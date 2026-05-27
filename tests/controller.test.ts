import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createConjectController } from "../apps/cli/src/controller.js";

describe("ConjectController", () => {
  it("drives the mock CLI/TUI workflow through shared actions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-controller-"));
    try {
      const controller = createConjectController(dir, {});
      expect(controller.hasConfig).toBe(false);

      controller.init("quick");
      const run = await controller.createRun("controller workflow prompt");
      await controller.runPipeline(run.id, { runtime: "mock" });

      const detail = await controller.getRunDetail(run.id);
      expect(detail.run.status).toBe("succeeded");
      expect(detail.ranking?.items.length).toBeGreaterThan(0);
      expect(detail.events.some((event) => event.type === "run.succeeded")).toBe(true);

      const exportPath = await controller.exportRun(run.id);
      expect(exportPath).toContain(`/exports/${run.id}`);

      const hypothesisId = detail.ranking!.items[0]!.hypothesisId;
      const implementationPath = await controller.implement(run.id, hypothesisId, "scaffold");
      expect(implementationPath).toBe(`implementations/${run.id}/${hypothesisId}/PLAN.md`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
