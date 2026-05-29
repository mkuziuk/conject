import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { Type } from "typebox";
import { getMarkdownTheme, type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, Spacer, Text } from "@earendil-works/pi-tui";
import { textResult } from "./result.js";

export interface ArtifactDetails {
  path: string;
  bytes: number;
}

interface WriteArtifactParams {
  path: string;
  content: string;
}

interface PresentProposalParams {
  summary: string;
  content: string;
}

export interface ProposalDetails extends ArtifactDetails {
  summary: string;
  content: string;
}

export function safeFileSegment(value: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || "artifact";
}

export function resolveResearchArtifactPath(cwd: string, requestedPath: string): string {
  const normalized = requestedPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.trim()) throw new Error("Artifact path is required.");
  if (isAbsolute(requestedPath)) throw new Error("Artifact path must be relative.");

  const relativePath = normalized.startsWith("research/") ? normalized : `research/${normalized}`;
  if (!relativePath.endsWith(".md")) throw new Error("Conject artifacts must be Markdown files ending in .md.");

  const researchRoot = resolve(cwd, "research");
  const resolved = resolve(cwd, relativePath);
  if (resolved !== researchRoot && !resolved.startsWith(`${researchRoot}${sep}`)) {
    throw new Error("Artifact path must stay inside the research/ directory.");
  }
  if (basename(resolved) === ".md") throw new Error("Artifact path must include a file name.");
  return resolved;
}

export async function writeResearchArtifact(cwd: string, requestedPath: string, content: string): Promise<ArtifactDetails> {
  const filePath = resolveResearchArtifactPath(cwd, requestedPath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
  return {
    path: relative(cwd, filePath),
    bytes: Buffer.byteLength(content, "utf8")
  };
}

export function createWriteArtifactTool(): ToolDefinition {
  return {
    name: "conject_write_artifact",
    label: "Conject Artifact",
    description: "Write a visible Conject research Markdown artifact under research/.",
    promptSnippet: "conject_write_artifact writes visible Markdown research artifacts under research/.",
    promptGuidelines: [
      "Use conject_write_artifact for research/brief.md, researcher memos, review, and proposal artifacts.",
      "Do not use hidden run IDs or hidden Conject state."
    ],
    parameters: Type.Object({
      path: Type.String({ description: "Relative Markdown path under research/, for example research/brief.md." }),
      content: Type.String({ description: "Markdown content to write." })
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as WriteArtifactParams;
      const details = await writeResearchArtifact(ctx.cwd, input.path, input.content);
      return textResult(`Wrote ${details.path} (${details.bytes} bytes).`, details);
    }
  };
}

export function createPresentProposalTool(): ToolDefinition {
  return {
    name: "conject_present_proposal",
    label: "Conject Proposal",
    description: "Write research/proposal.md and present a concise implementation proposal summary in chat.",
    promptSnippet: "conject_present_proposal writes research/proposal.md and returns a concise proposal summary to the user.",
    promptGuidelines: [
      "Use conject_present_proposal for the final implementation proposal.",
      "Pass a concise summary that synthesizes research/review.md and the proposal.",
      "The full proposal is written to research/proposal.md; invite the user to request implementation or revisions."
    ],
    parameters: Type.Object({
      summary: Type.String({ description: "Concise chat summary of the review and implementation proposal." }),
      content: Type.String({ description: "Full Markdown implementation proposal." })
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as PresentProposalParams;
      const summary = input.summary.trim();
      const content = input.content.trim();
      const details = await writeResearchArtifact(ctx.cwd, "research/proposal.md", content);
      const proposalDetails: ProposalDetails = { ...details, summary, content };
      return textResult(
        [
          `Proposal written to ${details.path}.`,
          "",
          summary,
          "",
          "Reply with an implementation request to start the builder, or describe revisions."
        ].join("\n"),
        proposalDetails
      );
    },
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("conject proposal")), 0, 0);
    },
    renderResult: renderProposalResult
  };
}

function renderProposalResult(result: AgentToolResult<unknown>, options: { expanded: boolean; isPartial: boolean }, theme: any) {
  const details = result.details as ProposalDetails | undefined;
  if (!details) {
    const text = result.content[0]?.type === "text" ? result.content[0].text : "(no proposal)";
    return new Text(text, 0, 0);
  }

  const marker = options.isPartial ? theme.fg("warning", "[writing]") : theme.fg("success", "[proposal]");
  if (!options.expanded) {
    return new Text(
      [
        `${marker} ${theme.fg("accent", details.path)}`,
        theme.fg("toolOutput", details.summary),
        theme.fg("muted", "Reply with an implementation request to start the builder, or describe revisions."),
        theme.fg("muted", "(Ctrl+O to expand)")
      ].join("\n"),
      0,
      0
    );
  }

  const container = new Container();
  container.addChild(new Text(`${marker} ${theme.fg("accent", details.path)}`, 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("muted", "--- Summary ---"), 0, 0));
  container.addChild(new Text(theme.fg("toolOutput", details.summary), 0, 0));
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("muted", "--- Full Proposal ---"), 0, 0));
  container.addChild(new Markdown(details.content, 0, 0, getMarkdownTheme()));
  container.addChild(new Spacer(1));
  container.addChild(new Text(theme.fg("muted", "Reply with an implementation request to start the builder, or describe revisions."), 0, 0));
  return container;
}
