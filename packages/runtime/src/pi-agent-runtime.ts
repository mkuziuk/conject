import { mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { formatAgentProfileForPrompt, getAgentProfile } from "@conject/agents";
import {
  EvidenceBundleSchema,
  HypothesisCardSchema,
  IdeaSchema,
  ImplementationPackSchema,
  RankingSchema,
  ResearchObjectiveSchema,
  type ArtifactType
} from "@conject/artifacts";
import type { ConjectConfig } from "@conject/config";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession
} from "@earendil-works/pi-coding-agent";
import type { AgentRuntime, ArtifactInput, RunAgentJobInput, RunAgentJobResult } from "./types.js";

type PiSession = {
  prompt: (text: string, options?: Record<string, unknown>) => Promise<void>;
  dispose?: () => void;
  state?: {
    messages?: unknown[];
  };
  messages?: unknown[];
};

type PiAuthStorage = {
  setRuntimeApiKey: (provider: string, apiKey: string) => void;
};

type PiModelRegistry = {
  find: (provider: string, modelId: string) => unknown | undefined;
  getError?: () => string | undefined;
};

type PiResourceLoader = {
  reload: () => Promise<void>;
};

type PiSdk = {
  createAgentSession: (options?: Record<string, unknown>) => Promise<{ session: PiSession }>;
  AuthStorage: {
    inMemory: () => PiAuthStorage;
  };
  ModelRegistry: {
    inMemory: (authStorage: PiAuthStorage) => PiModelRegistry;
  };
  SettingsManager: {
    inMemory: (settings?: Record<string, unknown>) => unknown;
  };
  SessionManager: {
    inMemory: (cwd?: string) => unknown;
  };
  DefaultResourceLoader: new (options: Record<string, unknown>) => PiResourceLoader;
};

type ResolvedPiModelConfig = {
  provider: string;
  model: string;
  apiKeyEnv: string;
  apiKey: string;
  thinking?: string;
};

export type PiAgentRuntimeOptions = {
  sdk?: PiSdk;
  cwd?: string;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
  maxValidationRetries?: number;
};

const DEFAULT_CONJECT_PI_AGENT_DIR = ".conject/pi";
const THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh"]);

const installedPiSdk: PiSdk = {
  createAgentSession: (options?: Record<string, unknown>) => createAgentSession(options as never) as Promise<{ session: PiSession }>,
  AuthStorage,
  ModelRegistry: ModelRegistry as unknown as PiSdk["ModelRegistry"],
  SettingsManager,
  SessionManager,
  DefaultResourceLoader: DefaultResourceLoader as unknown as PiSdk["DefaultResourceLoader"]
};

export class PiAgentRuntime implements AgentRuntime {
  private readonly sdk: PiSdk;
  private readonly cwd?: string;
  private readonly agentDir?: string;
  private readonly env: NodeJS.ProcessEnv;
  private readonly maxValidationRetries: number;

  constructor(options: PiAgentRuntimeOptions = {}) {
    this.sdk = options.sdk ?? installedPiSdk;
    this.cwd = options.cwd;
    this.agentDir = options.agentDir;
    this.env = options.env ?? process.env;
    this.maxValidationRetries = options.maxValidationRetries ?? 1;
  }

  async runAgentJob(input: RunAgentJobInput): Promise<RunAgentJobResult> {
    const cwd = resolve(this.cwd ?? process.cwd());
    const agentDir = resolveConjectPiAgentDir(cwd, this.agentDir ?? input.config.runtime.pi.agentDir);
    const resolvedModel = resolvePiModelConfig(input.config, input.agentId, this.env);
    const authStorage = this.sdk.AuthStorage.inMemory();
    authStorage.setRuntimeApiKey(resolvedModel.provider, resolvedModel.apiKey);
    const modelRegistry = this.sdk.ModelRegistry.inMemory(authStorage);
    const model = modelRegistry.find(resolvedModel.provider, resolvedModel.model);
    if (!model) {
      const loadError = modelRegistry.getError?.();
      throw new Error(
        [
          `Configured Pi model not found: ${resolvedModel.provider}/${resolvedModel.model}.`,
          "Use a model supported by the pinned @earendil-works/pi-coding-agent SDK or add custom model registry support first.",
          loadError ? `Model registry error: ${loadError}` : ""
        ]
          .filter(Boolean)
          .join(" ")
      );
    }

    mkdirSync(agentDir, { recursive: true });
    const settingsManager = this.sdk.SettingsManager.inMemory({
      defaultProvider: resolvedModel.provider,
      defaultModel: resolvedModel.model,
      ...(resolvedModel.thinking ? { defaultThinkingLevel: resolvedModel.thinking } : {}),
      quietStartup: true,
      sessionDir: resolve(agentDir, "sessions"),
      packages: [],
      extensions: [],
      skills: [],
      prompts: [],
      themes: [],
      enableSkillCommands: false
    });
    const sessionManager = this.sdk.SessionManager.inMemory(cwd);
    const resourceLoader = new this.sdk.DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: "You are an embedded Conject runtime. Return only the requested schema-shaped artifacts."
    });
    await resourceLoader.reload();

    const { session } = await this.sdk.createAgentSession({
      cwd,
      agentDir,
      authStorage,
      modelRegistry,
      model,
      ...(resolvedModel.thinking ? { thinkingLevel: resolvedModel.thinking } : {}),
      settingsManager,
      sessionManager,
      resourceLoader,
      noTools: "all",
      tools: []
    });

    let validationError: string | undefined;
    try {
      for (let attempt = 0; attempt <= this.maxValidationRetries; attempt += 1) {
        await session.prompt(buildPrompt(input, validationError));
        const rawText = extractAssistantText(session);
        try {
          const outputArtifacts = parseOutputArtifacts(rawText);
          return { outputArtifacts, rawText };
        } catch (error) {
          validationError = error instanceof Error ? error.message : String(error);
          if (attempt >= this.maxValidationRetries) throw error;
        }
      }
      throw new Error("Pi runtime exhausted validation retries.");
    } finally {
      session.dispose?.();
    }
  }
}

export async function checkPiSdkAvailability(
  config?: ConjectConfig,
  env: NodeJS.ProcessEnv = process.env
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (config) {
      resolveConjectPiAgentDir(process.cwd(), config.runtime.pi.agentDir);
      resolvePiModelConfig(config, "strategist", env);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function resolveConjectPiAgentDir(cwd: string, configuredAgentDir?: string): string {
  const value = configuredAgentDir?.trim() || DEFAULT_CONJECT_PI_AGENT_DIR;
  if (isAbsolute(value)) {
    throw new Error("runtime.pi.agentDir must be a relative path under .conject/.");
  }
  const resolved = resolve(cwd, value);
  const stateRoot = resolve(cwd, ".conject");
  const withinState = resolved === stateRoot || (!relative(stateRoot, resolved).startsWith("..") && !isAbsolute(relative(stateRoot, resolved)));
  if (!withinState) {
    throw new Error("runtime.pi.agentDir must stay under .conject/ so Conject never reads user-level Pi configuration.");
  }
  return resolved;
}

function resolvePiModelConfig(config: ConjectConfig, agentId: RunAgentJobInput["agentId"], env: NodeJS.ProcessEnv): ResolvedPiModelConfig {
  const modelConfig = { ...config.models.default, ...(config.models.agents[agentId] ?? {}) };
  const missing = ["provider", "model", "apiKeyEnv"].filter((key) => !modelConfig[key as keyof typeof modelConfig]);
  if (missing.length > 0) {
    throw new Error(
      `Missing Pi model config field(s): models.default.${missing.join(", models.default.")}. Set provider, model, and apiKeyEnv in conject.yaml before using --runtime pi.`
    );
  }

  const provider = modelConfig.provider!;
  const model = modelConfig.model!;
  const apiKeyEnv = modelConfig.apiKeyEnv!;
  const apiKey = env[apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Missing Pi API key environment variable: ${apiKeyEnv}. Set it before using --runtime pi.`);
  }
  if (modelConfig.thinking && !THINKING_LEVELS.has(modelConfig.thinking)) {
    throw new Error(`Invalid Pi thinking level '${modelConfig.thinking}'. Use one of: ${[...THINKING_LEVELS].join(", ")}.`);
  }

  return {
    provider,
    model,
    apiKeyEnv,
    apiKey,
    thinking: modelConfig.thinking
  };
}

function buildPrompt(input: RunAgentJobInput, validationError?: string): string {
  const profile = getAgentProfile(input.agentId);
  const budget = input.config.budgets[input.agentId];
  return [
    `You are Conject's ${input.agentId} agent.`,
    "",
    "Agent profile:",
    formatAgentProfileForPrompt(profile, budget),
    "",
    "Return only valid JSON. Do not wrap it in Markdown.",
    "The JSON shape must be:",
    '{"outputArtifacts":[{"type":"artifact_type","json":{},"parentIds":["optional-parent-id"]}]}',
    "",
    expectedOutputInstruction(input.agentId),
    "",
    agentSpecificConstraints(input),
    validationError ? `\nYour previous output failed validation:\n${validationError}\nReturn corrected JSON only.` : "",
    "",
    "Input artifacts:",
    JSON.stringify(input.inputArtifacts, null, 2),
    "",
    "Job prompt:",
    input.prompt
  ].join("\n");
}

function expectedOutputInstruction(agentId: RunAgentJobInput["agentId"]): string {
  if (agentId === "strategist") {
    return "Output one research_objective artifact and one or more idea artifacts.";
  }
  if (agentId === "researcher") {
    return "Output one evidence_bundle artifact for the provided idea.";
  }
  if (agentId === "reviewer") {
    return "Output one or more hypothesis_card artifacts and one ranking artifact.";
  }
  return "Output one implementation_pack artifact.";
}

function agentSpecificConstraints(input: RunAgentJobInput): string {
  if (input.agentId === "strategist") {
    return [
      `Create exactly ${input.config.research.ideas} idea artifact(s).`,
      "Use readable domain ids: OBJ-001, IDEA-001, IDEA-002, and so on.",
      "Each idea must include at least one concrete search query."
    ].join("\n");
  }
  if (input.agentId === "researcher") {
    return [
      `Use at most ${input.config.research.sourcesPerIdea} source(s).`,
      "Do not invent source metadata. If no real source is available in the inputs or tools, return an evidence_bundle with empty sources, empty claims, and explicit openQuestions."
    ].join("\n");
  }
  if (input.agentId === "reviewer") {
    return [
      "Use the configured scoring weights exactly as the ranking.scoringWeights value.",
      "Set ranking.partial=true and include warnings when evidence bundles are missing or sparse.",
      "Every hypothesis_card.keySources entry must reference a source id that exists in an evidence_bundle."
    ].join("\n");
  }
  return [
    `Write only under implementations/${input.runId}/<hypothesis-id>/.`,
    "The implementation_pack must include files[] with path and content for each generated file.",
    "Use a minimal Python scaffold with pyproject.toml and pytest smoke coverage unless the hypothesis clearly requires a different local-only scaffold."
  ].join("\n");
}

function extractAssistantText(session: PiSession): string {
  const messages = session.state?.messages ?? session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i] as { role?: string; content?: unknown };
    if (message.role && message.role !== "assistant") continue;
    const text = contentToText(message.content);
    if (text.trim()) return text;
  }
  throw new Error("Pi session produced no assistant text.");
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
          return (part as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object" && "text" in content && typeof (content as { text?: unknown }).text === "string") {
    return (content as { text: string }).text;
  }
  return "";
}

function parseOutputArtifacts(rawText: string): ArtifactInput[] {
  const parsed = JSON.parse(extractJsonObject(rawText)) as unknown;
  if (!parsed || typeof parsed !== "object" || !("outputArtifacts" in parsed) || !Array.isArray((parsed as { outputArtifacts?: unknown }).outputArtifacts)) {
    throw new Error("Pi output must be an object with outputArtifacts array.");
  }
  return (parsed as { outputArtifacts: unknown[] }).outputArtifacts.map((artifact, index) => parseArtifactInput(artifact, index));
}

function parseArtifactInput(value: unknown, index: number): ArtifactInput {
  if (!value || typeof value !== "object") throw new Error(`outputArtifacts[${index}] must be an object.`);
  const candidate = value as { type?: unknown; json?: unknown; parentIds?: unknown };
  if (typeof candidate.type !== "string") throw new Error(`outputArtifacts[${index}].type must be a string.`);
  if (!("json" in candidate)) throw new Error(`outputArtifacts[${index}].json is required.`);
  validateArtifactJson(candidate.type as ArtifactType, candidate.json);
  return {
    type: candidate.type as ArtifactType,
    json: candidate.json,
    parentIds: Array.isArray(candidate.parentIds) ? candidate.parentIds.filter((id): id is string => typeof id === "string") : undefined
  };
}

function validateArtifactJson(type: ArtifactType, json: unknown): void {
  if (type === "research_objective") ResearchObjectiveSchema.parse(json);
  else if (type === "idea") IdeaSchema.parse(json);
  else if (type === "evidence_bundle") EvidenceBundleSchema.parse(json);
  else if (type === "hypothesis_card") HypothesisCardSchema.parse(json);
  else if (type === "ranking") RankingSchema.parse(json);
  else if (type === "implementation_pack") ImplementationPackSchema.parse(json);
  else throw new Error(`Pi output artifact type is not supported by runtime adapter: ${type}`);
}

function extractJsonObject(text: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1]?.trim() ?? text.trim();
  if (candidate.startsWith("{") && candidate.endsWith("}")) return candidate;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("Could not find JSON object in Pi output.");
  return candidate.slice(start, end + 1);
}
