import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fedor-ngp-"));
  const previous = process.env.FEDOR_NGP;
  const previousDir = process.env.FEDOR_NGP_DIR;
  delete process.env.FEDOR_NGP;
  process.env.FEDOR_NGP_DIR = dir;

  const {
    disableNgp,
    enableNgp,
    extractNgpFromText,
    getNgpPromptBlock,
    isNgpOn,
    ngpSwitchFile,
    observeNgpUserText,
    readNgp,
    recallNgp,
    rememberNgp,
  } = await import("../lib/ngp");

  function ok(name: string, cond: unknown) {
    if (!cond) {
      console.error("FAIL", name);
      restore();
      rmSync(dir, { recursive: true, force: true });
      process.exit(1);
    }
    console.log("ok  ", name);
  }

  function restore() {
    if (previous === undefined) delete process.env.FEDOR_NGP;
    else process.env.FEDOR_NGP = previous;
    if (previousDir === undefined) delete process.env.FEDOR_NGP_DIR;
    else process.env.FEDOR_NGP_DIR = previousDir;
  }

  try {
    ok("off by default", isNgpOn() === false);
    ok("prompt empty when off", getNgpPromptBlock("стиль кода") === "");
    ok("ordinary text does not enable", observeNgpUserText("мне нравится короткие функции и тесты") === "off");
    ok("no files while off", !existsSync(path.join(dir, "user.json")) && !existsSync(ngpSwitchFile()));

    const promptSrc = readFileSync(path.join(process.cwd(), "lib/prompt.ts"), "utf8");
    ok("prompt calls helper", promptSrc.includes("getNgpPromptBlock(task)"));
    ok("prompt has no hardcoded ngp", !promptSrc.includes("<ngp>"));
    const handleSrc = readFileSync(path.join(process.cwd(), "lib/fyodor/handle.ts"), "utf8");
    ok("handle observes user text", handleSrc.includes("observeNgpUserText(request.userText)"));
    const crewSrc = readFileSync(path.join(process.cwd(), "lib/crew/run.ts"), "utf8");
    ok("crew observes user goal", crewSrc.includes("observeNgpUserText(options.userGoal || \"\")"));

    ok("chat enable", observeNgpUserText("включи новую память") === "enabled");
    ok("file appears after chat enable", existsSync(ngpSwitchFile()));
    ok("on after chat", isNgpOn() === true);
    ok("prompt fills after chat", /<values>/.test(getNgpPromptBlock("как писать код")));

    const prefs = extractNgpFromText(
      "мне нравится короткие функции и тесты. always use TypeScript. решили использовать REST без graphql.",
    );
    ok("extracts notes", prefs.length >= 2);
    ok(
      "user preference kept",
      prefs.some((note) => note.level === "user" && /короткие функции|TypeScript/i.test(note.text)),
    );
    ok(
      "project decision kept",
      prefs.some((note) => note.level === "project" && /REST/i.test(note.text)),
    );

    const first = readNgp("user").notes.find((note) => /короткие функции/.test(note.text));
    extractNgpFromText("мне нравится короткие функции и тесты");
    const second = readNgp("user").notes.find((note) => /короткие функции/.test(note.text));
    ok("same phrase stays one note", Boolean(first) && Boolean(second) && readNgp("user").notes.filter((n) => /короткие функции/.test(n.text)).length === 1);
    ok("repeat marks it stronger", Boolean(second && first && second.votes > first.votes));

    const hits = recallNgp("TypeScript функции", 8);
    ok("recall finds style", hits.some((note) => /TypeScript|функц/i.test(note.text)));

    const block = getNgpPromptBlock("как писать код");
    ok("prompt has values", /<values>/.test(block) && /Честность/.test(block));
    ok("prompt has entropy", /<entropy_check>/.test(block) && /энтропи/.test(block));
    ok("prompt has profile", /<user_profile>/.test(block) && /короткие функции/.test(block));

    rememberNgp({ text: "не плодить дубли", kind: "value", level: "user" });
    ok("manual remember", readNgp("user").notes.some((note) => note.text.includes("дубли")));

    ok("chat disable", observeNgpUserText("выключи новую память") === "disabled");
    ok("off after chat", isNgpOn() === false);
    ok("prompt empty after disable", getNgpPromptBlock("как писать код") === "");
    ok("notes still on disk", readNgp("user").notes.length >= 1);

    enableNgp();
    process.env.FEDOR_NGP = "0";
    ok("env 0 wins over file", isNgpOn() === false);
    delete process.env.FEDOR_NGP;
    disableNgp();
    process.env.FEDOR_NGP = "1";
    ok("env 1 still works", isNgpOn() === true);

    const leftover = readdirSync(dir).filter((name) => name.endsWith(".json"));
    ok("writes stay in ngp dir", leftover.length >= 1);
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
