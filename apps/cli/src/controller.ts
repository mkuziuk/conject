import type { Artifact, HypothesisCard, ImplementationPack, Job, Run } from "@conject/artifacts";
import { hasConfig, loadConfig, writeDefaultConfig, type ConjectConfig } from "@conject/config";
import { Orchestrator } from "@conject/core";
import { exportRunMarkdown, materializeImplementationPack } from "@conject/export";
import {
  MockAgentRuntime,
  PiAgentRuntime,
  ToolBackedResearchRuntime,
  getPiAuthReadiness,
  loginPiModelAuth,
  logoutPiModelAuth,
  type AgentRuntime,
  type PiAuthReadiness,
  type PiOAuthLoginCallbacks
} from "@conject/runtime";
import { ConjectRepository, openDatabase } from "@conject/storage";

export type PipelineRuntime = "mock" | "pi";
export type ImplementRuntime = "scaffold" | PipelineRuntime;

export type RunDetail = {
  run: Run;
  jobs: Job[];
  artifacts: Artifact[];
  toolCalls: Awaited<ReturnType<ConjectRepository["listToolCalls"]>>;
  events: Awaited<ReturnType<ConjectRepository["listEvents"]>>;
  ranking?: {
    items: Array<{ rank: number; hypothesisId: string; finalScore: number; recommendation: string; explanation: string }>;
    warnings: string[];
  };
};

export type ProjectSnapshot = {
  cwd: string;
  hasConfig: boolean;
  config?: ConjectConfig;
  runs: Run[];
  auth?: PiAuthReadiness;
  configError?: string;
};

export class ConjectController {
  constructor(
    readonly cwd: string,
    private readonly env: NodeJS.ProcessEnv = process.env
  ) {}

  get hasConfig(): boolean {
    return hasConfig(this.cwd);
  }

  init(preset: "quick" | "balanced" | "deep" = "balanced"): string {
    return writeDefaultConfig(this.cwd, preset);
  }

  loadConfig(): ConjectConfig {
    return loadConfig(this.cwd);
  }

  async snapshot(): Promise<ProjectSnapshot> {
    if (!this.hasConfig) {
      return { cwd: this.cwd, hasConfig: false, runs: [] };
    }
    try {
      const config = this.loadConfig();
      const runs = await this.withRepo((repo) => repo.listRuns());
      let auth: PiAuthReadiness | undefined;
      try {
        auth = getPiAuthReadiness(config, this.env, { cwd: this.cwd });
      } catch {
        auth = undefined;
      }
      return { cwd: this.cwd, hasConfig: true, config, runs, auth };
    } catch (error) {
      return { cwd: this.cwd, hasConfig: true, runs: [], configError: errorMessage(error) };
    }
  }

  async createRun(prompt: string): Promise<Run> {
    const config = this.loadConfig();
    return this.withRepo((repo) => repo.createRun(prompt, config));
  }

  async listRuns(): Promise<Run[]> {
    return this.withRepo((repo) => repo.listRuns());
  }

  async getRunDetail(runId: string): Promise<RunDetail> {
    return this.withRepo(async (repo) => {
      const run = await requireRun(repo, runId);
      const jobs = await repo.listJobs(runId);
      const artifacts = await repo.listArtifacts(runId);
      const toolCalls = await repo.listToolCalls(runId);
      const events = await repo.listEvents(runId);
      const rankingArtifact = artifacts.find((artifact) => artifact.type === "ranking");
      return {
        run,
        jobs,
        artifacts,
        toolCalls,
        events,
        ranking: rankingArtifact?.json as RunDetail["ranking"]
      };
    });
  }

  async runPipeline(runId: string, options: { realResearch?: boolean; runtime?: PipelineRuntime } = {}): Promise<void> {
    await this.withRepo(async (repo) => {
      const orchestrator = new Orchestrator(repo, await this.createRuntime(repo, runId, options));
      await orchestrator.runFullPipeline(runId);
    });
  }

  async exportRun(runId: string): Promise<string> {
    return this.withRepo(async (repo) => {
      await requireRun(repo, runId);
      return exportRunMarkdown(repo, this.cwd, runId);
    });
  }

  async implement(runId: string, hypothesisId: string, runtime: ImplementRuntime = "scaffold"): Promise<string> {
    return this.withRepo(async (repo) => {
      await requireRun(repo, runId);
      const artifact = await repo.findArtifactByDomainId(runId, hypothesisId);
      if (!artifact || artifact.type !== "hypothesis_card") {
        throw new Error(`Hypothesis not found in ${runId}: ${hypothesisId}`);
      }
      if (runtime !== "scaffold") {
        const orchestrator = new Orchestrator(repo, await this.createRuntime(repo, runId, { runtime }));
        const outputs = await orchestrator.runBuilder(runId, hypothesisId);
        const packArtifact = outputs.find((output) => output.type === "implementation_pack");
        if (!packArtifact) throw new Error(`Builder did not produce an implementation pack for ${hypothesisId}.`);
        const pack = materializeImplementationPack(this.cwd, runId, artifact.json as HypothesisCard, packArtifact.json as ImplementationPack);
        await repo.updateArtifactJson(runId, packArtifact.id, pack);
        await repo.addEvent(runId, packArtifact.createdByJobId ?? null, "builder.pack_materialized", {
          hypothesisId,
          generatedFiles: pack.generatedFiles
        });
        return pack.planMarkdownPath;
      }
      const job = await repo.createJob(runId, "builder", [artifact.id]);
      await repo.updateJob({ ...job, status: "running", startedAt: new Date().toISOString() });
      const pack = materializeImplementationPack(this.cwd, runId, artifact.json as HypothesisCard);
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
      return pack.planMarkdownPath;
    });
  }

  authStatus(): PiAuthReadiness {
    return getPiAuthReadiness(this.loadConfig(), this.env, { cwd: this.cwd });
  }

  async authLogin(callbacks: PiOAuthLoginCallbacks): Promise<PiAuthReadiness> {
    return loginPiModelAuth(this.loadConfig(), callbacks, this.env, { cwd: this.cwd });
  }

  authLogout(): PiAuthReadiness {
    return logoutPiModelAuth(this.loadConfig(), this.env, { cwd: this.cwd });
  }

  private async createRuntime(
    repo: ConjectRepository,
    runId: string,
    options: { realResearch?: boolean; runtime?: PipelineRuntime } = {}
  ): Promise<AgentRuntime> {
    const config = await repo.getRunConfig(runId);
    const runtime = options.runtime ?? config.runtime.default;
    if (runtime === "pi" && !config.runtime.pi.useSdk) {
      throw new Error("runtime.pi.useSdk is false in conject.yaml; enable it before using --runtime pi.");
    }
    const delegate = runtime === "pi" ? new PiAgentRuntime({ cwd: this.cwd, env: this.env }) : new MockAgentRuntime();
    return options.realResearch ? new ToolBackedResearchRuntime({ delegate, env: this.env }) : delegate;
  }

  private async withRepo<T>(fn: (repo: ConjectRepository) => Promise<T>): Promise<T> {
    const db = openDatabase(this.cwd);
    try {
      return await fn(new ConjectRepository(db, this.cwd));
    } finally {
      await db.destroy();
    }
  }
}

export function createConjectController(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): ConjectController {
  return new ConjectController(cwd, env);
}

export function parsePipelineRuntime(value: string | undefined): PipelineRuntime | undefined {
  if (value === undefined) return undefined;
  if (value === "mock" || value === "pi") return value;
  throw new Error("--runtime must be 'mock' or 'pi'.");
}

export function parseImplementRuntime(value: string | undefined): ImplementRuntime {
  const runtime = value ?? "scaffold";
  if (runtime === "scaffold" || runtime === "mock" || runtime === "pi") return runtime;
  throw new Error("--runtime must be 'scaffold', 'mock', or 'pi'.");
}

export function formatRun(run: Run): string {
  return `${run.id} ${run.status} ${run.createdAt} ${run.title}`;
}

export function formatJob(job: Job): string {
  return `${job.id} ${job.agentId} ${job.status}${job.error ? ` error=${job.error}` : ""}`;
}

async function requireRun(repo: ConjectRepository, runId: string): Promise<Run> {
  const run = await repo.getRun(runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  return run;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
