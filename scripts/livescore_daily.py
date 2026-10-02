import os, re, uuid as U, json
from collections import Counter
from datetime import datetime, timedelta, timezone
VN_TZ = timezone(timedelta(hours=7))
from curl_cffi import requests as cf
from supabase import create_client
import sys
sys.path.insert(0, 'scripts')
from cfi_tier import classify_tier

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SB_KEY:
    print("ERROR: SB_SERVICE_ROLE_KEY not set"); exit(1)

sb = create_client(SB_URL, SB_KEY)

def norm(s):
    if not s: return ""
    return re.sub(r"\s+", " ", s.lower().strip())

def crawl_day(day_offset):
    date = datetime.now().date() - timedelta(days=day_offset)
    ymd = date.strftime("%Y%m%d")
    events = {}
    for page in range(5):
        url = f"https://prod-cdn-mev-api.livescore.com/v1/api/app/date/soccer/{ymd}/{page}?MD=1"
        try:
            r = cf.get(url, impersonate="chrome120", timeout=20)
            if r.status_code != 200: break
            d = json.loads(r.text)
            stages = d.get("Stages", [])
            if not stages: break
            n_new = 0
            for stage in stages:
                for ev in stage.get("Events", []):
                    eid = ev.get("Eid")
                    if eid and eid not in events:
                        events[eid] = {**ev, "_stage": stage.get("Cnm"), "_league": stage.get("Snm") or stage.get("Cnm"), "_ymd": ymd}
                        n_new += 1
            if n_new == 0: break
        except Exception as e:
            print(f"  err: {e}"); break
    return list(events.values())

print("Loading teams...")
cfi_teams = {}
off = 0
while True:
    r = sb.table("teams").select("team_id,canonical_name").range(off, off+999).execute()
    if not r.data: break
    for t in r.data:
        n = norm(t["canonical_name"])
        if n: cfi_teams[n] = t["team_id"]
    off += 1000
    if len(r.data) < 1000: break
print(f"  {len(cfi_teams)} teams")

existing_map = {}
_off = 0
while True:
    _r = sb.table("cfi_living_verified_fixtures").select("fixture_id,kickoff_at").range(_off, _off+999).execute()
    if not _r.data: break
    for _x in _r.data:
        _k = _x.get("kickoff_at")
        if _k:
            try:
                existing_map[_x["fixture_id"]] = datetime.fromisoformat(str(_k).replace("Z","+00:00"))
            except: pass
    _off += 1000
    if len(_r.data) < 1000: break
print(f"  Loaded {len(existing_map)} existing fixtures")

all_events = []
for day in range(-1, 2):
    events = crawl_day(day)
    all_events.extend(events)
    print(f"  day {day}: {len(events)} events")

drop = Counter()
print(f"API events total: {len(all_events)}")

def team_names(m):
    t1, t2 = m.get("T1"), m.get("T2")
    if not t1 or not t2: return None, None
    return t1[0].get("Nm"), t2[0].get("Nm")

def kickoff_of(m):
    esd = str(m.get("Esd", ""))
    if len(esd) >= 14:
        return f"{esd[0:4]}-{esd[4:6]}-{esd[6:8]}T{esd[8:10]}:{esd[10:12]}:{esd[12:14]}Z"
    if len(esd) < 8:
        esd = str(m.get("_ymd", ""))
    if len(esd) < 8: return None
    return f"{esd[0:4]}-{esd[4:6]}-{esd[6:8]}T12:00:00Z"

finished = [e for e in all_events if e.get("Eps") == "FT"]
print(f"Finished (FT): {len(finished)}")

ok, fail = 0, 0
for m in finished:
    if m.get("Trh1") is None or m.get("Trh2") is None:
        drop["fixtures_skip_no_ht"] += 1; continue
    h_name, a_name = team_names(m)
    if not h_name or not a_name or h_name == a_name: continue
    def get_or_create_team(name):
        n = norm(name)
        if n in cfi_teams:
            return cfi_teams[n]
        tid = str(U.uuid5(U.NAMESPACE_DNS, f"cfi_team:{n}"))
        try:
            sb.table("teams").upsert({
                "team_id": tid,
                "canonical_name": name,
            }, on_conflict="team_id").execute()
        except Exception:
            return None
        cfi_teams[n] = tid
        return tid

    h_id = get_or_create_team(h_name)
    a_id = get_or_create_team(a_name)
    if not h_id or not a_id:
        drop["fixtures_skip_team_create_fail"] += 1; continue
    try:
        ft_h,ft_a = int(m.get("Tr1")), int(m.get("Tr2"))
        ht_h,ht_a = int(m.get("Trh1")), int(m.get("Trh2"))
    except:
        drop["fixtures_skip_bad_score"] += 1; continue
    if ht_h > ft_h or ht_a > ft_a:
        drop["fixtures_skip_ht_gt_ft"] += 1; continue
    esd = str(m.get("Esd",""))
    if len(esd) < 14:
        drop["fixtures_skip_esd_short"] += 1; continue
    utc_dt = datetime.strptime(esd[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    md = utc_dt.astimezone(VN_TZ).strftime("%Y-%m-%d")
    eid = str(m.get("Eid",""))
    if not eid:
        drop["fixtures_skip_no_eid"] += 1; continue
    fid = str(U.uuid5(U.NAMESPACE_DNS, f"livescore:{eid}"))
    row = {
        "fixture_id": fid, "match_date": md,
        "home_team_id": h_id, "away_team_id": a_id,
        "ht_home": ht_h, "ht_away": ht_a,
        "ft_home": ft_h, "ft_away": ft_a,
        "status": "CANONICAL",
        "competition_key": "livescore:" + (m.get("_league") or m.get("_stage") or "unknown").strip().lower().replace(" ","_")[:50],
        "tier": classify_tier(("livescore:" + (m.get("_league") or m.get("_stage") or "unknown").strip().lower().replace(" ","_")[:50])),
        "competition_name": m.get("_league") or m.get("_stage"),
    }
    try:
        sb.table("fixtures").insert(row).execute()
        ok += 1
    except:
        try:
            sb.table("fixtures").upsert(row, on_conflict="fixture_id").execute()
            ok += 1
        except:
            fail += 1

staged_ok = 0
for m in all_events:
    h_name, a_name = team_names(m)
    if not h_name or not a_name:
        drop["staging_skip_no_team_name"] += 1; continue
    if h_name == a_name:
        drop["staging_skip_same_team_name"] += 1; continue
    eid = str(m.get("Eid",""))
    if not eid:
        drop["staging_skip_no_eid"] += 1; continue
    kickoff = kickoff_of(m)
    if not kickoff:
        drop["staging_skip_no_date"] += 1; continue
    utc_dt = datetime.strptime(kickoff.replace("Z",""), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    md = utc_dt.astimezone(VN_TZ).strftime("%Y-%m-%d")
    fid = str(U.uuid5(U.NAMESPACE_DNS, f"livescore:{eid}"))
    live_row = {
        "fixture_id": fid,
        "target_date": md,
        "kickoff_at": kickoff,
        "home_team": h_name,
        "away_team": a_name,
        "home_team_norm": norm(h_name),
        "away_team_norm": norm(a_name),
        "competition": m.get("_stage"),
        "verification_status": "VERIFIED",
        "source_name": "LIVESCORE",
        "source_url": f"https://www.livescore.com/en/football/match/{eid}",
        "source_provenance": {"provider": "LIVESCORE", "providerId": eid, "stage": m.get("_stage")},
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "canonical_home_team_id": cfi_teams.get(norm(h_name)),
        "canonical_away_team_id": cfi_teams.get(norm(a_name)),
    }
    if fid in existing_map:
        try:
            _new_dt = datetime.fromisoformat(kickoff.replace("Z","+00:00"))
            if existing_map[fid] == _new_dt:
                drop["staging_unchanged_in_db"] += 1; continue
        except: pass
    try:
        sb.table("cfi_living_verified_fixtures").upsert(live_row, on_conflict="fixture_id").execute()
        staged_ok += 1
    except Exception as e:
        drop["staging_upsert_error"] += 1
        if drop["staging_upsert_error"] <= 5:
            print(f"  staging error {h_name} vs {a_name}: {str(e)[:160]}")

print("\nFUNNEL")
print(f"  api_total                 {len(all_events)}")
for k in sorted(drop):
    print(f"  {k:<32}{drop[k]}")
print(f"  staging_upserted          {staged_ok}")
print(f"  fixtures_inserted         {ok}")
print(f"\nOK: {ok}, Fail: {fail}, Staged: {staged_ok}")
