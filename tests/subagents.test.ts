import { describe, expect, it } from "vitest";
import { initTheme } from "@earendil-works/pi-coding-agent";
import {
  applyJsonEventToTrace,
  buildChildConjectArgs,
  createInitialTrace,
  createSpawnResearcherTool,
  summarizeMarkdown,
  validateReviewerOutput,
  type SpawnDetails
} from "../src/tools/subagents.js";

describe("subagent runtime helpers", () => {
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
