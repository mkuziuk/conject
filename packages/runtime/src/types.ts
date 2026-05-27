import type { Artifact, ArtifactType } from "@conject/artifacts";
import type { ConjectConfig } from "@conject/config";

export type AgentId = "strategist" | "researcher" | "reviewer" | "builder";

export type ArtifactInput = {
  type: ArtifactType;
  json: unknown;
  parentIds?: string[];
};

export type RunAgentJobInput = {
  runId: string;
  jobId: string;
  agentId: AgentId;
  inputArtifacts: Artifact[];
  prompt: string;
  config: ConjectConfig;
  logToolCall?: (call: RuntimeToolCall) => Promise<void>;
};

export type RuntimeToolCall = {
  toolName: string;
  input: unknown;
  output?: unknown;
  status: "succeeded" | "failed";
  error?: string;
  startedAt: string;
  finishedAt: string;
};

export type RunAgentJobResult = {
  outputArtifacts: ArtifactInput[];
  rawText?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
};

export interface AgentRuntime {
  runAgentJob(input: RunAgentJobInput): Promise<RunAgentJobResult>;
}
