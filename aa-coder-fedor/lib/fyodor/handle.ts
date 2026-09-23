import { getWorkspaceRoot, runInJob } from "../host-fs";
import { runCrewGraph, type CrewOutcome } from "../crew/graph";
import { crewSeatLabel } from "../crew/roles";
import { runToolAgent, type CrewSend, type LlmSettings } from "../crew/run";
import { GROK_TOOLS } from "../tools";
import type { TodoItem } from "../types";
import type { AttachMode, FyodorGraph, FyodorLevel, FyodorReport, Goal, GraphNode } from "./types";
import { budgetForPlan, clampLoops } from "./budget";
import { classifyLevel, shouldAnnouncePromotion } from "./classifier";
import { completeOnce } from "../llm";
import { writeWorkspaceFile } from "../host-fs";
import { draftSettings, fastSettings, routeLlm } from "../model-router";
import {
  cloneGraph,
  defaultL1Graph,
  defaultL2Graph,
  dependentsBlocked,
  hasUnfinished,
  markStatus,
  nextBatch,
  parsePlannerGraph,
  validateGraph,
} from "./graph-engine";
import { runLoopEngine, type CheckFn, type KillerFn, type ProduceFn } from "./loop-engine";
import { appendDecisionMd, appendLoop, archiveAgent, loadSession, saveSession, type AgentSession } from "./memory";
import { looksLikeFollowUp, normalizeTask } from "./normalizer";
import { looksLikeOperate, looksLikeSimpleHostTask, looksLikeStopCommand } from "./intent";
import { buildRoleMessages } from "./roles";
import { GOAL_KEEP_GOING } from "./until-goal";
import { throwIfAborted } from "../run-control";
import type { AppRole } from "../colleague/types";
import { runCheck } from "./test-runner";
import { ensureHarness } from "../build-harness";
import { defaultResidual, formatChatStatus, formatReport } from "./report";
import { finishVisiblePcWork } from "./visible";
import { heuristicKiller } from "./verifier";
import { grokToolsFor } from "./tools-registry";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { answerFromMemory, getMemoryPromptBlock, retrieveGrounding } from "../super-memory";
import { getSkillPromptBlock } from "../skill-ledger";
import { isSecretPath } from "../guard";

export type FyodorHooks = {
  produce?: ProduceFn;
  check?: CheckFn;
  killer?: KillerFn;
  skipLlm?: boolean;
};

export type FyodorHandleRequest = {
  repo?: string;
  userText: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  send?: CrewSend;
  settings?: LlmSettings;
  fallback?: LlmSettings | null;
  crewEnabled?: boolean;
  planId?: string;
  jobId?: string;
  forceLevel?: FyodorLevel;
  hooks?: FyodorHooks;
  signal?: AbortSignal | null;
  role?: AppRole;
};

export type FyodorHandleResult = {
  todos: TodoItem[];
  usedTools: string[];
  mode: CrewOutcome["mode"] | "fyodor";
  level: FyodorLevel;
  attach: AttachMode;
  report: FyodorReport;
  promoted: boolean;
  auto: "on" | "off";
};

const PROMOTION = "Дальше веду как задачу с проверкой.";

function emit(send: CrewSend | undefined, role: string, status: "running" | "done" | "handoff", note = "") {
  const payload = {
    role,
    label: crewSeatLabel(role),
    status,
    note: String(note || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800),
  };
  send?.("crew", payload);
  send?.("fyodor", payload);
}

function emptyReport(level: FyodorLevel, goal: string, extra: Partial<FyodorReport> = {}): FyodorReport {
  return {
    status: "DONE",
    level,
    goal,
    nodes: [],
    checks: [],
    files: [],
    residual_risk: extra.residual_risk || defaultResidual(level),
    how_to_verify: extra.how_to_verify || "Прочитайте ответ в чате.",
    ...extra,
  };
}

function goalChanged(prev: string | undefined, next: string): boolean {
  if (!prev) return true;
  if (looksLikeFollowUp(next)) return false;
  const a = prev.replace(/\s+/g, " ").slice(0, 80);
  const b = next.replace(/\s+/g, " ").slice(0, 80);
  if (a === b) return false;
  return !next.includes(prev.slice(0, 20));
}

function collectFileSnippets(repo: string, paths: string[]): Array<{ path: string; content: string }> {
  const out: Array<{ path: string; content: string }> = [];
  const seen = new Set<string>();
  for (const rel of paths) {
    const clean = String(rel || "").replace(/\\/g, "/").replace(/^\.\//, "").trim();
    if (!clean || seen.has(clean) || isSecretPath(clean)) continue;
    seen.add(clean);
    const abs = path.resolve(repo, clean);
    if (!abs.startsWith(path.resolve(repo))) continue;
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) continue;
      const content = readFileSync(abs, "utf8").slice(0, 2500);
      if (content) out.push({ path: clean, content });
    } catch {
      // skip unreadable
    }
    if (out.length >= 6) break;
  }
  return out;
}

function implementerMemory(userText: string): string {
  return [getMemoryPromptBlock(), getSkillPromptBlock(userText), retrieveGrounding(userText)]
    .filter(Boolean)
    .join("\n");
}

function extractFencedFiles(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /```(?:[\w.+-]*)\s*(?:\/\/\s*)?([a-zA-Z0-9_./-]+\.[a-zA-Z0-9]+)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match[1].includes("..")) continue;
    out[match[1]] = `${match[2].trimEnd()}\n`;
  }
  return out;
}

async function tryNoToolsDraft(
  repo: string,
  goal: Goal,
  userText: string,
  settings: LlmSettings | null,
  send?: CrewSend,
  label = "пишу черновик",
  defects: string[] = [],
): Promise<string[]> {
  if (!settings?.apiKey) return [];
  const hinted = [...`${goal.text}\n${userText}`.match(/[\w./-]+\.(?:js|ts|tsx|jsx|py|json|md|css|html)/gi) || []];
  const snippets = collectFileSnippets(repo, hinted);
  if (!snippets.length) return [];
  send?.("status", { text: `${label} · ${snippets.map((row) => row.path).join(", ")}` });
  try {
    const shot = await completeOnce({
      ...settings,
      temperature: 0.1,
      maxTokens: 4096,
      timeoutMs: 45_000,
      messages: [
        {
          role: "system",
          content:
            "Fix a small repo. Reply with markdown fences. The first line inside each fence must be the relative path, for example src/service/price.js. Do not call tools.",
        },
        {
          role: "user",
          content: `${goal.text}\n\n${defects.length ? `Test log:\n${defects.join("\n")}\n\n` : ""}${snippets
            .map((row) => `--- ${row.path}\n${row.content}`)
            .join("\n")}`,
        },
      ],
    });
    const files = extractFencedFiles(shot.content);
    if (!Object.keys(files).length && snippets.length === 1) {
      const fence = shot.content.match(/```(?:[\w.+-]*)\s*\n([\s\S]*?)```/);
      const body = (fence?.[1] || shot.content).replace(/^```[\w.+-]*\s*/m, "").replace(/```\s*$/m, "").trimEnd();
      if (body.includes("function") || body.includes("module.exports") || body.includes("export ")) {
        files[snippets[0].path] = `${body}\n`;
      }
    }
    const written: string[] = [];
    for (const [rel, body] of Object.entries(files)) {
      await writeWorkspaceFile(rel, body);
      written.push(rel.replace(/\\/g, "/"));
    }
    if (written.length) send?.("status", { text: `записал ${written.join(", ")} · гоняю тест` });
    return written;
  } catch {
    return [];
  }
}

/**
 * One kernel. Chat / CLI / API are shells.
 * Auto: attach chat / patch / loop / graph only as needed. No client toggle.
 */
export async function handleFyodor(request: FyodorHandleRequest): Promise<FyodorHandleResult> {
  return runInJob(request.jobId, () => handleFyodorInner(request));
}

async function handleFyodorInner(request: FyodorHandleRequest): Promise<FyodorHandleResult> {
  throwIfAborted(request.signal);
  const repo = pathResolve(request.repo || getWorkspaceRoot());
  const send = request.send;
  const jobId = request.jobId?.trim() || undefined;
  if (looksLikeStopCommand(request.userText)) {
    send?.("text", { delta: "Остановлено. Жду следующую задачу." });
    send?.("status", { text: "Остановлено." });
    const report = emptyReport("L0", request.userText, { how_to_verify: "Кодер остановлен по команде." });
    return { todos: [], usedTools: [], mode: "solo", level: "L0", attach: "chat", report, promoted: false, auto: "off" };
  }
  const goal = normalizeTask(request.userText, repo);
  const prev = loadSession(repo, jobId);
  const historyTurns = request.history?.length || 0;
  const classified = classifyLevel(request.userText, goal, {
    historyTurns,
    sameFileEdits: prev?.sameFileEdits,
    taskMs: prev ? Date.now() - prev.startedAt : 0,
    hadEdits: prev?.hadEdits,
    failedChecks: prev?.failedChecks,
    hasTestOrBuild: true,
    forceLevel: request.forceLevel,
  });

  let level = classified.level;
  let attach = classified.attach;
  const continuing =
    Boolean(prev?.open && prev.level !== "L0" && goal.writes && (looksLikeFollowUp(request.userText) || !goalChanged(prev.goal, goal.text)));

  if (continuing && prev?.level === "L2") {
    level = "L2";
    attach = "graph";
  } else if (continuing && prev?.level === "L1") {
    level = "L1";
    attach = (prev.failedChecks || 0) >= 1 ? "loop" : attach === "graph" ? "loop" : attach === "chat" ? "patch" : attach;
  } else if (prev?.open && prev.level !== "L0" && !goal.writes && level === "L0") {
    level = "L0";
    attach = "chat";
  }

  const routed = routeLlm(attach, request.settings);
  request.settings = routed.usedStrong ? fastSettings(request.settings) : routed.settings;

  const promoted = shouldAnnouncePromotion(continuing ? level : prev?.open ? prev.level : null, level);
  const auto: "on" | "off" = level === "L0" ? "off" : "on";

  const namedHint = [...`${goal.text}\n${request.userText}`.match(/[\w./-]+\.(?:js|ts|tsx|jsx|py|json|md|css|html)/gi) || []]
    .filter((item) => !/\.(test|spec)\./i.test(item) && !/(^|\/)tests?\//i.test(item));
  const namedSources = [...new Set(namedHint.map((item) => item.replace(/\\/g, "/")))];
  if (level !== "L0") {
    send?.("status", {
      text: namedSources.length ? `читаю ${namedSources.slice(0, 3).join(", ")}` : "читаю файлы задачи",
    });
  }
  emit(
    send,
    "coordinator",
    "running",
    level === "L0"
      ? looksLikeOperate(request.userText)
        ? "Оператор: кликаю в окне и в браузере до результата, сам не останавливаюсь."
        : "Смотрю задачу. Если это чат — ответит кодер, без лишних кругов."
      : attach === "patch"
        ? namedSources.length
          ? `Короткий патч: читаю ${namedSources.join(", ")} и гоняю тест.`
          : "Короткий патч: правлю файлы и гоняю тест."
        : attach === "loop"
          ? "Тест красный — правлю по логу, без широкого графа."
          : "Разбираю задачу по частям: кто пишет, кто проверяет.",
  );

  if (level === "L0") {
    if (prev?.open && prev.level !== "L0") {
      saveSession(repo, { ...prev, open: false, level: "L0" }, jobId);
    }
    emit(
      send,
      "coordinator",
      "done",
      looksLikeOperate(request.userText)
        ? "Короткий путь: кодер действует в окне и в браузере до результата."
        : "Короткий путь: кодер отвечает в чат.",
    );
    if (request.hooks?.skipLlm) {
      const report = emptyReport("L0", goal.text);
      return { todos: [], usedTools: [], mode: "solo", level, attach: "chat", report, promoted: false, auto: "off" };
    }
    const remembered = looksLikeOperate(request.userText)
      ? null
      : answerFromMemory(request.userText, request.history || []);
    if (remembered) {
      send?.("text", { delta: remembered });
      const report = emptyReport("L0", goal.text, { how_to_verify: "Ответ из Super Memory." });
      return { todos: [], usedTools: ["memory_recall"], mode: "solo", level, attach: "chat", report, promoted: false, auto: "off" };
    }
    const crew = await runCrewGraph({
      history: request.history || [{ role: "user", content: request.userText }],
      lastUser: request.userText,
      crewEnabled: request.crewEnabled !== false,
      settings: request.settings as LlmSettings,
      fallback: request.fallback ?? null,
      send: send || (() => undefined),
      tools: GROK_TOOLS,
      maxTurns: GOAL_KEEP_GOING,
      light: true,
      signal: request.signal,
      role: request.role,
    });
    await finishVisiblePcWork(request.userText, crew.changedPaths || [], send);
    return {
      todos: crew.todos,
      usedTools: crew.usedTools,
      mode: crew.mode,
      level,
      attach: "chat",
      report: emptyReport("L0", goal.text),
      promoted: false,
      auto: "off",
    };
  }

  if (promoted) {
    send?.("text", { delta: `${PROMOTION}\n\n` });
  }

  if (prev && goalChanged(prev.goal, goal.text) && !continuing && prev.open) {
    archiveAgent(repo, jobId);
  }

  const budget = budgetForPlan(request.planId);
  const lite = attach === "patch";
  const maxLoops = clampLoops(256, budget);
  emit(
    send,
    "coordinator",
    "done",
    lite
      ? "Короткий патч. Пишу файлы и гоняю тест."
      : attach === "loop"
        ? "Правлю по логу теста."
        : `Уровень ${level}: пишу узлы и сразу проверяю.`,
  );

  const session: AgentSession = {
    goal: goal.text,
    level,
    open: true,
    startedAt: continuing && prev ? prev.startedAt : Date.now(),
    announced: true,
    hadEdits: true,
    failedChecks: prev?.failedChecks || 0,
    sameFileEdits: continuing ? (prev?.sameFileEdits || 0) + 1 : 1,
    lastFiles: prev?.lastFiles || [],
    graph: continuing ? prev?.graph : undefined,
  };

  if (level === "L1") {
    const graph = session.graph?.nodes.length ? cloneGraph(session.graph) : defaultL1Graph(maxLoops);
    validateGraph(graph, "L1");
    session.graph = graph;
    saveSession(repo, session, jobId);
    const node = graph.nodes[0];
    const outcome = await runCodedNode({
      repo,
      node,
      maxLoops,
      goal,
      request,
      defects: continuing ? [request.userText] : [],
      maxTurns: GOAL_KEEP_GOING,
      useKiller: !lite,
    });
    markStatus(graph, node.id, outcome.status === "PASS" ? "pass" : "blocked");
    session.graph = graph;
    session.failedChecks += outcome.attempts.filter((item) => item.result === "FAIL").length;
    session.lastFiles = outcome.filesTouched;
    session.open = outcome.status !== "PASS";
    saveSession(repo, session, jobId);
    const report = buildReport(level, goal, graph, outcome, request.userText);
    if (!request.hooks?.skipLlm) {
      const visible = await finishVisiblePcWork(request.userText, outcome.filesTouched, send);
      if (!looksLikeSimpleHostTask(request.userText) && !visible.opened.length) {
        if (lite && outcome.status === "PASS") {
          const files = outcome.filesTouched.join(", ") || "без файлов";
          send?.("text", { delta: `\n\nГотово · ${files}\n` });
        } else if (request.settings || outcome.status !== "PASS") {
          send?.("text", { delta: `\n\n${formatChatStatus(report)}\n` });
        }
      }
    }
    appendDecisionMd(repo, formatReport(report), jobId);
    return {
      todos: [],
      usedTools: outcome.filesTouched.length ? ["write_file"] : [],
      mode: "fyodor",
      level,
      attach,
      report,
      promoted,
      auto: "on",
    };
  }

  let graph = session.graph?.nodes.length
    ? cloneGraph(session.graph)
    : defaultL2Graph({ collapseEdges: classified.signals.filesEst <= 2 && !classified.signals.independentChunks, maxLoops });
  if (!request.hooks?.skipLlm && request.settings && !continuing) {
    const planned = await planGraph(request, goal, maxLoops, graph);
    if (planned) graph = planned;
  }
  try {
    validateGraph(graph, "L2");
  } catch {
    graph = defaultL2Graph({ collapseEdges: true, maxLoops });
    validateGraph(graph, "L2");
  }
  session.graph = graph;
  saveSession(repo, session, jobId);

  const allFiles: string[] = [];
  const allChecks: FyodorReport["checks"] = [];
  let escalate = "";

  let graphRounds = 0;
  while (hasUnfinished(graph)) {
    throwIfAborted(request.signal);
    graphRounds += 1;
    if (graphRounds > GOAL_KEEP_GOING) {
      escalate = "Слишком много кругов по узлам. Остановился: мозговой трест не закрыл задачу. Жду следующую или «стоп».";
      break;
    }
    const batch = nextBatch(graph).slice(0, Math.max(1, budget.parallel));
    if (!batch.length) {
      if (dependentsBlocked(graph) || graph.nodes.some((item) => item.status === "blocked")) {
        escalate = "Узел заблокирован, зависимые не стартовали. Что чинить в первую очередь?";
      }
      break;
    }
    await Promise.all(
      batch.map(async (node) => {
        markStatus(graph, node.id, "running");
        emit(send, node.id, "running", `${crewSeatLabel(node.id)} берёт узел «${node.title || node.kind}».`);
        if (node.kind === "VERIFIER" || node.role === "killer") {
          const killer = request.hooks?.killer
            ? await request.hooks.killer({
                repo,
                node,
                filesTouched: allFiles,
                check: { exitCode: 0, output: "pre-killer", command: "none" },
                defects: [],
              })
            : heuristicKiller({ checkExit: 0, filesTouched: allFiles });
          if (killer.verdict === "KILL") {
            markStatus(graph, node.id, "blocked");
            escalate = killer.must_fix_now[0] || "VERIFIER отклонил. Что обязательно починить?";
          } else {
            markStatus(graph, node.id, "pass");
          }
          emit(
            send,
            node.id,
            killer.verdict === "PASS" ? "done" : "handoff",
            killer.verdict === "PASS"
              ? "Проверка пропустила код."
              : (killer.must_fix_now?.[0] || "Проверка завернула. Нужна правка."),
          );
          return;
        }
        if (node.kind === "REPORT" || node.kind === "REPO_RECON" || node.kind === "SPEC" || node.kind === "INTEGRATE") {
          markStatus(graph, node.id, "pass");
          emit(send, node.id, "done", `${crewSeatLabel(node.id)}: узел закрыт без правки файлов.`);
          return;
        }
        const outcome = await runCodedNode({
          repo,
          node,
          maxLoops: clampLoops(node.max_loops, budget),
          goal,
          request,
          defects: continuing ? [request.userText] : [],
          maxTurns: GOAL_KEEP_GOING,
          useKiller: node.kind === "GREEN" || node.kind === "EDGES",
        });
        allFiles.push(...outcome.filesTouched);
        for (const attempt of outcome.attempts) {
          allChecks.push({ command: `${node.id}#${attempt.attempt}`, exit: attempt.checkExit, output: attempt.checkOutput });
        }
        if (outcome.status === "PASS") markStatus(graph, node.id, "pass");
        else {
          markStatus(graph, node.id, "blocked");
          escalate = `Узел ${node.id} ${outcome.status}. Что делать дальше?`;
        }
        emit(
          send,
          node.id,
          outcome.status === "PASS" ? "done" : "handoff",
          (
            outcome.attempts.at(-1)?.checkOutput ||
            (outcome.status === "PASS" ? `${crewSeatLabel(node.id)}: узел закрыт.` : `${crewSeatLabel(node.id)}: ${outcome.status}`)
          )
            .replace(/\s+/g, " ")
            .slice(0, 700),
        );
      }),
    );
    if (escalate) break;
  }

  session.graph = graph;
  session.lastFiles = allFiles;
  session.open = Boolean(escalate) || graph.nodes.some((item) => item.status !== "pass");
  saveSession(repo, session, jobId);
  const report: FyodorReport = {
    status: escalate ? "ESCALATE" : "DONE",
    level,
    goal: goal.text,
    nodes: graph.nodes.map((item) => ({ id: item.id, status: item.status })),
    checks: allChecks,
    files: [...new Set(allFiles)],
    residual_risk: defaultResidual(level),
    how_to_verify: allChecks[0] ? `Повторить ${allChecks[0].command}` : "Прогнать тесты в репозитории.",
    escalate_question: escalate || undefined,
  };
  appendDecisionMd(repo, formatReport(report), jobId);
  if (!request.hooks?.skipLlm) {
    const visible = await finishVisiblePcWork(request.userText, report.files, send);
    if (!visible.opened.length) send?.("text", { delta: `\n\n${formatChatStatus(report)}\n` });
  }
  return {
    todos: [],
    usedTools: allFiles.length ? ["write_file"] : [],
    mode: "fyodor",
    level,
    attach: "graph",
    report,
    promoted,
    auto: "on",
  };
}

function pathResolve(repo: string): string {
  return repo;
}

async function planGraph(
  request: FyodorHandleRequest,
  goal: Goal,
  maxLoops: number,
  fallback: FyodorGraph,
): Promise<FyodorGraph | null> {
  if (!request.settings) return null;
  try {
    const messages = buildRoleMessages({ role: "planner", node: null, userText: goal.text, goal });
    const result = await runToolAgent({
      settings: request.settings,
      messages,
      tools: grokToolsFor("planner"),
      temperature: 0.1,
      maxTurns: 2,
      streamText: false,
      send: request.send || (() => undefined),
      rebuildSystem: async () => messages[0].content,
      fallback: request.fallback,
      todos: [],
      usedTools: [],
      signal: request.signal,
    });
    const parsed = parsePlannerGraph(result.content, maxLoops);
    if (!parsed) return fallback;
    validateGraph(parsed, "L2");
    return parsed;
  } catch {
    return fallback;
  }
}

async function runCodedNode(opts: {
  repo: string;
  node: GraphNode;
  maxLoops: number;
  goal: Goal;
  request: FyodorHandleRequest;
  defects: string[];
  maxTurns?: number;
  useKiller?: boolean;
}) {
  const { repo, node, maxLoops, goal, request, defects } = opts;
  const maxTurns = Math.max(GOAL_KEEP_GOING, opts.maxTurns ?? GOAL_KEEP_GOING);
  const produce: ProduceFn =
    request.hooks?.produce ||
    (async ({ attempt, defects: loopDefects }) => {
      if (!request.settings) return { filesTouched: [], claimedPass: false };
      const sourceHint = [
        ...`${goal.text}\n${request.userText}`.match(/[\w./-]+\.(?:js|ts|tsx|jsx|py|json|md|css|html)/gi) || [],
      ].filter((item) => !/\.(test|spec)\./i.test(item) && !/(^|\/)tests?\//i.test(item));
      const sourceCount = new Set(sourceHint.map((item) => item.replace(/\\/g, "/").toLowerCase())).size;
      if (attempt === 1 && !loopDefects.length) {
        const drafted = await tryNoToolsDraft(
          repo,
          goal,
          request.userText,
          request.settings || fastSettings(),
          request.send,
          sourceCount >= 2 ? "пишу черновик" : "пишу файл",
        );
        if (drafted.length) return { filesTouched: drafted };
      }
      if (attempt >= 2 && sourceCount >= 2 && loopDefects.length) {
        const drafted = await tryNoToolsDraft(
          repo,
          goal,
          request.userText,
          draftSettings(),
          request.send,
          "тест красный, пишу второй черновик",
          loopDefects,
        );
        if (drafted.length) return { filesTouched: drafted };
      }
      const snippetPaths = [
        ...(node.writes || []),
        ...(request.history || [])
          .map((row) => row.content)
          .join("\n")
          .match(/[\w./-]+\.(?:js|ts|tsx|jsx|py|json|md|css|html)/gi) || [],
      ];
      const messages = buildRoleMessages({
        role: "implementer",
        node,
        userText: goal.text,
        goal,
        defects: loopDefects,
        history: request.history,
        memoryBlock: implementerMemory(`${goal.text}\n${request.userText}`),
        fileSnippets: collectFileSnippets(repo, snippetPaths),
      });
      const result = await runToolAgent({
        settings: request.settings,
        messages,
        tools: grokToolsFor("implementer"),
        temperature: 0.3,
        maxTurns,
        streamText: true,
        send: request.send || (() => undefined),
        rebuildSystem: async () => messages[0].content,
        fallback: request.fallback,
        todos: [],
        usedTools: [],
        userGoal: goal.text,
        signal: request.signal,
      });
      void attempt;
      return {
        filesTouched: result.changedPaths,
        notes: result.content,
        claimedPass: /\bPASS\b/.test(result.content),
      };
    });

  const check: CheckFn =
    request.hooks?.check ||
    (async ({ filesTouched }) => {
      ensureHarness(repo);
      return runCheck(repo, filesTouched, /без тестов|without tests/i.test(goal.text));
    });

  const allowKiller = opts.useKiller !== false && (node.kind === "GREEN" || node.kind === "EDGES" || Boolean(request.hooks?.killer));
  const killer: KillerFn | undefined = !allowKiller
    ? undefined
    : request.hooks?.killer ||
      (async ({ check: checkResult, filesTouched }) => heuristicKiller({ checkExit: checkResult.exitCode, filesTouched }));

  return runLoopEngine({
    repo,
    node,
    maxLoops,
    produce,
    check,
    killer,
    signal: request.signal,
    logAttempt: (row) => appendLoop(repo, row, request.jobId),
    onProgress: (note, attempt, checkFlag) => {
      emit(
        request.send,
        node.id,
        checkFlag === "FAIL" ? "handoff" : "running",
        note || `${crewSeatLabel(node.id)} · цикл ${attempt}`,
      );
    },
  });
}

function buildReport(
  level: FyodorLevel,
  goal: Goal,
  graph: FyodorGraph,
  outcome: Awaited<ReturnType<typeof runLoopEngine>>,
  userText: string,
): FyodorReport {
  const blocked = outcome.status !== "PASS";
  return {
    status: blocked ? "ESCALATE" : "DONE",
    level,
    goal: goal.text || userText,
    nodes: graph.nodes.map((item) => ({ id: item.id, status: item.status })),
    checks: outcome.attempts.map((item) => ({
      command: `${item.nodeId}#${item.attempt}`,
      exit: item.checkExit,
      output: item.checkOutput,
    })),
    files: outcome.filesTouched,
    residual_risk: defaultResidual(level),
    how_to_verify: outcome.attempts.length
      ? `Повторить check узла ${outcome.attempts[0].nodeId}`
      : "Прогнать тесты.",
    escalate_question: blocked
      ? outcome.status === "BLOCKED"
        ? "Круги проверки исчерпаны. Какой один следующий шаг?"
        : "Проверка отклонила результат. Что обязательно починить?"
      : undefined,
  };
}

export const LEVEL_ROUTER = "lib/fyodor/classifier.ts";
export { PROMOTION };
