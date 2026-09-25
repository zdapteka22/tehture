import { readFileSync } from "node:fs";
import path from "node:path";

import { IS_FREE_EDITION, SETUP_BAT_NAME, isFreeEdition } from "../lib/brand";
import { PLANS, planById } from "../lib/commerce/plans";
import { payReadinessNote, savePayConfig, getPayConfig, payConfigPath } from "../lib/commerce/pay-config";
import { looksLikeYookassaSecret, shopSetupAdvice, YOOKASSA_SHOP_SETTINGS } from "../lib/commerce/yookassa-shop";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";

function ok(name: string, cond: unknown) {
  if (!cond) {
    console.error("FAIL", name);
    process.exit(1);
  }
  console.log("ok  ", name);
}

ok("compile SKU is paid", IS_FREE_EDITION === false);
ok("setup bat is paid", SETUP_BAT_NAME === "AA-Coder-Fedor-3.0-Setup.bat");
ok("no stamp is paid", isFreeEdition() === false);

ok("trial display is Пробный", PLANS[0].id === "free" && PLANS[0].name === "Пробный");
ok("lite is Fedor Lite", planById("lite").name === "Fedor Lite");
ok("main plan is Fedor", planById("super").name === "Fedor");
ok("plus is Fedor Plus", planById("plus").name === "Fedor Plus");
ok("heavy is Fedor Heavy", planById("heavy").name === "Fedor Heavy");
ok("no SuperGrok names", PLANS.every((p) => !/SuperGrok/i.test(p.name + p.grokTwin)));

const note = payReadinessNote();
ok("pay note has card/SBP/crypto", /карт|СБП|крипт/i.test(note));
ok("pay note has no YuMoney pitch", !/ЮMoney|юмани|YooMoney/i.test(note));

const root = process.cwd();
const payApp = readFileSync(path.join(root, "components/pay-app.tsx"), "utf8");
ok("pay default is SBP", /useState<PayMethod>\("sbp"\)/.test(payApp));
ok("pay button is Карта", /Карта/.test(payApp));
ok("pay app no YuMoney label", !/>\s*ЮMoney\s*</.test(payApp) && !/children: \"ЮMoney\"/.test(payApp));
ok("pay headline is Fedor", /Тарифы Fedor 3\.0/.test(payApp));

const settings = readFileSync(path.join(root, "components/pay-settings.tsx"), "utf8");
ok("settings pitch is card/SBP", /российской карты/.test(settings) && /СБП/.test(settings));
ok("settings no YuMoney pitch", !/ЮMoney \/ ЮKassa/.test(settings));
ok("settings opens shop-settings", settings.includes(YOOKASSA_SHOP_SETTINGS));
ok("live_ is yookassa secret", looksLikeYookassaSecret("live_FakeShopSecretForTestOnly0123456789"));
ok("random token is not yookassa secret", !looksLikeYookassaSecret("oauth-history-token"));
ok("shop advice has accordion", /аккордеон/.test(shopSetupAdvice()) && /Магазин/.test(shopSetupAdvice()));

const hub = mkdtempSync(path.join(os.tmpdir(), "fedor-pay-"));
const prevHub = process.env.FEDOR_HUB_DIR;
process.env.FEDOR_HUB_DIR = hub;
savePayConfig({
  yookassaShopId: "123456",
  yoomoneyToken: "live_FakeShopSecretForTestOnly0123456789",
});
const saved = getPayConfig();
ok("live_ pasted as yumoney token becomes yookassa secret", saved.yookassaSecret.startsWith("live_") && saved.yoomoneyToken === "");
ok("shopId kept", saved.yookassaShopId === "123456");
if (prevHub === undefined) delete process.env.FEDOR_HUB_DIR;
else process.env.FEDOR_HUB_DIR = prevHub;
rmSync(hub, { recursive: true, force: true });
void payConfigPath;

const chrome = readFileSync(path.join(root, "components/coder-app.tsx"), "utf8");
ok("chrome fallback is Пробный", /planName \|\| "Пробный"/.test(chrome));
ok("chrome no Тариф Free", !/Тариф Free/.test(chrome));
ok("chrome keeps ход button", /onClick=\{toggleWorkPanel\}/.test(chrome) && /Ход/.test(chrome));
ok("chrome leftover only behind freeSku", /freeSku \?/.test(chrome));

const hta = readFileSync(path.join(root, "lib/installer-hta.ts"), "utf8");
ok("hta paid copy is Fedor plans", /Fedor Lite/.test(hta));
ok("hta no YuMoney", !/ЮMoney|юмани|YooMoney/i.test(hta));

console.log("paid-edition ok");
