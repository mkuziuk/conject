import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { errorResult, textResult } from "./result.js";

const MAX_RESULTS = 10;

export interface PaperSearchResult {
  title: string;
  year?: number;
  url?: string;
  doi?: string;
  citedByCount?: number;
  authors: string[];
  abstract?: string;
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet?: string;
}

interface SearchParams {
  query: string;
  limit?: number;
}

function boundLimit(limit: number | undefined, fallback: number): number {
  const value = Number.isFinite(limit) ? Math.floor(limit as number) : fallback;
  return Math.max(1, Math.min(MAX_RESULTS, value));
}

export function createPaperSearchTool(fetchImpl: typeof fetch = fetch): ToolDefinition {
  return {
    name: "conject_paper_search",
    label: "Paper Search",
    description: "Search OpenAlex for source-grounded academic paper metadata.",
    promptSnippet: "conject_paper_search searches papers and returns titles, URLs, abstracts, years, and citation counts.",
    promptGuidelines: ["Use paper search before broad web search when research claims need scholarly evidence."],
    parameters: Type.Object({
      query: Type.String({ description: "Search query." }),
      limit: Type.Optional(Type.Number({ description: "Maximum results, 1-10. Default 5." }))
    }),
    async execute(_toolCallId, params, signal) {
      const input = params as SearchParams;
      try {
        const limit = boundLimit(input.limit, 5);
        const results = await searchOpenAlex(fetchImpl, input.query, limit, signal);
        const text = results.length
          ? results.map(formatPaperResult).join("\n\n")
          : `No paper results found for "${input.query}".`;
        return textResult(text, { provider: "openalex", query: input.query, results });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Paper search failed: ${message}`, { provider: "openalex", query: input.query, results: [] });
      }
    }
  };
}

export function createWebSearchTool(fetchImpl: typeof fetch = fetch): ToolDefinition {
  return {
    name: "conject_web_search",
    label: "Web Search",
    description: "Search configured web providers for recent implementation or project context.",
    promptSnippet: "conject_web_search searches Tavily or SearxNG when configured.",
    promptGuidelines: [
      "Use web search for recent implementation context, project pages, docs, and non-paper evidence.",
      "If no web provider is configured, say so and continue with available evidence."
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query." }),
      limit: Type.Optional(Type.Number({ description: "Maximum results, 1-10. Default 5." }))
    }),
    async execute(_toolCallId, params, signal) {
      const input = params as SearchParams;
      const limit = boundLimit(input.limit, 5);
      try {
        const tavilyKey = process.env.TAVILY_API_KEY;
        const searxngBase = process.env.SEARXNG_BASE_URL ?? process.env.CONJECT_SEARXNG_URL;
        const provider = tavilyKey ? "tavily" : searxngBase ? "searxng" : "none";
        const results = tavilyKey
          ? await searchTavily(fetchImpl, tavilyKey, input.query, limit, signal)
          : searxngBase
            ? await searchSearxng(fetchImpl, searxngBase, input.query, limit, signal)
            : [];

        if (provider === "none") {
          return textResult(
            "No web search provider is configured. Set TAVILY_API_KEY, SEARXNG_BASE_URL, or CONJECT_SEARXNG_URL.",
            { provider, query: input.query, results }
          );
        }

        const text = results.length ? results.map(formatWebResult).join("\n\n") : `No web results found for "${input.query}".`;
        return textResult(text, { provider, query: input.query, results });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Web search failed: ${message}`, { provider: "unknown", query: input.query, results: [] });
      }
    }
  };
}

async function searchOpenAlex(
  fetchImpl: typeof fetch,
  query: string,
  limit: number,
  signal: AbortSignal | undefined
): Promise<PaperSearchResult[]> {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("select", "id,doi,title,publication_year,primary_location,authorships,abstract_inverted_index,cited_by_count");
  if (process.env.OPENALEX_MAILTO) url.searchParams.set("mailto", process.env.OPENALEX_MAILTO);

  const response = await fetchImpl(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`OpenAlex HTTP ${response.status}`);
  const json = (await response.json()) as { results?: OpenAlexWork[] };

  return (json.results ?? []).slice(0, limit).map((work) => ({
    title: work.title ?? "(untitled)",
    year: work.publication_year,
    url: work.primary_location?.landing_page_url ?? work.primary_location?.pdf_url ?? work.id,
    doi: work.doi,
    citedByCount: work.cited_by_count,
    authors: (work.authorships ?? [])
      .map((authorship) => authorship.author?.display_name)
      .filter((name): name is string => Boolean(name))
      .slice(0, 6),
    abstract: invertOpenAlexAbstract(work.abstract_inverted_index)
  }));
}

async function searchTavily(
  fetchImpl: typeof fetch,
  apiKey: string,
  query: string,
  limit: number,
  signal: AbortSignal | undefined
): Promise<WebSearchResult[]> {
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: apiKey, query, max_results: limit, search_depth: "basic", include_answer: false })
  });
  if (!response.ok) throw new Error(`Tavily HTTP ${response.status}`);
  const json = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (json.results ?? [])
    .filter((result) => result.url)
    .slice(0, limit)
    .map((result) => ({
      title: result.title ?? result.url ?? "(untitled)",
      url: result.url as string,
      snippet: result.content
    }));
}

async function searchSearxng(
  fetchImpl: typeof fetch,
  baseUrl: string,
  query: string,
  limit: number,
  signal: AbortSignal | undefined
): Promise<WebSearchResult[]> {
  const url = new URL("/search", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  const response = await fetchImpl(url, { signal, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`SearxNG HTTP ${response.status}`);
  const json = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (json.results ?? [])
    .filter((result) => result.url)
    .slice(0, limit)
    .map((result) => ({
      title: result.title ?? result.url ?? "(untitled)",
      url: result.url as string,
      snippet: result.content
    }));
}

function formatPaperResult(result: PaperSearchResult): string {
  const authors = result.authors.length ? ` Authors: ${result.authors.join(", ")}.` : "";
  const year = result.year ? ` (${result.year})` : "";
  const cited = result.citedByCount !== undefined ? ` Cited by: ${result.citedByCount}.` : "";
  const doi = result.doi ? ` DOI: ${result.doi}.` : "";
  const url = result.url ? `\n${result.url}` : "";
  const abstract = result.abstract ? `\n${result.abstract}` : "";
  return `### ${result.title}${year}\n${authors}${cited}${doi}${url}${abstract}`.trim();
}

function formatWebResult(result: WebSearchResult): string {
  const snippet = result.snippet ? `\n${result.snippet}` : "";
  return `### ${result.title}\n${result.url}${snippet}`;
}

function invertOpenAlexAbstract(index: Record<string, number[]> | null | undefined): string | undefined {
  if (!index) return undefined;
  const words: Array<[number, string]> = [];
  for (const [word, positions] of Object.entries(index)) {
    for (const position of positions) words.push([position, word]);
  }
  words.sort((a, b) => a[0] - b[0]);
  return words.map(([, word]) => word).join(" ") || undefined;
}

interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  publication_year?: number;
  cited_by_count?: number;
  primary_location?: {
    landing_page_url?: string;
    pdf_url?: string;
  };
  authorships?: Array<{
    author?: {
      display_name?: string;
    };
  }>;
  abstract_inverted_index?: Record<string, number[]>;
}
