import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

async function main() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "fedor-tokens-"));
  process.env.FEDOR_HUB_DIR = dir;
  process.env.FEDOR_HUB_ADMIN_KEY = "test-admin";

  const { writeLocalSpend, readLocalCopy } = await import("../lib/commerce/copy-local");
  const {
    dailyDue,
    DAY_MS,
    writeTokenAsks,
    pendingAskIds,
    answerLocalAsks,
    readTokenReplies,
    reportMatchesUser,
    ownAskIds,
    clearReplies,
  } = await import("../lib/commerce/token-sync");
  const {
    registerUser,
    consumeChatTurn,
    listUsers,
    checkTokens,
    sortUsers,
    applyTokenReport,
  } = await import("../lib/commerce/store");

  function ok(name: string, cond: unknown) {
    if (!cond) {
      console.error("FAIL", name);
      rmSync(dir, { recursive: true, force: true });
      process.exit(1);
    }
    console.log("ok  ", name);
  }

  try {
    const anna = registerUser({ email: "anna@local.fedor", name: "Анна", deviceLabel: "ПК Анны" });
    const boris = registerUser({ email: "boris@local.fedor", name: "Борис", deviceLabel: "ПК Бориса" });
    ok("два пользователя", anna.id !== boris.id);

    consumeChatTurn(anna.token, "напиши короткий ответ про налоги");
    consumeChatTurn(anna.token, "ещё одно сообщение чтобы списать токены");
    const after = listUsers("test-admin", "tokens");
    const annaRow = after.users.find((u) => u.email === "anna@local.fedor");
    ok("у Анны есть истраченные токены", (annaRow?.lifetimeTokens || 0) > 0);
    ok("сорт по токенам: Анна первая", after.users[0].email === "anna@local.fedor");

    const byName = sortUsers(after.users, "name");
    ok("сорт по имени: Анна затем Борис", byName[0].name === "Анна" && byName[1].name === "Борис");

    applyTokenReport({
      type: "token-report",
      userId: boris.id,
      lifetimeTokens: 9000,
      lastSeenAt: Date.now() + 1000,
      t: Date.now(),
    });
    const created = applyTokenReport({
      type: "token-report",
      email: "copy.pc@local.fedor",
      deviceLabel: "ПК копии",
      usedInWeek: 2500,
      lastSeenAt: Date.now(),
      t: Date.now(),
    });
    ok("отчёт без учётки создаёт пользователя", Boolean(created?.id));
    ok("токены с окна попадают в учёт", (created?.lifetimeTokens || 0) >= 2500);
    const listed = listUsers("test-admin", "tokens");
    ok(
      "в списке видна копия с токенами",
      (listed.users.find((u) => u.email === "copy.pc@local.fedor")?.lifetimeTokens || 0) >= 2500,
    );
    const byVisit = listUsers("test-admin", "lastSeen");
    ok("сорт по визиту: Борис свежее", byVisit.users[0].email === "boris@local.fedor");

    writeLocalSpend(annaRow?.lifetimeTokens || 1, { userId: anna.id, email: anna.email });
    ok("copy.json записан", Boolean(readLocalCopy()?.deviceId));

    const asked = writeTokenAsks([anna.id, boris.id]);
    ok("запросы ушли двум копиям", asked === 2 && pendingAskIds().length === 2);

    const n = answerLocalAsks({
      userId: anna.id,
      email: anna.email,
      lifetimeTokens: annaRow?.lifetimeTokens || 1,
    });
    ok("локальная копия ответила", n >= 1);
    ok("ask Анны снят", !pendingAskIds().includes(anna.id));
    ok("ask Бориса ждёт", pendingAskIds().includes(boris.id));

    const replies = readTokenReplies();
    ok("есть квитанция ответа", replies.some((r) => r.userId === anna.id && r.lifetimeTokens > 0));

    const checked = checkTokens("test-admin", "tokens");
    ok("кнопка проверить: asked > 0", checked.asked >= 1);
    ok(
      "кнопка проверить: Анна с цифрой",
      (checked.users.find((u) => u.email === "anna@local.fedor")?.lifetimeTokens || 0) > 0,
    );

    ok("сутки ещё не прошли", dailyDue(Date.now() - 1000) === false);
    ok("сутки прошли", dailyDue(Date.now() - DAY_MS - 1) === true);
    ok("первый отчёт пора", dailyDue(undefined) === true);

    ok(
      "совпадение только по id/почте",
      reportMatchesUser({ userId: anna.id }, { id: anna.id, email: anna.email }) &&
        !reportMatchesUser({ userId: "other" }, { id: anna.id, email: anna.email }),
    );
    ok(
      "ask чужого id не свой",
      ownAskIds([anna.id, boris.id], { userId: anna.id }).join(",") === anna.id,
    );

    clearReplies();
    writeTokenAsks([anna.id, boris.id]);
    const leaked = answerLocalAsks({ lifetimeTokens: 20000, usedInFreeWindow: 20000 });
    const leakReplies = readTokenReplies();
    ok("без userId не отвечаем всем", leaked <= 1 && leakReplies.every((r) => r.userId !== boris.id));
    ok("Борису не записали 20000", !leakReplies.some((r) => r.userId === boris.id && r.lifetimeTokens === 20000));

    applyTokenReport({
      type: "token-report",
      userId: anna.id,
      email: anna.email,
      deviceLabel: "ПК Бориса",
      lifetimeTokens: 20000,
      usedInFreeWindow: 20000,
      lastSeenAt: Date.now(),
      t: Date.now(),
    });
    const afterClone = listUsers("test-admin", "tokens");
    const borisAfter = afterClone.users.find((u) => u.email === "boris@local.fedor");
    ok("общая метка ПК не копирует 20000 соседу", (borisAfter?.lifetimeTokens || 0) === 9000);

    const cara = registerUser({ email: "cara@local.fedor", name: "Кара", deviceLabel: "один ПК" });
    const dima = registerUser({ email: "dima@local.fedor", name: "Дима", deviceLabel: "один ПК" });
    applyTokenReport({
      type: "token-report",
      userId: cara.id,
      email: cara.email,
      deviceLabel: "один ПК",
      lifetimeTokens: 20000,
      usedInFreeWindow: 20000,
      lastSeenAt: Date.now(),
      t: Date.now(),
    });
    writeLocalSpend(20000, { userId: cara.id, email: cara.email });
    const checkedClone = checkTokens("test-admin", "tokens");
    const dimaRow = checkedClone.users.find((u) => u.email === "dima@local.fedor");
    ok("проверка не ставит 20000 всем", (dimaRow?.lifetimeTokens || 0) !== 20000);

    console.log("token-sync ok");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

void main();
