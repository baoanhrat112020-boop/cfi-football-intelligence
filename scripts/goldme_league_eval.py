import os
import math
from datetime import date, timedelta
from collections import Counter

import pandas as pd
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
LOOKBACK = 60
since = (date.today() - timedelta(days=240)).isoformat()
cols = "fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,tier,country,competition_key,competition_name,season"
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
d["gold"] = ((d.ht_home + d.ht_away >= 3) | (d.ht_home >= 4) | (d.ht_away >= 4) | (d.ft_home >= 5) | (d.ft_away >= 5) | (d.ft_home + d.ft_away >= 7))
d["hk"] = d.home_team_id.astype(str)
d["ak"] = d.away_team_id.astype(str)
print("rows", len(d))
for c in ("country", "competition_key", "competition_name"):
    print(c, "non-null share", round(d[c].notna().mean(), 3))
print("country top", d.country.value_counts().head(12).to_dict())

ctry = d[d.country.notna()]
g = ctry.groupby("country").gold.agg(["size", "mean"])
g = g[g["size"] >= 300].sort_values("mean", ascending=False)
print("gold rate by country (n>=300), top 12:")
print(g.head(12).round(3).to_string())
print("bottom 5:")
print(g.tail(5).round(3).to_string())

team_country = {}
for _, r in ctry.iterrows():
    team_country.setdefault(r.hk, r.country)
    team_country.setdefault(r.ak, r.country)

long = pd.concat([d[["day", "hk", "gold"]].rename(columns={"hk": "team"}), d[["day", "ak", "gold"]].rename(columns={"ak": "team"})])


def top_for(day, k, min_n, shrink):
    lo = day - timedelta(days=LOOKBACK)
    w = long[(long.day >= lo) & (long.day < day)]
    t = w.groupby("team").gold.agg(["size", "sum"])
    t = t[t["size"] >= min_n]
    base = w.gold.mean()
    t["rate"] = (t["sum"] + shrink * base) / (t["size"] + shrink)
    return t.sort_values(["rate", "size"], ascending=False).head(k)


first = d.day.min() + timedelta(days=LOOKBACK)
test_days = sorted(x for x in d.day.unique() if x >= first)
league_rate = d.groupby("country").gold.mean().to_dict()


def evaluate(k, min_n, shrink, label):
    a_gold, a_n, b_gold, b_n = 0, 0, 0, 0
    exp_gold = 0.0
    ctry_counter = Counter()
    for day in test_days:
        top = top_for(day, k, min_n, shrink)
        ts = set(top.index)
        for t in ts:
            ctry_counter[team_country.get(t, "?")] += 1
        m = d[d.day == day]
        star = m.hk.isin(ts) | m.ak.isin(ts)
        s = m[star]
        a_n += len(s)
        a_gold += int(s.gold.sum())
        o = m[~star]
        b_n += len(o)
        b_gold += int(o.gold.sum())
        for _, r in s.iterrows():
            c = r.country if isinstance(r.country, str) else team_country.get(r.hk) or team_country.get(r.ak)
            exp_gold += league_rate.get(c, d.gold.mean())
    print(label, {"starred": a_n, "gold_rate": round(a_gold / max(a_n, 1), 4), "others_rate": round(b_gold / max(b_n, 1), 4),
                  "expected_by_country": round(exp_gold / max(a_n, 1), 4)})
    print("   starred team-days by country:", dict(ctry_counter.most_common(6)))


for k, mn, sh, lab in ((20, 5, 0, "RAW top20 min5"), (20, 5, 10, "SHRINK10 top20 min5"), (20, 8, 10, "SHRINK10 top20 min8"), (20, 10, 20, "SHRINK20 top20 min10")):
    evaluate(k, mn, sh, lab)

last = d.day.max() + timedelta(days=1)
cur = top_for(last, 20, 5, 0)
print("current raw top20 countries:", dict(Counter(team_country.get(t, "?") for t in cur.index)))
cur2 = top_for(last, 20, 8, 10)
print("current shrink10 min8 top20 countries:", dict(Counter(team_country.get(t, "?") for t in cur2.index)))
