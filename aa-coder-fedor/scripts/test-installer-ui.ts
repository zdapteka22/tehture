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

const ads = readFileSync(path.join(process.cwd(), "scripts/generate-ads.py"), "utf8");
ok("ads pay is ru card sbp crypto", /российской картой/.test(ads) && /СБП/.test(ads) && !/Платите через ЮMoney/.test(ads));

const hta = installerHtaHtml();
ok("ad banners listed", SETUP_AD_FILES.includes("ad-code.jpg") && SETUP_AD_FILES.includes("ad-free.jpg") && SETUP_AD_FILES.length >= 6);
ok("hta has slideshow banners", /ad-code\.jpg/.test(hta) && /ad-free\.jpg/.test(hta) && /class="slides"/.test(hta));
ok("hta is not cards page", !/Platyna|Fyatu|виртуальн\w* карт/i.test(hta));
ok("hta has no yumoney pitch", !/ЮMoney|юмани|YooMoney|платите через ю/i.test(hta));
ok("hta pay is ru card sbp crypto", /российской картой/i.test(hta) && /СБП/.test(hta) && /крипт/i.test(hta));
ok("progress ui", /Ставлю кодер/.test(hta));
ok("shortcut hint", /ярлык:? AA Coder Fedor 3\.0/.test(hta));

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
ok("start turns full memory on by default", /FEDOR_NGP/.test(start) && /Set-EnvVar -Name 'FEDOR_NGP' -Value '1'/.test(start));
ok("start ships resume-goal", start.includes("resume-goal.mjs"));

const electron = readFileSync(path.join(process.cwd(), "electron/main.cjs"), "utf8");
ok("electron turns full memory on by default", /FEDOR_NGP/.test(electron) && /process.env.FEDOR_NGP = "1"/.test(electron));

const boot = readFileSync(path.join(process.cwd(), "scripts/fedor-setup-boot.ps1"), "utf8");
ok("boot script is ascii for PS 5.1", /^[\x09\x0a\x0d\x20-\x7e]*$/.test(boot));
ok("boot has no raw cyrillic quotes", !/[А-яЁё]/.test(boot));
ok("boot unpacks ad banners", /\$AdFiles/.test(boot) && /GROK_AD_/.test(boot) && /ad-code\.jpg/.test(boot));

const launcher = readFileSync(path.join(process.cwd(), "lib/desktop-launcher.ts"), "utf8");
ok("launcher uses electron dot", /"\$\{electronExe\}" \./.test(launcher));
ok("launcher skips public desktop write", /Never write to Public Desktop/.test(launcher));

const pack = readFileSync(path.join(process.cwd(), "scripts/rebuild-setup-bats.py"), "utf8");
ok("pack restores ход button", pack.includes('children:"Ход"'));
ok("pack hides leftover chip", pack.includes("false&&(0,a.jsx)(M.$,{size:\"xs\""));
ok("pack injects agent reasoning", pack.includes("Рассуждения агентов") && pack.includes("Что делают"));
ok("pack opens ход on send", pack.includes("s7();let n=s??"));
ok("pack patches with sku", pack.includes("def patch_ui_copy(data: bytes, sku: str = \"paid\")"));
ok("pack wires guard cycle", pack.includes("FEDOR_GUARD_CYCLE") && pack.includes("resume-goal.mjs"));

console.log("installer-ui ok");
