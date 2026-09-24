import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const APP_NAME = "AA Coder Fedor";
export const APP_TITLE = "AA coder fёdor 3.0";
export const APP_VERSION = "3.0";
export const DESKTOP_SHORTCUT_STEM = "AA Coder Fedor 3.0";

/** Compile-time default. The packed Next build is paid; Free-Setup stamps the SKU at install. */
export const IS_FREE_EDITION = false;
export const SKU_ID = IS_FREE_EDITION ? "free" : "paid";
export const SETUP_BAT_NAME = IS_FREE_EDITION
  ? "AA-Coder-Fedor-3.0-Free-Setup.bat"
  : "AA-Coder-Fedor-3.0-Setup.bat";

function looksFree(raw: string): boolean {
  const v = String(raw || "").trim().toLowerCase();
  return v === "free" || v === "1" || v === "true" || v === "yes";
}

function stampFree(file: string): boolean {
  try {
    if (!file || !existsSync(file)) return false;
    return /^\s*free\s*$/im.test(readFileSync(file, "utf8"));
  } catch {
    return false;
  }
}

/** Free-Setup writes .fedor-sku=free. Paid compile-time flag stays false. */
export function isFreeEdition(): boolean {
  if (IS_FREE_EDITION) return true;
  if (looksFree(process.env.FEDOR_SKU || "")) return true;
  if (looksFree(process.env.FEDOR_FREE || "")) return true;
  if (looksFree(process.env.FEDOR_EDITION || "")) return true;
  const cwd = process.cwd();
  const roots = [cwd];
  try {
    if (process.env.FEDOR_APP_ROOT) roots.unshift(process.env.FEDOR_APP_ROOT);
  } catch {
    // ignore
  }
  for (const root of roots) {
    if (stampFree(path.join(root, ".fedor-sku"))) return true;
    if (stampFree(path.join(root, ".next", "FEDOR_SKU"))) return true;
    if (stampFree(path.join(root, ".fedor-install-ok"))) return true;
  }
  return false;
}
