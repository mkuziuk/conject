import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

export function getPackageRoot(): string {
  return resolve(moduleDir, "..");
}

export function isRunningFromSource(): boolean {
  return basename(moduleDir) === "src";
}

export function getConjectExtensionPath(): string {
  const root = getPackageRoot();
  return isRunningFromSource() ? join(root, "src", "extension.ts") : join(root, "dist", "extension.js");
}

export function getConjectSkillsPath(): string {
  return join(getPackageRoot(), "skills");
}

export function getConjectSubagentsPath(): string {
  return join(getPackageRoot(), "subagents");
}

export function getDefaultConjectAgentDir(home = homedir()): string {
  return join(home, ".pi-conject", "agent");
}

export function getDefaultProjectSessionDir(cwd = process.cwd()): string {
  return join(cwd, ".pi", "sessions");
}
