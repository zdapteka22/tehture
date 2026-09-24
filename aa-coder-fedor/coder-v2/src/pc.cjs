"use strict";

const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { desktopDir } = require("./config.cjs");

function quoteWin(value) {
  const s = String(value ?? "");
  if (!s) return '""';
  return `"${s.replace(/"/g, '""')}"`;
}

function launchApp(target) {
  const spec = String(target || "").trim();
  if (!spec) throw new Error("launch: target is required");
  if (process.platform === "win32") {
    const child = spawn("cmd.exe", ["/c", "start", "", spec], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return { ok: true, target: spec, via: "cmd-start", pid: child.pid || null };
  }
  if (process.platform === "darwin") {
    spawn("open", [spec], { detached: true, stdio: "ignore" }).unref();
    return { ok: true, target: spec, via: "open" };
  }
  spawn(spec, [], { detached: true, stdio: "ignore" }).unref();
  return { ok: true, target: spec, via: "spawn" };
}

function parseTasklistCsv(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const windows = [];
  for (const line of lines.slice(1)) {
    const cols = [];
    let cur = "";
    let inQ = false;
    for (const ch of line) {
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if (ch === "," && !inQ) {
        cols.push(cur);
        cur = "";
        continue;
      }
      cur += ch;
    }
    cols.push(cur);
    const image = cols[0] || "";
    const pid = cols[1] || "";
    const title = cols[cols.length - 1] || "";
    if (title && title !== "N/A" && title !== "Не применимо") {
      windows.push({ image, pid, title });
    }
  }
  return windows;
}

function listWindows() {
  if (process.platform === "win32") {
    const run = spawnSync("tasklist", ["/v", "/fo", "csv"], { encoding: "utf8", windowsHide: true });
    return parseTasklistCsv(run.stdout || "");
  }
  const run = spawnSync("ps", ["-eo", "pid,comm"], { encoding: "utf8" });
  return String(run.stdout || "")
    .split(/\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .map((line) => {
      const [pid, ...rest] = line.split(/\s+/);
      return { pid, image: rest.join(" "), title: rest.join(" ") };
    });
}

function focusWindow(title) {
  const q = String(title || "").trim();
  if (!q) throw new Error("focus: title is required");
  if (process.platform === "win32") {
    const script = [
      "Add-Type -TypeDefinition @'",
      "using System;",
      "using System.Runtime.InteropServices;",
      "public class Coder2Win {",
      "  [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr h);",
      "}",
      "'@",
      `$w = Get-Process | Where-Object { $_.MainWindowTitle -like '*${q.replace(/'/g, "''")}*' } | Select-Object -First 1`,
      "if ($w) { [Coder2Win]::SetForegroundWindow($w.MainWindowHandle); $w.MainWindowTitle } else { 'not-found' }",
    ].join("\n");
    const run = spawnSync("powershell.exe", ["-NoProfile", "-Command", script], {
      encoding: "utf8",
      windowsHide: true,
    });
    const out = String(run.stdout || "").trim();
    return { ok: out !== "not-found" && Boolean(out), title: q, result: out || String(run.stderr || "") };
  }
  return { ok: false, title: q, result: "focus is Windows-only" };
}

function screenshotScreen(filePath) {
  const dest = filePath || path.join(desktopDir(), "pc-screen.png");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (process.platform === "win32") {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms,System.Drawing",
      "$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds",
      "$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height",
      "$g = [System.Drawing.Graphics]::FromImage($bmp)",
      "$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)",
      `$bmp.Save('${dest.replace(/'/g, "''")}')`,
      "$g.Dispose(); $bmp.Dispose()",
      `'saved:${dest.replace(/'/g, "''")}'`,
    ].join("; ");
    const run = spawnSync("powershell.exe", ["-NoProfile", "-Command", ps], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (!fs.existsSync(dest)) {
      throw new Error(`Screen screenshot failed: ${(run.stderr || run.stdout || "unknown").toString().slice(0, 400)}`);
    }
    return dest;
  }
  const tools = [
    ["import", ["-window", "root", dest]],
    ["scrot", [dest]],
    ["gnome-screenshot", ["-f", dest]],
  ];
  for (const [cmd, args] of tools) {
    const run = spawnSync(cmd, args, { encoding: "utf8" });
    if (run.status === 0 && fs.existsSync(dest)) return dest;
  }
  throw new Error("No screen-capture tool (need Edge/Chrome CDP for tab shots; full screen needs import/scrot or Windows).");
}

module.exports = {
  quoteWin,
  launchApp,
  parseTasklistCsv,
  listWindows,
  focusWindow,
  screenshotScreen,
  desktopDir,
};
