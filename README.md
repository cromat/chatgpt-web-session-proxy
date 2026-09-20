# chatgpt-web-session-proxy

Experimental **session-mode only** OpenAI Chat Completions-compatible proxy backed by a normal logged-in ChatGPT web browser session.

The default installation now uses your locally installed Google Chrome and automatically chooses an invisible runtime backend for the current OS:

| Host OS | `auto` runtime | Extra system package |
| --- | --- | --- |
| Linux | ordinary headed Chrome inside a private Xvfb display | `xvfb` |
| Windows | ordinary Chrome with its native Win32 window hidden | none |
| macOS | ordinary Chrome hidden through AppKit | none |
| other | minimized Chrome fallback | none |

The browser is still controlled over the same local Chrome DevTools Protocol (CDP) endpoint on every platform. The login flow is deliberately visible so you can authenticate and complete any security challenge yourself; normal Pi usage uses the invisible runtime selected above.

```text
pi
  -> http://127.0.0.1:4153/v1/chat/completions
  -> Pi session-affinity ID (automatic by default)
  -> OS-specific invisible Chrome runtime
  -> CDP http://127.0.0.1:9223
  -> one chatgpt.com conversation per local session
  -> OpenAI-compatible tool_calls back to Pi
```

This project does not attempt to disguise automation, bypass CAPTCHA/security checks, bypass rate limits, or implement undocumented ChatGPT backend endpoints.

## Important terms note

As of September 2026, OpenAI's Europe Terms of Use restrict programmatic extraction, reverse engineering, and bypassing protective measures. Browser automation of ChatGPT may therefore conflict with the terms that apply to your account. Review the current terms before using this. For a supported integration, use the OpenAI API instead.

## Chrome/Pi quick start

1. Setup Pi's `models.json` by copying `examples/pi-models.json` to `~/.pi/agent/models.json` or merging the provider into your existing file.
2. Run `npm run login:chrome` and sign in to ChatGPT.
3. Run `npm run dev:chrome` to start the proxy server.
4. Open a new terminal and run `pi`.

## Fast install

Requirements:

- Node.js 22+
- Google Chrome installed locally
- a ChatGPT account you can sign into normally
- Linux only: Xvfb for the default invisible runtime

Install the Node dependencies and run the platform check:

```bash
npm install
npm run setup
```

`npm run setup` detects the OS, finds Chrome, shows the resolved runtime mode, and checks Xvfb on Linux. On Windows and macOS there is no extra display-server install.

If Linux reports Xvfb missing, install it once:

```bash
# Debian / Ubuntu
sudo apt install xvfb

# Fedora / RHEL family
sudo dnf install xorg-x11-server-Xvfb

# Arch family
sudo pacman -S xorg-server-xvfb
```

Then authenticate once:

```bash
npm run login
```

A normal visible Chrome window opens with a dedicated profile. Sign in to ChatGPT, complete any security challenge manually, verify that the ChatGPT composer is visible, then return to the terminal and press **Enter**. The helper closes Chrome completely, prints `You can now run npm run dev:chrome or npm run dev:chromium to start the server`, and then returns control to your shell.

Start the proxy:

```bash
npm run dev
```

The proxy listens on:

```text
http://127.0.0.1:4153
```

It does **not** start Chrome while idle. Chrome starts only when Pi/API traffic first needs it.

## Automatic OS runtime selection

The default is:

```text
CHATGPT_BROWSER=chrome
CHATGPT_CHROME_RUNTIME_MODE=auto
```

`auto` resolves at startup:

```text
Linux   -> virtual
Windows -> hidden
macOS   -> hidden
other   -> minimized
```

### Linux: Xvfb virtual display

Linux uses a real private X11 display:

```text
Pi request
    |
    v
Xvfb :99
    |
    v
DISPLAY=:99 normal headed Chrome
    |
    v
CDP :9223
```

Chrome is not in Chrome headless mode. It renders into Xvfb instead of your desktop display. Xvfb is started automatically on the first request and stopped with the browser backend.

Defaults:

```text
CHATGPT_XVFB_DISPLAY=:99
CHATGPT_XVFB_SCREEN=1920x1080x24
```

If `:99` is occupied:

```bash
CHATGPT_XVFB_DISPLAY=:100 npm run dev
```

### Windows: native hidden Chrome

Native Windows Chrome does not use X11, so Cygwin/X, Xming, or VcXsrv cannot act as an Xvfb-equivalent for `chrome.exe`. In `auto` mode the proxy instead starts ordinary Chrome with the dedicated authenticated profile and hides the runtime window using the built-in Win32 `ShowWindow(..., SW_HIDE)` mechanism. No Cygwin or additional package is required.

The initial runtime target is also placed off-screen until the native hide step completes. CDP remains available at `127.0.0.1:9223`.

### macOS: native hidden Chrome

macOS also has no Xvfb equivalent for native Chrome. In `auto` mode the proxy starts ordinary Chrome and hides that launched Chrome application through AppKit's `NSRunningApplication.hide()` API, then controls it over CDP. No XQuartz or extra package is required.

### Why the implementations differ

Only Linux/X11 naturally supports the Xvfb display-server model. Windows and macOS use different native window systems, so forcing Xvfb onto them would either require running Linux Chrome in a VM/container or would not affect native Chrome at all. `auto` keeps the installation small while presenting the same invisible-browser behavior to the proxy.

## Runtime overrides

You normally do not need these, but all modes remain available:

```bash
npm run dev:chrome:auto
npm run dev:chrome:virtual   # Linux/Xvfb
npm run dev:chrome:hidden    # Windows/macOS native hiding
npm run dev:chrome:headed    # visible debugging
npm run dev:chrome:headless  # best effort only
```

Or use:

```text
CHATGPT_CHROME_RUNTIME_MODE=auto|virtual|hidden|minimized|headed|headless
```

`headless` is intentionally not the default because ChatGPT may present a security challenge to Chrome's headless runtime on some machines. This project does not attempt to evade that challenge.

## Browser/profile lifecycle

The default real-Chrome flow uses one dedicated persistent profile:

```text
~/.config/chatgpt-web-session-proxy/chrome-cdp-profile
```

Login and runtime never use it simultaneously:

```text
npm run login                        npm run dev + first Pi request
      |                                           |
      v                                           v
visible normal Chrome                       OS auto runtime
CDP :9222                                  CDP :9223
      |                                           |
manual login/security check                 same authenticated profile
      |                                           |
press Enter                                invisible normal usage
      v
Browser.close / full process exit
```

If ChatGPT later shows a login or security challenge, stop the proxy and run `npm run login` again. Complete the challenge manually, press Enter, and restart `npm run dev`.

## Playwright Chromium alternative

The old Playwright-managed Chromium backend is still available explicitly:

```bash
npx playwright install chromium
npm run login:chromium
npm run dev:chromium
```

Its profile is separate:

```text
~/.config/chatgpt-web-session-proxy/chromium-profile
```

## Custom Chrome executable/profile

If Chrome is installed somewhere unusual:

```bash
CHATGPT_BROWSER_EXECUTABLE_PATH=/path/to/chrome npm run login
```

On Windows PowerShell, set environment variables using normal PowerShell syntax, for example:

```powershell
$env:CHATGPT_BROWSER_EXECUTABLE_PATH = 'C:\Path\To\chrome.exe'
npm run login
```

Override the dedicated profile if needed:

```bash
CHATGPT_PROFILE_DIR="$HOME/.config/chatgpt-web-session-proxy/my-profile" npm run login
```

Authentication stays inside the Chrome profile; the proxy does not ask for or persist your password.

## What is implemented

- `POST /v1/chat/completions`
- OpenAI-compatible non-streaming and SSE compatibility responses
- `GET /v1/models`
- automatic Pi session-affinity IDs, with optional `X-ChatGPT-Session` override
- one ChatGPT conversation per local session
- persisted conversation URL + append-only shadow transcript
- prompt-emulated tool calls translated to OpenAI `tool_calls`
- automatic first-turn local project snapshot through Pi's `bash` tool
- session reset/list endpoints
- optional local bearer auth
- OS-aware invisible real-Chrome runtime

## Deliberate limitations

- ChatGPT's web DOM is not a stable API; selectors can change.
- Streaming is buffered compatibility streaming, not token-by-token upstream streaming.
- Tool calls are prompt-emulated, not ChatGPT Web's internal tool system.
- Images/files are not forwarded in this MVP.
- Windows/macOS `hidden` mode hides native Chrome; it is not a separate virtual display server like Xvfb.
- A site security challenge still needs manual completion through `npm run login`.

## Start and local auth

For a local API key:

```bash
PROXY_API_KEY='change-me' npm run dev
```

Then configure the client to use that same value as its bearer API key.

## Basic curl test

Start a fresh session:

```bash
curl http://127.0.0.1:4153/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'X-ChatGPT-Session: demo-1' \
  -d '{
    "model": "chatgpt-web-session",
    "messages": [
      {"role":"system","content":"Be concise."},
      {"role":"user","content":"Reply with exactly: hello"}
    ]
  }'
```

For the next request with the same session, send the full OpenAI transcript including the previous assistant response plus the new user message. The proxy verifies that the transcript is an append-only continuation but forwards only the new delta to the already-existing ChatGPT conversation.

## Pi configuration

Pi can provide its own stable session identifier to OpenAI-compatible providers through session-affinity headers. This proxy uses that mechanism by default, so you no longer need to export `CHATGPT_WEB_SESSION` before every Pi launch. Pi sends the same affinity ID for the lifetime of that Pi session, and separate Pi sessions get separate IDs.

Copy `examples/pi-models.json` into `~/.pi/agent/models.json` or merge the provider into your existing file. The important compatibility settings are:

```json
{
  "providers": {
    "chatgpt-web": {
      "baseUrl": "http://127.0.0.1:4153/v1",
      "api": "openai-completions",
      "apiKey": "local-proxy",
      "headers": {
        "X-ChatGPT-Session": "!node -e \"process.stdout.write(process.env.CHATGPT_WEB_SESSION || '__PI_AUTO__')\""
      },
      "compat": {
        "supportsUsageInStreaming": false,
        "supportsReasoningEffort": false,
        "sendSessionAffinityHeaders": true,
        "sessionAffinityFormat": "openai"
      },
      "models": [
        {
          "id": "chatgpt-web-session",
          "name": "ChatGPT Web (session proxy)",
          "reasoning": false,
          "input": ["text"]
        }
      ]
    }
  }
}
```

The `X-ChatGPT-Session` header is intentionally resolved through a small Node command instead of direct `$CHATGPT_WEB_SESSION` interpolation. Pi treats a missing directly interpolated environment variable as a configuration error before any HTTP request is sent. The command above always resolves: when `CHATGPT_WEB_SESSION` exists it sends that value; otherwise it sends the internal `__PI_AUTO__` sentinel. The proxy ignores that sentinel and uses Pi's session-affinity headers instead.

This means the default configuration works with **no `CHATGPT_WEB_SESSION` environment variable at all**, while an explicitly set `CHATGPT_WEB_SESSION` still overrides automatic session selection. Pi documents both shell-command header resolution and session-affinity headers for custom OpenAI-compatible providers.

### Automatic session IDs (default)

The default is:

```text
CHATGPT_WEB_AUTO_SET_SESSION_ENV=true
```

Despite the historical environment-variable name, auto mode does **not** modify your permanent OS environment. A child process cannot reliably and portably change the environment of the shell that launched it, and a global persisted value would make concurrent Pi agents collide. Instead, the proxy uses Pi's native per-session affinity ID. This gives the intended result with better behavior:

```text
Pi session A -> affinity A -> ChatGPT conversation A
Pi session B -> affinity B -> ChatGPT conversation B
```

This is OS-agnostic and allows multiple Pi agents to use the ChatGPT Web model simultaneously.

### Manual session mode

To restore the previous behavior, start the proxy with:

```bash
CHATGPT_WEB_AUTO_SET_SESSION_ENV=false npm run dev
```

On Windows PowerShell, for example:

```powershell
$env:CHATGPT_WEB_AUTO_SET_SESSION_ENV = "false"
npm run dev
```

Then set `CHATGPT_WEB_SESSION` before starting Pi. The default `examples/pi-models.json` already forwards it when present, so you do not need to edit `models.json`. Unix shells can use:

```bash
export CHATGPT_WEB_SESSION="$(basename "$PWD")-$(date +%s)"
pi
```

PowerShell can use:

```powershell
$env:CHATGPT_WEB_SESSION = "$(Split-Path -Leaf (Get-Location))-$(Get-Date -UFormat %s)"
pi
```

When automatic mode is enabled, setting `CHATGPT_WEB_SESSION` is a convenient one-off override. When it is unset, the provider command emits `__PI_AUTO__`, which the proxy treats as "use Pi session affinity" rather than as a real session ID.

If you set `PROXY_API_KEY`, replace `local-proxy` with that key.

## Automatic project context bootstrap

By default, the first turn of every **new or reset proxy session** automatically asks Pi to collect a small read-only snapshot of the folder where Pi is running before the request is sent to ChatGPT. This makes a fresh ChatGPT conversation start with basic local-project context instead of requiring you to manually ask it to inspect the folder first.

The proxy does this by returning a synthetic Pi `bash` tool call on the first request. Pi executes that command in its own current working directory, then sends the tool result back. Only then does the proxy send the original user request plus the snapshot into the new ChatGPT conversation. The proxy itself still never reads your filesystem directly.

The default snapshot includes:

- `pwd`
- a top-level `ls -la`
- `git status --short --branch` when inside a Git repository
- the first 200 paths from `git ls-files`
- up to the first 220 lines of common project files when present: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `composer.json`, `deno.json`, `deno.jsonc`, and common README filenames

It deliberately does **not** scan `.env`, credentials, the whole repository recursively, or arbitrary home-directory files. The snapshot is meant to be enough for orientation, not a full repository upload. ChatGPT can request additional files later through Pi's normal `read`/`bash` tools.

To disable this behavior, set the environment variable before starting the proxy:

```bash
CHATGPT_PROJECT_BOOTSTRAP=false npm run dev
```

or export it for the shell/session:

```bash
export CHATGPT_PROJECT_BOOTSTRAP=false
npm run dev
```

The default is `true`. The setting is read when the proxy starts. It only affects brand-new/reset sessions; an already-running session is not re-bootstrapped. If Pi does not expose a `bash` tool, the proxy skips the automatic snapshot and continues normally.

To force the bootstrap to run again, start a new Pi session or reset the current proxy session ID. You can list active/persisted IDs with `curl http://127.0.0.1:4153/v1/sessions`:

```bash
curl -X DELETE http://127.0.0.1:4153/v1/sessions/YOUR_SESSION_ID
```

## Session behavior

A session has two synchronized pieces of state:

1. the real ChatGPT server-side conversation represented by its `/c/...` URL;
2. a local shadow copy of the OpenAI message transcript.

After each successful turn, session state is written to:

```text
~/.config/chatgpt-web-session-proxy/sessions/
```

The filename is SHA-256 of the session ID, so arbitrary header values are not used as paths. Session files are written mode `0600`, and the session directory is forced to mode `0700` when possible.

**Security note:** the shadow transcript can contain prompts, source code, command output, and other local project data that Pi sent through the model. Treat `~/.config/chatgpt-web-session-proxy/` as sensitive. The browser profile also contains your logged-in ChatGPT session.

On restart, the proxy reopens the saved ChatGPT conversation URL and continues from the saved shadow transcript. If the saved ChatGPT conversation is no longer available and the site redirects away from it, the proxy refuses to continue rather than silently attaching the old shadow transcript to a new chat.

### Resetting a session

```bash
curl -X DELETE http://127.0.0.1:4153/v1/sessions/demo-1
```

This closes the live tab if present and deletes the persisted mapping/shadow transcript. It does **not** delete the conversation from your ChatGPT account.

## Tool-call emulation

When an OpenAI request contains `tools`, the ChatGPT prompt includes Pi's tool schemas and asks ChatGPT to use protocol v3. Version 0.8+ no longer puts tool arguments inside JSON because large source/file bodies frequently contain quotes that ChatGPT does not reliably JSON-escape. Each argument is carried in its own raw block instead:

```text
[[PI_TOOL_CALL]]
name: write
[[PI_ARG:path]]
hello.html
[[/PI_ARG]]
[[PI_ARG:content]]
<!DOCTYPE html>
<html lang="en">
  <body><h1>Hello</h1></body>
</html>
[[/PI_ARG]]
[[/PI_TOOL_CALL]]
```

The proxy turns that into a standard OpenAI `tool_calls` response with valid JSON arguments before Pi sees it. This means HTML, source code, shell syntax, quotes, and multiline text no longer depend on the web model producing correctly escaped JSON. Numeric/boolean arguments are coerced using the tool schema Pi sent with the request.

Version 0.8+ still accepts valid v2 JSON-style calls, old fenced calls, and bare single-tool JSON as compatibility fallbacks. It also has a narrow repair path for the common old `write` failure where the content body contains unescaped quotes. If ChatGPT emits `PI_TOOL_CALL` markers that cannot be parsed at all, the proxy now returns an explicit upstream error instead of leaking the markers to Pi as ordinary assistant text.

The prompt explicitly requires a tool call for local project actions such as creating/editing files or running commands when a corresponding tool is available. After a tool result is returned by Pi, that result is forwarded into the same ChatGPT web conversation and ChatGPT can issue the next tool call.

The proxy never executes local tools itself.

### Upgrading from older tool-protocol versions

You do not strictly need a new ChatGPT conversation because every delta prompt contains a protocol-v3 reminder, but resetting the local proxy session once is recommended so the conversation does not retain older JSON-tool instructions:

```bash
curl -X DELETE http://127.0.0.1:4153/v1/sessions/YOUR_SESSION_ID
```

Or start a new Pi session. In manual mode, you can instead start Pi with a new `CHATGPT_WEB_SESSION` value.

### Tool debugging

For a request such as "create hello.html", the proxy terminal should show a request containing Pi's tools and then a parsed tool-call response:

```text
tools: ["read", "bash", "edit", "write"]
finishReason: "tool_calls"
toolCalls: ["write"]
```

If the first line has `tools: []`, Pi did not send its tools to this provider. If tools are present but the response says `finishReason: "stop"` and `toolCalls: []`, the web model answered normally instead of requesting a tool. If the web model emits `[[PI_TOOL_CALL]]` but the block is malformed, current versions return a 502 protocol error instead of presenting the raw marker block in Pi.

## Browser CLI overrides

For convenience, `--browser` and `--profile-dir` are also accepted by the TypeScript entrypoints. The npm scripts use this for the named browser commands:

```bash
npm run login -- --browser chrome
npm run dev -- --browser chrome
```

Environment variables are still useful for an executable path or other advanced settings.

## Frequent errors / troubleshooting

### `Launch error: X display :99 is already in use`

This means the Linux `virtual` runtime could not start Xvfb on display `:99`. Either an Xvfb process is still using the display or stale X11 lock/socket files were left behind.

First check whether Xvfb is still running:

```bash
ps -ef | grep '[X]vfb :99'
```

If an old proxy-owned Xvfb process is still running, stop it using its PID:

```bash
kill <PID>
```

If no Xvfb process is using `:99`, remove the stale display files:

```bash
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
```

One-line cleanup when you have confirmed that no live X server should be using `:99`:

```bash
pkill -f 'Xvfb :99' 2>/dev/null || true; rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
```

Or avoid the occupied display entirely:

```bash
CHATGPT_XVFB_DISPLAY=:100 npm run dev:chrome
```

Do not remove `/tmp/.X99-lock` or `/tmp/.X11-unix/X99` while another legitimate X server is actively using display `:99`.

### Chrome CDP port is already in use (`9222` or `9223`)

The default Chrome ports are:

- `9222` - visible login Chrome
- `9223` - runtime Chrome controlled by the proxy

If either port is occupied by a stale Chrome process, stop only the process that owns that port.

#### Linux

Find the process:

```bash
lsof -nP -iTCP:9223 -sTCP:LISTEN
```

Kill it:

```bash
kill $(lsof -t -iTCP:9223 -sTCP:LISTEN)
```

One-liner:

```bash
pid=$(lsof -t -iTCP:9223 -sTCP:LISTEN); [ -z "$pid" ] || kill "$pid"
```

If `lsof` is unavailable, `fuser` is another common option:

```bash
fuser -k 9223/tcp
```

Replace `9223` with `9222` when fixing the login port.

#### macOS

Find the process:

```bash
lsof -nP -iTCP:9223 -sTCP:LISTEN
```

Kill it:

```bash
kill $(lsof -t -iTCP:9223 -sTCP:LISTEN)
```

One-liner:

```bash
pid=$(lsof -t -iTCP:9223 -sTCP:LISTEN); [ -z "$pid" ] || kill "$pid"
```

Replace `9223` with `9222` when fixing the login port.

#### Windows PowerShell

Find the process:

```powershell
Get-NetTCPConnection -LocalPort 9223 -State Listen | Select-Object LocalAddress, LocalPort, OwningProcess
```

Show the owning process:

```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 9223 -State Listen).OwningProcess
```

Stop it:

```powershell
Stop-Process -Id (Get-NetTCPConnection -LocalPort 9223 -State Listen).OwningProcess
```

One-liner:

```powershell
Get-NetTCPConnection -LocalPort 9223 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess }
```

Replace `9223` with `9222` when fixing the login port.

If `Get-NetTCPConnection` is unavailable, use `netstat` to locate the PID:

```cmd
netstat -ano | findstr :9223
```

then terminate that PID:

```cmd
taskkill /PID <PID> /F
```

### Proxy port `4153` is already in use

The proxy itself listens on port `4153` by default. You can either stop the process using it with the same OS-specific commands above, replacing `9223` with `4153`, or start the proxy on another port:

```bash
PORT=4154 npm run dev:chrome
```

PowerShell:

```powershell
$env:PORT = "4154"
npm run dev:chrome
```

If you change the proxy port, also update the Pi provider `baseUrl` in `models.json`.

### `ChatGPT prompt was not found` or a login/security challenge appears

Refresh the authenticated browser profile:

```bash
npm run login:chrome
```

Finish login in the visible Chrome window, verify that the normal ChatGPT composer is available, then press Enter and restart the proxy:

```bash
npm run dev:chrome
```

### Pi reports a missing `CHATGPT_WEB_SESSION`

If Pi fails before reaching the proxy with an error mentioning `X-ChatGPT-Session` or `CHATGPT_WEB_SESSION`, your installed Pi `models.json` is probably still using the older direct environment-variable header configuration. Update it to the current example in `examples/pi-models.json`.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `4153` | Listen port |
| `PROXY_API_KEY` | unset | Optional bearer auth for the local API |
| `CHATGPT_PROXY_HOME` | `~/.config/chatgpt-web-session-proxy` | Base state directory |
| `CHATGPT_BROWSER` | `chrome` | Browser backend: `chrome` or `chromium` |
| `CHATGPT_PROFILE_DIR` | browser-specific under `$CHATGPT_PROXY_HOME` | Chromium profile, or real-Chrome login/runtime profile |
| `CHATGPT_BROWSER_EXECUTABLE_PATH` | unset | Chrome executable for `login:chrome`, or direct executable override for Chromium mode |
| `CHATGPT_STATE_DIR` | `$CHATGPT_PROXY_HOME/sessions` | Persisted session metadata |
| `CHATGPT_CDP_URL` | `http://127.0.0.1:9223` | CDP endpoint used by real-Chrome runtime |
| `CHATGPT_LOGIN_CDP_URL` | `http://127.0.0.1:9222` | CDP endpoint used only by headed `login:chrome` |
| `CHATGPT_RUNTIME_PROFILE_DIR` | same as `CHATGPT_PROFILE_DIR` | Optional separate runtime profile; when different, login state is copied after Chrome closes |
| `CHATGPT_HEADLESS` | `false` | Playwright Chromium-mode headless setting |
| `CHATGPT_CHROME_RUNTIME_MODE` | `auto` | Real-Chrome runtime mode: `auto`, `virtual` (Linux/Xvfb), `hidden` (Windows/macOS native hiding), `minimized`, `headed`, or `headless` (best effort; may trigger a security challenge) |
| `CHATGPT_XVFB_DISPLAY` | `:99` | X display used by `virtual` runtime mode |
| `CHATGPT_XVFB_SCREEN` | `1920x1080x24` | Xvfb screen geometry/depth used by `virtual` runtime mode |
| `CHATGPT_XVFB_EXECUTABLE_PATH` | unset | Optional explicit path to the `Xvfb` executable |
| `CHATGPT_XVFB_STARTUP_TIMEOUT_MS` | `10000` | How long to wait for the virtual X display to become ready |
| `CHATGPT_BROWSER_CHANNEL` | unset | Advanced Playwright channel override for Chromium mode only |
| `CHATGPT_MAX_SESSIONS` | `8` | Maximum simultaneously open ChatGPT tabs |
| `CHATGPT_SESSION_TTL_MINUTES` | `120` | Close inactive live tabs after this many minutes; persisted state remains |
| `CHATGPT_TURN_TIMEOUT_SECONDS` | `300` | Maximum wait for a ChatGPT answer |
| `CHATGPT_SETTLE_MS` | `1200` | Stable-response delay after generation stops |
| `CHATGPT_PROJECT_BOOTSTRAP` | `true` | Automatically collect a lightweight local project snapshot through Pi's `bash` tool on the first turn of each new/reset session; set to `false` to disable |
| `CHATGPT_WEB_AUTO_SET_SESSION_ENV` | `true` | Automatically use Pi's native session-affinity ID when `X-ChatGPT-Session` is not explicitly set. Set to `false` to require manual `CHATGPT_WEB_SESSION` / `X-ChatGPT-Session`. |

## Updating selectors

All current ChatGPT DOM assumptions are isolated in `src/browser.ts`. If the site changes, that is the first file to inspect.

Current fallbacks look for:

- `#prompt-textarea` and `data-testid=prompt-textarea`
- Lexical/ProseMirror `contenteditable` composers
- the lowest visible ARIA `textbox` as a final composer fallback
- send/stop buttons by `data-testid`, CSS class, or accessible label
- assistant messages via `data-message-author-role=assistant`

If the prompt is missing, the proxy now distinguishes common login/security-challenge pages from a likely selector break and returns a more specific error.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The repository contains unit tests for transcript prefix detection and tool-call parsing. Browser integration tests are intentionally not automated because they require a real logged-in ChatGPT account.
