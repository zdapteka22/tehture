"use strict";

const { app, BrowserWindow, Menu, shell, clipboard, ipcMain, dialog } = require("electron");
const { spawn, spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const dns = require("node:dns");
try {
  dns.setDefaultResultOrder("ipv4first");
} catch {
  // ignore
}

const APP_TITLE = "AA coder fёdor 3.0";
const ROOT = path.join(__dirname, "..");
let PORT = String(process.env.GROK_PORT || "43223");
let URL = `http://127.0.0.1:${PORT}/`;
const LOG = path.join(os.tmpdir(), "fedor2-next.log");
const SPLASH = path.join(__dirname, "splash.html");
const { prepareNextLock, clearLock } = require("./next-lock.cjs");
const { startHostBridge, clearBridgeState } = require("./host-bridge.cjs");
const { installErrorLog, logError } = require("./error-log.cjs");
installErrorLog();
const DESKTOP_STEM = "AA Coder Fedor 3.0";
const HOME_LAUNCHER = "AA Coder Fedor 3.0.bat";
const OLD_LAUNCHERS = [
  "AA Coder Fedor 4.bat",
  "Coder 4.bat",
  DESKTOP_STEM + ".bat",
];

let nextChild = null;
let mainWindow = null;
let spawnedServer = false;
let serverReady = false;
let hostBridgeHandle = null;
const HOST_BRIDGE_PORT = String(Number(PORT) + 2);

ipcMain.handle("clipboard:write", (_event, text) => {
  clipboard.writeText(String(text ?? ""));
  return true;
});

ipcMain.handle("dialog:open", async (event, opts = {}) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const directory = Boolean(opts.directory);
  const result = await dialog.showOpenDialog(win || undefined, {
    title: String(opts.title || "Выберите файл"),
    properties: directory ? ["openDirectory"] : ["openFile"],
    filters: Array.isArray(opts.filters) && opts.filters.length ? opts.filters : [{ name: "Все файлы", extensions: ["*"] }],
  });
  if (result.canceled || !result.filePaths || !result.filePaths[0]) return { path: "" };
  return { path: result.filePaths[0] };
});

function loadEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key && process.env[key] == null) process.env[key] = value;
  }
}

const BAKED_DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || process.env.GROK_API_KEY || "__FEDOR_DEEPSEEK_KEY__";

function ensureEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  let text = "";
  try {
    if (fs.existsSync(file)) text = fs.readFileSync(file, "utf8");
  } catch {
    text = "";
  }
  const hasKey = /(?:^|\n)\s*(?:DEEPSEEK_API_KEY|GROK_API_KEY)=\S+/m.test(text);
  const lines = [
    `DEEPSEEK_API_KEY=${BAKED_DEEPSEEK_KEY}`,
    `GROK_API_KEY=${BAKED_DEEPSEEK_KEY}`,
    "GROK_PROVIDER=deepseek",
    "GROK_BASE_URL=https://api.deepseek.com/v1",
    "GROK_MODEL=deepseek-chat",
    "FAST_MODEL=deepseek-chat",
  ];
  if (!hasKey) {
    const keep = text
      .split(/\r?\n/)
      .filter((line) => !/^\s*(YANDEX_|OPENROUTER_API_KEY=|XAI_API_KEY=|GROK_PROVIDER=|GROK_BASE_URL=)/.test(line));
    const body = (keep.filter(Boolean).join("\n") + "\n" + lines.join("\n") + "\n").replace(/^\n+/, "");
    fs.writeFileSync(file, body, "utf8");
  }
  if (!process.env.DEEPSEEK_API_KEY) process.env.DEEPSEEK_API_KEY = BAKED_DEEPSEEK_KEY;
  if (!process.env.GROK_API_KEY) process.env.GROK_API_KEY = BAKED_DEEPSEEK_KEY;
  if (!process.env.GROK_PROVIDER) process.env.GROK_PROVIDER = "deepseek";
  if (!process.env.GROK_BASE_URL) process.env.GROK_BASE_URL = "https://api.deepseek.com/v1";
  const ngp = String(process.env.FEDOR_NGP || "").trim().toLowerCase();
  if (ngp !== "0" && ngp !== "false" && ngp !== "off" && ngp !== "no") {
    process.env.FEDOR_NGP = "1";
  }
  process.env.FEDOR_APP_ROOT = ROOT;
  const skuFiles = [path.join(ROOT, ".fedor-sku"), path.join(ROOT, ".next", "FEDOR_SKU")];
  let sku = String(process.env.FEDOR_SKU || "").trim().toLowerCase();
  if (sku !== "free" && sku !== "paid") {
    for (const file of skuFiles) {
      try {
        if (!fs.existsSync(file)) continue;
        const raw = fs.readFileSync(file, "utf8").trim().toLowerCase();
        if (raw === "free" || raw === "paid") {
          sku = raw;
          break;
        }
      } catch {
        // ignore
      }
    }
  }
  if (sku === "free" || sku === "paid") process.env.FEDOR_SKU = sku;
  if (sku === "free") process.env.FEDOR_FREE = "1";
}

function listNodeCandidates() {
  const out = [];
  const push = (item) => {
    if (item && !out.includes(item)) out.push(item);
  };
  push(process.env.GROK_NODE);
  const localApp = process.env.LOCALAPPDATA || "";
  const home = os.homedir();
  const roots = [
    path.join(localApp, "Fedor2", "node"),
    path.join(home, "Fedor2", "node"),
    path.join(ROOT, "node"),
  ];
  const walk = (dir, depth) => {
    if (depth > 4) return;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isFile() && /^node(\.exe)?$/i.test(name)) push(full);
      else if (st.isDirectory()) walk(full, depth + 1);
    }
  };
  for (const dir of roots) walk(dir, 0);
  push("C:\\Program Files\\nodejs\\node.exe");
  push("C:\\Program Files (x86)\\nodejs\\node.exe");
  push(path.join(ROOT, "node_modules", ".bin", process.platform === "win32" ? "node.exe" : "node"));
  return out;
}

function nodeWorks(bin) {
  try {
    const result = spawnSync(bin, ["-v"], {
      timeout: 8000,
      windowsHide: true,
      encoding: "utf8",
    });
    const text = `${result.stdout || ""}${result.stderr || ""}`;
    return result.status === 0 && /v\d+/.test(text);
  } catch {
    return false;
  }
}

function findNode() {
  for (const candidate of listNodeCandidates()) {
    if (fs.existsSync(candidate) && nodeWorks(candidate)) return candidate;
  }
  const fallback = process.platform === "win32" ? "node.exe" : "node";
  if (nodeWorks(fallback)) return fallback;
  return "";
}

function unlinkQuiet(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    // ignore
  }
}

function installDesktopLaunchersFromElectron(nodeBin) {
  const appRoot = ROOT;
  const electronExe = process.execPath;
  const electronMain = path.join(ROOT, "electron", "main.cjs");
  const starter = path.join(appRoot, "start-grok-coder.cmd");
  const body = [
    "@echo off",
    "setlocal EnableExtensions",
    "title AA Coder Fedor 3.0",
    'cd /d "' + appRoot + '"',
    nodeBin ? 'set "GROK_NODE=' + nodeBin + '"' : "rem no node baked",
    "set \"GROK_PORT=" + PORT + '"',
    'if exist "' + electronExe + '" if exist "' + electronMain + '" (',
    '  start "" /D "' + appRoot + '" "' + electronExe + '" .',
    "  exit /b 0",
    ")",
    'if exist "' + starter + '" (',
    '  call "' + starter + '"',
    "  exit /b %ERRORLEVEL%",
    ")",
    "echo AA Coder Fedor not found.",
    "echo " + appRoot,
    "pause",
    "",
  ].join("\r\n");
  const home = os.homedir();
  const publicDir = process.env.PUBLIC || path.join(path.dirname(home), "Public");
  const homeLaunch = path.join(home, "Fedor2");
  const publicDesk = path.join(publicDir, "Desktop");
  const desks = [
    path.join(home, "Desktop"),
    path.join(home, "OneDrive", "Desktop"),
    path.join(home, "OneDrive", "Рабочий стол"),
    path.join(home, "Рабочий стол"),
  ];
  try {
    fs.mkdirSync(homeLaunch, { recursive: true });
    fs.writeFileSync(path.join(homeLaunch, HOME_LAUNCHER), body, "utf8");
  } catch {
    // home launcher is optional
  }
  for (const dir of desks.concat([publicDesk, homeLaunch])) {
    if (!dir || !fs.existsSync(dir)) continue;
    for (const junk of OLD_LAUNCHERS) unlinkQuiet(path.join(dir, junk));
  }
  const hasLnk = desks.some((dir) => {
    try {
      return dir && fs.existsSync(path.join(dir, DESKTOP_STEM + ".lnk"));
    } catch {
      return false;
    }
  });
  for (const dir of desks.concat([publicDesk])) {
    if (!dir) continue;
    unlinkQuiet(path.join(dir, DESKTOP_STEM + ".bat"));
  }
  if (hasLnk) return;
  for (const dir of desks) {
    if (!dir || dir === publicDesk) continue;
    try {
      if (!fs.existsSync(dir)) continue;
      fs.writeFileSync(path.join(dir, DESKTOP_STEM + ".bat"), body, "utf8");
      return;
    } catch {
      // try the next folder
    }
  }
}

function logTail(max = 1800) {
  try {
    if (!fs.existsSync(LOG)) return "";
    return fs.readFileSync(LOG, "utf8").slice(-max);
  } catch {
    return "";
  }
}

function setBoot(pct, msg, sub, chunk) {
  // Safer than interpolating into JS from logs.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const n = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  const safeMsg = JSON.stringify(msg || "");
  const safeSub = JSON.stringify(sub || "");
  const safeLog = JSON.stringify(chunk || "");
  mainWindow.webContents
    .executeJavaScript(`window.__boot && window.__boot(${n}, ${safeMsg}, ${safeSub}, ${safeLog})`)
    .catch(() => undefined);
}

function readHttp(url, limit = 16000) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      const chunks = [];
      let n = 0;
      res.on("data", (c) => {
        chunks.push(c);
        n += c.length;
        if (n > limit) res.destroy();
      });
      res.on("end", () =>
        resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
      res.on("error", () => resolve(null));
    });
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
  });
}

function looksLikeForeignPayPage(body) {
  return /Platyna|Fyatu|виртуальн\w*\s+карт|приём оплаты по QR|приём оплаты поQR/i.test(String(body || ""));
}

function looksLikeFedor(body) {
  const text = String(body || "");
  if (!text) return false;
  if (looksLikeForeignPayPage(text)) return false;
  return /AA coder|AA Coder Fedor|fedor2|CoderApp|"fyodor"|aa-coder-fedor/i.test(text);
}

async function probeServer() {
  const cfg = await readHttp(`http://127.0.0.1:${PORT}/api/config`);
  if (cfg && cfg.status === 200 && looksLikeFedor(cfg.body)) return true;
  const home = await readHttp(URL);
  if (!home || home.status < 200) return false;
  if (looksLikeForeignPayPage(home.body)) return false;
  return looksLikeFedor(home.body);
}

function hasProductionBuild() {
  return fs.existsSync(path.join(ROOT, ".next", "BUILD_ID"));
}

function appendLog(text) {
  try {
    fs.appendFileSync(LOG, text);
  } catch {
    // ignore
  }
}

function parseBootLine(line, pct) {
  const t = line.trim();
  if (!t) return { pct, msg: "", compile: false };
  if (/already running|Another next dev/i.test(t)) {
    return { pct: Math.max(pct, 50), msg: "Нашёл уже запущенный сервер", compile: false, already: true };
  }
  if (/Cannot find module|MODULE_NOT_FOUND|node:.*not found/i.test(t)) {
    return { pct, msg: "Node или пакеты не найдены", compile: false, fatal: true };
  }
  if (/Compiling|compil(e|ing)|Creating an optimized production build/i.test(t)) {
    return { pct: Math.max(pct, 28), msg: "Идёт сборка на этом ПК…", compile: true };
  }
  if (/Collected page data|Generating static|Finalizing page/i.test(t)) {
    return { pct: Math.max(pct, 78), msg: "Идёт сборка — почти готово", compile: true };
  }
  if (/Compiled|compiled successfully|Ready in|started server|Local:/i.test(t)) {
    return { pct: Math.max(pct, 90), msg: "Сервер поднялся, открываю окно…", compile: false };
  }
  return { pct, msg: "", compile: /build/i.test(t) };
}

function startNext(nodeBin, mode) {
  const nextBin = path.join(ROOT, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(nextBin)) {
    throw new Error("Next.js не найден. Запустите AA-Coder-Fedor-3.0-Setup.bat ещё раз.");
  }
  appendLog(`\n--- boot ${new Date().toISOString()} node=${nodeBin} mode=${mode} port=${PORT} ---\n`);
  const env = {
    ...process.env,
    GROK_DESKTOP: "1",
    GROK_NODE: nodeBin,
    FEDOR_NGP: process.env.FEDOR_NGP || "1",
    FEDOR_SKU: process.env.FEDOR_SKU || "",
    FEDOR_FREE: process.env.FEDOR_FREE || "",
    FEDOR_APP_ROOT: ROOT,
    FEDOR4_HOST_BRIDGE: process.env.FEDOR4_HOST_BRIDGE || "",
    FEDOR4_HOST_TOKEN: process.env.FEDOR4_HOST_TOKEN || "",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: process.env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD || "1",
    NODE_OPTIONS: [process.env.NODE_OPTIONS, "--dns-result-order=ipv4first"].filter(Boolean).join(" "),
  };
  if (mode === "start") env.NODE_ENV = "production";
  const args = [nextBin, mode, "--port", PORT, "--hostname", "127.0.0.1"];
  if (mode === "dev" && process.platform === "win32") args.push("--webpack");
  nextChild = spawn(nodeBin, args, {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  spawnedServer = true;
  return nextChild;
}

function waitForChildReady(child, timeoutMs) {
  const started = Date.now();
  let pct = 22;
  let lastMsg = "Запускаю локальный сервер…";
  let compiling = false;
  let finished = false;

  return new Promise((resolve, reject) => {
    const fail = (why) => {
      if (finished) return;
      finished = true;
      reject(new Error(why + "\n\n" + logTail(1200) + "\n\nLog: " + LOG));
    };
    const onData = (buf) => {
      const text = buf.toString();
      appendLog(text);
      for (const line of text.split(/\r?\n/)) {
        const parsed = parseBootLine(line, pct);
        if (parsed.fatal) {
          fail(parsed.msg || "Node или пакеты не найдены");
          return;
        }
        if (parsed.pct > pct) pct = parsed.pct;
        if (parsed.msg) lastMsg = parsed.msg;
        if (parsed.compile) compiling = true;
      }
      setBoot(
        pct,
        lastMsg,
        compiling
          ? "Идёт сборка. Фон — реклама кодера, это не зависание."
          : "Если сервер упал — здесь появится ошибка, окно не будет ждать молча.",
        text.slice(-400),
      );
    };
    if (child.stdout) child.stdout.on("data", onData);
    if (child.stderr) child.stderr.on("data", onData);
    child.once("error", (error) => {
      fail("Не удалось запустить Node: " + (error && error.message ? error.message : error));
    });
    child.once("exit", (code) => {
      if (serverReady) return;
      fail("Сервер сразу закрылся (код " + code + "). Это не сборка — процесс упал.");
    });
    const tick = async () => {
      if (finished) return;
      if (await probeServer()) {
        serverReady = true;
        finished = true;
        resolve();
        return;
      }
      if (Date.now() - started > timeoutMs) {
        fail("Сервер не ответил за " + Math.round(timeoutMs / 1000) + " с. Это зависание, не «тихая сборка».");
        return;
      }
      if (compiling && pct < 86) {
        const extra = Math.min(86, pct + 1);
        if (extra > pct) {
          pct = extra;
          setBoot(pct, "Идёт сборка на этом ПК…", extra + "% по журналу Next.js");
        }
      }
      setTimeout(tick, 400);
    };
    void tick();
  });
}

function installEditMenu() {
  const menu = Menu.buildFromTemplate([
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}

function showFatal(message) {
  const html = `<!doctype html><html><body style="background:#140b0b;color:#f3e8e8;font-family:Segoe UI,sans-serif;padding:36px;white-space:pre-wrap">
  <h1 style="font-weight:600">${APP_TITLE}</h1>
  <p style="color:#ffb4a8">Это не сборка. Запуск остановился.</p>
  <pre style="background:#1e1414;padding:16px;border-radius:10px;overflow:auto">${String(message)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")}</pre>
  <p>Закройте окно крестиком. Потом снова AA-Coder-Fedor-3.0-Setup.bat — полный файл.</p>
  </body></html>`;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    mainWindow.show();
    mainWindow.focus();
  }
}

function createWindow() {
  installEditMenu();
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 840,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: "#07070a",
    autoHideMenuBar: true,
    title: APP_TITLE,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      spellcheck: true,
    },
  });
  mainWindow.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    if (String(permission).includes("clipboard")) {
      callback(true);
      return;
    }
    callback(true);
  });
  mainWindow.webContents.on("context-menu", (_event, params) => {
    const template = [];
    if (params.isEditable) {
      template.push(
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { type: "separator" },
        { role: "selectAll" }
      );
    } else if (params.selectionText) {
      template.push({ role: "copy" }, { role: "selectAll" });
    } else {
      template.push({ role: "paste" }, { role: "selectAll" });
    }
    Menu.buildFromTemplate(template).popup({ window: mainWindow });
  });
  mainWindow.loadFile(SPLASH);
  mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

async function ensureHostBridge() {
  if (hostBridgeHandle) return hostBridgeHandle;
  const token = crypto.randomBytes(16).toString("hex");
  hostBridgeHandle = await startHostBridge({
    shell,
    port: Number(HOST_BRIDGE_PORT),
    token,
    platform: process.platform,
  });
  process.env.FEDOR4_HOST_BRIDGE = hostBridgeHandle.url;
  process.env.FEDOR4_HOST_TOKEN = token;
  appendLog("\nhost-bridge " + hostBridgeHandle.url + "\n");
  return hostBridgeHandle;
}

async function boot() {
  ensureEnvLocal();
  loadEnvLocal();
  createWindow();
  try {
    await ensureHostBridge();
  } catch (error) {
    appendLog("\nhost-bridge failed " + (error && error.message ? error.message : error) + "\n");
  }
  await new Promise((resolve) => {
    if (!mainWindow) return resolve();
    mainWindow.webContents.once("did-finish-load", resolve);
    setTimeout(resolve, 1500);
  });
  setBoot(6, "Запуск на этом ПК…", "Ищу Node. Если его нет — сразу ошибка, без трёх минут чёрного экрана.");

  const nodeBin = findNode();
  try {
    installDesktopLaunchersFromElectron(nodeBin);
  } catch {
    // ignore
  }
  if (!nodeBin) {
    throw new Error(
      "Node.js не найден на этом ПК. Ярлык не передал путь. Запустите полный AA-Coder-Fedor-3.0-Setup.bat (сотни КБ)."
    );
  }
  process.env.GROK_NODE = nodeBin;
  setBoot(14, "Node найден", nodeBin);

  let httpUp = await probeServer();
  if (!httpUp) {
    const occupied = await readHttp(URL);
    if (occupied && occupied.status) {
      const nextPort = String(Number(PORT) + 1);
      appendLog("\nport " + PORT + " is not the coder, switching to " + nextPort + "\n");
      PORT = nextPort;
      URL = `http://127.0.0.1:${PORT}/`;
      process.env.GROK_PORT = PORT;
    }
  }
  const lockState = prepareNextLock(ROOT, httpUp);
  appendLog(`\nlock action=${lockState.action} pid=${lockState.lock ? lockState.lock.pid : "-"} http=${httpUp}\n`);
  if (lockState.action === "cleared-dead") {
    setBoot(18, "Старый замок Next снят", "Прошлый процесс уже мёртв. Запускаю сервер заново.");
  }
  if (lockState.action === "pid-alive-no-http") {
    const pid = lockState.lock.pid;
    setBoot(18, "Жду уже запущенный сервер…", "PID " + pid + ". Не дольше 12 секунд, потом сниму замок.");
    const until = Date.now() + 12000;
    while (Date.now() < until) {
      httpUp = await probeServer();
      if (httpUp) break;
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setBoot(20 + (12 - left), "Жду PID " + pid, "осталось " + left + " с.");
      await new Promise((r) => setTimeout(r, 400));
    }
    if (!httpUp) {
      clearLock(ROOT);
      setBoot(22, "Снимаю зависший замок Next", "Старый процесс не отдал сайт. Запускаю сервер заново.");
    }
  }
  if (httpUp) {
    setBoot(100, "Уже запущено — открываю окно", "");
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(URL);
    return;
  }

  if (!hasProductionBuild()) {
    throw new Error(
      "Готовая сборка не найдена в папке программы.\n" +
        "Это не компиляция на ПК — в установщике нет .next.\n" +
        "Скачайте полный AA-Coder-Fedor-3.0-Setup.bat ещё раз (не ярлык) и запустите его.",
    );
  }
  const mode = "start";
  setBoot(20, "Поднимаю уже собранную программу…", "Сборка уже есть, жду ответ сервера.");

  const tryStart = async () => {
    const child = startNext(nodeBin, mode);
    await waitForChildReady(child, mode === "dev" ? 240000 : 90000);
  };
  try {
    await tryStart();
  } catch (error) {
    const text = String(error && error.message ? error.message : error);
    httpUp = await probeServer();
    if (httpUp) {
      setBoot(100, "Сервер уже был — открываю окно", "");
    } else if (/already running|Another next/i.test(text + logTail(800))) {
      clearLock(ROOT);
      setBoot(24, "Снимаю замок Next и пробую ещё раз", "");
      await tryStart();
    } else {
      logError(error, "electron-boot");
      throw error;
    }
  }
  setBoot(100, "Готово", "Открываю кодер");
  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(URL);
  }
}

function stopChild() {
  if (!spawnedServer || !nextChild || nextChild.killed) return;
  try {
    if (process.platform === "win32" && nextChild.pid) {
      spawn("taskkill", ["/pid", String(nextChild.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      nextChild.kill("SIGTERM");
    }
  } catch {
    // ignore
  }
}

app.setName(APP_TITLE);
if (process.platform === "win32") {
  app.setAppUserModelId("local.coder.app");
}
try {
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("no-sandbox");
} catch {
  // ignore
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    void boot().catch((error) => {
      console.error(error);
      showFatal(error && error.message ? error.message : error);
    });
  });
  app.whenReady().then(() =>
    boot().catch((error) => {
      console.error(error);
      showFatal(error && error.message ? error.message : error);
    })
  );
}

app.on("window-all-closed", () => {
  stopChild();
  clearBridgeState();
  app.quit();
});

app.on("before-quit", () => {
  stopChild();
  clearBridgeState();
});
