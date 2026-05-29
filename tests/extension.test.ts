import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ExtensionHandler,
  InputEvent,
  InputEventResult,
  RegisteredCommand,
  ToolDefinition
} from "@earendil-works/pi-coding-agent";
import { createConjectExtensionFactory } from "../src/extension.js";
import type { ChildRunner } from "../src/tools/subagents.js";

describe("Conject extension", () => {
  it("registers minimal commands and the Conject tools", async () => {
    const pi = new FakePi();
    await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);

    expect([...pi.commands.keys()].sort()).toEqual(["conject-doctor", "thinking"]);
    expect([...pi.tools.keys()].sort()).toEqual([
      "conject_extract_pdf",
      "conject_paper_search",
      "conject_present_proposal",
      "conject_spawn_researcher",
      "conject_spawn_reviewer",
      "conject_web_search",
      "conject_write_artifact"
    ]);
  });

  it("prints doctor information through /conject-doctor", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);
      await pi.command("conject-doctor").handler("", fakeCommandContext(dir));

      expect(pi.messages).toHaveLength(1);
      expect(String(pi.messages[0]?.content)).toContain("Conject package:");
      expect(String(pi.messages[0]?.content)).toContain("Registered Conject tools:");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails visibly when a researcher subagent fails", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const failingRunner: ChildRunner = async () => ({ stdout: "", stderr: "duplicate extension conflict", exitCode: 1 });
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: failingRunner })(pi.api);

      await expect(
        pi.tool("conject_spawn_researcher").execute(
          "tool-1",
          {
            taskId: "Topic 1",
            title: "Rank evidence",
            question: "What evidence matters?"
          },
          undefined,
          undefined,
          fakeContext(dir)
        )
      ).rejects.toThrow(/researcher subagent failed/);

      expect(existsSync(join(dir, "research", "agents", "topic-1.md"))).toBe(false);
      expect(readFileSync(join(dir, "research", "errors", "topic-1.md"), "utf8")).toContain(
        "duplicate extension conflict"
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes structured reviewer output to research/review.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: reviewerChildRunner })(pi.api);
      await pi
        .tool("conject_spawn_reviewer")
        .execute("tool-1", { objective: "rank ideas" }, undefined, undefined, fakeContext(dir));

      expect(readFileSync(join(dir, "research", "review.md"), "utf8")).toContain("## Ranking");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects imprecise reviewer output", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);

      await expect(
        pi
          .tool("conject_spawn_reviewer")
          .execute("tool-1", { objective: "rank ideas" }, undefined, undefined, fakeContext(dir))
      ).rejects.toThrow(/Reviewer output failed validation/);

      expect(readFileSync(join(dir, "research", "errors", "reviewer.md"), "utf8")).toContain("missing ## Verdict");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("presents proposals in chat and writes research/proposal.md", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);
      const result = await pi
        .tool("conject_present_proposal")
        .execute(
          "tool-1",
          { summary: "Review says this is ready. Build the thing.", content: "# Proposal\n\nBuild the thing." },
          undefined,
          undefined,
          fakeContext(dir)
        );

      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("Review says this is ready");
      expect(text).not.toContain("# Proposal");
      expect(text).toContain("Reply `build this`");
      expect((result.details as { content?: string }).content).toContain("# Proposal");
      expect(readFileSync(join(dir, "research", "proposal.md"), "utf8")).toContain("Build the thing.");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("turns 'build this' into a builder handoff when a proposal exists", async () => {
      const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
      try {
        const pi = new FakePi();
        await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);
        mkdirSync(join(dir, "research"), { recursive: true });
        writeFileSync(join(dir, "research", "proposal.md"), "# Proposal\n\nApproved work.", "utf8");

      const result = await pi.emitInput({ type: "input", text: "build this", source: "interactive" }, fakeContext(dir));

      expect(result.action).toBe("transform");
      if (result.action === "transform") {
        expect(result.text).toContain("## Builder Guidance");
        expect(result.text).toContain("Approved work.");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("shows, sets, and validates thinking levels", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);
      const ctx = fakeCommandContext(dir, pi);

      await pi.command("thinking").handler("", ctx);
      expect(String(pi.messages.at(-1)?.content)).toContain("Current thinking level: medium");

      await pi.command("thinking").handler("high", ctx);
      expect(pi.thinkingLevel).toBe("high");
      expect(ctx.fakeUi.statuses.get("conject-thinking")).toBe("thinking high");

      await pi.command("thinking").handler("maximum", ctx);
      expect(String(pi.messages.at(-1)?.content)).toContain("Invalid thinking level");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes researcher subagent output to a visible memo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);
      const result = await pi.tool("conject_spawn_researcher").execute(
        "tool-1",
        {
          taskId: "Topic 1",
          title: "Rank evidence",
          question: "What evidence matters?"
        },
        undefined,
        undefined,
        fakeContext(dir)
      );

      expect(result.content[0]?.type).toBe("text");
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("Full output is available in research/agents/topic-1.md");
      expect(existsSync(join(dir, "research", "agents", "topic-1.md"))).toBe(true);
      expect(readFileSync(join(dir, "research", "agents", "topic-1.md"), "utf8")).toContain("Fixture child output");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("streams researcher subagent progress through tool updates", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-extension-"));
    try {
      const streamingRunner: ChildRunner = async (input) => {
        input.onUpdate?.({
          task: input.task,
          finalOutput: "",
          malformedLines: 0,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: 0, turns: 0 },
          items: [{ type: "toolCall", name: "read", args: { path: "paper.md" } }]
        });
        return { stdout: "## Summary\n\nDone.", stderr: "", exitCode: 0 };
      };
      const updates: unknown[] = [];
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: streamingRunner })(pi.api);
      await pi.tool("conject_spawn_researcher").execute(
        "tool-1",
        {
          taskId: "Topic 1",
          title: "Rank evidence",
          question: "What evidence matters?"
        },
        undefined,
        (partial) => updates.push(partial.details),
        fakeContext(dir)
      );

      expect(updates.length).toBeGreaterThanOrEqual(2);
      expect(JSON.stringify(updates)).toContain("paper.md");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns a no-provider message for web search without configuration", async () => {
    const oldTavily = process.env.TAVILY_API_KEY;
    const oldSearx = process.env.SEARXNG_BASE_URL;
    const oldConjectSearx = process.env.CONJECT_SEARXNG_URL;
    delete process.env.TAVILY_API_KEY;
    delete process.env.SEARXNG_BASE_URL;
    delete process.env.CONJECT_SEARXNG_URL;
    try {
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);
      const result = await pi
        .tool("conject_web_search")
        .execute("tool-1", { query: "test", limit: 2 }, undefined, undefined, fakeContext(process.cwd()));
      expect(String(result.content[0]?.type === "text" ? result.content[0].text : "")).toContain(
        "No web search provider is configured"
      );
    } finally {
      process.env.TAVILY_API_KEY = oldTavily;
      process.env.SEARXNG_BASE_URL = oldSearx;
      process.env.CONJECT_SEARXNG_URL = oldConjectSearx;
    }
  });

  it("normalizes OpenAlex paper results", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/W1",
              title: "Useful Paper",
              publication_year: 2024,
              cited_by_count: 7,
              primary_location: { landing_page_url: "https://example.test/paper" },
              authorships: [{ author: { display_name: "Ada Lovelace" } }],
              abstract_inverted_index: { useful: [0], result: [1] }
            }
          ]
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    const pi = new FakePi();
    await createConjectExtensionFactory({ childRunner: fixtureChildRunner, fetch: fetchImpl as typeof fetch })(pi.api);

    const result = await pi
      .tool("conject_paper_search")
      .execute("tool-1", { query: "useful", limit: 1 }, undefined, undefined, fakeContext(process.cwd()));

    const text = result.content[0]?.type === "text" ? result.content[0].text : "";
    expect(text).toContain("Useful Paper");
    expect(text).toContain("Ada Lovelace");
    expect(text).toContain("useful result");
  });

  it("extracts text files through the PDF extraction tool", async () => {
    const dir = mkdtempSync(join(tmpdir(), "conject-pdf-"));
    try {
      writeFileSync(join(dir, "source.txt"), "plain text source", "utf8");
      const pi = new FakePi();
      await createConjectExtensionFactory({ childRunner: fixtureChildRunner })(pi.api);
      const result = await pi
        .tool("conject_extract_pdf")
        .execute("tool-1", { path: "source.txt" }, undefined, undefined, fakeContext(dir));
      const text = result.content[0]?.type === "text" ? result.content[0].text : "";
      expect(text).toContain("plain text source");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const fixtureChildRunner: ChildRunner = async (input) => ({
  stdout: `# Fixture child output\n\n${input.task}`,
  stderr: "",
  exitCode: 0
});

const reviewerChildRunner: ChildRunner = async () => ({
  stdout: [
    "## Verdict",
    "Implementation is justified now.",
    "",
    "## Ranking",
    "| Rank | Option | Evidence Grade | Implementation Readiness | Rationale |",
    "|---|---|---|---|---|",
    "| 1 | First option | B | Ready | Supported by memos |",
    "",
    "## Evidence Grades",
    "First option: B.",
    "",
    "## Source Anchors",
    "research/agents/topic.md",
    "",
    "## Missing Validation",
    "Need measured data.",
    "",
    "## Implementation Readiness",
    "Ready for a minimal implementation.",
    "",
    "## Recommended Next Scope",
    "Build the smallest useful version."
  ].join("\n"),
  stderr: "",
  exitCode: 0
});

class FakePi {
  readonly commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
  readonly tools = new Map<string, ToolDefinition>();
  readonly messages: Array<{ customType: string; content: unknown; display: boolean; details?: unknown }> = [];
  readonly handlers = new Map<string, Array<ExtensionHandler<any, any>>>();
  thinkingLevel = "medium";

  readonly api = {
    registerCommand: (name: string, command: Omit<RegisteredCommand, "name" | "sourceInfo">) => {
      this.commands.set(name, command);
    },
    registerTool: (tool: ToolDefinition) => {
      this.tools.set(tool.name, tool);
    },
    sendMessage: (message: { customType: string; content: unknown; display: boolean; details?: unknown }) => {
      this.messages.push(message);
    },
    on: (event: string, handler: ExtensionHandler<any, any>) => {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    },
    getThinkingLevel: () => this.thinkingLevel,
    setThinkingLevel: (level: string) => {
      this.thinkingLevel = level;
    }
  } as unknown as ExtensionAPI;

  command(name: string): Omit<RegisteredCommand, "name" | "sourceInfo"> {
    const command = this.commands.get(name);
    if (!command) throw new Error(`Missing command: ${name}`);
    return command;
  }

  tool(name: string): ToolDefinition {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Missing tool: ${name}`);
    return tool;
  }

  async emitInput(event: InputEvent, ctx: ExtensionContext): Promise<InputEventResult> {
    for (const handler of this.handlers.get("input") ?? []) {
      const result = await handler(event, ctx);
      if (result) return result;
    }
    return { action: "continue" };
  }
}

function fakeContext(cwd: string): ExtensionContext {
  return {
    cwd,
    hasUI: false,
    ui: fakeUi()
  } as ExtensionContext;
}

function fakeCommandContext(cwd: string, pi?: FakePi): ExtensionCommandContext & { fakeUi: ReturnType<typeof fakeUi> } {
  const ui = fakeUi();
  return {
    cwd,
    hasUI: true,
    ui,
    fakeUi: ui
  } as ExtensionCommandContext & { fakeUi: ReturnType<typeof fakeUi> };
}

function fakeUi() {
  const statuses = new Map<string, string | undefined>();
  return {
    statuses,
    setStatus: (key: string, text: string | undefined) => {
      statuses.set(key, text);
    }
  };
}
