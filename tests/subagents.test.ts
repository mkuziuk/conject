import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  applyJsonEventToTrace,
  buildChildConjectArgs,
  type ChildRunner,
  type ChildRunTrace,
  createInitialTrace,
  createSpawnBuilderTool,
  createSpawnResearcherTool,
  summarizeMarkdown,
  validateReviewerOutput,
  type SpawnDetails
} from "../src/tools/subagents.js";

describe("subagent runtime helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds child args without loading a duplicate extension", () => {
    const args = buildChildConjectArgs({
      systemPrompt: "child prompt",
      task: "do research",
      tools: ["read", "conject_paper_search"]
    });

    expect(args.slice(0, 2)).toEqual(["--mode", "json"]);
    expect(args).toContain("--system-prompt");
    expect(args).toContain("--skill");
    expect(args).toContain("--tools");
    expect(args).not.toContain("--extension");
  });

  it("parses child JSON events into a display trace", () => {
    const trace = createInitialTrace("research task");

    applyJsonEventToTrace(
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", name: "read", arguments: { path: "paper.md" } }],
          usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, totalTokens: 18, cost: { total: 0.01 } },
          model: "gpt-test",
          stopReason: "toolUse"
        }
      }),
      trace
    );
    applyJsonEventToTrace(
      JSON.stringify({
        type: "tool_result_end",
        message: { role: "toolResult", toolName: "read", content: [{ type: "text", text: "paper content" }] }
      }),
      trace
    );
    applyJsonEventToTrace(
      JSON.stringify({
        type: "message_end",
        message: { role: "assistant", content: [{ type: "text", text: "## Summary\n\nUseful result." }], stopReason: "stop" }
      }),
      trace
    );

    expect(trace.items).toEqual(
      expect.arrayContaining([
        { type: "toolCall", name: "read", args: { path: "paper.md" } },
        { type: "toolResult", name: "read", text: "paper content" }
      ])
    );
    expect(trace.finalOutput).toContain("Useful result");
    expect(trace.usage.input).toBe(10);
    expect(trace.model).toBe("gpt-test");
  });

  it("renders collapsed subagent rows with the last three child tool calls", () => {
    initTheme();
    const tool = createSpawnResearcherTool();
    const result = {
      content: [{ type: "text", text: "Researcher output written to research/agents/topic.md." }],
      details: {
        role: "researcher",
        status: "done",
        title: "Topic",
        artifactPath: "research/agents/topic.md",
        stderr: "",
        outputChars: 10,
        summary: "Short summary.",
        trace: {
          task: "task",
          finalOutput: "## Summary\n\nShort summary.",
          malformedLines: 0,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, turns: 0 },
          items: [
            { type: "toolCall", name: "read", args: { path: "first.md" } },
            { type: "toolCall", name: "grep", args: { pattern: "skin", path: "." } },
            { type: "toolCall", name: "conject_paper_search", args: { query: "hsi skin" } },
            { type: "toolCall", name: "conject_web_search", args: { query: "dataset" } }
          ]
        }
      } satisfies SpawnDetails
    };

    const collapsed = tool
      .renderResult?.(result as any, { expanded: false, isPartial: false }, fakeTheme(), {} as any)
      .render(120)
      .join("\n");
    const expanded = tool
      .renderResult?.(result as any, { expanded: true, isPartial: false }, fakeTheme(), {} as any)
      .render(120)
      .join("\n");

    expect(collapsed).not.toContain("first.md");
    expect(collapsed).toContain("conject_web_search");
    expect(collapsed).toContain("Ctrl+O");
    expect(expanded).toContain("first.md");
    expect(expanded).toContain("Final Output");
  });

  it("throttles rapid running subagent updates but keeps expanded snapshots current", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "conject-subagent-throttle-"));
    try {
      const updates: SpawnDetails[] = [];
      let task = "";
      const childRunner: ChildRunner = async (input) => {
        task = input.task;
        input.onUpdate?.(traceWithRead(input.task, "first.md"));
        input.onUpdate?.(traceWithRead(input.task, "second.md"));
        input.onUpdate?.(traceWithRead(input.task, "third.md"));
        await new Promise((resolve) => setTimeout(resolve, 2_100));
        const trace = traceWithRead(input.task, "third.md");
        trace.finalOutput = "## Summary\n\nDone.";
        return { stdout: trace.finalOutput, stderr: "", exitCode: 0, trace };
      };
      const tool = createSpawnResearcherTool(childRunner);
      const promise = tool.execute(
        "tool-1",
        { taskId: "topic", title: "Topic", question: "Question?" },
        undefined,
        (partial) => updates.push(partial.details as SpawnDetails),
        fakeContext(dir)
      );

      expect(updates).toHaveLength(2);
      expect(updates[0]?.trace.items).toHaveLength(0);
      expect(renderExpanded(tool, updates[1])).toContain("first.md");

      await vi.advanceTimersByTimeAsync(1_999);
      expect(updates).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(updates).toHaveLength(3);
      expect(renderExpanded(tool, updates[2])).toContain("third.md");

      await vi.advanceTimersByTimeAsync(100);
      await promise;
      expect(task).toContain("Question?");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes method details and concrete examples in researcher task instructions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-researcher-contract-"));
    try {
      let task = "";
      const childRunner: ChildRunner = async (input) => {
        task = input.task;
        return {
          stdout: [
            "## Summary",
            "Done.",
            "",
            "## Method Details and Concrete Examples",
            "Example.",
          ].join("\n"),
          stderr: "",
          exitCode: 0
        };
      };
      const tool = createSpawnResearcherTool(childRunner);
      await tool.execute(
        "tool-1",
        { taskId: "topic", title: "Topic", question: "Question?" },
        undefined,
        undefined,
        fakeContext(dir)
      );

      expect(task).toContain("Method details and concrete examples");
      expect(task).toContain("concrete inputs and outputs");
      expect(task).toContain("at least one worked example");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes what-it-does and how-to-run requirements in builder task instructions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-builder-contract-"));
    try {
      mkdirSync(join(dir, "research"), { recursive: true });
      writeFileSync(join(dir, "research", "proposal.md"), "# Demo Build\n\nImplement a demo.", "utf8");
      let task = "";
      const childRunner: ChildRunner = async (input) => {
        task = input.task;
        writeFileSync(
          join(input.cwd, "BUILD_MANIFEST.json"),
          JSON.stringify({ buildId: "demo-build", files: [] }),
          "utf8"
        );
        return {
          stdout: [
            "## Summary",
            "Builds a demo. Run it with npm test. Validation: not applicable.",
            "",
            "## Files",
            "",
            "## Validation",
            "",
            "## Manifest",
            "",
            "## Open Questions"
          ].join("\n"),
          stderr: "",
          exitCode: 0
        };
      };
      const tool = createSpawnBuilderTool(childRunner);
      await tool.execute(
        "tool-1",
        { proposalPath: "research/proposal.md", buildId: "demo-build" },
        undefined,
        undefined,
        fakeContext(dir)
      );

      expect(task).toContain("explain what the implementation does");
      expect(task).toContain("how to run it from the implementation directory");
      expect(task).toContain("main validation command/result");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cancels pending throttled subagent updates after completion", async () => {
    vi.useFakeTimers();
    const dir = mkdtempSync(join(tmpdir(), "conject-subagent-throttle-"));
    try {
      const updates: SpawnDetails[] = [];
      const childRunner: ChildRunner = async (input) => {
        input.onUpdate?.(traceWithRead(input.task, "first.md"));
        input.onUpdate?.(traceWithRead(input.task, "second.md"));
        return { stdout: "## Summary\n\nDone.", stderr: "", exitCode: 0 };
      };
      const tool = createSpawnResearcherTool(childRunner);
      await tool.execute(
        "tool-1",
        { taskId: "topic", title: "Topic", question: "Question?" },
        undefined,
        (partial) => updates.push(partial.details as SpawnDetails),
        fakeContext(dir)
      );

      expect(updates).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(updates).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates reviewer structure", () => {
    const valid = [
      "## Verdict",
      "Ready.",
      "",
      "## Ranking",
      "| Rank | Option | Evidence Grade | Implementation Readiness | Rationale |",
      "|---|---|---|---|---|",
      "| 1 | A | B | Ready | Good enough |",
      "",
      "## Evidence Grades",
      "A: B.",
      "",
      "## Source Anchors",
      "memo.md",
      "",
      "## Missing Validation",
      "Need more data.",
      "",
      "## Implementation Readiness",
      "Ready for minimal scope.",
      "",
      "## Recommended Next Scope",
      "Build a baseline."
    ].join("\n");

    expect(validateReviewerOutput(valid)).toEqual([]);
    expect(validateReviewerOutput("## Ranking\n\nNo table")).toEqual(
      expect.arrayContaining(["missing ## Verdict", "missing ranking table"])
    );
  });

  it("extracts concise Markdown summaries", () => {
    expect(summarizeMarkdown("## Summary\n\nShort.\n\n## Sources\n\nA", ["Summary"])).toBe("Short.");
    expect(summarizeMarkdown("# Title\n\nFallback block.\n\n## Later\n\nMore.", ["Missing"])).toBe("# Title");
  });
});

function fakeTheme() {
  return {
    fg: (_color: string, text: string) => text,
    bold: (text: string) => text
  };
}

function fakeContext(cwd: string) {
  return {
    cwd,
    hasUI: false,
    ui: {}
  } as any;
}

function traceWithRead(task: string, path: string): ChildRunTrace {
  const trace = createInitialTrace(task);
  trace.items.push({ type: "toolCall", name: "read", args: { path } });
  return trace;
}

function renderExpanded(tool: ReturnType<typeof createSpawnResearcherTool>, details: SpawnDetails | undefined): string {
  return tool
    .renderResult?.({ content: [{ type: "text", text: "running" }], details } as any, { expanded: true, isPartial: true }, fakeTheme(), {} as any)
    .render(120)
    .join("\n") ?? "";
}
