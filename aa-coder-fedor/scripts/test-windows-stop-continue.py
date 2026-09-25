#!/usr/bin/env python3
"""Wine/Windows: when the coder must stop vs when it must keep going.

Runs real Windows node.exe inside cmd.exe and reads results from files
(Wine often breaks node stdout pipes with EBADF).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

AGENT = Path("/workspace/.agent")
WINE = "wine"
WINEPREFIX = Path(os.environ.get("FEDOR_WINEPREFIX") or (Path.home() / ".wine-fedor"))
NODE_EXE = WINEPREFIX / "drive_c/users/ubuntu/AppData/Local/Fedor2/node/node-v22.19.0-win-x64/node.exe"
WORKDIR_L = WINEPREFIX / "drive_c/users/ubuntu/AppData/Local/Temp/fedor-stop-test"
WORKDIR_W = r"C:\users\ubuntu\AppData\Local\Temp\fedor-stop-test"
NODE_W = r"C:\users\ubuntu\AppData\Local\Fedor2\node\node-v22.19.0-win-x64\node.exe"

PASS = 0
FAIL = 0


def ok(name: str, cond: bool, detail: str = "") -> None:
    global PASS, FAIL
    if not cond:
        FAIL += 1
        print("FAIL", name, (detail or "")[:280].replace("\n", " | "))
        return
    PASS += 1
    print("ok  ", name)


def wine_env() -> dict[str, str]:
    env = os.environ.copy()
    env["WINEDEBUG"] = "-all"
    env["WINEPREFIX"] = str(WINEPREFIX)
    env["LOOP_GUARD_NO_LAUNCH"] = "1"
    return env


def run_wine(cmd: list[str], timeout: int = 90) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, env=wine_env(), text=True, capture_output=True, timeout=timeout)


def write_bat(name: str, lines: list[str]) -> Path:
    path = WORKDIR_L / name
    path.write_text("@echo off\r\n" + "\r\n".join(lines) + "\r\n", encoding="ascii", errors="replace")
    return path


def run_bat(name: str, timeout: int = 90) -> int:
    r = run_wine([WINE, "cmd", "/c", rf"{WORKDIR_W}\{name}"], timeout=timeout)
    return r.returncode


def read_out() -> str:
    p = WORKDIR_L / "out.txt"
    if not p.exists():
        return ""
    raw = p.read_bytes()
    for enc in ("utf-8", "cp866", "cp1251", "latin-1"):
        try:
            return raw.decode(enc).replace("\r\n", "\n")
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", "replace").replace("\r\n", "\n")


def field(text: str, key: str) -> str:
    for line in text.splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip()
    return ""


def state() -> dict:
    p = WORKDIR_L / "loop-guard.state.json"
    if not p.exists():
        return {}
    return json.loads(p.read_text(encoding="utf-8"))


def write_state(data: dict) -> None:
    (WORKDIR_L / "loop-guard.state.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def reset_work() -> None:
    if WORKDIR_L.exists():
        shutil.rmtree(WORKDIR_L)
    WORKDIR_L.mkdir(parents=True)
    for name in ("loop-guard.mjs", "loop-guard.json", "resume-goal.mjs", "goal-brain.mjs", "check.bat", "check-guard.bat"):
        src = AGENT / name
        if src.exists():
            shutil.copy2(src, WORKDIR_L / name)


def guard(args: str) -> str:
    """Run loop-guard via Windows node.exe, capture stdout to out.txt."""
    write_bat(
        "_run.bat",
        [
            f"cd /d {WORKDIR_W}",
            f'"{NODE_W}" loop-guard.mjs {args} > out.txt 2>&1',
            "echo EXITCODE=%ERRORLEVEL%>> out.txt",
        ],
    )
    run_bat("_run.bat")
    return read_out()


def main() -> None:
    ok("wine present", run_wine([WINE, "--version"]).returncode == 0)
    ok("windows node.exe present", NODE_EXE.exists())
    reset_work()
    # probe node to file
    (WORKDIR_L / "_probe.bat").write_text(
        f'@echo off\r\ncd /d {WORKDIR_W}\r\n"{NODE_W}" --version > out.txt 2>&1\r\n',
        encoding="ascii",
    )
    run_bat("_probe.bat")
    ok("windows node.exe runs", "v22" in read_out(), read_out()[:80])

    # --- MUST KEEP GOING ---
    reset_work()
    text = guard('begin --goal="fix file app.ts"')
    ok("begin work task CONTINUE", field(text, "VERDICT") == "CONTINUE", text)

    text = guard('classify --type=stop-attempt --assistant="say fix" --user="fix file app.ts"')
    st = state()
    ok("empty done_when classify CONTINUE", field(text, "ACTION") == "CONTINUE" and field(text, "VERDICT") == "CONTINUE", text)
    ok("empty done_when is open_goal", field(text, "REASON") == "open_goal" or st.get("reason") == "open_goal", text)
    ok("empty done_when no RESTART", "RESTARTED=" not in text, text)
    ok("classify wrote loops", int(st.get("loops") or 0) >= 1, json.dumps(st, ensure_ascii=False)[:200])

    # Russian question via UTF-8 state, not cmd.exe codepage
    st = state()
    loops_before = int(st.get("loops") or 0)
    restarts_before = int(st.get("restarts") or 0)
    st["goal"] = "почини оплату"
    st["last_user"] = "почини оплату"
    write_state(st)
    text = guard('begin --goal="hung again why"')
    st = state()
    ok("follow-up begin keeps loops", int(st.get("loops") or 0) == loops_before, json.dumps(st, ensure_ascii=False)[:240])
    ok("follow-up begin keeps restarts", int(st.get("restarts") or 0) == restarts_before)

    # Real Russian phrases written into state, then classify
    st["goal"] = "почини оплату"
    st["last_user"] = "не процесы а имено ты опять завис"
    st["done_when"] = []
    write_state(st)
    text = guard('classify --type=stop-attempt --assistant="say fix"')
    st = state()
    ok("russian hang question CONTINUE", field(text, "ACTION") == "CONTINUE" and "RESTARTED=" not in text, text)
    ok("russian hang question writes loops", int(st.get("loops") or 0) == loops_before + 1, json.dumps(st, ensure_ascii=False)[:240])
    ok("russian hang question open_goal", field(text, "REASON") == "open_goal" or st.get("reason") == "open_goal", text)

    for phrase, label in (("i", "short i"), ("aaaa", "short aaaa"), ("why so long?", "why so long")):
        before = int(state().get("loops") or 0)
        guard(f'begin --goal="{phrase}"')
        st = state()
        ok(f"{label} does not reset loops", int(st.get("loops") or 0) == before, json.dumps(st, ensure_ascii=False)[:200])

    # Russian short follow-ups via beginGoal through a tiny driver file (UTF-8)
    driver = WORKDIR_L / "follow.mjs"
    driver.write_text(
        "import { beginGoal, emptyState } from './loop-guard.mjs';\n"
        "import fs from 'node:fs';\n"
        "const prev = JSON.parse(fs.readFileSync('loop-guard.state.json','utf8'));\n"
        "const next = beginGoal(prev, process.argv[2], []);\n"
        "fs.writeFileSync('loop-guard.state.json', JSON.stringify(next, null, 2));\n"
        "console.log('REASON=' + next.reason);\n"
        "console.log('LOOPS=' + next.loops);\n"
        "console.log('RESTARTS=' + next.restarts);\n",
        encoding="utf-8",
    )
    st = state()
    st["goal"] = "почини оплату"
    st["loops"] = 4
    st["restarts"] = 1
    write_state(st)
    driver.write_text(
        "import { beginGoal } from './loop-guard.mjs';\n"
        "import fs from 'node:fs';\n"
        "const prev = JSON.parse(fs.readFileSync('loop-guard.state.json','utf8'));\n"
        "const phrase = fs.readFileSync('phrase.txt','utf8').trim();\n"
        "const next = beginGoal(prev, phrase, []);\n"
        "fs.writeFileSync('loop-guard.state.json', JSON.stringify(next, null, 2));\n"
        "console.log('REASON=' + next.reason);\n"
        "console.log('LOOPS=' + next.loops);\n"
        "console.log('RESTARTS=' + next.restarts);\n"
        "console.log('GOAL=' + next.goal);\n",
        encoding="utf-8",
    )
    write_bat("_follow.bat", [f"cd /d {WORKDIR_W}", f'"{NODE_W}" follow.mjs > out.txt 2>&1'])
    for phrase, label in (("и", "и"), ("аааа", "аааа"), ("чё так долго", "чё так долго"), ("не процесы а имено ты опять завис", "ты опять завис")):
        (WORKDIR_L / "phrase.txt").write_text(phrase, encoding="utf-8")
        run_bat("_follow.bat")
        st = state()
        ok(f"RU {label} keeps loops/restarts", int(st.get("loops") or 0) == 4 and int(st.get("restarts") or 0) == 1, json.dumps(st, ensure_ascii=False)[:240])

    text = guard('classify --type=stop-attempt --assistant="готово смотри"')
    ok("слово готово не стоп", field(text, "ACTION") == "CONTINUE" and field(text, "VERDICT") == "CONTINUE", text)

    text = guard('classify --type=stop-attempt --assistant="цель достигнута"')
    ok("цель достигнута без квитанции CONTINUE", field(text, "ACTION") == "CONTINUE" and "RESTARTED=" not in text, text)

    text = guard('classify --type=stop-attempt --assistant="сделаю позже"')
    ok("сделаю позже CONTINUE", field(text, "ACTION") == "CONTINUE", text)

    text = guard("enforce")
    ok("enforce empty done_when exit 2", "EXITCODE=2" in text, text)
    ok("enforce says keep going", "НЕ ОСТАНАВЛИВАТЬСЯ" in text or field(text, "VERDICT") == "CONTINUE", text)
    ok("enforce no process restart", "RESTARTED=" not in text)

    reset_work()
    guard('begin --goal="create file" --done-when="wrote"')
    st = state()
    st["verified"] = ["wrote"]
    write_state(st)
    text = guard("enforce")
    ok("goal verified stops DONE/0", "EXITCODE=0" in text and field(text, "VERDICT") == "DONE", text)

    reset_work()
    cfg = json.loads((WORKDIR_L / "loop-guard.json").read_text(encoding="utf-8"))
    cfg["on_unjustified"] = "restart"
    (WORKDIR_L / "loop-guard.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    guard('begin --goal="fix pay"')
    text = guard('classify --type=stop-attempt --assistant="say fix"')
    ok("on_unjustified=restart still CONTINUE on empty done_when", field(text, "ACTION") == "CONTINUE" and "RESTARTED=" not in text, text)

    st = state()
    st["done_when"] = ["qr"]
    st["verified"] = []
    write_state(st)
    text = guard('classify --type=stop-attempt --assistant="hmm"')
    ok("no_reason never RESTART even if config restart", field(text, "ACTION") == "CONTINUE" and "RESTARTED=" not in text, text)

    st = state()
    st["restarts"] = 3
    st["done_when"] = ["x"]
    st["pid"] = 1
    write_state(st)
    text = guard("watchdog --sync")
    st = state()
    ok("restart limit not silent", field(text, "VERDICT") == "CONTINUE" or st.get("reason") == "restart_limit_continue", text)
    ok("restart limit not BLOCKED hang", field(text, "VERDICT") != "BLOCKED" and st.get("verdict") != "BLOCKED", text)

    reset_work()
    guard('begin --goal="fix file app.ts"')
    for i in range(5):
        guard(f'classify --type=stop-attempt --assistant="turn {i}"')
    st = state()
    log = (WORKDIR_L / "LOOPS.md").read_text(encoding="utf-8") if (WORKDIR_L / "LOOPS.md").exists() else ""
    ok("5 turns wrote loops=5", int(st.get("loops") or 0) == 5, json.dumps(st, ensure_ascii=False)[:200])
    ok("LOOPS.md has 5 classify lines", log.count("- classify ") == 5, log[:400])
    ok("state restarts still 0 after 5 text turns", int(st.get("restarts") or 0) == 0)

    # --- MUST STOP ---
    reset_work()
    guard('begin --goal="fix file app.ts" --done-when="fixed"')
    text = guard('classify --type=stop-attempt --user="stop" --assistant="still working"')
    ok("user stop -> STOP/DONE", field(text, "REASON") == "user_stop" and field(text, "VERDICT") == "DONE", text)
    ok("user stop no restart", "RESTARTED=" not in text)

    # Russian stop via UTF-8 state + on-user through driver
    (WORKDIR_L / "phrase.txt").write_text("остановись", encoding="utf-8")
    (WORKDIR_L / "stopuser.mjs").write_text(
        "import { spawnSync } from 'node:child_process';\n"
        "import fs from 'node:fs';\n"
        "const phrase = fs.readFileSync('phrase.txt','utf8').trim();\n"
        "const r = spawnSync(process.execPath, ['loop-guard.mjs','on-user', phrase], { encoding:'utf8' });\n"
        "fs.writeFileSync('out.txt', (r.stdout||'') + (r.stderr||'') + '\\nEXITCODE=' + (r.status??1));\n",
        encoding="utf-8",
    )
    write_bat("_stop.bat", [f"cd /d {WORKDIR_W}", f'"{NODE_W}" stopuser.mjs'])
    run_bat("_stop.bat")
    text = read_out()
    ok("остановись -> DONE", field(text, "VERDICT") == "DONE" and field(text, "REASON") == "user_stop", text)

    reset_work()
    guard('begin --goal="fix file app.ts" --done-when="fixed"')
    text = guard('classify --type=stop-attempt --observation="DENIED cwd=C:\\Windows" --assistant="cannot"')
    ok("DENIED -> STOP", field(text, "REASON") == "external_deny" and field(text, "VERDICT") == "DONE", text)

    reset_work()
    guard('begin --goal="fix file app.ts" --done-when="fixed"')
    st = state()
    st["loops"] = 256
    st["max_loops"] = 256
    write_state(st)
    text = guard('classify --type=stop-attempt --assistant="still working"')
    ok("max_loops -> BLOCKED", field(text, "VERDICT") == "BLOCKED" and field(text, "REASON") == "max_loops", text)

    # --- MUST RESTART only if process died ---
    reset_work()
    guard('begin --goal="fix file app.ts" --done-when="fixed"')
    text = guard('classify --type=process-check --alive=0 --assistant="still working"')
    ok("dead process -> RESTART", field(text, "ACTION") == "RESTART" and "process_died" in text, text)

    text = guard('classify --type=process-check --alive=1 --assistant="still working"')
    ok("alive process no RESTART", field(text, "ACTION") != "RESTART", text)

    reset_work()
    guard('begin --goal="fix file app.ts"')
    write_bat(
        "_err.bat",
        [
            f"cd /d {WORKDIR_W}",
            f'"{NODE_W}" loop-guard.mjs enforce > out.txt 2>&1',
            "if errorlevel 2 echo KEEP=2>> out.txt",
        ],
    )
    run_bat("_err.bat")
    text = read_out()
    ok("cmd.exe sees enforce exit 2", "KEEP=2" in text, text)

    write_bat(
        "_self.bat",
        [
            f"cd /d {WORKDIR_W}",
            f'"{NODE_W}" loop-guard.mjs selftest > out.txt 2>&1',
            "echo EXITCODE=%ERRORLEVEL%>> out.txt",
        ],
    )
    run_bat("_self.bat")
    text = read_out()
    ok("windows node selftest passed", "selftest passed" in text and "EXITCODE=0" in text, text[-500:])

    write_bat(
        "_check.bat",
        [
            f"cd /d {WORKDIR_W}",
            rf"set PATH={NODE_W.rsplit('\\', 1)[0]};%PATH%",
            "call check.bat > out.txt 2>&1",
        ],
    )
    run_bat("_check.bat")
    text = read_out()
    ok("check.bat RESULT OK on wine", "RESULT: OK" in text and "EXITCODE: 0" in text, text[-400:])

    print(f"windows-stop-continue {PASS} passed, {FAIL} failed")
    if FAIL:
        raise SystemExit(1)
    print("windows-stop-continue ok")


if __name__ == "__main__":
    main()
