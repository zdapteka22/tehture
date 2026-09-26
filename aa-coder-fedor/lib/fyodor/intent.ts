/** Shared intent: treat typos and “filename + fix” as writes so L0 does not swallow edits. */
export const WRITE_RE =
  /(нап+и+ш|добав|создай|исправ|поправ|подправ|почини|реализ|сделай(?!\s+обзор)|зделай|перепис|рефактор|удали|замени|внедри|поменяй|пофик|доработ|вынеси|разнеси|в файл|fix\b|implement|create|add\s|write\s|patch\b|refactor|edit\b|change\s|update\s+(the\s+)?(file|code)|сломай)/i;

export const FILE_RE = /\b[\w./-]+\.(ts|tsx|js|jsx|mjs|cjs|py|md|json|css|html|go|rs)\b/gi;

const QUESTION_LEAD =
  /^(что|как|почему|зачем|кто|где|объясни|расскажи|покажи|посмотри|найди|what |how |why |explain|show )/i;

export function looksLikeBatAsk(text: string): boolean {
  return /(бат(ник| файла?|ником)?|\.bat\b|start\.bat)/i.test(String(text || ""));
}

export function looksLikeNoteAsk(text: string): boolean {
  return /(текстов(ый|ого|ых)?\s*файл|\.txt\b|заметк)/i.test(String(text || ""));
}

export function looksLikeWrite(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (looksLikeOperate(raw)) {
    const hasFile = FILE_RE.test(raw);
    FILE_RE.lastIndex = 0;
    if (!hasFile) return false;
  }
  if (WRITE_RE.test(raw)) return true;
  const hasFile = FILE_RE.test(raw);
  FILE_RE.lastIndex = 0;
  if (hasFile && !QUESTION_LEAD.test(raw)) return true;
  if (/(файл|папк|проект).{0,24}(прав|меня|пиш|созда)/i.test(raw)) return true;
  if ((looksLikeBatAsk(raw) || looksLikeNoteAsk(raw)) && !QUESTION_LEAD.test(raw)) return true;
  return false;
}

export function looksLikeOpen(text: string): boolean {
  return /(открой|открыть|откройте|открыв|open\s+(the\s+)?(file|folder|it)\b|проводник|блокнот|notepad|\bexplorer\b)/i.test(
    String(text || ""),
  );
}

/** Drive a live desktop program: click, type, edit inside the window like a person. */
export function looksLikeOperate(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/(оператор|как человек.{0,32}(за пк|за комп|в программ|в приложен|за этим))/i.test(raw)) return true;
  if (/(управляй|управлять|поуправляй).{0,40}(программ|приложен|окн|excel|word|блокнот|notepad)/i.test(raw)) {
    return true;
  }
  if (/(кликн|напечат|двойной клик|pc_click|pc_type)/i.test(raw)) return true;
  if (/(введи|заполни|правь|поправь|исправ).{0,28}(в окн|в программ|в приложен|в excel|в word|в блокнот)/i.test(raw)) {
    return true;
  }
  if (/(зайди|поработай|работай).{0,20}(в |с )?(программ|приложен|excel|word|блокнот|окн)/i.test(raw)) return true;
  if (
    /в (блокнот|notepad|excel|word|chrome|программ|приложен|окн).{0,32}(напиш|введ|заполн|клик|прав|сохран)/i.test(raw)
  ) {
    return true;
  }
  if (
    /открой.{0,40}(блокнот|notepad|excel|word|программ|приложен).{0,48}(напиш|заполн|клик|отправ|сохран|введ|прав)/i.test(
      raw,
    )
  ) {
    return true;
  }
  if (/(вк|вконтакте|\bvk\.(com|ru)\b).{0,48}(сообществ|групп|паблик)/i.test(raw)) return true;
  if (/(создай|сделай|открой).{0,40}(сообществ|групп|паблик).{0,40}(вк|вконтакте|\bvk\b)/i.test(raw)) return true;
  if (looksLikeBrowserWork(raw)) return true;
  return false;
}

/** Live page / OAuth / form — not a repo edit and not a simple “what is X?”. */
export function looksLikeBrowserWork(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/(в браузер[еу]?|через браузер|браузером)/i.test(raw)) return true;
  if (
    /\b(chrome|chromium|firefox|msedge|google chrome)\b/i.test(raw) &&
    /(открой|зайди|клик|нажми|заполн|перейд|работай)/i.test(raw)
  ) {
    return true;
  }
  if (/(зайди|перейди|открой|откройте).{0,48}(сайт|ссылк|\burl\b|https?:\/\/|www\.|vk\.(com|ru)|oauth)/i.test(raw)) {
    return true;
  }
  if (/(на сайте|на веб-страниц).{0,40}(клик|нажми|заполн|создай|отправ|войди)/i.test(raw)) return true;
  if (/(заполни|отправь).{0,32}(форм|модал)/i.test(raw)) return true;
  if (/\bhttps?:\/\/\S+/i.test(raw) && /(открой|зайди|перейд|клик|заполн|нажми|войди|авториз)/i.test(raw)) {
    return true;
  }
  if (/(oauth|access_token|получен(ия|ие) токен)/i.test(raw)) return true;
  return false;
}

/** Model handed the job back to the user instead of the next click. */
export function looksLikeAskingUser(text: string): boolean {
  return /(напишите|пришлите|вставьте|посмотрите|скиньте|дайте (мне )?(токен|скрин)|что (там )?видно|что дальше\?|жду вас|ваша очередь|скажи чини|(?:^|\n)\s*жду\s*[.!]?\s*$)/i.test(
    String(text || ""),
  );
}

/** A note / folder / program on the PC — not a multi-file coding job. */
export function looksLikeSimpleHostTask(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const hasCodeFile = FILE_RE.test(raw);
  FILE_RE.lastIndex = 0;
  if (hasCodeFile) return false;
  if (looksLikeOperate(raw)) return false;
  if (/(api|сервис|рефактор|тест[аыи]|баг в|компонент|миграц|архитектур)/i.test(raw)) return false;
  if (looksLikeOpen(raw)) return true;
  if (looksLikeBatAsk(raw) || looksLikeNoteAsk(raw)) return true;
  if (/(создай|напиши|сделай|зделай).{0,48}(текстов|заметк|\.txt\b|\.bat\b|бат|файл|блокнот|на рабоч)/i.test(raw)) {
    return true;
  }
  if (/(запуст|открой).{0,24}(блокнот|notepad|калькулятор|chrome|explorer|проводник)/i.test(raw)) return true;
  return false;
}

const FOLLOW_WORK_RE =
  /(продолж|доделай|ещё раз|попробуй ещё|не останавливайся|не останавлиайся|не вставай|чё встал|че встал|че встаешь|делай всё|не останавливайся делай|finish (it|this)|keep going|continue\b|завис|зависа|опять встал|не процес|скажи чини|(чё|че|что|почему).{0,16}долго|hung\b|stuck again|остановк|без конца|вечно останав)/i;

export function looksLikeHangComplaint(text: string): boolean {
  return /(завис|зависа|молч(ит|ишь)|опять встал|не процес|скажи чини|(чё|че|что|почему).{0,16}долго|почему (ты )?встал|опять завис|hung\b|stuck again|остановк|без конца|вечно останав)/i.test(
    String(text || ""),
  );
}

export function looksLikeShortNudge(text: string): boolean {
  const t = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?…]+$/g, "");
  if (!t || looksLikeStopCommand(t)) return false;
  return /^(и|ну|да|ага|угу|ок|далее|дальше|давай|ещё|еще|чини|делай|поехали|го|ну что|и что|ну давай)$/i.test(t);
}

export function looksLikeKeepGoing(text: string): boolean {
  return FOLLOW_WORK_RE.test(String(text || "")) || looksLikeHangComplaint(text) || looksLikeShortNudge(text);
}

/** File / folder / program work that must not stop at a plan. */
export function taskNeedsWork(text: string): boolean {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (looksLikeStopCommand(raw)) return false;
  if (
    looksLikeWrite(raw) ||
    looksLikeOpen(raw) ||
    looksLikeBatAsk(raw) ||
    looksLikeNoteAsk(raw) ||
    looksLikeOperate(raw) ||
    looksLikeBrowserWork(raw)
  ) {
    return true;
  }
  if (FOLLOW_WORK_RE.test(raw) || looksLikeHangComplaint(raw) || looksLikeShortNudge(raw)) return true;
  return false;
}

/** User wants the current run to halt — not a new task. */
export function looksLikeStopCommand(text: string): boolean {
  const raw = String(text || "")
    .trim()
    .replace(/^[«"']+|[»"']+$/g, "")
    .replace(/[!?.,…]+$/g, "")
    .trim()
    .toLowerCase();
  if (!raw) return false;
  if (raw.length > 80) return false;
  if (/^(ну\s+|просто\s+|пожалуйста\s+)*(стоп+|stop+|halt|cancel|abort)(\s+(пожалуйста|now|it|this|the coder|кодер|работу|уже))?$/.test(raw)) {
    return true;
  }
  if (/^(please\s+)?stop(\s+(it|now|please|this))?$/.test(raw)) return true;
  if (
    /^(останови(сь|тесь|те|ться|тся)?|останавливайся|хватит|отмена|отмени|прекрати(те)?|не надо|достаточно|стой)(\s+(пожалуйста|уже|это|работу|кодер))?$/.test(
      raw,
    )
  ) {
    return true;
  }
  return false;
}

/** Model described the work instead of finishing it. «Готово» alone is not proof. */
export function looksUnfinished(text: string): boolean {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (looksLikeNarratingWork(raw)) return true;
  if (
    /(сейчас (сделаю|создам|напишу|открою|исправлю)|могу (сделать|создать|написать)|давай я |план:|шаги:|продолжить\?|хотите чтобы|если нужно, (я )?могу|не успел|осталось|ещё надо|I (will|can|shall) (create|write|open|fix)|let me (create|write|open)|here'?s (the )?plan)/i.test(
      raw,
    )
  ) {
    return true;
  }
  return /(?:^|\n)\s*(?:1[\).]|[-*]|сначала|потом)\s+\S+/m.test(raw) && /(создам|напишу|открою|will |then )/i.test(raw);
}

/** Talked about a step («сейчас читаю», «ход 2») instead of calling a tool. */
export function looksLikeNarratingWork(text: string): boolean {
  const raw = String(text || "");
  if (!raw.trim()) return false;
  if (
    /(сейчас (я )?(читаю|прочитаю|прочту|посмотрю|открою|сделаю|создам|напишу|запущу|проверю|вызову|починю|исправлю|кликну|печатаю|управляю)|ход\s*\d+\s*[—\-:.]|зачитался|подменял действие|имитировать работу|приложение запущено)/i.test(
      raw,
    )
  ) {
    return true;
  }
  return /(let me (read|open|check|run|write|fix)|I('ll| will) (now )?(read|open|check|run|look))/i.test(raw);
}
