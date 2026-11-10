@echo off
chcp 65001 >nul
title Teds
cd /d "%~dp0"

set "APP=dist\win-unpacked\Teds.exe"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

rem Teds is already open: just bring it to the front (the app allows one window).
tasklist /fi "imagename eq Teds.exe" 2>nul | find /i "Teds.exe" >nul
if not errorlevel 1 if exist "%APP%" (
  start "" "%APP%"
  exit /b 0
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo First-time setup, this can take a few minutes...
  call npm install
  if errorlevel 1 goto failed
  if not exist "node_modules\electron\dist\electron.exe" call node node_modules\electron\install.js
)

rem Builds Teds.exe (with the Teds name and logo) into dist\win-unpacked. Windows takes the
rem name and logo for the taskbar and notifications from this exe.
echo Preparing Teds...
call npm run app >build-error.log 2>&1
if errorlevel 1 (
  type build-error.log
  goto failed
)
del build-error.log >nul 2>nul

start "" "%APP%"
exit /b 0

:failed
echo.
echo Teds could not start. Check the error above.
pause
exit /b 1
