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

export function readTokenReplies(): TokenReport[] {
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
      if (typeof parsed.lifetimeTokens === "number") out.push(parsed);
    } catch {
      // skip bad reply
    }
  }
  return out;
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

/** This PC's coder answers a hub ask with current spend. */
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
  const mine = asks.filter((id) => !input.userId || id === input.userId || id === copy.deviceId);
  const targets = mine.length ? mine : input.userId ? [input.userId] : asks;
  if (!targets.length && !asks.length) {
    writeTokenReply({
      type: "token-report",
      userId: copy.userId || input.userId,
      email: copy.email || input.email,
      deviceId: copy.deviceId,
      deviceLabel: copy.deviceLabel,
      lifetimeTokens: Math.max(copy.lifetimeTokens, input.lifetimeTokens),
      usedInWeek: input.usedInWeek,
      usedInFreeWindow: input.usedInFreeWindow,
      lastSeenAt: Date.now(),
      t: Date.now(),
    });
    return 1;
  }
  let n = 0;
  for (const id of targets.length ? targets : [copy.userId || copy.deviceId]) {
    writeTokenReply({
      type: "token-report",
      userId: input.userId || id,
      email: copy.email || input.email,
      deviceId: copy.deviceId,
      deviceLabel: copy.deviceLabel,
      lifetimeTokens: Math.max(copy.lifetimeTokens, input.lifetimeTokens),
      usedInWeek: input.usedInWeek,
      usedInFreeWindow: input.usedInFreeWindow,
      lastSeenAt: Date.now(),
      t: Date.now(),
    });
    n += 1;
  }
  clearAsks(targets);
  markLocalReported();
  return n;
}

export function dailyDue(lastTokenReportAt?: number, now = Date.now()): boolean {
  if (!lastTokenReportAt) return true;
  return now - lastTokenReportAt >= DAY_MS;
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
