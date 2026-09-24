import { isFreeEdition } from "@/lib/brand";
import { meterPaidChatTurn, quotaOf, userByToken } from "@/lib/commerce/store";
import { answerLocalAsks, flushDailyIfDue, pendingAskIds, pushRemoteTokenReport } from "@/lib/commerce/token-sync";
import { trimHistoryForModel } from "@/lib/chat-store";
import { ensureWorkspace, getWorkspaceRoot } from "@/lib/host-fs";
import { resolveChatSettings } from "@/lib/providers";
import { recordMemoryEvent } from "@/lib/super-memory";
import { coachLesson, recordCoachEpisode } from "@/lib/step-coach";
import { handleFyodor } from "@/lib/fyodor/handle";
import type { ConnectionSettings } from "@/lib/types";
import { abortJob, beginJob, endJob, isAbortError } from "@/lib/run-control";
import { looksLikeStopCommand } from "@/lib/fyodor/intent";
import { logError } from "@/lib/error-log";
import { parseAppRole } from "@/lib/colleague/heartbeat";
import type { AppRole } from "@/lib/colleague/types";

export const runtime = "nodejs";
export const maxDuration = 3600;

type IncomingMessage = {
  role: "user" | "assistant";
  content: string;
};

type ChatBody = {
  action?: string;
  messages: IncomingMessage[];
  mode?: string;
  settings?: Partial<ConnectionSettings>;
  accountToken?: string;
  crew?: boolean;
  threadId?: string;
  role?: AppRole;
};

function encoder() {
  const text = new TextEncoder();
  return {
    send(controller: ReadableStreamDefaultController, event: string, data: unknown) {
      controller.enqueue(text.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    },
  };
}

function resolveSettings(settings?: Partial<ConnectionSettings>) {
  return resolveChatSettings(settings);
}

export async function POST(request: Request) {
  let body: ChatBody;
  try {
    body = (await request.json()) as ChatBody;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  if (body.action === "abort") {
    const stopped = abortJob(body.threadId);
    return new Response(JSON.stringify({ ok: true, stopped }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const settings = resolveSettings(body.settings);
  if (!settings.apiKey) {
    return new Response(
      JSON.stringify({
        error: "No API key. Add GROK_API_KEY in .env.local or paste a key in Settings.",
      }),
      { status: 401 },
    );
  }

  await ensureWorkspace();
  const lastUser = [...(body.messages ?? [])].reverse().find((message) => message.role === "user");
  let accountToken = body.accountToken?.trim() || "";
  if (!isFreeEdition() && !looksLikeStopCommand(lastUser?.content || "")) {
    try {
      const gate = meterPaidChatTurn(accountToken, lastUser?.content || " ");
      accountToken = gate.token;
      try {
        const me = userByToken(accountToken);
        if (me) {
          const payload = {
            userId: me.id,
            email: me.email,
            lifetimeTokens: me.lifetimeTokens || 0,
            usedInWeek: me.usedInWeek,
            usedInFreeWindow: me.usedInFreeWindow,
            lastTokenReportAt: me.lastTokenReportAt,
          };
          answerLocalAsks(payload);
          flushDailyIfDue(payload);
          void pushRemoteTokenReport({ token: accountToken, ...payload, lastSeenAt: Date.now() });
        }
      } catch {
        // token report must not block chat
      }
      if (!gate.ok) {
        const when = new Date(gate.quota.resetAt).toLocaleString("ru-RU");
        return new Response(
          JSON.stringify({
            error: `Лимит тарифа «${gate.quota.planName}» исчерпан. Окно обновится ${when}. Открываю страницу тарифов и оплаты.`,
            quota: gate.quota,
            openPay: true,
            payUrl: gate.payUrl,
          }),
          { status: 402 },
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Учёт временно недоступен";
      return new Response(JSON.stringify({ error: message, openPay: false }), {
        status: 503,
      });
    }
  }
  if (lastUser?.content) {
    try {
      recordMemoryEvent({ kind: "user", text: lastUser.content });
    } catch {
      // memory must never block chat
    }
  }

  const history = trimHistoryForModel(body.messages ?? []);
  const { send } = encoder();
  const fallback = null;
  const job = beginJob(body.threadId);
  const onClientGone = () => abortJob(body.threadId, job);
  try {
    request.signal.addEventListener("abort", onClientGone);
  } catch {
    // ignore
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        if (accountToken) send(controller, "account", { token: accountToken });
        const account = userByToken(accountToken);
        const outcome = await handleFyodor({
          repo: getWorkspaceRoot(),
          userText: lastUser?.content || "",
          history,
          crewEnabled: body.crew !== false,
          jobId: body.threadId,
          settings,
          fallback,
          planId: account?.planId,
          signal: job.signal,
          role: parseAppRole(body.role),
          send: (event, data) => {
            if (job.signal.aborted) return;
            send(controller, event, data);
          },
        });
        if (job.signal.aborted) {
          send(controller, "status", { text: "Остановлено." });
          send(controller, "done", { todos: outcome.todos, stopped: true });
          controller.close();
          return;
        }
        if (accountToken) {
          try {
            const account = userByToken(accountToken);
            if (account) send(controller, "quota", quotaOf(account));
          } catch {
            // ignore
          }
        }
        try {
          const episode = recordCoachEpisode({
            task: lastUser?.content || "",
            tools: outcome.usedTools,
          });
          send(controller, "coach", {
            steps: episode.steps,
            best: episode.best,
            grade: episode.grade,
            lesson: coachLesson(episode),
          });
        } catch {
          // coach must never block chat
        }
        send(controller, "done", {
          todos: outcome.todos,
          mode: outcome.mode,
          level: outcome.level,
          auto: outcome.auto,
        });
        controller.close();
      } catch (error) {
        if (isAbortError(error) || job.signal.aborted) {
          try {
            send(controller, "status", { text: "Остановлено." });
            send(controller, "done", { todos: [], stopped: true });
            controller.close();
          } catch {
            // already closed
          }
          return;
        }
        const message = error instanceof Error ? error.message : "Unknown error";
        logError(error, "chat");
        send(controller, "error", { message });
        send(controller, "done", { todos: [] });
        controller.close();
      } finally {
        endJob(body.threadId, job);
        try {
          request.signal.removeEventListener("abort", onClientGone);
        } catch {
          // ignore
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
