#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { main } from "@earendil-works/pi-coding-agent";
import {
  formatConjectSkillList,
  formatConjectSkillPaths,
  getConjectSkillLoadPaths,
  getConjectSkillLocations,
  initConjectSkill,
  listConjectSkills,
  rememberExplicitSkillPaths,
  skillPathsToArgs,
  type ConjectSkillInitScope
} from "./custom-skills.js";
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
import { CONJECT_SYSTEM_PROMPT } from "./prompt.js";
import { runConjectSetup } from "./setup.js";

const PACKAGE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);
const CONJECT_COMMANDS = new Set(["credentials", "setup", "skills"]);

export function buildConjectArgs(
  userArgs: string[],
  env: NodeJS.ProcessEnv = process.env,
  options: { cwd?: string; home?: string } = {}
): string[] {
  if (env.CONJECT_INTERNAL_CHILD === "1") return userArgs;
  if (userArgs[0] && CONJECT_COMMANDS.has(userArgs[0])) return userArgs;
  if (userArgs[0] && PACKAGE_COMMANDS.has(userArgs[0])) return userArgs;

  return [
    "--system-prompt",
    CONJECT_SYSTEM_PROMPT,
    ...skillPathsToArgs(getConjectSkillLoadPaths({ cwd: options.cwd, home: options.home, env })),
    ...userArgs
  ];
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

  if (argv[0] === "setup") {
    await runSetupCommand(argv.slice(1));
    return;
  }

  if (argv[0] === "skills") {
    await runSkillsCommand(argv.slice(1));
    return;
  }

  if (argv.includes("--print-env")) {
    console.log(formatPrintEnv());
    return;
  }

  configureConjectEnvironment();
  rememberExplicitSkillPaths(argv);

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

export async function runSkillsCommand(
  args: string[],
  options: { cwd?: string; home?: string; write?: (text: string) => void } = {}
): Promise<void> {
  const command = args[0];
  const write = options.write ?? ((text: string) => console.log(text));
  if (!command || command === "help" || command === "--help" || command === "-h") {
    write(formatSkillsHelp());
    return;
  }

  if (command === "paths") {
    write(formatConjectSkillPaths(getConjectSkillLocations({ cwd: options.cwd, home: options.home })));
    return;
  }

  if (command === "list") {
    write(formatConjectSkillList(listConjectSkills({ cwd: options.cwd, home: options.home })));
    return;
  }

  if (command === "init") {
    const name = args[1];
    if (!name) throw new Error("Usage: conject skills init <name> [--user|--project]");
    const scope = parseSkillInitScope(args.slice(2));
    const result = initConjectSkill(name, { cwd: options.cwd, home: options.home, scope });
    write(`Created ${scope} skill ${name} at ${result.filePath}`);
    return;
  }

  throw new Error(`Unknown skills command: ${command}`);
}

async function runSetupCommand(args: string[]): Promise<void> {
  const command = args[0];
  if (command === "--help" || command === "-h" || command === "help") {
    console.log(formatSetupHelp());
    return;
  }
  if (command) throw new Error(`Unknown setup argument: ${command}`);
  await runConjectSetup();
}

function formatCredentialHelp(): string {
  return [
    "Usage:",
    "  conject setup",
    "  conject credentials path",
    "  conject credentials init",
    "  conject credentials status",
    "  conject credentials set <KEY> --stdin"
  ].join("\n");
}

function formatSkillsHelp(): string {
  return [
    "Usage:",
    "  conject skills paths",
    "  conject skills list",
    "  conject skills init <name> [--user|--project]",
    "",
    "Project skills are stored in .conject/skills by default.",
    "User skills are stored in ~/.conject/skills."
  ].join("\n");
}

function parseSkillInitScope(args: string[]): ConjectSkillInitScope {
  const hasUser = args.includes("--user");
  const hasProject = args.includes("--project");
  const unknown = args.find((arg) => arg !== "--user" && arg !== "--project");
  if (unknown) throw new Error(`Unknown skills init argument: ${unknown}`);
  if (hasUser && hasProject) throw new Error("Use only one of --user or --project.");
  return hasUser ? "user" : "project";
}

function formatSetupHelp(): string {
  return [
    "Usage:",
    "  conject setup",
    "",
    "Guides model provider auth, Conject tool credentials, and researcher web-search budgets.",
    "Model auth is stored in ~/.conject/agent/auth.json.",
    "Tool credentials are stored in ~/.conject/credentials.env."
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
