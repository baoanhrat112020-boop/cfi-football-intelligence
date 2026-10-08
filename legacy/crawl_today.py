import os, sys, uuid, time
import pandas as pd
import numpy as np
from datetime import datetime
from curl_cffi import requests as cf
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SB_KEY:
    print("ERROR: set $env:SB_SERVICE_ROLE_KEY")
    sys.exit(1)

TARGET_DATE = sys.argv[1] if len(sys.argv) > 1 else datetime.now().strftime("%Y-%m-%d")
sb = create_client(SB_URL, SB_KEY)

# ============================================================
# OPENFOOTBALL — Leagues
# ============================================================
# Format: (league_code, competition_label)
LEAGUES = [
    ("en.1", "England / Premier League"),
    ("en.2", "England / Championship"),
    ("en.3", "England / League One"),
    ("en.4", "England / League Two"),
    ("de.1", "Germany / Bundesliga"),
    ("de.2", "Germany / 2. Bundesliga"),
    ("de.3", "Germany / 3. Liga"),
    ("es.1", "Spain / La Liga"),
    ("es.2", "Spain / Segunda División"),
    ("it.1", "Italy / Serie A"),
    ("it.2", "Italy / Serie B"),
    ("fr.1", "France / Ligue 1"),
    ("fr.2", "France / Ligue 2"),
]

# Season detection: nếu tháng >= 7 → mùa 2025-26, else mùa 2024-25
def get_season(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    if d.month >= 7:
        return f"{d.year}-{str(d.year+1)[2:]}"
    else:
        return f"{d.year-1}-{str(d.year)[2:]}"

# ============================================================
# FETCH OPENFOOTBALL
# ============================================================
def fetch_openfootball(date_str, league_code):
    season = get_season(date_str)
    url = f"https://raw.githubusercontent.com/openfootball/football.json/master/{season}/{league_code}.json"
    try:
        r = cf.get(url, impersonate="chrome120", timeout=30)
        if r.status_code != 200:
            return []
        data = r.json()
        out = []
        for m in data.get("matches", []):
            if m.get("date") == date_str:
                h = m.get("team1")
                a = m.get("team2")
                if h and a:
                    out.append({"home": h, "away": a})
        return out
    except Exception as e:
        return []

# ============================================================
# CRAWL ALL LEAGUES
# ============================================================
print(f"=== OpenFootball crawl for {TARGET_DATE} ===")
print(f"Season: {get_season(TARGET_DATE)}")
print()

fixtures = []
for code, label in LEAGUES:
    result = fetch_openfootball(TARGET_DATE, code)
    if result:
        print(f"[{code}] {label}: {len(result)} fixtures")
        for f in result:
            f["competition"] = label
            fixtures.append(f)

print(f"\nTotal: {len(fixtures)} fixtures from OpenFootball")

if not fixtures:
    print("No fixtures found.")
    sys.exit(0)

# ============================================================
# MATCH TO CANONICAL TEAMS
# ============================================================
print("\nLoading cfi_team_names...")
tn = sb.table("cfi_team_names").select("team_id, canonical_name, norm_name").execute().data
name_to_id = {}
for t in tn:
    for key in [t.get("canonical_name"), t.get("norm_name")]:
        if key:
            name_to_id[key.lower().strip()] = t["team_id"]
print(f"  {len(name_to_id)} name variants")

print("Loading fixtures_cache.csv...")
df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home", "ht_away", "ft_home", "ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date", "ft_home", "ft_away"])

df["ft_total"] = df["ft_home"] + df["ft_away"]
df["ft_max"]   = df[["ft_home", "ft_away"]].max(axis=1)
df["ht_total"] = df["ht_home"].fillna(0) + df["ht_away"].fillna(0)
df["ht_max"]   = df[["ht_home", "ht_away"]].max(axis=1)
df["y_7ft"]    = (df["ft_total"] >= 7).astype(int)
df["y_oft"]    = (df["ft_max"]   >= 5).astype(int)
df["y_3ht"]    = (df["ht_total"] >= 3).astype(int)
df["y_oht"]    = (df["ht_max"]   >= 4).astype(int)
df["home_t"]   = df["home_team_id"].astype(str)
df["away_t"]   = df["away_team_id"].astype(str)

g = {
    "7ft": float(df["y_7ft"].mean()),
    "oft": float(df["y_oft"].mean()),
    "3ht": float(df["y_3ht"].mean()),
    "oht": float(df["y_oht"].mean()),
    "ftavg": float(df["ft_total"].mean()),
    "htavg": float(df["ht_total"].mean()),
}

def roll(key, team_id, dt, target, days=730, minp=5):
    lo = dt - np.timedelta64(days, "D")
    s = df[(df[key] == str(team_id)) & (df["match_date"] >= lo) & (df["match_date"] < dt)]
    return float(s[target].mean()) if len(s) >= minp else None

# ============================================================
# BUILD ROWS
# ============================================================
target_dt = pd.to_datetime(TARGET_DATE)
rows = []
matched = 0
unmatched = []

for f in fixtures:
    hid = name_to_id.get(f["home"].lower().strip())
    aid = name_to_id.get(f["away"].lower().strip())
    if not hid or not aid:
        unmatched.append(f"{f['home']} vs {f['away']}")
        continue
    matched += 1

    fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{TARGET_DATE}|{hid}|{aid}"))
    row = {
        "fixture_id": fid,
        "match_date": TARGET_DATE,
        "home_team_id": hid,
        "away_team_id": aid,
        "competition_key": f["competition"],
    }
    for m in ["7ft", "oft", "3ht", "oht"]:
        rh = roll("home_t", hid, target_dt, f"y_{m}")
        ra = roll("away_t", aid, target_dt, f"y_{m}")
        row[f"feat_home_{m}"] = rh if rh is not None else g[m]
        row[f"feat_away_{m}"] = ra if ra is not None else g[m]
        row[f"feat_league_{m}"] = g[m]
    for m, tgt in [("ftavg", "ft_total"), ("htavg", "ht_total")]:
        rh = roll("home_t", hid, target_dt, tgt)
        ra = roll("away_t", aid, target_dt, tgt)
        row[f"feat_home_{m}"] = rh if rh is not None else g[m]
        row[f"feat_away_{m}"] = ra if ra is not None else g[m]
    rows.append(row)

print(f"\nMatched {matched}/{len(fixtures)} fixtures to canonical teams")
if unmatched:
    print(f"Unmatched ({len(unmatched)}):")
    for u in unmatched[:20]:
        print(f"  - {u}")

if not rows:
    print("No rows to insert.")
    sys.exit(0)

# ============================================================
# INSERT
# ============================================================
print(f"\nInserting {len(rows)} rows...")
for i in range(0, len(rows), 500):
    sb.table("cfi_fixture_features").upsert(rows[i:i+500]).execute()

print(f"\n✓ Inserted {len(rows)} fixtures for {TARGET_DATE}")