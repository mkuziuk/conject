import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { materializeImplementationPack, materializeImplementationPackFiles } from "../packages/export/src/index.js";
import { hypothesisFixture } from "./fixtures/artifacts.js";

describe("implementation packs", () => {
  it("materializes scaffold files under implementations", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-pack-"));
    try {
      const pack = materializeImplementationPack(dir, "run-1", hypothesisFixture);
      expect(pack.files).toHaveLength(5);
      expect(existsSync(join(dir, pack.planMarkdownPath))).toBe(true);
      expect(readFileSync(join(dir, pack.planMarkdownPath), "utf8")).toContain(hypothesisFixture.minimalExperiment);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to materialize files outside implementations", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-pack-"));
    try {
      expect(() =>
        materializeImplementationPackFiles(dir, {
          hypothesisId: "HYP-001",
          planMarkdownPath: "../PLAN.md",
          generatedFiles: ["../PLAN.md"],
          runCommands: [],
          validationChecklist: [],
          files: [{ path: "../PLAN.md", content: "bad" }]
        })
      ).toThrow("outside implementations");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
