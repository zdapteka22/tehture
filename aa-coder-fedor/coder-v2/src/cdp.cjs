"use strict";

const http = require("node:http");
const https = require("node:https");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpJson(url, timeoutMs = 2500, method = "GET") {
  return new Promise((resolve, reject) => {
    const client = String(url).startsWith("https") ? https : http;
    const req = client.request(url, { method, timeout: timeoutMs }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        if ((res.statusCode || 500) >= 400) {
          reject(new Error(`CDP HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
          return;
        }
        try {
          resolve(body ? JSON.parse(body) : {});
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("CDP HTTP timeout"));
    });
    req.on("error", reject);
    req.end();
  });
}

async function version(port) {
  return await httpJson(`http://127.0.0.1:${port}/json/version`);
}

async function listTargets(port) {
  const raw = await httpJson(`http://127.0.0.1:${port}/json/list`);
  const list = Array.isArray(raw) ? raw : [];
  return list.filter((item) => item.type === "page" || item.type === "app" || !item.type);
}

async function probe(port) {
  try {
    const info = await version(port);
    const tabs = await listTargets(port).catch(() => []);
    return { ok: true, port, browser: info.Browser || info.browser || "chromium", info, tabs };
  } catch {
    return { ok: false, port };
  }
}

async function waitForPort(port, timeoutMs = 20000) {
  const start = Date.now();
  let last = null;
  while (Date.now() - start < timeoutMs) {
    last = await probe(port);
    if (last.ok) return last;
    await sleep(250);
  }
  throw new Error(`Debug port ${port} did not come up in ${timeoutMs}ms. The usual profile often ignores --remote-debugging-port — Coder v2 uses a dedicated debug profile.`);
}

function pickTab(tabs, query) {
  if (!tabs?.length) return null;
  const q = String(query || "").trim().toLowerCase();
  if (!q) return tabs.find((tab) => tab.type === "page") || tabs[0];
  const byId = tabs.find(
    (tab) => String(tab.id || "").toLowerCase() === q || String(tab.id || "").toLowerCase().startsWith(q),
  );
  if (byId) return byId;
  return (
    tabs.find((tab) => String(tab.title || "").toLowerCase().includes(q)) ||
    tabs.find((tab) => String(tab.url || "").toLowerCase().includes(q)) ||
    null
  );
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.ws = null;
    this.nextId = 1;
    this.pending = new Map();
  }

  async open() {
    if (typeof WebSocket === "undefined") {
      throw new Error("This Node build has no WebSocket. Use Node 22+.");
    }
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", (event) => reject(event.error || new Error("CDP websocket failed")));
    });
    this.ws.addEventListener("message", (event) => {
      let msg;
      try {
        msg = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!msg.id || !this.pending.has(msg.id)) return;
      const job = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      if (msg.error) job.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else job.resolve(msg.result);
    });
    return this;
  }

  send(method, params = {}, timeoutMs = 20000) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async close() {
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
  }
}

async function connectTab(tab) {
  const url = tab?.webSocketDebuggerUrl;
  if (!url) throw new Error("Tab has no CDP websocket. Launch via Coder v2 debug profile.");
  const client = new CdpClient(url);
  await client.open();
  await client.send("Page.enable").catch(() => undefined);
  await client.send("Runtime.enable").catch(() => undefined);
  await client.send("DOM.enable").catch(() => undefined);
  return client;
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
  }
  return result?.result?.value;
}

async function newTarget(port, url) {
  const target = url || "about:blank";
  const encoded = encodeURIComponent(target);
  try {
    const created = await httpJson(`http://127.0.0.1:${port}/json/new?${encoded}`, 4000, "PUT");
    if (created && (created.id || created.webSocketDebuggerUrl)) return created;
  } catch {
    // try GET
  }
  try {
    const created = await httpJson(`http://127.0.0.1:${port}/json/new?${encoded}`, 4000, "GET");
    if (created && (created.id || created.webSocketDebuggerUrl)) return created;
  } catch {
    // browser websocket
  }
  const info = await version(port);
  const ws = info.webSocketDebuggerUrl;
  if (!ws) throw new Error("Cannot create a tab: no browser websocket");
  const client = new CdpClient(ws);
  await client.open();
  try {
    const result = await client.send("Target.createTarget", { url: target });
    return { id: result.targetId, ...result };
  } finally {
    await client.close();
  }
}

module.exports = {
  sleep,
  httpJson,
  version,
  listTargets,
  probe,
  waitForPort,
  pickTab,
  newTarget,
  CdpClient,
  connectTab,
  evaluate,
};
