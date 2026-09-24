import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { applyHarness, ensureHarness, inspectHarness, runHarnessAction } from "../lib/build-harness";

function tmp(name: string): string {
  return mkdtempSync(path.join(os.tmpdir(), name));
}

function main() {
  const empty = tmp("fedor-harness-empty-");
  assert.equal(ensureHarness(empty).wrote.length, 0);

  const js = tmp("fedor-harness-js-");
  writeFileSync(path.join(js, "package.json"), JSON.stringify({ name: "demo", version: "1.0.0" }), "utf8");
  writeFileSync(path.join(js, "add.js"), "module.exports = { add: (a, b) => a + b };\n", "utf8");

  const applied = applyHarness(js);
  assert.ok(applied.wrote.includes("Makefile") || existsSync(path.join(js, "Makefile")));
  assert.ok(existsSync(path.join(js, "CHANGELOG.md")), "changelog must be written");
  const pkg = JSON.parse(readFileSync(path.join(js, "package.json"), "utf8")) as {
    scripts?: { test?: string; lint?: string };
  };
  assert.ok(pkg.scripts?.test, "npm-test");
  assert.ok(pkg.scripts?.lint, "lint script");

  const report = inspectHarness(js);
  assert.ok(report.present.includes("lint"), `lint present, got ${report.present.join(",")}`);
  assert.ok(report.present.includes("changelog"), `changelog present, got ${report.present.join(",")}`);

  const again = ensureHarness(js);
  assert.ok(inspectHarness(js).present.includes("lint"));
  assert.ok(inspectHarness(js).present.includes("changelog"));
  void again;

  const log = runHarnessAction(js, "changelog", { title: "fix", note: "тест" });
  assert.match(log.output, /changelog/);
  assert.match(readFileSync(path.join(js, "CHANGELOG.md"), "utf8"), /тест/);

  rmSync(empty, { recursive: true, force: true });
  rmSync(js, { recursive: true, force: true });
  console.log("build-harness ok");
}

main();
