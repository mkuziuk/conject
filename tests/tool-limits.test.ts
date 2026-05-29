import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createPdfExtractTool, type PdfExtractDetails } from "../src/tools/pdf.js";
import { createPaperSearchTool, createWebSearchTool } from "../src/tools/search.js";

describe("tool output limits", () => {
  it("uses the PDF 80000 character default and reports one-character truncation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-pdf-limit-"));
    try {
      writeFileSync(join(dir, "source.txt"), "x".repeat(80_001), "utf8");
      const result = await createPdfExtractTool().execute("tool-1", { path: "source.txt" }, undefined, undefined, fakeContext(dir));
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = result.details as PdfExtractDetails;

      expect(text).toContain("[truncated: 1 chars omitted]");
      expect(details.truncated).toBe(true);
      expect(details.originalChars).toBe(80_001);
      expect(details.returnedChars).toBe(text.length);
      expect(details.chars).toBe(text.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("clamps very small PDF maxChars overrides to 1000", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-pdf-limit-"));
    try {
      writeFileSync(join(dir, "source.txt"), "x".repeat(1_500), "utf8");
      const result = await createPdfExtractTool().execute("tool-1", { path: "source.txt", maxChars: 10 }, undefined, undefined, fakeContext(dir));
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = result.details as PdfExtractDetails;

      expect(text).toContain("[truncated: 500 chars omitted]");
      expect(details.truncated).toBe(true);
      expect(details.originalChars).toBe(1_500);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps paper search result count, long abstracts, and total output", async () => {
    let perPage = "";
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      perPage = url.searchParams.get("per-page") ?? "";
      return new Response(
        JSON.stringify({
          results: Array.from({ length: 12 }, (_, index) => ({
            id: `https://openalex.org/W${index}`,
            title: `Paper ${index}`,
            publication_year: 2024,
            cited_by_count: index,
            primary_location: { landing_page_url: `https://example.test/paper-${index}` },
            authorships: [{ author: { display_name: "Ada Lovelace" } }],
            abstract_inverted_index: longAbstractIndex(2_501)
          }))
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    };

    const result = await createPaperSearchTool(fetchImpl as typeof fetch).execute(
      "tool-1",
      { query: "limits", limit: 99, maxChars: 1000 },
      undefined,
      undefined,
      fakeContext(process.cwd())
    );
    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    const details = result.details as { maxChars: number; truncated: boolean; results: Array<{ abstract?: string }> };

    expect(perPage).toBe("10");
    expect(details.results).toHaveLength(10);
    expect(details.results[0]?.abstract).toContain("[truncated:");
    expect(details.truncated).toBe(true);
    expect(details.maxChars).toBe(1000);
    expect(text).toContain("[truncated:");
  });

  it("caps web search result count, long snippets, and total output", async () => {
    const oldTavily = process.env.TAVILY_API_KEY;
    const oldSearx = process.env.SEARXNG_BASE_URL;
    const oldConjectSearx = process.env.CONJECT_SEARXNG_URL;
    process.env.TAVILY_API_KEY = "test-key";
    delete process.env.SEARXNG_BASE_URL;
    delete process.env.CONJECT_SEARXNG_URL;
    try {
      let maxResults = 0;
      const fetchImpl = async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { max_results?: number };
        maxResults = body.max_results ?? 0;
        return new Response(
          JSON.stringify({
            results: Array.from({ length: 12 }, (_, index) => ({
              title: `Result ${index}`,
              url: `https://example.test/${index}`,
              content: "s".repeat(5_000)
            }))
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      };

      const result = await createWebSearchTool(fetchImpl as typeof fetch).execute(
        "tool-1",
        { query: "limits", limit: 99, maxChars: 1000 },
        undefined,
        undefined,
        fakeContext(process.cwd())
      );
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      const details = result.details as { maxChars: number; truncated: boolean; results: Array<{ snippet?: string }> };

      expect(maxResults).toBe(10);
      expect(details.results).toHaveLength(10);
      expect(details.results[0]?.snippet).toContain("[truncated: 1000 chars omitted]");
      expect(details.truncated).toBe(true);
      expect(details.maxChars).toBe(1000);
      expect(text).toContain("[truncated:");
    } finally {
      restoreEnv("TAVILY_API_KEY", oldTavily);
      restoreEnv("SEARXNG_BASE_URL", oldSearx);
      restoreEnv("CONJECT_SEARXNG_URL", oldConjectSearx);
    }
  });
});

function longAbstractIndex(wordCount: number): Record<string, number[]> {
  return { x: Array.from({ length: wordCount }, (_, index) => index) };
}

function fakeContext(cwd: string) {
  return {
    cwd,
    hasUI: false,
    ui: {}
  } as any;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
