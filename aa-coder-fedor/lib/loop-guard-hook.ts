import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { looksLikeKeepGoing, looksLikeStopCommand, taskNeedsWork } from "./fyodor/intent";

export type GuardDecision = {
  keepGoing: boolean;
  verdict: string;
  action: string;
  reason: string;
  restarted: boolean;
};

function here(): string {
  try {
    return path.dirname(fileURLToPath(import.meta.url));
  } catch {
    return process.cwd();
  }
}

export function findAgentDir(): string {
  const roots = [
    process.env.GROK_WORKSPACE,
    process.env.FEDOR_WORKSPACE,
    process.env.FEDOR_APP_ROOT,
    process.cwd(),
    path.resolve(here(), ".."),
    path.resolve(here(), "..", ".."),
  ].filter(Boolean) as string[];
  for (const root of roots) {
    const dir = path.join(root, ".agent");
    if (existsSync(path.join(dir, "loop-guard.mjs"))) return dir;
  }
  return path.join(process.cwd(), ".agent");
}

function runGuard(args: string[], dir = findAgentDir()): { status: number; out: string } {
  const bin = path.join(dir, "loop-guard.mjs");
  if (!existsSync(bin)) return { status: 1, out: "" };
  try {
    mkdirSync(dir, { recursive: true });
    const proc = spawnSync(process.execPath, [bin, ...args, `--dir=${dir}`], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
      cwd: path.resolve(dir, ".."),
      env: { ...process.env, LOOP_GUARD_NO_LAUNCH: "1" },
    });
    return { status: proc.status ?? 1, out: `${proc.stdout || ""}${proc.stderr || ""}` };
  } catch {
    return { status: 1, out: "" };
  }
}

function parseDecision(out: string, status: number): GuardDecision {
  const verdict = ((out.match(/^VERDICT=(\w+)/m) || [])[1] || "").toUpperCase();
  const action = ((out.match(/^ACTION=(\S+)/m) || [])[1] || "").toUpperCase();
  const reason = ((out.match(/^REASON=(.*)$/m) || [])[1] || "").trim();
  const keepGoing =
    verdict === "CONTINUE" ||
    action === "RESTART" ||
    action === "НЕ" ||
    /НЕ ОСТАНАВЛИВАТЬСЯ/.test(out) ||
    status === 2;
  return {
    keepGoing,
    verdict: verdict || (keepGoing ? "CONTINUE" : ""),
    action: action || (keepGoing ? "CONTINUE" : ""),
    reason,
    restarted: /RESTARTED=/.test(out) && !/RESTARTED=ticket\b/.test(out),
  };
}

export function noteGuardUser(text: string): void {
  const raw = String(text || "").trim();
  if (!raw) return;
  const dir = findAgentDir();
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "goal.txt"), raw.slice(0, 4000), "utf8");
  } catch {
    // ignore
  }
  if (looksLikeStopCommand(raw)) {
    runGuard(["on-user", raw], dir);
    return;
  }
  if (!taskNeedsWork(raw)) {
    runGuard(["on-user", raw], dir);
    runGuard(["heartbeat", `--pid=${process.pid}`], dir);
    return;
  }
  runGuard(["begin", `--goal=${raw.slice(0, 500)}`], dir);
  runGuard(["heartbeat", `--pid=${process.pid}`], dir);
}

export function noteGuardTool(tool: string, result = "", error: string | null = null): void {
  const args = ["receipt", `--tool=${String(tool || "tool").slice(0, 80)}`, `--result=${String(result || "").slice(0, 400)}`];
  if (error) args.push(`--error=${String(error).slice(0, 200)}`);
  runGuard(args);
  runGuard(["heartbeat", `--pid=${process.pid}`]);
}

export function noteGuardAssistant(text: string): void {
  const raw = String(text || "").trim();
  if (!raw) return;
  runGuard(["say", `--assistant=${raw.slice(0, 500)}`]);
}

export function decideGuardStop(assistantText: string, userText = ""): GuardDecision {
  const rawUser = String(userText || "").trim();
  if (looksLikeStopCommand(rawUser) || looksLikeStopCommand(assistantText)) {
    return { keepGoing: false, verdict: "DONE", action: "STOP", reason: "user_stop", restarted: false };
  }
  noteGuardAssistant(assistantText);
  const r = runGuard([
    "classify",
    "--type=stop-attempt",
    `--assistant=${String(assistantText || "").slice(0, 500)}`,
    `--user=${rawUser.slice(0, 500)}`,
  ]);
  if (!String(r.out || "").trim()) {
    return { keepGoing: true, verdict: "CONTINUE", action: "CONTINUE", reason: "guard_silent", restarted: false };
  }
  const parsed = parseDecision(r.out, r.status);
  if (parsed.reason === "user_stop" || parsed.reason === "goal_verified" || parsed.reason === "external_deny") {
    return parsed;
  }
  if (parsed.verdict === "BLOCKED" && parsed.reason === "max_loops") {
    return parsed;
  }
  if (
    taskNeedsWork(rawUser) ||
    looksLikeKeepGoing(rawUser) ||
    /no_reason|open_goal|restart_limit|guard_silent|follow-up/i.test(parsed.reason) ||
    parsed.verdict === "CONTINUE"
  ) {
    return { ...parsed, keepGoing: true, verdict: parsed.verdict || "CONTINUE" };
  }
  return parsed;
}

export function guardTick(): void {
  runGuard(["tick"]);
}
