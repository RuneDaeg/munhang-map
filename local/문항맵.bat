@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Munhang Map requires Node.js 22 or newer.
  echo Install the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
node server.cjs
if errorlevel 1 pause
