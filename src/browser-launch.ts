import { chromium } from "playwright";
import { config } from "./config.js";

type PersistentContextOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

export function persistentContextOptions(headless = config.headless): PersistentContextOptions {
  const executablePath = config.browserExecutablePath;
  const channel = executablePath ? undefined : config.browserChannel;
  return {
    headless,
    channel,
    executablePath,
    viewport: { width: 1400, height: 1000 },
  };
}

export function browserDescription(): string {
  if (config.browser === "chrome") {
    return `installed Chrome ${config.chromeRuntimeMode} runtime over CDP at ${config.cdpUrl}`;
  }
  if (config.browserExecutablePath) return `Chromium via executable ${config.browserExecutablePath}`;
  if (config.browserChannel) return `Chromium via Playwright channel ${config.browserChannel}`;
  return "Playwright-managed Chromium";
}
