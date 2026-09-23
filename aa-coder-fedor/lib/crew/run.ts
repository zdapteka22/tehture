import { collapseOldObservations, formatAciObservation } from "../aci";
import { BOUNDARY_STOP, shouldStopOnBoundary } from "../agent-boundary";
import { executeTool, parseToolArgs, GROK_TOOLS } from "../tools";
import { observeToolForMemory } from "../super-memory";
import { concludeSkillTask, getSkillTask, recordSkillFromTool, setSkillTask } from "../skill-ledger";
import { completeOnce, type CompleteOnceOptions, type UpstreamToolCall } from "../llm";
import { actionFingerprint, FailureMemory, looksFailed, verbalLesson } from "../reflexion";
import type { ProviderId, TodoItem } from "../types";
import { CREW_LABELS, type CrewRole } from "./roles";
import { GOAL_KEEP_GOING, GOAL_NUDGE, shouldNudgeUntilGoal } from "../fyodor/until-goal";
import { isAbortError, throwIfAborted } from "../run-control";

export type CrewSend = (event: string, data: unknown) => void;

export type LlmSettings = {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type ToolLoopResult = {
  content: string;
  messages: unknown[];
  todos: TodoItem[];
  usedTools: string[];
  changedPaths: string[];
};

export async function runToolAgent(options: {
  settings: LlmSettings;
  messages: unknown[];
  tools: typeof GROK_TOOLS | undefined;
  temperature: number;
  maxTurns: number;
  streamText: boolean;
  send: CrewSend;
  rebuildSystem: () => Promise<string>;
  fallback?: LlmSettings | null;
  todos: TodoItem[];
  usedTools: string[];
  streamThought?: CrewRole;
  /** Original user task. When set, a plan-only reply does not end the loop. */
  userGoal?: string;
  maxNudges?: number;
  signal?: AbortSignal | null;
}): Promise<ToolLoopResult> {
  const messages = [...options.messages];
  let todos = options.todos;
  const usedTools = [...options.usedTools];
  const changedPaths: string[] = [];
  let active = { ...options.settings };
  let content = "";
  let lastThoughtAt = 0;
  let nudges = 0;
  const keepUntilGoal = Boolean(options.userGoal && options.tools);
  const maxNudges = keepUntilGoal
    ? Math.max(GOAL_KEEP_GOING, options.maxNudges ?? GOAL_KEEP_GOING)
    : Math.max(0, Math.min(8, options.maxNudges ?? 5));
  const turnLimit = keepUntilGoal
    ? Math.max(GOAL_KEEP_GOING, options.maxTurns || 0)
    : Math.max(1, options.maxTurns);
  const failures = new FailureMemory();
  setSkillTask(options.userGoal || "");

  const runModel = async () => {
    let emitted = false;
    const call = (settings: LlmSettings) =>
      completeOnce({
        ...settings,
        messages,
        tools: options.tools,
        temperature: options.temperature,
        signal: options.signal,
        onText: (delta) => {
          emitted = true;
          content += delta;
          if (options.streamText) options.send("text", { delta });
          else if (options.streamThought) {
            const now = Date.now();
            if (now - lastThoughtAt > 180) {
              lastThoughtAt = now;
              options.send("crew", {
                role: options.streamThought,
                label: CREW_LABELS[options.streamThought],
                status: "running",
                note: content.replace(/\s+/g, " ").trim().slice(-700),
              });
            }
          }
        },
      } satisfies CompleteOnceOptions);

    try {
      return await call(active);
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      if (!options.fallback || emitted || active.provider === options.fallback.provider) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      active = options.fallback;
      options.send("status", { text: `переключаюсь на ${active.model}` });
      options.send("provider", {
        provider: active.provider,
        reason: `Переключаюсь на запасной канал (${active.model}). ${reason}`.slice(0, 240),
      });
      return call(active);
    }
  };

  for (let turn = 0; turn < turnLimit; turn += 1) {
    throwIfAborted(options.signal);
    collapseOldObservations(messages as Array<{ role?: string; content?: unknown }>);
    content = "";
    let text = "";
    let toolCalls: UpstreamToolCall[] = [];
    try {
      const model = await runModel();
      text = model.content;
      toolCalls = model.toolCalls;
      content = text;
    } catch (error) {
      if (isAbortError(error) || options.signal?.aborted) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      if (/закончились деньги|insufficient.?quota|Payment Required|\b402\b/i.test(reason)) throw error;
      if (keepUntilGoal && nudges < maxNudges) {
        nudges += 1;
        options.send("status", { text: "сбой ответа модели — продолжаю" });
        options.send("crew", {
          role: options.streamThought || "coder",
          label: CREW_LABELS[options.streamThought || "coder"],
          status: "running",
          note: "Модель не ответила — следующий инструмент, без остановки.",
        });
        messages.push({ role: "assistant", content: reason.slice(0, 400) || "" });
        messages.push({ role: "user", content: GOAL_NUDGE });
        continue;
      }
      throw error;
    }

    if (!toolCalls.length) {
      throwIfAborted(options.signal);
      if (
        options.tools &&
        shouldNudgeUntilGoal({
          userText: options.userGoal || "",
          content,
          usedTools,
          changedPaths,
          nudges,
          maxNudges,
        })
      ) {
        nudges += 1;
        messages.push({ role: "assistant", content: text || "" });
        messages.push({ role: "user", content: GOAL_NUDGE });
        options.send("crew", {
          role: options.streamThought || "coder",
          label: CREW_LABELS[options.streamThought || "coder"],
          status: "running",
          note: "Цель не закрыта — продолжаю, без остановки на плане.",
        });
        continue;
      }
      finishSkill(content, usedTools, true);
      return { content, messages, todos, usedTools, changedPaths };
    }

    messages.push({
      role: "assistant",
      content: text || null,
      tool_calls: toolCalls.map((call: UpstreamToolCall) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    });

    for (const call of toolCalls) {
      throwIfAborted(options.signal);
      const parsedArgs = parseToolArgs(call.arguments);
      usedTools.push(call.name);
      options.send("tool", {
        id: call.id,
        name: call.name,
        args: parsedArgs,
        status: "running",
      });
      const fingerprint = actionFingerprint(call.name, parsedArgs);
      if (failures.seen(fingerprint) >= 1) {
        const lesson = verbalLesson(
          call.name,
          failures.lastObservation(fingerprint) || "повтор того же вызова после отказа",
        );
        options.send("tool", {
          id: call.id,
          name: call.name,
          args: parsedArgs,
          status: "done",
          result: lesson.slice(0, 8000),
        });
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: formatAciObservation(lesson),
        });
        try {
          recordSkillFromTool(call.name, parsedArgs, lesson);
        } catch {
          // ignore
        }
        continue;
      }
      const result = await executeTool(call.name, parsedArgs, todos, options.signal);
      try {
        observeToolForMemory(call.name, parsedArgs);
      } catch {
        // ignore
      }
      if (result.changedPaths?.length) {
        changedPaths.push(...result.changedPaths);
        options.send("files", { changed: result.changedPaths });
      } else if (call.name === "run_terminal_cmd") {
        options.send("files", { changed: [] });
      }
      if (result.todos) {
        todos = result.todos;
        options.send("todos", { todos });
      }
      const observation = formatAciObservation(result.output);
      if (looksFailed(result.output) || shouldStopOnBoundary(result.output)) {
        failures.rememberFailure(fingerprint, result.output);
      }
      options.send("tool", {
        id: call.id,
        name: call.name,
        args: parsedArgs,
        status: "done",
        result: observation.slice(0, 8000),
      });
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: observation.slice(0, 12000),
      });
      if (shouldStopOnBoundary(result.output)) {
        options.send("crew", {
          role: options.streamThought || "coder",
          label: CREW_LABELS[options.streamThought || "coder"],
          status: "done",
          note: "Стоп: система отказала. Не обхожу.",
        });
        finishSkill(BOUNDARY_STOP, usedTools, false);
        return { content: BOUNDARY_STOP, messages, todos, usedTools, changedPaths };
      }
    }

    (messages[0] as { content: string }).content = await options.rebuildSystem();
  }

  finishSkill(content, usedTools, true);
  return { content, messages, todos, usedTools, changedPaths };
}

function finishSkill(content: string, usedTools: string[], ok: boolean): void {
  try {
    concludeSkillTask({ task: getSkillTask(), usedTools, content, ok });
  } catch {
    // ignore
  }
}
