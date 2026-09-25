import { readFileSync } from "node:fs";
import path from "node:path";

import {
  dragWorkWidth,
  loadWorkPinned,
  restoreWorkWidth,
  workDockShown,
  WORK_W_DEFAULT,
} from "../lib/work-pane";
import { crewReasonLine, liveWorkLine } from "../lib/live-status";

function ok(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL ${name}`);
    process.exit(1);
  }
  console.log(`ok ${name}`);
}

ok("closed stays closed even if mouse hovers", workDockShown(false, true) === false);
ok("open stays open", workDockShown(true, false) === true);
ok("open with hover still open", workDockShown(true, true) === true);
ok("default not pinned", loadWorkPinned(undefined) === false);
ok("only explicit true pins", loadWorkPinned(true) === true);
ok("restore tiny width", restoreWorkWidth(0) === WORK_W_DEFAULT);
ok("drag shut closes", dragWorkWidth(320, 300).open === false);

const root = process.cwd();
const chrome = readFileSync(path.join(root, "components/coder-app.tsx"), "utf8");
ok("header has Ход button", /onClick=\{toggleWorkPanel\}[\s\S]{0,80}Ход/.test(chrome));
ok("rail label is Ход", /label="Ход"/.test(chrome));
ok("no leftover header chip", !/planName} ·/.test(chrome) && !/quota\.tokensLeft/.test((chrome.split("Dialog")[0] || "")));
ok("fetches runtime sku", chrome.includes('fetch("/api/sku")') && chrome.includes("setFreeSku"));
ok("free sku hides leftover tokens", /freeSku \? "Бесплатный Fedor 3\.0"/.test(chrome));
ok("send opens ход", /openWorkPanel\(\);/.test(chrome));

const dock = readFileSync(path.join(root, "components/work-dock.tsx"), "utf8");
ok("dock title is Ход работы", dock.includes("Ход работы"));
ok("dock shows agent reasoning", dock.includes("Рассуждения агентов"));
ok("dock shows doing/idle", dock.includes("Что делают") && dock.includes("агенты ничего не делают"));

ok(
  "live line shows crew note",
  liveWorkLine({
    id: "a",
    role: "assistant",
    content: "",
    crew: [{ role: "coder", label: "Кодер", status: "running", note: "Сначала открою файл и посмотрю тест." }],
  }).includes("открою файл"),
);
ok(
  "idle line is явный простой",
  liveWorkLine({ id: "b", role: "assistant", content: "" }) === "агенты ничего не делают",
);
ok(
  "reason line names the seat",
  crewReasonLine({ role: "reviewer", label: "Ревьюер", status: "running", note: "" }).includes("думает"),
);

console.log("work-pane ok");
