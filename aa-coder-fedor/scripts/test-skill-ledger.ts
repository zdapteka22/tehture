import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fedor-skills-"));
  process.env.FEDOR_SKILL_DIR = dir;

  const {
    concludeSkillTask,
    domainOfTool,
    getSkillPromptBlock,
    preferredToolsFor,
    recallSkillLines,
    recallSkills,
    recordSkillFromTool,
    setSkillTask,
    skillEngineName,
  } = await import("../lib/skill-ledger");

  function ok(name: string, cond: unknown) {
    if (!cond) {
      console.error("FAIL", name);
      rmSync(dir, { recursive: true, force: true });
      process.exit(1);
    }
    console.log("ok  ", name);
  }

  try {
    ok("engine is minisearch", skillEngineName() === "minisearch");
    ok("domains", domainOfTool("browser_click") === "browser" && domainOfTool("pc_click") === "pc");
    ok("code domain", domainOfTool("write_file") === "code" && domainOfTool("run_terminal_cmd") === "shell");

    setSkillTask("настрой приём платежей ЮKassa");
    const stale = recordSkillFromTool(
      "browser_click",
      { ref: "e32" },
      `клик «Настройки» прошёл, URL тот же. Раскрылось меню: Магазин, Интеграция.
Это аккордеон, не ссылка. Не вызывай click_kit и не кликай ту же кнопку снова.
url: https://yookassa.ru/my/payments`,
    );
    ok("accordion is tactic", stale?.outcome === "tactic" && stale.domain === "browser");

    const wrote = recordSkillFromTool("write_file", { path: "C:\\\\Users\\\\Name\\\\note.txt" }, "Wrote file note.txt");
    ok("write is win", wrote?.outcome === "win" && wrote.domain === "code");

    const miss = recordSkillFromTool("run_terminal_cmd", { command: "dir" }, "error: not found");
    ok("shell miss is lose", miss?.outcome === "lose" && miss.domain === "shell");

    const again = recordSkillFromTool(
      "browser_press",
      { key: "Enter" },
      `клик «Настройки» прошёл, URL тот же. Раскрылось меню: Магазин, Интеграция.
Это аккордеон, не ссылка. Не вызывай click_kit.`,
    );
    ok("second accordion kept", Boolean(again));

    const task = concludeSkillTask({
      task: "настрой приём платежей ЮKassa",
      usedTools: ["browser_click", "browser_press", "write_file"],
      content: "открыл Магазин",
      ok: true,
    });
    ok("task insight", Boolean(task?.text) && (task?.votes || 0) >= 2);

    const hits = recallSkills("ЮKassa настройки меню", 6);
    ok("recall accordion", hits.some((item) => /аккордеон|меню|тактик/i.test(item.text)));
    ok("insights not deleted", hits.length >= 1);

    const lines = recallSkillLines("платежи юкасса", 6);
    ok("skill lines", lines.some((line) => /навык/.test(line)));

    const browserPref = preferredToolsFor("browser", "юкасса");
    ok("browser prefers a tool", browserPref.length >= 1);

    const block = getSkillPromptBlock("настрой приём платежей ЮKassa");
    ok("prompt block", /<skill_memory>/.test(block) && /не удаля/i.test(block));

    const raw = JSON.parse(readFileSync(path.join(dir, "ledger.json"), "utf8")) as {
      experiences: unknown[];
      insights: unknown[];
    };
    const before = raw.experiences.length;
    recordSkillFromTool("pc_click", { ref: "e1" }, "клик по Ок");
    const after = JSON.parse(readFileSync(path.join(dir, "ledger.json"), "utf8")) as {
      experiences: unknown[];
      insights: unknown[];
    };
    ok("never deletes traces", after.experiences.length === before + 1);
    ok("insights stay", after.insights.length >= raw.insights.length);

    console.log("skill-ledger ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
