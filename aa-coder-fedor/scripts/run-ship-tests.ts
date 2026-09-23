import { spawnSync } from "node:child_process";

const SHIP = [
  "test:guard",
  "test:stop",
  "test:fyodor",
  "test:crew",
  "test:agent20",
  "test:pc-operator",
  "test:coder2",
  "test:click",
  "test:click-outcome",
  "test:skills",
  "test:local-llm",
  "test:router",
  "test:paid",
  "test:commerce",
  "test:pay",
  "test:sale",
  "test:presale",
  "test:open",
  "test:harness",
];

let failed = 0;
for (const name of SHIP) {
  const proc = spawnSync("npm", ["run", "-s", name], {
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true,
    shell: process.platform === "win32",
  });
  if ((proc.status ?? 1) !== 0) {
    console.error(`FAIL ${name}`);
    failed += 1;
    process.exit(proc.status ?? 1);
  }
  console.log(`ok ${name}`);
}
if (failed) process.exit(1);
console.log(`ship-tests ok ${SHIP.length}`);
