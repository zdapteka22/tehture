"use strict";

/**
 * guard.cjs — предохранитель кодера.
 *
 * (1) неизвестный инструмент LLM / неизвестная команда hub
 * (2) «готово» без свежего доказательства
 * (3) остановка, пока цель не достигнута
 * (4) клик вслепую без чтения страницы
 *
 * Вердикт BLOCK / WARN / OK. CLI: BLOCK → exit 2.
 * Installer and start-grok-coder.ps1 run: node guard.cjs selftest
 */

const fs = require("node:fs");
const path = require("node:path");

const STATE_DIR = path.join(process.env.LOCALAPPDATA || process.env.HOME || ".", "Fedor2");
const STATE_FILE = path.join(STATE_DIR, "guard-state.json");

/**
 * Tools the coder may actually run. Anything else is not work and not «готово».
 * Keep in sync with lib/tools.ts GROK_TOOLS + lib/fyodor/tools-registry.ts aliases.
 */
const KNOWN_TOOLS = [
  "read_file",
  "list_dir",
  "grep",
  "search_replace",
  "write_file",
  "run_terminal_cmd",
  "todo_write",
  "write_pc_file",
  "open_on_pc",
  "launch_app",
  "browser_navigate",
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press",
  "browser_wait",
  "browser_scroll",
  "browser_back",
  "browser_forward",
  "browser_close",
  "browser_tabs",
  "browser_engine",
  "click_kit",
  "browser_screenshot",
  "pc_windows",
  "pc_focus",
  "operator_use",
  "pc_snapshot",
  "pc_click",
  "pc_type",
  "pc_keys",
  "pc_screenshot",
  "send_to_peer",
  "memory_recall",
  "memory_save",
  "memory_forget",
  "memory_optimize",
  "project_harness",
  "web_fetch",
];

const ALIASES = {
  "fs.read": "read_file",
  "fs.write": "write_file",
  "fs.edit": "search_replace",
  "fs.list": "list_dir",
  shell: "run_terminal_cmd",
  "test_runner.run": "run_terminal_cmd",
  "test_runner.detect": "list_dir",
  "git.status": "git.status",
  "git.diff": "git.diff",
  "memory.read": "memory_recall",
  "memory.write": "memory_save",
};

const EXTRA_KNOWN = ["git.status", "git.diff"];

const KNOWN = {
  "browser-cdp": [
    "tabs",
    "navigate",
    "wait",
    "text",
    "find",
    "click-text",
    "click",
    "type",
    "keys",
    "portals",
    "frames",
    "eval",
    "shot",
    "close",
  ],
  "coder-v2": [
    "doctor",
    "tabs",
    "tab",
    "open",
    "screenshot",
    "shot",
    "launch",
    "snapshot",
    "click",
    "type",
    "key",
    "keys",
    "scroll",
    "find",
    "text",
    "eval",
    "pc",
    "menu",
    "start",
    "wait",
    "back",
    "forward",
    "newtab",
    "closetab",
    "windows",
    "focus",
    "guard",
    "goal",
  ],
  "loop-guard": ["goal", "status", "enforce", "selftest", "reset", "log"],
};

function canonical(name) {
  const n = String(name || "").trim();
  if (!n) return "";
  return ALIASES[n] || n;
}

function isKnownTool(name) {
  const n = String(name || "").trim();
  if (!n) return false;
  const c = canonical(n);
  return KNOWN_TOOLS.includes(n) || KNOWN_TOOLS.includes(c) || EXTRA_KNOWN.includes(c);
}

function unknownToolMessage(name) {
  const n = String(name || "").trim() || "(empty)";
  return (
    `UNKNOWN_TOOL: ${n}. Это не выполнение и не «готово». Нет такого инструмента. ` +
    `Возьми из списка: ${KNOWN_TOOLS.join(", ")}.`
  );
}

function looksLikeFalseDone(text) {
  return /UNKNOWN_TOOL\b|Unknown tool:|несуществующ\w* команд|DONE_WITHOUT_EVIDENCE|STALE_EVIDENCE|STOP_WITHOUT_REASON|BLIND_CLICK|STALE_READ/i.test(
    String(text || ""),
  );
}

function requiredFiles() {
  const dir = __dirname;
  return [
    path.join(dir, "guard.cjs"),
    path.join(dir, "hub.cjs"),
    path.join(dir, "cdp.cjs"),
    path.join(dir, "engines.cjs"),
  ];
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return { goal: null, startedAt: null, steps: [], lastEvidence: null, stops: 0 };
  }
}

function saveState(s) {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), "utf8");
  } catch {
    /* состояние не критично для работы */
  }
}

function checkCommand(tool, command) {
  const list = KNOWN[tool];
  if (!list) return { ok: true, note: `инструмент ${tool} не в реестре — пропуск` };
  if (list.includes(command)) return { ok: true };
  return {
    ok: false,
    code: "UNKNOWN_COMMAND",
    message: `команды "${command}" нет в ${tool}. Есть: ${list.join(", ")}`,
    fix: "выбери существующую команду или сначала добавь её в модуль",
  };
}

function checkDoneClaim(claim, evidence) {
  const words = /(готово|сделано|выполнено|done|успешно|создан[оа]?|исправлен[оа]?)/i;
  if (!words.test(String(claim || ""))) return { ok: true };
  if (!evidence || !evidence.at) {
    return {
      ok: false,
      code: "DONE_WITHOUT_EVIDENCE",
      message: "сказано «готово» без свежего результата инструмента",
      fix: "сначала вызови инструмент и приложи его вывод как доказательство",
    };
  }
  const age = Date.now() - new Date(evidence.at).getTime();
  if (age > 5 * 60 * 1000) {
    return {
      ok: false,
      code: "STALE_EVIDENCE",
      message: `доказательству ${Math.round(age / 1000)}с — оно устарело`,
      fix: "перепроверь результат прямо сейчас",
    };
  }
  return { ok: true };
}

function checkStop(goal, state, reason) {
  if (!goal) return { ok: true, note: "цель не задана — сторож не активен" };
  if (reason === "goal_reached" || reason === "user_stop" || reason === "external_block") {
    return { ok: true };
  }
  return {
    ok: false,
    code: "STOP_WITHOUT_REASON",
    message: `цель «${goal}» не достигнута, а остановка без причины`,
    fix: "продолжай: следующий инструмент в этом же ходу",
  };
}

function checkBlindClick(lastReadAt) {
  if (!lastReadAt) {
    return {
      ok: false,
      code: "BLIND_CLICK",
      message: "клик без предшествующего чтения страницы",
      fix: "сначала text/find/snapshot, потом клик",
    };
  }
  const age = Date.now() - new Date(lastReadAt).getTime();
  if (age > 60 * 1000) {
    return {
      ok: false,
      code: "STALE_READ",
      message: `страница читалась ${Math.round(age / 1000)}с назад — дерево устарело`,
      fix: "перечитай страницу перед кликом",
    };
  }
  return { ok: true };
}

function verdict(checks) {
  const blocked = checks.filter((c) => c && c.ok === false);
  if (blocked.length) {
    return {
      verdict: "BLOCK",
      exit: 2,
      blocked,
      text: blocked.map((b) => `[BLOCK ${b.code}] ${b.message}\n  → ${b.fix}`).join("\n"),
    };
  }
  return { verdict: "OK", exit: 0, blocked: [], text: "guard: OK" };
}

function selftest() {
  const missing = requiredFiles().filter((file) => !fs.existsSync(file));
  if (missing.length) {
    process.stderr.write(`FAIL missing ${missing.join(", ")}\n`);
    return 1;
  }
  const must = ["browser_click", "click_kit", "write_file", "run_terminal_cmd", "fs.read", "git.status"];
  for (const name of must) {
    if (!isKnownTool(name)) {
      process.stderr.write(`FAIL known tool rejected: ${name}\n`);
      return 1;
    }
  }
  const invented = ["click_button", "browser_click_js", "playwright_click", "mouse_click", "foo_bar_xyz"];
  for (const name of invented) {
    if (isKnownTool(name)) {
      process.stderr.write(`FAIL invented tool accepted: ${name}\n`);
      return 1;
    }
  }
  const msg = unknownToolMessage("click_button");
  if (!looksLikeFalseDone(msg) || !/UNKNOWN_TOOL/.test(msg)) {
    process.stderr.write("FAIL unknownToolMessage not marked as false-done\n");
    return 1;
  }
  if (looksLikeFalseDone("wrote app.js") || looksLikeFalseDone("клик «Войти» @40,12")) {
    process.stderr.write("FAIL false-done false positive\n");
    return 1;
  }
  if (KNOWN_TOOLS.length < 30) {
    process.stderr.write(`FAIL tool list too short: ${KNOWN_TOOLS.length}\n`);
    return 1;
  }

  const cases = [
    ["unknown command blocked", checkCommand("browser-cdp", "navigate").ok === true],
    ["unknown command caught", checkCommand("browser-cdp", "teleport").ok === false],
    ["done without evidence blocked", checkDoneClaim("готово", null).ok === false],
    ["done with evidence ok", checkDoneClaim("готово", { at: new Date().toISOString() }).ok === true],
    ["stale evidence blocked", checkDoneClaim("готово", { at: new Date(Date.now() - 6e5).toISOString() }).ok === false],
    ["stop without reason blocked", checkStop("цель", {}, null).ok === false],
    ["stop with reason ok", checkStop("цель", {}, "goal_reached").ok === true],
    ["blind click blocked", checkBlindClick(null).ok === false],
    ["fresh read ok", checkBlindClick(new Date().toISOString()).ok === true],
    ["hub guard command known", checkCommand("coder-v2", "guard").ok === true],
    ["hub goal command known", checkCommand("coder-v2", "goal").ok === true],
  ];
  let pass = 0;
  for (const [name, ok] of cases) {
    process.stdout.write(`${ok ? "ok  " : "FAIL"} ${name}\n`);
    if (ok) pass++;
  }
  if (pass !== cases.length) {
    process.stderr.write(`FAIL guard cases ${pass}/${cases.length}\n`);
    return 1;
  }
  process.stdout.write(`guard selftest: ${pass}/${cases.length}\n`);
  process.stdout.write(`guard selftest ok tools=${KNOWN_TOOLS.length}\n`);
  return 0;
}

function main(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd || cmd === "selftest") return selftest();

  const state = loadState();

  if (cmd === "goal") {
    state.goal = rest.join(" ") || null;
    state.startedAt = new Date().toISOString();
    state.steps = [];
    saveState(state);
    console.log(`guard: цель = ${state.goal}`);
    return 0;
  }

  if (cmd === "read") {
    state.lastReadAt = new Date().toISOString();
    saveState(state);
    console.log("guard: страница прочитана");
    return 0;
  }

  if (cmd === "evidence") {
    state.lastEvidence = { at: new Date().toISOString(), text: rest.join(" ").slice(0, 300) };
    saveState(state);
    console.log("guard: доказательство записано");
    return 0;
  }

  if (cmd === "command") {
    const [tool, command] = rest;
    const r = verdict([checkCommand(tool, command)]);
    console.log(r.text);
    return r.exit;
  }

  if (cmd === "done") {
    const r = verdict([checkDoneClaim(rest.join(" "), state.lastEvidence)]);
    console.log(r.text);
    return r.exit;
  }

  if (cmd === "click") {
    const r = verdict([checkBlindClick(state.lastReadAt)]);
    console.log(r.text);
    return r.exit;
  }

  if (cmd === "stop") {
    const r = verdict([checkStop(state.goal, state, rest[0])]);
    console.log(r.text);
    return r.exit;
  }

  if (cmd === "status") {
    console.log(
      JSON.stringify(
        {
          goal: state.goal,
          startedAt: state.startedAt,
          steps: (state.steps || []).length,
          lastReadAt: state.lastReadAt || null,
          lastEvidence: state.lastEvidence || null,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  process.stderr.write(
    "unknown guard command. команды — goal | read | evidence | command | done | click | stop | status | selftest\n",
  );
  return 1;
}

module.exports = {
  KNOWN_TOOLS,
  ALIASES,
  EXTRA_KNOWN,
  KNOWN,
  canonical,
  isKnownTool,
  unknownToolMessage,
  looksLikeFalseDone,
  requiredFiles,
  selftest,
  checkCommand,
  checkDoneClaim,
  checkStop,
  checkBlindClick,
  verdict,
  loadState,
  saveState,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
