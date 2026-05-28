import { mkdirSync } from "node:fs";
import { getDefaultConjectAgentDir, getDefaultProjectSessionDir } from "./paths.js";

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

export function configureConjectPiEnvironment(options: ConfigureConjectEnvironmentOptions = {}): ConjectEnvironment {
  const env = options.env ?? process.env;
  const agentDir = env.CONJECT_PI_AGENT_DIR ?? getDefaultConjectAgentDir(options.home);
  const sessionDir = env.CONJECT_PI_SESSION_DIR ?? getDefaultProjectSessionDir(options.cwd);

  env.PI_CODING_AGENT_DIR = agentDir;
  env.PI_CODING_AGENT_SESSION_DIR = sessionDir;
  env.PI_SKIP_VERSION_CHECK = "1";

  mkdirSync(agentDir, { recursive: true });
  mkdirSync(sessionDir, { recursive: true });

  return { agentDir, sessionDir, skipVersionCheck: "1" };
}
