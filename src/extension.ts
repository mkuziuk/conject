import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { createBuildHandoffMessage, hasResearchProposal, isBuildThisRequest } from "./build-handoff.js";
import { formatDoctorInfo, getDoctorInfo } from "./doctor.js";
import { createPresentProposalTool, createWriteArtifactTool } from "./tools/artifacts.js";
import { createPdfExtractTool } from "./tools/pdf.js";
import { createPaperSearchTool, createWebSearchTool } from "./tools/search.js";
import {
  type ChildRunner,
  createSpawnResearcherTool,
  createSpawnReviewerTool
} from "./tools/subagents.js";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
type ThinkingLevelName = (typeof THINKING_LEVELS)[number];

export interface ConjectExtensionOptions {
  childRunner?: ChildRunner;
  fetch?: typeof fetch;
}

export function createConjectExtensionFactory(options: ConjectExtensionOptions = {}): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const fetchImpl = options.fetch ?? fetch;

    pi.registerCommand("conject-doctor", {
      description: "Show Conject paths, version, skills, and tools.",
      handler: async (_args, ctx) => {
        const text = formatDoctorInfo(getDoctorInfo(ctx.cwd));
        pi.sendMessage({
          customType: "conject-doctor",
          content: text,
          display: true,
          details: getDoctorInfo(ctx.cwd)
        });
      }
    });

    pi.registerCommand("thinking", {
      description: "Show or set the current model reasoning effort.",
      handler: async (args, ctx) => {
        const requested = args.trim();
        if (!requested) {
          const current = pi.getThinkingLevel();
          const text = `Current thinking level: ${current}`;
          if (ctx.hasUI) ctx.ui.setStatus("conject-thinking", `thinking ${current}`);
          pi.sendMessage({ customType: "conject-thinking", content: text, display: true, details: { level: current } });
          return;
        }

        if (!isThinkingLevel(requested)) {
          const text = `Invalid thinking level: ${requested}\nValid levels: ${THINKING_LEVELS.join(", ")}`;
          pi.sendMessage({ customType: "conject-thinking", content: text, display: true, details: { error: "invalid" } });
          return;
        }

        pi.setThinkingLevel(requested);
        if (ctx.hasUI) ctx.ui.setStatus("conject-thinking", `thinking ${requested}`);
        pi.sendMessage({
          customType: "conject-thinking",
          content: `Thinking level set to: ${requested}`,
          display: true,
          details: { level: requested }
        });
      }
    });

    pi.registerTool(createPaperSearchTool(fetchImpl));
    pi.registerTool(createWebSearchTool(fetchImpl));
    pi.registerTool(createPdfExtractTool(fetchImpl));
    pi.registerTool(createWriteArtifactTool());
    pi.registerTool(createPresentProposalTool());
    pi.registerTool(createSpawnResearcherTool(options.childRunner));
    pi.registerTool(createSpawnReviewerTool(options.childRunner));

    pi.on("input", (event, ctx) => {
      if (!isBuildThisRequest(event.text) || !hasResearchProposal(ctx.cwd)) return { action: "continue" };
      return {
        action: "transform",
        text: createBuildHandoffMessage(ctx.cwd),
        images: event.images
      };
    });

    pi.on("session_start", (_event, ctx) => {
      if (ctx.hasUI) {
        ctx.ui.setStatus("conject", "Conject research tools loaded");
      }
    });
  };
}

export default function conjectExtension(pi: ExtensionAPI): void | Promise<void> {
  return createConjectExtensionFactory()(pi);
}

function isThinkingLevel(value: string): value is ThinkingLevelName {
  return THINKING_LEVELS.includes(value as ThinkingLevelName);
}
