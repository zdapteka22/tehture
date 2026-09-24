@echo off
title loop-guard

if "%~1"=="--selftest" goto selftest
goto main

:selftest
echo SELFTEST: OK
exit /b 0

:main
set MAX_OK=1
node "%~dp0goal-brain.mjs" selftest
if errorlevel 1 set MAX_OK=0
node "%~dp0loop-guard.mjs" selftest
if errorlevel 1 set MAX_OK=0

if "%MAX_OK%"=="1" goto ok
echo RESULT: PROBLEM
echo EXITCODE: 1
exit /b 1

:ok
echo RESULT: OK
echo EXITCODE: 0
exit /b 0
