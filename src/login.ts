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

async function waitForEnter(): Promise<void> {
  await new Promise<void>((resolve) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      // resume() keeps stdin referenced and can prevent this one-shot CLI from
      // returning to the shell. Pause it as soon as Enter is received.
      process.stdin.pause();
      resolve();
    });
  });
}

function finishLoginCli(): void {
  process.stdin.pause();
  console.log("Login complete.");
  console.log("You can now run npm run dev:chrome or npm run dev:chromium to start the server.");

  // Normally the process exits naturally after stdin/browser cleanup. Keep a
  // short unref'ed safety exit in case an OS/CDP handle lingers after Chrome
  // has already shut down, which previously left the login command hanging.
  const safetyExit = setTimeout(() => process.exit(0), 150);
  safetyExit.unref();
}

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
  console.log(`Runtime mode: ${config.chromeRuntimeModeRequested} -> ${config.chromeRuntimeMode}`);
  console.log("Log in to ChatGPT normally and make sure the prompt box is visible.");
  console.log("Then press Enter here. The helper will fully close Chrome before returning.");
  await waitForEnter();

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

  // Ensure Playwright releases its CDP transport even when Chrome has already
  // exited after Browser.close.
  await browser.close().catch(() => undefined);

  syncLoginProfileToRuntime();
  if (config.chromeRuntimeProfileDir === config.profileDir) {
    console.log(`Authenticated profile is ready for runtime use: ${config.profileDir}`);
  } else {
    console.log(`Authenticated profile copied to runtime profile: ${config.chromeRuntimeProfileDir}`);
  }
  console.log(`Runtime mode is ${config.chromeRuntimeMode}.`);
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
  await waitForEnter();
  await context.close();
}

finishLoginCli();
