import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, createHmac, randomBytes } from "node:crypto";
import path from "node:path";

import { APP_TITLE, APP_VERSION, isFreeEdition } from "../brand";
import { cryptoNote, quoteCrypto } from "./crypto-pay";
import { hubRoot } from "./hub-dir";
import { licenseFingerprint, verifyLicense } from "./license";
import {
  cryptoAddress,
  getPayConfig,
  hasCrypto,
  hasSbp,
  hasYookassa,
  hasYoomoneyWallet,
  paymentsReady,
  payReadinessNote,
  publicPayView,
  type PayConfig,
} from "./pay-config";
import {
  EXTRA_CREDIT_RUB,
  EXTRA_CREDIT_TOKENS,
  EXTRA_CREDIT_USD,
  FREE_WINDOW_MS,
  PLANS,
  estimateTokens,
  planById,
  tokensForChatTurn,
  type CryptoAsset,
  type PayMethod,
  type PlanId,
} from "./plans";
import { readLocalCopy, writeLocalSpend } from "./copy-local";
import {
  answerLocalAsks,
  clearReplies,
  findLocalUser,
  pendingAskIds,
  readTokenReplies,
  reportMatchesUser,
  writeTokenAsks,
} from "./token-sync";
import type { HubInvoice, HubState, HubUser, PayProvider, QuotaView, TokenReport, UserSort } from "./types";
import { createYookassaPayment, yoomoneyQuickpayUrl } from "./yoomoney";

const MAX_UNPAID_INVOICES = 8;
const SEAL_SECRET = "fedor2-hub-seal-v1";

function statePath(): string {
  return path.join(hubRoot(), "state.json");
}

function emptyState(): HubState {
  return { users: [], invoices: [], usedLicenses: [], usedPayRefs: [], updatedAt: Date.now() };
}

function userSeal(user: HubUser): string {
  return createHmac("sha256", SEAL_SECRET)
    .update(
      `${user.id}|${user.email}|${user.planId}|${user.extraTokens}|${user.usedInWeek}|${user.usedInFreeWindow}|${user.weekStartedAt}`,
    )
    .digest("hex");
}

function stateSeal(state: HubState): string {
  const body = state.users
    .map((user) => `${user.id}:${user.email}:${user.planId}:${user.extraTokens}:${user.usedInWeek}:${user.usedInFreeWindow}`)
    .join(";");
  return createHmac("sha256", SEAL_SECRET).update(body).digest("hex");
}

function hydrateUser(user: HubUser, integrityOk: boolean): HubUser {
  if (!integrityOk && (user.planId !== "free" || user.extraTokens > 0)) {
    user.planId = "free";
    user.extraTokens = 0;
  } else if (user.seal && user.seal !== userSeal(user) && (user.planId !== "free" || user.extraTokens > 0)) {
    user.planId = "free";
    user.extraTokens = 0;
  }
  return refreshWindows(user);
}

function readState(): HubState {
  try {
    const parsed = JSON.parse(readFileSync(statePath(), "utf8")) as Partial<HubState> & { integrity?: string };
    const state: HubState = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      invoices: Array.isArray(parsed.invoices) ? parsed.invoices : [],
      usedLicenses: Array.isArray(parsed.usedLicenses) ? parsed.usedLicenses : [],
      usedPayRefs: Array.isArray(parsed.usedPayRefs) ? parsed.usedPayRefs : [],
      updatedAt: parsed.updatedAt || Date.now(),
    };
    const integrityOk = !parsed.integrity || parsed.integrity === stateSeal(state);
    state.users = state.users.map((user) => hydrateUser(user, integrityOk));
    return state;
  } catch {
    return emptyState();
  }
}

function writeState(state: HubState): void {
  mkdirSync(hubRoot(), { recursive: true });
  state.updatedAt = Date.now();
  for (const user of state.users) user.seal = userSeal(user);
  const payload = { ...state, integrity: stateSeal(state) };
  const dest = statePath();
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, dest);
  } catch {
    writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    try {
      unlinkSync(tmp);
    } catch {
      // ignore
    }
  }
}

function sleepMs(ms: number): void {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    // hub writes are tiny; a short spin is enough on one PC
  }
}

function withLock<T>(fn: (state: HubState) => T): T {
  mkdirSync(hubRoot(), { recursive: true });
  const lock = `${statePath()}.lock`;
  const started = Date.now();
  for (;;) {
    try {
      const fd = openSync(lock, "wx");
      try {
        try {
          writeFileSync(fd, String(process.pid));
        } catch {
          // ignore
        }
        const state = readState();
        const result = fn(state);
        writeState(state);
        return result;
      } finally {
        closeSync(fd);
        try {
          unlinkSync(lock);
        } catch {
          // ignore
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      if (Date.now() - started > 6000) {
        try {
          unlinkSync(lock);
        } catch {
          // ignore
        }
      }
      if (Date.now() - started > 12000) throw new Error("Учёт занят, повторите ещё раз");
      sleepMs(20);
    }
  }
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(16)}_${randomBytes(4).toString("hex")}`;
}

function newToken(): string {
  return randomBytes(24).toString("hex");
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function weekStart(now = Date.now()): number {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diff = (day + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
}

function refreshWindows(user: HubUser, now = Date.now()): HubUser {
  const ws = weekStart(now);
  if (user.weekStartedAt !== ws) {
    user.weekStartedAt = ws;
    user.usedInWeek = 0;
  }
  if (now - (user.freeWindowStartedAt || 0) >= FREE_WINDOW_MS) {
    user.freeWindowStartedAt = now;
    user.usedInFreeWindow = 0;
  }
  return user;
}

function availableTokens(user: HubUser): number {
  refreshWindows(user);
  const plan = planById(user.planId);
  if (plan.id === "free") {
    const freeCap = PLANS[0].freeWindowTokens || 0;
    const freeLeft = Math.max(0, freeCap - user.usedInFreeWindow);
    return freeLeft + user.extraTokens;
  }
  const weekCap = plan.tokensPerWeek || 0;
  const weekLeft = Math.max(0, weekCap - user.usedInWeek);
  return weekLeft + user.extraTokens;
}

function spend(user: HubUser, tokens: number): { ok: boolean; quota: QuotaView } {
  refreshWindows(user);
  if (tokens <= 0) return { ok: true, quota: quotaOf(user) };
  if (availableTokens(user) < tokens) return { ok: false, quota: quotaOf(user) };
  let rest = tokens;
  if (user.planId !== "free") {
    const weekCap = planById(user.planId).tokensPerWeek || 0;
    const weekRoom = Math.max(0, weekCap - user.usedInWeek);
    const takeWeek = Math.min(weekRoom, rest);
    user.usedInWeek += takeWeek;
    rest -= takeWeek;
  }
  const takeExtra = Math.min(user.extraTokens, rest);
  user.extraTokens -= takeExtra;
  rest -= takeExtra;
  if (user.planId === "free") {
    const freeCap = PLANS[0].freeWindowTokens || 0;
    const freeRoom = Math.max(0, freeCap - user.usedInFreeWindow);
    const takeFree = Math.min(freeRoom, rest);
    user.usedInFreeWindow += takeFree;
    rest -= takeFree;
  }
  const spent = tokens - Math.max(0, rest);
  if (spent > 0) {
    user.lifetimeTokens = (user.lifetimeTokens || 0) + spent;
    user.lastSeenAt = Date.now();
  }
  return { ok: rest <= 0, quota: quotaOf(user) };
}

export function quotaOf(user: HubUser): QuotaView {
  refreshWindows(user);
  const plan = planById(user.planId);
  const freeCap = PLANS[0].freeWindowTokens || 0;
  const freeLeft = plan.id === "free" ? Math.max(0, freeCap - user.usedInFreeWindow) : 0;
  if (plan.id === "free") {
    const left = freeLeft + user.extraTokens;
    return {
      planId: plan.id,
      planName: plan.name,
      tokensLeft: left,
      tokensCap: freeCap,
      extraTokens: user.extraTokens,
      resetAt: (user.freeWindowStartedAt || Date.now()) + FREE_WINDOW_MS,
      windowKind: "free2h",
      fallbackFreeLeft: 0,
      blocked: left <= 0,
      openPay: left <= 0,
    };
  }
  const weekCap = plan.tokensPerWeek || 0;
  const weekLeft = Math.max(0, weekCap - user.usedInWeek);
  const left = weekLeft + user.extraTokens;
  return {
    planId: plan.id,
    planName: plan.name,
    tokensLeft: left,
    tokensCap: weekCap,
    extraTokens: user.extraTokens,
    resetAt: user.weekStartedAt + 7 * 24 * 60 * 60 * 1000,
    windowKind: "week",
    fallbackFreeLeft: 0,
    blocked: left <= 0,
    openPay: left <= 0,
  };
}

export function listPlans() {
  const cfg = getPayConfig();
  const view = publicPayView(cfg);
  return {
    usdRub: 84.2362,
    rateDate: "2026-09-16",
    extra: { usd: EXTRA_CREDIT_USD, rub: EXTRA_CREDIT_RUB, tokens: EXTRA_CREDIT_TOKENS },
    pay: {
      sbp: view.sbp,
      yoomoney: view.yoomoney,
      yookassa: view.yookassa,
      crypto: view.crypto,
      wallets: view.wallets,
      receiver: view.receiver,
      locked: view.locked,
      note: view.note,
    },
    plans: PLANS,
  };
}

function findOrCreateUser(state: HubState, input: { email: string; name?: string; deviceLabel?: string }): HubUser {
  const email = normalizeEmail(input.email);
  if (!email || !email.includes("@")) throw new Error("Нужна почта");
  let user = state.users.find((item) => item.email === email);
  if (!user) {
    user = {
      id: newId("usr"),
      email,
      name: (input.name || email.split("@")[0]).trim(),
      token: newToken(),
      planId: "free",
      createdAt: Date.now(),
      weekStartedAt: weekStart(),
      usedInWeek: 0,
      freeWindowStartedAt: Date.now(),
      usedInFreeWindow: 0,
      extraTokens: 0,
      deviceLabel: input.deviceLabel,
      lifetimeTokens: 0,
      lastSeenAt: Date.now(),
    };
    state.users.push(user);
  } else {
    if (input.name) user.name = input.name.trim();
    if (input.deviceLabel) user.deviceLabel = input.deviceLabel;
  }
  return user;
}

export function registerUser(input: { email: string; name?: string; deviceLabel?: string }): HubUser {
  return withLock((state) => findOrCreateUser(state, input));
}

export function userByToken(token: string | undefined | null): HubUser | null {
  if (!token) return null;
  const state = readState();
  const user = state.users.find((item) => item.token === token);
  return user ? refreshWindows(user) : null;
}

export function spentTokens(user: {
  lifetimeTokens?: number;
  usedInWeek?: number;
  usedInFreeWindow?: number;
}): number {
  const life = Math.max(0, Number(user.lifetimeTokens || 0));
  if (life > 0) return life;
  const windows = Math.max(0, Number(user.usedInWeek || 0)) + Math.max(0, Number(user.usedInFreeWindow || 0));
  return windows;
}

export function publicUser(user: HubUser) {
  const life = spentTokens(user);
  if ((user.lifetimeTokens || 0) < life) user.lifetimeTokens = life;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    planId: user.planId,
    quota: quotaOf(user),
    lifetimeTokens: life,
    lastSeenAt: user.lastSeenAt || 0,
    lastTokenReportAt: user.lastTokenReportAt || 0,
    usedInWeek: user.usedInWeek || 0,
    usedInFreeWindow: user.usedInFreeWindow || 0,
    deviceLabel: user.deviceLabel || "",
  };
}

export function sortUsers<T extends { name?: string; lastSeenAt?: number; lifetimeTokens?: number }>(
  users: T[],
  by: UserSort = "name",
): T[] {
  const copy = [...users];
  if (by === "lastSeen") copy.sort((a, b) => (b.lastSeenAt || 0) - (a.lastSeenAt || 0));
  else if (by === "tokens") copy.sort((a, b) => (b.lifetimeTokens || 0) - (a.lifetimeTokens || 0));
  else copy.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ru"));
  return copy;
}

export function peekUsers(): HubUser[] {
  return readState().users.map((user) => ({ ...refreshWindows(user) }));
}

export function applyTokenReport(report: TokenReport | {
  userId?: string;
  email?: string;
  deviceLabel?: string;
  lifetimeTokens?: number;
  usedInWeek?: number;
  usedInFreeWindow?: number;
  lastSeenAt?: number;
}): HubUser | null {
  return withLock((state) => {
    let user = state.users.find((item) =>
      reportMatchesUser(
        {
          userId: report.userId,
          email: report.email ? normalizeEmail(String(report.email)) : undefined,
        },
        item,
      ),
    );
    if (!user) {
      const email = report.email ? normalizeEmail(String(report.email)) : "";
      const fallback = email && email.includes("@") ? email : `copy.${String(report.userId || report.deviceLabel || Date.now()).replace(/[^\w.-]+/g, "").slice(0, 24)}@local.fedor`;
      user = findOrCreateUser(state, {
        email: fallback,
        name: report.deviceLabel || (email ? email.split("@")[0] : "Копия"),
        deviceLabel: report.deviceLabel,
      });
    }
    if (typeof report.lifetimeTokens === "number") {
      user.lifetimeTokens = Math.max(user.lifetimeTokens || 0, report.lifetimeTokens);
    }
    if (typeof report.usedInWeek === "number") {
      user.usedInWeek = Math.max(user.usedInWeek || 0, report.usedInWeek);
    }
    if (typeof report.usedInFreeWindow === "number") {
      user.usedInFreeWindow = Math.max(user.usedInFreeWindow || 0, report.usedInFreeWindow);
    }
    user.lifetimeTokens = spentTokens(user);
    user.lastSeenAt = Math.max(user.lastSeenAt || 0, report.lastSeenAt || Date.now());
    user.lastTokenReportAt = Date.now();
    return { ...user };
  });
}

export function invoicesForUser(token: string): HubInvoice[] {
  const user = userByToken(token);
  if (!user) return [];
  const state = readState();
  return state.invoices.filter((item) => item.userId === user.id).slice(0, 30);
}

export function consumeTokens(token: string, texts: string[]): { ok: boolean; used: number; quota: QuotaView } {
  return withLock((state) => {
    const user = state.users.find((item) => item.token === token);
    if (!user) throw new Error("Нужен вход в аккаунт");
    const used = texts.reduce((sum, text) => sum + estimateTokens(text), 0);
    const result = spend(user, used);
    return { ok: result.ok, used, quota: result.quota };
  });
}

export function consumeChatTurn(token: string, text: string): { ok: boolean; used: number; quota: QuotaView; payUrl: string } {
  return withLock((state) => {
    const user = state.users.find((item) => item.token === token);
    if (!user) throw new Error("Нужен вход в аккаунт");
    const used = tokensForChatTurn(text);
    const result = spend(user, used);
    const reason = user.planId === "free" ? "trial" : "quota";
    try {
      writeLocalSpend(user.lifetimeTokens || 0, { userId: user.id, email: user.email });
    } catch {
      // local copy is optional
    }
    return { ok: result.ok, used, quota: result.quota, payUrl: `/pay?reason=${reason}&auto=1` };
  });
}

/** Paid SKU: keep Free 10/2h. Free-Setup stamp / FEDOR_SKU=free never opens /pay. */
export function meterPaidChatTurn(
  token: string | undefined | null,
  text: string,
): { ok: boolean; used: number; quota: QuotaView; payUrl: string; token: string } {
  if (isFreeEdition()) {
    const given = String(token || "").trim();
    const guest = given ? userByToken(given) : null;
    return {
      ok: true,
      used: 0,
      quota: guest
        ? quotaOf(guest)
        : {
            planId: "free",
            planName: "Free",
            tokensLeft: 1_000_000,
            tokensCap: 1_000_000,
            extraTokens: 0,
            resetAt: Date.now() + 2 * 60 * 60 * 1000,
            windowKind: "free2h",
            fallbackFreeLeft: 0,
            blocked: false,
            openPay: false,
          },
      payUrl: "",
      token: given,
    };
  }
  const given = String(token || "").trim();
  const tryToken = (value: string) => {
    try {
      return { token: value, ...consumeChatTurn(value, text) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (/Нужен вход/.test(message)) return null;
      throw error;
    }
  };
  if (given) {
    const hit = tryToken(given);
    if (hit) return hit;
  }
  const guest = ensureGuestUser({ name: "Гость", deviceLabel: "studio" });
  return { token: guest.token, ...consumeChatTurn(guest.token, text) };
}

function machineEmail(): string {
  const file = path.join(hubRoot(), "machine.json");
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as { email?: string };
      if (parsed.email && parsed.email.includes("@")) return normalizeEmail(parsed.email);
    }
  } catch {
    // ignore
  }
  const email = `pc.${randomBytes(6).toString("hex")}@local.fedor`;
  mkdirSync(hubRoot(), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ email }, null, 2)}\n`, "utf8");
  return email;
}

export function ensureGuestUser(input?: { email?: string; name?: string; deviceLabel?: string }): HubUser {
  const email = (input?.email || "").trim() || machineEmail();
  return registerUser({
    email,
    name: input?.name || "Гость",
    deviceLabel: input?.deviceLabel || "studio",
  });
}

function methodReady(method: PayMethod, asset: CryptoAsset | undefined, cfg: PayConfig): boolean {
  if (method === "yoomoney") return hasYookassa(cfg) || hasYoomoneyWallet(cfg);
  if (method === "sbp") return hasSbp(cfg);
  return hasCrypto(cfg, asset);
}

function payNote(method: PayMethod, asset: CryptoAsset | undefined, cfg: PayConfig): string {
  if (method === "yoomoney") {
    if (hasYookassa(cfg) || hasYoomoneyWallet(cfg)) {
      return "Карта: откройте ссылку оплаты. После перевода нажмите «Проверить оплату».";
    }
    return "Карта: настройки ещё не заданы. Вставьте их в Настройки → Приём оплаты.";
  }
  if (method === "sbp") {
    if (hasYookassa(cfg) || hasYoomoneyWallet(cfg)) {
      return "СБП: откройте ссылку оплаты. После перевода нажмите «Проверить оплату».";
    }
    const req = cfg.sbpRequisites || cfg.sbpPhone;
    if (req) return `СБП: ${req}. После перевода нажмите «Проверить оплату» или пришлите номер счёта.`;
    return "СБП: реквизиты ещё не заданы. Счёт уже создан.";
  }
  const addr = asset ? cryptoAddress(cfg, asset) : "";
  if (addr) return `${asset}: ${addr}. После перевода нажмите «Проверить оплату».`;
  return `Крипта (${asset || "USDT"}): адрес появится, когда вставите кошелёк в Настройки → Приём оплаты.`;
}

async function attachProviderPayment(invoice: HubInvoice): Promise<HubInvoice> {
  if (invoice.status === "waiting_credentials") return invoice;
  const cfg = getPayConfig();
  if (invoice.method === "crypto" && invoice.cryptoAsset) {
    const address = cryptoAddress(cfg, invoice.cryptoAsset);
    if (!address) return invoice;
    const quote = await quoteCrypto({
      asset: invoice.cryptoAsset,
      amountUsd: invoice.amountUsd,
      invoiceId: invoice.id,
      address,
    });
    return withLock((state) => {
      const inv = state.invoices.find((item) => item.id === invoice.id);
      if (!inv) return invoice;
      inv.payAddress = address;
      inv.exactPay = quote.exactCrypto || String(quote.exactUsd);
      inv.amountUsd = quote.exactUsd;
      inv.provider = "crypto";
      inv.note = cryptoNote(quote);
      inv.status = "pending";
      return { ...inv };
    });
  }
  if ((invoice.method === "yoomoney" || invoice.method === "sbp") && hasYookassa(cfg)) {
    try {
      const pay = await createYookassaPayment({
        cfg,
        invoiceId: invoice.id,
        amountRub: invoice.amountRub,
        description: `AA Coder Fedor ${invoice.planId || "extra"} ${invoice.id}`,
        sbp: invoice.method === "sbp",
      });
      return withLock((state) => {
        const inv = state.invoices.find((item) => item.id === invoice.id);
        if (!inv) return invoice;
        inv.provider = "yookassa";
        inv.providerPaymentId = pay.id;
        inv.payUrl = pay.confirmationUrl;
        inv.note = "Карта / СБП: откройте ссылку оплаты. После перевода нажмите «Проверить оплату».";
        return { ...inv };
      });
    } catch {
      // wallet quickpay below
    }
  }
  if ((invoice.method === "yoomoney" || invoice.method === "sbp") && hasYoomoneyWallet(cfg)) {
    const payUrl = yoomoneyQuickpayUrl({
      receiver: cfg.yoomoneyReceiver,
      sum: invoice.amountRub,
      label: invoice.id,
      targets: `Fedor ${invoice.planId || "extra"} ${invoice.id}`,
      paymentType: invoice.method === "sbp" ? "SB" : "PC",
    });
    return withLock((state) => {
      const inv = state.invoices.find((item) => item.id === invoice.id);
      if (!inv) return invoice;
      inv.provider = "yoomoney";
      inv.payUrl = payUrl;
      inv.note = "Карта / СБП: откройте ссылку оплаты. После перевода нажмите «Проверить оплату».";
      return { ...inv };
    });
  }
  return invoice;
}

export async function createInvoice(input: {
  token: string;
  method: PayMethod;
  kind: "plan" | "extra";
  planId?: PlanId;
  period?: "month" | "year";
  cryptoAsset?: CryptoAsset;
}): Promise<HubInvoice> {
  const cfg = getPayConfig();
  const invoice = withLock((state) => {
    const user = state.users.find((item) => item.token === input.token);
    if (!user) throw new Error("Нужен вход в аккаунт");
    const unpaid = state.invoices.filter(
      (item) => item.userId === user.id && (item.status === "pending" || item.status === "waiting_credentials"),
    ).length;
    if (unpaid >= MAX_UNPAID_INVOICES) {
      throw new Error("Слишком много неоплаченных счетов. Оплатите предыдущий или подождите код активации.");
    }
    let amountUsd = EXTRA_CREDIT_USD;
    let amountRub = EXTRA_CREDIT_RUB;
    let extraTokens = EXTRA_CREDIT_TOKENS;
    if (input.kind === "plan") {
      const plan = planById(input.planId);
      if (plan.id === "free") throw new Error("Бесплатный тариф не оплачивается");
      if (input.period === "year" && plan.usdYear && plan.rubYear) {
        amountUsd = plan.usdYear;
        amountRub = plan.rubYear;
      } else {
        amountUsd = plan.usdMonth;
        amountRub = plan.rubMonth;
      }
      extraTokens = 0;
    }
    const ready = methodReady(input.method, input.cryptoAsset, cfg);
    const draft: HubInvoice = {
      id: newId("inv"),
      userId: user.id,
      kind: input.kind,
      planId: input.kind === "plan" ? planById(input.planId).id : undefined,
      period: input.kind === "plan" ? input.period || "month" : undefined,
      method: input.method,
      cryptoAsset: input.cryptoAsset,
      amountRub,
      amountUsd,
      extraTokens: input.kind === "extra" ? extraTokens : undefined,
      status: ready ? "pending" : "waiting_credentials",
      createdAt: Date.now(),
      note: payNote(input.method, input.cryptoAsset, cfg),
    };
    state.invoices.unshift(draft);
    return draft;
  });
  return attachProviderPayment(invoice);
}

function applyPaidInvoice(user: HubUser, invoice: HubInvoice): void {
  if (invoice.kind === "plan" && invoice.planId) user.planId = invoice.planId;
  if (invoice.kind === "extra") user.extraTokens += invoice.extraTokens || EXTRA_CREDIT_TOKENS;
}

export function markInvoicePaid(invoiceId: string, adminKey: string): HubInvoice {
  const expected = process.env.FEDOR_HUB_ADMIN_KEY || "";
  if (!expected || adminKey !== expected) throw new Error("Нет права отметить оплату");
  return fulfillInvoice(invoiceId, { provider: "sbp", ref: `admin:${invoiceId}`, note: "отмечено вручную" });
}

export function invoiceById(invoiceId: string): HubInvoice | null {
  return readState().invoices.find((item) => item.id === invoiceId) || null;
}

export function listUsedPayRefs(): string[] {
  return [...(readState().usedPayRefs || [])];
}

export function fulfillInvoice(
  invoiceId: string,
  proof: { provider: PayProvider; ref: string; note: string },
): HubInvoice {
  return withLock((state) => {
    const invoice = state.invoices.find((item) => item.id === invoiceId);
    if (!invoice) throw new Error("Счёт не найден");
    const user = state.users.find((item) => item.id === invoice.userId);
    if (!user) throw new Error("Пользователь не найден");
    const ref = `${proof.provider}:${proof.ref}`;
    const used = state.usedPayRefs || [];
    const taken = used.includes(ref) && invoice.status !== "paid";
    if (taken) throw new Error("Этот платёж уже привязан к другому счёту");
    if (invoice.status === "paid") return invoice;
    invoice.status = "paid";
    invoice.provider = proof.provider;
    invoice.txId = proof.ref;
    invoice.checkNote = proof.note;
    invoice.checkedAt = Date.now();
    applyPaidInvoice(user, invoice);
    if (!used.includes(ref)) state.usedPayRefs = [...used, ref];
    return { ...invoice };
  });
}

export function activateLicense(token: string, code: string): { user: HubUser; payload: ReturnType<typeof verifyLicense> } {
  const payload = verifyLicense(code);
  const fp = payload.jti || licenseFingerprint(code);
  return withLock((state) => {
    if ((state.usedLicenses || []).includes(fp)) throw new Error("Этот код уже использован");
    let user = state.users.find((item) => item.token === token);
    if (!user) throw new Error("Нужен вход в аккаунт");
    const licenseEmail = payload.email.trim().toLowerCase();
    const guest = /@local\.fedor$/.test(user.email);
    if (!guest && user.email !== licenseEmail) {
      throw new Error("Код выписан на другую почту. Войдите с той почтой, которую указывали при оплате.");
    }
    if (guest && licenseEmail) {
      const taken = state.users.find((item) => item.email === licenseEmail && item.id !== user!.id);
      if (taken) throw new Error("Эта почта уже занята на этом ПК");
      user.email = licenseEmail;
    }
    if (payload.planId && payload.planId !== "free") user.planId = payload.planId;
    if (payload.extraTokens) user.extraTokens += payload.extraTokens;
    if (payload.invoiceId) {
      const invoice = state.invoices.find((item) => item.id === payload.invoiceId && item.userId === user!.id);
      if (invoice && invoice.status !== "paid") invoice.status = "paid";
    }
    state.usedLicenses = [...(state.usedLicenses || []), fp];
    return { user, payload };
  });
}

export function listUsers(adminKey: string, sortBy: UserSort = "name") {
  const expected = process.env.FEDOR_HUB_ADMIN_KEY || "";
  if (!expected || adminKey !== expected) throw new Error("Нет права смотреть список");
  const state = readState();
  const users = sortUsers(
    state.users.map((user) => ({ ...publicUser(user), createdAt: user.createdAt })),
    sortBy,
  );
  return {
    dir: hubRoot(),
    users,
    invoices: state.invoices.slice(0, 50),
    sort: sortBy,
  };
}

const WINDOW_CAP = PLANS[0].freeWindowTokens || 20_000;

function looksLikeClonedWindowCap(users: { lifetimeTokens?: number }[]): boolean {
  if (users.length < 2) return false;
  return users.every((user) => spentTokens(user) === WINDOW_CAP);
}

/** Hub button «Проверить токены»: ask every copy, take only that copy's reply. */
export function checkTokens(adminKey: string, sortBy: UserSort = "tokens") {
  assertAdmin(adminKey);
  const askedAt = Date.now();
  clearReplies();
  const users = peekUsers();
  const asked = writeTokenAsks(users.map((user) => user.id));
  const copy = readLocalCopy();
  const local = findLocalUser(users, copy);
  if (local) {
    try {
      answerLocalAsks({
        userId: local.id,
        email: local.email,
        lifetimeTokens: Math.max(local.lifetimeTokens || 0, copy?.lifetimeTokens || 0),
        usedInWeek: local.usedInWeek,
        usedInFreeWindow: local.usedInFreeWindow,
      });
    } catch {
      // local miss is fine
    }
  }
  const replies = readTokenReplies(askedAt - 1000);
  const repliedIds = new Set<string>();
  let received = 0;
  for (const reply of replies) {
    const updated = applyTokenReport(reply);
    if (updated) {
      received += 1;
      if (updated.id) repliedIds.add(updated.id);
    }
  }
  if (looksLikeClonedWindowCap(peekUsers())) {
    withLock((state) => {
      for (const user of state.users) {
        if (!repliedIds.has(user.id)) {
          user.lifetimeTokens = 0;
        }
      }
    });
  }
  const view = listUsers(adminKey, sortBy);
  return { ...view, asked, received };
}

/** Copy answers a hub ask for this user only, when the inbox has one. */
export function answerPendingHubAsks(): number {
  const copy = readLocalCopy();
  const users = peekUsers();
  const me = findLocalUser(users, copy);
  const pending = pendingAskIds();
  if (!pending.length) return 0;
  if (me && pending.includes(me.id)) {
    return answerLocalAsks({
      userId: me.id,
      email: me.email,
      lifetimeTokens: me.lifetimeTokens || 0,
      usedInWeek: me.usedInWeek,
      usedInFreeWindow: me.usedInFreeWindow,
    });
  }
  if (copy?.userId && pending.includes(copy.userId)) {
    return answerLocalAsks({
      userId: copy.userId,
      email: copy.email,
      lifetimeTokens: copy.lifetimeTokens || 0,
    });
  }
  return 0;
}

function assertAdmin(adminKey: string): void {
  const expected = process.env.FEDOR_HUB_ADMIN_KEY || "";
  if (!expected || adminKey !== expected) throw new Error("Нет права смотреть список");
}

export function latestUpdate() {
  const file = process.env.FEDOR_UPDATE_URL || "";
  return {
    version: APP_VERSION,
    title: APP_TITLE,
    url: file,
    notes: "Обновления не публикуются открытой ссылкой.",
  };
}

export function hubStatus() {
  const state = readState();
  return {
    title: APP_TITLE,
    version: APP_VERSION,
    region: process.env.FEDOR_HUB_REGION || "local",
    users: state.users.length,
    invoices: state.invoices.length,
    paymentsReady: paymentsReady(),
    pay: publicPayView(),
    note: payReadinessNote(),
  };
}

export function fingerprintEmail(email: string): string {
  return createHash("sha1").update(normalizeEmail(email)).digest("hex").slice(0, 10);
}
