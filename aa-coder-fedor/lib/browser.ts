import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { forceHub, hubRun, hubText, resetDriver, useHub } from "./coder-hub";
import { resolveUserPlace } from "./host-fs";
import {
  healClickKits,
  looksLikeClickFailure,
  preferredClickOrder,
  recordClickResult,
  type ClickKitId,
} from "./click-kit";
import {
  annotateClickObservation,
  looksLikeStaleClick,
  noteClickedKey,
  noteClickTacticChange,
  sameRefAdvice,
  sameRefAfterAccordion,
} from "./click-outcome";

type BrowserModule = typeof import("playwright");

type Session = {
  context: import("playwright").BrowserContext;
  page: import("playwright").Page;
  channel: string;
  lastAria: string;
};

const globalKey = "__grokCoderBrowser";

function slot(): { session: Session | null } {
  const g = globalThis as typeof globalThis & { [globalKey]?: { session: Session | null } };
  if (!g[globalKey]) g[globalKey] = { session: null };
  return g[globalKey]!;
}

function headedPreferred(): boolean {
  if (process.env.GROK_BROWSER_HEADLESS === "1") return false;
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

function profileDir(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "browser-profile");
  }
  return path.join(os.homedir(), ".fedor2", "browser-profile");
}

function clearStaleProfileLock(dir: string): void {
  for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    const lock = path.join(dir, name);
    if (!existsSync(lock)) continue;
    try {
      unlinkSync(lock);
    } catch {
      // still in use
    }
  }
}

async function loadPlaywright(): Promise<BrowserModule> {
  try {
    return (await import("playwright")) as BrowserModule;
  } catch {
    throw new Error(
      "Playwright is not installed. On this PC run: npm install (Chrome or Edge will be used as the real browser)."
    );
  }
}

function attachPages(session: Session): void {
  session.context.on("page", (page) => {
    session.page = page;
  });
}

function activePage(session: Session): import("playwright").Page {
  const open = session.context.pages().filter((page) => !page.isClosed());
  if (!open.length) {
    throw new Error("The browser window closed. Call browser_navigate again.");
  }
  if (session.page.isClosed() || !open.includes(session.page)) {
    session.page = open[open.length - 1];
  }
  return session.page;
}

async function launchSession(): Promise<Session> {
  const playwright = await loadPlaywright();
  const headless = !headedPreferred();
  const userDataDir = profileDir();
  mkdirSync(userDataDir, { recursive: true });
  const downloadsPath = resolveUserPlace("downloads");
  mkdirSync(downloadsPath, { recursive: true });
  const channels =
    process.platform === "win32"
      ? ["msedge", "chrome", "chromium"]
      : ["chrome", "msedge", "chromium"];

  let lastError: unknown;
  for (const channel of channels) {
    for (const retry of [0, 1]) {
      if (retry === 1) clearStaleProfileLock(userDataDir);
      try {
        const options: Parameters<BrowserModule["chromium"]["launchPersistentContext"]>[1] = {
          headless,
          viewport: { width: 1400, height: 900 },
          locale: "ru-RU",
          acceptDownloads: true,
          downloadsPath,
          ignoreHTTPSErrors: false,
        };
        if (channel !== "chromium") options.channel = channel;
        const context = await playwright.chromium.launchPersistentContext(userDataDir, options);
        const page = context.pages()[0] || (await context.newPage());
        const session: Session = { context, page, channel, lastAria: "" };
        attachPages(session);
        return session;
      } catch (error) {
        lastError = error;
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Could not open a real browser on this PC (${os.hostname()}). Install Google Chrome or Microsoft Edge. ${reason}`
  );
}

async function session(): Promise<Session> {
  const store = slot();
  if (store.session) {
    try {
      const pages = store.session.context.pages().filter((page) => !page.isClosed());
      if (pages.length) {
        activePage(store.session);
        return store.session;
      }
    } catch {
      store.session = null;
    }
  }
  store.session = await launchSession();
  return store.session;
}

function looksLikeHumanCheck(title: string, text: string, url: string): boolean {
  const blob = `${title}\n${text}\n${url}`.toLowerCase();
  return (
    blob.includes("captcha") ||
    blob.includes("recaptcha") ||
    blob.includes("hcaptcha") ||
    blob.includes("cf-challenge") ||
    blob.includes("checking if the site connection is secure") ||
    blob.includes("verify you are human") ||
    (blob.includes("подтв") && blob.includes("робот"))
  );
}

function humanCheckNote(flag: boolean): string {
  if (!flag) return "";
  return `

HUMAN CHECK: this page looks like a captcha / bot wall. Do NOT solve it. Do not retry tricks. Tell the user to complete it in the visible browser window, then continue.`;
}

function parseAriaRef(yaml: string, ref: string): { role: string; name: string } | null {
  const key = ref.replace(/^\[ref=/, "").replace(/\]$/, "");
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = yaml.match(
    new RegExp(`-\\s+([\\w-]+)(?:\\s+"((?:\\\\.|[^"\\\\])*)")?[^\\n]*\\[ref=${escaped}\\]`)
  );
  if (!match) return null;
  return { role: match[1], name: (match[2] || "").replace(/\\"/g, '"') };
}

async function pause(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function followNewPage(current: Session, beforeCount: number): Promise<void> {
  await pause(400);
  const pages = current.context.pages().filter((page) => !page.isClosed());
  if (pages.length > beforeCount) {
    current.page = pages[pages.length - 1];
    await current.page.waitForLoadState("domcontentloaded").catch(() => undefined);
  }
}

export async function browserNavigate(url: string): Promise<string> {
  if (await useHub()) return hubText(await hubRun("open", [url]));
  const target = url.trim();
  if (!/^https?:\/\//i.test(target)) {
    return "url must start with http:// or https://";
  }
  const current = await session();
  const page = activePage(current);
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await pause(400);
  return await browserSnapshot();
}

export async function browserSnapshot(): Promise<string> {
  if (await useHub()) return hubText(await hubRun("snapshot"));
  const current = await session();
  const page = activePage(current);
  const title = await page.title();
  const loc = await page
    .evaluate(() => ({ href: String(location.href || ""), hash: String(location.hash || "") }))
    .catch(() => ({ href: page.url(), hash: "" }));
  const url = loc.href || page.url();
  const hash = loc.hash || (url.includes("#") ? url.slice(url.indexOf("#")) : "");
  const tokenHit = `${hash} ${url}`.match(/access_token=([^&\s#]+)/i);
  const aria = await page.ariaSnapshot({ mode: "ai", timeout: 8_000 });
  current.lastAria = aria;
  const text = ((await page.innerText("body").catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 1500);
  const flag = looksLikeHumanCheck(title, `${text}\n${aria}`, url);
  const tabs = current.context
    .pages()
    .filter((item) => !item.isClosed())
    .map((item, index) => `${index + 1}:${item.url()}`)
    .join(" | ");
  const lines = [
    `browser=${current.channel} headed=${headedPreferred() ? "yes" : "no"} host=${os.hostname()} profile=${profileDir()}`,
    `tabs: ${tabs || "(none)"}`,
    `url: ${url}`,
    `hash: ${hash || "(none)"}`,
  ];
  if (tokenHit?.[1]) {
    lines.push(`access_token: ${tokenHit[1]}`);
    lines.push(
      "TOKEN_READY: full token is on the access_token line. Use it in the next API call this turn. Do not ask the user to paste it. Do not say it is truncated.",
    );
  }
  lines.push(`title: ${title}`, "aria:", aria.slice(0, 6000) || "(none)", "visible text:", text || "(empty)");
  return lines.join("\n") + humanCheckNote(flag);
}

async function refuseHumanCheck(): Promise<string | null> {
  const snap = await browserSnapshot();
  if (snap.includes("HUMAN CHECK:")) {
    return "HUMAN CHECK: captcha/bot wall. Not clicking or typing. Complete it in the visible window, then continue.";
  }
  return null;
}

async function playwrightClick(page: import("playwright").Page, key: string, lastAria: string): Promise<{ kit: ClickKitId; ok: boolean }> {
  const node = parseAriaRef(lastAria, key);
  const attempts: Array<{ kit: ClickKitId; run: () => Promise<void> }> = [];
  if (node?.name) {
    attempts.push({
      kit: "playwright-locator",
      run: () => page.getByRole(node.role as never, { name: node.name }).first().click({ timeout: 6000 }),
    });
  }
  attempts.push({
    kit: "playwright-locator",
    run: () => page.getByText(key, { exact: false }).first().click({ timeout: 6000 }),
  });
  attempts.push({
    kit: "playwright-locator",
    run: () =>
      page
        .locator("button,a,[role='button'],input,summary")
        .filter({ hasText: key })
        .first()
        .click({ timeout: 6000, force: true }),
  });
  attempts.push({
    kit: "playwright-js",
    run: async () => {
      const ok = await page.evaluate((q) => {
        const ql = String(q || "").replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
        const all = [...document.querySelectorAll("a,button,input,textarea,select,summary,option,[role='button'],[role='link'],[role='option'],[role='menuitem'],[role='listbox'],[role='menu'],[role='dialog'],[onclick],label")];
        let el = null;
        const ref = ql.match(/^e(\d+)$/);
        if (ref) el = all[Number(ref[1]) - 1] || null;
        if (!el) {
          el =
            all.find((node) =>
              ((node as HTMLElement).innerText || (node as HTMLInputElement).value || node.getAttribute("aria-label") || "")
                .toLowerCase()
                .includes(ql),
            ) || null;
        }
        if (!el) return false;
        (el as HTMLElement).scrollIntoView({ block: "center" });
        (el as HTMLElement).click();
        return true;
      }, key);
      if (!ok) throw new Error("playwright-js: not found");
    },
  });
  attempts.push({
    kit: "playwright-mouse",
    run: async () => {
      const loc = node?.name
        ? page.getByRole(node.role as never, { name: node.name }).first()
        : page.getByText(key, { exact: false }).first();
      const box = await loc.boundingBox();
      if (!box) throw new Error("no box");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    },
  });

  let lastError = "";
  const seen = new Set<string>();
  for (const attempt of attempts) {
    try {
      await attempt.run();
      recordClickResult(attempt.kit, true);
      return { kit: attempt.kit, ok: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!seen.has(attempt.kit)) {
        recordClickResult(attempt.kit, false, lastError);
        seen.add(attempt.kit);
      }
    }
  }
  throw new Error(lastError || "playwright click failed");
}

export async function browserClick(refOrText: string): Promise<string> {
  const key = refOrText.trim();
  if (!key) return "ref or text is required";
  if (sameRefAfterAccordion(key)) return sameRefAdvice(key);
  noteClickTacticChange(false);
  const blocked = await refuseHumanCheck();
  if (blocked) return blocked;
  const errors: string[] = [];
  const order = preferredClickOrder().filter((kit) => kit !== "cdp-mouse" && kit !== "playwright-chromium");
  noteClickedKey(key);

  const tryHub = async (): Promise<string | null> => {
    if (!(await useHub())) return null;
    const result = await hubRun("click", [key]);
    const text = hubText(result);
    if (result.ok !== false && !looksLikeClickFailure(text)) {
      const kit = String(result.kit) === "cdp-mouse" ? "cdp-mouse" : "cdp-js";
      recordClickResult(kit, true);
      noteClickTacticChange(Boolean(result.tactic) || looksLikeStaleClick(text));
      return text;
    }
    noteClickTacticChange(false);
    recordClickResult("cdp-js", false, text);
    errors.push(`hub: ${text.slice(0, 180)}`);
    resetDriver();
    return null;
  };

  const tryPlaywright = async (): Promise<string | null> => {
    try {
      const current = await session();
      const beforeSnap = await browserSnapshot();
      const page = activePage(current);
      const before = current.context.pages().length;
      const hit = await playwrightClick(page, key, current.lastAria);
      await followNewPage(current, before);
      const snap = await browserSnapshot();
      return annotateClickObservation(key, beforeSnap, `клик «${key}» [${hit.kit}]\n${snap}`);
    } catch (error) {
      noteClickTacticChange(false);
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`playwright: ${message}`);
      return null;
    }
  };

  for (const kit of order) {
    if (kit.startsWith("cdp") || kit === "puppeteer-core") {
      const hubOut = await tryHub();
      if (hubOut) return hubOut;
    }
    if (kit.startsWith("playwright")) {
      const pw = await tryPlaywright();
      if (pw) return pw;
    }
  }

  const hubOut = await tryHub();
  if (hubOut) return hubOut;
  const pw = await tryPlaywright();
  if (pw) return pw;

  const heal = await healClickKits(errors.join(" | ") || `не кликнул «${key}»`);
  const retryHub = await tryHub();
  if (retryHub) return `${heal}\n${retryHub}`;
  const retryPw = await tryPlaywright();
  if (retryPw) return `${heal}\n${retryPw}`;
  return `не сработал клик «${key}». ${heal}\n${errors.join("\n") || "ни один набор не попал"}\nСнимите snapshot и вызовите browser_click снова — кодер сменит набор сам.`;
}

export async function browserType(refOrSelector: string, text: string, submit = false): Promise<string> {
  if (await useHub()) {
    if (refOrSelector?.trim()) await hubRun("click", [refOrSelector.trim()]);
    const args = [text];
    if (submit) args.push("--submit");
    return hubText(await hubRun("type", args));
  }
  const blocked = await refuseHumanCheck();
  if (blocked) return blocked;
  const current = await session();
  if (!current.lastAria) await browserSnapshot();
  const key = refOrSelector.trim();
  const page = activePage(current);
  if (!key) {
    await page.keyboard.type(text, { delay: 15 });
  } else {
    const node = parseAriaRef(current.lastAria, key);
    const locator = node
      ? page.getByRole(node.role as never, node.name ? { name: node.name } : undefined).first()
      : page.locator(key).first();
    await locator.click({ timeout: 10_000 });
    await locator.fill(text, { timeout: 10_000 }).catch(async () => {
      await page.keyboard.type(text, { delay: 20 });
    });
  }
  if (submit) await page.keyboard.press("Enter");
  await pause(300);
  return await browserSnapshot();
}

export async function browserPress(key: string): Promise<string> {
  if (await useHub()) return hubText(await hubRun("key", [key]));
  const current = await session();
  await activePage(current).keyboard.press(key);
  await pause(200);
  return await browserSnapshot();
}

export async function browserScroll(
  direction: "down" | "up" | "top" | "bottom" = "down"
): Promise<string> {
  if (await useHub()) return hubText(await hubRun("scroll", [direction]));
  const current = await session();
  const page = activePage(current);
  if (direction === "top") {
    await page.evaluate(() => window.scrollTo(0, 0));
  } else if (direction === "bottom") {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  } else {
    await page.mouse.wheel(0, direction === "up" ? -900 : 900);
  }
  await pause(250);
  return await browserSnapshot();
}

export async function browserBack(): Promise<string> {
  if (await useHub()) return hubText(await hubRun("back"));
  const current = await session();
  await activePage(current).goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
  await pause(300);
  return await browserSnapshot();
}

export async function browserForward(): Promise<string> {
  if (await useHub()) return hubText(await hubRun("forward"));
  const current = await session();
  await activePage(current).goForward({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
  await pause(300);
  return await browserSnapshot();
}

export async function browserWait(ms: number): Promise<string> {
  if (await useHub()) return hubText(await hubRun("wait", [String(ms)]));
  await session();
  await pause(Math.min(Math.max(ms, 0), 20_000));
  return await browserSnapshot();
}

export async function browserTabs(query = ""): Promise<string> {
  if (await useHub()) return hubText(await hubRun("tabs", query ? [query] : []));
  const current = await session();
  const pages = current.context.pages().filter((page) => !page.isClosed());
  return pages.map((page, index) => `${index + 1}. ${page.url()}`).join("\n") || "вкладок нет";
}

export async function browserEngine(id: string): Promise<string> {
  const result = await hubRun("doctor", id ? [id] : []);
  if (result.ok) forceHub();
  return hubText(result);
}

export async function browserScreenshot(kind: "tab" | "screen" = "tab", dest = ""): Promise<string> {
  const args = [kind];
  if (dest) args.push(dest);
  return hubText(await hubRun("screenshot", args));
}

export async function pcWindows(): Promise<string> {
  return hubText(await hubRun("windows"));
}

export async function pcFocus(title: string): Promise<string> {
  return hubText(await hubRun("focus", [title]));
}

export async function browserClose(): Promise<string> {
  if (await useHub()) {
    return "Окно Edge/Chrome не закрывал — debug-порт остаётся. Можно снова tabs / snapshot. Чтобы закрыть вкладку: browser tool closetab.";
  }
  const store = slot();
  if (!store.session) return "No browser is open.";
  try {
    await store.session.context.close();
  } catch {
    // ignore
  }
  store.session = null;
  return "Closed the real browser window on this PC.";
}
