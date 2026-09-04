param(
  [string]$NodeRoot = "$env:LOCALAPPDATA\CFI-PC-NODE-R3",
  [string]$SourceWorker = "$PSScriptRoot\cfi-result-recovery-worker.mjs"
)

$ErrorActionPreference = 'Stop'
$taskName = 'CFI-PC-NODE-R3-RESULT-RECOVERY'
$src = (Resolve-Path $SourceWorker).Path
$dstDir = Join-Path $NodeRoot 'src'
$dst = Join-Path $dstDir 'cfi-result-recovery-worker.mjs'

if (-not (Test-Path $NodeRoot)) { throw "PC Node root not found: $NodeRoot" }
New-Item -ItemType Directory -Force -Path $dstDir | Out-Null
Copy-Item -Force $src $dst

$node = (Get-Command node.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}"' -f $dst) -WorkingDirectory $NodeRoot
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration ([TimeSpan]::MaxValue)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 4)

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'CFI targeted post-match result recovery. Pulls selected PENDING snapshots only; requires dual-source HT/FT consensus before canonical settlement.' -Force | Out-Null

Write-Host "RESULT_RECOVERY_TASK=INSTALLED"
Write-Host "TASK=$taskName"
Write-Host "WORKER=$dst"
Write-Host "CADENCE=5m"
Write-Host "POLICY=TARGETED_SELECTED_PENDING_ONLY;DUAL_SOURCE;NO_RECONSTRUCTION"
