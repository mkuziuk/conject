import type { EvidenceBundle, HypothesisCard, Idea, ResearchObjective } from "../../packages/artifacts/src/index.js";

export const objectiveFixture: ResearchObjective = {
  id: "OBJ-001",
  title: "Robust IMF for hyperspectral unmixing",
  rawPrompt: "Find implementable ideas for robust IMF in hyperspectral unmixing",
  normalizedPrompt: "Find implementable ideas for robust IMF in hyperspectral unmixing",
  domain: "hyperspectral unmixing",
  constraints: ["implementable"],
  successCriteria: ["ranked hypotheses"]
};

export const ideaFixture: Idea = {
  id: "IDEA-001",
  title: "Robust objective variant",
  summary: "Test a robust objective for IMF.",
  rationale: "The change is small and benchmarkable.",
  expectedValue: "Improved robustness against noise.",
  possibleRisks: ["May not beat baseline"],
  searchQueries: ["robust IMF hyperspectral unmixing"]
};

export const evidenceBundleFixture: EvidenceBundle = {
  ideaId: ideaFixture.id,
  sources: [
    {
      id: "SRC-001",
      title: "Mock source",
      url: "https://example.org/source",
      year: 2024,
      sourceType: "paper",
      provider: "mock",
      authors: ["Fixture Author"],
      abstract: "A mock abstract.",
      qualityNotes: "Fixture only."
    }
  ],
  claims: [
    {
      id: "CLM-001",
      sourceId: "SRC-001",
      ideaId: ideaFixture.id,
      text: "Robust objectives can improve noisy settings.",
      support: "supports",
      confidence: 4
    }
  ],
  contradictions: [],
  openQuestions: [],
  researchNotes: "Mock notes."
};

export const hypothesisFixture: HypothesisCard = {
  id: "HYP-001",
  ideaId: ideaFixture.id,
  title: "Hypothesis: robust objective variant",
  hypothesis: "A robust objective improves unmixing under noise.",
  mechanism: "Downweights outlier residuals.",
  whyItMightWork: "Noise robustness is directly targeted.",
  evidenceSummary: "One source supports the direction.",
  keySources: ["SRC-001"],
  mainRisks: ["May underfit"],
  falsificationTest: "Reject if it fails against baseline.",
  minimalExperiment: "Compare baseline and robust objective on synthetic mixtures.",
  noveltyScore: 3,
  evidenceStrengthScore: 3,
  testabilityScore: 5,
  impactScore: 4,
  implementationDifficultyScore: 2,
  finalScore: 3,
  recommendation: "strong",
  reviewerExplanation: "Fixture explanation."
};
