#!/usr/bin/env python3
"""Wine (Windows cmd) check: coder does not stop when the goal is reached."""

from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT = Path("/workspace/.agent")
WINE = "wine"


def ok(name: str, cond: bool) -> None:
    if not cond:
        print("FAIL", name)
        raise SystemExit(1)
    print("ok  ", name)


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> subprocess.CompletedProcess[str]:
    merged = os.environ.copy()
    merged["WINEDEBUG"] = "-all"
    prefix = Path(os.environ.get("FEDOR_WINEPREFIX") or (Path.home() / ".wine-fedor-keep"))
    prefix.mkdir(parents=True, exist_ok=True)
    merged["WINEPREFIX"] = str(prefix)
    if env:
        merged.update(env)
    timeout = 180 if cmd[:2] == [WINE, "wineboot"] else 90
    return subprocess.run(cmd, cwd=str(cwd or ROOT), env=merged, text=True, capture_output=True, timeout=timeout)


def main() -> None:
    wine = run([WINE, "--version"])
    ok("wine present", wine.returncode == 0 and "wine" in (wine.stdout + wine.stderr).lower())
    print("     ", (wine.stdout or wine.stderr).strip())

    boot = run([WINE, "wineboot", "-u"])
    print("     wineboot", boot.returncode, ((boot.stdout or "") + (boot.stderr or "")).replace("\n", " | ")[:200])
    probed = run([WINE, "cmd", "/c", "echo WINE_CMD_OK"])
    out = (probed.stdout or "") + (probed.stderr or "")
    print("     wine cmd rc", probed.returncode, "out", out.replace("\n", " | ")[:240])
    ok("wine cmd.exe runs", probed.returncode == 0 and "WINE_CMD_OK" in out)

    # cmd.exe: read exit 2 with if errorlevel, not a bare %ERRORLEVEL% after &
    with tempfile.TemporaryDirectory(dir=str(Path.home())) as tmp:
        tdir = Path(tmp)
        (tdir / "rc2.bat").write_text(
            "@echo off\r\ncmd /c exit /b 2\r\nif errorlevel 2 echo RC=2\r\n",
            encoding="ascii",
        )
        wp = run([WINE, "winepath", "-w", str(tdir / "rc2.bat")])
        win_bat = (wp.stdout or "").strip() or ("Z:" + str(tdir / "rc2.bat").replace("/", "\\"))
        rc2 = run([WINE, "cmd", "/c", win_bat])
        rc_out = (rc2.stdout or "") + (rc2.stderr or "")
        print("     errorlevel bat", rc2.returncode, rc_out.replace("\n", " | ")[:240])
        ok("wine cmd sees exit 2", "RC=2" in rc_out)

    # Product loop: goal reached still nudges
    tsx = run(["npx", "tsx", "scripts/test-until-goal.ts"], cwd=ROOT)
    print(tsx.stdout)
    ok("until-goal tests", tsx.returncode == 0)
    ok("goal reached still going", "vk: real group_id still keeps going" in tsx.stdout)
    ok("user stop still works", "user stop is respected" in tsx.stdout)

    # loop-guard: goal verified must CONTINUE
    guard = run(["node", str(AGENT / "loop-guard.mjs"), "selftest"], cwd=AGENT)
    print(guard.stdout)
    ok("loop-guard selftest", guard.returncode == 0 and "цель достигнута -> CONTINUE" in guard.stdout)

    # enforce after a finished goal still exits 2 (keep going)
    gdir = Path("/tmp/fedor-guard-keep")
    gdir.mkdir(exist_ok=True)
    for name in ("loop-guard.mjs", "loop-guard.json"):
        src = AGENT / name
        dst = gdir / name
        dst.write_bytes(src.read_bytes())
    begin = run(
        ["node", str(gdir / "loop-guard.mjs"), "begin", "--goal=создай файл", "--done-when=wrote"],
        cwd=gdir,
    )
    ok("begin continue", begin.returncode == 0 and "VERDICT=CONTINUE" in begin.stdout)
    # mark goal verified in state
    import json

    state_path = gdir / "loop-guard.state.json"
    state = json.loads(state_path.read_text())
    state["verified"] = ["wrote"]
    state["done_when"] = ["wrote"]
    state_path.write_text(json.dumps(state), encoding="utf-8")
    enforce = run(["node", str(gdir / "loop-guard.mjs"), "enforce"], cwd=gdir)
    print(enforce.stdout)
    ok("enforce after goal is CONTINUE/2", enforce.returncode == 2 and "CONTINUE" in enforce.stdout)

    # Packed installer still has keep-going source
    bat_path = Path("/opt/cursor/artifacts/AA-Coder-Fedor-3.0-Free-Setup.bat")
    if not bat_path.exists():
        bat_path = Path("/workspace/AA-Coder-Fedor-3.0-Free-Setup.bat")
    raw = bat_path.read_text(encoding="utf-8", errors="replace")
    ok("free setup bat present", "GROK_APP_ZIP" in raw)

    print("windows-keep-going ok")


if __name__ == "__main__":
    main()
