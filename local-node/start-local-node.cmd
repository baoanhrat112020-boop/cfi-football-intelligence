@echo off
setlocal

cd /d "%~dp0\.."

where node >nul 2>&1
if errorlevel 1 (
  echo [CFI NODE] node.exe not found in PATH.
  exit /b 1
)

:restart
node local-node\index.mjs
set "CFI_NODE_EXIT=%ERRORLEVEL%"

echo [CFI NODE] exited with code %CFI_NODE_EXIT%.
echo [CFI NODE] restarting in 60 seconds...

timeout /t 60 /nobreak >nul
goto restart