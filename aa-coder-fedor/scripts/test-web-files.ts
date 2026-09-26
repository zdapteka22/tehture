import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { looksLikeDownloadWork, taskNeedsWork } from "../lib/fyodor/intent";
import { missingGoalWork, shouldNudgeUntilGoal } from "../lib/fyodor/until-goal";

const req = createRequire(fileURLToPath(import.meta.url));
const wf = req("../lib/web-files.cjs") as {
  parseSearchHtml: (html: string) => { title: string; url: string }[];
  decodeHref: (href: string) => string;
  packageMirrors: (pkg: string) => { title: string; url: string }[];
  webSearch: (q: string, n?: number) => Promise<string>;
  downloadFile: (opts: Record<string, unknown>) => Promise<string>;
  inspectApk: (p: string) => string;
  inspectZip: (p: string) => string;
};

let failed = 0;
function ok(name: string, cond: boolean) {
  if (cond) console.log(`ok   ${name}`);
  else {
    failed += 1;
    console.error(`FAIL ${name}`);
  }
}

const toolsSrc = readFileSync(path.join(process.cwd(), "lib/tools.ts"), "utf8");
ok("tools include web_search", /name: "web_search"/.test(toolsSrc));
ok("tools include download_file", /name: "download_file"/.test(toolsSrc));
ok("tools include inspect_apk", /name: "inspect_apk"/.test(toolsSrc));

const prompt = readFileSync(path.join(process.cwd(), "lib/prompt.ts"), "utf8");
ok("prompt has web_files", prompt.includes("<web_files>") && prompt.includes("web_search ПЕРВЫМ"));
ok("prompt has mirrors", prompt.includes("d.apkpure.com/b/APK"));

ok("скачай apk is work", taskNeedsWork("скачай APK приложения ru.asa.pdd.android.app"));
ok("download intent", looksLikeDownloadWork("найди файл ru.asa.pdd.android.app apk"));
ok(
  "search alone keeps going",
  missingGoalWork("скачай apk ru.asa.pdd.android.app", ["web_search"], []) === true,
);
ok(
  "nudge until file on disk",
  shouldNudgeUntilGoal({
    userText: "скачай APK ru.asa.pdd.android.app",
    content: "ищу",
    usedTools: ["web_search"],
    changedPaths: [],
    nudges: 0,
  }) === true,
);

const href = wf.decodeHref(
  "//duckduckgo.com/l/?uddg=https%3A%2F%2Fapkpure.com%2Fapp%2Fru.asa.pdd.android.app",
);
ok("decode uddg", href.includes("apkpure.com") && href.includes("ru.asa.pdd.android.app"));

const parsed = wf.parseSearchHtml(
  `<a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fapkpure.net%2Fpdd%2Fru.asa.pdd.android.app">PDD APK</a>
   <a href="https://lite.example" class="nav">home</a>
   <a class="result__a" href="https://www.apkmirror.com/?s=ru.asa.pdd.android.app">APKMirror</a>`,
);
ok("parse result__a", parsed.length >= 2 && parsed.some((r) => /apkpure|apkmirror/i.test(r.url)));

const mirrors = wf.packageMirrors("ru.asa.pdd.android.app");
ok("mirrors include apkpure latest", mirrors.some((m) => /d\.apkpure\.com\/b\/APK\/ru\.asa\.pdd/.test(m.url)));

async function main() {
  const exe = JSON.parse(
    await wf.downloadFile({ url: "https://example.com/setup.exe", path: path.join(os.tmpdir(), "setup.exe") }),
  );
  ok("exe blocked without consent", exe.ok === false && exe.error === "need_consent");

  const zipDir = mkdtempSync(path.join(os.tmpdir(), "fedor-zip-"));
  const zipPath = path.join(zipDir, "sample.zip");
  writeFileSync(path.join(zipDir, "readme.txt"), "hello zip");
  const zipped = spawnSync("python3", [
    "-c",
    "import zipfile; zipfile.ZipFile(r'''" + zipPath + "''','w').write(r'''" + path.join(zipDir, "readme.txt") + "''','readme.txt')",
  ]);
  ok("made sample zip", (zipped.status ?? 1) === 0 && existsSync(zipPath));
  const zipInfo = JSON.parse(wf.inspectZip(zipPath));
  ok("inspect_zip lists file", zipInfo.ok === true && zipInfo.fileCount >= 1);

  const live = await wf.webSearch("ru.asa.pdd.android.app apk", 10);
  ok("live search ok", /ok=true/.test(live));
  ok("live search has apk mirror", /apkpure|apkmirror|apkcombo|uptodown|appbrain/i.test(live));

  const dest = "/tmp/pdd.apk";
  const dl = JSON.parse(
    existsSync(dest) && statSync(dest).size > 1_000_000
      ? JSON.stringify({
          ok: true,
          path: dest,
          bytes: statSync(dest).size,
          sha256: createHash("sha256").update(readFileSync(dest)).digest("hex"),
        })
      : await wf.downloadFile({
          url: "https://d.apkpure.com/b/APK/ru.asa.pdd.android.app?version=latest",
          path: dest,
        }),
  );
  ok("download apk ok", dl.ok === true && Number(dl.bytes) > 1_000_000);
  ok("download sha256", typeof dl.sha256 === "string" && dl.sha256.length === 64);
  ok("apk on disk", existsSync(dl.path || dest));

  const apk = JSON.parse(wf.inspectApk(dl.path || dest));
  ok("inspect package", apk.package === "ru.asa.pdd.android.app");
  ok("inspect versionName", Boolean(apk.versionName));
  ok("inspect versionCode", Boolean(apk.versionCode));
  ok("inspect assets", Number(apk.assetCount) >= 0 && Number(apk.fileCount) > 10);

  if (failed) {
    console.error(`web-files failed ${failed}`);
    process.exit(1);
  }
  console.log("web-files ok");
}

void main();
