import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { getConjectSkillsPath } from "../src/paths.js";
import { loadSubagentPrompt } from "../src/subagent-prompts.js";

const EXPECTED_SKILLS = [
  "conject-implementation-proposal",
  "conject-research-agent",
  "conject-research-planning",
  "conject-research-workflow",
  "conject-review-ranking",
  "conject-source-evidence"
];

describe("Conject skills", () => {
  it("ships the expected layered skill stack with frontmatter", () => {
    const skillsPath = getConjectSkillsPath();
    const skillDirs = readdirSync(skillsPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect(skillDirs).toEqual(EXPECTED_SKILLS);

    for (const skill of skillDirs) {
      const file = join(skillsPath, skill, "SKILL.md");
      expect(existsSync(file)).toBe(true);
      const content = readFileSync(file, "utf8");
      expect(content).toMatch(/^---\n/);
      expect(content).toContain(`name: ${skill}`);
      expect(content).toMatch(/description: .{40,}/);
    }
  });
});

describe("Conject subagent prompts", () => {
  it("loads researcher, reviewer, and builder prompts with metadata", () => {
    for (const name of ["researcher", "reviewer", "builder"] as const) {
      const prompt = loadSubagentPrompt(name);
      expect(prompt.name).toBe(name);
      expect(prompt.description.length).toBeGreaterThan(20);
      expect(prompt.prompt.length).toBeGreaterThan(100);
      expect(prompt.tools.length).toBeGreaterThan(0);
    }
  });

  it("keeps researcher and builder report contracts explicit", () => {
    const researcher = loadSubagentPrompt("researcher").prompt;
    const builder = loadSubagentPrompt("builder").prompt;
    const researchAgentSkill = readFileSync(join(getConjectSkillsPath(), "conject-research-agent", "SKILL.md"), "utf8");

    expect(researcher).toContain("## Method Details and Concrete Examples");
    expect(researcher).toContain("at least one worked example");
    expect(researchAgentSkill).toContain("## Method Details and Concrete Examples");
    expect(researchAgentSkill).toContain("concrete inputs, outputs, assumptions");
    expect(builder).toContain("what the implementation does");
    expect(builder).toContain("how to run it from the implementation directory");
  });
});
