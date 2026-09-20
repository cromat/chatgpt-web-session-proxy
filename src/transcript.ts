import crypto from "node:crypto";
import { renderToolInstructions } from "./tool-protocol.js";
import type { ChatMessage, ToolDefinition } from "./types.js";

export function contentToText(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content;
  if (!content) return "";
  return content.filter((p) => p?.type === "text" || p?.type === "input_text").map((p) => p.text).join("\n");
}

function normalizedMessage(message: ChatMessage): unknown {
  return {
    role: message.role,
    content: contentToText(message.content),
    name: message.name ?? null,
    tool_call_id: message.tool_call_id ?? null,
    tool_calls: message.tool_calls?.map((call) => ({ id: call.id, type: call.type, function: call.function })) ?? null,
  };
}

export function fingerprintMessage(message: ChatMessage): string {
  return crypto.createHash("sha256").update(JSON.stringify(normalizedMessage(message))).digest("hex");
}

export function commonPrefixLength(a: ChatMessage[], b: ChatMessage[]): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  for (; i < max; i++) if (fingerprintMessage(a[i]) !== fingerprintMessage(b[i])) break;
  return i;
}

function renderMessage(message: ChatMessage): string {
  const content = contentToText(message.content);
  if (message.role === "tool") {
    return [`<tool_result id=${JSON.stringify(message.tool_call_id ?? "unknown")}${message.name ? ` name=${JSON.stringify(message.name)}` : ""}>`, content, "</tool_result>"].join("\n");
  }
  if (message.role === "assistant" && message.tool_calls?.length) {
    return message.tool_calls.map((call) => `<previous_tool_call id=${JSON.stringify(call.id)} name=${JSON.stringify(call.function.name)}>\n${call.function.arguments}\n</previous_tool_call>`).join("\n");
  }
  return `<${message.role}>\n${content}\n</${message.role}>`;
}

export function buildInitialPrompt(messages: ChatMessage[], tools: ToolDefinition[]): string {
  return [
    renderToolInstructions(tools),
    "<client_transcript>",
    messages.map(renderMessage).join("\n\n"),
    "</client_transcript>",
    "Continue from the final client message. Treat system/developer blocks above as instructions to follow when compatible with your higher-priority instructions.",
  ].filter(Boolean).join("\n\n");
}

export function buildDeltaPrompt(messages: ChatMessage[], tools: ToolDefinition[]): string {
  const reminder = tools.length ? "UPDATED TOOL PROTOCOL v3 (replaces all earlier tool formats): if another local tool is needed, use [[PI_TOOL_CALL]], a name: line, and one raw [[PI_ARG:argument_name]]...[[/PI_ARG]] block per argument. Do NOT emit JSON for tool calls and do not use Markdown fences." : "";
  return [messages.map(renderMessage).join("\n\n"), reminder].filter(Boolean).join("\n\n");
}
