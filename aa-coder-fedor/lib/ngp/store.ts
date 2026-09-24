import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type NgpNote = {
  text: string;
  kind: "preference" | "style" | "decision" | "value";
  level: "user" | "project";
  votes: number;
  at: number;
};

export type NgpState = {
  notes: NgpNote[];
  updatedAt: number;
};

const HOT = 400;

export function ngpRoot(): string {
  const override = process.env.FEDOR_NGP_DIR?.trim();
  if (override) return path.resolve(override);
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "ngp");
  }
  return path.join(os.homedir(), ".fedor-ngp");
}

function fileOf(level: "user" | "project"): string {
  return path.join(ngpRoot(), level === "user" ? "user.json" : "project.json");
}

export function emptyNgp(): NgpState {
  return { notes: [], updatedAt: 0 };
}

export function readNgp(level: "user" | "project"): NgpState {
  try {
    const file = fileOf(level);
    if (!existsSync(file)) return emptyNgp();
    const parsed = JSON.parse(readFileSync(file, "utf8")) as NgpState;
    if (!parsed || !Array.isArray(parsed.notes)) return emptyNgp();
    return parsed;
  } catch {
    return emptyNgp();
  }
}

export function writeNgp(level: "user" | "project", state: NgpState): void {
  mkdirSync(ngpRoot(), { recursive: true });
  const next = { ...state, updatedAt: Date.now() };
  const dest = fileOf(level);
  const tmp = `${dest}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  try {
    renameSync(tmp, dest);
  } catch {
    writeFileSync(dest, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  }
}

function sameText(a: string, b: string): boolean {
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Keep every note. A repeat only raises votes. */
export function rememberNgp(note: Omit<NgpNote, "votes" | "at"> & { votes?: number }): NgpNote {
  const state = readNgp(note.level);
  const text = String(note.text || "").replace(/\s+/g, " ").trim().slice(0, 220);
  if (!text) {
    return { text: "", kind: note.kind, level: note.level, votes: 0, at: Date.now() };
  }
  const hit = state.notes.find((item) => item.kind === note.kind && sameText(item.text, text));
  if (hit) {
    hit.votes += 1;
    hit.at = Date.now();
    writeNgp(note.level, state);
    return hit;
  }
  const created: NgpNote = {
    text,
    kind: note.kind,
    level: note.level,
    votes: note.votes ?? 1,
    at: Date.now(),
  };
  state.notes.push(created);
  if (state.notes.length > HOT) state.notes = state.notes.slice(-HOT);
  writeNgp(note.level, state);
  return created;
}

export function recallNgp(query = "", limit = 8): NgpNote[] {
  const words = String(query || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2);
  const all = [...readNgp("user").notes, ...readNgp("project").notes];
  const scored = all.map((note) => {
    const hay = note.text.toLowerCase();
    let score = note.votes + (note.level === "user" ? 1 : 0);
    for (const word of words) if (hay.includes(word)) score += 3;
    return { note, score };
  });
  scored.sort((a, b) => b.score - a.score || b.note.at - a.note.at);
  return scored.slice(0, limit).map((row) => row.note);
}
