import { readFileSync } from "node:fs";
import path from "node:path";

import {
  countWorkMoves,
  isLiveOutcomeJob,
  looksLikeOperateSuccess,
  looksLikeSingleAction,
  MIN_WORK_MOVES,
  shouldNudgeUntilGoal,
} from "../lib/fyodor/until-goal";

function ok(name: string, cond: unknown) {
  if (!cond) {
    console.error("FAIL", name);
    process.exit(1);
  }
  console.log("ok  ", name);
}

const src = readFileSync(path.join(process.cwd(), "lib/fyodor/until-goal.ts"), "utf8");
ok("weak открыл/готово fallback gone", !/страница открыта\|перешёл\|перешел\|готово/.test(src));
ok("done word not a live success", !/\\bdone\\b/.test(src));
ok("min moves is 3", MIN_WORK_MOVES === 3);
ok("nudge text mentions 1-2 moves", /Один-два хода/.test(src));

ok("vk community is live outcome", isLiveOutcomeJob("создай сообщество вк про котов"));
ok("fill form is live outcome", isLiveOutcomeJob("зайди на сайт и заполни форму"));
ok("plain open url is not live outcome", !isLiveOutcomeJob("открой https://example.com"));
ok("chat question is not live outcome", !isLiveOutcomeJob("что такое react"));

ok("two clicks count as two moves", countWorkMoves(["browser_navigate", "browser_snapshot", "browser_click"]) === 2);
ok("look-only ignored", countWorkMoves(["read_file", "list_dir", "browser_snapshot"]) === 0);

ok(
  "готово after one click is not success",
  !looksLikeOperateSuccess("создай сообщество вк", "Готово, открыл страницу"),
);
ok(
  "group_id is success",
  looksLikeOperateSuccess("создай сообщество вк", 'создал сообщество group_id: 12345'),
);

ok("open folder is single action", looksLikeSingleAction("открой папку Документы"));
ok("vk job is not single action", !looksLikeSingleAction("создай сообщество вк"));
ok("fix file is not single action", !looksLikeSingleAction("исправь баг в src/price.js"));

function nudge(partial: Partial<Parameters<typeof shouldNudgeUntilGoal>[0]>) {
  return shouldNudgeUntilGoal({
    userText: "",
    content: "",
    usedTools: [],
    changedPaths: [],
    nudges: 0,
    ...partial,
  });
}

ok(
  "vk: 1 click + готово keeps going",
  nudge({
    userText: "создай сообщество вконтакте про котов",
    content: "Готово, открыл страницу.",
    usedTools: ["browser_navigate"],
  }) === true,
);

ok(
  "vk: 2 clicks + открыл keeps going",
  nudge({
    userText: "создай сообщество вк",
    content: "Открыл, перешёл дальше.",
    usedTools: ["browser_navigate", "browser_click"],
  }) === true,
);

ok(
  "vk: real group_id stops",
  nudge({
    userText: "создай сообщество вк",
    content: "сообщество создано group_id: 99881",
    usedTools: ["browser_navigate", "browser_click", "browser_type", "run_terminal_cmd"],
  }) === false,
);

ok(
  "open url after navigate stops",
  nudge({
    userText: "открой https://example.com",
    content: "Открыл example.com",
    usedTools: ["browser_navigate"],
  }) === false,
);

ok(
  "code fix after write stops",
  nudge({
    userText: "исправь баг в src/price.js",
    content: "Поправил файл.",
    usedTools: ["write_file"],
    changedPaths: ["src/price.js"],
  }) === false,
);

ok(
  "desktop note after write stops",
  nudge({
    userText: "напиши текстовый файл заметка на рабочем столе",
    content: "Записал заметку на рабочий стол.",
    usedTools: ["write_pc_file"],
    changedPaths: ["C:/Users/Dir/Desktop/zametka.txt"],
  }) === false,
);

ok(
  "code fix without write keeps going",
  nudge({
    userText: "исправь баг в src/price.js",
    content: "Сейчас поправлю файл.",
    usedTools: [],
  }) === true,
);

ok(
  "user stop is respected",
  nudge({
    userText: "стоп",
    content: "Останавливаюсь",
    usedTools: ["browser_click"],
  }) === false,
);

ok(
  "chat question does not force tools",
  nudge({
    userText: "что такое массив",
    content: "Массив — это список значений.",
    usedTools: [],
  }) === false,
);

const crew = readFileSync(path.join(process.cwd(), "lib/crew/run.ts"), "utf8");
ok("crew asks guard", /decideGuardStop/.test(crew));
ok("crew stops when work is done", /stopDone/.test(crew) && /needNudge/.test(crew));
ok("crew writes receipts", /noteGuardTool/.test(crew));

const prompt = readFileSync(path.join(process.cwd(), "lib/prompt.ts"), "utf8");
ok("prompt forbids stop after one or two tools", /one or two tools/.test(prompt));
ok("prompt keeps Super Memory", prompt.includes("getMemoryPromptBlock()"));
ok("prompt keeps click kit", /click_kit/.test(prompt));

console.log("until-goal ok");
