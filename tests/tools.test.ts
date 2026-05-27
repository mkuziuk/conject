import { describe, expect, it } from "vitest";
import {
  ArxivPaperSearchProvider,
  OpenAlexPaperSearchProvider,
  SearxngWebSearchProvider,
  SemanticScholarPaperSearchProvider,
  TavilyWebSearchProvider,
  searchPapersAcrossProviders,
  searchWebAcrossProviders,
  type PaperSearchProvider
} from "../packages/tools/src/index.js";

describe("paper search providers", () => {
  it("maps OpenAlex works into source records", async () => {
    const provider = new OpenAlexPaperSearchProvider({ baseUrl: "https://openalex.test", mailto: "me@example.com" });
    const results = await provider.search({
      query: "robust unmixing",
      limit: 1,
      fetch: async (url) => {
        const parsed = new URL(String(url));
        expect(parsed.searchParams.get("search")).toBe("robust unmixing");
        expect(parsed.searchParams.get("mailto")).toBe("me@example.com");
        return jsonResponse({
          results: [
            {
              id: "https://openalex.org/W1",
              doi: "https://doi.org/10.1000/example",
              display_name: "Robust unmixing paper",
              publication_year: 2024,
              abstract_inverted_index: { Robust: [0], methods: [1], work: [2] },
              authorships: [{ author: { display_name: "Ada Lovelace" } }],
              primary_location: {
                landing_page_url: "https://example.org/paper",
                source: { display_name: "Journal" }
              },
              open_access: { oa_url: "https://example.org/paper.pdf" }
            }
          ]
        });
      }
    });

    expect(results[0]).toMatchObject({
      id: "https://doi.org/10.1000/example",
      title: "Robust unmixing paper",
      doi: "10.1000/example",
      provider: "openalex",
      abstract: "Robust methods work"
    });
  });

  it("maps Semantic Scholar results and sends API key when configured", async () => {
    const provider = new SemanticScholarPaperSearchProvider({ baseUrl: "https://s2.test", apiKey: "secret" });
    const results = await provider.search({
      query: "robust imf",
      limit: 1,
      fetch: async (_url, init) => {
        expect((init?.headers as Record<string, string>)["x-api-key"]).toBe("secret");
        return jsonResponse({
          data: [
            {
              paperId: "abc",
              title: "S2 Paper",
              abstract: "S2 abstract",
              url: "https://example.org/s2",
              year: 2023,
              venue: "Conference",
              authors: [{ name: "Grace Hopper" }],
              externalIds: { DOI: "10.1000/s2" },
              openAccessPdf: { url: "https://example.org/s2.pdf" }
            }
          ]
        });
      }
    });

    expect(results[0]).toMatchObject({
      id: "abc",
      title: "S2 Paper",
      url: "https://example.org/s2.pdf",
      doi: "10.1000/s2",
      provider: "semantic_scholar"
    });
  });

  it("parses arXiv Atom responses", async () => {
    const provider = new ArxivPaperSearchProvider({ baseUrl: "https://arxiv.test" });
    const results = await provider.search({
      query: "matrix factorization",
      limit: 1,
      fetch: async () =>
        new Response(`<?xml version="1.0"?>
          <feed>
            <entry>
              <id>http://arxiv.org/abs/2401.00001v1</id>
              <title> A Matrix Factorization Paper </title>
              <summary> A useful abstract. </summary>
              <published>2024-01-01T00:00:00Z</published>
              <author><name>Alan Turing</name></author>
              <link href="http://arxiv.org/abs/2401.00001v1"/>
              <link title="pdf" href="http://arxiv.org/pdf/2401.00001v1"/>
            </entry>
          </feed>`)
    });

    expect(results[0]).toMatchObject({
      id: "http://arxiv.org/abs/2401.00001v1",
      title: "A Matrix Factorization Paper",
      url: "http://arxiv.org/pdf/2401.00001v1",
      year: 2024,
      provider: "arxiv"
    });
  });

  it("deduplicates across paper providers", async () => {
    const providers: PaperSearchProvider[] = [
      { id: "openalex", search: async () => [{ id: "a", title: "Same", doi: "10/test", sourceType: "paper", provider: "openalex", authors: [] }] },
      { id: "semantic_scholar", search: async () => [{ id: "b", title: "Same", doi: "10/test", sourceType: "paper", provider: "semantic_scholar", authors: [] }] }
    ];
    const results = await searchPapersAcrossProviders({ query: "x", limit: 5, providers });
    expect(results).toHaveLength(1);
  });
});

describe("web search providers", () => {
  it("maps Tavily results", async () => {
    const provider = new TavilyWebSearchProvider({ apiKey: "tavily-key", baseUrl: "https://tavily.test" });
    const results = await provider.search({
      query: "robust unmixing",
      limit: 1,
      fetch: async (_url, init) => {
        expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tavily-key");
        expect(JSON.parse(String(init?.body)).query).toBe("robust unmixing");
        return jsonResponse({ results: [{ title: "Result", url: "https://example.org", content: "Snippet", score: 0.9 }] });
      }
    });

    expect(results[0]).toMatchObject({ title: "Result", provider: "tavily", score: 0.9 });
  });

  it("maps SearXNG results and deduplicates web providers", async () => {
    const searxng = new SearxngWebSearchProvider({ baseUrl: "https://searxng.test" });
    const results = await searchWebAcrossProviders({
      query: "robust unmixing",
      limit: 3,
      providers: [searxng, searxng],
      fetch: async () => jsonResponse({ results: [{ title: "Result", url: "https://example.org", content: "Snippet", score: 1 }] })
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ title: "Result", provider: "searxng" });
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
