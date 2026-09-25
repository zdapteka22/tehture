import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), "..");
const BRAIN = path.join(ROOT, "coder-v2", "src", "agent", "goal-brain.mjs");
const WRAP = path.join(ROOT, "coder-v2", "src", "agent", "loop-guard.mjs");
const AGENT = path.resolve(ROOT, "..", ".agent", "loop-guard.mjs");
const CHECK_BAT = path.resolve(ROOT, "..", ".agent", "check.bat");
const CHECK_GUARD = path.resolve(ROOT, "..", ".agent", "check-guard.bat");

function ok(name: string, cond: unknown) {
  if (!cond) {
    console.error("FAIL", name);
    process.exit(1);
  }
  console.log("ok  ", name);
}

function run(file: string, args: string[], cwd?: string) {
  return spawnSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    cwd: cwd || ROOT,
    timeout: 20000,
    windowsHide: true,
  });
}

const brain = run(BRAIN, ["selftest"]);
console.log(brain.stdout);
ok("goal-brain selftest", (brain.status ?? 1) === 0 && /stale by TTL/.test(brain.stdout || ""));

const wrap = run(WRAP, ["selftest"]);
console.log(wrap.stdout);
ok("coder-v2 loop-guard selftest", (wrap.status ?? 1) === 0 && /foreign task/.test(wrap.stdout || ""));
ok("coder-v2 CONTINUE process.exit(2)", /CONTINUE -> process\.exit\(2\)/.test(wrap.stdout || ""));

const agent = run(AGENT, ["selftest"], path.dirname(AGENT));
console.log(agent.stdout);
ok("agent loop-guard selftest", (agent.status ?? 1) === 0 && /selftest passed/.test(agent.stdout || ""));
ok("цель достигнута -> CONTINUE", /цель достигнута -> CONTINUE/.test(agent.stdout || ""));
ok("чужая задача stale", /чужая задача -> STALE CONTINUE/.test(agent.stdout || ""));
ok("agent CONTINUE process.exit(2)", /CONTINUE -> process\.exit\(2\)/.test(agent.stdout || ""));
ok("LOOPS.md UTF-8 в selftest", /LOOPS\.md UTF-8 без U\+FFFD/.test(agent.stdout || ""));
ok("auto restart_command задан", /auto restart_command задан/.test(agent.stdout || ""));
ok("resume-goal пишет nudge", /resume-goal пишет nudge/.test(agent.stdout || ""));

const tmp = mkdtempSync(path.join(os.tmpdir(), "goal-stale-"));
writeFileSync(
  path.join(tmp, "goal-brain.state.json"),
  JSON.stringify({
    goal: "вчерашняя цель",
    done_when: ["TOKEN_READY"],
    evidence: [{ text: "TOKEN_READY" }],
    lastCheck: new Date().toISOString(),
    lastVerdict: "DONE",
  }),
  "utf8",
);
writeFileSync(path.join(tmp, "loop-guard.state.json"), JSON.stringify({ goal: "новая задача" }), "utf8");
const foreign = run(BRAIN, ["check", "--state", path.join(tmp, "goal-brain.state.json"), "--task", "новая задача"]);
ok("check prints STALE=1", /STALE=1/.test(foreign.stdout || ""));
ok("check CONTINUE on foreign", /VERDICT=CONTINUE/.test(foreign.stdout || ""));
ok("check --task задан", (foreign.status ?? 0) === 2);

const reset = run(BRAIN, ["reset", "--state", path.join(tmp, "goal-brain.state.json")]);
ok("reset removes state", (reset.status ?? 1) === 0 && !existsSync(path.join(tmp, "goal-brain.state.json")));

const enforceTmp = mkdtempSync(path.join(os.tmpdir(), "goal-exit2-"));
writeFileSync(
  path.join(enforceTmp, "goal-brain.state.json"),
  JSON.stringify({
    goal: "вчерашняя цель про клик",
    done_when: ["TOKEN_READY"],
    evidence: [{ text: "TOKEN_READY vk1.a" }],
    lastCheck: new Date().toISOString(),
    lastVerdict: "DONE",
  }),
  "utf8",
);
writeFileSync(path.join(enforceTmp, "loop-guard.state.json"), JSON.stringify({ goal: "новая задача: оплата картой" }), "utf8");
const enforce = run(WRAP, ["enforce"], enforceTmp);
ok("wrapper enforce status===2", enforce.status === 2);
ok("wrapper enforce не врёт нулём", enforce.status !== 0);

const agentEnforce = run(AGENT, ["enforce", `--dir=${enforceTmp}`], enforceTmp);
ok("agent enforce status===2", agentEnforce.status === 2);

const logTmp = mkdtempSync(path.join(os.tmpdir(), "loops-"));
writeFileSync(path.join(logTmp, "LOOPS.md"), "pat\uFFFDh zamen\uFFFD\n", "utf8");
const logged = run(AGENT, ["log", `--dir=${logTmp}`, "ход: замена path"], logTmp);
ok("log command writes", (logged.status ?? 1) === 0);
const cleaned = readFileSync(path.join(logTmp, "LOOPS.md"), "utf8");
const bad = (cleaned.match(/\uFFFD/g) || []).length;
ok("log utf8 no replacement chars", bad === 0 && cleaned.includes("path") && cleaned.includes("замена"));

const hookTmp = mkdtempSync(path.join(os.tmpdir(), "guard-hook-"));
const hookAgent = path.join(hookTmp, ".agent");
mkdirSync(hookAgent, { recursive: true });
for (const name of ["loop-guard.mjs", "loop-guard.json", "resume-goal.mjs", "goal-brain.mjs"]) {
  const src = path.resolve(ROOT, "..", ".agent", name);
  if (existsSync(src)) writeFileSync(path.join(hookAgent, name), readFileSync(src));
}
writeFileSync(
  path.join(hookAgent, "loop-guard.state.json"),
  JSON.stringify({ goal: "вчерашняя цель FIX-ДЛЯ-ДРУГОГО-КОДЕРА.md", verdict: "done", loops: 5 }),
  "utf8",
);
writeFileSync(
  path.join(hookAgent, "goal-brain.state.json"),
  JSON.stringify({ goal: "FIX-ДЛЯ-ДРУГОГО-КОДЕРА.md", lastVerdict: "CONTINUE", lastCheck: "2026-09-24" }),
  "utf8",
);
const begun = run(path.join(hookAgent, "loop-guard.mjs"), ["begin", "--goal=новая задача: оплата картой", `--dir=${hookAgent}`], hookTmp);
ok("begin resets stale loops", /VERDICT=CONTINUE/.test(begun.stdout || ""));
const begunState = JSON.parse(readFileSync(path.join(hookAgent, "loop-guard.state.json"), "utf8"));
ok("begin clears old loops", (begunState.loops || 0) === 0 && begunState.goal.includes("оплата"));
ok("begin drops stale brain", !existsSync(path.join(hookAgent, "goal-brain.state.json")));
const classified = run(
  path.join(hookAgent, "loop-guard.mjs"),
  ["classify", "--type=stop-attempt", "--assistant=готово", "--user=новая задача: оплата картой", `--dir=${hookAgent}`],
  hookTmp,
);
ok("stop-attempt keeps going", /ACTION=CONTINUE|VERDICT=CONTINUE|НЕ ОСТАНАВЛИВАТЬСЯ/.test(classified.stdout || ""));
ok(
  "stop-attempt does not restart process",
  !existsSync(path.join(hookAgent, "restart.ticket.json")) && !existsSync(path.join(hookAgent, "resume.nudge.json")),
);
rmSync(hookTmp, { recursive: true, force: true });

const cfg = readFileSync(path.resolve(ROOT, "..", ".agent", "loop-guard.json"), "utf8");
ok("config restart is auto", /"restart_command": "auto"/.test(cfg));
ok("config unjustified is continue", /"on_unjustified": "continue"/.test(cfg));
ok("config heartbeat is 5 min", /"heartbeat_stale_ms": 300000/.test(cfg));
ok("config done phrases are strict", /"цель достигнута"/.test(cfg) && /"задача закрыта"/.test(cfg) && !/"done_phrases": \[[^\]]*"готово"/.test(cfg));
ok("config plan phrases drop heading", /"plan_phrases": \[[^\]]*"сделаю позже"/.test(cfg) && !/"plan_phrases": \[[^\]]*"план:"/.test(cfg));
ok("resume-goal exists", existsSync(path.resolve(ROOT, "..", ".agent", "resume-goal.mjs")));
const hook = readFileSync(path.join(ROOT, "lib", "loop-guard-hook.ts"), "utf8");
ok("hook begin on user", hook.includes("begin") && hook.includes("noteGuardUser"));
ok("hook classify on stop", hook.includes("stop-attempt") && hook.includes("decideGuardStop"));
ok("hook classify without detach", !hook.includes("--detach"));
const crew = readFileSync(path.join(ROOT, "lib", "crew", "run.ts"), "utf8");
ok("crew calls guard on empty tools", crew.includes("decideGuardStop") && crew.includes("noteGuardTool"));
ok("crew hod hides classifier", !crew.includes("Гвард:") && crew.includes("Цель не закрыта — делаю следующий шаг."));
const handle = readFileSync(path.join(ROOT, "lib", "fyodor", "handle.ts"), "utf8");
ok("handle begins guard goal", handle.includes("noteGuardUser"));
const start = readFileSync(path.join(ROOT, "scripts", "start-grok-coder.ps1"), "utf8");
ok("start copies resume-goal", start.includes("resume-goal.mjs"));

const loops = path.resolve(ROOT, "..", ".agent", "LOOPS.md");
if (existsSync(loops)) {
  const n = (readFileSync(loops, "utf8").match(/\uFFFD/g) || []).length;
  ok(".agent/LOOPS.md BAD=0", n === 0);
}

function batLooksHonest(file: string) {
  const src = readFileSync(file, "utf8");
  return (
    !/setlocal/i.test(src) &&
    /set MAX_OK=1/.test(src) &&
    src.indexOf("set MAX_OK=1") < src.indexOf('node "%~dp0goal-brain.mjs" selftest') &&
    /SELFTEST: OK/.test(src) &&
    /RESULT: OK/.test(src) &&
    /EXITCODE: 0/.test(src) &&
    /EXITCODE: 1/.test(src)
  );
}
ok("check.bat не врёт про состояние", existsSync(CHECK_BAT) && batLooksHonest(CHECK_BAT));
ok("check-guard.bat не врёт про состояние", existsSync(CHECK_GUARD) && batLooksHonest(CHECK_GUARD));

function wineEnv() {
  const prefix = path.join(os.homedir(), ".wine-fedor-keep");
  return { ...process.env, WINEDEBUG: "-all", WINEPREFIX: prefix };
}

const wineVer = spawnSync("wine", ["--version"], { encoding: "utf8", env: wineEnv(), timeout: 15000 });
if ((wineVer.status ?? 1) === 0) {
  const delayed = spawnSync(
    "wine",
    ["cmd", "/v:on", "/c", "cmd /c exit /b 2 & echo DELAYED=!ERRORLEVEL!"],
    { encoding: "utf8", env: wineEnv(), timeout: 45000 },
  );
  const dOut = `${delayed.stdout || ""}${delayed.stderr || ""}`;
  console.log("wine /v:on", delayed.status, dOut.replace(/\r/g, "").replace(/\n/g, " | ").slice(0, 240));
  ok("cmd /v:on !ERRORLEVEL! видит 2", /DELAYED=2/.test(dOut));
} else {
  console.log("skip wine /v:on (wine missing)");
}

rmSync(tmp, { recursive: true, force: true });
rmSync(enforceTmp, { recursive: true, force: true });
rmSync(logTmp, { recursive: true, force: true });
console.log("goal-stale ok");
