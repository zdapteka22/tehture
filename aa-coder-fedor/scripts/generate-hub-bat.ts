import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const ps1 = readFileSync(path.join(ROOT, "scripts", "fedor-hub.ps1"));
const wrapped = (Buffer.from(ps1).toString("base64").match(/.{1,76}/g) || [""]).join("\r\n");

const head = `@echo off
setlocal EnableExtensions
chcp 65001 >nul
title Fedor uchet
set "GROK_SELF=%~f0"
set "GROK_PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
if not exist "%GROK_PS%" set "GROK_PS=powershell.exe"
if not exist "%GROK_PS%" (
  echo Need Windows 10 and PowerShell.
  pause
  exit /b 1
)
set "GROK_BOOT_DIR=%LOCALAPPDATA%\\Fedor2"
if not defined LOCALAPPDATA set "GROK_BOOT_DIR=%TEMP%"
if not exist "%GROK_BOOT_DIR%" mkdir "%GROK_BOOT_DIR%"
echo Installing Fedor accounting app...
"%GROK_PS%" -NoProfile -ExecutionPolicy Bypass -Command "try { Unblock-File -LiteralPath ([Environment]::GetEnvironmentVariable('GROK_SELF')) } catch {}"
"%GROK_PS%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $self=[Environment]::GetEnvironmentVariable('GROK_SELF'); if(-not $self){throw 'GROK_SELF missing'}; $raw=[IO.File]::ReadAllText($self); $m='-----FEDOR_HUB_BOOT-----'; $i=$raw.LastIndexOf($m); if($i -lt 0){throw 'HUB boot missing'}; $b64=[regex]::Replace($raw.Substring($i+$m.Length),'[^A-Za-z0-9+/=]',''); $la=[Environment]::GetEnvironmentVariable('LOCALAPPDATA'); if(-not $la){$la=[Environment]::GetEnvironmentVariable('TEMP')}; $d=Join-Path $la 'Fedor2'; [void][IO.Directory]::CreateDirectory($d); $p=Join-Path $d 'fedor-hub.ps1'; $bytes=[Convert]::FromBase64String($b64); $bom=[byte[]](239,187,191); if($bytes.Length -lt 3 -or $bytes[0] -ne 239){ $all=New-Object byte[] ($bytes.Length+3); [Buffer]::BlockCopy($bom,0,$all,0,3); [Buffer]::BlockCopy($bytes,0,$all,3,$bytes.Length); $bytes=$all }; [IO.File]::WriteAllBytes($p,$bytes)"
if errorlevel 1 (
  echo Could not read hub file. Copy AA-Coder-Fedor-Hub.bat again.
  pause
  exit /b 1
)
del "%TEMP%\\fedor-hub-alive.flag" >nul 2>&1
start "Fedor uchet" "%GROK_PS%" -NoProfile -STA -ExecutionPolicy Bypass -WindowStyle Hidden -File "%GROK_BOOT_DIR%\\fedor-hub.ps1"
ping -n 4 127.0.0.1 >nul
if not exist "%TEMP%\\fedor-hub-alive.flag" (
  echo App did not start.
  if exist "%TEMP%\\fedor-hub.log" type "%TEMP%\\fedor-hub.log"
  pause
  exit /b 1
)
exit /b 0

-----FEDOR_HUB_BOOT-----
${wrapped}
`;

mkdirSync(path.join(ROOT, "dist"), { recursive: true });
const out = path.join(ROOT, "dist", "AA-Coder-Fedor-Hub.bat");
writeFileSync(out, head.replace(/\n/g, "\r\n"), "utf8");
console.log("wrote", out, Buffer.byteLength(head), "bytes");
