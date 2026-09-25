export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { installErrorLog } = await import("./lib/error-log");
    installErrorLog();
    const { peekUsers, answerPendingHubAsks } = await import("./lib/commerce/store");
    const { flushDailyIfDue } = await import("./lib/commerce/token-sync");
    const tickDaily = () => {
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
    const tickAsks = () => {
      try {
        answerPendingHubAsks();
      } catch {
        // ask poll must not crash the process
      }
    };
    tickDaily();
    tickAsks();
    setInterval(tickDaily, 60 * 60 * 1000);
    setInterval(tickAsks, 3000);
  }
}
