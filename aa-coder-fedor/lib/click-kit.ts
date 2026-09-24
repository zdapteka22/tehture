import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { lastClickWasAccordion, looksLikeStaleClick } from "./click-outcome";

export type ClickKitId =
  | "cdp-js"
  | "cdp-mouse"
  | "playwright-locator"
  | "playwright-js"
  | "playwright-mouse"
  | "puppeteer-core"
  | "playwright-chromium";

export type ClickKitKind = "bundled" | "npm" | "browser";

export type ClickKitRecord = {
  id: ClickKitId;
  kind: ClickKitKind;
  wins: number;
  losses: number;
  lastError: string;
  installed: boolean;
  kept: boolean;
};

const BUNDLED: Array<{ id: ClickKitId; kind: ClickKitKind }> = [
  { id: "cdp-js", kind: "bundled" },
  { id: "cdp-mouse", kind: "bundled" },
  { id: "playwright-locator", kind: "bundled" },
  { id: "playwright-js", kind: "bundled" },
  { id: "playwright-mouse", kind: "bundled" },
];

const DOWNLOADABLE: Array<{ id: ClickKitId; kind: ClickKitKind; npm?: string }> = [
  { id: "puppeteer-core", kind: "npm", npm: "puppeteer-core" },
];

const DEAD_KITS = new Set<ClickKitId>(["cdp-mouse", "playwright-chromium"]);

const ALLOWED_NPM = new Set(["puppeteer-core"]);

type Ledger = { kits: ClickKitRecord[]; preferred: ClickKitId[]; updatedAt: number };

function emptyLedger(): Ledger {
  const kits = [...BUNDLED, ...DOWNLOADABLE].map((item) => ({
    id: item.id,
    kind: item.kind,
    wins: 0,
    losses: 0,
    lastError: "",
    installed: item.kind === "bundled",
    kept: item.kind === "bundled",
  }));
  return { kits, preferred: BUNDLED.map((item) => item.id), updatedAt: Date.now() };
}

export function clickKitDir(): string {
  const override = process.env.FEDOR_CLICK_KIT_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "kits", "click");
  }
  return path.join(os.homedir(), ".fedor2", "kits", "click");
}

function ledgerPath(): string {
  return path.join(clickKitDir(), "ledger.json");
}

export function looksLikeClickFailure(text: string): boolean {
  const raw = String(text || "");
  if (!raw.trim()) return true;
  if (looksLikeStaleClick(raw)) return false;
  return /не нашёл|не нашел|not found|timeout|timed out|intercepts pointer|not visible|not attached|no node|error|failed|не сработал клик|не кликнул|click failed|unknown tool|locator\./i.test(
    raw,
  );
}

/** True only when the click engine itself missed — not when a SPA accordion swallowed a successful click. */
export function shouldHealClickKit(reason = ""): boolean {
  if (lastClickWasAccordion()) return false;
  if (looksLikeStaleClick(reason)) return false;
  return true;
}

function refuseHealText(): string {
  return [
    "Это не сломанный клик — кнопка приняла нажатие, страница не ушла на новый URL.",
    "Другой движок не качаю: puppeteer / Playwright тут ничего не изменят.",
    "Смени тактику: browser_press Enter или клик по появившемуся пункту (Магазин / Интеграция), не по той же кнопке.",
  ].join(" ");
}

function readLedger(): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), "utf8")) as Partial<Ledger>;
    const base = emptyLedger();
    const byId = new Map((parsed.kits || []).map((item) => [item.id, item]));
    base.kits = base.kits.map((item) => ({ ...item, ...(byId.get(item.id) || {}) }));
    if (Array.isArray(parsed.preferred) && parsed.preferred.length) {
      base.preferred = parsed.preferred.filter((id) => base.kits.some((kit) => kit.id === id)) as ClickKitId[];
    }
    return base;
  } catch {
    return emptyLedger();
  }
}

function writeLedger(ledger: Ledger): void {
  mkdirSync(clickKitDir(), { recursive: true });
  ledger.updatedAt = Date.now();
  writeFileSync(ledgerPath(), `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

export function listClickKits(): ClickKitRecord[] {
  return readLedger().kits;
}

function isDeadKit(kit: ClickKitRecord): boolean {
  if (kit.id === "playwright-chromium" || kit.id === "cdp-mouse") return true;
  if (kit.wins <= 0 && kit.losses >= 3) return true;
  return false;
}

export function preferredClickOrder(): ClickKitId[] {
  const ledger = readLedger();
  const scored = [...ledger.kits]
    .filter((kit) => kit.installed && kit.kept && !isDeadKit(kit))
    .sort((a, b) => {
      if (a.id === "cdp-js") return -1;
      if (b.id === "cdp-js") return 1;
      return b.wins - b.losses - (a.wins - a.losses) || b.wins - a.wins;
    });
  const ids = scored.map((kit) => kit.id);
  if (!ids.includes("cdp-js")) ids.unshift("cdp-js");
  return ids.length ? ids : (["cdp-js"] as ClickKitId[]);
}

export function recordClickResult(id: ClickKitId, ok: boolean, error = ""): ClickKitRecord {
  const ledger = readLedger();
  const kit = ledger.kits.find((item) => item.id === id);
  if (!kit) return emptyLedger().kits[0];
  if (ok) {
    kit.wins += 1;
    kit.lastError = "";
    kit.kept = true;
    kit.installed = true;
    ledger.preferred = [id, ...ledger.preferred.filter((item) => item !== id)];
  } else {
    kit.losses += 1;
    kit.lastError = String(error || "").slice(0, 240);
    kit.kept = !(DEAD_KITS.has(id) && kit.wins <= 0 && kit.losses >= 3);
  }
  writeLedger(ledger);
  return kit;
}

export function deleteDownloadedKit(id: ClickKitId): string {
  const dir = path.join(clickKitDir(), id);
  if (!existsSync(dir)) return `набора ${id} на диске нет`;
  rmSync(dir, { recursive: true, force: true });
  return `удалил нерабочий набор ${id}`;
}

type Installer = (id: ClickKitId) => Promise<{ ok: boolean; message: string }>;

let installer: Installer = defaultInstaller;

export function setClickKitInstaller(fn: Installer | null): void {
  installer = fn || defaultInstaller;
}

async function defaultInstaller(id: ClickKitId): Promise<{ ok: boolean; message: string }> {
  if (process.env.FEDOR_CLICK_KIT_OFFLINE === "1") {
    return { ok: false, message: "офлайн: скачивание наборов выключено" };
  }
  const dir = path.join(clickKitDir(), id);
  mkdirSync(dir, { recursive: true });
  if (id === "puppeteer-core") {
    if (!ALLOWED_NPM.has("puppeteer-core")) return { ok: false, message: "пакет не из списка" };
    const proc = spawnSync("npm", ["install", "puppeteer-core@24.0.0", "--omit=dev", "--no-fund", "--no-audit"], {
      cwd: dir,
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const out = `${proc.stdout || ""}${proc.stderr || ""}`.trim().slice(0, 400);
    if ((proc.status ?? 1) !== 0) {
      rmSync(dir, { recursive: true, force: true });
      return { ok: false, message: out || "npm install puppeteer-core не удался" };
    }
    return { ok: true, message: "скачал puppeteer-core в набор клика" };
  }
  if (id === "playwright-chromium") {
    return {
      ok: false,
      message: "Chrome for Testing не качаю — использую системный Edge/Chrome. Рабочий набор: cdp-js.",
    };
  }
  return { ok: true, message: `${id} уже в кодере` };
}

function probeInstalled(id: ClickKitId): boolean {
  if (BUNDLED.some((item) => item.id === id)) return true;
  if (id === "puppeteer-core") {
    return existsSync(path.join(clickKitDir(), id, "node_modules", "puppeteer-core"));
  }
  if (id === "playwright-chromium") {
    return existsSync(path.join(os.homedir(), ".cache", "ms-playwright")) || process.platform === "win32";
  }
  return false;
}

/** Detect a broken click engine and try the next known kit. Experience is kept even if a download fails. */
export async function healClickKits(reason = ""): Promise<string> {
  if (!shouldHealClickKit(reason)) return refuseHealText();
  const ledger = readLedger();
  const lines = [`клик не проходит (${String(reason || "промах").slice(0, 160)}). Подбираю набор.`];
  const bundledReady = ledger.kits.filter((kit) => kit.kind === "bundled");
  lines.push(`встроенные: ${bundledReady.map((kit) => `${kit.id} +${kit.wins}/-${kit.losses}`).join(", ")}`);

  for (const spec of DOWNLOADABLE) {
    const kit = ledger.kits.find((item) => item.id === spec.id);
    if (!kit) continue;
    if (kit.installed && kit.kept) continue;
    if (!kit.installed && kit.losses >= 3) {
      lines.push(`${kit.id}: раньше не встал (+${kit.wins}/-${kit.losses}), запись оставил, сейчас не качаю повторно`);
      continue;
    }
    const installed = await installer(spec.id);
    lines.push(`${spec.id}: ${installed.message}`);
    kit.lastError = installed.ok ? "" : installed.message;
    kit.installed = installed.ok;
    kit.kept = true;
    if (!installed.ok) {
      kit.losses += 1;
      deleteDownloadedKit(spec.id);
      continue;
    }
    if (!probeInstalled(spec.id) && spec.id === "puppeteer-core") {
      kit.installed = false;
      kit.losses += 1;
      deleteDownloadedKit(spec.id);
      lines.push(`${spec.id}: скачался, но не находится — опыт записал, папку с недокачкой убрал`);
      continue;
    }
    ledger.preferred = [spec.id, ...ledger.preferred.filter((id) => id !== spec.id)];
    writeLedger(ledger);
    lines.push(`запомнил ${spec.id} как рабочий, следующие клики пойдут через него`);
    return lines.join("\n");
  }

  writeLedger(ledger);
  lines.push("скачивать больше нечего из белого списка. Дальше кручу cdp-js. cdp-mouse и Chrome for Testing не беру.");
  return lines.join("\n");
}

export function clickKitStatusText(): string {
  const kits = listClickKits();
  const order = preferredClickOrder();
  const lines = [
    "Наборы клика по кнопкам (опыт на этом ПК):",
    `порядок: ${order.join(" → ") || "—"}`,
    ...kits.map((kit) => {
      const mark = kit.kept && kit.installed ? "держу" : kit.installed ? "есть" : "нет";
      return `- ${kit.id} [${kit.kind}] ${mark}  побед ${kit.wins} / промахов ${kit.losses}${kit.lastError ? `  (${kit.lastError})` : ""}`;
    }),
    "Рабочий набор — cdp-js. cdp-mouse после серии промахов отключаю. Chrome for Testing не качаю, беру системный Edge/Chrome.",
    "Если клик сам падает (not found / timeout) — кодер меняет набор. puppeteer-core можно скачать; Playwright Chromium — нет.",
    "Если клик прошёл, а URL тот же — это меню/аккордеон. Движок не меняем, жмём появившийся пункт или Enter. click_kit на аккордеоне не вызывай.",
  ];
  return lines.join("\n");
}
