#!/usr/bin/env python3
"""Replace installer UI and scripts inside existing Setup.bat files. Keep the packed app zip."""

from __future__ import annotations

import base64
import os
import re
import subprocess
import zipfile
from io import BytesIO
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
HTA_TS = ROOT / "lib" / "installer-hta.ts"
BOOT = ROOT / "scripts" / "fedor-setup-boot.ps1"
INSTALL = ROOT / "scripts" / "grok-coder-install.ps1"
START = ROOT / "scripts" / "start-grok-coder.ps1"
ELECTRON_MAIN = ROOT / "electron" / "main.cjs"
BATS = [
    REPO / "AA-Coder-Fedor-3.0-Setup.bat",
    REPO / "AA-Coder-Fedor-3.0-Free-Setup.bat",
    ROOT / "dist" / "AA-Coder-Fedor-3.0-Setup.bat",
    ROOT / "dist" / "AA-Coder-Fedor-3.0-Free-Setup.bat",
    Path("/opt/cursor/artifacts/AA-Coder-Fedor-3.0-Setup.bat"),
    Path("/opt/cursor/artifacts/AA-Coder-Fedor-3.0-Free-Setup.bat"),
]
OLD_KEYS = ("sk-375f3f562e7f4b4684fee292c4818151",)


def baked_key() -> str:
    return (
        __import__("os").environ.get("DEEPSEEK_API_KEY")
        or __import__("os").environ.get("GROK_API_KEY")
        or ""
    ).strip()


def with_baked_key(data: bytes) -> bytes:
    key = baked_key()
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        blob = data
        if key:
            for old in OLD_KEYS:
                blob = blob.replace(old.encode("ascii"), key.encode("ascii"))
        return blob
    for old in OLD_KEYS:
        text = text.replace(old, key or "")
    if key:
        text = text.replace("__FEDOR_DEEPSEEK_KEY__", key)
    return text.encode("utf-8")


def wrap_b64(data: bytes, width: int = 120) -> str:
    b64 = base64.b64encode(data).decode("ascii")
    return "\n".join(b64[i : i + width] for i in range(0, len(b64), width))


def hta_html() -> bytes:
    proc = subprocess.run(
        ["npx", "tsx", "-e", "import { installerHtaHtml } from './lib/installer-hta.ts'; process.stdout.write(installerHtaHtml())"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return proc.stdout.replace("\n", "\r\n").encode("utf-8")


def section_bytes(raw: str, name: str, names: list[str]) -> bytes | None:
    tok = f"-----{name}-----"
    i = raw.rfind(tok)
    if i < 0:
        return None
    frm = i + len(tok)
    end = len(raw)
    for other in names:
        if other == name:
            continue
        j = raw.find(f"-----{other}-----", frm)
        if j >= 0 and j < end:
            end = j
    b64 = re.sub(r"[^A-Za-z0-9+/=]", "", raw[frm:end])
    if len(b64) < 8:
        return None
    return base64.b64decode(b64)


def replace_section(raw: str, name: str, payload: bytes) -> str:
    tok = f"-----{name}-----"
    i = raw.rfind(tok)
    if i < 0:
        raise SystemExit(f"missing {name}")
    frm = i + len(tok)
    # keep following marker
    nxt = len(raw)
    for m in re.finditer(r"\n-----([A-Z0-9_.-]+)-----", raw[frm:]):
        nxt = frm + m.start() + 1
        break
    block = f"{tok}\n{wrap_b64(payload)}\n"
    return raw[:i] + block + raw[nxt:]


INJECT = {
    "lib/ngp/enabled.ts": ROOT / "lib" / "ngp" / "enabled.ts",
    "lib/ngp/values.ts": ROOT / "lib" / "ngp" / "values.ts",
    "lib/ngp/extract.ts": ROOT / "lib" / "ngp" / "extract.ts",
    "lib/ngp/prompt.ts": ROOT / "lib" / "ngp" / "prompt.ts",
    "lib/ngp/store.ts": ROOT / "lib" / "ngp" / "store.ts",
    "lib/ngp/index.ts": ROOT / "lib" / "ngp" / "index.ts",
    "lib/prompt.ts": ROOT / "lib" / "prompt.ts",
    "lib/fyodor/handle.ts": ROOT / "lib" / "fyodor" / "handle.ts",
    "lib/fyodor/until-goal.ts": ROOT / "lib" / "fyodor" / "until-goal.ts",
    "lib/crew/run.ts": ROOT / "lib" / "crew" / "run.ts",
    "lib/crew/graph.ts": ROOT / "lib" / "crew" / "graph.ts",
    "lib/commerce/store.ts": ROOT / "lib" / "commerce" / "store.ts",
    "lib/commerce/token-sync.ts": ROOT / "lib" / "commerce" / "token-sync.ts",
    "app/api/hub/route.ts": ROOT / "app" / "api" / "hub" / "route.ts",
    "app/api/chat/route.ts": ROOT / "app" / "api" / "chat" / "route.ts",
}
NEXT_OVERRIDE = Path(os.environ.get("FEDOR_NEXT_OVERRIDE") or ROOT / ".next")


SKIP_NEXT_PARTS = {"cache", "types", "diagnostics"}
SKIP_NEXT_NAMES = {"trace", "trace-build"}


def patch_keep_going_chunk(data: bytes) -> bytes:
    """Packed Next runs this chunk, not the TS sources. Keep 1-2 moves from ending a live job."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "FEDOR_KEEP_GOING" in text:
        return data
    start = text.find(
        'if((0,bE.cP)(a.userText)||(0,bE.tq)(a.userText)||(0,bE.ZI)(a.userText)||a.usedTools.some(a=>b4.test(String(a||"")))){let d,e;return'
    )
    end = text.find("}return!!(0,bE.O2)(a.userText)&&(", start) if start >= 0 else -1
    if start < 0 or end < 0 or "страница открыта" not in text[start:end]:
        if "страница открыта" in text:
            raise SystemExit("keep-going chunk marker missing")
        return data
    live_new = (
        'if((0,bE.cP)(a.userText)||(0,bE.tq)(a.userText)||(0,bE.ZI)(a.userText)'
        '||a.usedTools.some(a=>b4.test(String(a||"")))){/*FEDOR_KEEP_GOING*/'
        'let workMoves=a.usedTools.filter(t=>String(t||"").trim()&&!b5.test(String(t||""))).length;'
        'if(b7(a.userText)||/(сообществ|групп|паблик|oauth|access_token|заполн|отправ|войди|авториз|зарегистри|опублик)/i.test(a.userText)){'
        'if(workMoves<3)return!0;let d,e;return b=a.userText,c=a.content,d=String(b||""),'
        '!(!(!(e=String(c||"")).trim()||bz(e)||(0,bE.e5)(e)||(0,bE.dE)(e)||(0,bE.GC)(e)||b6(e)'
        '||/(не сработал|не открыл|не появил|не отрисов|не могу|пришлите|вставь(те)? токен|посмотрите|напишите|что видно|окно не|модалка не|не нашёл|не нашел|жду вас)/i.test(e))'
        '&&(/(сообществ|групп|паблик|\\bвк\\b|вконтакте|\\bvk\\.(com|ru)\\b)/i.test(d)&&b7(d)'
        '?/["\']?group_id["\']?\\s*[:=]\\s*\\d+|vk\\.(com|ru)\\/(club|public)\\d+|сообщество создано|создал сообществ|"type"\\s*:\\s*"(group|page|event)"/i.test(e)'
        ':/(токен|oauth|access_token)/i.test(d)&&!/(сообществ|групп|паблик)/i.test(d)'
        '?/access_token:|TOKEN_READY|токен получен|vk1\\.a\\./i.test(e)'
        ':/(сохранил|отправил|создано\\b|файл записан|clicked and saved|вошёл|вошел|зарегистрирован|опубликован)/i.test(e)))}'
        'if(workMoves<1)return!0;}'
        'if((0,bE.O2)(a.userText)&&((0,bE.BP)(a.userText)||(0,bE.cP)(a.userText))'
        '&&a.usedTools.filter(t=>String(t||"").trim()&&!b5.test(String(t||""))).length<3'
        '&&!/(текстов|заметк|\\.txt\\b|\\.bat\\b|бат|на рабоч|блокнот)/i.test(a.userText)'
        '&&!((0,bE.KW)(a.userText)&&!(0,bE.BP)(a.userText)))return!0;'
    )
    text = text[:start] + live_new + text[end + 1 :]
    if "Один-два хода" not in text:
        text = text.replace(
            "Стоп. Ты описал шаг словами вместо вызова инструмента.",
            "Стоп. Ты описал шаг словами вместо вызова инструмента. Один-два хода и слово «готово» — не конец.",
            1,
        )
    return text.encode("utf-8")


def maybe_patch_packed(rel: str, data: bytes) -> bytes:
    norm = rel.replace("\\", "/")
    if norm.endswith("server/chunks/690.js"):
        return patch_keep_going_chunk(data)
    return data


def inject_tree(dest: zipfile.ZipFile, written: set[str], root: Path, prefix: str) -> int:
    count = 0
    if not root.exists():
        return 0
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        rel_parts = path.relative_to(root).parts
        if any(part in SKIP_NEXT_PARTS for part in rel_parts):
            continue
        if path.name in SKIP_NEXT_NAMES:
            continue
        rel = f"{prefix}/{path.relative_to(root).as_posix()}"
        dest.writestr(rel, maybe_patch_packed(rel, path.read_bytes()))
        written.add(rel)
        count += 1
    return count


def patch_zip(zip_bytes: bytes, sku: str = "paid") -> bytes:
    src = zipfile.ZipFile(BytesIO(zip_bytes))
    out_buf = BytesIO()
    inject = {rel: path.read_bytes() for rel, path in INJECT.items() if path.exists()}
    replace_next = NEXT_OVERRIDE.is_dir() and (NEXT_OVERRIDE / "BUILD_ID").exists()
    written: set[str] = set()
    with zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as dest:
        for info in src.infolist():
            rel = info.filename.replace("\\", "/")
            if replace_next and (rel == ".next" or rel.startswith(".next/")):
                continue
            if rel in inject:
                dest.writestr(info, with_baked_key(inject[rel]))
                written.add(rel)
                continue
            data = src.read(info.filename)
            if rel == "scripts/start-grok-coder.ps1":
                data = with_baked_key(START.read_bytes())
            elif rel == "electron/main.cjs" and ELECTRON_MAIN.exists():
                data = with_baked_key(ELECTRON_MAIN.read_bytes())
            else:
                data = with_baked_key(data)
            dest.writestr(info, maybe_patch_packed(rel, data))
            written.add(rel)
        for rel, data in inject.items():
            if rel in written:
                continue
            dest.writestr(rel, with_baked_key(data))
            written.add(rel)
        if replace_next:
            inject_tree(dest, written, NEXT_OVERRIDE, ".next")
            dest.writestr(".next/FEDOR_SKU", f"{sku}\n".encode("utf-8"))
            written.add(".next/FEDOR_SKU")
    return out_buf.getvalue()


BOOT_EXTRACT_OLD = "[IO.File]::WriteAllBytes($p,[Convert]::FromBase64String($b64))"
BOOT_EXTRACT_NEW = (
    "$bytes=[Convert]::FromBase64String($b64); "
    "$utf8=New-Object System.Text.UTF8Encoding $false; "
    "$text=$utf8.GetString($bytes); "
    "if($text.Length -gt 0 -and [int][char]$text[0] -eq 65279){$text=$text.Substring(1)}; "
    "$uni=New-Object System.Text.UnicodeEncoding $false,$true; "
    "[IO.File]::WriteAllText($p,$text,$uni)"
)


def patch_boot_extract(raw: str) -> str:
    if BOOT_EXTRACT_NEW in raw:
        return raw
    if BOOT_EXTRACT_OLD not in raw:
        raise SystemExit("boot extract command missing")
    return raw.replace(BOOT_EXTRACT_OLD, BOOT_EXTRACT_NEW, 1)


AD_DIR = ROOT / "electron" / "ads"
AD_FILES = [
    "ad-code.jpg",
    "ad-both.jpg",
    "ad-parallel.jpg",
    "ad-memory.jpg",
    "ad-agents.jpg",
    "ad-sbp.jpg",
    "ad-crew.jpg",
    "ad-free.jpg",
]


def ensure_ads() -> None:
    missing = [name for name in AD_FILES if not (AD_DIR / name).exists()]
    if not missing:
        return
    subprocess.run(["python3", str(ROOT / "scripts" / "generate-ads.py")], cwd=ROOT, check=True)
    still = [name for name in AD_FILES if not (AD_DIR / name).exists()]
    if still:
        raise SystemExit(f"ads still missing: {still}")


def insert_ad_sections(raw: str) -> str:
    raw = re.sub(r"\n-----GROK_AD_[A-Za-z0-9_.-]+-----\n(?:[A-Za-z0-9+/=\r\n]+)", "\n", raw)
    blocks: list[str] = []
    for name in AD_FILES:
        path = AD_DIR / name
        if not path.exists():
            raise SystemExit(f"missing ad image {path}")
        blocks.append(f"-----GROK_AD_{name}-----\n{wrap_b64(path.read_bytes())}\n")
    tok = "-----GROK_INSTALL_PS1-----"
    i = raw.rfind(tok)
    if i < 0:
        raise SystemExit("missing GROK_INSTALL_PS1")
    return raw[:i] + "".join(blocks) + raw[i:]


def patch_bat(path: Path) -> None:
    raw = path.read_text(encoding="utf-8", errors="replace")
    raw = patch_boot_extract(raw)
    names = [
        "GROK_BOOT",
        "GROK_HTA",
        "GROK_INSTALL_PS1",
        "GROK_APP_ZIP",
        "GROK_END",
    ]
    zip_bytes = section_bytes(raw, "GROK_APP_ZIP", names)
    raw = replace_section(raw, "GROK_BOOT", BOOT.read_bytes())
    raw = replace_section(raw, "GROK_HTA", hta_html())
    ensure_ads()
    raw = insert_ad_sections(raw)
    raw = replace_section(raw, "GROK_INSTALL_PS1", with_baked_key(INSTALL.read_bytes()))
    if zip_bytes and zip_bytes[:2] == b"PK":
        sku = "free" if "Free" in path.name else "paid"
        raw = replace_section(raw, "GROK_APP_ZIP", patch_zip(zip_bytes, sku))
    path.write_text(raw, encoding="utf-8", newline="\n")
    print(f"patched {path} ({path.stat().st_size} bytes)")


def main() -> None:
    found = False
    for path in BATS:
        if path.exists():
            patch_bat(path)
            found = True
    if not found:
        raise SystemExit("no Setup.bat files found")


if __name__ == "__main__":
    main()
