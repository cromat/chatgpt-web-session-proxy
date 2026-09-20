import type { chromium } from "patchright";
import { config, type BrowserRuntimeMode } from "./config.js";

type PersistentContextOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>;

function isHeadless(mode: BrowserRuntimeMode): boolean {
  return mode === "headless";
}

function extraArgs(mode: BrowserRuntimeMode): string[] {
  if (mode === "minimized") return ["--start-minimized"];
  return [];
}

/**
 * Patchright's stealth patches only apply when it launches the browser itself,
 * so we always use launchPersistentContext (never connectOverCDP).
 *
 * Patchright best practices honored here:
 *  - Real Google Chrome via channel: "chrome" (or explicit executablePath)
 *  - No custom userAgent / headers / viewport
 *  - No manual --disable-blink-features (Patchright adds it internally)
 */
export function persistentContextOptions(mode: BrowserRuntimeMode = config.runtimeMode): PersistentContextOptions {
  const executablePath = config.browserExecutablePath;
  const channel = executablePath ? undefined : config.browser === "chrome" ? "chrome" : undefined;
  return {
    headless: isHeadless(mode),
    channel,
    executablePath,
    args: extraArgs(mode),        // no extra args for headless
    viewport: null,               // critical for stealth
    ignoreDefaultArgs: undefined, // let Patchright use its hardened defaults
  };
}

export function browserDescription(): string {
  if (config.browser === "chrome") {
    return `Patchright driving installed Google Chrome (${config.runtimeMode} runtime)`;
  }
  if (config.browserExecutablePath) {
    return `Patchright with Chromium executable ${config.browserExecutablePath}`;
  }
  return `Patchright-managed Chromium (${config.runtimeMode} runtime)`;
}