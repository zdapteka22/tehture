# Что сейчас реально используют, чтобы агент не врал и не вставал

Проверено запросами 2026-09-23. Ниже только то, что открылось по живым ссылкам.

## Не врать (утверждение ≠ факт)

| Инструмент | Что делает | Ссылка |
|---|---|---|
| **ToolProof** | Квитанция на каждый вызов инструмента (SHA-256 + опциональный HMAC). Потом сверка «агент сказал» vs «что реально вернулось»: VERIFIED / UNVERIFIED / TAMPERED. | https://github.com/Moshe-ship/toolproof |
| **Mizan** | Тот же слой квитанций + гейт до вызова. `mizan verify` код 5, если агент соврал. | https://github.com/Moshe-ship/mizan |
| **NabaOS** (статья) | HMAC-квитанции, классификация каждого утверждения по источнику. 94.2% выдуманных tool-call, <15 мс. | https://www.alphaxiv.org/abs/2603.10060 |
| **agent-polygraph** | Детектор лжи о завершении: «Done» при ошибке инструмента = `lie` (L1). Без зависимостей. | https://github.com/NAJEMWEHBE/agent-polygraph |
| **GroundCheck** | Каждое утверждение сверяет с доказательством, не с мнением другой модели. | https://github.com/zhjai/groundcheck |
| **agent-grounding** | `claim-gate`: сильное утверждение без доказательства блокируется. | https://github.com/LanNguyenSi/agent-grounding |

Практический вывод: агенту нельзя верить на слово «я запустил / я сделал / готово». Нужна **квитанция вызова**, которую модель не может подделать.

## Не вставать (и вставать только по делу)

| Инструмент | Что делает | Ссылка |
|---|---|---|
| **Claude Code Stop hook** | Хук на попытку стопа. Можно вернуть `{"decision":"block"}` и агент продолжает. | https://code.claude.com/docs/en/hooks |
| **claude-code-watchdog** | Stop-hook не даёт выйти, пока ход реально менял файлы. | https://github.com/JonyanDunh/claude-code-watchdog |
| **agents-never-sleep watchdog** | Отдельный процесс. Протух heartbeat → убивает и **перезапускает** run. Лимит рестартов, код 75 если кончились. | https://github.com/TokonoMix/agents-never-sleep |
| **mahimathacker/loopguard** | Стоп не за повтор инструмента, а за повтор + нет прогресса. | https://github.com/mahimathacker/loopguard |
| **ai-loopguard** | Circuit breaker: 3 одинаковых ошибки → эскалация, не тихий выход. | https://github.com/deghosal-2026/ai-loopguard |
| **Tangle** | Дедлок / лайвлок нескольких агентов, потом действие (отмена / эскалация). | https://github.com/intuitai/tangle |

Практический вывод из ANS watchdog (текст с https://raw.githubusercontent.com/TokonoMix/agents-never-sleep/main/docs/watchdog.md):

> Stop-hook не видит зависон. Подпроцесс может клинить, сеть висеть, модель замереть — процесс «живой», сердцебиения нет. Watchdog — отдельный процесс: заметил тишину → перезапустил.

## Что взято в этот loop-guard

1. Старые правила стопа (цель / пользователь / лимит / DENIED) — не трогались.
2. **Классификатор стопа** (polygraph + Stop hook): стоп без причины = UNJUSTIFIED.
3. **Квитанции** (ToolProof / NabaOS): «готово» без записи вызова = ложь.
4. **Watchdog + рестарт** (ANS): процесс умер или heartbeat протух → запустить снова, не больше 3 раз.
