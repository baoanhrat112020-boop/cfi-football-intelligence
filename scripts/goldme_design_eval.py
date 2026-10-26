import os
from datetime import date, timedelta
from collections import Counter

import pandas as pd
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
cnt = sb.table("fixtures").select("fixture_id", count="exact").limit(1).execute()
print("fixtures total", cnt.count)
c2 = sb.table("fixtures").select("fixture_id", count="exact").not_.is_("ht_home", "null").not_.is_("ft_home", "null").limit(1).execute()
print("fixtures with HT+FT", c2.count)
for y in (2023, 2024, 2025, 2026):
    cy = sb.table("fixtures").select("fixture_id", count="exact").gte("match_date", f"{y}-01-01").lt("match_date", f"{y + 1}-01-01").not_.is_("ht_home", "null").limit(1).execute()
    print("year", y, "with HT", cy.count)

since = (date.today() - timedelta(days=545)).isoformat()
cols = "match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,tier,country,competition_key,competition_name"
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
print("rows used", len(d), "span", d.day.min(), d.day.max(), "teams", len(set(d.home_team_id) | set(d.away_team_id)))
print("tier counts", d.tier.value_counts(dropna=False).to_dict())
e = d[d.country == "England"]
g = e.groupby(["competition_name", "tier"]).gold.agg(["size", "mean"]).sort_values("size", ascending=False).head(45)
print("England competitions (n, gold rate):")
for (nm, t), r in g.iterrows():
    print("  ", nm, "|", t, "|", int(r["size"]), round(r["mean"], 3))
print("countries with >=1500 matches:", {k: v for k, v in d.country.value_counts().items() if v >= 1500})

d["lg"] = d.competition_key.fillna("UNK").astype(str)
d["hk"] = d.home_team_id.astype(str)
d["ak"] = d.away_team_id.astype(str)
long = pd.concat([d[["day", "hk", "gold", "lg", "country"]].rename(columns={"hk": "team"}), d[["day", "ak", "gold", "lg", "country"]].rename(columns={"ak": "team"})])
g_all = d.gold.mean()


def lists(day, look, min_n):
    lo = day - timedelta(days=look)
    w = long[(long.day >= lo) & (long.day < day)]
    lrate = w.groupby("lg").gold.agg(["size", "mean"])
    lrate["r"] = (lrate["size"] * lrate["mean"] + 30 * g_all) / (lrate["size"] + 30)
    w = w.assign(exp=w.lg.map(lrate["r"]).fillna(g_all))
    t = w.groupby("team").agg(n=("gold", "size"), hits=("gold", "sum"), exp=("exp", "sum"), lg=("lg", "last"), ctry=("country", "last"))
    t = t[t["n"] >= min_n]
    t["excess"] = (t.hits - t.exp) / (t.n + 10)
    return t, lrate["r"]


def evaluate(look, min_n, cap, label):
    first = d.day.min() + timedelta(days=look)
    days = [x for x in sorted(d.day.unique()) if x >= first][::4]
    n = gold = exp = 0.0
    ctr, ctries = Counter(), set()
    for day in days:
        t, lrate = lists(day, look, min_n)
        t = t.sort_values(["excess", "n"], ascending=False)
        if cap:
            t = t.groupby("lg", sort=False).head(cap)
        top = t.head(20)
        for _, r in top.iterrows():
            ctr[r.ctry] += 1
        ts = set(top.index)
        m = d[d.day == day]
        star = m.hk.isin(ts) | m.ak.isin(ts)
        n += int(star.sum())
        gold += float(m[star].gold.sum())
        exp += float(m[star].lg.map(lrate).fillna(g_all).sum())
    print(label, {"test_days": len(days), "starred": int(n), "gold_rate": round(gold / max(n, 1), 4), "expected_by_league": round(exp / max(n, 1), 4),
                  "uplift": round(gold / max(exp, 1e-9), 3), "countries": len([k for k in ctr if k]), "top_countries": dict(ctr.most_common(5))})


for look in (60, 120, 180, 365):
    for mn in (8, 12):
        evaluate(look, mn, 0, f"EXCESS look={look} min={mn}")
evaluate(120, 8, 2, "EXCESS look=120 min=8 cap2/league")
evaluate(180, 8, 2, "EXCESS look=180 min=8 cap2/league")
