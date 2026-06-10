@echo off
setlocal enabledelayedexpansion
title Hey Claude
cd /d "%~dp0"
echo.
echo   ========================================
echo    Hey Claude - talk to your code
echo   ========================================
echo.

REM --- Node.js (auto-install via winget if missing) ---
where node >nul 2>nul
if errorlevel 1 (
  echo  [setup] Node.js not found. Trying to install it automatically...
  winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements >nul 2>nul
  where node >nul 2>nul
  if errorlevel 1 (
    echo.
    echo  [!] Could not auto-install Node.js. Install it once from https://nodejs.org
    echo      then run this again.
    echo.
    pause & exit /b 1
  )
)

REM --- Claude Code CLI (auto-install via npm if missing) ---
where claude >nul 2>nul
if errorlevel 1 (
  where claude.cmd >nul 2>nul
  if errorlevel 1 (
    echo  [setup] Claude Code CLI not found. Installing...
    call npm install -g @anthropic-ai/claude-code
  )
)

echo.
echo  Already use Claude Code in VS Code? You're logged in - the CLI shares that
echo  session, so no re-login is needed.
echo.

REM --- workspace = parent folder (your project), unless overridden ---
if not defined VOICE_WORKSPACE for %%I in ("%CD%\..") do set "VOICE_WORKSPACE=%%~fI"
echo  Workspace: %VOICE_WORKSPACE%
echo  Opening http://localhost:8765 ...
echo  (Ctrl+C to stop)
echo.
start "" http://localhost:8765
node server.js
pause
