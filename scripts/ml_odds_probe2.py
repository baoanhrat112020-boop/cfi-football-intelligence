import os
import pandas as pd
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])


def pull(table, select, fn=None, step=1000, cap=20000):
    out, off = [], 0
    while off < cap:
        q = sb.table(table).select(select)
        if fn:
            q = fn(q)
        r = q.range(off, off + step - 1).execute().data
        out += r
        if len(r) < step:
            break
        off += step
    return out


bc = pd.DataFrame(pull("best_choice_daily", "competition,tier", cap=3000))
print("best_choice competitions sample", bc.competition.drop_duplicates().head(12).tolist())
lt = pd.DataFrame(pull("cfi_league_tiers", "*", cap=500))
print("tier cols", lt.columns.tolist())
print(lt.head(8).to_string())
lg = pd.DataFrame(pull("match_odds", "league,verified_fixture_id", cap=6000))
print("match_odds league sample", lg.league.drop_duplicates().head(15).tolist())
sp = pd.DataFrame(pull("suggest_pick_log", "fixture_id,kickoff_at", lambda q: q.not_.is_("ft_home", "null").order("kickoff_at", desc=True), cap=3000))
ids = sp.fixture_id.tolist()
o = []
for i in range(0, len(ids), 150):
    o += pull("match_odds", "verified_fixture_id,market_family,period,first_seen_at,last_seen_at,n_fetches", lambda q, ch=ids[i:i + 150]: q.in_("verified_fixture_id", ch), cap=5000)
o = pd.DataFrame(o).merge(sp, left_on="verified_fixture_id", right_on="fixture_id")
for c in ["first_seen_at", "last_seen_at", "kickoff_at"]:
    o[c] = pd.to_datetime(o[c], utc=True)
o["first_h"] = (o.kickoff_at - o.first_seen_at).dt.total_seconds() / 3600
o["last_h"] = (o.kickoff_at - o.last_seen_at).dt.total_seconds() / 3600
print("rows", len(o))
print("hours before kickoff first_seen", o.first_h.describe(percentiles=[.05, .25, .5, .75, .95]).round(1).to_dict())
print("hours before kickoff last_seen", o.last_h.describe(percentiles=[.05, .25, .5, .75, .95]).round(1).to_dict())
print("share last_seen after kickoff", round((o.last_h < 0).mean(), 3), "share first_seen after kickoff", round((o.first_h < 0).mean(), 3))
print("n_fetches", o.n_fetches.describe().round(1).to_dict())
