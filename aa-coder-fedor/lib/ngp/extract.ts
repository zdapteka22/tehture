import { rememberNgp, type NgpNote } from "./store";

const RULES: Array<{ re: RegExp; kind: NgpNote["kind"]; level: NgpNote["level"] }> = [
  { re: /(?:мне нравится|предпочитаю|я люблю|важно(?: то)?(?: что)?)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:всегда делай|всегда используй|делай как)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "style", level: "user" },
  { re: /(?:никогда не|не используй|не трогай|не удаляй)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:стиль(?: кода)?[:\s]+|пиш[уи] как)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "style", level: "user" },
  { re: /(?:i prefer|always use|please always)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:never use|don't use|do not use)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:решили|решение|будем использовать|convention|архитектур\w*)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "decision", level: "project" },
];

function clip(text: string): string {
  const cut = String(text || "").split(/[.!?\n]/)[0] || "";
  return cut.replace(/[.…]+$/, "").replace(/\s+/g, " ").trim().slice(0, 180);
}

/** Pull durable notes from the user's words. Safe if NGP is off — caller decides. */
export function extractNgpFromText(text: string): NgpNote[] {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const out: NgpNote[] = [];
  const seen = new Set<string>();
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.re.exec(raw))) {
      const piece = clip(match[1] || "");
      if (piece.length < 8) continue;
      const key = `${rule.kind}:${piece.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(rememberNgp({ text: piece, kind: rule.kind, level: rule.level }));
    }
  }
  return out;
}
