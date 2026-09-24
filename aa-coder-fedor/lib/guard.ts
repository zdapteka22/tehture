import path from "node:path";

/** Destructive / out-of-policy commands. Live terminal, Fyodor, and launch_app all use this. */
export const SHELL_DENY =
  /(\bpowershell(\.exe)?\b|\bpwsh(\.exe)?\b|\bInvoke-Expression\b|\bIEX\s*\(|DownloadString\s*\(|\bgit\s+push\b|\bgit\s+reset\s+--hard\b|\bgit\s+checkout\s+--(\s|$|\.)|\bgit\s+clean\s+-f|\bsudo\b|\brm\s+-rf\s+[\/~]|\brm\s+-rf\s+\.(?:\s|$)|rd\s+\/s\s+\/q\s+[A-Za-z]:\\|del\s+\/[fsq ]+\s+[A-Za-z]:\\|format\s+[a-z]:|\bformat\.com\b|\bshutdown(\.exe)?\b|\bmkfs\b|\bdd\s+if=|\bdiskpart\b|\bcipher\s+\/w|\bcurl\s+[^\n]*\|\s*(sh|bash|cmd)|iwr\s+[^\n]*\|\s*iex)/i;

/**
 * OS + the coder window. The agent may not kill / stop these.
 * Closing a window is the user's job.
 */
export const PROTECTED_PROCESSES = [
  "csrss",
  "lsass",
  "winlogon",
  "wininit",
  "services",
  "smss",
  "svchost",
  "dwm",
  "explorer",
  "system",
  "registry",
  "lsm",
  "fontdrvhost",
  "sihost",
  "taskmgr",
  "electron",
  "node",
] as const;

const KILL_TOOL =
  /(\btaskkill(\.exe)?\b|\btskill(\.exe)?\b|\bwmic\s+process\b|\bStop-Process\b|\bStop-Service\b|\bpkill\b|\bkillall\b|\bkill\s+-\d+)/i;

const SECRET_NAME =
  /(^|[/\\])(\.env|\.env\.[^/\\]+|.+\.pem|.+\.key|.+\.p12|.+\.pfx|id_rsa|id_ed25519|credentials\.json|secrets?\.json|auth\.json|serviceAccount.+\.json)(\.|$)/i;

export function isProtectedProcess(name: string): boolean {
  const n = String(name || "")
    .replace(/\.exe$/i, "")
    .trim()
    .toLowerCase();
  return (PROTECTED_PROCESSES as readonly string[]).includes(n);
}

/** taskkill / Stop-Process / kill of explorer, electron, lsass, … */
export function isDeniedProcessTouch(command: string): boolean {
  const cmd = String(command || "");
  if (!KILL_TOOL.test(cmd) && !/\bkill\s+\d+/i.test(cmd)) return false;

  if (/\bwmic\s+process\b/i.test(cmd)) return true;
  if (/\bpkill\b|\bkillall\b/i.test(cmd)) return true;
  if (/\btaskkill\b/i.test(cmd) && !/\/im\s+/i.test(cmd)) return true;

  const named =
    cmd.match(/\/im\s+"?([A-Za-z0-9._-]+)"?/gi) ||
    cmd.match(/-Name\s+"?([A-Za-z0-9._-]+)"?/gi) ||
    cmd.match(/\bkillall\s+(?:-9\s+)?([A-Za-z0-9._-]+)/gi) ||
    [];
  for (const chunk of named) {
    const token = chunk.replace(/^.*?([A-Za-z0-9._-]+)\s*$/i, "$1");
    if (isProtectedProcess(token)) return true;
    if (token === "*" || token === ".") return true;
  }

  for (const proc of PROTECTED_PROCESSES) {
    if (new RegExp(`\\b${proc}(\\.exe)?\\b`, "i").test(cmd)) return true;
  }
  return false;
}

export function isDeniedShell(command: string): boolean {
  const c = String(command || "");
  return SHELL_DENY.test(c) || isDeniedProcessTouch(c);
}

export function isSecretPath(relOrAbs: string): boolean {
  const base = path.basename(relOrAbs);
  const full = String(relOrAbs || "").replace(/\\/g, "/");
  if (/\.env\.example$/i.test(base)) return false;
  if (SECRET_NAME.test(base) || SECRET_NAME.test(full)) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (/\.(pem|key|p12|pfx)$/i.test(base)) return true;
  return false;
}

export function redactSecrets(text: string): string {
  let s = String(text || "");
  s = s.replace(/\b(sk-|sk-or-v1-|xai-|AQVN)[A-Za-z0-9_\-]{8,}/g, "[redacted]");
  s = s.replace(/\bBearer\s+\S+/gi, "Bearer [redacted]");
  s = s.replace(/\b(api[_-]?key|password|token|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]");
  s = s.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted-key]");
  return s;
}

export function isDeniedLaunch(target: string): boolean {
  const t = String(target || "");
  if (isDeniedShell(t)) return true;
  return /(\bformat(\.com)?\b|\bshutdown(\.exe)?\b|\bdiskpart\b|\bpowershell\b|\bpwsh\b)/i.test(t);
}

export type HostCommandPlan = {
  allowed: boolean;
  command: string;
  reason?: string;
  note?: string;
};

/**
 * Windows is cmd.exe. Models often emit bash/PowerShell — rewrite the safe ones, refuse the rest.
 */
export function planHostCommand(command: string, platform = process.platform): HostCommandPlan {
  const trimmed = String(command || "").trim();
  if (!trimmed) return { allowed: true, command: trimmed };
  if (isDeniedProcessTouch(trimmed)) {
    return {
      allowed: false,
      command: trimmed,
      reason:
        "Нельзя трогать системные процессы и окно кодера (explorer, electron, lsass и подобные). Закройте окно сами крестиком.",
    };
  }
  if (SHELL_DENY.test(trimmed)) {
    return {
      allowed: false,
      command: trimmed,
      reason:
        "Команда запрещена: git push / reset --hard, PowerShell, format, shutdown, rm -rf корня и подобные. На Windows — cmd.exe.",
    };
  }
  if (platform !== "win32") return { allowed: true, command: trimmed };

  if (/^\s*(powershell|pwsh)(\.exe)?\b/i.test(trimmed)) {
    return {
      allowed: false,
      command: trimmed,
      reason: "PowerShell выключен. Нужна команда cmd.exe (dir, type, copy, set, cd /d).",
    };
  }

  let next = trimmed;
  let note = "";
  const simple: Array<[RegExp, string, string]> = [
    [/^\s*ls\s*$/i, "dir", "ls → dir"],
    [/^\s*ls\s+/i, "dir ", "ls → dir"],
    [/^\s*pwd\s*$/i, "cd", "pwd → cd"],
    [/^\s*clear\s*$/i, "cls", "clear → cls"],
    [/^\s*cat\s+/i, "type ", "cat → type"],
    [/^\s*cp\s+/i, "copy ", "cp → copy"],
    [/^\s*mv\s+/i, "move ", "mv → move"],
    [/^\s*export\s+/i, "set ", "export → set"],
    [/^\s*touch\s+(\S+)/i, "type nul >> $1", "touch → type nul >>"],
    [/^\s*rm\s+-rf\s+(\S+)/i, "rmdir /s /q $1", "rm -rf → rmdir /s /q"],
    [/^\s*rm\s+(\S+)/i, "del $1", "rm → del"],
  ];
  for (const [re, repl, label] of simple) {
    if (re.test(next)) {
      next = next.replace(re, repl);
      note = label;
      break;
    }
  }
  if (/\$\(|`[^`]+`/.test(next)) {
    return {
      allowed: false,
      command: trimmed,
      reason: "Подстановка bash $(...) на Windows не выполняется. Напишите обычную команду cmd.",
    };
  }
  if (isDeniedShell(next)) {
    return {
      allowed: false,
      command: trimmed,
      reason: "После перевода в cmd команда всё ещё опасна и не будет запущена.",
    };
  }
  return { allowed: true, command: next, note: note || undefined };
}
