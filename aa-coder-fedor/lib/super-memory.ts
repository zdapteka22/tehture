import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

import { recallHeavyFile } from "./heavy-file";

export type MemoryKind = "user" | "assistant" | "command" | "browser" | "edit" | "app" | "note";

export type MemoryFact = {
  id: string;
  text: string;
  hits: number;
  updatedAt: number;
  pinned?: boolean;
};

export type MemorySkill = {
  id: string;
  title: string;
  pattern: string;
  count: number;
  kind: "command" | "query" | "url";
  updatedAt: number;
};

export type MemorySuggestion = {
  id: string;
  title: string;
  detail: string;
  kind: "skill" | "cleanup" | "git" | "style";
  prompt?: string;
};

export type MemoryFingerprint = {
  hash: string;
  kind: MemoryKind;
  text: string;
  count: number;
  lastAt: number;
};

export type MemoryProfile = {
  language: "ru" | "en" | "mix";
  topCommands: { text: string; count: number }[];
  topUrls: { text: string; count: number }[];
  git?: { branch?: string; dirty?: number; lastCommit?: string; remote?: string };
};

export type SuperMemoryState = {
  enabled: boolean;
  facts: MemoryFact[];
  skills: MemorySkill[];
  fingerprints: MemoryFingerprint[];
  dismissed: string[];
  updatedAt: number;
  hygieneAt?: number;
  lastDropped?: number;
};

export type MemoryHygiene = {
  lastAt: number;
  dropped: number;
};

export type MemoryPublicSnapshot = {
  enabled: boolean;
  entropy: number;
  redundancy: number;
  events: number;
  unique: number;
  facts: MemoryFact[];
  skills: MemorySkill[];
  suggestions: MemorySuggestion[];
  profile: MemoryProfile;
  dir: string;
  hygiene: MemoryHygiene;
};

const MAX_FINGERPRINTS = 800;
const MAX_FACTS = 80;
const MAX_SKILLS = 40;
const MAX_ONE_OFF = 80;
const SKILL_THRESHOLD = 3;
export const MAX_TEXT = 1200;
const DAY_MS = 24 * 60 * 60 * 1000;
const STOP_WORDS = new Set([
  "не",
  "нет",
  "никогда",
  "больше",
  "всегда",
  "never",
  "not",
  "dont",
  "don't",
  "always",
  "the",
  "and",
  "для",
  "это",
  "этот",
  "этого",
  "этой",
  "какой",
  "какая",
  "какое",
  "какие",
  "what",
  "which",
  "how",
  "where",
  "when",
  "why",
  "that",
  "this",
]);

/** PIN ↔ код, проект ↔ репозиторий — lexical recall without embeddings. */
const SYNONYM_GROUPS: string[][] = [
  ["pin", "пин", "код", "пароль", "ключ", "password", "passwd", "secret", "секрет"],
  ["проект", "репозиторий", "репозитор", "repo", "стенд", "repository"],
  ["имя", "зовут", "звать", "name"],
];

function expandToken(word: string): string[] {
  const stem = stemWord(word);
  const out = new Set<string>([word, stem]);
  for (const group of SYNONYM_GROUPS) {
    const stems = group.map(stemWord);
    const hit = group.some((item) => item === word || item === stem) || stems.some((item) => item === stem || stem.startsWith(item) || item.startsWith(stem));
    if (!hit) continue;
    for (const item of group) {
      out.add(item);
      out.add(stemWord(item));
    }
  }
  return [...out];
}

function envMs(name: string, fallback: number): number {
  const raw = Number(process.env[name] || "");
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function noiseTtlMs(): number {
  return envMs("GROK_MEMORY_NOISE_MS", 14 * DAY_MS);
}

function fingerprintStaleMs(): number {
  return envMs("GROK_MEMORY_STALE_FP_MS", 45 * DAY_MS);
}

function factStaleMs(): number {
  return envMs("GROK_MEMORY_STALE_FACT_MS", 30 * DAY_MS);
}

function autoHygieneMs(): number {
  return envMs("GROK_MEMORY_HYGIENE_MS", 6 * 60 * 60 * 1000);
}

function memoryRoot(): string {
  const override = process.env.GROK_MEMORY_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "memory");
  }
  return path.join(os.homedir(), ".fedor2", "memory");
}

function statePath(): string {
  return path.join(memoryRoot(), "state.json");
}

export function redactSecrets(text: string): string {
  let s = text;
  s = s.replace(/\b(sk-|sk-or-v1-|xai-|AQVN)[A-Za-z0-9_\-]{8,}/g, "[redacted]");
  s = s.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");
  s = s.replace(/\b(api[_-]?key|password|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  s = s.replace(/\bgpt:\/\/[^\s]+/gi, "gpt://[redacted]");
  return s;
}

export function normalizeMemoryText(text: string): string {
  return redactSecrets(text)
    .replace(/\\/g, "/")
    .replace(os.homedir().replace(/\\/g, "/"), "~")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .slice(0, MAX_TEXT);
}

export function fingerprintHash(kind: MemoryKind, text: string): string {
  return createHash("sha1").update(`${kind}:${normalizeMemoryText(text)}`).digest("hex").slice(0, 16);
}

function emptyState(): SuperMemoryState {
  return {
    enabled: true,
    facts: [],
    skills: [],
    fingerprints: [],
    dismissed: [],
    updatedAt: Date.now(),
    hygieneAt: 0,
    lastDropped: 0,
  };
}

function readState(): SuperMemoryState {
  try {
    const raw = readFileSync(statePath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<SuperMemoryState>;
    return {
      ...emptyState(),
      ...parsed,
      enabled: parsed.enabled !== false,
      facts: Array.isArray(parsed.facts) ? parsed.facts : [],
      skills: Array.isArray(parsed.skills) ? parsed.skills : [],
      fingerprints: Array.isArray(parsed.fingerprints) ? parsed.fingerprints : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
    };
  } catch {
    return emptyState();
  }
}

function writeState(state: SuperMemoryState): void {
  const dir = memoryRoot();
  mkdirSync(dir, { recursive: true });
  state.updatedAt = Date.now();
  writeFileSync(statePath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function looksLikeRememberCommand(text: string): boolean {
  // JS \b is ASCII-only; a Cyrillic «запомни» would never match «запомни код».
  return /^(запомни|запомнить|remember(?:\s+that)?)(?=$|[\s:,.\-–—])/i.test(text.trim());
}

function looksLikePreference(text: string): boolean {
  if (looksLikeRememberCommand(text)) return false;
  return /(всегда|никогда|предпочитаю|не трогай|use .+ instead|\balways\b|\bnever\b)/i.test(text);
}

/** Something the user told us to keep — not a coding task. «запомни» is optional. */
export function looksLikeDurableFact(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw || isTransientChat(raw)) return false;
  if (looksLikeRememberCommand(raw) || looksLikePreference(raw)) return true;
  if (
    /(напиши|создай файл|исправ|поправ|открой|добавь функцию|рефактор|баг в)/i.test(raw) &&
    !/(запомни|секретн|меня зовут|код проекта|код стенда)/i.test(raw)
  ) {
    return false;
  }
  if (
    /(секретн.{0,32}код|код (проекта|стенда|репозитор)|пин[\s:=]|pin[\s:=]|\bпароль\b|меня зовут|как меня звать|я живу|мой (проект|стенд|репозиторий)|это мой)/i.test(
      raw,
    )
  ) {
    return true;
  }
  return false;
}

export function cleanFactText(text: string): string {
  return redactSecrets(text)
    .replace(/^(запомни|запомнить|remember(?:\s+that)?|save fact)\s*[:\-–—]?\s*/i, "")
    .trim();
}

function stemWord(word: string): string {
  if (word.length <= 5) return word;
  return word.replace(/(ются|ется|ешь|ите|ать|ить|ять|ют|ет|ит|ю)$/i, "").slice(0, 9);
}

function factMergeKey(text: string): string {
  return normalizeMemoryText(cleanFactText(text))
    .split(" ")
    .filter((word) => word.length > 2)
    .map(stemWord)
    .sort()
    .join(" ");
}

function cyrillicRatio(text: string): number {
  const letters = text.replace(/[^a-zа-яё]/gi, "");
  if (!letters.length) return 0;
  const cyr = letters.replace(/[^а-яё]/gi, "").length;
  return cyr / letters.length;
}

export function isTransientChat(text: string): boolean {
  const n = normalizeMemoryText(text);
  if (!n) return true;
  if (n.length < 4) return true;
  return /^(ок|окей|ok|okay|да|нет|ага|угу|спасибо|thanks|thx|лол|понял|ясно|хорошо|го|lf|yes|no|привет|hi|hello)$/i.test(
    n
  );
}

export function recordMemoryEvent(input: {
  kind: MemoryKind;
  text: string;
  distill?: boolean;
}): { duplicate: boolean; hash: string } {
  const state = readState();
  if (!state.enabled) return { duplicate: false, hash: "" };
  const text = redactSecrets(String(input.text || "")).trim().slice(0, MAX_TEXT);
  if (!text) return { duplicate: false, hash: "" };
  if (input.kind === "user" && isTransientChat(text)) return { duplicate: false, hash: "" };
  const hash = fingerprintHash(input.kind, text);
  const now = Date.now();
  const existing = state.fingerprints.find((item) => item.hash === hash);
  if (existing) {
    existing.count += 1;
    existing.lastAt = now;
    existing.text = text;
    promoteSkill(state, existing);
    writeState(compactState(state));
    return { duplicate: true, hash };
  }
  state.fingerprints.push({ hash, kind: input.kind, text, count: 1, lastAt: now });
  if (input.distill !== false && (input.kind === "user" || input.kind === "note")) {
    if (looksLikeRememberCommand(text)) {
      const rest = cleanFactText(text);
      if (rest) upsertFact(state, rest);
    } else if (looksLikeDurableFact(text)) {
      upsertFact(state, cleanFactText(text) || text);
    }
  }
  writeState(compactState(state));
  return { duplicate: false, hash };
}

function promoteSkill(state: SuperMemoryState, item: MemoryFingerprint): void {
  if (item.count < SKILL_THRESHOLD) return;
  if (item.kind !== "command" && item.kind !== "user" && item.kind !== "browser") return;
  const kind: MemorySkill["kind"] =
    item.kind === "command" ? "command" : item.kind === "browser" ? "url" : "query";
  const found = state.skills.find((skill) => skill.pattern === item.hash);
  if (found) {
    found.count = item.count;
    found.updatedAt = item.lastAt;
    found.title = skillTitle(item);
    return;
  }
  state.skills.push({
    id: newId("sk"),
    title: skillTitle(item),
    pattern: item.hash,
    count: item.count,
    kind,
    updatedAt: item.lastAt,
  });
}

function skillTitle(item: MemoryFingerprint): string {
  const short = item.text.length > 72 ? `${item.text.slice(0, 72)}…` : item.text;
  if (item.kind === "command") return `Частая команда: ${short}`;
  if (item.kind === "browser") return `Частый сайт: ${short}`;
  return `Частый запрос: ${short}`;
}

function upsertFact(state: SuperMemoryState, text: string): MemoryFact {
  const cleaned = cleanFactText(redactSecrets(text)).slice(0, MAX_TEXT);
  const key = factMergeKey(cleaned) || normalizeMemoryText(cleaned);
  const found = key ? state.facts.find((fact) => (factMergeKey(fact.text) || normalizeMemoryText(fact.text)) === key) : undefined;
  if (found) {
    found.hits += 1;
    found.updatedAt = Date.now();
    if (cleaned && cleaned.length <= found.text.length) found.text = cleaned;
    return found;
  }
  const fact: MemoryFact = {
    id: newId("fact"),
    text: cleaned || redactSecrets(text).slice(0, MAX_TEXT),
    hits: 1,
    updatedAt: Date.now(),
  };
  if (fact.text) state.facts.push(fact);
  return fact;
}

export function saveMemoryFact(text: string, pinned = false): MemoryFact | null {
  const cleaned = redactSecrets(text).trim();
  if (!cleaned) return null;
  const state = readState();
  const fact = upsertFact(state, cleaned);
  if (pinned) fact.pinned = true;
  writeState(compactState(state));
  recordMemoryEvent({ kind: "note", text: cleaned, distill: false });
  return fact;
}

export function forgetMemory(idOrQuery: string): number {
  const state = readState();
  const q = normalizeMemoryText(idOrQuery);
  if (!q && !idOrQuery.trim()) return 0;
  const before = state.facts.length + state.skills.length + state.fingerprints.length;
  state.facts = state.facts.filter(
    (fact) => fact.id !== idOrQuery && normalizeMemoryText(fact.text) !== q && !normalizeMemoryText(fact.text).includes(q)
  );
  state.skills = state.skills.filter(
    (skill) => skill.id !== idOrQuery && !normalizeMemoryText(skill.title).includes(q)
  );
  state.fingerprints = state.fingerprints.filter((item) => {
    if (item.hash === idOrQuery.replace(/^fp_/, "")) return false;
    if (q && normalizeMemoryText(item.text).includes(q)) return false;
    return true;
  });
  writeState(state);
  return before - (state.facts.length + state.skills.length + state.fingerprints.length);
}

export function setMemoryEnabled(enabled: boolean): SuperMemoryState {
  const state = readState();
  state.enabled = enabled;
  writeState(state);
  return state;
}

export function dismissSuggestion(id: string): void {
  const state = readState();
  if (!state.dismissed.includes(id)) state.dismissed.push(id);
  state.dismissed = state.dismissed.slice(-80);
  writeState(state);
}

function wordStems(text: string): string[] {
  return factMergeKey(text)
    .split(" ")
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function jaccard(a: string, b: string): number {
  const left = new Set(wordStems(a));
  const right = new Set(wordStems(b));
  if (!left.size || !right.size) return 0;
  let inter = 0;
  for (const word of left) {
    if (right.has(word)) inter += 1;
  }
  return inter / (left.size + right.size - inter);
}

export function resolveContradictions(facts: MemoryFact[]): MemoryFact[] {
  const ranked = [...facts].sort(
    (a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt
  );
  const kept: MemoryFact[] = [];
  for (const fact of ranked) {
    const rival = kept.find((item) => jaccard(item.text, fact.text) >= 0.55);
    if (!rival) {
      kept.push({ ...fact });
      continue;
    }
    rival.hits += fact.hits;
    rival.updatedAt = Math.max(rival.updatedAt, fact.updatedAt);
    rival.pinned = rival.pinned || fact.pinned;
  }
  return kept;
}

function hygieneState(state: SuperMemoryState): SuperMemoryState {
  const now = Date.now();
  const before = state.facts.length + state.fingerprints.length + state.skills.length;
  const noiseTtl = noiseTtlMs();
  const fpStale = fingerprintStaleMs();
  const factStale = factStaleMs();

  state.fingerprints = state.fingerprints.filter((item) => {
    const age = now - (item.lastAt || 0);
    if (item.count <= 1 && age > noiseTtl) return false;
    if (item.count < 5 && age > fpStale) return false;
    return true;
  });

  state.facts = state.facts.filter((fact) => {
    if (fact.pinned) return true;
    const age = now - (fact.updatedAt || 0);
    if ((fact.hits || 1) <= 1 && age > factStale) return false;
    return true;
  });
  state.facts = resolveContradictions(state.facts);

  state.skills = state.skills.filter((skill) => {
    const age = now - (skill.updatedAt || 0);
    if (skill.count < SKILL_THRESHOLD && age > fpStale) return false;
    return true;
  });

  pruneEntropy(state);

  const after = state.facts.length + state.fingerprints.length + state.skills.length;
  state.lastDropped = Math.max(0, before - after);
  return state;
}

function pruneEntropy(state: SuperMemoryState): void {
  const keepers = state.fingerprints.filter((item) => item.count > 1);
  const ones = state.fingerprints
    .filter((item) => item.count <= 1)
    .sort((a, b) => b.lastAt - a.lastAt);
  if (ones.length > MAX_ONE_OFF) {
    state.fingerprints = [...keepers, ...ones.slice(0, MAX_ONE_OFF)];
  }

  const stats = entropyOf(state);
  if (stats.events < 24 || stats.entropy <= 0.55) return;

  const weak = state.fingerprints
    .filter((item) => item.count < 3)
    .sort((a, b) => a.lastAt - b.lastAt || a.count - b.count);
  const strong = state.fingerprints.filter((item) => item.count >= 3);
  const dropN = Math.min(weak.length, Math.ceil(weak.length * 0.4));
  if (dropN > 0) {
    state.fingerprints = [...strong, ...weak.slice(dropN)];
  }
}

function compactState(state: SuperMemoryState): SuperMemoryState {
  state.fingerprints.sort((a, b) => b.lastAt - a.lastAt);
  const seen = new Set<string>();
  const merged: MemoryFingerprint[] = [];
  for (const item of state.fingerprints) {
    if (seen.has(item.hash)) continue;
    seen.add(item.hash);
    merged.push(item);
  }
  merged.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  state.fingerprints = merged.slice(0, MAX_FINGERPRINTS);

  const factMap = new Map<string, MemoryFact>();
  for (const fact of state.facts) {
    const key = factMergeKey(fact.text) || normalizeMemoryText(fact.text);
    const prev = factMap.get(key);
    if (!prev) {
      factMap.set(key, {
        ...fact,
        text: cleanFactText(fact.text) || fact.text,
      });
      continue;
    }
    prev.hits += fact.hits;
    prev.updatedAt = Math.max(prev.updatedAt, fact.updatedAt);
    prev.pinned = prev.pinned || fact.pinned;
    const cleaned = cleanFactText(fact.text) || fact.text;
    if (cleaned.length < prev.text.length || /^запомни/i.test(prev.text)) {
      prev.text = cleaned;
    }
  }
  state.facts = [...factMap.values()]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.hits - a.hits || b.updatedAt - a.updatedAt)
    .slice(0, MAX_FACTS);

  const skillMap = new Map<string, MemorySkill>();
  for (const skill of state.skills) {
    const prev = skillMap.get(skill.pattern);
    if (!prev) {
      skillMap.set(skill.pattern, skill);
      continue;
    }
    prev.count = Math.max(prev.count, skill.count);
    prev.updatedAt = Math.max(prev.updatedAt, skill.updatedAt);
  }
  state.skills = [...skillMap.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_SKILLS);

  return hygieneState(state);
}

export function compactSuperMemory(): MemoryPublicSnapshot {
  const state = compactState(readState());
  state.hygieneAt = Date.now();
  writeState(state);
  return getMemorySnapshot();
}

export function recallMemory(query: string, limit = 8): string[] {
  const q = normalizeMemoryText(query);
  if (!q) return [];
  const state = readState();
  const memoryQ = looksLikeMemoryQuestion(query);
  const scored: { score: number; text: string; at: number }[] = [];
  for (const fact of state.facts) {
    const n = normalizeMemoryText(fact.text);
    let score = (n.includes(q) ? 5 : 0) + overlapScore(q, n) + fact.hits * 0.2 + (fact.pinned ? 2 : 0);
    if (memoryQ && /код|pin|пин|секрет|пароль/i.test(query) && /код|pin|пин|секрет|пароль|[A-Z]{3,}-[A-Z0-9-]+/.test(fact.text)) {
      score += 1.4;
    }
    if (score > 0.35) scored.push({ score, text: `факт: ${fact.text}`, at: fact.updatedAt });
  }
  for (const skill of state.skills) {
    const n = normalizeMemoryText(skill.title);
    const score = (n.includes(q) ? 4 : 0) + overlapScore(q, n) + skill.count * 0.15;
    if (score > 0.4) scored.push({ score, text: `навык ×${skill.count}: ${skill.title}`, at: skill.updatedAt });
  }
  const fpFloor = memoryQ ? 0.7 : 1.2;
  for (const item of state.fingerprints.slice(0, 200)) {
    const n = normalizeMemoryText(item.text);
    let score = (n.includes(q) ? 3 : 0) + overlapScore(q, n) + Math.log2(item.count + 1);
    if (memoryQ && /код|pin|пин|секрет/i.test(query) && /[A-Z]{3,}-[A-Z0-9-]+/.test(item.text)) score += 1.2;
    if (score > fpFloor) scored.push({ score, text: `${item.kind} ×${item.count}: ${item.text}`, at: item.lastAt });
  }
  scored.sort((a, b) => b.score - a.score || b.at - a.at);
  const uniq: string[] = [];
  for (const row of scored) {
    if (uniq.includes(row.text)) continue;
    uniq.push(row.text);
    if (uniq.length >= limit) break;
  }
  for (const row of recallHeavyFile(query, Math.max(3, limit))) {
    if (uniq.includes(row)) continue;
    uniq.push(row);
    if (uniq.length >= limit + 4) break;
  }
  return uniq;
}

export function retrieveGrounding(query: string, extra: string[] = []): string {
  const mem = recallMemory(query, 6);
  const lines = [...mem, ...extra.filter(Boolean)].slice(0, 10);
  if (!lines.length) return "";
  return `<grounding>\nTrust these retrieved local notes over invention. If they conflict with the CURRENT user message, trust the user.\n${lines.map((line) => `- ${line}`).join("\n")}\n</grounding>`;
}

export function looksLikeMemoryQuestion(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|css|html|go|rs)\b/i.test(raw)) return false;
  if (/(напиши|создай|исправ|поправ|открой|папк)/i.test(raw) && !/(запомнил|напомни|секретн)/i.test(raw)) {
    return false;
  }
  return /(напомни|что ты запомнил|что я (говорил|просил запомнить)|секретн(ый|ого)?\s+код|код проекта|какой\s+(у\s+нас\s+)?(код|пин|pin|пароль|секрет)|как меня зовут|как звать)/i.test(
    raw,
  );
}

export function answerFromMemory(
  question: string,
  history: Array<{ role?: string; content: string }> = [],
): string | null {
  if (!looksLikeMemoryQuestion(question)) return null;
  const codeRe = /[A-Z]{2,}(?:-[A-Z0-9]+){1,}/g;
  const hist = history
    .filter((row) => row.role === "user" || !row.role)
    .map((row) => String(row.content || ""))
    .join("\n");
  const chatCodes = [...new Set(hist.match(codeRe) || [])];
  if (chatCodes.length === 1) return `Из этого чата: ${chatCodes[0]}`;
  if (chatCodes.length > 1) {
    return `В этом чате несколько кодов: ${chatCodes.join(", ")}. Какой нужен?`;
  }
  const hits = recallMemory(question, 6);
  if (!hits.length) return null;
  const strip = (row: string) =>
    row.replace(/^(факт|навык[^:]*|user ×\d+|assistant ×\d+|note ×\d+|command ×\d+|edit ×\d+|app ×\d+|browser ×\d+):\s*/i, "");
  const cleaned = [...new Set(hits.map(strip))];
  const memCodes = [...new Set(cleaned.flatMap((row) => row.match(codeRe) || []))];
  if (memCodes.length > 1) {
    return `В памяти несколько кодов: ${memCodes.join(", ")}. Какой нужен?`;
  }
  if (memCodes.length === 1) return `Из Super Memory: ${memCodes[0]}`;
  return `Из Super Memory: ${cleaned[0]}`;
}

function overlapScore(query: string, text: string): number {
  const qWords = query
    .split(" ")
    .map((word) => word.trim())
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
  if (!qWords.length) return 0;
  const n = normalizeMemoryText(text);
  let hits = 0;
  for (const word of qWords) {
    if (n.includes(word) || n.includes(stemWord(word))) {
      hits += 1;
      continue;
    }
    const alts = expandToken(word);
    if (alts.some((tok) => tok.length > 2 && tok !== word && (n.includes(tok) || n.includes(stemWord(tok))))) {
      hits += 1;
    }
  }
  return hits / qWords.length;
}

function readGitSnapshot(cwd: string): MemoryProfile["git"] | undefined {
  if (!existsSync(path.join(cwd, ".git"))) return undefined;
  const run = (args: string[]) =>
    spawnSync("git", args, { cwd, encoding: "utf8", timeout: 1500, windowsHide: true });
  const branch = run(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch.status !== 0) return undefined;
  const status = run(["status", "--porcelain"]);
  const log = run(["log", "-1", "--oneline"]);
  const remote = run(["remote", "get-url", "origin"]);
  const dirty = (status.stdout || "").split(/\r?\n/).filter((line) => line.trim()).length;
  return {
    branch: (branch.stdout || "").trim() || undefined,
    dirty,
    lastCommit: (log.stdout || "").trim() || undefined,
    remote: (remote.stdout || "").trim() || undefined,
  };
}

let gitCache: { at: number; cwd: string; value: MemoryProfile["git"] } | undefined;

function cachedGit(cwd: string): MemoryProfile["git"] | undefined {
  const now = Date.now();
  if (gitCache && gitCache.cwd === cwd && now - gitCache.at < 20_000) return gitCache.value;
  const value = readGitSnapshot(cwd);
  gitCache = { at: now, cwd, value };
  return value;
}

function buildProfile(state: SuperMemoryState): MemoryProfile {
  const commands = state.fingerprints
    .filter((item) => item.kind === "command")
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((item) => ({ text: item.text, count: item.count }));
  const urls = state.fingerprints
    .filter((item) => item.kind === "browser")
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)
    .map((item) => ({ text: item.text, count: item.count }));
  const userText = state.fingerprints
    .filter((item) => item.kind === "user")
    .map((item) => item.text)
    .join(" ");
  const ratio = cyrillicRatio(userText);
  const language: MemoryProfile["language"] = ratio > 0.6 ? "ru" : ratio < 0.2 && userText ? "en" : "mix";
  let git: MemoryProfile["git"] | undefined;
  try {
    const cwd = process.env.GROK_WORKSPACE?.trim() || path.join(os.homedir(), "Fedor2", "workspace");
    git = existsSync(cwd) ? cachedGit(cwd) : undefined;
  } catch {
    git = undefined;
  }
  return { language, topCommands: commands, topUrls: urls, git };
}

function entropyOf(state: SuperMemoryState): { entropy: number; redundancy: number; events: number; unique: number } {
  const unique = state.fingerprints.length;
  const events = state.fingerprints.reduce((sum, item) => sum + item.count, 0);
  if (events === 0) return { entropy: 0, redundancy: 0, events: 0, unique: 0 };
  const entropy = unique / events;
  return { entropy, redundancy: 1 - entropy, events, unique };
}

function memoryNeedsHygiene(state: SuperMemoryState): boolean {
  const due = Date.now() - (state.hygieneAt || 0) > autoHygieneMs();
  if (due) return true;
  const stats = entropyOf(state);
  return stats.events >= 24 && stats.entropy > 0.55;
}

function buildSuggestions(state: SuperMemoryState, profile: MemoryProfile): MemorySuggestion[] {
  const out: MemorySuggestion[] = [];
  for (const skill of state.skills.slice(0, 6)) {
    const id = `skill:${skill.id}`;
    if (state.dismissed.includes(id)) continue;
    out.push({
      id,
      kind: "skill",
      title: skill.title,
      detail: `Повторялось ${skill.count} раз. Можно вызывать одним запросом.`,
      prompt: skill.kind === "command" ? `Выполни как обычно: ${skill.title.replace(/^Частая команда:\s*/i, "")}` : skill.title.replace(/^Частый запрос:\s*/i, ""),
    });
  }
  if (profile.git?.dirty && profile.git.dirty > 0) {
    const id = "git:dirty";
    if (!state.dismissed.includes(id)) {
      out.push({
        id,
        kind: "git",
        title: `Git: ${profile.git.dirty} изменённых файлов`,
        detail: profile.git.branch
          ? `Ветка ${profile.git.branch}. Могу набросать сообщение коммита по текущему diff.`
          : "Могу набросать сообщение коммита по текущему diff.",
        prompt: "Посмотри git status и diff в этой папке и предложи короткое сообщение коммита. Не коммить, пока не попрошу.",
      });
    }
  }
  if (profile.language === "ru") {
    const id = "style:ru";
    if (!state.dismissed.includes(id) && !state.facts.some((f) => /русск/i.test(f.text))) {
      out.push({
        id,
        kind: "style",
        title: "Отвечать по-русски",
        detail: "Большинство запросов на русском — это уже учитывается в подсказках.",
      });
    }
  }
  return out.slice(0, 8);
}

export function getMemorySnapshot(): MemoryPublicSnapshot {
  let state = readState();
  if (memoryNeedsHygiene(state)) {
    state = compactState(state);
    state.hygieneAt = Date.now();
    writeState(state);
  }
  const profile = buildProfile(state);
  const stats = entropyOf(state);
  return {
    enabled: state.enabled,
    ...stats,
    facts: state.facts,
    skills: state.skills,
    suggestions: state.enabled ? buildSuggestions(state, profile) : [],
    profile,
    dir: memoryRoot(),
    hygiene: {
      lastAt: state.hygieneAt || 0,
      dropped: state.lastDropped || 0,
    },
  };
}

export function getMemoryPromptBlock(): string {
  const snap = getMemorySnapshot();
  if (!snap.enabled) return "";
  const facts = snap.facts
    .slice(0, 12)
    .map((fact) => `- ${fact.text}`)
    .join("\n");
  const skills = snap.skills
    .slice(0, 6)
    .map((skill) => `- ×${skill.count} ${skill.title}`)
    .join("\n");
  const cmds = snap.profile.topCommands
    .map((item) => `- ×${item.count} ${item.text}`)
    .join("\n");
  const git = snap.profile.git
    ? `Git: branch=${snap.profile.git.branch || "?"} dirty=${snap.profile.git.dirty ?? 0} last=${snap.profile.git.lastCommit || "—"}`
    : "Git: not a repository (or git unavailable).";
  const suggestions = snap.suggestions
    .slice(0, 4)
    .map((item) => `- ${item.title}: ${item.detail}`)
    .join("\n");
  return `
<super_memory>
Local Super Memory is ON. Redacted local journal on this PC. It is not cloud training.
Hygiene runs automatically: duplicates merge, contradictions keep the newer fact, one-off noise and stale items drop. No user button. Do not call memory_optimize unless the user explicitly asks.
If a stored fact conflicts with the CURRENT user message, trust the current message.
If they ask what they told you — code, name, rule — answer from Known facts. Do not say you forgot.
Do not treat one-off fingerprints as rules. Do not dump the whole memory.
memory_recall for a specific past item. memory_save for durable preferences. memory_forget to drop something.

Language bias: ${snap.profile.language}
${git}
Entropy (unique/events): ${snap.entropy.toFixed(2)} redundancy=${snap.redundancy.toFixed(2)} events=${snap.events} hygieneDropped=${snap.hygiene.dropped}

Known facts:
${facts || "- (none yet)"}

Repeated skills:
${skills || "- (none yet)"}

Frequent commands:
${cmds || "- (none yet)"}

Workflow hints:
${suggestions || "- (none yet)"}
</super_memory>
`;
}

const SKIP_TOOL_LOG = new Set([
  "todo_write",
  "browser_snapshot",
  "browser_wait",
  "memory_recall",
  "memory_save",
  "memory_forget",
  "memory_optimize",
]);

export function observeToolForMemory(name: string, args: Record<string, unknown>): void {
  if (SKIP_TOOL_LOG.has(name)) return;
  try {
    if (name === "run_terminal_cmd") {
      recordMemoryEvent({ kind: "command", text: String(args.command ?? "") });
      return;
    }
    if (name === "browser_navigate") {
      recordMemoryEvent({ kind: "browser", text: String(args.url ?? "") });
      return;
    }
    if (name === "read_file") {
      recordMemoryEvent({ kind: "edit", text: `читал ${String(args.path ?? "")}` });
      return;
    }
    if (name === "write_file" || name === "search_replace") {
      recordMemoryEvent({ kind: "edit", text: String(args.path ?? "") });
      return;
    }
    if (name === "write_pc_file") {
      recordMemoryEvent({ kind: "edit", text: `${args.place || "desktop"}/${args.name || ""}` });
      return;
    }
    if (name === "launch_app" || name === "open_on_pc") {
      recordMemoryEvent({ kind: "app", text: String(args.target || args.path || args.name || "") });
    }
  } catch {
    // memory must never break the agent
  }
}
