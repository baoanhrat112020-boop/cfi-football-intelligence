import os, re
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY","")
sb = create_client(SB_URL, SB_KEY)

def norm(s):
    if not s: return ""
    s = s.lower().strip()
    s = re.sub(r"\s+", " ", s)
    return s

def strip_suffix(s):
    """Remove common suffixes: FC, CF, SC, AFC, United -> still keep variants"""
    s = re.sub(r"\b(fc|cf|sc|afc|fk|sk|ac|as|cd|club|calcio)\b", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s

print("Loading teams...")
teams = []
off = 0
while True:
    r = sb.table("teams").select("team_id,canonical_name,normalized_name").range(off, off+999).execute()
    if not r.data: break
    teams.extend(r.data); off += 1000
    if len(r.data) < 1000: break
print(f"  {len(teams)} teams")

# Build lookup indexes
by_norm = {}
by_strip = {}
by_canon = {}
for t in teams:
    n = t.get("normalized_name") or norm(t.get("canonical_name",""))
    c = t.get("canonical_name","")
    if n: by_norm[n] = t["team_id"]
    if c: by_canon[c.lower().strip()] = t["team_id"]
    s = strip_suffix(n)
    if s and s not in by_strip: by_strip[s] = t["team_id"]

def find_team(name):
    if not name: return None
    n = norm(name)
    if n in by_norm: return by_norm[n]
    if name.lower().strip() in by_canon: return by_canon[name.lower().strip()]
    s = strip_suffix(n)
    if s in by_strip: return by_strip[s]
    return None

print("\nLoading FLASHSCORE rows without canonical...")
rows = []
off = 0
while True:
    r = sb.table("cfi_living_verified_fixtures")\
        .select("fixture_id,home_team,away_team,home_team_norm,away_team_norm,canonical_home_team_id,canonical_away_team_id")\
        .eq("source_name", "FLASHSCORE")\
        .range(off, off+999).execute()
    if not r.data: break
    rows.extend(r.data); off += 1000
    if len(r.data) < 1000: break
print(f"  {len(rows)} FLASHSCORE rows")

need_fix = [r for r in rows if not r["canonical_home_team_id"] or not r["canonical_away_team_id"]]
print(f"  {len(need_fix)} need canonical IDs")

updates = []
for r in need_fix:
    h_id = find_team(r["home_team"])
    a_id = find_team(r["away_team"])
    if h_id and a_id:
        updates.append({
            "fixture_id": r["fixture_id"],
            "canonical_home_team_id": h_id,
            "canonical_away_team_id": a_id,
        })

print(f"\nMatched both: {len(updates)}")
if not updates:
    print("Nothing to update")
    exit(0)

BATCH = 500
for i in range(0, len(updates), BATCH):
    batch = updates[i:i+BATCH]
    try:
        sb.table("cfi_living_verified_fixtures").upsert(batch, on_conflict="fixture_id").execute()
        print(f"  Batch {i//BATCH+1}: OK ({len(batch)})")
    except Exception as e:
        print(f"  Batch {i//BATCH+1}: FAIL {str(e)[:200]}")

print(f"\nDone. Updated {len(updates)} rows")