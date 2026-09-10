@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Munhang Map requires Node.js 22.13 or newer.
  echo Install the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
node -e "const [major, minor] = process.versions.node.split('.').map(Number); process.exit(major > 22 || (major === 22 && minor >= 13) ? 0 : 1)" >nul 2>nul
if errorlevel 1 (
  echo Installed Node.js is too old for Munhang Map.
  node -v
  echo Munhang Map requires Node.js 22.13 or newer. Install the LTS version from https://nodejs.org and try again.
  pause
  exit /b 1
)
node server.cjs
if errorlevel 1 pause
