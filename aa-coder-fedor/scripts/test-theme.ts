import { readFileSync } from "node:fs";
import path from "path";

function ok(name: string, cond: unknown) {
  if (!cond) {
    console.error("FAIL", name);
    process.exit(1);
  }
  console.log("ok  ", name);
}

const root = process.cwd();
const app = readFileSync(path.join(root, "components/coder-app.tsx"), "utf8");
ok("coder uses lib/theme", app.includes('from "@/lib/theme"') && app.includes("applyTheme"));
ok("coder has light button", /Светлая/.test(app));
ok("coder does not rely on next-themes hook", !app.includes("useTheme"));

const theme = readFileSync(path.join(root, "lib/theme.ts"), "utf8");
ok("theme key persisted", theme.includes("fedor-theme"));
ok("theme toggles html.light", theme.includes('classList.toggle("light"'));

const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
ok("light remaps chrome", css.includes("html.light") && css.includes("#f4f4f5"));

const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
ok("layout has ThemeProvider", layout.includes("ThemeProvider") && layout.includes("./globals.css"));

const electron = readFileSync(path.join(root, "electron/main.cjs"), "utf8");
ok("electron injects theme", electron.includes("fedor-theme") && electron.includes("Светлая"));
ok("electron inserts light css", electron.includes("FEDOR_LIGHT_CSS") && electron.includes("wireFedorTheme"));

const hub = readFileSync(path.join(root, "scripts/fedor-hub.ps1"), "utf8");
ok("hub has light theme", hub.includes("Светлая") && hub.includes("theme.txt"));
ok("hub matches by id/email", hub.includes("Same-User") && hub.includes("Clear-Replies"));
ok("hub does not match deviceLabel for spend", !/deviceLabel -eq \$rep\.deviceLabel/.test(hub));

const start = readFileSync(path.join(root, "scripts/start-grok-coder.ps1"), "utf8");
ok("start sets FEDOR_HUB_DIR", start.includes("FEDOR_HUB_DIR="));

console.log("theme ok");
