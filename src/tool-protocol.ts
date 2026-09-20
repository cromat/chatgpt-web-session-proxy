import crypto from "node:crypto";
import type { AssistantTurn, ToolCall, ToolDefinition } from "./types.js";

const TOOL_BLOCK_RE = /```tool\s*\n([\s\S]*?)```/gi;
const XML_TOOL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
const SENTINEL_TOOL_RE = /\[\[PI_TOOL_CALL\]\]\s*([\s\S]*?)\s*\[\[\/PI_TOOL_CALL\]\]/gi;
const LINE_TOOL_RE = /(?:^|\n)PI_TOOL_CALL\s*:\s*(\{[^\n]*\})\s*(?=\n|$)/gi;
const RENDERED_FENCE_TOOL_RE = /(?:^|\n)tool\s*\n(?:copy(?: code)?\s*\n)?\s*(\{[\s\S]*\})\s*$/gi;
const ARG_BLOCK_RE = /\[\[PI_ARG:([A-Za-z0-9_.-]+)\]\]\r?\n?([\s\S]*?)\r?\n?\[\[\/PI_ARG\]\]/gi;

function parsePayload(payload: string): { name: string; arguments: unknown } | null {
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (!value || typeof value !== "object" || typeof value.name !== "string" || !value.name.trim()) return null;
    return { name: value.name.trim(), arguments: value.arguments ?? {} };
  } catch {
    return salvageLegacyWritePayload(payload);
  }
}

function decodeJsonEscapes(value: string): string {
  return value.replace(/\\(?:u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (escape) => {
    if (escape.startsWith("\\u")) return String.fromCharCode(Number.parseInt(escape.slice(2), 16));
    const map: Record<string, string> = {
      '\\"': '"',
      "\\\\": "\\",
      "\\/": "/",
      "\\b": "\b",
      "\\f": "\f",
      "\\n": "\n",
      "\\r": "\r",
      "\\t": "\t",
    };
    return map[escape] ?? escape;
  });
}

/**
 * Compatibility for v2 responses where ChatGPT returned a JSON-looking write
 * call but failed to escape quotes inside a large file body. This is purposely
 * narrow: only `write` is salvaged, and only path/content are reconstructed.
 */
function salvageLegacyWritePayload(payload: string): { name: string; arguments: unknown } | null {
  if (!/"name"\s*:\s*"write"/i.test(payload)) return null;
  const pathMatch = payload.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/i);
  const contentStart = payload.search(/"content"\s*:\s*"/i);
  if (!pathMatch || contentStart < 0) return null;

  const prefix = payload.slice(contentStart).match(/^"content"\s*:\s*"/i)?.[0];
  if (!prefix) return null;
  const bodyStart = contentStart + prefix.length;
  const suffixMatch = payload.slice(bodyStart).match(/"\s*}\s*}\s*$/);
  if (!suffixMatch || suffixMatch.index === undefined) return null;
  const rawContent = payload.slice(bodyStart, bodyStart + suffixMatch.index);

  return {
    name: "write",
    arguments: {
      path: decodeJsonEscapes(pathMatch[1]),
      content: decodeJsonEscapes(rawContent),
    },
  };
}

function toToolCall(parsed: { name: string; arguments: unknown }): ToolCall {
  return {
    id: `call_${crypto.randomUUID().replaceAll("-", "").slice(0, 24)}`,
    type: "function",
    function: {
      name: parsed.name,
      arguments: typeof parsed.arguments === "string" ? parsed.arguments : JSON.stringify(parsed.arguments),
    },
  };
}

function harvestMatches(text: string, re: RegExp): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of text.matchAll(re)) {
    const parsed = parsePayload(match[1].trim());
    if (parsed) calls.push(toToolCall(parsed));
  }
  return calls;
}

function schemaForTool(tools: ToolDefinition[], name: string): Record<string, unknown> | undefined {
  const parameters = tools.find((tool) => tool.function.name === name)?.function.parameters;
  if (!parameters || typeof parameters !== "object") return undefined;
  const properties = (parameters as Record<string, unknown>).properties;
  return properties && typeof properties === "object" ? properties as Record<string, unknown> : undefined;
}

function coerceArgument(raw: string, schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return raw;
  const type = (schema as Record<string, unknown>).type;
  if (type === "string") return raw;
  if (type === "integer") {
    const value = Number.parseInt(raw.trim(), 10);
    return Number.isNaN(value) ? raw : value;
  }
  if (type === "number") {
    const value = Number(raw.trim());
    return Number.isNaN(value) ? raw : value;
  }
  if (type === "boolean") {
    if (raw.trim() === "true") return true;
    if (raw.trim() === "false") return false;
    return raw;
  }
  if (type === "object" || type === "array") {
    try { return JSON.parse(raw); } catch { return raw; }
  }
  return raw;
}

/**
 * v3 protocol. Each argument gets its own literal block so arbitrary HTML,
 * source code, shell syntax, quotes, and newlines never need JSON escaping.
 */
function harvestArgumentBlockCalls(text: string, tools: ToolDefinition[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const match of text.matchAll(new RegExp(SENTINEL_TOOL_RE))) {
    const body = match[1];
    const name = body.match(/(?:^|\n)\s*name\s*:\s*([^\r\n]+)\s*(?:\r?\n|$)/i)?.[1]?.trim();
    if (!name) continue;

    const properties = schemaForTool(tools, name);
    const args: Record<string, unknown> = {};
    for (const argMatch of body.matchAll(new RegExp(ARG_BLOCK_RE))) {
      const key = argMatch[1];
      const raw = argMatch[2];
      args[key] = coerceArgument(raw, properties?.[key]);
    }
    if (Object.keys(args).length) calls.push(toToolCall({ name, arguments: args }));
  }
  return calls;
}

/**
 * ChatGPT Web responses are read from rendered DOM text. Markdown fences are
 * formatting and usually do not survive innerText(), so the primary protocol
 * uses literal sentinel strings that remain visible in the rendered text.
 */
export function parseAssistantTurn(text: string, tools: ToolDefinition[] = []): AssistantTurn {
  let calls = harvestArgumentBlockCalls(text, tools);
  if (calls.length === 0) calls = harvestMatches(text, new RegExp(SENTINEL_TOOL_RE));
  if (calls.length === 0) calls = harvestMatches(text, new RegExp(LINE_TOOL_RE));
  if (calls.length === 0) calls = harvestMatches(text, new RegExp(TOOL_BLOCK_RE));
  if (calls.length === 0) calls = harvestMatches(text, new RegExp(XML_TOOL_RE));
  if (calls.length === 0) calls = harvestMatches(text, new RegExp(RENDERED_FENCE_TOOL_RE));

  // Last-resort compatibility: if ChatGPT emits exactly one JSON tool object
  // without the requested wrapper, still translate it into a function call.
  if (calls.length === 0) {
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      const parsed = parsePayload(trimmed);
      if (parsed) calls = [toToolCall(parsed)];
    }
  }

  if (calls.length === 0 && /\[\[PI_TOOL_CALL\]\]/i.test(text)) {
    throw new Error("ChatGPT emitted PI_TOOL_CALL markers, but the proxy could not parse the tool call. This usually means the model deviated from protocol v3. Inspect the ChatGPT conversation and proxy logs.");
  }

  return calls.length
    ? { rawText: text, content: null, toolCalls: calls, finishReason: "tool_calls" }
    : { rawText: text, content: text, toolCalls: [], finishReason: "stop" };
}

export function renderToolInstructions(tools: ToolDefinition[]): string {
  if (!tools.length) return "";
  const specs = tools.map((tool) => ({
    name: tool.function.name,
    description: tool.function.description ?? "",
    parameters: tool.function.parameters ?? { type: "object", properties: {} },
  }));
  return [
    '<agent_tool_protocol version="3">',
    "You are serving as the reasoning backend for a local coding agent.",
    "The local agent, not you, executes tools. Never claim a tool ran unless its result is supplied later.",
    "If the user asks you to read, create, edit, delete, search, run, test, or otherwise act on the local project and an appropriate tool is available, you MUST call that tool instead of describing or claiming the action in prose.",
    "When a local tool is required, respond ONLY with one or more calls using this exact plain-text block format:",
    "[[PI_TOOL_CALL]]",
    "name: tool_name",
    "[[PI_ARG:argument_name]]",
    "raw argument value goes here; do not JSON-escape it",
    "[[/PI_ARG]]",
    "[[/PI_TOOL_CALL]]",
    "Use one PI_ARG block per argument. Preserve file contents and source code exactly inside PI_ARG blocks. Do NOT wrap the call in Markdown fences. Do NOT emit JSON for tool calls.",
    "Example for writing a file:",
    "[[PI_TOOL_CALL]]",
    "name: write",
    "[[PI_ARG:path]]",
    "example.html",
    "[[/PI_ARG]]",
    "[[PI_ARG:content]]",
    '<!DOCTYPE html><html lang="en"><body>Hello</body></html>',
    "[[/PI_ARG]]",
    "[[/PI_TOOL_CALL]]",
    "For multiple tool calls, repeat the complete PI_TOOL_CALL block once per call.",
    "After a tool result is provided, continue solving the task and call another tool if needed.",
    "When no tool is needed, answer normally without PI_TOOL_CALL markers.",
    "Available tools:",
    JSON.stringify(specs, null, 2),
    "</agent_tool_protocol>",
  ].join("\n");
}
