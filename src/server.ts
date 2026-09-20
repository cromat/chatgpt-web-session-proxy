import Fastify from "fastify";
import { BrowserBackend } from "./browser.js";
import { config } from "./config.js";
import { jsonCompletion, streamCompletion } from "./openai.js";
import { SessionDivergedError, SessionManager, SessionRestoreError } from "./sessions.js";
import type { ChatCompletionRequest } from "./types.js";

const app = Fastify({ logger: true, bodyLimit: 10 * 1024 * 1024 });
const browser = new BrowserBackend();
const sessions = new SessionManager(browser);
const MODEL_ID = "chatgpt-web-session";

app.addHook("onRequest", async (request, reply) => {
  if (config.apiKey && request.headers.authorization !== `Bearer ${config.apiKey}`) {
    return reply.code(401).send({ error: { message: "Unauthorized", type: "authentication_error" } });
  }
});

app.get("/health", async () => ({ ok: true, sessions: sessions.list().length }));
app.get("/v1/models", async () => ({ object: "list", data: [{ id: MODEL_ID, object: "model", created: 0, owned_by: "chatgpt-web-session-proxy" }] }));
app.get("/v1/sessions", async () => ({ data: sessions.list() }));
app.delete<{ Params: { id: string } }>("/v1/sessions/:id", async (request) => ({ id: request.params.id, deleted: await sessions.reset(request.params.id) }));

app.post<{ Body: ChatCompletionRequest }>("/v1/chat/completions", async (request, reply) => {
  const body = request.body;
  if (!body || !Array.isArray(body.messages) || !body.messages.length) return reply.code(400).send({ error: { message: "messages must be a non-empty array", type: "invalid_request_error" } });
  const rawSession = request.headers["x-chatgpt-session"];
  const sessionId = Array.isArray(rawSession) ? rawSession[0] : rawSession;
  if (!sessionId?.trim()) return reply.code(400).send({ error: { message: "Session mode requires X-ChatGPT-Session. Use a unique stable value for each Pi agent session/project.", type: "invalid_request_error" } });

  try {
    request.log.info({ sessionId: sessionId.trim(), tools: (body.tools ?? []).map((tool) => tool.function?.name).filter(Boolean) }, "chat completion request");
    const turn = await sessions.complete(sessionId.trim(), body.messages, body.tools ?? []);
    request.log.info({ sessionId: sessionId.trim(), finishReason: turn.finishReason, toolCalls: turn.toolCalls.map((call) => call.function.name) }, "chat completion response");
    if (body.stream) { streamCompletion(reply, body.model || MODEL_ID, turn); return; }
    return reply.send(jsonCompletion(body.model || MODEL_ID, turn));
  } catch (error) {
    request.log.error(error);
    if (error instanceof SessionDivergedError) return reply.code(409).send({ error: { message: error.message, type: "session_diverged" } });
    if (error instanceof SessionRestoreError) return reply.code(409).send({ error: { message: error.message, type: "session_restore_failed" } });
    return reply.code(502).send({ error: { message: error instanceof Error ? error.message : "ChatGPT web backend failed", type: "upstream_error" } });
  }
});

const shutdown = async () => { await sessions.close(); await browser.close(); await app.close(); };
process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

await sessions.init();
sessions.startCleanupLoop();
await app.listen({ host: config.host, port: config.port });
