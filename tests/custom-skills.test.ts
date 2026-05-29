import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runSkillsCommand } from "../src/cli.js";
import {
  formatConjectSkillList,
  getConjectProjectSkillsPath,
  getConjectSkillLoadPaths,
  getConjectUserSkillsPath,
  initConjectSkill,
  listConjectSkills,
  validateSkillName
} from "../src/custom-skills.js";

describe("Conject custom skills", () => {
  it("resolves bundled plus existing user and project skill load paths", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-skills-"));
    try {
      const home = join(dir, "home");
      const cwd = join(dir, "project");
      mkdirSync(getConjectUserSkillsPath(home), { recursive: true });
      mkdirSync(getConjectProjectSkillsPath(cwd), { recursive: true });

      const paths = getConjectSkillLoadPaths({ cwd, home });

      expect(paths[0]).toContain("skills");
      expect(paths).toContain(getConjectUserSkillsPath(home));
      expect(paths).toContain(getConjectProjectSkillsPath(cwd));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("initializes project and user skills without overwriting existing skills", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-skills-"));
    try {
      const home = join(dir, "home");
      const cwd = join(dir, "project");
      const project = initConjectSkill("project-style", { cwd, home });
      const user = initConjectSkill("user-style", { cwd, home, scope: "user" });

      expect(project.filePath).toBe(join(cwd, ".conject", "skills", "project-style", "SKILL.md"));
      expect(user.filePath).toBe(join(home, ".conject", "skills", "user-style", "SKILL.md"));
      expect(readFileSync(project.filePath, "utf8")).toContain("name: project-style");
      expect(() => initConjectSkill("project-style", { cwd, home })).toThrow(/already exists/);
      expect(validateSkillName("Bad Skill")).toContain("name must use lowercase letters, numbers, and hyphens only");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists custom skills with source labels and diagnostics", () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-skills-"));
    try {
      const home = join(dir, "home");
      const cwd = join(dir, "project");
      initConjectSkill("project-style", { cwd, home });
      mkdirSync(join(cwd, ".conject", "skills", "broken"), { recursive: true });
      writeFileSync(join(cwd, ".conject", "skills", "broken", "SKILL.md"), "---\nname: broken\n---\n", "utf8");

      const result = listConjectSkills({ cwd, home });
      const output = formatConjectSkillList(result);

      expect(result.skills).toEqual(expect.arrayContaining([expect.objectContaining({ name: "project-style", scope: "project" })]));
      expect(output).toContain("[project] project-style");
      expect(output).toContain("Diagnostics:");
      expect(output).toContain("description is required");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("runs skills init/list/paths commands against supplied roots", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-skills-"));
    try {
      const home = join(dir, "home");
      const cwd = join(dir, "project");
      const output: string[] = [];
      const write = (text: string) => output.push(text);

      await runSkillsCommand(["init", "demo-skill"], { cwd, home, write });
      await runSkillsCommand(["list"], { cwd, home, write });
      await runSkillsCommand(["paths"], { cwd, home, write });

      expect(existsSync(join(cwd, ".conject", "skills", "demo-skill", "SKILL.md"))).toBe(true);
      expect(output.join("\n")).toContain("[project] demo-skill");
      expect(output.join("\n")).toContain("Conject project");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
