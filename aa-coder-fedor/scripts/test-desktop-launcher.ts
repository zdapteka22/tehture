import { launcherBatBody } from "../lib/desktop-launcher";

const body = launcherBatBody({
  appRoot: "C:\\Users\\Dir\\AppData\\Local\\AA Coder Fedor 3.0",
  electronExe:
    "C:\\Users\\Dir\\AppData\\Local\\AA Coder Fedor 3.0\\node_modules\\electron\\dist\\electron.exe",
  electronMain: "C:\\Users\\Dir\\AppData\\Local\\AA Coder Fedor 3.0\\electron\\main.cjs",
});

function ok(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL ${name}\n${body}`);
    process.exit(1);
  }
  console.log(`ok ${name}`);
}

ok("cd quoted app root", body.includes('cd /d "C:\\Users\\Dir\\AppData\\Local\\AA Coder Fedor 3.0"'));
ok("start uses working dir", body.includes('start "" /D "C:\\Users\\Dir\\AppData\\Local\\AA Coder Fedor 3.0"'));
ok("electron path quoted", body.includes('"C:\\Users\\Dir\\AppData\\Local\\AA Coder Fedor 3.0\\node_modules\\electron\\dist\\electron.exe"'));
ok("app arg is dot not spaced main", /electron\.exe" \.\r?\n/.test(body));
ok("does not pass main.cjs on start line", !/start "" \/D .*main\.cjs/.test(body));

console.log("desktop-launcher ok");
