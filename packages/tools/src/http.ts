export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type JsonRecord = Record<string, unknown>;

export async function fetchJson(fetcher: FetchLike, url: URL, init?: RequestInit): Promise<JsonRecord> {
  const response = await fetcher(url, init);
  if (!response.ok) {
    const body = await safeText(response);
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url.toString()}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  const parsed = (await response.json()) as unknown;
  if (!isRecord(parsed)) throw new Error(`Expected JSON object from ${url.toString()}`);
  return parsed;
}

export async function fetchText(fetcher: FetchLike, url: URL, init?: RequestInit): Promise<string> {
  const response = await fetcher(url, init);
  if (!response.ok) {
    const body = await safeText(response);
    throw new Error(`HTTP ${response.status} ${response.statusText} for ${url.toString()}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  return response.text();
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = asString(value);
    if (text) return text;
  }
  return undefined;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
