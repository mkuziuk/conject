import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadSubagentPrompt } from "./subagent-prompts.js";

export function isBuildThisRequest(text: string): boolean {
  return /^\s*build\s+this\s*$/iu.test(text);
}

export function hasResearchProposal(cwd: string): boolean {
  return existsSync(join(cwd, "research", "proposal.md"));
}

export function createBuildHandoffMessage(cwd: string): string {
  const proposalPath = join(cwd, "research", "proposal.md");
  const proposal = readFileSync(proposalPath, "utf8").trim();
  const builder = loadSubagentPrompt("builder");

  return [
    "Build the approved Conject proposal below.",
    "",
    "Use the builder guidance and keep the implementation scoped to the proposal.",
    "",
    "## Builder Guidance",
    builder.prompt,
    "",
    "## Approved Proposal",
    proposal
  ].join("\n");
}
