"use strict";

/**
 * Public search + streamed file download + APK/ZIP inspect.
 * No extra npm deps. Used by tools.ts and the packed Next chunk.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const zlib = require("node:zlib");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const DEFAULT_MAX_BYTES = 500 * 1024 * 1024;
const BLOCKED_EXEC = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs)$/i;
const SEARCH_ENDPOINTS = [
  (q) => `https://html.duckduckgo.com/html/?q=${q}`,
  (q) => `https://lite.duckduckgo.com/lite/?q=${q}`,
];

function json(obj) {
  return JSON.stringify(obj, null, 2);
}

function encodeQuery(q) {
  return encodeURIComponent(String(q || "").trim()).replace(/%20/g, "+");
}

function stripTags(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHref(href) {
  const raw = String(href || "")
    .replace(/&amp;/g, "&")
    .trim();
  if (!raw || raw.startsWith("#") || raw.toLowerCase().startsWith("javascript:")) return "";
  try {
    const abs = raw.startsWith("//") ? `https:${raw}` : raw;
    const u = new URL(abs, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    if (uddg) {
      const once = decodeURIComponent(uddg);
      try {
        return decodeURIComponent(once);
      } catch {
        return once;
      }
    }
    if (/duckduckgo\.com$/i.test(u.hostname) || /duckduckgo\.com$/i.test(u.host)) return "";
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return u.toString();
  } catch {
    return "";
  }
}

function looksLikePackage(text) {
  return /\b[a-zA-Z][\w]*(\.[a-zA-Z][\w]*){2,}\b/.test(String(text || ""));
}

function firstPackage(text) {
  const m = String(text || "").match(/\b[a-zA-Z][\w]*(\.[a-zA-Z][\w]*){2,}\b/);
  return m ? m[0] : "";
}

function packageMirrors(pkg) {
  const p = String(pkg || "").trim();
  if (!p) return [];
  const slug = p.split(".").pop() || p;
  return [
    { title: `APKPure latest APK ${p}`, url: `https://d.apkpure.net/b/APK/${p}?version=latest` },
    { title: `APKPure.com latest APK ${p}`, url: `https://d.apkpure.com/b/APK/${p}?version=latest` },
    { title: `APKPure ${p}`, url: `https://apkpure.com/${slug}/${p}` },
    { title: `APKPure.net ${p}`, url: `https://apkpure.net/${slug}/${p}` },
    { title: `APKMirror ${p}`, url: `https://www.apkmirror.com/?s=${encodeURIComponent(p)}` },
    { title: `APKCombo ${p}`, url: `https://apkcombo.com/${p}/` },
    { title: `Uptodown ${p}`, url: `https://uptodown.com/android/search?q=${encodeURIComponent(p)}` },
    { title: `AppBrain ${p}`, url: `https://www.appbrain.com/app/${p}` },
  ];
}

function parseSearchHtml(html) {
  const out = [];
  const seen = new Set();
  const push = (href, title) => {
    const url = decodeHref(href);
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ title: stripTags(title) || url, url });
  };
  const htmlVer = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const htmlRev = /<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = htmlVer.exec(html))) push(m[1], m[2]);
  while ((m = htmlRev.exec(html))) push(m[1], m[2]);
  if (!out.length) {
    const lite = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = lite.exec(html))) {
      const href = m[1];
      if (!/uddg=|https?:\/\//i.test(href)) continue;
      push(href, m[2]);
    }
  }
  return out;
}

function httpGetBuffer(url, timeoutMs = 15000, maxBytes = 1_500_000) {
  return new Promise((resolve, reject) => {
    const done = (err, val) => {
      if (done.ok) return;
      done.ok = true;
      err ? reject(err) : resolve(val);
    };
    let hops = 0;
    const go = (target) => {
      hops += 1;
      if (hops > 8) return done(new Error("too many redirects"));
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        return done(new Error("bad url"));
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return done(new Error("http(s) only"));
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request(
        parsed,
        {
          method: "GET",
          headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        },
        (res) => {
          const loc = res.headers.location;
          if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            res.resume();
            return go(new URL(loc, parsed).toString());
          }
          const chunks = [];
          let n = 0;
          res.on("data", (c) => {
            n += c.length;
            if (n > maxBytes) {
              req.destroy();
              return done(new Error("response too large"));
            }
            chunks.push(c);
          });
          res.on("end", () =>
            done(null, {
              status: res.statusCode || 0,
              url: parsed.toString(),
              contentType: String(res.headers["content-type"] || ""),
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
          res.on("error", done);
        },
      );
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        done(new Error("timeout"));
      });
      req.on("error", done);
      req.end();
    };
    go(url);
  });
}

async function webSearch(query, maxResults = 10) {
  const q = String(query || "").trim();
  if (!q) return json({ ok: false, error: "query is required" });
  const encoded = encodeQuery(q);
  let results = [];
  let source = "";
  let lastErr = "";
  for (const make of SEARCH_ENDPOINTS) {
    try {
      const page = await httpGetBuffer(make(encoded), 16000);
      if (/HUMAN CHECK|captcha|unusual traffic/i.test(page.body.slice(0, 4000))) {
        return json({
          ok: false,
          error: "HUMAN CHECK",
          hint: "Поисковик показал капчу. Пройдите её в браузере и повторите.",
        });
      }
      results = parseSearchHtml(page.body);
      if (results.length) {
        source = page.url;
        break;
      }
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  const pkg = firstPackage(q);
  const mirrors = pkg ? packageMirrors(pkg) : [];
  const merged = [];
  const seen = new Set();
  for (const item of [...results, ...mirrors]) {
    if (!item.url || seen.has(item.url)) continue;
    seen.add(item.url);
    merged.push(item);
  }
  const top = merged.slice(0, Math.max(1, Math.min(20, Number(maxResults) || 10)));
  const lines = top.map((item, i) => `${i + 1}. ${item.title}\n   ${item.url}`);
  return [
    `ok=true source=${source || "mirrors"} count=${top.length}`,
    pkg ? `package=${pkg}` : "",
    "rule: Play/RuStore/закрытый каталог файл не отдают — бери зеркало, не долби API первоисточника.",
    "rule: 400/404 = не тот эндпоинт, максимум 2 попытки, потом другое зеркало.",
    lines.join("\n"),
    json({ ok: true, query: q, source, results: top, mirrors: mirrors.slice(0, 7) }),
  ]
    .filter(Boolean)
    .join("\n");
}

function publicHttpUrl(raw) {
  const text = String(raw || "").trim();
  if (!/^https?:\/\//i.test(text)) return null;
  let u;
  try {
    u = new URL(text);
  } catch {
    return null;
  }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password) return null;
  return u;
}

function workspaceRoot() {
  return (
    process.env.GROK_WORKSPACE ||
    process.env.FEDOR_WORKSPACE ||
    process.env.FEDOR_APP_ROOT ||
    process.cwd()
  );
}

function userPlace(kind) {
  const home = os.homedir();
  if (kind === "downloads") {
    for (const p of [path.join(home, "Downloads"), path.join(home, "Загрузки")]) {
      if (fs.existsSync(p)) return p;
    }
    return path.join(home, "Downloads");
  }
  for (const p of [
    process.env.GROK_DESKTOP_DIR,
    path.join(home, "Desktop"),
    path.join(home, "Рабочий стол"),
  ]) {
    if (p && fs.existsSync(p)) return p;
  }
  return path.join(home, "Desktop");
}

function isAllowedDest(abs) {
  const resolved = path.resolve(abs);
  const roots = [workspaceRoot(), os.homedir(), userPlace("desktop"), userPlace("downloads"), os.tmpdir()];
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), resolved);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

function filenameFromUrl(u, contentDisposition) {
  const cd = String(contentDisposition || "");
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      return path.basename(decodeURIComponent(star[1].trim()));
    } catch {
      /* ignore */
    }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  if (plain) return path.basename(plain[1].trim());
  const base = path.basename(u.pathname || "");
  return base && base !== "/" ? decodeURIComponent(base) : "download.bin";
}

function resolveDest(rawPath, fallbackName) {
  const raw = String(rawPath || "").trim();
  let dest;
  if (!raw) dest = path.join(userPlace("desktop"), fallbackName);
  else if (path.isAbsolute(raw)) dest = raw;
  else dest = path.resolve(workspaceRoot(), raw);
  dest = path.resolve(dest);
  if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) dest = path.join(dest, fallbackName);
  return dest;
}

function mirrorHost(urlObj) {
  if (!urlObj) return null;
  if (/\.apkpure\.com$/i.test(urlObj.hostname)) {
    const next = new URL(urlObj.toString());
    next.hostname = urlObj.hostname.replace(/apkpure\.com$/i, "apkpure.net");
    return next;
  }
  return null;
}

function pythonBin() {
  for (const name of process.platform === "win32" ? ["py", "python", "python3"] : ["python3", "python"]) {
    const r = spawnSync(name, ["-c", "print(1)"], { encoding: "utf8", timeout: 4000, windowsHide: true });
    if ((r.status ?? 1) === 0 && String(r.stdout || "").includes("1")) return name;
  }
  return "";
}

function downloadWithPython(target, dest, maxBytes) {
  const bin = pythonBin();
  if (!bin) return null;
  const script = [
    "import hashlib,sys,urllib.request",
    "url=sys.argv[1]; dest=sys.argv[2]; cap=int(sys.argv[3])",
    "req=urllib.request.Request(url,headers={'User-Agent':" + JSON.stringify(UA) + ",'Accept':'*/*'})",
    "h=hashlib.sha256(); n=0",
    "with urllib.request.urlopen(req, timeout=120) as r, open(dest,'wb') as o:",
    "    ctype=r.headers.get('content-type') or ''",
    "    while True:",
    "        c=r.read(1024*256)",
    "        if not c: break",
    "        n+=len(c)",
    "        if n>cap: raise SystemExit('exceeded maxBytes')",
    "        h.update(c); o.write(c)",
    "    print(n); print(h.hexdigest()); print(ctype); print(r.url)",
  ].join("\n");
  const args = bin === "py" ? ["-3", "-c", script, target, dest, String(maxBytes)] : ["-c", script, target, dest, String(maxBytes)];
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 180000, windowsHide: true, maxBuffer: 2_000_000 });
  if ((r.status ?? 1) !== 0) return { ok: false, error: String(r.stderr || r.stdout || "python download failed").slice(0, 400) };
  const lines = String(r.stdout || "").trim().split(/\r?\n/);
  return {
    ok: true,
    path: dest,
    bytes: Number(lines[0] || 0),
    sha256: lines[1] || "",
    contentType: lines[2] || "",
    url: lines[3] || target,
  };
}

function downloadFile(opts) {
  const args = opts && typeof opts === "object" ? opts : {};
  const u = publicHttpUrl(args.url);
  if (!u) return Promise.resolve(json({ ok: false, error: "url must be public http(s) without credentials" }));
  const nameGuess = filenameFromUrl(u, "");
  if (BLOCKED_EXEC.test(nameGuess) && !args.consent && !args.allowExec) {
    return Promise.resolve(
      json({
        ok: false,
        error: "need_consent",
        url: u.toString(),
        hint: "Не качаю .exe/.msi/.bat без явного согласия. Подтвердите и вызовите download_file с consent=true.",
      }),
    );
  }
  const maxBytes = Math.max(1024, Number(args.maxBytes) || DEFAULT_MAX_BYTES);
  const dest = resolveDest(args.path, nameGuess);
  if (!isAllowedDest(dest)) {
    return Promise.resolve(json({ ok: false, error: "path is outside the user folders" }));
  }
  if (BLOCKED_EXEC.test(dest) && !args.consent && !args.allowExec) {
    return Promise.resolve(
      json({
        ok: false,
        error: "need_consent",
        url: u.toString(),
        path: dest,
        hint: "Не качаю исполняемый файл без согласия пользователя.",
      }),
    );
  }

  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let hops = 0;
    const go = (target) => {
      hops += 1;
      if (hops > 10) return resolve(json({ ok: false, error: "too many redirects" }));
      let parsed;
      try {
        parsed = new URL(target);
      } catch {
        return resolve(json({ ok: false, error: "bad redirect" }));
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return resolve(json({ ok: false, error: "http(s) only" }));
      }
      const lib = parsed.protocol === "https:" ? https : http;
      const req = lib.request(
        parsed,
        {
          method: "GET",
          headers: {
            "User-Agent": UA,
            Accept: "*/*",
            "Accept-Language": "en-US,en;q=0.9,ru;q=0.8",
            "Accept-Encoding": "identity",
            Connection: "close",
          },
        },
        (res) => {
          const loc = res.headers.location;
          if (res.statusCode >= 300 && res.statusCode < 400 && loc) {
            res.resume();
            return go(new URL(loc, parsed).toString());
          }
          if ((res.statusCode || 0) >= 400) {
            res.resume();
            const alt = hops <= 3 ? mirrorHost(parsed) : null;
            if (alt && alt.toString() !== parsed.toString()) return go(alt.toString());
            if (res.statusCode === 403 || res.statusCode === 503) {
              const viaPy = downloadWithPython(target, dest, maxBytes);
              if (viaPy && viaPy.ok) return resolve(json(viaPy));
            }
            return resolve(
              json({
                ok: false,
                error: `HTTP ${res.statusCode}`,
                url: parsed.toString(),
                hint: "400/404 — эндпоинт не тот. Максимум ещё одна попытка, потом поисковик/другое зеркало.",
              }),
            );
          }
          const type = String(res.headers["content-type"] || "");
          const declared = Number(res.headers["content-length"] || 0);
          if (declared > maxBytes) {
            res.resume();
            return resolve(json({ ok: false, error: `file ${declared} bytes exceeds maxBytes ${maxBytes}` }));
          }
          const finalName = filenameFromUrl(parsed, res.headers["content-disposition"]);
          let outPath = dest;
          if (!args.path) outPath = resolveDest("", finalName);
          else if (fs.existsSync(dest) && fs.statSync(dest).isDirectory()) outPath = path.join(dest, finalName);
          if (BLOCKED_EXEC.test(outPath) && !args.consent && !args.allowExec) {
            res.resume();
            return resolve(json({ ok: false, error: "need_consent", url: parsed.toString(), path: outPath }));
          }
          const tmp = `${outPath}.part`;
          const hash = crypto.createHash("sha256");
          const file = fs.createWriteStream(tmp);
          let bytes = 0;
          let head = Buffer.alloc(0);
          let aborted = false;
          const fail = (msg) => {
            if (aborted) return;
            aborted = true;
            res.destroy();
            file.destroy();
            try {
              fs.unlinkSync(tmp);
            } catch {
              /* ignore */
            }
            resolve(json({ ok: false, error: msg, url: parsed.toString() }));
          };
          res.on("data", (chunk) => {
            if (aborted) return;
            bytes += chunk.length;
            if (bytes > maxBytes) return fail(`exceeded maxBytes ${maxBytes}`);
            if (head.length < 800) head = Buffer.concat([head, chunk]).subarray(0, 800);
            if (head.length >= 16 && /text\/html/i.test(type) && /<html|HUMAN CHECK|captcha/i.test(head.toString("utf8"))) {
              return fail("HUMAN CHECK or HTML page, not a file. Stop and ask the user, or pick another mirror.");
            }
            hash.update(chunk);
            file.write(chunk);
          });
          res.on("end", () => {
            if (aborted) return;
            file.end(() => {
              try {
                fs.renameSync(tmp, outPath);
              } catch (err) {
                return resolve(json({ ok: false, error: String(err && err.message ? err.message : err) }));
              }
              resolve(
                json({
                  ok: true,
                  path: outPath,
                  bytes,
                  contentType: type,
                  sha256: hash.digest("hex"),
                  url: parsed.toString(),
                }),
              );
            });
          });
          res.on("error", (err) => fail(String(err.message || err)));
        },
      );
      req.setTimeout(120000, () => {
        req.destroy();
        resolve(json({ ok: false, error: "timeout" }));
      });
      req.on("error", (err) => resolve(json({ ok: false, error: String(err.message || err) })));
      req.end();
    };
    go(u.toString());
  });
}

function readU16(buf, o) {
  return buf.readUInt16LE(o);
}
function readU32(buf, o) {
  return buf.readUInt32LE(o);
}

function findEocd(buf) {
  const min = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (readU32(buf, i) === 0x06054b50) return i;
  }
  return -1;
}

function parseCentralDirectory(cd, count) {
  const files = [];
  let off = 0;
  for (let i = 0; i < count && off + 46 <= cd.length; i++) {
    if (readU32(cd, off) !== 0x02014b50) break;
    const method = readU16(cd, off + 10);
    const comp = readU32(cd, off + 20);
    const uncomp = readU32(cd, off + 24);
    const nameLen = readU16(cd, off + 28);
    const extraLen = readU16(cd, off + 30);
    const commentLen = readU16(cd, off + 32);
    const localOff = readU32(cd, off + 42);
    const name = cd.subarray(off + 46, off + 46 + nameLen).toString("utf8");
    files.push({ name, method, comp, uncomp, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function listZipBuffer(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error("not a zip");
  const count = readU16(buf, eocd + 10);
  const off = readU32(buf, eocd + 16);
  const size = readU32(buf, eocd + 12);
  if (off + size > buf.length) throw new Error("zip central directory truncated");
  return parseCentralDirectory(buf.subarray(off, off + size), count);
}

function inflateZipEntry(buf, entry) {
  const lo = entry.localOff;
  if (readU32(buf, lo) !== 0x04034b50) throw new Error(`bad local header ${entry.name}`);
  const nameLen = readU16(buf, lo + 26);
  const extraLen = readU16(buf, lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.comp);
  if (entry.method === 0) return Buffer.from(raw);
  if (entry.method === 8) return zlib.inflateRawSync(raw);
  throw new Error(`unsupported zip method ${entry.method} for ${entry.name}`);
}

function listZipFile(filePath) {
  const st = fs.statSync(filePath);
  if (st.size <= 8 * 1024 * 1024) return listZipBuffer(fs.readFileSync(filePath));
  const fd = fs.openSync(filePath, "r");
  try {
    const tailWant = Math.min(st.size, 80 * 1024);
    const tail = Buffer.alloc(tailWant);
    fs.readSync(fd, tail, 0, tailWant, st.size - tailWant);
    const eocdRel = findEocd(tail);
    if (eocdRel < 0) throw new Error("not a zip");
    const count = readU16(tail, eocdRel + 10);
    const cdOff = readU32(tail, eocdRel + 16);
    const cdSize = readU32(tail, eocdRel + 12);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOff);
    return parseCentralDirectory(cd, count);
  } finally {
    fs.closeSync(fd);
  }
}

function readZipEntryFile(filePath, name) {
  const st = fs.statSync(filePath);
  if (st.size <= 12 * 1024 * 1024) {
    const buf = fs.readFileSync(filePath);
    const entry = listZipBuffer(buf).find((e) => e.name === name);
    if (!entry) throw new Error(`missing ${name}`);
    return inflateZipEntry(buf, entry);
  }
  const files = listZipFile(filePath);
  const entry = files.find((e) => e.name === name);
  if (!entry) throw new Error(`missing ${name}`);
  const fd = fs.openSync(filePath, "r");
  try {
    const local = Buffer.alloc(30);
    fs.readSync(fd, local, 0, 30, entry.localOff);
    if (readU32(local, 0) !== 0x04034b50) throw new Error("bad local header");
    const nameLen = readU16(local, 26);
    const extraLen = readU16(local, 28);
    const start = entry.localOff + 30 + nameLen + extraLen;
    const raw = Buffer.alloc(entry.comp);
    fs.readSync(fd, raw, 0, entry.comp, start);
    if (entry.method === 0) return raw;
    if (entry.method === 8) return zlib.inflateRawSync(raw);
    throw new Error(`unsupported zip method ${entry.method}`);
  } finally {
    fs.closeSync(fd);
  }
}

function decodeUtf8Len(buf, o) {
  let chars = buf[o];
  let n = 1;
  if (chars & 0x80) {
    chars = ((chars & 0x7f) << 8) | buf[o + 1];
    n = 2;
  }
  let bytes = buf[o + n];
  n += 1;
  if (bytes & 0x80) {
    bytes = ((bytes & 0x7f) << 8) | buf[o + n];
    n += 1;
  }
  return { n, bytes };
}

function parseStringPool(buf, start) {
  const stringCount = readU32(buf, start + 8);
  const flags = readU32(buf, start + 16);
  const stringsStart = readU32(buf, start + 20);
  const utf8 = Boolean(flags & (1 << 8));
  const out = [];
  for (let i = 0; i < stringCount; i++) {
    const rel = readU32(buf, start + 28 + i * 4);
    let o = start + stringsStart + rel;
    if (utf8) {
      const enc = decodeUtf8Len(buf, o);
      o += enc.n;
      out.push(buf.subarray(o, o + enc.bytes).toString("utf8"));
    } else {
      let len = readU16(buf, o);
      o += 2;
      if (len & 0x8000) {
        len = ((len & 0x7fff) << 16) | readU16(buf, o);
        o += 2;
      }
      out.push(buf.subarray(o, o + len * 2).toString("utf16le"));
    }
  }
  return out;
}

function parseAxml(buf) {
  if (!buf || buf.length < 16) return {};
  const strings = [];
  let packageName = "";
  let versionName = "";
  let versionCode = "";
  let offset = 0;
  const limit = Math.min(buf.length, readU32(buf, 4) || buf.length);
  while (offset + 8 <= buf.length && offset < limit) {
    const type = readU16(buf, offset);
    const headerSize = readU16(buf, offset + 2);
    const chunkSize = readU32(buf, offset + 4);
    if (!chunkSize || offset + chunkSize > buf.length) break;
    if (type === 0x0003) {
      offset += headerSize || 8;
      continue;
    }
    if (type === 0x0001) {
      try {
        strings.push(...parseStringPool(buf, offset));
      } catch {
        /* keep going */
      }
    } else if (type === 0x0102) {
      const nameIdx = readU32(buf, offset + 20);
      const attrCount = readU16(buf, offset + 28);
      const name = strings[nameIdx] || "";
      let attrOff = offset + 36;
      const attrs = {};
      for (let i = 0; i < attrCount && attrOff + 20 <= offset + chunkSize; i++) {
        const an = strings[readU32(buf, attrOff + 4)] || "";
        const raw = readU32(buf, attrOff + 8);
        const typed = buf[attrOff + 15];
        const data = readU32(buf, attrOff + 16);
        let value = "";
        if (typed === 0x03) value = strings[data] || strings[raw] || "";
        else if (typed === 0x10 || typed === 0x11) value = String(data);
        else if (raw !== 0xffffffff) value = strings[raw] || String(data);
        else value = String(data);
        attrs[an] = value;
        attrOff += 20;
      }
      if (name === "manifest") {
        packageName = attrs.package || packageName;
        versionName = attrs.versionName || versionName;
        versionCode = attrs.versionCode || versionCode;
      }
    }
    offset += chunkSize;
  }
  return { package: packageName, versionName, versionCode };
}

function findAapt2() {
  const names = process.platform === "win32" ? ["aapt2.exe", "aapt.exe"] : ["aapt2", "aapt"];
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Android", "Sdk") : "",
    path.join(os.homedir(), "Android", "Sdk"),
    "/opt/android-sdk",
    "/usr/lib/android-sdk",
  ].filter(Boolean);
  for (const root of roots) {
    const tools = path.join(root, "build-tools");
    if (!fs.existsSync(tools)) continue;
    const vers = fs.readdirSync(tools).sort().reverse();
    for (const ver of vers) {
      for (const name of names) {
        const bin = path.join(tools, ver, name);
        if (fs.existsSync(bin)) return bin;
      }
    }
  }
  for (const name of names) {
    const which = spawnSync(process.platform === "win32" ? "where" : "which", [name.replace(/\.exe$/, "")], {
      encoding: "utf8",
      timeout: 4000,
      windowsHide: true,
    });
    const line = String(which.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    if (line && fs.existsSync(line)) return line;
  }
  return "";
}

function inspectWithAapt(bin, apkPath) {
  const r = spawnSync(bin, ["dump", "badging", apkPath], {
    encoding: "utf8",
    timeout: 20000,
    windowsHide: true,
    maxBuffer: 2_000_000,
  });
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const pkg = (text.match(/package: name='([^']+)'/) || [])[1] || "";
  const versionCode = (text.match(/versionCode='([^']+)'/) || [])[1] || "";
  const versionName = (text.match(/versionName='([^']+)'/) || [])[1] || "";
  if (!pkg) return null;
  return { package: pkg, versionCode, versionName, source: path.basename(bin) };
}

function inspectApk(rawPath) {
  const filePath = path.resolve(String(rawPath || "").trim());
  if (!filePath || !fs.existsSync(filePath)) return json({ ok: false, error: "apk not found", path: filePath });
  const bytes = fs.statSync(filePath).size;
  let files = [];
  try {
    files = listZipFile(filePath);
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), path: filePath });
  }
  const assets = files.filter((f) => f.name.startsWith("assets/") && !f.name.endsWith("/"));
  let meta = {};
  const aapt = findAapt2();
  if (aapt) {
    try {
      meta = inspectWithAapt(aapt, filePath) || {};
    } catch {
      meta = {};
    }
  }
  if (!meta.package) {
    try {
      const axml = readZipEntryFile(filePath, "AndroidManifest.xml");
      meta = { ...parseAxml(axml), source: "axml" };
    } catch (err) {
      meta = { error: err instanceof Error ? err.message : String(err), source: "axml" };
    }
  }
  return json({
    ok: Boolean(meta.package),
    path: filePath,
    bytes,
    package: meta.package || "",
    versionName: meta.versionName || "",
    versionCode: meta.versionCode || "",
    fileCount: files.length,
    assetCount: assets.length,
    assets: assets.slice(0, 40).map((f) => ({ name: f.name, bytes: f.uncomp })),
    source: meta.source || "",
  });
}

function inspectZip(rawPath) {
  const filePath = path.resolve(String(rawPath || "").trim());
  if (!filePath || !fs.existsSync(filePath)) return json({ ok: false, error: "zip not found", path: filePath });
  try {
    const files = listZipFile(filePath);
    return json({
      ok: true,
      path: filePath,
      bytes: fs.statSync(filePath).size,
      fileCount: files.length,
      files: files.slice(0, 80).map((f) => ({ name: f.name, bytes: f.uncomp })),
    });
  } catch (err) {
    return json({ ok: false, error: err instanceof Error ? err.message : String(err), path: filePath });
  }
}

async function fetchPublicPage(rawUrl) {
  const u = publicHttpUrl(rawUrl);
  if (!u) return "url must be http:// or https:// without credentials";
  try {
    const page = await httpGetBuffer(u.toString(), 12000, 80000);
    let body = page.body;
    if (/html/i.test(page.contentType) || /<html|<body|<article/i.test(body.slice(0, 400))) {
      body = stripTags(body.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " "));
    }
    return `status=${page.status}\nurl=${page.url}\n\n${body.slice(0, 12000)}`;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

function looksLikeDownloadWork(text) {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (/(скача(й|ть)|загрузи|download\b|найди.{0,24}(apk|файл|архив|зеркал))/i.test(raw)) return true;
  if (/\.apk\b/i.test(raw) && /(найди|достань|принеси|зеркало)/i.test(raw)) return true;
  return false;
}

module.exports = {
  webSearch,
  downloadFile,
  inspectApk,
  inspectZip,
  fetchPublicPage,
  parseSearchHtml,
  decodeHref,
  packageMirrors,
  parseAxml,
  listZipBuffer,
  looksLikeDownloadWork,
  UA,
};
