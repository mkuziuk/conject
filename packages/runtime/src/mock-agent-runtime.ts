import type { EvidenceBundle, HypothesisCard, Idea, ResearchObjective, SourceRecord } from "@conject/artifacts";
import { createReadableId } from "@conject/artifacts";
import { computeFinalScore, sortHypotheses } from "@conject/ranking";
import type { AgentRuntime, RunAgentJobInput, RunAgentJobResult } from "./types.js";

export class MockAgentRuntime implements AgentRuntime {
  async runAgentJob(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    if (input.agentId === "strategist") return this.runStrategist(input);
    if (input.agentId === "researcher") return this.runResearcher(input);
    if (input.agentId === "reviewer") return this.runReviewer(input);
    if (input.agentId === "builder") return this.runBuilder(input);
    throw new Error(`Unsupported mock agent: ${input.agentId}`);
  }

  private async runStrategist(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    const objective: ResearchObjective = {
      id: "OBJ-001",
      title: summarizeTitle(input.prompt),
      rawPrompt: input.prompt,
      normalizedPrompt: input.prompt.trim(),
      domain: inferDomain(input.prompt),
      constraints: ["Prefer implementable ideas", "Prefer testable hypotheses"],
      successCriteria: ["Produces ranked hypotheses", "Includes minimal experiments"]
    };

    const ideas: Idea[] = Array.from({ length: input.config.research.ideas }, (_, index) => {
      const id = createReadableId("IDEA", index + 1);
      return {
        id,
        title: `${ideaTheme(index)} for ${objective.title}`,
        summary: `Investigate whether ${ideaTheme(index).toLowerCase()} can improve the target research problem.`,
        rationale: "The idea is narrow enough for a small experiment while still being grounded in the prompt.",
        expectedValue: "A plausible implementation path and measurable comparison against a baseline.",
        possibleRisks: ["Evidence may be sparse", "The method may be hard to benchmark cleanly"],
        searchQueries: [
          `${objective.normalizedPrompt} ${ideaTheme(index)} paper`,
          `${objective.normalizedPrompt} benchmark method`
        ]
      };
    });

    return {
      outputArtifacts: [
        { type: "research_objective", json: objective },
        ...ideas.map((idea) => ({ type: "idea" as const, json: idea, parentIds: [objective.id] }))
      ],
      rawText: JSON.stringify({ objective, ideas }, null, 2)
    };
  }

  private async runResearcher(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    const ideaArtifact = input.inputArtifacts.find((artifact) => artifact.type === "idea");
    if (!ideaArtifact) throw new Error("Researcher requires one Idea artifact.");
    const idea = ideaArtifact.json as Idea;
    const sources: SourceRecord[] = Array.from({ length: input.config.research.sourcesPerIdea }, (_, index) => ({
      id: `${idea.id}-SRC-${String(index + 1).padStart(3, "0")}`,
      title: `${idea.title}: mock source ${index + 1}`,
      url: `https://example.org/${idea.id.toLowerCase()}/source-${index + 1}`,
      year: 2024 - index,
      sourceType: "paper",
      provider: "mock",
      authors: ["Conject Fixture"],
      abstract: `Mock abstract describing evidence for ${idea.title}.`,
      qualityNotes: "Deterministic fixture source for offline tests."
    }));

    const claims = sources.map((source, index) => ({
      id: `${idea.id}-CLM-${String(index + 1).padStart(3, "0")}`,
      sourceId: source.id,
      ideaId: idea.id,
      text: `Mock claim ${index + 1} supports testing ${idea.title}.`,
      support: "supports" as const,
      confidence: Math.max(3, 5 - index)
    }));

    const bundle: EvidenceBundle = {
      ideaId: idea.id,
      sources,
      claims,
      contradictions: [],
      openQuestions: ["Would the effect remain under a stronger baseline?"],
      researchNotes: `Mock evidence bundle for ${idea.id}; replace with paper/web tools in real runtime.`
    };

    return {
      outputArtifacts: [{ type: "evidence_bundle", json: bundle, parentIds: [ideaArtifact.id] }],
      rawText: JSON.stringify(bundle, null, 2)
    };
  }

  private async runReviewer(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    const ideas = input.inputArtifacts.filter((artifact) => artifact.type === "idea").map((artifact) => artifact.json as Idea);
    const bundles = input.inputArtifacts
      .filter((artifact) => artifact.type === "evidence_bundle")
      .map((artifact) => artifact.json as EvidenceBundle);

    const cards: HypothesisCard[] = ideas.map((idea, index) => {
      const bundle = bundles.find((candidate) => candidate.ideaId === idea.id);
      const difficulty = Math.min(5, 2 + (index % 4));
      const base = {
        id: createReadableId("HYP", index + 1),
        ideaId: idea.id,
        title: `Hypothesis: ${idea.title}`,
        hypothesis: `${idea.title} will improve at least one measurable outcome against a straightforward baseline.`,
        mechanism: "The proposed mechanism is narrowed into a minimal experiment with observable success/failure criteria.",
        whyItMightWork: idea.rationale,
        evidenceSummary: bundle
          ? `${bundle.claims.length} supporting mock claims across ${bundle.sources.length} sources.`
          : "No evidence bundle was available.",
        keySources: bundle?.sources.map((source) => source.id) ?? [],
        mainRisks: idea.possibleRisks,
        falsificationTest: "Run the minimal experiment and reject if performance does not beat the baseline under identical data splits.",
        minimalExperiment: `Implement a small benchmark for ${idea.id} and compare against a baseline.`,
        noveltyScore: clampScore(4 - (index % 2)),
        evidenceStrengthScore: clampScore(bundle ? Math.min(5, 2 + bundle.sources.length) : 1),
        testabilityScore: clampScore(5 - (index % 3)),
        impactScore: clampScore(4 + (index === 0 ? 1 : 0)),
        implementationDifficultyScore: clampScore(difficulty),
        finalScore: 0,
        recommendation: "promising" as const,
        reviewerExplanation: "Mock reviewer explanation generated from fixture evidence and configured weights."
      };
      const finalScore = computeFinalScore(base, input.config.scoring);
      return {
        ...base,
        finalScore,
        recommendation: finalScore >= 3.6 ? "strong" : finalScore >= 2.8 ? "promising" : "weak"
      };
    });

    const sorted = sortHypotheses(cards);
    const ranking = {
      id: "RANK-001",
      runId: input.runId,
      items: sorted.map((card, index) => ({
        hypothesisId: card.id,
        rank: index + 1,
        finalScore: card.finalScore,
        recommendation: card.recommendation,
        explanation: card.reviewerExplanation ?? "Ranked by configured weighted score."
      })),
      partial: bundles.length < ideas.length,
      warnings: bundles.length < ideas.length ? ["One or more ideas did not produce evidence bundles."] : [],
      scoringWeights: input.config.scoring
    };

    return {
      outputArtifacts: [
        ...cards.map((card) => ({ type: "hypothesis_card" as const, json: card })),
        { type: "ranking", json: ranking }
      ],
      rawText: JSON.stringify({ hypothesisCards: cards, ranking }, null, 2)
    };
  }

  private async runBuilder(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    const hypothesis = input.inputArtifacts.find((artifact) => artifact.type === "hypothesis_card")?.json as HypothesisCard | undefined;
    if (!hypothesis) throw new Error("Builder requires one HypothesisCard artifact.");
    return {
      outputArtifacts: [
        {
          type: "implementation_pack",
          json: {
            hypothesisId: hypothesis.id,
            planMarkdownPath: `implementations/${input.runId}/${hypothesis.id}/PLAN.md`,
            generatedFiles: [
              `implementations/${input.runId}/${hypothesis.id}/README.md`,
              `implementations/${input.runId}/${hypothesis.id}/pyproject.toml`,
              `implementations/${input.runId}/${hypothesis.id}/src/experiment.py`,
              `implementations/${input.runId}/${hypothesis.id}/tests/test_smoke.py`
            ],
            runCommands: ["uv sync", "uv run pytest"],
            validationChecklist: ["Smoke test passes", "Baseline comparison is implemented", "Results are documented"]
          }
        }
      ],
      rawText: `Mock implementation pack for ${hypothesis.id}`
    };
  }
}

function summarizeTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\s+/g, " ");
  return trimmed.length <= 72 ? trimmed : `${trimmed.slice(0, 69)}...`;
}

function inferDomain(prompt: string): string | undefined {
  if (/hyperspectral|unmixing|imf/i.test(prompt)) return "hyperspectral unmixing";
  if (/biology|medical|clinical/i.test(prompt)) return "biomedical research";
  return undefined;
}

function ideaTheme(index: number): string {
  const themes = [
    "Robust objective variant",
    "Uncertainty-aware scoring",
    "Lightweight benchmark protocol",
    "Hybrid prior injection",
    "Failure-mode detector",
    "Ablation-driven simplification",
    "Synthetic-data stress test",
    "Adaptive regularization"
  ];
  return themes[index % themes.length]!;
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(5, value));
}
