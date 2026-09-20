# chatgpt-web-session-proxy

Experimental **session-mode only** OpenAI Chat Completions-compatible proxy backed by a normal logged-in ChatGPT web browser session. Browser automation is powered by [**Patchright**](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright), a stealth-hardened Playwright fork.

The intended flow is:

```text
pi
  -> POST http://127.0.0.1:4153/v1/chat/completions
  -> X-ChatGPT-Session: my-project-session
  -> Patchright-launched Chrome/Chromium (persistent profile)
  -> one chatgpt.com conversation per local session
  -> prompt-emulated tool calls
  -> OpenAI-compatible tool_calls back to pi
```

This is deliberately a browser adapter, not an implementation of undocumented ChatGPT backend endpoints. It does not extract or persist bearer tokens, bypass login challenges, bypass rate limits, or attempt CAPTCHA/protective-measure evasion.

## Important terms note

As of September 2026, OpenAI's Europe Terms of Use prohibit automatically/programmatically extracting data or Output and also restrict reverse engineering and bypassing protective measures. Browser automation of ChatGPT may therefore conflict with the terms that apply to your account. Review the current terms before using this. For a supported integration, use the OpenAI API instead.

## Why Patchright?

Standard Playwright leaves detectable fingerprints (the `Runtime.enable` CDP leak, the `navigator.webdriver` flag, `--enable-automation`, etc.) that Cloudflare and similar bot-mitigation systems use to trigger CAPTCHA challenges. Patchright patches those out at the driver level, so a Patchright-launched browser session looks like a normal user session.

**Patchright only works when it launches the browser itself.** Attaching to an externally started Chrome over CDP (`connectOverCDP`) bypasses every Patchright patch. This project therefore always uses `launchPersistentContext`.

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
- Patchright stealth defaults: real Chrome channel, `viewport: null`, no header injection

## Deliberate limitations

- ChatGPT's web DOM is not a stable API. Selectors can change.
- Streaming is compatibility streaming, not token-by-token upstream streaming.
- Only text message parts are supported in this MVP. Images/files are not forwarded.
- The selected ChatGPT web model is whatever your web UI/account currently uses; `model` in the OpenAI request is only a compatibility label.
- Tool calls are prompt-emulated. They are not ChatGPT Web's internal tool system.
- If the client's transcript forks or rewrites history for an existing session, the proxy returns HTTP 409. Use a new session ID or delete/reset the old session.
- Even with Patchright, aggressive server-side fingerprinting can still challenge you. The default `minimized` runtime is the recommended trade-off between stealth and low visual footprint.

## Requirements

- Node.js 22+
- Patchright (installed as a dependency)
- either Patchright-managed Chromium **or** a locally installed Google Chrome (**recommended**)
- a ChatGPT account you can sign into normally in a browser

## Install

```bash
npm install
npx patchright install chromium
```

If you plan to use the `chrome` channel (recommended), you do not strictly need the Patchright Chromium download — Patchright will drive your installed Google Chrome.

## Browser choice

Patchright drives one of two browser backends:

| Mode | Command flag | Default profile directory |
| --- | --- | --- |
| Installed Google Chrome (`channel: "chrome"`) — **default & recommended** | `--browser chrome` | `~/.config/chatgpt-web-session-proxy/chrome-profile` |
| Patchright-managed Chromium | `--browser chromium` | `~/.config/chatgpt-web-session-proxy/chromium-profile` |

`chrome` is the default. `npm run login` and `npm run dev` are equivalent to their `:chrome` counterparts.

## Runtime modes

Both backends share the same three runtime modes, controlled by `CHATGPT_RUNTIME_MODE` or `--runtime-mode`:

| Mode | Behavior | Notes |
| --- | --- | --- |
| `headless` (**default**) | `--headless=new` | Fully invisible; Patchright removes the headless fingerprints that would otherwise trigger a challenge |
| `minimized` | Headed Chrome started with `--start-minimized` | Visible only as a taskbar entry; use this if a specific site still challenges headless |
| `headed` | Fully visible Chrome window | Maximum compatibility, most visible |

Patchright patches headless detection at the driver level, so `headless` is the recommended default when you want the browser to stay invisible. If a particular system still challenges it, switch to `minimized` for that session.

## Login (one-time setup)

Real login is always headed and fully visible so you can solve any challenge manually:

```bash
npm run login            # default → chrome
# or
npm run login:chrome
npm run login:chromium
```

In the window that opens:

1. Go to `https://chatgpt.com/` if needed.
2. Sign in normally and complete any security challenge manually.
3. Verify that the ChatGPT composer/prompt box is visible.
4. Return to the terminal and press **Enter**.

The persistent profile is written to `~/.config/chatgpt-web-session-proxy/` and reused by the runtime. The login script does not use Patchright's stealth launch flags — it intentionally opens a normal visible window.

## Start

```bash
npm run dev              # default → chrome, minimized runtime
# or explicitly
npm run dev:chrome
npm run dev:chromium
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

Copy `examples/pi-models.json` into `~/.pi/agent/models.json` or merge the provider into your existing file.

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

When an OpenAI request contains `tools`, the ChatGPT prompt includes Pi's tool schemas and asks ChatGPT to use protocol v3. Each argument is carried in its own raw block so HTML, source code, shell syntax, quotes, and multiline text never depend on JSON escaping:

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

The proxy turns that into a standard OpenAI `tool_calls` response with valid JSON arguments before Pi sees it. Numeric/boolean arguments are coerced using the tool schema Pi sent with the request.

The parser still accepts valid v2 JSON-style calls, old fenced calls, and bare single-tool JSON as compatibility fallbacks. If ChatGPT emits `PI_TOOL_CALL` markers that cannot be parsed at all, the proxy returns an explicit upstream error instead of leaking the markers to Pi as ordinary assistant text.

The proxy never executes local tools itself.

### Tool debugging

For a request such as "create hello.html", the proxy terminal should show a request containing Pi's tools and then a parsed tool-call response:

```text
tools: ["read", "bash", "edit", "write"]
finishReason: "tool_calls"
toolCalls: ["write"]
```

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Listen address |
| `PORT` | `4153` | Listen port |
| `PROXY_API_KEY` | unset | Optional bearer auth for the local API |
| `CHATGPT_PROXY_HOME` | `~/.config/chatgpt-web-session-proxy` | Base state directory |
| `CHATGPT_BROWSER` | `chrome` | Browser backend: `chrome` (recommended) or `chromium` |
| `CHATGPT_PROFILE_DIR` | browser-specific under `$CHATGPT_PROXY_HOME` | Persistent user-data directory |
| `CHATGPT_BROWSER_EXECUTABLE_PATH` | unset | Explicit Chrome/Chromium executable path |
| `CHATGPT_RUNTIME_MODE` | `minimized` | `minimized`, `headed`, or `headless` |
| `CHATGPT_STATE_DIR` | `$CHATGPT_PROXY_HOME/sessions` | Persisted session metadata |
| `CHATGPT_URL` | `https://chatgpt.com/` | Start URL |
| `CHATGPT_MAX_SESSIONS` | `8` | Maximum simultaneously open ChatGPT tabs |
| `CHATGPT_SESSION_TTL_MINUTES` | `120` | Close inactive live tabs after this many minutes; persisted state remains |
| `CHATGPT_TURN_TIMEOUT_SECONDS` | `300` | Maximum wait for a ChatGPT answer |
| `CHATGPT_SETTLE_MS` | `1200` | Stable-response delay after generation stops |

## Upgrading from the CDP-based version (≤ 0.8)

Version 0.9 removes the external-Chrome-over-CDP backend entirely. Migration steps:

1. Delete the old CDP state:
   ```bash
   rm -rf ~/.config/chatgpt-web-session-proxy/chrome-cdp-profile
   ```
2. Unset obsolete environment variables:
   ```bash
   unset CHATGPT_CDP_URL CHATGPT_LOGIN_CDP_URL CHATGPT_RUNTIME_PROFILE_DIR CHATGPT_CHROME_RUNTIME_MODE
   ```
3. Reinstall dependencies and the Patchright Chromium driver:
   ```bash
   rm -rf node_modules package-lock.json
   npm install
   npx patchright install chromium
   ```
4. Re-run the login flow with the new persistent profile:
   ```bash
   npm run login
   ```
5. Start the proxy:
   ```bash
   npm run dev
   ```

Existing `/v1/sessions/*` state under `$CHATGPT_STATE_DIR` remains valid; only the browser profile changes.

## Updating selectors

All current ChatGPT DOM assumptions are isolated in `src/browser.ts`. If the site changes, that is the first file to inspect.

Current fallbacks look for:

- `#prompt-textarea` and `data-testid=prompt-textarea`
- Lexical/ProseMirror `contenteditable` composers
- the lowest visible ARIA `textbox` as a final composer fallback
- send/stop buttons by `data-testid`, CSS class, or accessible label
- assistant messages via `data-message-author-role=assistant`

If the prompt is missing, the proxy distinguishes common login/security-challenge pages from a likely selector break and returns a more specific error.

## Development

```bash
npm run typecheck
npm test
npm run build
```

The repository contains unit tests for transcript prefix detection and tool-call parsing. Browser integration tests are intentionally not automated because they require a real logged-in ChatGPT account.