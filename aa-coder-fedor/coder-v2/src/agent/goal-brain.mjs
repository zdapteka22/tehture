#!/usr/bin/env node
"use strict";

/**
 * Определитель цели. Не верит слову «готово».
 * Устаревшая / чужая цель не даёт DONE.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const TTL_MS = 6 * 60 * 60 * 1000;

function defaultStatePath() {
  if (process.env.FEDOR_GOAL_STATE) return path.resolve(process.env.FEDOR_GOAL_STATE);
  const dir = process.env.FEDOR_WORKSPACE
    ? path.join(process.env.FEDOR_WORKSPACE, ".agent")
    : path.join(process.env.LOCALAPPDATA || process.env.HOME || os.homedir() || ".", "Fedor2");
  return path.join(dir, "goal-brain.state.json");
}

function emptyState() {
  return {
    goal: null,
    done_when: [],
    evidence: [],
    lastCheck: null,
    lastVerdict: null,
    startedAt: null,
  };
}

export function loadState(file) {
  try {
    return { ...emptyState(), ...JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch {
    return emptyState();
  }
}

export function saveState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export function significantPrefix(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
}

export function staleness(goal, opts = {}) {
  const now = Number(opts.now) || Date.now();
  const rawCheck = goal && (goal.lastCheck || goal.checkedAt || goal.updatedAt);
  const lastCheck = rawCheck ? Date.parse(rawCheck) : 0;
  const ageMs = lastCheck ? now - lastCheck : 0;
  const expired = !lastCheck || ageMs > TTL_MS;
  const task = String(opts.task || "").trim();
  const saved = String((goal && (goal.goal || goal.text)) || "").trim();
  const mismatch = Boolean(task && saved && significantPrefix(task) !== significantPrefix(saved));
  const stale = Boolean(expired || mismatch);
  let why = "";
  if (mismatch) why = "task mismatch: текущая задача не совпадает с сохранённой целью";
  else if (expired) why = lastCheck ? `TTL: lastCheck ${ageMs}ms > ${TTL_MS}ms` : "нет lastCheck";
  return { stale, expired, mismatch, ageMs, why };
}

function baseVerdict(state) {
  const goal = String((state && state.goal) || "").trim();
  if (!goal) return { verdict: "CONTINUE", message: "цель не задана — это не «готово»" };
  const when = Array.isArray(state.done_when)
    ? state.done_when.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  if (!when.length) {
    return { verdict: "CONTINUE", message: `цель «${goal}» задана, но критерии done_when пусты — продолжай` };
  }
  const blob = ((state.evidence || []).map((e) => String((e && e.text) || "")).join("\n") || "").toLowerCase();
  const missing = when.filter((item) => !blob.includes(item.toLowerCase()));
  if (missing.length) {
    return { verdict: "CONTINUE", message: `цель «${goal}» ещё нет: ${missing.join(", ")}` };
  }
  return { verdict: "DONE", message: `цель «${goal}» достигнута по критериям done_when` };
}

export function evaluate(goal, opts = {}) {
  const state = goal && typeof goal === "object" ? goal : { goal };
  const raw = baseVerdict(state);
  const staleInfo = staleness(state, opts);
  if (raw.verdict === "DONE" && staleInfo.stale) {
    return {
      verdict: "CONTINUE",
      message: `устаревшая цель не даёт DONE — ${staleInfo.why}`,
      stale: staleInfo,
    };
  }
  return { ...raw, stale: staleInfo };
}

function printCheck(result) {
  const stale = result.stale || { stale: false, why: "" };
  if (stale.stale) console.log(`STALE=1 — ${stale.why}`);
  else console.log("STALE=0");
  console.log(`VERDICT=${result.verdict}`);
  console.log(result.message);
}

function argVal(rest, name) {
  const key = `--${name}`;
  const i = rest.indexOf(key);
  if (i >= 0) return rest[i + 1] || "";
  const pref = `${key}=`;
  const hit = rest.find((a) => a.startsWith(pref));
  return hit ? hit.slice(pref.length) : "";
}

export function resetState(file) {
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

export function selftest() {
  const now = Date.now();
  const fresh = {
    goal: "нажми Войти",
    done_when: ["TOKEN_READY"],
    evidence: [{ text: "TOKEN_READY vk1.a" }],
    lastCheck: new Date(now).toISOString(),
    lastVerdict: "DONE",
  };
  const old = {
    ...fresh,
    lastCheck: new Date(now - TTL_MS - 60_000).toISOString(),
    lastVerdict: "DONE",
  };
  const ttl = evaluate(old, { now });
  const staleFlag = staleness(old, { now });
  const freshDone = evaluate(fresh, { now, task: "нажми Войти" });
  const mismatch = staleness(fresh, { now, task: "оплати тариф российской картой" });
  const match = staleness(fresh, { now, task: "нажми Войти" });
  const empty = evaluate({ goal: null, done_when: [], evidence: [] }, { now });

  const cases = [
    ["stale by TTL -> not DONE", ttl.verdict === "CONTINUE"],
    ["stale flag set", staleFlag.stale === true && staleFlag.expired === true],
    ["fresh goal still DONE", freshDone.verdict === "DONE"],
    ["task mismatch -> stale", mismatch.stale === true && mismatch.mismatch === true],
    ["task match -> not stale", match.stale === false && match.mismatch === false],
    ["empty continues", empty.verdict === "CONTINUE"],
  ];
  let pass = 0;
  for (const [name, ok] of cases) {
    console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
    if (ok) pass += 1;
  }
  console.log(`goal-brain selftest: ${pass}/${cases.length}`);
  return pass === cases.length ? 0 : 1;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  const stateFile = argVal(rest, "state") || defaultStatePath();
  const task = argVal(rest, "task");

  if (!cmd || cmd === "selftest") return selftest();
  if (cmd === "reset") {
    resetState(stateFile);
    console.log(`RESET ${stateFile}`);
    return 0;
  }
  if (cmd === "set" || cmd === "goal") {
    const state = loadState(stateFile);
    const text = rest.filter((a) => !a.startsWith("--") && a !== task && a !== stateFile).join(" ").trim();
    state.goal = text || task || null;
    state.startedAt = new Date().toISOString();
    state.lastCheck = state.startedAt;
    state.lastVerdict = "CONTINUE";
    if (!Array.isArray(state.done_when)) state.done_when = [];
    saveState(stateFile, state);
    console.log(`GOAL ${state.goal || "(cleared)"}`);
    return 0;
  }
  if (cmd === "when") {
    const state = loadState(stateFile);
    state.done_when = rest
      .filter((a) => !a.startsWith("--"))
      .join(" ")
      .split("|")
      .map((s) => s.trim())
      .filter(Boolean);
    saveState(stateFile, state);
    console.log(`DONE_WHEN ${state.done_when.join(" | ") || "(empty)"}`);
    return 0;
  }
  if (cmd === "evidence") {
    const state = loadState(stateFile);
    state.evidence = state.evidence || [];
    state.evidence.push({
      at: new Date().toISOString(),
      text: rest.filter((a) => !a.startsWith("--")).join(" ").slice(0, 400),
    });
    if (state.evidence.length > 40) state.evidence = state.evidence.slice(-40);
    const r = evaluate(state, { task });
    state.lastCheck = new Date().toISOString();
    state.lastVerdict = r.verdict;
    saveState(stateFile, state);
    printCheck(r);
    return 0;
  }
  if (cmd === "status" || cmd === "check") {
    const state = loadState(stateFile);
    const r = evaluate(state, { task });
    state.lastCheck = new Date().toISOString();
    state.lastVerdict = r.verdict;
    saveState(stateFile, state);
    printCheck(r);
    return r.verdict === "DONE" ? 0 : 2;
  }
  console.log("goal-brain: set | when | evidence | check | status | reset | selftest");
  return 0;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith("goal-brain.mjs");
if (isMain) process.exit(main(process.argv.slice(2)));

export { main, defaultStatePath };
