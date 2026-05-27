import { describe, expect, it } from "vitest";
import { defaultConfig } from "../packages/config/src/index.js";
import { computeFinalScore } from "../packages/ranking/src/index.js";
import { hypothesisFixture } from "./fixtures/artifacts.js";

describe("scoring", () => {
  it("uses configured weighted score", () => {
    expect(computeFinalScore(hypothesisFixture, defaultConfig.scoring)).toBe(3);
  });
});
