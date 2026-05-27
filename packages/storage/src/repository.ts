import type { Artifact, ArtifactType, Job, Run } from "@conject/artifacts";
import { ArtifactSchema, createId } from "@conject/artifacts";
import type { ConjectConfig } from "@conject/config";
import type { Kysely } from "kysely";
import type { ConjectDatabase } from "./db.js";
import { ensureRunDirs } from "./paths.js";

export class ConjectRepository {
  constructor(
    private readonly db: Kysely<ConjectDatabase>,
    private readonly cwd: string
  ) {}

  async createRun(rawPrompt: string, config: ConjectConfig): Promise<Run> {
    const now = new Date().toISOString();
    const run: Run = {
      id: createId("run"),
      title: rawPrompt.slice(0, 80),
      rawPrompt,
      status: "created",
      createdAt: now,
      updatedAt: now
    };
    ensureRunDirs(this.cwd, run.id);
    await this.db
      .insertInto("runs")
      .values({
        id: run.id,
        title: run.title,
        raw_prompt: run.rawPrompt,
        status: run.status,
        config_json: JSON.stringify(config),
        created_at: run.createdAt,
        updated_at: run.updatedAt
      })
      .execute();
    await this.storeArtifact({
      runId: run.id,
      type: "config_snapshot",
      json: config,
      parentIds: []
    });
    await this.addEvent(run.id, null, "run.created", { prompt: rawPrompt });
    return run;
  }

  async getRun(runId: string): Promise<Run | undefined> {
    const row = await this.db.selectFrom("runs").selectAll().where("id", "=", runId).executeTakeFirst();
    if (!row) return undefined;
    return {
      id: row.id,
      title: row.title,
      rawPrompt: row.raw_prompt,
      status: row.status as Run["status"],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async getRunConfig(runId: string): Promise<ConjectConfig> {
    const row = await this.db.selectFrom("runs").select(["config_json"]).where("id", "=", runId).executeTakeFirstOrThrow();
    return JSON.parse(row.config_json) as ConjectConfig;
  }

  async listRuns(): Promise<Run[]> {
    const rows = await this.db.selectFrom("runs").selectAll().orderBy("created_at", "desc").execute();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      rawPrompt: row.raw_prompt,
      status: row.status as Run["status"],
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  async updateRunStatus(runId: string, status: Run["status"]): Promise<void> {
    await this.db
      .updateTable("runs")
      .set({ status, updated_at: new Date().toISOString() })
      .where("id", "=", runId)
      .execute();
  }

  async createJob(runId: string, agentId: Job["agentId"], inputArtifactIds: string[]): Promise<Job> {
    const now = new Date().toISOString();
    const job: Job = {
      id: createId("job"),
      runId,
      agentId,
      status: "pending",
      inputArtifactIds,
      outputArtifactIds: [],
      error: null,
      createdAt: now,
      startedAt: null,
      finishedAt: null
    };
    await this.db
      .insertInto("jobs")
      .values({
        id: job.id,
        run_id: runId,
        agent_id: agentId,
        status: job.status,
        input_artifact_ids_json: JSON.stringify(inputArtifactIds),
        output_artifact_ids_json: JSON.stringify([]),
        error: null,
        created_at: now,
        started_at: null,
        finished_at: null
      })
      .execute();
    return job;
  }

  async updateJob(job: Job): Promise<void> {
    await this.db
      .updateTable("jobs")
      .set({
        status: job.status,
        output_artifact_ids_json: JSON.stringify(job.outputArtifactIds),
        error: job.error ?? null,
        started_at: job.startedAt ?? null,
        finished_at: job.finishedAt ?? null
      })
      .where("id", "=", job.id)
      .execute();
  }

  async listJobs(runId: string): Promise<Job[]> {
    const rows = await this.db.selectFrom("jobs").selectAll().where("run_id", "=", runId).orderBy("created_at").execute();
    return rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      agentId: row.agent_id as Job["agentId"],
      status: row.status as Job["status"],
      inputArtifactIds: JSON.parse(row.input_artifact_ids_json) as string[],
      outputArtifactIds: JSON.parse(row.output_artifact_ids_json) as string[],
      error: row.error,
      createdAt: row.created_at,
      startedAt: row.started_at,
      finishedAt: row.finished_at
    }));
  }

  async storeArtifact(input: {
    runId: string;
    type: ArtifactType;
    json: unknown;
    parentIds?: string[];
    createdByJobId?: string | null;
  }): Promise<Artifact> {
    const artifact = ArtifactSchema.parse({
      id: createId("art"),
      runId: input.runId,
      type: input.type,
      parentIds: input.parentIds ?? [],
      createdByJobId: input.createdByJobId ?? null,
      json: input.json,
      createdAt: new Date().toISOString()
    });
    await this.db
      .insertInto("artifacts")
      .values({
        id: artifact.id,
        run_id: artifact.runId,
        type: artifact.type,
        parent_ids_json: JSON.stringify(artifact.parentIds),
        created_by_job_id: artifact.createdByJobId ?? null,
        json: JSON.stringify(artifact.json),
        created_at: artifact.createdAt
      })
      .execute();
    return artifact;
  }

  async getArtifact(runId: string, artifactId: string): Promise<Artifact | undefined> {
    const row = await this.db
      .selectFrom("artifacts")
      .selectAll()
      .where("run_id", "=", runId)
      .where("id", "=", artifactId)
      .executeTakeFirst();
    if (!row) return undefined;
    return ArtifactSchema.parse({
      id: row.id,
      runId: row.run_id,
      type: row.type,
      parentIds: JSON.parse(row.parent_ids_json),
      createdByJobId: row.created_by_job_id,
      json: JSON.parse(row.json),
      createdAt: row.created_at
    });
  }

  async updateArtifactJson(runId: string, artifactId: string, json: unknown): Promise<Artifact> {
    const existing = await this.getArtifact(runId, artifactId);
    if (!existing) throw new Error(`Artifact not found in ${runId}: ${artifactId}`);
    const updated = ArtifactSchema.parse({ ...existing, json });
    await this.db
      .updateTable("artifacts")
      .set({ json: JSON.stringify(updated.json) })
      .where("run_id", "=", runId)
      .where("id", "=", artifactId)
      .execute();
    return updated;
  }

  async findArtifactByDomainId(runId: string, domainId: string): Promise<Artifact | undefined> {
    const artifacts = await this.listArtifacts(runId);
    return artifacts.find((artifact) => {
      const json = artifact.json as { id?: string };
      return json.id === domainId || artifact.id === domainId;
    });
  }

  async listArtifacts(runId: string, type?: ArtifactType): Promise<Artifact[]> {
    let query = this.db.selectFrom("artifacts").selectAll().where("run_id", "=", runId);
    if (type) query = query.where("type", "=", type);
    const rows = await query.orderBy("created_at").execute();
    return rows.map((row) =>
      ArtifactSchema.parse({
        id: row.id,
        runId: row.run_id,
        type: row.type,
        parentIds: JSON.parse(row.parent_ids_json),
        createdByJobId: row.created_by_job_id,
        json: JSON.parse(row.json),
        createdAt: row.created_at
      })
    );
  }

  async addEvent(runId: string, jobId: string | null, type: string, payload: Record<string, unknown>): Promise<void> {
    await this.db
      .insertInto("events")
      .values({
        public_id: createId("evt"),
        run_id: runId,
        job_id: jobId,
        type,
        payload_json: JSON.stringify(payload),
        created_at: new Date().toISOString()
      })
      .execute();
  }

  async addToolCall(input: {
    runId: string;
    jobId: string | null;
    toolName: string;
    input: unknown;
    output?: unknown;
    status: "succeeded" | "failed";
    startedAt: string;
    finishedAt: string;
  }): Promise<void> {
    await this.db
      .insertInto("tool_calls")
      .values({
        public_id: createId("tool"),
        run_id: input.runId,
        job_id: input.jobId,
        tool_name: input.toolName,
        input_json: JSON.stringify(input.input),
        output_json: input.output === undefined ? null : JSON.stringify(input.output),
        status: input.status,
        created_at: input.startedAt,
        finished_at: input.finishedAt
      })
      .execute();
  }

  async listToolCalls(runId: string): Promise<
    Array<{
      id: string;
      runId: string;
      jobId: string | null;
      toolName: string;
      input: unknown;
      output: unknown;
      status: string;
      createdAt: string;
      finishedAt: string | null;
    }>
  > {
    const rows = await this.db.selectFrom("tool_calls").selectAll().where("run_id", "=", runId).orderBy("created_at").execute();
    return rows.map((row) => ({
      id: row.public_id,
      runId: row.run_id,
      jobId: row.job_id,
      toolName: row.tool_name,
      input: JSON.parse(row.input_json),
      output: row.output_json ? JSON.parse(row.output_json) : null,
      status: row.status,
      createdAt: row.created_at,
      finishedAt: row.finished_at
    }));
  }
}
