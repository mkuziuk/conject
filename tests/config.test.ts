import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ConjectConfigSchema, configForPreset, hasConfig, loadConfig, writeDefaultConfig } from "../packages/config/src/index.js";

describe("config", () => {
  it("creates and loads commented yaml config", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-config-"));
    try {
      expect(hasConfig(dir)).toBe(false);
      writeDefaultConfig(dir, "quick");
      expect(hasConfig(dir)).toBe(true);
      const config = loadConfig(dir);
      expect(config.research.preset).toBe("quick");
      expect(config.research.ideas).toBe(3);
      expect(config.models.default).toMatchObject({
        provider: "openai-codex",
        model: "gpt-5.5",
        auth: { type: "openai-codex", scope: "global" }
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies deep preset limits", () => {
    const config = configForPreset("deep");
    expect(config.research.ideas).toBe(8);
    expect(config.research.sourcesPerIdea).toBe(5);
  });

  it("accepts nested apiKeyEnv auth and legacy apiKeyEnv model config", () => {
    const nested = ConjectConfigSchema.parse({
      ...configForPreset("quick"),
      models: {
        default: {
          provider: "anthropic",
          model: "claude-test",
          auth: { type: "apiKeyEnv", env: "ANTHROPIC_API_KEY" }
        },
        agents: {}
      }
    });
    expect(nested.models.default.auth).toEqual({ type: "apiKeyEnv", env: "ANTHROPIC_API_KEY" });

    const legacy = ConjectConfigSchema.parse({
      ...configForPreset("quick"),
      models: {
        default: {
          provider: "anthropic",
          model: "claude-test",
          apiKeyEnv: "ANTHROPIC_API_KEY"
        },
        agents: {}
      }
    });
    expect(legacy.models.default.apiKeyEnv).toBe("ANTHROPIC_API_KEY");
  });
});
