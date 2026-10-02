import os, re, uuid, hashlib, json
from datetime import datetime, timedelta, timezone
from curl_cffi import requests as cf
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY","")
sb = create_client(SB_URL, SB_KEY)

SEP_EVENT="~"; SEP_FIELD="\u00ac"; SEP_KV="\u00f7"
SKIP = re.compile(r"\b(W|Women|U19|U20|U21|U23|Reserve|Reserves|II\b)\b", re.I)

def fetch(day):
    try:
        r = cf.get(f"https://global.flashscore.ninja/2/x/feed/f_1_{day}_3_en_1",
                   headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=20)
        return r.text if r.status_code == 200 else ""
    except: return ""

def parse(text, target_date):
    cur_lg=None; cur_country=None
    out=[]
    for ev in text.split(SEP_EVENT):
        if not ev.strip(): continue
        f={}
        for x in ev.split(SEP_FIELD):
            if SEP_KV in x:
                k,v=x.split(SEP_KV,1); f[k]=v
        if "ZA" in f:
            lg_name = f.get("ZA","")
            if ":" in lg_name:
                cur_country, cur_lg = lg_name.split(":", 1)
                cur_country = cur_country.strip()
                cur_lg = cur_lg.strip()
            else:
                cur_lg = lg_name.strip(); cur_country = None
        if "AA" in f and "AE" in f and "AF" in f:
            mid = f.get("AA","")
            home = f.get("AE","").strip()
            away = f.get("AF","").strip()
            ts = f.get("AD","")
            if not home or not away or not mid: continue
            try:
                kickoff = datetime.fromtimestamp(int(ts), tz=timezone.utc)
            except:
                kickoff = None
            if not kickoff: continue
            out.append({"mid": mid, "home": home, "away": away,
                        "league": cur_lg or "", "country": cur_country,
                        "kickoff": kickoff, "date": target_date})
    return out

def norm(s): return re.sub(r"\s+", " ", s.lower().strip())

def make_uuid(m):
    key = f"{norm(m['home'])}|{norm(m['away'])}|{m['kickoff'].isoformat()}"
    h = hashlib.sha256(key.encode()).hexdigest()[:32]
    return str(uuid.UUID(h))

print("Loading teams...")
teams = []
off = 0
while True:
    r = sb.table("teams").select("team_id,canonical_name,normalized_name").range(off,off+999).execute()
    if not r.data: break
    teams.extend(r.data); off += 1000
    if len(r.data) < 1000: break
print(f"  {len(teams)} teams")
by_norm = {t["normalized_name"]: t["team_id"] for t in teams if t.get("normalized_name")}
by_name = {t["canonical_name"]: t["team_id"] for t in teams if t.get("canonical_name")}

print("\nFetching Flashscore...")
all_matches = []
for day in [0, 1, 2]:
    text = fetch(day)
    if not text: continue
    md = (datetime.now().date()+timedelta(days=day)).strftime("%Y-%m-%d")
    ms = parse(text, md)
    all_matches.extend(ms)
    print(f"  day {day} ({md}): {len(ms)} matches")

senior = [m for m in all_matches if m["league"] and not SKIP.search(m["league"])]
seen = set(); uniq = []
for m in senior:
    if m["mid"] in seen: continue
    seen.add(m["mid"]); uniq.append(m)
print(f"\nUnique senior: {len(uniq)}")

now_iso = datetime.now(timezone.utc).isoformat()
rows = []
for m in uniq:
    h_id = by_norm.get(norm(m["home"])) or by_name.get(m["home"])
    a_id = by_norm.get(norm(m["away"])) or by_name.get(m["away"])
    rows.append({
        "fixture_id": make_uuid(m),
        "target_date": m["date"],
        "kickoff_at": m["kickoff"].isoformat(),
        "home_team": m["home"],
        "away_team": m["away"],
        "home_team_norm": norm(m["home"]),
        "away_team_norm": norm(m["away"]),
        "competition": m["league"],
        "verification_status": "VERIFIED",
        "source_name": "FLASHSCORE",
        "source_url": f"https://www.flashscore.com/match/{m['mid']}",
        "source_provenance": {"provider": "FLASHSCORE", "providerId": m["mid"], "country": m["country"]},
        "verified_at": now_iso,
        "canonical_home_team_id": h_id,
        "canonical_away_team_id": a_id,
    })

print(f"\nRows to insert: {len(rows)}")
with_canonical = sum(1 for r in rows if r["canonical_home_team_id"] and r["canonical_away_team_id"])
print(f"Both teams mapped: {with_canonical}")

BATCH = 500
inserted = 0
errors = 0
for i in range(0, len(rows), BATCH):
    batch = rows[i:i+BATCH]
    try:
        sb.table("cfi_living_verified_fixtures").upsert(batch, on_conflict="fixture_id").execute()
        inserted += len(batch)
        print(f"  Batch {i//BATCH+1}: OK ({len(batch)} rows)")
    except Exception as e:
        errors += 1
        print(f"  Batch {i//BATCH+1}: FAIL {str(e)[:200]}")

print(f"\nInserted: {inserted}, errors: {errors}")