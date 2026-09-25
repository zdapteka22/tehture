# loop-guard 2.1 — стоп только по делу, без ложного рестарта

Остановка агента разрешена только если она **обоснована**.
Текстовый ход, слово «готово» и заголовок «план:» процесс **не** перезапускают.
Необоснованная остановка = `CONTINUE`. Перезапуск только если процесс реально умер.

## Когда останавливаться (как было)

1. Пользователь сказал стоп (`стоп`, `остановись`, `хватит`, `stop`, `cancel`)
2. Все пункты `done_when` подтверждены проверкой
3. Исчерпан `max_loops` → `BLOCKED`
4. Внешний запрет: `DENIED` / `HUMAN CHECK` / `EACCES`

## Что добавлено

Проверка **необоснованной** остановки. Срабатывает, если агент встал сам:

- «сделаю позже» / «потом сделаю» — только как обещание отложить работу
- «цель достигнута» / «задача закрыта» без квитанции — CONTINUE, не рестарт
- ход с вызовом инструмента не считается no_state_change
- процесс умер, цель ещё открыта → RESTART
- heartbeat старше 5 минут у живого процесса → CONTINUE

Действие по умолчанию: `VERDICT=CONTINUE`, `ACTION=CONTINUE`. `restart_command` = `auto` поднимает процесс только если он мёртв. Цикл кодера зовёт `begin` / `heartbeat` / `receipt` / `classify` сам, не только `check.bat`.

## Команды

```
node .agent/loop-guard.mjs selftest
node .agent/loop-guard.mjs begin --goal="..." --done-when="a|b"
node .agent/loop-guard.mjs heartbeat
node .agent/loop-guard.mjs receipt --tool=read --result=ok
node .agent/loop-guard.mjs classify --assistant="готово" --alive=0
node .agent/loop-guard.mjs enforce
node .agent/loop-guard.mjs watchdog --once
```

`enforce` как раньше: `CONTINUE` → код 2 (`process.exit(2)`, не `exitCode`), `DONE` → 0, `BLOCKED` → 1.

Обёртка всегда зовёт `goal-brain check --task <текущая задача>`. Без `--task` сторож не видит смену цели.

Код 2 в cmd.exe: `&` сбрасывает `%ERRORLEVEL%`. Мерить так:

```
cmd /v:on /c "node .agent/loop-guard.mjs enforce & echo !ERRORLEVEL!"
```

`check.bat` / `check-guard.bat`: без `setlocal`, `MAX_OK=1` до проверок, печатают `RESULT` и `EXITCODE: 0|1`. `--selftest` → `SELFTEST: OK`.

`LOOPS.md` пишет Node в UTF-8. Журнал не должен содержать U+FFFD.

Источники паттернов (реальные репозитории, не выдумка): `.agent/RESEARCH.md`.
