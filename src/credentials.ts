import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getDefaultCredentialStorePath } from "./paths.js";

export const CREDENTIAL_KEYS = [
  "TAVILY_API_KEY",
  "SEARXNG_BASE_URL",
  "CONJECT_SEARXNG_URL",
  "OPENALEX_MAILTO"
] as const;

export type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

export interface CredentialLoadResult {
  path: string;
  exists: boolean;
  loadedKeys: CredentialKey[];
  skippedKeys: CredentialKey[];
}

export interface CredentialStoreStatus {
  path: string;
  exists: boolean;
  permissionsOk: boolean;
  mode?: string;
  keys: Record<CredentialKey, boolean>;
}

export interface CredentialStoreOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  path?: string;
}

const KEY_SET = new Set<string>(CREDENTIAL_KEYS);
const ASSIGNMENT_PATTERN = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)\s*$/;

export function loadConjectCredentials(options: CredentialStoreOptions = {}): CredentialLoadResult {
  const env = options.env ?? process.env;
  const path = resolveCredentialStorePath(options);
  if (!existsSync(path)) return { path, exists: false, loadedKeys: [], skippedKeys: [] };

  const values = parseCredentialText(readFileSync(path, "utf8"));
  const loadedKeys: CredentialKey[] = [];
  const skippedKeys: CredentialKey[] = [];
  for (const key of CREDENTIAL_KEYS) {
    const value = values[key];
    if (!value) continue;
    if (env[key] !== undefined) {
      skippedKeys.push(key);
      continue;
    }
    env[key] = value;
    loadedKeys.push(key);
  }

  return { path, exists: true, loadedKeys, skippedKeys };
}

export function initializeCredentialStore(options: CredentialStoreOptions = {}): { path: string; created: boolean } {
  const path = resolveCredentialStorePath(options);
  ensureCredentialDirectory(path);
  if (existsSync(path)) {
    chmodSync(path, 0o600);
    return { path, created: false };
  }

  writeFileSync(path, defaultCredentialTemplate(), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return { path, created: true };
}

export function inspectCredentialStore(options: CredentialStoreOptions = {}): CredentialStoreStatus {
  const path = resolveCredentialStorePath(options);
  const keys = emptyKeyStatus();
  if (!existsSync(path)) return { path, exists: false, permissionsOk: false, keys };

  const stat = statSync(path);
  const mode = stat.mode & 0o777;
  const values = parseCredentialText(readFileSync(path, "utf8"));
  for (const key of CREDENTIAL_KEYS) keys[key] = Boolean(values[key]);
  return {
    path,
    exists: true,
    permissionsOk: (mode & 0o077) === 0,
    mode: mode.toString(8).padStart(3, "0"),
    keys
  };
}

export function setCredentialValue(
  key: string,
  value: string,
  options: CredentialStoreOptions = {}
): { path: string; key: CredentialKey } {
  if (!isCredentialKey(key)) {
    throw new Error(`Unsupported credential key: ${key}. Supported keys: ${CREDENTIAL_KEYS.join(", ")}`);
  }
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Credential value for ${key} is empty.`);

  const path = resolveCredentialStorePath(options);
  ensureCredentialDirectory(path);
  const lines = existsSync(path) ? readFileSync(path, "utf8").split(/\r?\n/) : defaultCredentialTemplate().split("\n");
  const rendered = `export ${key}=${JSON.stringify(trimmed)}`;
  let replaced = false;
  const nextLines: string[] = [];

  for (const line of lines) {
    const match = line.match(ASSIGNMENT_PATTERN);
    if (match?.[1] === key) {
      if (!replaced) nextLines.push(rendered);
      replaced = true;
      continue;
    }
    nextLines.push(line);
  }
  if (!replaced) {
    if (nextLines.length && nextLines[nextLines.length - 1] !== "") nextLines.push("");
    nextLines.push(rendered);
  }

  writeFileSync(path, ensureTrailingNewline(nextLines.join("\n")), { encoding: "utf8", mode: 0o600 });
  chmodSync(path, 0o600);
  return { path, key };
}

export function formatCredentialStoreStatus(status: CredentialStoreStatus, env: NodeJS.ProcessEnv = process.env): string {
  const permissionText = status.exists
    ? status.permissionsOk
      ? `ok (${status.mode})`
      : `too open (${status.mode})`
    : "missing";
  return [
    `Conject credentials: ${status.path}`,
    `Exists: ${status.exists ? "yes" : "no"}`,
    `Permissions: ${permissionText}`,
    `Effective web search: ${resolveWebSearchStatus(env)}`,
    "",
    "Configured keys:",
    ...CREDENTIAL_KEYS.map((key) => `- ${key}: ${status.keys[key] ? "set" : "unset"}`)
  ].join("\n");
}

export function resolveCredentialStorePath(options: CredentialStoreOptions = {}): string {
  return options.path ?? getDefaultCredentialStorePath(options.home);
}

export function parseCredentialText(text: string): Partial<Record<CredentialKey, string>> {
  const values: Partial<Record<CredentialKey, string>> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = line.match(ASSIGNMENT_PATTERN);
    if (!match) continue;
    const key = match[1];
    if (!isCredentialKey(key)) continue;
    values[key] = parseCredentialValue(match[2] ?? "");
  }
  return values;
}

export function resolveWebSearchStatus(env: NodeJS.ProcessEnv): "tavily" | "searxng" | "none" {
  if (env.TAVILY_API_KEY) return "tavily";
  if (env.SEARXNG_BASE_URL || env.CONJECT_SEARXNG_URL) return "searxng";
  return "none";
}

function parseCredentialValue(raw: string): string {
  const value = raw.trim();
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1);
  return value;
}

function isCredentialKey(value: string): value is CredentialKey {
  return KEY_SET.has(value);
}

function ensureCredentialDirectory(path: string): void {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function emptyKeyStatus(): Record<CredentialKey, boolean> {
  return {
    TAVILY_API_KEY: false,
    SEARXNG_BASE_URL: false,
    CONJECT_SEARXNG_URL: false,
    OPENALEX_MAILTO: false
  };
}

function defaultCredentialTemplate(): string {
  return [
    "# Conject credentials. Keep this file private.",
    "#",
    "# Uncomment or set values with: conject credentials set <KEY> --stdin",
    "# TAVILY_API_KEY=",
    "# SEARXNG_BASE_URL=",
    "# CONJECT_SEARXNG_URL=",
    "# OPENALEX_MAILTO=",
    ""
  ].join("\n");
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
