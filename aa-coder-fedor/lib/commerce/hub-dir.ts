import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** Local hub on this PC. Not a public payment server. */
export function hubRoot(): string {
  const override = process.env.FEDOR_HUB_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "hub");
  }
  return path.join(os.homedir(), ".fedor-hub");
}

export function ensureHubRoot(): string {
  const dir = hubRoot();
  mkdirSync(dir, { recursive: true });
  return dir;
}
