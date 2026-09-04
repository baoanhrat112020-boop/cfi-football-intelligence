@echo off
setlocal EnableExtensions
title CFI R4 Result Recovery Installer

set "ROOT=D:\CFI\PC-Node"
set "COMMIT=0fe88e7590474e0687d3fafb7df0a1eeb0e3357f"
set "TMPDIR=%TEMP%\CFI-R4-RESULT-RECOVERY-INSTALL"
set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"

if /I not "%~1"=="ELEVATED" (
  "%PS%" -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:ComSpec -Verb RunAs -ArgumentList '/d','/s','/c','\"\"%~f0\" ELEVATED\"'"
  exit /b
)

echo ============================================================
echo CFI R4 RESULT RECOVERY - ONE CLICK INSTALL
echo ============================================================
echo ROOT=%ROOT%
echo COMMIT=%COMMIT%
echo.

if not exist "%ROOT%\config.json" (
  echo FIX_RESULT=FAIL
  echo ERROR=CONFIG_NOT_FOUND:%ROOT%\config.json
  pause
  exit /b 1
)

if not exist "%ROOT%\src\cfi-pc-node.mjs" (
  echo FIX_RESULT=FAIL
  echo ERROR=MAIN_R4_NOT_FOUND:%ROOT%\src\cfi-pc-node.mjs
  pause
  exit /b 1
)

if exist "%TMPDIR%" rmdir /s /q "%TMPDIR%"
mkdir "%TMPDIR%" >nul 2>&1
if errorlevel 1 (
  echo FIX_RESULT=FAIL
  echo ERROR=TEMP_DIR_CREATE_FAILED
  pause
  exit /b 1
)

set "WORKER=%TMPDIR%\cfi-result-recovery-worker.mjs"
set "INSTALLER=%TMPDIR%\install-result-recovery-task.ps1"

echo [1/3] Downloading verified R4 files from merged commit...

"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';" ^
  "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/baoanhrat112020-boop/cfi-football-intelligence/%COMMIT%/pc-node/cfi-result-recovery-worker.mjs' -OutFile '%WORKER%';" ^
  "Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/baoanhrat112020-boop/cfi-football-intelligence/%COMMIT%/pc-node/install-result-recovery-task.ps1' -OutFile '%INSTALLER%';"

if errorlevel 1 (
  echo FIX_RESULT=FAIL
  echo ERROR=DOWNLOAD_FAILED
  pause
  exit /b 1
)

echo [2/3] Installing and verifying CFI-PC-NODE-R4-RESULT-RECOVERY...

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%" -NodeRoot "%ROOT%" -SourceWorker "%WORKER%"
set "RC=%ERRORLEVEL%"

if not "%RC%"=="0" (
  echo.
  echo FIX_RESULT=FAIL
  echo INSTALLER_EXIT=%RC%
  echo INSTALL_LOG=%ROOT%\data\result-recovery-install.log
  echo RUN_LOG=%ROOT%\data\result-recovery.log
  pause
  exit /b %RC%
)

echo [3/3] Final verification...

"%PS%" -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$t=Get-ScheduledTask -TaskName 'CFI-PC-NODE-R4-RESULT-RECOVERY' -ErrorAction Stop;" ^
  "$i=Get-ScheduledTaskInfo -TaskName 'CFI-PC-NODE-R4-RESULT-RECOVERY' -ErrorAction Stop;" ^
  "$old=Get-ScheduledTask -TaskName 'CFI-PC-NODE-R3-RESULT-RECOVERY' -ErrorAction SilentlyContinue;" ^
  "if($old){throw 'LEGACY_R3_RECOVERY_TASK_STILL_EXISTS'};" ^
  "if($i.LastTaskResult -ne 0){throw ('TASK_LAST_RESULT_'+$i.LastTaskResult)};" ^
  "Write-Host ('TASK='+$t.TaskName);" ^
  "Write-Host ('STATE='+$t.State);" ^
  "Write-Host ('LAST_RESULT='+$i.LastTaskResult);" ^
  "Write-Host ('NEXT_RUN='+$i.NextRunTime);" ^
  "Write-Host 'FIX_RESULT=PASS';"

if errorlevel 1 (
  echo.
  echo FIX_RESULT=FAIL
  echo ERROR=FINAL_VERIFY_FAILED
  echo INSTALL_LOG=%ROOT%\data\result-recovery-install.log
  echo RUN_LOG=%ROOT%\data\result-recovery.log
  pause
  exit /b 1
)

echo.
echo ============================================================
echo CFI R4 RESULT RECOVERY INSTALLED
echo TASK=CFI-PC-NODE-R4-RESULT-RECOVERY
echo CADENCE=5m
echo AUTH_SOURCE=config.json
echo MAIN_RUNNER_MUTATED=FALSE
echo POLICY=TARGETED_SELECTED_PENDING_ONLY;DUAL_SOURCE;NO_RECONSTRUCTION
echo ============================================================
echo.
pause
exit /b 0
