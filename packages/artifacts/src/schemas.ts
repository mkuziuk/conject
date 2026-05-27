import { z } from "zod";

export const ArtifactTypeSchema = z.enum([
  "research_objective",
  "idea",
  "source_record",
  "claim",
  "evidence_bundle",
  "hypothesis_card",
  "ranking",
  "implementation_pack",
  "review",
  "config_snapshot"
]);

export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

export const ScoreSchema = z.number().min(1).max(5);

export const ResearchObjectiveSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  rawPrompt: z.string().min(1),
  normalizedPrompt: z.string().min(1),
  domain: z.string().optional(),
  constraints: z.array(z.string()).default([]),
  successCriteria: z.array(z.string()).default([])
});

export const IdeaSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  summary: z.string().min(1),
  rationale: z.string().min(1),
  expectedValue: z.string().min(1),
  possibleRisks: z.array(z.string()).default([]),
  searchQueries: z.array(z.string()).min(1)
});

export const SourceRecordSchema = z.object({
  id: z.string(),
  title: z.string().min(1),
  url: z.string().url().optional(),
  doi: z.string().optional(),
  venue: z.string().optional(),
  year: z.number().int().min(1800).max(2200).optional(),
  sourceType: z.enum(["paper", "web", "pdf", "manual"]),
  provider: z.string().optional(),
  authors: z.array(z.string()).default([]),
  abstract: z.string().optional(),
  extractedTextPath: z.string().optional(),
  qualityNotes: z.string().optional()
});

export const ClaimSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  ideaId: z.string(),
  text: z.string().min(1),
  support: z.enum(["supports", "contradicts", "context", "unknown"]),
  confidence: ScoreSchema,
  quote: z.string().optional(),
  location: z.string().optional()
});

export const EvidenceBundleSchema = z.object({
  ideaId: z.string(),
  sources: z.array(SourceRecordSchema),
  claims: z.array(ClaimSchema),
  contradictions: z.array(ClaimSchema).default([]),
  openQuestions: z.array(z.string()).default([]),
  researchNotes: z.string()
});

export const RecommendationSchema = z.enum(["strong", "promising", "weak", "reject"]);

export const HypothesisCardSchema = z.object({
  id: z.string(),
  ideaId: z.string(),
  title: z.string().min(1),
  hypothesis: z.string().min(1),
  mechanism: z.string().min(1),
  whyItMightWork: z.string().min(1),
  evidenceSummary: z.string().min(1),
  keySources: z.array(z.string()),
  mainRisks: z.array(z.string()),
  falsificationTest: z.string().min(1),
  minimalExperiment: z.string().min(1),
  noveltyScore: ScoreSchema,
  evidenceStrengthScore: ScoreSchema,
  testabilityScore: ScoreSchema,
  impactScore: ScoreSchema,
  implementationDifficultyScore: ScoreSchema,
  finalScore: z.number(),
  recommendation: RecommendationSchema,
  reviewerExplanation: z.string().optional()
});

export const RankingItemSchema = z.object({
  hypothesisId: z.string(),
  rank: z.number().int().positive(),
  finalScore: z.number(),
  recommendation: RecommendationSchema,
  explanation: z.string()
});

export const RankingSchema = z.object({
  id: z.string(),
  runId: z.string(),
  items: z.array(RankingItemSchema),
  partial: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  scoringWeights: z.record(z.number())
});

export const ImplementationFileSchema = z.object({
  path: z.string().min(1),
  content: z.string(),
  executable: z.boolean().optional()
});

export const ImplementationPackSchema = z.object({
  hypothesisId: z.string(),
  planMarkdownPath: z.string(),
  generatedFiles: z.array(z.string()),
  runCommands: z.array(z.string()),
  validationChecklist: z.array(z.string()),
  files: z.array(ImplementationFileSchema).optional()
});

export const ArtifactJsonSchema = z.union([
  ResearchObjectiveSchema,
  IdeaSchema,
  SourceRecordSchema,
  ClaimSchema,
  EvidenceBundleSchema,
  HypothesisCardSchema,
  RankingSchema,
  ImplementationPackSchema,
  z.record(z.unknown())
]);

export const ArtifactSchema = z.object({
  id: z.string(),
  runId: z.string(),
  type: ArtifactTypeSchema,
  parentIds: z.array(z.string()).default([]),
  createdByJobId: z.string().nullable().optional(),
  json: ArtifactJsonSchema,
  createdAt: z.string()
});

export const RunStatusSchema = z.enum(["created", "running", "succeeded", "failed", "cancelled"]);

export const RunSchema = z.object({
  id: z.string(),
  title: z.string(),
  rawPrompt: z.string(),
  status: RunStatusSchema,
  createdAt: z.string(),
  updatedAt: z.string()
});

export const JobStatusSchema = z.enum(["pending", "running", "succeeded", "failed", "cancelled"]);

export const JobSchema = z.object({
  id: z.string(),
  runId: z.string(),
  agentId: z.enum(["strategist", "researcher", "reviewer", "builder"]),
  status: JobStatusSchema,
  inputArtifactIds: z.array(z.string()).default([]),
  outputArtifactIds: z.array(z.string()).default([]),
  error: z.string().nullable().optional(),
  createdAt: z.string(),
  startedAt: z.string().nullable().optional(),
  finishedAt: z.string().nullable().optional()
});

export const EventSchema = z.object({
  id: z.string(),
  runId: z.string(),
  jobId: z.string().nullable().optional(),
  type: z.string(),
  payload: z.record(z.unknown()).default({}),
  createdAt: z.string()
});

export type ResearchObjective = z.infer<typeof ResearchObjectiveSchema>;
export type Idea = z.infer<typeof IdeaSchema>;
export type SourceRecord = z.infer<typeof SourceRecordSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
export type HypothesisCard = z.infer<typeof HypothesisCardSchema>;
export type Ranking = z.infer<typeof RankingSchema>;
export type ImplementationFile = z.infer<typeof ImplementationFileSchema>;
export type ImplementationPack = z.infer<typeof ImplementationPackSchema>;
export type Artifact = z.infer<typeof ArtifactSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Job = z.infer<typeof JobSchema>;
export type Event = z.infer<typeof EventSchema>;
