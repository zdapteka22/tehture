import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ensureLocalCopy, markLocalReported, readLocalCopy } from "./copy-local";
import { hubRoot } from "./hub-dir";
import type { TokenReport } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;

function inboxDir(): string {
  return path.join(hubRoot(), "inbox");
}

function ensureInbox(): string {
  const dir = inboxDir();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeTokenAsks(userIds: string[]): number {
  const dir = ensureInbox();
  const t = Date.now();
  for (const id of userIds) {
    const file = path.join(dir, `ask-${id}.json`);
    writeFileSync(file, `${JSON.stringify({ type: "ask-tokens", userId: id, t }, null, 2)}\n`, "utf8");
  }
  return userIds.length;
}

export function pendingAskIds(): string[] {
  try {
    return readdirSync(inboxDir())
      .filter((name) => name.startsWith("ask-") && name.endsWith(".json"))
      .map((name) => name.slice(4, -5));
  } catch {
    return [];
  }
}

export function writeTokenReply(report: TokenReport): string {
  const dir = ensureInbox();
  const id = report.userId || report.deviceId || "local";
  const file = path.join(dir, `reply-${id}.json`);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return file;
}

export function readTokenReplies(afterTs?: number): TokenReport[] {
  const dir = inboxDir();
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith("reply-") && name.endsWith(".json"));
  } catch {
    return [];
  }
  const out: TokenReport[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as TokenReport;
      if (typeof parsed.lifetimeTokens !== "number") continue;
      if (typeof afterTs === "number" && Number(parsed.t || 0) < afterTs) continue;
      out.push(parsed);
    } catch {
      // skip bad reply
    }
  }
  return out;
}

export function clearReplies(): void {
  const dir = inboxDir();
  let names: string[] = [];
  try {
    names = readdirSync(dir).filter((name) => name.startsWith("reply-") && name.endsWith(".json"));
  } catch {
    return;
  }
  for (const name of names) {
    try {
      unlinkSync(path.join(dir, name));
    } catch {
      // ignore
    }
  }
}

/** Spend from a report belongs to this user only by id or email — never by shared PC name. */
export function reportMatchesUser(
  report: { userId?: string; email?: string },
  user: { id?: string; email?: string },
): boolean {
  if (report.userId && user.id && report.userId === user.id) return true;
  const reportEmail = String(report.email || "").trim().toLowerCase();
  const userEmail = String(user.email || "").trim().toLowerCase();
  return Boolean(reportEmail && userEmail && reportEmail === userEmail);
}

export function findLocalUser<T extends { id?: string; email?: string }>(
  users: T[],
  copy: { userId?: string; email?: string } | null | undefined,
): T | undefined {
  if (!copy) return undefined;
  return users.find((user) => reportMatchesUser({ userId: copy.userId, email: copy.email }, user));
}

export function ownAskIds(
  asks: string[],
  input: { userId?: string; deviceId?: string },
): string[] {
  const mine = [input.userId, input.deviceId].filter((id): id is string => Boolean(id));
  if (!mine.length) return [];
  return asks.filter((id) => mine.includes(id));
}

export function clearAsks(userIds?: string[]): void {
  const dir = inboxDir();
  const ids = userIds || pendingAskIds();
  for (const id of ids) {
    const file = path.join(dir, `ask-${id}.json`);
    try {
      if (existsSync(file)) unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

function writeOwnReply(
  copy: ReturnType<typeof ensureLocalCopy>,
  input: {
    userId?: string;
    email?: string;
    lifetimeTokens: number;
    usedInWeek?: number;
    usedInFreeWindow?: number;
  },
  userId: string | undefined,
): void {
  writeTokenReply({
    type: "token-report",
    userId,
    email: copy.email || input.email,
    deviceId: copy.deviceId,
    deviceLabel: copy.deviceLabel,
    lifetimeTokens: Math.max(copy.lifetimeTokens, input.lifetimeTokens),
    usedInWeek: input.usedInWeek,
    usedInFreeWindow: input.usedInFreeWindow,
    lastSeenAt: Date.now(),
    t: Date.now(),
  });
}

/** This PC answers only its own ask. Never copy one spend onto every user. */
export function answerLocalAsks(input: {
  userId?: string;
  email?: string;
  lifetimeTokens: number;
  usedInWeek?: number;
  usedInFreeWindow?: number;
}): number {
  const copy = ensureLocalCopy({
    userId: input.userId,
    email: input.email,
    lifetimeTokens: input.lifetimeTokens,
    lastSeenAt: Date.now(),
  });
  const asks = pendingAskIds();
  const targets = ownAskIds(asks, { userId: input.userId || copy.userId, deviceId: copy.deviceId });
  const selfId = input.userId || copy.userId;
  if (!targets.length) {
    if (!selfId && !input.email && !copy.email) return 0;
    writeOwnReply(copy, input, selfId);
    markLocalReported();
    return 1;
  }
  for (const id of targets) {
    writeOwnReply(copy, input, id === copy.deviceId ? selfId || id : id);
  }
  clearAsks(targets);
  markLocalReported();
  return targets.length;
}

export function dailyDue(lastTokenReportAt?: number, now = Date.now()): boolean {
  if (!lastTokenReportAt) return true;
  return now - lastTokenReportAt >= DAY_MS;
}

export async function pushRemoteTokenReport(input: {
  token?: string;
  userId?: string;
  email?: string;
  lifetimeTokens: number;
  usedInWeek?: number;
  usedInFreeWindow?: number;
  lastSeenAt?: number;
}): Promise<boolean> {
  const raw = String(process.env.FEDOR_HUB_URL || "").trim().replace(/\/$/, "");
  if (!raw) return false;
  const token = String(input.token || process.env.FEDOR_ACCOUNT_TOKEN || "").trim();
  try {
    const res = await fetch(`${raw}/api/hub`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { "x-fedor-account": token } : {}),
      },
      body: JSON.stringify({
        action: "report-tokens",
        token,
        lifetimeTokens: input.lifetimeTokens,
        usedInWeek: input.usedInWeek,
        usedInFreeWindow: input.usedInFreeWindow,
        lastSeenAt: input.lastSeenAt || Date.now(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function flushDailyIfDue(input: {
  userId?: string;
  email?: string;
  lifetimeTokens: number;
  usedInWeek?: number;
  usedInFreeWindow?: number;
  lastTokenReportAt?: number;
}): boolean {
  const copy = readLocalCopy();
  const last = input.lastTokenReportAt ?? copy?.lastTokenReportAt;
  if (!dailyDue(last)) return false;
  answerLocalAsks(input);
  return true;
}
