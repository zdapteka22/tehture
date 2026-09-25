"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Copy,
  ShieldCheck,
  Users,
  FileCode2,
  Files,
  Folder,
  FolderOpen,
  Link2,
  FolderGit2,
  Handshake,
  HardDrive,
  Loader2,
  Mail,
  MessageSquare,
  Monitor,
  Bot,
  Paperclip,
  Plus,
  ArrowUp,
  Settings2,
  Square,
  Sun,
  Moon,
  Target,
  TerminalSquare,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { IS_FREE_EDITION } from "@/lib/brand";
import { applyTheme, loadTheme, type FedorTheme } from "@/lib/theme";
import { PaySettings } from "@/components/pay-settings";
import { openPayPage, shouldOpenPay, type PayGatePayload } from "@/lib/pay-gate";
import { eulaTitle } from "@/lib/eula";
import { ChatMarkdown } from "@/components/chat-markdown";
import { AaCorner } from "@/components/aa-mark";
import { GrokMark, WorkMark } from "@/components/grok-mark";
import { WorkDock } from "@/components/work-dock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { appendChatTurn, groupTurns, loadThreads, titleFrom, emptyThread } from "@/lib/chat-store";
import { looksLikeStopCommand } from "@/lib/fyodor/intent";
import { APP_TITLE } from "@/lib/brand";
import { WHAT_NEW } from "@/lib/whats-new";
import { liveBusyLabel, liveWorkLine, mergeLiveCrew, mergeLiveTools, pickLiveMessage } from "@/lib/live-status";
import { copyText } from "@/lib/copy-text";
import { CLOUD_BANNER_MS } from "@/lib/cloud-banner";
import { closeStudioPane, ensureStudioPane } from "@/lib/studio-panes";
import {
  WORK_W_DEFAULT,
  WORK_W_SHOW,
  dragWorkWidth,
  loadWorkPinned,
  loadWorkWidth,
  restoreWorkWidth,
  workDockShown,
} from "@/lib/work-pane";
import { DEFAULT_SETTINGS, PROVIDERS } from "@/lib/providers";
import type {
  ChatMessage,
  ChatThread,
  ComputerLog,
  ConnectionSettings,
  CrewStep,
  FileMap,
  PeerPublicStatus,
  ProviderId,
  TodoItem,
  ToolCallEvent,
} from "@/lib/types";
import type { TreeNode } from "@/lib/workspace";

const MonacoPane = dynamic(
  () => import("@/components/monaco-pane").then((mod) => mod.MonacoPane),
  {
    ssr: false,
    loading: () => <div className="h-full bg-[#1e1e1e]" />,
  }
);

const SETTINGS_KEY = "fedor2-settings";
const THREADS_KEY = "fedor2-threads-v1";
const ACCOUNT_KEY = "fedor2-account-token";
let studioAccountBooted = false;
const CREW_KEY = "fedor2-crew-enabled";
const HELPER_KEY = "fedor3-role";
const WORK_KEY = "fedor2-work-pinned";
const SIDE_W_KEY = "fedor2-side-w";
const WORK_W_KEY = "fedor2-work-w";
const CHAT_W_KEY = "fedor2-chat-w";
const CHAT_H_KEY = "fedor2-chat-h";
const SIDE_W_DEFAULT = 256;
const CHAT_W_DEFAULT = 672;
const CHAT_H_DEFAULT = 200;
const SIDE_W_MIN = 0;
const CHAT_W_MIN = 0;
const CHAT_H_MIN = 18;
const SIDE_W_MAX = 720;
const CHAT_W_MAX = 2400;
const CHAT_H_MAX = 900;
const CHAT_OPEN_KEY = "fedor2-chat-open";
const EDITOR_OPEN_KEY = "fedor2-editor-open";
const GITHUB_ASK_KEY = "fedor2-github-asked";
const GITHUB_NAG_KEY = "fedor2-github-nag";
const CLOUD_BANNER_KEY = "fedor2-cloud-banner-gone";

type GithubStatus = {
  connected: boolean;
  user: string | null;
  remote: string | null;
  ghInstalled: boolean;
  gitInstalled: boolean;
  hasToken: boolean;
  message: string;
};

type CloudProvider = "yadisk" | "mailru" | "onedrive" | "gdrive" | "dropbox";

type CloudStatus = {
  connected: boolean;
  provider: CloudProvider | null;
  folder: string | null;
  candidates: { provider: CloudProvider; label: string; folder: string }[];
  message: string;
};

type MailProvider = "yandex" | "mailru" | "gmail" | "outlook";

type MailStatus = {
  connected: boolean;
  provider: MailProvider | null;
  label: string | null;
  url: string | null;
  clients: string[];
  message: string;
};

const CLOUD_CONNECT_OPTIONS: Array<{ id: CloudProvider; label: string }> = [
  { id: "yadisk", label: "Яндекс Диск" },
  { id: "mailru", label: "Облако Mail.ru" },
  { id: "onedrive", label: "OneDrive" },
  { id: "gdrive", label: "Google Диск" },
  { id: "dropbox", label: "Dropbox" },
];

const MAIL_CONNECT_OPTIONS: Array<{ id: MailProvider; label: string }> = [
  { id: "yandex", label: "Яндекс Почта" },
  { id: "mailru", label: "Почта Mail.ru" },
  { id: "gmail", label: "Gmail" },
  { id: "outlook", label: "Outlook" },
];

type PendingFile = { name: string; text: string };

function formatAttachments(files: PendingFile[], text: string): string {
  if (!files.length) return text;
  const blocks = files
    .map((file) => `### ${file.name}\n${file.text}`)
    .join("\n\n");
  return `<attached_files>\n${blocks}\n</attached_files>\n\n${text}`;
}

function loadJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readAccountToken(key: string): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return "";
    if (raw.startsWith('"')) {
      const parsed = JSON.parse(raw) as unknown;
      return typeof parsed === "string" ? parsed : "";
    }
    return raw;
  } catch {
    try {
      return localStorage.getItem(key) || "";
    } catch {
      return "";
    }
  }
}

type MobileView = "files" | "editor" | "chat";

type MemorySnapshot = {
  enabled: boolean;
  entropy: number;
  redundancy: number;
  events: number;
  unique: number;
  dir: string;
  facts: { id: string; text: string; hits: number }[];
  skills: { id: string; title: string; count: number }[];
  suggestions: { id: string; title: string; detail: string; prompt?: string }[];
  hygiene?: { lastAt: number; dropped: number };
  profile: {
    language: string;
    topCommands: { text: string; count: number }[];
    git?: { branch?: string; dirty?: number; lastCommit?: string };
  };
};

type CoachSnapshot = {
  teaching: boolean;
  dir: string;
  episodes: number;
  averageSteps: number;
  recipes: { id: string; title: string; bestCount: number; path: string[]; samples: number }[];
  recent: { id: string; task: string; steps: number; best: number; grade: string }[];
};

type CrewLogItem = {
  id: string;
  at: number;
  task: string;
  why: string;
  verdict?: string;
};

type QuotaView = {
  planId: string;
  planName: string;
  tokensLeft: number;
  tokensCap: number;
  extraTokens: number;
  resetAt: number;
  windowKind: "week" | "free2h";
  blocked: boolean;
  openPay?: boolean;
};

type HubUserView = {
  id: string;
  email: string;
  name: string;
  planId: string;
  quota: QuotaView;
};

type HelperWatchView = {
  apps: Array<{ id: string; name: string; path: string }>;
  agents: Array<{ id: string; name: string; path: string; kind: string; detail: string }>;
  limit: number | null;
  remaining: number | null;
  message: string;
};

type GrokDesktopApi = {
  isDesktop?: boolean;
  pickOpen?: (kind: "app" | "agent" | "agent-folder") => Promise<{ path?: string } | string | null>;
};

const SUGGESTIONS = [
  "Создай текстовый файл на рабочем столе и открой его",
  "Открой браузер и зайди на https://example.com",
  "Запусти калькулятор",
];

function firstFile(nodes: TreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "file") return node.path;
    if (node.children?.length) {
      const nested = firstFile(node.children);
      if (nested) return nested;
    }
  }
  return null;
}

function treeHasPath(nodes: TreeNode[], path: string): boolean {
  return nodes.some(
    (node) => node.path === path || (node.children ? treeHasPath(node.children, path) : false)
  );
}

function uid() {
  return crypto.randomUUID();
}

function readSse(
  buffer: string,
  onEvent: (event: string, data: unknown) => void
): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const part of parts) {
    const event = part.match(/^event:\s*(.+)$/m)?.[1]?.trim();
    const data = part
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!event || !data) continue;
    try {
      onEvent(event, JSON.parse(data));
    } catch {
      onEvent(event, { raw: data });
    }
  }
  return rest;
}

function SendMark() {
  return <ArrowUp className="size-4" strokeWidth={2.35} />;
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Math.round(n)));
}

function SplitHandle({
  label,
  onDelta,
  onReset,
  onDragStart,
  onDragEnd,
}: {
  label: string;
  onDelta: (dx: number) => void;
  onReset: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
}) {
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation="vertical"
      tabIndex={0}
      className="relative z-30 hidden h-full w-2 shrink-0 cursor-col-resize touch-none bg-transparent hover:bg-[#7c5cff]/50 active:bg-[#7c5cff]/80 sm:block"
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const el = event.currentTarget;
        const pointerId = event.pointerId;
        try {
          el.setPointerCapture(pointerId);
        } catch {
          /* capture is optional; document listeners still move the split */
        }
        onDragStart?.();
        let last = event.clientX;
        const move = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          const dx = ev.clientX - last;
          last = ev.clientX;
          if (dx) onDelta(dx);
        };
        const up = (ev: PointerEvent) => {
          if (ev.pointerId !== pointerId) return;
          try {
            el.releasePointerCapture(pointerId);
          } catch {
            /* already released */
          }
          document.removeEventListener("pointermove", move);
          document.removeEventListener("pointerup", up);
          document.removeEventListener("pointercancel", up);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
          onDragEnd?.();
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("pointermove", move);
        document.addEventListener("pointerup", up);
        document.addEventListener("pointercancel", up);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onDelta(-16);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onDelta(16);
        }
      }}
    />
  );
}

function ComposerWidth({
  width,
  onDelta,
  onReset,
  children,
}: {
  width: number;
  onDelta: (dx: number) => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  const collapsed = width < 28;
  const edge = (side: "left" | "right") => (
    <div
      role="separator"
      aria-label={side === "left" ? "Ширина поля ввода слева" : "Ширина поля ввода справа"}
      aria-orientation="vertical"
      tabIndex={0}
      className="absolute inset-y-1 z-20 w-3 cursor-col-resize touch-none"
      style={side === "left" ? { left: -6 } : { right: -6 }}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const el = event.currentTarget;
        el.setPointerCapture(event.pointerId);
        let last = event.clientX;
        const move = (ev: PointerEvent) => {
          const dx = ev.clientX - last;
          last = ev.clientX;
          onDelta(side === "left" ? -dx : dx);
        };
        const up = () => {
          el.releasePointerCapture(event.pointerId);
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          document.body.style.cursor = "";
          document.body.style.userSelect = "";
        };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          onDelta(side === "left" ? 16 : -16);
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          onDelta(side === "left" ? -16 : 16);
        }
      }}
    >
      <div className="mx-auto h-full w-1 rounded-full bg-transparent hover:bg-[#7c5cff]/70 active:bg-[#7c5cff]" />
    </div>
  );

  if (collapsed) {
    return (
      <div className="mx-auto flex w-full max-w-full justify-center">
        <button
          type="button"
          className="h-3 w-28 cursor-col-resize rounded-full border border-white/20 bg-white/10 hover:bg-[#7c5cff]/50"
          aria-label="Открыть поле ввода"
          title="Потяните или нажмите — откроется поле, куда писать"
          onClick={onReset}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            const el = event.currentTarget;
            el.setPointerCapture(event.pointerId);
            let last = event.clientX;
            const move = (ev: PointerEvent) => {
              const dx = Math.abs(ev.clientX - last);
              if (dx > 2) onDelta(dx * 2);
              last = ev.clientX;
            };
            const up = () => {
              el.releasePointerCapture(event.pointerId);
              el.removeEventListener("pointermove", move);
              el.removeEventListener("pointerup", up);
            };
            el.addEventListener("pointermove", move);
            el.addEventListener("pointerup", up);
          }}
        />
      </div>
    );
  }

  return (
    <div className="relative mx-auto flex h-full min-h-0 w-full max-w-full flex-col" style={{ width, maxWidth: "100%" }}>
      {edge("left")}
      {children}
      {edge("right")}
    </div>
  );
}

function ComposerShelf({
  height,
  onDelta,
  onReset,
  children,
}: {
  height: number;
  onDelta: (dy: number) => void;
  onReset: () => void;
  children: React.ReactNode;
}) {
  const collapsed = height < 40;
  return (
    <div className="relative shrink-0 bg-[#0b0b0b] md:pr-12" style={{ height: collapsed ? 22 : height }}>
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Высота поля ввода"
        tabIndex={0}
        className="absolute inset-x-0 -top-1 z-40 flex h-5 cursor-row-resize items-start justify-center touch-none"
        onDoubleClick={onReset}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          const el = event.currentTarget;
          el.setPointerCapture(event.pointerId);
          let last = event.clientY;
          const move = (ev: PointerEvent) => {
            onDelta(last - ev.clientY);
            last = ev.clientY;
          };
          const up = () => {
            try {
              el.releasePointerCapture(event.pointerId);
            } catch {
              // ignore
            }
            el.removeEventListener("pointermove", move);
            el.removeEventListener("pointerup", up);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
          };
          document.body.style.cursor = "row-resize";
          document.body.style.userSelect = "none";
          el.addEventListener("pointermove", move);
          el.addEventListener("pointerup", up);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp") {
            event.preventDefault();
            onDelta(24);
          }
          if (event.key === "ArrowDown") {
            event.preventDefault();
            onDelta(-24);
          }
        }}
      >
        <div className="mt-1 h-1.5 w-24 rounded-full border border-white/30 bg-white/35 hover:bg-[#7c5cff]" />
      </div>
      {collapsed ? (
        <button
          type="button"
          className="flex h-full w-full items-center justify-center text-[11px] text-zinc-500 hover:text-white"
          onClick={onReset}
        >
          Потяните вверх — поле ввода
        </button>
      ) : (
        <div className="h-full min-h-0 overflow-hidden pt-4">{children}</div>
      )}
    </div>
  );
}

function FileTreeView({
  nodes,
  activePath,
  openFolders,
  onToggleFolder,
  onOpenFile,
  depth = 0,
}: {
  nodes: TreeNode[];
  activePath: string;
  openFolders: Set<string>;
  onToggleFolder: (path: string) => void;
  onOpenFile: (path: string) => void;
  depth?: number;
}) {
  return (
    <ul className="select-none">
      {nodes.map((node) => {
        const open = openFolders.has(node.path);
        return (
          <li key={node.path}>
            <button
              type="button"
              style={{ paddingLeft: 8 + depth * 12 }}
              className={`flex h-7 w-full items-center gap-1.5 pr-2 text-left text-[13px] ${
                node.path === activePath
                  ? "bg-[#04395e] text-white"
                  : "text-[#cccccc] hover:bg-[#2a2d2e]"
              }`}
              onClick={() =>
                node.kind === "folder" ? onToggleFolder(node.path) : onOpenFile(node.path)
              }
            >
              {node.kind === "folder" ? (
                <>
                  <ChevronRight className={`size-3 opacity-60 transition ${open ? "rotate-90" : ""}`} />
                  {open ? <FolderOpen className="size-3.5 text-[#c09553]" /> : <Folder className="size-3.5 text-[#c09553]" />}
                </>
              ) : (
                <>
                  <span className="w-3" />
                  <FileCode2 className="size-3.5 opacity-70" />
                </>
              )}
              <span className="truncate">{node.name}</span>
            </button>
            {node.kind === "folder" && open && node.children && (
              <FileTreeView
                nodes={node.children}
                activePath={activePath}
                openFolders={openFolders}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
                depth={depth + 1}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ToolCard({ call }: { call: ToolCallEvent }) {
  const [open, setOpen] = useState(call.status !== "running");
  const label =
    call.name === "read_file"
      ? `Reading ${String(call.args.path ?? "")}`
      : call.name === "search_replace"
        ? `Editing ${String(call.args.path ?? "")}`
        : call.name === "write_file"
          ? `Writing ${String(call.args.path ?? "")}`
        : call.name === "run_terminal_cmd"
          ? `$ ${String(call.args.command ?? "")}`
          : call.name.startsWith("browser_")
            ? `${call.name} ${String(call.args.url ?? call.args.ref ?? call.args.text ?? "")}`
            : call.name === "send_to_peer"
              ? `Peer: ${String(call.args.prompt ?? "").slice(0, 80)}`
              : call.name;
  return (
    <div className="overflow-hidden rounded-xl border border-white/8 bg-white/3">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-zinc-300"
        onClick={() => setOpen((value) => !value)}
      >
        {call.status === "running" ? (
          <Loader2 className="size-3.5 animate-spin text-grok-purple" />
        ) : (
          <TerminalSquare className="size-3.5 text-grok-purple" />
        )}
        <span className="truncate font-mono">{label}</span>
        <span className="ml-auto text-[10px] tracking-wider text-zinc-500 uppercase">
          {call.status}
        </span>
      </button>
      {open && call.result && (
        <pre className="max-h-40 overflow-auto border-t border-white/8 px-3 py-2 font-mono text-[11px] leading-5 text-zinc-400">
          {call.result}
        </pre>
      )}
    </div>
  );
}

function BrainTrust({ steps, live }: { steps?: CrewStep[]; live: boolean }) {
  if (!steps?.length && !live) return null;
  return (
    <div className="mb-3 rounded-xl border border-[#3a3558] bg-[#14141c] p-3">
      <div className="mb-2 flex items-center gap-2 text-[11px] uppercase tracking-wide text-[#b48eff]">
        <WorkMark live={live} size="sm" />
        Мозговой трест
        <span className="font-normal normal-case text-[#8a8aa0]">{live ? "думают" : "готово"}</span>
      </div>
      {steps?.length ? (
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li key={`${step.role}-${index}-${step.status}`} className="rounded-lg bg-black/30 px-2.5 py-2">
              <div className="flex items-center gap-2 text-[12px] text-white">
                {step.status === "running" ? (
                  <Loader2 className="size-3 shrink-0 animate-spin text-[#b48eff]" />
                ) : (
                  <span className="size-1.5 shrink-0 rounded-full bg-[#6ee7b7]" />
                )}
                <span className="font-medium">{step.label || step.role}</span>
                <span className="text-[10px] uppercase text-[#8a8aa0]">
                  {step.status === "running" ? "думает" : step.status === "handoff" ? "передал" : "сказал"}
                </span>
              </div>
              {step.note ? (
                <p className="mt-1 text-[13px] leading-6 whitespace-pre-wrap text-[#d8d8ea]">{step.note}</p>
              ) : live && step.status === "running" ? (
                <p className="mt-1 text-[13px] leading-6 text-[#8a8aa0]">Рассуждение сейчас появится в этой карточке.</p>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-[13px] leading-6 text-[#d0d0e0]">Собираю группу. Сейчас появятся рассуждения.</p>
      )}
    </div>
  );
}

export function CoderApp() {
  const [theme, setThemeState] = useState<FedorTheme>("dark");
  const setTheme = (next: FedorTheme) => {
    setThemeState(applyTheme(next));
  };
  const [files, setFiles] = useState<FileMap>({});
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [workspaceRoot, setWorkspaceRoot] = useState("");
  const [workspaceDraft, setWorkspaceDraft] = useState("");
  const [hostname, setHostname] = useState("");
  const [platform, setPlatform] = useState("");
  const [activePath, setActivePath] = useState("src/median.ts");
  const [openFolders, setOpenFolders] = useState<Set<string>>(new Set(["src"]));
  const [chatSession] = useState(loadThreads);
  const [threads, setThreads] = useState<ChatThread[]>(chatSession.threads);
  const [activeChatId, setActiveChatId] = useState(chatSession.activeId);
  const [draft, setDraft] = useState("");
  const [runningJobs, setRunningJobs] = useState<{ threadId: string; requestId: string }[]>([]);
  const [computerOpen, setComputerOpen] = useState(() => loadWorkPinned(loadJson<boolean>(WORK_KEY, false)));
  const [sideW, setSideW] = useState(() => {
    const n = loadJson<number>(SIDE_W_KEY, SIDE_W_DEFAULT);
    return typeof n === "number" && n >= 0 ? clamp(n, SIDE_W_MIN, SIDE_W_MAX) : SIDE_W_DEFAULT;
  });
  const [workW, setWorkW] = useState(() => loadWorkWidth(loadJson<number>(WORK_W_KEY, WORK_W_DEFAULT)));
  const [chatW, setChatW] = useState(() => {
    const n = loadJson<number>(CHAT_W_KEY, CHAT_W_DEFAULT);
    return typeof n === "number" && n >= 0 ? clamp(n, CHAT_W_MIN, CHAT_W_MAX) : CHAT_W_DEFAULT;
  });
  const [chatH, setChatH] = useState(() => {
    const n = loadJson<number>(CHAT_H_KEY, CHAT_H_DEFAULT);
    return typeof n === "number" && n >= 0 ? clamp(n, CHAT_H_MIN, CHAT_H_MAX) : CHAT_H_DEFAULT;
  });
  const [editorOpen, setEditorOpen] = useState(() => {
    const chat = loadJson<boolean>(CHAT_OPEN_KEY, true) !== false;
    const editor = loadJson<boolean>(EDITOR_OPEN_KEY, false) === true;
    return ensureStudioPane({ chat, editor }).editor;
  });
  const [chatOpen, setChatOpen] = useState(() => {
    const chat = loadJson<boolean>(CHAT_OPEN_KEY, true) !== false;
    const editor = loadJson<boolean>(EDITOR_OPEN_KEY, false) === true;
    return ensureStudioPane({ chat, editor }).chat;
  });
  const [logs, setLogs] = useState<ComputerLog[]>([]);
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [splash, setSplash] = useState(true);
  const [memory, setMemory] = useState<MemorySnapshot | null>(null);
  const [coach, setCoach] = useState<CoachSnapshot | null>(null);
  const [crewEnabled, setCrewEnabled] = useState(() => loadJson<boolean>(CREW_KEY, true) !== false);
  const [appRole, setAppRole] = useState<"coder" | "helper">(() =>
    loadJson<string>(HELPER_KEY, "coder") === "helper" ? "helper" : "coder",
  );
  const [crewLog, setCrewLog] = useState<CrewLogItem[]>([]);
  const [accountToken, setAccountToken] = useState("");
  const [account, setAccount] = useState<HubUserView | null>(null);
  const [accountEmail, setAccountEmail] = useState("");
  const [freeSku, setFreeSku] = useState(IS_FREE_EDITION);
  const [updateInfo, setUpdateInfo] = useState<{ version?: string; notes?: string; url?: string } | null>(null);
  const [settings, setSettings] = useState<ConnectionSettings>(() => ({
    ...DEFAULT_SETTINGS,
    ...loadJson<Partial<ConnectionSettings>>(SETTINGS_KEY, {}),
  }));
  const [hasServerKey, setHasServerKey] = useState(false);
  const [storedKeys, setStoredKeys] = useState<Record<string, boolean>>({});
  const [mobileView, setMobileView] = useState<MobileView>("chat");
  const [sidebarMode, setSidebarMode] = useState<"files" | "chats">("chats");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [atBottom, setAtBottom] = useState(true);
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([]);
  const [github, setGithub] = useState<GithubStatus | null>(null);
  const [githubOpen, setGithubOpen] = useState(false);
  const [githubToken, setGithubToken] = useState("");
  const [githubNagGone, setGithubNagGone] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(GITHUB_NAG_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [cloud, setCloud] = useState<CloudStatus | null>(null);
  const [cloudOpen, setCloudOpen] = useState(false);
  const [cloudFolder, setCloudFolder] = useState("");
  const [cloudProvider, setCloudProvider] = useState<CloudProvider>("yadisk");
  const [mail, setMail] = useState<MailStatus | null>(null);
  const [mailOpen, setMailOpen] = useState(false);
  const [mailProvider, setMailProvider] = useState<MailProvider>("yandex");
  const [helperWatch, setHelperWatch] = useState<HelperWatchView | null>(null);
  const [cloudBannerGone, setCloudBannerGone] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return sessionStorage.getItem(CLOUD_BANNER_KEY) === "1";
    } catch {
      return false;
    }
  });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [openTabs, setOpenTabs] = useState<string[]>(["src/median.ts"]);
  const [peer, setPeer] = useState<PeerPublicStatus | null>(null);
  const [peerHost, setPeerHost] = useState("");
  const [peerPin, setPeerPin] = useState("");
  const abortMapRef = useRef(new Map<string, AbortController>());
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const composeHostRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const ignoreScrollRef = useRef(false);
  const dirtyRef = useRef(false);
  const saveTimerRef = useRef<number | null>(null);
  const workDragRef = useRef(false);

  const loadFile = useCallback(async (path: string) => {
    if (!path) return;
    dirtyRef.current = false;
    try {
      const response = await fetch(`/api/workspace/file?path=${encodeURIComponent(path)}`);
      const payload = (await response.json()) as { contents?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "Unable to read file");
      setFiles((current) => ({ ...current, [path]: payload.contents ?? "" }));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to read file");
    }
  }, []);

  const refreshWorkspace = useCallback(async (preferPath?: string) => {
    const response = await fetch("/api/workspace");
    const payload = (await response.json()) as {
      workspace?: string;
      hostname?: string;
      platform?: string;
      tree?: TreeNode[];
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error || "Unable to load workspace");
    const nextTree = payload.tree ?? [];
    setTree(nextTree);
    setWorkspaceRoot(payload.workspace ?? "");
    setWorkspaceDraft(payload.workspace ?? "");
    setHostname(payload.hostname ?? "");
    setPlatform(payload.platform ?? "");
    const nextPath =
      (preferPath && treeHasPath(nextTree, preferPath) ? preferPath : firstFile(nextTree)) ?? "";
    if (nextPath) {
      setActivePath(nextPath);
      setOpenTabs((tabs) => (tabs.includes(nextPath) ? tabs : nextPath ? [nextPath, ...tabs.filter(Boolean)] : tabs));
      const srcFolder = nextPath.includes("/") ? nextPath.split("/").slice(0, -1).join("/") : "";
      if (srcFolder) setOpenFolders((current) => new Set([...current, srcFolder]));
      await loadFile(nextPath);
    }
    return payload;
  }, [loadFile]);

  const loadMemory = useCallback(async () => {
    try {
      const response = await fetch("/api/memory");
      if (!response.ok) return;
      setMemory((await response.json()) as MemorySnapshot);
    } catch {
      // ignore
    }
  }, []);

  const memoryAction = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { snapshot?: MemorySnapshot; error?: string };
      if (!response.ok) throw new Error(payload.error || "Memory request failed");
      if (payload.snapshot) setMemory(payload.snapshot);
      else await loadMemory();
    },
    [loadMemory]
  );

  const loadCoach = useCallback(async () => {
    try {
      const response = await fetch("/api/coach");
      if (!response.ok) return;
      setCoach((await response.json()) as CoachSnapshot);
    } catch {
      // ignore
    }
  }, []);

  const coachAction = useCallback(
    async (body: Record<string, unknown>) => {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as { snapshot?: CoachSnapshot; error?: string };
      if (!response.ok) throw new Error(payload.error || "Coach request failed");
      if (payload.snapshot) setCoach(payload.snapshot);
      else await loadCoach();
    },
    [loadCoach]
  );

  const loadAccount = useCallback(async (token?: string) => {
    const useToken = token || accountToken || readAccountToken(ACCOUNT_KEY);
    if (!useToken) return;
    try {
      const response = await fetch("/api/hub?view=me", {
        headers: { "x-fedor-account": useToken },
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { user?: HubUserView };
      if (payload.user) {
        setAccount(payload.user);
        setAccountToken(useToken);
        setAccountEmail((current) => (current === payload.user!.email ? current : payload.user!.email));
      }
    } catch {
      // ignore
    }
  }, [accountToken]);

  const registerAccount = useCallback(async () => {
    const email = accountEmail.trim() || `pc-${hostname || "this"}@local.fedor`;
    const response = await fetch("/api/hub", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "register", email, name: hostname, deviceLabel: platform }),
    });
    const payload = (await response.json()) as { token?: string; user?: HubUserView; error?: string };
    if (!response.ok) throw new Error(payload.error || "Не удалось войти");
    if (payload.token) {
      localStorage.setItem(ACCOUNT_KEY, payload.token);
      setAccountToken(payload.token);
    }
    if (payload.user) {
      setAccount(payload.user);
      setAccountEmail((current) => (current === payload.user!.email ? current : payload.user!.email));
    }
    return payload.token || "";
  }, [accountEmail, hostname, platform]);

  useEffect(() => {
    setThemeState(applyTheme(loadTheme()));
  }, []);

  useEffect(() => {
    void refreshWorkspace("src/median.ts").catch((error: Error) => {
      toast.error(error.message);
    });
  }, [refreshWorkspace]);

  useEffect(() => {
    void loadMemory();
  }, [loadMemory]);

  useEffect(() => {
    void loadCoach();
  }, [loadCoach]);

  useEffect(() => {
    if (settingsOpen) {
      void loadMemory();
      void loadCoach();
    }
  }, [settingsOpen, loadMemory, loadCoach]);

  useEffect(() => {
    void fetch("/api/sku")
      .then((response) => response.json())
      .then((payload: { free?: boolean }) => {
        setFreeSku(Boolean(payload.free));
        return Boolean(payload.free);
      })
      .catch(() => IS_FREE_EDITION)
      .then((free) => {
        if (studioAccountBooted) return;
        studioAccountBooted = true;
        if (free) return;
        const saved = readAccountToken(ACCOUNT_KEY);
        if (saved) {
          setAccountToken(saved);
          void loadAccount(saved);
          return;
        }
        void registerAccount().catch(() => undefined);
      });
  }, [loadAccount, registerAccount]);

  useEffect(() => {
    const timer = window.setTimeout(() => setSplash(false), 1600);
    return () => window.clearTimeout(timer);
  }, []);

  const loadGithub = useCallback(async () => {
    try {
      const response = await fetch("/api/github");
      const payload = (await response.json()) as GithubStatus;
      setGithub(payload);
      if (!payload.connected && !sessionStorage.getItem(GITHUB_ASK_KEY)) {
        sessionStorage.setItem(GITHUB_ASK_KEY, "1");
        toast.message(payload.message, { id: "fedor-github" });
      }
    } catch {
      const fallback: GithubStatus = {
        connected: false,
        user: null,
        remote: null,
        ghInstalled: false,
        gitInstalled: false,
        hasToken: false,
        message: "GitHub не подключён. Нужен вход, иначе клон и пуш не сработают.",
      };
      setGithub(fallback);
      if (!sessionStorage.getItem(GITHUB_ASK_KEY)) {
        sessionStorage.setItem(GITHUB_ASK_KEY, "1");
        toast.message(fallback.message, { id: "fedor-github" });
      }
    }
  }, []);

  const loadCloud = useCallback(async () => {
    try {
      const response = await fetch("/api/cloud");
      const payload = (await response.json()) as CloudStatus;
      setCloud(payload);
      if (payload.candidates[0]) {
        setCloudProvider(payload.provider || payload.candidates[0].provider);
        setCloudFolder(payload.folder || payload.candidates[0].folder);
      }
    } catch {
      const fallback: CloudStatus = {
        connected: false,
        provider: null,
        folder: null,
        candidates: [],
        message: "Облачный диск не подключён. Нужен Яндекс Диск, Mail.ru, OneDrive, Google Диск или Dropbox.",
      };
      setCloud(fallback);
    }
  }, []);

  const loadMail = useCallback(async () => {
    try {
      const response = await fetch("/api/mail");
      const payload = (await response.json()) as MailStatus;
      setMail(payload);
      if (payload.provider) setMailProvider(payload.provider);
    } catch {
      setMail({
        connected: false,
        provider: null,
        label: null,
        url: null,
        clients: [],
        message: "Почта не подключена. Выберите Яндекс Почту, Mail.ru, Gmail или Outlook в Настройках.",
      });
    }
  }, []);

  const loadHelperWatch = useCallback(async () => {
    try {
      const planId = account?.quota.planId || "";
      const response = await fetch(`/api/helper${planId ? `?planId=${encodeURIComponent(planId)}` : ""}`);
      const payload = (await response.json()) as HelperWatchView;
      setHelperWatch(payload);
    } catch {
      setHelperWatch({ apps: [], agents: [], limit: null, remaining: null, message: "" });
    }
  }, [account?.quota.planId]);

  useEffect(() => {
    void loadGithub();
    void loadCloud();
    void loadMail();
    void loadHelperWatch();
  }, [loadGithub, loadCloud, loadMail, loadHelperWatch]);

  const cloudNagVisible = Boolean(cloud && !cloud.connected && !cloudBannerGone);
  useEffect(() => {
    if (!cloudNagVisible) return;
    const timer = window.setTimeout(() => {
      setCloudBannerGone(true);
      setCloudOpen(false);
      toast.dismiss("fedor-cloud");
      try {
        sessionStorage.setItem(CLOUD_BANNER_KEY, "1");
      } catch {
        // ignore
      }
    }, CLOUD_BANNER_MS);
    return () => window.clearTimeout(timer);
  }, [cloudNagVisible]);

  const hideCloudBanner = () => {
    setCloudBannerGone(true);
    setCloudOpen(false);
    toast.dismiss("fedor-cloud");
    try {
      sessionStorage.setItem(CLOUD_BANNER_KEY, "1");
    } catch {
      // ignore
    }
  };

  const saveGithub = async () => {
    const token = githubToken.trim();
    if (!token) {
      toast.error("Вставьте личный токен GitHub или сначала войдите через gh auth login");
      return;
    }
    const response = await fetch("/api/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    const payload = (await response.json()) as GithubStatus;
    setGithub(payload);
    setGithubToken("");
    setGithubOpen(false);
    toast.success(payload.connected ? "GitHub подключён" : "Токен сохранён. Проверьте права токена.");
  };

  const saveCloud = async () => {
    const folder = cloudFolder.trim();
    if (!folder) {
      toast.error("Укажите папку Яндекс Диска, Mail.ru, OneDrive, Google Диска или Dropbox");
      return;
    }
    const response = await fetch("/api/cloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: cloudProvider, folder }),
    });
    const payload = (await response.json()) as CloudStatus & { error?: string };
    if (!response.ok) throw new Error(payload.error || "не подключилось");
    setCloud(payload);
    setCloudOpen(false);
    toast.success(payload.connected ? payload.message : "Папка сохранена");
  };

  const saveMailConnect = async (openAfter = false) => {
    const response = await fetch("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: mailProvider, open: openAfter }),
    });
    const payload = (await response.json()) as MailStatus & { error?: string };
    if (!response.ok) throw new Error(payload.error || "почта не подключилась");
    setMail(payload);
    setMailOpen(false);
    toast.success(payload.connected ? payload.message : "Почта сохранена");
  };

  const openExtraLink = async (id: string) => {
    const response = await fetch("/api/mail", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: id }),
    });
    const payload = (await response.json()) as { error?: string; opened?: string };
    if (!response.ok) throw new Error(payload.error || "не открылось");
    toast.success(payload.opened ? `Открываю ${payload.opened}` : "Открываю в браузере");
  };

  const helperPlanId = account?.quota.planId || "";

  const helperAction = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/helper", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, planId: helperPlanId }),
    });
    const payload = (await response.json()) as HelperWatchView & { error?: string; path?: string };
    if (!response.ok) throw new Error(payload.error || "помощник");
    setHelperWatch(payload);
    return payload;
  };

  const pickHelperPath = async (kind: "app" | "agent" | "agent-folder"): Promise<string> => {
    const desktop = (window as unknown as { grokDesktop?: GrokDesktopApi }).grokDesktop;
    if (desktop?.pickOpen) {
      const picked = await desktop.pickOpen(kind);
      if (typeof picked === "string") return picked.trim();
      return String(picked?.path || "").trim();
    }
    const payload = await helperAction({
      action: kind === "app" ? "pick-app" : kind === "agent-folder" ? "pick-agent-folder" : "pick-agent",
    });
    return String(payload.path || "").trim();
  };

  const addHelperTarget = async (kind: "app" | "agent" | "agent-folder") => {
    const picked = await pickHelperPath(kind);
    if (!picked) return;
    await helperAction({ action: kind === "app" ? "add-app" : "add-agent", path: picked });
    toast.success(kind === "app" ? "Приложение добавлено" : "ИИ-агент добавлен");
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const next: PendingFile[] = [];
    for (const file of Array.from(list)) {
      if (file.size > 400_000) {
        toast.error(`${file.name}: больше 400 КБ, не прикрепил`);
        continue;
      }
      const text = await file.text();
      next.push({ name: file.name, text: text.slice(0, 120_000) });
    }
    if (!next.length) return;
    setPendingFiles((current) => [...current, ...next].slice(0, 8));
  };

  useEffect(() => {
    void fetch("/api/config")
      .then((response) => response.json())
      .then((config: {
        hasServerKey: boolean;
        storedKeys?: Record<string, boolean>;
        defaultModel?: string;
        defaultBaseUrl?: string;
        defaultProvider?: ProviderId;
        host?: { launchers?: string[]; desktop?: string };
        update?: { version?: string; notes?: string; url?: string };
        crew?: { recent?: CrewLogItem[] };
      }) => {
        setHasServerKey(config.hasServerKey);
        setStoredKeys(config.storedKeys ?? {});
        setUpdateInfo(config.update ?? null);
        if (config.crew?.recent) setCrewLog(config.crew.recent);
        setSettings((current) => ({
          ...current,
          provider: current.apiKey ? current.provider : (config.defaultProvider ?? current.provider),
          model: current.apiKey ? current.model : (config.defaultModel ?? current.model),
          baseUrl: current.apiKey ? current.baseUrl : (config.defaultBaseUrl ?? current.baseUrl),
        }));
        const launchers = config.host?.launchers ?? [];
        const onDesktop = launchers.find((item) => /AA Coder Fedor 2\.0\.(lnk|bat)$/i.test(item));
        if (onDesktop && !sessionStorage.getItem("fedor2-desktop-toast")) {
          sessionStorage.setItem("fedor2-desktop-toast", "1");
          toast.success("На рабочем столе ярлык 3.0: AA Coder Fedor 3.0. Ярлыки 1.02–2.0 не трогаем.");
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const response = await fetch("/api/peer");
        if (!response.ok) return;
        const payload = (await response.json()) as PeerPublicStatus;
        if (!stop) setPeer(payload);
      } catch {
        // peer API optional during boot
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(THREADS_KEY, JSON.stringify({ threads, activeId: activeChatId }));
  }, [threads, activeChatId]);

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem(CREW_KEY, JSON.stringify(crewEnabled));
  }, [crewEnabled]);

  useEffect(() => {
    localStorage.setItem(HELPER_KEY, JSON.stringify(appRole));
  }, [appRole]);

  useEffect(() => {
    localStorage.setItem(WORK_KEY, JSON.stringify(computerOpen));
  }, [computerOpen]);

  useEffect(() => {
    localStorage.setItem(SIDE_W_KEY, JSON.stringify(sideW));
  }, [sideW]);

  useEffect(() => {
    localStorage.setItem(WORK_W_KEY, JSON.stringify(workW));
  }, [workW]);

  useEffect(() => {
    if (computerOpen) setWorkW((width) => restoreWorkWidth(width));
  }, [computerOpen]);

  const applyWorkWidthDelta = useCallback((dx: number) => {
    setWorkW((width) => {
      const next = dragWorkWidth(width, dx);
      if (!next.open) {
        setComputerOpen(false);
      }
      return next.width;
    });
  }, []);

  const openWorkPanel = useCallback(() => {
    setComputerOpen(true);
    setWorkW((width) => restoreWorkWidth(width));
  }, []);

  const toggleWorkPanel = useCallback(() => {
    setComputerOpen((open) => {
      if (open) return false;
      setWorkW((width) => restoreWorkWidth(width));
      return true;
    });
  }, []);

  const pinWorkPanel = useCallback((next: boolean) => {
    if (next) openWorkPanel();
    else setComputerOpen(false);
  }, [openWorkPanel]);

  useEffect(() => {
    localStorage.setItem(CHAT_W_KEY, JSON.stringify(chatW));
  }, [chatW]);

  useEffect(() => {
    localStorage.setItem(CHAT_OPEN_KEY, JSON.stringify(chatOpen));
  }, [chatOpen]);

  useEffect(() => {
    localStorage.setItem(EDITOR_OPEN_KEY, JSON.stringify(editorOpen));
  }, [editorOpen]);

  useEffect(() => {
    localStorage.setItem(CHAT_H_KEY, JSON.stringify(chatH));
  }, [chatH]);

  useEffect(() => {
    if (!dirtyRef.current || !activePath) return;
    const contents = files[activePath];
    if (contents === undefined) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      dirtyRef.current = false;
      void fetch("/api/workspace/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: activePath, contents }),
      }).then(async (response) => {
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          toast.error(payload?.error || "Save failed");
        }
      });
    }, 450);
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [files, activePath]);

  const messages = threads.find((thread) => thread.id === activeChatId)?.messages ?? [];
  const turns = useMemo(() => groupTurns(messages), [messages]);
  const lastAssistant = [...messages].reverse().find((item) => item.role === "assistant");
  const lastUserTask = [...messages].reverse().find((item) => item.role === "user")?.content ?? "";
  const runningIds = useMemo(() => [...new Set(runningJobs.map((job) => job.threadId))], [runningJobs]);
  const liveAssistantIds = useMemo(
    () => new Set(runningJobs.filter((job) => job.threadId === activeChatId).map((job) => job.requestId)),
    [runningJobs, activeChatId]
  );
  const liveAssistant = pickLiveMessage(messages, liveAssistantIds);
  const latestLog = logs[logs.length - 1];
  const activeBusy = runningIds.includes(activeChatId);
  const runningCount = runningIds.length;
  const headerStatus = activeBusy
    ? liveBusyLabel(liveAssistant, latestLog)
    : runningCount > 0
      ? `Этот чат на месте · ещё ${runningCount} в работе`
      : appRole === "helper"
        ? "Помощник на связи"
        : "Готов к задаче";
  const workLine = liveWorkLine(liveAssistant, latestLog);
  const liveTools = mergeLiveTools(messages, liveAssistantIds);
  const liveCrew = mergeLiveCrew(messages, liveAssistantIds);

  const patchThread = useCallback(
    (threadId: string, updater: (current: ChatMessage[]) => ChatMessage[], title?: string) => {
      setThreads((current) => {
        const list = current.some((thread) => thread.id === threadId)
          ? current
          : [
              {
                id: threadId,
                title: "New chat",
                updatedAt: Date.now(),
                messages: [],
              },
              ...current,
            ];
        return list.map((thread) => {
          if (thread.id !== threadId) return thread;
          const nextMessages = updater(thread.messages);
          const firstUser = nextMessages.find((message) => message.role === "user")?.content;
          return {
            ...thread,
            messages: nextMessages,
            updatedAt: Date.now(),
            title:
              thread.title === "New chat" && firstUser
                ? titleFrom(title || firstUser)
                : thread.title,
          };
        });
      });
    },
    []
  );

  useEffect(() => {
    if (appRole !== "helper") {
      void fetch("/api/colleague", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, role: "coder" }),
      }).catch(() => undefined);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      if (runningIds.length > 0) return;
      try {
        const response = await fetch("/api/colleague", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: true, role: "helper" }),
        });
        const payload = (await response.json()) as { action?: string; text?: string };
        if (cancelled || payload.action !== "speak" || !payload.text) return;
        const assistantId = uid();
        patchThread(activeChatId, (current) => [
          ...current,
          { id: assistantId, role: "assistant", content: String(payload.text) },
        ]);
        toast.message("Помощник");
      } catch {
        // heartbeat must never block the UI
      }
    };
    void tick();
    const timer = window.setInterval(() => void tick(), 45_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appRole, runningIds.length, activeChatId, patchThread]);

  const onChatScroll = () => {
    const el = chatScrollRef.current;
    if (!el || ignoreScrollRef.current) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    let pinned = stickToBottomRef.current;
    if (pinned && gap > 140) pinned = false;
    if (!pinned && gap < 24) pinned = true;
    el.classList.toggle("is-pinned", pinned);
    if (pinned === stickToBottomRef.current && pinned === atBottom) return;
    stickToBottomRef.current = pinned;
    setAtBottom(pinned);
  };

  const pinToBottom = () => {
    const el = chatScrollRef.current;
    if (!el) return;
    ignoreScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    el.classList.add("is-pinned");
    stickToBottomRef.current = true;
    setAtBottom(true);
    window.requestAnimationFrame(() => {
      ignoreScrollRef.current = false;
    });
  };

  const jumpToBottom = () => pinToBottom();

  useEffect(() => {
    pinToBottom();
  }, [activeChatId]);

  const computerActive = runningCount > 0;

  const pushLog = useCallback((log: Omit<ComputerLog, "id" | "at">) => {
    setLogs((current) => [
      ...current.slice(-80),
      { ...log, id: uid(), at: Date.now() },
    ]);
  }, []);

  const startRun = (threadId: string, requestId: string, controller: AbortController) => {
    abortMapRef.current.set(requestId, controller);
    setRunningJobs((current) =>
      current.some((job) => job.requestId === requestId)
        ? current
        : [...current, { threadId, requestId }]
    );
  };

  const endRun = (requestId: string) => {
    abortMapRef.current.delete(requestId);
    setRunningJobs((current) => current.filter((job) => job.requestId !== requestId));
  };

  const abortServerRun = (id: string) => {
    const token = accountToken || readAccountToken(ACCOUNT_KEY);
    void fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "abort", threadId: id, accountToken: token }),
    }).catch(() => undefined);
  };

  const stopThread = (id: string, server = true) => {
    setRunningJobs((current) => {
      for (const job of current) {
        if (job.threadId !== id) continue;
        abortMapRef.current.get(job.requestId)?.abort();
        abortMapRef.current.delete(job.requestId);
      }
      return current.filter((job) => job.threadId !== id);
    });
    if (server) abortServerRun(id);
  };

  const stop = () => {
    stopThread(activeChatId, true);
    pushLog({ kind: "system", title: "Остановлено" });
    toast.message("Кодер остановлен");
  };

  const send = async (text: string, threadId = activeChatId, seedMessages?: ChatMessage[]) => {
    const attached = pendingFiles;
    const prompt = formatAttachments(attached, text.trim()).trim();
    if (!prompt) return;
    const targetId = threadId;
    if (looksLikeStopCommand(prompt) && attached.length === 0) {
      setPendingFiles([]);
      setDraft("");
      stickToBottomRef.current = true;
      setAtBottom(true);
      setMobileView("chat");
      stopThread(targetId, true);
      const userMessage: ChatMessage = { id: uid(), role: "user", content: prompt };
      const assistantId = uid();
      patchThread(targetId, (current) =>
        appendChatTurn(current, userMessage, {
          id: assistantId,
          role: "assistant",
          content: "Остановлено. Жду следующую задачу.",
        }),
      );
      pushLog({ kind: "system", title: "Остановлено" });
      toast.message("Кодер остановлен");
      return;
    }
    stopThread(targetId, false);
    setPendingFiles([]);
    let token = accountToken || readAccountToken(ACCOUNT_KEY);
    if (!freeSku && !token) {
      try {
        token = (await registerAccount()) || "";
      } catch {
        token = "";
      }
    }
    openWorkPanel();
    const prior = seedMessages ?? threads.find((thread) => thread.id === threadId)?.messages ?? [];
    stickToBottomRef.current = true;
    setAtBottom(true);
    setDraft("");
    setMobileView("chat");
    const userMessage: ChatMessage = { id: uid(), role: "user", content: prompt };
    const assistantId = uid();
    const history = [...prior, userMessage];
    patchThread(targetId, (current) =>
      appendChatTurn(current, userMessage, { id: assistantId, role: "assistant", content: "", toolCalls: [] })
    );
    const controller = new AbortController();
    startRun(targetId, assistantId, controller);
    pushLog({ kind: "system", title: "Задача принята" });

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          messages: history.map(({ role, content }) => ({ role, content })),
          accountToken: token || accountToken,
          settings: {
            ...settings,
            apiKey: settings.apiKey.trim(),
          },
          crew: crewEnabled,
          role: appRole,
          threadId: targetId,
        }),
      });

      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !contentType.includes("text/event-stream")) {
        const payload = (await response.json().catch(() => null)) as PayGatePayload | null;
        if (!freeSku && shouldOpenPay(payload, response.status)) {
          openPayPage(payload?.quota?.planId === "free" ? "trial" : "quota", payload?.payUrl);
        }
        throw new Error(payload?.error || `Request failed (${response.status})`);
      }
      if (!response.body) throw new Error("Empty stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const applyEvent = (event: string, data: unknown) => {
        const payload = data as Record<string, unknown>;
        if (event === "text") {
          const delta = String(payload.delta ?? "");
          patchThread(targetId,(current) =>
            current.map((message) =>
              message.id === assistantId
                ? { ...message, content: message.content + delta }
                : message
            )
          );
        }
        if (event === "tool") {
          const tool = payload as unknown as ToolCallEvent;
          patchThread(targetId,(current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              const existing = message.toolCalls ?? [];
              const index = existing.findIndex((item) => item.id === tool.id);
              const next =
                index === -1
                  ? [...existing, tool]
                  : existing.map((item, itemIndex) => (itemIndex === index ? { ...item, ...tool } : item));
              return { ...message, toolCalls: next };
            })
          );
          pushLog({
            kind: "tool",
            title: tool.name,
            detail:
              tool.name === "run_terminal_cmd"
                ? String(tool.args.command ?? "")
                : String(tool.args.path ?? tool.status),
          });
        }
        if (event === "files") {
          const changed = (payload.changed as string[] | undefined) ?? [];
          pushLog({ kind: "edit", title: "Files updated on this PC", detail: changed.join(", ") });
          void refreshWorkspace(activePath).then(() => {
            void Promise.all(changed.map((path) => loadFile(path)));
          });
        }
        if (event === "todos") {
          setTodos((payload.todos as TodoItem[]) ?? []);
        }
        if (event === "status") {
          const line = String((payload as { text?: string }).text || "").trim();
          if (line) pushLog({ kind: "system", title: line });
        }
        if (event === "provider") {
          const nextProvider = String(payload.provider ?? "yandex") as ProviderId;
          const reason = String(payload.reason ?? "Switched provider");
          setSettings((current) => {
            const preset = nextProvider === "custom" ? null : PROVIDERS[nextProvider];
            return {
              ...current,
              provider: nextProvider,
              baseUrl: preset?.baseUrl ?? current.baseUrl,
              model: preset?.models[0]?.id ?? current.model,
            };
          });
          pushLog({ kind: "system", title: reason });
          toast.message(reason);
        }
        if (event === "crew") {
          const step = payload as unknown as CrewStep;
          patchThread(targetId,(current) =>
            current.map((message) => {
              if (message.id !== assistantId) return message;
              const existing = message.crew ?? [];
              const index = existing.findIndex((item) => item.role === step.role && item.status === "running");
              const next =
                index === -1
                  ? [...existing, step]
                  : existing.map((item, itemIndex) => (itemIndex === index ? { ...item, ...step } : item));
              return { ...message, crew: next };
            })
          );
          if (step.status !== "running") {
            pushLog({ kind: "system", title: step.label, detail: step.note });
          }
        }
        if (event === "coach") {
          void loadCoach();
        }
        if (event === "account") {
          const nextToken = String(payload.token ?? "").trim();
          if (nextToken) {
            try {
              localStorage.setItem(ACCOUNT_KEY, nextToken);
            } catch {
              // ignore
            }
            setAccountToken(nextToken);
          }
        }
        if (event === "quota") {
          const quota = payload as unknown as QuotaView;
          setAccount((current) =>
            current ? { ...current, quota, planId: quota.planId } : current
          );
        }
        if (event === "error") {
          const message = String(payload.message ?? "Unknown error");
          patchThread(targetId,(current) =>
            current.map((item) =>
              item.id === assistantId
                ? {
                    ...item,
                    content: item.content || `Не получилось закончить этот шаг.\n\n${message}`,
                  }
                : item
            )
          );
          toast.error(message);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer = readSse(buffer + decoder.decode(value, { stream: true }), applyEvent);
      }
      if (buffer.trim()) readSse(`${buffer}\n\n`, applyEvent);
    } catch (error) {
      if ((error as Error).name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Request failed";
      patchThread(targetId,(current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, content: item.content || `Не удалось связаться с моделью.\n\n${message}` }
            : item
        )
      );
      toast.error(message);
    } finally {
      endRun(assistantId);
      void loadMemory();
    }
  };

  const applyCode = (path: string | undefined, code: string) => {
    const target = path && (files[path] !== undefined || path === activePath) ? path : activePath;
    dirtyRef.current = true;
    setFiles((current) => ({ ...current, [target]: code }));
    setActivePath(target);
    setOpenTabs((tabs) => (tabs.includes(target) ? tabs : [...tabs, target]));
    setEditorOpen(true);
    toast.success(`Applied to ${target} on this PC`);
  };

  const resetWorkspace = () => {
    void fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seed: true }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Seed failed");
        await refreshWorkspace("src/median.ts");
        setLogs([]);
        setTodos([]);
        toast.success("Demo Pulse project written to this PC");
      })
      .catch((error: Error) => toast.error(error.message));
  };

  const applyWorkspacePath = () => {
    const next = workspaceDraft.trim();
    if (!next) return;
    void fetch("/api/workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspace: next }),
    })
      .then(async (response) => {
        const payload = (await response.json()) as { error?: string; workspace?: string };
        if (!response.ok) throw new Error(payload.error || "Could not open folder");
        await refreshWorkspace();
        toast.success(`Workspace: ${payload.workspace}`);
      })
      .catch((error: Error) => toast.error(error.message));
  };

  const peerAction = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/peer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as PeerPublicStatus & { error?: string };
    if (!response.ok) throw new Error(payload.error || "Peer request failed");
    setPeer(payload);
    return payload;
  };

  const newChat = () => {
    const thread = emptyThread();
    setThreads((current) => [thread, ...current]);
    setActiveChatId(thread.id);
    stickToBottomRef.current = true;
    setMobileView("chat");
    setSidebarMode("chats");
    setChatOpen(true);
  };

  const deleteChat = (id: string) => {
    stopThread(id);
    setThreads((current) => {
      const next = current.filter((thread) => thread.id !== id);
      const fallback = next[0] ?? emptyThread();
      if (!next.length) {
        setActiveChatId(fallback.id);
        return [fallback];
      }
      if (id === activeChatId) setActiveChatId(fallback.id);
      return next;
    });
  };

  const openFile = (path: string) => {
    setActivePath(path);
    setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));
    setEditorOpen(true);
    setMobileView("editor");
    void loadFile(path);
  };

  const providerModels =
    settings.provider === "custom" ? [] : PROVIDERS[settings.provider].models;
  const activeThread = threads.find((thread) => thread.id === activeChatId);
  const sortedThreads = [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
  const pendingInbox = peer?.inbox.filter((item) => item.status === "pending") ?? [];

  const acceptIncoming = async (id: string, prompt: string) => {
    try {
      await peerAction({ action: "accept", id });
      toast.success("Задача принята — выполняется на этом ПК");
      const thread = emptyThread();
      setThreads((current) => [thread, ...current]);
      setActiveChatId(thread.id);
      await send(prompt, thread.id, []);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Accept failed");
    }
  };

  return (
    <div className="relative flex h-dvh min-h-0 flex-col bg-[#1e1e1e] pb-12 text-[#cccccc] md:pb-0">
      {splash && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#0b0b0b]">
          <div className="px-6 text-center">
            <div className="text-[22px] font-medium tracking-tight text-[#e8e8e8]">{APP_TITLE}</div>
            <div className="mt-2 text-[13px] text-[#9d9d9d]">Запуск на этом ПК…</div>
          </div>
        </div>
      )}
      {pendingInbox.length > 0 && (
        <div className="z-50 shrink-0 border-b border-[#5a3d1b] bg-[#3a2f1a] px-3 py-2 text-sm text-[#f0d9b5]">
          {pendingInbox.map((item) => (
            <div key={item.id} className="flex flex-wrap items-center gap-2 py-1">
              <Link2 className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Задача с {item.fromHost}: {item.prompt}
              </span>
              <Button size="xs" onClick={() => void acceptIncoming(item.id, item.prompt)}>
                Принять
              </Button>
              <Button
                size="xs"
                variant="ghost"
                onClick={() =>
                  void peerAction({ action: "reject", id: item.id }).catch((error: Error) =>
                    toast.error(error.message)
                  )
                }
              >
                Отклонить
              </Button>
            </div>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
      <aside className="hidden w-12 shrink-0 flex-col items-center border-r border-[#3c3c3c] bg-[#181818] py-3 md:flex">
        <GrokMark className="mb-6 size-6 text-[#e8e8e8]" />
        <RailButton
          label="Файлы"
          active={sidebarOpen && sidebarMode === "files"}
          onClick={() => {
            if (sidebarOpen && sidebarMode === "files") {
              setSidebarOpen(false);
              return;
            }
            setSidebarMode("files");
            setSidebarOpen(true);
            setEditorOpen(true);
            setMobileView("files");
          }}
        >
          <Files className="size-4" />
        </RailButton>
        <RailButton
          label="Чаты"
          active={sidebarOpen && sidebarMode === "chats"}
          onClick={() => {
            if (sidebarOpen && sidebarMode === "chats") {
              setSidebarOpen(false);
              return;
            }
            setSidebarMode("chats");
            setSidebarOpen(true);
            setChatOpen(true);
            setMobileView("chat");
          }}
        >
          <MessageSquare className="size-4" />
        </RailButton>
        <RailButton
          label="Ход"
          active={workDockShown(computerOpen)}
          glow={computerActive}
          onClick={toggleWorkPanel}
        >
          <Monitor className="size-4" />
        </RailButton>
        <RailButton
          label="Другой ПК"
          active={Boolean(peer?.listening || peer?.outbound)}
          onClick={() => setSettingsOpen(true)}
        >
          <Link2 className="size-4" />
        </RailButton>
        <div className="mt-auto flex flex-col gap-1">
          <RailButton label="New chat" onClick={newChat}>
            <Plus className="size-4" />
          </RailButton>
          <RailButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="size-4" />
          </RailButton>
        </div>
      </aside>

      <aside
        className={`${
          sidebarOpen ? "md:flex" : "md:hidden"
        } ${mobileView === "files" ? "flex" : "hidden"} w-full shrink-0 flex-col overflow-hidden border-r border-[#3c3c3c] bg-[#252526] max-md:!w-full`}
        style={{ width: `${sideW}px` }}
      >
        <div className="flex items-center gap-2 border-b border-[#3c3c3c] px-3 py-3">
          <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-[#7c5cff] to-[#3d2a88]">
            <GrokMark className="size-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm text-[#e8e8e8]">{APP_TITLE}</div>
            <div className="truncate text-[11px] text-[#9d9d9d]">
              {hostname ? `${hostname} · 3.0, 2.0 не трогает` : "3.0 · 2.0 не трогает"}
            </div>
          </div>
        </div>
        <div className="flex border-b border-[#3c3c3c] text-[12px]">
          <button
            type="button"
            className={`flex-1 py-2 ${sidebarMode === "files" ? "bg-[#37373d] text-white" : "text-[#9d9d9d] hover:text-white"}`}
            onClick={() => setSidebarMode("files")}
          >
            Explorer
          </button>
          <button
            type="button"
            className={`flex-1 py-2 ${sidebarMode === "chats" ? "bg-[#37373d] text-white" : "text-[#9d9d9d] hover:text-white"}`}
            onClick={() => setSidebarMode("chats")}
          >
            Chats
            {runningCount > 0 ? ` · ${runningCount}` : ""}
          </button>
        </div>
        {sidebarMode === "files" ? (
          <>
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-[11px] text-[#9d9d9d]">
              <span className="truncate uppercase tracking-wide" title={workspaceRoot}>
                {workspaceRoot.split(/[/\\]/).filter(Boolean).slice(-2).join("/") || "Workspace"}
              </span>
              <button type="button" className="shrink-0 text-[10px] hover:text-white" onClick={resetWorkspace}>
                Seed demo
              </button>
            </div>
            <ScrollArea className="min-h-0 flex-1">
              <FileTreeView
                nodes={tree}
                activePath={activePath}
                openFolders={openFolders}
                onToggleFolder={(path) =>
                  setOpenFolders((current) => {
                    const next = new Set(current);
                    if (next.has(path)) next.delete(path);
                    else next.add(path);
                    return next;
                  })
                }
                onOpenFile={openFile}
              />
            </ScrollArea>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-wide text-[#9d9d9d]">
              Conversations
              <button type="button" className="text-[10px] hover:text-white" onClick={newChat}>
                New
              </button>
            </div>
            {runningCount > 0 && (
              <p className="px-3 pb-1 text-[10px] leading-4 text-[#b48eff]">
                {runningCount} {runningCount === 1 ? "задача идёт" : "задачи идут"} сейчас. Новый чат не останавливает другие.
              </p>
            )}
            <ScrollArea className="min-h-0 flex-1">
              <ul className="px-1 pb-2">
                {sortedThreads.map((thread) => (
                  <li key={thread.id} className="group relative">
                    <button
                      type="button"
                      className={`flex w-full items-start gap-2 rounded-md py-2 pr-8 pl-2 text-left ${
                        thread.id === activeChatId ? "bg-[#04395e] text-white" : "text-[#cccccc] hover:bg-[#2a2d2e]"
                      }`}
                      onClick={() => {
                        setActiveChatId(thread.id);
                        setMobileView("chat");
                      }}
                    >
                      <MessageSquare className="mt-0.5 size-3.5 shrink-0 opacity-70" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13px]">{thread.title}</span>
                        <span className="block text-[10px] text-[#9d9d9d]">
                          {runningIds.includes(thread.id)
                            ? "ИИ-агенты работают…"
                            : `${thread.messages.length} msg`}
                        </span>
                      </span>
                      {runningIds.includes(thread.id) ? (
                        <Loader2 className="mt-0.5 size-3 shrink-0 animate-spin text-[#b48eff]" />
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="absolute top-2 right-1 rounded p-1 text-[#9d9d9d] hover:text-white"
                      aria-label="Delete chat"
                      onClick={() => deleteChat(thread.id)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </>
        )}
      </aside>

      {sidebarOpen ? (
        <SplitHandle
          label="Ширина левой панели"
          onDelta={(dx) => setSideW((w) => clamp(w + dx, SIDE_W_MIN, SIDE_W_MAX))}
          onReset={() => setSideW(SIDE_W_DEFAULT)}
        />
      ) : null}

      <section
        className={`${
          mobileView === "editor" ? "flex" : "hidden"
        } min-w-0 flex-col ${editorOpen ? "md:flex md:flex-1" : "md:hidden"}`}
      >
        <div className="flex h-9 items-center border-b border-[#3c3c3c] bg-[#252526]">
          <div className="flex min-w-0 flex-1 overflow-x-auto">
            {openTabs.map((tab) => (
              <div
                key={tab}
                className={`flex items-center border-r border-[#3c3c3c] ${
                  tab === activePath ? "bg-[#1e1e1e] text-white" : "text-[#9d9d9d]"
                }`}
              >
                <button
                  type="button"
                  className="truncate px-3 py-1.5 font-mono text-[12px]"
                  onClick={() => setActivePath(tab)}
                >
                  {tab.split("/").pop()}
                </button>
                <button
                  type="button"
                  className="pr-2 text-[#9d9d9d] hover:text-white"
                  aria-label={`Close ${tab}`}
                  onClick={() => {
                    const next = openTabs.filter((item) => item !== tab);
                    setOpenTabs(next);
                    if (tab === activePath) setActivePath(next[0] ?? "");
                    if (next.length === 0) {
                      const panes = closeStudioPane("editor", { chat: chatOpen, editor: true });
                      setEditorOpen(panes.editor);
                      setChatOpen(panes.chat);
                      if (panes.chat) setMobileView("chat");
                    }
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2 px-2">
            <Badge variant="outline" className={computerActive ? "text-[#b48eff]" : "text-[#9d9d9d]"}>
              {computerActive ? "computer live" : "idle"}
            </Badge>
            <button
              type="button"
              className="hidden rounded px-2 py-0.5 text-[11px] text-[#9d9d9d] hover:bg-[#37373d] hover:text-white sm:inline-flex"
              onClick={() => setSettingsOpen(true)}
            >
              {settings.model.split("/").pop()}
            </button>
            <button
              type="button"
              className="rounded p-1 text-[#9d9d9d] hover:text-white"
              aria-label="Закрыть редактор"
              onClick={() => {
                const panes = closeStudioPane("editor", { chat: chatOpen, editor: true });
                setEditorOpen(panes.editor);
                setChatOpen(panes.chat);
                if (!panes.editor) setMobileView(panes.chat ? "chat" : "files");
              }}
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 bg-[#1e1e1e]">
          {openTabs.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm text-[#e8e8e8]">Нет открытых файлов</p>
              <p className="text-[12px] leading-5 text-[#9d9d9d]">
                Выберите файл слева в Explorer или напишите задачу в чате — код появится здесь.
              </p>
            </div>
          ) : (
            <MonacoPane
              path={activePath}
              value={files[activePath] ?? ""}
              onChange={(value) => {
                dirtyRef.current = true;
                setFiles((current) => ({ ...current, [activePath]: value }));
              }}
            />
          )}
        </div>

        {computerOpen && (
          <div className="h-36 shrink-0 border-t border-[#3c3c3c] bg-[#181818]">
            <div className="flex items-center gap-2 border-b border-[#3c3c3c] px-3 py-1 text-[11px] text-[#9d9d9d]">
              <span className={`size-1.5 rounded-full ${computerActive ? "bg-[#b48eff]" : "bg-[#5a5a5a]"}`} />
              Terminal
              <span className="ml-auto truncate pl-2">
                {hostname || "this PC"}
              </span>
            </div>
            <ScrollArea className="h-[calc(9rem-1.6rem)]">
              <div className="space-y-1 p-3 font-mono text-[11px] leading-5 text-[#9d9d9d]">
                {logs.length === 0 && (
                  <p>Commands run on this PC — {hostname || "local host"}.</p>
                )}
                {logs.map((log) => (
                  <div key={log.id}>
                    <span className="text-[#3794ff]">{log.kind}</span> {log.title}
                    {log.detail ? <span className="text-[#6e6e6e]"> — {log.detail}</span> : null}
                  </div>
                ))}
                {todos.length > 0 && (
                  <div className="pt-2">
                    {todos.map((todo) => (
                      <div key={todo.id}>
                        [{todo.status === "completed" ? "x" : " "}] {todo.content}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>
        )}
      </section>

      <section
        className={`${
          mobileView === "chat" && chatOpen ? "flex" : "hidden"
        } min-w-0 w-full flex-1 flex-col bg-[#0b0b0b] md:w-auto ${chatOpen ? "md:flex" : "md:hidden"}`}
      >
        <header className="flex h-14 items-center gap-3 border-b border-white/10 px-4">
          <WorkMark live={activeBusy || runningCount > 0} size="md" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] text-white">{activeThread?.title || "Новый чат"}</div>
            <div
              className={`truncate text-[11px] ${
                activeBusy ? "text-[#d4c4ff]" : runningCount > 0 ? "text-[#b48eff]" : "text-[#6a6a72]"
              }`}
            >
              {activeBusy ? headerStatus : runningCount > 0 ? headerStatus : appRole === "helper" ? "Помощник на связи" : "Готов к задаче"}
            </div>
          </div>
          <div className="flex shrink-0 overflow-hidden rounded-md border border-white/15">
            <button
              type="button"
              className={`px-2 py-1 text-[11px] ${appRole === "coder" ? "bg-[#7c5cff] text-white" : "text-[#9d9d9d] hover:text-white"}`}
              onClick={() => setAppRole("coder")}
            >
              Кодер
            </button>
            <button
              type="button"
              className={`px-2 py-1 text-[11px] ${appRole === "helper" ? "bg-[#7c5cff] text-white" : "text-[#9d9d9d] hover:text-white"}`}
              onClick={() => setAppRole("helper")}
            >
              Помощник
            </button>
          </div>
          <Button
            size="xs"
            variant="ghost"
            className="shrink-0 text-[#9d9d9d]"
            onClick={toggleWorkPanel}
          >
            Ход
          </Button>
          <Button size="xs" variant="ghost" className="hidden text-[#9d9d9d] sm:inline-flex" onClick={() => setSettingsOpen(true)}>
            Settings
          </Button>
          <Button size="xs" variant="ghost" className="hidden text-[#9d9d9d] sm:inline-flex" onClick={newChat}>
            New
          </Button>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-[#9d9d9d] hover:text-white"
            aria-label="Закрыть чат"
            onClick={() => {
              const panes = closeStudioPane("chat", { chat: true, editor: editorOpen });
              setChatOpen(panes.chat);
              setEditorOpen(panes.editor);
              if (!panes.chat) setMobileView(panes.editor ? "editor" : "files");
            }}
          >
            <X className="size-4" />
          </button>
        </header>
        {activeBusy ? (
          <div className="live-work-bar flex shrink-0 items-center gap-2 border-b border-[#5b3d8a]/50 bg-[#1a1524] px-4 py-2">
            <span className="size-2 shrink-0 animate-pulse rounded-full bg-[#b48eff]" />
            <span className="truncate text-[13px] text-[#e8dcff]">{workLine}</span>
          </div>
        ) : null}

        <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-white/10 bg-[#101010] px-2">
          {sortedThreads.map((thread) => (
            <button
              key={thread.id}
              type="button"
              className={`flex max-w-[11rem] shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] ${
                thread.id === activeChatId ? "bg-[#2a2d3a] text-white" : "text-[#9d9d9d] hover:bg-[#1c1c1c] hover:text-white"
              }`}
              onClick={() => {
                setActiveChatId(thread.id);
                setMobileView("chat");
              }}
            >
              {runningIds.includes(thread.id) ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-[#b48eff]" />
              ) : (
                <MessageSquare className="size-3 shrink-0 opacity-70" />
              )}
              <span className="truncate">{thread.title}</span>
            </button>
          ))}
          <button
            type="button"
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-[#9d9d9d] hover:bg-[#1c1c1c] hover:text-white"
            aria-label="Новый чат"
            onClick={newChat}
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="relative min-h-0 min-w-0 flex-1">
        <div
          ref={chatScrollRef}
          onScroll={onChatScroll}
          className="chat-scroll absolute inset-0"
        >
          <div className="chat-scroll-inner mx-auto w-full px-4 py-8" style={{ maxWidth: chatW < 28 ? 672 : chatW }}>
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col justify-center">
                <p className="text-[22px] font-semibold tracking-tight text-white">{APP_TITLE}</p>
                <p className="mt-3 text-[15px] leading-7 text-zinc-400">
                  Пишите внизу — сюда можно вставлять текст (Ctrl+V). Это 3.0: кодер или помощник.
                  Старые сборки не меняет. Те же права, что у вас: диск, программы, живой Chrome/Edge.
                </p>
                <p className="mt-5 text-[11px] font-medium uppercase tracking-[0.2em] text-sky-300/80">
                  Чем 3.0 сильнее 2.0
                </p>
                <ul className="mt-3 space-y-3 text-[12px] leading-5 text-zinc-500">
                  {WHAT_NEW.map((item) => (
                    <li key={item.title}>
                      <div className="text-[13px] text-zinc-200">{item.title}</div>
                      <div>раньше — {item.vs}</div>
                      <div className="text-zinc-400">3.0 — {item.now}</div>
                    </li>
                  ))}
                </ul>
                <div className="mt-5 grid gap-2">
                  {[
                    ...(memory?.suggestions ?? [])
                      .map((item) => item.prompt)
                      .filter((item): item is string => Boolean(item)),
                    ...SUGGESTIONS,
                  ]
                    .filter((item, index, all) => all.indexOf(item) === index)
                    .slice(0, 5)
                    .map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      className="rounded-lg border border-[#3c3c3c] bg-[#252526] px-3 py-2.5 text-left text-sm text-[#cccccc] hover:bg-[#2a2d2e]"
                      onClick={() => void send(suggestion)}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {turns.map((turn) => {
                  const message = turn.assistant;
                  const live = Boolean(message && liveAssistantIds.has(message.id));
                  return (
                    <div key={turn.id} className="chat-turn space-y-2">
                      {turn.user ? (
                        <div className="chat-user-pin">
                          <div className="ml-8 select-text rounded-2xl bg-[#1a1a1a] px-4 py-3 text-[15px] leading-7 whitespace-pre-wrap text-white">
                            {turn.user.content}
                          </div>
                        </div>
                      ) : null}
                      {message ? (
                        <div className="select-text">
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-zinc-500">
                            <GrokMark className="size-3 text-white" />
                            Fёdor
                            {live ? (
                              <span className="truncate text-[10px] text-[#b48eff]">{workLine}</span>
                            ) : null}
                            {message.content ? (
                              <button
                                type="button"
                                className="ml-auto inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-white"
                                onClick={() =>
                                  void copyText(message.content).then((ok) =>
                                    ok ? toast.success("Скопировано") : toast.error("Не удалось скопировать")
                                  )
                                }
                              >
                                <Copy className="size-3" />
                                Копировать
                              </button>
                            ) : null}
                          </div>
                          <BrainTrust steps={message.crew} live={live} />
                          <div className="space-y-2">
                            {message.toolCalls?.map((call) => (
                              <ToolCard key={call.id} call={call} />
                            ))}
                          </div>
                          <ChatMarkdown
                            content={message.content}
                            onApply={applyCode}
                            live={live}
                            onCopied={() => toast.success("Скопировано")}
                            onCopyFail={() => toast.error("Не удалось скопировать")}
                          />
                        </div>
                      ) : null}
                      {turn === turns[turns.length - 1] ? <div className="chat-anchor" aria-hidden /> : null}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {!atBottom && messages.length > 0 ? (
          <button
            type="button"
            className="absolute right-16 bottom-16 z-20 flex size-9 items-center justify-center rounded-full border border-white/15 bg-[#1a1a22] text-white shadow-lg hover:bg-[#252532]"
            aria-label="Вниз чата"
            onClick={jumpToBottom}
          >
            <ChevronDown className="size-5" />
          </button>
        ) : null}
        </div>
        {computerOpen ? (
          <WorkDock
            className="flex h-44 shrink-0 border-t sm:hidden"
            live={activeBusy || runningCount > 0}
            task={lastUserTask}
            logs={logs}
            tools={liveTools.length ? liveTools : lastAssistant?.toolCalls ?? []}
            crew={liveCrew.length ? liveCrew : lastAssistant?.crew ?? []}
            todos={todos}
            pinned={computerOpen}
            onPinned={pinWorkPanel}
            onClose={() => {
              setComputerOpen(false);
            }}
          />
        ) : null}

        <ComposerShelf
          height={chatH}
          onDelta={(dy) =>
            setChatH((h) =>
              clamp(
                h + dy,
                CHAT_H_MIN,
                Math.min(CHAT_H_MAX, Math.round((typeof window === "undefined" ? 800 : window.innerHeight) * 0.72))
              )
            )
          }
          onReset={() => setChatH(CHAT_H_DEFAULT)}
        >
        <div ref={composeHostRef} className="flex h-full min-h-0 flex-col px-4 pb-3">
          <ComposerWidth
            width={chatW}
            onDelta={(dx) =>
              setChatW((w) =>
                clamp(w + dx, CHAT_W_MIN, composeHostRef.current?.clientWidth || CHAT_W_MAX)
              )
            }
            onReset={() => setChatW(CHAT_W_DEFAULT)}
          >
          {github && !github.connected && !githubNagGone ? (
            <div className="mx-auto mb-2 flex items-start justify-between gap-2 rounded-xl border border-[#5b3d8a]/60 bg-[#1a1524] px-3 py-2">
              <p className="text-[12px] leading-5 text-[#d8c8ff]">{github.message}</p>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="xs" onClick={() => setGithubOpen(true)}>
                  Подключить GitHub
                </Button>
                <button
                  type="button"
                  className="rounded p-1 text-[#9d9d9d] hover:text-white"
                  aria-label="Скрыть подсказку GitHub"
                  onClick={() => {
                    setGithubNagGone(true);
                    try {
                      sessionStorage.setItem(GITHUB_NAG_KEY, "1");
                    } catch {
                      // ignore
                    }
                  }}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          ) : null}
          {cloudNagVisible ? (
            <div className="mx-auto mb-2 flex items-start justify-between gap-2 rounded-xl border border-[#3d5b8a]/60 bg-[#151a24] px-3 py-2">
              <p className="text-[12px] leading-5 text-[#c8d8ff]">{cloud?.message}</p>
              <div className="flex shrink-0 items-center gap-1">
                <Button size="xs" onClick={() => setCloudOpen(true)}>
                  Подключить диск
                </Button>
                <button
                  type="button"
                  className="rounded p-1 text-[#9d9d9d] hover:text-white"
                  aria-label="Скрыть подсказку диска"
                  onClick={hideCloudBanner}
                >
                  <X className="size-3.5" />
                </button>
              </div>
            </div>
          ) : null}
          <p className="mx-auto mb-2 text-[12px] text-zinc-500">
            Сюда пишите задачу. Верхнюю полоску поля тяните вверх-вниз — высоту меняете сами, можно схлопнуть.
          </p>
          <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/15 bg-[#161616] p-3">
            {pendingFiles.length ? (
              <div className="mb-2 flex flex-wrap gap-1 px-1">
                {pendingFiles.map((file, index) => (
                  <span
                    key={`${file.name}-${index}`}
                    className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-[#d4d4de]"
                  >
                    {file.name}
                    <button
                      type="button"
                      className="text-[#8a8a96] hover:text-white"
                      aria-label={`Убрать ${file.name}`}
                      onClick={() =>
                        setPendingFiles((current) => current.filter((_, i) => i !== index))
                      }
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <Textarea
              id="chat-draft"
              name="chat-draft"
              value={draft}
              placeholder="Напишите или вставьте текст…"
              className="min-h-0 flex-1 [field-sizing:fixed] resize-none border-0 bg-transparent px-2 py-1 text-[15px] text-white shadow-none focus-visible:ring-0 dark:bg-transparent"
              onChange={(event) => setDraft(event.target.value)}
              onPaste={() => undefined}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void send(draft);
                }
              }}
            />
            <div className="mt-auto flex shrink-0 items-center gap-2 px-1">
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Прикрепить файлы"
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip className="size-3.5" />
              </Button>
              <span className={`min-w-0 truncate text-[11px] ${activeBusy ? "text-[#d4c4ff]" : "text-[#6a6a72]"}`}>
                {activeBusy ? headerStatus : "Готов"}
              </span>
              {peer?.outbound && (
                <button
                  type="button"
                  className="hidden truncate text-[11px] text-[#b48eff] hover:text-white sm:inline"
                  title={`Отправить черновик на ${peer.outbound.hostname}`}
                  onClick={() => {
                    const prompt = draft.trim();
                    if (!prompt) {
                      toast.error("Напишите задачу, потом отправьте на другой ПК");
                      return;
                    }
                    void peerAction({ action: "send", prompt, mode: "agent" })
                      .then(() => {
                        setDraft("");
                        toast.success(`Отправлено на ${peer.outbound?.hostname}. Там нажмут Принять.`);
                      })
                      .catch((error: Error) => toast.error(error.message));
                  }}
                >
                  На {peer.outbound.hostname}
                </button>
              )}
              <div className="ml-auto flex items-center gap-1">
                {activeBusy ? (
                  <Button size="icon-sm" variant="ghost" onClick={stop} aria-label="Остановить этот чат">
                    <Square className="size-3.5 fill-current" />
                  </Button>
                ) : null}
                <button
                  type="button"
                  className="send-launch"
                  onClick={() => void send(draft)}
                  disabled={!draft.trim() && pendingFiles.length === 0}
                  aria-label="Отправить"
                >
                  <SendMark />
                </button>
              </div>
            </div>
          </div>
          </ComposerWidth>
        </div>
        </ComposerShelf>
      </section>

        {computerOpen ? (
          <>
            <SplitHandle
              label="Ширина хода работы"
              onDelta={applyWorkWidthDelta}
              onReset={() => setWorkW(WORK_W_DEFAULT)}
              onDragStart={() => {
                workDragRef.current = true;
              }}
              onDragEnd={() => {
                workDragRef.current = false;
              }}
            />
            <WorkDock
              className="hidden min-h-0 shrink-0 self-stretch overflow-hidden border-l sm:flex sm:flex-col"
              style={{ width: `${workW}px`, minWidth: WORK_W_SHOW }}
              live={activeBusy || runningCount > 0}
              task={lastUserTask}
              logs={logs}
              tools={liveTools.length ? liveTools : lastAssistant?.toolCalls ?? []}
              crew={liveCrew.length ? liveCrew : lastAssistant?.crew ?? []}
              todos={todos}
              pinned={computerOpen}
              onPinned={pinWorkPanel}
              onClose={() => {
                setComputerOpen(false);
              }}
            />
          </>
        ) : null}

      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-[#3c3c3c] bg-[#181818] md:hidden">
        {[
          { id: "files" as const, icon: Files, label: "Files" },
          { id: "editor" as const, icon: FileCode2, label: "Editor" },
          { id: "chat" as const, icon: MessageSquare, label: "Chats" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            className={`flex h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${
              mobileView === item.id ? "text-white" : "text-[#9d9d9d]"
            }`}
            onClick={() => {
              if (item.id === "files") setSidebarMode("files");
              if (item.id === "chat") {
                setSidebarMode("chats");
                setChatOpen(true);
              }
              if (item.id === "editor") setEditorOpen(true);
              setMobileView(item.id);
            }}
          >
            <item.icon className="size-4" />
            {item.label}
          </button>
        ))}
        <button
          type="button"
          className={`flex h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] ${
            computerOpen ? "text-white" : "text-[#9d9d9d]"
          }`}
          aria-label="Ход"
          onClick={toggleWorkPanel}
        >
          <Monitor className="size-4" />
          Ход
        </button>
        <button
          type="button"
          className="flex h-12 flex-1 flex-col items-center justify-center gap-0.5 text-[10px] text-[#9d9d9d]"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings2 className="size-4" />
          Settings
        </button>
      </nav>


      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto bg-[#252526] sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Настройки · {APP_TITLE}</DialogTitle>
            <DialogDescription>
              Пишите задачи в чате. Текст можно копировать и вставлять. Доступ — как у вашего
              пользователя Windows: любые папки, куда вам можно зайти, программы и браузер.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                {theme === "light" ? (
                  <Sun className="size-4 text-[#b48eff]" />
                ) : (
                  <Moon className="size-4 text-[#b48eff]" />
                )}
                Тема
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                Светлая или тёмная оболочка. Выбор запоминается на этом ПК.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={theme === "dark" ? "default" : "outline"}
                  onClick={() => setTheme("dark")}
                >
                  Тёмная
                </Button>
                <Button
                  size="sm"
                  variant={theme === "light" ? "default" : "outline"}
                  onClick={() => setTheme("light")}
                >
                  Светлая
                </Button>
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <ShieldCheck className="size-4 text-[#b48eff]" />
                {freeSku ? "Бесплатный Fedor 3.0" : account?.quota.planName || "Пробный"}
              </div>
              {freeSku ? (
                <p className="text-[11px] leading-5 text-zinc-500">
                  Отдельная сборка. Счётчика ходов нет, лимита сообщений нет.
                </p>
              ) : (
                <>
                  <p className="text-[11px] leading-5 text-zinc-400">
                    {account?.quota
                      ? `Осталось ${account.quota.tokensLeft.toLocaleString("ru-RU")} из ${account.quota.tokensCap.toLocaleString("ru-RU")} токенов. Окно: ${account.quota.windowKind === "free2h" ? "2 часа" : "неделя"}.`
                      : "10 сообщений каждые 2 часа на пробном тарифе."}
                  </p>
                  <p className="text-[11px] leading-5 text-zinc-500">
                    Оплата российской картой, СБП и криптовалютой. Реквизиты — в «Приём оплаты».
                  </p>
                  <div className="flex gap-2">
                    <Input
                      placeholder="почта для тарифа"
                      value={accountEmail}
                      onChange={(event) => setAccountEmail(event.target.value)}
                    />
                    <Button size="sm" variant="outline" onClick={() => void registerAccount()}>
                      Войти
                    </Button>
                  </div>
                  <Button size="sm" onClick={() => openPayPage(account?.quota.blocked ? "quota" : "trial")}>
                    Тарифы и оплата
                  </Button>
                  <PaySettings />
                </>
              )}
              <p className="text-[11px] leading-5 text-zinc-500">
                {eulaTitle()}. При сбое пришлите файл{" "}
                <span className="font-mono text-zinc-400">%LOCALAPPDATA%\Fedor2\logs\fedor-error.log</span>
              </p>
              <ul className="space-y-2.5 text-[11px] leading-5 text-zinc-400">
                {WHAT_NEW.map((item) => (
                  <li key={item.title}>
                    <div className="text-[#e8e8e8]">{item.title}</div>
                    <div>раньше — {item.vs}</div>
                    <div>3.0 — {item.now}</div>
                  </li>
                ))}
              </ul>
              {updateInfo?.version && (
                <p className="text-[11px] text-zinc-400">
                  Сборка {updateInfo.version}. {updateInfo.notes}
                </p>
              )}
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <Link2 className="size-4 text-[#b48eff]" />
                Подключения
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                Сначала диск и почта. Это папки и сайты на этом ПК, не облачный логин через API.
                Письма и чаты кодер сам не читает.
              </p>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <HardDrive className="size-4 text-[#b48eff]" />
                Облачные диски
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                {cloud?.message || "Проверяю Яндекс Диск, Mail.ru, OneDrive, Google Диск и Dropbox на этом ПК."}
              </p>
              <div className="flex flex-wrap gap-1">
                {CLOUD_CONNECT_OPTIONS.map((item) => (
                  <Button
                    key={item.id}
                    size="xs"
                    variant={cloudProvider === item.id ? "default" : "outline"}
                    onClick={() => {
                      setCloudProvider(item.id);
                      setCloudOpen(true);
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setCloudOpen(true)}>
                {cloud?.connected ? "Сменить папку" : "Подключить диск"}
              </Button>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <Mail className="size-4 text-[#b48eff]" />
                Почта
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                {mail?.message || "Проверяю почту на этом ПК."}
              </p>
              <div className="flex flex-wrap gap-1">
                {MAIL_CONNECT_OPTIONS.map((item) => (
                  <Button
                    key={item.id}
                    size="xs"
                    variant={mailProvider === item.id ? "default" : "outline"}
                    onClick={() => {
                      setMailProvider(item.id);
                      setMailOpen(true);
                    }}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => setMailOpen(true)}>
                {mail?.connected ? "Сменить почту" : "Подключить почту"}
              </Button>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <FolderGit2 className="size-4 text-[#b48eff]" />
                GitHub
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                {github?.message || "Проверяю, подключён ли GitHub на этом ПК."}
              </p>
              <Button size="sm" variant="outline" onClick={() => setGithubOpen(true)}>
                {github?.connected ? "Обновить подключение" : "Подключить GitHub"}
              </Button>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="text-sm text-[#e8e8e8]">Ещё можно открыть</div>
              <p className="text-[11px] leading-5 text-zinc-500">
                Telegram и Slack — только сайт в браузере. Сообщения сам не читает. USB и обычную папку
                кодер уже видит, если напишете путь в задаче.
              </p>
              <div className="flex flex-wrap gap-1">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void openExtraLink("telegram").catch((error: Error) => toast.error(error.message))}
                >
                  Telegram
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void openExtraLink("slack").catch((error: Error) => toast.error(error.message))}
                >
                  Slack
                </Button>
              </div>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <Link2 className="size-4 text-[#b48eff]" />
                Связь с другим ПК
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                На том компьютере тоже запустите Coder. Там нажмите «Принимать задачи», продиктуйте
                IP и PIN сюда. Скрытого доступа нет: без PIN и кнопки Принять ничего не уйдёт.
              </p>
              {peer?.listening ? (
                <div className="space-y-1 text-[12px] text-[#cccccc]">
                  <div>
                    PIN: <span className="font-mono text-lg tracking-[0.3em] text-white">{peer.pin}</span>
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    Адреса:{" "}
                    {(peer.addresses.length ? peer.addresses : ["127.0.0.1"])
                      .map((ip) => `${ip}:${peer.port}`)
                      .join(" · ")}
                  </div>
                  {peer.inboundPeer ? (
                    <div className="text-[11px] text-[#8bd48b]">Входящая связь: {peer.inboundPeer}</div>
                  ) : (
                    <div className="text-[11px] text-zinc-500">Ждём ввод PIN на другом ПК</div>
                  )}
                  <Button size="sm" variant="outline" onClick={() => void peerAction({ action: "stop" })}>
                    Не принимать
                  </Button>
                </div>
              ) : (
                <Button
                  size="sm"
                  onClick={() =>
                    void peerAction({ action: "listen" })
                      .then(() => toast.success("Приём включён. Назовите PIN человеку за другим ПК."))
                      .catch((error: Error) => toast.error(error.message))
                  }
                >
                  Принимать задачи
                </Button>
              )}
              <div className="grid gap-2 pt-1">
                <span className="text-[11px] text-zinc-400">Подключиться к другому ПК</span>
                {peer?.outbound ? (
                  <div className="flex items-center justify-between gap-2 text-[12px]">
                    <span className="text-[#8bd48b]">
                      Связан с {peer.outbound.hostname} ({peer.outbound.host})
                    </span>
                    <Button size="xs" variant="ghost" onClick={() => void peerAction({ action: "disconnect" })}>
                      Отвязать
                    </Button>
                  </div>
                ) : (
                  <>
                    <Input
                      placeholder="192.168.0.12 или hostname"
                      value={peerHost}
                      onChange={(event) => setPeerHost(event.target.value)}
                    />
                    <div className="flex gap-2">
                      <Input
                        placeholder="PIN 6 цифр"
                        inputMode="numeric"
                        value={peerPin}
                        onChange={(event) => setPeerPin(event.target.value.replace(/\D/g, "").slice(0, 6))}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void peerAction({ action: "connect", host: peerHost, pin: peerPin })
                            .then(() => toast.success("ПК связаны. Можно отправлять задачи."))
                            .catch((error: Error) => toast.error(error.message))
                        }
                      >
                        Связать
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <label className="grid gap-1 text-xs text-zinc-400">
              Workspace on this PC
              <div className="flex gap-2">
                <Input
                  value={workspaceDraft}
                  placeholder="/home/you/project or C:\\Users\\you\\project"
                  onChange={(event) => setWorkspaceDraft(event.target.value)}
                />
                <Button size="sm" variant="outline" onClick={applyWorkspacePath}>
                  Open
                </Button>
              </div>
              <span className="text-[11px] text-zinc-500">
                Папка проекта по умолчанию. Абсолютные пути (Рабочий стол, другие диски) доступны и
                без смены этой папки. Host {hostname || "…"}
              </span>
            </label>
            <label className="grid gap-1 text-xs text-zinc-400">
              Provider
              <select
                className="h-8 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-sm text-[#cccccc]"
                value={settings.provider}
                onChange={(event) => {
                  const provider = event.target.value as ProviderId;
                  const preset = provider === "custom" ? null : PROVIDERS[provider];
                  setSettings((current) => ({
                    ...current,
                    provider,
                    baseUrl: preset?.baseUrl ?? "http://127.0.0.1:11434/v1",
                    model: preset?.models[0]?.id ?? "llama3.2",
                    apiKey: provider === "custom" ? current.apiKey || "local" : current.apiKey,
                  }));
                }}
              >
                <option value="deepseek">Авто</option>
                <option value="yandex">Запасной канал</option>
                <option value="nvidia">Канал 3</option>
                <option value="openrouter">Канал 4</option>
                <option value="xai">Канал 5</option>
                <option value="custom">Свой сервер</option>
              </select>
            </label>
            {providerModels.length > 0 && (
              <label className="grid gap-1 text-xs text-zinc-400">
                Model
                <select
                  className="h-8 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] px-2 text-sm text-[#cccccc]"
                  value={settings.model}
                  onChange={(event) =>
                    setSettings((current) => ({ ...current, model: event.target.value }))
                  }
                >
                  {providerModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="grid gap-1 text-xs text-zinc-400">
              Base URL
              <Input
                value={settings.baseUrl}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, baseUrl: event.target.value }))
                }
              />
            </label>
            <label className="grid gap-1 text-xs text-zinc-400">
              API key override {storedKeys[settings.provider] ? `(server ${settings.provider} key is ready)` : ""}
              <Input
                type="password"
                placeholder={
                  storedKeys[settings.provider]
                    ? "Ключ уже на этом ПК"
                    : hasServerKey
                      ? "Ключ уже на этом ПК"
                      : "ключ…"
                }
                value={settings.apiKey}
                onChange={(event) =>
                  setSettings((current) => ({ ...current, apiKey: event.target.value }))
                }
              />
            </label>
            <p className="text-[11px] leading-5 text-zinc-500">
              Ключи на этом ПК: основной {storedKeys.deepseek ? "есть" : "нет"} · запасной{" "}
              {storedKeys.yandex ? "есть" : "нет"}.
            </p>
            <div className="grid gap-3 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[13px] text-[#cccccc]">
              <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                <ShieldCheck className="size-4 text-[#b48eff]" />
                Режим с проверкой — сам
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                Тумблера нет. Вопрос — обычный чат. Правка одного файла — короткий путь (почти как
                сама модель) плюс одна проверка. Длинные циклы включаются сами, только
                если задача широкая или проверка покраснела. При первом включении пишет:
                «Дальше веду как задачу с проверкой.»
              </p>
              <p className="text-[11px] leading-5 text-zinc-500">
                Как снизить риск: в задаче называйте файл («поправь app.js»), держите тест который умеет
                покраснеть, после правки гляньте diff. Не кладите ключи в обычный .js — только в .env
                (инструменты его не читают). Не пишите в npm test разрушительные команды. Если кодер
                остановился с BLOCKED — одной фразой скажите, что чинить дальше. Bash/PowerShell на
                Windows он теперь либо переводит в cmd (dir/type), либо отказывается запускать.
              </p>
            </div>
            <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[13px] text-[#cccccc]">
              <div className="text-sm text-[#e8e8e8]">Build Harness — включён в кодер</div>
              <p className="text-[11px] leading-5 text-zinc-500">
                После правок кодер гоняет make check или npm test, не выдумывает check-max.bat. Если в проекте нет проверки — добавляет только недостающее: Makefile, npm test, CHANGELOG, .gitignore. По запросу — версия и упаковка релиза. Это про сам кодер и текущую папку проекта, не про чужие репозитории.
              </p>
            </div>
            <div className="grid gap-3 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[13px] text-[#cccccc]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                  <Handshake className="size-4 text-[#b48eff]" />
                  Настроить помощника
                </div>
                <div className="flex overflow-hidden rounded-md border border-white/15">
                  <button
                    type="button"
                    className={`px-2 py-1 text-[11px] ${appRole === "coder" ? "bg-[#7c5cff] text-white" : "text-[#9d9d9d]"}`}
                    onClick={() => setAppRole("coder")}
                  >
                    Кодер
                  </button>
                  <button
                    type="button"
                    className={`px-2 py-1 text-[11px] ${appRole === "helper" ? "bg-[#7c5cff] text-white" : "text-[#9d9d9d]"}`}
                    onClick={() => setAppRole("helper")}
                  >
                    Помощник
                  </button>
                </div>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                {appRole === "helper"
                  ? "Помощник работает как живой оператор за этим ПК: открывает ваши программы, смотрит окно, кликает, печатает и правит. Не ограничивается статусом «запущено / не запущено». «Стоп» останавливает работу."
                  : "Сейчас режим кодера — ждёт задачу. Включите помощника, если нужен коллега-оператор на этом ПК."}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setMailOpen(true)}>
                  {mail?.connected ? `Почта: ${mail.label}` : "Подключить почту"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setCloudOpen(true)}>
                  {cloud?.connected ? "Сменить облачный диск" : "Подключить облачный диск"}
                </Button>
              </div>
              <div className="grid gap-2 rounded-md border border-white/10 p-2">
                <div className="flex items-center gap-2 text-[12px] text-[#e8e8e8]">
                  <Monitor className="size-3.5 text-[#b48eff]" />
                  Приложения, которыми помощник управляет как оператор
                </div>
                <p className="text-[11px] leading-5 text-zinc-500">
                  {helperWatch?.message || "Добавьте программы через проводник."}
                </p>
                {(helperWatch?.apps ?? []).length === 0 ? (
                  <p className="text-[11px] text-zinc-500">Пока пусто. Нажмите «Добавить приложение».</p>
                ) : (
                  <ul className="space-y-1">
                    {(helperWatch?.apps ?? []).map((app) => (
                      <li key={app.id} className="flex items-start justify-between gap-2 text-[12px]">
                        <span className="min-w-0 flex-1 truncate" title={app.path}>
                          {app.name}
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-[11px] text-zinc-500 hover:text-white"
                          onClick={() =>
                            void helperAction({ action: "remove-app", id: app.id }).catch((error: Error) =>
                              toast.error(error.message),
                            )
                          }
                        >
                          убрать
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void addHelperTarget("app").catch((error: Error) => toast.error(error.message))}
                >
                  Добавить приложение
                </Button>
              </div>
              <div className="grid gap-2 rounded-md border border-white/10 p-2">
                <div className="flex items-center gap-2 text-[12px] text-[#e8e8e8]">
                  <Bot className="size-3.5 text-[#b48eff]" />
                  ИИ-агенты, за которыми следит помощник
                </div>
                <p className="text-[11px] leading-5 text-zinc-500">
                  Универсальный способ: файл-карточка или папка агента. Понимает OpenClaw (SOUL.md, IDENTITY.md, openclaw.json — так в Telegram добавляют бота через BotFather), A2A agent-card.json, MCP mcp.json.
                </p>
                {(helperWatch?.agents ?? []).length === 0 ? (
                  <p className="text-[11px] text-zinc-500">Пока пусто. Нажмите «Добавить ИИ-агента».</p>
                ) : (
                  <ul className="space-y-1">
                    {(helperWatch?.agents ?? []).map((agent) => (
                      <li key={agent.id} className="flex items-start justify-between gap-2 text-[12px]">
                        <span className="min-w-0 flex-1">
                          <span className="text-[#e8e8e8]">{agent.name}</span>
                          <span className="block truncate text-[10px] text-zinc-500" title={agent.path}>
                            {agent.detail}
                          </span>
                        </span>
                        <button
                          type="button"
                          className="shrink-0 text-[11px] text-zinc-500 hover:text-white"
                          onClick={() =>
                            void helperAction({ action: "remove-agent", id: agent.id }).catch((error: Error) =>
                              toast.error(error.message),
                            )
                          }
                        >
                          убрать
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void addHelperTarget("agent").catch((error: Error) => toast.error(error.message))}
                  >
                    Добавить ИИ-агента
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void addHelperTarget("agent-folder").catch((error: Error) => toast.error(error.message))
                    }
                  >
                    Папка агента
                  </Button>
                </div>
              </div>
            </div>
            <div className="grid gap-3 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[13px] text-[#cccccc]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                  <Users className="size-4 text-[#b48eff]" />
                  Мозговой трест
                </div>
                <Button size="sm" variant="outline" onClick={() => setCrewEnabled((value) => !value)}>
                  {crewEnabled ? "Выключить" : "Включить"}
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                В чате видно рассуждения координатора, архитектора, кодера и критика. Короткие
                «привет» идут одним ответом. Если трест выключен — один кодер, без штурма.
              </p>
              {(crewLog ?? []).length === 0 ? (
                <p className="text-[11px] text-zinc-500">Журнал решений появится после первой командной задачи.</p>
              ) : (
                <ul className="space-y-2">
                  {crewLog.slice(0, 5).map((item) => (
                    <li key={item.id} className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-2 text-[11px] leading-5">
                      <div className="text-[#cccccc]">{item.task}</div>
                      <div className="text-zinc-500">
                        {item.verdict ? `${item.verdict} · ` : ""}
                        {item.why}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="grid gap-3 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[13px] text-[#cccccc]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                  <Brain className="size-4 text-[#b48eff]" />
                  Супер Память
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void memoryAction({ action: "enable", enabled: memory?.enabled === false })
                      .catch((error: Error) => toast.error(error.message))
                  }
                >
                  {memory?.enabled === false ? "Включить" : "Выключить"}
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                {memory?.enabled === false
                  ? "Выключена. Чаты не пишутся в память."
                  : `Включена · ${memory?.events ?? 0} событий · сжатие ${Math.round((memory?.redundancy ?? 0) * 100)}%. Гигиена (дубли, противоречия, разовый мусор) идёт сама, без кнопок. Файлы проекта не трогает.`}
              </p>
              {typeof memory?.hygiene?.dropped === "number" && memory.hygiene.dropped > 0 && (
                <p className="text-[11px] text-zinc-500">
                  Последняя уборка убрала {memory.hygiene.dropped} записей.
                </p>
              )}
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-2">
                  <div className="text-lg text-white">{memory?.events ?? 0}</div>
                  события
                </div>
                <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-2">
                  <div className="text-lg text-white">{memory?.unique ?? 0}</div>
                  уникальные
                </div>
                <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-2">
                  <div className="text-lg text-white">{Math.round((memory?.redundancy ?? 0) * 100)}%</div>
                  сжатие
                </div>
              </div>
              {memory?.profile.git && (
                <p className="text-[11px] text-zinc-400">
                  Git: {memory.profile.git.branch || "?"} · грязных {memory.profile.git.dirty ?? 0}
                  {memory.profile.git.lastCommit ? ` · ${memory.profile.git.lastCommit}` : ""}
                </p>
              )}
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-[#9d9d9d]">Факты</div>
                {(memory?.facts ?? []).length === 0 && (
                  <p className="text-[11px] text-zinc-500">Скажите в чате «запомни: …» — попадёт сюда.</p>
                )}
                <ul className="space-y-1">
                  {(memory?.facts ?? []).slice(0, 12).map((fact) => (
                    <li key={fact.id} className="flex items-start justify-between gap-2 text-[12px]">
                      <span className="min-w-0 flex-1 text-[#cccccc]">{fact.text}</span>
                      <button
                        type="button"
                        className="shrink-0 text-[11px] text-zinc-500 hover:text-white"
                        onClick={() => void memoryAction({ action: "forget", id: fact.id })}
                      >
                        забыть
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-[#9d9d9d]">Навыки</div>
                {(memory?.skills ?? []).length === 0 && (
                  <p className="text-[11px] text-zinc-500">Повторяющиеся команды станут навыками после 3 раз.</p>
                )}
                <ul className="space-y-1 text-[12px]">
                  {(memory?.skills ?? []).slice(0, 10).map((skill) => (
                    <li key={skill.id} className="text-[#cccccc]">
                      ×{skill.count} {skill.title}
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[10px] leading-4 text-zinc-600">Папка: {memory?.dir || "…"}.</p>
            </div>
            <div className="grid gap-3 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[13px] text-[#cccccc]">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm text-[#e8e8e8]">
                  <Target className="size-4 text-[#b48eff]" />
                  Тренер шагов
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void coachAction({ action: "teaching", teaching: coach?.teaching === false })
                      .catch((error: Error) => toast.error(error.message))
                  }
                >
                  {coach?.teaching === false ? "Включить обучение" : "Только журнал"}
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                Учит делать ту же задачу за меньшее число действий. Чат из‑за этого не обрывает.
                Старые маршруты чистятся сами.
              </p>
              <div className="grid grid-cols-2 gap-2 text-center text-[11px]">
                <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-2">
                  <div className="text-lg text-white">{coach?.episodes ?? 0}</div>
                  задачи
                </div>
                <div className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-2">
                  <div className="text-lg text-white">{coach?.averageSteps ?? 0}</div>
                  шагов в среднем
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] uppercase tracking-wide text-[#9d9d9d]">Короткие пути</div>
                {(coach?.recipes ?? []).length === 0 && (
                  <p className="text-[11px] text-zinc-500">Пока пусто — решите несколько задач в чате.</p>
                )}
                <ul className="space-y-2">
                  {(coach?.recipes ?? []).slice(0, 8).map((item) => (
                    <li key={item.id} className="rounded-lg border border-[#3c3c3c] bg-[#252526] p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[13px] text-white">{item.title}</div>
                          <div className="text-[11px] leading-5 text-zinc-500">
                            лучший: {item.bestCount} шаг(ов) · {item.path.slice(0, 6).join(" → ")}
                          </div>
                        </div>
                        <button
                          type="button"
                          className="shrink-0 text-[11px] text-zinc-500 hover:text-white"
                          onClick={() => void coachAction({ action: "forget", id: item.id })}
                        >
                          забыть
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="text-[10px] leading-4 text-zinc-600">Папка: {coach?.dir || "…"}.</p>
            </div>
            {settings.provider === "custom" && (
              <div className="grid gap-2 rounded-lg border border-[#3c3c3c] bg-[#1e1e1e] p-3 text-[12px] leading-5 text-zinc-400">
                <label className="grid gap-1 text-xs text-zinc-400">
                  Model id
                  <Input
                    value={settings.model}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, model: event.target.value }))
                    }
                    placeholder="llama3.2"
                  />
                </label>
                <p>
                  Локальная модель на этом или соседнем ПК: поставьте Ollama, скачайте модель, затем Base URL{" "}
                  <span className="font-mono text-[#cccccc]">http://127.0.0.1:11434/v1</span> (этот ПК) или{" "}
                  <span className="font-mono text-[#cccccc]">http://IP-соседа:11434/v1</span>. Ключ можно{" "}
                  <span className="font-mono">local</span>. Облако для этого не нужно.
                </p>
              </div>
            )}
            <p className="pt-2 text-center text-[10px] tracking-wide text-zinc-600">
              © 2026 · Made with by AA it
            </p>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={githubOpen} onOpenChange={setGithubOpen}>
        <DialogContent className="max-w-md bg-[#252526]" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle>Подключить GitHub</DialogTitle>
              <button
                type="button"
                className="rounded p-1 text-[#9d9d9d] hover:text-white"
                aria-label="Закрыть подключение GitHub"
                onClick={() => setGithubOpen(false)}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <DialogDescription>
              Без входа кодер не клонирует приватные репозитории. Вставьте личный токен (scope repo)
              или сначала выполните <span className="font-mono">gh auth login</span> в обычном cmd.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[12px] leading-5 text-zinc-400">
            {github?.ghInstalled ? "GitHub CLI найден на этом ПК." : "GitHub CLI (gh) не найден — достаточно токена."}{" "}
            {github?.gitInstalled ? "git есть." : "git не найден."}
            {github?.remote ? ` Удалённый: ${github.remote}` : ""}
          </p>
          <Input
            id="github-token"
            name="github-token"
            type="password"
            placeholder="ghp_… личный токен"
            value={githubToken}
            onChange={(event) => setGithubToken(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setGithubOpen(false)}>
              Позже
            </Button>
            <Button onClick={() => void saveGithub().catch((error: Error) => toast.error(error.message))}>
              Сохранить токен
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={cloudOpen} onOpenChange={setCloudOpen}>
        <DialogContent className="max-w-md bg-[#252526]" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle>Подключить облачный диск</DialogTitle>
              <button
                type="button"
                className="rounded p-1 text-[#9d9d9d] hover:text-white"
                aria-label="Закрыть подключение диска"
                onClick={() => setCloudOpen(false)}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <DialogDescription>
              Сначала Яндекс Диск. Ещё Mail.ru, OneDrive, Google Диск или Dropbox. Укажите папку, куда
              приложение диска синхронизирует файлы на этом ПК. Без этой папки проект в облако не уедет.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[12px] leading-5 text-zinc-400">{cloud?.message}</p>
          <div className="flex flex-wrap gap-1">
            {CLOUD_CONNECT_OPTIONS.map((item) => (
              <Button
                key={item.id}
                size="xs"
                variant={cloudProvider === item.id ? "default" : "outline"}
                onClick={() => setCloudProvider(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          {cloud?.candidates.length ? (
            <div className="grid gap-1">
              {cloud.candidates.map((item) => (
                <button
                  key={`${item.provider}-${item.folder}`}
                  type="button"
                  className="rounded-md border border-[#3c3c3c] bg-[#1e1e1e] px-2 py-1 text-left text-[12px] text-[#cccccc] hover:border-[#b48eff]"
                  onClick={() => {
                    setCloudProvider(item.provider);
                    setCloudFolder(item.folder);
                  }}
                >
                  {item.label}: {item.folder}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-zinc-500">
              Папки не найдены автоматически. Поставьте приложение Яндекс Диска и вставьте путь, например
              D:\Яндекс.Диск или C:\Users\Вы\YandexDisk.
            </p>
          )}
          <Input
            id="cloud-folder"
            name="cloud-folder"
            placeholder="путь к папке диска"
            value={cloudFolder}
            onChange={(event) => setCloudFolder(event.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setCloudOpen(false)}>
              Позже
            </Button>
            <Button onClick={() => void saveCloud().catch((error: Error) => toast.error(error.message))}>
              Подключить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mailOpen} onOpenChange={setMailOpen}>
        <DialogContent className="max-w-md bg-[#252526]" showCloseButton={false}>
          <DialogHeader>
            <div className="flex items-start justify-between gap-2">
              <DialogTitle>Подключить почту</DialogTitle>
              <button
                type="button"
                className="rounded p-1 text-[#9d9d9d] hover:text-white"
                aria-label="Закрыть подключение почты"
                onClick={() => setMailOpen(false)}
              >
                <X className="size-3.5" />
              </button>
            </div>
            <DialogDescription>
              Яндекс Почта, Mail.ru, Gmail или Outlook. Кодер откроет сайт в браузере. Письма сам не читает —
              это не вход в ящик, а выбранная почта для этого ПК.
            </DialogDescription>
          </DialogHeader>
          <p className="text-[12px] leading-5 text-zinc-400">{mail?.message}</p>
          <div className="flex flex-wrap gap-1">
            {MAIL_CONNECT_OPTIONS.map((item) => (
              <Button
                key={item.id}
                size="xs"
                variant={mailProvider === item.id ? "default" : "outline"}
                onClick={() => setMailProvider(item.id)}
              >
                {item.label}
              </Button>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setMailOpen(false)}>
              Позже
            </Button>
            <Button
              variant="outline"
              onClick={() => void saveMailConnect(true).catch((error: Error) => toast.error(error.message))}
            >
              Подключить и открыть
            </Button>
            <Button onClick={() => void saveMailConnect(false).catch((error: Error) => toast.error(error.message))}>
              Подключить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <AaCorner />
      </div>
    </div>
  );
}

function RailButton({
  children,
  label,
  onClick,
  active,
  glow,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
  glow?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            aria-label={label}
            className={`mb-1 flex size-9 items-center justify-center rounded-md ${
              active ? "bg-[#37373d] text-white" : "text-[#9d9d9d] hover:bg-[#2a2d2e] hover:text-white"
            } ${glow ? "text-[#b48eff]" : ""}`}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );
}
