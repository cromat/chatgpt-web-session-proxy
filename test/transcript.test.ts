import test from "node:test";
import assert from "node:assert/strict";
import { commonPrefixLength } from "../src/transcript.js";
import type { ChatMessage } from "../src/types.js";

test("append-only transcript prefix", () => {
  const a: ChatMessage[] = [{ role: "system", content: "s" }, { role: "user", content: "u" }, { role: "assistant", content: "a" }];
  assert.equal(commonPrefixLength(a, [...a, { role: "user", content: "next" }]), 3);
});

test("divergence is detected", () => {
  assert.equal(commonPrefixLength([{ role: "user", content: "one" }], [{ role: "user", content: "two" }]), 0);
});
