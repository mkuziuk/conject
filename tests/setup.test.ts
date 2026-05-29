import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  type SetupChoice,
  type SetupIO,
  createTerminalSetupIO,
  inspectModelAuthStore,
  inspectSetupStatus,
  runConjectSetup
} from "../src/setup.js";
import { parseCredentialText } from "../src/credentials.js";

describe("Conject setup", () => {
  it("inspects model auth providers without exposing credentials", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-setup-"));
    try {
      const authPath = join(dir, ".conject", "agent", "auth.json");
      mkdirSync(join(dir, ".conject", "agent"), { recursive: true });
      writeFileSync(
        authPath,
        JSON.stringify({ openai: { type: "api_key", key: "sk-secret" }, "openai-codex": { type: "oauth" } }),
        "utf8"
      );
      chmodSync(authPath, 0o600);

      const status = inspectModelAuthStore(dir);

      expect(status.providers).toEqual([
        { provider: "openai", type: "api_key" },
        { provider: "openai-codex", type: "oauth" }
      ]);
      expect(JSON.stringify(status)).not.toContain("sk-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores selected model API keys in Conject's isolated Pi auth file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-setup-"));
    try {
      const io = new ScriptedSetupIO({
        selects: ["configure", "api_key", "openai", "skip", "skip"],
        inputs: ["sk-test-secret"]
      });

      await runConjectSetup({ home: dir, env: {}, io });

      const authPath = join(dir, ".conject", "agent", "auth.json");
      const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, { type?: string; key?: string }>;
      expect(auth.openai).toEqual({ type: "api_key", key: "sk-test-secret" });
      expect((statSync(authPath).mode & 0o777).toString(8)).toBe("600");
      expect(io.output()).not.toContain("sk-test-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("stores Conject tool credentials in credentials.env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-setup-"));
    try {
      const env: NodeJS.ProcessEnv = {};
      const io = new ScriptedSetupIO({
        selects: ["skip", "tavily", "skip"],
        inputs: ["tavily-secret"]
      });

      await runConjectSetup({ home: dir, env, io });

      const credentialPath = join(dir, ".conject", "credentials.env");
      const parsed = parseCredentialText(readFileSync(credentialPath, "utf8"));
      expect(parsed.TAVILY_API_KEY).toBe("tavily-secret");
      expect(env.TAVILY_API_KEY).toBe("tavily-secret");
      expect((statSync(credentialPath).mode & 0o777).toString(8)).toBe("600");
      expect(io.output()).not.toContain("tavily-secret");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports setup status without creating missing stores", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-setup-"));
    try {
      const status = inspectSetupStatus({ home: dir, env: {} });

      expect(status.modelAuth.exists).toBe(false);
      expect(status.toolCredentials.exists).toBe(false);
      expect(status.webSearch).toBe("none");
      expect(existsSync(join(dir, ".conject"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps piped setup choices buffered across prompts", async () => {
    const input = new PassThrough();
    const output = new CaptureWritable();
    input.end("1\n2\n");
    const io = createTerminalSetupIO(input, output);

    await expect(
      io.select("First", [
        { value: "first", label: "First" },
        { value: "other", label: "Other" }
      ])
    ).resolves.toBe("first");
    await expect(
      io.select("Second", [
        { value: "other", label: "Other" },
        { value: "second", label: "Second" }
      ])
    ).resolves.toBe("second");
  });
});

class ScriptedSetupIO implements SetupIO {
  private readonly selects: string[];
  private readonly inputs: string[];
  private readonly writes: string[] = [];

  constructor(script: { selects: string[]; inputs?: string[] }) {
    this.selects = [...script.selects];
    this.inputs = [...(script.inputs ?? [])];
  }

  write(text: string): void {
    this.writes.push(text);
  }

  async select(message: string, choices: SetupChoice[]): Promise<string | undefined> {
    this.write(`${message}\n`);
    const next = this.selects.shift();
    if (!next) return undefined;
    if (!choices.some((choice) => choice.value === next)) {
      throw new Error(`Unexpected setup selection ${next}. Choices: ${choices.map((choice) => choice.value).join(", ")}`);
    }
    return next;
  }

  async input(message: string): Promise<string | undefined> {
    this.write(`${message} `);
    return this.inputs.shift();
  }

  output(): string {
    return this.writes.join("");
  }
}

class CaptureWritable extends Writable {
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    callback();
  }
}
