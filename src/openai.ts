import crypto from "node:crypto";
import type { FastifyReply } from "fastify";
import type { AssistantTurn } from "./types.js";

const completionId = () => `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`;

export function jsonCompletion(model: string, turn: AssistantTurn) {
  return {
    id: completionId(), object: "chat.completion", created: Math.floor(Date.now() / 1000), model,
    choices: [{ index: 0, message: { role: "assistant", content: turn.content, ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls } : {}) }, finish_reason: turn.finishReason }],
    usage: null,
  };
}

export function streamCompletion(reply: FastifyReply, model: string, turn: AssistantTurn): void {
  const id = completionId();
  const created = Math.floor(Date.now() / 1000);
  reply.hijack();
  reply.raw.statusCode = 200;
  reply.raw.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  const send = (data: unknown) => reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });
  if (turn.toolCalls.length) {
    turn.toolCalls.forEach((call, index) => send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { tool_calls: [{ index, id: call.id, type: "function", function: { name: call.function.name, arguments: call.function.arguments } }] }, finish_reason: null }] }));
  } else if (turn.content) {
    send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: { content: turn.content }, finish_reason: null }] });
  }
  send({ id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: turn.finishReason }] });
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
}
