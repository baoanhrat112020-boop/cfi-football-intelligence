import os, sys
import pandas as pd
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_SERVICE_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")

if not SB_SERVICE_KEY:
    print("ERROR: set $env:SB_SERVICE_ROLE_KEY")
    sys.exit(1)

sb = create_client(SB_URL, SB_SERVICE_KEY)

print("Loading cfi_tm_mapping_v2.csv...")
df = pd.read_csv("cfi_tm_mapping_v2.csv", encoding="utf-8-sig")

# Chỉ giữ cột cần
out = df[["team_id", "canonical_name", "norm_name", "domestic_competition_id", "total_market_value"]].copy()
out["canonical_name"] = out["canonical_name"].fillna("").astype(str)
out["norm_name"] = out["norm_name"].fillna("").astype(str)
out["domestic_competition_id"] = out["domestic_competition_id"].fillna("").astype(str)
out["total_market_value"] = pd.to_numeric(out["total_market_value"], errors="coerce").fillna(0)

rows = out.to_dict(orient="records")
print(f"Uploading {len(rows)} teams...")

BATCH = 500
for i in range(0, len(rows), BATCH):
    sb.table("cfi_team_names").upsert(rows[i:i+BATCH]).execute()
    print(f"  {min(i+BATCH, len(rows))}/{len(rows)}")

print(f"\n✓ Uploaded {len(rows)} teams to cfi_team_names")