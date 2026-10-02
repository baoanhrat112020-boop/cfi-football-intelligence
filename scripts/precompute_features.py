import os, sys
import pandas as pd
import numpy as np
from tqdm import tqdm
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_SERVICE_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")

if not SB_SERVICE_KEY:
    print("ERROR: Set env: $env:SB_SERVICE_ROLE_KEY = Read-Host 'Paste key'")
    sys.exit(1)

CSV = "fixtures_cache.csv"
WINDOW_DAYS = 730
MIN_PERIODS = 5

sb = create_client(SB_URL, SB_SERVICE_KEY)

print("Loading fixtures_cache.csv...")
df = pd.read_csv(CSV, encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home", "ht_away", "ft_home", "ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")

df = df.dropna(subset=["match_date", "ft_home", "ft_away"])
df = df.sort_values("match_date").reset_index(drop=True)

df["ft_total"] = df["ft_home"] + df["ft_away"]
df["ft_max"] = df[["ft_home", "ft_away"]].max(axis=1)
df["ht_total"] = df["ht_home"].fillna(0) + df["ht_away"].fillna(0)
df["ht_max"] = df[["ht_home", "ht_away"]].max(axis=1)

df["y_7ft"] = (df["ft_total"] >= 7).astype(int)
df["y_oft"] = (df["ft_max"] >= 5).astype(int)
df["y_3ht"] = (df["ht_total"] >= 3).astype(int)
df["y_oht"] = (df["ht_max"] >= 4).astype(int)

df["home_t"] = df["home_team_id"].astype(str)
df["away_t"] = df["away_team_id"].astype(str)
df["league"] = df["competition_key"].fillna("unknown").astype(str)

print(f"Loaded {len(df)} fixtures")

# ---- Targets = ALL fixtures ----
targets = df[["fixture_id", "match_date", "home_team_id", "away_team_id", "competition_key"]].copy()
targets["competition_key"] = targets["competition_key"].fillna("unknown").astype(str)
targets["home_team_id"] = targets["home_team_id"].astype(str)
targets["away_team_id"] = targets["away_team_id"].astype(str)
print(f"Target fixtures: {len(targets)}")

home_dates = {}
away_dates = {}
for _, row in targets.iterrows():
    home_dates.setdefault(row["home_team_id"], []).append(row["match_date"])
    away_dates.setdefault(row["away_team_id"], []).append(row["match_date"])

league_dates = {}
for _, row in targets.iterrows():
    league_dates.setdefault(row["competition_key"], []).append(row["match_date"])

def rolling_rate(df_in, key_col, target_col, target_dates, window_days=730, min_periods=5):
    out = {}
    for key, grp in tqdm(df_in.groupby(key_col, sort=False), desc=f"  {target_col}"):
        if key not in target_dates:
            continue
        grp = grp.sort_values("match_date")
        dates = grp["match_date"].values
        vals = grp[target_col].values
        for tdate in target_dates[key]:
            lo = tdate - np.timedelta64(window_days, "D")
            m = (dates >= lo) & (dates < tdate)
            if m.sum() >= min_periods:
                out[(key, tdate)] = float(vals[m].mean())
            else:
                out[(key, tdate)] = np.nan
    return out

print("\nComputing rolling rates...")
rates = {}
for target, name in [("y_7ft","7ft"), ("y_oft","oft"), ("y_3ht","3ht"), ("y_oht","oht")]:
    print(f"\n[{name}]")
    rates[f"home_{name}"] = rolling_rate(df, "home_t", target, home_dates)
    rates[f"away_{name}"] = rolling_rate(df, "away_t", target, away_dates)
    rates[f"league_{name}"] = rolling_rate(df, "league", target, league_dates, min_periods=20)

print("\n[avg]")
rates["home_ftavg"] = rolling_rate(df, "home_t", "ft_total", home_dates)
rates["away_ftavg"] = rolling_rate(df, "away_t", "ft_total", away_dates)
rates["home_htavg"] = rolling_rate(df, "home_t", "ht_total", home_dates)
rates["away_htavg"] = rolling_rate(df, "away_t", "ht_total", away_dates)

def get_rate(d, key, tdate, fallback):
    v = d.get((key, tdate))
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return float(fallback)
    return float(v)

global_base = {
    "7ft": float(df["y_7ft"].mean()),
    "oft": float(df["y_oft"].mean()),
    "3ht": float(df["y_3ht"].mean()),
    "oht": float(df["y_oht"].mean()),
}
global_ftavg = float(df["ft_total"].mean())
global_htavg = float(df["ht_total"].mean())

print("\nBuilding rows...")
rows = []
for _, row in tqdm(targets.iterrows(), total=len(targets)):
    fid = row["fixture_id"]
    ht = row["home_team_id"]
    at = row["away_team_id"]
    md = row["match_date"]
    lg = row["competition_key"]

    r = {
        "fixture_id": fid,
        "match_date": md.strftime("%Y-%m-%d") if hasattr(md, "strftime") else str(md)[:10],
        "home_team_id": ht,
        "away_team_id": at,
        "competition_key": lg,
    }
    for name in ["7ft", "oft", "3ht", "oht"]:
        r[f"feat_home_{name}"] = get_rate(rates[f"home_{name}"], ht, md, global_base[name])
        r[f"feat_away_{name}"] = get_rate(rates[f"away_{name}"], at, md, global_base[name])
        r[f"feat_league_{name}"] = get_rate(rates[f"league_{name}"], lg, md, global_base[name])
    r["feat_home_ftavg"] = get_rate(rates["home_ftavg"], ht, md, global_ftavg)
    r["feat_away_ftavg"] = get_rate(rates["away_ftavg"], at, md, global_ftavg)
    r["feat_home_htavg"] = get_rate(rates["home_htavg"], ht, md, global_htavg)
    r["feat_away_htavg"] = get_rate(rates["away_htavg"], at, md, global_htavg)
    rows.append(r)

print(f"\nComputed {len(rows)} rows")

print("Uploading to Supabase...")
BATCH = 500
for i in tqdm(range(0, len(rows), BATCH), desc="Insert"):
    sb.table("cfi_fixture_features").upsert(rows[i:i+BATCH]).execute()

print(f"\n✓ Inserted {len(rows)} rows into cfi_fixture_features")