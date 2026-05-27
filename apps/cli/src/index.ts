#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import type { HypothesisCard, ImplementationPack, Job, Run } from "@conject/artifacts";
import { loadConfig, writeDefaultConfig } from "@conject/config";
import { Orchestrator } from "@conject/core";
import { exportRunMarkdown, materializeImplementationPack } from "@conject/export";
import {
  MockAgentRuntime,
  PiAgentRuntime,
  ToolBackedResearchRuntime,
  checkPiSdkAvailability,
  getPiAuthReadiness,
  loginPiModelAuth,
  logoutPiModelAuth,
  type AgentRuntime,
  type PiOAuthLoginCallbacks
} from "@conject/runtime";
import { ConjectRepository, openDatabase } from "@conject/storage";
import {
  ArxivPaperSearchProvider,
  OpenAlexPaperSearchProvider,
  SearxngWebSearchProvider,
  SemanticScholarPaperSearchProvider,
  TavilyWebSearchProvider,
  searchPapersAcrossProviders,
  searchWebAcrossProviders,
  type PaperSearchProvider,
  type WebSearchProvider
} from "@conject/tools";
import { Command } from "commander";

const program = new Command();

program.name("conject").description("Local artifact-first research harness").version("0.1.0");

program
  .command("init")
  .description("Create root conject.yaml")
  .option("--preset <preset>", "quick, balanced, or deep", "balanced")
  .action(async (options: { preset: "quick" | "balanced" | "deep" }) => {
    const path = writeDefaultConfig(process.cwd(), options.preset);
    console.log(`Wrote ${path}`);
  });

program
  .command("new")
  .description("Create a run from a research prompt")
  .argument("<prompt>")
  .action(async (prompt: string) => {
    await withRepo(async (repo) => {
      const config = loadConfig(process.cwd());
      const run = await repo.createRun(prompt, config);
      console.log(run.id);
    });
  });

program
  .command("run")
  .description("Run Strategist, Researchers, and Reviewer for a run")
  .argument("<run-id>")
  .option("--real-research", "Use configured paper/web providers for Researcher jobs")
  .option("--runtime <runtime>", "mock or pi; defaults to the run config runtime.default")
  .action(async (runId: string, options: { realResearch?: boolean; runtime?: string }) => {
    await withRepo(async (repo) => {
      const orchestrator = new Orchestrator(
        repo,
        await createRuntime(repo, runId, { realResearch: Boolean(options.realResearch), runtime: parsePipelineRuntime(options.runtime) })
      );
      await orchestrator.runFullPipeline(runId);
      console.log(`Run complete: ${runId}`);
    });
  });

program
  .command("status")
  .description("Show jobs and artifact counts for a run")
  .argument("<run-id>")
  .action(async (runId: string) => {
    await withRepo(async (repo) => {
      const run = await requireRun(repo, runId);
      const jobs = await repo.listJobs(runId);
      const artifacts = await repo.listArtifacts(runId);
      const toolCalls = await repo.listToolCalls(runId);
      console.log(formatRun(run));
      console.log("");
      console.log("Jobs");
      for (const job of jobs) console.log(formatJob(job));
      console.log("");
      console.log("Artifacts");
      const counts = new Map<string, number>();
      for (const artifact of artifacts) counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
      for (const [type, count] of [...counts.entries()].sort()) console.log(`${type}: ${count}`);
      if (toolCalls.length > 0) {
        console.log("");
        console.log("Tool calls");
        for (const call of toolCalls) console.log(`${call.toolName} ${call.status}`);
      }
    });
  });

program
  .command("list")
  .description("List runs")
  .action(async () => {
    await withRepo(async (repo) => {
      const runs = await repo.listRuns();
      for (const run of runs) console.log(formatRun(run));
    });
  });

program
  .command("open")
  .description("Open an artifact by internal id or run-scoped domain id")
  .argument("<run-id>")
  .argument("<artifact-id>")
  .action(async (runId: string, artifactId: string) => {
    await withRepo(async (repo) => {
      await requireRun(repo, runId);
      const artifact = (await repo.getArtifact(runId, artifactId)) ?? (await repo.findArtifactByDomainId(runId, artifactId));
      if (!artifact) throw new Error(`Artifact not found in ${runId}: ${artifactId}`);
      console.log(JSON.stringify(artifact, null, 2));
    });
  });

program
  .command("rank")
  .description("Show ranked hypotheses for a run")
  .argument("<run-id>")
  .action(async (runId: string) => {
    await withRepo(async (repo) => {
      await requireRun(repo, runId);
      const ranking = (await repo.listArtifacts(runId, "ranking"))[0]?.json as
        | { items: Array<{ rank: number; hypothesisId: string; finalScore: number; recommendation: string; explanation: string }>; warnings: string[] }
        | undefined;
      if (!ranking) throw new Error(`No ranking for ${runId}. Run 'conject run ${runId}' first.`);
      for (const item of ranking.items) {
        console.log(`${item.rank}. ${item.hypothesisId} score=${item.finalScore} recommendation=${item.recommendation}`);
        console.log(`   ${item.explanation}`);
      }
      for (const warning of ranking.warnings) console.log(`warning: ${warning}`);
    });
  });

program
  .command("export")
  .description("Export run artifacts to Markdown")
  .argument("<run-id>")
  .option("--format <format>", "currently only markdown", "markdown")
  .action(async (runId: string, options: { format: string }) => {
    if (options.format !== "markdown") throw new Error("Only --format markdown is supported.");
    await withRepo(async (repo) => {
      await requireRun(repo, runId);
      const outDir = await exportRunMarkdown(repo, process.cwd(), runId);
      console.log(outDir);
    });
  });

program
  .command("implement")
  .description("Generate an implementation pack for a hypothesis")
  .argument("<run-id>")
  .argument("<hypothesis-id>")
  .option("--runtime <runtime>", "scaffold, mock, or pi", "scaffold")
  .action(async (runId: string, hypothesisId: string, options: { runtime?: string }) => {
    await withRepo(async (repo) => {
      await requireRun(repo, runId);
      const artifact = await repo.findArtifactByDomainId(runId, hypothesisId);
      if (!artifact || artifact.type !== "hypothesis_card") {
        throw new Error(`Hypothesis not found in ${runId}: ${hypothesisId}`);
      }
      const runtime = parseImplementRuntime(options.runtime);
      if (runtime !== "scaffold") {
        const orchestrator = new Orchestrator(repo, await createRuntime(repo, runId, { runtime }));
        const outputs = await orchestrator.runBuilder(runId, hypothesisId);
        const packArtifact = outputs.find((output) => output.type === "implementation_pack");
        if (!packArtifact) throw new Error(`Builder did not produce an implementation pack for ${hypothesisId}.`);
        const pack = materializeImplementationPack(process.cwd(), runId, artifact.json as HypothesisCard, packArtifact.json as ImplementationPack);
        await repo.updateArtifactJson(runId, packArtifact.id, pack);
        await repo.addEvent(runId, packArtifact.createdByJobId ?? null, "builder.pack_materialized", {
          hypothesisId,
          generatedFiles: pack.generatedFiles
        });
        console.log(pack.planMarkdownPath);
        return;
      }
      const job = await repo.createJob(runId, "builder", [artifact.id]);
      await repo.updateJob({ ...job, status: "running", startedAt: new Date().toISOString() });
      const pack = materializeImplementationPack(process.cwd(), runId, artifact.json as HypothesisCard);
      const stored = await repo.storeArtifact({
        runId,
        type: "implementation_pack",
        json: pack,
        parentIds: [artifact.id],
        createdByJobId: job.id
      });
      await repo.updateJob({
        ...job,
        status: "succeeded",
        outputArtifactIds: [stored.id],
        startedAt: job.startedAt ?? new Date().toISOString(),
        finishedAt: new Date().toISOString()
      });
      await repo.addEvent(runId, job.id, "builder.pack_materialized", { hypothesisId, generatedFiles: pack.generatedFiles });
      console.log(pack.planMarkdownPath);
    });
  });

program
  .command("search")
  .description("Smoke-test configured paper or web search providers")
  .argument("<query>")
  .option("--type <type>", "paper or web", "paper")
  .option("--limit <limit>", "maximum results", "5")
  .action(async (query: string, options: { type: string; limit: string }) => {
    const config = loadConfig(process.cwd());
    const limit = Number.parseInt(options.limit, 10);
    if (!Number.isFinite(limit) || limit <= 0) throw new Error("--limit must be a positive integer.");

    if (options.type === "paper") {
      const providers = createPaperProviders(config);
      if (providers.length === 0) throw new Error("No paper providers are enabled in conject.yaml.");
      const results = await searchPapersAcrossProviders({ query, limit, providers });
      for (const result of results) {
        console.log(`${result.provider ?? "paper"} ${result.year ?? ""} ${result.title}`);
        if (result.url) console.log(`  ${result.url}`);
        if (result.abstract) console.log(`  ${result.abstract.slice(0, 220)}${result.abstract.length > 220 ? "..." : ""}`);
      }
      return;
    }

    if (options.type === "web") {
      const providers = createWebProviders(config);
      if (providers.length === 0) {
        console.log("No configured web providers are available. Set TAVILY_API_KEY or providers.web.searxng.baseUrl.");
        return;
      }
      const results = await searchWebAcrossProviders({ query, limit, providers });
      for (const result of results) {
        console.log(`${result.provider} ${result.title}`);
        console.log(`  ${result.url}`);
        if (result.snippet) console.log(`  ${result.snippet.slice(0, 220)}${result.snippet.length > 220 ? "..." : ""}`);
      }
      return;
    }

    throw new Error("--type must be 'paper' or 'web'.");
  });

program
  .command("pi-check")
  .description("Check whether Conject-owned Pi runtime config is ready")
  .action(async () => {
    const config = loadConfig(process.cwd());
    const result = await checkPiSdkAvailability(config);
    if (result.ok) {
      console.log("Pi runtime ready");
      return;
    }
    throw new Error(result.error);
  });

const piCommand = program.command("pi").description("Manage Conject-owned Pi authentication");

piCommand
  .command("login")
  .description("Log in using the auth method configured in models.default.auth")
  .action(async () => {
    const config = loadConfig(process.cwd());
    const readiness = getPiAuthReadiness(config);
    if (readiness.authType === "apiKeyEnv") {
      console.log(`Pi auth uses environment variable ${readiness.label}. No login is needed.`);
      return;
    }

    const callbacks = createOAuthLoginCallbacks();
    try {
      const next = await loginPiModelAuth(config, callbacks);
      console.log(`Stored ${next.provider} credentials at ${next.storagePath}.`);
    } finally {
      callbacks.close();
    }
  });

piCommand
  .command("logout")
  .description("Remove credentials for the auth method configured in models.default.auth")
  .action(async () => {
    const config = loadConfig(process.cwd());
    const readiness = getPiAuthReadiness(config);
    if (readiness.authType === "apiKeyEnv") {
      console.log(`Pi auth uses environment variable ${readiness.label}. Nothing to remove.`);
      return;
    }
    const next = logoutPiModelAuth(config);
    console.log(`Removed ${next.provider} credentials from ${next.storagePath}.`);
  });

piCommand
  .command("status")
  .description("Show configured Pi provider/model/auth readiness")
  .action(async () => {
    const config = loadConfig(process.cwd());
    try {
      const readiness = getPiAuthReadiness(config);
      console.log(`Provider: ${readiness.provider}`);
      console.log(`Model: ${readiness.model}`);
      console.log(`Auth: ${readiness.authType}`);
      if (readiness.storagePath) console.log(`Storage: ${readiness.storagePath}`);
      if (readiness.source) console.log(`Source: ${readiness.source}${readiness.label ? ` (${readiness.label})` : ""}`);
      console.log(`Ready: ${readiness.ready ? "yes" : "no"}`);
      if (readiness.error) console.log(`Next: ${readiness.error}`);
    } catch (error) {
      console.log(`Ready: no`);
      console.log(`Error: ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function createOAuthLoginCallbacks(): PiOAuthLoginCallbacks & { close: () => void } {
  if (!process.stdin.isTTY) throw new Error("Pi OAuth login requires an interactive terminal.");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (message: string): Promise<string> => rl.question(`${message} `);

  return {
    onAuth: (info) => {
      console.log(info.instructions ?? "Complete OAuth login in your browser.");
      console.log(info.url);
      openBrowser(info.url);
    },
    onDeviceCode: (info) => {
      console.log(`Open ${info.verificationUri} and enter code ${info.userCode}.`);
    },
    onPrompt: (prompt) => ask(prompt.message),
    onProgress: (message) => console.log(message),
    onManualCodeInput: () => ask("Paste the authorization code or full redirect URL, or complete login in the browser:"),
    onSelect: async (prompt) => {
      console.log(prompt.message);
      for (const option of prompt.options) console.log(`${option.id}: ${option.label}`);
      const selected = await ask("Select option id:");
      return selected.trim() || undefined;
    },
    close: () => rl.close()
  };
}

function openBrowser(url: string): void {
  const command =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : process.env.DISPLAY ? "xdg-open" : undefined;
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  if (!command) return;
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Printing the URL above is the reliable fallback.
  }
}

async function withRepo<T>(fn: (repo: ConjectRepository) => Promise<T>): Promise<T> {
  const db = openDatabase(process.cwd());
  try {
    return await fn(new ConjectRepository(db, process.cwd()));
  } finally {
    await db.destroy();
  }
}

type PipelineRuntime = "mock" | "pi";
type ImplementRuntime = "scaffold" | PipelineRuntime;

async function createRuntime(
  repo: ConjectRepository,
  runId: string,
  options: { realResearch?: boolean; runtime?: PipelineRuntime } = {}
): Promise<AgentRuntime> {
  const config = await repo.getRunConfig(runId);
  const runtime = options.runtime ?? config.runtime.default;
  if (runtime === "pi" && !config.runtime.pi.useSdk) {
    throw new Error("runtime.pi.useSdk is false in conject.yaml; enable it before using --runtime pi.");
  }
  const delegate = runtime === "pi" ? new PiAgentRuntime({ cwd: process.cwd() }) : new MockAgentRuntime();
  return options.realResearch ? new ToolBackedResearchRuntime({ delegate }) : delegate;
}

function parsePipelineRuntime(value: string | undefined): PipelineRuntime | undefined {
  if (value === undefined) return undefined;
  if (value === "mock" || value === "pi") return value;
  throw new Error("--runtime must be 'mock' or 'pi'.");
}

function parseImplementRuntime(value: string | undefined): ImplementRuntime {
  const runtime = value ?? "scaffold";
  if (runtime === "scaffold" || runtime === "mock" || runtime === "pi") return runtime;
  throw new Error("--runtime must be 'scaffold', 'mock', or 'pi'.");
}

async function requireRun(repo: ConjectRepository, runId: string): Promise<Run> {
  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  return run;
}

function formatRun(run: Run): string {
  return `${run.id} ${run.status} ${run.createdAt} ${run.title}`;
}

function formatJob(job: Job): string {
  return `${job.id} ${job.agentId} ${job.status}${job.error ? ` error=${job.error}` : ""}`;
}

function createPaperProviders(config: ReturnType<typeof loadConfig>): PaperSearchProvider[] {
  const providers: PaperSearchProvider[] = [];
  if (config.providers.paper.openAlex.enabled) {
    providers.push(new OpenAlexPaperSearchProvider({ mailto: config.providers.paper.openAlex.mailto }));
  }
  if (config.providers.paper.semanticScholar.enabled) {
    const apiKeyEnv = config.providers.paper.semanticScholar.apiKeyEnv;
    providers.push(new SemanticScholarPaperSearchProvider({ apiKey: apiKeyEnv ? process.env[apiKeyEnv] : undefined }));
  }
  if (config.providers.paper.arxiv.enabled) {
    providers.push(new ArxivPaperSearchProvider());
  }
  return providers;
}

function createWebProviders(config: ReturnType<typeof loadConfig>): WebSearchProvider[] {
  if (!config.providers.web.enabled) return [];
  const providers: WebSearchProvider[] = [];
  if (config.providers.web.tavily.enabled) {
    const apiKey = process.env[config.providers.web.tavily.apiKeyEnv];
    if (apiKey) providers.push(new TavilyWebSearchProvider({ apiKey }));
  }
  if (config.providers.web.searxng.enabled && config.providers.web.searxng.baseUrl) {
    providers.push(new SearxngWebSearchProvider({ baseUrl: config.providers.web.searxng.baseUrl }));
  }
  return providers;
}
