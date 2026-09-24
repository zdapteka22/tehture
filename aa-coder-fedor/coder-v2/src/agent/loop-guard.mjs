#!/usr/bin/env node
"use strict";

/**
 * Сторож цикла. Вызывает goal-brain с --task.
 * CONTINUE немедленно выходит кодом 2: process.exit(2), не exitCode.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function findBrain() {
  const roots = [
    process.env.FEDOR_WORKSPACE,
    path.join(process.env.USERPROFILE || process.env.HOME || "", "Fedor2", "workspace"),
    here,
  ].filter(Boolean);
  for (const root of roots) {
    const p = path.join(root, root === here ? "goal-brain.mjs" : path.join(".agent", "goal-brain.mjs"));
    if (fs.existsSync(p)) return p;
  }
  return path.join(here, "goal-brain.mjs");
}

function readTask(dir) {
  let fromState = "";
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "loop-guard.state.json"), "utf8"));
    fromState = String(raw.goal || "").trim();
  } catch {
    fromState = "";
  }
  let fromGoalFile = "";
  try {
    fromGoalFile = fs.readFileSync(path.join(dir, "goal.txt"), "utf8").trim();
  } catch {
    fromGoalFile = "";
  }
  let fromBrain = "";
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, "goal-brain.state.json"), "utf8"));
    fromBrain = String(raw.goal || "").trim();
  } catch {
    fromBrain = "";
  }
  const task = fromState || fromGoalFile || fromBrain || String(process.env.FEDOR_GOAL || "").trim();
  return task;
}

function runBrain(args) {
  const brain = findBrain();
  const proc = spawnSync(process.execPath, [brain, ...args], {
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });
  const out = `${proc.stdout || ""}${proc.stderr || ""}`.trim();
  return { status: proc.status ?? 1, out };
}

export function autoGoalVerdict(dir = process.cwd()) {
  const task = readTask(dir);
  const statePath = path.join(dir, "goal-brain.state.json");
  const args = ["check", "--state", statePath, "--task", task];
  return runBrain(args);
}

function enforce(dir = process.cwd()) {
  const r = autoGoalVerdict(dir);
  const lines = r.out.split("\n").filter(Boolean);
  console.log(r.out || "CONTINUE цель не достигнута");
  const verdict = ((lines.find((l) => /^VERDICT=/.test(l)) || "").slice(8) ||
    (lines.find((l) => /^(DONE|CONTINUE|BLOCKED)\b/.test(l)) || "").split(/\s+/)[0] ||
    "CONTINUE").toUpperCase();
  if (verdict === "CONTINUE") {
    console.log("ACTION=НЕ ОСТАНАВЛИВАТЬСЯ: сделай следующий ход.");
    process.exit(2);
  }
  if (verdict === "BLOCKED") {
    console.log("ACTION=остановка разрешена.");
    process.exit(1);
  }
  console.log("ACTION=остановка разрешена.");
  process.exit(0);
}

function selftest() {
  const brain = findBrain();
  if (!fs.existsSync(brain)) {
    console.error("FAIL missing goal-brain.mjs");
    return 1;
  }
  const r = runBrain(["selftest"]);
  const okBrain = r.status === 0 && /goal-brain selftest:/.test(r.out);
  console.log(okBrain ? "ok  brain reachable" : "FAIL brain reachable");

  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "lg-task-"));
  fs.writeFileSync(
    path.join(tmp, "goal-brain.state.json"),
    JSON.stringify(
      {
        goal: "старая цель про вчерашний клик",
        done_when: ["TOKEN_READY"],
        evidence: [{ text: "TOKEN_READY vk1.a" }],
        lastCheck: new Date().toISOString(),
        lastVerdict: "DONE",
      },
      null,
      2,
    ),
    "utf8",
  );
  fs.writeFileSync(path.join(tmp, "loop-guard.state.json"), JSON.stringify({ goal: "новая задача: оплата картой" }), "utf8");
  const foreign = autoGoalVerdict(tmp);
  const staleOk = /STALE=1/.test(foreign.out) && /VERDICT=CONTINUE/.test(foreign.out);
  console.log(staleOk ? "ok  wrapper foreign task -> STALE CONTINUE" : "FAIL wrapper foreign task");

  const child = spawnSync(process.execPath, [path.join(here, "loop-guard.mjs"), "enforce"], {
    cwd: tmp,
    encoding: "utf8",
    timeout: 8000,
    windowsHide: true,
  });
  const exit2 = child.status === 2;
  console.log(exit2 ? "ok  CONTINUE -> process.exit(2)" : `FAIL CONTINUE exit=${child.status}`);

  fs.writeFileSync(path.join(tmp, "loop-guard.state.json"), JSON.stringify({ goal: "старая цель про вчерашний клик" }), "utf8");
  const own = autoGoalVerdict(tmp);
  const ownOk = /VERDICT=DONE/.test(own.out) && !/STALE=1/.test(own.out);
  console.log(ownOk ? "ok  wrapper own task -> DONE" : "FAIL wrapper own task");
  fs.rmSync(tmp, { recursive: true, force: true });

  const pass = okBrain && staleOk && ownOk && exit2;
  console.log(`loop-guard selftest: ${pass ? 4 : 0}/4`);
  return pass ? 0 : 1;
}

function main(argv) {
  const cmd = argv[0] || "enforce";
  if (cmd === "selftest") return selftest();
  if (cmd === "enforce" || cmd === "check") return enforce(process.cwd());
  console.log("loop-guard: enforce | check | selftest");
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("loop-guard.mjs");
if (isMain) {
  const code = main(process.argv.slice(2));
  if (typeof code === "number") process.exit(code);
}
