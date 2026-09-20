import { chromium, type BrowserContext, type Locator, type Page } from "patchright";
import { config } from "./config.js";
import { persistentContextOptions } from "./browser-launch.js";

const PROMPT_SELECTORS = [
  "#prompt-textarea",
  '[data-testid="prompt-textarea"]',
  'div[contenteditable="true"][data-lexical-editor="true"]',
  'div.ProseMirror[contenteditable="true"]',
  'textarea[placeholder*="Message"]',
];
const ASSISTANT_SELECTORS = [
  '[data-message-author-role="assistant"]',
  'article[data-testid^="conversation-turn-"] [data-message-author-role="assistant"]',
];
const SEND_SELECTORS = [
  'button[data-testid="send-button"]',
  'button[aria-label="Send prompt"]',
  'button[aria-label^="Send"]',
  'button.composer-submit-btn',
];
const STOP_SELECTORS = [
  'button[data-testid="stop-button"]',
  'button[aria-label^="Stop"]',
];

export class BrowserBackend {
  private context?: BrowserContext;

  async start(): Promise<void> {
    if (this.context) return;
    this.context = await chromium.launchPersistentContext(config.profileDir, persistentContextOptions());
  }

  async close(): Promise<void> {
    await this.context?.close().catch(() => undefined);
    this.context = undefined;
  }

  async newConversationPage(url = config.chatgptUrl): Promise<Page> {
    await this.start();
    const page = await this.context!.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await this.assertLoggedIn(page);
    return page;
  }

  private async firstVisible(page: Page, selectors: string[]): Promise<Locator | null> {
    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if ((await locator.count()) && (await locator.isVisible().catch(() => false))) return locator;
    }
    return null;
  }

  private async fallbackPrompt(page: Page): Promise<Locator | null> {
    const candidates = page.getByRole("textbox");
    const count = await candidates.count().catch(() => 0);
    let best: { locator: Locator; y: number } | undefined;
    for (let index = 0; index < count; index += 1) {
      const locator = candidates.nth(index);
      if (!(await locator.isVisible().catch(() => false))) continue;
      const box = await locator.boundingBox().catch(() => null);
      if (!box) continue;
      if (!best || box.y > best.y) best = { locator, y: box.y };
    }
    return best?.locator ?? null;
  }

  private async findPrompt(page: Page): Promise<Locator | null> {
    return (await this.firstVisible(page, PROMPT_SELECTORS)) ?? this.fallbackPrompt(page);
  }

  private async waitForPrompt(page: Page, timeoutMs = 30_000): Promise<Locator> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const prompt = await this.findPrompt(page);
      if (prompt) return prompt;
      await page.waitForTimeout(250);
    }
    throw new Error("Timed out waiting for the ChatGPT prompt editor.");
  }

  private async pageDiagnostic(page: Page): Promise<string> {
    const url = page.url();
    const title = await page.title().catch(() => "");
    const body = (await page.locator("body").innerText({ timeout: 1000 }).catch(() => ""))
      .replace(/\s+/g, " ")
      .slice(0, 400);
    const challenge = /verify you are human|checking your browser|just a moment|cloudflare|captcha|security check/i.test(
      `${title} ${body}`,
    );
    const login = /log in|sign up|continue with google|continue with microsoft|continue with apple/i.test(body);
    if (challenge) {
      return `The Patchright-launched browser tab appears to be on a bot/security challenge (${title || url}). Complete it manually with "npm run login" and retry.`;
    }
    if (login) {
      return `The persistent profile does not appear to be logged in to ChatGPT (${title || url}). Run "npm run login" first.`;
    }
    return `No ChatGPT prompt editor was found. URL=${url}${title ? ` title=${JSON.stringify(title)}` : ""}. The ChatGPT UI may have changed.`;
  }

  async assertLoggedIn(page: Page): Promise<void> {
    if (await this.waitForPrompt(page, 15_000).catch(() => null)) return;
    const diagnostic = await this.pageDiagnostic(page);
    throw new Error(
      `${diagnostic} If this persists, run "npm run login" with the same --browser and profile to refresh the session.`,
    );
  }

  private assistantLocator(page: Page): Locator {
    return page.locator(ASSISTANT_SELECTORS.join(","));
  }

  async sendPrompt(page: Page, text: string): Promise<string> {
    const assistants = this.assistantLocator(page);
    const before = await assistants.count();
    const prompt = await this.waitForPrompt(page);
    await prompt.click();
    await prompt.fill(text).catch(async () => {
      await prompt.press("ControlOrMeta+A");
      await prompt.press("Backspace");
      await prompt.pressSequentially(text, { delay: 0 });
    });

    const send = await this.firstVisible(page, SEND_SELECTORS);
    if (send) await send.click();
    else await prompt.press("Enter");

    const assistant = assistants.nth(before);
    await assistant.waitFor({ state: "visible", timeout: config.turnTimeoutMs });

    const deadline = Date.now() + config.turnTimeoutMs;
    let last = "";
    let stableSince = Date.now();
    while (Date.now() < deadline) {
      const current = (await assistant.innerText().catch(() => "")).trim();
      if (current !== last) {
        last = current;
        stableSince = Date.now();
      }
      const running = Boolean(await this.firstVisible(page, STOP_SELECTORS));
      if (last && !running && Date.now() - stableSince >= config.settleMs) return last;
      await page.waitForTimeout(250);
    }
    if (last) return last;
    throw new Error("Timed out waiting for ChatGPT to finish the response.");
  }
}