export type HeaderValue = string | string[] | undefined;

export type RequestHeaders = Record<string, HeaderValue>;

export const AUTO_SESSION_SENTINEL = "__PI_AUTO__";

export type SessionIdSource =
  | "x-chatgpt-session"
  | "x-session-affinity"
  | "x-client-request-id"
  | "x-session-id"
  | "session_id";

function firstHeader(value: HeaderValue): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim();
  return trimmed || undefined;
}

export function resolveRequestSessionId(
  headers: RequestHeaders,
  autoSession: boolean,
): { sessionId: string; source: SessionIdSource } | undefined {
  const explicit = firstHeader(headers["x-chatgpt-session"]);
  if (explicit && explicit != AUTO_SESSION_SENTINEL) {
    return { sessionId: explicit, source: "x-chatgpt-session" };
  }

  if (!autoSession) return undefined;

  const candidates: SessionIdSource[] = [
    "x-session-affinity",
    "x-client-request-id",
    "x-session-id",
    "session_id",
  ];

  for (const name of candidates) {
    const value = firstHeader(headers[name]);
    if (value) return { sessionId: value, source: name };
  }

  return undefined;
}
