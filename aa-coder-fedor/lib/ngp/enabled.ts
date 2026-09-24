import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ngpRoot } from "./store";

/** Marker file. If it exists, the common lane was turned off by the user. */
export function ngpOffFile(): string {
  return path.join(ngpRoot(), "off");
}

export function ngpSwitchFile(): string {
  return path.join(ngpRoot(), "enabled");
}

function envOverride(): boolean | null {
  const raw = String(process.env.FEDOR_NGP || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return null;
}

/** Common version: full memory is ON from the first launch. Super Memory and clicks stay anyway. */
export function isNgpOn(): boolean {
  const forced = envOverride();
  if (forced !== null) return forced;
  try {
    if (existsSync(ngpOffFile())) return false;
  } catch {
    return true;
  }
  return true;
}

/** Persist the default-on marker so the first message already has full memory. */
export function ensureNgpDefaultOn(): boolean {
  if (!isNgpOn()) return false;
  try {
    mkdirSync(ngpRoot(), { recursive: true });
    if (!existsSync(ngpSwitchFile())) {
      writeFileSync(ngpSwitchFile(), "on\n", "utf8");
    }
  } catch {
    // still on in memory
  }
  return true;
}

export function enableNgp(): void {
  mkdirSync(ngpRoot(), { recursive: true });
  try {
    unlinkSync(ngpOffFile());
  } catch {
    // already on
  }
  writeFileSync(ngpSwitchFile(), "on\n", "utf8");
}

export function disableNgp(): void {
  mkdirSync(ngpRoot(), { recursive: true });
  writeFileSync(ngpOffFile(), "off\n", "utf8");
  try {
    unlinkSync(ngpSwitchFile());
  } catch {
    // ignore
  }
}
