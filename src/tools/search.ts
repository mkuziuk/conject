import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseNonNegativeIntegerBudget, WEB_SEARCH_BUDGET_ENV } from "../search-budget.js";
import { errorResult, textResult, truncateText } from "./result.js";

const MAX_RESULTS = 10;
const DEFAULT_SEARCH_MAX_CHARS = 30_000;
const MAX_SEARCH_MAX_CHARS = 120_000;
const MAX_RESULT_TEXT_CHARS = 4_000;

interface WebSearchBudgetState {
  raw?: string;
  used: number;
}

interface WebSearchBudgetSnapshot {
  limit: number;
  used: number;
  remaining: number;
}

const webSearchBudgetState: WebSearchBudgetState = { used: 0 };

export function resetWebSearchBudgetForTests(): void {
  webSearchBudgetState.raw = undefined;
  webSearchBudgetState.used = 0;
}

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
  maxChars?: number;
}

function boundLimit(limit: number | undefined, fallback: number): number {
  const value = Number.isFinite(limit) ? Math.floor(limit as number) : fallback;
  return Math.max(1, Math.min(MAX_RESULTS, value));
}

function boundMaxChars(maxChars: number | undefined): number {
  const value = Number.isFinite(maxChars) ? Math.floor(maxChars as number) : DEFAULT_SEARCH_MAX_CHARS;
  return Math.max(1_000, Math.min(MAX_SEARCH_MAX_CHARS, value));
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
      limit: Type.Optional(Type.Number({ description: "Maximum results, 1-10. Default 5." })),
      maxChars: Type.Optional(Type.Number({ description: "Maximum returned text characters. Default 30000." }))
    }),
    async execute(_toolCallId, params, signal) {
      const input = params as SearchParams;
      const maxChars = boundMaxChars(input.maxChars);
      try {
        const limit = boundLimit(input.limit, 5);
        const results = boundPaperResults(await searchOpenAlex(fetchImpl, input.query, limit, signal));
        const rawText = results.length
          ? results.map(formatPaperResult).join("\n\n")
          : `No paper results found for "${input.query}".`;
        const output = boundToolText(rawText, maxChars);
        return textResult(output.text, { provider: "openalex", query: input.query, maxChars, truncated: output.truncated, results });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Paper search failed: ${message}`, { provider: "openalex", query: input.query, maxChars, truncated: false, results: [] });
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
      limit: Type.Optional(Type.Number({ description: "Maximum results, 1-10. Default 5." })),
      maxChars: Type.Optional(Type.Number({ description: "Maximum returned text characters. Default 30000." }))
    }),
    async execute(_toolCallId, params, signal) {
      const input = params as SearchParams;
      const limit = boundLimit(input.limit, 5);
      const maxChars = boundMaxChars(input.maxChars);
      const budgetBeforeProvider = peekWebSearchBudget();
      try {
        const tavilyKey = process.env.TAVILY_API_KEY;
        const searxngBase = process.env.SEARXNG_BASE_URL ?? process.env.CONJECT_SEARXNG_URL;
        const provider = tavilyKey ? "tavily" : searxngBase ? "searxng" : "none";

        if (provider === "none") {
          return textResult(
            "No web search provider is configured. Set TAVILY_API_KEY, SEARXNG_BASE_URL, or CONJECT_SEARXNG_URL.",
            { provider, query: input.query, maxChars, truncated: false, results: [], ...budgetDetails(budgetBeforeProvider) }
          );
        }

        const budgetAttempt = consumeWebSearchBudget();
        if (!budgetAttempt.allowed) {
          return textResult(
            `Web search budget exhausted (${budgetAttempt.budget.used}/${budgetAttempt.budget.limit}). Continue with paper search, local files, and already collected evidence.`,
            {
              provider,
              query: input.query,
              maxChars,
              truncated: false,
              results: [],
              budgetExhausted: true,
              ...budgetDetails(budgetAttempt.budget)
            }
          );
        }

        const results = boundWebResults(
          tavilyKey
            ? await searchTavily(fetchImpl, tavilyKey, input.query, limit, signal)
            : await searchSearxng(fetchImpl, searxngBase as string, input.query, limit, signal)
        );

        const rawText = results.length ? results.map(formatWebResult).join("\n\n") : `No web results found for "${input.query}".`;
        const output = boundToolText(rawText, maxChars);
        return textResult(output.text, {
          provider,
          query: input.query,
          maxChars,
          truncated: output.truncated,
          results,
          ...budgetDetails(budgetAttempt.budget)
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Web search failed: ${message}`, {
          provider: "unknown",
          query: input.query,
          maxChars,
          truncated: false,
          results: [],
          ...budgetDetails(peekWebSearchBudget())
        });
      }
    }
  };
}

function peekWebSearchBudget(): WebSearchBudgetSnapshot | undefined {
  const raw = process.env[WEB_SEARCH_BUDGET_ENV];
  if (raw !== webSearchBudgetState.raw) {
    webSearchBudgetState.raw = raw;
    webSearchBudgetState.used = 0;
  }
  const limit = parseNonNegativeIntegerBudget(raw);
  if (limit === undefined) return undefined;
  return {
    limit,
    used: webSearchBudgetState.used,
    remaining: Math.max(0, limit - webSearchBudgetState.used)
  };
}

function consumeWebSearchBudget(): { allowed: true; budget?: WebSearchBudgetSnapshot } | { allowed: false; budget: WebSearchBudgetSnapshot } {
  const current = peekWebSearchBudget();
  if (!current) return { allowed: true };
  if (current.remaining <= 0) return { allowed: false, budget: current };
  webSearchBudgetState.used++;
  return {
    allowed: true,
    budget: {
      limit: current.limit,
      used: webSearchBudgetState.used,
      remaining: Math.max(0, current.limit - webSearchBudgetState.used)
    }
  };
}

function budgetDetails(budget: WebSearchBudgetSnapshot | undefined): Record<string, number> {
  if (!budget) return {};
  return {
    budgetLimit: budget.limit,
    budgetUsed: budget.used,
    budgetRemaining: budget.remaining
  };
}

function boundPaperResults(results: PaperSearchResult[]): PaperSearchResult[] {
  return results.map((result) => ({
    ...result,
    abstract: result.abstract ? truncateText(result.abstract, MAX_RESULT_TEXT_CHARS) : undefined
  }));
}

function boundWebResults(results: WebSearchResult[]): WebSearchResult[] {
  return results.map((result) => ({
    ...result,
    snippet: result.snippet ? truncateText(result.snippet, MAX_RESULT_TEXT_CHARS) : undefined
  }));
}

function boundToolText(text: string, maxChars: number): { text: string; truncated: boolean } {
  return {
    text: truncateText(text, maxChars),
    truncated: text.length > maxChars
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
