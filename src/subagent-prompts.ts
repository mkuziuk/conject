import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter as parseYamlFrontmatter } from "@earendil-works/pi-coding-agent";
import { getConjectSubagentsPath } from "./paths.js";

export const SUBAGENT_PROMPT_NAMES = ["researcher", "reviewer", "builder"] as const;

export interface SubagentPrompt {
  name: string;
  description: string;
  tools: string[];
  prompt: string;
  path: string;
}

export type SubagentPromptName = (typeof SUBAGENT_PROMPT_NAMES)[number];

type SubagentPromptFrontmatter = Record<string, unknown> & {
  name?: unknown;
  description?: unknown;
  tools?: unknown;
};

export function loadSubagentPrompt(name: SubagentPromptName): SubagentPrompt {
  const filePath = join(getConjectSubagentsPath(), `${name}.md`);
  const content = readFileSync(filePath, "utf8");
  return parseSubagentPromptContent(name, filePath, content);
}

export function parseSubagentPromptContent(name: SubagentPromptName, filePath: string, content: string): SubagentPrompt {
  const normalizedContent = content.replace(/^\uFEFF/u, "");
  if (!normalizedContent.startsWith("---")) throw new Error(`Subagent prompt is missing YAML frontmatter: ${filePath}`);

  let parsed: ReturnType<typeof parseYamlFrontmatter<SubagentPromptFrontmatter>>;
  try {
    parsed = parseYamlFrontmatter<SubagentPromptFrontmatter>(normalizedContent);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Subagent prompt has invalid YAML frontmatter: ${filePath}: ${message}`);
  }

  const frontmatter = parsed.frontmatter;
  const prompt = parsed.body.trim();
  const promptName = stringValue(frontmatter.name);
  const description = stringValue(frontmatter.description);
  if (!promptName) throw new Error(`Subagent prompt is missing name: ${filePath}`);
  if (!description) throw new Error(`Subagent prompt is missing description: ${filePath}`);
  if (!prompt) throw new Error(`Subagent prompt body is empty: ${filePath}`);

  return {
    name: promptName,
    description,
    tools: parseTools(frontmatter.tools),
    prompt,
    path: filePath
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseTools(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((tool) => tool.trim())
    .filter(Boolean);
}
