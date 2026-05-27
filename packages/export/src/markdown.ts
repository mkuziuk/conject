import type { EvidenceBundle, HypothesisCard, Idea, Ranking, ResearchObjective } from "@conject/artifacts";
import type { ConjectRepository } from "@conject/storage";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function exportRunMarkdown(repo: ConjectRepository, cwd: string, runId: string): Promise<string> {
  const outDir = join(cwd, "exports", runId);
  mkdirSync(join(outDir, "hypotheses"), { recursive: true });

  const objective = (await repo.listArtifacts(runId, "research_objective"))[0]?.json as ResearchObjective | undefined;
  const ideas = (await repo.listArtifacts(runId, "idea")).map((artifact) => artifact.json as Idea);
  const bundles = (await repo.listArtifacts(runId, "evidence_bundle")).map((artifact) => artifact.json as EvidenceBundle);
  const cards = (await repo.listArtifacts(runId, "hypothesis_card")).map((artifact) => artifact.json as HypothesisCard);
  const ranking = (await repo.listArtifacts(runId, "ranking"))[0]?.json as Ranking | undefined;

  if (objective) {
    writeFileSync(join(outDir, "objective.md"), `# ${objective.title}\n\n${objective.normalizedPrompt}\n`, "utf8");
  }
  writeFileSync(join(outDir, "ideas.md"), renderIdeas(ideas), "utf8");
  writeFileSync(join(outDir, "evidence.md"), renderEvidence(bundles), "utf8");
  if (ranking) writeFileSync(join(outDir, "ranking.md"), renderRanking(ranking), "utf8");
  for (const card of cards) {
    writeFileSync(join(outDir, "hypotheses", `${card.id}.md`), renderHypothesis(card), "utf8");
  }
  return outDir;
}

function renderIdeas(ideas: Idea[]): string {
  return ["# Ideas", "", ...ideas.map((idea) => `## ${idea.id}: ${idea.title}\n\n${idea.summary}\n\n${idea.rationale}`)].join("\n");
}

function renderEvidence(bundles: EvidenceBundle[]): string {
  const sections = bundles.map((bundle) => {
    const sources = bundle.sources.map((source) => `- ${source.id}: ${source.title}`).join("\n");
    const claims = bundle.claims.map((claim) => `- ${claim.text} (${claim.support}, confidence ${claim.confidence})`).join("\n");
    return `## ${bundle.ideaId}\n\n### Sources\n${sources}\n\n### Claims\n${claims}\n\n${bundle.researchNotes}`;
  });
  return ["# Evidence", "", ...sections].join("\n");
}

function renderRanking(ranking: Ranking): string {
  const warnings = ranking.warnings.length ? `\n\n## Warnings\n${ranking.warnings.map((warning) => `- ${warning}`).join("\n")}` : "";
  const items = ranking.items
    .map((item) => `${item.rank}. ${item.hypothesisId} - ${item.finalScore} (${item.recommendation})\n\n${item.explanation}`)
    .join("\n\n");
  return `# Ranking\n\nPartial: ${ranking.partial ? "yes" : "no"}\n\n${items}${warnings}\n`;
}

function renderHypothesis(card: HypothesisCard): string {
  return `# ${card.title}

## Hypothesis
${card.hypothesis}

## Mechanism
${card.mechanism}

## Why it might work
${card.whyItMightWork}

## Evidence
${card.evidenceSummary}

## Risks
${card.mainRisks.map((risk) => `- ${risk}`).join("\n")}

## Minimal experiment
${card.minimalExperiment}

## Scores
- Novelty: ${card.noveltyScore}
- Evidence strength: ${card.evidenceStrengthScore}
- Testability: ${card.testabilityScore}
- Impact: ${card.impactScore}
- Implementation difficulty: ${card.implementationDifficultyScore}
- Final: ${card.finalScore}

## Recommendation
${card.recommendation}
`;
}
