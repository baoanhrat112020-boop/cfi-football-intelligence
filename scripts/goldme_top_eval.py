import os
import math
from datetime import timedelta

import pandas as pd
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
LOOKBACK = int(os.environ.get("LOOKBACK", "60"))
MIN_N = int(os.environ.get("MIN_N", "5"))

rows, off = [], 0
cols = "fixture_id,kickoff_at,home_team,away_team,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away"
while True:
    r = (sb.table("suggest_pick_log").select(cols).not_.is_("ft_home", "null").not_.is_("ht_home", "null")
         .is_("void_reason", "null").order("kickoff_at").range(off, off + 999).execute().data)
    rows += r
    if len(r) < 1000:
        break
    off += 1000
d = pd.DataFrame(rows)
d = d[~(d.home_team + " " + d.away_team).str.contains(r"\bU1[0-8]\b", case=False, regex=True)].copy()
d["ko"] = pd.to_datetime(d.kickoff_at, utc=True)
d["day"] = d.ko.dt.date
for c in ("ht_home", "ht_away", "ft_home", "ft_away"):
    d[c] = d[c].astype(int)
d["x3ht"] = d.ht_home + d.ht_away >= 3
d["xoht"] = (d.ht_home >= 4) | (d.ht_away >= 4)
d["xoft"] = (d.ft_home >= 5) | (d.ft_away >= 5)
d["x7ft"] = d.ft_home + d.ft_away >= 7
d["gold"] = d.x3ht | d.xoht | d.xoft | d.x7ft
d["hk"] = d.home_team_id.fillna(d.home_team).astype(str)
d["ak"] = d.away_team_id.fillna(d.away_team).astype(str)
names = {}
for _, r in d.iterrows():
    names[r.hk] = r.home_team
    names[r.ak] = r.away_team
print("rows", len(d), "span", d.day.min(), "->", d.day.max(), "days", (d.day.max() - d.day.min()).days)
print("base gold rate", round(d.gold.mean(), 4), {k: round(d[k].mean(), 4) for k in ("x3ht", "xoht", "xoft", "x7ft")})

long = pd.concat([
    d[["day", "hk", "gold"]].rename(columns={"hk": "team"}),
    d[["day", "ak", "gold"]].rename(columns={"ak": "team"}),
])


def top_for(day, k):
    lo = day - timedelta(days=LOOKBACK)
    w = long[(long.day >= lo) & (long.day < day)]
    g = w.groupby("team").gold.agg(["size", "sum"])
    g = g[g["size"] >= MIN_N]
    g["rate"] = g["sum"] / g["size"]
    return g.sort_values(["rate", "size"], ascending=False).head(k)


first = d.day.min() + timedelta(days=LOOKBACK)
test_days = sorted(x for x in d.day.unique() if x >= first)
print("test days", len(test_days), "from", test_days[0] if test_days else None)


def evaluate(k):
    a, b = [], []
    for day in test_days:
        top = set(top_for(day, k).index)
        m = d[d.day == day]
        star = m.hk.isin(top) | m.ak.isin(top)
        a += m[star].gold.tolist()
        b += m[~star].gold.tolist()
    na, nb = len(a), len(b)
    pa, pb = (sum(a) / na if na else float("nan")), (sum(b) / nb if nb else float("nan"))
    pp = (sum(a) + sum(b)) / max(na + nb, 1)
    se = math.sqrt(pp * (1 - pp) * (1 / max(na, 1) + 1 / max(nb, 1)))
    z = (pa - pb) / se if se and na and nb else float("nan")
    return {"top_k": k, "starred_matches": na, "starred_gold_rate": round(pa, 4), "other_matches": nb,
            "other_gold_rate": round(pb, 4), "lift": round(pa / pb, 3) if pb else None, "z": round(z, 2)}


for k in (10, 20, 40):
    print(evaluate(k))

last = d.day.max() + timedelta(days=1)
cur = top_for(last, 20)
print("Top 20 hien tai (%d ngay, toi thieu %d tran):" % (LOOKBACK, MIN_N))
for i, (t, r) in enumerate(cur.iterrows(), 1):
    print(i, names.get(t, t), int(r["size"]), int(r["sum"]), round(r["rate"], 3))
