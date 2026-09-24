/** Heavy file vault inside Super Memory. Long tables stay on disk; the model gets a preview. */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PREVIEW_LINES = 40;
export const MAX_LINE = 180;
export const CHUNK_CHARS = 1100;
export const HEAVY_BYTES = 20 * 1024;
export const HEAVY_LINES = 140;
export const HEAVY_LINE_LEN = 240;

export type HeavyChunk = {
  i: number;
  from: number;
  to: number;
  text: string;
};

export type HeavyRecord = {
  path: string;
  bytes: number;
  lines: number;
  maxLine: number;
  updatedAt: number;
  chunks: HeavyChunk[];
};

function memoryRoot(): string {
  const override = process.env.GROK_MEMORY_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "memory");
  }
  return path.join(os.homedir(), ".fedor2", "memory");
}

function filesDir(): string {
  return path.join(memoryRoot(), "files");
}

function fileKey(filePath: string): string {
  return createHash("sha1").update(String(filePath || "").replace(/\\/g, "/").toLowerCase()).digest("hex").slice(0, 16);
}

export function clipLine(line: string, max = MAX_LINE): string {
  const raw = String(line ?? "");
  if (raw.length <= max) return raw;
  return `${raw.slice(0, max)}… [ещё ${raw.length - max} символов, полный в Super Memory]`;
}

export function isHeavyText(text: string): boolean {
  const raw = String(text || "");
  if (Buffer.byteLength(raw, "utf8") >= HEAVY_BYTES) return true;
  const lines = raw.split(/\r?\n/);
  if (lines.length >= HEAVY_LINES) return true;
  return lines.some((line) => line.length >= HEAVY_LINE_LEN);
}

function splitChunks(text: string): HeavyChunk[] {
  const lines = String(text || "").split(/\r?\n/);
  const chunks: HeavyChunk[] = [];
  let buf: string[] = [];
  let from = 1;
  let chars = 0;
  const flush = (to: number) => {
    if (!buf.length) return;
    chunks.push({
      i: chunks.length + 1,
      from,
      to,
      text: buf.join("\n").slice(0, CHUNK_CHARS),
    });
    buf = [];
    chars = 0;
    from = to + 1;
  };
  lines.forEach((line, idx) => {
    const n = idx + 1;
    const piece = `${n}|${clipLine(line, 400)}`;
    if (chars + piece.length > CHUNK_CHARS && buf.length) flush(n - 1);
    buf.push(piece);
    chars += piece.length + 1;
  });
  flush(lines.length);
  return chunks.slice(0, 48);
}

export function storeHeavyFile(filePath: string, text: string): HeavyRecord {
  const lines = String(text || "").split(/\r?\n/);
  const rec: HeavyRecord = {
    path: String(filePath || ""),
    bytes: Buffer.byteLength(String(text || ""), "utf8"),
    lines: lines.length,
    maxLine: lines.reduce((max, line) => Math.max(max, line.length), 0),
    updatedAt: Date.now(),
    chunks: splitChunks(text),
  };
  const dir = filesDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${fileKey(rec.path)}.json`), `${JSON.stringify(rec)}\n`, "utf8");
  rememberFileFact(rec);
  return rec;
}

function rememberFileFact(rec: HeavyRecord): void {
  try {
    const stateFile = path.join(memoryRoot(), "state.json");
    let state: {
      enabled?: boolean;
      facts?: Array<{ id: string; text: string; hits: number; updatedAt: number; pinned?: boolean }>;
      skills?: unknown[];
      fingerprints?: unknown[];
      dismissed?: string[];
      updatedAt?: number;
    };
    try {
      state = JSON.parse(readFileSync(stateFile, "utf8"));
    } catch {
      state = { enabled: true, facts: [], skills: [], fingerprints: [], dismissed: [] };
    }
    const text = `файл ${rec.path}: ${rec.lines} строк, ${rec.bytes} байт, самая длинная линия ${rec.maxLine}. Полный текст в Super Memory — memory_recall("файл ${path.basename(rec.path)}") или grep.`;
    const facts = Array.isArray(state.facts) ? state.facts : [];
    const marker = `файл ${rec.path}:`;
    const found = facts.find((fact) => String(fact.text || "").startsWith(marker));
    if (found) {
      found.text = text;
      found.hits = (found.hits || 1) + 1;
      found.updatedAt = rec.updatedAt;
    } else {
      facts.unshift({
        id: `file_${fileKey(rec.path)}`,
        text,
        hits: 1,
        updatedAt: rec.updatedAt,
      });
    }
    for (const chunk of rec.chunks.slice(0, 6)) {
      const chunkText = `файл ${rec.path} часть ${chunk.i}/${rec.chunks.length} строки ${chunk.from}-${chunk.to}: ${chunk.text}`.slice(0, 1180);
      const id = `file_${fileKey(rec.path)}_${chunk.i}`;
      const prev = facts.find((fact) => fact.id === id);
      if (prev) {
        prev.text = chunkText;
        prev.updatedAt = rec.updatedAt;
      } else {
        facts.push({ id, text: chunkText, hits: 1, updatedAt: rec.updatedAt });
      }
    }
    state.facts = facts.slice(0, 80);
    state.updatedAt = rec.updatedAt;
    mkdirSync(memoryRoot(), { recursive: true });
    writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  } catch {
    // vault must never break read_file
  }
}

export function loadHeavyFile(filePath: string): HeavyRecord | null {
  const file = path.join(filesDir(), `${fileKey(filePath)}.json`);
  try {
    return JSON.parse(readFileSync(file, "utf8")) as HeavyRecord;
  } catch {
    return null;
  }
}

export function recallHeavyFile(query: string, limit = 8): string[] {
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/");
  if (!q) return [];
  const dir = filesDir();
  if (!existsSync(dir)) return [];
  const scored: { score: number; text: string }[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    let rec: HeavyRecord;
    try {
      rec = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as HeavyRecord;
    } catch {
      continue;
    }
    const p = String(rec.path || "").toLowerCase().replace(/\\/g, "/");
    const base = path.basename(p);
    let score = 0;
    if (p.includes(q) || q.includes(p) || q.includes(base)) score += 5;
    if (q.includes("файл") || q.includes("file") || q.includes("таблиц") || q.includes("csv")) score += 1;
    for (const chunk of rec.chunks) {
      const blob = chunk.text.toLowerCase();
      if (q.length > 3 && blob.includes(q)) score += 3;
    }
    if (score <= 0) continue;
    scored.push({
      score,
      text: `файл: ${rec.path} (${rec.lines} строк, ${rec.bytes} байт, частей ${rec.chunks.length})`,
    });
    for (const chunk of rec.chunks.slice(0, 4)) {
      if (q.length > 3 && chunk.text.toLowerCase().includes(q)) {
        scored.push({
          score: score + 1,
          text: `файл ${rec.path} часть ${chunk.i} строки ${chunk.from}-${chunk.to}: ${chunk.text.slice(0, 400)}`,
        });
      }
    }
    if (!scored.some((row) => row.text.includes(`часть 1`) && row.text.includes(rec.path))) {
      const first = rec.chunks[0];
      if (first) {
        scored.push({
          score,
          text: `файл ${rec.path} часть ${first.i} строки ${first.from}-${first.to}: ${first.text.slice(0, 400)}`,
        });
      }
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const uniq: string[] = [];
  for (const row of scored) {
    if (uniq.includes(row.text)) continue;
    uniq.push(row.text);
    if (uniq.length >= limit) break;
  }
  return uniq;
}

export function formatHeavyPreview(
  filePath: string,
  text: string,
  offset?: number,
  limit?: number,
): string {
  const lines = String(text || "").split(/\r?\n/);
  const start = Math.max(1, offset ?? 1);
  const want = Math.min(PREVIEW_LINES, limit && limit > 0 ? limit : PREVIEW_LINES);
  const slice = lines.slice(start - 1, start - 1 + want);
  const rec = storeHeavyFile(filePath, text);
  const body = slice.map((line, i) => `${start + i}|${clipLine(line)}`).join("\n");
  const more = Math.max(0, lines.length - (start - 1 + slice.length));
  return [
    `файл ${filePath} — тяжёлый (${rec.bytes} байт, ${rec.lines} строк, макс. линия ${rec.maxLine}).`,
    `Полный текст положил в Super Memory (${rec.chunks.length} частей). Не читай его целиком снова.`,
    `Дальше: grep по этому пути или memory_recall("файл ${path.basename(filePath)}"). offset/limit — узкое окно.`,
    body,
    more ? `… ещё ${more} строк в Super Memory` : "",
    `[${filePath}]`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatLightPreview(
  filePath: string,
  text: string,
  offset?: number,
  limit?: number,
): string {
  const lines = String(text || "").split(/\r?\n/);
  const start = Math.max(1, offset ?? 1);
  const count = limit ?? lines.length;
  const slice = lines.slice(start - 1, start - 1 + count);
  const clipped = slice.some((line) => line.length > MAX_LINE);
  if (clipped) storeHeavyFile(filePath, text);
  return (
    slice.map((line, i) => `${start + i}|${clipLine(line)}`).join("\n") +
    (clipped
      ? `\nдлинные линии укоротил, полный текст в Super Memory: memory_recall("файл ${path.basename(filePath)}")`
      : "") +
    `\n[${filePath}]`
  );
}
