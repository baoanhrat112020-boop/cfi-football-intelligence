$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$NodeRoot = 'D:\CFI\PC-Node'
$TaskName = 'CFI-PC-NODE-R4-RESULT-RECOVERY'
$LegacyTaskName = 'CFI-PC-NODE-R3-RESULT-RECOVERY'

$Worker = Join-Path $NodeRoot 'src\cfi-result-recovery-worker.mjs'
$Main = Join-Path $NodeRoot 'src\cfi-pc-node.mjs'
$Config = Join-Path $NodeRoot 'config.json'
$Launcher = Join-Path $NodeRoot 'cfi-result-recovery-launch.mjs'
$CmdWrapper = Join-Path $NodeRoot 'CFI-R4-RESULT-RECOVERY.cmd'
$TaskXml = Join-Path $NodeRoot 'CFI-R4-RESULT-RECOVERY.xml'
$LogDir = Join-Path $NodeRoot 'data'
$RunLog = Join-Path $LogDir 'result-recovery.log'
$InstallLog = Join-Path $LogDir 'result-recovery-install.log'

function Step([string]$Text) {
    $line = "[$(Get-Date -Format o)] $Text"
    Write-Host $line
    Add-Content -Path $InstallLog -Value $line -Encoding UTF8
}

try {
    if (-not (Test-Path $NodeRoot)) { throw "NODE_ROOT_NOT_FOUND:$NodeRoot" }
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    Set-Content -Path $InstallLog -Value '' -Encoding UTF8

    Step 'INSTALL_MODE=OFFLINE_EXISTING_R4'
    if (-not (Test-Path $Main)) { throw "MAIN_R4_NOT_FOUND:$Main" }
    if (-not (Test-Path $Worker)) { throw "RECOVERY_WORKER_NOT_FOUND:$Worker" }
    if (-not (Test-Path $Config)) { throw "CONFIG_NOT_FOUND:$Config" }

    $cfg = Get-Content $Config -Raw | ConvertFrom-Json
    if (-not $cfg.nodeKey) { throw 'CONFIG_NODE_KEY_MISSING' }
    if (-not $cfg.ingestUrl) { throw 'CONFIG_INGEST_URL_MISSING' }
    Step 'LOCAL_PREREQUISITES=PASS'

    $LauncherText = @'
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const cfg=JSON.parse(fs.readFileSync(path.join(ROOT,"config.json"),"utf8"));
const u=new URL(String(cfg.ingestUrl||""));
process.env.SUPABASE_URL ||= u.origin;
process.env.CFI_PC_NODE_KEY ||= String(cfg.nodeKey||"");
process.env.CFI_PC_NODE_ID ||= String(cfg.nodeId||"");
if(!process.env.CFI_PC_NODE_KEY) throw new Error("CONFIG_NODE_KEY_MISSING");
await import("./src/cfi-result-recovery-worker.mjs");
'@
    [IO.File]::WriteAllText($Launcher, $LauncherText, [Text.UTF8Encoding]::new($false))
    Step 'LAUNCHER_CREATE=PASS'

    $NodeExe = (Get-Command node.exe -ErrorAction Stop).Source
    $CmdText = @(
        '@echo off',
        ('cd /d "{0}"' -f $NodeRoot),
        ('"{0}" "{1}" >> "{2}" 2>&1' -f $NodeExe, $Launcher, $RunLog),
        'exit /b %ERRORLEVEL%'
    ) -join "`r`n"
    [IO.File]::WriteAllText($CmdWrapper, $CmdText, [Text.ASCIIEncoding]::new())
    Step "CMD_WRAPPER_CREATE=PASS node=$NodeExe"

    Step 'DIRECT_SMOKE_START'
    $Smoke = & $NodeExe $Launcher 2>&1
    $SmokeExit = $LASTEXITCODE
    foreach ($Line in $Smoke) { Step ("SMOKE> " + [string]$Line) }
    if ($SmokeExit -ne 0) { throw "DIRECT_SMOKE_FAILED:$SmokeExit" }
    if (-not (($Smoke -join "`n") -match 'CFI RESULT RECOVERY DONE')) {
        throw 'DIRECT_SMOKE_MISSING_DONE_MARKER'
    }
    Step 'DIRECT_SMOKE=PASS'

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
    [IO.File]::WriteAllText($TaskXml, $Xml, [Text.UnicodeEncoding]::new($false, $true))

    $CreateOut = & schtasks.exe /Create /TN $TaskName /XML $TaskXml /F 2>&1
    $CreateExit = $LASTEXITCODE
    foreach ($Line in $CreateOut) { Step ("SCHTASKS_CREATE> " + [string]$Line) }
    if ($CreateExit -ne 0) { throw "TASK_CREATE_FAILED:$CreateExit" }
    Step 'TASK_CREATE=PASS'

    $RunOut = & schtasks.exe /Run /TN $TaskName 2>&1
    $RunExit = $LASTEXITCODE
    foreach ($Line in $RunOut) { Step ("SCHTASKS_RUN> " + [string]$Line) }
    if ($RunExit -ne 0) { throw "TASK_RUN_FAILED:$RunExit" }

    $Deadline = (Get-Date).AddMinutes(2)
    do {
        Start-Sleep -Seconds 3
        $Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction SilentlyContinue
        $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
        if ($Task -and $Task.State -ne 'Running' -and $Info.LastRunTime -gt [datetime]::MinValue) { break }
    } while ((Get-Date) -lt $Deadline)

    $Task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    $Info = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
    if ($Info.LastTaskResult -ne 0) { throw "TASK_EXECUTION_FAILED:$($Info.LastTaskResult)" }
    if (Get-ScheduledTask -TaskName $LegacyTaskName -ErrorAction SilentlyContinue) {
        throw 'LEGACY_R3_RECOVERY_TASK_STILL_EXISTS'
    }

    Step "TASK_VERIFY=PASS state=$($Task.State) lastResult=$($Info.LastTaskResult) nextRun=$($Info.NextRunTime)"
    Step 'FIX_RESULT=PASS'
    Step 'TASK=CFI-PC-NODE-R4-RESULT-RECOVERY'
    Step 'CADENCE=5m'
    Step 'NETWORK_DOWNLOADS=NONE'
    Step 'AUTH_SOURCE=config.json'
    Step 'MAIN_RUNNER_MUTATED=FALSE'
    Write-Host "INSTALL_LOG=$InstallLog"
    Write-Host "RUN_LOG=$RunLog"
    exit 0
}
catch {
    $Message = $_.Exception.Message
    try { Step ("FIX_RESULT=FAIL error=" + $Message) } catch { Write-Host "FIX_RESULT=FAIL error=$Message" }
    Write-Host "INSTALL_LOG=$InstallLog"
    Write-Host "RUN_LOG=$RunLog"
    exit 1
}
