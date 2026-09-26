import type { ChatMessage, ComputerLog, CrewStep, ToolCallEvent } from "./types";

function clip(text: string, max = 72): string {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

const JUNK_RE =
  /задача принята|мозговой трест|files updated on this pc|кодер работает|кодер простаивает|уровень работы|дальше трест|собираю мозговой|узел закрыт без правки|панель закреплена|здесь живой ход/i;

export function isJunkWorkLine(text: string): boolean {
  return !String(text || "").trim() || JUNK_RE.test(text);
}

export function toolAction(tool: ToolCallEvent): string {
  const path = clip(String(tool.args.path ?? tool.args.target ?? ""), 56);
  const command = clip(String(tool.args.command ?? ""), 56);
  if (tool.name === "write_file" || tool.name === "write_pc_file") return path ? `пишет ${path}` : "пишет файл";
  if (tool.name === "read_file") return path ? `читает ${path}` : "читает файл";
  if (tool.name === "list_dir") return path ? `смотрит ${path}` : "смотрит папку";
  if (tool.name === "open_on_pc") return path ? `открывает ${path}` : "открывает на ПК";
  if (tool.name === "launch_app") return "запускает программу";
  if (tool.name === "run_terminal_cmd") {
    if (/test|pytest|jest|vitest/i.test(command)) return command ? `гоняет тест: ${command}` : "гоняет тест";
    return command ? `команда: ${command}` : "выполняет команду";
  }
  if (tool.name.startsWith("browser_")) {
    if (tool.name === "browser_tabs") return "смотрит вкладки";
    if (tool.name === "browser_screenshot") return "снимает экран браузера";
    if (tool.name === "browser_engine") return "подключает браузер";
    return "работает в браузере";
  }
  if (tool.name === "pc_windows") return "смотрит окна ПК";
  if (tool.name === "pc_focus") return "выводит окно на передний план";
  if (tool.name === "operator_use") {
    const app = clip(String(tool.args.query ?? tool.args.app ?? tool.args.target ?? ""), 40);
    return app ? `управляет ${app}` : "открывает программу как оператор";
  }
  if (tool.name === "pc_snapshot") return "смотрит окно программы";
  if (tool.name === "pc_click") return "кликает в окне";
  if (tool.name === "pc_type") return "печатает в окне";
  if (tool.name === "pc_keys") return "нажимает клавиши";
  if (tool.name === "pc_screenshot") return "снимает экран ПК";
  if (tool.name === "click_kit") return "подбирает набор клика";
  if (tool.name === "web_fetch") return "читает открытую страницу";
  if (tool.name === "web_search") return "ищет файл в интернете";
  if (tool.name === "download_file") return "скачивает файл";
  if (tool.name === "inspect_apk") return "разбирает APK";
  if (tool.name === "inspect_zip") return "смотрит архив";
  return clip(tool.name, 40) || "инструмент";
}

export function usefulCrewNote(step: CrewStep): string {
  const note = clip(step.note || "", 140);
  if (!note || isJunkWorkLine(note)) return "";
  return note;
}

export function crewReasonLine(step: CrewStep): string {
  const note = usefulCrewNote(step);
  const who = clip(step.label || step.role, 36);
  if (note) return who ? `${who}: ${note}` : note;
  if (step.status === "running") return who ? `${who} думает` : "агент думает";
  if (step.status === "handoff") return who ? `${who} передал ход` : "агент передал ход";
  return who ? `${who} молчит` : "";
}

function usefulLogLine(log?: ComputerLog): string {
  if (!log?.title) return "";
  const line = clip(log.detail ? `${log.title} — ${log.detail}` : log.title, 88);
  if (isJunkWorkLine(line) || isJunkWorkLine(log.title)) return "";
  return line;
}

export function pickLiveMessage(
  messages: ChatMessage[],
  liveIds: Iterable<string>,
): ChatMessage | undefined {
  const ids = new Set(Array.from(liveIds));
  return (
    [...messages].reverse().find((item) => item.role === "assistant" && ids.has(item.id)) ??
    [...messages].reverse().find((item) => item.role === "assistant")
  );
}

export function liveBusyLabel(message?: ChatMessage, log?: ComputerLog): string {
  const runningTool = [...(message?.toolCalls ?? [])].reverse().find((item) => item.status === "running");
  if (runningTool) return toolAction(runningTool);
  const runningCrew = [...(message?.crew ?? [])].reverse().find((item) => item.status === "running");
  const crewLine = runningCrew ? crewReasonLine(runningCrew) : "";
  if (crewLine) return crewLine;
  const fact = usefulLogLine(log);
  if (fact) return fact;
  if (message && !String(message.content || "").trim()) return "думает над задачей";
  return "пишет ответ";
}

export function liveWorkLine(message?: ChatMessage, log?: ComputerLog): string {
  const runningTool = [...(message?.toolCalls ?? [])].reverse().find((item) => item.status === "running");
  if (runningTool) return `сейчас: ${toolAction(runningTool)}`;
  const runningCrew = [...(message?.crew ?? [])].reverse().find((item) => item.status === "running") as CrewStep | undefined;
  const crewLine = runningCrew ? crewReasonLine(runningCrew) : "";
  if (crewLine) return `сейчас: ${crewLine}`;
  const lastCrew = [...(message?.crew ?? [])].reverse()[0];
  const lastLine = lastCrew ? crewReasonLine(lastCrew) : "";
  if (lastLine) return `сейчас: ${lastLine}`;
  const fact = usefulLogLine(log);
  if (fact) return `сейчас: ${fact}`;
  if (message?.crew?.length) return "сейчас: агенты есть, но молчат";
  return "агенты ничего не делают";
}

export function workFactRows(
  logs: ComputerLog[],
  tools: ToolCallEvent[],
  crew: CrewStep[],
): string[] {
  const rows: string[] = [];
  const seen = new Set<string>();
  const push = (line: string) => {
    const clean = clip(line, 96);
    if (!clean || isJunkWorkLine(clean) || seen.has(clean)) return;
    seen.add(clean);
    rows.push(clean);
  };
  for (const tool of tools.slice(-8)) {
    const action = toolAction(tool);
    push(`${tool.status === "running" ? "…" : "✓"} ${action}`);
  }
  for (const step of crew.slice(-8)) {
    const line = crewReasonLine(step);
    if (line) push(line);
  }
  for (const log of logs.slice(-16)) {
    const line = usefulLogLine(log);
    if (line) push(line);
  }
  return rows.slice(-12);
}

export function mergeLiveTools(messages: ChatMessage[], liveIds: Iterable<string>): ToolCallEvent[] {
  const ids = new Set(Array.from(liveIds));
  return messages.filter((item) => ids.has(item.id)).flatMap((item) => item.toolCalls ?? []);
}

export function mergeLiveCrew(messages: ChatMessage[], liveIds: Iterable<string>): CrewStep[] {
  const ids = new Set(Array.from(liveIds));
  return messages.filter((item) => ids.has(item.id)).flatMap((item) => item.crew ?? []);
}
