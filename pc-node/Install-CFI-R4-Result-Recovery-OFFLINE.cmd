@echo off
setlocal EnableExtensions
title CFI R4 Result Recovery - Offline Installer

set "PS=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
set "INSTALLER=%~dp0Install-CFI-R4-Result-Recovery-OFFLINE.ps1"

if /I not "%~1"=="ELEVATED" (
  "%PS%" -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath $env:ComSpec -Verb RunAs -ArgumentList '/d','/s','/c','\"\"%~f0\" ELEVATED\"'"
  exit /b
)

echo ============================================================
echo CFI R4 RESULT RECOVERY - OFFLINE ONE-SHOT INSTALL
echo ============================================================
echo NETWORK_DOWNLOADS=NONE
echo TARGET=D:\CFI\PC-Node
echo.

if not exist "%INSTALLER%" (
  echo FIX_RESULT=FAIL
  echo ERROR=OFFLINE_INSTALLER_MISSING
  pause
  exit /b 1
)

"%PS%" -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER%"
set "RC=%ERRORLEVEL%"

echo.
if "%RC%"=="0" (
  echo ============================================================
  echo FIX_RESULT=PASS
  echo TASK=CFI-PC-NODE-R4-RESULT-RECOVERY
  echo CADENCE=5m
  echo ============================================================
) else (
  echo ============================================================
  echo FIX_RESULT=FAIL
  echo INSTALLER_EXIT=%RC%
  echo LOG=D:\CFI\PC-Node\data\result-recovery-install.log
  echo ============================================================
)

pause
exit /b %RC%
