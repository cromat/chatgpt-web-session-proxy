import assert from "node:assert/strict";
import test from "node:test";
import { macHideScript, windowsHideScript } from "../src/native-visibility.js";

test("Windows hidden backend uses SW_HIDE for the launched Chrome process tree", () => {
  const script = windowsHideScript(1234);
  assert.match(script, /targetPid = 1234/);
  assert.match(script, /ShowWindow/);
  assert.match(script, /MainWindowHandle/);
  assert.match(script, /, 0\)/);
});

test("macOS hidden backend targets the launched Chrome PID through AppKit", () => {
  const script = macHideScript(4321);
  assert.match(script, /NSRunningApplication/);
  assert.match(script, /4321/);
  assert.match(script, /hide/);
});
