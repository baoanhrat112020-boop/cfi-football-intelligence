param(
  [string]$NodeRoot = $(if ($env:CFI_PC_NODE_ROOT) { $env:CFI_PC_NODE_ROOT } else { 'D:\CFI\PC-Node' }),
  [string]$SourceWorker = "$PSScriptRoot\cfi-result-recovery-worker.mjs"
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$TaskName = 'CFI-PC-NODE-R4-RESULT-RECOVERY'
$LegacyTaskName = 'CFI-PC-NODE-R3-RESULT-RECOVERY'
$DstDir = Join-Path $NodeRoot 'src'
$DstWorker = Join-Path $DstDir 'cfi-result-recovery-worker.mjs'
$ConfigPath = Join-Path $NodeRoot 'config.json'
$Launcher = Join-Path $NodeRoot 'cfi-result-recovery-launch.mjs'
$CmdWrapper = Join-Path $NodeRoot 'CFI-R4-RESULT-RECOVERY.cmd'
$TaskXml = Join-Path $NodeRoot 'CFI-R4-RESULT-RECOVERY.xml'
$LogDir = Join-Path $NodeRoot 'data'
$RunLog = Join-Path $LogDir 'result-recovery.log'
$InstallLog = Join-Path $LogDir 'result-recovery-install.log'

function Write-Step([string]$Text) {
  $line = "[$(Get-Date -Format o)] $Text"
  Write-Host $line
  Add-Content -Path $InstallLog -Value $line -Encoding UTF8
}

try {
  if (-not (Test-Path $NodeRoot)) { throw "NODE_ROOT_NOT_FOUND:$NodeRoot" }
  New-Item -ItemType Directory -Force -Path $DstDir | Out-Null
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
  Set-Content -Path $InstallLog -Value '' -Encoding UTF8

  Write-Step "START NodeRoot=$NodeRoot"

  if (-not (Test-Path $ConfigPath)) { throw "CONFIG_NOT_FOUND:$ConfigPath" }
  $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
  if (-not $Config.nodeKey) { throw 'CONFIG_NODE_KEY_MISSING' }
  if (-not $Config.ingestUrl) { throw 'CONFIG_INGEST_URL_MISSING' }
  Write-Step 'CONFIG_CHECK=PASS'

  $Src = (Resolve-Path $SourceWorker).Path
  Copy-Item -Force $Src $DstWorker
  Write-Step "WORKER_COPY=PASS sha256=$((Get-FileHash $DstWorker -Algorithm SHA256).Hash)"

  $LauncherText = @'
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,"config.json"),"utf8"));
const u=new URL(String(cfg.ingestUrl||""));
process.env.SUPABASE_URL ||= `${u.protocol}//${u.host}`;
process.env.CFI_PC_NODE_KEY ||= String(cfg.nodeKey||"");
process.env.CFI_PC_NODE_ID ||= String(cfg.nodeId||"");
if(!process.env.CFI_PC_NODE_KEY) throw new Error("CONFIG_NODE_KEY_MISSING");
await import("./src/cfi-result-recovery-worker.mjs");
'@
  [IO.File]::WriteAllText($Launcher,$LauncherText,[Text.UTF8Encoding]::new($false))
  Write-Step 'LAUNCHER_CREATE=PASS'

  $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
  $CmdText = @(
    '@echo off',
    ('cd /d "{0}"' -f $NodeRoot),
    ('"{0}" "{1}" >> "{2}" 2>&1' -f $NodeExe,$Launcher,$RunLog),
    'exit /b %ERRORLEVEL%'
  ) -join "`r`n"
  [IO.File]::WriteAllText($CmdWrapper,$CmdText,[Text.ASCIIEncoding]::new())
  Write-Step 'CMD_WRAPPER_CREATE=PASS'

  Write-Step 'DIRECT_SMOKE_START'
  $Smoke = & $NodeExe $Launcher 2>&1
  $SmokeExit = $LASTEXITCODE
  foreach ($Line in $Smoke) { Write-Step ("SMOKE> " + [string]$Line) }
  if ($SmokeExit -ne 0) { throw "DIRECT_SMOKE_FAILED:$SmokeExit" }
  if (-not (($Smoke -join "`n") -match 'CFI RESULT RECOVERY DONE')) { throw 'DIRECT_SMOKE_MISSING_DONE_MARKER' }
  Write-Step 'DIRECT_SMOKE=PASS'

  Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue

  $StartBoundary = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')
  $CmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
  $UserSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  if (-not $UserSid) { throw 'CURRENT_USER_SID_UNAVAILABLE' }
  $EscRoot = [Security.SecurityElement]::Escape($NodeRoot)
  $EscCmd = [Security.SecurityElement]::Escape($CmdExe)
  $EscArgs = [Security.SecurityElement]::Escape('/d /s /c "' + $CmdWrapper + '"')
  $EscUserSid = [Security.SecurityElement]::Escape($UserSid)

  $Xml = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>CFI R4 targeted selected-PENDING post-match result recovery. Dual-source consensus only. No reconstruction.</Description>
  </RegistrationInfo>
  <Triggers>
    <CalendarTrigger>
      <Repetition>
        <Interval>PT5M</Interval>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
      <StartBoundary>$StartBoundary</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>$EscUserSid</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>true</RunOnlyIfNetworkAvailable>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <ExecutionTimeLimit>PT4M</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$EscCmd</Command>
      <Arguments>$EscArgs</Arguments>
      <WorkingDirectory>$EscRoot</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
  [IO.File]::WriteAllText($TaskXml,$Xml,[Text.UnicodeEncoding]::new($false,$true))

  $CreateOut = & schtasks.exe /Create /TN $TaskName /XML $TaskXml /F 2>&1
  $CreateExit = $LASTEXITCODE
  foreach ($Line in $CreateOut) { Write-Step ("SCHTASKS_CREATE> " + [string]$Line) }
  if ($CreateExit -ne 0) { throw "TASK_CREATE_FAILED:$CreateExit" }
  Write-Step 'TASK_CREATE=PASS'

  $RunOut = & schtasks.exe /Run /TN $TaskName 2>&1
  $RunExit = $LASTEXITCODE
  foreach ($Line in $RunOut) { Write-Step ("SCHTASKS_RUN> " + [string]$Line) }
  if ($RunExit -ne 0) { throw "TASK_RUN_FAILED:$RunExit" }

  $Deadline = (Get-Date).AddMinutes(2)
  $LastResult = $null
  do {
    Start-Sleep -Seconds 3
    $Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
    $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($Info) { $LastResult = $Info.LastTaskResult }
    if ($Task -and $Task.State -ne 'Running' -and $Info.LastRunTime -gt [datetime]::MinValue) { break }
  } while ((Get-Date) -lt $Deadline)

  $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
  if ($Info.LastTaskResult -ne 0) { throw "TASK_EXECUTION_FAILED:$($Info.LastTaskResult)" }

  $LegacyExists = [bool](Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue)
  if ($LegacyExists) { throw 'LEGACY_R3_RECOVERY_TASK_STILL_EXISTS' }

  Write-Step "TASK_VERIFY=PASS state=$($Task.State) lastResult=$($Info.LastTaskResult) nextRun=$($Info.NextRunTime)"
  Write-Step 'FIX_RESULT=PASS'
  Write-Step 'TASK=CFI-PC-NODE-R4-RESULT-RECOVERY'
  Write-Step 'CADENCE=5m'
  Write-Step 'AUTH_SOURCE=config.json'
  Write-Step 'MAIN_RUNNER_MUTATED=FALSE'
  Write-Step 'POLICY=TARGETED_SELECTED_PENDING_ONLY;DUAL_SOURCE;NO_RECONSTRUCTION'
  Write-Host "INSTALL_LOG=$InstallLog"
  Write-Host "RUN_LOG=$RunLog"
  exit 0
}
catch {
  $Message = $_.Exception.Message
  try { Write-Step ("FIX_RESULT=FAIL error=" + $Message) } catch { Write-Host "FIX_RESULT=FAIL error=$Message" }
  Write-Host "INSTALL_LOG=$InstallLog"
  Write-Host "RUN_LOG=$RunLog"
  exit 1
}
