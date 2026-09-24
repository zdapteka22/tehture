"use client";

import { Pin, PinOff, X } from "lucide-react";
import type { CSSProperties } from "react";

import { WorkMark } from "@/components/grok-mark";
import { liveWorkLine, workFactRows } from "@/lib/live-status";
import type { ComputerLog, CrewStep, TodoItem, ToolCallEvent } from "@/lib/types";

export function WorkDock({
  live,
  task,
  logs,
  tools,
  crew,
  todos,
  pinned,
  onPinned,
  onClose,
  className = "",
  style,
}: {
  live: boolean;
  task: string;
  logs: ComputerLog[];
  tools: ToolCallEvent[];
  crew: CrewStep[];
  todos: TodoItem[];
  pinned: boolean;
  onPinned: (next: boolean) => void;
  onClose?: () => void;
  className?: string;
  style?: CSSProperties;
}) {
  const now = liveWorkLine(
    {
      id: "live",
      role: "assistant",
      content: "",
      toolCalls: tools,
      crew,
    },
    logs[logs.length - 1],
  );
  const facts = workFactRows(logs, tools, crew);
  const openTodos = todos.filter((todo) => todo.status !== "completed").slice(-4);
  return (
    <aside
      className={`min-h-0 flex-col border-[#2a2a38] bg-[#121218] ${className}`}
      style={style}
      aria-label="Экран"
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 px-3">
        <WorkMark live={live} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium tracking-wide text-[#d4c4ff] uppercase">Экран</div>
          <div className={`truncate text-[10px] ${live ? "text-[#c4b4ff]" : "text-[#6a6a72]"}`}>
            {live ? "идёт сейчас" : "простой"}
          </div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-[#9d9d9d] hover:text-white"
          aria-label={pinned ? "Открепить панель" : "Закрепить панель"}
          onClick={() => onPinned(!pinned)}
        >
          {pinned ? <Pin className="size-3.5 text-[#b48eff]" /> : <PinOff className="size-3.5" />}
        </button>
        {onClose ? (
          <button
            type="button"
            className="rounded p-1 text-[#9d9d9d] hover:text-white"
            aria-label="Закрыть панель"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {task ? (
        <div className="shrink-0 border-b border-white/8 px-3 py-2">
          <div className="text-[10px] tracking-wide text-[#6a6a72] uppercase">Запрос</div>
          <p className="mt-0.5 line-clamp-2 text-[12px] leading-5 text-[#e8e8f0]">{task}</p>
        </div>
      ) : null}
      <div className="shrink-0 border-b border-[#5b3d8a]/40 bg-[#1a1524] px-3 py-2">
        <div className="text-[10px] tracking-wide text-[#8a7ab8] uppercase">Сейчас</div>
        <p className={`mt-0.5 text-[13px] leading-5 ${live ? "text-[#e8dcff]" : "text-[#8a8aa0]"}`}>{now}</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        {openTodos.length ? (
          <ul className="mb-3 space-y-1 text-[12px] text-[#c8c8d4]">
            {openTodos.map((todo) => (
              <li key={todo.id}>
                {todo.status === "in_progress" ? "▶" : "☐"} {todo.content}
              </li>
            ))}
          </ul>
        ) : null}
        {facts.length ? (
          <div className="space-y-1 font-mono text-[11px] leading-5 text-[#b8b8c8]">
            {facts.map((row, index) => (
              <div key={`${index}-${row}`}>{row}</div>
            ))}
          </div>
        ) : (
          <p className="text-[12px] leading-5 text-[#6a6a72]">ещё не открыл файл и не запустил команду</p>
        )}
      </div>
    </aside>
  );
}
