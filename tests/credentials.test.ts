import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatCredentialStoreStatus,
  initializeCredentialStore,
  inspectCredentialStore,
  loadConjectCredentials,
  parseCredentialText,
  setCredentialValue
} from "../src/credentials.js";
import { configureConjectEnvironment } from "../src/env.js";
import { createWebSearchTool } from "../src/tools/search.js";

describe("Conject credentials", () => {
  it("loads supported keys without overriding process values", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-credentials-"));
    try {
      const credentialPath = join(dir, ".conject", "credentials.env");
      mkdirSync(join(dir, ".conject"), { recursive: true });
      writeFileSync(
        credentialPath,
        ['export TAVILY_API_KEY="file-key"', "SEARXNG_BASE_URL=https://search.example", "UNRELATED=value"].join("\n"),
        "utf8"
      );

      const env: NodeJS.ProcessEnv = { TAVILY_API_KEY: "process-key" };
      const result = loadConjectCredentials({ home: dir, env });

      expect(result.exists).toBe(true);
      expect(result.loadedKeys).toEqual(["SEARXNG_BASE_URL"]);
      expect(result.skippedKeys).toEqual(["TAVILY_API_KEY"]);
      expect(env.TAVILY_API_KEY).toBe("process-key");
      expect(env.SEARXNG_BASE_URL).toBe("https://search.example");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("initializes, updates, and reports a private credential file", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-credentials-"));
    try {
      const init = initializeCredentialStore({ home: dir });
      expect(init.path).toBe(join(dir, ".conject", "credentials.env"));
      expect(init.created).toBe(true);
      expect(existsSync(init.path)).toBe(true);
      expect((statSync(init.path).mode & 0o777).toString(8)).toBe("600");

      setCredentialValue("TAVILY_API_KEY", "test-key\n", { home: dir });
      const parsed = parseCredentialText(readFileSync(init.path, "utf8"));
      expect(parsed.TAVILY_API_KEY).toBe("test-key");

      const status = inspectCredentialStore({ home: dir });
      expect(status.permissionsOk).toBe(true);
      expect(status.keys.TAVILY_API_KEY).toBe(true);
      expect(formatCredentialStoreStatus(status)).not.toContain("test-key");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("makes loaded credentials available to web search", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-credentials-"));
    const oldTavily = process.env.TAVILY_API_KEY;
    const oldSearx = process.env.SEARXNG_BASE_URL;
    const oldConjectSearx = process.env.CONJECT_SEARXNG_URL;
    try {
      delete process.env.TAVILY_API_KEY;
      delete process.env.SEARXNG_BASE_URL;
      delete process.env.CONJECT_SEARXNG_URL;

      initializeCredentialStore({ home: dir });
      setCredentialValue("TAVILY_API_KEY", "test-key", { home: dir });
      configureConjectEnvironment({ cwd: dir, home: dir, env: process.env });

      let capturedApiKey = "";
      const fetchImpl = async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { api_key?: string };
        capturedApiKey = body.api_key ?? "";
        return new Response(JSON.stringify({ results: [{ title: "Result", url: "https://example.test", content: "Text" }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      };

      const result = await createWebSearchTool(fetchImpl as typeof fetch).execute(
        "tool-1",
        { query: "test", limit: 1 },
        undefined
      );
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";

      expect(capturedApiKey).toBe("test-key");
      expect(text).toContain("Result");
    } finally {
      restoreEnv("TAVILY_API_KEY", oldTavily);
      restoreEnv("SEARXNG_BASE_URL", oldSearx);
      restoreEnv("CONJECT_SEARXNG_URL", oldConjectSearx);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
