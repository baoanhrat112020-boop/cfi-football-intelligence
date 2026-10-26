import os
import json
from supabase import create_client

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
r = sb.table("fixtures").select("*").limit(2).execute().data
print("columns", sorted(r[0].keys()) if r else None)
print("sample", json.dumps(r[0], default=str)[:900] if r else None)
for col in ("kickoff_at", "kickoff", "match_date", "starts_at", "date", "kickoff_time", "start_time", "scheduled_at"):
    try:
        lo = sb.table("fixtures").select(col).not_.is_(col, "null").order(col).limit(1).execute().data
        hi = sb.table("fixtures").select(col).not_.is_(col, "null").order(col, desc=True).limit(1).execute().data
        print(col, lo, hi)
    except Exception as e:
        print(col, "n/a")
c = sb.table("fixtures").select("id", count="exact").not_.is_("ht_home", "null").limit(1).execute()
print("fixtures with ht score", c.count)
