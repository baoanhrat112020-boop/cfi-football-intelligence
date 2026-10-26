import os
from datetime import date, timedelta
from collections import Counter

import numpy as np
import pandas as pd
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
LOOKBACK = 60
since = (date.today() - timedelta(days=240)).isoformat()
cols = "fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,country,competition_key,competition_name"
rows, off = [], 0
while True:
    r = (sb.table("fixtures").select(cols).gte("match_date", since).not_.is_("ht_home", "null").not_.is_("ft_home", "null")
         .not_.is_("home_team_id", "null").not_.is_("away_team_id", "null").order("match_date").order("fixture_id")
         .range(off, off + 999).execute().data)
    rows += r
    if len(r) < 1000:
        break
    off += 1000
d = pd.DataFrame(rows)
d["day"] = pd.to_datetime(d.match_date).dt.date
for c in ("ht_home", "ht_away", "ft_home", "ft_away"):
    d[c] = d[c].astype(int)
d["gold"] = ((d.ht_home + d.ht_away >= 3) | (d.ht_home >= 4) | (d.ht_away >= 4) | (d.ft_home >= 5) | (d.ft_away >= 5) | (d.ft_home + d.ft_away >= 7)).astype(float)
d["lg"] = d.competition_key.fillna("UNK").astype(str)
d["hk"] = d.home_team_id.astype(str)
d["ak"] = d.away_team_id.astype(str)
print("rows", len(d), "leagues", d.lg.nunique(), "UNK share", round((d.lg == "UNK").mean(), 3))
lg_name = d.dropna(subset=["competition_name"]).drop_duplicates("lg").set_index("lg").competition_name.to_dict()
lg_ctry = d.dropna(subset=["country"]).drop_duplicates("lg").set_index("lg").country.to_dict()
lr = d.groupby("lg").gold.agg(["size", "mean"])
lr = lr[lr["size"] >= 200].sort_values("mean", ascending=False)
print("leagues by gold rate (n>=200), top 10:")
for k, r in lr.head(10).iterrows():
    print("  ", k, lg_ctry.get(k, ""), lg_name.get(k, ""), int(r["size"]), round(r["mean"], 3))
print("share of matches in leagues with rate>0.30:", round(d.lg.isin(lr[lr["mean"] > 0.30].index).mean(), 3))

long = pd.concat([
    d[["day", "hk", "gold", "lg"]].rename(columns={"hk": "team"}),
    d[["day", "ak", "gold", "lg"]].rename(columns={"ak": "team"}),
])
first = d.day.min() + timedelta(days=LOOKBACK)
test_days = sorted(x for x in d.day.unique() if x >= first)
g_all = d.gold.mean()


def window(day):
    lo = day - timedelta(days=LOOKBACK)
    return long[(long.day >= lo) & (long.day < day)]


def lists(day):
    w = window(day)
    lrate = w.groupby("lg").gold.agg(["size", "mean"])
    lrate["r"] = (lrate["size"] * lrate["mean"] + 30 * g_all) / (lrate["size"] + 30)
    w = w.assign(exp=w.lg.map(lrate["r"]).fillna(g_all))
    t = w.groupby("team").agg(n=("gold", "size"), hits=("gold", "sum"), exp=("exp", "sum"))
    t = t[t["n"] >= 5]
    t["raw"] = t.hits / t.n
    t["excess"] = (t.hits - t.exp) / (t.n + 10)
    return t, lrate["r"]


modes = {"RAW": ("raw", 20), "EXCESS": ("excess", 20), "EXCESS40": ("excess", 40)}
acc = {m: {"n": 0, "gold": 0.0, "exp": 0.0, "lg": Counter()} for m in modes}
oth = {"n": 0, "gold": 0.0, "exp": 0.0}
for day in test_days:
    t, lrate = lists(day)
    m = d[d.day == day]
    expm = m.lg.map(lrate).fillna(g_all)
    any_star = pd.Series(False, index=m.index)
    for name, (col, k) in modes.items():
        top = set(t.sort_values([col, "n"], ascending=False).head(k).index)
        star = m.hk.isin(top) | m.ak.isin(top)
        acc[name]["n"] += int(star.sum())
        acc[name]["gold"] += float(m[star].gold.sum())
        acc[name]["exp"] += float(expm[star].sum())
        for lgk in m[star].lg:
            acc[name]["lg"][lgk] += 1
        if name == "RAW":
            any_star = star
    oth["n"] += int((~any_star).sum())
    oth["gold"] += float(m[~any_star].gold.sum())
    oth["exp"] += float(expm[~any_star].sum())
for name, a in acc.items():
    n = max(a["n"], 1)
    print(name, {"starred_matches": a["n"], "gold_rate": round(a["gold"] / n, 4), "expected_by_league": round(a["exp"] / n, 4),
                 "uplift_vs_league": round(a["gold"] / max(a["exp"], 1e-9), 3)})
    print("   top leagues of starred matches:", [(k, lg_ctry.get(k, ""), lg_name.get(k, ""), v) for k, v in a["lg"].most_common(5)])
print("OTHERS (not RAW-starred)", {"n": oth["n"], "gold_rate": round(oth["gold"] / max(oth["n"], 1), 4), "expected_by_league": round(oth["exp"] / max(oth["n"], 1), 4)})

names = {}
off = 0
while True:
    r = sb.table("suggest_pick_log").select("home_team_id,away_team_id,home_team,away_team").not_.is_("home_team_id", "null").range(off, off + 999).execute().data
    for x in r:
        names[str(x["home_team_id"])] = x["home_team"]
        if x.get("away_team_id"):
            names[str(x["away_team_id"])] = x["away_team"]
    if len(r) < 1000:
        break
    off += 1000
t, lrate = lists(d.day.max() + timedelta(days=1))
last_lg = long.sort_values("day").groupby("team").lg.last()
print("Top 20 by EXCESS hien tai (vuot muc nen cua chinh giai):")
for i, (tid, r) in enumerate(t.sort_values(["excess", "n"], ascending=False).head(20).iterrows(), 1):
    lgk = last_lg.get(tid, "")
    print(i, names.get(tid, tid[:8]), "|", lg_ctry.get(lgk, ""), lg_name.get(lgk, lgk), "|", int(r.hits), "/", int(r.n), "exp", round(r.exp / r.n, 2))
