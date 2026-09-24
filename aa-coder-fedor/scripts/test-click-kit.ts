import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fedor-click-"));
  process.env.FEDOR_CLICK_KIT_DIR = dir;
  process.env.FEDOR_CLICK_KIT_OFFLINE = "1";

  const { noteClickTacticChange } = await import("../lib/click-outcome");
  const { healClickKits, shouldHealClickKit, looksLikeClickFailure, preferredClickOrder, recordClickResult } = await import("../lib/click-kit");

  function ok(name: string, cond: unknown) {
    if (!cond) {
      console.error("FAIL", name);
      rmSync(dir, { recursive: true, force: true });
      process.exit(1);
    }
    console.log("ok  ", name);
  }

  try {
    noteClickTacticChange(true);
    ok("accordion does not heal", !shouldHealClickKit("кнопка не нажимается"));
    const refused = await healClickKits("кнопка не нажимается");
    ok("heal refuses download", /не качаю|не сломанный клик/i.test(refused) && !/Подбираю набор/.test(refused));

    noteClickTacticChange(false);
    ok("real miss heals", shouldHealClickKit("not found"));
    ok("error text is kit miss", looksLikeClickFailure("не нашёл на странице timed out"));
    const heal = await healClickKits("не нашёл кнопку Настройки");
    ok("heal starts picker", /Подбираю набор/.test(heal));
    ok("heal no accordion lecture", !/аккордеон/.test(heal));
    ok("heal no chrome for testing", !/скачал Chromium|playwright install chromium/i.test(heal));

    const order = preferredClickOrder();
    ok("cdp-js first", order[0] === "cdp-js");
    ok("mouse not preferred", !order.includes("cdp-mouse"));
    ok("no chrome-for-testing kit", !order.includes("playwright-chromium"));

    recordClickResult("cdp-mouse", false, "miss");
    recordClickResult("cdp-mouse", false, "miss");
    recordClickResult("cdp-mouse", false, "miss");
    ok("dead mouse stays out", !preferredClickOrder().includes("cdp-mouse"));
    console.log("click-kit ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
