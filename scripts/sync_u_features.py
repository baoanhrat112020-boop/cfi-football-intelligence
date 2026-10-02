import os, uuid
import pandas as pd
import numpy as np
from datetime import datetime
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
sb = create_client(SB_URL, SB_KEY)

print("Loading all finished fixtures...")
all_rows = []
offset = 0
while True:
    r = sb.table("fixtures").select(
        "fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,competition_key"
    ).not_.is_("ft_home","null").range(offset, offset+999).execute()
    if not r.data: break
    all_rows.extend(r.data)
    offset += 1000
    if len(r.data) < 1000: break
print(f"  {len(all_rows)} finished fixtures")

df = pd.DataFrame(all_rows)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home","ht_away","ft_home","ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date","ft_home","ft_away"])
df = df.sort_values("match_date").reset_index(drop=True)

df["ft_total"] = df["ft_home"] + df["ft_away"]
df["ft_max"] = df[["ft_home","ft_away"]].max(axis=1)
df["ht_total"] = df["ht_home"].fillna(0) + df["ht_away"].fillna(0)
df["ht_max"] = df[["ht_home","ht_away"]].max(axis=1)
df["y_7ft"] = (df["ft_total"] >= 7).astype(int)
df["y_oft"] = (df["ft_max"] >= 5).astype(int)
df["y_3ht"] = (df["ht_total"] >= 3).astype(int)
df["y_oht"] = (df["ht_max"] >= 4).astype(int)
df["home_t"] = df["home_team_id"].astype(str)
df["away_t"] = df["away_team_id"].astype(str)

g = {
    "7ft": float(df["y_7ft"].mean()), "oft": float(df["y_oft"].mean()),
    "3ht": float(df["y_3ht"].mean()), "oht": float(df["y_oht"].mean()),
    "ftavg": float(df["ft_total"].mean()), "htavg": float(df["ht_total"].mean()),
}

def roll(key, tid, dt, target, days=730, minp=3):
    lo = dt - np.timedelta64(days,"D")
    s = df[(df[key]==str(tid)) & (df["match_date"]>=lo) & (df["match_date"]<dt)]
    return float(s[target].mean()) if len(s) >= minp else None

# Get U-fixtures needing features
print("Finding U-fixtures without features...")
existing = sb.table("cfi_fixture_features").select("fixture_id").like("competition_key","youth:%").execute().data
existing_ids = {r["fixture_id"] for r in existing}

u_rows = []
offset = 0
while True:
    r = sb.table("fixtures").select(
        "fixture_id,match_date,home_team_id,away_team_id,competition_key"
    ).like("competition_key","youth:%").range(offset, offset+999).execute()
    if not r.data: break
    u_rows.extend(r.data)
    offset += 1000
    if len(r.data) < 1000: break

targets = [r for r in u_rows if r["fixture_id"] not in existing_ids]
print(f"  {len(targets)} U-fixtures to compute")

rows = []
for t in targets:
    md = pd.to_datetime(t["match_date"])
    hid, aid = t["home_team_id"], t["away_team_id"]
    r = {
        "fixture_id": t["fixture_id"], "match_date": t["match_date"],
        "home_team_id": hid, "away_team_id": aid,
        "competition_key": t["competition_key"],
    }
    for m in ["7ft","oft","3ht","oht"]:
        rh = roll("home_t", hid, md, f"y_{m}")
        ra = roll("away_t", aid, md, f"y_{m}")
        r[f"feat_home_{m}"] = rh if rh is not None else g[m]
        r[f"feat_away_{m}"] = ra if ra is not None else g[m]
        r[f"feat_league_{m}"] = g[m]
    for m, tgt in [("ftavg","ft_total"),("htavg","ht_total")]:
        rh = roll("home_t", hid, md, tgt)
        ra = roll("away_t", aid, md, tgt)
        r[f"feat_home_{m}"] = rh if rh is not None else g[m]
        r[f"feat_away_{m}"] = ra if ra is not None else g[m]
    rows.append(r)

print(f"Inserting {len(rows)} rows...")
for i in range(0, len(rows), 500):
    sb.table("cfi_fixture_features").upsert(rows[i:i+500]).execute()
print(f"OK - {len(rows)} U features inserted")