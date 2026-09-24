import { readFileSync } from "node:fs";
import path from "node:path";

import { installerHtaHtml, SETUP_AD_FILES } from "../lib/installer-hta";

function ok(name: string, cond: unknown) {
  if (!cond) {
    console.error("FAIL", name);
    process.exit(1);
  }
  console.log("ok  ", name);
}

const hta = installerHtaHtml();
ok("no payment slide", !/ЮMoney|оплат|крипт|ad-sbp|ЮKassa/i.test(hta));
ok("no ad images", !/ad-code\.jpg|ad-free\.jpg/.test(hta));
ok("no ad files listed", SETUP_AD_FILES.length === 0);
ok("progress ui", /Ставлю кодер/.test(hta) && /AA Coder Fedor 3.0/.test(hta));
ok("shortcut hint", /ярлык AA Coder Fedor 3.0/.test(hta));

const install = readFileSync(path.join(process.cwd(), "scripts/grok-coder-install.ps1"), "utf8");
ok("install skips public desktop", !/CommonDesktopDirectory/.test(install));
ok("install does not write desktop log", !/AA-Coder-Fedor-install\.log/.test(install));
ok("install keeps files on start warning", /Files are in place/.test(install));
const afterCheck = install.split("Write-Host '[4/5]")[1] || "";
ok("install writes shortcut before start", afterCheck.includes("Write-InstallLaunchers") && afterCheck.indexOf("Write-InstallLaunchers") < afterCheck.indexOf("& $starter"));

const start = readFileSync(path.join(process.cwd(), "scripts/start-grok-coder.ps1"), "utf8");
ok("start skips public desktop", !/CommonDesktopDirectory/.test(start));
ok("start does not wipe launchers on error", !/Remove-InstallLaunchers -ProfileDir/.test(start));
ok("start does not write desktop log", !/AA-Coder-Fedor-install\.log/.test(start));
ok("start does not throw leftover edition", !/Leftover program is/.test(start));

const launcher = readFileSync(path.join(process.cwd(), "lib/desktop-launcher.ts"), "utf8");
ok("launcher uses electron dot", /"\$\{electronExe\}" \./.test(launcher));
ok("launcher skips public desktop write", /Never write to Public Desktop/.test(launcher));

console.log("installer-ui ok");
