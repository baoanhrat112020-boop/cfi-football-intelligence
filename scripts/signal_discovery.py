import pandas as pd
import numpy as np

df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home","ht_away","ft_home","ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date","ht_home","ht_away","ft_home","ft_away"])
df = df[df["match_date"] >= "2020-01-01"]

df["ht_t"] = df["ht_home"] + df["ht_away"]
df["ft_t"] = df["ft_home"] + df["ft_away"]
df["ht_max"] = df[["ht_home","ht_away"]].max(axis=1)
df["ft_max"] = df[["ft_home","ft_away"]].max(axis=1)
df["y3ht"] = (df["ht_t"] >= 3).astype(int)
df["y7ft"] = (df["ft_t"] >= 7).astype(int)
df["yoht"] = (df["ht_max"] >= 4).astype(int)
df["yoft"] = (df["ft_max"] >= 5).astype(int)

df["month"] = df["match_date"].dt.month
def phase(m):
    if m in (8,9,10): return "early"
    if m in (11,12,1,2): return "mid"
    return "late"
df["phase"] = df["month"].apply(phase)

# Rolling strength: mean FT total last 10 for each team
df = df.sort_values("match_date").reset_index(drop=True)
def roll_strength(series, window=10):
    return series.shift(1).rolling(window, min_periods=5).mean()
df["home_str"] = df.groupby("home_team_id")["ft_t"].transform(roll_strength)
df["away_str"] = df.groupby("away_team_id")["ft_t"].transform(roll_strength)
df["str_gap"] = (df["home_str"] - df["away_str"]).abs()
df["str_bucket"] = pd.cut(df["str_gap"], bins=[-0.01, 0.3, 1.0, 2.0, 99], labels=["even","small","mid","big"])

# Global baseline
base = {m: df["y"+m].mean() for m in ["3ht","7ft","oht","oft"]}

# Cell = league x phase x str_bucket
df["cell"] = df["competition_key"].astype(str) + "|" + df["phase"] + "|" + df["str_bucket"].astype(str)

rows = []
for cell, g in df.groupby("cell"):
    if len(g) < 100: continue
    for m in ["3ht","7ft","oht","oft"]:
        rate = g["y"+m].mean()
        lift = rate / base[m] if base[m] > 0 else 0
        rows.append({
            "cell": cell, "market": m, "n": len(g),
            "rate": round(rate*100, 2), "base": round(base[m]*100, 2),
            "lift": round(lift, 2)
        })

res = pd.DataFrame(rows)
res = res.sort_values("lift", ascending=False)

print("=== TOP 30 CELLS WITH HIGHEST LIFT ===")
print(res.head(30).to_string(index=False))

print("\n=== SUMMARY ===")
for m in ["3ht","7ft","oht","oft"]:
    sub = res[res["market"]==m]
    strong = sub[sub["lift"] >= 1.5]
    print(f"{m}: {len(sub)} cells, {len(strong)} with lift >= 1.5")

res.to_csv("signal_discovery_results.csv", index=False)
print("\nSaved: signal_discovery_results.csv")