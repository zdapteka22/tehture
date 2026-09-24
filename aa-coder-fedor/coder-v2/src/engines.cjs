"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { profileDir, portFor, loadState, saveState } = require("./config.cjs");

const ENGINE_IDS = ["edge", "chrome", "chromium"];

function defaultCandidates(platform, env) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const local = env.LOCALAPPDATA || path.join(home, "AppData", "Local");
  const pf = env["ProgramFiles"] || "C:\\Program Files";
  const pf86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  if (platform === "win32") {
    return {
      edge: [
        path.join(pf86, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(pf, "Microsoft", "Edge", "Application", "msedge.exe"),
        path.join(local, "Microsoft", "Edge", "Application", "msedge.exe"),
      ],
      chrome: [
        path.join(pf, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(pf86, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(local, "Google", "Chrome", "Application", "chrome.exe"),
      ],
      chromium: [path.join(local, "Chromium", "Application", "chrome.exe")],
    };
  }
  return {
    edge: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable", "/usr/bin/msedge"],
    chrome: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chrome"],
    chromium: ["/usr/bin/chromium", "/usr/bin/chromium-browser"],
  };
}

function firstExisting(paths, existsFn = fs.existsSync) {
  return paths.find((item) => existsFn(item)) || null;
}

function listEngines(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const existsFn = options.existsFn || fs.existsSync;
  const map = defaultCandidates(platform, env);
  const preferred = String(options.preferred || loadState().engine || (platform === "win32" ? "edge" : "chrome"));
  return ENGINE_IDS.map((id) => {
    const exe = firstExisting(map[id], existsFn);
    return {
      id,
      name: id === "edge" ? "Microsoft Edge" : id === "chrome" ? "Google Chrome" : "Chromium",
      exe,
      installed: Boolean(exe),
      port: portFor(id),
      preferred: preferred === id,
    };
  });
}

function pickEngine(id, options) {
  const engines = listEngines(options);
  if (id) {
    const hit = engines.find((item) => item.id === String(id).toLowerCase());
    if (!hit) throw new Error(`Unknown engine: ${id}`);
    if (!hit.installed) throw new Error(`${hit.name} is not installed on this PC`);
    saveState({ engine: hit.id, port: hit.port });
    return hit;
  }
  const preferred = engines.find((item) => item.preferred && item.installed);
  const fallback = engines.find((item) => item.installed);
  if (!fallback) {
    throw new Error("Install Microsoft Edge or Google Chrome — Coder v2 talks to a real browser, not a fake one.");
  }
  return preferred || fallback;
}

function launchArgs(engine, extraUrl) {
  const profile = profileDir(engine.id);
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    `--remote-debugging-port=${engine.port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    "--start-maximized",
    extraUrl || "about:blank",
  ];
  return { profile, args };
}

function spawnBrowser(engine, extraUrl, spawnFn = spawn) {
  const { profile, args } = launchArgs(engine, extraUrl);
  const child = spawnFn(engine.exe, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  if (child && typeof child.unref === "function") child.unref();
  saveState({ engine: engine.id, port: engine.port, profile, pid: child?.pid || null });
  return { pid: child?.pid || null, profile, port: engine.port, exe: engine.exe };
}

function doctorText(engines, attached) {
  const lines = ["Coder v2 · диагностика браузеров"];
  for (const item of engines) {
    const mark = item.installed ? "есть" : "нет";
    const pref = item.preferred ? " ← выбран" : "";
    const exe = item.exe || "—";
    lines.push(`- ${item.name}: ${mark}, порт ${item.port}${pref}`);
    lines.push(`  ${exe}`);
  }
  if (attached) {
    lines.push(`подключено: ${attached.browser} ${attached.webSocketDebuggerUrl ? "CDP ok" : ""}`);
  } else {
    lines.push("порт не отвечает — запущу отдельный debug-профиль (обычный профиль флаг игнорирует).");
  }
  lines.push("профиль отладки не трогает ваш ежедневный Edge/Chrome.");
  return lines.join("\n");
}

module.exports = {
  ENGINE_IDS,
  defaultCandidates,
  listEngines,
  pickEngine,
  launchArgs,
  spawnBrowser,
  doctorText,
};
