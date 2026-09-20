import test from "node:test";
import assert from "node:assert/strict";
import { buildProjectBootstrapTurn, PROJECT_SNAPSHOT_COMMAND } from "../src/project-bootstrap.js";

const bashTool = {
  type: "function" as const,
  function: {
    name: "bash",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
};

test("builds a read-only project snapshot as a synthetic bash tool call", () => {
  const turn = buildProjectBootstrapTurn([bashTool]);
  if (!turn) assert.fail("expected bootstrap turn");
  assert.equal(turn.finishReason, "tool_calls");
  assert.equal(turn.content, null);
  assert.equal(turn.toolCalls.length, 1);
  assert.equal(turn.toolCalls[0].function.name, "bash");
  const args = JSON.parse(turn.toolCalls[0].function.arguments);
  assert.equal(args.command, PROJECT_SNAPSHOT_COMMAND);
  assert.match(args.command, /pwd/);
  assert.match(args.command, /ls -la/);
  assert.match(args.command, /git status --short --branch/);
  assert.match(args.command, /package\.json/);
  assert.match(args.command, /README\.md/);
});

test("does not bootstrap when Pi does not expose bash", () => {
  const turn = buildProjectBootstrapTurn([{ type: "function", function: { name: "read", parameters: { type: "object", properties: { path: { type: "string" } } } } }]);
  assert.equal(turn, null);
});

test("supports bash schemas that call the command argument cmd", () => {
  const turn = buildProjectBootstrapTurn([{ type: "function", function: { name: "bash", parameters: { type: "object", properties: { cmd: { type: "string" } } } } }]);
  if (!turn) assert.fail("expected bootstrap turn");
  assert.equal(JSON.parse(turn.toolCalls[0].function.arguments).cmd, PROJECT_SNAPSHOT_COMMAND);
});
