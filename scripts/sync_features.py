import os, sys, uuid, time
import pandas as pd
import numpy as np
from datetime import datetime
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SB_KEY:
    print("ERROR: set $env:SB_SERVICE_ROLE_KEY")
    sys.exit(1)

sb = create_client(SB_URL, SB_KEY)

# ============================================================
# LOAD HISTORICAL DATA
# ============================================================
print("Loading fixtures_cache.csv...")
df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home", "ht_away", "ft_home", "ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date", "ft_home", "ft_away"])
df = df[["fixture_id", "match_date", "home_team_id", "away_team_id",
         "ht_home", "ht_away", "ft_home", "ft_away", "competition_key"]].copy()
print(f"  {len(df)} historical fixtures")

# ============================================================
# FETCH FINISHED FIXTURES FROM DB
# ============================================================
print("\nFetching finished fixtures from DB...")
res = sb.table("fixtures").select(
    "fixture_id, match_date, home_team_id, away_team_id, "
    "ht_home, ht_away, ft_home, ft_away, competition_key"
).not_.is_("ft_home", "null").limit(500000).execute()

db_df = pd.DataFrame(res.data)
if len(db_df):
    db_df["match_date"] = pd.to_datetime(db_df["match_date"], errors="coerce")
    for c in ["ht_home", "ht_away", "ft_home", "ft_away"]:
        db_df[c] = pd.to_numeric(db_df[c], errors="coerce")
    db_df = db_df.dropna(subset=["match_date", "ft_home", "ft_away"])
    print(f"  {len(db_df)} finished fixtures from DB")
    combined = pd.concat([df, db_df], ignore_index=True)
    combined = combined.drop_duplicates(subset=["fixture_id"], keep="last")
else:
    combined = df

combined = combined.sort_values("match_date").reset_index(drop=True)

combined["ft_total"] = combined["ft_home"] + combined["ft_away"]
combined["ft_max"]   = combined[["ft_home", "ft_away"]].max(axis=1)
combined["ht_total"] = combined["ht_home"].fillna(0) + combined["ht_away"].fillna(0)
combined["ht_max"]   = combined[["ht_home", "ht_away"]].max(axis=1)
combined["y_7ft"]    = (combined["ft_total"] >= 7).astype(int)
combined["y_oft"]    = (combined["ft_max"]   >= 5).astype(int)
combined["y_3ht"]    = (combined["ht_total"] >= 3).astype(int)
combined["y_oht"]    = (combined["ht_max"]   >= 4).astype(int)
combined["home_t"]   = combined["home_team_id"].astype(str)
combined["away_t"]   = combined["away_team_id"].astype(str)
combined["league"]   = combined["competition_key"].fillna("unknown").astype(str)

g = {
    "7ft": float(combined["y_7ft"].mean()),
    "oft": float(combined["y_oft"].mean()),
    "3ht": float(combined["y_3ht"].mean()),
    "oht": float(combined["y_oht"].mean()),
    "ftavg": float(combined["ft_total"].mean()),
    "htavg": float(combined["ht_total"].mean()),
}
print(f"  Global means: {g}")

# ============================================================
# FETCH UPCOMING FIXTURES (targets)
# ============================================================
print("\nFetching upcoming fixtures from DB...")
res = sb.table("fixtures").select(
    "fixture_id, match_date, home_team_id, away_team_id, competition_key"
).gte("match_date", datetime.now().strftime("%Y-%m-%d")).limit(50000).execute()

targets = pd.DataFrame(res.data)
if not len(targets):
    print("No upcoming fixtures")
    sys.exit(0)

targets["match_date"] = pd.to_datetime(targets["match_date"])
targets["home_team_id"] = targets["home_team_id"].astype(str)
targets["away_team_id"] = targets["away_team_id"].astype(str)
targets["competition_key"] = targets["competition_key"].fillna("unknown")
print(f"  {len(targets)} upcoming fixtures")

# Check which already have features
print("Checking existing features...")
all_existing = []
offset = 0
while True:
    r = sb.table("cfi_fixture_features").select("fixture_id").range(offset, offset+999).execute()
    if not r.data:
        break
    all_existing.extend(r.data)
    offset += 1000
    if len(r.data) < 1000:
        break

existing_ids = {r["fixture_id"] for r in all_existing}
print(f"  {len(existing_ids)} existing features")
targets = targets[~targets["fixture_id"].isin(existing_ids)]
print(f"  {len(targets)} need features")

if not len(targets):
    print("All features up to date")
    sys.exit(0)

# ============================================================
# BUILD ROLLING FEATURES
# ============================================================
def roll(key_col, team_id, dt, target, days=730, minp=5):
    lo = dt - np.timedelta64(days, "D")
    s = combined[(combined[key_col] == str(team_id)) &
                 (combined["match_date"] >= lo) &
                 (combined["match_date"] < dt)]
    return float(s[target].mean()) if len(s) >= minp else None

print("\nBuilding rows...")
rows = []
for _, row in targets.iterrows():
    fid = row["fixture_id"]
    hid = row["home_team_id"]
    aid = row["away_team_id"]
    md = row["match_date"]
    lg = row["competition_key"]

    r = {
        "fixture_id": fid,
        "match_date": md.strftime("%Y-%m-%d"),
        "home_team_id": hid,
        "away_team_id": aid,
        "competition_key": lg,
    }
    for m in ["7ft", "oft", "3ht", "oht"]:
        rh = roll("home_t", hid, md, f"y_{m}")
        ra = roll("away_t", aid, md, f"y_{m}")
        r[f"feat_home_{m}"] = rh if rh is not None else g[m]
        r[f"feat_away_{m}"] = ra if ra is not None else g[m]
        r[f"feat_league_{m}"] = g[m]
    for m, tgt in [("ftavg", "ft_total"), ("htavg", "ht_total")]:
        rh = roll("home_t", hid, md, tgt)
        ra = roll("away_t", aid, md, tgt)
        r[f"feat_home_{m}"] = rh if rh is not None else g[m]
        r[f"feat_away_{m}"] = ra if ra is not None else g[m]
    rows.append(r)

# ============================================================
# INSERT
# ============================================================
print(f"\nInserting {len(rows)} rows...")
for i in range(0, len(rows), 500):
    sb.table("cfi_fixture_features").upsert(rows[i:i+500]).execute()

print(f"\n✓ Synced {len(rows)} fixtures")