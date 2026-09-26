import { readFileSync } from "node:fs";
import path from "node:path";

import { formatDrainedInterjections, shouldAttachToRunningTurn } from "../lib/follow-up-loop";
import {
  abortJob,
  attachToRunningJob,
  beginJob,
  drainInterjections,
  endJob,
  enqueueInterjection,
  hasActiveJob,
} from "../lib/run-control";

function ok(name: string, cond: unknown) {
  if (!cond) {
    console.error("FAIL", name);
    process.exit(1);
  }
  console.log("ok  ", name);
}

ok("idle starts a job", shouldAttachToRunningTurn("скачай apk", false) === "start");
ok("live follow-up queues", shouldAttachToRunningTurn("и", true) === "queue");
ok("live new line also queues", shouldAttachToRunningTurn("ещё проверь sha256", true) === "queue");
ok("stop aborts even while live", shouldAttachToRunningTurn("стоп", true) === "stop");
ok("stop while idle still stop", shouldAttachToRunningTurn("stop", false) === "stop");

const formatted = formatDrainedInterjections(["и", "  "]);
ok("format keeps the line", formatted.includes("— и"));
ok("format says do not restart", /не начинай задачу заново/i.test(formatted));
ok("empty drain formats empty", formatDrainedInterjections(["", "  "]) === "");

const thread = `follow-up-loop-test-${Date.now()}`;
const first = beginJob(thread);
ok("job is live", hasActiveJob(thread));
const second = beginJob(thread);
ok("second beginJob does not kill", first === second && !first.signal.aborted);
ok("queue while live", enqueueInterjection(thread, "и") === true);
ok("attach helper queues", attachToRunningJob(thread, "и чё") === true);
const drained = drainInterjections(thread);
ok("drain keeps both pings", drained.join("|") === "и|и чё");
ok("second drain is empty", drainInterjections(thread).length === 0);

enqueueInterjection(thread, "не сбрасывай");
const stopped = abortJob(thread);
ok("abort stops the job", stopped && first.signal.aborted && !hasActiveJob(thread));
ok("abort clears the queue", drainInterjections(thread).length === 0);
ok("idle attach fails", attachToRunningJob(thread, "и") === false);

const fresh = beginJob(thread);
ok("new job after abort", hasActiveJob(thread) && fresh !== first);
endJob(thread, fresh);
ok("endJob clears idle", !hasActiveJob(thread));

const chat = readFileSync(path.join(process.cwd(), "app", "api", "chat", "route.ts"), "utf8");
ok("chat uses attach helper", /attachToRunningJob/.test(chat) && /shouldAttachToRunningTurn/.test(chat));
const crew = readFileSync(path.join(process.cwd(), "lib", "crew", "run.ts"), "utf8");
ok("crew drains follow-ups", /drainInterjections/.test(crew) && /formatDrainedInterjections/.test(crew));

console.log("follow-up-loop ok");
