import os, re, uuid as U, json
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
                        events[eid] = {**ev, "_stage": stage.get("Cnm"), "_league": stage.get("Snm") or stage.get("Cnm")}
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

all_events = []
for day in range(-7, 3):
    events = crawl_day(day)
    all_events.extend(events)
    print(f"  day -{day}: {len(events)} events")

# Insert SCHEDULED (future) matches to cfi_living_verified_fixtures
scheduled_ok = 0
for m in all_events:
    if m.get("Eps") == "FT":  # skip finished, xử lý ở dưới
        continue
    if not m.get("T1") or not m.get("T2"): continue
    h_name = m["T1"][0].get("Nm")
    a_name = m["T2"][0].get("Nm")
    if not h_name or not a_name or h_name == a_name: continue
    h_id = cfi_teams.get(norm(h_name))
    a_id = cfi_teams.get(norm(a_name))
    # Cho phép null team_id cho SCHEDULED (national teams, clubs lạ)
    # Vẫn insert để app hiển thị; predict sẽ báo CANONICAL_IDENTITY_UNRESOLVED nếu cần
    esd = str(m.get("Esd",""))
    if len(esd) < 8: continue
    if len(esd) >= 14:
        kickoff = f"{esd[0:4]}-{esd[4:6]}-{esd[6:8]}T{esd[8:10]}:{esd[10:12]}:{esd[12:14]}Z"
    else:
        # Date-only Esd → default 12:00 UTC
        kickoff = f"{esd[0:4]}-{esd[4:6]}-{esd[6:8]}T12:00:00Z"
    utc_dt = datetime.strptime(kickoff.replace("Z",""), "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc)
    md = utc_dt.astimezone(VN_TZ).strftime("%Y-%m-%d")
    eid = str(m.get("Eid",""))
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
        "verified_at": datetime.utcnow().isoformat() + "Z",
        "canonical_home_team_id": h_id,
        "canonical_away_team_id": a_id,
    }
    try:
        sb.table("cfi_living_verified_fixtures").upsert(live_row, on_conflict="fixture_id").execute()
        scheduled_ok += 1
    except:
        pass
print(f"Scheduled inserted: {scheduled_ok}")

finished = [e for e in all_events
            if e.get("Eps") == "FT" 
            and e.get("Trh1") is not None 
            and e.get("Trh2") is not None]
print(f"Finished with HT: {len(finished)}")

ok, fail, skip = 0, 0, 0
for m in finished:
    if not m.get("T1") or not m.get("T2"): continue
    h_name = m["T1"][0].get("Nm")
    a_name = m["T2"][0].get("Nm")
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
            pass
        cfi_teams[n] = tid
        return tid

    h_id = get_or_create_team(h_name)
    a_id = get_or_create_team(a_name)
    try:
        ft_h,ft_a = int(m.get("Tr1")), int(m.get("Tr2"))
        ht_h,ht_a = int(m.get("Trh1")), int(m.get("Trh2"))
    except: continue
    if ht_h > ft_h or ht_a > ft_a: continue
    esd = str(m.get("Esd",""))
    if len(esd) < 14: continue
    utc_dt = datetime.strptime(esd[:14], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc)
    md = utc_dt.astimezone(VN_TZ).strftime("%Y-%m-%d")
    eid = str(m.get("Eid",""))
    if not eid: continue
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

    # Also insert into cfi_living_verified_fixtures for /api/discover
    esd_full = str(m.get("Esd",""))
    if len(esd_full) >= 14:
        kickoff = f"{esd_full[0:4]}-{esd_full[4:6]}-{esd_full[6:8]}T{esd_full[8:10]}:{esd_full[10:12]}:{esd_full[12:14]}Z"
    else:
        kickoff = f"{md}T12:00:00Z"
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
        "verified_at": datetime.utcnow().isoformat() + "Z",
        "canonical_home_team_id": h_id,
        "canonical_away_team_id": a_id,
    }
    try:
        sb.table("cfi_living_verified_fixtures").upsert(live_row, on_conflict="fixture_id").execute()
    except:
        pass

print(f"\nOK: {ok}, Fail: {fail}, Skip: {skip}, Scheduled: {scheduled_ok}")
