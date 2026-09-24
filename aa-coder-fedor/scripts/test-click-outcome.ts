import {
  addedNames,
  annotateClickObservation,
  clickMovedPage,
  clickNeedsTacticChange,
  lastClickWasAccordion,
  looksLikeStaleClick,
  noteClickedKey,
  noteClickTacticChange,
  parsePageMark,
  sameRefAdvice,
  sameRefAfterAccordion,
  staleClickAdvice,
  urlChanged,
} from "../lib/click-outcome";
import { looksFailed, verbalLesson } from "../lib/reflexion";
import { looksLikeClickFailure, shouldHealClickKit } from "../lib/click-kit";

const before = parsePageMark(`url: https://yookassa.ru/my/payments
title: ЮKassa
элементы:
- [e32] button "Настройки" @40,400
- [e20] link "Платежи" @40,200
текст: кабинет
`);

const same = parsePageMark(`url: https://yookassa.ru/my/payments
title: ЮKassa
элементы:
- [e32] button "Настройки" @40,400
- [e20] link "Платежи" @40,200
текст: кабинет
`);

const menu = parsePageMark(`url: https://yookassa.ru/my/payments
title: ЮKassa
элементы:
- [e32] button "Настройки" @40,400
- [e33] button "Магазин" @40,430
- [e35] button "Чеки от ЮKassa" @40,460
- [e37] button "Интеграция" @40,490
текст: кабинет
`);

const shop = parsePageMark(`url: https://yookassa.ru/my/shop-settings
title: Магазин
элементы:
- [e1] heading "Магазин" @200,80
текст: shopId
`);

function ok(name: string, cond: boolean) {
  if (!cond) throw new Error(name);
  console.log("ok  ", name);
}

ok("same url", !urlChanged(before, same));
ok("same is stale", !clickMovedPage(before, same));
ok("same needs tactic", clickNeedsTacticChange(before, same));
ok("menu opens", clickMovedPage(before, menu));
ok("menu still tactic", clickNeedsTacticChange(before, menu));
ok("menu names", addedNames(before, menu).join(",") === "Магазин,Чеки от ЮKassa,Интеграция");
ok("navigated", urlChanged(before, shop) && clickMovedPage(before, shop));
ok("shop no tactic", !clickNeedsTacticChange(before, shop));
ok(
  "advice no kit",
  /не вызывай click_kit/i.test(staleClickAdvice("Настройки", same, [])),
);
ok(
  "advice menu",
  /Интеграция/.test(staleClickAdvice("Настройки", menu, addedNames(before, menu))),
);

const beforeText = `url: https://yookassa.ru/my/payments
title: ЮKassa
- [e32] button "Настройки" @40,400`;
const sameText = `url: https://yookassa.ru/my/payments
title: ЮKassa
- [e32] button "Настройки" @40,400`;
const menuText = `url: https://yookassa.ru/my/payments
title: ЮKassa
- [e32] button "Настройки" @40,400
- [e33] button "Магазин" @40,430
- [e37] button "Интеграция" @40,490`;
const shopText = `url: https://yookassa.ru/my/shop-settings
title: Магазин
- [e1] heading "Магазин" @200,80`;

const staleObs = annotateClickObservation("Настройки", beforeText, sameText);
ok("annotate stale", /страница не сменилась/.test(staleObs) && lastClickWasAccordion());
ok("stale is failed for memory", looksFailed(staleObs));
ok("stale is not kit miss", !looksLikeClickFailure(staleObs));
ok("stale lesson no heal", /не вызывай click_kit/i.test(verbalLesson("browser_click", staleObs)));
ok("stale blocks heal", !shouldHealClickKit("кнопка не нажимается"));

noteClickTacticChange(false);
ok("reset tactic", !lastClickWasAccordion());
ok("real miss still heals", shouldHealClickKit("not found timeout"));

const menuObs = annotateClickObservation("Настройки", beforeText, menuText);
ok("annotate menu", /аккордеон/.test(menuObs) && /Магазин/.test(menuObs));
ok("menu blocks heal", lastClickWasAccordion() && !shouldHealClickKit("клик не попадает"));

const shopObs = annotateClickObservation("Настройки", beforeText, shopText);
ok("annotate shop no extra", !/не вызывай click_kit/i.test(shopObs) && !lastClickWasAccordion());
ok("shop click is success", !looksFailed(shopObs) && !looksLikeStaleClick(shopObs));

const hub = require("../coder-v2/src/hub.cjs") as {
  SNAPSHOT_JS?: string;
  clickOutcomeAdvice: (
    target: string,
    snap0: { url?: string; title?: string; nodes?: { name?: string }[] },
    snap: { url?: string; title?: string; nodes?: { name?: string }[] },
  ) => string;
};
const hubAdvice = hub.clickOutcomeAdvice(
  "Настройки",
  { url: "https://yookassa.ru/my/payments", title: "ЮKassa", nodes: [{ name: "Настройки" }] },
  {
    url: "https://yookassa.ru/my/payments",
    title: "ЮKassa",
    nodes: [{ name: "Настройки" }, { name: "Магазин" }, { name: "Интеграция" }],
  },
);
ok("hub accordion", /Интеграция/.test(hubAdvice) && /не вызывай click_kit/i.test(hubAdvice));
ok(
  "hub navigated silent",
  hub.clickOutcomeAdvice(
    "Магазин",
    { url: "https://yookassa.ru/my/payments", title: "ЮKassa", nodes: [] },
    { url: "https://yookassa.ru/my/shop-settings", title: "Магазин", nodes: [] },
  ) === "",
);

noteClickedKey("e32");
noteClickTacticChange(true);
ok("same ref after accordion", sameRefAfterAccordion("e32") && sameRefAfterAccordion("[e32]"));
ok("other ref ok", !sameRefAfterAccordion("Магазин"));
ok("same ref advice", /тот же ref/i.test(sameRefAdvice("e32")) && /не вызывай click_kit/i.test(sameRefAdvice("e32")));
ok("same ref looks stale", looksLikeStaleClick(sameRefAdvice("e32")));
ok("same ref blocks heal", !shouldHealClickKit("кнопка не нажимается"));
ok("snapshot sees overlays", /role="listbox"|role="dialog"|role="menu"/.test(String(hub.SNAPSHOT_JS || "")));

console.log("click-outcome ok");
