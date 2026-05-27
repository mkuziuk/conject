import { describe, expect, it } from "vitest";
import {
  EvidenceBundleSchema,
  HypothesisCardSchema,
  IdeaSchema,
  ResearchObjectiveSchema
} from "../packages/artifacts/src/index.js";
import { evidenceBundleFixture, hypothesisFixture, ideaFixture, objectiveFixture } from "./fixtures/artifacts.js";

describe("artifact schemas", () => {
  it("validates valid fixtures", () => {
    expect(() => ResearchObjectiveSchema.parse(objectiveFixture)).not.toThrow();
    expect(() => IdeaSchema.parse(ideaFixture)).not.toThrow();
    expect(() => EvidenceBundleSchema.parse(evidenceBundleFixture)).not.toThrow();
    expect(() => HypothesisCardSchema.parse(hypothesisFixture)).not.toThrow();
  });

  it("rejects malformed ideas", () => {
    expect(() => IdeaSchema.parse({ ...ideaFixture, searchQueries: [] })).toThrow();
  });

  it("rejects out-of-range scores", () => {
    expect(() => HypothesisCardSchema.parse({ ...hypothesisFixture, impactScore: 9 })).toThrow();
  });
});
