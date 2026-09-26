/** Hard stop: OUR refusal, captcha, or OS access error. Not a third-party API "Access denied". */
const BOUNDARY_RE =
  /(?:^|\n)\s*(DENIED\.|HUMAN CHECK\b|Secret path denied|Refused to launch|Изоляция:)|(?:^|\n)\s*DENIED\b|\bEACCES\b|\bEPERM\b|Стоп\. Система или инструмент отказали \(нет прав|Windows Error:\s*Access is denied|access is denied\.|отказано в доступе/i;

export function isHardBoundary(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/PowerShell выключен|нужна команда cmd\.exe|Setup\.bat через cmd/i.test(raw)) return false;
  if (/^(DENIED)\b/.test(raw)) return true;
  return BOUNDARY_RE.test(raw);
}

export const BOUNDARY_STOP =
  "Стоп. Система или инструмент отказали (нет прав, запрет, капча, секретный путь, изоляция). Не обходи это. Скажи пользователю, чего не хватает, и что можно сделать легально.";

export function shouldStopOnBoundary(observation: string): boolean {
  return isHardBoundary(observation);
}
