import type { ArtifactType } from "@conject/artifacts";

export type AgentProfileId = "strategist" | "researcher" | "reviewer" | "builder";

export type ModelConfigRef = {
  provider?: string;
  model?: string;
  thinking?: string;
};

export type SkillRef = {
  id: string;
  description: string;
};

export type ToolRef = {
  id: string;
  description: string;
};

export type PermissionPolicy = {
  filesystem: "none" | "read-only" | "scoped-write";
  network: "none" | "provider-tools" | "allowed";
  commandExecution: "none" | "scoped";
  writeRoot?: string;
};

export type BudgetPolicy = {
  maxToolCalls: number;
  timeoutMs: number;
  maxOutputTokens?: number;
};

export type AgentProfile = {
  id: AgentProfileId;
  role: string;
  model: ModelConfigRef;
  systemPrompt: string;
  skills: SkillRef[];
  tools: ToolRef[];
  inputArtifacts: ArtifactType[];
  outputArtifacts: ArtifactType[];
  permissions: PermissionPolicy;
  budget: BudgetPolicy;
  outputSchema: string;
};

export const AGENT_PROFILES: Record<AgentProfileId, AgentProfile> = {
  strategist: {
    id: "strategist",
    role: "Objective normalizer and research idea generator",
    model: {},
    systemPrompt:
      "Normalize the user's research objective into testable constraints, then propose diverse implementable ideas. Prefer narrow, measurable ideas over broad surveys.",
    skills: [
      {
        id: "objective-normalization",
        description: "Rewrite open-ended prompts into scoped objectives with success criteria."
      }
    ],
    tools: [],
    inputArtifacts: [],
    outputArtifacts: ["research_objective", "idea"],
    permissions: { filesystem: "none", network: "none", commandExecution: "none" },
    budget: { maxToolCalls: 0, timeoutMs: 120000, maxOutputTokens: 4000 },
    outputSchema: "One research_objective artifact and N idea artifacts."
  },
  researcher: {
    id: "researcher",
    role: "Evidence collector and uncertainty reporter",
    model: {},
    systemPrompt:
      "Collect and organize evidence for one idea. Do not invent citations. Make uncertainty visible through source quality notes, claims, contradictions, and open questions.",
    skills: [
      {
        id: "claim-extraction",
        description: "Extract source-linked claims with support direction, confidence, quote, and location."
      }
    ],
    tools: [
      { id: "paper_search", description: "Search OpenAlex, Semantic Scholar, and arXiv through configured adapters." },
      { id: "web_search", description: "Search Tavily or SearXNG through configured adapters." }
    ],
    inputArtifacts: ["research_objective", "idea"],
    outputArtifacts: ["evidence_bundle"],
    permissions: { filesystem: "none", network: "provider-tools", commandExecution: "none" },
    budget: { maxToolCalls: 20, timeoutMs: 300000, maxOutputTokens: 8000 },
    outputSchema: "One evidence_bundle artifact for the provided idea."
  },
  reviewer: {
    id: "reviewer",
    role: "Hypothesis reviewer and ranker",
    model: {},
    systemPrompt:
      "Convert ideas and evidence bundles into ranked hypothesis cards. Ground every score in the available evidence and preserve warnings when evidence is partial.",
    skills: [],
    tools: [],
    inputArtifacts: ["research_objective", "idea", "evidence_bundle"],
    outputArtifacts: ["hypothesis_card", "ranking"],
    permissions: { filesystem: "none", network: "none", commandExecution: "none" },
    budget: { maxToolCalls: 5, timeoutMs: 180000, maxOutputTokens: 6000 },
    outputSchema: "One hypothesis_card per reviewed idea plus one ranking artifact."
  },
  builder: {
    id: "builder",
    role: "Scoped implementation pack builder",
    model: {},
    systemPrompt:
      "Create a runnable implementation pack for the selected hypothesis. Keep the experiment minimal, falsifiable, and self-contained.",
    skills: [],
    tools: [],
    inputArtifacts: ["research_objective", "evidence_bundle", "hypothesis_card"],
    outputArtifacts: ["implementation_pack"],
    permissions: {
      filesystem: "scoped-write",
      network: "none",
      commandExecution: "scoped",
      writeRoot: "implementations/<run-id>/<hypothesis-id>/"
    },
    budget: { maxToolCalls: 30, timeoutMs: 300000, maxOutputTokens: 8000 },
    outputSchema: "One implementation_pack artifact with files[] for all generated files."
  }
};

export function getAgentProfile(id: AgentProfileId): AgentProfile {
  return AGENT_PROFILES[id];
}

export function listAgentProfiles(): AgentProfile[] {
  return Object.values(AGENT_PROFILES);
}

export function formatAgentProfileForPrompt(profile: AgentProfile, budgetOverride?: Partial<BudgetPolicy>): string {
  const budget = { ...profile.budget, ...budgetOverride };
  return [
    `Role: ${profile.role}`,
    `System prompt: ${profile.systemPrompt}`,
    `Input artifacts: ${profile.inputArtifacts.length ? profile.inputArtifacts.join(", ") : "none"}`,
    `Output artifacts: ${profile.outputArtifacts.join(", ")}`,
    `Permissions: ${JSON.stringify(profile.permissions)}`,
    `Budget: ${JSON.stringify(budget)}`,
    profile.skills.length ? `Skills: ${profile.skills.map((skill) => `${skill.id} (${skill.description})`).join("; ")}` : "Skills: none",
    profile.tools.length ? `Tools: ${profile.tools.map((tool) => `${tool.id} (${tool.description})`).join("; ")}` : "Tools: none",
    `Output contract: ${profile.outputSchema}`
  ].join("\n");
}
