import { disableNgp, enableNgp, isNgpOn } from "./enabled";
import { extractNgpFromText } from "./extract";
import { NGP_ENTROPY_CHECK, NGP_VALUES } from "./values";
import { recallNgp } from "./store";

export type NgpObserve = "enabled" | "disabled" | "noted" | "off";

const ENABLE_RE = /(?:включи(?:ть)?|turn on|enable)\s+(?:новую\s+память|ngp|новую\s+версию)/i;
const DISABLE_RE = /(?:выключи(?:ть)?|отключи(?:ть)?|turn off|disable)\s+(?:новую\s+память|ngp|новую\s+версию)/i;

export function observeNgpUserText(text: string): NgpObserve {
  const raw = String(text || "");
  try {
    if (ENABLE_RE.test(raw)) {
      enableNgp();
      return "enabled";
    }
    if (DISABLE_RE.test(raw)) {
      disableNgp();
      return "disabled";
    }
    if (!isNgpOn()) return "off";
    extractNgpFromText(raw);
    return "noted";
  } catch {
    return isNgpOn() ? "noted" : "off";
  }
}

export function getNgpPromptBlock(task = ""): string {
  if (!isNgpOn()) return "";
  const hits = recallNgp(task, 8);
  const user = hits.filter((n) => n.level === "user").map((n) => `- ${n.text}`);
  const project = hits.filter((n) => n.level === "project").map((n) => `- ${n.text}`);
  const lines = [
    "<ngp>",
    "This block is the experimental NGP lane. The shipped Super Memory path is unchanged.",
    "<values>",
    NGP_VALUES,
    "</values>",
    user.length ? `<user_profile>\n${user.join("\n")}\n</user_profile>` : "<user_profile></user_profile>",
    project.length ? `<project_memory>\n${project.join("\n")}\n</project_memory>` : "",
    "<entropy_check>",
    NGP_ENTROPY_CHECK,
    "</entropy_check>",
    "</ngp>",
  ];
  return `\n${lines.filter(Boolean).join("\n")}\n`;
}
