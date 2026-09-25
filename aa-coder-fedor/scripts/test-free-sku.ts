import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fedor-sku-"));
  const prev = {
    FEDOR_SKU: process.env.FEDOR_SKU,
    FEDOR_FREE: process.env.FEDOR_FREE,
    FEDOR_EDITION: process.env.FEDOR_EDITION,
    FEDOR_APP_ROOT: process.env.FEDOR_APP_ROOT,
    cwd: process.cwd(),
  };

  function restore() {
    for (const key of ["FEDOR_SKU", "FEDOR_FREE", "FEDOR_EDITION", "FEDOR_APP_ROOT"] as const) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
    process.chdir(prev.cwd);
  }

  function ok(name: string, cond: unknown) {
    if (!cond) {
      restore();
      rmSync(dir, { recursive: true, force: true });
      console.error("FAIL", name);
      process.exit(1);
    }
    console.log("ok  ", name);
  }

  try {
    delete process.env.FEDOR_SKU;
    delete process.env.FEDOR_FREE;
    delete process.env.FEDOR_EDITION;
    process.env.FEDOR_APP_ROOT = dir;
    process.chdir(dir);

    const { isFreeEdition, IS_FREE_EDITION } = await import("../lib/brand");
    ok("compile default stays paid", IS_FREE_EDITION === false);
    ok("no stamp is paid", isFreeEdition() === false);

    writeFileSync(path.join(dir, ".fedor-sku"), "free\n");
    ok("stamp file is free", isFreeEdition() === true);

    writeFileSync(path.join(dir, ".fedor-sku"), "paid\n");
    ok("paid stamp is paid", isFreeEdition() === false);

    mkdirSync(path.join(dir, ".next"), { recursive: true });
    writeFileSync(path.join(dir, ".next", "FEDOR_SKU"), "free\n");
    ok("next stamp is free", isFreeEdition() === true);

    writeFileSync(path.join(dir, ".next", "FEDOR_SKU"), "paid\n");
    process.env.FEDOR_SKU = "free";
    ok("env FEDOR_SKU wins", isFreeEdition() === true);

    const chat = (await import("node:fs")).readFileSync(path.join(prev.cwd, "app/api/chat/route.ts"), "utf8");
    ok("chat uses runtime helper", chat.includes("isFreeEdition()"));
    ok("chat does not use compile flag", !chat.includes("IS_FREE_EDITION"));

    const store = (await import("node:fs")).readFileSync(path.join(prev.cwd, "lib/commerce/store.ts"), "utf8");
    ok("meter skips free sku", store.includes("if (isFreeEdition())"));

    const sku = (await import("node:fs")).readFileSync(path.join(prev.cwd, "app/api/sku/route.ts"), "utf8");
    ok("sku route uses runtime helper", sku.includes("isFreeEdition()"));

    const chrome = (await import("node:fs")).readFileSync(path.join(prev.cwd, "components/coder-app.tsx"), "utf8");
    ok("chrome asks /api/sku", chrome.includes("/api/sku"));
    ok("chrome leftover uses freeSku", chrome.includes("freeSku") && !/if \(!IS_FREE_EDITION && !token\)/.test(chrome));
    ok("chrome has no header leftover chip", !/planName} ·/.test(chrome));
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("free-sku ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
