@echo off
chcp 65001 >nul
title Teds
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo First-time setup, this can take a few minutes...
  call npm install
  if errorlevel 1 goto failed
  if not exist "node_modules\electron\dist\electron.exe" call node node_modules\electron\install.js
)

echo Preparing Teds...
call npm run build >nul 2>build-error.log
if errorlevel 1 (
  type build-error.log
  goto failed
)
del build-error.log >nul 2>nul

start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:failed
echo.
echo Teds could not start. Check the error above.
pause
exit /b 1
