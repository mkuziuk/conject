import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const IMPLEMENTATION_INTENT_PATTERNS = [
  /\bbuild\s+this\b/iu,
  /\bimplement\s+(it|this|the\s+proposal|the\s+plan)\b/iu,
  /\b(start|begin|do|run)\s+the\s+implementation\b/iu,
  /\bcreate\s+the\s+code\b/iu,
  /\bapply\s+(it|this|the\s+proposal|the\s+plan)\b/iu,
  /\bgo\s+ahead\b/iu,
  /\bproceed\b/iu,
  /^\s*do\s+it\s*$/iu,
  /^\s*yes[,.]?\s*(build|implement|apply|proceed)\b/iu
];

export function isImplementationIntentRequest(text: string): boolean {
  return IMPLEMENTATION_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function hasResearchProposal(cwd: string): boolean {
  return existsSync(join(cwd, "research", "proposal.md"));
}

export function createBuilderToolRequestMessage(cwd: string, userText: string): string {
  const proposalPath = join(cwd, "research", "proposal.md");
  const proposal = readFileSync(proposalPath, "utf8").trim();

  return [
    "The user gave explicit implementation intent for the approved Conject proposal.",
    "",
    `User request: ${userText.trim() || "(empty)"}`,
    "",
    "You must call `conject_spawn_builder` before doing any implementation work.",
    "Do not use bash, edit, or write to implement this proposal directly in the main session.",
    "Use `proposalPath: \"research/proposal.md\"` unless the user explicitly names a different proposal.",
    "",
    "## Approved Proposal",
    proposal
  ].join("\n");
}
