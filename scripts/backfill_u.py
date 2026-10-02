import os, re, uuid
from datetime import datetime, timedelta
from curl_cffi import requests as cf
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
sb = create_client(SB_URL, SB_KEY)

SEP_EVENT = "~"; SEP_FIELD = "\u00ac"; SEP_KV = "\u00f7"
U_REGEX = re.compile(r"\bU(19|20|21|23)\b", re.I)

def fetch_feed(day):
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
        if "ZA" in f: cur_lg = f["ZA"]
        if "AA" in f and "AE" in f and "AF" in f:
            out.append({"match_id": f.get("AA",""), "home": f.get("AE",""),
                        "away": f.get("AF",""), "league": cur_lg or "",
                        "hg": f.get("AG",""), "ag": f.get("AH","")})
    return out

def norm(n): return n.lower().strip()
def t_uuid(n): return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"cfi_team:{n.lower().strip()}"))

# Load teams by canonical_name from main teams table
print("Loading teams...")
all_teams = []
offset = 0
while True:
    r = sb.table("teams").select("team_id,canonical_name").range(offset, offset+999).execute()
    if not r.data: break
    all_teams.extend(r.data)
    offset += 1000
    if len(r.data) < 1000: break

by_canonical = {t["canonical_name"]: t["team_id"] for t in all_teams}
print(f"  {len(by_canonical)} teams loaded")

existing_tn = sb.table("cfi_team_names").select("team_id,norm_name").execute().data
by_norm = {t["norm_name"]: t["team_id"] for t in existing_tn if t.get("norm_name")}

DAYS_BACK = int(os.environ.get("U_DAYS_BACK", "30"))
print(f"Crawling {DAYS_BACK} days...")
all_u = []
for day in range(-DAYS_BACK, 1):
    text = fetch_feed(day)
    if not text: continue
    for m in parse(text):
        if U_REGEX.search(m["league"]):
            m["date_offset"] = day; all_u.append(m)

finished = [m for m in all_u if m["hg"] not in ("", "-1") and m["ag"] not in ("", "-1")]
print(f"Finished: {len(finished)}")

u_names = set()
for m in finished:
    u_names.add(m["home"]); u_names.add(m["away"])

new_teams_main = []
new_teams_tn = []
for n in u_names:
    n_norm = norm(n)
    # Reuse existing team_id if canonical_name matches
    if n in by_canonical:
        tid = by_canonical[n]
    else:
        tid = t_uuid(n)
        new_teams_main.append({"team_id": tid, "canonical_name": n})
        by_canonical[n] = tid

    if n_norm not in by_norm:
        new_teams_tn.append({"team_id": tid, "canonical_name": n,
                              "norm_name": n_norm, "domestic_competition_id": "youth"})
        by_norm[n_norm] = tid

if new_teams_main:
    print(f"Inserting {len(new_teams_main)} new teams (main)...")
    for i in range(0, len(new_teams_main), 500):
        sb.table("teams").upsert(new_teams_main[i:i+500]).execute()

if new_teams_tn:
    print(f"Inserting {len(new_teams_tn)} new teams (names)...")
    for i in range(0, len(new_teams_tn), 500):
        sb.table("cfi_team_names").upsert(new_teams_tn[i:i+500]).execute()

today = datetime.now().date()
rows = {}
for m in finished:
    hid = by_canonical.get(m["home"])
    aid = by_canonical.get(m["away"])
    if not hid or not aid: continue
    try: hg = int(m["hg"]); ag = int(m["ag"])
    except: continue
    md = today + timedelta(days=m["date_offset"])
    fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"flashscore:{m['match_id']}"))
    rows[fid] = {
        "fixture_id": fid, "match_date": md.strftime("%Y-%m-%d"),
        "home_team_id": hid, "away_team_id": aid,
        "competition_key": f"youth:{m['league']}",
        "status": "CANONICAL", "ft_home": hg, "ft_away": ag,
    }

rows = list(rows.values())
print(f"Inserting {len(rows)} fixtures...")
for i in range(0, len(rows), 500):
    sb.table("fixtures").upsert(rows[i:i+500]).execute()
print(f"OK - {len(rows)} U-fixtures inserted")