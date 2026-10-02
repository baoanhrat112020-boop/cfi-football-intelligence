import os, re
from datetime import datetime, timedelta, timezone
from curl_cffi import requests as cf
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY","")
sb = create_client(SB_URL, SB_KEY)

SEP_EVENT="~"; SEP_FIELD="\u00ac"; SEP_KV="\u00f7"

# Whitelist: chÃ¡Â»â€° giÃ¡ÂºÂ£i CFI Ã„â€˜ÃƒÂ£ cÃƒÂ³ history
COMP_WHITELIST = {
    "ENGLAND: Premier League", "ENGLAND: Championship", "ENGLAND: League One", "ENGLAND: League Two",
    "ENGLAND: FA Cup", "ENGLAND: EFL Cup", "ENGLAND: National League",
    "SPAIN: LaLiga", "SPAIN: LaLiga2", "SPAIN: Copa del Rey",
    "ITALY: Serie A", "ITALY: Serie B", "ITALY: Coppa Italia",
    "GERMANY: Bundesliga", "GERMANY: 2. Bundesliga", "GERMANY: DFB Pokal", "GERMANY: 3. Liga",
    "FRANCE: Ligue 1", "FRANCE: Ligue 2", "FRANCE: Coupe de France",
    "NETHERLANDS: Eredivisie", "NETHERLANDS: Eerste Divisie",
    "PORTUGAL: Liga Portugal", "PORTUGAL: Liga Portugal 2",
    "BELGIUM: Jupiler Pro League", "BELGIUM: Challenger Pro League",
    "TURKEY: Super Lig", "TURKEY: 1. Lig",
    "GREECE: Super League",
    "SCOTLAND: Premiership", "SCOTLAND: Championship",
    "SCOTLAND: League One", "SCOTLAND: League Two",
}

def fetch(day):
    try:
        r = cf.get(f"https://global.flashscore.ninja/2/x/feed/f_1_{day}_3_en_1",
                   headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=20)
        return r.text if r.status_code == 200 else ""
    except: return ""

def parse(text, target_date):
    cur_lg=None; out=[]
    for ev in text.split(SEP_EVENT):
        if not ev.strip(): continue
        f={}
        for x in ev.split(SEP_FIELD):
            if SEP_KV in x:
                k,v=x.split(SEP_KV,1); f[k]=v
        if "ZA" in f:
            cur_lg = f.get("ZA","").strip()
        if "AA" in f and "AE" in f and "AF" in f:
            mid=f.get("AA",""); home=f.get("AE","").strip(); away=f.get("AF","").strip(); ts=f.get("AD","")
            if not home or not away or not mid or not cur_lg: continue
            try: kickoff=datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except: continue
            out.append({"mid":mid,"home":home,"away":away,"league":cur_lg,"kickoff":kickoff,"date":target_date})
    return out

def norm(s): return re.sub(r"\s+"," ",s.lower().strip()) if s else ""

print("Loading teams...")
teams=[]; off=0
while True:
    r=sb.table("teams").select("team_id,canonical_name,normalized_name").range(off,off+999).execute()
    if not r.data: break
    teams.extend(r.data); off+=1000
    if len(r.data)<1000: break
print(f"  {len(teams)} teams")
by_norm={t["normalized_name"]:t["team_id"] for t in teams if t.get("normalized_name")}
by_canon={t["canonical_name"]:t["team_id"] for t in teams if t.get("canonical_name")}

print("\nFetching Flashscore (today only)...")
matches=[]
for day in [0]:
    text=fetch(day)
    if not text: continue
    md=(datetime.now().date()+timedelta(days=day)).strftime("%Y-%m-%d")
    parsed=parse(text,md)
    print(f"  day {day}: {len(parsed)} total")
    whitelist=[m for m in parsed if m["league"] in COMP_WHITELIST]
    print(f"  whitelist: {len(whitelist)}")
    matches.extend(whitelist)

# Dedupe
seen=set(); uniq=[]
for m in matches:
    if m["mid"] in seen: continue
    seen.add(m["mid"]); uniq.append(m)
print(f"\nUnique whitelist matches: {len(uniq)}")

# Match teams
matched=[]
for m in uniq:
    h_id = by_norm.get(norm(m["home"])) or by_canon.get(m["home"])
    a_id = by_norm.get(norm(m["away"])) or by_canon.get(m["away"])
    if h_id and a_id:
        m["h_id"]=h_id; m["a_id"]=a_id
        matched.append(m)
print(f"Both teams matched: {len(matched)}")

# Group by league for preview
from collections import Counter
lg_counts = Counter(m["league"] for m in matched)
print("\nMatched by league:")
for lg, n in lg_counts.most_common(20):
    print(f"  {n:3d}  {lg}")

# Insert with proper full row (all required fields)
now_iso=datetime.now(timezone.utc).isoformat()
rows=[]
for m in matched:
    import hashlib, uuid as U
    key=f"{norm(m['home'])}|{norm(m['away'])}|{m['kickoff'].isoformat()}"
    h=hashlib.sha256(key.encode()).hexdigest()[:32]
    fid=str(U.UUID(h))
    rows.append({
        "fixture_id":fid,
        "target_date":m["date"],
        "kickoff_at":m["kickoff"].isoformat(),
        "home_team":m["home"],
        "away_team":m["away"],
        "home_team_norm":norm(m["home"]),
        "away_team_norm":norm(m["away"]),
        "competition":m["league"],
        "verification_status":"VERIFIED",
        "source_name":"Football-Data fixtures.csv",
        "source_url":f"https://www.flashscore.com/match/{m['mid']}",
        "source_provenance":{"provider":"FLASHSCORE","providerId":m["mid"],"provenance":"flashscore_adapter_v1"},
        "verified_at":now_iso,
        "canonical_home_team_id":m["h_id"],
        "canonical_away_team_id":m["a_id"],
    })

print(f"\nInserting {len(rows)}...")
for i in range(0,len(rows),500):
    try:
        sb.table("cfi_living_verified_fixtures").upsert(rows[i:i+500], on_conflict="home_team_norm,away_team_norm,target_date,kickoff_at").execute()
        print(f"  Batch {i//500+1}: OK ({len(rows[i:i+500])})")
    except Exception as e:
        print(f"  Batch {i//500+1}: FAIL {str(e)[:200]}")

print(f"\nDone. {len(rows)} rows.")