import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { isDeniedLaunch, isSecretPath, planHostCommand, redactSecrets } from "./guard";
import { requestHostBridge } from "./host-bridge";
import type { TreeNode } from "./workspace";
import { STARTER_FILES } from "./workspace";
import { installDesktopLaunchers } from "./desktop-launcher";
import { setJobAbortHook, throwIfAborted, JobAbortedError } from "./run-control";
import { formatHeavyPreview, formatLightPreview, isHeavyText } from "./heavy-file";

export type HostConfig = {
  workspace: string;
};

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".agent",
  "dist",
  ".turbo",
  "coverage",
  ".venv",
  "__pycache__",
]);

const BINARY_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "pdf",
  "zip",
  "exe",
  "dll",
  "so",
  "dylib",
  "wasm",
  "woff",
  "woff2",
  "ttf",
  "mp4",
  "mp3",
]);

const MAX_FILE_BYTES = 512 * 1024;
const MAX_TREE_ENTRIES = 800;
const MAX_GREP_HITS = 200;
const COMMAND_TIMEOUT_MS = 15 * 60_000;
const MAX_COMMAND_OUTPUT = 80_000;
const SHELL_CWD_MAP = "__fedor2ShellCwdMap";
const jobAls = new AsyncLocalStorage<string>();
const jobProcs = new Map<string, Set<ChildProcess>>();

function killProcessTree(child: ChildProcess): void {
  if (!child || child.exitCode != null) return;
  const pid = child.pid;
  try {
    if (hostPlatform() === "win32" && pid) {
      hostSpawnImpl("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      // ignore
    }
  }
}

export function killJobProcesses(jobId?: string): void {
  const key = String(jobId || jobAls.getStore() || "").trim() || "default";
  const set = jobProcs.get(key);
  if (!set) return;
  for (const child of [...set]) {
    killProcessTree(child);
  }
  set.clear();
}

function registerJobProcess(child: ChildProcess): void {
  const key = jobKey();
  let set = jobProcs.get(key);
  if (!set) {
    set = new Set();
    jobProcs.set(key, set);
  }
  set.add(child);
  const drop = () => set.delete(child);
  child.once("close", drop);
  child.once("error", drop);
}

setJobAbortHook((id) => {
  killJobProcesses(id);
});

type ShellCwd = { cwd: string | null };

function shellMap(): Map<string, ShellCwd> {
  const g = globalThis as typeof globalThis & { [SHELL_CWD_MAP]?: Map<string, ShellCwd> };
  if (!g[SHELL_CWD_MAP]) g[SHELL_CWD_MAP] = new Map();
  return g[SHELL_CWD_MAP];
}

function jobKey(): string {
  return jobAls.getStore() || "default";
}

function shellState(): ShellCwd {
  const map = shellMap();
  const key = jobKey();
  let state = map.get(key);
  if (!state) {
    state = { cwd: null };
    map.set(key, state);
  }
  return state;
}

export function runInJob<T>(jobId: string | undefined, fn: () => T): T {
  return jobAls.run(String(jobId || "").trim() || "default", fn);
}

export function resetShellCwd(): void {
  shellState().cwd = null;
}

export type HostSpawn = (
  command: string,
  args: readonly string[],
  options?: SpawnOptions,
) => ChildProcess;

let hostSpawnImpl: HostSpawn = (command, args, options) => spawn(command, [...args], options ?? {});
let hostPlatformImpl: NodeJS.Platform | null = null;

/** Tests replace spawn / platform. Production always uses the real OS. */
export function setHostSpawn(fn: HostSpawn | null): void {
  hostSpawnImpl = fn ?? ((command, args, options) => spawn(command, [...args], options ?? {}));
}

export function setHostPlatform(platform: NodeJS.Platform | null): void {
  hostPlatformImpl = platform;
}

export function hostPlatform(): NodeJS.Platform {
  return hostPlatformImpl ?? process.platform;
}

export function quoteWinArg(value: string): string {
  const s = String(value ?? "");
  if (!s) return '""';
  if (s.startsWith('"') && s.endsWith('"') && s.length >= 2) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Visible UI spawn. windowsHide:true maps to CREATE_NO_WINDOW — Explorer and
 * start.bat then "start" with no window. The Next server itself is already hidden.
 * Do NOT pre-quote the path: Node spawn already quotes args with spaces.
 */
export function uiSpawnOptions(platform: NodeJS.Platform): SpawnOptions {
  if (platform === "win32") {
    return { detached: true, stdio: "ignore", windowsHide: false };
  }
  return { detached: true, stdio: "ignore" };
}

/**
 * Windows cmd.exe /c of a whole command string. Node's default argv quoting
 * turns `dir /b "C:\Users\Dir"` into `dir /b \"C:\Users\Dir\"` — dir then
 * prints nothing and `if exist` says NO. Verbatim keeps the inner quotes.
 */
export function cmdRunSpawnOptions(platform: NodeJS.Platform): SpawnOptions {
  if (platform === "win32") {
    return {
      windowsHide: true,
      windowsVerbatimArguments: true,
      stdio: ["ignore", "pipe", "pipe"],
    };
  }
  return { stdio: ["ignore", "pipe", "pipe"] };
}

export function openOnPcCommand(
  platform: NodeJS.Platform,
  isDir: boolean,
  target: string,
): { command: string; args: string[] } {
  void isDir;
  if (platform === "win32") {
    return { command: "cmd.exe", args: ["/c", "start", "", target] };
  }
  if (platform === "darwin") return { command: "open", args: [target] };
  return { command: "xdg-open", args: [target] };
}

/** Node fs, not cmd.exe. Use this when the model asks “does the file exist?”. */
export function diskTruth(absPath: string): string {
  const abs = path.resolve(absPath);
  try {
    if (!existsSync(abs)) return `node_fs=MISSING ${abs}`;
    const st = statSync(abs);
    if (st.isDirectory()) {
      const names = readdirSync(abs)
        .filter((name) => name !== ".DS_Store")
        .slice(0, 40);
      return `node_fs=DIR ${abs} count=${names.length} [${names.join(", ")}]`;
    }
    return `node_fs=FILE ${abs} bytes=${st.size}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `node_fs=ERROR ${abs} ${message}`;
  }
}

function waitForChildStart(child: ChildProcess, label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => fail(new Error("timed out waiting for process start")), 8000);
    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        child.unref();
      } catch {
        // mocks may omit unref
      }
      resolve();
    };
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to start ${label}: ${err.message}`));
    };
    child.once("error", fail);
    child.once("spawn", succeed);
    if (typeof child.pid === "number" && child.pid > 0) succeed();
  });
}

function spawnDetached(command: string, args: readonly string[]): Promise<void> {
  const options = uiSpawnOptions(hostPlatform());
  const child = hostSpawnImpl(command, args, options);
  return waitForChildStart(child, `${command} ${args.join(" ")}`);
}

export function expandEnvInPath(input: string): string {
  let s = input.trim();
  s = s.replace(/%([^%]+)%/gi, (_, name: string) => {
    const direct = process.env[name];
    if (direct) return direct;
    const upper = process.env[name.toUpperCase()];
    if (upper) return upper;
    const key = Object.keys(process.env).find((item) => item.toLowerCase() === name.toLowerCase());
    if (key && process.env[key]) return process.env[key] as string;
    return `%${name}%`;
  });
  s = s.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => process.env[name] ?? `\${${name}}`);
  s = s.replace(/(^|[^$])\$([A-Za-z_][A-Za-z0-9_]*)/g, (all, prefix: string, name: string) => {
    const value = process.env[name];
    return value != null ? `${prefix}${value}` : all;
  });
  return s;
}

function takeCwdMarker(text: string): { body: string; cwd?: string } {
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].startsWith("__GROK_CWD__")) {
      const nextCwd = lines[i].slice("__GROK_CWD__".length).trim();
      lines.splice(i, 1);
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      return { body: lines.join("\n"), cwd: nextCwd || undefined };
    }
  }
  return { body: text };
}

function configPath(): string {
  if (process.platform === "win32") {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(base, "Fedor2", "config.json");
  }
  return path.join(os.homedir(), ".fedor2", "config.json");
}

export function defaultWorkspacePath(): string {
  if (process.platform === "win32") {
    return path.join(os.homedir(), "Fedor2", "workspace");
  }
  return path.join(os.homedir(), "Fedor2", "workspace");
}

function readConfigFile(): HostConfig | null {
  try {
    const raw = readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<HostConfig>;
    if (parsed.workspace && typeof parsed.workspace === "string") {
      return { workspace: parsed.workspace };
    }
  } catch {
    // missing or invalid
  }
  return null;
}

export function writeHostConfig(config: HostConfig): void {
  const file = configPath();
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function getWorkspaceRoot(): string {
  const saved = readConfigFile();
  if (saved?.workspace) return path.resolve(saved.workspace);
  const fromEnv = process.env.GROK_WORKSPACE?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  return path.resolve(defaultWorkspacePath());
}

export function isUnderRoot(root: string, target: string): boolean {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (!rel) return true;
  if (rel.startsWith("..")) return false;
  if (path.isAbsolute(rel)) return false;
  return true;
}

export function isAllowedUserPath(absPath: string): boolean {
  const resolved = path.resolve(absPath);
  const roots = [
    os.homedir(),
    getWorkspaceRoot(),
    resolveUserPlace("desktop"),
    resolveUserPlace("documents"),
    resolveUserPlace("downloads"),
  ];
  return roots.some((root) => isUnderRoot(root, resolved));
}

export type UserPlace = "desktop" | "documents" | "downloads" | "workspace" | "home";

function firstExistingDir(candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      try {
        if (statSync(candidate).isDirectory()) return candidate;
      } catch {
        // skip
      }
    }
  }
  return null;
}

export function resolveUserPlace(place: UserPlace): string {
  const home = os.homedir();
  if (place === "workspace") return getWorkspaceRoot();
  if (place === "home") return home;
  if (place === "documents") {
    return (
      firstExistingDir([
        path.join(home, "Documents"),
        path.join(home, "OneDrive", "Documents"),
        path.join(home, "Документы"),
      ]) || path.join(home, "Documents")
    );
  }
  if (place === "downloads") {
    return (
      firstExistingDir([
        path.join(home, "Downloads"),
        path.join(home, "OneDrive", "Downloads"),
        path.join(home, "Загрузки"),
      ]) || path.join(home, "Downloads")
    );
  }
  const desktop =
    process.env.GROK_DESKTOP_DIR?.trim() ||
    firstExistingDir([
      path.join(home, "Desktop"),
      path.join(home, "OneDrive", "Desktop"),
      path.join(home, "OneDrive", "Рабочий стол"),
      path.join(home, "Рабочий стол"),
    ]);
  return desktop || path.join(home, "Desktop");
}

export function resolveUserFile(place: UserPlace, name: string): string {
  const base = resolveUserPlace(place);
  const safe = path.basename(String(name || "").replace(/\\/g, "/"));
  if (!safe || safe === "." || safe === "..") {
    throw new Error("Invalid file name");
  }
  if (isSecretPath(safe)) {
    throw new Error("Secret file name denied");
  }
  const target = path.resolve(base, safe);
  if (!isAllowedUserPath(target) || !isUnderRoot(base, target)) {
    throw new Error("Path is not allowed");
  }
  return target;
}

export async function writePcFile(
  place: UserPlace,
  name: string,
  contents: string
): Promise<string> {
  const abs = resolveUserFile(place, name);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contents, "utf8");
  return `Wrote ${abs} on ${os.hostname()} (${Buffer.byteLength(contents, "utf8")} bytes)\n${diskTruth(abs)}`;
}

export async function openOnPc(absPath: string): Promise<string> {
  const target = resolveHostPath(absPath);
  if (!existsSync(target)) {
    throw new Error(`File not found: ${target}`);
  }
  let isDir = false;
  try {
    isDir = statSync(target).isDirectory();
  } catch {
    isDir = false;
  }
  const via = await requestHostBridge("open", target);
  if (!via) {
    const { command, args } = openOnPcCommand(hostPlatform(), isDir, target);
    await spawnDetached(command, args);
  }
  const channel = via ? "electron-host-bridge" : "cmd-start";
  const opened = isDir
    ? `Opened folder in Explorer: ${target} on ${os.hostname()}`
    : `Opened ${target} on ${os.hostname()} as the current user`;
  return `${opened}\nvia=${channel}\n${diskTruth(target)}`;
}

export async function launchOnPc(target: string): Promise<string> {
  const trimmed = expandEnvInPath(target);
  if (!trimmed) throw new Error("target is required");
  if (isDeniedLaunch(trimmed)) {
    return `Refused to launch: ${trimmed.slice(0, 120)}`;
  }
  const spec =
    isAbsoluteHostPath(trimmed) || /[\\/]/.test(trimmed) ? resolveHostPath(trimmed) : trimmed;
  const platform = hostPlatform();
  const via = await requestHostBridge("launch", spec);
  if (!via) {
    if (platform === "win32") {
      await spawnDetached("cmd.exe", ["/c", "start", "", spec]);
    } else if (platform === "darwin") {
      await spawnDetached("open", [spec]);
    } else {
      await spawnDetached(spec, []);
    }
  }
  const channel = via ? "electron-host-bridge" : "cmd-start";
  return `Started ${spec} on ${os.hostname()} as the current user\nvia=${channel}`;
}

function resolveCommandCwd(workingDirectory: string): string {
  const trimmed = workingDirectory.trim();
  if (!trimmed) {
    const remembered = shellState().cwd;
    if (remembered && existsSync(remembered)) {
      try {
        if (statSync(remembered).isDirectory()) return remembered;
      } catch {
        // fall through
      }
    }
    return getWorkspaceRoot();
  }
  const abs = resolveHostPath(trimmed);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`working_directory does not exist: ${trimmed}`);
  }
  shellState().cwd = abs;
  return abs;
}

export function isInsideWorkspace(root: string, target: string): boolean {
  return isUnderRoot(root, target);
}

export function isAbsoluteHostPath(input: string): boolean {
  const trimmed = expandEnvInPath(input);
  if (!trimmed) return false;
  if (trimmed === "~" || trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return true;
  if (trimmed.startsWith("\\\\")) return true;
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  return path.isAbsolute(trimmed);
}

export function resolveHostPath(input = ""): string {
  const trimmed = expandEnvInPath(input);
  if (!trimmed) return getWorkspaceRoot();
  if (trimmed === "~") return path.resolve(os.homedir());
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return path.resolve(os.homedir(), trimmed.slice(2));
  }
  if (trimmed.startsWith("\\\\") || /^[A-Za-z]:[\\/]/.test(trimmed) || path.isAbsolute(trimmed)) {
    return path.resolve(trimmed);
  }
  return resolveWorkspacePath(trimmed);
}

export function displayHostPath(absPath: string): string {
  const abs = path.resolve(absPath);
  if (isUnderRoot(getWorkspaceRoot(), abs)) return toPosixRel(abs);
  return abs;
}

export function resolveWorkspacePath(relPath = ""): string {
  const root = getWorkspaceRoot();
  const trimmed = relPath.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  const safeRel = trimmed
    .split("/")
    .filter((part) => part && part !== ".")
    .map((part) => {
      if (part === "..") throw new Error("Path escapes the workspace.");
      return part;
    })
    .join(path.sep);
  const target = safeRel ? path.resolve(root, safeRel) : path.resolve(root);
  if (!isInsideWorkspace(root, target)) {
    throw new Error(`Path escapes the workspace: ${relPath}`);
  }
  return target;
}

export function toPosixRel(absPath: string): string {
  const root = getWorkspaceRoot();
  const rel = path.relative(root, absPath);
  return rel.split(path.sep).join("/");
}

export async function ensureWorkspace(): Promise<string> {
  const root = getWorkspaceRoot();
  await mkdir(root, { recursive: true });
  writeHostConfig({ workspace: root });
  const entries = await readdir(root).catch(() => []);
  if (entries.length === 0) {
    await seedStarter(root);
  }
  try {
    installDesktopLaunchers({ appRoot: process.cwd() });
  } catch {
    // launching without a desktop icon must not break the app
  }
  return root;
}

export async function setWorkspaceRoot(next: string): Promise<string> {
  const root = path.resolve(next.trim());
  await mkdir(root, { recursive: true });
  process.env.GROK_WORKSPACE = root;
  writeHostConfig({ workspace: root });
  shellState().cwd = root;
  const entries = await readdir(root);
  if (entries.length === 0) await seedStarter(root);
  return root;
}

export async function seedStarter(root = getWorkspaceRoot()): Promise<void> {
  await mkdir(root, { recursive: true });
  for (const [rel, contents] of Object.entries(STARTER_FILES)) {
    const abs = path.join(root, rel);
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, contents, "utf8");
  }
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name);
}

function isProbablyBinary(rel: string, buf: Buffer): boolean {
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  if (BINARY_EXT.has(ext)) return true;
  const sample = buf.subarray(0, 800);
  return sample.includes(0);
}

export async function listWorkspaceTree(): Promise<TreeNode[]> {
  const root = await ensureWorkspace();
  const files: string[] = [];

  const walk = async (dir: string) => {
    if (files.length >= MAX_TREE_ENTRIES) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    entries.sort((a, b) => a.localeCompare(b));
    for (const name of entries) {
      if (files.length >= MAX_TREE_ENTRIES) return;
      if (name.startsWith(".") && name !== ".env.example" && name !== ".gitignore") {
        if (shouldSkipDir(name) || name === ".DS_Store") continue;
      }
      if (shouldSkipDir(name)) continue;
      const abs = path.join(dir, name);
      let info;
      try {
        info = await stat(abs);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(abs);
      } else if (info.isFile()) {
        files.push(toPosixRel(abs));
      }
    }
  };

  await walk(root);
  return fileTreeFromPaths(files);
}

function fileTreeFromPaths(paths: string[]): TreeNode[] {
  const root: TreeNode[] = [];
  const ensureFolder = (segments: string[]): TreeNode[] => {
    let level = root;
    let current = "";
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment;
      let node = level.find((item) => item.name === segment && item.kind === "folder");
      if (!node) {
        node = { name: segment, path: current, kind: "folder", children: [] };
        level.push(node);
      }
      level = node.children!;
    }
    return level;
  };

  for (const filePath of [...paths].sort()) {
    const parts = filePath.split("/");
    const fileName = parts.pop()!;
    const parent = parts.length ? ensureFolder(parts) : root;
    parent.push({ name: fileName, path: filePath, kind: "file" });
  }

  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const node of nodes) {
      if (node.children) sortLevel(node.children);
    }
  };
  sortLevel(root);
  return root;
}

export async function listWorkspaceSnapshot(limit = 400): Promise<string> {
  const root = await ensureWorkspace();
  const lines: string[] = [];

  const walk = async (dir: string) => {
    if (lines.length >= limit) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (lines.length >= limit) return;
      if (shouldSkipDir(name)) continue;
      const abs = path.join(dir, name);
      let info;
      try {
        info = await stat(abs);
      } catch {
        continue;
      }
      const rel = displayHostPath(abs);
      if (info.isDirectory()) {
        lines.push(`${rel}/`);
        await walk(abs);
      } else if (info.isFile()) {
        lines.push(rel);
      }
    }
  };

  await walk(root);
  const extra = lines.length >= limit ? `\n… truncated after ${limit} entries` : "";
  return lines.join("\n") + extra;
}

export async function readWorkspaceFile(relPath: string, offset?: number, limit?: number): Promise<string> {
  if (isSecretPath(relPath)) {
    throw new Error(`Secret path denied: ${relPath}`);
  }
  const abs = resolveHostPath(relPath);
  if (isSecretPath(abs)) {
    throw new Error(`Secret path denied: ${relPath}`);
  }
  const buf = await readFile(abs);
  if (isProbablyBinary(relPath, buf)) {
    return `Binary file (${buf.length} bytes): ${abs}`;
  }
  const text = redactSecrets(buf.subarray(0, MAX_FILE_BYTES).toString("utf8"));
  const label = displayHostPath(abs);
  const windowed = offset !== undefined || (limit !== undefined && limit > 0 && limit <= 80);
  if (!windowed && isHeavyText(text)) {
    return formatHeavyPreview(label, text, offset, limit);
  }
  return formatLightPreview(label, text, offset, limit);
}

export async function readWorkspaceFileRaw(relPath: string): Promise<string> {
  if (isSecretPath(relPath)) throw new Error(`Secret path denied: ${relPath}`);
  const abs = resolveHostPath(relPath);
  if (isSecretPath(abs)) throw new Error(`Secret path denied: ${relPath}`);
  const buf = await readFile(abs);
  if (buf.length > MAX_FILE_BYTES) {
    return buf.subarray(0, MAX_FILE_BYTES).toString("utf8");
  }
  return buf.toString("utf8");
}

export async function writeWorkspaceFile(relPath: string, contents: string): Promise<string> {
  if (isSecretPath(relPath)) {
    throw new Error(`Secret path denied: ${relPath}`);
  }
  const abs = resolveHostPath(relPath);
  if (isSecretPath(abs)) {
    throw new Error(`Secret path denied: ${relPath}`);
  }
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, contents, "utf8");
  return `Wrote ${abs} on ${os.hostname()} (${Buffer.byteLength(contents, "utf8")} bytes)\n${diskTruth(abs)}`;
}

export async function listWorkspaceDir(relPath = ""): Promise<string> {
  const abs = resolveHostPath(relPath);
  const entries = await readdir(abs, { withFileTypes: true });
  const lines = entries
    .filter((entry) => !shouldSkipDir(entry.name) && entry.name !== ".DS_Store")
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name));
  return `${diskTruth(abs)}\n${lines.length ? lines.join("\n") : "(empty)"}`;
}

export async function grepWorkspace(pattern: string, relPath = "", glob?: string): Promise<string> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "g");
  } catch {
    return `Invalid regular expression: ${pattern}`;
  }
  const root = relPath ? resolveHostPath(relPath) : getWorkspaceRoot();
  const hits: string[] = [];
  const globRe = glob
    ? new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`)
    : null;

  const walk = async (dir: string) => {
    if (hits.length >= MAX_GREP_HITS) return;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (hits.length >= MAX_GREP_HITS) return;
      if (shouldSkipDir(name)) continue;
      const abs = path.join(dir, name);
      if (isSecretPath(name) || isSecretPath(abs)) continue;
      let info;
      try {
        info = await stat(abs);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!info.isFile() || info.size > MAX_FILE_BYTES) continue;
      const rel = displayHostPath(abs);
      if (globRe && !globRe.test(name) && !globRe.test(rel)) continue;
      const buf = await readFile(abs);
      if (isProbablyBinary(rel, buf)) continue;
      const text = buf.toString("utf8");
      text.split("\n").forEach((line, index) => {
        if (hits.length >= MAX_GREP_HITS) return;
        regex.lastIndex = 0;
        if (regex.test(line)) hits.push(`${rel}:${index + 1}:${redactSecrets(line)}`);
      });
    }
  };

  const info = statSync(root);
  if (info.isFile()) {
    if (isSecretPath(root)) return "Secret path denied";
    const rel = displayHostPath(root);
    const buf = await readFile(root);
    buf
      .toString("utf8")
      .split("\n")
      .forEach((line, index) => {
        regex.lastIndex = 0;
        if (regex.test(line)) hits.push(`${rel}:${index + 1}:${redactSecrets(line)}`);
      });
  } else {
    await walk(root);
  }
  return hits.length ? hits.join("\n") : "No matches";
}

export async function searchReplaceFile(
  relPath: string,
  oldString: string,
  newString: string,
  replaceAll = false
): Promise<{ output: string; changed: boolean }> {
  if (isSecretPath(relPath)) {
    return { output: `Secret path denied: ${relPath}`, changed: false };
  }
  const abs = resolveHostPath(relPath);
  if (isSecretPath(abs)) {
    return { output: `Secret path denied: ${relPath}`, changed: false };
  }
  const haystack = await readFile(abs, "utf8");
  if (!haystack.includes(oldString)) {
    return { output: `old_string not found in ${relPath}`, changed: false };
  }
  if (!replaceAll) {
    const first = haystack.indexOf(oldString);
    const second = haystack.indexOf(oldString, first + oldString.length);
    if (second !== -1) {
      return {
        output: `old_string matched more than once in ${relPath}. Pass replace_all or provide a unique string.`,
        changed: false,
      };
    }
  }
  const next = replaceAll ? haystack.split(oldString).join(newString) : haystack.replace(oldString, newString);
  await writeFile(abs, next, "utf8");
  return { output: `Updated ${relPath} on ${os.hostname()}`, changed: true };
}

function windowsCmdShell(): string {
  const fromEnv = process.env.ComSpec || process.env.COMSPEC || "";
  if (fromEnv.trim()) return fromEnv;
  const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
  return path.join(root, "System32", "cmd.exe");
}

export async function runHostCommand(
  command: string,
  workingDirectory = "",
  signal?: AbortSignal | null,
): Promise<string> {
  throwIfAborted(signal);
  let cwd: string;
  try {
    cwd = resolveCommandCwd(workingDirectory);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  if (!existsSync(cwd)) {
    return `working_directory does not exist: ${workingDirectory || "."}`;
  }
  const trimmed = command.trim();
  if (!trimmed) return "";
  const platform = hostPlatform();
  const plan = planHostCommand(trimmed, platform);
  if (!plan.allowed) {
    return `DENIED cwd=${cwd}\n${plan.reason}`;
  }

  const isWin = platform === "win32";
  const marker = "__GROK_CWD__";
  const tracked = isWin
    ? `${plan.command} & echo ${marker}%CD%`
    : `${plan.command}\nprintf '\\n%s%s\\n' '${marker}' "$PWD"`;
  const shell = isWin ? windowsCmdShell() : "/bin/bash";
  const args = isWin ? ["/d", "/s", "/c", tracked] : ["-lc", tracked];

  return new Promise((resolvePromise, rejectPromise) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GROK_CODER_HOST: os.hostname(),
    };
    if (env.npm_config_prefix === "/") {
      delete env.npm_config_prefix;
    }
    const spawnOpts = { cwd, env, ...cmdRunSpawnOptions(platform) };
    let child = hostSpawnImpl(shell, args, spawnOpts);
    let retried = false;
    const wire = (proc: ReturnType<typeof hostSpawnImpl>) => {
      registerJobProcess(proc);
      proc.stdout?.on("data", (chunk: Buffer) => onChunk(chunk, "out"));
      proc.stderr?.on("data", (chunk: Buffer) => onChunk(chunk, "err"));
      proc.on("error", (error) => {
        const msg = error instanceof Error ? error.message : String(error);
        if (!retried && /ENOENT/i.test(msg) && (/bash/i.test(shell) || /bash/i.test(msg))) {
          retried = true;
          child = hostSpawnImpl(windowsCmdShell(), ["/d", "/s", "/c", `${plan.command} & echo ${marker}%CD%`], {
            cwd,
            env,
            ...cmdRunSpawnOptions("win32"),
          });
          wire(child);
          return;
        }
        clearTimeout(timer);
        resolvePromise(
          `Failed to start command: ${msg}. На Windows оболочка — cmd.exe (dir, type, cd /d), не /bin/bash.`,
        );
      });
      proc.on("close", (code, closeSignal) => {
        clearTimeout(timer);
        try {
          signal?.removeEventListener("abort", onAbort);
        } catch {
          // ignore
        }
        if (signal?.aborted) {
          rejectPromise(new JobAbortedError());
          return;
        }
        const raw = `${stdout}${stderr ? (stdout ? "\n" : "") + stderr : ""}`;
        const parsed = takeCwdMarker(raw);
        if (parsed.cwd && existsSync(parsed.cwd)) {
          try {
            if (statSync(parsed.cwd).isDirectory()) shellState().cwd = parsed.cwd;
          } catch {
            // ignore
          }
        }
        const body = parsed.body.slice(0, MAX_COMMAND_OUTPUT);
        const suffix =
          closeSignal === "SIGTERM" && !body.includes("Failed")
            ? `\n[stopped after ${COMMAND_TIMEOUT_MS / 1000}s or output limit]`
            : "";
        const liveCwd = shellState().cwd || cwd;
        const header = `host=${os.hostname()} cwd=${liveCwd} exit=${code ?? "null"}${plan.note ? ` note=${plan.note}` : ""} ${diskTruth(liveCwd)}`;
        resolvePromise(`${header}\n${body || "(no output)"}${suffix}`);
      });
    };
    registerJobProcess(child);
    const onAbort = () => killProcessTree(child);
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    let stdout = "";
    let stderr = "";
    const onChunk = (chunk: Buffer, dest: "out" | "err") => {
      const text = chunk.toString("utf8");
      if (dest === "out") stdout += text;
      else stderr += text;
      if (stdout.length + stderr.length > MAX_COMMAND_OUTPUT) {
        child.kill("SIGTERM");
      }
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, COMMAND_TIMEOUT_MS);
    wire(child);
  });
}

export function hostInfo() {
  let launchers: string[] = [];
  try {
    launchers = installDesktopLaunchers({ appRoot: process.cwd() }).written;
  } catch {
    launchers = [];
  }
  return {
    hostname: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    homedir: os.homedir(),
    workspace: getWorkspaceRoot(),
    desktop: resolveUserPlace("desktop"),
    documents: resolveUserPlace("documents"),
    downloads: resolveUserPlace("downloads"),
    launchers,
    configPath: configPath(),
  };
}

