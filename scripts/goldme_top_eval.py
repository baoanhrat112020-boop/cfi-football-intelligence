import os
import math
from datetime import date, timedelta

import pandas as pd
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
LOOKBACK = int(os.environ.get("LOOKBACK", "60"))
MIN_N = int(os.environ.get("MIN_N", "5"))
HISTORY_DAYS = int(os.environ.get("HISTORY_DAYS", "240"))

since = (date.today() - timedelta(days=HISTORY_DAYS)).isoformat()
cols = "fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,tier"
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
d["x3ht"] = d.ht_home + d.ht_away >= 3
d["xoht"] = (d.ht_home >= 4) | (d.ht_away >= 4)
d["xoft"] = (d.ft_home >= 5) | (d.ft_away >= 5)
d["x7ft"] = d.ft_home + d.ft_away >= 7
d["gold"] = d.x3ht | d.xoht | d.xoft | d.x7ft
d["hk"] = d.home_team_id.astype(str)
d["ak"] = d.away_team_id.astype(str)
print("rows", len(d), "span", d.day.min(), "->", d.day.max(), "teams", len(set(d.hk) | set(d.ak)))
print("tier counts", d.tier.value_counts(dropna=False).to_dict())
print("base gold rate", round(d.gold.mean(), 4), {k: round(float(d[k].mean()), 4) for k in ("x3ht", "xoht", "xoft", "x7ft")})

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


def build_long(df):
    return pd.concat([
        df[["day", "hk", "gold"]].rename(columns={"hk": "team"}),
        df[["day", "ak", "gold"]].rename(columns={"ak": "team"}),
    ])


def top_for(long, day, k):
    lo = day - timedelta(days=LOOKBACK)
    w = long[(long.day >= lo) & (long.day < day)]
    g = w.groupby("team").gold.agg(["size", "sum"])
    g = g[g["size"] >= MIN_N]
    g["rate"] = g["sum"] / g["size"]
    return g.sort_values(["rate", "size"], ascending=False).head(k)


def evaluate(df, k, label):
    long = build_long(df)
    first = df.day.min() + timedelta(days=LOOKBACK)
    days = sorted(x for x in df.day.unique() if x >= first)
    a, b, by_month = [], [], {}
    for day in days:
        top = set(top_for(long, day, k).index)
        m = df[df.day == day]
        star = m.hk.isin(top) | m.ak.isin(top)
        a += m[star].gold.tolist()
        b += m[~star].gold.tolist()
        mo = str(day)[:7]
        e = by_month.setdefault(mo, [0, 0, 0, 0])
        e[0] += int(star.sum())
        e[1] += int(m[star].gold.sum())
        e[2] += int((~star).sum())
        e[3] += int(m[~star].gold.sum())
    na, nb = len(a), len(b)
    pa, pb = (sum(a) / na if na else float("nan")), (sum(b) / nb if nb else float("nan"))
    pp = (sum(a) + sum(b)) / max(na + nb, 1)
    se = math.sqrt(pp * (1 - pp) * (1 / max(na, 1) + 1 / max(nb, 1)))
    print(label, {"top_k": k, "test_days": len(days), "starred": na, "starred_rate": round(pa, 4), "others": nb,
                  "others_rate": round(pb, 4), "lift": round(pa / pb, 3) if pb else None,
                  "z_naive": round((pa - pb) / se, 2) if se else None})
    print("  by month (starred n, gold, others n, gold):", {k2: v for k2, v in sorted(by_month.items())})


for k in (10, 20, 40):
    evaluate(d, k, "ALL")
nj = d[d.tier != "junk"].copy()
print("non-junk rows", len(nj))
for k in (10, 20, 40):
    evaluate(nj, k, "NON-JUNK")

long = build_long(d)
cur = top_for(long, d.day.max() + timedelta(days=1), 20)
print("Top 20 hien tai (%d ngay, toi thieu %d tran):" % (LOOKBACK, MIN_N))
for i, (t, r) in enumerate(cur.iterrows(), 1):
    print(i, names.get(t, t[:8]), int(r["size"]), int(r["sum"]), round(r["rate"], 3))
