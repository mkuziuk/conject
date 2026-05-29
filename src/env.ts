import { mkdirSync } from "node:fs";
import { getDefaultConjectAgentDir, getDefaultProjectSessionDir } from "./paths.js";
import { loadConjectCredentials } from "./credentials.js";

export interface ConjectEnvironment {
  agentDir: string;
  sessionDir: string;
  skipVersionCheck: string;
}

export interface ConfigureConjectEnvironmentOptions {
  cwd?: string;
  home?: string;
  env?: NodeJS.ProcessEnv;
}

export function resolveConjectEnvironment(options: ConfigureConjectEnvironmentOptions = {}): ConjectEnvironment {
  const env = options.env ?? process.env;
  loadConjectCredentials({ env, home: options.home });

  const agentDir = env.CONJECT_AGENT_DIR ?? getDefaultConjectAgentDir(options.home);
  const sessionDir = env.CONJECT_SESSION_DIR ?? getDefaultProjectSessionDir(options.cwd);

  return { agentDir, sessionDir, skipVersionCheck: "1" };
}

export function configureConjectEnvironment(options: ConfigureConjectEnvironmentOptions = {}): ConjectEnvironment {
  const env = options.env ?? process.env;
  const resolved = resolveConjectEnvironment(options);

  env.PI_CODING_AGENT_DIR = resolved.agentDir;
  env.PI_CODING_AGENT_SESSION_DIR = resolved.sessionDir;
  env.PI_SKIP_VERSION_CHECK = resolved.skipVersionCheck;

  mkdirSync(resolved.agentDir, { recursive: true });
  mkdirSync(resolved.sessionDir, { recursive: true });

  return resolved;
}
