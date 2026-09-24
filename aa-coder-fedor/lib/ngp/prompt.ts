import { isNgpOn } from "./enabled";
import { extractNgpFromText } from "./extract";
import { NGP_ENTROPY_CHECK, NGP_VALUES } from "./values";
import { recallNgp } from "./store";

export function observeNgpUserText(text: string): void {
  if (!isNgpOn()) return;
  try {
    extractNgpFromText(text);
  } catch {
    // NGP must never break the ready coder
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
