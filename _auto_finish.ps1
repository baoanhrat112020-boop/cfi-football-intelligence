param([switch]$SkipDeploy,[switch]$NoPush)
$ErrorActionPreference = "Continue"
$root = "D:\CFI\DEEPSEEK\cfi-football-intelligence"
$logDir = "$root\_logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stamp = Get-Date -f yyyyMMdd_HHmmss
$logFile = "$logDir\auto_finish_$stamp.log"
$marker = "$logDir\auto_finish_$stamp.done"
function Log($m){ $line="[$(Get-Date -f 'HH:mm:ss')] $m"; $line | Tee-Object -FilePath $logFile -Append }
Log "=== AUTO FINISH START ==="

$ct = "$root\etl\compute_tendency.py"
$ctTxt = [System.IO.File]::ReadAllText($ct,[System.Text.UTF8Encoding]::new($false))
$ctTxt = $ctTxt -replace 'LOW_MIN_LIFT\s*=\s*2\.0','LOW_MIN_LIFT       = 1.5'
$ctTxt = $ctTxt -replace 'MEDIUM_MIN_LIFT\s*=\s*2\.0','MEDIUM_MIN_LIFT    = 1.75'
[System.IO.File]::WriteAllText($ct,$ctTxt,[System.Text.UTF8Encoding]::new($false))
Log "STEP 1a: threshold updated"
Push-Location "$root\etl"
& python compute_tendency.py --push 2>&1 | Tee-Object -FilePath $logFile -Append
Pop-Location
Log "STEP 1 done"

$worker = "$root\cloudflare-worker\src\index-gpt-core-v5.ts"
Copy-Item $worker "$worker.bak-$stamp"
$wTxt = [System.IO.File]::ReadAllText($worker,[System.Text.UTF8Encoding]::new($false))
if($wTxt -notmatch "async function fetchTeamWarnings"){
    $helper = "async function fetchTeamWarnings(env:any,home:string,away:string):Promise<any[]>{if(!env.SUPABASE_SERVICE_KEY)return[];const names=[home,away].filter(Boolean);if(names.length===0)return[];try{const res=await fetch(```${TIER_C_LOG_SUPABASE_URL}/rest/v1/rpc/cfi_team_tendency_by_names``,{method:'POST',headers:{'apikey':env.SUPABASE_SERVICE_KEY,'Authorization':``Bearer `${env.SUPABASE_SERVICE_KEY}``,'Content-Type':'application/json'},body:JSON.stringify({p_names:names}),signal:AbortSignal.timeout(2500)});if(!res.ok)return[];const rows:any=await res.json();return Array.isArray(rows)?rows.map((r:any)=>({team:r.team_name,market:r.market,flag:r.flag,nMatches:r.n_matches,nEvents:r.n_events,rate:Number(r.rate),lift:Number(r.lift)})):[]}catch(_e){return[]}}`n`nexport default{"
    $idx = $wTxt.IndexOf("export default{")
    if($idx -ge 0){
        $wTxt = $wTxt.Substring(0,$idx) + $helper + $wTxt.Substring($idx + "export default{".Length)
        Log "STEP 2a: helper inserted"
    }
}
[System.IO.File]::WriteAllText($worker,$wTxt,[System.Text.UTF8Encoding]::new($false))
Log "STEP 2 done"

$html = "$root\web\index.html"
Copy-Item $html "$html.bak-$stamp"
$hTxt = [System.IO.File]::ReadAllText($html,[System.Text.UTF8Encoding]::new($false))
if($hTxt -notmatch "\.tendency-warn\{"){
    $hTxt = $hTxt.Replace(
        ".market-approximate{opacity:.95;background:#2a2814}.market-approximate .approx-flag{cursor:help;margin-left:4px}",
        ".market-approximate{opacity:.95;background:#2a2814}.market-approximate .approx-flag{cursor:help;margin-left:4px}.tendency-warn{padding:8px 12px;margin-bottom:6px;border-left:3px solid #f59e0b;background:#2a2314;border-radius:6px;font-size:12px}.tendency-warn.HIGH{border-color:#ef4444;background:#2a1414}.tendency-warn b{color:#ffd23f}.tendency-warn.HIGH b{color:#f87171}")
    Log "STEP 3a: CSS inserted"
}
if($hTxt -notmatch "renderTendencyWarnings"){
    $renderAnchor = 'var list=$("marketList");list.innerHTML="";'
    $renderNew = 'var list=$("marketList");list.innerHTML="";(function(){var w=out&&out.tendencyWarnings;if(!w||!w.length)return;var byTeam={};w.forEach(function(x){(byTeam[x.team]=byTeam[x.team]||[]).push(x)});Object.keys(byTeam).forEach(function(t){var items=byTeam[t];var maxFlag=items.some(function(x){return x.flag==="HIGH"})?"HIGH":"MEDIUM";var el=document.createElement("div");el.className="tendency-warn "+maxFlag;var txt=items.map(function(x){var lift=x.lift?(x.lift.toFixed(2)+"x"):"?";return esc(x.market)+" ("+x.flag+" "+lift+")"}).join(" · ");el.innerHTML="<b>"+esc(t)+"</b>: "+txt;list.appendChild(el)})})();'
    $hTxt = $hTxt.Replace($renderAnchor,$renderNew)
    Log "STEP 3b: render inserted"
}
[System.IO.File]::WriteAllText($html,$hTxt,[System.Text.UTF8Encoding]::new($false))
Log "STEP 3 done"

if(-not $SkipDeploy){
    Push-Location "$root\cloudflare-worker"
    $r = & npx wrangler deploy 2>&1
    $r | Tee-Object -FilePath $logFile -Append
    Pop-Location
    Log "STEP 4: deploy done"
}

if(-not $NoPush){
    Push-Location $root
    & git add etl/compute_tendency.py cloudflare-worker/src/index-gpt-core-v5.ts web/index.html 2>&1 | Tee-Object -FilePath $logFile -Append
    & git commit -m "feat(tendency): threshold A + worker compact warnings + frontend badge" 2>&1 | Tee-Object -FilePath $logFile -Append
    & git push origin main 2>&1 | Tee-Object -FilePath $logFile -Append
    Pop-Location
    Log "STEP 5: commit + push done"
}

Log "=== AUTO FINISH DONE ==="
"OK $stamp" | Set-Content $marker
Log "Marker: $marker"
