import { describe, expect, it } from "vitest";
import { defaultConfig, type ConjectConfig } from "../packages/config/src/index.js";
import { PiAgentRuntime, checkPiSdkAvailability } from "../packages/runtime/src/index.js";

describe("PiAgentRuntime", () => {
  it("creates an isolated Conject-owned Pi session and parses validated output", async () => {
    const session = new FakePiSession([
      JSON.stringify({
        outputArtifacts: [
          {
            type: "research_objective",
            json: {
              id: "OBJ-001",
              title: "Objective",
              rawPrompt: "Prompt",
              normalizedPrompt: "Prompt",
              constraints: [],
              successCriteria: []
            }
          },
          {
            type: "idea",
            json: {
              id: "IDEA-001",
              title: "Idea",
              summary: "Summary",
              rationale: "Rationale",
              expectedValue: "Value",
              possibleRisks: [],
              searchQueries: ["query"]
            }
          }
        ]
      })
    ]);
    const sdk = new FakePiSdk(session);
    const runtime = new PiAgentRuntime({
      sdk,
      cwd: "/tmp/conject-test",
      env: { CONJECT_TEST_PI_KEY: "secret" }
    });

    const result = await runtime.runAgentJob({
      runId: "run-1",
      jobId: "job-1",
      agentId: "strategist",
      inputArtifacts: [],
      prompt: "Prompt",
      config: piConfig()
    });

    expect(result.outputArtifacts.map((artifact) => artifact.type)).toEqual(["research_objective", "idea"]);
    expect(session.prompts[0]).toContain("Output one research_objective artifact");
    expect(session.prompts[0]).toContain("Agent profile:");
    expect(session.prompts[0]).toContain("Create exactly 5 idea artifact(s).");
    expect(session.disposed).toBe(true);

    expect(sdk.authStorage.runtimeKeys).toEqual([{ provider: "anthropic", apiKey: "secret" }]);
    expect(sdk.modelRegistry.findCalls).toEqual([{ provider: "anthropic", modelId: "claude-test" }]);
    expect(sdk.resourceLoader?.reloaded).toBe(true);
    expect(sdk.sessionOptions).toMatchObject({
      cwd: "/tmp/conject-test",
      noTools: "all",
      tools: [],
      agentDir: "/tmp/conject-test/.conject/pi",
      model: sdk.model
    });
    expect(sdk.sessionOptions?.authStorage).toBe(sdk.authStorage);
    expect(sdk.sessionOptions?.modelRegistry).toBe(sdk.modelRegistry);
    expect(sdk.sessionOptions?.settingsManager).toBe(sdk.settingsManager);
    expect(sdk.sessionOptions?.sessionManager).toBe(sdk.sessionManager);
    expect(sdk.sessionOptions?.resourceLoader).toBe(sdk.resourceLoader);
  });

  it("retries once after validation failure", async () => {
    const session = new FakePiSession([
      JSON.stringify({
        outputArtifacts: [
          {
            type: "idea",
            json: {
              id: "IDEA-001",
              title: "Missing required fields"
            }
          }
        ]
      }),
      JSON.stringify({
        outputArtifacts: [
          {
            type: "idea",
            json: {
              id: "IDEA-001",
              title: "Idea",
              summary: "Summary",
              rationale: "Rationale",
              expectedValue: "Value",
              possibleRisks: [],
              searchQueries: ["query"]
            }
          }
        ]
      })
    ]);

    const runtime = new PiAgentRuntime({
      sdk: new FakePiSdk(session),
      env: { CONJECT_TEST_PI_KEY: "secret" },
      maxValidationRetries: 1
    });

    const result = await runtime.runAgentJob({
      runId: "run-1",
      jobId: "job-1",
      agentId: "strategist",
      inputArtifacts: [],
      prompt: "Prompt",
      config: piConfig()
    });

    expect(result.outputArtifacts).toHaveLength(1);
    expect(session.prompts).toHaveLength(2);
    expect(session.prompts[1]).toContain("previous output failed validation");
  });

  it("fails before session creation when explicit Pi model config is incomplete", async () => {
    const session = new FakePiSession([]);
    const sdk = new FakePiSdk(session);
    const runtime = new PiAgentRuntime({ sdk, env: { CONJECT_TEST_PI_KEY: "secret" } });
    const config = piConfig();
    config.models.default = {};

    await expect(
      runtime.runAgentJob({
        runId: "run-1",
        jobId: "job-1",
        agentId: "strategist",
        inputArtifacts: [],
        prompt: "Prompt",
        config
      })
    ).rejects.toThrow("Missing Pi model config field");
    expect(sdk.sessionOptions).toBeUndefined();
  });

  it("fails before session creation when the configured API key env var is missing", async () => {
    const session = new FakePiSession([]);
    const sdk = new FakePiSdk(session);
    const runtime = new PiAgentRuntime({ sdk, env: {} });

    await expect(
      runtime.runAgentJob({
        runId: "run-1",
        jobId: "job-1",
        agentId: "strategist",
        inputArtifacts: [],
        prompt: "Prompt",
        config: piConfig()
      })
    ).rejects.toThrow("Missing Pi API key environment variable: CONJECT_TEST_PI_KEY");
    expect(sdk.sessionOptions).toBeUndefined();
  });

  it("rejects Pi agentDir values outside .conject", async () => {
    const session = new FakePiSession([]);
    const sdk = new FakePiSdk(session);
    const runtime = new PiAgentRuntime({ sdk, cwd: "/tmp/conject-test", env: { CONJECT_TEST_PI_KEY: "secret" } });
    const config = piConfig();
    config.runtime.pi.agentDir = "../pi";

    await expect(
      runtime.runAgentJob({
        runId: "run-1",
        jobId: "job-1",
        agentId: "strategist",
        inputArtifacts: [],
        prompt: "Prompt",
        config
      })
    ).rejects.toThrow("runtime.pi.agentDir must stay under .conject");
    expect(sdk.sessionOptions).toBeUndefined();
  });

  it("reports readiness errors without loading user Pi config", async () => {
    const result = await checkPiSdkAvailability(piConfig(), {});
    expect(result).toEqual({
      ok: false,
      error: "Missing Pi API key environment variable: CONJECT_TEST_PI_KEY. Set it before using --runtime pi."
    });
  });
});

function piConfig(): ConjectConfig {
  const config = structuredClone(defaultConfig);
  config.models.default = {
    provider: "anthropic",
    model: "claude-test",
    apiKeyEnv: "CONJECT_TEST_PI_KEY",
    thinking: "medium"
  };
  return config;
}

class FakePiSession {
  readonly prompts: string[] = [];
  readonly state: { messages: Array<{ role: string; content: Array<{ type: string; text: string }> }> } = { messages: [] };
  disposed = false;

  constructor(private readonly responses: string[]) {}

  async prompt(text: string): Promise<void> {
    this.prompts.push(text);
    const response = this.responses.shift();
    if (!response) throw new Error("No fake Pi response queued.");
    this.state.messages.push({ role: "assistant", content: [{ type: "text", text: response }] });
  }

  dispose(): void {
    this.disposed = true;
  }
}

class FakeAuthStorage {
  readonly runtimeKeys: Array<{ provider: string; apiKey: string }> = [];

  setRuntimeApiKey(provider: string, apiKey: string): void {
    this.runtimeKeys.push({ provider, apiKey });
  }
}

class FakeModelRegistry {
  readonly findCalls: Array<{ provider: string; modelId: string }> = [];

  constructor(private readonly model: unknown) {}

  find(provider: string, modelId: string): unknown {
    this.findCalls.push({ provider, modelId });
    return this.model;
  }
}

class FakeResourceLoader {
  reloaded = false;

  constructor(readonly options: Record<string, unknown>) {}

  async reload(): Promise<void> {
    this.reloaded = true;
  }
}

class FakePiSdk {
  readonly model = { provider: "anthropic", id: "claude-test" };
  readonly authStorage = new FakeAuthStorage();
  readonly modelRegistry = new FakeModelRegistry(this.model);
  readonly settingsManager = { type: "settings" };
  readonly sessionManager = { type: "session" };
  readonly DefaultResourceLoader: new (options: Record<string, unknown>) => FakeResourceLoader;
  resourceLoader?: FakeResourceLoader;
  sessionOptions?: Record<string, unknown>;

  readonly AuthStorage = {
    inMemory: () => this.authStorage
  };

  readonly ModelRegistry = {
    inMemory: () => this.modelRegistry
  };

  readonly SettingsManager = {
    inMemory: () => this.settingsManager
  };

  readonly SessionManager = {
    inMemory: () => this.sessionManager
  };

  constructor(private readonly session: FakePiSession) {
    const sdk = this;
    this.DefaultResourceLoader = class extends FakeResourceLoader {
      constructor(options: Record<string, unknown>) {
        super(options);
        sdk.resourceLoader = this;
      }
    };
  }

  createAgentSession = async (options?: Record<string, unknown>): Promise<{ session: FakePiSession }> => {
    this.sessionOptions = options;
    return { session: this.session };
  };
}
