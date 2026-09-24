#!/usr/bin/env python3
"""Replace installer UI and scripts inside existing Setup.bat files. Keep the packed app zip."""

from __future__ import annotations

import base64
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
BATS = [
    REPO / "AA-Coder-Fedor-3.0-Setup.bat",
    REPO / "AA-Coder-Fedor-3.0-Free-Setup.bat",
    ROOT / "dist" / "AA-Coder-Fedor-3.0-Setup.bat",
    ROOT / "dist" / "AA-Coder-Fedor-3.0-Free-Setup.bat",
]


def with_baked_key(data: bytes) -> bytes:
    key = (
        __import__("os").environ.get("DEEPSEEK_API_KEY")
        or __import__("os").environ.get("GROK_API_KEY")
        or ""
    ).strip()
    text = data.decode("utf-8")
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


def patch_zip(zip_bytes: bytes) -> bytes:
    src = zipfile.ZipFile(BytesIO(zip_bytes))
    out_buf = BytesIO()
    with zipfile.ZipFile(out_buf, "w", compression=zipfile.ZIP_DEFLATED) as dest:
        for info in src.infolist():
            data = src.read(info.filename)
            if info.filename.replace("\\", "/") == "scripts/start-grok-coder.ps1":
                data = with_baked_key(START.read_bytes())
            dest.writestr(info, data)
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
        raw = replace_section(raw, "GROK_APP_ZIP", patch_zip(zip_bytes))
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
