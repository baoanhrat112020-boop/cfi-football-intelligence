@echo off
setlocal EnableExtensions EnableDelayedExpansion
title CFI R4 Result Recovery - FINAL

set "ROOT=D:\CFI\PC-Node"
set "TASK=CFI-PC-NODE-R4-RESULT-RECOVERY"
set "OLDTASK=CFI-PC-NODE-R3-RESULT-RECOVERY"
set "LAUNCH=%ROOT%\cfi-result-recovery-launch.mjs"
set "WORKER=%ROOT%\src\cfi-result-recovery-worker.mjs"
set "MAIN=%ROOT%\src\cfi-pc-node.mjs"
set "CONFIG=%ROOT%\config.json"
set "WRAP=%ROOT%\CFI-R4-RESULT-RECOVERY.cmd"
set "LOG=%ROOT%\data\result-recovery.log"

fltmc >nul 2>&1
if not "%ERRORLEVEL%"=="0" (
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:ComSpec -Verb RunAs -ArgumentList '/d','/s','/c','\"\"%~f0\" ELEVATED\"'"
  exit /b
)

echo ============================================================
echo CFI R4 RESULT RECOVERY - FINAL ONE-SHOT
echo ============================================================
echo POWERSHELL_INSTALLER=NONE
echo NETWORK_DOWNLOADS=NONE
echo TARGET=%ROOT%
echo.

if not exist "%ROOT%" goto fail_root
if not exist "%CONFIG%" goto fail_config
if not exist "%MAIN%" goto fail_main
if not exist "%WORKER%" goto fail_worker
if not exist "%LAUNCH%" goto fail_launcher

for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE set "NODE=%%I"
if not defined NODE goto fail_node

if not exist "%ROOT%\data" mkdir "%ROOT%\data" >nul 2>&1

echo [1/5] PRECHECK=PASS
echo NODE=%NODE%
echo LAUNCHER=%LAUNCH%
echo WORKER=%WORKER%

echo [2/5] DIRECT_SMOKE_START
"%NODE%" "%LAUNCH%"
if errorlevel 1 goto fail_smoke
echo DIRECT_SMOKE=PASS

echo [3/5] CREATE_WRAPPER
(
  echo @echo off
  echo cd /d "%ROOT%"
  echo "%NODE%" "%LAUNCH%" ^>^> "%LOG%" 2^>^&1
  echo exit /b %%ERRORLEVEL%%
) > "%WRAP%"
if errorlevel 1 goto fail_wrapper
if not exist "%WRAP%" goto fail_wrapper
echo WRAPPER=PASS

echo [4/5] CREATE_R4_TASK
schtasks.exe /Delete /TN "%OLDTASK%" /F >nul 2>&1
schtasks.exe /Delete /TN "%TASK%" /F >nul 2>&1
schtasks.exe /Create /TN "%TASK%" /TR "cmd.exe /d /s /c %WRAP%" /SC MINUTE /MO 5 /RL HIGHEST /F
if errorlevel 1 goto fail_create

> "%LOG%" echo [CFI-R4-INSTALL] scheduled task verification start

schtasks.exe /Run /TN "%TASK%"
if errorlevel 1 goto fail_run

echo [5/5] VERIFY_TASK_EXECUTION
set /a WAITED=0
:wait_loop
timeout /t 5 /nobreak >nul
set /a WAITED+=5
findstr /C:"CFI RESULT RECOVERY DONE" "%LOG%" >nul 2>&1
if not errorlevel 1 goto task_done
if !WAITED! GEQ 120 goto fail_timeout
goto wait_loop

:task_done
schtasks.exe /Query /TN "%TASK%" /V /FO LIST
if errorlevel 1 goto fail_query

schtasks.exe /Query /TN "%OLDTASK%" >nul 2>&1
if not errorlevel 1 goto fail_old

echo.
echo ============================================================
echo FIX_RESULT=PASS
echo TASK=%TASK%
echo CADENCE=5m
echo MAIN_RUNNER_MUTATED=FALSE
echo NETWORK_DOWNLOADS=NONE
echo POWERSHELL_INSTALLER=NONE
echo LOG=%LOG%
echo ============================================================
pause
exit /b 0

:fail_root
set "ERR=NODE_ROOT_NOT_FOUND"
goto fail
:fail_config
set "ERR=CONFIG_NOT_FOUND"
goto fail
:fail_main
set "ERR=MAIN_R4_NOT_FOUND"
goto fail
:fail_worker
set "ERR=RECOVERY_WORKER_NOT_FOUND"
goto fail
:fail_launcher
set "ERR=RECOVERY_LAUNCHER_NOT_FOUND"
goto fail
:fail_node
set "ERR=NODE_EXE_NOT_FOUND"
goto fail
:fail_smoke
set "ERR=DIRECT_SMOKE_FAILED"
goto fail
:fail_wrapper
set "ERR=WRAPPER_CREATE_FAILED"
goto fail
:fail_create
set "ERR=TASK_CREATE_FAILED"
goto fail
:fail_run
set "ERR=TASK_RUN_FAILED"
goto fail
:fail_timeout
set "ERR=TASK_VERIFY_TIMEOUT"
goto fail
:fail_query
set "ERR=TASK_QUERY_FAILED"
goto fail
:fail_old
set "ERR=LEGACY_R3_RECOVERY_TASK_STILL_EXISTS"
goto fail

:fail
echo.
echo ============================================================
echo FIX_RESULT=FAIL
echo ERROR=%ERR%
echo TASK=%TASK%
echo LOG=%LOG%
echo ============================================================
pause
exit /b 1
