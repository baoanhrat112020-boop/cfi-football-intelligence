import os, re, uuid, hashlib
from datetime import datetime
from curl_cffi import requests as cf
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
sb = create_client(SB_URL, SB_KEY)

SEP_EVENT = "~"
SEP_FIELD = "\u00ac"
SEP_KV = "\u00f7"
U_REGEX = re.compile(r"\bU(19|20|21|23)\b", re.I)

def fetch_feed(day=0):
    url = f"https://global.flashscore.ninja/2/x/feed/f_1_{day}_3_en_1"
    r = cf.get(url, headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=30)
    return r.text if r.status_code == 200 else ""

def parse(text):
    events = text.split(SEP_EVENT)
    current_league = None
    matches = []
    for ev in events:
        if not ev.strip(): continue
        fields = {}
        for f in ev.split(SEP_FIELD):
            if SEP_KV in f:
                k, v = f.split(SEP_KV, 1)
                fields[k] = v
        if "ZA" in fields:
            current_league = fields["ZA"]
        if "AA" in fields and "AE" in fields and "AF" in fields:
            matches.append({
                "match_id": fields.get("AA",""),
                "home": fields.get("AE",""),
                "away": fields.get("AF",""),
                "league": current_league or "",
                "time": fields.get("AD",""),
            })
    return matches

def team_uuid(name):
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"cfi_team:{name.lower().strip()}"))

def norm(name):
    return name.lower().strip()

# Fetch today + tomorrow
print("Fetching Flashscore...")
all_matches = []
for day in [0, 1]:
    text = fetch_feed(day)
    parsed = parse(text)
    all_matches.extend(parsed)
    print(f"  day {day}: {len(parsed)} matches")

u_matches = [m for m in all_matches if U_REGEX.search(m["league"])]
print(f"U-matches: {len(u_matches)}")

if not u_matches:
    print("Nothing to do")
    exit(0)

# Load existing teams
existing = sb.table("cfi_team_names").select("team_id,canonical_name,norm_name").execute().data
by_norm = {t["norm_name"]: t["team_id"] for t in existing if t.get("norm_name")}
by_name = {t["canonical_name"]: t["team_id"] for t in existing if t.get("canonical_name")}
print(f"Existing teams: {len(by_norm)}")

# Collect unique team names in U-matches
u_team_names = set()
for m in u_matches:
    u_team_names.add(m["home"])
    u_team_names.add(m["away"])

# New teams to insert
new_teams = []
for name in u_team_names:
    if norm(name) in by_norm or name in by_name:
        continue
    new_teams.append({
        "team_id": team_uuid(name),
        "canonical_name": name,
        "norm_name": norm(name),
        "domestic_competition_id": "youth",
    })

if new_teams:
    print(f"Inserting {len(new_teams)} new teams...")
    for i in range(0, len(new_teams), 500):
        sb.table("cfi_team_names").upsert(new_teams[i:i+500]).execute()
    for t in new_teams:
        by_norm[t["norm_name"]] = t["team_id"]

# Global means (fallback)
global_means = {
    "7ft": 0.021209842611559105,
    "oft": 0.034550263178364925,
    "3ht": 0.1133352347862162,
    "oht": 0.00825835558897503,
    "ftavg": 2.6897477117743147,
    "htavg": 1.1562281224881374,
}

today = datetime.now().strftime("%Y-%m-%d")

rows = []
seen = set()
for m in u_matches:
    hid = by_norm.get(norm(m["home"]))
    aid = by_norm.get(norm(m["away"]))
    if not hid or not aid: continue
    key = (hid, aid, today)
    if key in seen: continue
    seen.add(key)
    fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"flashscore:{m['match_id']}"))
    row = {
        "fixture_id": fid,
        "match_date": today,
        "home_team_id": hid,
        "away_team_id": aid,
        "competition_key": f"youth:{m['league']}",
        "feat_home_7ft": global_means["7ft"], "feat_away_7ft": global_means["7ft"], "feat_league_7ft": global_means["7ft"],
        "feat_home_oft": global_means["oft"], "feat_away_oft": global_means["oft"], "feat_league_oft": global_means["oft"],
        "feat_home_3ht": global_means["3ht"], "feat_away_3ht": global_means["3ht"], "feat_league_3ht": global_means["3ht"],
        "feat_home_oht": global_means["oht"], "feat_away_oht": global_means["oht"], "feat_league_oht": global_means["oht"],
        "feat_home_ftavg": global_means["ftavg"], "feat_away_ftavg": global_means["ftavg"],
        "feat_home_htavg": global_means["htavg"], "feat_away_htavg": global_means["htavg"],
    }
    rows.append(row)

print(f"Rows to insert: {len(rows)}")
if rows:
    for i in range(0, len(rows), 500):
        sb.table("cfi_fixture_features").upsert(rows[i:i+500]).execute()
    print(f"OK - inserted {len(rows)} U-fixtures for {today}")
    for r in rows[:10]:
        print(f"  {r['fixture_id'][:8]}... | {r['competition_key']}")