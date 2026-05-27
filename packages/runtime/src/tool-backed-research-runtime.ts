import type { EvidenceBundle, Idea, ResearchObjective, SourceRecord } from "@conject/artifacts";
import {
  ArxivPaperSearchProvider,
  OpenAlexPaperSearchProvider,
  SearxngWebSearchProvider,
  SemanticScholarPaperSearchProvider,
  TavilyWebSearchProvider,
  type PaperSearchProvider,
  type WebSearchProvider
} from "@conject/tools";
import { MockAgentRuntime } from "./mock-agent-runtime.js";
import { buildEvidenceNotes, enrichSourceQualityNotes, extractClaimsFromSources } from "./evidence-extraction.js";
import type { AgentRuntime, RunAgentJobInput, RunAgentJobResult } from "./types.js";

export type ToolBackedResearchRuntimeOptions = {
  delegate?: AgentRuntime;
  paperProviders?: PaperSearchProvider[];
  webProviders?: WebSearchProvider[];
  env?: NodeJS.ProcessEnv;
};

export class ToolBackedResearchRuntime implements AgentRuntime {
  private readonly delegate: AgentRuntime;
  private readonly paperProviders?: PaperSearchProvider[];
  private readonly webProviders?: WebSearchProvider[];
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: ToolBackedResearchRuntimeOptions = {}) {
    this.delegate = options.delegate ?? new MockAgentRuntime();
    this.paperProviders = options.paperProviders;
    this.webProviders = options.webProviders;
    this.env = options.env ?? process.env;
  }

  async runAgentJob(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    if (input.agentId !== "researcher") return this.delegate.runAgentJob(input);
    return this.runResearcher(input);
  }

  private async runResearcher(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    const ideaArtifact = input.inputArtifacts.find((artifact) => artifact.type === "idea");
    const objectiveArtifact = input.inputArtifacts.find((artifact) => artifact.type === "research_objective");
    if (!ideaArtifact) throw new Error("Tool-backed Researcher requires one Idea artifact.");

    const idea = ideaArtifact.json as Idea;
    const objective = objectiveArtifact?.json as ResearchObjective | undefined;
    const queries = idea.searchQueries.length ? idea.searchQueries : [idea.title];
    const sources: SourceRecord[] = [];
    const notes: string[] = [];
    const webProviders = this.webProviders ?? createWebProviders(input, this.env);
    const canUseWeb =
      input.config.providers.web.enabled && webProviders.length > 0 && input.config.research.webQueries > 0 && input.config.research.webFetches > 0;
    const paperLimit = canUseWeb ? Math.max(1, input.config.research.sourcesPerIdea - 1) : input.config.research.sourcesPerIdea;

    const paperProviders = this.paperProviders ?? createPaperProviders(input, this.env);
    if (paperProviders.length > 0) {
      const paperSources = await this.searchPaperProviders(input, paperProviders, queries[0]!, paperLimit);
      sources.push(...paperSources);
      notes.push(`Paper search returned ${paperSources.length} source(s).`);
    } else {
      notes.push("No paper providers were enabled.");
    }

    const remaining = Math.max(0, input.config.research.sourcesPerIdea - sources.length);
    if (canUseWeb) {
      const webLimit = Math.min(input.config.research.webFetches, Math.max(1, remaining));
      const webSources = await this.searchWebProviders(input, webProviders, queries.slice(0, input.config.research.webQueries), webLimit, idea.id);
      sources.push(...webSources);
      notes.push(`Web search returned ${webSources.length} source(s).`);
    } else if (input.config.providers.web.enabled) {
      notes.push("Web search was enabled but no configured web provider was available.");
    }

    const selectedSources = dedupeSources(sources)
      .slice(0, input.config.research.sourcesPerIdea)
      .map((source) => enrichSourceQualityNotes(source));
    const claims = extractClaimsFromSources({ idea, objective, sources: selectedSources });

    const bundle: EvidenceBundle = {
      ideaId: idea.id,
      sources: selectedSources,
      claims,
      contradictions: [],
      openQuestions: [
        "Does this evidence transfer to the exact benchmark and constraints in the objective?",
        "Are there stronger baselines that would reduce the expected value?"
      ],
      researchNotes: [
        `Tool-backed research for ${idea.id}${objective ? ` under objective ${objective.id}` : ""}.`,
        ...notes,
        ...buildEvidenceNotes({ sources: selectedSources, claims })
      ].join("\n")
    };

    return {
      outputArtifacts: [{ type: "evidence_bundle", json: bundle, parentIds: [ideaArtifact.id] }],
      rawText: JSON.stringify(bundle, null, 2)
    };
  }

  private async searchPaperProviders(
    input: RunAgentJobInput,
    providers: PaperSearchProvider[],
    query: string,
    limit: number
  ): Promise<SourceRecord[]> {
    const output: SourceRecord[] = [];
    const seen = new Set<string>();
    for (const provider of providers) {
      const remaining = limit - output.length;
      if (remaining <= 0) break;
      const results = await this.loggedToolCall(input, `paper_search.${provider.id}`, { provider: provider.id, query, limit: remaining }, () =>
        provider.search({ query, limit: remaining })
      );
      for (const result of results) {
        const key = result.doi ?? result.url ?? result.title.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(result);
        if (output.length >= limit) break;
      }
    }
    return output;
  }

  private async searchWebProviders(
    input: RunAgentJobInput,
    providers: WebSearchProvider[],
    queries: string[],
    limit: number,
    ideaId: string
  ): Promise<SourceRecord[]> {
    const output: SourceRecord[] = [];
    const seen = new Set<string>();
    for (const query of queries) {
      for (const provider of providers) {
        const remaining = limit - output.length;
        if (remaining <= 0) return output;
        const results = await this.loggedToolCall(input, `web_search.${provider.id}`, { provider: provider.id, query, limit: remaining }, () =>
          provider.search({ query, limit: remaining })
        );
        for (const result of results) {
          if (seen.has(result.url)) continue;
          seen.add(result.url);
          output.push({
            id: `${ideaId}-WEB-${String(output.length + 1).padStart(3, "0")}`,
            title: result.title,
            url: result.url,
            sourceType: "web",
            provider: result.provider,
            authors: [],
            abstract: result.snippet,
            qualityNotes: `Imported from ${result.provider} web search.`
          });
          if (output.length >= limit) return output;
        }
      }
    }
    return output;
  }

  private async loggedToolCall<T>(
    input: RunAgentJobInput,
    toolName: string,
    toolInput: unknown,
    execute: () => Promise<T[]>
  ): Promise<T[]> {
    const startedAt = new Date().toISOString();
    try {
      const result = await execute();
      await input.logToolCall?.({
        toolName,
        input: toolInput,
        output: { resultCount: result.length },
        status: "succeeded",
        startedAt,
        finishedAt: new Date().toISOString()
      });
      return result;
    } catch (error) {
      await input.logToolCall?.({
        toolName,
        input: toolInput,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        startedAt,
        finishedAt: new Date().toISOString()
      });
      return [];
    }
  }
}

function createPaperProviders(input: RunAgentJobInput, env: NodeJS.ProcessEnv): PaperSearchProvider[] {
  const providers: PaperSearchProvider[] = [];
  if (input.config.providers.paper.openAlex.enabled) {
    providers.push(new OpenAlexPaperSearchProvider({ mailto: input.config.providers.paper.openAlex.mailto }));
  }
  if (input.config.providers.paper.semanticScholar.enabled) {
    const keyEnv = input.config.providers.paper.semanticScholar.apiKeyEnv;
    providers.push(new SemanticScholarPaperSearchProvider({ apiKey: keyEnv ? env[keyEnv] : undefined }));
  }
  if (input.config.providers.paper.arxiv.enabled) {
    providers.push(new ArxivPaperSearchProvider());
  }
  return providers;
}

function createWebProviders(input: RunAgentJobInput, env: NodeJS.ProcessEnv): WebSearchProvider[] {
  if (!input.config.providers.web.enabled) return [];
  const providers: WebSearchProvider[] = [];
  if (input.config.providers.web.tavily.enabled) {
    const apiKey = env[input.config.providers.web.tavily.apiKeyEnv];
    if (apiKey) providers.push(new TavilyWebSearchProvider({ apiKey }));
  }
  if (input.config.providers.web.searxng.enabled && input.config.providers.web.searxng.baseUrl) {
    providers.push(new SearxngWebSearchProvider({ baseUrl: input.config.providers.web.searxng.baseUrl }));
  }
  return providers;
}

function dedupeSources(sources: SourceRecord[]): SourceRecord[] {
  const seen = new Set<string>();
  const output: SourceRecord[] = [];
  for (const source of sources) {
    const key = source.doi ?? source.url ?? source.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(source);
  }
  return output;
}
