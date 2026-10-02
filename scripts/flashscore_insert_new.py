import os, re, hashlib, uuid as U
from datetime import datetime, timezone
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY","")
sb = create_client(SB_URL, SB_KEY)

# Load existing keys
print("Loading existing keys...")
existing = set()
off = 0
while True:
    r = sb.table("cfi_living_verified_fixtures").select("home_team_norm,away_team_norm,target_date,kickoff_at").range(off, off+999).execute()
    if not r.data: break
    for row in r.data:
        existing.add(f"{row['home_team_norm']}|{row['away_team_norm']}|{row['target_date']}|{row['kickoff_at']}")
    off += 1000
    if len(r.data) < 1000: break
print(f"  {len(existing)} existing keys")

# Import insert logic từ script kia
exec(open("scripts/flashscore_whitelist.py", encoding="utf-8").read().split("# Insert with proper full row")[0])

# Rebuild rows
now_iso = datetime.now(timezone.utc).isoformat()
rows = []
for m in matched:
    key = f"{norm(m['home'])}|{norm(m['away'])}|{m['date']}|{m['kickoff'].isoformat()}"
    if key in existing:
        continue
    key2 = f"{norm(m['home'])}|{norm(m['away'])}|{m['date']}|{m['kickoff'].isoformat()}"
    h = hashlib.sha256(f"{norm(m['home'])}|{norm(m['away'])}|{m['kickoff'].isoformat()}".encode()).hexdigest()[:32]
    fid = str(U.UUID(h))
    rows.append({
        "fixture_id": fid,
        "target_date": m["date"],
        "kickoff_at": m["kickoff"].isoformat(),
        "home_team": m["home"],
        "away_team": m["away"],
        "home_team_norm": norm(m["home"]),
        "away_team_norm": norm(m["away"]),
        "competition": m["league"],
        "verification_status": "VERIFIED",
        "source_name": "Football-Data fixtures.csv",
        "source_url": f"https://www.flashscore.com/match/{m['mid']}",
        "source_provenance": {"provider":"FLASHSCORE","providerId":m["mid"],"provenance":"flashscore_adapter_v1"},
        "verified_at": now_iso,
        "canonical_home_team_id": m["h_id"],
        "canonical_away_team_id": m["a_id"],
    })

print(f"\nNew rows to insert: {len(rows)}")
if rows:
    for i in range(0, len(rows), 500):
        try:
            sb.table("cfi_living_verified_fixtures").insert(rows[i:i+500]).execute()
            print(f"  Batch {i//500+1}: OK ({len(rows[i:i+500])})")
        except Exception as e:
            print(f"  Batch {i//500+1}: FAIL {str(e)[:200]}")
print(f"\nDone.")