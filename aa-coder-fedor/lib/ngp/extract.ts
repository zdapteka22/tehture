import { rememberNgp, type NgpNote } from "./store";

const RULES: Array<{ re: RegExp; kind: NgpNote["kind"]; level: NgpNote["level"] }> = [
  { re: /(?:мне нравится|предпочитаю|я люблю|важно(?: то)?(?: что)?|мне так удобнее|привык к)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:всегда делай|всегда используй|делай как|пиши как|пиши на)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "style", level: "user" },
  { re: /(?:никогда не|не используй|не трогай|не удаляй|не надо|давай без)\s+(.{2,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:стиль(?: кода)?[:\s]+|используй)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "style", level: "user" },
  { re: /(?:i prefer|always use|please always|write in)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:never use|don't use|do not use|no more)\s+(.{2,180}?)(?=[.!?\n]|$)/gi, kind: "preference", level: "user" },
  { re: /(?:решили|решение|будем использовать|convention|архитектур\w*)\s+(.{8,180}?)(?=[.!?\n]|$)/gi, kind: "decision", level: "project" },
];

const CUE =
  /мне нравится|предпочитаю|я люблю|важно то|мне так удобнее|привык к|всегда делай|всегда используй|делай как|пиши как|пиши на|никогда не|не используй|не трогай|не удаляй|не надо|давай без|стиль кода|i prefer|always use|write in|never use|don't use|do not use|no more|решили|будем использовать|convention/i;

function clip(text: string): string {
  const cut = String(text || "").split(/[.!?\n]/)[0] || "";
  return cut.replace(/[.…]+$/, "").replace(/\s+/g, " ").trim().slice(0, 180);
}

function classifySentence(sentence: string): { kind: NgpNote["kind"]; level: NgpNote["level"] } {
  if (/(?:решили|будем использовать|convention|архитектур)/i.test(sentence)) {
    return { kind: "decision", level: "project" };
  }
  if (/(?:пиши|стиль|write in|always use|используй)/i.test(sentence)) {
    return { kind: "style", level: "user" };
  }
  return { kind: "preference", level: "user" };
}

function sentencesOf(text: string): string[] {
  return String(text || "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((part) => clip(part))
    .filter((part) => part.length >= 3);
}

/** Pull durable notes from the user's words. Super Memory is not replaced. */
export function extractNgpFromText(text: string): NgpNote[] {
  const raw = String(text || "");
  if (!raw.trim()) return [];
  const out: NgpNote[] = [];
  const seen = new Set<string>();
  const keep = (kind: NgpNote["kind"], level: NgpNote["level"], piece: string) => {
    if (piece.length < 3) return;
    const key = `${kind}:${piece.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(rememberNgp({ text: piece, kind, level }));
  };
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rule.re.exec(raw))) {
      keep(rule.kind, rule.level, clip(match[1] || ""));
    }
  }
  for (const sentence of sentencesOf(raw)) {
    if (!CUE.test(sentence)) continue;
    const low = sentence.toLowerCase();
    if ([...seen].some((key) => {
      const text = key.slice(key.indexOf(":") + 1);
      return Boolean(text) && (low.includes(text) || text.includes(low));
    })) {
      continue;
    }
    const { kind, level } = classifySentence(sentence);
    keep(kind, level, sentence);
  }
  return out;
}
