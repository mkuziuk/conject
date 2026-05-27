import { asArray, asNumber, asString, fetchJson, firstString, isRecord, type FetchLike } from "./http.js";

export type WebProviderName = "tavily" | "searxng";

export type WebSearchResult = {
  title: string;
  url: string;
  snippet?: string;
  score?: number;
  provider: WebProviderName;
};

export type WebSearchOptions = {
  query: string;
  limit: number;
  fetch?: FetchLike;
};

export interface WebSearchProvider {
  readonly id: WebProviderName;
  search(options: WebSearchOptions): Promise<WebSearchResult[]>;
}

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly id = "tavily" as const;

  constructor(private readonly options: { apiKey: string; baseUrl?: string }) {}

  async search(options: WebSearchOptions): Promise<WebSearchResult[]> {
    const fetcher = options.fetch ?? fetch;
    const url = new URL("/search", this.options.baseUrl ?? "https://api.tavily.com");
    const json = await fetchJson(fetcher, url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.options.apiKey}`
      },
      body: JSON.stringify({
        query: options.query,
        max_results: options.limit,
        search_depth: "basic",
        include_raw_content: false
      })
    });
    return asArray(json.results).slice(0, options.limit).flatMap((item) => {
      if (!isRecord(item)) return [];
      const title = asString(item.title);
      const url = asString(item.url);
      if (!title || !url) return [];
      return [{ title, url, snippet: asString(item.content), score: asNumber(item.score), provider: this.id }];
    });
  }
}

export class SearxngWebSearchProvider implements WebSearchProvider {
  readonly id = "searxng" as const;

  constructor(private readonly options: { baseUrl: string }) {}

  async search(options: WebSearchOptions): Promise<WebSearchResult[]> {
    const fetcher = options.fetch ?? fetch;
    const url = new URL("/search", this.options.baseUrl);
    url.searchParams.set("q", options.query);
    url.searchParams.set("format", "json");
    url.searchParams.set("language", "en");
    const json = await fetchJson(fetcher, url, { headers: { accept: "application/json" } });
    return asArray(json.results).slice(0, options.limit).flatMap((item) => {
      if (!isRecord(item)) return [];
      const title = asString(item.title);
      const resultUrl = asString(item.url);
      if (!title || !resultUrl) return [];
      return [
        {
          title,
          url: resultUrl,
          snippet: firstString(item.content, item.snippet),
          score: asNumber(item.score),
          provider: this.id
        }
      ];
    });
  }
}

export async function searchWebAcrossProviders(input: {
  query: string;
  limit: number;
  providers: WebSearchProvider[];
  fetch?: FetchLike;
}): Promise<WebSearchResult[]> {
  const seen = new Set<string>();
  const output: WebSearchResult[] = [];
  for (const provider of input.providers) {
    const remaining = input.limit - output.length;
    if (remaining <= 0) break;
    const results = await provider.search({ query: input.query, limit: remaining, fetch: input.fetch });
    for (const result of results) {
      if (seen.has(result.url)) continue;
      seen.add(result.url);
      output.push(result);
      if (output.length >= input.limit) break;
    }
  }
  return output;
}
