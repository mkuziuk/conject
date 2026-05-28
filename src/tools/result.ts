import type { AgentToolResult } from "@earendil-works/pi-coding-agent";

export function textResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return {
    content: [{ type: "text", text }],
    details
  } as AgentToolResult<TDetails>;
}

export function errorResult<TDetails>(text: string, details: TDetails): AgentToolResult<TDetails> {
  return textResult(text, details);
}

export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars))}\n\n[truncated: ${text.length - maxChars} chars omitted]`;
}
