import type { SourceRecord } from "@conject/artifacts";
import { XMLParser } from "fast-xml-parser";
import { asArray, asNumber, asString, fetchJson, fetchText, firstString, isRecord, type FetchLike } from "./http.js";

export type PaperProviderName = "openalex" | "semantic_scholar" | "arxiv";

export type PaperSearchOptions = {
  query: string;
  limit: number;
  fetch?: FetchLike;
};

export interface PaperSearchProvider {
  readonly id: PaperProviderName;
  search(options: PaperSearchOptions): Promise<SourceRecord[]>;
}

export class OpenAlexPaperSearchProvider implements PaperSearchProvider {
  readonly id = "openalex" as const;

  constructor(private readonly options: { baseUrl?: string; mailto?: string } = {}) {}

  async search(options: PaperSearchOptions): Promise<SourceRecord[]> {
    const fetcher = options.fetch ?? fetch;
    const url = new URL("/works", this.options.baseUrl ?? "https://api.openalex.org");
    url.searchParams.set("search", options.query);
    url.searchParams.set("per-page", String(options.limit));
    if (this.options.mailto) url.searchParams.set("mailto", this.options.mailto);

    const json = await fetchJson(fetcher, url);
    return asArray(json.results).slice(0, options.limit).flatMap((item, index) => {
      if (!isRecord(item)) return [];
      return [openAlexWorkToSource(item, index)];
    });
  }
}

export class SemanticScholarPaperSearchProvider implements PaperSearchProvider {
  readonly id = "semantic_scholar" as const;

  constructor(private readonly options: { baseUrl?: string; apiKey?: string } = {}) {}

  async search(options: PaperSearchOptions): Promise<SourceRecord[]> {
    const fetcher = options.fetch ?? fetch;
    const url = new URL("/graph/v1/paper/search", this.options.baseUrl ?? "https://api.semanticscholar.org");
    url.searchParams.set("query", options.query);
    url.searchParams.set("limit", String(options.limit));
    url.searchParams.set("fields", "title,abstract,url,year,authors,venue,externalIds,openAccessPdf");
    const headers = this.options.apiKey ? { "x-api-key": this.options.apiKey } : undefined;
    const json = await fetchJson(fetcher, url, headers ? { headers } : undefined);
    return asArray(json.data).slice(0, options.limit).flatMap((item, index) => {
      if (!isRecord(item)) return [];
      return [semanticScholarPaperToSource(item, index)];
    });
  }
}

export class ArxivPaperSearchProvider implements PaperSearchProvider {
  readonly id = "arxiv" as const;

  constructor(private readonly options: { baseUrl?: string } = {}) {}

  async search(options: PaperSearchOptions): Promise<SourceRecord[]> {
    const fetcher = options.fetch ?? fetch;
    const url = new URL("/api/query", this.options.baseUrl ?? "https://export.arxiv.org");
    url.searchParams.set("search_query", `all:${options.query}`);
    url.searchParams.set("start", "0");
    url.searchParams.set("max_results", String(options.limit));
    const xml = await fetchText(fetcher, url);
    const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" });
    const parsed = parser.parse(xml) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.feed)) return [];
    const entries = asArray(parsed.feed.entry).length ? asArray(parsed.feed.entry) : parsed.feed.entry ? [parsed.feed.entry] : [];
    return entries.slice(0, options.limit).flatMap((entry, index) => {
      if (!isRecord(entry)) return [];
      return [arxivEntryToSource(entry, index)];
    });
  }
}

export async function searchPapersAcrossProviders(input: {
  query: string;
  limit: number;
  providers: PaperSearchProvider[];
  fetch?: FetchLike;
}): Promise<SourceRecord[]> {
  const seen = new Set<string>();
  const output: SourceRecord[] = [];
  for (const provider of input.providers) {
    const remaining = input.limit - output.length;
    if (remaining <= 0) break;
    const results = await provider.search({ query: input.query, limit: remaining, fetch: input.fetch });
    for (const result of results) {
      const key = result.doi ?? result.url ?? result.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      output.push(result);
      if (output.length >= input.limit) break;
    }
  }
  return output;
}

function openAlexWorkToSource(work: Record<string, unknown>, index: number): SourceRecord {
  const id = firstString(work.doi, work.id) ?? `openalex:${index + 1}`;
  const primaryLocation = isRecord(work.primary_location) ? work.primary_location : {};
  const source = isRecord(primaryLocation.source) ? primaryLocation.source : {};
  const openAccess = isRecord(work.open_access) ? work.open_access : {};
  const authors = asArray(work.authorships)
    .map((authorship) => (isRecord(authorship) && isRecord(authorship.author) ? asString(authorship.author.display_name) : undefined))
    .filter((author): author is string => Boolean(author));
  return {
    id,
    title: firstString(work.display_name, work.title) ?? "Untitled OpenAlex work",
    url: firstString(openAccess.oa_url, primaryLocation.landing_page_url, work.id),
    doi: stripDoiPrefix(asString(work.doi)),
    venue: asString(source.display_name),
    year: asNumber(work.publication_year),
    sourceType: "paper",
    provider: "openalex",
    authors,
    abstract: reconstructOpenAlexAbstract(work.abstract_inverted_index),
    qualityNotes: "Imported from OpenAlex Works search."
  };
}

function semanticScholarPaperToSource(paper: Record<string, unknown>, index: number): SourceRecord {
  const externalIds = isRecord(paper.externalIds) ? paper.externalIds : {};
  const openAccessPdf = isRecord(paper.openAccessPdf) ? paper.openAccessPdf : {};
  const authors = asArray(paper.authors)
    .map((author) => (isRecord(author) ? asString(author.name) : undefined))
    .filter((author): author is string => Boolean(author));
  return {
    id: firstString(paper.paperId, externalIds.DOI, paper.url) ?? `semantic_scholar:${index + 1}`,
    title: asString(paper.title) ?? "Untitled Semantic Scholar paper",
    url: firstString(openAccessPdf.url, paper.url),
    doi: stripDoiPrefix(asString(externalIds.DOI)),
    venue: asString(paper.venue),
    year: asNumber(paper.year),
    sourceType: "paper",
    provider: "semantic_scholar",
    authors,
    abstract: asString(paper.abstract),
    qualityNotes: "Imported from Semantic Scholar Graph API paper search."
  };
}

function arxivEntryToSource(entry: Record<string, unknown>, index: number): SourceRecord {
  const links = asArray(entry.link);
  const pdfLink = links.find((link) => isRecord(link) && link.title === "pdf") as Record<string, unknown> | undefined;
  const firstLink = links.find((link) => isRecord(link)) as Record<string, unknown> | undefined;
  const authors = asArray(entry.author).length
    ? asArray(entry.author)
        .map((author) => (isRecord(author) ? asString(author.name) : undefined))
        .filter((author): author is string => Boolean(author))
    : isRecord(entry.author) && asString(entry.author.name)
      ? [asString(entry.author.name)!]
      : [];
  const published = asString(entry.published);
  return {
    id: asString(entry.id) ?? `arxiv:${index + 1}`,
    title: normalizeWhitespace(asString(entry.title) ?? "Untitled arXiv paper"),
    url: firstString(pdfLink?.href, firstLink?.href, entry.id),
    venue: "arXiv",
    year: published ? Number.parseInt(published.slice(0, 4), 10) : undefined,
    sourceType: "paper",
    provider: "arxiv",
    authors,
    abstract: normalizeWhitespace(asString(entry.summary) ?? ""),
    qualityNotes: "Imported from arXiv API."
  };
}

function reconstructOpenAlexAbstract(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const entries: Array<{ word: string; position: number }> = [];
  for (const [word, positions] of Object.entries(value)) {
    for (const position of asArray(positions)) {
      if (typeof position === "number") entries.push({ word, position });
    }
  }
  if (entries.length === 0) return undefined;
  return entries
    .sort((a, b) => a.position - b.position)
    .map((entry) => entry.word)
    .join(" ");
}

function stripDoiPrefix(value: string | undefined): string | undefined {
  return value?.replace(/^https?:\/\/doi\.org\//i, "");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}
