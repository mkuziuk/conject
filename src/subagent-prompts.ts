import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getConjectSubagentsPath } from "./paths.js";

export interface SubagentPrompt {
  name: string;
  description: string;
  tools: string[];
  prompt: string;
  path: string;
}

export type SubagentPromptName = "researcher" | "reviewer" | "builder";

export function loadSubagentPrompt(name: SubagentPromptName): SubagentPrompt {
  const filePath = join(getConjectSubagentsPath(), `${name}.md`);
  const content = readFileSync(filePath, "utf8");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(content);
  if (!match) throw new Error(`Subagent prompt is missing YAML frontmatter: ${filePath}`);

  const frontmatter = parseFrontmatter(match[1]);
  const prompt = match[2].trim();
  if (!frontmatter.name) throw new Error(`Subagent prompt is missing name: ${filePath}`);
  if (!frontmatter.description) throw new Error(`Subagent prompt is missing description: ${filePath}`);
  if (!prompt) throw new Error(`Subagent prompt body is empty: ${filePath}`);

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    tools: parseTools(frontmatter.tools),
    prompt,
    path: filePath
  };
}

function parseFrontmatter(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    result[key] = value;
  }
  return result;
}

function parseTools(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}
