#!/usr/bin/env node
import { main } from "@earendil-works/pi-coding-agent";
import { formatDoctorInfo, getDoctorInfo } from "./doctor.js";
import { configureConjectPiEnvironment } from "./env.js";
import { createConjectPiExtensionFactory } from "./extension.js";
import { getConjectSkillsPath } from "./paths.js";
import { CONJECT_SYSTEM_PROMPT } from "./prompt.js";

const PI_PACKAGE_COMMANDS = new Set(["install", "remove", "uninstall", "update", "list", "config"]);

export function buildPiArgs(userArgs: string[], env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.CONJECT_PI_INTERNAL_CHILD === "1") return userArgs;
  if (userArgs[0] && PI_PACKAGE_COMMANDS.has(userArgs[0])) return userArgs;

  return ["--system-prompt", CONJECT_SYSTEM_PROMPT, "--skill", getConjectSkillsPath(), ...userArgs];
}

export function formatPrintEnv(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env, home?: string): string {
  const configured = configureConjectPiEnvironment({ cwd, env, home });
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
  configureConjectPiEnvironment();

  if (argv.includes("--print-env")) {
    console.log(formatPrintEnv());
    return;
  }

  if (argv.includes("--doctor")) {
    console.log(formatDoctorInfo(getDoctorInfo()));
    return;
  }

  await main(buildPiArgs(argv), {
    extensionFactories: [createConjectPiExtensionFactory()]
  });
}

runCli().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`conject-pi: ${message}`);
  process.exitCode = 1;
});
