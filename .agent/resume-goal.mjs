#!/usr/bin/env node
// Реальный подъём после UNJUSTIFIED STOP. Не печаталка: пишет nudge и, если процесс мёртв, поднимает кодер.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function argVal(args, name) {
  const p = `--${name}=`;
  const hit = args.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : undefined;
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function processAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function findStartScript(root) {
  const home = process.env.LOCALAPPDATA || process.env.USERPROFILE || os.homedir();
  const names = [
    process.env.FEDOR_RESUME_CMD,
    path.join(root, "scripts", "start-grok-coder.ps1"),
    path.join(root, "aa-coder-fedor", "scripts", "start-grok-coder.ps1"),
    path.join(home, "Fedor2", "start-grok-coder.ps1"),
    path.join(home, "Fedor2", "AA Coder Fedor 3.0.bat"),
  ].filter(Boolean);
  return names.find((p) => fs.existsSync(p)) || "";
}

function launchCoder(root) {
  if (process.env.LOOP_GUARD_NO_LAUNCH === "1") return { launched: false, reason: "test" };
  if (process.env.FEDOR_RESUME_LAUNCH !== "1") return { launched: false, reason: "launch-off" };
  const script = findStartScript(root);
  if (!script) return { launched: false, reason: "no-start-script" };
  if (script.toLowerCase().endsWith(".ps1")) {
    const child = spawn("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script], {
      detached: true,
      stdio: "ignore",
      cwd: root,
      env: process.env,
    });
    child.unref();
    return { launched: true, pid: child.pid };
  }
  const child = spawn(script, [], {
    detached: true,
    stdio: "ignore",
    cwd: root,
    env: process.env,
    shell: true,
  });
  child.unref();
  return { launched: true, pid: child.pid };
}

function main(argv = process.argv.slice(2)) {
  const dir = path.resolve(argVal(argv, "dir") || __dirname);
  const root = path.resolve(dir, "..");
  const state = loadJson(path.join(dir, "loop-guard.state.json"), {});
  const ticket = loadJson(path.join(dir, "restart.ticket.json"), {});
  const reason = String(ticket.reason || state.last_unjustified || "no_reason");
  const goal = String(state.goal || ticket.goal || "").trim();
  if (state.verdict === "DONE" && /user_stop|external_deny/.test(String(state.stop_reason || ""))) {
    console.log("RESUMED=0");
    console.log("REASON=justified-stop");
    return;
  }
  const nudge = {
    t: new Date().toISOString(),
    goal,
    reason,
    text:
      "Цель ещё открыта. Внезапная остановка не считается концом. Сделай следующий ход инструментом, не пиши «готово».",
  };
  fs.writeFileSync(path.join(dir, "resume.nudge.json"), JSON.stringify(nudge, null, 2), "utf8");
  fs.writeFileSync(
    path.join(dir, "loop-guard.heartbeat"),
    JSON.stringify({ t: nudge.t, pid: state.pid || process.ppid || process.pid }),
    "utf8",
  );
  const alive = processAlive(state.pid);
  let launch = { launched: false, reason: "alive" };
  if (!alive) launch = launchCoder(root);
  console.log("RESUMED=1");
  console.log("GOAL=" + goal);
  console.log("REASON=" + reason);
  console.log("ALIVE=" + (alive ? "1" : "0"));
  console.log("LAUNCHED=" + (launch.launched ? "1" : "0"));
  if (launch.reason) console.log("LAUNCH=" + launch.reason);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
