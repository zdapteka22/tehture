import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { ngpRoot } from "./store";

/** Marker file. If it exists, the experimental lane is on. */
export function ngpSwitchFile(): string {
  return path.join(ngpRoot(), "enabled");
}

function envOverride(): boolean | null {
  const raw = String(process.env.FEDOR_NGP || "").trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off" || raw === "no") return false;
  if (raw === "1" || raw === "true" || raw === "on" || raw === "yes") return true;
  return null;
}

/** Off unless the user turned it on. The shipped coder stays as-is. */
export function isNgpOn(): boolean {
  const forced = envOverride();
  if (forced !== null) return forced;
  try {
    return existsSync(ngpSwitchFile());
  } catch {
    return false;
  }
}

export function enableNgp(): void {
  mkdirSync(ngpRoot(), { recursive: true });
  writeFileSync(ngpSwitchFile(), "on\n", "utf8");
}

export function disableNgp(): void {
  try {
    unlinkSync(ngpSwitchFile());
  } catch {
    // already off
  }
}
