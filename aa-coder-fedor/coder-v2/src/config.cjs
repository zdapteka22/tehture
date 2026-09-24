"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PORTS = { edge: 9222, chrome: 9223, chromium: 9224 };

function homeStateDir() {
  if (process.env.CODER2_STATE_DIR) return process.env.CODER2_STATE_DIR;
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor4");
  }
  return path.join(os.homedir(), ".fedor4");
}

function statePath() {
  return path.join(homeStateDir(), "coder-v2-state.json");
}

function profileDir(engine) {
  const id = String(engine || "edge").toLowerCase();
  return path.join(homeStateDir(), `coder-v2-profile-${id}`);
}

function desktopDir() {
  if (process.env.GROK_DESKTOP_DIR) return process.env.GROK_DESKTOP_DIR;
  if (process.env.CODER2_DESKTOP) return process.env.CODER2_DESKTOP;
  const home = os.homedir();
  const candidates = [
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "OneDrive", "Рабочий стол"),
    path.join(home, "Рабочий стол"),
  ];
  return candidates.find((dir) => fs.existsSync(dir)) || candidates[0];
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}

function saveState(patch) {
  const next = { ...loadState(), ...patch, updatedAt: Date.now() };
  fs.mkdirSync(path.dirname(statePath()), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(next, null, 2));
  return next;
}

function portFor(engine) {
  const id = String(engine || loadState().engine || "edge").toLowerCase();
  if (id === "chrome") return PORTS.chrome;
  if (id === "chromium") return PORTS.chromium;
  return PORTS.edge;
}

module.exports = {
  PORTS,
  homeStateDir,
  statePath,
  profileDir,
  desktopDir,
  loadState,
  saveState,
  portFor,
};
