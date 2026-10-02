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

def get_season(date_str):
    d = datetime.strptime(date_str, "%Y-%m-%d")
    if d.month >= 7:
        return f"{d.year}{str(d.year+1)[2:]}"
    return f"{d.year-1}{str(d.year)[2:]}"

# ============================================================
# SOURCE 1 — OpenFootball (JSON, 20 league châu Âu)
# ============================================================
def fetch_openfootball(date_str):
    season = get_season(date_str)
    leagues = [
        ("en.1","England / Premier League"),
        ("en.2","England / Championship"),
        ("de.1","Germany / Bundesliga"),
        ("de.2","Germany / 2. Bundesliga"),
        ("es.1","Spain / La Liga"),
        ("it.1","Italy / Serie A"),
        ("fr.1","France / Ligue 1"),
        ("nl.1","Netherlands / Eredivisie"),
        ("pt.1","Portugal / Primeira Liga"),
        ("be.1","Belgium / Pro League"),
        ("tr.1","Turkey / Süper Lig"),
        ("gr.1","Greece / Super League"),
    ]
    out = []
    for code, label in leagues:
        url = f"https://raw.githubusercontent.com/openfootball/football.json/master/{season}/{code}.json"
        try:
            r = cf.get(url, impersonate="chrome120", timeout=20)
            if r.status_code != 200:
                continue
            data = r.json()
            for m in data.get("matches", []):
                if m.get("date") == date_str:
                    h = m.get("team1")
                    a = m.get("team2")
                    if h and a:
                        out.append({"home": h, "away": a, "competition": label})
        except Exception as e:
            continue
    return out

# ============================================================
# SOURCE 2 — football-data.co.uk (CSV, có cả hiệp 1)
# ============================================================
def fetch_football_data(date_str):
    season = get_season(date_str)
    leagues = [
        ("E0","England / Premier League"),
        ("E1","England / Championship"),
        ("E2","England / League One"),
        ("E3","England / League Two"),
        ("D1","Germany / Bundesliga"),
        ("D2","Germany / 2. Bundesliga"),
        ("SP1","Spain / La Liga"),
        ("SP2","Spain / Segunda"),
        ("I1","Italy / Serie A"),
        ("I2","Italy / Serie B"),
        ("F1","France / Ligue 1"),
        ("F2","France / Ligue 2"),
        ("N1","Netherlands / Eredivisie"),
        ("P1","Portugal / Primeira Liga"),
        ("B1","Belgium / Pro League"),
        ("T1","Turkey / Süper Lig"),
        ("G1","Greece / Super League"),
    ]
    out = []
    target = pd.to_datetime(date_str)
    for code, label in leagues:
        url = f"https://www.football-data.co.uk/mmz4281/{season}/{code}.csv"
        try:
            df = pd.read_csv(url, encoding="utf-8", on_bad_lines="skip")
            if "Date" not in df.columns:
                continue
            df["_d"] = pd.to_datetime(df["Date"], format="%d/%m/%Y", errors="coerce")
            if df["_d"].isna().all():
                df["_d"] = pd.to_datetime(df["Date"], format="%d/%m/%y", errors="coerce")
            sub = df[df["_d"] == target]
            for _, row in sub.iterrows():
                h = row.get("HomeTeam")
                a = row.get("AwayTeam")
                if isinstance(h, str) and isinstance(a, str):
                    out.append({"home": h, "away": a, "competition": label})
        except Exception as e:
            continue
    return out

# ============================================================
# SOURCE 3 — TheSportsDB (public key 3, worldwide)
# ============================================================
def fetch_thesportsdb(date_str):
    url = f"https://www.thesportsdb.com/api/v1/json/3/eventsday.php?d={date_str}&s=Soccer"
    try:
        r = cf.get(url, impersonate="chrome120", timeout=20)
        if r.status_code != 200:
            return []
        data = r.json()
        out = []
        for ev in data.get("events", []) or []:
            h = ev.get("strHomeTeam")
            a = ev.get("strAwayTeam")
            lg = ev.get("strLeague")
            if h and a:
                out.append({"home": h, "away": a, "competition": lg or "?"})
        return out
    except Exception:
        return []

# ============================================================
# CRAWL
# ============================================================
print(f"=== Crawl {TARGET_DATE} ===")
all_fixtures = []
seen_keys = set()

for name, fn in [
    ("OpenFootball", fetch_openfootball),
    ("football-data.co.uk", fetch_football_data),
    ("TheSportsDB", fetch_thesportsdb),
]:
    print(f"\n[{name}]")
    try:
        res = fn(TARGET_DATE)
        print(f"  → {len(res)} fixtures")
        for f in res:
            k = (f["home"].lower().strip(), f["away"].lower().strip())
            if k not in seen_keys:
                seen_keys.add(k)
                all_fixtures.append(f)
    except Exception as e:
        print(f"  FAIL: {e}")
    time.sleep(1)

print(f"\nTotal unique: {len(all_fixtures)}")
if not all_fixtures:
    sys.exit(0)

# ============================================================
# LOAD TEAM NAMES + HISTORY
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
# MATCH + BUILD
# ============================================================
target_dt = pd.to_datetime(TARGET_DATE)
rows = []
matched = 0
unmatched = []

for f in all_fixtures:
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

print(f"\nMatched {matched}/{len(all_fixtures)}")
if unmatched:
    print(f"Unmatched ({len(unmatched)}):")
    for u in unmatched[:15]:
        print(f"  - {u}")

if not rows:
    sys.exit(0)

print(f"\nInserting {len(rows)} rows...")
for i in range(0, len(rows), 500):
    sb.table("cfi_fixture_features").upsert(rows[i:i+500]).execute()

print(f"\n✓ Inserted {len(rows)} fixtures for {TARGET_DATE}")