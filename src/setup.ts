import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { join } from "node:path";
import { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  CREDENTIAL_KEYS,
  type CredentialKey,
  initializeCredentialStore,
  inspectCredentialStore,
  loadConjectCredentials,
  resolveWebSearchStatus,
  setCredentialValue
} from "./credentials.js";
import { getDefaultConjectAgentDir, getDefaultCredentialStorePath } from "./paths.js";

type AuthType = "oauth" | "api_key";

interface OAuthAuthInfo {
  url: string;
  instructions?: string;
}

interface OAuthDeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

interface OAuthPrompt {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}

interface OAuthSelectPrompt {
  message: string;
  options: Array<{ id: string; label: string }>;
}

export interface SetupChoice {
  value: string;
  label: string;
  description?: string;
}

export interface SetupInputOptions {
  secret?: boolean;
  allowEmpty?: boolean;
  signal?: AbortSignal;
}

export interface SetupIO {
  write(text: string): void;
  select(message: string, choices: SetupChoice[]): Promise<string | undefined>;
  input(message: string, options?: SetupInputOptions): Promise<string | undefined>;
}

export interface RunConjectSetupOptions {
  home?: string;
  env?: NodeJS.ProcessEnv;
  io?: SetupIO;
}

export interface SetupPaths {
  agentDir: string;
  authPath: string;
  modelsPath: string;
  credentialsPath: string;
}

export interface ModelAuthProviderStatus {
  provider: string;
  type: string;
}

export interface ModelAuthStoreStatus {
  path: string;
  exists: boolean;
  permissionsOk: boolean;
  mode?: string;
  providers: ModelAuthProviderStatus[];
  parseError?: string;
}

export interface SetupStatus {
  paths: SetupPaths;
  modelAuth: ModelAuthStoreStatus;
  toolCredentials: ReturnType<typeof inspectCredentialStore>;
  webSearch: "tavily" | "searxng" | "none";
}

interface ProviderOption {
  id: string;
  name: string;
  authType: AuthType;
  configured: boolean;
  source?: string;
}

const BEDROCK_PROVIDER_ID = "amazon-bedrock";

export function getSetupPaths(home?: string): SetupPaths {
  const agentDir = getDefaultConjectAgentDir(home);
  return {
    agentDir,
    authPath: join(agentDir, "auth.json"),
    modelsPath: join(agentDir, "models.json"),
    credentialsPath: getDefaultCredentialStorePath(home)
  };
}

export function inspectModelAuthStore(home?: string): ModelAuthStoreStatus {
  const { authPath } = getSetupPaths(home);
  if (!existsSync(authPath)) {
    return { path: authPath, exists: false, permissionsOk: false, providers: [] };
  }

  const stat = statSync(authPath);
  const mode = stat.mode & 0o777;
  try {
    const parsed = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
    const providers = Object.entries(parsed)
      .map(([provider, credential]) => ({
        provider,
        type: typeof credential === "object" && credential !== null && "type" in credential
          ? (credential as { type?: unknown }).type
          : undefined
      }))
      .filter((entry): entry is ModelAuthProviderStatus => typeof entry.type === "string")
      .sort((a, b) => a.provider.localeCompare(b.provider));
    return {
      path: authPath,
      exists: true,
      permissionsOk: (mode & 0o077) === 0,
      mode: mode.toString(8).padStart(3, "0"),
      providers
    };
  } catch (error) {
    return {
      path: authPath,
      exists: true,
      permissionsOk: (mode & 0o077) === 0,
      mode: mode.toString(8).padStart(3, "0"),
      providers: [],
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}

export function inspectSetupStatus(options: RunConjectSetupOptions = {}): SetupStatus {
  const env = options.env ?? process.env;
  return {
    paths: getSetupPaths(options.home),
    modelAuth: inspectModelAuthStore(options.home),
    toolCredentials: inspectCredentialStore({ home: options.home }),
    webSearch: resolveWebSearchStatus(env)
  };
}

export function formatSetupStatus(status: SetupStatus): string {
  const modelProviders = status.modelAuth.providers.length
    ? status.modelAuth.providers.map((provider) => `${provider.provider} (${provider.type})`).join(", ")
    : "none";
  const toolKeys = CREDENTIAL_KEYS.filter((key) => status.toolCredentials.keys[key]).join(", ") || "none";
  return [
    `Model auth: ${status.modelAuth.path}`,
    `Model providers: ${modelProviders}`,
    `Tool credentials: ${status.toolCredentials.path}`,
    `Tool credential keys: ${toolKeys}`,
    `Effective web search: ${status.webSearch}`
  ].join("\n");
}

export async function runConjectSetup(options: RunConjectSetupOptions = {}): Promise<void> {
  const env = options.env ?? process.env;
  const io = options.io ?? createTerminalSetupIO();
  const paths = getSetupPaths(options.home);

  loadConjectCredentials({ home: options.home, env });

  io.write("Conject setup\n\n");
  io.write(`${formatSetupStatus(inspectSetupStatus({ home: options.home, env }))}\n\n`);

  mkdirSync(paths.agentDir, { recursive: true, mode: 0o700 });
  const authStorage = AuthStorage.create(paths.authPath);
  const modelRegistry = ModelRegistry.create(authStorage, paths.modelsPath);

  await configureModelProvider(io, authStorage, modelRegistry, paths.authPath);
  await configureToolCredentials(io, { home: options.home, env });

  io.write("\nSetup complete.\n");
  io.write(`${formatSetupStatus(inspectSetupStatus({ home: options.home, env }))}\n`);
  io.write("\nRun `conject --doctor` to verify the full runtime configuration.\n");
}

function createProviderOptions(authStorage: AuthStorage, modelRegistry: ModelRegistry): ProviderOption[] {
  const oauthProviders = authStorage.getOAuthProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    authType: "oauth" as const
  }));
  const oauthProviderIds = new Set(oauthProviders.map((provider) => provider.id));
  const modelProviderIds = [...new Set(modelRegistry.getAll().map((model) => model.provider))].sort();
  const apiProviders = modelProviderIds
    .filter((providerId) => !oauthProviderIds.has(providerId))
    .map((providerId) => ({
      id: providerId,
      name: modelRegistry.getProviderDisplayName(providerId),
      authType: "api_key" as const
    }));

  return [...oauthProviders, ...apiProviders]
    .map((provider) => {
      const status = modelRegistry.getProviderAuthStatus(provider.id);
      return {
        ...provider,
        configured: status.configured,
        source: status.source
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function configureModelProvider(
  io: SetupIO,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  authPath: string
): Promise<void> {
  const configured = authStorage.list().sort();
  const action = await io.select(
    configured.length
      ? `Model auth is configured for: ${configured.join(", ")}`
      : "No Conject model provider is configured yet.",
    [
      configured.length
        ? { value: "keep", label: "Keep existing model auth", description: "Leave model provider credentials unchanged." }
        : { value: "configure", label: "Configure model provider", description: "Choose from the same provider groups as Pi /login." },
      configured.length
        ? { value: "configure", label: "Add or update provider", description: "Choose a subscription or API-key provider." }
        : { value: "skip", label: "Skip model provider", description: "You can run `conject setup` again later." }
    ]
  );
  if (!action || action === "keep" || action === "skip") return;

  const authType = await io.select("Choose authentication method:", [
    { value: "oauth", label: "Use a subscription", description: "OAuth providers such as ChatGPT, Claude, or GitHub Copilot." },
    { value: "api_key", label: "Use an API key", description: "API-key providers known to Pi plus custom providers in models.json." },
    { value: "skip", label: "Skip model auth", description: "Do not change model provider credentials." }
  ]);
  if (authType !== "oauth" && authType !== "api_key") return;

  const providers = createProviderOptions(authStorage, modelRegistry).filter((provider) => provider.authType === authType);
  if (providers.length === 0) {
    io.write(`No ${authType === "oauth" ? "subscription" : "API-key"} providers are available.\n`);
    return;
  }

  const providerId = await io.select(
    "Choose provider:",
    providers.map((provider) => ({
      value: provider.id,
      label: provider.name,
      description: providerDescription(provider)
    }))
  );
  const provider = providers.find((candidate) => candidate.id === providerId);
  if (!provider) return;

  if (provider.authType === "oauth") {
    await loginOAuthProvider(io, authStorage, modelRegistry, provider.id, provider.name, authPath);
  } else {
    await saveApiKeyProvider(io, authStorage, modelRegistry, provider.id, provider.name);
  }
}

function providerDescription(provider: ProviderOption): string {
  const parts: string[] = [];
  if (provider.configured) parts.push(provider.source ? `configured via ${provider.source}` : "configured");
  return parts.join("; ") || (provider.authType === "oauth" ? "subscription/OAuth provider" : "API-key provider");
}

async function loginOAuthProvider(
  io: SetupIO,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  providerId: string,
  providerName: string,
  authPath: string
): Promise<void> {
  const provider = authStorage.getOAuthProviders().find((candidate) => candidate.id === providerId);
  if (!provider) throw new Error(`Unknown OAuth provider: ${providerId}`);

  const manualInputAbort = new AbortController();
  try {
    await authStorage.login(providerId, {
      onAuth: (info) => renderOAuthAuthInfo(io, providerName, info),
      onDeviceCode: (info) => renderOAuthDeviceCode(io, providerName, info),
      onPrompt: (prompt) => promptOAuthInput(io, prompt),
      onProgress: (message) => io.write(`${message}\n`),
      onSelect: (prompt) => selectOAuthOption(io, prompt),
      onManualCodeInput: provider.usesCallbackServer
        ? () => promptManualOAuthCode(io, manualInputAbort.signal)
        : undefined,
      signal: manualInputAbort.signal
    });
  } finally {
    manualInputAbort.abort();
  }

  modelRegistry.refresh();
  io.write(`Saved OAuth credentials for ${providerName} in ${authPath}.\n`);
}

function renderOAuthAuthInfo(io: SetupIO, providerName: string, info: OAuthAuthInfo): void {
  io.write(`\n${providerName} login\n`);
  if (info.instructions) io.write(`${info.instructions}\n`);
  io.write(`${info.url}\n`);
}

function renderOAuthDeviceCode(io: SetupIO, providerName: string, info: OAuthDeviceCodeInfo): void {
  io.write(`\n${providerName} device login\n`);
  io.write(`Open: ${info.verificationUri}\n`);
  io.write(`Code: ${info.userCode}\n`);
}

async function promptOAuthInput(io: SetupIO, prompt: OAuthPrompt): Promise<string> {
  const value = await io.input(prompt.message, { allowEmpty: prompt.allowEmpty });
  if (value === undefined || (!prompt.allowEmpty && !value.trim())) throw new Error("Login cancelled");
  return value;
}

async function selectOAuthOption(io: SetupIO, prompt: OAuthSelectPrompt): Promise<string | undefined> {
  return io.select(
    prompt.message,
    prompt.options.map((option) => ({ value: option.id, label: option.label }))
  );
}

async function promptManualOAuthCode(io: SetupIO, signal: AbortSignal): Promise<string> {
  const value = await io.input("Paste the redirect URL or authorization code:", { allowEmpty: false, signal });
  if (!value?.trim()) throw new Error("Login cancelled");
  return value;
}

async function saveApiKeyProvider(
  io: SetupIO,
  authStorage: AuthStorage,
  modelRegistry: ModelRegistry,
  providerId: string,
  providerName: string
): Promise<void> {
  if (providerId === BEDROCK_PROVIDER_ID) {
    io.write("Amazon Bedrock uses AWS credentials rather than a single API key.\n");
    io.write("Configure AWS_PROFILE, IAM environment variables, bearer token, ECS credentials, or IRSA.\n");
    return;
  }

  const value = await io.input(`Enter API key for ${providerName}:`, { secret: true, allowEmpty: false });
  const apiKey = value?.trim();
  if (!apiKey) {
    io.write("Skipped API key setup.\n");
    return;
  }

  authStorage.set(providerId, { type: "api_key", key: apiKey });
  modelRegistry.refresh();
  io.write(`Saved API key for ${providerName}.\n`);
}

async function configureToolCredentials(
  io: SetupIO,
  options: { home?: string; env: NodeJS.ProcessEnv }
): Promise<void> {
  const webChoice = await io.select("Configure Conject web search credentials:", [
    { value: "skip", label: "Skip web search", description: "OpenAlex paper search still works without a key." },
    { value: "tavily", label: "Tavily API key", description: "Enables hosted web search for recent implementation context." },
    { value: "searxng", label: "SearXNG URL", description: "Use a self-hosted SearXNG instance instead of Tavily." }
  ]);

  if (webChoice === "tavily") {
    await configureCredentialValue(io, options, "TAVILY_API_KEY", {
      label: "Tavily API key",
      secret: true,
      envValue: options.env.TAVILY_API_KEY
    });
  } else if (webChoice === "searxng") {
    await configureCredentialValue(io, options, "SEARXNG_BASE_URL", {
      label: "SearXNG base URL",
      envValue: options.env.SEARXNG_BASE_URL ?? options.env.CONJECT_SEARXNG_URL
    });
  }

  const mailtoChoice = await io.select("Configure OpenAlex polite-pool email:", [
    { value: "skip", label: "Skip OpenAlex email", description: "Paper search works without this optional value." },
    { value: "set", label: "Set OpenAlex email", description: "Adds OPENALEX_MAILTO for polite-pool OpenAlex requests." }
  ]);
  if (mailtoChoice === "set") {
    await configureCredentialValue(io, options, "OPENALEX_MAILTO", {
      label: "OpenAlex email",
      envValue: options.env.OPENALEX_MAILTO
    });
  }
}

async function configureCredentialValue(
  io: SetupIO,
  options: { home?: string; env: NodeJS.ProcessEnv },
  key: CredentialKey,
  details: { label: string; secret?: boolean; envValue?: string }
): Promise<void> {
  let value: string | undefined;
  if (details.envValue) {
    const source = await io.select(`${key} is already set in the current environment.`, [
      { value: "save-env", label: "Save current value", description: "Copy the current environment value into Conject credentials." },
      { value: "enter", label: "Enter new value", description: "Store a different value in Conject credentials." },
      { value: "skip", label: "Skip", description: "Leave this key unchanged." }
    ]);
    if (source === "save-env") value = details.envValue;
    else if (source === "enter") value = await io.input(`Enter ${details.label}:`, { secret: details.secret });
    else return;
  } else {
    value = await io.input(`Enter ${details.label} (leave blank to skip):`, {
      secret: details.secret,
      allowEmpty: true
    });
  }

  const trimmed = value?.trim();
  if (!trimmed) {
    io.write(`Skipped ${key}.\n`);
    return;
  }

  initializeCredentialStore({ home: options.home });
  const result = setCredentialValue(key, trimmed, { home: options.home });
  if (!options.env[key]) options.env[key] = trimmed;
  io.write(`Saved ${result.key} in ${result.path}.\n`);
}

export function createTerminalSetupIO(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout
): SetupIO {
  const write = (text: string) => output.write(text);
  const reader = createSetupLineReader(input, output);
  return {
    write,
    async select(message, choices) {
      if (choices.length === 0) return undefined;
      write(`${message}\n`);
      choices.forEach((choice, index) => {
        const suffix = choice.description ? ` - ${choice.description}` : "";
        write(`  ${index + 1}. ${choice.label}${suffix}\n`);
      });
      while (true) {
        const answer = await reader.read("Choice: ", { allowEmpty: false });
        if (answer === undefined) {
          write("\n");
          return undefined;
        }
        const index = Number.parseInt(answer ?? "", 10) - 1;
        if (index >= 0 && index < choices.length) {
          write("\n");
          return choices[index]?.value;
        }
        write(`Enter a number from 1 to ${choices.length}.\n`);
      }
    },
    input(message, options = {}) {
      return reader.read(`${message} `, options);
    }
  };
}

interface SetupLineReader {
  read(prompt: string, options: SetupInputOptions): Promise<string | undefined>;
}

function createSetupLineReader(input: NodeJS.ReadableStream, output: NodeJS.WritableStream): SetupLineReader {
  if (!isReadableTty(input)) return new BufferedLineReader(input, output);
  return {
    read(prompt, options) {
      return readInteractiveLine(input, output, prompt, options);
    }
  };
}

class BufferedLineReader implements SetupLineReader {
  private readonly linesPromise: Promise<string[]>;
  private index = 0;

  constructor(
    input: NodeJS.ReadableStream,
    private readonly output: NodeJS.WritableStream
  ) {
    this.linesPromise = readAllInputLines(input);
  }

  async read(prompt: string, options: SetupInputOptions): Promise<string | undefined> {
    if (options.signal?.aborted) throw new Error("Login cancelled");
    this.output.write(prompt);
    const lines = await this.linesPromise;
    this.output.write("\n");
    const answer = lines[this.index++];
    if (answer === undefined) return undefined;
    return normalizeInputAnswer(answer, options);
  }
}

async function readAllInputLines(input: NodeJS.ReadableStream): Promise<string[]> {
  const chunks: Buffer[] = [];
  for await (const chunk of input) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function readInteractiveLine(
  input: NodeJS.ReadableStream,
  output: NodeJS.WritableStream,
  prompt: string,
  options: SetupInputOptions
): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let muted = false;
    const isSecret = Boolean(options.secret && isTty(output));
    const promptOutput = isSecret
      ? new Writable({
          write(chunk, encoding, callback) {
            if (!muted) output.write(chunk, encoding);
            callback();
          }
        })
      : output;
    const rl = createInterface({ input, output: promptOutput, terminal: isTty(output) });
    const cleanup = () => {
      options.signal?.removeEventListener("abort", onAbort);
      rl.close();
    };
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (isSecret) output.write("\n");
      resolve(value);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => fail(new Error("Login cancelled"));
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted) {
      onAbort();
      return;
    }

    if (isSecret) {
      output.write(prompt);
      muted = true;
      rl.question("", (answer) => finish(normalizeInputAnswer(answer, options)));
    } else {
      rl.question(prompt, (answer) => finish(normalizeInputAnswer(answer, options)));
    }
  });
}

function normalizeInputAnswer(answer: string, options: SetupInputOptions): string | undefined {
  if (!options.allowEmpty && !answer.trim()) return undefined;
  return answer;
}

function isReadableTty(input: NodeJS.ReadableStream): boolean {
  return Boolean((input as NodeJS.ReadStream).isTTY);
}

function isTty(output: NodeJS.WritableStream): boolean {
  return Boolean((output as NodeJS.WriteStream).isTTY);
}
