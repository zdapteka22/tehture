import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type VerifyCheck = {
  path: string;
  ok: boolean;
  detail: string;
};

export type VerifyReport = {
  ok: boolean;
  checks: VerifyCheck[];
  summary: string;
};

function run(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const proc = spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    timeout: 12000,
    windowsHide: true,
  });
  const out = `${proc.stdout || ""}${proc.stderr || ""}`.trim().slice(0, 800);
  return { ok: proc.status === 0, out: out || `exit ${proc.status}` };
}

function checkFile(filePath: string): VerifyCheck | null {
  if (!filePath || !existsSync(filePath)) return null;
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    try {
      JSON.parse(readFileSync(filePath, "utf8"));
      return { path: filePath, ok: true, detail: "JSON ok" };
    } catch (error) {
      return { path: filePath, ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
  if ([".js", ".mjs", ".cjs"].includes(ext)) {
    const result = run("node", ["--check", filePath]);
    return { path: filePath, ok: result.ok, detail: result.ok ? "node --check ok" : result.out };
  }
  if ([".ts", ".tsx", ".mts"].includes(ext)) {
    return { path: filePath, ok: true, detail: "ts: syntax left to the critic + runtime" };
  }
  if (ext === ".py") {
    const result = run("python3", ["-m", "py_compile", filePath]);
    return { path: filePath, ok: result.ok, detail: result.ok ? "py_compile ok" : result.out };
  }
  return null;
}

export function verifyChangedFiles(paths: string[]): VerifyReport {
  const unique = [...new Set(paths.filter(Boolean))].slice(0, 12);
  const checks: VerifyCheck[] = [];
  for (const filePath of unique) {
    const check = checkFile(filePath);
    if (check) checks.push(check);
  }
  const failed = checks.filter((item) => !item.ok);
  const summary = checks.length
    ? failed.length
      ? `Проверки: ${failed.length} из ${checks.length} с ошибкой. ${failed.map((item) => `${path.basename(item.path)}: ${item.detail}`).join("; ")}`
      : `Проверки: ${checks.length} файлов, ошибок нет.`
    : "Проверять было нечего (нет JS/TS/JSON/PY).";
  return { ok: failed.length === 0, checks, summary };
}

export function extractiveBrief(texts: string[], maxChars = 900): string {
  const parts = texts
    .map((text) => String(text || "").replace(/\s+/g, " ").trim())
    .filter((text) => text.length > 8)
    .map((text) => (text.length > 180 ? `${text.slice(0, 177)}…` : text));
  let out = "";
  for (const part of parts) {
    if (out.length + part.length > maxChars) break;
    out += (out ? "\n" : "") + `- ${part}`;
  }
  return out;
}
