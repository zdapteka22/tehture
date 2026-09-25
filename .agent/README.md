# loop-guard 2.0 — автоостановка + перезапуск

Остановка агента разрешена только если она **обоснована**.
Внезапная остановка проверяется. Если причины нет — процесс запускается снова.

## Когда останавливаться (как было)

1. Пользователь сказал стоп (`стоп`, `остановись`, `хватит`, `stop`, `cancel`)
2. Все пункты `done_when` подтверждены проверкой
3. Исчерпан `max_loops` → `BLOCKED`
4. Внешний запрет: `DENIED` / `HUMAN CHECK` / `EACCES`

## Что добавлено

Проверка **необоснованной** остановки. Срабатывает, если агент встал сам:

- нет записанной причины
- текст «план / сделаю позже»
- «готово» без квитанции инструмента
- «успех» при ошибке в квитанции (ложь про инструмент)
- «готово» без изменения файла/состояния
- процесс умер, цель ещё открыта
- протух heartbeat
- старый `DONE` от другой задачи

Действие: `VERDICT=CONTINUE`, `ACTION=RESTART`. `restart_command` = `auto` → `resume-goal.mjs` пишет nudge и поднимает процесс, если он мёртв. Цикл кодера зовёт `begin` / `heartbeat` / `receipt` / `classify` сам, не только `check.bat`.
После 3 рестартов подряд → `BLOCKED` (не крутимся вечно).

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
