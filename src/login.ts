import { chromium } from "playwright";
import { browserDescription, persistentContextOptions } from "./browser-launch.js";
import {
  cdpReachable,
  launchChromeForCdp,
  syncLoginProfileToRuntime,
  terminateChromeProcess,
  waitForCdp,
  waitForCdpToStop,
} from "./chrome-launch.js";
import { config } from "./config.js";

if (config.browser === "chrome") {
  if (await cdpReachable(config.loginCdpUrl)) {
    throw new Error(
      `A headed login Chrome CDP endpoint is already running at ${config.loginCdpUrl}. Close it before running login:chrome.`,
    );
  }
  if (await cdpReachable(config.cdpUrl)) {
    throw new Error(
      `The runtime Chrome is still running at ${config.cdpUrl}. Stop the proxy/runtime Chrome before refreshing login.`,
    );
  }

  const { executable, pid } = launchChromeForCdp({
    mode: "headed",
    profileDir: config.profileDir,
    cdpUrl: config.loginCdpUrl,
  });
  await waitForCdp(config.loginCdpUrl);
  const browser = await chromium.connectOverCDP(config.loginCdpUrl, { timeout: 10_000 });
  console.log(`Opened ordinary headed Chrome${pid ? ` (PID ${pid})` : ""}: ${executable}`);
  console.log(`Login/runtime profile: ${config.profileDir}`);
  if (config.chromeRuntimeProfileDir !== config.profileDir) {
    console.log(`Separate runtime profile: ${config.chromeRuntimeProfileDir}`);
  }
  console.log(`Headed login CDP endpoint: ${config.loginCdpUrl}`);
  console.log(`Runtime CDP endpoint: ${config.cdpUrl}`);
  console.log(`Runtime mode: ${config.chromeRuntimeMode}`);
  console.log("Log in to ChatGPT normally and make sure the prompt box is visible.");
  console.log("Then press Enter here. The helper will fully close Chrome before returning.");
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });

  // Browser.close is an actual Chrome DevTools Protocol command. It is more reliable
  // for an externally launched Chrome than merely closing Playwright's CDP connection.
  try {
    const session = await browser.newBrowserCDPSession();
    await session.send("Browser.close");
  } catch {
    await browser.close().catch(() => undefined);
  }

  try {
    await waitForCdpToStop(config.loginCdpUrl, 7_500);
  } catch {
    // If Chrome ignored Browser.close or its launcher process kept the browser alive,
    // terminate the process group we started and wait once more before touching the profile.
    await terminateChromeProcess(pid);
    await waitForCdpToStop(config.loginCdpUrl, 7_500);
  }

  syncLoginProfileToRuntime();
  if (config.chromeRuntimeProfileDir === config.profileDir) {
    console.log(`Authenticated profile is ready for runtime use: ${config.profileDir}`);
  } else {
    console.log(`Authenticated profile copied to runtime profile: ${config.chromeRuntimeProfileDir}`);
  }
  console.log(`You can now run npm run dev:chrome. Runtime mode is ${config.chromeRuntimeMode}.`);
} else {
  const context = await chromium.launchPersistentContext(
    config.profileDir,
    persistentContextOptions(false),
  );
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(config.chatgptUrl, { waitUntil: "domcontentloaded" });
  console.log(`Opened ChatGPT with ${browserDescription()}.`);
  console.log(`Persistent browser profile: ${config.profileDir}`);
  console.log("Sign in normally. When the ChatGPT prompt box is visible, press Enter here to close the browser.");
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => resolve());
  });
  await context.close();
}
