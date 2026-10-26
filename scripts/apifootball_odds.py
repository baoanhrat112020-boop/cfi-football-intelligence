import argparse
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal

import bongdawap_odds as bdw

BASE = "https://v3.football.api-sports.io"
BOOK_PRIORITY = ["Pinnacle", "Bet365", "Marathonbet", "1xBet", "William Hill", "Betfair", "BetVictor", "SBO", "Betano"]
SOURCE = "apifootball"


def api(path, key):
    for attempt in range(4):
        req = urllib.request.Request(BASE + path, headers={"x-apisports-key": key})
        with urllib.request.urlopen(req, timeout=40) as r:
            body = json.load(r)
        errs = body.get("errors")
        if errs and "rate" in json.dumps(errs).lower():
            time.sleep(20 * (attempt + 1))
            continue
        if errs:
            print("api error", path, errs)
        return body
    return {"response": [], "paging": {"current": 1, "total": 1}}


def fixtures_for(date, key):
    out = {}
    for f in api("/fixtures?date=%s" % date, key).get("response") or []:
        out[f["fixture"]["id"]] = f
    return out


def odds_for(date, key):
    rows, page, total = [], 1, 1
    while page <= total:
        body = api("/odds?date=%s&page=%d" % (date, page), key)
        rows += body.get("response") or []
        total = (body.get("paging") or {}).get("total") or 1
        page += 1
        time.sleep(0.4)
    return rows


def pick_bet(bookmakers, name):
    by_name = {b["name"]: b for b in bookmakers}
    ordered = [by_name[n] for n in BOOK_PRIORITY if n in by_name] + [b for b in bookmakers if b["name"] not in BOOK_PRIORITY]
    for b in ordered:
        for bet in b["bets"]:
            if bet["name"] == name:
                return b["name"], bet["values"]
    return None, None


def ou_rows(values, period):
    lines = {}
    for v in values:
        side, _, ln = v["value"].partition(" ")
        if side not in ("Over", "Under"):
            continue
        try:
            lines.setdefault(Decimal(ln), {})[side] = float(v["odd"])
        except Exception:
            continue
    out = []
    for ln, d in lines.items():
        if "Over" not in d or "Under" not in d or d["Over"] <= 1 or d["Under"] <= 1:
            continue
        io, iu = 1 / d["Over"], 1 / d["Under"]
        out.append({"market_family": "OVER_UNDER", "period": period, "line": ln, "odds_over": round(d["Over"], 4),
                    "odds_under": round(d["Under"], 4), "p_implied_over": round(io / (io + iu), 4), "raw_line": str(ln)})
    return out


def build_rows(odds, fixtures):
    rows = []
    for o in odds:
        f = fixtures.get(o["fixture"]["id"])
        if not f or not o.get("bookmakers"):
            continue
        base = {
            "provider_id": "AF-%s" % o["fixture"]["id"],
            "league": "%s · %s" % (f["league"]["country"], f["league"]["name"]),
            "home": f["teams"]["home"]["name"],
            "away": f["teams"]["away"]["name"],
            "kickoff_utc": datetime.fromisoformat(f["fixture"]["date"]).astimezone(timezone.utc),
        }
        found = []
        _, mw = pick_bet(o["bookmakers"], "Match Winner")
        if mw:
            d = {v["value"]: float(v["odd"]) for v in mw}
            if all(k in d and d[k] > 1 for k in ("Home", "Draw", "Away")):
                found.append({"market_family": "1X2", "period": "FT", "line": None, "odds_home": d["Home"], "odds_draw": d["Draw"], "odds_away": d["Away"]})
        _, ft = pick_bet(o["bookmakers"], "Goals Over/Under")
        if ft:
            found += ou_rows(ft, "FT")
        _, ht = pick_bet(o["bookmakers"], "Goals Over/Under First Half")
        if ht:
            found += ou_rows(ht, "HT")
        for r in found:
            row = dict(base)
            row.update(r)
            rows.append(row)
    return rows


def to_records(inserts):
    out = []
    for pick, r, _ in inserts:
        out.append({
            "verified_fixture_id": pick["fixture_id"],
            "source": SOURCE,
            "market_family": r["market_family"],
            "period": r["period"],
            "line": None if r["line"] is None else str(r["line"]),
            "odds_over": r.get("odds_over"),
            "odds_under": r.get("odds_under"),
            "odds_home": r.get("odds_home"),
            "odds_draw": r.get("odds_draw"),
            "odds_away": r.get("odds_away"),
            "p_implied_over": r.get("p_implied_over"),
            "raw_line": r.get("raw_line"),
            "handicap_side": None,
            "league": r.get("league"),
        })
    return out


def have_bdw(sb_url, key, ids):
    have = set()
    for i in range(0, len(ids), 100):
        q = "match_odds?select=verified_fixture_id&source=eq.bongdawap&verified_fixture_id=in.(%s)&limit=1000" % ",".join(ids[i:i + 100])
        have |= {r["verified_fixture_id"] for r in bdw.sb_request(sb_url, key, "GET", q)}
    return have


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    args = ap.parse_args()
    key = os.environ["APIFOOTBALL_KEY"]
    sb_url = os.environ["SB_URL"].rstrip("/")
    sb_key = os.environ["SB_SERVICE_ROLE_KEY"]
    now = datetime.now(timezone.utc)
    fixtures, odds = {}, []
    for d in (now.date(), now.date() + timedelta(days=1), now.date() + timedelta(days=2)):
        fx = fixtures_for(d, key)
        fixtures.update(fx)
        od = odds_for(d, key)
        odds += od
        print(str(d), "fixtures", len(fx), "with odds", len(od))
    rows = build_rows(odds, fixtures)
    picks = bdw.fetch_picks(sb_url, sb_key, now)
    inserts, stats = bdw.build_inserts(picks, rows, bdw.TZ_DEFAULT)
    matched = {p["fixture_id"] for p, _, _ in inserts}
    already = have_bdw(sb_url, sb_key, sorted(matched)) if matched else set()
    print(json.dumps({"api_matches_with_rows": len({r["provider_id"] for r in rows}), "rows": len(rows), "picks": len(picks),
                      "matched": len(matched), "match_rate": round(len(matched) / max(len(picks), 1), 3),
                      "already_have_bongdawap": len(already), "new_coverage": len(matched - already), "stats": stats}))
    seen = {p["fixture_id"] for p, _, _ in inserts}
    miss = [p for p in picks if p["fixture_id"] not in seen][:15]
    print("unmatched sample", [(p["home"], p["away"]) for p in miss])
    if args.write:
        n = 0
        recs = to_records(inserts)
        for i in range(0, len(recs), bdw.BATCH_SIZE):
            n += bdw.sb_request(sb_url, sb_key, "POST", "rpc/cfi_upsert_match_odds", {"p_rows": recs[i:i + bdw.BATCH_SIZE]})
        print("upserted", n)


if __name__ == "__main__":
    main()
