/** Quiet installer window. Progress only — no ads, no payment slides. */

export const SETUP_UI_FILE = "fedor2-setup-ui.txt";
export const SETUP_AD_FILES = [] as const;

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
<title>AA Coder Fedor 3.0</title>
<style>
  html, body { margin:0; height:100%; overflow:hidden; background:#071018; color:#e8f2ff;
    font-family:"Segoe UI", Arial, sans-serif; }
  .box { position:absolute; left:28px; right:28px; top:28px; bottom:28px; }
  .brand { letter-spacing:0.22em; font-size:11px; color:#9ec8e8; text-transform:uppercase; }
  h1 { margin:18px 0 8px; font-size:28px; font-weight:650; }
  .hint { color:#9db4c8; font-size:14px; line-height:1.45; width:36em; }
  .dock { position:absolute; left:0; right:0; bottom:0;
    background:#041017; border:1px solid #2a5a78; padding:16px 18px 12px; }
  .pct { font-size:34px; font-weight:700; float:left; width:96px; margin-top:2px; color:#7ecbff; }
  .copy { margin-left:108px; }
  .msg { font-size:16px; }
  .sub { margin-top:4px; color:#9db4c8; font-size:13px; }
  .bar { clear:both; margin-top:14px; height:8px; background:#13202c; }
  .fill { height:8px; width:0%; background:#7ecbff; }
  .log { margin-top:8px; font-family:Consolas, "Courier New", monospace; font-size:11px; color:#8aa0b4;
    height:3.2em; overflow:auto; word-wrap:break-word; }
  .err { color:#ffb4a8; }
  .sub.err { color:#ffb4a8; font-size:12px; line-height:1.35; }
</style>
</head>
<body>
  <div class="box">
    <div class="brand">AA Coder Fedor 3.0</div>
    <h1>Ставлю кодер</h1>
    <p class="hint">Окно можно не трогать. Когда появится «Готово», на рабочем столе будет ярлык AA Coder Fedor 3.0 — он открывает кодер, не установщик.</p>
    <div class="dock">
      <div class="pct" id="pct">0%</div>
      <div class="copy">
        <div class="msg" id="msg">Ставлю кодер</div>
        <div class="sub" id="sub">Идет установка. Проценты пойдут вверх.</div>
      </div>
      <div class="bar"><div class="fill" id="fill"></div></div>
      <div class="log" id="log"></div>
    </div>
  </div>
<script>
(function () {
  try { window.resizeTo(720, 420); window.moveTo((screen.width - 720) / 2, (screen.height - 420) / 2); } catch (e) {}
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
          setTimeout(function () { try { window.close(); } catch (e2) {} }, 1800);
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
