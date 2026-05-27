import type { Claim, Idea, ResearchObjective, SourceRecord } from "@conject/artifacts";

export type SourceText = {
  sourceId: string;
  title: string;
  text: string;
  provider?: string;
  sourceType: SourceRecord["sourceType"];
  url?: string;
  year?: number;
};

export function normalizeSourceText(source: SourceRecord): SourceText {
  return {
    sourceId: source.id,
    title: source.title,
    text: normalizeWhitespace(source.abstract ?? source.title),
    provider: source.provider,
    sourceType: source.sourceType,
    url: source.url,
    year: source.year
  };
}

export function enrichSourceQualityNotes(source: SourceRecord, nowYear = new Date().getUTCFullYear()): SourceRecord {
  const notes = [
    source.qualityNotes,
    source.sourceType === "paper" ? "paper source" : `${source.sourceType} source`,
    source.doi ? "has DOI" : "no DOI",
    source.abstract ? "has abstract/snippet text" : "title-only evidence",
    recencyNote(source.year, nowYear),
    source.provider ? `provider: ${source.provider}` : undefined
  ].filter((note): note is string => Boolean(note));
  return {
    ...source,
    qualityNotes: dedupeStrings(notes).join("; ")
  };
}

export function extractClaimsFromSources(input: {
  idea: Idea;
  objective?: ResearchObjective;
  sources: SourceRecord[];
}): Claim[] {
  const objectiveText = input.objective
    ? [input.objective.title, input.objective.normalizedPrompt, ...input.objective.constraints, ...input.objective.successCriteria].join(" ")
    : "";
  const keywords = buildKeywords([input.idea.title, input.idea.summary, input.idea.rationale, input.idea.expectedValue, objectiveText].join(" "));
  const claims: Claim[] = [];

  input.sources.forEach((source, sourceIndex) => {
    const sourceText = normalizeSourceText(source);
    const sentences = splitSentences(sourceText.text);
    const ranked = sentences
      .map((sentence) => ({
        sentence,
        overlap: keywordOverlap(sentence, keywords),
        support: classifySupport(sentence, input.idea, keywords)
      }))
      .sort((a, b) => b.overlap - a.overlap || supportRank(b.support) - supportRank(a.support));

    const selected = ranked[0] ?? {
      sentence: `${source.title} appears relevant to ${input.idea.title}.`,
      overlap: 0,
      support: "context" as Claim["support"]
    };

    claims.push({
      id: `${input.idea.id}-CLM-${String(sourceIndex + 1).padStart(3, "0")}`,
      sourceId: source.id,
      ideaId: input.idea.id,
      text: truncateClaim(selected.sentence),
      support: selected.support,
      confidence: confidenceFor(source, selected.overlap, selected.support),
      quote: selected.sentence,
      location: sourceText.sourceType === "paper" ? "abstract" : "snippet"
    });
  });

  return claims;
}

export function buildEvidenceNotes(input: {
  sources: SourceRecord[];
  claims: Claim[];
}): string[] {
  const papers = input.sources.filter((source) => source.sourceType === "paper").length;
  const web = input.sources.filter((source) => source.sourceType === "web").length;
  const withDoi = input.sources.filter((source) => source.doi).length;
  const withText = input.sources.filter((source) => source.abstract).length;
  const supporting = input.claims.filter((claim) => claim.support === "supports").length;
  const contradicting = input.claims.filter((claim) => claim.support === "contradicts").length;
  const contextual = input.claims.length - supporting - contradicting;
  return [
    `Evidence mix: ${papers} paper source(s), ${web} web source(s).`,
    `Source quality: ${withDoi} DOI-backed source(s), ${withText} source(s) with abstract/snippet text.`,
    `Claim extraction: ${supporting} supporting claim(s), ${contradicting} contradicting claim(s), ${contextual} contextual/unknown claim(s).`
  ];
}

function buildKeywords(text: string): Set<string> {
  const stop = new Set([
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "into",
    "from",
    "will",
    "can",
    "using",
    "based",
    "idea",
    "research",
    "objective",
    "variant",
    "method"
  ]);
  return new Set(
    normalizeWhitespace(text)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 4 && !stop.has(token))
  );
}

function splitSentences(text: string): string[] {
  return normalizeWhitespace(text)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20)
    .slice(0, 8);
}

function keywordOverlap(sentence: string, keywords: Set<string>): number {
  if (keywords.size === 0) return 0;
  const tokens = new Set(
    sentence
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
  );
  let overlap = 0;
  for (const keyword of keywords) {
    if (tokens.has(keyword)) overlap += 1;
  }
  return overlap;
}

function classifySupport(sentence: string, idea: Idea, keywords: Set<string>): Claim["support"] {
  const lower = sentence.toLowerCase();
  const positiveMarkers = [
    "improve",
    "improves",
    "improved",
    "robust",
    "effective",
    "outperform",
    "outperforms",
    "accurate",
    "promising",
    "reduce",
    "reduces"
  ];
  const negativeMarkers = ["fails", "failed", "worse", "limitation", "limitations", "degrade", "degrades"];
  if (negativeMarkers.some((marker) => lower.includes(marker))) return "contradicts";
  const overlap = keywordOverlap(`${idea.title} ${sentence}`, keywords);
  if (overlap >= 2 && positiveMarkers.some((marker) => lower.includes(marker))) return "supports";
  if (overlap >= 1) return "context";
  return "unknown";
}

function confidenceFor(source: SourceRecord, overlap: number, support: Claim["support"]): number {
  let score = source.sourceType === "paper" ? 3 : 2;
  if (source.doi) score += 1;
  if (source.abstract) score += 1;
  if (overlap >= 2) score += 1;
  if (support === "unknown") score -= 1;
  if (support === "contradicts") score -= 1;
  return Math.max(1, Math.min(5, score));
}

function supportRank(support: Claim["support"]): number {
  if (support === "supports") return 3;
  if (support === "context") return 2;
  if (support === "contradicts") return 1;
  return 0;
}

function recencyNote(year: number | undefined, nowYear: number): string | undefined {
  if (!year) return "unknown publication year";
  if (year >= nowYear - 2) return "recent source";
  if (year >= nowYear - 8) return "moderately recent source";
  return "older source";
}

function truncateClaim(text: string): string {
  const normalized = normalizeWhitespace(text);
  return normalized.length <= 320 ? normalized : `${normalized.slice(0, 317)}...`;
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}
