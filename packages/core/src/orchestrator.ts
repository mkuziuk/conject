import type { Artifact, ArtifactType, Job } from "@conject/artifacts";
import { EvidenceBundleSchema, HypothesisCardSchema, IdeaSchema, ImplementationPackSchema, RankingSchema, ResearchObjectiveSchema } from "@conject/artifacts";
import type { AgentRuntime, RunAgentJobResult } from "@conject/runtime";
import type { ConjectRepository } from "@conject/storage";

export class Orchestrator {
  constructor(
    private readonly repo: ConjectRepository,
    private readonly runtime: AgentRuntime
  ) {}

  async runFullPipeline(runId: string): Promise<void> {
    const run = await this.repo.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    await this.repo.updateRunStatus(runId, "running");
    try {
      await this.runStrategist(runId);
      await this.runResearchers(runId);
      await this.runReviewer(runId);
      await this.repo.updateRunStatus(runId, "succeeded");
      await this.repo.addEvent(runId, null, "run.succeeded", {});
    } catch (error) {
      await this.repo.updateRunStatus(runId, "failed");
      await this.repo.addEvent(runId, null, "run.failed", { error: errorMessage(error) });
      throw error;
    }
  }

  async runStrategist(runId: string): Promise<void> {
    const existingObjective = await this.repo.listArtifacts(runId, "research_objective");
    const existingIdeas = await this.repo.listArtifacts(runId, "idea");
    if (existingObjective.length > 0 && existingIdeas.length > 0) return;

    const run = await this.repo.getRun(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    const job = await this.repo.createJob(runId, "strategist", []);
    await this.executeJob(job, run.rawPrompt, []);
  }

  async runResearchers(runId: string): Promise<void> {
    const objective = (await this.repo.listArtifacts(runId, "research_objective"))[0];
    if (!objective) throw new Error("Cannot run researchers before Strategist output exists.");
    const ideas = await this.repo.listArtifacts(runId, "idea");
    const existingBundles = await this.repo.listArtifacts(runId, "evidence_bundle");
    const existingIdeaIds = new Set(existingBundles.map((artifact) => (artifact.json as { ideaId: string }).ideaId));

    for (const idea of ideas) {
      const ideaJson = idea.json as { id: string };
      if (existingIdeaIds.has(ideaJson.id)) continue;
      const job = await this.repo.createJob(runId, "researcher", [objective.id, idea.id]);
      try {
        await this.executeJob(job, `Research idea ${ideaJson.id}`, [objective, idea]);
      } catch (error) {
        await this.repo.addEvent(runId, job.id, "researcher.failed.continued", { error: errorMessage(error) });
      }
    }
  }

  async runReviewer(runId: string): Promise<void> {
    const existingRanking = await this.repo.listArtifacts(runId, "ranking");
    if (existingRanking.length > 0) return;
    const objective = (await this.repo.listArtifacts(runId, "research_objective"))[0];
    if (!objective) throw new Error("Cannot run Reviewer before Strategist output exists.");
    const ideas = await this.repo.listArtifacts(runId, "idea");
    const bundles = await this.repo.listArtifacts(runId, "evidence_bundle");
    if (ideas.length === 0) throw new Error("Cannot run Reviewer without ideas.");
    const inputArtifacts = [objective, ...ideas, ...bundles];
    const job = await this.repo.createJob(
      runId,
      "reviewer",
      inputArtifacts.map((artifact) => artifact.id)
    );
    await this.executeJob(job, "Review evidence and rank hypotheses.", inputArtifacts);
  }

  async runBuilder(runId: string, hypothesisId: string): Promise<Artifact[]> {
    const hypothesis = await this.repo.findArtifactByDomainId(runId, hypothesisId);
    if (!hypothesis || hypothesis.type !== "hypothesis_card") {
      throw new Error(`Hypothesis not found in run ${runId}: ${hypothesisId}`);
    }
    const objective = (await this.repo.listArtifacts(runId, "research_objective"))[0];
    const evidence = (await this.repo.listArtifacts(runId, "evidence_bundle")).find(
      (artifact) => (artifact.json as { ideaId?: string }).ideaId === (hypothesis.json as { ideaId: string }).ideaId
    );
    const inputs = [hypothesis, ...(objective ? [objective] : []), ...(evidence ? [evidence] : [])];
    const job = await this.repo.createJob(
      runId,
      "builder",
      inputs.map((artifact) => artifact.id)
    );
    return this.executeJob(job, `Build implementation pack for ${hypothesisId}.`, inputs);
  }

  private async executeJob(job: Job, prompt: string, inputArtifacts: Artifact[]): Promise<Artifact[]> {
    const started: Job = { ...job, status: "running", startedAt: new Date().toISOString() };
    await this.repo.updateJob(started);
    await this.repo.addEvent(job.runId, job.id, "job.started", { agentId: job.agentId });

    try {
      const config = await this.repo.getRunConfig(job.runId);
      const result = await this.runtime.runAgentJob({
        runId: job.runId,
        jobId: job.id,
        agentId: job.agentId,
        inputArtifacts,
        prompt,
        config,
        logToolCall: async (call) => {
          await this.repo.addToolCall({
            runId: job.runId,
            jobId: job.id,
            toolName: call.toolName,
            input: call.input,
            output: call.error ? { ...(typeof call.output === "object" && call.output !== null ? call.output : {}), error: call.error } : call.output,
            status: call.status,
            startedAt: call.startedAt,
            finishedAt: call.finishedAt
          });
        }
      });
      const artifacts = await this.persistResult(job, result);
      const succeeded: Job = {
        ...started,
        status: "succeeded",
        outputArtifactIds: artifacts.map((artifact) => artifact.id),
        finishedAt: new Date().toISOString()
      };
      await this.repo.updateJob(succeeded);
      await this.repo.addEvent(job.runId, job.id, "job.succeeded", {
        outputArtifactIds: succeeded.outputArtifactIds
      });
      return artifacts;
    } catch (error) {
      const failed: Job = {
        ...started,
        status: "failed",
        error: errorMessage(error),
        finishedAt: new Date().toISOString()
      };
      await this.repo.updateJob(failed);
      await this.repo.addEvent(job.runId, job.id, "job.failed", { error: failed.error });
      throw error;
    }
  }

  private async persistResult(job: Job, result: RunAgentJobResult): Promise<Artifact[]> {
    const artifacts: Artifact[] = [];
    for (const output of result.outputArtifacts) {
      validateOutput(output.type, output.json);
      artifacts.push(
        await this.repo.storeArtifact({
          runId: job.runId,
          type: output.type,
          json: output.json,
          parentIds: output.parentIds ?? job.inputArtifactIds,
          createdByJobId: job.id
        })
      );
    }
    return artifacts;
  }
}

function validateOutput(type: ArtifactType, json: unknown): void {
  if (type === "research_objective") ResearchObjectiveSchema.parse(json);
  if (type === "idea") IdeaSchema.parse(json);
  if (type === "evidence_bundle") EvidenceBundleSchema.parse(json);
  if (type === "hypothesis_card") HypothesisCardSchema.parse(json);
  if (type === "ranking") RankingSchema.parse(json);
  if (type === "implementation_pack") ImplementationPackSchema.parse(json);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
