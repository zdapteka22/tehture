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
    extractNgpFromText,
    getNgpPromptBlock,
    isNgpOn,
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
    observeNgpUserText("мне нравится короткие функции и тесты");
    ok("observe is no-op when off", !existsSync(path.join(dir, "user.json")));

    const promptSrc = readFileSync(path.join(process.cwd(), "lib/prompt.ts"), "utf8");
    ok("prompt calls helper", promptSrc.includes("getNgpPromptBlock(task)"));
    ok("prompt has no hardcoded ngp", !promptSrc.includes("<ngp>"));
    const handleSrc = readFileSync(path.join(process.cwd(), "lib/fyodor/handle.ts"), "utf8");
    ok("handle observes user text", handleSrc.includes("observeNgpUserText(request.userText)"));
    const crewSrc = readFileSync(path.join(process.cwd(), "lib/crew/run.ts"), "utf8");
    ok("crew observes user goal", crewSrc.includes("observeNgpUserText(options.userGoal || \"\")"));

    process.env.FEDOR_NGP = "1";
    ok("flag on", isNgpOn() === true);

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

    const again = extractNgpFromText("мне нравится короткие функции и тесты");
    ok("repeat raises votes", again.some((note) => note.votes >= 2));
    ok("notes not deleted", readNgp("user").notes.length >= 1);

    const hits = recallNgp("TypeScript функции", 8);
    ok("recall finds style", hits.some((note) => /TypeScript|функц/i.test(note.text)));

    const block = getNgpPromptBlock("как писать код");
    ok("prompt has values", /<values>/.test(block) && /Честность/.test(block));
    ok("prompt has entropy", /<entropy_check>/.test(block) && /энтропи/.test(block));
    ok("prompt has profile", /<user_profile>/.test(block) && /короткие функции/.test(block));
    ok("prompt has investigation", /презрен/.test(block));

    rememberNgp({ text: "не плодить дубли", kind: "value", level: "user" });
    ok("manual remember", readNgp("user").notes.some((note) => note.text.includes("дубли")));

    process.env.FEDOR_NGP = "0";
    ok("flag off again", isNgpOn() === false);
    ok("prompt empty after off", getNgpPromptBlock("как писать код") === "");

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
