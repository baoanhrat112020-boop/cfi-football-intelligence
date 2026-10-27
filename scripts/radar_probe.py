import json
import os
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
sn = sb.table("suggest_snapshot").select("snapshot_date,payload").order("snapshot_date", desc=True).limit(1).execute().data[0]
ms = [m for sl in sn["payload"].get("slots", []) for m in sl.get("matches", []) if m.get("fixture_id")]
print("snapshot", sn["snapshot_date"], "matches", len(ms))
print("match keys", sorted(ms[0].keys())[:60])
ids = [m["fixture_id"] for m in ms]
got = {}
for i in range(0, len(ids), 80):
    r = sb.table("cfi_living_verified_fixtures").select("*").in_("fixture_id", ids[i:i + 80]).execute().data
    for x in r:
        got[x["fixture_id"]] = x
print("view rows", len(got))
if got:
    k = next(iter(got))
    print("view columns", sorted(got[k].keys()))
    print("sample", json.dumps(got[k], default=str)[:500])
with_ids = sum(1 for x in got.values() if x.get("canonical_home_team_id") and x.get("canonical_away_team_id"))
print("with both team ids", with_ids)
print("sample competitions", sorted({m.get("competition") for m in ms if m.get("competition")})[:12])
