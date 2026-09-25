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
    "lib/brand.ts": ROOT / "lib" / "brand.ts",
    "lib/prompt.ts": ROOT / "lib" / "prompt.ts",
    "lib/fyodor/handle.ts": ROOT / "lib" / "fyodor" / "handle.ts",
    "lib/fyodor/until-goal.ts": ROOT / "lib" / "fyodor" / "until-goal.ts",
    "lib/crew/run.ts": ROOT / "lib" / "crew" / "run.ts",
    "lib/crew/graph.ts": ROOT / "lib" / "crew" / "graph.ts",
    "lib/commerce/store.ts": ROOT / "lib" / "commerce" / "store.ts",
    "lib/commerce/token-sync.ts": ROOT / "lib" / "commerce" / "token-sync.ts",
    "lib/commerce/hub-dir.ts": ROOT / "lib" / "commerce" / "hub-dir.ts",
    "lib/theme.ts": ROOT / "lib" / "theme.ts",
    "app/layout.tsx": ROOT / "app" / "layout.tsx",
    "app/globals.css": ROOT / "app" / "globals.css",
    "app/hub/page.tsx": ROOT / "app" / "hub" / "page.tsx",
    "public/fedor-theme.css": ROOT / "public" / "fedor-theme.css",
    "components/theme-provider.tsx": ROOT / "components" / "theme-provider.tsx",
    "instrumentation.ts": ROOT / "instrumentation.ts",
    "app/api/hub/route.ts": ROOT / "app" / "api" / "hub" / "route.ts",
    "app/api/chat/route.ts": ROOT / "app" / "api" / "chat" / "route.ts",
    "lib/heavy-file.ts": ROOT / "lib" / "heavy-file.ts",
    "lib/host-fs.ts": ROOT / "lib" / "host-fs.ts",
    "lib/super-memory.ts": ROOT / "lib" / "super-memory.ts",
    "lib/build-harness.ts": ROOT / "lib" / "build-harness.ts",
    "lib/click-kit.ts": ROOT / "lib" / "click-kit.ts",
    "lib/click-outcome.ts": ROOT / "lib" / "click-outcome.ts",
    "lib/browser.ts": ROOT / "lib" / "browser.ts",
    "lib/tools.ts": ROOT / "lib" / "tools.ts",
    "lib/reflexion.ts": ROOT / "lib" / "reflexion.ts",
    "coder-v2/src/hub.cjs": ROOT / "coder-v2" / "src" / "hub.cjs",
    "lib/commerce/plans.ts": ROOT / "lib" / "commerce" / "plans.ts",
    "lib/commerce/pay-config.ts": ROOT / "lib" / "commerce" / "pay-config.ts",
    "lib/commerce/yookassa-shop.ts": ROOT / "lib" / "commerce" / "yookassa-shop.ts",
    "lib/commerce/store.ts": ROOT / "lib" / "commerce" / "store.ts",
    "lib/commerce/verify-pay.ts": ROOT / "lib" / "commerce" / "verify-pay.ts",
    "lib/pay-gate.ts": ROOT / "lib" / "pay-gate.ts",
    "app/pay/page.tsx": ROOT / "app" / "pay" / "page.tsx",
    "components/pay-app.tsx": ROOT / "components" / "pay-app.tsx",
    "components/pay-settings.tsx": ROOT / "components" / "pay-settings.tsx",
    "coder-v2/src/agent/goal-brain.mjs": ROOT / "coder-v2" / "src" / "agent" / "goal-brain.mjs",
    "coder-v2/src/agent/loop-guard.mjs": ROOT / "coder-v2" / "src" / "agent" / "loop-guard.mjs",
    ".agent/goal-brain.mjs": REPO / ".agent" / "goal-brain.mjs",
    ".agent/loop-guard.mjs": REPO / ".agent" / "loop-guard.mjs",
    ".agent/loop-guard.json": REPO / ".agent" / "loop-guard.json",
    ".agent/resume-goal.mjs": REPO / ".agent" / "resume-goal.mjs",
    "lib/loop-guard-hook.ts": ROOT / "lib" / "loop-guard-hook.ts",
    ".agent/check.bat": REPO / ".agent" / "check.bat",
    ".agent/check-guard.bat": REPO / ".agent" / "check-guard.bat",
    "lib/installer-hta.ts": ROOT / "lib" / "installer-hta.ts",
    "components/coder-app.tsx": ROOT / "components" / "coder-app.tsx",
    "components/work-dock.tsx": ROOT / "components" / "work-dock.tsx",
    "components/grok-mark.tsx": ROOT / "components" / "grok-mark.tsx",
    "lib/live-status.ts": ROOT / "lib" / "live-status.ts",
    "lib/types.ts": ROOT / "lib" / "types.ts",
    "app/api/sku/route.ts": ROOT / "app" / "api" / "sku" / "route.ts",
}
NEXT_OVERRIDE = Path(os.environ.get("FEDOR_NEXT_OVERRIDE") or ROOT / ".next")


SKIP_NEXT_PARTS = {"cache", "types", "diagnostics"}
SKIP_NEXT_NAMES = {"trace", "trace-build"}


def patch_guard_cycle_chunk(data: bytes) -> bytes:
    """Call loop-guard from the packed crew loop: begin on task, classify before stop."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "FEDOR_GUARD_CYCLE" in text:
        return data
    begin_old = 'let v=a.jobId?.trim()||void 0;if((0,bE.pS)(a.userText))'
    begin_new = (
        'let v=a.jobId?.trim()||void 0;/*FEDOR_GUARD_CYCLE*/'
        'try{var _fs=require("fs"),_p=require("path"),_cp=require("child_process"),'
        '_gd=_p.join(process.env.GROK_WORKSPACE||process.cwd(),".agent"),_gb=_p.join(_gd,"loop-guard.mjs");'
        'if(_fs.existsSync(_gb)){_cp.spawnSync(process.execPath,[_gb,(0,bE.pS)(a.userText)?"on-user":"begin",'
        '(0,bE.pS)(a.userText)?String(a.userText||""):"--goal="+String(a.userText||"").slice(0,500),"--dir="+_gd],'
        '{encoding:"utf8",timeout:8e3,windowsHide:!0,env:Object.assign({},process.env,{LOOP_GUARD_NO_LAUNCH:"1"})});'
        '_cp.spawnSync(process.execPath,[_gb,"heartbeat","--pid="+process.pid,"--dir="+_gd],'
        '{encoding:"utf8",timeout:8e3,windowsHide:!0})}}catch(_z){}'
        'if((0,bE.pS)(a.userText))'
    )
    if begin_old in text:
        text = text.replace(begin_old, begin_new, 1)
    stop_old = (
        'note:"Цель не закрыта — продолжаю, без остановки на плане."});continue}break}'
    )
    stop_new = (
        'note:"Цель не закрыта — продолжаю, без остановки на плане."});continue}'
        '/*FEDOR_GUARD_CYCLE*/if(a.tools&&a.userGoal){try{var _fs2=require("fs"),_p2=require("path"),_cp2=require("child_process"),'
        '_gd2=_p2.join(process.env.GROK_WORKSPACE||process.cwd(),".agent"),_gb2=_p2.join(_gd2,"loop-guard.mjs");'
        'if(_fs2.existsSync(_gb2)){var _out=_cp2.spawnSync(process.execPath,[_gb2,"classify","--type=stop-attempt",'
        '"--assistant="+String(h||"").slice(0,400),"--user="+String(a.userGoal||"").slice(0,400),"--detach","--dir="+_gd2],'
        '{encoding:"utf8",timeout:8e3,windowsHide:!0,env:Object.assign({},process.env,{LOOP_GUARD_NO_LAUNCH:"1"})});'
        'var _txt=String((_out.stdout||"")+(_out.stderr||""));'
        'if(/VERDICT=CONTINUE|ACTION=RESTART|НЕ ОСТАНАВЛИВАТЬСЯ/.test(_txt)||_out.status===2){'
        'k+=1,c.push({role:"assistant",content:b||""}),c.push({role:"user",content:b_}),'
        'a.send("crew",{role:a.streamThought||"coder",label:bF[a.streamThought||"coder"],status:"running",'
        'note:"Цель не закрыта — делаю следующий шаг."});continue}}}'
        'catch(_z2){}}'
        'break}'
    )
    if stop_old in text:
        text = text.replace(stop_old, stop_new, 1)
    return text.encode("utf-8")


def patch_keep_going_chunk(data: bytes) -> bytes:
    """Packed Next runs this chunk, not the TS sources. Keep 1-2 moves from ending a live job."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "FEDOR_NEVER_STOP_ON_GOAL" in text:
        return text.encode("utf-8") if isinstance(text, str) else data
    if "FEDOR_KEEP_GOING" in text:
        text = text.replace(
            "/*FEDOR_KEEP_GOING*/",
            "/*FEDOR_KEEP_GOING*//*FEDOR_NEVER_STOP_ON_GOAL*/"
            "if((0,bE.O2)(a.userText)||(0,bE.cP)(a.userText)||(0,bE.tq)(a.userText)||(0,bE.ZI)(a.userText)"
            "||a.usedTools.some(t=>b4.test(String(t||\"\"))))return!0;",
            1,
        )
        return text.encode("utf-8")
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
        '||a.usedTools.some(a=>b4.test(String(a||"")))){/*FEDOR_KEEP_GOING*//*FEDOR_NEVER_STOP_ON_GOAL*/'
        'if((0,bE.O2)(a.userText)||(0,bE.cP)(a.userText)||(0,bE.tq)(a.userText)||(0,bE.ZI)(a.userText)'
        '||a.usedTools.some(t=>b4.test(String(t||""))))return!0;'
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


CHAT_METER_OLD = 'if(!d.j5&&!(0,n.pS)(r?.content||""))'
CHAT_METER_NEW = (
    'if(!d.j5&&!function(){try{var fs=require("fs"),p=require("path"),c=process.env.FEDOR_APP_ROOT||process.cwd(),'
    'e=String(process.env.FEDOR_SKU||process.env.FEDOR_FREE||process.env.FEDOR_EDITION||"").trim().toLowerCase();'
    'if(e==="free"||e==="1"||e==="true")return!0;'
    'for(var f of[p.join(c,".fedor-sku"),p.join(c,".next","FEDOR_SKU"),p.join(c,".fedor-install-ok")]){'
    'if(fs.existsSync(f)&&/^\\s*free\\s*$/im.test(fs.readFileSync(f,"utf8")))return!0}}catch(x){}return!1}()'
    '&&!(0,n.pS)(r?.content||""))'
)


def patch_chat_free_sku(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "Лимит тарифа" not in text or CHAT_METER_OLD not in text:
        return data
    if "FEDOR_APP_ROOT||process.cwd()" in text:
        return data
    return text.replace(CHAT_METER_OLD, CHAT_METER_NEW, 1).encode("utf-8")


def patch_click_chunk(data: bytes) -> bytes:
    """Prefer cdp-js, skip dead cdp-mouse, never download Chrome for Testing."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "FEDOR_CLICK_JS_FIRST" in text:
        return data
    old_av = (
        "function av(){let a=at(),b=[...a.kits].filter(a=>a.installed&&a.kept)"
        ".sort((a,b)=>b.wins-b.losses-(a.wins-a.losses)||b.wins-a.wins).map(a=>a.id);"
        "for(let c of a.preferred)if(!b.includes(c))continue;return b.length?b:am.map(a=>a.id)}"
    )
    new_av = (
        "function av(){/*FEDOR_CLICK_JS_FIRST*/let a=at(),b=[...a.kits].filter(a=>a.installed&&a.kept"
        '&&"cdp-mouse"!==a.id&&"playwright-chromium"!==a.id&&!(a.wins<=0&&a.losses>=3))'
        '.sort((a,b)=>("cdp-js"===a.id?-1:"cdp-js"===b.id?1:b.wins-b.losses-(a.wins-a.losses)||b.wins-a.wins))'
        '.map(a=>a.id);if(!b.includes("cdp-js"))b.unshift("cdp-js");return b.length?b:["cdp-js"]}'
    )
    if old_av in text:
        text = text.replace(old_av, new_av, 1)
    old_loss = "e.losses+=1,e.lastError=String(c||\"\").slice(0,240),e.kept=!0"
    new_loss = (
        "e.losses+=1,e.lastError=String(c||\"\").slice(0,240),"
        'e.kept=!("cdp-mouse"===a||"playwright-chromium"===a)||e.wins>0'
    )
    if old_loss in text:
        text = text.replace(old_loss, new_loss, 1)
    old_pw = (
        'if("playwright-chromium"===a){let a=(0,aa.spawnSync)("npx",["--yes","playwright","install","chromium"],'
        '{cwd:process.cwd(),encoding:"utf8",timeout:18e4,windowsHide:!0,shell:"win32"===process.platform})'
    )
    # replace the whole playwright-chromium installer block with a refusal
    start = text.find('if("playwright-chromium"===a){')
    if start >= 0 and "Chrome for Testing не качаю" not in text:
        end = text.find('return{ok:!0,message:"скачал Chromium для Playwright"}', start)
        if end >= 0:
            end = text.find("}", end)
            text = (
                text[:start]
                + 'if("playwright-chromium"===a)return{ok:!1,message:"Chrome for Testing не качаю — использую системный Edge/Chrome. Рабочий набор: cdp-js."}'
                + text[end + 1 :]
            )
    text = text.replace(
        "может скачать puppeteer-core / Chromium.",
        "рабочий набор cdp-js. Chrome for Testing не качаю.",
    )
    return text.encode("utf-8")


def patch_harness_chunk(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "FEDOR_HARNESS_LINT" in text:
        return data
    old_safe = 'bi=["make","npm-test","changelog","cache","version"]'
    new_safe = 'bi=["make","npm-test","lint","changelog","cache","version"]/*FEDOR_HARNESS_LINT*/'
    if old_safe in text:
        text = text.replace(old_safe, new_safe, 1)
    old_lint = 'else if("lint"===a)g("package.json",!1);'
    new_lint = (
        'else if("lint"===a)g("package.json",function(a){let b=n().join(a,"package.json"),c=bm(a);'
        "if(!c||c.scripts&&c.scripts.lint)return!1;"
        'let d={...c,scripts:{...(c.scripts||{}),lint:"node --check package.json"}};'
        "(0,l.writeFileSync)(b,`${JSON.stringify(d,null,2)}\\n`,\"utf8\");return!0}(c));"
    )
    if old_lint in text:
        text = text.replace(old_lint, new_lint, 1)
    old_ensure = "if(!function(a){if(bl(a)||(0,l.existsSync)(n().join(a,\"package.json\"))"
    # drop `||c.check` so lint/changelog still apply when npm-test already exists
    text = text.replace("||c.check)return{wrote:[],report:c}", ")return{wrote:[],report:c}", 1)
    return text.encode("utf-8")


def patch_heavy_read_chunk(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "FEDOR_HEAVY_READ" in text:
        return data
    old = (
        "let f=(0,l.fp)(e.subarray(0,524288).toString(\"utf8\")).split(\"\\n\"),"
        "h=Math.max(1,b??1),i=c??f.length,j=f.slice(h-1,h-1+i),k=X(d);"
        "return j.map((a,b)=>`${h+b}|${a}`).join(\"\\n\")+`\n[${k}]`}"
    )
    # tolerate the actual newline in the compiled source
    marker = "let f=(0,l.fp)(e.subarray(0,524288).toString(\"utf8\")).split(\"\\n\")"
    start = text.find(marker)
    if start < 0:
        marker = "let f=(0,l.fp)(e.subarray(0,524288).toString(\"utf8\")).split(\"\\n\")"
        start = text.find('let f=(0,l.fp)(e.subarray(0,524288)')
    if start < 0:
        return data
    end = text.find("async function af(", start)
    if end < 0:
        return data
    helper = r"""let f=(0,l.fp)(e.subarray(0,524288).toString("utf8")),k=X(d);/*FEDOR_HEAVY_READ*/return(function(filePath,text,offset,limit){var lines=String(text||"").split(/\n/),start=Math.max(1,offset??1),maxLine=0,i=0;for(;i<lines.length;i++)if(lines[i].length>maxLine)maxLine=lines[i].length;var bytes=Buffer.byteLength(text,"utf8"),heavy=bytes>=20480||lines.length>=140||maxLine>=240,clip=function(s){return s.length<=180?s:s.slice(0,180)+"… [ещё "+(s.length-180)+" символов, полный в Super Memory]"};var want=limit&&limit>0&&limit<=80?limit:heavy?40:limit??lines.length,slice=lines.slice(start-1,start-1+want);try{var os=require("os"),path=require("path"),fs=require("fs"),crypto=require("crypto"),root=process.env.GROK_MEMORY_DIR?path.resolve(process.env.GROK_MEMORY_DIR):"win32"===process.platform?path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),"AppData","Local"),"Fedor2","memory"):path.join(os.homedir(),".fedor2","memory"),dir=path.join(root,"files");fs.mkdirSync(dir,{recursive:!0});var key=crypto.createHash("sha1").update(String(filePath).replace(/\\/g,"/").toLowerCase()).digest("hex").slice(0,16),chunks=[],buf=[],chars=0,from=1,flush=function(to){buf.length&&(chunks.push({i:chunks.length+1,from:from,to:to,text:buf.join("\n").slice(0,1100)}),buf=[],chars=0,from=to+1)};lines.forEach(function(line,idx){var n=idx+1,piece=n+"|"+clip(line);chars+piece.length>1100&&buf.length&&flush(n-1);buf.push(piece);chars+=piece.length+1});flush(lines.length);var rec={path:filePath,bytes:bytes,lines:lines.length,maxLine:maxLine,updatedAt:Date.now(),chunks:chunks.slice(0,48)};if(heavy||maxLine>180){fs.writeFileSync(path.join(dir,key+".json"),JSON.stringify(rec)+"\n");try{var stateFile=path.join(root,"state.json"),state;try{state=JSON.parse(fs.readFileSync(stateFile,"utf8"))}catch(z){state={enabled:!0,facts:[],skills:[],fingerprints:[],dismissed:[]}}state.facts=Array.isArray(state.facts)?state.facts:[];var fact="файл "+filePath+": "+rec.lines+" строк, "+rec.bytes+" байт, самая длинная линия "+rec.maxLine+". Полный текст в Super Memory — memory_recall(\"файл "+path.basename(filePath)+"\") или grep.",found=state.facts.find(function(x){return String(x.text||"").startsWith("файл "+filePath+":")});found?(found.text=fact,found.hits=(found.hits||1)+1,found.updatedAt=rec.updatedAt):state.facts.unshift({id:"file_"+key,text:fact,hits:1,updatedAt:rec.updatedAt});rec.chunks.slice(0,6).forEach(function(ch){var t=("файл "+filePath+" часть "+ch.i+"/"+rec.chunks.length+" строки "+ch.from+"-"+ch.to+": "+ch.text).slice(0,1180),id="file_"+key+"_"+ch.i,prev=state.facts.find(function(x){return x.id===id});prev?(prev.text=t,prev.updatedAt=rec.updatedAt):state.facts.push({id:id,text:t,hits:1,updatedAt:rec.updatedAt})});state.facts=state.facts.slice(0,80);state.updatedAt=rec.updatedAt;fs.mkdirSync(root,{recursive:!0});fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+"\n")}catch(z){}}}catch(z){}var body=slice.map(function(line,i){return start+i+"|"+clip(line)}).join("\n");if(heavy){var more=Math.max(0,lines.length-(start-1+slice.length));return"файл "+filePath+" — тяжёлый ("+bytes+" байт, "+lines.length+" строк, макс. линия "+maxLine+").\nПолный текст положил в Super Memory. Не читай его целиком снова.\nДальше: grep или memory_recall(\"файл "+String(filePath).split(/[\\/]/).pop()+"\").\n"+body+(more?"\n… ещё "+more+" строк в Super Memory":"")+"\n["+filePath+"]"}return body+(maxLine>180?"\nдлинные линии укоротил, полный текст в Super Memory":"")+"\n["+filePath+"]"})(k,f,b,c)}"""
    text = text[:start] + helper + text[end:]
    return text.encode("utf-8")


HOD_REASON_BLOCK = (
    '(0,a.jsxs)("section",{className:"mb-3",children:['
    '(0,a.jsx)("div",{className:"text-[10px] tracking-wide text-[#8a7ab8] uppercase",children:"Рассуждения агентов"}),'
    'r.length?(0,a.jsx)("ol",{className:"mt-1 space-y-2",children:r.slice(-12).map((e,t)=>(0,a.jsxs)("li",'
    '{className:"rounded-md bg-black/30 px-2 py-1.5",children:['
    '(0,a.jsxs)("div",{className:"text-[12px] text-white",children:[e.label||e.role,'
    '(0,a.jsx)("span",{className:"ml-2 text-[10px] uppercase text-[#8a8aa0]",'
    'children:"running"===e.status?"думает":"handoff"===e.status?"передал":"сказал"})]}),'
    '(0,a.jsx)("p",{className:"mt-0.5 whitespace-pre-wrap text-[13px] leading-5 text-[#e8e8f0]",'
    'children:e.note&&e.note.trim()||("running"===e.status?"рассуждение ещё не пришло":"молчит — текста нет")})'
    ']},`${e.role}-${t}-${e.status}`))}):(0,a.jsx)("p",{className:"mt-1 text-[12px] leading-5 text-[#6a6a72]",'
    'children:e?"трест ещё не высказался":"рассуждений нет — агенты молчат"})]}),'
    '(0,a.jsxs)("section",{className:"mb-3",children:['
    '(0,a.jsx)("div",{className:"text-[10px] tracking-wide text-[#8a7ab8] uppercase",children:"Что делают"}),'
    'i.filter(e=>"running"===e.status).length?(0,a.jsx)("ul",{className:"mt-1 space-y-1 font-mono text-[11px] leading-5 text-[#e8dcff]",'
    'children:i.filter(e=>"running"===e.status).map(e=>(0,a.jsx)("li",{children:"▶ "+ea(e)},e.id))})'
    ':(0,a.jsx)("p",{className:"mt-1 text-[12px] leading-5 text-[#6a6a72]",'
    'children:e?"инструмент сейчас не вызван":"ничего не делают"})]}),'
)


def patch_ui_copy(data: bytes, sku: str = "paid") -> bytes:
    """Pay pitch is RU card + SBP + crypto. Work pane is «Ход» with agent reasoning."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    changed = False
    if "ЮMoney" in text or "SuperGrok" in text or "Тариф Free" in text:
        text = text.replace(
            "ЮMoney \\xb7 СБП \\xb7 USDT / BTC / TON. Реквизиты — в \\xabПриём оплаты\\xbb. Проверка по факту платежа.",
            "Оплата российской картой, СБП и криптовалютой. Реквизиты — в \\xabПриём оплаты\\xbb.",
        )
        text = text.replace(
            "ЮMoney · СБП · USDT / BTC / TON. Реквизиты — в «Приём оплаты». Проверка по факту платежа.",
            "Оплата российской картой, СБП и криптовалютой. Реквизиты — в «Приём оплаты».",
        )
        text = text.replace("ЮMoney / ЮKassa и крипта.", "Российская карта, СБП и крипта.")
        text = text.replace("Тариф Free", "Пробный")
        text = text.replace("на Free — как у Grok", "на пробном тарифе")
        text = text.replace("Тарифы как у Grok", "Тарифы Fedor 3.0")
        text = text.replace("SuperGrok Lite", "Fedor Lite")
        text = text.replace("SuperGrok Plus", "Fedor Plus")
        text = text.replace("SuperGrok Heavy", "Fedor Heavy")
        text = text.replace("SuperGrok", "Fedor")
        text = text.replace('children:"ЮMoney"', 'children:"Карта"')
        text = text.replace("Оплата: ЮMoney и крипта", "Оплата российской картой, СБП и криптой")
        changed = True
    hod_btn = (
        ',(0,a.jsx)(M.$,{size:"xs",variant:"ghost",className:"shrink-0 text-[#9d9d9d]",onClick:ae,children:"Ход"})'
    )
    if 'children:"Ход"' not in text and "sm:inline-flex" in text and "Settings" in text:
        needle = ',(0,a.jsx)(M.$,{size:"xs",variant:"ghost",className:"hidden text-[#9d9d9d] sm:inline-flex"'
        if needle in text and hod_btn not in text:
            text = text.replace(needle, hod_btn + needle, 1)
            changed = True
    chip = (
        '!L.j5&&(0,a.jsx)(M.$,{size:"xs",variant:"ghost",className:"hidden max-w-[14rem] truncate text-[#b8d4ff] sm:inline-flex"'
    )
    if chip in text:
        text = text.replace(chip, 'false&&(0,a.jsx)(M.$,{size:"xs",variant:"ghost",className:"hidden max-w-[14rem] truncate text-[#b8d4ff] sm:inline-flex"', 1)
        changed = True
    if sku == "free" and "L.j5" in text and "Бесплатный Fedor 3.0" in text:
        text = text.replace("L.j5", "!0")
        changed = True
    if 'catch{r=""}let n=s??' in text and "s7();let n=s??" not in text:
        text = text.replace('catch{r=""}let n=s??', 'catch{r=""}s7();let n=s??', 1)
        changed = True
    old_note = 'function ei(e){let t=ee(e.note||"",80);return!t||es(t)?"":/(читаю|пишу|гоняю|тест|записал|переключаюсь|правлю)/i.test(t)?t:""}'
    new_note = 'function ei(e){let t=ee(e.note||"",140);return!t||es(t)?"":t}'
    if old_note in text:
        text = text.replace(old_note, new_note, 1)
        changed = True
    if ':"ещё не открыл файл и не запустил команду"}' in text:
        text = text.replace(
            ':"ещё не открыл файл и не запустил команду"}',
            ':"агенты ничего не делают"}',
            1,
        )
        changed = True
    if 'children:e?"идёт сейчас":"простой"}' in text:
        text = text.replace(
            'children:e?"идёт сейчас":"простой"}',
            'children:e?"агенты работают":"агенты ничего не делают"}',
            1,
        )
        changed = True
    scroll = '(0,a.jsxs)("div",{className:"min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 py-2",children:[u.length?'
    if "Рассуждения агентов" not in text and scroll in text:
        text = text.replace(scroll, scroll.replace("children:[u.length?", "children:[" + HOD_REASON_BLOCK + "u.length?"), 1)
        changed = True
    if "FEDOR_HOD_BACK" not in text and ("Экран" in text or "Ход" in text or "идёт сейчас" in text):
        text = text.replace('"aria-label":"Экран"', '"aria-label":"Ход работы"')
        text = text.replace('label:"Экран"', 'label:"Ход"')
        text = text.replace('children:"Экран"', 'children:"Ход работы"')
        text = text.replace(',"Экран"]', ',"Ход"]')
        if "/*FEDOR_HOD_BACK*/" not in text:
            text = "/*FEDOR_HOD_BACK*/" + text
        changed = True
    return text.encode("utf-8") if changed else data


def patch_token_broadcast_chunk(data: bytes) -> bytes:
    """One PC must not write the same spend (often the 20000 window) onto every user."""
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    repls = [
        (
            "e=c.filter(c=>!a.userId||c===a.userId||c===b.deviceId),h=e.length?e:a.userId?[a.userId]:c",
            "e=c.filter(c=>c===(a.userId||b.userId)||c===b.deviceId),h=e",
        ),
        (
            "l=r.filter(t=>!e.userId||t===e.userId||t===i.deviceId),o=l.length?l:e.userId?[e.userId]:r",
            "l=r.filter(t=>t===(e.userId||i.userId)||t===i.deviceId),o=l",
        ),
        (
            "a.userId&&b.id===a.userId||a.email&&b.email===A(String(a.email))||a.deviceLabel&&b.deviceLabel&&b.deviceLabel===a.deviceLabel",
            "a.userId&&b.id===a.userId||a.email&&b.email===A(String(a.email))",
        ),
        (
            "g?.userId&&a.id===g.userId||g?.email&&a.email===g.email||g?.deviceLabel&&a.deviceLabel===g.deviceLabel",
            "g?.userId&&a.id===g.userId||g?.email&&a.email===g.email",
        ),
        (
            "function I(a){return Math.max(0,Number(a.lifetimeTokens||0),Number(a.usedInWeek||0)+Number(a.usedInFreeWindow||0))}",
            "function I(a){let b=Math.max(0,Number(a.lifetimeTokens||0));return b>0?b:Math.max(0,Number(a.usedInWeek||0))+Math.max(0,Number(a.usedInFreeWindow||0))}",
        ),
    ]
    changed = False
    for old, new in repls:
        if old in text:
            text = text.replace(old, new)
            changed = True
    return text.encode("utf-8") if changed else data


def patch_hub_dir_chunk(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "Fedor2" in text and "win32" in text and ".fedor-hub" in text:
        return data
    old = 'n.default.join(i.default.homedir(),".fedor-hub")'
    if old not in text:
        old = 'n.default.join(i.default.homedir(),".fedor-hub")'
    if 'homedir(),".fedor-hub")' not in text and "homedir(),'.fedor-hub')" not in text:
        return data
    new = (
        '(function(){var e=process.env.FEDOR_HUB_DIR&&process.env.FEDOR_HUB_DIR.trim();'
        'if(e)return n.default.resolve(e);'
        'if("win32"===process.platform){var a=process.env.LOCALAPPDATA||n.default.join(i.default.homedir(),"AppData","Local");'
        'return n.default.join(a,"Fedor2","hub")}'
        'return n.default.join(i.default.homedir(),".fedor-hub")})()'
    )
    text = text.replace('n.default.join(i.default.homedir(),".fedor-hub")', new)
    text = text.replace("n.default.join(i.default.homedir(),'.fedor-hub')", new)
    return text.encode("utf-8")


def patch_ask_poll_chunk(data: bytes) -> bytes:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data
    if "FEDOR_ASK_POLL" in text:
        return data
    old = "s(),setInterval(s,36e5)"
    if old not in text:
        return data
    new = (
        "s(),setInterval(s,36e5);/*FEDOR_ASK_POLL*/"
        "setInterval(function(){try{s()}catch(z){}},3e3)"
    )
    return text.replace(old, new, 1).encode("utf-8")


def maybe_patch_packed(rel: str, data: bytes, sku: str = "paid") -> bytes:
    norm = rel.replace("\\", "/")
    if norm.endswith("server/chunks/690.js"):
        data = patch_keep_going_chunk(data)
        data = patch_guard_cycle_chunk(data)
        data = patch_click_chunk(data)
        data = patch_harness_chunk(data)
    if norm.endswith("server/chunks/432.js"):
        data = patch_heavy_read_chunk(data)
    if norm.endswith("server/app/api/chat/route.js"):
        data = patch_chat_free_sku(data)
    if "/static/chunks/" in norm and norm.endswith(".js"):
        data = patch_ui_copy(data, sku)
    if "pay/page" in norm and norm.endswith(".js"):
        data = patch_ui_copy(data, sku)
    if norm.endswith(".js"):
        data = patch_hub_dir_chunk(data)
        data = patch_ask_poll_chunk(data)
        data = patch_token_broadcast_chunk(data)
    return data


def inject_tree(dest: zipfile.ZipFile, written: set[str], root: Path, prefix: str, sku: str = "paid") -> int:
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
        dest.writestr(rel, maybe_patch_packed(rel, path.read_bytes(), sku))
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
            if rel in {".fedor-sku", ".next/FEDOR_SKU"}:
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
            dest.writestr(info, maybe_patch_packed(rel, data, sku))
            written.add(rel)
        for rel, data in inject.items():
            if rel in written:
                continue
            dest.writestr(rel, with_baked_key(data))
            written.add(rel)
        if replace_next:
            inject_tree(dest, written, NEXT_OVERRIDE, ".next", sku)
        dest.writestr(".fedor-sku", f"{sku}\n".encode("utf-8"))
        dest.writestr(".next/FEDOR_SKU", f"{sku}\n".encode("utf-8"))
        written.add(".fedor-sku")
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
