import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import { getMarkdownTheme, type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import {
  BUILD_MANIFEST_NAME,
  applyBuildManifest,
  chooseBuildId,
  defaultBuildIdFromProposal,
  getBuildPath
} from "../builds.js";
import { getConjectSkillsPath } from "../paths.js";
import { resolveResearcherWebSearchBudget, WEB_SEARCH_BUDGET_ENV } from "../search-budget.js";
import { loadSubagentPrompt } from "../subagent-prompts.js";
import { safeFileSegment, writeResearchArtifact } from "./artifacts.js";
import { textResult, truncateText } from "./result.js";

const DEFAULT_CHILD_OUTPUT_CHARS = 60_000;
const CHILD_TOOL_PREVIEW_CHARS = 80;
const SUMMARY_CHARS = 1_200;
const SUBAGENT_UPDATE_INTERVAL_MS = 2_000;

export interface ChildRunInput {
  cwd: string;
  systemPrompt: string;
  task: string;
  tools: string[];
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  onUpdate?: (trace: ChildRunTrace) => void;
}

export interface ChildRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  trace?: ChildRunTrace;
  rawStdout?: string;
}

export type ChildRunner = (input: ChildRunInput) => Promise<ChildRunResult>;

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: number;
  turns: number;
}

export type ChildDisplayItem =
  | { type: "toolCall"; name: string; args: Record<string, unknown> }
  | { type: "toolResult"; name: string; text: string }
  | { type: "text"; text: string };

export interface ChildRunTrace {
  task: string;
  items: ChildDisplayItem[];
  finalOutput: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  malformedLines: number;
}

export interface SpawnDetails {
  role: SubagentRole;
  status: "running" | "done" | "failed";
  title: string;
  taskId?: string;
  implementationPath?: string;
  manifestPath?: string;
  artifactPath?: string;
  errorArtifactPath?: string;
  exitCode?: number;
  stderr: string;
  outputChars: number;
  summary?: string;
  error?: string;
  trace: ChildRunTrace;
}

type SubagentRole = "researcher" | "reviewer" | "builder";

interface SpawnResearcherParams {
  taskId: string;
  title: string;
  question: string;
  context?: string;
  maxOutputChars?: number;
}

interface SpawnReviewerParams {
  objective: string;
  briefPath?: string;
  memoPaths?: string[];
  context?: string;
  maxOutputChars?: number;
}

interface SpawnBuilderParams {
  proposalPath?: string;
  buildId?: string;
  implementationRoot?: string;
  context?: string;
  maxOutputChars?: number;
}

const ResearcherParams = Type.Object({
  taskId: Type.String({ description: "Stable short task id, for example topic-1." }),
  title: Type.String({ description: "Short task title." }),
  question: Type.String({ description: "One specific research question." }),
  context: Type.Optional(Type.String({ description: "Relevant project/user context for the researcher." })),
  maxOutputChars: Type.Optional(Type.Number({ description: "Maximum memo chars to keep. Default 60000." }))
});

const ReviewerParams = Type.Object({
  objective: Type.String({ description: "Original user objective or research idea." }),
  briefPath: Type.Optional(Type.String({ description: "Path to the research brief, usually research/brief.md." })),
  memoPaths: Type.Optional(Type.Array(Type.String(), { description: "Researcher memo paths to review." })),
  context: Type.Optional(Type.String({ description: "Additional synthesis context." })),
  maxOutputChars: Type.Optional(Type.Number({ description: "Maximum review chars to keep. Default 60000." }))
});

const BuilderParams = Type.Object({
  proposalPath: Type.Optional(Type.String({ description: "Approved proposal path. Default research/proposal.md." })),
  buildId: Type.Optional(Type.String({ description: "Stable implementation id. Defaults to a slug from the proposal title." })),
  implementationRoot: Type.Optional(Type.String({ description: "Relative implementation root. Default implementations." })),
  context: Type.Optional(Type.String({ description: "Additional build context or user constraints." })),
  maxOutputChars: Type.Optional(Type.Number({ description: "Maximum build report chars to keep. Default 60000." }))
});

export function createSpawnResearcherTool(childRunner: ChildRunner = runChildConject): ToolDefinition {
  return {
    name: "conject_spawn_researcher",
    label: "Researcher",
    description: "Spawn a focused Conject researcher subagent for one bounded research task and save its memo.",
    promptSnippet: "conject_spawn_researcher delegates one bounded research task to an isolated researcher subagent.",
    promptGuidelines: [
      "Use researcher subagents for independent research topics.",
      "Give each researcher one precise question and enough context to work independently."
    ],
    parameters: ResearcherParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as SpawnResearcherParams;
      const maxOutputChars = boundOutput(input.maxOutputChars);
      const prompt = loadSubagentPrompt("researcher");
      const webSearchBudget = resolveResearcherWebSearchBudget(process.env);
      const task = [
        `# Research Task: ${input.title}`,
        "",
        `Task id: ${input.taskId}`,
        "",
        "## Question",
        input.question,
        "",
        "## Context",
        input.context?.trim() || "(none provided)",
        "",
        "## Search Budget",
        `You may call conject_web_search at most ${webSearchBudget} time${webSearchBudget === 1 ? "" : "s"}. Prefer conject_paper_search first; reserve web search for recent, implementation, documentation, dataset, or non-paper evidence.`,
        "",
        "## Required Memo Format",
        "- Summary",
        "- Key evidence",
        "- Method details and concrete examples: explain the method/mechanism, concrete inputs and outputs, assumptions, and at least one worked example tied to this task",
        "- Sources",
        "- Contradictions or uncertainty",
        "- Open questions"
      ].join("\n");

      const emit = makeSubagentUpdateEmitter(onUpdate, {
        role: "researcher",
        title: input.title,
        taskId: input.taskId
      });
      try {
        emit(createInitialTrace(task), "running");

        const result = await childRunner({
          cwd: ctx.cwd,
          systemPrompt: prompt.prompt,
          task,
          tools: prompt.tools,
          env: { [WEB_SEARCH_BUDGET_ENV]: String(webSearchBudget) },
          signal,
          onUpdate: (trace) => emit(trace, "running")
        });
        const trace = normalizeTrace(result, task);
        const output = truncateText(getChildOutput(result, trace), maxOutputChars);
        await assertChildSuccess(ctx.cwd, safeFileSegment(input.taskId), "researcher", result, output, trace);
        const artifact = await writeResearchArtifact(ctx.cwd, `research/agents/${safeFileSegment(input.taskId)}.md`, output);
        const summary = summarizeMarkdown(output, ["Summary", "Key evidence"]);
        const details: SpawnDetails = {
          role: "researcher",
          status: "done",
          title: input.title,
          taskId: input.taskId,
          artifactPath: artifact.path,
          exitCode: result.exitCode,
          stderr: result.stderr,
          outputChars: output.length,
          summary,
          trace: { ...trace, finalOutput: output }
        };
        return textResult(formatSubagentSuccessText(details), details);
      } finally {
        emit.cancelPending();
      }
    },
    renderCall(args, theme) {
      const input = args as SpawnResearcherParams;
      const title = input.title || input.taskId || "research task";
      return new Text(`${theme.fg("toolTitle", theme.bold("researcher"))} ${theme.fg("accent", title)}`, 0, 0);
    },
    renderResult: renderSubagentResult
  };
}

export function createSpawnReviewerTool(childRunner: ChildRunner = runChildConject): ToolDefinition {
  return {
    name: "conject_spawn_reviewer",
    label: "Reviewer",
    description: "Spawn a Conject reviewer subagent to rank research options and critique evidence.",
    promptSnippet: "conject_spawn_reviewer reviews researcher memos and writes research/review.md.",
    promptGuidelines: [
      "Use the reviewer after researcher memos exist.",
      "The reviewer should rank options and critique evidence before implementation is proposed."
    ],
    parameters: ReviewerParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as SpawnReviewerParams;
      const maxOutputChars = boundOutput(input.maxOutputChars);
      const prompt = loadSubagentPrompt("reviewer");
      const task = [
        "# Review Research Workflow",
        "",
        "## Objective",
        input.objective,
        "",
        "## Inputs",
        `Brief: ${input.briefPath ?? "research/brief.md"}`,
        `Memos: ${(input.memoPaths && input.memoPaths.length > 0 ? input.memoPaths : ["research/agents/*.md"]).join(", ")}`,
        "",
        "## Additional Context",
        input.context?.trim() || "(none provided)",
        "",
        "## Required Review Format",
        "- Ranked options",
        "- Evidence critique",
        "- Missing or weak evidence",
        "- Recommendation",
        "- Whether an implementation proposal is justified"
      ].join("\n");

      const emit = makeSubagentUpdateEmitter(onUpdate, {
        role: "reviewer",
        title: "Review research workflow"
      });
      try {
        emit(createInitialTrace(task), "running");

        const result = await childRunner({
          cwd: ctx.cwd,
          systemPrompt: prompt.prompt,
          task,
          tools: prompt.tools,
          signal,
          onUpdate: (trace) => emit(trace, "running")
        });
        const trace = normalizeTrace(result, task);
        const output = truncateText(getChildOutput(result, trace), maxOutputChars);
        await assertChildSuccess(ctx.cwd, "reviewer", "reviewer", result, output, trace);
        const reviewErrors = validateReviewerOutput(output);
        if (reviewErrors.length > 0) {
          const artifact = await writeChildErrorArtifact(ctx.cwd, "reviewer", "reviewer", result, output, reviewErrors, trace);
          throw new Error(`Reviewer output failed validation. Diagnostics written to ${artifact.path}: ${reviewErrors.join("; ")}`);
        }
        const artifact = await writeResearchArtifact(ctx.cwd, "research/review.md", output);
        const summary = summarizeMarkdown(output, ["Verdict", "Recommendation", "Recommended Next Scope"]);
        const details: SpawnDetails = {
          role: "reviewer",
          status: "done",
          title: "Review research workflow",
          artifactPath: artifact.path,
          exitCode: result.exitCode,
          stderr: result.stderr,
          outputChars: output.length,
          summary,
          trace: { ...trace, finalOutput: output }
        };
        return textResult(formatSubagentSuccessText(details), details);
      } finally {
        emit.cancelPending();
      }
    },
    renderCall(_args, theme) {
      return new Text(`${theme.fg("toolTitle", theme.bold("reviewer"))} ${theme.fg("accent", "research ranking")}`, 0, 0);
    },
    renderResult: renderSubagentResult
  };
}

export function createSpawnBuilderTool(childRunner: ChildRunner = runChildConject): ToolDefinition {
  return {
    name: "conject_spawn_builder",
    label: "Builder",
    description: "Spawn a Conject builder subagent to implement the approved research proposal in an isolated implementation folder.",
    promptSnippet: "conject_spawn_builder implements an approved Conject proposal under implementations/<buildId>/.",
    promptGuidelines: [
      "Use the builder for implementation after a Conject research proposal is approved or the user requests implementation.",
      "Do not implement researched proposals directly in the main session; delegate to the builder."
    ],
    parameters: BuilderParams,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as SpawnBuilderParams;
      const maxOutputChars = boundOutput(input.maxOutputChars);
      const proposalPath = input.proposalPath?.trim() || "research/proposal.md";
      const proposal = await readProjectFile(ctx.cwd, proposalPath);
      const review = await readOptionalProjectFile(ctx.cwd, "research/review.md");
      const requestedBuildId = input.buildId?.trim() || defaultBuildIdFromProposal(proposal);
      const implementationRoot = input.implementationRoot?.trim() || "implementations";
      const buildId = input.buildId?.trim()
        ? safeFileSegment(requestedBuildId)
        : chooseBuildId(ctx.cwd, requestedBuildId, implementationRoot);
      const buildPath = getBuildPath(ctx.cwd, buildId, implementationRoot);
      await mkdir(buildPath, { recursive: true });

      const prompt = loadSubagentPrompt("builder");
      const task = [
        `# Build Task: ${buildId}`,
        "",
        `Target project root: ${ctx.cwd}`,
        `Implementation directory: ${relative(ctx.cwd, buildPath)}`,
        `Approved proposal: ${proposalPath}`,
        "",
        "## Builder Contract",
        "- You are running with cwd set to the implementation directory.",
        "- Write implementation files only under this implementation directory.",
        "- You may inspect the target project root, but do not edit it directly.",
        `- Before finishing, write ${BUILD_MANIFEST_NAME} in the implementation directory.`,
        "- The manifest must list files that can later be merged into the target root.",
        "- If you create Python files or Python project metadata, create and use .venv in the implementation directory.",
        "- Run validation from the implementation directory and record commands in the manifest.",
        "",
        "## Approved Proposal",
        proposal,
        "",
        "## Review Context",
        review || "(no review artifact found)",
        "",
        "## Additional Context",
        input.context?.trim() || "(none provided)",
        "",
        "## Required Final Report Format",
        "## Summary",
        "In this section, explain what the implementation does, how to run it from the implementation directory, and the main validation command/result.",
        "## Files",
        "## Validation",
        "## Manifest",
        "## Open Questions"
      ].join("\n");

      const emit = makeSubagentUpdateEmitter(onUpdate, {
        role: "builder",
        title: `Build ${buildId}`,
        taskId: buildId
      });
      try {
        emit(createInitialTrace(task), "running", { implementationPath: relative(ctx.cwd, buildPath) });

        const result = await childRunner({
          cwd: buildPath,
          systemPrompt: prompt.prompt,
          task,
          tools: prompt.tools,
          signal,
          onUpdate: (trace) => emit(trace, "running", { implementationPath: relative(ctx.cwd, buildPath) })
        });
        const trace = normalizeTrace(result, task);
        const output = truncateText(getChildOutput(result, trace), maxOutputChars);
        await assertChildSuccess(ctx.cwd, buildId, "builder", result, output, trace);
        const validationErrors = await validateBuilderWorkspace(ctx.cwd, buildId, implementationRoot);
        if (validationErrors.length > 0) {
          const artifact = await writeChildErrorArtifact(ctx.cwd, buildId, "builder", result, output, validationErrors, trace);
          throw new Error(`Builder output failed validation. Diagnostics written to ${artifact.path}: ${validationErrors.join("; ")}`);
        }

        const manifestPath = relative(ctx.cwd, join(buildPath, BUILD_MANIFEST_NAME));
        const report = [
          output,
          "",
          "## Conject Build Metadata",
          "",
          `- Build id: ${buildId}`,
          `- Implementation: ${relative(ctx.cwd, buildPath)}`,
          `- Manifest: ${manifestPath}`
        ].join("\n").trim();
        const artifact = await writeResearchArtifact(ctx.cwd, `research/builds/${buildId}.md`, report);
        const summary = summarizeMarkdown(report, ["Summary", "Validation"]);
        const details: SpawnDetails = {
          role: "builder",
          status: "done",
          title: `Build ${buildId}`,
          taskId: buildId,
          implementationPath: relative(ctx.cwd, buildPath),
          manifestPath,
          artifactPath: artifact.path,
          exitCode: result.exitCode,
          stderr: result.stderr,
          outputChars: report.length,
          summary,
          trace: { ...trace, finalOutput: report }
        };
        return textResult(formatSubagentSuccessText(details), details);
      } finally {
        emit.cancelPending();
      }
    },
    renderCall(args, theme) {
      const input = args as SpawnBuilderParams;
      const title = input.buildId || input.proposalPath || "approved proposal";
      return new Text(`${theme.fg("toolTitle", theme.bold("builder"))} ${theme.fg("accent", title)}`, 0, 0);
    },
    renderResult: renderSubagentResult
  };
}

export function buildChildConjectArgs(input: Pick<ChildRunInput, "systemPrompt" | "task" | "tools">): string[] {
  return [
    "--mode",
    "json",
    "--no-session",
    "-p",
    "--system-prompt",
    input.systemPrompt,
    "--skill",
    getConjectSkillsPath(),
    "--tools",
    input.tools.join(","),
    input.task
  ];
}

export async function runChildConject(input: ChildRunInput): Promise<ChildRunResult> {
  const invocation = getChildInvocation(buildChildConjectArgs(input));

  return new Promise((resolve) => {
    const trace = createInitialTrace(input.task);
    const child = spawn(invocation.command, invocation.args, {
      cwd: input.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PI_SKIP_VERSION_CHECK: "1",
        CONJECT_INTERNAL_CHILD: "1",
        ...input.env
      }
    });

    let rawStdout = "";
    let stderr = "";
    let buffer = "";

    const processLine = (line: string) => {
      rawStdout += `${line}\n`;
      if (!line.trim()) return;
      const changed = applyJsonEventToTrace(line, trace);
      if (changed) input.onUpdate?.({ ...trace, items: [...trace.items], usage: { ...trace.usage } });
    };

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) processLine(line);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stderr += error.message;
      resolve({
        stdout: trace.finalOutput || rawStdout.trim(),
        stderr,
        exitCode: 1,
        trace,
        rawStdout
      });
    });
    child.on("close", (code) => {
      if (buffer.trim()) processLine(buffer);
      resolve({
        stdout: trace.finalOutput || rawStdout.trim(),
        stderr,
        exitCode: code ?? 0,
        trace,
        rawStdout
      });
    });

    if (input.signal) {
      const kill = () => child.kill("SIGTERM");
      if (input.signal.aborted) kill();
      else input.signal.addEventListener("abort", kill, { once: true });
    }
  });
}

export function getChildInvocation(args: string[]): { command: string; args: string[] } {
  const override = process.env.CONJECT_CHILD_COMMAND;
  if (override) return { command: override, args };

  const currentScript = process.argv[1];
  if (currentScript && existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  return { command: "conject", args };
}

export function createInitialTrace(task: string): ChildRunTrace {
  return {
    task,
    items: [],
    finalOutput: "",
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, turns: 0 },
    malformedLines: 0
  };
}

export function applyJsonEventToTrace(line: string, trace: ChildRunTrace): boolean {
  let event: any;
  try {
    event = JSON.parse(line);
  } catch {
    trace.malformedLines++;
    return true;
  }

  if (event.type === "message_end" && event.message) {
    collectMessage(event.message, trace);
    return true;
  }
  if (event.type === "tool_result_end" && event.message) {
    collectToolResult(event.message, trace);
    return true;
  }
  return false;
}

export function validateReviewerOutput(output: string): string[] {
  const checks: Array<[string, RegExp]> = [
    ["missing ## Verdict", /^## Verdict\b/im],
    ["missing ## Ranking", /^## Ranking\b/im],
    ["missing ## Evidence Grades", /^## Evidence Grades\b/im],
    ["missing ## Source Anchors", /^## Source Anchors\b/im],
    ["missing ## Missing Validation", /^## Missing Validation\b/im],
    ["missing ## Implementation Readiness", /^## Implementation Readiness\b/im],
    ["missing ## Recommended Next Scope", /^## Recommended Next Scope\b/im],
    ["missing ranking table", /^\|.*rank.*\|.*option.*\|.*evidence.*\|.*readiness.*\|.*rationale.*\|/im]
  ];
  return checks.filter(([, pattern]) => !pattern.test(output)).map(([message]) => message);
}

export function summarizeMarkdown(output: string, preferredHeadings: string[] = ["Summary"]): string {
  const sections = preferredHeadings
    .map((heading) => extractMarkdownSection(output, heading))
    .filter((section): section is string => Boolean(section));
  const text = sections.length > 0 ? sections.join("\n\n") : firstMeaningfulMarkdownBlock(output);
  return truncateText(text.trim(), SUMMARY_CHARS).trim();
}

function collectMessage(message: any, trace: ChildRunTrace): void {
  if (message.role !== "assistant") return;
  trace.usage.turns++;
  collectUsage(message, trace);
  if (message.model && typeof message.model === "string") trace.model = message.model;
  if (message.stopReason && typeof message.stopReason === "string") trace.stopReason = message.stopReason;
  if (message.errorMessage && typeof message.errorMessage === "string") trace.errorMessage = message.errorMessage;

  const texts: string[] = [];
  for (const part of message.content ?? []) {
    if (part?.type === "toolCall") {
      trace.items.push({
        type: "toolCall",
        name: String(part.name ?? "tool"),
        args: isRecord(part.arguments) ? part.arguments : {}
      });
    } else if (part?.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
      trace.items.push({ type: "text", text: part.text });
    }
  }
  if (texts.length > 0) trace.finalOutput = texts.join("\n").trim();
}

function collectToolResult(message: any, trace: ChildRunTrace): void {
  if (message.role !== "toolResult") return;
  const text = getTextContent(message.content);
  trace.items.push({
    type: "toolResult",
    name: String(message.toolName ?? "tool"),
    text: truncateText(text.trim(), 500)
  });
}

function collectUsage(message: any, trace: ChildRunTrace): void {
  const usage = message.usage;
  if (!usage) return;
  trace.usage.input += numeric(usage.input);
  trace.usage.output += numeric(usage.output);
  trace.usage.cacheRead += numeric(usage.cacheRead);
  trace.usage.cacheWrite += numeric(usage.cacheWrite);
  trace.usage.totalTokens = numeric(usage.totalTokens) || trace.usage.totalTokens;
  trace.usage.cost += numeric(usage.cost?.total);
}

function normalizeTrace(result: ChildRunResult, task: string): ChildRunTrace {
  if (result.trace) return result.trace;
  const trace = createInitialTrace(task);
  const output = result.stdout.trim();
  if (output) {
    trace.finalOutput = output;
    trace.items.push({ type: "text", text: output });
  }
  return trace;
}

function getChildOutput(result: ChildRunResult, trace: ChildRunTrace): string {
  return (trace.finalOutput || result.stdout || result.rawStdout || "").trim();
}

function makeSubagentUpdateEmitter(
  onUpdate: ((partial: AgentToolResult<SpawnDetails>) => void) | undefined,
  base: Pick<SpawnDetails, "role" | "title" | "taskId">
) {
  let emittedInitial = false;
  let emittedActivity = false;
  let lastEmitAt = 0;
  let pending: { trace: ChildRunTrace; status: SpawnDetails["status"]; extra: Partial<SpawnDetails> } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clearPending = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending = undefined;
  };

  const emitNow = (trace: ChildRunTrace, status: SpawnDetails["status"], extra: Partial<SpawnDetails>) => {
    const traceSnapshot = cloneTrace(trace);
    if (hasChildActivity(traceSnapshot)) emittedActivity = true;
    lastEmitAt = Date.now();
    onUpdate?.(
      textResult(formatSubagentProgressText(base.role, traceSnapshot), {
        ...base,
        status,
        stderr: "",
        outputChars: traceSnapshot.finalOutput.length,
        trace: traceSnapshot,
        ...extra
      })
    );
  };

  const schedulePending = () => {
    if (timer || !pending) return;
    const elapsed = Date.now() - lastEmitAt;
    const delay = Math.max(0, SUBAGENT_UPDATE_INTERVAL_MS - elapsed);
    timer = setTimeout(() => {
      timer = undefined;
      const next = pending;
      pending = undefined;
      if (next) emitNow(next.trace, next.status, next.extra);
    }, delay);
  };

  const emit = (trace: ChildRunTrace, status: SpawnDetails["status"], extra: Partial<SpawnDetails> = {}) => {
    if (!onUpdate) return;
    const traceSnapshot = cloneTrace(trace);
    const extraSnapshot = { ...extra };
    const activity = hasChildActivity(traceSnapshot);
    if (status !== "running") {
      clearPending();
      emitNow(traceSnapshot, status, extraSnapshot);
      return;
    }
    if (!emittedInitial || (!emittedActivity && activity)) {
      emitNow(traceSnapshot, status, extraSnapshot);
      emittedInitial = true;
      return;
    }
    pending = { trace: traceSnapshot, status, extra: extraSnapshot };
    schedulePending();
  };

  emit.cancelPending = clearPending;
  return emit;
}

function hasChildActivity(trace: ChildRunTrace): boolean {
  return trace.items.length > 0 || trace.finalOutput.trim().length > 0 || trace.malformedLines > 0;
}

function cloneTrace(trace: ChildRunTrace): ChildRunTrace {
  return {
    ...trace,
    items: trace.items.map(cloneDisplayItem),
    usage: { ...trace.usage }
  };
}

function cloneDisplayItem(item: ChildDisplayItem): ChildDisplayItem {
  if (item.type === "toolCall") return { ...item, args: { ...item.args } };
  return { ...item };
}

async function assertChildSuccess(
  cwd: string,
  artifactId: string,
  role: SubagentRole,
  result: ChildRunResult,
  output: string,
  trace: ChildRunTrace
): Promise<void> {
  if (result.exitCode === 0 && output.trim().length > 0) return;

  const reasons = [
    result.exitCode !== 0 ? `exit code ${result.exitCode}` : undefined,
    output.trim().length === 0 ? "empty output" : undefined,
    trace.errorMessage ? `model error: ${trace.errorMessage}` : undefined
  ].filter((reason): reason is string => Boolean(reason));
  const artifact = await writeChildErrorArtifact(cwd, artifactId, role, result, output, reasons, trace);
  throw new Error(`${role} subagent failed (${reasons.join(", ")}). Diagnostics written to ${artifact.path}.`);
}

async function writeChildErrorArtifact(
  cwd: string,
  artifactId: string,
  role: SubagentRole,
  result: ChildRunResult,
  output: string,
  reasons: string[],
  trace: ChildRunTrace
) {
  return writeResearchArtifact(
    cwd,
    `research/errors/${safeFileSegment(artifactId)}.md`,
    [
      `# ${role} subagent failure`,
      "",
      `Exit code: ${result.exitCode}`,
      "",
      "## Reasons",
      ...reasons.map((reason) => `- ${reason}`),
      "",
      "## Stderr",
      "```text",
      result.stderr.trim() || "(empty)",
      "```",
      "",
      "## Child Trace",
      formatTraceForArtifact(trace),
      "",
      "## Stdout",
      "```text",
      output.trim() || result.stdout.trim() || result.rawStdout?.trim() || "(empty)",
      "```"
    ].join("\n")
  );
}

async function readProjectFile(cwd: string, requestedPath: string): Promise<string> {
  const path = resolveProjectPath(cwd, requestedPath);
  return readFile(path, "utf8");
}

async function readOptionalProjectFile(cwd: string, requestedPath: string): Promise<string | undefined> {
  const path = resolveProjectPath(cwd, requestedPath);
  if (!existsSync(path)) return undefined;
  return readFile(path, "utf8");
}

function resolveProjectPath(cwd: string, requestedPath: string): string {
  const normalized = requestedPath.replace(/\\/g, "/").replace(/^\/+/, "").trim();
  if (!normalized) throw new Error("Project path is required.");
  if (isAbsolute(requestedPath)) throw new Error("Project path must be relative.");
  if (normalized.split("/").some((part) => part === "..")) throw new Error("Project path must not contain '..'.");
  const resolved = resolve(cwd, normalized);
  const root = resolve(cwd);
  if (resolved !== root && !resolved.startsWith(`${root}${sep}`)) throw new Error("Project path must stay inside the project.");
  return resolved;
}

async function validateBuilderWorkspace(cwd: string, buildId: string, implementationRoot: string): Promise<string[]> {
  const errors: string[] = [];
  const buildPath = getBuildPath(cwd, buildId, implementationRoot);
  const manifestPath = join(buildPath, BUILD_MANIFEST_NAME);
  if (!existsSync(manifestPath)) {
    errors.push(`missing ${BUILD_MANIFEST_NAME}`);
  } else {
    try {
      await applyBuildManifest(cwd, buildId, { dryRun: true, implementationRoot });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (workspaceNeedsPythonVenv(buildPath) && !hasPythonVenv(buildPath)) {
    errors.push("Python implementation output requires .venv in the implementation directory");
  }
  return errors;
}

function workspaceNeedsPythonVenv(root: string): boolean {
  for (const path of walkWorkspaceFiles(root)) {
    const relativePath = relative(root, path).replace(/\\/g, "/");
    if (relativePath.endsWith(".py")) return true;
    if (["pyproject.toml", "requirements.txt", "requirements-dev.txt", "setup.py"].includes(relativePath)) return true;
  }
  return false;
}

function hasPythonVenv(root: string): boolean {
  return existsSync(join(root, ".venv", "bin", "python")) || existsSync(join(root, ".venv", "Scripts", "python.exe"));
}

function walkWorkspaceFiles(root: string): string[] {
  const files: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if ([".venv", "__pycache__", "node_modules", ".git"].includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) files.push(path);
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) visit(root);
  return files;
}

function renderSubagentResult(
  result: AgentToolResult<unknown>,
  options: { expanded: boolean; isPartial: boolean },
  theme: any
) {
  const details = result.details as SpawnDetails | undefined;
  if (!details) {
    const text = result.content[0]?.type === "text" ? result.content[0].text : "(no output)";
    return new Text(text, 0, 0);
  }

  const status = options.isPartial ? "running" : details.status;
  const marker =
    status === "failed" ? theme.fg("error", "[failed]") : status === "running" ? theme.fg("warning", "[running]") : theme.fg("success", "[done]");
  const heading = `${marker} ${theme.fg("toolTitle", theme.bold(details.role))} ${theme.fg("accent", details.title)}`;
  const trace = details.trace ?? createInitialTrace("");

  if (options.expanded) {
    const container = new Container();
    container.addChild(new Text(heading, 0, 0));
    if (details.artifactPath) container.addChild(new Text(theme.fg("dim", `Artifact: ${details.artifactPath}`), 0, 0));
    if (details.errorArtifactPath) container.addChild(new Text(theme.fg("error", `Diagnostics: ${details.errorArtifactPath}`), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "--- Task ---"), 0, 0));
    container.addChild(new Text(theme.fg("dim", trace.task || "(unknown task)"), 0, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Text(theme.fg("muted", "--- Child Activity ---"), 0, 0));
    const items = trace.items.length > 0 ? trace.items : [{ type: "text" as const, text: "(no child activity yet)" }];
    for (const item of items) container.addChild(new Text(formatDisplayItem(item, theme, true), 0, 0));
    if (details.stderr.trim()) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("error", `stderr: ${truncateText(details.stderr.trim(), 1_000)}`), 0, 0));
    }
    if (trace.finalOutput.trim()) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("muted", "--- Final Output ---"), 0, 0));
      container.addChild(new Markdown(trace.finalOutput.trim(), 0, 0, getMarkdownTheme()));
    }
    const usage = formatUsage(trace);
    if (usage) {
      container.addChild(new Spacer(1));
      container.addChild(new Text(theme.fg("dim", usage), 0, 0));
    }
    return container;
  }

  const toolCalls = trace.items.filter((item): item is Extract<ChildDisplayItem, { type: "toolCall" }> => item.type === "toolCall");
  const lastCalls = toolCalls.slice(-3);
  let text = heading;
  if (details.artifactPath) text += `\n${theme.fg("dim", details.artifactPath)}`;
  if (details.summary) text += `\n${theme.fg("toolOutput", truncateText(details.summary, 450))}`;
  if (lastCalls.length > 0) {
    text += `\n${theme.fg("muted", "Last child tool calls:")}`;
    text += `\n${lastCalls.map((item) => formatDisplayItem(item, theme, false)).join("\n")}`;
  } else if (status === "running") {
    text += `\n${theme.fg("muted", "(waiting for child activity)")}`;
  }
  text += `\n${theme.fg("muted", "(Ctrl+O to expand)")}`;
  return new Text(text, 0, 0);
}

function formatSubagentSuccessText(details: SpawnDetails): string {
  return [
    `${capitalize(details.role)} output written to ${details.artifactPath}.`,
    "",
    details.summary ? `Summary:\n${details.summary}` : "Summary: (none extracted)",
    "",
    `Full output is available in ${details.artifactPath}.`
  ].join("\n");
}

function formatSubagentProgressText(role: SubagentRole, trace: ChildRunTrace): string {
  const toolCalls = trace.items.filter((item) => item.type === "toolCall").length;
  return `${capitalize(role)} running: ${toolCalls} child tool call${toolCalls === 1 ? "" : "s"} observed.`;
}

function formatDisplayItem(item: ChildDisplayItem, theme: any, expanded: boolean): string {
  if (item.type === "toolCall") return `${theme.fg("muted", "-> ")}${formatToolCall(item.name, item.args, theme)}`;
  if (item.type === "toolResult") {
    const preview = expanded ? item.text : truncateText(item.text.replace(/\s+/g, " "), CHILD_TOOL_PREVIEW_CHARS);
    return `${theme.fg("muted", "<- ")}${theme.fg("accent", item.name)} ${theme.fg("dim", preview)}`;
  }
  const text = expanded ? item.text : truncateText(item.text.replace(/\s+/g, " "), CHILD_TOOL_PREVIEW_CHARS);
  return theme.fg("toolOutput", text);
}

function formatToolCall(name: string, args: Record<string, unknown>, theme: any): string {
  const path = String(args.path ?? args.file_path ?? args.cwd ?? "");
  switch (name) {
    case "bash":
      return theme.fg("muted", "$ ") + theme.fg("toolOutput", truncateText(String(args.command ?? ""), 80));
    case "read": {
      const range = args.offset || args.limit ? `:${String(args.offset ?? 1)}${args.limit ? `+${String(args.limit)}` : ""}` : "";
      return theme.fg("muted", "read ") + theme.fg("accent", `${path || "..."}${range}`);
    }
    case "write": {
      const content = String(args.content ?? "");
      const lines = content ? content.split("\n").length : 0;
      return theme.fg("muted", "write ") + theme.fg("accent", path || "...") + theme.fg("dim", lines ? ` (${lines} lines)` : "");
    }
    case "grep":
      return theme.fg("muted", "grep ") + theme.fg("accent", String(args.pattern ?? "")) + theme.fg("dim", path ? ` in ${path}` : "");
    case "find":
      return theme.fg("muted", "find ") + theme.fg("accent", String(args.pattern ?? "*")) + theme.fg("dim", path ? ` in ${path}` : "");
    case "ls":
      return theme.fg("muted", "ls ") + theme.fg("accent", path || ".");
    default: {
      const raw = JSON.stringify(args);
      return theme.fg("accent", name) + theme.fg("dim", raw ? ` ${truncateText(raw, 70)}` : "");
    }
  }
}

function formatUsage(trace: ChildRunTrace): string {
  const parts: string[] = [];
  if (trace.usage.turns) parts.push(`${trace.usage.turns} turns`);
  if (trace.usage.input) parts.push(`in ${trace.usage.input}`);
  if (trace.usage.output) parts.push(`out ${trace.usage.output}`);
  if (trace.usage.cacheRead) parts.push(`cache ${trace.usage.cacheRead}`);
  if (trace.usage.cost) parts.push(`$${trace.usage.cost.toFixed(4)}`);
  if (trace.model) parts.push(trace.model);
  if (trace.stopReason) parts.push(`stop ${trace.stopReason}`);
  return parts.join(" | ");
}

function formatTraceForArtifact(trace: ChildRunTrace): string {
  const lines = trace.items.map((item) => {
    if (item.type === "toolCall") return `- tool: ${item.name} ${JSON.stringify(item.args)}`;
    if (item.type === "toolResult") return `- result: ${item.name} ${item.text.replace(/\s+/g, " ").slice(0, 200)}`;
    return `- text: ${item.text.replace(/\s+/g, " ").slice(0, 200)}`;
  });
  return lines.length > 0 ? lines.join("\n") : "(empty)";
}

function extractMarkdownSection(output: string, heading: string): string | undefined {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^#{1,3}\\s+${escaped}\\s*$`, "im");
  const match = pattern.exec(output);
  if (!match) return undefined;
  const start = match.index + match[0].length;
  const rest = output.slice(start);
  const next = rest.search(/^#{1,3}\s+\S/m);
  return (next >= 0 ? rest.slice(0, next) : rest).trim();
}

function firstMeaningfulMarkdownBlock(output: string): string {
  return output
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .find((block) => block && !block.startsWith("---")) ?? output.trim();
}

function getTextContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => Boolean(part) && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function boundOutput(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_CHILD_OUTPUT_CHARS;
  return Math.max(4_000, Math.min(120_000, Math.floor(value as number)));
}

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
