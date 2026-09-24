/** IE/mshta installer UI. No ё in this file: HTML uses &#1105;. */

export const SETUP_UI_FILE = "fedor2-setup-ui.txt";
export const SETUP_AD_FILES = [
  "ad-code.jpg",
  "ad-both.jpg",
  "ad-parallel.jpg",
  "ad-memory.jpg",
  "ad-agents.jpg",
  "ad-sbp.jpg",
  "ad-crew.jpg",
  "ad-free.jpg",
] as const;

export function installerHtaHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta http-equiv="X-UA-Compatible" content="IE=11" />
<meta charset="utf-8" />
<HTA:APPLICATION
  ID="FedorSetup"
  APPLICATIONNAME="AA Coder Fedor"
  BORDER="thin"
  CAPTION="yes"
  SHOWINTASKBAR="yes"
  SINGLEINSTANCE="yes"
  SYSMENU="yes"
  SCROLL="no"
  WINDOWSTATE="normal"
/>
<title>AA coder f&#1105;dor 3.0</title>
<style>
  html, body { margin:0; height:100%; overflow:hidden; background:#02060e; color:#e8f2ff;
    font-family:"Segoe UI", Arial, sans-serif; }
  .slides { position:absolute; left:0; right:0; top:0; bottom:0; }
  .slide { position:absolute; left:0; right:0; top:0; bottom:0; display:none;
    background-color:#02060e; background-position:center; background-repeat:no-repeat; background-size:cover; }
  .slide.on { display:block; }
  .a { background-image:url("ad-code.jpg"); }
  .b { background-image:url("ad-both.jpg"); }
  .c { background-image:url("ad-parallel.jpg"); }
  .d { background-image:url("ad-memory.jpg"); }
  .e { background-image:url("ad-agents.jpg"); }
  .s { background-image:url("ad-sbp.jpg"); }
  .r { background-image:url("ad-crew.jpg"); }
  .f { background-image:url("ad-free.jpg"); }
  .shade { position:absolute; left:0; right:0; top:0; bottom:0;
    background:linear-gradient(90deg, rgba(2,6,14,0.72) 0%, rgba(2,6,14,0.22) 46%, rgba(2,6,14,0.08) 100%); }
  .rail { position:absolute; left:0; top:0; bottom:0; width:3px; background:#7ecbff; }
  .brand { position:absolute; left:34px; top:18px; letter-spacing:0.22em; font-size:11px;
    color:#9ec8e8; text-transform:uppercase; }
  .ad { position:absolute; left:40px; right:40%; top:12%; }
  .kicker { letter-spacing:0.28em; font-size:12px; color:#7ecbff; text-transform:uppercase; }
      .ad h2 { margin:14px 0 12px; font-size:36px; font-weight:650; line-height:1.08; width:16em;
    text-shadow:0 4px 18px rgba(0,0,0,0.75); }
  .ad p { margin:0; font-size:16px; color:#d5e6f4; width:32em; line-height:1.45;
    text-shadow:0 2px 10px rgba(0,0,0,0.7); }
  .dock { position:absolute; left:16px; right:16px; bottom:14px;
    background:#071018; border:1px solid #2a5a78; padding:14px 18px 12px; }
  .pct { font-size:34px; font-weight:700; float:left; width:96px; margin-top:2px; color:#7ecbff; }
  .copy { margin-left:108px; }
  .msg { font-size:16px; }
  .sub { margin-top:4px; color:#9db4c8; font-size:13px; }
  .bar { clear:both; margin-top:14px; height:8px; background:#13202c; }
  .fill { height:8px; width:0%; background:#7ecbff; }
  .log { margin-top:8px; font-family:Consolas, "Courier New", monospace; font-size:11px; color:#8aa0b4;
    height:4.8em; overflow:auto; word-wrap:break-word; }
  .credit { margin-top:8px; text-align:center; font-size:11px; color:#6a8498; letter-spacing:0.04em; }
  .err { color:#ffb4a8; }
  .sub.err { color:#ffb4a8; font-size:12px; line-height:1.35; }
  .dots { position:absolute; right:28px; top:20px; }
  .dots i { width:8px; height:8px; background:#2a4458; display:inline-block; margin-left:7px; }
  .dots i.on { background:#7ecbff; }
</style>
</head>
<body>
  <div class="slides">
    <div class="slide on a"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">Код</div>
        <h2>Сила в коде</h2><p>Сила в коде. Пишет и чинит как сильный инженер. Не уступает Grok Build: читает проект, правит файлы, запускает команды и смотрит вывод.</p></div></div>
    <div class="slide b"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">ПК</div>
        <h2>Ваш компьютер</h2><p>Работает с вами за ПК: папки, диск, программы, терминал. То, что вы сделали бы руками — только быстрее. После установки на рабочем столе ярлык: AA Coder Fedor 3.0.</p></div></div>
    <div class="slide c"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">Браузер</div>
        <h2>Живой браузер</h2><p>Открывает Chrome или Edge, заходит на сайты, смотрит страницы, кликает как человек. Нужен, чтобы проверить сайт и войти в сервисы прямо с этого ПК.</p></div></div>
    <div class="slide d"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">Сети</div>
        <h2>Блокчейн и нейросети</h2><p>Контракты, кошельки, сети. Модели, пайплайны, ключи API. Силен там, где код встречается с цепью и с моделью.</p></div></div>
    <div class="slide e"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">Россия</div>
        <h2>Доступ из России без VPN</h2><p>Кодер открывается из России без VPN. Домашний интернет, без обхода блокировок. Работает на обычном канале.</p></div></div>
    <div class="slide s"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">Оплата</div>
        <h2>Оплата российской картой, СБП и криптой</h2><p>Платите российской картой, СБП или криптовалютой. Зарубежная карта не нужна. Тарифы как у Grok. Крипта USDT, BTC, TON. Кодер сам проверяет, что перевод пришёл.</p></div></div>
    <div class="slide r"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">Экипаж</div>
        <h2>Мозговой трест</h2><p>Координатор, архитектор, кодер и критик думают вместе. Короткий вопрос — один ответ. Сложная задача — план, правки, проверка.</p></div></div>
    <div class="slide f"><div class="shade"></div><div class="rail"></div>
      <div class="brand">AA coder f&#1105;dor 3.0</div>
      <div class="ad"><div class="kicker">Память</div>
        <h2>Super Memory</h2><p>Помнит решения проекта. Новый чат не начинает с нуля. На столе ярлык: AA Coder Fedor 3.0.</p></div></div>
  </div>
  <div class="dots" id="dots"><i class="on"></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="dock">
    <div class="row">
      <div class="pct" id="pct">0%</div>
      <div class="copy">
        <div class="msg" id="msg">Ставлю кодер</div>
        <div class="sub" id="sub">Идет установка. Проценты пойдут вверх.</div>
      </div>
    </div>
    <div class="bar"><div class="fill" id="fill"></div></div>
    <div class="log" id="log"></div>
    <div class="credit">&copy; 2026 &middot; Made with by AA it</div>
  </div>
<script>
(function () {
  try { window.resizeTo(1080, 680); window.moveTo((screen.width - 1080) / 2, (screen.height - 680) / 2); } catch (e) {}
  var slides = document.getElementsByClassName("slide");
  var dots = document.getElementById("dots").getElementsByTagName("i");
  var i = 0;
  setInterval(function () {
    slides[i].className = slides[i].className.replace(" on", "");
    dots[i].className = "";
    i = (i + 1) % slides.length;
    slides[i].className = slides[i].className + " on";
    dots[i].className = "on";
  }, 4800);
  var t0 = new Date().getTime();
  function parse(text) {
    var out = { PCT: "0", MSG: "", SUB: "", LOG: "", DONE: "0", ERR: "" };
    var lines = String(text || "").split(/\\r?\\n/);
    var k;
    for (k = 0; k < lines.length; k++) {
      var p = lines[k].indexOf("=");
      if (p < 1) continue;
      out[lines[k].slice(0, p)] = lines[k].slice(p + 1);
    }
    return out;
  }
  function tick() {
    var sec = Math.floor((new Date().getTime() - t0) / 1000);
    try {
      var sh = new ActiveXObject("WScript.Shell");
      var fso = new ActiveXObject("Scripting.FileSystemObject");
      var p = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") + "\\\\Fedor2\\\\fedor2-setup-ui.txt";
      if (!fso.FileExists(p)) p = sh.ExpandEnvironmentStrings("%TEMP%") + "\\\\fedor2-setup-ui.txt";
      if (fso.FileExists(p)) {
        var fh = fso.OpenTextFile(p, 1, false, -1);
        var raw = fh.ReadAll();
        fh.Close();
        var u = parse(raw);
        var n = parseInt(u.PCT, 10);
        if (isNaN(n)) n = 0;
        if (n < 0) n = 0;
        if (n > 100) n = 100;
        document.getElementById("pct").innerText = n + "%";
        document.getElementById("fill").style.width = n + "%";
        if (u.MSG) document.getElementById("msg").innerText = u.MSG;
        if (u.ERR) {
          document.getElementById("sub").innerText = u.ERR;
          document.getElementById("sub").className = "sub err";
          document.getElementById("log").innerText = u.ERR;
          document.getElementById("log").className = "log err";
        } else if (u.SUB) {
          document.getElementById("sub").innerText = u.SUB + " · " + sec + " сек";
          document.getElementById("sub").className = "sub";
        }
        if (u.LOG && !u.ERR) document.getElementById("log").innerText = u.LOG;
        if (u.DONE === "1" && u.ERR) {
          document.getElementById("msg").innerText = "Установка не закончилась";
          document.getElementById("sub").innerText = u.ERR;
          document.getElementById("sub").className = "sub err";
        } else if (u.DONE === "1" && !u.ERR) {
          document.getElementById("msg").innerText = "Готово";
          document.getElementById("sub").innerText = "На рабочем столе ярлык: AA Coder Fedor 3.0";
          setTimeout(function () { try { window.close(); } catch (e2) {} }, 2200);
        }
      } else {
        document.getElementById("sub").innerText = "Готовлю установщик · " + sec + " сек";
      }
    } catch (err) {
      document.getElementById("log").innerText = String(err.message || err);
    }
  }
  setInterval(tick, 400);
  tick();
})();
</script>
</body>
</html>
`;
}
