import crypto from "node:crypto";
import type { AssistantTurn, ToolCall, ToolDefinition } from "./types.js";

export const PROJECT_SNAPSHOT_COMMAND = [
  "printf '%s\\n' '=== PI PROJECT SNAPSHOT ==='",
  "printf '\\n--- working directory ---\\n'",
  "pwd",
  "printf '\\n--- top-level entries ---\\n'",
  "ls -la",
  "printf '\\n--- git status ---\\n'",
  "if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git status --short --branch; else printf '%s\\n' '(not a git repository)'; fi",
  "printf '\\n--- tracked files (first 200) ---\\n'",
  "if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files | sed -n '1,200p'; else printf '%s\\n' '(unavailable outside a git repository)'; fi",
  "for f in package.json pyproject.toml Cargo.toml go.mod composer.json deno.json deno.jsonc README.md README.rst README.txt README; do if [ -f \"$f\" ]; then printf '\\n--- %s (first 220 lines) ---\\n' \"$f\"; sed -n '1,220p' \"$f\"; fi; done",
].join("; ");

function objectProperties(tool: ToolDefinition): Record<string, unknown> | undefined {
  const parameters = tool.function.parameters;
  if (!parameters || typeof parameters !== "object") return undefined;
  const properties = (parameters as Record<string, unknown>).properties;
  return properties && typeof properties === "object" ? properties as Record<string, unknown> : undefined;
}

function bootstrapArguments(tool: ToolDefinition): Record<string, unknown> | null {
  const properties = objectProperties(tool);
  if (!properties || Object.keys(properties).length === 0 || "command" in properties) {
    return { command: PROJECT_SNAPSHOT_COMMAND };
  }
  if ("cmd" in properties) return { cmd: PROJECT_SNAPSHOT_COMMAND };
  if ("script" in properties) return { script: PROJECT_SNAPSHOT_COMMAND };
  return null;
}

export function buildProjectBootstrapTurn(tools: ToolDefinition[]): AssistantTurn | null {
  const bash = tools.find((tool) => tool.type === "function" && tool.function.name === "bash");
  if (!bash) return null;
  const args = bootstrapArguments(bash);
  if (!args) return null;

  const call: ToolCall = {
    id: `call_bootstrap_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
    type: "function",
    function: {
      name: "bash",
      arguments: JSON.stringify(args),
    },
  };

  return {
    rawText: "[automatic project snapshot]",
    content: null,
    toolCalls: [call],
    finishReason: "tool_calls",
  };
}
