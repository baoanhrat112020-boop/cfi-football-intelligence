import os
import pandas as pd
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
ids, off = [], 0
while True:
    r = sb.table("suggest_pick_log").select("fixture_id").not_.is_("ft_home", "null").range(off, off + 999).execute().data
    ids += [x["fixture_id"] for x in r]
    if len(r) < 1000:
        break
    off += 1000
rows = []
for i in range(0, len(ids), 150):
    ch = ids[i:i + 150]
    off = 0
    while True:
        r = sb.table("match_odds").select("verified_fixture_id,market_family,period,line,p_implied_over,odds_home,odds_draw,odds_away,league").in_("verified_fixture_id", ch).range(off, off + 999).execute().data
        rows += r
        if len(r) < 1000:
            break
        off += 1000
d = pd.DataFrame(rows)
print("fixtures", len(ids), "odds rows", len(d), "fixtures with odds", d.verified_fixture_id.nunique())
g = d.groupby(["market_family", "period"]).agg(n=("line", "size"), fx=("verified_fixture_id", "nunique"), has_pimp=("p_implied_over", lambda s: s.notna().mean()), has_home=("odds_home", lambda s: s.notna().mean()))
print(g.to_string())
print(d.league.nunique(), "leagues")
