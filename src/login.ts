import { chromium } from "patchright";
import { browserDescription, persistentContextOptions } from "./browser-launch.js";
import { config } from "./config.js";

// Login is always headed and fully visible so the user can solve any
// challenge in a real Chrome window. The persistent profile is then reused
// by the runtime.
const context = await chromium.launchPersistentContext(
  config.profileDir,
  { ...persistentContextOptions("headed"), headless: false },
);

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(config.chatgptUrl, { waitUntil: "domcontentloaded" });

console.log(`Opened ChatGPT with ${browserDescription()}.`);
console.log(`Persistent browser profile: ${config.profileDir}`);
console.log("Sign in normally. If ChatGPT shows a security challenge, solve it manually.");
console.log("When the ChatGPT prompt box is visible, press Enter here to close the browser.");

await new Promise<void>((resolve) => {
  process.stdin.resume();
  process.stdin.once("data", () => resolve());
});

await context.close();