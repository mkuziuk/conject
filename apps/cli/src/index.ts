#!/usr/bin/env node
import { loadConfig } from "@conject/config";
import { checkPiSdkAvailability } from "@conject/runtime";
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
import { Command, Option } from "commander";
import {
  assertPiOnlyRuntimeFlag,
  createConjectController,
  formatJob,
  formatRun
} from "./controller.js";
import { runTui } from "./tui.js";
import { createOAuthLoginCallbacks } from "./ui-oauth.js";

const program = new Command();

program.name("conject").description("Local artifact-first research harness").version("0.1.0");

program
  .command("tui")
  .description("Open the Conject TUI")
  .action(async () => {
    await runTui(process.cwd());
  });

program
  .command("init")
  .description("Create root conject.yaml")
  .option("--preset <preset>", "quick, balanced, or deep", "balanced")
  .action(async (options: { preset: "quick" | "balanced" | "deep" }) => {
    const path = createConjectController().init(options.preset);
    console.log(`Wrote ${path}`);
  });

program
  .command("new")
  .description("Create a run from a research prompt")
  .argument("<prompt>")
  .action(async (prompt: string) => {
    const run = await createConjectController().createRun(prompt);
    console.log(run.id);
  });

program
  .command("run")
  .description("Run Strategist, Researchers, and Reviewer through Pi")
  .argument("<run-id>")
  .addOption(new Option("--real-research", "deprecated; Conject runs through Pi only").hideHelp())
  .addOption(new Option("--runtime <runtime>", "deprecated; Conject runs through Pi only").hideHelp())
  .action(async (runId: string, options: { realResearch?: boolean; runtime?: string }) => {
    if (options.realResearch) throw new Error("Conject runs through Pi only. Remove --real-research.");
    assertPiOnlyRuntimeFlag(options.runtime);
    await createConjectController().runPipeline(runId);
    console.log(`Run complete: ${runId}`);
  });

program
  .command("status")
  .description("Show jobs and artifact counts for a run")
  .argument("<run-id>")
  .action(async (runId: string) => {
    const detail = await createConjectController().getRunDetail(runId);
    console.log(formatRun(detail.run));
    console.log("");
    console.log("Jobs");
    for (const job of detail.jobs) console.log(formatJob(job));
    console.log("");
    console.log("Artifacts");
    const counts = new Map<string, number>();
    for (const artifact of detail.artifacts) counts.set(artifact.type, (counts.get(artifact.type) ?? 0) + 1);
    for (const [type, count] of [...counts.entries()].sort()) console.log(`${type}: ${count}`);
    if (detail.toolCalls.length > 0) {
      console.log("");
      console.log("Tool calls");
      for (const call of detail.toolCalls) console.log(`${call.toolName} ${call.status}`);
    }
  });

program
  .command("list")
  .description("List runs")
  .action(async () => {
    const runs = await createConjectController().listRuns();
    for (const run of runs) console.log(formatRun(run));
  });

program
  .command("open")
  .description("Open an artifact by internal id or run-scoped domain id")
  .argument("<run-id>")
  .argument("<artifact-id>")
  .action(async (runId: string, artifactId: string) => {
    const detail = await createConjectController().getRunDetail(runId);
    const artifact = detail.artifacts.find((candidate) => candidate.id === artifactId || (candidate.json as { id?: string }).id === artifactId);
    if (!artifact) throw new Error(`Artifact not found in ${runId}: ${artifactId}`);
    console.log(JSON.stringify(artifact, null, 2));
  });

program
  .command("rank")
  .description("Show ranked hypotheses for a run")
  .argument("<run-id>")
  .action(async (runId: string) => {
    const ranking = (await createConjectController().getRunDetail(runId)).ranking;
    if (!ranking) throw new Error(`No ranking for ${runId}. Run 'conject run ${runId}' first.`);
    for (const item of ranking.items) {
      console.log(`${item.rank}. ${item.hypothesisId} score=${item.finalScore} recommendation=${item.recommendation}`);
      console.log(`   ${item.explanation}`);
    }
    for (const warning of ranking.warnings) console.log(`warning: ${warning}`);
  });

program
  .command("export")
  .description("Export run artifacts to Markdown")
  .argument("<run-id>")
  .option("--format <format>", "currently only markdown", "markdown")
  .action(async (runId: string, options: { format: string }) => {
    if (options.format !== "markdown") throw new Error("Only --format markdown is supported.");
    console.log(await createConjectController().exportRun(runId));
  });

program
  .command("implement")
  .description("Generate an implementation pack for a hypothesis through Pi")
  .argument("<run-id>")
  .argument("<hypothesis-id>")
  .addOption(new Option("--runtime <runtime>", "deprecated; Conject implements through Pi only").hideHelp())
  .action(async (runId: string, hypothesisId: string, options: { runtime?: string }) => {
    assertPiOnlyRuntimeFlag(options.runtime);
    console.log(await createConjectController().implement(runId, hypothesisId));
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
  .description("Check whether the LLM runtime config is ready")
  .action(async () => {
    const config = loadConfig(process.cwd());
    const result = await checkPiSdkAvailability(config);
    if (result.ok) {
      console.log("LLM runtime ready");
      return;
    }
    throw new Error(result.error);
  });

registerAuthCommands(program.command("auth").description("Manage Conject auth"));
registerAuthCommands(program.command("pi").description("Compatibility alias for Conject auth commands"));

const run = process.argv.slice(2).length === 0 ? runTui(process.cwd()) : program.parseAsync(process.argv);
run.catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function registerAuthCommands(command: Command): void {
  command
    .command("login")
    .description("Log in using the auth method configured in models.default.auth")
    .option("--manual", "Prompt for a pasted authorization code or redirect URL instead of waiting only for the browser callback")
    .action(async (options: { manual?: boolean }) => {
      const controller = createConjectController();
      const readiness = controller.authStatus();
      if (readiness.authType === "apiKeyEnv") {
        console.log(`Conject auth uses environment variable ${readiness.label}. No login is needed.`);
        return;
      }

      const callbacks = createOAuthLoginCallbacks({ manual: Boolean(options.manual) });
      let loginSucceeded = false;
      try {
        const next = await controller.authLogin(callbacks);
        console.log(`Stored Conject auth credentials for ${next.provider} at ${next.storagePath}.`);
        loginSucceeded = true;
      } finally {
        callbacks.close();
      }
      if (loginSucceeded) {
        // The OAuth callback server can leave a browser socket alive after credentials are stored.
        process.exit(0);
      }
    });

  command
    .command("logout")
    .description("Remove credentials for the auth method configured in models.default.auth")
    .action(async () => {
      const controller = createConjectController();
      const readiness = controller.authStatus();
      if (readiness.authType === "apiKeyEnv") {
        console.log(`Conject auth uses environment variable ${readiness.label}. Nothing to remove.`);
        return;
      }
      const next = controller.authLogout();
      console.log(`Removed Conject auth credentials for ${next.provider} from ${next.storagePath}.`);
    });

  command
    .command("status")
    .description("Show configured Conject auth readiness")
    .action(async () => {
      try {
        const readiness = createConjectController().authStatus();
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
