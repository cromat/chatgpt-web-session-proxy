import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, type ChromeRuntimeMode } from "./config.js";

function existing(paths: string[]): string | undefined {
  return paths.find((candidate) => candidate && fs.existsSync(candidate));
}

function which(name: string): string | undefined {
  if (process.platform === "win32") return undefined;
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value || undefined;
}

export function findChromeExecutable(): string {
  if (config.browserExecutablePath) {
    if (!fs.existsSync(config.browserExecutablePath)) {
      throw new Error(`CHATGPT_BROWSER_EXECUTABLE_PATH does not exist: ${config.browserExecutablePath}`);
    }
    return config.browserExecutablePath;
  }

  if (process.platform === "darwin") {
    const found = existing([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
      "/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta",
      "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev",
      "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    ]);
    if (found) return found;
  }

  if (process.platform === "win32") {
    const roots = [process.env.PROGRAMFILES, process.env["PROGRAMFILES(X86)"], process.env.LOCALAPPDATA].filter(Boolean) as string[];
    const candidates = roots.flatMap((root) => [
      path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(root, "Google", "Chrome Beta", "Application", "chrome.exe"),
      path.join(root, "Google", "Chrome Dev", "Application", "chrome.exe"),
      path.join(root, "Google", "Chrome SxS", "Application", "chrome.exe"),
    ]);
    const found = existing(candidates);
    if (found) return found;
  }

  const found = ["google-chrome", "google-chrome-stable", "google-chrome-beta", "chromium", "chromium-browser"]
    .map(which)
    .find(Boolean);
  if (found) return found;

  throw new Error(
    "Could not find Google Chrome. Set CHATGPT_BROWSER_EXECUTABLE_PATH to the Chrome executable.",
  );
}

export function cdpPort(cdpUrl = config.cdpUrl): number {
  let parsed: URL;
  try {
    parsed = new URL(cdpUrl);
  } catch {
    throw new Error(`CDP URL must be an HTTP URL, got ${JSON.stringify(cdpUrl)}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`CDP URL must use http:// or https://, got ${parsed.protocol}`);
  }
  const port = Number.parseInt(parsed.port || (parsed.protocol === "https:" ? "443" : "80"), 10);
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error(`Invalid CDP port in ${cdpUrl}`);
  return port;
}

export function chromeLaunchArgs(options: { mode: ChromeRuntimeMode; profileDir?: string; cdpUrl?: string }): string[] {
  const profileDir = options.profileDir ?? config.chromeRuntimeProfileDir;
  const cdpUrl = options.cdpUrl ?? config.cdpUrl;
  const args = [
    `--remote-debugging-port=${cdpPort(cdpUrl)}`,
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (options.mode === "headless") {
    args.push("--headless=new", "--no-startup-window");
  } else if (options.mode === "minimized") {
    args.push("--start-minimized");
  }
  args.push(config.chatgptUrl);
  return args;
}

export function launchChromeForCdp(options: { mode: ChromeRuntimeMode; profileDir?: string; cdpUrl?: string }): { executable: string; pid?: number } {
  const executable = findChromeExecutable();
  const profileDir = options.profileDir ?? config.chromeRuntimeProfileDir;
  fs.mkdirSync(profileDir, { recursive: true, mode: 0o700 });
  const child = spawn(executable, chromeLaunchArgs(options), {
    detached: true,
    stdio: "ignore",
    windowsHide: options.mode === "headless",
  });
  child.unref();
  return { executable, pid: child.pid };
}

export async function cdpReachable(cdpUrl = config.cdpUrl, timeoutMs = 1_500): Promise<boolean> {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function cdpLooksHeadless(cdpUrl = config.cdpUrl, timeoutMs = 1_500): Promise<boolean> {
  try {
    const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return false;
    const info = await response.json() as { Browser?: string; "User-Agent"?: string };
    return /HeadlessChrome/i.test(`${info.Browser ?? ""} ${info["User-Agent"] ?? ""}`);
  } catch {
    return false;
  }
}

export async function waitForCdp(cdpUrl = config.cdpUrl, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpUrl.replace(/\/$/, "")}/json/version`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = new Error(`CDP returned HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Chrome started but CDP did not become reachable at ${cdpUrl}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

export async function waitForCdpToStop(cdpUrl: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await cdpReachable(cdpUrl, 500))) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Chrome at ${cdpUrl} did not stop.`);
}

export async function terminateChromeProcess(pid: number | undefined, timeoutMs = 5_000): Promise<void> {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      return;
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

function copyProfileFilter(source: string): boolean {
  const name = path.basename(source);
  return ![
    "SingletonCookie",
    "SingletonLock",
    "SingletonSocket",
    "DevToolsActivePort",
  ].includes(name);
}

export function syncLoginProfileToRuntime(): void {
  if (!fs.existsSync(config.profileDir)) {
    throw new Error(`Chrome login profile does not exist: ${config.profileDir}. Run "npm run login:chrome" first.`);
  }
  if (path.resolve(config.profileDir) === path.resolve(config.chromeRuntimeProfileDir)) return;

  fs.rmSync(config.chromeRuntimeProfileDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(config.chromeRuntimeProfileDir), { recursive: true, mode: 0o700 });
  fs.cpSync(config.profileDir, config.chromeRuntimeProfileDir, {
    recursive: true,
    force: true,
    filter: copyProfileFilter,
  });
}

export function ensureRuntimeProfile(): void {
  if (fs.existsSync(config.chromeRuntimeProfileDir)) return;
  syncLoginProfileToRuntime();
}
