import test from "node:test";
import assert from "node:assert/strict";
import { parseAssistantTurn, renderToolInstructions } from "../src/tool-protocol.js";

const writeTool = {
  type: "function" as const,
  function: {
    name: "write",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
      },
    },
  },
};

test("parses v3 raw argument blocks with unescaped HTML quotes", () => {
  const text = [
    "[[PI_TOOL_CALL]]",
    "name: write",
    "[[PI_ARG:path]]",
    "example.html",
    "[[/PI_ARG]]",
    "[[PI_ARG:content]]",
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<body class="demo">Hello</body>',
    '</html>',
    "[[/PI_ARG]]",
    "[[/PI_TOOL_CALL]]",
  ].join("\n");
  const turn = parseAssistantTurn(text, [writeTool]);
  assert.equal(turn.finishReason, "tool_calls");
  assert.equal(turn.content, null);
  assert.equal(turn.toolCalls.length, 1);
  assert.equal(turn.toolCalls[0].function.name, "write");
  assert.deepEqual(JSON.parse(turn.toolCalls[0].function.arguments), {
    path: "example.html",
    content: '<!DOCTYPE html>\n<html lang="en">\n<body class="demo">Hello</body>\n</html>',
  });
});

test("coerces non-string raw arguments using the Pi tool schema", () => {
  const readTool = {
    type: "function" as const,
    function: {
      name: "read",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, offset: { type: "integer" }, limit: { type: "integer" } },
      },
    },
  };
  const text = [
    "[[PI_TOOL_CALL]]",
    "name: read",
    "[[PI_ARG:path]]",
    "README.md",
    "[[/PI_ARG]]",
    "[[PI_ARG:offset]]",
    "10",
    "[[/PI_ARG]]",
    "[[PI_ARG:limit]]",
    "25",
    "[[/PI_ARG]]",
    "[[/PI_TOOL_CALL]]",
  ].join("\n");
  const turn = parseAssistantTurn(text, [readTool]);
  assert.deepEqual(JSON.parse(turn.toolCalls[0].function.arguments), { path: "README.md", offset: 10, limit: 25 });
});

test("salvages v2 malformed write JSON with unescaped quotes in content", () => {
  const text = '[[PI_TOOL_CALL]]\n{"name":"write","arguments":{"path":"example.html","content":"<!DOCTYPE html>\\n<html lang="en">\\n<body class="demo">Hi</body>\\n</html>\\n"}}\n[[/PI_TOOL_CALL]]';
  const turn = parseAssistantTurn(text, [writeTool]);
  assert.equal(turn.finishReason, "tool_calls");
  assert.equal(turn.toolCalls[0].function.name, "write");
  assert.deepEqual(JSON.parse(turn.toolCalls[0].function.arguments), {
    path: "example.html",
    content: '<!DOCTYPE html>\n<html lang="en">\n<body class="demo">Hi</body>\n</html>\n',
  });
});

test("parses legacy rendered-DOM sentinel JSON tool calls", () => {
  const turn = parseAssistantTurn('[[PI_TOOL_CALL]]\n{"name":"write","arguments":{"path":"hello.html","content":"<h1>Hello</h1>"}}\n[[/PI_TOOL_CALL]]');
  assert.equal(turn.finishReason, "tool_calls");
  assert.equal(turn.toolCalls.length, 1);
  assert.deepEqual(JSON.parse(turn.toolCalls[0].function.arguments), { path: "hello.html", content: "<h1>Hello</h1>" });
});

test("parses multiple v3 tool calls", () => {
  const text = [
    "[[PI_TOOL_CALL]]", "name: write", "[[PI_ARG:path]]", "a.txt", "[[/PI_ARG]]", "[[PI_ARG:content]]", "a", "[[/PI_ARG]]", "[[/PI_TOOL_CALL]]",
    "[[PI_TOOL_CALL]]", "name: write", "[[PI_ARG:path]]", "b.txt", "[[/PI_ARG]]", "[[PI_ARG:content]]", "b", "[[/PI_ARG]]", "[[/PI_TOOL_CALL]]",
  ].join("\n");
  const turn = parseAssistantTurn(text, [writeTool]);
  assert.equal(turn.toolCalls.length, 2);
  assert.equal(turn.toolCalls[0].function.name, "write");
  assert.equal(turn.toolCalls[1].function.name, "write");
});

test("keeps fenced tool format for backward compatibility", () => {
  const turn = parseAssistantTurn('```tool\n{"name":"bash","arguments":{"command":"pwd"}}\n```');
  assert.equal(turn.finishReason, "tool_calls");
  assert.equal(turn.toolCalls[0].function.name, "bash");
});

test("parses a bare JSON tool object as a last-resort fallback", () => {
  const turn = parseAssistantTurn('{"name":"read","arguments":{"path":"README.md"}}');
  assert.equal(turn.finishReason, "tool_calls");
  assert.equal(turn.toolCalls[0].function.name, "read");
});

test("normal text remains a normal assistant response", () => {
  const turn = parseAssistantTurn("No tool is needed for this answer.");
  assert.equal(turn.finishReason, "stop");
  assert.equal(turn.content, "No tool is needed for this answer.");
  assert.equal(turn.toolCalls.length, 0);
});

test("tool instructions use raw argument blocks and forbid JSON tool calls", () => {
  const text = renderToolInstructions([writeTool]);
  assert.match(text, /\[\[PI_TOOL_CALL\]\]/);
  assert.match(text, /\[\[PI_ARG:argument_name\]\]/);
  assert.match(text, /Do NOT emit JSON for tool calls/);
  assert.match(text, /name: write/);
});
