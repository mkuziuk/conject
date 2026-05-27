import Database from "better-sqlite3";
import { Kysely, SqliteDialect, type Generated, type Insertable, type Selectable, type Updateable } from "kysely";
import { dbPath, ensureStateDirs } from "./paths.js";

export interface RunsTable {
  id: string;
  title: string;
  raw_prompt: string;
  status: string;
  config_json: string;
  created_at: string;
  updated_at: string;
}

export interface JobsTable {
  id: string;
  run_id: string;
  agent_id: string;
  status: string;
  input_artifact_ids_json: string;
  output_artifact_ids_json: string;
  error: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export interface ArtifactsTable {
  id: string;
  run_id: string;
  type: string;
  parent_ids_json: string;
  created_by_job_id: string | null;
  json: string;
  created_at: string;
}

export interface EventsTable {
  id: Generated<number>;
  public_id: string;
  run_id: string;
  job_id: string | null;
  type: string;
  payload_json: string;
  created_at: string;
}

export interface ToolCallsTable {
  id: Generated<number>;
  public_id: string;
  run_id: string;
  job_id: string | null;
  tool_name: string;
  input_json: string;
  output_json: string | null;
  status: string;
  created_at: string;
  finished_at: string | null;
}

export interface ConjectDatabase {
  runs: RunsTable;
  jobs: JobsTable;
  artifacts: ArtifactsTable;
  events: EventsTable;
  tool_calls: ToolCallsTable;
}

export type RunRow = Selectable<RunsTable>;
export type NewRunRow = Insertable<RunsTable>;
export type RunRowUpdate = Updateable<RunsTable>;

export function openDatabase(cwd: string): Kysely<ConjectDatabase> {
  ensureStateDirs(cwd);
  const sqlite = new Database(dbPath(cwd));
  migrate(sqlite);
  const db = new Kysely<ConjectDatabase>({
    dialect: new SqliteDialect({ database: sqlite })
  });
  return db;
}

export function migrate(sqlite: Database.Database): void {
  sqlite.exec(`
    create table if not exists runs (
      id text primary key,
      title text not null,
      raw_prompt text not null,
      status text not null,
      config_json text not null,
      created_at text not null,
      updated_at text not null
    );

    create table if not exists jobs (
      id text primary key,
      run_id text not null references runs(id),
      agent_id text not null,
      status text not null,
      input_artifact_ids_json text not null,
      output_artifact_ids_json text not null,
      error text,
      created_at text not null,
      started_at text,
      finished_at text
    );

    create table if not exists artifacts (
      id text primary key,
      run_id text not null references runs(id),
      type text not null,
      parent_ids_json text not null,
      created_by_job_id text,
      json text not null,
      created_at text not null
    );

    create table if not exists events (
      id integer primary key autoincrement,
      public_id text not null,
      run_id text not null references runs(id),
      job_id text,
      type text not null,
      payload_json text not null,
      created_at text not null
    );

    create table if not exists tool_calls (
      id integer primary key autoincrement,
      public_id text not null,
      run_id text not null references runs(id),
      job_id text,
      tool_name text not null,
      input_json text not null,
      output_json text,
      status text not null,
      created_at text not null,
      finished_at text
    );

    create index if not exists idx_artifacts_run_type on artifacts(run_id, type);
    create index if not exists idx_jobs_run_agent on jobs(run_id, agent_id);
  `);
}
