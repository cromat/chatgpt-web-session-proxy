import assert from "node:assert/strict";
import test from "node:test";
import { resolveChromeRuntimeMode } from "../src/config.js";

test("auto runtime resolves to Xvfb virtual mode on Linux", () => {
  assert.equal(resolveChromeRuntimeMode("auto", "linux"), "virtual");
});

test("auto runtime resolves to native hidden mode on Windows and macOS", () => {
  assert.equal(resolveChromeRuntimeMode("auto", "win32"), "hidden");
  assert.equal(resolveChromeRuntimeMode("auto", "darwin"), "hidden");
});

test("explicit runtime mode overrides OS auto selection", () => {
  assert.equal(resolveChromeRuntimeMode("headed", "linux"), "headed");
  assert.equal(resolveChromeRuntimeMode("headless", "win32"), "headless");
  assert.equal(resolveChromeRuntimeMode("minimized", "darwin"), "minimized");
});
