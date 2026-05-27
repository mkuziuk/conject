import { z } from "zod";

export const ResearchPresetSchema = z.enum(["quick", "balanced", "deep"]);

export const ScoreWeightsSchema = z.object({
  impact: z.number(),
  testability: z.number(),
  evidenceStrength: z.number(),
  novelty: z.number(),
  implementationDifficulty: z.number()
});

export const AgentBudgetSchema = z.object({
  maxToolCalls: z.number().int().nonnegative(),
  timeoutMs: z.number().int().positive(),
  maxOutputTokens: z.number().int().positive().optional()
});

export const AgentModelSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  thinking: z.string().optional()
});

export const ConjectConfigSchema = z.object({
  version: z.literal(1),
  research: z.object({
    preset: ResearchPresetSchema,
    ideas: z.number().int().positive(),
    sourcesPerIdea: z.number().int().positive(),
    researcherParallelism: z.number().int().positive(),
    webQueries: z.number().int().nonnegative(),
    webFetches: z.number().int().nonnegative(),
    fetchOpenAccessPdfs: z.boolean()
  }),
  providers: z.object({
    paper: z.object({
      openAlex: z.object({
        enabled: z.boolean(),
        mailto: z.string().email().optional()
      }),
      semanticScholar: z.object({
        enabled: z.boolean(),
        apiKeyEnv: z.string().optional()
      }),
      arxiv: z.object({ enabled: z.boolean() })
    }),
    web: z.object({
      enabled: z.boolean(),
      primary: z.enum(["tavily", "searxng"]).optional(),
      tavily: z.object({
        enabled: z.boolean(),
        apiKeyEnv: z.string()
      }),
      searxng: z.object({
        enabled: z.boolean(),
        baseUrl: z.string().url().optional()
      })
    })
  }),
  runtime: z.object({
    default: z.enum(["mock", "pi"]),
    pi: z.object({
      useSdk: z.boolean(),
      agentDir: z.string().optional()
    })
  }),
  models: z.object({
    default: AgentModelSchema,
    agents: z.record(AgentModelSchema).default({})
  }),
  scoring: ScoreWeightsSchema,
  budgets: z.record(AgentBudgetSchema)
});

export type ConjectConfig = z.infer<typeof ConjectConfigSchema>;
export type ScoreWeights = z.infer<typeof ScoreWeightsSchema>;

export const defaultConfig: ConjectConfig = {
  version: 1,
  research: {
    preset: "balanced",
    ideas: 5,
    sourcesPerIdea: 3,
    researcherParallelism: 2,
    webQueries: 3,
    webFetches: 5,
    fetchOpenAccessPdfs: true
  },
  providers: {
    paper: {
      openAlex: { enabled: true, mailto: undefined },
      semanticScholar: { enabled: true, apiKeyEnv: "SEMANTIC_SCHOLAR_API_KEY" },
      arxiv: { enabled: true }
    },
    web: {
      enabled: true,
      primary: "tavily",
      tavily: {
        enabled: true,
        apiKeyEnv: "TAVILY_API_KEY"
      },
      searxng: {
        enabled: false,
        baseUrl: undefined
      }
    }
  },
  runtime: {
    default: "mock",
    pi: {
      useSdk: true,
      agentDir: ".conject/pi"
    }
  },
  models: {
    default: {},
    agents: {}
  },
  scoring: {
    impact: 0.25,
    testability: 0.25,
    evidenceStrength: 0.2,
    novelty: 0.15,
    implementationDifficulty: -0.15
  },
  budgets: {
    strategist: { maxToolCalls: 0, timeoutMs: 120000, maxOutputTokens: 4000 },
    researcher: { maxToolCalls: 20, timeoutMs: 300000, maxOutputTokens: 8000 },
    reviewer: { maxToolCalls: 5, timeoutMs: 180000, maxOutputTokens: 6000 },
    builder: { maxToolCalls: 30, timeoutMs: 300000, maxOutputTokens: 8000 }
  }
};

export function configForPreset(preset: "quick" | "balanced" | "deep"): ConjectConfig {
  const next = structuredClone(defaultConfig);
  next.research.preset = preset;
  if (preset === "quick") {
    next.research.ideas = 3;
    next.research.sourcesPerIdea = 2;
    next.research.webQueries = 2;
    next.research.webFetches = 3;
  }
  if (preset === "deep") {
    next.research.ideas = 8;
    next.research.sourcesPerIdea = 5;
    next.research.webQueries = 6;
    next.research.webFetches = 10;
  }
  return next;
}
