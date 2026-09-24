/** After a click: did the page actually change, or was it an accordion? */

export type PageMark = {
  url: string;
  title: string;
  names: string[];
};

let lastClickNeedsTactic = false;
let lastClickedKey = "";

export function noteClickTacticChange(needed: boolean): void {
  lastClickNeedsTactic = Boolean(needed);
}

export function lastClickWasAccordion(): boolean {
  return lastClickNeedsTactic;
}

function normClickKey(key: string): string {
  return String(key || "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();
}

export function noteClickedKey(key: string): void {
  lastClickedKey = normClickKey(key);
}

export function lastClickedKeyValue(): string {
  return lastClickedKey;
}

export function sameRefAfterAccordion(key: string): boolean {
  return lastClickNeedsTactic && Boolean(lastClickedKey) && lastClickedKey === normClickKey(key);
}

export function sameRefAdvice(key: string): string {
  const label = String(key || "кнопка").trim();
  return [
    `Тот же ref «${label}» — это аккордеон, не сломанный клик.`,
    "Не вызывай click_kit и не жми ту же кнопку снова.",
    "Жми появившийся пункт по тексту (Магазин / Интеграция / язык / страна) или browser_press Enter.",
    "Сними snapshot: оверлеи (меню языка, список стран) теперь в дереве.",
  ].join(" ");
}

function stripUrl(url: string): string {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "")
    .replace(/#.*$/, "");
}

export function parsePageMark(text: string): PageMark {
  const raw = String(text || "");
  const url = (raw.match(/^url:\s*(.+)$/m) || [])[1]?.trim() || "";
  const title = (raw.match(/^title:\s*(.+)$/m) || [])[1]?.trim() || "";
  const names: string[] = [];
  for (const hit of raw.matchAll(/\[e\d+\]\s+\S+\s+"([^"]*)"/g)) {
    const name = String(hit[1] || "").trim();
    if (name) names.push(name);
  }
  if (!names.length) {
    for (const hit of raw.matchAll(/\[e\d+\][^\n]*?([А-Яа-яA-Za-z0-9][^\n]{0,60})/g)) {
      const name = String(hit[1] || "").trim();
      if (name) names.push(name);
    }
  }
  return { url, title, names };
}

export function addedNames(before: PageMark, after: PageMark): string[] {
  const prev = new Set(before.names.map((name) => name.toLowerCase()));
  return after.names.filter((name) => name && !prev.has(name.toLowerCase()));
}

export function urlChanged(before: PageMark, after: PageMark): boolean {
  if (!before.url || !after.url) return false;
  return stripUrl(before.url) !== stripUrl(after.url);
}

export function clickMovedPage(before: PageMark, after: PageMark): boolean {
  if (urlChanged(before, after)) return true;
  if (before.title && after.title && before.title !== after.title) return true;
  return addedNames(before, after).length >= 1;
}

/** Same URL and title: click landed, but this is a menu — change tactic, do not swap engines. */
export function clickNeedsTacticChange(before: PageMark, after: PageMark): boolean {
  if (urlChanged(before, after)) return false;
  if (before.title && after.title && before.title !== after.title) return false;
  return true;
}

export function staleClickAdvice(key: string, after: PageMark, opened: string[]): string {
  const label = String(key || "кнопка").trim();
  if (opened.length) {
    return [
      `клик «${label}» прошёл, URL тот же. Раскрылось меню: ${opened.slice(0, 10).join(", ")}.`,
      "Это аккордеон, не ссылка. Не вызывай click_kit и не кликай ту же кнопку снова.",
      "Жми появившийся пункт (Магазин / Интеграция / API) или browser_press Enter.",
    ].join(" ");
  }
  return [
    `клик «${label}» прошёл, страница не сменилась (${after.url || "тот же URL"}).`,
    "Это меню или кнопка без перехода, не сломанный клик. Не вызывай click_kit.",
    "Смени тактику: browser_press Enter, соседний пункт, или snapshot и другой ref.",
  ].join(" ");
}

export function looksLikeStaleClick(text: string): boolean {
  return /страница не сменилась|раскрылось меню|аккордеон, не ссылка|не вызывай click_kit|тот же ref/i.test(
    String(text || ""),
  );
}

export function annotateClickObservation(key: string, beforeText: string, afterText: string): string {
  const before = parsePageMark(beforeText);
  const after = parsePageMark(afterText);
  const needsTactic = clickNeedsTacticChange(before, after);
  noteClickTacticChange(needsTactic);
  if (!needsTactic) return afterText;
  const opened = addedNames(before, after);
  return `${staleClickAdvice(key, after, opened)}\n${afterText}`;
}
