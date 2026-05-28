import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveResearchArtifactPath, safeFileSegment, writeResearchArtifact } from "../src/tools/artifacts.js";

describe("research artifacts", () => {
  it("restricts writes to Markdown files under research", () => {
    const cwd = mkdtempSync(join(tmpdir(), "conject-artifacts-"));
    try {
      expect(resolveResearchArtifactPath(cwd, "brief.md")).toBe(join(cwd, "research", "brief.md"));
      expect(() => resolveResearchArtifactPath(cwd, "../escape.md")).toThrow(/inside the research/);
      expect(() => resolveResearchArtifactPath(cwd, "/tmp/escape.md")).toThrow(/relative/);
      expect(() => resolveResearchArtifactPath(cwd, "brief.txt")).toThrow(/Markdown/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("writes visible Markdown artifacts", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "conject-artifacts-"));
    try {
      const result = await writeResearchArtifact(cwd, "research/agents/topic-1.md", "# Memo");
      expect(result.path).toBe("research/agents/topic-1.md");
      expect(existsSync(join(cwd, result.path))).toBe(true);
      expect(readFileSync(join(cwd, result.path), "utf8")).toBe("# Memo\n");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it("normalizes task ids into file-safe segments", () => {
    expect(safeFileSegment("Topic 1: GPU/RAG?")).toBe("topic-1-gpu-rag");
  });
});
