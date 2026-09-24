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
    "lib/crew/run.ts": ROOT / "lib" / "crew" / "run.ts",
    "lib/commerce/store.ts": ROOT / "lib" / "commerce" / "store.ts",
    "lib/commerce/token-sync.ts": ROOT / "lib" / "commerce" / "token-sync.ts",
    "app/api/hub/route.ts": ROOT / "app" / "api" / "hub" / "route.ts",
    "app/api/chat/route.ts": ROOT / "app" / "api" / "chat" / "route.ts",
}
NEXT_OVERRIDE = Path(os.environ.get("FEDOR_NEXT_OVERRIDE") or ROOT / ".next")


SKIP_NEXT_PARTS = {"cache", "types", "diagnostics"}
SKIP_NEXT_NAMES = {"trace", "trace-build"}


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
        dest.writestr(rel, path.read_bytes())
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
            dest.writestr(info, data)
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


def patch_bat(path: Path) -> None:
    raw = path.read_text(encoding="utf-8", errors="replace")
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
