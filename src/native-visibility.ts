import { spawnSync } from "node:child_process";

export function windowsHideScript(pid: number): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class ChatGptProxyUser32 {
  [DllImport("user32.dll")]
  public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$targetPid = ${pid}
$ids = New-Object 'System.Collections.Generic.HashSet[int]'
[void]$ids.Add($targetPid)
for ($round = 0; $round -lt 6; $round++) {
  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  foreach ($proc in $all) {
    if ($ids.Contains([int]$proc.ParentProcessId)) { [void]$ids.Add([int]$proc.ProcessId) }
  }
}
foreach ($id in $ids) {
  $proc = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -ne $proc -and $proc.MainWindowHandle -ne 0) {
    [void][ChatGptProxyUser32]::ShowWindow($proc.MainWindowHandle, 0)
  }
}
`;
}

export function macHideScript(pid: number): string {
  return String.raw`ObjC.import('AppKit');
const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid});
if (!app) throw new Error('Chrome process not found');
let ok = false;
try { ok = Boolean(app.hide()); } catch (_) { ok = Boolean(app.hide); }
if (!ok) throw new Error('NSRunningApplication.hide() returned false');`;
}

export function hideNativeChrome(pid: number | undefined, platform: NodeJS.Platform = process.platform): void {
  if (!pid) throw new Error("Chrome PID is unavailable; cannot hide the runtime browser safely.");

  if (platform === "win32") {
    const result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", windowsHideScript(pid)],
      { encoding: "utf8", windowsHide: true, timeout: 8_000 },
    );
    if (result.status !== 0) {
      throw new Error(`Windows could not hide the Chrome window: ${(result.stderr || result.stdout || "PowerShell failed").trim()}`);
    }
    return;
  }

  if (platform === "darwin") {
    const result = spawnSync(
      "/usr/bin/osascript",
      ["-l", "JavaScript", "-e", macHideScript(pid)],
      { encoding: "utf8", timeout: 8_000 },
    );
    if (result.status !== 0) {
      throw new Error(`macOS could not hide the Chrome app: ${(result.stderr || result.stdout || "osascript failed").trim()}`);
    }
    return;
  }

  throw new Error(`Native hidden-window mode is not supported on ${platform}.`);
}
