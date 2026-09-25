#!/usr/bin/env node
// loop-guard 2.2 — пустой done_when не стоп; no_reason = CONTINUE; state пишется всегда.
// Ноль зависимостей. Windows + POSIX.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const EXIT = { DONE: 0, BLOCKED: 1, CONTINUE: 2, WATCHDOG_EXHAUSTED: 75 };

const DEFAULT_CFG = {
  stop_words: ['стоп', 'остановись', 'хватит', 'stop', 'cancel'],
  plan_phrases: ['сделаю позже', 'дальше можно', 'потом сделаю', 'на этом всё', 'пока всё'],
  done_phrases: ['цель достигнута', 'задача закрыта'],
  external_deny: ['DENIED', 'HUMAN CHECK', 'EACCES'],
  on_unjustified: 'continue',
  max_loops: 256,
  max_restarts: 3,
  heartbeat_stale_ms: 300000,
  hmac_env: 'LOOP_GUARD_HMAC',
  restart_command: null,
  restart_args: [],
};

export function unjustifiedAction(cfg = DEFAULT_CFG) {
  return String(cfg.on_unjustified || 'continue').toLowerCase() === 'restart' ? 'RESTART' : 'CONTINUE';
}

export function hasDoneCriteria(state = {}) {
  return (state.done_when || []).some((x) => String(x || '').trim());
}

export function isFollowUpText(text, prevGoal = '') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!t) return true;
  if (!String(prevGoal || '').trim()) return false;
  if (significantPrefix(prevGoal) === significantPrefix(t)) return true;
  if (t.length <= 16) return true;
  if (/[?]/.test(t) && t.length <= 160) return true;
  if (/^(что|как|почему|зачем|кто|где|чё|че так|а что|ну что)\b/i.test(t)) return true;
  if (/(завис|долго|молч|опять встал|не процесс)/i.test(t)) return true;
  return false;
}

/** no_reason / пустой критерий никогда не рестартят, даже если on_unjustified=restart. */
export function actionForReason(reason, cfg = DEFAULT_CFG) {
  const r = String(reason || '');
  if (r === 'no_reason' || r === 'open_goal' || r === 'restart_limit_continue') return 'CONTINUE';
  if (r === 'process_died') return 'RESTART';
  if (r === 'user_stop' || r === 'external_deny') return 'STOP';
  if (r === 'max_loops') return 'BLOCKED';
  return unjustifiedAction(cfg);
}

export function hadToolWork(state = {}, event = {}) {
  const receipts = event.receipts || [];
  return Boolean(
    event.stateChanged ||
    state.state_changed ||
    (state.receipts_this_turn || 0) > 0 ||
    receipts.length > 0,
  );
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function resolveRestart(cfg, dir = __dirname) {
  const next = { ...cfg };
  const raw = String(next.restart_command || '').trim().toLowerCase();
  const resume = path.join(dir, 'resume-goal.mjs');
  if (!raw || raw === 'null' || raw === 'auto') {
    if (fs.existsSync(resume)) {
      next.restart_command = process.execPath;
      next.restart_args = [resume, `--dir=${dir}`];
    }
  }
  return next;
}

export function loadConfig(dir = __dirname) {
  const raw = loadJson(path.join(dir, 'loop-guard.json'), {});
  return resolveRestart({ ...DEFAULT_CFG, ...raw }, dir);
}

export function emptyState(cfg = DEFAULT_CFG) {
  return {
    goal: '',
    done_when: [],
    verified: [],
    loops: 0,
    max_loops: cfg.max_loops ?? 256,
    verdict: 'CONTINUE',
    reason: 'start',
    stop_reason: null,
    restarts: 0,
    max_restarts: cfg.max_restarts ?? 3,
    last_heartbeat: null,
    pid: null,
    last_user: '',
    last_assistant: '',
    receipts_this_turn: 0,
    state_changed: false,
    last_unjustified: null,
  };
}

function norm(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export function isUserStop(text, cfg = DEFAULT_CFG) {
  const t = norm(text);
  if (!t) return false;
  return (cfg.stop_words || DEFAULT_CFG.stop_words).some((w) => {
    const n = norm(w);
    return t === n || t.startsWith(n + ' ') || t.endsWith(' ' + n) || t.includes(' ' + n + ' ');
  });
}

export function isPlanLanguage(text, cfg = DEFAULT_CFG) {
  const t = norm(text);
  return (cfg.plan_phrases || DEFAULT_CFG.plan_phrases).some((p) => t.includes(norm(p)));
}

export function isDoneClaim(text, cfg = DEFAULT_CFG) {
  const t = norm(text);
  if (!t) return false;
  return (cfg.done_phrases || DEFAULT_CFG.done_phrases).some((p) => {
    const n = norm(p);
    return t === n || t.startsWith(n) || t.includes(' ' + n);
  });
}

export function isExternalDeny(text, cfg = DEFAULT_CFG) {
  const t = String(text || '');
  return (cfg.external_deny || DEFAULT_CFG.external_deny).some((p) => t.includes(p));
}

export function goalVerified(state) {
  if (!hasDoneCriteria(state)) return false;
  const need = (state.done_when || []).filter((x) => String(x || '').trim());
  const have = new Set(state.verified || []);
  return need.every((x) => have.has(x));
}

export function heartbeatStale(state, now, staleMs) {
  if (!state.last_heartbeat) return true;
  return now - Date.parse(state.last_heartbeat) > staleMs;
}

function hasUnrecoveredError(receipts) {
  const list = receipts || [];
  const errors = list.filter((r) => r && r.error);
  if (!errors.length) return false;
  const recovered = list.some((r) => r && !r.error && r.recovers);
  return !recovered;
}

/**
 * Классификатор стопа.
 * event: {
 *   type: 'tick'|'stop-attempt'|'process-check',
 *   userText, assistantText, observation,
 *   processAlive, now, receipts, stateChanged
 * }
 */
export function classifyStop(state, event = {}, cfg = DEFAULT_CFG) {
  const now = event.now || Date.now();
  const receipts = event.receipts || [];
  const staleMs = cfg.heartbeat_stale_ms ?? 300000;
  const soft = (reason) => actionForReason(reason, cfg);

  if (isUserStop(event.userText, cfg)) {
    return { justified: true, reason: 'user_stop', action: 'STOP', verdict: 'DONE' };
  }
  if (isExternalDeny(event.observation, cfg) || isExternalDeny(event.assistantText, cfg)) {
    return { justified: true, reason: 'external_deny', action: 'STOP', verdict: 'DONE' };
  }
  if ((state.loops || 0) >= (state.max_loops || cfg.max_loops || 256)) {
    return { justified: true, reason: 'max_loops', action: 'BLOCKED', verdict: 'BLOCKED' };
  }
  if (goalVerified(state) && !hasUnrecoveredError(receipts) && !isPlanLanguage(event.assistantText, cfg)) {
    return { justified: false, reason: 'goal_reached_keep_going', action: 'CONTINUE', verdict: 'CONTINUE' };
  }

  if (state.verdict === 'DONE' && !goalVerified(state)) {
    return { justified: false, reason: 'stale_done', action: soft('stale_done'), verdict: 'CONTINUE' };
  }
  if (event.processAlive === false && !goalVerified(state)) {
    return { justified: false, reason: 'process_died', action: 'RESTART', verdict: 'CONTINUE' };
  }
  if (event.type === 'process-check' && heartbeatStale(state, now, staleMs) && !goalVerified(state)) {
    if (event.processAlive === false) {
      return { justified: false, reason: 'process_died', action: 'RESTART', verdict: 'CONTINUE' };
    }
    return { justified: false, reason: 'stale_heartbeat', action: soft('stale_heartbeat'), verdict: 'CONTINUE' };
  }
  if (isPlanLanguage(event.assistantText, cfg)) {
    return { justified: false, reason: 'plan_language', action: soft('plan_language'), verdict: 'CONTINUE' };
  }
  if (isDoneClaim(event.assistantText, cfg) && receipts.length === 0 && (state.receipts_this_turn || 0) === 0 && !hadToolWork(state, event)) {
    return { justified: false, reason: 'done_without_evidence', action: soft('done_without_evidence'), verdict: 'CONTINUE' };
  }
  if (isDoneClaim(event.assistantText, cfg) && hasUnrecoveredError(receipts)) {
    return { justified: false, reason: 'lie_about_tools', action: soft('lie_about_tools'), verdict: 'CONTINUE' };
  }
  if (isDoneClaim(event.assistantText, cfg) && event.stateChanged === false && !state.state_changed) {
    if (hadToolWork(state, event)) {
      return { justified: false, reason: 'in_progress', action: 'CONTINUE', verdict: 'CONTINUE' };
    }
    return { justified: false, reason: 'no_state_change', action: soft('no_state_change'), verdict: 'CONTINUE' };
  }
  if (event.type === 'stop-attempt' && !hasDoneCriteria(state)) {
    return { justified: false, reason: 'open_goal', action: 'CONTINUE', verdict: 'CONTINUE' };
  }
  if (event.type === 'stop-attempt' && !goalVerified(state)) {
    return { justified: false, reason: 'no_reason', action: 'CONTINUE', verdict: 'CONTINUE' };
  }

  return { justified: false, reason: 'in_progress', action: 'CONTINUE', verdict: 'CONTINUE' };
}

export function applyClassification(state, cls, cfg = DEFAULT_CFG) {
  const next = { ...state };
  if (cls.justified) {
    next.verdict = cls.verdict;
    next.reason = cls.reason;
    next.stop_reason = cls.reason;
    next.last_unjustified = null;
    return next;
  }
  if (cls.action === 'CONTINUE') {
    next.verdict = 'CONTINUE';
    next.reason = cls.reason;
    next.stop_reason = null;
    if (cls.reason && cls.reason !== 'in_progress') next.last_unjustified = cls.reason;
    return next;
  }
  const maxR = next.max_restarts ?? cfg.max_restarts ?? 3;
  if ((next.restarts || 0) >= maxR) {
    next.verdict = 'CONTINUE';
    next.reason = 'restart_limit_continue';
    next.stop_reason = null;
    next.last_unjustified = cls.reason;
    return next;
  }
  next.restarts = (next.restarts || 0) + 1;
  next.verdict = 'CONTINUE';
  next.reason = 'unjustified-stop: ' + cls.reason;
  next.stop_reason = null;
  next.last_unjustified = cls.reason;
  return next;
}

export function hmacSecret(cfg = DEFAULT_CFG) {
  return process.env[cfg.hmac_env || 'LOOP_GUARD_HMAC'] || 'loop-guard-local';
}

export function makeReceipt(tool, result, error, cfg = DEFAULT_CFG) {
  const payload = {
    id: crypto.randomBytes(8).toString('hex'),
    t: new Date().toISOString(),
    tool: String(tool || ''),
    result: String(result || '').slice(0, 2000),
    error: error ? String(error).slice(0, 500) : null,
  };
  const body = JSON.stringify({ tool: payload.tool, result: payload.result, error: payload.error, t: payload.t });
  payload.hash = crypto.createHash('sha256').update(body).digest('hex');
  payload.hmac = crypto.createHmac('sha256', hmacSecret(cfg)).update(payload.hash).digest('hex');
  return payload;
}

export function verifyReceipt(receipt, cfg = DEFAULT_CFG) {
  if (!receipt || !receipt.hash || !receipt.hmac) return { verdict: 'UNVERIFIED', reason: 'missing-signature' };
  const body = JSON.stringify({
    tool: receipt.tool,
    result: receipt.result,
    error: receipt.error,
    t: receipt.t,
  });
  const hash = crypto.createHash('sha256').update(body).digest('hex');
  if (hash !== receipt.hash) return { verdict: 'TAMPERED', reason: 'hash-mismatch' };
  const hmac = crypto.createHmac('sha256', hmacSecret(cfg)).update(receipt.hash).digest('hex');
  if (hmac !== receipt.hmac) return { verdict: 'TAMPERED', reason: 'hmac-mismatch' };
  return { verdict: 'VERIFIED', reason: 'ok' };
}

export function verifyClaim(claimTool, receipts) {
  const list = receipts || [];
  const hit = list.find((r) => r.tool === claimTool);
  if (!hit) return { verdict: 'UNVERIFIED', reason: 'no-receipt-for-tool' };
  const sig = verifyReceipt(hit);
  if (sig.verdict !== 'VERIFIED') return sig;
  return { verdict: 'VERIFIED', reason: 'receipt-matches', receipt: hit };
}

export function runRestartCommand(cfg = DEFAULT_CFG, { detached = false, cwd = ROOT } = {}) {
  if (!cfg.restart_command) return { ran: false };
  const args = Array.isArray(cfg.restart_args) ? cfg.restart_args : [];
  if (detached) {
    const child = spawn(cfg.restart_command, args, {
      detached: true,
      stdio: 'ignore',
      cwd,
      env: process.env,
    });
    child.unref();
    return { ran: true, pid: child.pid };
  }
  const r = spawnSync(cfg.restart_command, args, {
    encoding: 'utf8',
    timeout: 20000,
    cwd,
    env: process.env,
  });
  return { ran: true, status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function paths(dir) {
  return {
    state: path.join(dir, 'loop-guard.state.json'),
    heartbeat: path.join(dir, 'loop-guard.heartbeat'),
    receipts: path.join(dir, 'receipts.jsonl'),
    log: path.join(dir, 'LOOPS.md'),
  };
}

function readState(dir, cfg) {
  const p = paths(dir).state;
  const s = loadJson(p, null);
  return s || emptyState(cfg);
}

function writeState(dir, state) {
  const file = paths(dir).state;
  const body = JSON.stringify(state, null, 2);
  const tmp = file + '.tmp';
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(tmp, body, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, body, 'utf8');
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export function sanitizeLogText(text) {
  return String(text || '')
    .replace(/pat\uFFFD+h/gi, 'path')
    .replace(/zamen\uFFFD+/gi, 'замена')
    .replace(/\uFFFD+/g, '');
}

function appendLog(dir, line) {
  const p = paths(dir).log;
  let prev = '';
  try {
    prev = fs.readFileSync(p, { encoding: 'utf8' });
  } catch {
    prev = '';
  }
  const next = sanitizeLogText(`${prev}${line}\n`);
  fs.writeFileSync(p, next, { encoding: 'utf8' });
}

function writeRestartTicket(dir, cls, state) {
  const ticket = {
    t: new Date().toISOString(),
    reason: cls.reason,
    action: 'RESTART',
    goal: state.goal || '',
    restarts: state.restarts || 0,
    verdict: state.verdict,
  };
  fs.writeFileSync(path.join(dir, 'restart.ticket.json'), JSON.stringify(ticket, null, 2), 'utf8');
}

function readReceipts(dir) {
  const p = paths(dir).receipts;
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8')
    .split(/\n/)
    .filter(Boolean)
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter(Boolean);
}

function printStatus(state) {
  console.log('VERDICT=' + state.verdict);
  console.log('REASON=' + (state.reason || ''));
  console.log('LOOPS=' + (state.loops || 0) + '/' + (state.max_loops || 256));
  console.log('GOAL=' + (state.goal || ''));
  if (state.last_unjustified) console.log('UNJUSTIFIED=' + state.last_unjustified);
  if (state.restarts) console.log('RESTARTS=' + state.restarts + '/' + (state.max_restarts || 3));
}

const REST_KEYS = new Set(['goal', 'assistant', 'user', 'observation', 'text']);

function argVal(args, name) {
  const p = '--' + name + '=';
  const i = args.findIndex((a) => a.startsWith(p) || a === '--' + name);
  if (i < 0) return undefined;
  const first = args[i].startsWith(p) ? args[i].slice(p.length) : (args[i + 1] && !String(args[i + 1]).startsWith('--') ? args[i + 1] : '');
  if (!REST_KEYS.has(name)) return first;
  const start = args[i].startsWith(p) ? i + 1 : i + 2;
  const extra = [];
  for (let j = start; j < args.length; j += 1) {
    if (String(args[j]).startsWith('--')) break;
    extra.push(args[j]);
  }
  return [first, ...extra].filter((x) => x !== undefined && x !== '').join(' ');
}

function flag(args, name) {
  return args.includes('--' + name);
}

export function beginGoal(state, goal, doneWhen) {
  const incoming = (doneWhen || []).filter(Boolean);
  const prevGoal = String(state.goal || '').trim();
  const nextGoal = String(goal || '').trim();
  const follow = Boolean(prevGoal && isFollowUpText(nextGoal, prevGoal));
  if (follow) {
    const next = { ...state };
    if (incoming.length) next.done_when = incoming;
    next.verdict = 'CONTINUE';
    next.reason = 'follow-up';
    next.stop_reason = null;
    next.last_heartbeat = new Date().toISOString();
    next.pid = process.pid;
    next.last_user = nextGoal || next.last_user;
    return next;
  }
  const next = emptyState({ max_loops: state.max_loops, max_restarts: state.max_restarts });
  next.goal = nextGoal;
  next.done_when = incoming;
  next.verdict = 'CONTINUE';
  next.reason = 'start';
  next.last_heartbeat = new Date().toISOString();
  next.pid = process.pid;
  next.last_user = nextGoal;
  return next;
}

function significantPrefix(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, 40).toLowerCase();
}

function resetStaleBrain(dir, goal) {
  const file = path.join(dir, 'goal-brain.state.json');
  try {
    if (!fs.existsSync(file)) return;
    const prev = loadJson(file, null);
    const old = significantPrefix(prev && prev.goal);
    const next = significantPrefix(goal);
    if (!old || (next && old !== next)) fs.unlinkSync(file);
  } catch {
    /* reset best-effort */
  }
}

function cmdBegin(dir, cfg, args) {
  const goal = argVal(args, 'goal') || '';
  const state = beginGoal(readState(dir, cfg), goal, String(argVal(args, 'done-when') || '').split('|'));
  resetStaleBrain(dir, goal);
  writeState(dir, state);
  printStatus(state);
}

function cmdHeartbeat(dir, cfg, args = []) {
  const state = readState(dir, cfg);
  state.last_heartbeat = new Date().toISOString();
  const pidArg = Number(argVal(args, 'pid') || process.env.FEDOR_AGENT_PID || '');
  state.pid = pidArg || process.ppid || process.pid;
  writeState(dir, state);
  fs.writeFileSync(paths(dir).heartbeat, JSON.stringify({ t: state.last_heartbeat, pid: state.pid }), 'utf8');
  console.log('HEARTBEAT=' + state.last_heartbeat);
}

function cmdReceipt(dir, cfg, args) {
  const rec = makeReceipt(argVal(args, 'tool') || 'tool', argVal(args, 'result') || '', argVal(args, 'error') || null, cfg);
  fs.appendFileSync(paths(dir).receipts, JSON.stringify(rec) + '\n', 'utf8');
  const state = readState(dir, cfg);
  state.receipts_this_turn = (state.receipts_this_turn || 0) + 1;
  if (!rec.error) state.state_changed = true;
  writeState(dir, state);
  console.log('RECEIPT=' + rec.id);
  console.log('HASH=' + rec.hash);
}

function cmdVerify(dir, cfg, args) {
  const tool = argVal(args, 'tool') || '';
  const out = verifyClaim(tool, readReceipts(dir));
  console.log('CLAIM=' + tool);
  console.log('VERDICT=' + out.verdict);
  console.log('REASON=' + out.reason);
}

function cmdClassify(dir, cfg, args) {
  const state = readState(dir, cfg);
  const event = {
    type: argVal(args, 'type') || 'stop-attempt',
    userText: argVal(args, 'user') || state.last_user,
    assistantText: argVal(args, 'assistant') || state.last_assistant,
    observation: argVal(args, 'observation') || '',
    processAlive: argVal(args, 'alive') === undefined ? true : argVal(args, 'alive') !== '0',
    now: Date.now(),
    receipts: readReceipts(dir),
    stateChanged: state.state_changed,
  };
  const cls = classifyStop(state, event, cfg);
  const next = applyClassification(state, cls, cfg);
  next.loops = (Number(state.loops) || 0) + 1;
  next.last_assistant = event.assistantText || next.last_assistant;
  next.last_user = event.userText || next.last_user;
  writeState(dir, next);
  printStatus(next);
  console.log('JUSTIFIED=' + (cls.justified ? 'yes' : 'no'));
  console.log('ACTION=' + cls.action);
  appendLog(dir, '- classify ' + cls.reason + ' action=' + cls.action + ' loops=' + next.loops + ' restarts=' + (next.restarts || 0));
  if (cls.action === 'RESTART' && next.verdict === 'CONTINUE' && cls.reason === 'process_died') {
    writeRestartTicket(dir, cls, next);
    const run = runRestartCommand(cfg, { detached: flag(args, 'detach'), cwd: ROOT });
    if (run.ran) console.log('RESTARTED=' + (run.pid || run.status));
    else console.log('RESTARTED=ticket');
    appendLog(dir, '- unjustified ' + cls.reason + ' -> RESTART #' + next.restarts);
  }
}

function cmdOnUser(dir, cfg, args) {
  const text = args.filter((a) => !a.startsWith('--')).join(' ') || argVal(args, 'text') || '';
  let state = readState(dir, cfg);
  state.last_user = text;
  if (isUserStop(text, cfg)) {
    state = applyClassification(state, classifyStop(state, { userText: text }, cfg), cfg);
  } else if (state.verdict === 'DONE' && !goalVerified(state)) {
    state.verdict = 'CONTINUE';
    state.reason = 'new-user-message';
    state.stop_reason = null;
  } else if (state.verdict === 'DONE' && text && text !== state.goal) {
    state = beginGoal(state, text, state.done_when);
    state.reason = 'new-goal-from-user';
  }
  writeState(dir, state);
  printStatus(state);
}

function cmdVerifyCriterion(dir, cfg, args) {
  const name = argVal(args, 'name') || args.find((a) => !a.startsWith('--')) || '';
  const state = readState(dir, cfg);
  if (name && (state.done_when || []).includes(name) && !(state.verified || []).includes(name)) {
    state.verified = [...(state.verified || []), name];
  }
  if (goalVerified(state)) {
    state.verdict = 'DONE';
    state.reason = 'goal_verified';
    state.stop_reason = 'goal_verified';
    state.last_unjustified = null;
  }
  writeState(dir, state);
  printStatus(state);
}

function cmdTick(dir, cfg) {
  const state = readState(dir, cfg);
  state.loops = (state.loops || 0) + 1;
  state.last_heartbeat = new Date().toISOString();
  state.receipts_this_turn = 0;
  state.state_changed = false;
  const cls = classifyStop(state, { type: 'tick', now: Date.now() }, cfg);
  const next = applyClassification(state, cls, cfg);
  writeState(dir, next);
  printStatus(next);
}

function cmdStatus(dir, cfg) {
  printStatus(readState(dir, cfg));
}

function cmdReset(dir, cfg) {
  const p = paths(dir);
  for (const f of [p.state, p.heartbeat, p.receipts, path.join(dir, 'restart.ticket.json'), path.join(dir, 'goal-brain.state.json')]) {
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      /* reset best-effort */
    }
  }
  writeState(dir, emptyState(cfg));
  console.log('RESET ok');
}

function cmdLog(dir, cfg, args) {
  const text = args.filter((a) => !a.startsWith('--')).join(' ') || argVal(args, 'text') || '';
  appendLog(dir, text);
  console.log('LOG=' + paths(dir).log);
}

function readGoalFile(dir) {
  try {
    return fs.readFileSync(path.join(dir, 'goal.txt'), 'utf8').trim();
  } catch {
    return '';
  }
}

function findGoalBrain(dir) {
  const candidates = [
    path.join(dir, 'goal-brain.mjs'),
    path.join(__dirname, 'goal-brain.mjs'),
    path.join(ROOT, 'aa-coder-fedor', 'coder-v2', 'src', 'agent', 'goal-brain.mjs'),
  ];
  return candidates.find((p) => fs.existsSync(p)) || '';
}

/** Вызов сторожа цели С текстом текущей задачи. Без --task баг 1 не работает. */
export function autoGoalVerdict(dir) {
  const state = readState(dir, loadConfig(dir));
  const task = String(state.goal || readGoalFile(dir) || process.env.FEDOR_GOAL || '').trim();
  const brain = findGoalBrain(dir);
  const statePath = path.join(dir, 'goal-brain.state.json');
  if (!brain) {
    return { out: 'CONTINUE no goal-brain', verdict: 'CONTINUE', stale: false, task };
  }
  const args = ['check', '--state', statePath, '--task', task];
  const proc = spawnSync(process.execPath, [brain, ...args], {
    encoding: 'utf8',
    timeout: 8000,
    windowsHide: true,
  });
  const out = `${proc.stdout || ''}${proc.stderr || ''}`.trim();
  const verdict = ((out.match(/^VERDICT=(\w+)/m) || [])[1] || 'CONTINUE').toUpperCase();
  const stale = /^STALE=1/m.test(out);
  return { out, verdict, stale, task, status: proc.status };
}

function cmdEnforce(dir, cfg) {
  const brain = autoGoalVerdict(dir);
  if (brain.stale || (brain.verdict === 'CONTINUE' && /STALE=1/.test(brain.out))) {
    console.log(brain.out);
    console.log('ACTION=НЕ ОСТАНАВЛИВАТЬСЯ: сделай следующий ход.');
    process.exit(EXIT.CONTINUE);
  }
  const state = readState(dir, cfg);
  const cls = classifyStop(state, {
    type: 'stop-attempt',
    userText: state.last_user,
    assistantText: state.last_assistant,
    processAlive: true,
    now: Date.now(),
    receipts: readReceipts(dir),
    stateChanged: state.state_changed,
  }, cfg);
  const next = applyClassification(state, cls, cfg);
  next.loops = (Number(state.loops) || 0) + 1;
  writeState(dir, next);
  printStatus(next);
  appendLog(dir, '- enforce ' + cls.reason + ' action=' + cls.action + ' loops=' + next.loops + ' restarts=' + (next.restarts || 0));
  if (next.verdict === 'CONTINUE') {
    if (cls.action === 'RESTART' && cls.reason === 'process_died') {
      writeRestartTicket(dir, cls, next);
      const run = runRestartCommand(cfg, { detached: true, cwd: ROOT });
      console.log('RESTARTED=' + (run.ran ? (run.pid || 'ok') : 'ticket'));
      appendLog(dir, '- enforce ' + cls.reason + ' -> RESTART #' + next.restarts);
    }
    console.log('ACTION=' + (cls.action === 'RESTART' && cls.reason === 'process_died' ? 'RESTART' : 'НЕ ОСТАНАВЛИВАТЬСЯ'));
    process.exit(EXIT.CONTINUE);
  }
  if (next.verdict === 'BLOCKED') {
    console.log('ACTION=остановка: BLOCKED');
    process.exitCode = EXIT.BLOCKED;
    return;
  }
  console.log('ACTION=остановка разрешена.');
  process.exitCode = EXIT.DONE;
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

function cmdWatchdog(dir, cfg, args) {
  const state = readState(dir, cfg);
  const alive = processAlive(state.pid);
  const cls = classifyStop(state, {
    type: 'process-check',
    processAlive: alive,
    now: Date.now(),
    receipts: readReceipts(dir),
    assistantText: state.last_assistant,
    userText: state.last_user,
  }, cfg);
  const next = applyClassification(state, cls, cfg);
  writeState(dir, next);
  printStatus(next);
  appendLog(dir, '- watchdog ' + cls.reason + ' action=' + cls.action + ' loops=' + (next.loops || 0) + ' restarts=' + (next.restarts || 0));
  console.log('ALIVE=' + (alive ? '1' : '0'));
  console.log('ACTION=' + (next.reason === 'restart_limit_continue' ? 'CONTINUE' : cls.action));
  if (next.reason === 'restart_limit_continue') {
    process.exitCode = EXIT.CONTINUE;
    return;
  }
  if (cls.action === 'RESTART' && next.verdict === 'CONTINUE' && cls.reason === 'process_died') {
    writeRestartTicket(dir, cls, next);
    const run = runRestartCommand(cfg, { detached: !flag(args, 'sync'), cwd: ROOT });
    console.log('RESTARTED=' + (run.ran ? (run.pid || run.status) : 'ticket'));
    appendLog(dir, '- watchdog ' + cls.reason + ' -> RESTART #' + next.restarts);
    process.exitCode = EXIT.CONTINUE;
    return;
  }
  process.exitCode = next.verdict === 'DONE' ? EXIT.DONE : EXIT.CONTINUE;
}

function ok(name, cond) {
  if (!cond) {
    console.log('FAIL ' + name);
    return false;
  }
  console.log('ok   ' + name);
  return true;
}

function selftest() {
  const cfg = { ...DEFAULT_CFG, heartbeat_stale_ms: 1000, max_restarts: 3, max_loops: 3 };
  let pass = true;

  let s = emptyState(cfg);
  s.goal = 'x';
  s.done_when = ['a'];
  let c = classifyStop(s, { type: 'tick' }, cfg);
  pass &= ok('старт -> CONTINUE', c.verdict === 'CONTINUE' && c.reason === 'in_progress');

  s.loops = 2;
  c = classifyStop(s, { type: 'tick' }, cfg);
  pass &= ok('ход 2 -> CONTINUE', c.verdict === 'CONTINUE');

  s.loops = 3;
  c = classifyStop(s, { type: 'tick' }, cfg);
  pass &= ok('лимит -> BLOCKED', c.justified && c.verdict === 'BLOCKED' && c.reason === 'max_loops');

  s = emptyState(cfg);
  s.done_when = ['a', 'b'];
  s.verified = ['a', 'b'];
  c = classifyStop(s, { type: 'stop-attempt' }, cfg);
  pass &= ok('цель достигнута -> CONTINUE', !c.justified && c.verdict === 'CONTINUE' && c.reason === 'goal_reached_keep_going');

  pass &= ok('стоп пользователя', isUserStop('остановись', cfg));
  pass &= ok('распознан стоп', isUserStop('stop please', cfg));
  pass &= ok('обычный текст не стоп', !isUserStop('продолжай работу', cfg));

  s = emptyState(cfg);
  s.goal = 'не процесы а имено ты опять завис';
  c = classifyStop(s, { type: 'stop-attempt', assistantText: 'скажи чини' }, cfg);
  pass &= ok('пустой done_when не no_reason', c.reason === 'open_goal' && c.action === 'CONTINUE' && c.verdict === 'CONTINUE');
  const restartCfg = { ...cfg, on_unjustified: 'restart' };
  c = classifyStop(s, { type: 'stop-attempt', assistantText: 'скажи чини' }, restartCfg);
  pass &= ok('пустой done_when даже при restart', c.action === 'CONTINUE' && c.reason === 'open_goal');

  s = emptyState(cfg);
  s.goal = 'сервис карт';
  s.done_when = ['qr'];
  c = classifyStop(s, { type: 'stop-attempt', assistantText: '' }, cfg);
  const a1 = applyClassification(s, c, cfg);
  pass &= ok('внезапная остановка -> CONTINUE', !c.justified && c.reason === 'no_reason' && c.action === 'CONTINUE' && a1.verdict === 'CONTINUE' && (a1.restarts || 0) === 0);
  c = classifyStop(s, { type: 'stop-attempt' }, restartCfg);
  pass &= ok('no_reason не рестартит', c.reason === 'no_reason' && c.action === 'CONTINUE');

  c = classifyStop(s, { type: 'stop-attempt', assistantText: 'готово, смотри отчёт' }, cfg);
  pass &= ok('обычное готово не стоп', c.action === 'CONTINUE' && c.reason !== 'done_without_evidence');

  c = classifyStop(s, { type: 'stop-attempt', assistantText: 'цель достигнута' }, cfg);
  pass &= ok('цель достигнута без доказательств -> CONTINUE', !c.justified && c.reason === 'done_without_evidence' && c.action === 'CONTINUE');

  c = classifyStop(s, { type: 'stop-attempt', userText: 'стоп' }, cfg);
  pass &= ok('стоп пользователя не рестартит', c.justified && c.reason === 'user_stop');

  s.last_heartbeat = new Date(Date.now() - 5000).toISOString();
  c = classifyStop(s, { type: 'process-check', processAlive: true, now: Date.now() }, cfg);
  pass &= ok('heartbeat протух у живого -> CONTINUE', !c.justified && c.reason === 'stale_heartbeat' && c.action === 'CONTINUE');

  c = classifyStop(s, { type: 'process-check', processAlive: false, now: Date.now() }, cfg);
  pass &= ok('процесс умер -> RESTART', !c.justified && c.reason === 'process_died' && c.action === 'RESTART');

  const bad = [makeReceipt('pay', '', 'ECONNREFUSED', cfg)];
  c = classifyStop(s, { type: 'stop-attempt', assistantText: 'цель достигнута', receipts: bad }, cfg);
  pass &= ok('ложь про инструмент -> CONTINUE', !c.justified && c.reason === 'lie_about_tools' && c.action === 'CONTINUE');

  let lim = emptyState(cfg);
  lim.done_when = ['x'];
  lim.restarts = 3;
  c = classifyStop(lim, { type: 'process-check', processAlive: false }, cfg);
  const a2 = applyClassification(lim, c, cfg);
  pass &= ok('лимит рестартов не глушит', a2.verdict === 'CONTINUE' && a2.reason === 'restart_limit_continue');

  let stale = emptyState(cfg);
  stale.verdict = 'DONE';
  stale.reason = 'old goal';
  stale.done_when = ['z'];
  c = classifyStop(stale, { type: 'tick' }, cfg);
  pass &= ok('старый DONE без критериев -> CONTINUE', !c.justified && c.reason === 'stale_done' && c.action === 'CONTINUE');

  pass &= ok('DENIED обоснован', classifyStop(s, { observation: 'DENIED cwd=...' }, cfg).reason === 'external_deny');
  pass &= ok('заголовок план: не стоп', classifyStop(s, { assistantText: 'план: открою файл и поправлю тест' }, cfg).reason !== 'plan_language');
  pass &= ok('сделаю позже -> CONTINUE', classifyStop(s, { assistantText: 'сделаю позже' }, cfg).reason === 'plan_language' && classifyStop(s, { assistantText: 'сделаю позже' }, cfg).action === 'CONTINUE');

  const withTool = emptyState(cfg);
  withTool.receipts_this_turn = 1;
  withTool.state_changed = true;
  c = classifyStop(withTool, { type: 'stop-attempt', assistantText: 'цель достигнута', stateChanged: true, receipts: [makeReceipt('write', 'ok', null, cfg)] }, cfg);
  pass &= ok('ход с инструментом не no_state_change', c.reason !== 'no_state_change');

  pass &= ok('вопрос это follow-up', isFollowUpText('ты опять завис', 'почини оплату'));
  pass &= ok('новая задача не follow-up', !isFollowUpText('новая задача: оплата картой', 'вчерашняя цель про клик'));

  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-persist-'));
  try {
    const started = beginGoal({ ...emptyState({ max_loops: 256, max_restarts: 3 }), loops: 5, restarts: 2, goal: 'почини оплату' }, 'не процесы а имено ты опять завис', []);
    pass &= ok('begin на вопросе хранит счётчики', started.loops === 5 && started.restarts === 2 && started.reason === 'follow-up');
    writeState(persistDir, started);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'classify', '--type=stop-attempt', '--assistant=скажи чини', `--dir=${persistDir}`], {
      cwd: persistDir,
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    const after = JSON.parse(fs.readFileSync(path.join(persistDir, 'loop-guard.state.json'), 'utf8'));
    const log = fs.existsSync(path.join(persistDir, 'LOOPS.md')) ? fs.readFileSync(path.join(persistDir, 'LOOPS.md'), 'utf8') : '';
    pass &= ok('classify пишет loops в state', after.loops === 6 && after.restarts === 2);
    pass &= ok('classify не рестартит вопрос', /ACTION=CONTINUE/.test(child.stdout || '') && !/RESTARTED=/.test(child.stdout || ''));
    pass &= ok('LOOPS.md и state вместе', /loops=6/.test(log) && after.loops === 6);
  } finally {
    fs.rmSync(persistDir, { recursive: true, force: true });
  }

  const rec = makeReceipt('curl', 'HEALTH ok', null, cfg);
  const v1 = verifyReceipt(rec, cfg);
  pass &= ok('квитанция VERIFIED', v1.verdict === 'VERIFIED');
  const v2 = verifyClaim('curl', [rec]);
  pass &= ok('заявленный инструмент есть', v2.verdict === 'VERIFIED');
  const v3 = verifyClaim('выдуманный', [rec]);
  pass &= ok('выдуманный инструмент UNVERIFIED', v3.verdict === 'UNVERIFIED');
  const tampered = { ...rec, result: 'подделка' };
  pass &= ok('подделка TAMPERED', verifyReceipt(tampered, cfg).verdict === 'TAMPERED');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-'));
  const marker = path.join(tmp, 'restarted.txt');
  try {
    const rcfg = {
      ...cfg,
      restart_command: process.execPath,
      restart_args: ['-e', "require('fs').writeFileSync(process.env.LG_MARK,'ok')"],
    };
    const prev = process.env.LG_MARK;
    process.env.LG_MARK = marker;
    const run = runRestartCommand(rcfg, { detached: false, cwd: tmp });
    if (prev === undefined) delete process.env.LG_MARK;
    else process.env.LG_MARK = prev;
    pass &= ok('watchdog рестарт процесса', run.ran && fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === 'ok');

    const resumeSrc = path.join(__dirname, 'resume-goal.mjs');
    if (fs.existsSync(resumeSrc)) {
      fs.copyFileSync(resumeSrc, path.join(tmp, 'resume-goal.mjs'));
      fs.writeFileSync(path.join(tmp, 'loop-guard.json'), JSON.stringify({ restart_command: 'auto' }), 'utf8');
      const auto = loadConfig(tmp);
      pass &= ok('auto restart_command задан', auto.restart_command === process.execPath && /resume-goal\.mjs/.test(String(auto.restart_args[0] || '')));
      fs.writeFileSync(
        path.join(tmp, 'loop-guard.state.json'),
        JSON.stringify({ ...emptyState(cfg), goal: 'поднять оплату', last_user: '', last_assistant: 'готово' }),
        'utf8',
      );
      const prevLaunch = process.env.LOOP_GUARD_NO_LAUNCH;
      process.env.LOOP_GUARD_NO_LAUNCH = '1';
      const resumed = runRestartCommand(auto, { detached: false, cwd: tmp });
      if (prevLaunch === undefined) delete process.env.LOOP_GUARD_NO_LAUNCH;
      else process.env.LOOP_GUARD_NO_LAUNCH = prevLaunch;
      const nudgeFile = path.join(tmp, 'resume.nudge.json');
      pass &= ok(
        'resume-goal пишет nudge',
        resumed.ran && fs.existsSync(nudgeFile) && /оплату/.test(fs.readFileSync(nudgeFile, 'utf8')),
      );
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  const tmpStale = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-stale-'));
  try {
    fs.writeFileSync(
      path.join(tmpStale, 'goal-brain.state.json'),
      JSON.stringify({
        goal: 'вчерашняя цель про клик',
        done_when: ['TOKEN_READY'],
        evidence: [{ text: 'TOKEN_READY vk1.a' }],
        lastCheck: new Date().toISOString(),
        lastVerdict: 'DONE',
      }),
      'utf8',
    );
    fs.writeFileSync(path.join(tmpStale, 'loop-guard.state.json'), JSON.stringify({ ...emptyState(cfg), goal: 'новая задача: оплата картой' }), 'utf8');
    const foreign = autoGoalVerdict(tmpStale);
    pass &= ok('обёртка: чужая задача -> STALE CONTINUE', foreign.stale && foreign.verdict === 'CONTINUE');
    fs.writeFileSync(path.join(tmpStale, 'loop-guard.state.json'), JSON.stringify({ ...emptyState(cfg), goal: 'вчерашняя цель про клик' }), 'utf8');
    const own = autoGoalVerdict(tmpStale);
    pass &= ok('обёртка: своя задача -> DONE', own.verdict === 'DONE' && !own.stale);

    fs.writeFileSync(path.join(tmpStale, 'loop-guard.state.json'), JSON.stringify({ ...emptyState(cfg), goal: 'новая задача: оплата картой' }), 'utf8');
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), 'enforce', `--dir=${tmpStale}`], {
      cwd: tmpStale,
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
    });
    pass &= ok('CONTINUE -> process.exit(2)', child.status === 2);
    pass &= ok('CONTINUE не через exitCode', child.status === 2 && /НЕ ОСТАНАВЛИВАТЬСЯ/.test(`${child.stdout || ''}${child.stderr || ''}`));
  } finally {
    fs.rmSync(tmpStale, { recursive: true, force: true });
  }

  const tmpLog = fs.mkdtempSync(path.join(os.tmpdir(), 'lg-log-'));
  try {
    fs.writeFileSync(path.join(tmpLog, 'LOOPS.md'), 'pat\uFFFDh zamen\uFFFD\n', { encoding: 'utf8' });
    appendLog(tmpLog, '- замена path');
    const raw = fs.readFileSync(path.join(tmpLog, 'LOOPS.md'), { encoding: 'utf8' });
    const bad = (raw.match(/\uFFFD/g) || []).length;
    pass &= ok('LOOPS.md UTF-8 без U+FFFD', bad === 0 && raw.includes('path') && raw.includes('замена'));
  } finally {
    fs.rmSync(tmpLog, { recursive: true, force: true });
  }

  if (pass) {
    console.log('selftest passed');
    process.exit(0);
  } else {
    console.log('selftest FAILED');
    process.exit(1);
  }
}

function main(argv = process.argv.slice(2), dir = __dirname) {
  const cmd = argv[0] || 'status';
  const args = argv.slice(1);
  const dirArg = argVal(argv, 'dir') || argVal(args, 'dir');
  if (dirArg) dir = path.resolve(dirArg);
  const cfg = loadConfig(dir);
  if (cmd === 'selftest') return selftest();
  if (cmd === 'status') return cmdStatus(dir, cfg);
  if (cmd === 'enforce') return cmdEnforce(dir, cfg);
  if (cmd === 'reset') return cmdReset(dir, cfg);
  if (cmd === 'log') return cmdLog(dir, cfg, args);
  if (cmd === 'begin') return cmdBegin(dir, cfg, args);
  if (cmd === 'heartbeat') return cmdHeartbeat(dir, cfg, args);
  if (cmd === 'receipt') return cmdReceipt(dir, cfg, args);
  if (cmd === 'verify-claim') return cmdVerify(dir, cfg, args);
  if (cmd === 'classify') return cmdClassify(dir, cfg, args);
  if (cmd === 'on-user') return cmdOnUser(dir, cfg, args);
  if (cmd === 'verify-criterion') return cmdVerifyCriterion(dir, cfg, args);
  if (cmd === 'tick') return cmdTick(dir, cfg);
  if (cmd === 'watchdog') return cmdWatchdog(dir, cfg, args);
  console.log('usage: node .agent/loop-guard.mjs <selftest|status|enforce|begin|heartbeat|receipt|classify|watchdog|on-user|reset|log>');
  process.exitCode = 1;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
