import type { HypothesisCard } from "@conject/artifacts";
import type { ScoreWeights } from "@conject/config";

export function computeFinalScore(
  card: Pick<
    HypothesisCard,
    | "impactScore"
    | "testabilityScore"
    | "evidenceStrengthScore"
    | "noveltyScore"
    | "implementationDifficultyScore"
  >,
  weights: ScoreWeights
): number {
  const score =
    weights.impact * card.impactScore +
    weights.testability * card.testabilityScore +
    weights.evidenceStrength * card.evidenceStrengthScore +
    weights.novelty * card.noveltyScore +
    weights.implementationDifficulty * card.implementationDifficultyScore;
  return Number(score.toFixed(3));
}

export function sortHypotheses(cards: HypothesisCard[]): HypothesisCard[] {
  return [...cards].sort((a, b) => b.finalScore - a.finalScore || a.id.localeCompare(b.id));
}
