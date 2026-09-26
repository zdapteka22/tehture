import {
  browserBack,
  browserClick,
  browserClose,
  browserEngine,
  browserForward,
  browserNavigate,
  browserPress,
  browserScroll,
  browserScreenshot,
  browserSnapshot,
  browserTabs,
  browserType,
  browserWait,
  pcFocus,
  pcWindows,
} from "./browser";
import {
  operatorUse,
  pcClick,
  pcKeys,
  pcSnapshot,
  pcType,
} from "./pc-operator";
import {
  grepWorkspace,
  launchOnPc,
  listWorkspaceDir,
  openOnPc,
  readWorkspaceFile,
  resolveUserFile,
  runHostCommand,
  searchReplaceFile,
  writePcFile,
  writeWorkspaceFile,
  getWorkspaceRoot,
  type UserPlace,
} from "./host-fs";
import { runHarnessAction } from "./build-harness";
import { isolationFromTool } from "./agent-isolation";
import { sendPeerTask } from "./peer";
import {
  compactSuperMemory,
  forgetMemory,
  recallMemory,
  saveMemoryFact,
} from "./super-memory";
import type { AgentMode, TodoItem } from "./types";
import { downloadFile, inspectApk, inspectZip, webSearch } from "./web-files";
import { fetchPublicPage } from "./web-public";
import { clickKitStatusText, healClickKits, shouldHealClickKit } from "./click-kit";
import { JobAbortedError, isAbortError } from "./run-control";
import { isKnownTool, unknownToolMessage } from "./tool-guard";
import { recallSkillLines, recordSkillFromTool } from "./skill-ledger";

export const GROK_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description:
        "Read a file on this PC. Relative path = project folder. Absolute path (C:\\..., /..., ~\\...) = anywhere the Windows user can read. Long tables and huge files go into Super Memory: you get a short preview, then grep or memory_recall(\"файл <name>\"). Do not dump the whole file into chat.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          offset: { type: "number" },
          limit: { type: "number" },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_dir",
      description: "List files and folders on this PC. Relative = project folder. Absolute = any folder the user can open.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path, default workspace root" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "grep",
      description: "Search file contents on this PC with a regular expression. path may be a project-relative or absolute folder/file.",
      parameters: {
        type: "object",
        properties: {
          pattern: { type: "string" },
          path: { type: "string", description: "File or directory to search" },
          glob: { type: "string" },
        },
        required: ["pattern"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "search_replace",
      description:
        "Replace an exact string in a real file on this PC. path may be project-relative or absolute.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
          replace_all: { type: "boolean" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description:
        "Create or overwrite a file on this PC. Relative path = project folder. Absolute path = anywhere the signed-in user can write (Desktop, Documents, other disks, etc.).",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          contents: { type: "string" },
        },
        required: ["path", "contents"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_terminal_cmd",
      description:
        "Run a real command as the signed-in user on this PC. Windows = cmd.exe (not PowerShell). Full paths and any folder the user can access are allowed. working_directory may be any existing folder. cd in one command is remembered for the next command. This is not a sandbox.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          working_directory: { type: "string" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "todo_write",
      description: "Update the in-session todo list shown to the user.",
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                content: { type: "string" },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                },
              },
              required: ["id", "content", "status"],
            },
          },
        },
        required: ["todos"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_pc_file",
      description:
        "Shortcut for Desktop / Documents / Downloads / home. For any other folder use write_file with an absolute path (C:\\..., %USERPROFILE%\\...).",
      parameters: {
        type: "object",
        properties: {
          place: {
            type: "string",
            enum: ["desktop", "documents", "downloads", "workspace", "home"],
          },
          name: { type: "string", description: "File name, for example zametka.txt" },
          contents: { type: "string" },
        },
        required: ["name", "contents"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "open_on_pc",
      description:
        "Open a file or folder with the usual program on this PC, as the signed-in user. path can be any location the user can open.",
      parameters: {
        type: "object",
        properties: {
          place: {
            type: "string",
            enum: ["desktop", "documents", "downloads", "workspace", "home"],
          },
          name: { type: "string" },
          path: { type: "string", description: "Absolute or project-relative path" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "launch_app",
      description:
        "Start a program the way the user would: notepad, calc, explorer, chrome, an .exe path, or a document. Windows uses start.",
      parameters: {
        type: "object",
        properties: {
          target: { type: "string", description: "Program name, exe, URL, or file path" },
        },
        required: ["target"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_navigate",
      description:
        "Open a URL in a REAL visible browser on this PC (Chrome or Edge). Never used to solve captchas.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_snapshot",
      description:
        "Read the current real-browser page: URL, title, accessible elements with refs like [e1], visible text. If HUMAN CHECK appears, stop and ask the user.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_click",
      description:
        "Click a button or control in the real browser. Prefer a snapshot ref (e1, e2) or visible text. If the click misses, the coder switches click kits itself (JS, CDP mouse, Playwright). Do not ask the user to click.",
      parameters: {
        type: "object",
        properties: { ref: { type: "string" }, text: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_type",
      description: "Type into a field in the real browser. Prefer a snapshot ref. Never type captcha solutions.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string" },
          text: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_press",
      description: "Press a keyboard key in the real browser, for example Enter, Tab, Escape.",
      parameters: {
        type: "object",
        properties: { key: { type: "string" } },
        required: ["key"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_wait",
      description: "Wait up to 20 seconds, then snapshot the real browser again.",
      parameters: {
        type: "object",
        properties: { milliseconds: { type: "number" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_scroll",
      description: "Scroll the real browser page. direction: down, up, top, or bottom.",
      parameters: {
        type: "object",
        properties: {
          direction: { type: "string", enum: ["down", "up", "top", "bottom"] },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_back",
      description: "Go back in the real browser, like the Back button.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_forward",
      description: "Go forward in the real browser, like the Forward button.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_close",
      description: "Disconnect from the real browser. Does not kill the user's Edge/Chrome debug window.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_tabs",
      description:
        "List windows/tabs of the real Edge/Chrome (debug port). Pass query to focus a tab by title or URL, for example MAX.",
      parameters: {
        type: "object",
        properties: { query: { type: "string", description: "Tab title, URL fragment, or MAX" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_engine",
      description: "Diagnose browsers and switch engine: edge or chrome. Uses a dedicated debug profile so the port actually binds.",
      parameters: {
        type: "object",
        properties: { engine: { type: "string", enum: ["edge", "chrome", "chromium"] } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "click_kit",
      description:
        "When browser_click itself errors (not found, timeout, intercepts pointer): inspect click kits. Prefer cdp-js. Do not download Chrome for Testing. Do not call this if the click landed and the URL stayed the same or a submenu appeared — that is an accordion: press Enter or click the new item by text, never the same ref.",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["status", "heal"] },
          reason: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "browser_screenshot",
      description: "Screenshot the current tab or the whole PC screen. Saves PNG on the Desktop by default (max-tab.png / pc-screen.png).",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["tab", "screen"] },
          path: { type: "string" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pc_windows",
      description: "List visible window titles on this PC (tasklist). Then pc_focus or browser_tabs to bring one forward.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pc_focus",
      description: "Bring a PC window to the foreground by title, for example MAX, Edge, Notepad.",
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "operator_use",
      description:
        "Operate a program like a person: launch the user-added app (or any exe/window name), bring it forward, read its UI tree. Then pc_click / pc_type / pc_keys / pc_screenshot. Do not only report that it is running.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "App name from helper settings, exe path, or window title" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pc_snapshot",
      description:
        "Read the live desktop window like a person looking at it: buttons, fields, labels with refs [e1]. Pass title to pick a window, or omit for the foreground window.",
      parameters: {
        type: "object",
        properties: { title: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pc_click",
      description: "Click in the live desktop window like a person. Prefer a ref from the last pc_snapshot (e1), or visible name, or x,y screen pixels. double=true for a double-click.",
      parameters: {
        type: "object",
        properties: {
          ref: { type: "string" },
          name: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          double: { type: "boolean" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pc_type",
      description: "Type into the focused desktop control, as a person at the keyboard. Optional ref clicks the field first. Never type captcha solutions.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string" },
          ref: { type: "string" },
          submit: { type: "boolean" },
        },
        required: ["text"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pc_keys",
      description: "Press keys in the live desktop window: Enter, Tab, Escape, Ctrl+S, Ctrl+V.",
      parameters: {
        type: "object",
        properties: { keys: { type: "string" } },
        required: ["keys"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "pc_screenshot",
      description: "Screenshot the whole PC screen (not only a browser tab). Use when the UI tree is empty or you need to see pixels.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "send_to_peer",
      description:
        "Send a task to a paired second PC. That machine uses its own files, shell, and browser after a human there accepts. Requires Settings pairing (IP + PIN).",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          mode: { type: "string", enum: ["agent", "ask"] },
        },
        required: ["prompt"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_recall",
      description:
        "Search Super Memory and the skill ledger: past commands, URLs, facts, and what worked on this PC (browser, PC, code, task). Use when they refer to previous work or a similar job.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_save",
      description:
        "Save a durable preference or fact to Super Memory (redacted, local). Use when the user says to remember something.",
      parameters: {
        type: "object",
        properties: {
          fact: { type: "string" },
          pinned: { type: "boolean" },
        },
        required: ["fact"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_forget",
      description: "Remove a Super Memory fact or skill by id or short text. Does not delete project files.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Fact/skill id or a phrase to match" },
        },
        required: ["id"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "memory_optimize",
      description:
        "Hygiene already runs by itself. Call only if the user explicitly asks to clean Super Memory now. Merges duplicates, drops stale/contradictory facts and one-off noise. Never deletes project files.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "project_harness",
      description:
        "Build Harness of this coder. inspect/apply/check/changelog/version/pack on the current project. After code edits prefer check. Do not invent check-max.bat. apply writes only missing files (Makefile, npm test, CHANGELOG, .gitignore). Never XXR/Sony/VPN.",
      parameters: {
        type: "object",
        properties: {
          action: {
            type: "string",
            description: "inspect | apply | ensure | check | changelog | version | pack",
          },
          pieces: {
            type: "array",
            items: { type: "string" },
            description: "make, npm-test, lint, precommit, changelog, version, cache, audit, compose, ci, pack",
          },
          title: { type: "string" },
          note: { type: "string" },
          bump: { type: "string", description: "patch | minor | major" },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_fetch",
      description:
        "GET a public http(s) page. No login, cookies, credentials, or private APIs. Use for docs and open pages. Not a browser — for a live window use browser_navigate. For «найди файл» use web_search first, not this on the origin API.",
      parameters: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "web_search",
      description:
        "Search the public web (DuckDuckGo HTML/lite, no JS). First tool for «найди/скачай файл X». Returns top links. Do not start with the origin API (RuStore, Play, closed catalog).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          maxResults: { type: "number" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "download_file",
      description:
        "Stream a public http(s) file to disk (redirects, sha256, default 500MB cap). Never download .exe/.msi/.bat without consent=true. After an APK, call inspect_apk.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          path: { type: "string", description: "Destination file or folder. Default: Desktop." },
          maxBytes: { type: "number" },
          consent: { type: "boolean", description: "Required for .exe/.msi/.bat" },
        },
        required: ["url"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "inspect_apk",
      description: "Read an APK (ZIP): package, versionName, versionCode, assets/. Uses aapt2 if present.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "inspect_zip",
      description: "List files inside a ZIP/APK without extracting.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
];

export const READ_ONLY_TOOLS = new Set([
  "read_file",
  "list_dir",
  "grep",
  "browser_snapshot",
  "browser_tabs",
  "pc_windows",
  "pc_snapshot",
  "pc_screenshot",
  "memory_recall",
  "memory_optimize",
  "web_fetch",
  "web_search",
  "inspect_apk",
  "inspect_zip",
]);

export type ToolResult = {
  output: string;
  changedPaths?: string[];
  todos?: TodoItem[];
};

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  todos: TodoItem[],
  signal?: AbortSignal | null,
): Promise<ToolResult> {
  const result = await runExecuteTool(name, args, todos, signal);
  try {
    recordSkillFromTool(name, args, result.output);
  } catch {
    // skill ledger must never break the agent
  }
  return result;
}

async function runExecuteTool(
  name: string,
  args: Record<string, unknown>,
  todos: TodoItem[],
  signal?: AbortSignal | null,
): Promise<ToolResult> {
  try {
    if (signal?.aborted) throw new JobAbortedError();
    if (!isKnownTool(name)) return { output: unknownToolMessage(name) };
    const blocked = isolationFromTool(name, args);
    if (blocked) return { output: blocked };
    switch (name) {
      case "read_file": {
        const filePath = String(args.path ?? "");
        const offset = args.offset !== undefined ? Number(args.offset) : undefined;
        const limit = args.limit !== undefined ? Number(args.limit) : undefined;
        return { output: await readWorkspaceFile(filePath, offset, limit) };
      }
      case "list_dir":
        return { output: await listWorkspaceDir(String(args.path ?? "")) };
      case "grep":
        return {
          output: await grepWorkspace(
            String(args.pattern ?? ""),
            String(args.path ?? ""),
            args.glob ? String(args.glob) : undefined
          ),
        };
      case "search_replace": {
        const filePath = String(args.path ?? "");
        const result = await searchReplaceFile(
          filePath,
          String(args.old_string ?? ""),
          String(args.new_string ?? ""),
          Boolean(args.replace_all)
        );
        return {
          output: result.output,
          changedPaths: result.changed ? [filePath] : undefined,
        };
      }
      case "write_file": {
        const filePath = String(args.path ?? "");
        if (!filePath) return { output: "path is required" };
        return {
          output: await writeWorkspaceFile(filePath, String(args.contents ?? "")),
          changedPaths: [filePath],
        };
      }
      case "write_pc_file": {
        const place = (String(args.place ?? "desktop") || "desktop") as UserPlace;
        const name = String(args.name ?? "zametka.txt");
        const abs = resolveUserFile(place, name);
        return {
          output: await writePcFile(place, name, String(args.contents ?? "")),
          changedPaths: [abs],
        };
      }
      case "open_on_pc": {
        const abs = args.path
          ? String(args.path)
          : resolveUserFile(
              (String(args.place ?? "desktop") || "desktop") as UserPlace,
              String(args.name ?? "")
            );
        return { output: await openOnPc(abs) };
      }
      case "launch_app":
        return { output: await launchOnPc(String(args.target ?? "")) };
      case "browser_scroll":
        return {
          output: await browserScroll(
            String(args.direction ?? "down") as "down" | "up" | "top" | "bottom"
          ),
        };
      case "run_terminal_cmd":
        return {
          output: await runHostCommand(
            String(args.command ?? ""),
            String(args.working_directory ?? ""),
            signal,
          ),
        };
      case "todo_write": {
        const nextTodos = Array.isArray(args.todos) ? (args.todos as TodoItem[]) : todos;
        return {
          output: nextTodos.map((todo) => `- [${todo.status}] ${todo.content}`).join("\n"),
          todos: nextTodos,
        };
      }
      case "browser_navigate":
        return { output: await browserNavigate(String(args.url ?? "")) };
      case "browser_snapshot":
        return { output: await browserSnapshot() };
      case "browser_click": {
        const { sameRefAdvice, sameRefAfterAccordion } = await import("./click-outcome");
        const key = String(args.ref || args.text || "");
        if (sameRefAfterAccordion(key)) return { output: sameRefAdvice(key) };
        return { output: await browserClick(key) };
      }
      case "browser_type":
        return {
          output: await browserType(
            String(args.ref || args.selector || ""),
            String(args.text ?? ""),
            Boolean(args.submit)
          ),
        };
      case "browser_press":
        return { output: await browserPress(String(args.key ?? "Enter")) };
      case "browser_wait":
        return { output: await browserWait(Number(args.milliseconds ?? 1000)) };
      case "browser_back":
        return { output: await browserBack() };
      case "browser_forward":
        return { output: await browserForward() };
      case "browser_close":
        return { output: await browserClose() };
      case "browser_tabs":
        return { output: await browserTabs(String(args.query ?? args.title ?? "")) };
      case "browser_engine":
        return { output: await browserEngine(String(args.engine ?? args.id ?? "")) };
      case "click_kit": {
        const action = String(args.action || "heal");
        if (action === "status") return { output: clickKitStatusText() };
        const reason = String(args.reason || "клик не попадает по кнопкам");
        if (!shouldHealClickKit(reason)) {
          return {
            output:
              "Это не сломанный клик. Другой движок не качаю. Жми появившийся пункт меню или browser_press Enter.",
          };
        }
        return { output: await healClickKits(reason) };
      }
      case "browser_screenshot":
        return {
          output: await browserScreenshot(
            args.kind === "screen" ? "screen" : "tab",
            String(args.path ?? ""),
          ),
        };
      case "pc_windows":
        return { output: await pcWindows() };
      case "pc_focus":
        return { output: await pcFocus(String(args.title ?? args.query ?? "")) };
      case "operator_use":
        return { output: await operatorUse(String(args.query ?? args.app ?? args.target ?? ""), launchOnPc) };
      case "pc_snapshot":
        return { output: await pcSnapshot(String(args.title ?? args.query ?? "")) };
      case "pc_click": {
        const target =
          args.x !== undefined && args.y !== undefined
            ? `${Number(args.x)},${Number(args.y)}`
            : String(args.ref || args.name || args.text || "");
        return { output: await pcClick(target, Boolean(args.double)) };
      }
      case "pc_type":
        return {
          output: await pcType(String(args.text ?? ""), Boolean(args.submit), String(args.ref || args.name || "")),
        };
      case "pc_keys":
        return { output: await pcKeys(String(args.keys ?? args.key ?? "")) };
      case "pc_screenshot":
        return {
          output: await browserScreenshot("screen", String(args.path ?? "")),
        };
      case "send_to_peer": {
        const item = await sendPeerTask(
          String(args.prompt ?? ""),
          (args.mode === "ask" ? "ask" : "agent") as AgentMode
        );
        return {
          output: `Sent to ${item.hostname} (${item.host}) id=${item.id} status=${item.status}. A person on that PC must accept. It will run with that PC's files, shell, and browser.`,
        };
      }
      case "memory_recall": {
        const query = String(args.query ?? "");
        const { recallHeavyFile } = await import("./heavy-file");
        const hits = recallMemory(query, 10);
        const skills = recallSkillLines(query, 6);
        const files = recallHeavyFile(query, 6);
        const lines = [...skills, ...hits, ...files];
        return { output: lines.length ? [...new Set(lines)].join("\n") : "Super Memory: nothing matched." };
      }
      case "memory_save": {
        const fact = saveMemoryFact(String(args.fact ?? ""), Boolean(args.pinned));
        return { output: fact ? `Saved fact ${fact.id}: ${fact.text}` : "Empty fact, not saved." };
      }
      case "memory_forget": {
        const removed = forgetMemory(String(args.id ?? ""));
        return { output: `Removed ${removed} memory item(s). Project files were not touched.` };
      }
      case "project_harness": {
        const pieces = Array.isArray(args.pieces) ? args.pieces.map((item) => String(item)) : [];
        return runHarnessAction(getWorkspaceRoot(), String(args.action ?? "inspect"), {
          pieces,
          title: args.title ? String(args.title) : undefined,
          note: args.note ? String(args.note) : undefined,
          bump: args.bump ? String(args.bump) : undefined,
        });
      }
      case "web_fetch":
        return { output: await fetchPublicPage(String(args.url ?? "")) };
      case "web_search":
        return { output: await webSearch(String(args.query ?? ""), Number(args.maxResults) || 10) };
      case "download_file": {
        const output = await downloadFile({
          url: String(args.url ?? ""),
          path: args.path ? String(args.path) : "",
          maxBytes: args.maxBytes,
          consent: Boolean(args.consent || args.allowExec),
        });
        let changed: string[] | undefined;
        try {
          const parsed = JSON.parse(output) as { ok?: boolean; path?: string };
          if (parsed.ok && parsed.path) changed = [parsed.path];
        } catch {
          changed = undefined;
        }
        return { output, changedPaths: changed };
      }
      case "inspect_apk":
        return { output: inspectApk(String(args.path ?? "")) };
      case "inspect_zip":
        return { output: inspectZip(String(args.path ?? "")) };
      case "memory_optimize": {
        const snap = compactSuperMemory();
        const lines = [
          `enabled=${snap.enabled} events=${snap.events} unique=${snap.unique} redundancy=${snap.redundancy.toFixed(2)}`,
          snap.profile.git
            ? `git branch=${snap.profile.git.branch || "?"} dirty=${snap.profile.git.dirty ?? 0} last=${snap.profile.git.lastCommit || "—"}`
            : "git: n/a",
          "facts:",
          ...(snap.facts.slice(0, 8).map((fact) => `- ${fact.text}`) || ["- none"]),
          "skills:",
          ...(snap.skills.slice(0, 8).map((skill) => `- ×${skill.count} ${skill.title}`) || ["- none"]),
          "suggestions:",
          ...(snap.suggestions.slice(0, 6).map((item) => `- ${item.title}: ${item.detail}`) || ["- none"]),
        ];
        return { output: lines.join("\n") };
      }
      default:
        return { output: unknownToolMessage(name) };
    }
  } catch (error) {
    if (isAbortError(error) || signal?.aborted) throw error instanceof Error ? error : new JobAbortedError();
    const message = error instanceof Error ? error.message : String(error);
    return { output: message };
  }
}

export function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { raw };
  }
}
