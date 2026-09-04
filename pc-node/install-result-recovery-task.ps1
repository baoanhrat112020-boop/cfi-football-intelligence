param(
  [string]$NodeRoot = $(if ($env:CFI_PC_NODE_ROOT) { $env:CFI_PC_NODE_ROOT } else { 'D:\CFI\PC-Node' }),
  [string]$SourceWorker = "$PSScriptRoot\cfi-result-recovery-worker.mjs"
)

$ErrorActionPreference = 'Stop'
$taskName = 'CFI-PC-NODE-R4-RESULT-RECOVERY'
$legacyTaskName = 'CFI-PC-NODE-R3-RESULT-RECOVERY'
$src = (Resolve-Path $SourceWorker).Path
$dstDir = Join-Path $NodeRoot 'src'
$dst = Join-Path $dstDir 'cfi-result-recovery-worker.mjs'
$configPath = Join-Path $NodeRoot 'config.json'
$launcher = Join-Path $NodeRoot 'cfi-result-recovery-launch.mjs'
$cmdWrapper = Join-Path $NodeRoot 'CFI-R4-RESULT-RECOVERY.cmd'
$logDir = Join-Path $NodeRoot 'data'
$logPath = Join-Path $logDir 'result-recovery.log'

if (-not (Test-Path $NodeRoot)) { throw "PC Node root not found: $NodeRoot" }
if (-not (Test-Path $configPath)) { throw "PC Node config not found: $configPath" }

$config = Get-Content $configPath -Raw | ConvertFrom-Json
if (-not $config.nodeKey) { throw 'config.json nodeKey missing' }
if (-not $config.ingestUrl) { throw 'config.json ingestUrl missing' }

New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Copy-Item -Force $src $dst

$launcherText = @'
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
[IO.File]::WriteAllText($launcher,$launcherText,[Text.UTF8Encoding]::new($false))

$node = (Get-Command node.exe -ErrorAction Stop).Source
$cmdText = @(
  '@echo off',
  ('cd /d "{0}"' -f $NodeRoot),
  ('"{0}" "{1}" >> "{2}" 2>&1' -f $node,$launcher,$logPath),
  'exit /b %ERRORLEVEL%'
) -join "`r`n"
[IO.File]::WriteAllText($cmdWrapper,$cmdText,[Text.ASCIIEncoding]::new())

Unregister-ScheduledTask -TaskName $legacyTaskName -Confirm:$false -ErrorAction SilentlyContinue

$cmdExe = Join-Path $env:SystemRoot 'System32\cmd.exe'
$action = New-ScheduledTaskAction -Execute $cmdExe -Argument ('/d /s /c "{0}"' -f $cmdWrapper) -WorkingDirectory $NodeRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'CFI R4 targeted post-match result recovery. Pulls selected PENDING snapshots only; requires dual-source HT/FT consensus before canonical settlement.' -Force | Out-Null

Write-Host 'RESULT_RECOVERY_TASK=INSTALLED'
Write-Host "TASK=$taskName"
Write-Host "WORKER=$dst"
Write-Host "LAUNCHER=$launcher"
Write-Host "CMD_WRAPPER=$cmdWrapper"
Write-Host "LOG=$logPath"
Write-Host 'AUTH_SOURCE=config.json'
Write-Host 'CADENCE=5m'
Write-Host 'POLICY=TARGETED_SELECTED_PENDING_ONLY;DUAL_SOURCE;NO_RECONSTRUCTION'
