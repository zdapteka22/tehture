import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { verifyChangedFiles } from "../verifiers";
import { isDeniedShell } from "../guard";

export type CheckResult = {
  exitCode: number;
  output: string;
  command: string;
};

function makefileHas(repo: string, target: string): boolean {
  for (const name of ["Makefile", "makefile"]) {
    const file = path.join(repo, name);
    if (!existsSync(file)) continue;
    try {
      const text = readFileSync(file, "utf8");
      if (new RegExp(`^${target}\\s*:`, "m").test(text)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function hasMakeBin(): boolean {
  const proc = spawnSync("make", ["-v"], {
    encoding: "utf8",
    timeout: 4000,
    windowsHide: true,
    shell: false,
  });
  const text = `${proc.stdout || ""}${proc.stderr || ""}`;
  return (proc.status ?? 1) === 0 || /GNU Make|make /i.test(text);
}

export function detectCheck(repo: string): { command: string; args: string[]; cwd: string; label: string } | null {
  const canMake = hasMakeBin();
  if (canMake && makefileHas(repo, "check")) {
    return { command: "make", args: ["check"], cwd: repo, label: "make check" };
  }
  if (canMake && makefileHas(repo, "test")) {
    return { command: "make", args: ["test"], cwd: repo, label: "make test" };
  }
  const pkgPath = path.join(repo, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
      if (pkg.scripts?.test && !isDeniedShell(pkg.scripts.test)) {
        return { command: "npm", args: ["test", "--silent"], cwd: repo, label: "npm test" };
      }
    } catch {
      // ignore
    }
  }
  const rootFiles = existsSync(repo) ? readdirSync(repo) : [];
  const testFile = rootFiles.find((name) => /\.(test|spec)\.(js|mjs|cjs|ts)$/i.test(name));
  if (testFile) {
    return { command: "node", args: [testFile], cwd: repo, label: `node ${testFile}` };
  }
  if (existsSync(path.join(repo, "pytest.ini")) || existsSync(path.join(repo, "tests"))) {
    return { command: "python3", args: ["-m", "pytest", "-q"], cwd: repo, label: "pytest" };
  }
  return null;
}

/**
 * User phrase «просто напиши, без тестов» must not skip this.
 */
export function runCheck(repo: string, filesTouched: string[] = [], skipTests = false): CheckResult {
  void skipTests;
  const detected = detectCheck(repo);
  if (detected) {
    const bin = String(detected.command);
    const argv = detected.args.map((item) => String(item));
    const proc = spawnSync(bin, argv, {
      cwd: detected.cwd,
      encoding: "utf8",
      timeout: 60_000,
      windowsHide: true,
      shell: false,
    });
    const output = `${proc.stdout || ""}${proc.stderr || ""}`.trim().slice(0, 4000);
    return {
      exitCode: proc.status ?? 1,
      output: output || `exit ${proc.status}`,
      command: detected.label,
    };
  }

  const abs = filesTouched.map((rel) => (path.isAbsolute(rel) ? rel : path.join(repo, rel)));
  const report = verifyChangedFiles(abs);
  if (report.checks.length) {
    return {
      exitCode: report.ok ? 0 : 1,
      output: report.summary,
      command: "syntax",
    };
  }

  if (filesTouched.length) {
    const missing = abs.filter((file) => !existsSync(file));
    if (missing.length) {
      return { exitCode: 1, output: `missing: ${missing.join(", ")}`, command: "exists" };
    }
    return { exitCode: 0, output: "files exist", command: "exists" };
  }

  return { exitCode: 1, output: "no checkable artifact", command: "none" };
}
