import os from "node:os";
import path from "node:path";

export type BrowserKind = "chromium" | "chrome";
export type ChromeRuntimeMode = "minimized" | "headed" | "headless";

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  return raw == null ? fallback : ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function intEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(value) ? value : fallback;
}

function cliValue(name: string): string | undefined {
  const exact = `--${name}`;
  const prefix = `${exact}=`;
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === exact) return process.argv[index + 1];
  }
  return undefined;
}

function browserKind(raw: string | undefined): BrowserKind {
  const value = (raw ?? "chromium").toLowerCase();
  if (value === "chromium" || value === "chrome") return value;
  throw new Error(`Unsupported browser ${JSON.stringify(value)}. Use "chromium" or "chrome".`);
}

function chromeRuntimeMode(raw: string | undefined): ChromeRuntimeMode {
  const value = (raw ?? "minimized").toLowerCase();
  if (value === "minimized" || value === "headed" || value === "headless") return value;
  throw new Error(
    `Unsupported Chrome runtime mode ${JSON.stringify(value)}. Use "minimized", "headed", or "headless".`,
  );
}

const baseDir = process.env.CHATGPT_PROXY_HOME ?? path.join(os.homedir(), ".config", "chatgpt-web-session-proxy");
const selectedBrowser = browserKind(cliValue("browser") ?? process.env.CHATGPT_BROWSER);
const chromiumProfileDir = path.join(baseDir, "chromium-profile");
const chromeLoginProfileDir = path.join(baseDir, "chrome-cdp-profile");
const selectedProfileDir = cliValue("profile-dir") ?? process.env.CHATGPT_PROFILE_DIR ?? (selectedBrowser === "chrome" ? chromeLoginProfileDir : chromiumProfileDir);

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: intEnv("PORT", 4153),
  browser: selectedBrowser,
  profileDir: selectedProfileDir,
  // By default real Chrome uses the exact same profile for login and runtime, but never at the same time.
  // This preserves the authenticated browser state and avoids copying profile databases/cookies unnecessarily.
  chromeRuntimeProfileDir: cliValue("runtime-profile-dir") ?? process.env.CHATGPT_RUNTIME_PROFILE_DIR ?? selectedProfileDir,
  stateDir: process.env.CHATGPT_STATE_DIR ?? path.join(baseDir, "sessions"),
  headless: boolEnv("CHATGPT_HEADLESS", false),
  chromeRuntimeMode: chromeRuntimeMode(cliValue("runtime-mode") ?? process.env.CHATGPT_CHROME_RUNTIME_MODE),
  cdpUrl: cliValue("cdp-url") ?? process.env.CHATGPT_CDP_URL ?? "http://127.0.0.1:9223",
  loginCdpUrl: cliValue("login-cdp-url") ?? process.env.CHATGPT_LOGIN_CDP_URL ?? "http://127.0.0.1:9222",
  browserExecutablePath: process.env.CHATGPT_BROWSER_EXECUTABLE_PATH || undefined,
  browserChannel: process.env.CHATGPT_BROWSER_CHANNEL || undefined,
  chatgptUrl: process.env.CHATGPT_URL ?? "https://chatgpt.com/",
  maxSessions: intEnv("CHATGPT_MAX_SESSIONS", 8),
  sessionTtlMs: intEnv("CHATGPT_SESSION_TTL_MINUTES", 120) * 60_000,
  turnTimeoutMs: intEnv("CHATGPT_TURN_TIMEOUT_SECONDS", 300) * 1000,
  settleMs: intEnv("CHATGPT_SETTLE_MS", 1200),
  apiKey: process.env.PROXY_API_KEY,
};
