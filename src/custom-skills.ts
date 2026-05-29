import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSkillsFromDir, type ResourceDiagnostic } from "@earendil-works/pi-coding-agent";
import { getConjectSkillsPath, getDefaultConjectAgentDir, getDefaultConjectHomeDir } from "./paths.js";

export const CONJECT_EXTRA_SKILL_PATHS_ENV = "CONJECT_EXTRA_SKILL_PATHS";

export type ConjectSkillScope = "bundled" | "user" | "project" | "pi-user" | "pi-project";

export interface ConjectSkillLocation {
  scope: ConjectSkillScope;
  label: string;
  path: string;
  exists: boolean;
  autoLoaded: boolean;
}

export interface ConjectSkillListEntry {
  name: string;
  description: string;
  filePath: string;
  scope: ConjectSkillScope;
}

export interface ConjectSkillListDiagnostic {
  scope: ConjectSkillScope;
  type: ResourceDiagnostic["type"];
  message: string;
  path?: string;
}

export interface ConjectSkillListResult {
  locations: ConjectSkillLocation[];
  skills: ConjectSkillListEntry[];
  diagnostics: ConjectSkillListDiagnostic[];
}

export interface ConjectSkillOptions {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export type ConjectSkillInitScope = "user" | "project";

export function getConjectUserSkillsPath(home?: string): string {
  return join(getDefaultConjectHomeDir(home), "skills");
}

export function getConjectProjectSkillsPath(cwd = process.cwd()): string {
  return join(cwd, ".conject", "skills");
}

export function getPiUserSkillsPath(home?: string): string {
  return join(getDefaultConjectAgentDir(home), "skills");
}

export function getPiProjectSkillsPath(cwd = process.cwd()): string {
  return join(cwd, ".pi", "skills");
}

export function getConjectSkillLocations(options: ConjectSkillOptions = {}): ConjectSkillLocation[] {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? options.env?.HOME;
  const locations: Array<Omit<ConjectSkillLocation, "exists">> = [
    { scope: "bundled", label: "Bundled", path: getConjectSkillsPath(), autoLoaded: true },
    { scope: "user", label: "Conject user", path: getConjectUserSkillsPath(home), autoLoaded: true },
    { scope: "project", label: "Conject project", path: getConjectProjectSkillsPath(cwd), autoLoaded: true },
    { scope: "pi-user", label: "Pi-native user", path: getPiUserSkillsPath(home), autoLoaded: false },
    { scope: "pi-project", label: "Pi-native project", path: getPiProjectSkillsPath(cwd), autoLoaded: false }
  ];
  return locations.map((location) => ({ ...location, exists: isDirectory(location.path) }));
}

export function getConjectSkillLoadPaths(options: ConjectSkillOptions & { includeExtraEnv?: boolean } = {}): string[] {
  const locations = getConjectSkillLocations(options);
  const paths = locations
    .filter((location) => location.autoLoaded && (location.scope === "bundled" || location.exists))
    .map((location) => location.path);

  if (options.includeExtraEnv) {
    paths.push(...parseForwardedSkillPaths(options.env ?? process.env));
  }

  return unique(paths);
}

export function skillPathsToArgs(paths: string[]): string[] {
  return paths.flatMap((path) => ["--skill", path]);
}

export function extractExplicitSkillPaths(args: string[]): string[] {
  const paths: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] !== "--skill") continue;
    const value = args[index + 1];
    if (!value) continue;
    paths.push(value);
    index++;
  }
  return paths;
}

export function rememberExplicitSkillPaths(args: string[], env: NodeJS.ProcessEnv = process.env): void {
  const explicitPaths = extractExplicitSkillPaths(args);
  if (explicitPaths.length === 0) return;
  const existing = parseForwardedSkillPaths(env);
  env[CONJECT_EXTRA_SKILL_PATHS_ENV] = JSON.stringify(unique([...existing, ...explicitPaths]));
}

export function parseForwardedSkillPaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[CONJECT_EXTRA_SKILL_PATHS_ENV];
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  } catch {
    return [];
  }
}

export function validateSkillName(name: string): string[] {
  const errors: string[] = [];
  if (name.length > 64) errors.push(`name exceeds 64 characters (${name.length})`);
  if (!/^[a-z0-9-]+$/.test(name)) errors.push("name must use lowercase letters, numbers, and hyphens only");
  if (name.startsWith("-") || name.endsWith("-")) errors.push("name must not start or end with a hyphen");
  if (name.includes("--")) errors.push("name must not contain consecutive hyphens");
  return errors;
}

export function initConjectSkill(
  name: string,
  options: ConjectSkillOptions & { scope?: ConjectSkillInitScope } = {}
): { path: string; filePath: string } {
  const errors = validateSkillName(name);
  if (errors.length > 0) throw new Error(`Invalid skill name "${name}": ${errors.join("; ")}`);

  const scope = options.scope ?? "project";
  const root =
    scope === "user" ? getConjectUserSkillsPath(options.home ?? options.env?.HOME) : getConjectProjectSkillsPath(options.cwd);
  const path = join(root, name);
  const filePath = join(path, "SKILL.md");

  if (existsSync(path)) throw new Error(`Skill already exists: ${path}`);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(filePath, renderSkillTemplate(name), { encoding: "utf8", mode: 0o600 });
  return { path, filePath };
}

export function listConjectSkills(options: ConjectSkillOptions = {}): ConjectSkillListResult {
  const locations = getConjectSkillLocations(options);
  const skills: ConjectSkillListEntry[] = [];
  const diagnostics: ConjectSkillListDiagnostic[] = [];

  for (const location of locations) {
    if (!location.exists) continue;
    const result = loadSkillsFromDir({ dir: location.path, source: location.scope });
    skills.push(
      ...result.skills.map((skill) => ({
        name: skill.name,
        description: skill.description,
        filePath: skill.filePath,
        scope: location.scope
      }))
    );
    diagnostics.push(
      ...result.diagnostics.map((diagnostic) => ({
        scope: location.scope,
        type: diagnostic.type,
        message: diagnostic.message,
        path: diagnostic.path
      }))
    );
  }

  return {
    locations,
    skills: skills.sort((a, b) => sourceOrder(a.scope) - sourceOrder(b.scope) || a.name.localeCompare(b.name)),
    diagnostics
  };
}

export function formatConjectSkillPaths(locations: ConjectSkillLocation[]): string {
  return [
    "Conject skill paths:",
    ...locations.map((location) => {
      const suffix = location.exists ? "exists" : "missing";
      const auto = location.autoLoaded ? "auto-loaded" : "Pi-native";
      return `- ${location.label}: ${location.path} (${suffix}, ${auto})`;
    })
  ].join("\n");
}

export function formatConjectSkillList(result: ConjectSkillListResult): string {
  const lines = ["Discovered skills:"];
  if (result.skills.length === 0) {
    lines.push("- none");
  } else {
    lines.push(...result.skills.map((skill) => `- [${skill.scope}] ${skill.name}: ${skill.filePath}`));
  }

  if (result.diagnostics.length > 0) {
    lines.push("", "Diagnostics:");
    lines.push(
      ...result.diagnostics.map((diagnostic) => {
        const path = diagnostic.path ? ` (${diagnostic.path})` : "";
        return `- [${diagnostic.scope}] ${diagnostic.type}: ${diagnostic.message}${path}`;
      })
    );
  }

  return lines.join("\n");
}

function renderSkillTemplate(name: string): string {
  return [
    "---",
    `name: ${name}`,
    'description: "TODO: Describe when Conject should use this skill in one clear sentence."',
    "---",
    "",
    `# ${titleFromSkillName(name)}`,
    "",
    "Add task-specific instructions here.",
    ""
  ].join("\n");
}

function titleFromSkillName(name: string): string {
  return name
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function sourceOrder(scope: ConjectSkillScope): number {
  return ["bundled", "user", "project", "pi-user", "pi-project"].indexOf(scope);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
