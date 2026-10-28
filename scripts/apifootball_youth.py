import argparse
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid as U
from datetime import datetime, timedelta, timezone

BASE = "https://v3.football.api-sports.io"
SB_URL = "https://zbwkowqluwuvsnajkuvc.supabase.co"
VN_TZ = timezone(timedelta(hours=7))
LEAGUES = {
    703: "Professional Development League",
    1039: "Premier League International Cup",
    871: "Premier League Cup",
}
FINISHED = {"FT", "AET", "PEN"}
UPCOMING = {"NS", "TBD"}
STOP = {"fc", "cf", "sc", "ac", "afc", "fk", "sk", "bk", "if", "ik", "cd", "ca", "club", "de", "ud", "sd", "the", "and"}
ALIASES = {
    "wolves": "wolverhampton wanderers",
    "spurs": "tottenham hotspur",
    "man city": "manchester city",
    "man utd": "manchester united",
    "man united": "manchester united",
    "nottm forest": "nottingham forest",
    "nott m forest": "nottingham forest",
    "qpr": "queens park rangers",
    "west brom": "west bromwich albion",
    "sheff utd": "sheffield united",
    "sheff wed": "sheffield wednesday",
    "sheffield wed": "sheffield wednesday",
}
SUFFIX = re.compile(r"^(u\d\d|ii|iii|b|w|2|3|reserves|res|youth|academy|women)$")
DUP_WINDOW = timedelta(hours=36)
RPC_BATCH = 500


def fold_key(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.category(c).startswith("M"))
    s = s.lower().replace("&", " and ")
    return " ".join("".join(c if c.isalnum() else " " for c in s).split())


def norm(s):
    if not s:
        return ""
    return re.sub(r"\s+", " ", s.lower().strip())


def split_tokens(name):
    folded = fold_key(name)
    for alias, full in ALIASES.items():
        if folded == alias or folded.startswith(alias + " "):
            folded = full + folded[len(alias):]
            break
    toks = [t for t in folded.split() if t not in STOP]
    return frozenset(t for t in toks if not SUFFIX.match(t)), frozenset(t for t in toks if SUFFIX.match(t))


def api_get(path, key):
    for attempt in range(3):
        req = urllib.request.Request(BASE + path, headers={"x-apisports-key": key})
        try:
            with urllib.request.urlopen(req, timeout=40) as r:
                body = json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                print("http 429", path, "attempt", attempt + 1)
                time.sleep(20 * (attempt + 1))
                continue
            raise
        errs = body.get("errors")
        if errs and "rate" in json.dumps(errs).lower():
            time.sleep(20 * (attempt + 1))
            continue
        if errs:
            print("api error", path, errs)
        return body
    return None


def sb_request(key, method, path, body=None, headers=None):
    hdrs = {"apikey": key, "Authorization": "Bearer " + key}
    if body is not None:
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(SB_URL + "/rest/v1/" + path, data=data, method=method, headers=hdrs)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else None


def fetch_events(key, days):
    out, used = [], 0
    for d in days:
        body = api_get("/fixtures?date=%s" % d, key)
        used += 1
        if body is None:
            print("rate limited, stopping at", d)
            break
        for f in body.get("response") or []:
            if (f.get("league") or {}).get("id") in LEAGUES:
                out.append(f)
        time.sleep(0.5)
    return out, used


def load_exact(key, names):
    keys = sorted({fold_key(n) for n in names if n} - {""})
    teams = {}
    for i in range(0, len(keys), 100):
        inlist = ",".join('"%s"' % k for k in keys[i:i + 100])
        q = "teams?select=team_id,canonical_name,folded_name&folded_name=in.(%s)" % urllib.parse.quote(inlist, safe='(),"')
        for t in sb_request(key, "GET", q) or []:
            teams[t["folded_name"]] = t["team_id"]
    return teams


def load_youth_teams(key):
    out, off = [], 0
    while True:
        q = "teams?select=team_id,canonical_name&or=(canonical_name.ilike.*U21*,canonical_name.ilike.*U23*,canonical_name.ilike.*U19*,canonical_name.ilike.*U20*)&order=team_id&limit=1000&offset=%d" % off
        page = sb_request(key, "GET", q) or []
        out += page
        if len(page) < 1000:
            return out
        off += 1000


class Resolver:
    def __init__(self, exact, youth, dry):
        self.exact = exact
        self.dry = dry
        self.by_split = {}
        for t in youth:
            core, suf = split_tokens(t["canonical_name"])
            if core:
                self.by_split.setdefault(suf, []).append((core, t["team_id"], t["canonical_name"]))
        self.created = {}
        self.fuzzy = {}
        self.pending = []

    def resolve(self, name):
        fk = fold_key(name)
        if fk in self.exact:
            return self.exact[fk], "exact"
        if name in self.created:
            return self.created[name], "created"
        core, suf = split_tokens(name)
        if core and suf:
            cands = self.by_split.get(suf, [])
            hits = {tid for c, tid, _ in cands if c == core} or {tid for c, tid, _ in cands if core <= c or c <= core}
            if len(hits) == 1:
                tid = next(iter(hits))
                self.fuzzy[name] = tid
                return tid, "fuzzy"
        tid = str(U.uuid5(U.NAMESPACE_DNS, "cfi_team:" + norm(name)))
        self.created[name] = tid
        self.pending.append({"team_id": tid, "canonical_name": name})
        return tid, "created"

    def flush(self, key):
        if self.dry or not self.pending:
            return
        for i in range(0, len(self.pending), 200):
            sb_request(key, "POST", "teams?on_conflict=team_id", self.pending[i:i + 200], {"Prefer": "resolution=merge-duplicates,return=minimal"})


def league_slug(name):
    return "apifootball:" + re.sub(r"\s+", "_", name.strip().lower())[:50]


def build_rows(events, resolver):
    fixtures, living, kinds = {}, [], {}
    for f in events:
        fx, lg, tm = f["fixture"], f["league"], f["teams"]
        h_name, a_name = tm["home"]["name"], tm["away"]["name"]
        if not h_name or not a_name or h_name == a_name:
            continue
        status = (fx.get("status") or {}).get("short")
        kickoff = datetime.fromisoformat(fx["date"]).astimezone(timezone.utc)
        h_id, hk = resolver.resolve(h_name)
        a_id, ak = resolver.resolve(a_name)
        kinds[hk] = kinds.get(hk, 0) + 1
        kinds[ak] = kinds.get(ak, 0) + 1
        fid = str(U.uuid5(U.NAMESPACE_DNS, "apifootball:%s" % fx["id"]))
        md = kickoff.astimezone(VN_TZ).strftime("%Y-%m-%d")
        if status in FINISHED:
            sc = f.get("score") or {}
            ht, ft = sc.get("halftime") or {}, sc.get("fulltime") or {}
            vals = [ht.get("home"), ht.get("away"), ft.get("home"), ft.get("away")]
            if any(v is None for v in vals) or ht["home"] > ft["home"] or ht["away"] > ft["away"]:
                continue
            fixtures[fid] = {
                "fixture_id": fid, "match_date": md, "home_team_id": h_id, "away_team_id": a_id,
                "ht_home": ht["home"], "ht_away": ht["away"], "ft_home": ft["home"], "ft_away": ft["away"],
                "status": "CANONICAL", "competition_key": league_slug(lg["name"]), "tier": "minor",
                "competition_name": lg["name"], "country": lg.get("country"),
            }
        elif status in UPCOMING:
            living.append({
                "fixture_id": fid, "target_date": md, "kickoff_at": kickoff.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "home_team": h_name, "away_team": a_name, "home_team_norm": norm(h_name), "away_team_norm": norm(a_name),
                "competition": lg.get("country"), "verification_status": "VERIFIED", "source_name": "APIFOOTBALL",
                "source_url": "https://www.api-football.com/",
                "source_provenance": {"provider": "APIFOOTBALL", "providerId": str(fx["id"]), "stage": lg.get("country"), "league": lg["name"]},
                "verified_at": datetime.now(timezone.utc).isoformat(),
                "canonical_home_team_id": h_id, "canonical_away_team_id": a_id,
            })
    return list(fixtures.values()), living, kinds


def drop_duplicates(key, living):
    if not living:
        return living, 0
    lo = min(datetime.fromisoformat(r["kickoff_at"].replace("Z", "+00:00")) for r in living) - DUP_WINDOW
    hi = max(datetime.fromisoformat(r["kickoff_at"].replace("Z", "+00:00")) for r in living) + DUP_WINDOW
    q = "cfi_living_verified_fixtures?select=fixture_id,kickoff_at,canonical_home_team_id,canonical_away_team_id&kickoff_at=gte.%s&kickoff_at=lte.%s&limit=1000" % (
        lo.strftime("%Y-%m-%dT%H:%M:%SZ"), hi.strftime("%Y-%m-%dT%H:%M:%SZ"))
    existing = []
    for r in sb_request(key, "GET", q) or []:
        if r["canonical_home_team_id"] and r["canonical_away_team_id"]:
            existing.append((r["canonical_home_team_id"], r["canonical_away_team_id"], datetime.fromisoformat(r["kickoff_at"].replace("Z", "+00:00")), r["fixture_id"]))
    keep, dup = [], 0
    for r in living:
        ko = datetime.fromisoformat(r["kickoff_at"].replace("Z", "+00:00"))
        clash = any(h == r["canonical_home_team_id"] and a == r["canonical_away_team_id"] and abs(k - ko) <= DUP_WINDOW and fid != r["fixture_id"] for h, a, k, fid in existing)
        if clash:
            dup += 1
        else:
            keep.append(r)
    return keep, dup


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    api_key = os.environ["APIFOOTBALL_KEY"]
    sb_key = os.environ["SB_SERVICE_ROLE_KEY"]
    today = datetime.now(timezone.utc).date()
    days = [(today + timedelta(days=d)).isoformat() for d in (-1, 0, 1)]
    events, used = fetch_events(api_key, days)
    print("api requests", used, "events in leagues", len(events))
    by_league = {}
    for f in events:
        by_league[f["league"]["name"]] = by_league.get(f["league"]["name"], 0) + 1
    print("by league", json.dumps(by_league))
    if not events:
        return
    names = {f["teams"]["home"]["name"] for f in events} | {f["teams"]["away"]["name"] for f in events}
    resolver = Resolver(load_exact(sb_key, names), load_youth_teams(sb_key), args.dry_run)
    fixtures, living, kinds = build_rows(events, resolver)
    living, dup = drop_duplicates(sb_key, living)
    print("team resolution", json.dumps(kinds), "fuzzy", json.dumps(resolver.fuzzy, ensure_ascii=False), "new teams", len(resolver.pending))
    print("finished rows", len(fixtures), "upcoming rows", len(living), "skipped as duplicate of existing", dup)
    if args.dry_run:
        for r in living[:10]:
            print("  upcoming", r["home_team"], "v", r["away_team"], r["kickoff_at"], r["source_provenance"]["league"])
        for r in fixtures[:10]:
            print("  finished", r["match_date"], r["home_team_id"][:8], r["away_team_id"][:8], r["ht_home"], r["ht_away"], r["ft_home"], r["ft_away"], r["competition_name"])
        return
    resolver.flush(sb_key)
    inserted = updated = 0
    for i in range(0, len(fixtures), RPC_BATCH):
        d = sb_request(sb_key, "POST", "rpc/cfi_upsert_livescore_fixtures", {"p_rows": fixtures[i:i + RPC_BATCH]})
        if not isinstance(d, dict) or d.get("status") != "OK":
            print("rpc bad response", d)
            sys.exit(1)
        inserted += int(d.get("inserted", 0))
        updated += int(d.get("updated", 0))
    staged = 0
    for r in living:
        sb_request(sb_key, "POST", "cfi_living_verified_fixtures?on_conflict=fixture_id", r, {"Prefer": "resolution=merge-duplicates,return=minimal"})
        staged += 1
    print("fixtures inserted", inserted, "updated", updated, "staged", staged)


if __name__ == "__main__":
    main()
