import { buildSystemPrompt, wrapUserQuery } from "../prompt";
import { listWorkspaceSnapshot } from "../host-fs";
import { retrieveGrounding, recordMemoryEvent } from "../super-memory";
import { recallSkillLines } from "../skill-ledger";
import {
  appendA2A,
  appendDecision,
  getWorkingMemory,
  searchDecisions,
  setWorkingMemory,
} from "../decision-log";
import { extractiveBrief, verifyChangedFiles } from "../verifiers";
import { GROK_TOOLS } from "../tools";
import { droppedHistoryBrief } from "../chat-store";
import type { TodoItem } from "../types";
import {
  CREW_LABELS,
  architectTools,
  coderTemperature,
  parseVerdict,
  parseVote,
  reviewerTools,
  rolePrompt,
  shouldUseCrew,
  type CrewMode,
  type CrewRole,
} from "./roles";
import { runToolAgent, type CrewSend, type LlmSettings } from "./run";
import { GOAL_KEEP_GOING } from "../fyodor/until-goal";
import { throwIfAborted } from "../run-control";
import type { AppRole } from "../colleague/types";

export type CrewRequest = {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  lastUser: string;
  crewEnabled: boolean;
  settings: LlmSettings;
  fallback: LlmSettings | null;
  send: CrewSend;
  tools?: typeof GROK_TOOLS;
  /** Tool-turn ceiling. Coder seats ignore this until the goal is done. */
  maxTurns?: number;
  /** Skip workspace dump + never spawn the three-agent crew. */
  light?: boolean;
  signal?: AbortSignal | null;
  role?: AppRole;
};

export type CrewOutcome = {
  todos: TodoItem[];
  usedTools: string[];
  changedPaths: string[];
  mode: CrewMode;
};

function emitCrew(send: CrewSend, role: CrewRole, status: "running" | "done" | "handoff", note?: string) {
  send("crew", {
    role,
    label: CREW_LABELS[role],
    status,
    note: String(note || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800),
  });
}

async function systemFor(
  role: CrewRole,
  extra: string,
  light = false,
  appRole: AppRole = "coder",
  task = "",
): Promise<string> {
  const listing = light ? "" : await listWorkspaceSnapshot();
  return `${buildSystemPrompt(listing, appRole, task)}\n\n${rolePrompt(role, extra)}`;
}

function historyMessages(
  history: Array<{ role: "user" | "assistant"; content: string }>,
  lastWrap = true,
): Array<{ role: string; content: string }> {
  return history.map((message, index, all) => {
    if (lastWrap && message.role === "user" && index === all.length - 1) {
      return { role: "user", content: wrapUserQuery(message.content) };
    }
    return { role: message.role, content: message.content };
  });
}

export async function runCrewGraph(request: CrewRequest): Promise<CrewOutcome> {
  const { send } = request;
  throwIfAborted(request.signal);
  const go = (opts: Parameters<typeof runToolAgent>[0]) =>
    runToolAgent({ ...opts, signal: request.signal ?? opts.signal });
  const light = Boolean(request.light);
  const turnCap = Math.max(GOAL_KEEP_GOING, request.maxTurns ?? GOAL_KEEP_GOING);
  const brief = droppedHistoryBrief(request.history);
  const rag = retrieveGrounding(request.lastUser, [
        ...recallSkillLines(request.lastUser, 4),
        ...searchDecisions(request.lastUser, 3),
        getWorkingMemory() ? `рабочая память: ${getWorkingMemory()}` : "",
        brief ? `сжатый прошлый чат:\n${brief}` : "",
      ]);
  const priorTools = light
    ? false
    : request.history.some((item) => /```|write_file|run_terminal/i.test(item.content));
  const mode =
    light || !request.crewEnabled ? "solo" : shouldUseCrew(request.lastUser, priorTools);

  emitCrew(
    send,
    "coordinator",
    "running",
    mode === "crew" ? "Собираю мозговой трест: архитектор, кодер, критик." : "Короткий путь: один кодер.",
  );
  appendA2A({
    from: "coordinator",
    to: mode === "crew" ? "architect" : "coder",
    kind: "handoff",
    text: mode,
  });
  emitCrew(
    send,
    "coordinator",
    "done",
    mode === "crew" ? "Трест собран. Дальше штурм по ролям." : "Полный трест не нужен — отвечает кодер.",
  );

  let todos: TodoItem[] = [];
  const usedTools: string[] = [];
  const rebuild = (role: CrewRole, extra: string) => () =>
    systemFor(role, `${extra}\n${rag}`, light, request.role, request.lastUser);

  if (mode === "solo") {
    const messages: unknown[] = [
      { role: "system", content: await rebuild("coder", "Solo path. Still use tools when the PC must change.")() },
      ...historyMessages(request.history),
    ];
    emitCrew(send, "coder", "running", "Думаю и пишу ответ.");
    const result = await go({
      settings: request.settings,
      messages,
      tools: request.tools ?? GROK_TOOLS,
      temperature: coderTemperature(request.lastUser),
      maxTurns: turnCap,
      streamText: true,
      send,
      rebuildSystem: rebuild("coder", "Solo path."),
      fallback: request.fallback,
      todos,
      usedTools,
      userGoal: request.lastUser,
    });
    todos = result.todos;
    usedTools.push(...result.usedTools);
    emitCrew(send, "coder", "done", (result.content || "Ответ готов.").replace(/\s+/g, " ").slice(0, 220));
    if (result.changedPaths.length) {
      const report = verifyChangedFiles(result.changedPaths);
      emitCrew(send, "verifier", report.ok ? "done" : "handoff", report.summary);
    }
    if (result.content) {
      try {
        recordMemoryEvent({ kind: "assistant", text: result.content, distill: false });
      } catch {
        // ignore
      }
    }
    return { todos, usedTools, changedPaths: result.changedPaths, mode };
  }

  const planMessages: unknown[] = [
    {
      role: "system",
      content: await rebuild("architect", "Plan only.")(),
    },
    ...historyMessages(request.history),
  ];
  emitCrew(send, "architect", "running", "Планирую шаги и называю файлы.");
  const plan = await go({
    settings: request.settings,
    messages: planMessages,
    tools: architectTools(),
    temperature: 0.1,
    maxTurns: 4,
    streamText: false,
    streamThought: "architect",
    send,
    rebuildSystem: rebuild("architect", "Plan only."),
    fallback: request.fallback,
    todos,
    usedTools,
  });
  usedTools.push(...plan.usedTools);
  todos = plan.todos;
  const planText = plan.content.slice(0, 2500);
  appendA2A({ from: "architect", to: "coder", kind: "plan", text: planText });
  emitCrew(send, "architect", "done", planText.replace(/\s+/g, " ").slice(0, 700));
  emitCrew(send, "coder", "handoff", "План принят, пишу.");

  const coderExtra = `Architect plan:\n${planText}\nImplement this. If tools show the plan is wrong, deviate and say so.`;
  const coderMessages: unknown[] = [
    { role: "system", content: await rebuild("coder", coderExtra)() },
    ...historyMessages(request.history),
    { role: "user", content: `<architect_plan>\n${planText}\n</architect_plan>` },
  ];
  emitCrew(send, "coder", "running", "Пишу и правлю файлы");
  let coder = await go({
    settings: request.settings,
    messages: coderMessages,
    tools: request.tools ?? GROK_TOOLS,
    temperature: coderTemperature(request.lastUser),
      maxTurns: turnCap,
    streamText: true,
    send,
    rebuildSystem: rebuild("coder", coderExtra),
    fallback: request.fallback,
    todos,
    usedTools,
    userGoal: request.lastUser,
  });
  todos = coder.todos;
  usedTools.push(...coder.usedTools);
  const changed = [...coder.changedPaths];
  emitCrew(send, "coder", "done", coder.content.replace(/\s+/g, " ").slice(0, 180));
  appendA2A({ from: "coder", to: "reviewer", kind: "handoff", text: coder.content.slice(0, 1500) });

  emitCrew(send, "reviewer", "running", "Читаю как посторонний. Ищу дыры.");
  const reviewMessages: unknown[] = [
    { role: "system", content: await rebuild("reviewer", "Review the coder output.")() },
    {
      role: "user",
      content: `Task:\n${request.lastUser}\n\nPlan:\n${planText}\n\nCoder answer:\n${coder.content.slice(0, 6000)}\n\nChanged paths: ${changed.join(", ") || "(none)"}`,
    },
  ];
  const review = await go({
    settings: request.settings,
    messages: reviewMessages,
    tools: reviewerTools(),
    temperature: 0.1,
    maxTurns: 6,
    streamText: false,
    streamThought: "reviewer",
    send,
    rebuildSystem: rebuild("reviewer", "Review the coder output."),
    fallback: request.fallback,
    todos,
    usedTools,
  });
  usedTools.push(...review.usedTools);
  todos = review.todos;
  let verdict = parseVerdict(review.content);
  appendA2A({ from: "reviewer", to: "coder", kind: "critique", text: review.content.slice(0, 1500) });
  emitCrew(send, "reviewer", verdict === "reject" ? "handoff" : "done", review.content.replace(/\s+/g, " ").slice(0, 700));

  if (verdict === "reject") {
    send("text", { delta: "\n\nКритик вернул на доработку. Исправляю.\n\n" });
    const fixExtra = `Reviewer REJECTED. Fix only these items:\n${review.content.slice(0, 3000)}`;
    emitCrew(send, "coder", "running", "Правки по критику");
    coder = await go({
      settings: request.settings,
      messages: [
        { role: "system", content: await rebuild("coder", fixExtra)() },
        ...historyMessages(request.history),
        { role: "user", content: `<fix_list>\n${review.content.slice(0, 3000)}\n</fix_list>` },
      ],
      tools: request.tools ?? GROK_TOOLS,
      temperature: 0.2,
      maxTurns: Math.max(16, turnCap),
      streamText: true,
      send,
      rebuildSystem: rebuild("coder", fixExtra),
      fallback: request.fallback,
      todos,
      usedTools,
      userGoal: request.lastUser,
    });
    todos = coder.todos;
    usedTools.push(...coder.usedTools);
    changed.push(...coder.changedPaths);
    emitCrew(send, "coder", "done", "Повторная выдача");
    const review2 = await go({
      settings: request.settings,
      messages: [
        { role: "system", content: await rebuild("reviewer", "Second look after fixes.")() },
        {
          role: "user",
          content: `Original critique:\n${review.content.slice(0, 2000)}\n\nNew answer:\n${coder.content.slice(0, 4000)}`,
        },
      ],
      tools: reviewerTools(),
      temperature: 0.1,
      maxTurns: 4,
        streamText: false,
        streamThought: "reviewer",
        send,
        rebuildSystem: rebuild("reviewer", "Second look after fixes."),
      fallback: request.fallback,
      todos,
      usedTools,
    });
    usedTools.push(...review2.usedTools);
    verdict = parseVerdict(review2.content);
    emitCrew(send, "reviewer", "done", review2.content.replace(/\s+/g, " ").slice(0, 180));
    if (verdict === "reject") {
      emitCrew(send, "coordinator", "running", "Нет согласия — голосуем");
      const vote = await go({
        settings: request.settings,
        messages: [
          { role: "system", content: await rebuild("coordinator", "Break the tie.")() },
          {
            role: "user",
            content: `Plan:\n${planText}\n\nCoder:\n${coder.content.slice(0, 2500)}\n\nReviewer:\n${review2.content.slice(0, 2500)}`,
          },
        ],
        tools: undefined,
        temperature: 0.1,
        maxTurns: 1,
        streamText: false,
        streamThought: "coordinator",
        send,
        rebuildSystem: rebuild("coordinator", "Break the tie."),
        fallback: request.fallback,
        todos,
        usedTools,
      });
      const choice = parseVote(vote.content);
      appendA2A({ from: "coordinator", to: "coder", kind: "vote", text: vote.content.slice(0, 600) });
      emitCrew(send, "coordinator", "done", choice === "ship" ? "Координатор: выпускаем" : vote.content.slice(0, 180));
      if (choice !== "ship") {
        send("text", { delta: `\n\nКоординатор: ${vote.content.slice(0, 400)}\n` });
      }
    }
  }

  emitCrew(send, "verifier", "running", "Тесты и синтаксис");
  const report = verifyChangedFiles(changed);
  emitCrew(send, "verifier", report.ok ? "done" : "handoff", report.summary);
  if (!report.ok) {
    send("text", { delta: `\n\n${report.summary}\n` });
    const fixExtra = `External verifier failed. Fix:\n${report.summary}`;
    emitCrew(send, "coder", "running", "Чиню по проверкам");
    const fixed = await go({
      settings: request.settings,
      messages: [
        { role: "system", content: await rebuild("coder", fixExtra)() },
        { role: "user", content: wrapUserQuery(`${request.lastUser}\n\n${report.summary}`) },
      ],
      tools: request.tools ?? GROK_TOOLS,
      temperature: 0.2,
      maxTurns: Math.max(GOAL_KEEP_GOING, turnCap),
      streamText: true,
      send,
      rebuildSystem: rebuild("coder", fixExtra),
      fallback: request.fallback,
      todos,
      usedTools,
      userGoal: request.lastUser,
    });
    todos = fixed.todos;
    usedTools.push(...fixed.usedTools);
    emitCrew(send, "coder", "done", "После проверок");
  }

  emitCrew(send, "reflect", "running", "Ищу свои ошибки");
  const reflect = await go({
    settings: request.settings,
    messages: [
      { role: "system", content: await rebuild("reflect", "")() },
      { role: "user", content: coder.content.slice(0, 5000) || request.lastUser },
    ],
    tools: undefined,
    temperature: 0.1,
    maxTurns: 1,
      streamText: false,
      streamThought: "reflect",
      send,
      rebuildSystem: rebuild("reflect", ""),
    fallback: request.fallback,
    todos,
    usedTools,
  });
  const clean = /^CLEAN\b/i.test(reflect.content.trim());
  emitCrew(send, "reflect", "done", clean ? "Чисто — противоречий не вижу." : reflect.content.replace(/\s+/g, " ").slice(0, 700));
  if (!clean && reflect.content.trim()) {
    send("text", { delta: `\n\nСамопроверка: ${reflect.content.slice(0, 800)}\n` });
  }

  const why = extractiveBrief(
    [planText, review.content, report.summary, `вердикт ${verdict}`],
    500,
  );
  appendDecision({
    task: request.lastUser.slice(0, 240),
    why: why || `команда ${verdict}`,
    plan: planText.slice(0, 500),
    verdict,
    verify: report.summary,
    agents: ["architect", "coder", "reviewer"],
  });
  setWorkingMemory(`задача: ${request.lastUser.slice(0, 180)}\nплан: ${planText.slice(0, 400)}\nвердикт: ${verdict}`);
  try {
    recordMemoryEvent({ kind: "assistant", text: coder.content, distill: false });
    if (planText) {
      recordMemoryEvent({ kind: "note", text: `план: ${planText.replace(/\s+/g, " ").slice(0, 220)}` });
    }
  } catch {
    // ignore
  }

  return { todos, usedTools, changedPaths: changed, mode };
}

export { CREW_LABELS, CREW_TRUST, crewSeatLabel, shouldUseCrew } from "./roles";
export type { CrewRole, CrewMode } from "./roles";
