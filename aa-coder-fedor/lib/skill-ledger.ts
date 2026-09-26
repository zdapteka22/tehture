/**
 * Experiential skill ledger (ExpeL-style, Zhao et al., AAAI 2024).
 * Every tool — browser, PC, code, shell, human, whole task — leaves a trace.
 * Winners rise, losers stay as lessons. Nothing is deleted: this is a skill, not a trash can.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { looksLikeStaleClick } from "./click-outcome";
import { looksFailed } from "./reflexion";
import { redactSecrets } from "./super-memory";

export type SkillDomain = "browser" | "pc" | "code" | "shell" | "human" | "task";
export type SkillOutcome = "win" | "lose" | "tactic";

export type SkillExperience = {
  id: string;
  domain: SkillDomain;
  tool: string;
  situation: string;
  tactic: string;
  outcome: SkillOutcome;
  lesson: string;
  task: string;
  at: number;
};

export type SkillInsight = {
  id: string;
  domain: SkillDomain;
  tools: string[];
  text: string;
  votes: number;
  wins: number;
  losses: number;
  tactics: number;
  updatedAt: number;
};

type Ledger = {
  experiences: SkillExperience[];
  insights: SkillInsight[];
  updatedAt: number;
};

const SKIP = new Set([
  "todo_write",
  "browser_snapshot",
  "browser_wait",
  "browser_tabs",
  "pc_windows",
  "pc_snapshot",
  "pc_screenshot",
  "memory_recall",
  "memory_save",
  "memory_forget",
  "memory_optimize",
]);

const HOT_EXPERIENCES = 2500;
let currentTask = "";

export function setSkillTask(task: string): void {
  currentTask = redactSecrets(String(task || "")).replace(/\s+/g, " ").trim().slice(0, 400);
}

export function getSkillTask(): string {
  return currentTask;
}

function skillRoot(): string {
  const override = process.env.FEDOR_SKILL_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "skills");
  }
  return path.join(os.homedir(), ".fedor2", "skills");
}

function ledgerPath(): string {
  return path.join(skillRoot(), "ledger.json");
}

function archivePath(): string {
  return path.join(skillRoot(), "archive.jsonl");
}

function empty(): Ledger {
  return { experiences: [], insights: [], updatedAt: Date.now() };
}

function readLedger(): Ledger {
  try {
    const parsed = JSON.parse(readFileSync(ledgerPath(), "utf8")) as Partial<Ledger>;
    return {
      experiences: Array.isArray(parsed.experiences) ? parsed.experiences : [],
      insights: Array.isArray(parsed.insights) ? parsed.insights : [],
      updatedAt: parsed.updatedAt || Date.now(),
    };
  } catch {
    return empty();
  }
}

function writeLedger(state: Ledger): void {
  mkdirSync(skillRoot(), { recursive: true });
  if (state.experiences.length > HOT_EXPERIENCES) {
    const overflow = state.experiences.slice(0, state.experiences.length - HOT_EXPERIENCES);
    const keep = state.experiences.slice(-HOT_EXPERIENCES);
    try {
      const lines = overflow.map((item) => JSON.stringify(item)).join("\n");
      const prev = existsSync(archivePath()) ? readFileSync(archivePath(), "utf8") : "";
      writeFileSync(archivePath(), `${prev}${prev && !prev.endsWith("\n") ? "\n" : ""}${lines}\n`, "utf8");
    } catch {
      // archive is best-effort; hot ledger still keeps the newest traces
    }
    state.experiences = keep;
  }
  state.updatedAt = Date.now();
  writeFileSync(ledgerPath(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(16)}_${Math.random().toString(16).slice(2, 8)}`;
}

function clip(text: string, max = 220): string {
  return redactSecrets(String(text || ""))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function stems(text: string): string[] {
  return clip(text, 800)
    .toLowerCase()
    .split(/[^a-zа-яё0-9]+/i)
    .map((word) => word.replace(/(ются|ется|ешь|ите|ать|ить|ять|ют|ет|ит|ю)$/i, ""))
    .filter((word) => word.length > 2);
}

function overlap(a: string, b: string): number {
  const left = new Set(stems(a));
  const right = stems(b);
  if (!left.size || !right.length) return 0;
  let hits = 0;
  for (const word of right) if (left.has(word)) hits += 1;
  return hits / Math.max(left.size, right.length, 1);
}

function insightKey(domain: SkillDomain, text: string): string {
  return createHash("sha1")
    .update(`${domain}:${stems(text).slice(0, 14).join(" ")}`)
    .digest("hex")
    .slice(0, 16);
}

export function domainOfTool(name: string): SkillDomain {
  const tool = String(name || "");
  if (/^(browser_|click_kit|web_fetch|web_search)/.test(tool)) return "browser";
  if (/^(download_file|inspect_apk|inspect_zip)/.test(tool)) return "pc";
  if (/^(pc_|operator_use|launch_app|open_on_pc)/.test(tool)) return "pc";
  if (/^(run_terminal_cmd|project_harness)/.test(tool)) return "shell";
  if (/^(write_file|search_replace|read_file|list_dir|grep|write_pc_file)/.test(tool)) return "code";
  if (/^(send_to_peer|memory_)/.test(tool)) return "human";
  return "task";
}

function situationOf(tool: string, args: Record<string, unknown>, output: string, task: string): string {
  const url =
    String(args.url || args.path || args.target || args.query || args.ref || args.text || "").trim() ||
    (String(output || "").match(/^url:\s*(\S+)/m) || [])[1] ||
    "";
  let host = clip(url, 80);
  try {
    if (/^https?:\/\//i.test(url)) host = new URL(url).hostname;
  } catch {
    // keep raw
  }
  return clip([tool, host, clip(task, 80)].filter(Boolean).join(" | "), 180);
}

function tacticOf(output: string): string {
  const raw = String(output || "");
  if (looksLikeStaleClick(raw)) {
    if (/раскрылось меню/i.test(raw)) return "accordion-child";
    return "press-enter";
  }
  if (/HUMAN CHECK/i.test(raw)) return "ask-human";
  if (/click_kit/i.test(raw) && /Подбираю набор|not found|timeout/i.test(raw)) return "heal-kit";
  return "";
}

function lessonOf(tool: string, output: string, outcome: SkillOutcome): string {
  const bit = clip(output, 160);
  if (outcome === "tactic") {
    return clip(
      `${tool}: клик/действие попало, но это меню или тот же экран. Смени тактику, не набор. ${bit}`,
      280,
    );
  }
  if (outcome === "lose") return clip(`${tool} не сработал: ${bit}`, 280);
  return clip(`${tool} сработал`, 160);
}

function outcomeOf(output: string): SkillOutcome {
  if (looksLikeStaleClick(output)) return "tactic";
  if (looksFailed(output) || /HUMAN CHECK|DENIED\./i.test(String(output || ""))) return "lose";
  return "win";
}

function upsertInsight(state: Ledger, exp: SkillExperience): SkillInsight {
  const key = insightKey(exp.domain, exp.lesson);
  const close = state.insights.find(
    (item) => item.id === `in_${key}` || (item.domain === exp.domain && overlap(item.text, exp.lesson) >= 0.55),
  );
  if (close) {
    close.votes += 1;
    close.updatedAt = exp.at;
    if (!close.tools.includes(exp.tool)) close.tools.push(exp.tool);
    if (exp.outcome === "win") close.wins += 1;
    else if (exp.outcome === "lose") close.losses += 1;
    else close.tactics += 1;
    if (exp.lesson.length > close.text.length * 0.6 && overlap(close.text, exp.lesson) >= 0.7) {
      close.text = exp.lesson;
    }
    return close;
  }
  const insight: SkillInsight = {
    id: `in_${key}`,
    domain: exp.domain,
    tools: [exp.tool],
    text: exp.lesson,
    votes: 2,
    wins: exp.outcome === "win" ? 1 : 0,
    losses: exp.outcome === "lose" ? 1 : 0,
    tactics: exp.outcome === "tactic" ? 1 : 0,
    updatedAt: exp.at,
  };
  state.insights.push(insight);
  return insight;
}

export function recordSkillFromTool(
  tool: string,
  args: Record<string, unknown> = {},
  output = "",
  task = getSkillTask(),
): SkillExperience | null {
  const name = String(tool || "").trim();
  if (!name || SKIP.has(name)) return null;
  const raw = String(output || "");
  if (!raw.trim()) return null;
  const exp: SkillExperience = {
    id: newId("ex"),
    domain: domainOfTool(name),
    tool: name,
    situation: situationOf(name, args, raw, task),
    tactic: tacticOf(raw),
    outcome: outcomeOf(raw),
    lesson: lessonOf(name, raw, outcomeOf(raw)),
    task: clip(task, 240),
    at: Date.now(),
  };
  const state = readLedger();
  state.experiences.push(exp);
  upsertInsight(state, exp);
  writeLedger(state);
  return exp;
}

export function concludeSkillTask(opts: {
  task: string;
  usedTools: string[];
  content: string;
  ok: boolean;
}): SkillInsight | null {
  const task = clip(opts.task, 240);
  if (!task) return null;
  const tools = [...new Set((opts.usedTools || []).map((name) => String(name || "").trim()).filter(Boolean))];
  const exp: SkillExperience = {
    id: newId("ex"),
    domain: "task",
    tool: tools[0] || "task",
    situation: clip(task, 180),
    tactic: tools.slice(0, 8).join(" → "),
    outcome: opts.ok ? "win" : "lose",
    lesson: opts.ok
      ? clip(`задача закрыта инструментами ${tools.slice(0, 8).join(", ") || "без инструментов"}: ${task}`, 280)
      : clip(`задача не закрыта: ${task}. уже пробовали ${tools.slice(0, 8).join(", ") || "ничего"}`, 280),
    task,
    at: Date.now(),
  };
  const state = readLedger();
  state.experiences.push(exp);
  const insight = upsertInsight(state, exp);
  writeLedger(state);
  return insight;
}

type SearchDoc = { id: string; text: string };

function lexicalSearch(docs: SearchDoc[], query: string, limit: number): SearchDoc[] {
  const scored = docs
    .map((doc) => ({ doc, score: overlap(query, doc.text) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((row) => row.doc);
}

function miniSearch(docs: SearchDoc[], query: string, limit: number): SearchDoc[] | null {
  if (!query.trim() || !docs.length) return [];
  try {
    // MiniSearch is optional. If webpack/npm miss it, lexical overlap still works.
    const loaded = require("minisearch") as { default?: new (opts: object) => MiniLike } & (new (opts: object) => MiniLike);
    const Mini = loaded.default || loaded;
    const index = new Mini({
      fields: ["text"],
      storeFields: ["id", "text"],
      tokenize: (text: string) => stems(String(text || "")),
      searchOptions: { prefix: true, fuzzy: 0.2 },
    });
    index.addAll(docs);
    const hits = index.search(query) as Array<{ id: string }>;
    const byId = new Map(docs.map((doc) => [doc.id, doc]));
    return hits
      .map((hit) => byId.get(String(hit.id)))
      .filter((item): item is SearchDoc => Boolean(item))
      .slice(0, limit);
  } catch {
    return null;
  }
}

type MiniLike = {
  addAll: (docs: SearchDoc[]) => void;
  search: (query: string) => Array<{ id: string }>;
};

function searchDocs(docs: SearchDoc[], query: string, limit: number): SearchDoc[] {
  const ranked = miniSearch(docs, query, limit);
  if (ranked && ranked.length) return ranked;
  return lexicalSearch(docs, query, limit);
}

export function recallSkills(query: string, limit = 6): SkillInsight[] {
  const state = readLedger();
  if (!state.insights.length) return [];
  const q = clip(query || currentTask, 400);
  if (!q) {
    return [...state.insights].sort((a, b) => b.votes - a.votes || b.updatedAt - a.updatedAt).slice(0, limit);
  }
  const docs = state.insights.map((item) => ({
    id: item.id,
    text: `${item.domain} ${item.tools.join(" ")} ${item.text}`,
  }));
  const hits = searchDocs(docs, q, limit);
  const byId = new Map(state.insights.map((item) => [item.id, item]));
  const out: SkillInsight[] = [];
  for (const hit of hits) {
    const row = byId.get(hit.id);
    if (row) out.push(row);
  }
  if (out.length < Math.min(3, limit)) {
    for (const row of [...state.insights].sort((a, b) => b.votes - a.votes)) {
      if (out.some((item) => item.id === row.id)) continue;
      out.push(row);
      if (out.length >= limit) break;
    }
  }
  return out.slice(0, limit);
}

export function recallSkillLines(query: string, limit = 4): string[] {
  return recallSkills(query, limit).map((item) => {
    const score = `+${item.wins}/-${item.losses}${item.tactics ? `/~${item.tactics}` : ""} ×${item.votes}`;
    return `навык ${item.domain} ${score}: ${item.text}`;
  });
}

export function preferredToolsFor(domain: SkillDomain, query = ""): string[] {
  const state = readLedger();
  const score = (wantQuery: boolean) => {
    const scores = new Map<string, number>();
    for (const exp of state.experiences) {
      if (exp.domain !== domain) continue;
      if (
        wantQuery &&
        query &&
        overlap(query, `${exp.situation} ${exp.lesson} ${exp.task}`) < 0.05 &&
        !clip(exp.situation, 200).toLowerCase().includes(query.toLowerCase().slice(0, 6))
      ) {
        continue;
      }
      const delta = exp.outcome === "win" ? 2 : exp.outcome === "tactic" ? 1 : -1;
      scores.set(exp.tool, (scores.get(exp.tool) || 0) + delta);
    }
    return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  };
  const hit = score(true);
  return hit.length ? hit : score(false);
}

export function getSkillPromptBlock(task = currentTask): string {
  const insights = recallSkills(task, 6);
  if (!insights.length) {
    return `
<skill_memory>
Навык опыта включён. После каждого инструмента кодер запоминает, что сработало в браузере, на ПК, в коде, в диалоге и в самой задаче. Победителей поднимает, промахи оставляет как урок. Ничего из этого не удаляет.
Пока записей нет — действуй, и память наполнится.
</skill_memory>
`;
  }
  const byDomain = new Map<SkillDomain, string[]>();
  for (const domain of ["browser", "pc", "code", "shell", "human", "task"] as SkillDomain[]) {
    const tools = preferredToolsFor(domain, task).slice(0, 4);
    if (tools.length) byDomain.set(domain, tools);
  }
  const prefer = [...byDomain.entries()]
    .map(([domain, tools]) => `- ${domain}: ${tools.join(" → ")}`)
    .join("\n");
  const lines = insights
    .map((item) => `- [${item.domain} +${item.wins}/-${item.losses} ×${item.votes}] ${item.text}`)
    .join("\n");
  return `
<skill_memory>
Навык опыта (долгосрочный, на этом ПК). Это не облачное обучение. Выводы копятся и всплывают по задаче. Ничего не удаляй из журнала навыков.
Если запись спорит с ТЕКУЩИМ сообщением пользователя — верь пользователю.
Для похожей ситуации сначала бери тактику с большим счётом побед, не повторяй тот же промах.

Что уже лучше работает:
${prefer || "- пока мало данных по доменам"}

Выводы:
${lines}
</skill_memory>
`;
}

export function skillEngineName(): "minisearch" | "lexical" {
  try {
    require("minisearch");
    return "minisearch";
  } catch {
    return "lexical";
  }
}
