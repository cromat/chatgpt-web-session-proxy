import assert from "node:assert/strict";
import test from "node:test";
import { displayLockPath, displayNumber, displaySocketPath, xvfbArgs } from "../src/xvfb.js";

test("parses Xvfb display numbers", () => {
  assert.equal(displayNumber(":99"), 99);
  assert.equal(displayNumber(":100.0"), 100);
  assert.throws(() => displayNumber("99"), /Invalid Xvfb display/);
});

test("builds local-only Xvfb arguments and paths", () => {
  assert.deepEqual(xvfbArgs(":99", "1920x1080x24"), [":99", "-screen", "0", "1920x1080x24", "-nolisten", "tcp"]);
  assert.equal(displaySocketPath(":99"), "/tmp/.X11-unix/X99");
  assert.equal(displayLockPath(":99"), "/tmp/.X99-lock");
});
