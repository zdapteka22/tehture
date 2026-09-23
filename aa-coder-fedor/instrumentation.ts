export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installErrorLog } = await import("./lib/error-log");
    installErrorLog();
    const { peekUsers } = await import("./lib/commerce/store");
    const { flushDailyIfDue } = await import("./lib/commerce/token-sync");
    const tick = () => {
      try {
        for (const user of peekUsers()) {
          flushDailyIfDue({
            userId: user.id,
            email: user.email,
            lifetimeTokens: user.lifetimeTokens || 0,
            usedInWeek: user.usedInWeek,
            usedInFreeWindow: user.usedInFreeWindow,
            lastTokenReportAt: user.lastTokenReportAt,
          });
        }
      } catch {
        // daily report must not crash the process
      }
    };
    tick();
    setInterval(tick, 60 * 60 * 1000);
  }
}
