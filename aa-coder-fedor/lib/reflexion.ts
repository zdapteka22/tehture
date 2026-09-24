/** Reflexion: a failed trajectory becomes a verbal lesson. Shinn et al., NeurIPS 2023. */

import { looksLikeStaleClick } from "./click-outcome";

export function actionFingerprint(name: string, args: Record<string, unknown>): string {
  const keys = Object.keys(args || {}).sort();
  const slim: Record<string, unknown> = {};
  for (const key of keys) {
    const value = args[key];
    slim[key] = typeof value === "string" ? value.slice(0, 400) : value;
  }
  return `${name}:${JSON.stringify(slim)}`;
}

export function looksFailed(observation: string): boolean {
  const raw = String(observation || "");
  if (looksLikeStaleClick(raw)) return true;
  return /error|failed|denied|not found|unknown tool|eacces|eperm|refused|запрещ|отказано/i.test(raw);
}

export function verbalLesson(name: string, observation: string): string {
  const clip = String(observation || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  if (looksLikeStaleClick(observation) || /тот же ref/i.test(observation)) {
    return `Reflexion: клик попал, но это меню/аккордеон, не ссылка. Не вызывай click_kit и не жми тот же ref. Жми появившийся пункт по тексту (Магазин / Интеграция / язык / страна) или browser_press Enter.`;
  }
  if (/browser_click|click_kit/i.test(name) || /не сработал клик|не нашёл на странице|timed out|intercepts pointer/i.test(observation)) {
    return `Reflexion: клик «${clip}» не попал. Не останавливайся и не проси человека нажать. Вызови click_kit с action=heal только если это not found/timeout, затем browser_click по тексту — рабочий набор cdp-js. Chrome for Testing не качай.`;
  }
  return `Reflexion: действие ${name} уже не сработало («${clip}»). Не повторяй тот же вызов с теми же аргументами. Если это JSON error_code / Access denied API — смени параметры и вызови снова. Останавливайся только когда Observation начинается с DENIED. / HUMAN CHECK / EACCES.`;
}

export class FailureMemory {
  private counts = new Map<string, number>();
  private last = new Map<string, string>();

  seen(fingerprint: string): number {
    return this.counts.get(fingerprint) || 0;
  }

  lastObservation(fingerprint: string): string {
    return this.last.get(fingerprint) || "";
  }

  rememberFailure(fingerprint: string, observation = ""): number {
    const next = this.seen(fingerprint) + 1;
    this.counts.set(fingerprint, next);
    if (observation) this.last.set(fingerprint, observation);
    return next;
  }
}
