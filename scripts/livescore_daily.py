import os, re, uuid as U, json, time, unicodedata
from collections import Counter
from datetime import datetime, timedelta, timezone
VN_TZ = timezone(timedelta(hours=7))
from curl_cffi import requests as cf
from supabase import create_client
import sys
sys.path.insert(0, 'scripts')
from cfi_tier import classify_tier

SB_URL = "https://zbwkowqluwuvsnajkuvc.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SB_KEY:
    print("ERROR: SB_SERVICE_ROLE_KEY not set"); exit(1)

sb = create_client(SB_URL, SB_KEY)

RETRY_DELAYS = (2, 5)
RPC_BATCH = 500
stats = Counter()

class LivescoreError(Exception):
    def __init__(self, msg, blocked=False, partial=None):
        super().__init__(msg)
        self.blocked = blocked
        self.partial = partial or []

def sb_exec(q):
    stats["sb_requests"] += 1
    return q.execute()

def norm(s):
    if not s: return ""
    return re.sub(r"\s+", " ", s.lower().strip())

def fetch_page(url):
    last = None
    for attempt in range(len(RETRY_DELAYS) + 1):
        stats["ls_requests"] += 1
        try:
            r = cf.get(url, impersonate="chrome120", timeout=20)
        except Exception as e:
            last = LivescoreError(f"{type(e).__name__}: {e} url={url}")
        else:
            if r.status_code == 200:
                return r
            if r.status_code in (403, 429):
                raise LivescoreError(f"http {r.status_code} url={url}", blocked=True)
            last = LivescoreError(f"http {r.status_code} url={url}")
            if r.status_code < 500:
                raise last
        if attempt < len(RETRY_DELAYS):
            stats["ls_retries"] += 1
            time.sleep(RETRY_DELAYS[attempt])
    raise last

def crawl_day(day_offset):
    date = datetime.now().date() - timedelta(days=day_offset)
    ymd = date.strftime("%Y%m%d")
    events = {}
    url = f"https://prod-cdn-mev-api.livescore.com/v1/api/app/date/soccer/{ymd}/0?MD=1"
    r = fetch_page(url)
    try:
        d = json.loads(r.text)
    except Exception as e:
        raise LivescoreError(f"bad json url={url}: {e}")
    for stage in d.get("Stages", []):
        for ev in stage.get("Events", []):
            eid = ev.get("Eid")
            if eid and eid not in events:
                events[eid] = {**ev, "_stage": stage.get("Cnm"), "_league": stage.get("Snm") or stage.get("Cnm"), "_ymd": ymd}
    return list(events.values())

def dedupe_events(events):
    by_eid = {}
    for e in events:
        eid = str(e.get("Eid"))
        cur = by_eid.get(eid)
        if cur is None:
            by_eid[eid] = e
            continue
        if str(e.get("Esd", ""))[:8] == e.get("_ymd") and str(cur.get("Esd", ""))[:8] != cur.get("_ymd"):
            by_eid[eid] = e
    return list(by_eid.values())

existing_map = {}
existing_league = {}
_off = 0
while True:
    _r = sb_exec(sb.table("cfi_living_verified_fixtures").select("fixture_id,kickoff_at,source_provenance").range(_off, _off+999))
    if not _r.data: break
    for _x in _r.data:
        _k = _x.get("kickoff_at")
        if _k:
            try:
                existing_map[_x["fixture_id"]] = datetime.fromisoformat(str(_k).replace("Z","+00:00"))
                existing_league[_x["fixture_id"]] = (_x.get("source_provenance") or {}).get("league")
            except: pass
    _off += 1000
    if len(_r.data) < 1000: break
print(f"  Loaded {len(existing_map)} existing fixtures")

all_events = []
failures = []
for day in range(-1, 2):
    try:
        events = crawl_day(day)
    except LivescoreError as e:
        failures.append(e)
        events = e.partial
        print(f"  day {day}: FAILED {e} (partial {len(events)} events)")
    all_events.extend(events)
    print(f"  day {day}: {len(events)} events")

drop = Counter()
_raw_total = len(all_events)
all_events = dedupe_events(all_events)
drop["events_deduped_by_eid"] = _raw_total - len(all_events)
print(f"API events total: {len(all_events)}")

def team_names(m):
    t1, t2 = m.get("T1"), m.get("T2")
    if not t1 or not t2: return None, None
    return t1[0].get("Nm"), t2[0].get("Nm")

def fold_key(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.category(c).startswith("M"))
    s = s.lower().replace("&", " and ")
    return " ".join("".join(c if c.isalnum() else " " for c in s).split())

def load_teams(names):
    keys = sorted({fold_key(n) for n in names if n} - {""})
    teams = {}
    for i in range(0, len(keys), 200):
        r = sb_exec(sb.table("teams").select("team_id,canonical_name").in_("folded_name", keys[i:i+200]))
        for t in r.data:
            n = norm(t["canonical_name"])
            if n: teams[n] = t["team_id"]
    return teams

print("Loading teams...")
cfi_teams = load_teams({n for m in all_events for n in team_names(m) if n})
print(f"  {len(cfi_teams)} teams")

def kickoff_of(m):
    esd = str(m.get("Esd", ""))
    if len(esd) >= 14:
        return f"{esd[0:4]}-{esd[4:6]}-{esd[6:8]}T{esd[8:10]}:{esd[10:12]}:{esd[12:14]}Z"
    if len(esd) < 8:
        esd = str(m.get("_ymd", ""))
    if len(esd) < 8: return None
    return f"{esd[0:4]}-{esd[4:6]}-{esd[6:8]}T12:00:00Z"

def get_or_create_team(name):
    n = norm(name)
    if n in cfi_teams:
        return cfi_teams[n]
    tid = str(U.uuid5(U.NAMESPACE_DNS, f"cfi_team:{n}"))
    try:
        sb_exec(sb.table("teams").upsert({
            "team_id": tid,
            "canonical_name": name,
        }, on_conflict="team_id"))
    except Exception:
        return None
    cfi_teams[n] = tid
    return tid

finished = [e for e in all_events if e.get("Eps") == "FT"]
print(f"Finished (FT): {len(finished)}")

fixture_rows = {}
for m in finished:
    if m.get("Trh1") is None or m.get("Trh2") is None:
        drop["fixtures_skip_no_ht"] += 1; continue
    h_name, a_name = team_names(m)
    if not h_name or not a_name or h_name == a_name: continue
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
    comp_key = "livescore:" + (m.get("_league") or m.get("_stage") or "unknown").strip().lower().replace(" ","_")[:50]
    fixture_rows[fid] = {
        "fixture_id": fid, "match_date": md,
        "home_team_id": h_id, "away_team_id": a_id,
        "ht_home": ht_h, "ht_away": ht_a,
        "ft_home": ft_h, "ft_away": ft_a,
        "status": "CANONICAL",
        "competition_key": comp_key,
        "tier": classify_tier(comp_key),
        "competition_name": m.get("_league") or m.get("_stage"),
    }

def rpc_fixtures(rows):
    res = sb_exec(sb.rpc("cfi_upsert_livescore_fixtures", {"p_rows": rows}))
    data = res.data
    if isinstance(data, list) and data: data = data[0]
    if not isinstance(data, dict) or data.get("status") != "OK":
        raise RuntimeError(f"rpc bad response: {data}")
    return data

fx_inserted = fx_updated = fx_skipped = fx_failed = 0
rows_list = list(fixture_rows.values())
for i in range(0, len(rows_list), RPC_BATCH):
    chunk = rows_list[i:i+RPC_BATCH]
    try:
        d = rpc_fixtures(chunk)
        fx_inserted += int(d.get("inserted", 0))
        fx_updated += int(d.get("updated", 0))
        fx_skipped += int(d.get("skipped", 0))
    except Exception as e:
        print(f"  fixtures batch failed ({len(chunk)} rows): {str(e)[:200]}; retrying per row")
        for row in chunk:
            try:
                d = rpc_fixtures([row])
                fx_inserted += int(d.get("inserted", 0))
                fx_updated += int(d.get("updated", 0))
                fx_skipped += int(d.get("skipped", 0))
            except Exception:
                fx_failed += 1

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
        "source_provenance": {"provider": "LIVESCORE", "providerId": eid, "stage": m.get("_stage"), "league": m.get("_league")},
        "verified_at": datetime.now(timezone.utc).isoformat(),
        "canonical_home_team_id": cfi_teams.get(norm(h_name)),
        "canonical_away_team_id": cfi_teams.get(norm(a_name)),
    }
    if fid in existing_map:
        try:
            _new_dt = datetime.fromisoformat(kickoff.replace("Z","+00:00"))
            if existing_map[fid] == _new_dt and existing_league.get(fid) == m.get("_league"):
                drop["staging_unchanged_in_db"] += 1; continue
        except: pass
    try:
        sb_exec(sb.table("cfi_living_verified_fixtures").upsert(live_row, on_conflict="fixture_id"))
        staged_ok += 1
        existing_map[fid] = datetime.fromisoformat(kickoff.replace("Z","+00:00"))
        existing_league[fid] = m.get("_league")
    except Exception as e:
        drop["staging_upsert_error"] += 1
        if drop["staging_upsert_error"] <= 5:
            print(f"  staging error {h_name} vs {a_name}: {str(e)[:160]}")

print("\nFUNNEL")
print(f"  api_total                 {len(all_events)}")
for k in sorted(drop):
    print(f"  {k:<32}{drop[k]}")
print(f"  staging_upserted          {staged_ok}")
print(f"  fixtures_candidates       {len(rows_list)}")
print(f"  fixtures_inserted         {fx_inserted}")
print(f"  fixtures_updated          {fx_updated}")
print(f"  fixtures_skipped          {fx_skipped}")
print(f"  fixtures_failed           {fx_failed}")
print(f"\nREQUESTS livescore={stats['ls_requests']} (retries={stats['ls_retries']}) supabase={stats['sb_requests']}")
print(f"ROWS upsert={fx_inserted + fx_updated + staged_ok} skip={fx_skipped + drop['staging_unchanged_in_db']}")
print(f"OK: {fx_inserted + fx_updated}, Fail: {fx_failed}, Staged: {staged_ok}")

if any(f.blocked for f in failures):
    exit_code = 2
elif failures or fx_failed:
    exit_code = 1
else:
    exit_code = 0
if failures:
    print(f"LIVESCORE FAILURES: {len(failures)} -> exit {exit_code}")

if __name__ == "__main__":
    sys.exit(exit_code)
