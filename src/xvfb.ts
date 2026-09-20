import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface XvfbHandle {
  pid?: number;
  display: string;
  executable: string;
}

function which(name: string): string | undefined {
  if (process.platform === "win32") return undefined;
  const result = spawnSync("which", [name], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value || undefined;
}

export function displayNumber(display = config.xvfbDisplay): number {
  const match = /^:(\d+)(?:\.\d+)?$/.exec(display.trim());
  if (!match) {
    throw new Error(`Invalid Xvfb display ${JSON.stringify(display)}. Expected a value such as ":99".`);
  }
  return Number.parseInt(match[1], 10);
}

export function displaySocketPath(display = config.xvfbDisplay): string {
  return path.join("/tmp/.X11-unix", `X${displayNumber(display)}`);
}

export function displayLockPath(display = config.xvfbDisplay): string {
  return path.join("/tmp", `.X${displayNumber(display)}-lock`);
}

export function xvfbArgs(display = config.xvfbDisplay, screen = config.xvfbScreen): string[] {
  return [display, "-screen", "0", screen, "-nolisten", "tcp"];
}

export function findXvfbExecutable(): string {
  if (config.xvfbExecutablePath) {
    if (!fs.existsSync(config.xvfbExecutablePath)) {
      throw new Error(`CHATGPT_XVFB_EXECUTABLE_PATH does not exist: ${config.xvfbExecutablePath}`);
    }
    return config.xvfbExecutablePath;
  }
  const found = which("Xvfb");
  if (found) return found;
  throw new Error(
    'Xvfb was not found. Install it (for example: "sudo apt install xvfb") or set CHATGPT_XVFB_EXECUTABLE_PATH.',
  );
}

export async function startXvfb(): Promise<XvfbHandle> {
  if (process.platform !== "linux") {
    throw new Error('CHATGPT_CHROME_RUNTIME_MODE="virtual" is currently supported only on Linux.');
  }

  const socketPath = displaySocketPath();
  const lockPath = displayLockPath();
  if (fs.existsSync(socketPath) || fs.existsSync(lockPath)) {
    const occupied = fs.existsSync(socketPath) ? socketPath : lockPath;
    throw new Error(
      `X display ${config.xvfbDisplay} is already in use or has a stale lock (${occupied} exists). ` +
      "Stop the old Xvfb process/remove the stale lock, or choose another display with CHATGPT_XVFB_DISPLAY, for example :100.",
    );
  }

  const executable = findXvfbExecutable();
  const child = spawn(executable, xvfbArgs(), {
    detached: true,
    stdio: "ignore",
  });
  child.unref();

  const deadline = Date.now() + config.xvfbStartupTimeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(socketPath)) {
      return { pid: child.pid, display: config.xvfbDisplay, executable };
    }
    if (child.exitCode != null) {
      throw new Error(`Xvfb exited before display ${config.xvfbDisplay} became ready (exit ${child.exitCode}).`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  await stopXvfb({ pid: child.pid, display: config.xvfbDisplay, executable });
  throw new Error(`Xvfb did not create display ${config.xvfbDisplay} within ${config.xvfbStartupTimeoutMs}ms.`);
}

export async function stopXvfb(handle: XvfbHandle | undefined, timeoutMs = 3_000): Promise<void> {
  const pid = handle?.pid;
  if (!pid) return;

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
