#!/usr/bin/env python3
"""Emulate the Windows Setup.bat install and check what the shortcut would open."""

from __future__ import annotations

import base64
import json
import re
import zipfile
from io import BytesIO
from pathlib import Path

BAT = Path("/workspace/AA-Coder-Fedor-3.0-Setup.bat")
OLD = "sk-375f3f562e7f4b4684fee292c4818151"
NEW = "sk-82c5e888a40945a5a2f21d314226ad5a"
NAMES = ["GROK_BOOT", "GROK_HTA", "GROK_INSTALL_PS1", "GROK_APP_ZIP", "GROK_END"]


def section(raw: str, name: str) -> bytes:
    tok = f"-----{name}-----"
    i = raw.rfind(tok)
    if i < 0:
        raise SystemExit(f"missing {name}")
    frm = i + len(tok)
    end = len(raw)
    for other in NAMES:
        if other == name:
            continue
        j = raw.find(f"-----{other}-----", frm)
        if 0 <= j < end:
            end = j
    return base64.b64decode(re.sub(r"[^A-Za-z0-9+/=]", "", raw[frm:end]))


def ok(name: str, cond: bool) -> None:
    if not cond:
        print("FAIL", name)
        raise SystemExit(1)
    print("ok  ", name)


def main() -> None:
    ok("setup bat exists", BAT.exists())
    raw = BAT.read_text(encoding="utf-8", errors="replace")
    hta = section(raw, "GROK_HTA").decode("utf-8", "replace")
    install = section(raw, "GROK_INSTALL_PS1").decode("utf-8", "replace")
    boot = section(raw, "GROK_BOOT").decode("utf-8", "replace")
    zbytes = section(raw, "GROK_APP_ZIP")
    ok("hta is progress only", "Ставлю кодер" in hta and "ЮMoney" not in hta and "ad-sbp" not in hta)
    ok("hta is not cards page", "Platyna" not in hta and "Fyatu" not in hta)
    ok("boot does not unpack ads", "AdFiles" not in boot and "ad-sbp" not in boot)
    ok("install skips public desktop", "CommonDesktopDirectory" not in install)
    ok("install writes shortcut before start", install.split("Write-Host '[4/5]")[1].find("Write-InstallLaunchers") < install.split("Write-Host '[4/5]")[1].find("& $starter"))
    ok("old deepseek key gone from bat text", OLD not in raw)
    zf = zipfile.ZipFile(BytesIO(zbytes))
    page = zf.read("app/page.tsx").decode("utf-8")
    main_js = zf.read("electron/main.cjs").decode("utf-8")
    start = zf.read("scripts/start-grok-coder.ps1").decode("utf-8")
    ok("home page is coder, not cards", "CoderApp" in page and "Platyna" not in page)
    ok("electron refuses foreign pay page", "looksLikeForeignPayPage" in main_js)
    ok("electron checks /api/config is fedor", "/api/config" in main_js)
    ok("old key gone from zip main", OLD not in main_js)
    ok("old key gone from zip start", OLD not in start)
    ok("new key baked in install or zip", NEW in install or NEW in main_js or NEW in start)
    ok("shortcut starts electron with working dir and dot", 'start "" /D "' in install and "electron.exe" in install and '" .' in install)
    out = Path("/tmp/fedor-win-emul")
    if out.exists():
        import shutil

        shutil.rmtree(out)
    out.mkdir()
    zf.extractall(out)
    ok("extracted package.json", (out / "package.json").exists())
    ok("extracted coder-app", (out / "components" / "coder-app.tsx").exists() or any(out.rglob("coder-app.tsx")))
    ok("extracted .next build", (out / ".next" / "BUILD_ID").exists())
    prompt = zf.read("lib/prompt.ts").decode("utf-8", "replace")
    handle = zf.read("lib/fyodor/handle.ts").decode("utf-8", "replace")
    ok("common ngp sources in zip", "lib/ngp/index.ts" in zf.namelist() and "lib/ngp/store.ts" in zf.namelist())
    ok("prompt keeps Super Memory and adds ngp", "getMemoryPromptBlock()" in prompt and "getNgpPromptBlock(task)" in prompt)
    ok("handle keeps Super Memory and adds ngp", "getMemoryPromptBlock()" in handle and "observeNgpUserText" in handle)
    ok("skill ledger stays", "getSkillPromptBlock" in prompt and "click_kit" in prompt)
    packed = b"".join(zf.read(name) for name in zf.namelist() if name.replace("\\", "/").startswith(".next/server/chunks/") and name.endswith(".js"))
    ok("packed build has common ngp", b"<ngp>" in packed and b"does NOT replace Super Memory" in packed)
    ok("packed memory is on by default", b"ON by default" in packed)
    ok("start sets FEDOR_NGP on", "FEDOR_NGP" in start and "Value '1'" in start)
    ok("electron sets FEDOR_NGP on", "FEDOR_NGP" in main_js and 'process.env.FEDOR_NGP = "1"' in main_js)
    print("emulation ok")
    print(json.dumps({"app": str(out), "shortcut": "AA Coder Fedor 3.0 -> electron.exe .", "home": "CoderApp"}, ensure_ascii=False))


if __name__ == "__main__":
    main()
