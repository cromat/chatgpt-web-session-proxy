import assert from "node:assert/strict";
import test from "node:test";
import { chromeLaunchArgs } from "../src/chrome-launch.js";

const loginProfile = "/tmp/chatgpt-login-profile";
const runtimeProfile = "/tmp/chatgpt-runtime-profile";

test("headed Chrome login launch does not request minimized or headless mode", () => {
  const args = chromeLaunchArgs({
    mode: "headed",
    profileDir: loginProfile,
    cdpUrl: "http://127.0.0.1:9222",
  });
  assert.equal(args.includes("--headless=new"), false);
  assert.equal(args.includes("--start-minimized"), false);
  assert.equal(args.includes("--remote-debugging-port=9222"), true);
  assert.equal(args.includes(`--user-data-dir=${loginProfile}`), true);
});

test("default-style minimized runtime stays headed but starts minimized", () => {
  const args = chromeLaunchArgs({
    mode: "minimized",
    profileDir: runtimeProfile,
    cdpUrl: "http://127.0.0.1:9223",
  });
  assert.equal(args.includes("--headless=new"), false);
  assert.equal(args.includes("--start-minimized"), true);
  assert.equal(args.includes("--remote-debugging-port=9223"), true);
  assert.equal(args.includes(`--user-data-dir=${runtimeProfile}`), true);
});

test("explicit headless runtime still uses modern headless mode", () => {
  const args = chromeLaunchArgs({
    mode: "headless",
    profileDir: runtimeProfile,
    cdpUrl: "http://127.0.0.1:9223",
  });
  assert.equal(args.includes("--headless=new"), true);
  assert.equal(args.includes("--no-startup-window"), true);
  assert.equal(args.includes("--start-minimized"), false);
});
