import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultConfig } from "../packages/config/src/index.js";
import { Orchestrator } from "../packages/core/src/index.js";
import { MockAgentRuntime, ToolBackedResearchRuntime } from "../packages/runtime/src/index.js";
import { ConjectRepository, openDatabase } from "../packages/storage/src/index.js";
import type { PaperSearchProvider, WebSearchProvider } from "../packages/tools/src/index.js";

describe("orchestrator", () => {
  it("runs the full mock research pipeline", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-pipeline-"));
    const db = openDatabase(dir);
    try {
      const repo = new ConjectRepository(db, dir);
      const config = structuredClone(defaultConfig);
      config.research.ideas = 3;
      config.research.sourcesPerIdea = 2;
      const run = await repo.createRun("Find implementable ideas for robust IMF in hyperspectral unmixing", config);
      await new Orchestrator(repo, new MockAgentRuntime()).runFullPipeline(run.id);

      expect(await repo.listArtifacts(run.id, "idea")).toHaveLength(3);
      expect(await repo.listArtifacts(run.id, "evidence_bundle")).toHaveLength(3);
      expect(await repo.listArtifacts(run.id, "hypothesis_card")).toHaveLength(3);
      expect(await repo.listArtifacts(run.id, "ranking")).toHaveLength(1);
      expect((await repo.getRun(run.id))?.status).toBe("succeeded");
    } finally {
      await db.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs researcher jobs with tool-backed providers and logs tool calls", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-real-research-"));
    const db = openDatabase(dir);
    try {
      const repo = new ConjectRepository(db, dir);
      const config = structuredClone(defaultConfig);
      config.research.ideas = 1;
      config.research.sourcesPerIdea = 2;
      config.research.webQueries = 1;
      config.research.webFetches = 1;

      const paperProvider: PaperSearchProvider = {
        id: "openalex",
        async search() {
          return [
            {
              id: "paper-1",
              title: "A real-ish paper result",
              url: "https://example.org/paper",
              year: 2024,
              sourceType: "paper",
              provider: "openalex",
              authors: ["Fixture Author"],
              doi: "10.1000/fixture",
              abstract: "This robust hyperspectral unmixing method improves performance under noisy outliers and reduces sensitivity to corrupted observations."
            }
          ];
        }
      };

      const webProvider: WebSearchProvider = {
        id: "tavily",
        async search() {
          return [
            {
              title: "A real-ish web result",
              url: "https://example.org/web",
              snippet: "A robust unmixing benchmark reports improved stability for sparse hyperspectral mixtures.",
              provider: "tavily"
            }
          ];
        }
      };

      const run = await repo.createRun("Find implementable ideas for robust IMF in hyperspectral unmixing", config);
      await new Orchestrator(
        repo,
        new ToolBackedResearchRuntime({
          delegate: new MockAgentRuntime(),
          paperProviders: [paperProvider],
          webProviders: [webProvider]
        })
      ).runFullPipeline(run.id);

      const bundles = await repo.listArtifacts(run.id, "evidence_bundle");
      expect(bundles).toHaveLength(1);
      const bundle = bundles[0]!.json as {
        sources: Array<{ provider?: string; sourceType: string; qualityNotes?: string }>;
        claims: Array<{ sourceId: string; support: string; confidence: number; location?: string; quote?: string }>;
        researchNotes: string;
      };
      expect(bundle.sources.map((source) => source.provider)).toEqual(["openalex", "tavily"]);
      expect(bundle.claims).toHaveLength(2);
      expect(bundle.claims[0]).toMatchObject({
        sourceId: "paper-1",
        support: "supports",
        confidence: 5,
        location: "abstract"
      });
      expect(bundle.claims[0]!.quote).toContain("improves performance");
      expect(bundle.claims.every((claim) => claim.confidence >= 1 && claim.confidence <= 5)).toBe(true);
      expect(bundle.sources[0]!.qualityNotes).toContain("has DOI");
      expect(bundle.sources[1]!.qualityNotes).toContain("web source");
      expect(bundle.researchNotes).toContain("Tool-backed research");
      expect(bundle.researchNotes).toContain("Evidence mix: 1 paper source(s), 1 web source(s).");

      const toolCalls = await repo.listToolCalls(run.id);
      expect(toolCalls.map((call) => call.toolName)).toEqual(["paper_search.openalex", "web_search.tavily"]);
      expect(toolCalls.every((call) => call.status === "succeeded")).toBe(true);
    } finally {
      await db.destroy();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
