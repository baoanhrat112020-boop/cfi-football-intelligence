import os, re, uuid as U
from datetime import datetime, timedelta
from curl_cffi import requests as cf
from supabase import create_client
import sys
sys.path.insert(0, 'scripts')
from cfi_tier import classify_tier

SB_URL = "https://zbwkowqluwuvsnajkuvc.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SB_KEY:
    print("ERROR: SB_SERVICE_ROLE_KEY not set"); exit(1)

sb = create_client(SB_URL, SB_KEY)

SEP_EVENT="~"; SEP_FIELD="\u00ac"; SEP_KV="\u00f7"

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

def norm(s):
    if not s: return ""
    return re.sub(r"\s+", " ", s.lower().strip())

def fetch(day):
    try:
        r = cf.get(f"https://global.flashscore.ninja/2/x/feed/f_1_{day}_3_en_1",
                   headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=20)
        return r.text if r.status_code == 200 else ""
    except: return ""

def parse(text):
    cur_lg = None; out = []
    for ev in text.split(SEP_EVENT):
        if not ev.strip(): continue
        f = {}
        for x in ev.split(SEP_FIELD):
            if SEP_KV in x:
                k, v = x.split(SEP_KV, 1); f[k] = v
        if "ZA" in f: cur_lg = f["ZA"].strip()
        if "AA" in f and "AE" in f and "AF" in f:
            mid = f.get("AA",""); home = f.get("AE","").strip(); away = f.get("AF","").strip()
            if not home or not away or not mid or not cur_lg: continue
            out.append({"mid": mid, "home": home, "away": away, "league": cur_lg})
    return out

print("Loading teams...")
cfi_teams = {}
off = 0
while True:
    r = sb.table("teams").select("team_id,canonical_name").range(off, off+999).execute()
    if not r.data: break
    for t in r.data:
        n = norm(t["canonical_name"])
        if n: cfi_teams[n] = t["team_id"]
    off += 1000
    if len(r.data) < 1000: break
print(f"  {len(cfi_teams)} teams")

all_matches = []
for day in [0, 1]:
    text = fetch(day)
    if not text: continue
    parsed = parse(text)
    matches = [m for m in parsed if m["league"] in COMP_WHITELIST]
    md = (datetime.now().date() + timedelta(days=day)).strftime("%Y-%m-%d")
    for m in matches:
        m["date"] = md
    all_matches.extend(matches)
    print(f"  day {day} ({md}): {len(matches)} whitelist matches")

print(f"\nTotal: {len(all_matches)}")

ok, fail, skip = 0, 0, 0
for m in all_matches:
    h_id = cfi_teams.get(norm(m["home"]))
    a_id = cfi_teams.get(norm(m["away"]))
    if not h_id or not a_id:
        skip += 1; continue
    fid = str(U.uuid5(U.NAMESPACE_DNS, f"flashscore:{m['mid']}"))
    row = {
        "fixture_id": fid,
        "match_date": m["date"],
        "home_team_id": h_id, "away_team_id": a_id,
        "ht_home": None, "ht_away": None,
        "ft_home": None, "ft_away": None,
        "status": "SCHEDULED",
        "competition_key": "flashscore:" + m["league"].lower().replace(": ","_").replace(" ","_")[:50],
        "tier": classify_tier("flashscore:" + m["league"].lower().replace(": ","_").replace(" ","_")[:50]),
        "competition_name": m["league"],
    }
    try:
        sb.table("fixtures").insert(row).execute()
        ok += 1
    except:
        try:
            sb.table("fixtures").upsert(row, on_conflict="fixture_id").execute()
            ok += 1
        except:
            fail += 1

print(f"\nOK: {ok}, Fail: {fail}, Skip: {skip}")
