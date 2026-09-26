/** While a job is live, a follow-up is queued. Only an explicit stop aborts. */

import { looksLikeStopCommand } from "./fyodor/intent";

export type LoopAttach = "stop" | "queue" | "start";

export function shouldAttachToRunningTurn(text: string, running: boolean): LoopAttach {
  if (looksLikeStopCommand(text)) return "stop";
  if (running) return "queue";
  return "start";
}

export function formatDrainedInterjections(items: string[]): string {
  const clean = items.map((item) => String(item || "").trim()).filter(Boolean);
  if (!clean.length) return "";
  return [
    "Уточнение пользователя, пока шёл ход. Не начинай задачу заново. Продолжи текущую работу с учётом этого:",
    ...clean.map((item) => `— ${item}`),
  ].join("\n");
}
