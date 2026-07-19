@echo off
cd /d "%~dp0"
where pnpm >nul 2>nul
if errorlevel 1 (
  echo pnpm is required. Run: corepack enable
  pause
  exit /b 1
)
start "" pnpm start
