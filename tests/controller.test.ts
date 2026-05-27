import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPiOnlyRuntimeFlag, createConjectController } from "../apps/cli/src/controller.js";
import { MockAgentRuntime } from "../packages/runtime/src/index.js";

describe("ConjectController", () => {
  it("rejects non-Pi runtime flags", () => {
    expect(() => assertPiOnlyRuntimeFlag(undefined)).not.toThrow();
    expect(() => assertPiOnlyRuntimeFlag("pi")).not.toThrow();
    expect(() => assertPiOnlyRuntimeFlag("mock")).toThrow("Conject runs through Pi only");
    expect(() => assertPiOnlyRuntimeFlag("scaffold")).toThrow("Conject runs through Pi only");
  });

  it("reports missing runs before runtime setup", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-controller-"));
    try {
      const controller = createConjectController(dir, {
        env: {},
        runtimeFactory: () => {
          throw new Error("runtime should not be created");
        }
      });
      await expect(controller.runPipeline("run_missing")).rejects.toThrow("Run not found: run_missing");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("drives the CLI/TUI workflow through shared actions with an injected fixture runtime", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-controller-"));
    try {
      const controller = createConjectController(dir, {
        env: {},
        runtimeFactory: () => new MockAgentRuntime()
      });
      expect(controller.hasConfig).toBe(false);

      controller.init("quick");
      const run = await controller.createRun("controller workflow prompt");
      await controller.runPipeline(run.id);

      const detail = await controller.getRunDetail(run.id);
      expect(detail.run.status).toBe("succeeded");
      expect(detail.ranking?.items.length).toBeGreaterThan(0);
      expect(detail.events.some((event) => event.type === "run.succeeded")).toBe(true);

      const exportPath = await controller.exportRun(run.id);
      expect(exportPath).toContain(`/exports/${run.id}`);

      const hypothesisId = detail.ranking!.items[0]!.hypothesisId;
      const implementationPath = await controller.implement(run.id, hypothesisId);
      expect(implementationPath).toBe(`implementations/${run.id}/${hypothesisId}/PLAN.md`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
