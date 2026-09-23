import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const APP_NAME = "AA Coder Fedor";
/** Own icon. Never delete 1.02 / 1.03 / 1.04 ULTIMA shortcuts. */
export const DESKTOP_SHORTCUT_STEM = "AA Coder Fedor 3.0";
export const DESKTOP_BAT_NAMES = [`${DESKTOP_SHORTCUT_STEM}.bat`];
export const DESKTOP_LNK_NAME = `${DESKTOP_SHORTCUT_STEM}.lnk`;
export const HOME_LAUNCHER_NAME = "AA Coder Fedor 3.0.bat";
export const OLD_LAUNCHER_NAMES = [
  "AA Coder Fedor 4.bat",
  "Coder 4.bat",
  `${DESKTOP_SHORTCUT_STEM}.bat`,
];

export type DesktopLauncherResult = {
  written: string[];
  errors: string[];
  removed: string[];
};

function uniqueDirs(dirs: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    const abs = path.resolve(dir);
    if (!out.includes(abs)) out.push(abs);
  }
  return out;
}

export function publicDesktopDir(): string {
  const publicDir = process.env.PUBLIC || path.join(path.dirname(os.homedir()), "Public");
  return path.join(publicDir, "Desktop");
}

export function desktopDirectories(): string[] {
  const override = process.env.GROK_DESKTOP_DIR?.trim();
  if (override) return uniqueDirs([override]);
  const home = os.homedir();
  return uniqueDirs([
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "OneDrive", "Рабочий стол"),
    path.join(home, "Рабочий стол"),
  ]);
}

export function homeLauncherDir(): string {
  return path.join(os.homedir(), "Fedor2");
}

export function launcherBatBody(options: {
  appRoot: string;
  electronExe: string;
  electronMain: string;
}): string {
  const appRoot = options.appRoot;
  const electronExe = options.electronExe;
  const electronMain = options.electronMain;
  const starter = path.join(appRoot, "start-grok-coder.cmd");
  const okStamp = path.join(appRoot, ".fedor-install-ok");
  const lines = [
    "@echo off",
    "setlocal EnableExtensions",
    "title AA Coder Fedor 3.0",
    `cd /d "${appRoot}"`,
    process.env.GROK_NODE ? `set "GROK_NODE=${process.env.GROK_NODE}"` : "rem GROK_NODE from this PC",
    "set \"GROK_PORT=43223\"",
    `if exist "${okStamp}" if exist "${electronExe}" if exist "${electronMain}" (`,
    `  start "" /D "${appRoot}" "${electronExe}" .`,
    "  exit /b 0",
    ")",
    "echo Missing pieces on this PC. Downloading what is needed...",
    `if exist "${starter}" (`,
    '  call "' + starter + '"',
    "  exit /b %ERRORLEVEL%",
    ")",
    `echo ${APP_NAME} not found.`,
    `echo ${appRoot}`,
    "pause",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function ensureDir(dir: string): boolean {
  try {
    if (existsSync(dir) && statSync(dir).isDirectory()) return true;
  } catch {
    return false;
  }
  const home = os.homedir();
  const allowedCreate = new Set([
    path.resolve(home, "Desktop"),
    path.resolve(home, "Fedor2"),
  ]);
  if (process.env.GROK_DESKTOP_DIR?.trim()) {
    allowedCreate.add(path.resolve(process.env.GROK_DESKTOP_DIR.trim()));
  }
  if (!allowedCreate.has(path.resolve(dir))) return false;
  try {
    mkdirSync(dir, { recursive: true });
    return existsSync(dir);
  } catch {
    return false;
  }
}

function tryUnlink(file: string): boolean {
  try {
    if (!existsSync(file)) return false;
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function removeOldLaunchers(dirs: string[]): string[] {
  const removed: string[] = [];
  for (const dir of dirs) {
    if (!dir) continue;
    for (const name of OLD_LAUNCHER_NAMES) {
      const target = path.join(dir, name);
      if (tryUnlink(target)) removed.push(target);
    }
  }
  return removed;
}

/** One launch file on the user Desktop. Never write to Public Desktop. */
export function installDesktopLaunchers(options?: {
  appRoot?: string;
  electronExe?: string;
  electronMain?: string;
}): DesktopLauncherResult {
  const appRoot = path.resolve(options?.appRoot || process.cwd());
  const electronExe =
    options?.electronExe || path.join(appRoot, "node_modules", "electron", "dist", "electron.exe");
  const electronMain = options?.electronMain || path.join(appRoot, "electron", "main.cjs");
  const body = launcherBatBody({ appRoot, electronExe, electronMain });
  const written: string[] = [];
  const errors: string[] = [];

  const overrideDesk = process.env.GROK_DESKTOP_DIR?.trim();
  const homeDir = overrideDesk ? path.resolve(overrideDesk) : homeLauncherDir();
  if (!overrideDesk) {
    if (!ensureDir(homeDir)) {
      errors.push(`skip home ${homeDir}`);
    } else {
      try {
        mkdirSync(homeDir, { recursive: true });
        const homeBat = path.join(homeDir, HOME_LAUNCHER_NAME);
        writeFileSync(homeBat, body, { encoding: "utf8" });
        written.push(homeBat);
      } catch (error) {
        errors.push(`${homeDir}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  const desks = desktopDirectories();
  const publicDesk = overrideDesk ? "" : publicDesktopDir();
  const removed = removeOldLaunchers(
    uniqueDirs([...desks, overrideDesk ? "" : homeDir, publicDesk]),
  );

  const hasLnk = desks.some((dir) => existsSync(path.join(dir, DESKTOP_LNK_NAME)));
  for (const dir of uniqueDirs([...desks, publicDesk])) {
    const bat = path.join(dir, `${DESKTOP_SHORTCUT_STEM}.bat`);
    if (tryUnlink(bat)) removed.push(bat);
  }

  if (hasLnk) {
    for (const dir of desks) {
      const lnk = path.join(dir, DESKTOP_LNK_NAME);
      if (existsSync(lnk)) written.push(lnk);
    }
    return { written, errors, removed };
  }

  for (const dir of desks) {
    if (publicDesk && path.resolve(dir) === path.resolve(publicDesk)) continue;
    if (!ensureDir(dir)) {
      errors.push(`skip ${dir}`);
      continue;
    }
    const bat = path.join(dir, `${DESKTOP_SHORTCUT_STEM}.bat`);
    try {
      writeFileSync(bat, body, { encoding: "utf8" });
      written.push(bat);
      break;
    } catch (error) {
      errors.push(`${bat}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { written, errors, removed };
}
