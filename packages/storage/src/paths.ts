import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function stateDir(cwd: string): string {
  return join(cwd, ".conject");
}

export function dbPath(cwd: string): string {
  return join(stateDir(cwd), "conject.sqlite");
}

export function runDir(cwd: string, runId: string): string {
  return join(stateDir(cwd), "runs", runId);
}

export function ensureStateDirs(cwd: string): void {
  mkdirSync(stateDir(cwd), { recursive: true });
  mkdirSync(join(stateDir(cwd), "runs"), { recursive: true });
}

export function ensureRunDirs(cwd: string, runId: string): void {
  mkdirSync(runDir(cwd, runId), { recursive: true });
  mkdirSync(join(runDir(cwd, runId), "logs"), { recursive: true });
  mkdirSync(join(runDir(cwd, runId), "artifacts"), { recursive: true });
}
