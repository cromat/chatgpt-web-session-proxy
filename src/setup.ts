import { config, platformLabel } from "./config.js";
import { findChromeExecutable } from "./chrome-launch.js";
import { findXvfbExecutable } from "./xvfb.js";

console.log("chatgpt-web-session-proxy setup check\n");
console.log(`OS:              ${platformLabel()} (${process.platform})`);
console.log(`Browser backend: ${config.browser}`);
console.log(`Runtime mode:    ${config.chromeRuntimeModeRequested} -> ${config.chromeRuntimeMode}`);
console.log(`Proxy URL:       http://${config.host}:${config.port}`);
console.log(`Runtime CDP:     ${config.cdpUrl}`);
console.log(`Pi session mode: ${config.autoSetSessionEnv ? "automatic (Pi session-affinity headers)" : "manual CHATGPT_WEB_SESSION"}`);

let failed = false;

if (config.browser === "chrome") {
  try {
    console.log(`Chrome:          ${findChromeExecutable()}`);
  } catch (error) {
    failed = true;
    console.error(`Chrome:          MISSING - ${error instanceof Error ? error.message : String(error)}`);
  }

  if (config.chromeRuntimeMode === "virtual") {
    try {
      console.log(`Virtual display: ${findXvfbExecutable()} (${config.xvfbDisplay}, ${config.xvfbScreen})`);
    } catch {
      failed = true;
      console.error("Virtual display: MISSING - Xvfb is required for invisible Chrome on Linux.");
      console.error("  Debian/Ubuntu: sudo apt install xvfb");
      console.error("  Fedora/RHEL:   sudo dnf install xorg-x11-server-Xvfb");
      console.error("  Arch:          sudo pacman -S xorg-server-xvfb");
    }
  } else if (config.chromeRuntimeMode === "hidden" && process.platform === "win32") {
    console.log("Visibility:      native Win32 hidden-window backend (no extra package)");
  } else if (config.chromeRuntimeMode === "hidden" && process.platform === "darwin") {
    console.log("Visibility:      native AppKit hidden-application backend (no extra package)");
  }
}

console.log("");
if (failed) {
  console.error("Setup is incomplete. Install the missing item(s), then run npm run setup again.");
  process.exitCode = 1;
} else {
  console.log("Ready. Next: npm run login, then npm run dev");
}
