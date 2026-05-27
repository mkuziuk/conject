import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { configForPreset, hasConfig, loadConfig, writeDefaultConfig } from "../packages/config/src/index.js";

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
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("applies deep preset limits", () => {
    const config = configForPreset("deep");
    expect(config.research.ideas).toBe(8);
    expect(config.research.sourcesPerIdea).toBe(5);
  });
});
