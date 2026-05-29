import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildConjectArgs, formatPrintEnv } from "../src/cli.js";
import { configureConjectEnvironment } from "../src/env.js";
import { CONJECT_SYSTEM_PROMPT } from "../src/prompt.js";

describe("Conject launcher environment", () => {
  it("isolates agent and session dirs", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-env-"));
    try {
      const env: NodeJS.ProcessEnv = {};
      const result = configureConjectEnvironment({ cwd: dir, home: dir, env });

      expect(result.agentDir).toBe(join(dir, ".conject", "agent"));
      expect(result.sessionDir).toBe(join(dir, ".conject", "sessions"));
      expect(env.PI_CODING_AGENT_DIR).toBe(result.agentDir);
      expect(env.PI_CODING_AGENT_SESSION_DIR).toBe(result.sessionDir);
      expect(env.PI_SKIP_VERSION_CHECK).toBe("1");
      expect(existsSync(result.agentDir)).toBe(true);
      expect(existsSync(result.sessionDir)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("injects the Conject prompt and skills for normal runs", () => {
    const args = buildConjectArgs(["--thinking", "medium"]);
    expect(args.slice(0, 4)).toEqual(["--system-prompt", CONJECT_SYSTEM_PROMPT, "--skill", expect.any(String)]);
    expect(args).toContain("--thinking");
  });

  it("does not inject prompt flags into package commands", () => {
    expect(buildConjectArgs(["install", "./pkg"])).toEqual(["install", "./pkg"]);
  });

  it("does not inject prompt flags into Conject setup commands", () => {
    expect(buildConjectArgs(["setup"])).toEqual(["setup"]);
    expect(buildConjectArgs(["credentials", "status"])).toEqual(["credentials", "status"]);
  });

  it("does not inject parent prompt flags into internal child runs", () => {
    expect(buildConjectArgs(["--system-prompt", "child"], { CONJECT_INTERNAL_CHILD: "1" })).toEqual([
      "--system-prompt",
      "child"
    ]);
  });

  it("prints the effective environment as JSON", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-env-"));
    try {
      const env: NodeJS.ProcessEnv = {};
      const parsed = JSON.parse(formatPrintEnv(dir, env, dir)) as Record<string, string>;
      expect(parsed.PI_CODING_AGENT_DIR).toBe(join(dir, ".conject", "agent"));
      expect(parsed.PI_CODING_AGENT_SESSION_DIR).toBe(join(dir, ".conject", "sessions"));
      expect(parsed.PI_SKIP_VERSION_CHECK).toBe("1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
