import pandas as pd
import numpy as np
from supabase import create_client
import os

df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home","ht_away","ft_home","ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date","ht_home","ht_away","ft_home","ft_away"])
df = df[df["match_date"] >= "2018-01-01"]
df["ht_t"] = df["ht_home"] + df["ht_away"]
df["ft_t"] = df["ft_home"] + df["ft_away"]
df["ht_max"] = df[["ht_home","ht_away"]].max(axis=1)
df["ft_max"] = df[["ft_home","ft_away"]].max(axis=1)
df["y3ht"] = (df["ht_t"] >= 3).astype(int)
df["y7ft"] = (df["ft_t"] >= 7).astype(int)
df["yoht"] = (df["ht_max"] >= 4).astype(int)
df["yoft"] = (df["ft_max"] >= 5).astype(int)
df["month"] = df["match_date"].dt.month
df["phase"] = df["month"].apply(lambda m: "early" if m in (8,9,10) else ("mid" if m in (11,12,1,2) else "late"))
df["year"] = df["match_date"].dt.year
df = df.sort_values("match_date").reset_index(drop=True)

def roll(s, w=10): return s.shift(1).rolling(w, min_periods=5).mean()
df["home_str"] = df.groupby("home_team_id")["ft_t"].transform(roll)
df["away_str"] = df.groupby("away_team_id")["ft_t"].transform(roll)
df["str_gap"] = (df["home_str"] - df["away_str"]).abs()
df["str_bucket"] = pd.cut(df["str_gap"], bins=[-0.01,0.3,1.0,2.0,99], labels=["even","small","mid","big"])
df["cell"] = df["competition_key"].astype(str) + "|" + df["phase"] + "|" + df["str_bucket"].astype(str)

# Year baseline per market for lift
year_base = df.groupby("year")[["y3ht","y7ft","yoht","yoft"]].mean()

# Walk-forward per cell x market
results = []
for cell, g in df.groupby("cell"):
    if len(g) < 50: continue
    for m in ["y3ht","y7ft","yoht","yoft"]:
        year_lifts = []
        total_pos = 0
        total_n = 0
        for year in sorted(g["year"].unique()):
            ys = g[g["year"] == year]
            if len(ys) < 8: continue
            base = year_base.loc[year, m]
            if base == 0: continue
            rate = ys[m].mean()
            year_lifts.append(rate / base)
            total_pos += int(ys[m].sum())
            total_n += len(ys)
        if not year_lifts or total_pos < 12: continue
        mean_lift = np.mean(year_lifts)
        min_lift = min(year_lifts)
        stable = sum(1 for l in year_lifts if l > 1.3)
        n_years = len(year_lifts)
        # Criteria: mean >= 1.5, min >= 1.0, 70% years stable
        if mean_lift >= 1.5 and min_lift >= 1.0 and stable / n_years >= 0.7:
            market_name = m.replace("y","")
            results.append({
                "cell": cell,
                "market": market_name,
                "lift": round(float(mean_lift), 2),
                "min_lift": round(float(min_lift), 2),
                "stability": stable,
                "n_years": n_years,
                "n": total_n,
            })

print(f"Found {len(results)} validated edge cells")

# Upload
sb = create_client("https://kovmddkkzttquupdgmel.supabase.co", os.environ.get("SB_SERVICE_ROLE_KEY",""))
for i in range(0, len(results), 500):
    sb.table("cfi_edge_cells").upsert(results[i:i+500]).execute()

print(f"Uploaded {len(results)} cells")
for r in sorted(results, key=lambda x: -x["lift"])[:15]:
    print(f"  {r['cell']:40s} {r['market']:5s} {r['lift']:5.2f}x (min {r['min_lift']:.2f}, {r['stability']}/{r['n_years']})")