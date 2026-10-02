import pandas as pd
import numpy as np
from scipy import stats

df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home","ht_away","ft_home","ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date","ht_home","ht_away","ft_home","ft_away"])
df = df[df["match_date"] >= "2018-01-01"]

df["ht_t"] = df["ht_home"] + df["ht_away"]
df["ft_t"] = df["ft_home"] + df["ft_away"]
df["y3ht"] = (df["ht_t"] >= 3).astype(int)
df["yoft"] = (df[["ft_home","ft_away"]].max(axis=1) >= 5).astype(int)
df["y7ft"] = (df["ft_t"] >= 7).astype(int)

df["month"] = df["match_date"].dt.month
def phase(m):
    if m in (8,9,10): return "early"
    if m in (11,12,1,2): return "mid"
    return "late"
df["phase"] = df["month"].apply(phase)
df = df.sort_values("match_date").reset_index(drop=True)

def roll(s, w=10): return s.shift(1).rolling(w, min_periods=5).mean()
df["home_str"] = df.groupby("home_team_id")["ft_t"].transform(roll)
df["away_str"] = df.groupby("away_team_id")["ft_t"].transform(roll)
df["str_gap"] = (df["home_str"] - df["away_str"]).abs()
df["str_bucket"] = pd.cut(df["str_gap"], bins=[-0.01, 0.3, 1.0, 2.0, 99], labels=["even","small","mid","big"])
df["cell"] = df["competition_key"].astype(str) + "|" + df["phase"] + "|" + df["str_bucket"].astype(str)
df["year"] = df["match_date"].dt.year

# Candidate cells to test
candidates = [
    ("germany:d1|early|mid", "y3ht"),
    ("germany:d1|early|mid", "yoft"),
    ("netherlands:n1|early|mid", "yoft"),
    ("netherlands:n1|early|small", "yoft"),
    ("netherlands:n1|early|small", "y7ft"),
    ("scotland:sc3|mid|even", "y3ht"),
    ("germany:d2|late|even", "y3ht"),
]

print("=== WALK-FORWARD VALIDATION (2018-2026) ===")
print()
for cell, m in candidates:
    sub = df[df["cell"] == cell]
    print(f"\n{cell} | {m}")
    print(f"{'year':>6} {'n':>5} {'pos':>4} {'rate%':>7}")
    year_lifts = []
    for year in sorted(sub["year"].unique()):
        ys = sub[sub["year"] == year]
        baseline = df[df["year"] == year][m].mean()
        if len(ys) < 10: continue
        rate = ys[m].mean()
        lift = rate / baseline if baseline > 0 else 0
        year_lifts.append(lift)
        print(f"{year:>6} {len(ys):>5} {int(ys[m].sum()):>4} {rate*100:>7.2f}  lift={lift:.2f}")
    if year_lifts:
        print(f"  Mean lift: {np.mean(year_lifts):.2f}x | Min: {min(year_lifts):.2f}x | Stable: {sum(1 for l in year_lifts if l > 1.3)}/{len(year_lifts)}")