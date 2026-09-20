import assert from "node:assert/strict";
import test from "node:test";
import { AUTO_SESSION_SENTINEL, resolveRequestSessionId } from "../src/session-id.js";

test("explicit X-ChatGPT-Session always wins", () => {
  assert.deepEqual(
    resolveRequestSessionId(
      {
        "x-chatgpt-session": "manual-session",
        "x-session-affinity": "pi-session",
      },
      true,
    ),
    { sessionId: "manual-session", source: "x-chatgpt-session" },
  );
});

test("auto mode accepts Pi x-session-affinity", () => {
  assert.deepEqual(resolveRequestSessionId({ "x-session-affinity": "pi-123" }, true), {
    sessionId: "pi-123",
    source: "x-session-affinity",
  });
});

test("auto mode falls back to x-client-request-id", () => {
  assert.deepEqual(resolveRequestSessionId({ "x-client-request-id": "pi-456" }, true), {
    sessionId: "pi-456",
    source: "x-client-request-id",
  });
});

test("manual mode ignores affinity headers", () => {
  assert.equal(resolveRequestSessionId({ "x-session-affinity": "pi-123" }, false), undefined);
});


test("auto sentinel falls back to Pi affinity", () => {
  assert.deepEqual(
    resolveRequestSessionId(
      {
        "x-chatgpt-session": AUTO_SESSION_SENTINEL,
        "x-session-affinity": "pi-auto-789",
      },
      true,
    ),
    { sessionId: "pi-auto-789", source: "x-session-affinity" },
  );
});

test("auto sentinel does not bypass manual-only mode", () => {
  assert.equal(
    resolveRequestSessionId(
      {
        "x-chatgpt-session": AUTO_SESSION_SENTINEL,
        "x-session-affinity": "pi-auto-789",
      },
      false,
    ),
    undefined,
  );
});
