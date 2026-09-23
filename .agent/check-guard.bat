@echo off
chcp 65001 >nul
title loop-guard

if "%~1"=="--selftest" goto selftest
goto main

:selftest
node "%~dp0loop-guard.mjs" selftest
exit /b %errorlevel%

:main
echo [loop-guard] selftest
node "%~dp0loop-guard.mjs" selftest
if errorlevel 1 (
  echo RESULT: PROBLEM
  echo EXITCODE: 1
  exit /b 1
)

echo [loop-guard] enforce
node "%~dp0loop-guard.mjs" enforce
set "G=%errorlevel%"
if "%G%"=="2" echo     ^>^> VERDICT=CONTINUE: внезапная остановка отклонена, процесс продолжается
if "%G%"=="75" echo     ^>^> рестарты кончились

echo RESULT: OK
echo EXITCODE: 0
exit /b 0
