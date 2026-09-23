import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { hubRoot } from "./hub-dir";

export type LocalCopy = {
  deviceId: string;
  deviceLabel: string;
  userId?: string;
  email?: string;
  lifetimeTokens: number;
  lastSeenAt: number;
  lastTokenReportAt?: number;
};

function copyPath(): string {
  return path.join(hubRoot(), "copy.json");
}

function newDeviceId(): string {
  const host = os.hostname() || "pc";
  return `dev_${host.replace(/[^\w.-]+/g, "_").slice(0, 40)}`;
}

export function readLocalCopy(): LocalCopy | null {
  try {
    const parsed = JSON.parse(readFileSync(copyPath(), "utf8")) as Partial<LocalCopy>;
    if (!parsed.deviceId) return null;
    return {
      deviceId: String(parsed.deviceId),
      deviceLabel: String(parsed.deviceLabel || os.hostname() || "этот ПК"),
      userId: parsed.userId,
      email: parsed.email,
      lifetimeTokens: Number(parsed.lifetimeTokens || 0),
      lastSeenAt: Number(parsed.lastSeenAt || 0),
      lastTokenReportAt: parsed.lastTokenReportAt ? Number(parsed.lastTokenReportAt) : undefined,
    };
  } catch {
    return null;
  }
}

export function ensureLocalCopy(patch?: Partial<LocalCopy>): LocalCopy {
  const prev = readLocalCopy();
  const next: LocalCopy = {
    deviceId: patch?.deviceId || prev?.deviceId || newDeviceId(),
    deviceLabel: patch?.deviceLabel || prev?.deviceLabel || os.hostname() || "этот ПК",
    userId: patch?.userId || prev?.userId,
    email: patch?.email || prev?.email,
    lifetimeTokens: Math.max(Number(prev?.lifetimeTokens || 0), Number(patch?.lifetimeTokens || 0)),
    lastSeenAt: Math.max(Number(prev?.lastSeenAt || 0), Number(patch?.lastSeenAt || Date.now())),
    lastTokenReportAt: patch?.lastTokenReportAt ?? prev?.lastTokenReportAt,
  };
  mkdirSync(hubRoot(), { recursive: true });
  writeFileSync(copyPath(), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function writeLocalSpend(lifetimeTokens: number, extra?: { userId?: string; email?: string }): LocalCopy {
  return ensureLocalCopy({
    lifetimeTokens,
    lastSeenAt: Date.now(),
    userId: extra?.userId,
    email: extra?.email,
  });
}

export function markLocalReported(): LocalCopy {
  return ensureLocalCopy({ lastTokenReportAt: Date.now(), lastSeenAt: Date.now() });
}

export function copyExists(): boolean {
  return existsSync(copyPath());
}
