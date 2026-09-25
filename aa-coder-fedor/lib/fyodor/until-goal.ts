import { isHardBoundary } from "../agent-boundary";
import { isKnownTool, looksLikeFalseDone } from "../tool-guard";
import {
  looksLikeAskingUser,
  looksLikeBrowserWork,
  looksLikeKeepGoing,
  looksLikeNarratingWork,
  looksLikeOpen,
  looksLikeOperate,
  looksLikeSimpleHostTask,
  looksLikeHangComplaint,
  looksLikeStopCommand,
  looksLikeWrite,
  looksUnfinished,
  taskNeedsWork,
} from "./intent";

export const GOAL_NUDGE =
  "Стоп. Ты описал шаг словами вместо вызова инструмента. Один-два хода и слово «готово» — не конец. Несколько browser_* кликов — не конец, в браузере сам не останавливайся. Если клик упал ошибкой (not found / timeout) — click_kit(heal), потом browser_click снова. Если клик прошёл, а URL тот же или раскрылось меню — это аккордеон: не вызывай click_kit и не жми ту же кнопку, жми появившийся пункт или browser_press Enter. Сейчас вызови следующий инструмент: browser_snapshot / browser_click / browser_press / click_kit / browser_type / run_terminal_cmd / operator_use / pc_click. Если Observation это JSON error_code / Access denied API — это не DENIED системы: смени параметры и вызови снова в этом ходе. Если в снимке есть строка access_token: — это полный токен, копируй её целиком и сразу вызывай API. Не проси пользователя вставить токен и не спрашивай «что видно». Для сообщества ВК цель = group_id или vk.com/club… На Windows это cmd.exe, не bash.";

/**
 * Safety ceiling only — not a “job done” signal.
 * Stop only when the goal is actually done, the user says stop, abort, or a hard boundary.
 */
export const GOAL_KEEP_GOING = 10_000;

/** One or two tool calls is never the end of a live / multi-step job. */
export const MIN_WORK_MOVES = 3;

const WORK_TOOLS =
  /^(write_file|write_pc_file|search_replace|open_on_pc|launch_app|run_terminal_cmd|operator_use|pc_click|pc_type|pc_keys|pc_snapshot|pc_screenshot|pc_focus|browser_navigate|browser_click|browser_type|browser_press|browser_wait|browser_snapshot|browser_screenshot|click_kit|project_harness)$/;
const OPEN_TOOLS = /^(open_on_pc|launch_app|operator_use|browser_navigate)$/;
const WRITE_TOOLS = /^(write_file|write_pc_file|search_replace)$/;
const OPERATE_TOOLS =
  /^(operator_use|pc_click|pc_type|pc_keys|pc_screenshot|pc_focus|browser_navigate|browser_click|browser_type|browser_press|browser_wait|click_kit|run_terminal_cmd)$/;
const LIVE_SITE_TOOLS =
  /^(browser_|click_kit|operator_use|pc_click|pc_type|pc_keys|pc_screenshot|pc_focus)/;
const LOOK_ONLY =
  /^(read_file|list_dir|grep|browser_snapshot|browser_tabs|pc_windows|pc_snapshot|web_fetch|memory_recall)$/;

function looksLikeRetryableApiError(text: string): boolean {
  return /error_code|error_msg|access denied(?! is)|invalid (token|scope|client)|one of the parameters specified was missing/i.test(
    String(text || ""),
  );
}

function wantsLiveOutcome(task: string): boolean {
  return /(создай|сделай|заполн|отправ|клик|нажми|войди|авториз|сообществ|групп|паблик|зарегистри|опублик|токен|oauth|access_token)/i.test(
    task,
  );
}

/** Fill a form, create a community, log in — not “just open this URL”. */
export function isLiveOutcomeJob(task: string): boolean {
  const raw = String(task || "");
  if (!raw.trim()) return false;
  return (
    wantsLiveOutcome(raw) ||
    /(сообществ|групп|паблик|oauth|access_token|заполн|отправ|войди|авториз|зарегистри|опублик)/i.test(raw)
  );
}

export function countWorkMoves(usedTools: string[]): number {
  return usedTools.filter((name) => {
    const tool = String(name || "").trim();
    if (!tool || LOOK_ONLY.test(tool)) return false;
    return WORK_TOOLS.test(tool) || OPERATE_TOOLS.test(tool) || LIVE_SITE_TOOLS.test(tool);
  }).length;
}

/** Open one folder / write one note — not a live site or a multi-file job. */
export function looksLikeSingleAction(userText: string): boolean {
  const task = String(userText || "").trim();
  if (!task) return false;
  if (isLiveOutcomeJob(task) || looksLikeKeepGoing(task)) return false;
  if (looksLikeBrowserWork(task)) return false;
  if (looksLikeSimpleHostTask(task)) return true;
  if (looksLikeOpen(task) && !looksLikeWrite(task) && !looksLikeOperate(task)) return true;
  return false;
}

/** Live-site / operator job is done only with a real outcome, not “открыл” / «готово». */
export function looksLikeOperateSuccess(userText: string, content: string): boolean {
  const task = String(userText || "");
  const raw = String(content || "");
  if (!raw.trim()) return false;
  if (looksLikeFalseDone(raw)) return false;
  if (looksUnfinished(raw) || looksLikeNarratingWork(raw) || looksLikeAskingUser(raw)) return false;
  if (looksLikeRetryableApiError(raw)) return false;
  if (
    /(не сработал|не открыл|не появил|не отрисов|не могу|пришлите|вставь(те)? токен|посмотрите|напишите|что видно|окно не|модалка не|не нашёл|не нашел|жду вас)/i.test(
      raw,
    )
  ) {
    return false;
  }
  if (/(сообществ|групп|паблик|\bвк\b|вконтакте|\bvk\.(com|ru)\b)/i.test(task) && wantsLiveOutcome(task)) {
    return /["']?group_id["']?\s*[:=]\s*\d+|vk\.(com|ru)\/(club|public)\d+|сообщество создано|создал сообществ|"type"\s*:\s*"(group|page|event)"/i.test(
      raw,
    );
  }
  if (/(токен|oauth|access_token)/i.test(task) && !/(сообществ|групп|паблик)/i.test(task)) {
    return /access_token:|TOKEN_READY|токен получен|vk1\.a\./i.test(raw);
  }
  if (isLiveOutcomeJob(task) || (looksLikeOperate(task) && !looksLikeBrowserWork(task))) {
    return /(сохранил|отправил|создано\b|файл записан|clicked and saved|вошёл|вошел|зарегистрирован|опубликован)/i.test(
      raw,
    );
  }
  return false;
}

export function usedLiveSiteTools(usedTools: string[]): boolean {
  return usedTools.some((name) => LIVE_SITE_TOOLS.test(String(name || "")));
}

export function didPcWork(usedTools: string[], changedPaths: string[]): boolean {
  if (changedPaths.some((item) => String(item || "").trim())) return true;
  return usedTools.some((name) => WORK_TOOLS.test(String(name || "")));
}

export function missingGoalWork(userText: string, usedTools: string[], changedPaths: string[]): boolean {
  if (!taskNeedsWork(userText)) return false;
  const wantOpen = looksLikeOpen(userText);
  const wantWrite = looksLikeWrite(userText);
  const wantOperate = looksLikeOperate(userText);
  const didOpen = usedTools.some((name) => OPEN_TOOLS.test(String(name || "")));
  const didWrite =
    usedTools.some((name) => WRITE_TOOLS.test(String(name || ""))) ||
    changedPaths.some((item) => String(item || "").trim());
  const didOperate = usedTools.some((name) => OPERATE_TOOLS.test(String(name || "")));
  if (wantWrite && !didWrite) return true;
  if (wantOpen && !didOpen && !didOperate) return true;
  if (wantOperate) {
    if (!didOperate) return true;
    if (usedTools.length > 0 && usedTools.every((name) => LOOK_ONLY.test(String(name || "")))) return true;
  }
  return false;
}

/**
 * Keep going only while the job is unfinished.
 * Stop when the work is actually done, the user says стоп, abort, or a hard boundary.
 * «Готово» without evidence, a plan, or a missing write/click is not done.
 */
export function shouldNudgeUntilGoal(opts: {
  userText: string;
  content: string;
  usedTools: string[];
  changedPaths: string[];
  nudges: number;
  maxNudges?: number;
}): boolean {
  const maxNudges = Math.max(0, opts.maxNudges ?? GOAL_KEEP_GOING);
  if (opts.nudges >= maxNudges) return false;
  if (looksLikeStopCommand(opts.userText) || looksLikeStopCommand(opts.content)) return false;
  if (isHardBoundary(opts.content)) return false;
  if (looksLikeFalseDone(opts.content)) return true;
  if (opts.usedTools.some((name) => String(name || "").trim() && !isKnownTool(name))) return true;
  if (looksLikeRetryableApiError(opts.content)) return true;
  if (looksLikeNarratingWork(opts.content) || looksUnfinished(opts.content) || looksLikeAskingUser(opts.content)) {
    return true;
  }
  if (looksLikeHangComplaint(opts.userText) && !didPcWork(opts.usedTools, opts.changedPaths)) return true;
  if (missingGoalWork(opts.userText, opts.usedTools, opts.changedPaths)) return true;

  const liveSite =
    looksLikeOperate(opts.userText) ||
    looksLikeBrowserWork(opts.userText) ||
    looksLikeKeepGoing(opts.userText) ||
    usedLiveSiteTools(opts.usedTools) ||
    isLiveOutcomeJob(opts.userText);
  if (liveSite) {
    if (looksLikeOperateSuccess(opts.userText, opts.content)) return false;
    const justOpen =
      looksLikeOpen(opts.userText) &&
      !isLiveOutcomeJob(opts.userText) &&
      !looksLikeWrite(opts.userText) &&
      !wantsLiveOutcome(opts.userText) &&
      opts.usedTools.some((name) => OPEN_TOOLS.test(String(name || "")));
    if (justOpen) return false;
    return true;
  }

  if (taskNeedsWork(opts.userText) && didPcWork(opts.usedTools, opts.changedPaths)) return false;
  if (looksLikeKeepGoing(opts.userText) && !didPcWork(opts.usedTools, opts.changedPaths)) return true;
  return false;
}
