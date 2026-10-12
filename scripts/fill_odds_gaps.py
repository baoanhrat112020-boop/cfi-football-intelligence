import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from bongdawap_odds import BATCH_SIZE, SIM_MIN, norm, sb_request, team_sim

SOURCE = "oddsportal"
TIME_WINDOW = timedelta(hours=4)
HT_LINES = {0.5, 0.75, 1.0, 1.25, 1.5}
FT_LINES = {1.5, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5}
BOOK_PRIORITY = ("pinnacle", "bet365", "bwin", "unibet", "betfair", "williamhill", "1xbet")
FT_NEEDS = (("OVER_UNDER", "FT"), ("ASIAN_HANDICAP", "FT"), ("1X2", "FT"))
HT_NEEDS = (("OVER_UNDER", "HT"), ("ASIAN_HANDICAP", "HT"))
PERIOD_CODE = {"full_time": "FT", "1st_half": "HT"}
MARKETS = {"full_time": "1x2,over_under,asian_handicap", "1st_half": "over_under,asian_handicap"}
LINK = re.compile(r"/football/h2h/([^/]+)/([^/#?]+)")
SLUG_ID = re.compile(r"-[A-Za-z0-9]{8}$")
MARKET_KEY = re.compile(r"^(over_under|asian_handicap)_([+-]?\d+(?:_\d+)?)_market$")
LINE_TOKEN = re.compile(r"([+-]?)(\d+)(?:_(\d+))?")


def fmt_utc(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_utc(value):
    if not value:
        return None
    text = str(value).strip().replace(" UTC", "").replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def to_odds(value):
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if number > 1.0 else None


def line_from_token(token):
    m = LINE_TOKEN.fullmatch(token)
    if not m:
        return None
    value = float(m.group(2) + ("." + m.group(3) if m.group(3) else ""))
    return -value if m.group(1) == "-" else value


def fmt_line(value):
    text = ("%.2f" % value).rstrip("0").rstrip(".")
    return "0" if text in ("", "-0") else text


def link_teams(link):
    m = LINK.search(link or "")
    if not m:
        return None
    return tuple(norm(SLUG_ID.sub("", part).replace("-", " ")) for part in m.groups())


def pair_score(nh, na, ta, tb):
    best = None
    for x, y in ((ta, tb), (tb, ta)):
        sh, sa = team_sim(nh, x), team_sim(na, y)
        if sh >= SIM_MIN and sa >= SIM_MIN:
            score = sh + sa
            if best is None or score > best:
                best = score
    return best


def match_targets(picks, rows):
    cands = []
    for r in rows:
        teams = link_teams(r.get("match_link"))
        if teams is not None:
            cands.append((r["match_link"], teams, parse_utc(r.get("kickoff_utc"))))
    used = set()
    out = []
    for p in picks:
        nh, na = norm(p["home"]), norm(p["away"])
        best = None
        for link, (ta, tb), ko in cands:
            if link in used:
                continue
            gap = abs(ko - p["kickoff_utc"]) if ko is not None else timedelta(0)
            if gap > TIME_WINDOW:
                continue
            score = pair_score(nh, na, ta, tb)
            if score is None:
                continue
            key = score - gap.total_seconds() / 86400
            if best is None or key > best[0]:
                best = (key, link)
        if best is not None:
            used.add(best[1])
            out.append({
                "fixture_id": p["fixture_id"],
                "home": p["home"],
                "away": p["away"],
                "kickoff_utc": fmt_utc(p["kickoff_utc"]),
                "tier": p.get("tier"),
                "need_ft": p.get("need_ft", True),
                "need_ht": p.get("need_ht", True),
                "missing": p.get("missing", []),
                "match_link": best[1],
            })
    return out


def unmatched_report(picks, targets, rows, limit=30):
    got = {t["fixture_id"] for t in targets}
    cands = []
    for r in rows:
        teams = link_teams(r.get("match_link"))
        if teams is not None:
            cands.append((teams, parse_utc(r.get("kickoff_utc"))))
    pool = sorted({t for (ta, tb), _ in cands for t in (ta, tb)})
    lines = []
    for p in picks:
        if p["fixture_id"] in got:
            continue
        nh, na = norm(p["home"]), norm(p["away"])
        best = None
        for (ta, tb), ko in cands:
            score = pair_score(nh, na, ta, tb)
            if score is not None and (best is None or score > best[0]):
                best = (score, ta, tb, ko)
        if best is not None:
            gap = abs(best[3] - p["kickoff_utc"]) if best[3] is not None else None
            detail = "name_match=%s/%s score=%.2f gap=%s" % (best[1], best[2], best[0], gap)
        elif pool:
            bh = max(pool, key=lambda t: team_sim(nh, t))
            ba = max(pool, key=lambda t: team_sim(na, t))
            detail = "no_pair home~%s(%.2f) away~%s(%.2f)" % (bh, team_sim(nh, bh), ba, team_sim(na, ba))
        else:
            detail = "no_candidates"
        lines.append("unmatched %s | %s - %s | %s" % (fmt_utc(p["kickoff_utc"]), p["home"], p["away"], detail))
        if len(lines) >= limit:
            break
    return lines


def fetch_picks(sb_url, key, now, hours, tiers):
    path = (
        "suggest_pick_log?select=fixture_id,home_team,away_team,kickoff_at,confidence_tier"
        "&settled_at=is.null&kickoff_at=gt.%s&kickoff_at=lt.%s&confidence_tier=in.(%s)"
        "&order=kickoff_at.asc&limit=1000"
    ) % (fmt_utc(now), fmt_utc(now + timedelta(hours=hours)), ",".join(tiers))
    picks = []
    for p in sb_request(sb_url, key, "GET", path) or []:
        picks.append({
            "fixture_id": p["fixture_id"],
            "home": p["home_team"],
            "away": p["away_team"],
            "kickoff_utc": parse_utc(p["kickoff_at"]),
            "tier": p.get("confidence_tier"),
        })
    return picks


def fetch_coverage(sb_url, key, ids):
    have = {}
    for i in range(0, len(ids), 25):
        chunk = ids[i:i + 25]
        path = "match_odds?select=verified_fixture_id,market_family,period&verified_fixture_id=in.(%s)&limit=1000" % ",".join(chunk)
        for r in sb_request(sb_url, key, "GET", path) or []:
            have.setdefault(r["verified_fixture_id"], set()).add((r["market_family"], r["period"]))
    return have


def prioritize(picks, have):
    out = []
    for p in picks:
        got = have.get(p["fixture_id"], set())
        miss_ft = [k for k in FT_NEEDS if k not in got]
        miss_ht = [k for k in HT_NEEDS if k not in got]
        if not miss_ft and not miss_ht:
            continue
        q = dict(p)
        q["need_ft"] = bool(miss_ft)
        q["need_ht"] = bool(miss_ht)
        q["missing"] = ["%s/%s" % k for k in miss_ft + miss_ht]
        out.append(q)
    return sorted(out, key=lambda p: p["kickoff_utc"])


def run_cmd(cmd, log_path, timeout_s):
    try:
        with open(log_path, "ab") as fh:
            proc = subprocess.run(cmd, stdout=fh, stderr=subprocess.STDOUT, timeout=max(30, int(timeout_s)))
        return proc.returncode
    except subprocess.TimeoutExpired:
        return 124
    except OSError as exc:
        print("cannot run %s: %s" % (cmd[0], exc))
        return 127


def load_json_list(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return []
    return data if isinstance(data, list) else [data]


def collect_links(dates, workdir, attempts=2):
    rows = []
    for day in dates:
        out = str(workdir / ("links_%s.json" % day))
        for attempt in range(attempts):
            Path(out).unlink(missing_ok=True)
            cmd = ["oddsharvester", "upcoming", "-s", "football", "-d", day, "--links-only", "--headless", "-f", "json", "-o", out]
            code = run_cmd(cmd, str(workdir / "links.log"), 900)
            got = load_json_list(out)
            print("links date=%s attempt=%d exit=%s rows=%d" % (day, attempt + 1, code, len(got)))
            if got:
                rows.extend({"match_link": r} if isinstance(r, str) else r for r in got)
                break
            time.sleep(20)
    return rows


def cmd_plan(args):
    sb_url = os.environ["SB_URL"].rstrip("/")
    key = os.environ["SB_SERVICE_ROLE_KEY"]
    now = datetime.now(timezone.utc)
    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    tiers = [t.strip() for t in args.tiers.split(",") if t.strip()]
    picks = fetch_picks(sb_url, key, now, args.hours, tiers)
    have = fetch_coverage(sb_url, key, [p["fixture_id"] for p in picks])
    ordered = prioritize(picks, have)
    stats = {
        "picks": len(picks),
        "gaps": len(ordered),
        "need_ft": sum(1 for p in ordered if p["need_ft"]),
        "need_ht": sum(1 for p in ordered if p["need_ht"]),
        "links": 0,
        "matched": 0,
        "selected": 0,
    }
    targets = []
    if ordered:
        end = now + timedelta(hours=args.hours)
        dates = sorted({now.strftime("%Y%m%d"), end.strftime("%Y%m%d")})
        rows = collect_links(dates, workdir)
        stats["links"] = len(rows)
        matched = match_targets(ordered, rows)
        stats["matched"] = len(matched)
        targets = matched[:args.max_matches]
        stats["selected"] = len(targets)
        for line in unmatched_report(ordered, matched, rows):
            print(line)
    for t in targets[:12]:
        print("target %s | %s - %s | %s | missing=%s | %s" % (t["kickoff_utc"], t["home"], t["away"], t["tier"], ",".join(t["missing"]), t["match_link"]))
    print("plan " + json.dumps(stats))
    Path(args.out).write_text(json.dumps({"generated_at": fmt_utc(now), "stats": stats, "targets": targets}, ensure_ascii=False), encoding="utf-8")
    gh_out = os.environ.get("GITHUB_OUTPUT")
    if gh_out:
        with open(gh_out, "a", encoding="utf-8") as fh:
            fh.write("count=%d\n" % len(targets))
    return 0


def pick_entry(entries, keys):
    good = [e for e in entries if isinstance(e, dict) and all(to_odds(e.get(k)) for k in keys)]
    if not good:
        return None

    def rank(entry):
        name = str(entry.get("bookmaker_name", "")).lower()
        for i, book in enumerate(BOOK_PRIORITY):
            if book in name:
                return i
        return len(BOOK_PRIORITY)

    return min(good, key=rank)


def is_swapped(match, fixture):
    nh, na = norm(fixture["home"]), norm(fixture["away"])
    oh, oa = norm(match.get("home_team")), norm(match.get("away_team"))
    straight = team_sim(nh, oh) + team_sim(na, oa)
    crossed = team_sim(nh, oa) + team_sim(na, oh)
    if max(straight, crossed) < 2 * SIM_MIN:
        return None
    return crossed > straight


def side_of(line):
    if line == 0:
        return "none"
    return "home" if line < 0 else "away"


def match_records(match, fixture, period_code):
    swapped = is_swapped(match, fixture)
    if swapped is None:
        return []
    allowed = FT_LINES if period_code == "FT" else HT_LINES
    base = {"verified_fixture_id": fixture["fixture_id"], "source": SOURCE, "period": period_code, "league": match.get("league_name")}
    out = []
    ah = []
    for k, entries in match.items():
        if not isinstance(entries, list) or not entries:
            continue
        m = MARKET_KEY.match(k)
        if not m:
            continue
        line = line_from_token(m.group(2))
        if line is None:
            continue
        if m.group(1) == "over_under" and line in allowed:
            e = pick_entry(entries, ("odds_over", "odds_under"))
            if e is None:
                continue
            over, under = to_odds(e["odds_over"]), to_odds(e["odds_under"])
            io, iu = 1 / over, 1 / under
            rec = dict(base)
            rec.update({
                "market_family": "OVER_UNDER",
                "line": fmt_line(line),
                "odds_over": round(over, 4),
                "odds_under": round(under, 4),
                "p_implied_over": round(io / (io + iu), 4),
                "raw_line": fmt_line(line),
                "handicap_side": None,
            })
            out.append(rec)
        elif m.group(1) == "asian_handicap":
            e = pick_entry(entries, ("team1_handicap", "team2_handicap"))
            if e is None:
                continue
            h, a = to_odds(e["team1_handicap"]), to_odds(e["team2_handicap"])
            ah.append((abs(h - a), abs(line), line, h, a))
    if ah:
        _, _, line, h, a = min(ah)
        if swapped:
            line, h, a = -line, a, h
        rec = dict(base)
        rec.update({
            "market_family": "ASIAN_HANDICAP",
            "line": fmt_line(line),
            "odds_home": round(h, 4),
            "odds_away": round(a, 4),
            "raw_line": fmt_line(abs(line)),
            "handicap_side": side_of(line),
        })
        out.append(rec)
    if period_code == "FT":
        e = pick_entry(match.get("1x2_market") or [], ("1", "X", "2"))
        if e is not None:
            home, draw, away = to_odds(e["1"]), to_odds(e["X"]), to_odds(e["2"])
            if swapped:
                home, away = away, home
            rec = dict(base)
            rec.update({
                "market_family": "1X2",
                "line": None,
                "odds_home": round(home, 4),
                "odds_draw": round(draw, 4),
                "odds_away": round(away, 4),
                "handicap_side": None,
            })
            out.append(rec)
    return out


def push_records(sb_url, key, records):
    total = 0
    for i in range(0, len(records), BATCH_SIZE):
        total += sb_request(sb_url, key, "POST", "rpc/cfi_upsert_match_odds", {"p_rows": records[i:i + BATCH_SIZE]}) or 0
    return total


def scrape_chunk(links, period, workdir, tag, timeout_s):
    links_file = workdir / ("chunk_%s.txt" % tag)
    out = str(workdir / ("chunk_%s.json" % tag))
    links_file.write_text("\n".join(links) + "\n", encoding="utf-8")
    Path(out).unlink(missing_ok=True)
    cmd = [
        "oddsharvester", "upcoming", "-s", "football", "--match-links-file", str(links_file),
        "--period", period, "-m", MARKETS[period], "--concurrency", "2", "--request-delay", "2",
        "--headless", "-f", "json", "-o", out,
    ]
    code = run_cmd(cmd, str(workdir / ("scrape_%s.log" % period)), timeout_s)
    return code, load_json_list(out)


def cmd_scrape(args):
    period = args.period
    code_p = PERIOD_CODE[period]
    plan = json.loads(Path(args.targets).read_text(encoding="utf-8"))
    flag = "need_ft" if period == "full_time" else "need_ht"
    by_link = {t["match_link"]: t for t in plan.get("targets", []) if t.get(flag, True)}
    workdir = Path(args.workdir)
    workdir.mkdir(parents=True, exist_ok=True)
    sb_url = key = None
    if not args.dry_run:
        sb_url = os.environ["SB_URL"].rstrip("/")
        key = os.environ["SB_SERVICE_ROLE_KEY"]
    deadline = time.monotonic() + args.budget_min * 60
    stats = {"period": period, "targets": len(by_link), "scraped": 0, "failed": 0, "skipped_unmatched": 0, "records": 0, "upserted": 0, "chunks": 0}
    done = set()
    pending = list(by_link)
    for attempt in range(2):
        if not pending or time.monotonic() >= deadline:
            break
        failed = []
        for i in range(0, len(pending), args.chunk):
            remaining = deadline - time.monotonic()
            if remaining < 60:
                failed.extend(pending[i:])
                break
            chunk = pending[i:i + args.chunk]
            stats["chunks"] += 1
            code, rows = scrape_chunk(chunk, period, workdir, "%d_%d" % (attempt, i), min(900, remaining))
            got = {r.get("match_link"): r for r in rows if isinstance(r, dict)}
            records = []
            for link in chunk:
                match = got.get(link)
                if match is None:
                    failed.append(link)
                    continue
                fixture = by_link[link]
                recs = match_records(match, fixture, code_p)
                if not recs:
                    stats["skipped_unmatched"] += 1
                    done.add(link)
                    continue
                done.add(link)
                stats["scraped"] += 1
                records.extend(recs)
                kinds = sorted({"%s%s" % (r["market_family"][:2], r["line"] if r["line"] is not None else "") for r in recs})
                print("ok %s - %s | %d rows | %s" % (fixture["home"], fixture["away"], len(recs), " ".join(kinds)))
            stats["records"] += len(records)
            print("chunk attempt=%d offset=%d exit=%s links=%d scraped=%d" % (attempt, i, code, len(chunk), len(got)))
            if records and not args.dry_run:
                stats["upserted"] += push_records(sb_url, key, records)
            if args.dry_run and records:
                print("sample " + json.dumps(records[0], ensure_ascii=False))
        pending = failed
        if pending and attempt == 0 and time.monotonic() < deadline:
            time.sleep(60)
    stats["failed"] = len(pending)
    print("result " + json.dumps(stats))
    return 0 if stats["scraped"] > 0 or not by_link else 1


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--hours", type=float, default=12)
    p.add_argument("--tiers", default="CAO,KHA,TB")
    p.add_argument("--max-matches", type=int, default=60)
    p.add_argument("--out", default="targets.json")
    p.add_argument("--workdir", default="work")
    s = sub.add_parser("scrape")
    s.add_argument("--period", choices=sorted(PERIOD_CODE), required=True)
    s.add_argument("--targets", default="targets.json")
    s.add_argument("--budget-min", type=float, default=70)
    s.add_argument("--chunk", type=int, default=5)
    s.add_argument("--workdir", default="work")
    s.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    sys.exit(cmd_plan(args) if args.cmd == "plan" else cmd_scrape(args))


if __name__ == "__main__":
    main()
