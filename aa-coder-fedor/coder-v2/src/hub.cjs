"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { desktopDir, loadState, saveState, portFor, profileDir } = require("./config.cjs");
const { listEngines, pickEngine, spawnBrowser, doctorText } = require("./engines.cjs");
const {
  sleep,
  probe,
  waitForPort,
  listTargets,
  pickTab,
  newTarget,
  connectTab,
  evaluate,
} = require("./cdp.cjs");
const { mousePath, typePlan, clickHoldMs, betweenActionMs } = require("./human.cjs");
const pc = require("./pc.cjs");

const MENU = [
  { id: "1", title: "Диагностика браузеров", command: "doctor" },
  { id: "2", title: "Подключить Edge", command: "doctor", args: ["edge"] },
  { id: "3", title: "Подключить Chrome", command: "doctor", args: ["chrome"] },
  { id: "4", title: "Список вкладок", command: "tabs" },
  { id: "5", title: "Открыть MAX", command: "open", args: ["https://max.ru"] },
  { id: "6", title: "Скриншот вкладки", command: "screenshot", args: ["tab"] },
  { id: "7", title: "Скриншот экрана", command: "screenshot", args: ["screen"] },
  { id: "8", title: "Запуск программы", command: "launch", args: ["notepad"] },
];

const SNAPSHOT_JS = `(() => {
  const nodes = [];
  const seen = new Set();
  const sel = 'a,button,input,textarea,select,summary,option,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="checkbox"],[role="option"],[role="listbox"],[role="menu"],[role="menubar"],[role="dialog"],[role="alertdialog"],[role="combobox"],[role="listitem"],[role="treeitem"],[role="gridcell"],[role="switch"],[role="radio"],[aria-haspopup],[aria-expanded="true"],[onclick],[data-testid],label';
  const overlaySel = '[role="listbox"],[role="menu"],[role="dialog"],[role="alertdialog"],[role="combobox"],[aria-expanded="true"],[popover],:popover-open,[class*="dropdown"],[class*="overlay"],[class*="popover"],[class*="modal"],[class*="lang"],[class*="country"]';
  const pushEl = (el, force) => {
    if (!el || seen.has(el)) return;
    const r = el.getBoundingClientRect();
    const inOverlay = el.closest(overlaySel);
    if (!force && !inOverlay && (r.width < 2 || r.height < 2)) return;
    if (!force && !inOverlay && (r.bottom < -40 || r.right < -40 || r.top > innerHeight + 40 || r.left > innerWidth + 40)) return;
    const name = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || el.getAttribute('data-value') || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    if (!name && !inOverlay && !force) return;
    seen.add(el);
    nodes.push({
      ref: 'e' + (nodes.length + 1),
      role: (el.getAttribute('role') || el.tagName.toLowerCase()),
      name: name || (inOverlay ? '(оверлей)' : ''),
      href: el.href || '',
      x: Math.round(r.x + r.width / 2),
      y: Math.round(r.y + r.height / 2),
      overlay: Boolean(inOverlay),
    });
  };
  document.querySelectorAll(sel).forEach((el) => pushEl(el, false));
  document.querySelectorAll(overlaySel).forEach((box) => {
    pushEl(box, true);
    box.querySelectorAll('a,button,li,span,div,p,option,[role="option"],[role="menuitem"]').forEach((el) => {
      const t = (el.innerText || '').replace(/\\s+/g, ' ').trim();
      if (t && t.length <= 80) pushEl(el, true);
    });
  });
  const text = (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 1800);
  const overlays = [...document.querySelectorAll(overlaySel)].slice(0, 8).map((el) => String(el.getAttribute('role') || el.className || el.tagName).slice(0, 40));
  return { url: location.href, hash: location.hash || '', title: document.title, text, overlays, nodes: nodes.slice(0, 160) };
})()`;

const CLICKABLE_SEL = 'a,button,input,textarea,select,summary,option,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="checkbox"],[role="option"],[role="listbox"],[role="menu"],[role="menubar"],[role="dialog"],[role="alertdialog"],[role="combobox"],[role="listitem"],[role="treeitem"],[onclick],[data-testid],label';

function FIND_JS(query) {
  return `(() => {
  const q = ${JSON.stringify(query)};
  const ql = String(q || '').replace(/^\\[/, '').replace(/\\]$/, '').toLowerCase();
  const sel = ${JSON.stringify(CLICKABLE_SEL)};
  const all = [...document.querySelectorAll(sel)];
  document.querySelectorAll('[data-fedor-hit]').forEach((el) => el.removeAttribute('data-fedor-hit'));
  let hitEl = null;
  const refHit = ql.match(/^e(\\d+)$/);
  if (refHit) {
    const idx = Number(refHit[1]) - 1;
    if (all[idx]) hitEl = all[idx];
  }
  if (!hitEl) {
    const score = (el) => {
      const blob = ((el.innerText || '') + ' ' + (el.value || '') + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.placeholder || '') + ' ' + (el.title || '')).toLowerCase();
      if (blob === ql) return 3;
      if (blob.includes(ql)) return 2;
      return 0;
    };
    const ranked = all.map((el) => ({ el, s: score(el) })).filter((x) => x.s).sort((a, b) => b.s - a.s)[0];
    if (ranked) hitEl = ranked.el;
  }
  if (!hitEl) {
    const walker = [...document.querySelectorAll('div,span,p,li,h1,h2,h3')];
    const ranked = walker.map((el) => ({ el, s: (el.innerText || '').trim().toLowerCase().includes(ql) ? 1 : 0 })).filter((x) => x.s)[0];
    if (ranked) hitEl = ranked.el;
  }
  if (!hitEl) return null;
  hitEl.setAttribute('data-fedor-hit', '1');
  hitEl.scrollIntoView({ block: 'center', inline: 'center' });
  const r = hitEl.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), name: (hitEl.innerText || hitEl.value || '').trim().slice(0, 80), tag: hitEl.tagName };
})()`;
}

function CLICK_JS(query) {
  return `(() => {
  const q = ${JSON.stringify(query)};
  const ql = String(q || '').replace(/^\\[/, '').replace(/\\]$/, '').toLowerCase();
  const sel = ${JSON.stringify(CLICKABLE_SEL)};
  const all = [...document.querySelectorAll(sel)];
  document.querySelectorAll('[data-fedor-hit]').forEach((node) => node.removeAttribute('data-fedor-hit'));
  let el = null;
  const refHit = ql.match(/^e(\\d+)$/);
  if (refHit) {
    const idx = Number(refHit[1]) - 1;
    if (all[idx]) el = all[idx];
  }
  if (!el) {
    const score = (node) => {
      const blob = ((node.innerText || '') + ' ' + (node.value || '') + ' ' + (node.getAttribute('aria-label') || '') + ' ' + (node.placeholder || '') + ' ' + (node.title || '')).toLowerCase();
      if (blob === ql) return 3;
      if (blob.includes(ql)) return 2;
      return 0;
    };
    const ranked = all.map((node) => ({ node, s: score(node) })).filter((x) => x.s).sort((a, b) => b.s - a.s)[0];
    if (ranked) el = ranked.node;
  }
  if (!el) return { ok: false, reason: 'not found' };
  el.setAttribute('data-fedor-hit', '1');
  el.scrollIntoView({ block: 'center', inline: 'center' });
  try { el.focus({ preventScroll: true }); } catch (e) {}
  const r = el.getBoundingClientRect();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, buttons: 1 };
  for (const type of ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
    try {
      const Ctor = type.startsWith('pointer') && typeof PointerEvent === 'function' ? PointerEvent : MouseEvent;
      el.dispatchEvent(new Ctor(type, opts));
    } catch (e) {}
  }
  try { if (typeof el.click === 'function') el.click(); } catch (e) {}
  return { ok: true, tag: el.tagName, name: (el.innerText || el.value || '').trim().slice(0, 80), x: Math.round(x), y: Math.round(y) };
})()`;
}

function looksLikeHumanCheck(title, text, url) {
  const blob = `${title}\n${text}\n${url}`.toLowerCase();
  return (
    blob.includes("captcha") ||
    blob.includes("recaptcha") ||
    blob.includes("hcaptcha") ||
    blob.includes("verify you are human") ||
    blob.includes("checking if the site connection is secure") ||
    (blob.includes("подтв") && blob.includes("робот"))
  );
}

function formatTabs(tabs) {
  if (!tabs.length) return "вкладок нет";
  return tabs
    .map((tab, i) => `${i + 1}. ${tab.title || "(без названия)"}  ${tab.url || ""}${tab.id ? `  [${String(tab.id).slice(0, 8)}]` : ""}`)
    .join("\n");
}

function tokenFromHash(hash, url) {
  const src = `${hash || ""} ${url || ""}`;
  const hit = src.match(/access_token=([^&\s#]+)/i);
  return hit ? hit[1] : "";
}

function formatSnapshot(snap) {
  const href = String(snap.url || "");
  const hash = String(snap.hash || (href.includes("#") ? href.slice(href.indexOf("#")) : "") || "");
  const token = tokenFromHash(hash, href);
  const lines = [
    `url: ${href}`,
    hash ? `hash: ${hash}` : "hash: (none)",
  ];
  if (token) {
    lines.push(`access_token: ${token}`);
    lines.push("TOKEN_READY: full token is on the access_token line. Use it in the next API call this turn. Do not ask the user to paste it. Do not say it is truncated.");
  }
  lines.push(
    `title: ${snap.title}`,
    "элементы:",
    ...(snap.nodes || []).map((node) => `- [${node.ref}] ${node.role} "${node.name}" @${node.x},${node.y}${node.overlay ? " overlay" : ""}`),
  );
  if (snap.overlays && snap.overlays.length) {
    lines.push(`оверлеи: ${snap.overlays.join(", ")}`);
  }
  lines.push("текст:", snap.text || "(пусто)");
  if (looksLikeHumanCheck(snap.title, snap.text, snap.url)) {
    lines.push("", "HUMAN CHECK: капча. Не решать. Попросите человека в открытом окне.");
  }
  return lines.join("\n");
}

function stripSnapUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/#.*$/, "");
}

function clickOutcomeAdvice(target, snap0, snap) {
  const url0 = stripSnapUrl(snap0 && snap0.url);
  const url1 = stripSnapUrl(snap && snap.url);
  if (url0 && url1 && url0 !== url1) return "";
  const t0 = String((snap0 && snap0.title) || "");
  const t1 = String((snap && snap.title) || "");
  if (t0 && t1 && t0 !== t1) return "";
  const prev = new Set(
    (snap0 && snap0.nodes ? snap0.nodes : [])
      .map((node) => String(node.name || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const opened = (snap && snap.nodes ? snap.nodes : [])
    .map((node) => String(node.name || "").trim())
    .filter((name) => name && !prev.has(name.toLowerCase()));
  const label = String(target || "кнопка").trim();
  if (opened.length) {
    return [
      `клик «${label}» прошёл, URL тот же. Раскрылось меню: ${opened.slice(0, 10).join(", ")}.`,
      "Это аккордеон, не ссылка. Не вызывай click_kit и не кликай ту же кнопку снова.",
      "Жми появившийся пункт (Магазин / Интеграция / API) или browser_press Enter.",
    ].join(" ");
  }
  return [
    `клик «${label}» прошёл, страница не сменилась (${(snap && snap.url) || "тот же URL"}).`,
    "Это меню или кнопка без перехода, не сломанный клик. Не вызывай click_kit.",
    "Смени тактику: browser_press Enter, соседний пункт, или snapshot и другой ref.",
  ].join(" ");
}

async function ensureBrowser(engineId) {
  const engine = pickEngine(engineId);
  let live = await probe(engine.port);
  if (!live.ok) {
    spawnBrowser(engine);
    live = await waitForPort(engine.port, 25000);
  }
  saveState({ engine: engine.id, port: engine.port, profile: profileDir(engine.id) });
  return { engine, live };
}

async function withPage(fn, tabQuery) {
  const state = loadState();
  const engine = pickEngine(state.engine);
  let live = await probe(engine.port);
  if (!live.ok) {
    const ensured = await ensureBrowser(engine.id);
    live = ensured.live;
  }
  let tabs = live.tabs?.length ? live.tabs : await listTargets(engine.port);
  let tab = pickTab(tabs, tabQuery || state.tabQuery);
  if (!tab) {
    await newTarget(engine.port, "about:blank");
    await sleep(300);
    tabs = await listTargets(engine.port);
    tab = pickTab(tabs);
  }
  if (!tab) throw new Error("Нет вкладок. Сначала: coder2 open <url> или откройте MAX в debug-окне.");
  const client = await connectTab(tab);
  try {
    const result = await fn(client, tab, tabs, engine);
    return result;
  } finally {
    await client.close();
  }
}

async function humanMoveClick(client, x, y, button = "left", count = 1) {
  const from = loadState().cursor || { x: 40, y: 40 };
  const pathPoints = mousePath(from, { x, y });
  for (const point of pathPoints) {
    await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await sleep(8);
  }
  const hold = clickHoldMs();
  for (let n = 0; n < count; n++) {
    await client.send("Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button,
      buttons: 1,
      clickCount: n + 1,
    });
    await sleep(hold);
    await client.send("Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button,
      buttons: 0,
      clickCount: n + 1,
    });
    if (n + 1 < count) await sleep(90);
  }
  saveState({ cursor: { x, y } });
  await sleep(betweenActionMs());
}

async function resolveClickPoint(client, target) {
  const raw = String(target || "").trim();
  if (!raw) throw new Error("click: нужен текст, ref (e3) или x,y");
  const xy = raw.match(/^(\d+)\s*,\s*(\d+)$/);
  if (xy) return { x: Number(xy[1]), y: Number(xy[2]), name: "coords" };
  const refs = loadState().lastRefs || {};
  const key = raw.replace(/^\[/, "").replace(/\]$/, "");
  if (refs[key]) return { x: refs[key].x, y: refs[key].y, name: refs[key].name || key };
  const found = await evaluate(client, FIND_JS(raw));
  if (!found) throw new Error(`Не нашёл на странице: ${raw}`);
  return found;
}

async function snapshotNow(client, tab) {
  let snap = (await evaluate(client, SNAPSHOT_JS)) || { url: tab.url, title: tab.title, nodes: [], text: "", hash: "" };
  const loc = await evaluate(client, "({ href: String(location.href||''), hash: String(location.hash||'') })").catch(() => null);
  if (loc && typeof loc === "object") {
    if (loc.href) snap.url = loc.href;
    if (loc.hash) snap.hash = loc.hash;
  } else if (!String(snap.url || "").includes("#")) {
    const href = await evaluate(client, "location.href").catch(() => "");
    if (href) {
      snap.url = href;
      snap.hash = String(href).includes("#") ? String(href).slice(String(href).indexOf("#")) : snap.hash || "";
    }
  }
  if (!snap.hash && String(snap.url || "").includes("#")) {
    snap.hash = String(snap.url).slice(String(snap.url).indexOf("#"));
  }
  const refs = {};
  for (const node of snap.nodes || []) refs[node.ref] = node;
  saveState({ lastRefs: refs, lastUrl: snap.url, lastTitle: snap.title, tabQuery: tab.id });
  return snap;
}

async function cmdDoctor(engineId) {
  if (engineId) pickEngine(engineId);
  const engines = listEngines();
  const chosen = pickEngine(engineId);
  let live = await probe(chosen.port);
  if (!live.ok) {
    spawnBrowser(chosen);
    live = await waitForPort(chosen.port, 25000);
  }
  const text = doctorText(engines, live.ok ? { browser: live.browser, webSocketDebuggerUrl: live.info?.webSocketDebuggerUrl } : null);
  return {
    ok: true,
    engine: chosen.id,
    port: chosen.port,
    attached: live.ok,
    profile: profileDir(chosen.id),
    tabs: (live.tabs || []).map((tab) => ({ id: tab.id, title: tab.title, url: tab.url })),
    message: text,
  };
}

async function cmdTabs(query) {
  const { engine } = await ensureBrowser();
  const tabs = await listTargets(engine.port);
  if (query) {
    const tab = pickTab(tabs, query);
    if (!tab) return { ok: false, message: `вкладка не найдена: ${query}\n${formatTabs(tabs)}` };
    saveState({ tabQuery: tab.id });
    const client = await connectTab(tab);
    try {
      await client.send("Page.bringToFront").catch(() => undefined);
    } finally {
      await client.close();
    }
    return { ok: true, current: { id: tab.id, title: tab.title, url: tab.url }, tabs, message: `активна: ${tab.title}\n${formatTabs(tabs)}` };
  }
  return { ok: true, tabs: tabs.map((tab) => ({ id: tab.id, title: tab.title, url: tab.url })), message: formatTabs(tabs) };
}

async function cmdOpen(url, engineId) {
  const target = String(url || "").trim();
  if (!/^https?:\/\//i.test(target) && target !== "about:blank") {
    return { ok: false, message: "url must start with http:// or https://" };
  }
  const { engine } = await ensureBrowser(engineId);
  const tabs = await listTargets(engine.port);
  const exact = tabs.find(
    (tab) => tab.url === target || tab.url === `${target}/` || tab.url === target.replace(/\/$/, ""),
  );
  if (exact) {
    saveState({ tabQuery: exact.id });
    await withPage(async (client) => {
      await client.send("Page.bringToFront").catch(() => undefined);
    }, exact.id);
    const snap = await cmdSnapshot(exact.id);
    return { ok: true, reused: true, message: `уже открыто, переключился\n${snap.message}` };
  }
  const created = await newTarget(engine.port, target);
  await sleep(900);
  const tabs2 = await listTargets(engine.port);
  const opened =
    pickTab(tabs2, created.id || created.targetId) ||
    tabs2.find((tab) => String(tab.url || "").startsWith(target.replace(/\/$/, ""))) ||
    tabs2[0];
  if (!opened) throw new Error("Вкладка не создалась");
  saveState({ tabQuery: opened.id });
  const snap = await cmdSnapshot(opened.id);
  return { ok: true, message: snap.message, url: target, engine: engine.id };
}

async function cmdSnapshot(query) {
  return await withPage(async (client, tab) => {
    const snap = await snapshotNow(client, tab);
    return { ok: true, ...snap, message: formatSnapshot(snap) };
  }, query);
}

async function cmdClick(target, kind) {
  return await withPage(async (client, tab) => {
    const snap0 = await snapshotNow(client, tab);
    if (looksLikeHumanCheck(snap0.title, snap0.text, snap0.url)) {
      return { ok: false, message: "HUMAN CHECK: капча. Не кликаю. Завершите в открытом окне." };
    }
    const state = loadState();
    const key = String(target || "").trim().replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
    if (state.lastAccordion && state.lastClickKey && state.lastClickKey === key) {
      return {
        ok: true,
        tactic: true,
        kit: "cdp-js",
        message: [
          `Тот же ref «${target}» — это аккордеон, не сломанный клик.`,
          "Не вызывай click_kit и не жми ту же кнопку снова.",
          "Жми появившийся пункт по тексту или browser_press Enter.",
          formatSnapshot(snap0),
        ].join(" "),
      };
    }
    const point = await resolveClickPoint(client, target);
    const button = kind === "right" ? "right" : "left";
    const count = kind === "dbl" ? 2 : 1;
    const used = [];
    let js = null;
    try {
      js = await evaluate(client, CLICK_JS(target));
    } catch {
      js = null;
    }
    if (js && js.ok) used.push("cdp-js");
    else used.push("cdp-js-miss");
    if (kind === "dbl" || kind === "right") {
      await humanMoveClick(client, point.x, point.y, button, count);
      used.push("cdp-mouse");
    } else if (!js || !js.ok) {
      try {
        js = await evaluate(client, CLICK_JS((js && js.name) || target));
      } catch {
        js = js || null;
      }
      if (js && js.ok && !used.includes("cdp-js")) used.push("cdp-js");
    }
    await sleep(400);
    const snap = await snapshotNow(client, tab);
    const how = used.join(" + ");
    const advice = clickOutcomeAdvice(target, snap0, snap);
    const head = `клик «${(js && js.name) || point.name || target}» @${point.x},${point.y} [${how}]`;
    saveState({ lastClickKey: key, lastAccordion: Boolean(advice) });
    return {
      ok: true,
      clicked: point,
      kit: js && js.ok ? "cdp-js" : used.includes("cdp-mouse") ? "cdp-mouse" : "cdp-js",
      tactic: Boolean(advice),
      message: `${advice ? `${advice}\n` : ""}${head}\n${formatSnapshot(snap)}`,
    };
  });
}

async function cmdType(text, submit) {
  return await withPage(async (client, tab) => {
    const snap0 = await snapshotNow(client, tab);
    if (looksLikeHumanCheck(snap0.title, snap0.text, snap0.url)) {
      return { ok: false, message: "HUMAN CHECK: капча. Не печатаю." };
    }
    for (const item of typePlan(text)) {
      await client.send("Input.insertText", { text: item.ch });
      await sleep(item.delay);
    }
    if (submit) {
      await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
      await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
    }
    await sleep(300);
    const snap = await snapshotNow(client, tab);
    return { ok: true, message: formatSnapshot(snap) };
  });
}

async function cmdKey(key) {
  return await withPage(async (client, tab) => {
    const name = String(key || "Enter");
    await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: name });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name });
    await sleep(200);
    const snap = await snapshotNow(client, tab);
    return { ok: true, message: formatSnapshot(snap) };
  });
}

async function cmdScroll(direction) {
  return await withPage(async (client, tab) => {
    const dir = String(direction || "down");
    const dy = dir === "up" ? -900 : dir === "top" ? 0 : dir === "bottom" ? 4000 : 900;
    if (dir === "top") await evaluate(client, "window.scrollTo(0,0)");
    else if (dir === "bottom") await evaluate(client, "window.scrollTo(0, document.body.scrollHeight)");
    else await client.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: 400, y: 300, deltaX: 0, deltaY: dy });
    await sleep(250);
    const snap = await snapshotNow(client, tab);
    return { ok: true, message: formatSnapshot(snap) };
  });
}

async function cmdBack() {
  return await withPage(async (client, tab) => {
    await evaluate(client, "history.back()");
    await sleep(400);
    const snap = await snapshotNow(client, tab);
    return { ok: true, message: formatSnapshot(snap) };
  });
}

async function cmdForward() {
  return await withPage(async (client, tab) => {
    await evaluate(client, "history.forward()");
    await sleep(400);
    const snap = await snapshotNow(client, tab);
    return { ok: true, message: formatSnapshot(snap) };
  });
}

async function cmdWait(ms) {
  await sleep(Math.min(Math.max(Number(ms) || 1000, 0), 20000));
  return await cmdSnapshot();
}

async function cmdScreenshot(kind, filePath, query) {
  const mode = String(kind || "tab").toLowerCase();
  if (mode === "screen" || mode === "pc" || mode === "desktop") {
    const dest = pc.screenshotScreen(filePath);
    return { ok: true, path: dest, message: `скриншот экрана: ${dest}` };
  }
  return await withPage(async (client, tab) => {
    const dest = filePath || path.join(desktopDir(), "max-tab.png");
    const shot = await client.send("Page.captureScreenshot", { format: "png" });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(shot.data, "base64"));
    return { ok: true, path: dest, title: tab.title, url: tab.url, message: `скриншот вкладки «${tab.title}»: ${dest}` };
  }, query);
}

async function cmdNewTab(url) {
  const { engine } = await ensureBrowser();
  const tabs = await listTargets(engine.port);
  const page = pickTab(tabs);
  if (!page) throw new Error("нет страницы, к которой подключиться");
  const client = await connectTab(page);
  try {
    await client.send("Target.createTarget", { url: url || "about:blank" });
  } finally {
    await client.close();
  }
  await sleep(400);
  return await cmdTabs();
}

async function cmdCloseTab(query) {
  return await withPage(async (client, tab) => {
    await client.send("Target.closeTarget", { targetId: tab.id }).catch(async () => {
      await evaluate(client, "window.close()");
    });
    return { ok: true, message: `закрыл вкладку ${tab.title}` };
  }, query);
}

async function cmdLaunch(target) {
  const result = pc.launchApp(target);
  return { ok: true, ...result, message: `запустил ${target} на этом ПК` };
}

async function cmdWindows() {
  const windows = pc.listWindows();
  const message = windows.length
    ? windows.slice(0, 40).map((item) => `- ${item.title}  (${item.image} ${item.pid})`).join("\n")
    : "окон с заголовком нет";
  return { ok: true, windows, message };
}

async function cmdFocus(title) {
  const result = pc.focusWindow(title);
  if (result.ok) {
    try {
      await cmdTabs(title);
    } catch {
      // OS window focused even if it is not a debug tab
    }
  }
  return { ...result, message: result.ok ? `на передний план: ${result.result || title}` : `не нашёл окно «${title}»` };
}

const COMMANDS = {
  doctor: (args) => cmdDoctor(args[0]),
  tabs: (args) => cmdTabs(args[0]),
  tab: (args) => cmdTabs(args[0]),
  open: (args) => cmdOpen(args[0], args[1]),
  snapshot: (args) => cmdSnapshot(args[0]),
  click: (args) => cmdClick(args[0], args[1]),
  type: (args) => {
    const submit = args.includes("--submit");
    const text = args.filter((item) => item !== "--submit").join(" ");
    return cmdType(text, submit);
  },
  key: (args) => cmdKey(args[0]),
  scroll: (args) => cmdScroll(args[0]),
  back: () => cmdBack(),
  forward: () => cmdForward(),
  wait: (args) => cmdWait(args[0]),
  screenshot: (args) => cmdScreenshot(args[0], args[1], args[2]),
  shot: (args) => cmdScreenshot(args[0], args[1], args[2]),
  newtab: (args) => cmdNewTab(args[0]),
  closetab: (args) => cmdCloseTab(args[0]),
  launch: (args) => cmdLaunch(args.join(" ")),
  windows: () => cmdWindows(),
  focus: (args) => cmdFocus(args.join(" ")),
  menu: () => ({ ok: true, menu: MENU, message: MENU.map((item) => `${item.id}. ${item.title}`).join("\n") }),
  start: (args) => cmdDoctor(args[0]),
  goal: (args) => goalBrain(args),
  guard: (args) => cmdGuard(args),
};

function parseArgv(argv) {
  const args = [...argv];
  let json = false;
  const rest = [];
  for (const item of args) {
    if (item === "--json") json = true;
    else rest.push(item);
  }
  const command = rest.shift() || "menu";
  return { command, args: rest, json };
}

function cmdGuard(args) {
  const guard = require("./guard.cjs");
  const sub = args[0] || "status";
  const rest = args.slice(1);
  if (sub === "selftest") {
    const code = guard.selftest();
    return { ok: code === 0, message: code === 0 ? "guard selftest ok" : "guard selftest FAIL" };
  }
  if (sub === "goal") {
    const st = guard.loadState();
    st.goal = rest.join(" ") || null;
    st.startedAt = new Date().toISOString();
    st.steps = [];
    guard.saveState(st);
    return { ok: true, message: `guard: цель = ${st.goal}` };
  }
  if (sub === "read") {
    const st = guard.loadState();
    st.lastReadAt = new Date().toISOString();
    guard.saveState(st);
    return { ok: true, message: "guard: страница прочитана" };
  }
  if (sub === "evidence") {
    const st = guard.loadState();
    st.lastEvidence = { at: new Date().toISOString(), text: rest.join(" ").slice(0, 300) };
    guard.saveState(st);
    return { ok: true, message: "guard: доказательство записано" };
  }
  if (sub === "done") {
    const st = guard.loadState();
    const r = guard.verdict([guard.checkDoneClaim(rest.join(" "), st.lastEvidence)]);
    return { ok: r.exit === 0, message: r.text };
  }
  if (sub === "click") {
    const st = guard.loadState();
    const r = guard.verdict([guard.checkBlindClick(st.lastReadAt)]);
    return { ok: r.exit === 0, message: r.text };
  }
  if (sub === "stop") {
    const st = guard.loadState();
    const r = guard.verdict([guard.checkStop(st.goal, st, rest[0])]);
    return { ok: r.exit === 0, message: r.text };
  }
  if (sub === "command") {
    const r = guard.verdict([guard.checkCommand(rest[0], rest[1])]);
    return { ok: r.exit === 0, message: r.text };
  }
  const st = guard.loadState();
  return { ok: true, message: JSON.stringify(st, null, 2) };
}

function goalBrain(args) {
  const fs = require("node:fs");
  const { execFileSync } = require("node:child_process");
  const path = require("node:path");
  const filename = args && args[0] === "guard" ? "loop-guard.mjs" : "goal-brain.mjs";
  const roots = [
    process.env.FEDOR_WORKSPACE,
    path.join(process.env.USERPROFILE || process.env.HOME || "", "Fedor2", "workspace"),
    path.join(__dirname, "..", "..", "..", "..", "workspace"),
  ].filter(Boolean);
  const bundled = path.join(__dirname, "agent", filename);
  let target = bundled;
  for (const root of roots) {
    const candidate = path.join(root, ".agent", filename);
    if (fs.existsSync(candidate)) {
      target = candidate;
      break;
    }
  }
  if (!fs.existsSync(target)) {
    return { ok: false, message: `нет определителя цели: ${filename}` };
  }
  const sub = (args && args[0]) || "check";
  const rest = (args || []).slice(1);
  const argv = sub === "guard" ? ["enforce"] : [sub, ...rest];
  try {
    const out = execFileSync(process.execPath, [target, ...argv], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 8000,
      windowsHide: true,
    });
    return { ok: true, message: String(out || "").trim() };
  } catch (e) {
    const out = String((e && e.stdout) || "") + String((e && e.stderr) || "");
    return { ok: false, message: out.trim() || String(e && e.message) };
  }
}

async function run(command, args) {
  const fn = COMMANDS[command];
  if (!fn) {
    try {
      const guard = require("./guard.cjs");
      const check = guard.checkCommand("coder-v2", command);
      if (!check.ok) {
        const st = guard.loadState();
        st.steps = st.steps || [];
        st.steps.push({ at: new Date().toISOString(), error: check.code, command });
        guard.saveState(st);
      }
    } catch {
      /* guard не критичен для ответа */
    }
    return {
      ok: false,
      message: `UNKNOWN_TOOL: ${command}. неизвестная команда. Это не «готово». команды: ${Object.keys(COMMANDS).join(", ")}`,
    };
  }
  try {
    return await fn(args);
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

async function main(argv) {
  const { command, args, json } = parseArgv(argv);
  const result = await run(command, args);
  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${result.message || JSON.stringify(result)}\n`);
  }
  return result.ok !== false ? 0 : 1;
}

module.exports = {
  MENU,
  COMMANDS,
  parseArgv,
  run,
  main,
  cmdDoctor,
  cmdTabs,
  cmdOpen,
  cmdSnapshot,
  cmdClick,
  cmdType,
  cmdScreenshot,
  cmdLaunch,
  cmdWindows,
  formatTabs,
  formatSnapshot,
  looksLikeHumanCheck,
  FIND_JS,
  CLICK_JS,
  cmdGuard,
  goalBrain,
  clickOutcomeAdvice,
  SNAPSHOT_JS,
  CLICKABLE_SEL,
};
