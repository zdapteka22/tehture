import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { detectCheck, runCheck, type CheckResult } from "./fyodor/test-runner";

export const HARNESS_PIECES = [
  "make",
  "npm-test",
  "lint",
  "precommit",
  "changelog",
  "version",
  "cache",
  "audit",
  "compose",
  "ci",
  "pack",
] as const;

export type HarnessPiece = (typeof HARNESS_PIECES)[number];

export type HarnessReport = {
  repo: string;
  present: HarnessPiece[];
  missing: HarnessPiece[];
  check: string | null;
};

const SAFE_APPLY: HarnessPiece[] = ["make", "npm-test", "lint", "changelog", "cache", "version"];

function readText(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function writeNew(file: string, body: string): boolean {
  if (existsSync(file)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, body, "utf8");
  return true;
}

function hasMakefile(repo: string): boolean {
  return existsSync(path.join(repo, "Makefile")) || existsSync(path.join(repo, "makefile"));
}

function readPkg(repo: string): { name?: string; version?: string; scripts?: Record<string, string> } | null {
  const file = path.join(repo, "package.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as {
      name?: string;
      version?: string;
      scripts?: Record<string, string>;
    };
  } catch {
    return null;
  }
}

function looksLikeCodeRepo(repo: string): boolean {
  if (hasMakefile(repo) || existsSync(path.join(repo, "package.json"))) return true;
  if (existsSync(path.join(repo, "pyproject.toml")) || existsSync(path.join(repo, "requirements.txt"))) return true;
  try {
    return readdirSync(repo).some((name) => /\.(js|mjs|cjs|ts|tsx|py|go|rs)$/i.test(name));
  } catch {
    return false;
  }
}

function hasLint(repo: string): boolean {
  const pkg = readPkg(repo);
  if (pkg?.scripts?.lint) return true;
  return [
    "eslint.config.js",
    "eslint.config.mjs",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
    "pyproject.toml",
  ].some((name) => existsSync(path.join(repo, name)));
}

function hasCi(repo: string): boolean {
  const dir = path.join(repo, ".github", "workflows");
  if (!existsSync(dir)) return false;
  try {
    return readdirSync(dir).some((name) => /\.(yml|yaml)$/i.test(name));
  } catch {
    return false;
  }
}

function hasCompose(repo: string): boolean {
  return ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml"].some((name) =>
    existsSync(path.join(repo, name)),
  );
}

function hasPack(repo: string): boolean {
  if (existsSync(path.join(repo, "scripts", "pack-release.sh"))) return true;
  if (existsSync(path.join(repo, "scripts", "pack-windows.sh"))) return true;
  const pkg = readPkg(repo);
  return Boolean(pkg?.scripts?.["kit:windows"] || pkg?.scripts?.pack);
}

function hasCacheIgnore(repo: string): boolean {
  const text = readText(path.join(repo, ".gitignore"));
  return /(?:^|\/)node_modules\/?$/m.test(text) || /(?:^|\/)\.next\/?$/m.test(text);
}

function hasAudit(repo: string): boolean {
  const make = readText(path.join(repo, "Makefile")) + readText(path.join(repo, "makefile"));
  if (/^audit\s*:/m.test(make)) return true;
  return Boolean(readPkg(repo)?.scripts?.audit);
}

export function inspectHarness(repo: string): HarnessReport {
  const root = path.resolve(repo || ".");
  const present: HarnessPiece[] = [];
  const add = (piece: HarnessPiece, ok: boolean) => {
    if (ok) present.push(piece);
  };
  add("make", hasMakefile(root));
  add("npm-test", Boolean(readPkg(root)?.scripts?.test) || Boolean(detectCheck(root)));
  add("lint", hasLint(root));
  add("precommit", existsSync(path.join(root, ".git", "hooks", "pre-commit")));
  add("changelog", existsSync(path.join(root, "CHANGELOG.md")));
  add("version", Boolean(readPkg(root)?.version));
  add("cache", hasCacheIgnore(root));
  add("audit", hasAudit(root));
  add("compose", hasCompose(root));
  add("ci", hasCi(root));
  add("pack", hasPack(root));
  return {
    repo: root,
    present,
    missing: HARNESS_PIECES.filter((piece) => !present.includes(piece)),
    check: detectCheck(root)?.label || null,
  };
}

function makefileBody(repo: string): string {
  const pkg = readPkg(repo);
  const testLine = pkg?.scripts?.test ? "\tnpm test" : "\tnode --test";
  const lintLine = pkg?.scripts?.lint ? "\tnpm run lint" : "\t@echo no lint";
  return [
    ".PHONY: check test lint audit",
    "check:",
    testLine,
    "test:",
    testLine,
    "lint:",
    lintLine,
    "audit:",
    pkg ? "\tnpm audit --omit=dev" : "\t@echo no npm",
    "",
  ].join("\n");
}

function ensureNpmTest(repo: string): boolean {
  const file = path.join(repo, "package.json");
  const pkg = readPkg(repo);
  if (!pkg) return false;
  if (pkg.scripts?.test) return false;
  const next = {
    ...pkg,
    scripts: { ...(pkg.scripts || {}), test: "node --test" },
  };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return true;
}

function ensureLint(repo: string): boolean {
  const file = path.join(repo, "package.json");
  const pkg = readPkg(repo);
  if (!pkg) {
    if (hasMakefile(repo)) return false;
    return writeNew(
      path.join(repo, "scripts", "lint.cmd"),
      "@echo off\nif exist Makefile (where make >nul 2>nul && make lint & exit /b %ERRORLEVEL%)\necho no lint\nexit /b 0\n",
    );
  }
  if (pkg.scripts?.lint) return false;
  const hasEslint = [
    "eslint.config.js",
    "eslint.config.mjs",
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.json",
  ].some((name) => existsSync(path.join(repo, name)));
  const next = {
    ...pkg,
    scripts: {
      ...(pkg.scripts || {}),
      lint: hasEslint ? "eslint ." : "node --check package.json",
    },
  };
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return true;
}

function ensureVersion(repo: string): boolean {
  const file = path.join(repo, "package.json");
  const pkg = readPkg(repo);
  if (!pkg || pkg.version) return false;
  writeFileSync(file, `${JSON.stringify({ ...pkg, version: "0.1.0" }, null, 2)}\n`, "utf8");
  return true;
}

function ensureGitignore(repo: string): boolean {
  const file = path.join(repo, ".gitignore");
  const extra = ["node_modules/", ".next/cache/", "dist/*.map", "*.log"];
  const now = readText(file);
  const add = extra.filter((line) => !now.split(/\r?\n/).includes(line));
  if (!add.length && now) return false;
  const body = `${now.replace(/\s*$/, "")}${now ? "\n" : ""}${add.join("\n")}\n`;
  writeFileSync(file, body, "utf8");
  return true;
}

function ensureChangelog(repo: string): boolean {
  return writeNew(
    path.join(repo, "CHANGELOG.md"),
    "# Changelog\n\n## Unreleased\n\n- проект подключён к Build Harness кодера.\n",
  );
}

function ensurePrecommit(repo: string): boolean {
  if (!existsSync(path.join(repo, ".git"))) return false;
  const hook = path.join(repo, ".git", "hooks", "pre-commit");
  const body = `#!/bin/sh
if command -v make >/dev/null 2>&1 && [ -f Makefile ]; then
  make check
  exit $?
fi
if [ -f package.json ]; then
  npm test
  exit $?
fi
exit 0
`;
  return writeNew(hook, body);
}

function ensureCi(repo: string): boolean {
  if (!existsSync(path.join(repo, ".git"))) return false;
  return writeNew(
    path.join(repo, ".github", "workflows", "check.yml"),
    [
      "name: check",
      "on: [push, pull_request]",
      "jobs:",
      "  check:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - uses: actions/checkout@v4",
      "      - uses: actions/setup-node@v4",
      "        with:",
      "          node-version: 22",
      "      - run: npm ci --ignore-scripts || npm install --ignore-scripts",
      "      - run: npm test --silent",
      "",
    ].join("\n"),
  );
}

function ensureCompose(repo: string): boolean {
  if (!existsSync(path.join(repo, "Dockerfile"))) return false;
  return writeNew(
    path.join(repo, "docker-compose.yml"),
    ["services:", "  app:", "    build: .", "    ports:", "      - \"3000:3000\"", ""].join("\n"),
  );
}

function ensurePackScript(repo: string): boolean {
  return writeNew(
    path.join(repo, "scripts", "pack-release.sh"),
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "ROOT=\"$(cd \"$(dirname \"$0\")/..\" && pwd)\"",
      "OUT=\"$ROOT/dist/release.zip\"",
      "mkdir -p \"$ROOT/dist\"",
      "if [[ -d \"$ROOT/dist\" ]]; then",
      "  tar -a -cf \"$OUT\" -C \"$ROOT\" --exclude release.zip dist || tar -czf \"${OUT%.zip}.tgz\" -C \"$ROOT\" dist",
      "fi",
      "echo \"$OUT\"",
      "",
    ].join("\n"),
  );
}

function ensureCheckCmd(repo: string): boolean {
  return writeNew(
    path.join(repo, "scripts", "check.cmd"),
    [
      "@echo off",
      "if exist Makefile (",
      "  where make >nul 2>nul && (make check & exit /b %ERRORLEVEL%)",
      ")",
      "if exist package.json (",
      "  call npm test --silent",
      "  exit /b %ERRORLEVEL%",
      ")",
      "echo no check",
      "exit /b 1",
      "",
    ].join("\n"),
  );
}

export function applyHarness(repo: string, pieces?: HarnessPiece[]): { wrote: string[]; skipped: string[]; report: HarnessReport } {
  const root = path.resolve(repo || ".");
  const want = (pieces?.length ? pieces : SAFE_APPLY).filter((piece): piece is HarnessPiece =>
    (HARNESS_PIECES as readonly string[]).includes(piece),
  );
  const wrote: string[] = [];
  const skipped: string[] = [];
  const mark = (rel: string, changed: boolean) => {
    if (changed) wrote.push(rel);
    else skipped.push(rel);
  };

  for (const piece of want) {
    if (piece === "make") mark("Makefile", writeNew(path.join(root, "Makefile"), makefileBody(root)));
    else if (piece === "npm-test") mark("package.json", ensureNpmTest(root));
    else if (piece === "lint") mark("package.json", ensureLint(root));
    else if (piece === "precommit") mark(".git/hooks/pre-commit", ensurePrecommit(root));
    else if (piece === "changelog") mark("CHANGELOG.md", ensureChangelog(root));
    else if (piece === "version") mark("package.json", ensureVersion(root));
    else if (piece === "cache") mark(".gitignore", ensureGitignore(root));
    else if (piece === "audit") mark("Makefile", hasMakefile(root) ? false : writeNew(path.join(root, "Makefile"), makefileBody(root)));
    else if (piece === "compose") mark("docker-compose.yml", ensureCompose(root));
    else if (piece === "ci") mark(".github/workflows/check.yml", ensureCi(root));
    else if (piece === "pack") {
      mark("scripts/pack-release.sh", ensurePackScript(root));
      mark("scripts/check.cmd", ensureCheckCmd(root));
    }
  }
  return { wrote, skipped, report: inspectHarness(root) };
}

/** If the folder is a code project and has no check, add the safe pieces. */
export function ensureHarness(repo: string): { wrote: string[]; report: HarnessReport } {
  const root = path.resolve(repo || ".");
  const before = inspectHarness(root);
  if (!looksLikeCodeRepo(root)) return { wrote: [], report: before };
  const need = before.missing.filter((piece) => SAFE_APPLY.includes(piece));
  if (!need.length) return { wrote: [], report: before };
  const applied = applyHarness(root, need);
  return { wrote: applied.wrote, report: applied.report };
}

export function appendChangelog(repo: string, title: string, note = ""): { path: string } {
  const file = path.join(path.resolve(repo), "CHANGELOG.md");
  const head = String(title || "").trim() || "update";
  const extra = String(note || "").trim();
  const day = new Date().toISOString().slice(0, 10);
  const block = `## ${day} — ${head}\n\n${extra ? `- ${extra}\n` : "- правки кодера.\n"}\n`;
  if (!existsSync(file)) {
    writeFileSync(file, `# Changelog\n\n${block}`, "utf8");
    return { path: file };
  }
  const now = readText(file);
  if (/^## Unreleased/m.test(now)) {
    writeFileSync(file, now.replace(/^## Unreleased\s*\n+/m, `## Unreleased\n\n${block}`), "utf8");
  } else {
    writeFileSync(file, now.replace(/^(# Changelog\s*\n+)/, `$1${block}`), "utf8");
  }
  return { path: file };
}

export function bumpVersion(repo: string, kind: "patch" | "minor" | "major" = "patch"): { version: string; path: string } {
  const file = path.join(path.resolve(repo), "package.json");
  const pkg = readPkg(repo);
  if (!pkg) throw new Error("package.json нет — версию некуда писать");
  const [major, minor, patch] = String(pkg.version || "0.1.0")
    .split(".")
    .map((part) => Number(part) || 0);
  const next =
    kind === "major"
      ? `${major + 1}.0.0`
      : kind === "minor"
        ? `${major}.${minor + 1}.0`
        : `${major}.${minor}.${patch + 1}`;
  writeFileSync(file, `${JSON.stringify({ ...pkg, version: next }, null, 2)}\n`, "utf8");
  return { version: next, path: file };
}

export function packRelease(repo: string): { path: string; bytes: number } {
  const root = path.resolve(repo);
  const dist = path.join(root, "dist");
  mkdirSync(dist, { recursive: true });
  const out = path.join(dist, "release.zip");
  const proc = spawnSync("tar", ["-a", "-cf", out, "-C", root, "--exclude", "release.zip", "dist"], {
    encoding: "utf8",
    timeout: 30_000,
    windowsHide: true,
  });
  if ((proc.status ?? 1) !== 0 || !existsSync(out)) {
    const tgz = path.join(dist, "release.tgz");
    const fallback = spawnSync("tar", ["-czf", tgz, "-C", root, "dist"], {
      encoding: "utf8",
      timeout: 30_000,
      windowsHide: true,
    });
    if ((fallback.status ?? 1) !== 0 || !existsSync(tgz)) {
      throw new Error((proc.stderr || fallback.stderr || "pack failed").slice(0, 400));
    }
    return { path: tgz, bytes: readFileSync(tgz).length };
  }
  return { path: out, bytes: readFileSync(out).length };
}

export function formatHarnessReport(report: HarnessReport): string {
  const present = report.present.length ? report.present.join(", ") : "нет";
  const missing = report.missing.length ? report.missing.join(", ") : "нет";
  return [
    `Build Harness: check=${report.check || "нет"}`,
    `есть: ${present}`,
    `нет: ${missing}`,
  ].join("\n");
}

export function runHarnessAction(
  repo: string,
  action: string,
  opts: { pieces?: string[]; title?: string; note?: string; bump?: string } = {},
): { output: string; changedPaths?: string[] } {
  const root = path.resolve(repo || ".");
  const act = String(action || "inspect").toLowerCase();
  if (act === "inspect" || act === "status") {
    return { output: formatHarnessReport(inspectHarness(root)) };
  }
  if (act === "apply" || act === "ensure") {
    const pieces = (opts.pieces || []).filter((item): item is HarnessPiece =>
      (HARNESS_PIECES as readonly string[]).includes(item),
    );
    const applied = act === "ensure" ? ensureHarness(root) : applyHarness(root, pieces.length ? pieces : undefined);
    const wrote = "wrote" in applied ? applied.wrote : [];
    return {
      output: `${formatHarnessReport(applied.report)}\nwrote: ${wrote.join(", ") || "ничего (уже было)"}`,
      changedPaths: wrote.map((rel) => path.join(root, rel)),
    };
  }
  if (act === "check") {
    const result: CheckResult = runCheck(root);
    return { output: `${result.command} exit=${result.exitCode}\n${result.output}`.trim() };
  }
  if (act === "changelog") {
    const hit = appendChangelog(root, String(opts.title || "update"), String(opts.note || ""));
    return { output: `changelog: ${hit.path}`, changedPaths: [hit.path] };
  }
  if (act === "version") {
    const bump = opts.bump === "major" || opts.bump === "minor" ? opts.bump : "patch";
    const hit = bumpVersion(root, bump);
    return { output: `version ${hit.version}`, changedPaths: [hit.path] };
  }
  if (act === "pack") {
    const hit = packRelease(root);
    return { output: `pack ${hit.path} ${hit.bytes} bytes`, changedPaths: [hit.path] };
  }
  return { output: `unknown harness action: ${action}` };
}
