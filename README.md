# chatgpt-web-session-proxy

Experimental **session-mode only** OpenAI Chat Completions-compatible proxy backed by a normal logged-in ChatGPT web browser session.

The intended flow is:

```text
pi
  -> POST http://127.0.0.1:4153/v1/chat/completions
  -> X-ChatGPT-Session: my-project-session
  -> browser backend (Playwright Chromium or CDP-attached real Chrome)
  -> one chatgpt.com conversation per local session
  -> prompt-emulated tool calls
  -> OpenAI-compatible tool_calls back to pi
```

This is deliberately a browser adapter, not an implementation of undocumented ChatGPT backend endpoints. It does not extract or persist bearer tokens, bypass login challenges, bypass rate limits, or attempt CAPTCHA/protective-measure evasion.

## Important terms note

As of September 2026, OpenAI's Europe Terms of Use prohibit automatically/programmatically extracting data or Output and also restrict reverse engineering and bypassing protective measures. Browser automation of ChatGPT may therefore conflict with the terms that apply to your account. Review the current terms before using this. For a supported integration, use the OpenAI API instead.

## What is implemented

- `POST /v1/chat/completions`
- OpenAI-compatible non-streaming responses
- OpenAI-compatible SSE streaming responses (buffered until the ChatGPT turn finishes)
- `GET /v1/models`
- required `X-ChatGPT-Session` header
- one ChatGPT conversation per session
- per-session serialization so concurrent turns cannot race
- append-only transcript verification
- persisted session metadata + ChatGPT conversation URL across proxy restarts
- prompt-emulated function/tool calling
- optional local bearer auth via `PROXY_API_KEY`
- `GET /v1/sessions` and `DELETE /v1/sessions/:id`
- session tab TTL / max-open-session controls

## Deliberate limitations

- ChatGPT's web DOM is not a stable API. Selectors can change.
- Streaming is compatibility streaming, not token-by-token upstream streaming: the browser response is buffered first so the proxy can distinguish normal text from an emulated tool call.
- Only text message parts are supported in this MVP. Images/files are not forwarded.
- The selected ChatGPT web model is whatever your web UI/account currently uses; `model` in the OpenAI request is only a compatibility label.
- Tool calls are prompt-emulated. They are not ChatGPT Web's internal tool system.
- If the client's transcript forks or rewrites history for an existing session, the proxy returns HTTP 409. Use a new session ID or delete/reset the old session.

## Requirements

- Node.js 22+
- either Playwright-managed Chromium **or** a locally installed Google Chrome
- a ChatGPT account you can sign into normally in a browser

## Install

```bash
npm install
```

If you want the default Playwright-managed Chromium backend, also install Chromium:

```bash
npx playwright install chromium
```

If you want to use your normal system installation of **Google Chrome**, you do not need the Playwright Chromium download. Chrome mode now launches an ordinary external Chrome process and the proxy attaches to it over the Chrome DevTools Protocol (CDP). Playwright does **not** launch the Chrome login browser.

## Browser choice

Two browser modes are supported:

| Mode | Command | Default profile directory |
| --- | --- | --- |
| Playwright Chromium | `npm run login:chromium` / `npm run dev:chromium` | `~/.config/chatgpt-web-session-proxy/chromium-profile` |
| Installed Google Chrome over CDP | `npm run login:chrome` / `npm run dev:chrome` | `~/.config/chatgpt-web-session-proxy/chrome-cdp-profile` |

`chromium` remains the generic default, so `npm run login` and `npm run dev` behave like the Chromium commands.

### Recommended: real Chrome with headed login + minimized runtime

```bash
npm run login:chrome
```

This starts your installed Chrome as a normal **headed** process using a dedicated profile and login-only CDP port `9222`. In the Chrome window that opens:

1. Go to `https://chatgpt.com/` if needed.
2. Sign in normally and complete any security challenge manually.
3. Verify that the ChatGPT composer/prompt box is visible.
4. Return to the terminal and press **Enter**.

The login helper now sends Chrome's real DevTools `Browser.close` command and, if needed, terminates the process it started. It waits until port `9222` is gone before returning, so the profile is fully unlocked before Pi uses it. This fixes the older behavior where pressing Enter could leave the Chrome window alive.

By default the **same authenticated profile** is reused for runtime. There is no profile copy unless you explicitly set `CHATGPT_RUNTIME_PROFILE_DIR`. Reusing the exact profile avoids losing browser/session state between headed login and runtime.

Defaults:

```text
Chrome profile:        ~/.config/chatgpt-web-session-proxy/chrome-cdp-profile
headed login CDP:      http://127.0.0.1:9222
runtime CDP:           http://127.0.0.1:9223
runtime mode:          minimized
```

Then start the proxy:

```bash
npm run dev:chrome
```

The proxy stays browser-less while idle. On the first Pi/API request it starts ordinary installed Chrome with `--start-minimized`, using the same authenticated profile, then attaches over CDP on port `9223`. This is still normal headed Chrome, just minimized/backgrounded; it is intentionally **not** headless.

Why? On some systems ChatGPT's security page accepts the authenticated profile in ordinary Chrome but presents a `Just a moment...` / bot challenge when that same profile is launched with `--headless=new`. The proxy does not try to disguise headless Chrome or bypass that challenge.

If you still want to test headless mode explicitly:

```bash
CHATGPT_CHROME_RUNTIME_MODE=headless npm run dev:chrome
```

If ChatGPT returns a security challenge in that mode, switch back to the default `minimized` mode. You can also use a fully visible runtime with:

```bash
CHATGPT_CHROME_RUNTIME_MODE=headed npm run dev:chrome
```

### Real Chrome lifecycle

```text
setup/login (occasional)                    normal Pi usage
-------------------------                   ----------------
npm run login:chrome                        npm run dev:chrome
        |                                           |
        v                                           | idle: no browser
headed real Chrome on :9222                        |
login / CAPTCHA                                    | first Pi request
        |                                           v
press Enter                                ordinary Chrome :9223
        |                                    same auth profile
Browser.close                                       |
Chrome fully exits                                  v
                                            --start-minimized
                                                    |
                                                    v
                                               chatgpt.com
```

If ChatGPT expires the login or presents a security challenge in the default minimized mode, stop the proxy, rerun `npm run login:chrome`, complete the check manually, verify the prompt box, press Enter, and restart the proxy. The proxy does not automate or bypass the challenge.

If you previously used version 0.5 with `chrome-headless-profile`, remove any `CHATGPT_RUNTIME_PROFILE_DIR` override so version 0.8 can reuse the authenticated login profile directly.

### Playwright Chromium

```bash
npm run login:chromium
npm run dev:chromium
```

For a compiled production build, use `npm run build` followed by `npm run start:chromium`.

Its persistent login is stored separately in:

```text
~/.config/chatgpt-web-session-proxy/chromium-profile
```

### Custom Chrome/Chromium executable

If Playwright cannot discover Chrome, or you want a specific build, set an explicit executable path:

```bash
CHATGPT_BROWSER=chrome \
CHATGPT_BROWSER_EXECUTABLE_PATH=/path/to/google-chrome \
npm run login
```

For Chrome mode, `CHATGPT_BROWSER_EXECUTABLE_PATH` is used both by `npm run login:chrome` and by the proxy when it auto-starts real Chrome. Headed login uses `CHATGPT_LOGIN_CDP_URL`; runtime uses `CHATGPT_CDP_URL`. For Chromium mode, the executable/channel settings are used by Playwright directly.

You can also override the dedicated user-data directory:

```bash
CHATGPT_BROWSER=chrome \
CHATGPT_PROFILE_DIR="$HOME/.config/chatgpt-web-session-proxy/my-chatgpt-chrome" \
npm run login
```

In Chrome mode, `CHATGPT_PROFILE_DIR` is both the login and runtime profile by default. Set `CHATGPT_RUNTIME_PROFILE_DIR` only if you deliberately want a separate copied runtime profile.

The proxy never asks for your password and does not copy authentication cookies/tokens into its own config. Authentication remains inside that browser profile.


## If you previously hit a CAPTCHA loop

Version 0.8 keeps the version 0.6 real-Chrome runtime behavior: the default runtime is `minimized`, not `headless`. If you upgraded from version 0.5, first stop any old runtime Chrome and clear old headless-specific environment overrides:

```bash
unset CHATGPT_CHROME_RUNTIME_MODE
unset CHATGPT_RUNTIME_PROFILE_DIR
npm run login:chrome
# log in manually, verify the ChatGPT composer, then press Enter
npm run dev:chrome
```

The first Pi request should now start ordinary Chrome minimized instead of `HeadlessChrome`. Do not try to automate or bypass a CAPTCHA/security challenge; complete it manually with `npm run login:chrome`.

If Pi still references a failed old local session, use a new `X-ChatGPT-Session` value or reset it:

```bash
curl -X DELETE http://127.0.0.1:4153/v1/sessions/YOUR_SESSION_ID
```

## Start

For the recommended real-Chrome workflow:

```bash
npm run dev:chrome
```

This does not open Chrome immediately. Ordinary Chrome is started minimized only when Pi sends the first request.

The generic default is still Playwright Chromium:

```bash
npm run dev
```

Default listen address:

```text
http://127.0.0.1:4153
```

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

Pi's current custom-model configuration supports an OpenAI-compatible base URL and custom headers. Copy `examples/pi-models.json` into `~/.pi/agent/models.json` or merge the provider into your existing file.

Set a unique session value **before starting a Pi session**:

```bash
export CHATGPT_WEB_SESSION="$(basename "$PWD")-$(date +%s)"
pi
```

Example provider:

```json
{
  "providers": {
    "chatgpt-web": {
      "baseUrl": "http://127.0.0.1:4153/v1",
      "api": "openai-completions",
      "apiKey": "local-proxy",
      "headers": {
        "X-ChatGPT-Session": "$CHATGPT_WEB_SESSION"
      },
      "compat": {
        "supportsUsageInStreaming": false,
        "supportsReasoningEffort": false
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

If you set `PROXY_API_KEY`, replace `local-proxy` with that key.

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

When an OpenAI request contains `tools`, the ChatGPT prompt includes Pi's tool schemas and asks ChatGPT to use protocol v3. Version 0.8 no longer puts tool arguments inside JSON because large source/file bodies frequently contain quotes that ChatGPT does not reliably JSON-escape. Each argument is carried in its own raw block instead:

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

Version 0.8 still accepts valid v2 JSON-style calls, old fenced calls, and bare single-tool JSON as compatibility fallbacks. It also has a narrow repair path for the common old `write` failure where the content body contains unescaped quotes. If ChatGPT emits `PI_TOOL_CALL` markers that cannot be parsed at all, the proxy now returns an explicit upstream error instead of leaking the markers to Pi as ordinary assistant text.

The prompt explicitly requires a tool call for local project actions such as creating/editing files or running commands when a corresponding tool is available. After a tool result is returned by Pi, that result is forwarded into the same ChatGPT web conversation and ChatGPT can issue the next tool call.

The proxy never executes local tools itself.

### Upgrading from v0.7

You do not strictly need a new ChatGPT conversation because every delta prompt contains a protocol-v3 reminder, but resetting the local proxy session once is recommended so the conversation does not retain older JSON-tool instructions:

```bash
curl -X DELETE http://127.0.0.1:4153/v1/sessions/YOUR_SESSION_ID
```

Or start Pi with a new `CHATGPT_WEB_SESSION` value.

### Tool debugging

For a request such as "create hello.html", the proxy terminal should show a request containing Pi's tools and then a parsed tool-call response:

```text
tools: ["read", "bash", "edit", "write"]
finishReason: "tool_calls"
toolCalls: ["write"]
```

If the first line has `tools: []`, Pi did not send its tools to this provider. If tools are present but the response says `finishReason: "stop"` and `toolCalls: []`, the web model answered normally instead of requesting a tool. If the web model emits `[[PI_TOOL_CALL]]` but the block is malformed, version 0.8 returns a 502 protocol error instead of presenting the raw marker block in Pi.

## Browser CLI overrides

For convenience, `--browser` and `--profile-dir` are also accepted by the TypeScript entrypoints. The npm scripts use this for the named browser commands:

```bash
npm run login -- --browser chrome
npm run dev -- --browser chrome
```

Environment variables are still useful for an executable path or other advanced settings.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `4153` | Listen port |
| `PROXY_API_KEY` | unset | Optional bearer auth for the local API |
| `CHATGPT_PROXY_HOME` | `~/.config/chatgpt-web-session-proxy` | Base state directory |
| `CHATGPT_BROWSER` | `chromium` | Browser backend: `chromium` or `chrome` |
| `CHATGPT_PROFILE_DIR` | browser-specific under `$CHATGPT_PROXY_HOME` | Chromium profile, or real-Chrome login/runtime profile |
| `CHATGPT_BROWSER_EXECUTABLE_PATH` | unset | Chrome executable for `login:chrome`, or direct executable override for Chromium mode |
| `CHATGPT_STATE_DIR` | `$CHATGPT_PROXY_HOME/sessions` | Persisted session metadata |
| `CHATGPT_CDP_URL` | `http://127.0.0.1:9223` | CDP endpoint used by real-Chrome runtime |
| `CHATGPT_LOGIN_CDP_URL` | `http://127.0.0.1:9222` | CDP endpoint used only by headed `login:chrome` |
| `CHATGPT_RUNTIME_PROFILE_DIR` | same as `CHATGPT_PROFILE_DIR` | Optional separate runtime profile; when different, login state is copied after Chrome closes |
| `CHATGPT_HEADLESS` | `false` | Playwright Chromium-mode headless setting |
| `CHATGPT_CHROME_RUNTIME_MODE` | `minimized` | Real-Chrome runtime mode: `minimized` (recommended), `headed`, or `headless` (best effort; may trigger a security challenge) |
| `CHATGPT_BROWSER_CHANNEL` | unset | Advanced Playwright channel override for Chromium mode only |
| `CHATGPT_MAX_SESSIONS` | `8` | Maximum simultaneously open ChatGPT tabs |
| `CHATGPT_SESSION_TTL_MINUTES` | `120` | Close inactive live tabs after this many minutes; persisted state remains |
| `CHATGPT_TURN_TIMEOUT_SECONDS` | `300` | Maximum wait for a ChatGPT answer |
| `CHATGPT_SETTLE_MS` | `1200` | Stable-response delay after generation stops |

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
