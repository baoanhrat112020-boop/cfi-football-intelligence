<#
.SYNOPSIS
    CFI ETL orchestrator - chay pull + settle + aggregate.
    Idempotent: chi chay 1 lan/ngay tru khi -Force.
#>
param(
    [switch]$Force,
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$root = "D:\CFI\DEEPSEEK\cfi-football-intelligence"
$etl  = "$root\etl"
$pgBin = "$etl\_pg_portable\pgsql\bin"
$dataDir = "$etl\_pg_portable\data"
$logDir = "$etl\_etl_data\logs"
$today = (Get-Date).ToString("yyyyMMdd")
$marker = "$logDir\etl_$today.ok"
$logFile = "$logDir\etl_$today.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Log($msg) {
    $line = "[$(Get-Date -f 'yyyy-MM-dd HH:mm:ss')] $msg"
    Add-Content -Path $logFile -Value $line -Encoding UTF8
    Write-Host $line
}

Log "=== CFI ETL start ==="

# === 1. Check duplicate ===
if (-not $Force -and (Test-Path $marker)) {
    Log "Da chay hom nay ($marker). Bo qua. Dung -Force de chay lai."
    exit 0
}

# === 2. Ensure Postgres running ===
$listening = (netstat -ano 2>&1 | Select-String ":15433.*LISTENING")
if (-not $listening) {
    Log "Postgres chua chay. Dang start..."
    Start-Process -FilePath "$pgBin\pg_ctl.exe" -ArgumentList "-D","$dataDir","-l","$etl\_pg_portable\pg_start.log","start" -NoNewWindow
    $ok = $false
    for ($i = 0; $i -lt 15; $i++) {
        Start-Sleep 1
        if ((netstat -ano 2>&1 | Select-String ":15433.*LISTENING")) { $ok = $true; break }
    }
    if (-not $ok) { Log "FAIL: Postgres khong start duoc"; exit 1 }
    Log "Postgres started OK"
} else {
    Log "Postgres da chay san"
}

$env:LOCAL_DB_URL = "postgresql://cfi:cfi_local_dev@127.0.0.1:15433/cfi_etl"

# === 3. Pull all tables ===
$tables = @("teams", "team_aliases", "teams_elo", "tier_c_log", "fixtures", "cfi_living_verified_fixtures")
foreach ($t in $tables) {
    Log "PULL $t..."
    $r = & python "$etl\pull.py" --table $t --batch 1000 2>&1
    $r | Add-Content -Path $logFile -Encoding UTF8
    if ($LASTEXITCODE -ne 0) { Log "WARN pull $t exit=$LASTEXITCODE" }
}

# === 3b. Compute team stats ===
Log "TEAM_STATS..."
if ($NoPush) {
    $r = & python "$etl\compute_team_stats.py" 2>&1
} else {
    $r = & python "$etl\compute_team_stats.py" --push 2>&1
}
$r | Add-Content -Path $logFile -Encoding UTF8
if ($LASTEXITCODE -ne 0) { Log "WARN team_stats exit=$LASTEXITCODE" }

# === 4. Settle ===
Log "SETTLE..."
if ($NoPush) {
    $r = & python "$etl\settle.py" --limit 500 2>&1
} else {
    $r = & python "$etl\settle.py" --limit 500 --push 2>&1
}
$r | Add-Content -Path $logFile -Encoding UTF8
if ($LASTEXITCODE -ne 0) { Log "WARN settle exit=$LASTEXITCODE" }

# === 5. Aggregate ===
Log "AGGREGATE..."
if ($NoPush) {
    $r = & python "$etl\aggregate.py" 2>&1
} else {
    $r = & python "$etl\aggregate.py" --push 2>&1
}
$r | Add-Content -Path $logFile -Encoding UTF8
if ($LASTEXITCODE -ne 0) { Log "WARN aggregate exit=$LASTEXITCODE" }

# === 6. Compute team tendency flags ===
Log "TENDENCY..."
if ($NoPush) {
    $r = & python "$etl\compute_tendency.py" 2>&1
} else {
    $r = & python "$etl\compute_tendency.py" --push 2>&1
}
$r | Add-Content -Path $logFile -Encoding UTF8
if ($LASTEXITCODE -ne 0) { Log "WARN tendency exit=$LASTEXITCODE" }

# === 7. Marker ===
"OK $(Get-Date -f 'yyyy-MM-dd HH:mm:ss')" | Set-Content -Path $marker -Encoding UTF8
Log "=== CFI ETL done ==="