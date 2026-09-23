import {
  dragWorkWidth,
  loadWorkPinned,
  restoreWorkWidth,
  workDockShown,
  WORK_W_DEFAULT,
} from "../lib/work-pane";

function ok(name: string, cond: boolean) {
  if (!cond) {
    console.error(`FAIL ${name}`);
    process.exit(1);
  }
  console.log(`ok ${name}`);
}

ok("closed stays closed even if mouse hovers", workDockShown(false, true) === false);
ok("open stays open", workDockShown(true, false) === true);
ok("open with hover still open", workDockShown(true, true) === true);
ok("default not pinned", loadWorkPinned(undefined) === false);
ok("only explicit true pins", loadWorkPinned(true) === true);
ok("restore tiny width", restoreWorkWidth(0) === WORK_W_DEFAULT);
ok("drag shut closes", dragWorkWidth(320, 300).open === false);

console.log("work-pane ok");
