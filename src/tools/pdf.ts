import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { Type } from "typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { errorResult, textResult, truncateText } from "./result.js";

const execFileAsync = promisify(execFile);
const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 80_000;

export interface PdfExtractDetails {
  source: string;
  bytes: number;
  chars: number;
  originalChars: number;
  returnedChars: number;
  method: "text" | "pdftotext" | "strings-fallback";
  truncated: boolean;
}

interface PdfExtractParams {
  url?: string;
  path?: string;
  maxBytes?: number;
  maxChars?: number;
}

export function createPdfExtractTool(fetchImpl: typeof fetch = fetch): ToolDefinition {
  return {
    name: "conject_extract_pdf",
    label: "PDF Extract",
    description: "Fetch or read a PDF and extract bounded text for research evidence review.",
    promptSnippet: "conject_extract_pdf extracts bounded text from PDFs when available.",
    promptGuidelines: ["Use PDF extraction only for sources that look directly relevant."],
    parameters: Type.Object({
      url: Type.Optional(Type.String({ description: "PDF URL to fetch." })),
      path: Type.Optional(Type.String({ description: "Local PDF or text path to read." })),
      maxBytes: Type.Optional(Type.Number({ description: "Maximum bytes to read. Default 12 MiB." })),
      maxChars: Type.Optional(Type.Number({ description: "Maximum extracted characters. Default 80000." }))
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const input = params as PdfExtractParams;
      try {
        const maxBytes = boundedNumber(input.maxBytes, DEFAULT_MAX_BYTES, 1024, DEFAULT_MAX_BYTES);
        const maxChars = boundedNumber(input.maxChars, DEFAULT_MAX_CHARS, 1000, 240_000);
        const sourceCount = Number(Boolean(input.url)) + Number(Boolean(input.path));
        if (sourceCount !== 1) throw new Error("Provide exactly one of url or path.");

        const source = input.url ?? input.path ?? "";
        const data = input.url
          ? await fetchBytes(fetchImpl, input.url, maxBytes, signal)
          : await readLocalBytes(ctx.cwd, input.path as string, maxBytes);
        const extracted = await extractText(data, source, maxChars, signal);
        return textResult(extracted.text, extracted.details);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`PDF extraction failed: ${message}`, {
          source: input.url ?? input.path ?? "",
          bytes: 0,
          chars: 0,
          originalChars: 0,
          returnedChars: 0,
          method: "strings-fallback",
          truncated: false
        } satisfies PdfExtractDetails);
      }
    }
  };
}

async function fetchBytes(
  fetchImpl: typeof fetch,
  url: string,
  maxBytes: number,
  signal: AbortSignal | undefined
): Promise<Buffer> {
  const response = await fetchImpl(url, { signal, headers: { accept: "application/pdf,text/plain,*/*" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new Error(`Source is too large (${contentLength} bytes > ${maxBytes}).`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > maxBytes) throw new Error(`Source is too large (${bytes.length} bytes > ${maxBytes}).`);
  return bytes;
}

async function readLocalBytes(cwd: string, rawPath: string, maxBytes: number): Promise<Buffer> {
  const filePath = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
  const data = await readFile(filePath);
  if (data.length > maxBytes) throw new Error(`Source is too large (${data.length} bytes > ${maxBytes}).`);
  return data;
}

async function extractText(
  data: Buffer,
  source: string,
  maxChars: number,
  signal: AbortSignal | undefined
): Promise<{ text: string; details: PdfExtractDetails }> {
  if (!looksLikePdf(data)) {
    const sourceText = data.toString("utf8");
    const formatted = formatExtractedText(sourceText, maxChars);
    return {
      text: formatted.text,
      details: {
        source,
        bytes: data.length,
        chars: formatted.returnedChars,
        originalChars: formatted.originalChars,
        returnedChars: formatted.returnedChars,
        method: "text",
        truncated: formatted.truncated
      }
    };
  }

  const pdftotext = await tryPdftotext(data, signal);
  if (pdftotext !== undefined) {
    const formatted = formatExtractedText(pdftotext.trim(), maxChars);
    return {
      text: formatted.text,
      details: {
        source,
        bytes: data.length,
        chars: formatted.returnedChars,
        originalChars: formatted.originalChars,
        returnedChars: formatted.returnedChars,
        method: "pdftotext",
        truncated: formatted.truncated
      }
    };
  }

  const fallback = extractPrintableStrings(data);
  const formatted = formatExtractedText(fallback, maxChars);
  const text =
    formatted.text.trim() ||
    "No readable text could be extracted. Install the pdftotext command for better PDF extraction.";
  return {
    text,
    details: {
      source,
      bytes: data.length,
      chars: text.length,
      originalChars: formatted.originalChars,
      returnedChars: text.length,
      method: "strings-fallback",
      truncated: formatted.truncated
    }
  };
}

function formatExtractedText(text: string, maxChars: number): { text: string; originalChars: number; returnedChars: number; truncated: boolean } {
  const truncated = text.length > maxChars;
  const returned = truncateText(text, maxChars);
  return {
    text: returned,
    originalChars: text.length,
    returnedChars: returned.length,
    truncated
  };
}

function looksLikePdf(data: Buffer): boolean {
  return data.subarray(0, 5).toString("ascii") === "%PDF-";
}

async function tryPdftotext(data: Buffer, signal: AbortSignal | undefined): Promise<string | undefined> {
  const dir = await mkdtemp(join(tmpdir(), "conject-pdf-"));
  const pdfPath = join(dir, "source.pdf");
  try {
    await writeFile(pdfPath, data);
    const result = await execFileAsync("pdftotext", ["-layout", "-q", pdfPath, "-"], {
      encoding: "utf8",
      maxBuffer: 5 * 1024 * 1024,
      signal
    });
    return result.stdout;
  } catch {
    return undefined;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function extractPrintableStrings(data: Buffer): string {
  const ascii = data.toString("latin1").replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, "\n");
  return ascii
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 24)
    .join("\n");
}

function boundedNumber(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value as number)));
}
