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
df = df.sort_values("match_date").reset_index(drop=True)
def roll_strength(s, w=10): return s.shift(1).rolling(w, min_periods=5).mean()
df["home_str"] = df.groupby("home_team_id")["ft_t"].transform(roll_strength)
df["away_str"] = df.groupby("away_team_id")["ft_t"].transform(roll_strength)
df["str_gap"] = (df["home_str"] - df["away_str"]).abs()
df["str_bucket"] = pd.cut(df["str_gap"], bins=[-0.01, 0.3, 1.0, 2.0, 99], labels=["even","small","mid","big"])
df["cell"] = df["competition_key"].astype(str) + "|" + df["phase"] + "|" + df["str_bucket"].astype(str)

base = {m: df["y"+m].mean() for m in ["3ht","7ft","oht","oft"]}

rows = []
for cell, g in df.groupby("cell"):
    for m in ["3ht","7ft","oht","oft"]:
        pos = int(g["y"+m].sum())
        if pos < 15: continue  # cần ít nhất 15 events
        rate = g["y"+m].mean()
        lift = rate / base[m] if base[m] > 0 else 0
        rows.append({
            "cell": cell, "market": m, "n": len(g), "pos": pos,
            "rate": round(rate*100, 2), "lift": round(lift, 2)
        })

res = pd.DataFrame(rows).sort_values("lift", ascending=False)
print("=== TOP 30 CELLS (pos >= 15 events) ===")
print(res.head(30).to_string(index=False))
print(f"\nTotal validated cells: {len(res)}")
res.to_csv("signal_discovery_validated.csv", index=False)