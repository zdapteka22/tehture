import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  clipLine,
  formatHeavyPreview,
  formatLightPreview,
  isHeavyText,
  recallHeavyFile,
  storeHeavyFile,
} from "../lib/heavy-file";
import { recallMemory } from "../lib/super-memory";

async function main() {
  const tmp = mkdtempSync(path.join(os.tmpdir(), "fedor-heavy-"));
  process.env.GROK_MEMORY_DIR = tmp;
  const table = ["col1,col2,col3", ...Array.from({ length: 80 }, (_, i) => `${"x".repeat(300)},row${i},${"y".repeat(200)}`)].join("\n");
  assert.equal(isHeavyText("short\nfile\n"), false);
  assert.equal(isHeavyText(table), true);
  assert.match(clipLine("a".repeat(300)), /Super Memory/);

  const preview = formatHeavyPreview("report.csv", table);
  assert.match(preview, /тяжёл/);
  assert.match(preview, /Super Memory/);
  assert.match(preview, /memory_recall/);
  assert.ok(!preview.includes("x".repeat(250)), "long line must be clipped");
  assert.ok(preview.split("\n").length < 60, "preview must stay short");

  const rec = storeHeavyFile("report.csv", table);
  assert.ok(rec.chunks.length >= 2);
  const hits = recallHeavyFile("файл report.csv");
  assert.ok(hits.some((row) => /report\.csv/.test(row)));
  const mem = recallMemory("файл report.csv");
  assert.ok(mem.some((row) => /report\.csv/.test(row)), "Super Memory must recall the heavy file");

  const light = formatLightPreview("tiny.txt", "hello\nworld");
  assert.match(light, /1\|hello/);
  assert.match(light, /\[tiny\.txt\]/);

  const longOne = formatLightPreview("wide.txt", `ok\n${"z".repeat(400)}`);
  assert.match(longOne, /Super Memory/);
  assert.ok(!longOne.includes("z".repeat(250)));

  writeFileSync(path.join(tmp, "note.txt"), "x");
  rmSync(tmp, { recursive: true, force: true });
  console.log("heavy-file ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
