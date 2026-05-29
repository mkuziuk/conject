#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "@earendil-works/pi-coding-agent";
import {
  formatCredentialStoreStatus,
  initializeCredentialStore,
  inspectCredentialStore,
  loadConjectCredentials,
  resolveCredentialStorePath,
  setCredentialValue
} from "./credentials.js";
import { formatDoctorInfo, getDoctorInfo } from "./doctor.js";
import { configureConjectEnvironment, resolveConjectEnvironment } from "./env.js";
import { createConjectExtensionFactory } from "./extension.js";
import { getConjectSkillsPath } from "./paths.js";
import { CONJECT_SYSTEM_PROMPT } from "./prompt.js";

const PACKAGE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

export function buildConjectArgs(userArgs: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.CONJECT_INTERNAL_CHILD === "1") return userArgs;
  if (userArgs[0] && PACKAGE_COMMANDS.has(userArgs[0])) return userArgs;

  return ["--system-prompt", CONJECT_SYSTEM_PROMPT, "--skill", getConjectSkillsPath(), ...userArgs];
}

export function formatPrintEnv(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env, home?: string): string {
  const configured = resolveConjectEnvironment({ cwd, env, home });
  return JSON.stringify(
    {
      PI_CODING_AGENT_DIR: configured.agentDir,
      PI_CODING_AGENT_SESSION_DIR: configured.sessionDir,
      PI_SKIP_VERSION_CHECK: configured.skipVersionCheck
    },
    null,
    2
  );
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  if (argv[0] === "credentials") {
    await runCredentialCommand(argv.slice(1));
    return;
  }

  if (argv.includes("--print-env")) {
    console.log(formatPrintEnv());
    return;
  }

  configureConjectEnvironment();

  if (argv.includes("--doctor")) {
    console.log(formatDoctorInfo(getDoctorInfo()));
    return;
  }

  await main(buildConjectArgs(argv), {
    extensionFactories: [createConjectExtensionFactory()]
  });
}

if (isCliEntryPoint()) {
  runCli().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`conject: ${message}`);
    process.exitCode = 1;
  });
}

async function runCredentialCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(formatCredentialHelp());
    return;
  }

  if (command === "path") {
    console.log(resolveCredentialStorePath());
    return;
  }

  if (command === "init") {
    const result = initializeCredentialStore();
    console.log(`${result.created ? "Created" : "Checked"} Conject credentials at ${result.path}`);
    return;
  }

  if (command === "status") {
    loadConjectCredentials();
    console.log(formatCredentialStoreStatus(inspectCredentialStore(), process.env));
    return;
  }

  if (command === "set") {
    const key = args[1];
    if (!key || !args.includes("--stdin")) {
      throw new Error("Usage: conject credentials set <KEY> --stdin");
    }
    const result = setCredentialValue(key, await readStdin());
    console.log(`Updated ${result.key} in ${result.path}`);
    return;
  }

  throw new Error(`Unknown credentials command: ${command}`);
}

function formatCredentialHelp(): string {
  return [
    "Usage:",
    "  conject credentials path",
    "  conject credentials init",
    "  conject credentials status",
    "  conject credentials set <KEY> --stdin"
  ].join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function isCliEntryPoint(scriptPath = process.argv[1]): boolean {
  if (!scriptPath) return false;
  return realPathOrResolve(scriptPath) === realPathOrResolve(fileURLToPath(import.meta.url));
}

function realPathOrResolve(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}
