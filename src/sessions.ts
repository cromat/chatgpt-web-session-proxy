import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Page } from "playwright";
import { BrowserBackend } from "./browser.js";
import { config } from "./config.js";
import { parseAssistantTurn } from "./tool-protocol.js";
import { buildDeltaPrompt, buildInitialPrompt, commonPrefixLength } from "./transcript.js";
import type { AssistantTurn, ChatMessage, ToolDefinition } from "./types.js";

class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.tail.then(fn, fn);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

type Session = {
  id: string;
  page: Page;
  shadow: ChatMessage[];
  createdAt: number;
  touchedAt: number;
  queue: SerialQueue;
  conversationUrl?: string;
};

type PersistedSession = Omit<Session, "page" | "queue">;

export class SessionManager {
  private sessions = new Map<string, Session>();
  private cleanupTimer?: NodeJS.Timeout;
  constructor(private readonly browser: BrowserBackend) {}

  async init(): Promise<void> {
    await fs.mkdir(config.stateDir, { recursive: true, mode: 0o700 });
    await fs.chmod(config.stateDir, 0o700).catch(() => undefined);
  }

  startCleanupLoop(): void {
    this.cleanupTimer = setInterval(() => void this.cleanupExpired(), 60_000);
    this.cleanupTimer.unref();
  }

  async close(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    await Promise.allSettled([...this.sessions.values()].map((s) => s.page.close()));
    this.sessions.clear();
  }

  list() {
    return [...this.sessions.values()].map(({ id, createdAt, touchedAt, conversationUrl }) => ({ id, createdAt, touchedAt, conversationUrl }));
  }

  private statePath(id: string): string {
    const key = crypto.createHash("sha256").update(id).digest("hex");
    return path.join(config.stateDir, `${key}.json`);
  }

  private async readPersisted(id: string): Promise<PersistedSession | null> {
    try {
      const data = JSON.parse(await fs.readFile(this.statePath(id), "utf8")) as PersistedSession;
      if (data.id !== id || !Array.isArray(data.shadow)) return null;
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  private async persist(session: Session): Promise<void> {
    const data: PersistedSession = {
      id: session.id,
      shadow: session.shadow,
      createdAt: session.createdAt,
      touchedAt: session.touchedAt,
      conversationUrl: session.conversationUrl,
    };
    const target = this.statePath(session.id);
    const temp = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
    await fs.rename(temp, target);
  }

  async reset(id: string): Promise<boolean> {
    let deleted = false;
    const existing = this.sessions.get(id);
    if (existing) {
      this.sessions.delete(id);
      await existing.page.close().catch(() => undefined);
      deleted = true;
    }
    try {
      await fs.unlink(this.statePath(id));
      deleted = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    return deleted;
  }

  private async cleanupExpired(): Promise<void> {
    const cutoff = Date.now() - config.sessionTtlMs;
    for (const [id, session] of this.sessions) {
      if (session.touchedAt < cutoff) {
        this.sessions.delete(id);
        await session.page.close().catch(() => undefined);
      }
    }
  }

  private validConversationUrl(url: string | undefined): string | undefined {
    if (!url) return undefined;
    try {
      const parsed = new URL(url);
      if (parsed.origin === "https://chatgpt.com" && parsed.pathname.startsWith("/c/")) return parsed.toString();
    } catch {
      // Ignore malformed persisted URL.
    }
    return undefined;
  }

  private async getOrCreate(id: string): Promise<Session> {
    const existing = this.sessions.get(id);
    if (existing) {
      existing.touchedAt = Date.now();
      return existing;
    }

    if (this.sessions.size >= config.maxSessions) {
      const oldest = [...this.sessions.values()].sort((a, b) => a.touchedAt - b.touchedAt)[0];
      if (oldest) {
        this.sessions.delete(oldest.id);
        await oldest.page.close().catch(() => undefined);
      }
    }

    const persisted = await this.readPersisted(id);
    const restoredUrl = this.validConversationUrl(persisted?.conversationUrl);
    const page = await this.browser.newConversationPage(restoredUrl);
    if (persisted?.shadow.length && restoredUrl) {
      const actualUrl = this.validConversationUrl(page.url());
      const expectedPath = new URL(restoredUrl).pathname;
      const actualPath = actualUrl ? new URL(actualUrl).pathname : undefined;
      if (actualPath !== expectedPath) {
        await page.close().catch(() => undefined);
        throw new SessionRestoreError(`ChatGPT no longer opened the saved conversation for session ${id}. Reset the local session and start a new ChatGPT conversation.`);
      }
    }
    const now = Date.now();
    const session: Session = {
      id,
      page,
      shadow: persisted?.shadow ?? [],
      createdAt: persisted?.createdAt ?? now,
      touchedAt: now,
      queue: new SerialQueue(),
      conversationUrl: persisted?.conversationUrl,
    };
    this.sessions.set(id, session);
    return session;
  }

  async complete(id: string, messages: ChatMessage[], tools: ToolDefinition[] = []): Promise<AssistantTurn> {
    const session = await this.getOrCreate(id);
    return session.queue.run(async () => {
      session.touchedAt = Date.now();
      let prompt: string;
      if (session.shadow.length === 0) {
        prompt = buildInitialPrompt(messages, tools);
      } else {
        const prefix = commonPrefixLength(session.shadow, messages);
        if (prefix !== session.shadow.length) {
          throw new SessionDivergedError(`Session ${id} diverged at message ${prefix}. Reset it or use a new X-ChatGPT-Session value.`);
        }
        const delta = messages.slice(prefix);
        if (!delta.length) throw new SessionDivergedError(`Session ${id} has no new messages; refusing to duplicate an old ChatGPT turn.`);
        prompt = buildDeltaPrompt(delta, tools);
      }

      const turn = parseAssistantTurn(await this.browser.sendPrompt(session.page, prompt), tools);
      session.shadow = [...messages, { role: "assistant", content: turn.content, ...(turn.toolCalls.length ? { tool_calls: turn.toolCalls } : {}) }];
      session.conversationUrl = this.validConversationUrl(session.page.url()) ?? session.conversationUrl;
      await this.persist(session);
      return turn;
    });
  }
}

export class SessionDivergedError extends Error { override name = "SessionDivergedError"; }
export class SessionRestoreError extends Error { override name = "SessionRestoreError"; }
