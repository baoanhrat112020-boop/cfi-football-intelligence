import argparse
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from difflib import SequenceMatcher
from zoneinfo import ZoneInfo

BASE_URL = "https://bongdawap.com/ajax/load_handicap.htm?d="
TZ_DEFAULT = "Asia/Ho_Chi_Minh"
STOP = {"fc", "cf", "ac", "as", "sc", "us", "ssc", "afc", "rc", "ud", "cd", "fk", "sv", "vfl", "vfb", "tsg", "fsv", "1", "de", "calcio", "club", "the"}
CATEGORIES = {"u15", "u16", "u17", "u18", "u19", "u20", "u21", "u22", "u23", "w", "ii"}
CATEGORY_ALIASES = {"women": "w", "woman": "w", "nu": "w", "reserve": "ii", "reserves": "ii", "b": "ii"}
SIM_MIN = 0.6
TIME_WINDOW = timedelta(hours=4)
BATCH_SIZE = 500
RETENTION_DAYS = 90
PICK_HORIZON = timedelta(hours=48)
NUM = re.compile(r"-?\d+(?:\.\d+)?")


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    toks = [t for t in s.split() if t not in STOP]
    return " ".join(toks)


def sim(a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    r = SequenceMatcher(None, a, b).ratio()
    if a in b or b in a:
        r = max(r, 0.85)
    ta, tb = set(a.split()), set(b.split())
    if ta & tb:
        r = max(r, 0.5 + 0.5 * len(ta & tb) / max(len(ta), len(tb)))
    return r


def split_category(s):
    toks = [CATEGORY_ALIASES.get(t, t) for t in s.split()]
    return frozenset(t for t in toks if t in CATEGORIES), " ".join(t for t in toks if t not in CATEGORIES)


def team_sim(a, b):
    cat_a, rest_a = split_category(a)
    cat_b, rest_b = split_category(b)
    if cat_a != cat_b:
        return 0.0
    if not rest_a or not rest_b:
        return sim(a, b)
    return sim(rest_a, rest_b)


def malay_to_decimal(x):
    if x == 0 or abs(x) > 1:
        return None
    if x >= 0:
        return 1 + x
    return 1 + 1 / abs(x)


def parse_half_line(raw):
    m = re.fullmatch(r"(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?", (raw or "").strip())
    if not m:
        return None
    a = Decimal(m.group(1))
    if m.group(2) is None:
        return a
    return (a + Decimal(m.group(2))) / 2


def cell_parts(cell_html):
    first = re.search(r'<p class="left">\s*<b>(.*?)</b>\s*</p>', cell_html, re.S)
    second = re.search(r'<p class="left right">\s*<b>(.*?)</b>\s*</p>', cell_html, re.S)
    if not first or not second:
        return None, None
    odds_text = re.sub(r"&nbsp;|<br\s*/?>", " ", second.group(1))
    return first.group(1), [float(v) for v in NUM.findall(odds_text)]


def two_sided(odds):
    if not odds or len(odds) < 2:
        return None
    a, b = malay_to_decimal(odds[0]), malay_to_decimal(odds[1])
    if a is None or b is None:
        return None
    return a, b


def parse_ou_cell(cell_html):
    line_html, odds = cell_parts(cell_html)
    if line_html is None:
        return None
    raw = re.sub(r"\s+", "", re.sub(r"&nbsp;|<br\s*/?>", "", line_html))
    line = parse_half_line(raw)
    pair = two_sided(odds)
    if line is None or pair is None:
        return None
    over, under = pair
    io, iu = 1 / over, 1 / under
    return {
        "line": line,
        "odds_over": round(over, 4),
        "odds_under": round(under, 4),
        "p_implied_over": round(io / (io + iu), 4),
        "raw_line": raw,
    }


def parse_handicap_cell(cell_html):
    line_html, odds = cell_parts(cell_html)
    if line_html is None:
        return None
    parts = [re.sub(r"\s+", "", p.replace("&nbsp;", "")) for p in re.split(r"<br\s*/?>", line_html)]
    raw = "".join(parts)
    magnitude = parse_half_line(raw)
    pair = two_sided(odds)
    if magnitude is None or pair is None:
        return None
    if magnitude == 0:
        side, line = "none", Decimal(0)
    elif len(parts) > 1 and parts[0] == "":
        side, line = "away", magnitude
    else:
        side, line = "home", -magnitude
    return {
        "line": line,
        "odds_home": round(pair[0], 4),
        "odds_away": round(pair[1], 4),
        "handicap_side": side,
        "raw_line": raw,
    }


def parse_1x2_cell(cell_html):
    text = re.sub(r"&nbsp;|<br\s*/?>", " ", cell_html)
    vals = [float(v) for v in NUM.findall(re.sub(r"<[^>]+>", " ", text))]
    if len(vals) != 3 or any(v <= 1 for v in vals):
        return None
    return {"odds_home": vals[0], "odds_away": vals[1], "odds_draw": vals[2]}


def vn_kickoff(day, month, hour, minute, tz, ref_year, ref_month):
    year = ref_year
    if month < ref_month - 6:
        year += 1
    elif month > ref_month + 6:
        year -= 1
    local = datetime(year, month, day, hour, minute, tzinfo=ZoneInfo(tz))
    return local.astimezone(timezone.utc)


def parse_bongdawap_handicap(html, tz, ref_date):
    ref_year, ref_month = ref_date.year, ref_date.month
    out = []
    league = None
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        h2 = re.search(r"<h2>\s*<a[^>]*>\s*([^<]+?)\s*</a>", tr)
        if h2:
            league = re.sub(r"^T[ỷy] [lL]ệ (?:kèo|cược) (?:bóng đá )?", "", h2.group(1), flags=re.I).strip()
            continue
        if "doibong" not in tr:
            continue
        cells = tr.split("</td>")
        if len(cells) < 7:
            continue
        tm = re.search(r"(\d{1,2})/(\d{1,2})\s*<br\s*/?>\s*<b[^>]*>(\d{1,2}):(\d{2})", cells[0])
        teams = re.findall(r'<a href="(doi-[^"]+?)\.html">\s*<b[^>]*>([^<]+)</b>', cells[1])
        if not tm or len(teams) < 2:
            continue
        day, month, hour, minute = (int(g) for g in tm.groups())
        kickoff = vn_kickoff(day, month, hour, minute, tz, ref_year, ref_month)
        local = kickoff.astimezone(ZoneInfo(tz))
        base = {
            "provider_id": "BDW-%s-%s-%s" % (local.strftime("%Y-%m-%d-%H:%M"), teams[0][1].strip(), teams[1][1].strip()),
            "league": league,
            "home": teams[0][1].strip(),
            "away": teams[1][1].strip(),
            "home_src_key": teams[0][0],
            "away_src_key": teams[1][0],
            "kickoff_utc": kickoff,
        }
        specs = (
            ("ASIAN_HANDICAP", "FT", parse_handicap_cell(cells[2])),
            ("OVER_UNDER", "FT", parse_ou_cell(cells[3])),
            ("1X2", "FT", parse_1x2_cell(cells[4])),
            ("ASIAN_HANDICAP", "HT", parse_handicap_cell(cells[5])),
            ("OVER_UNDER", "HT", parse_ou_cell(cells[6])),
        )
        for family, period, data in specs:
            if data is None:
                continue
            row = dict(base)
            row.update({"market_family": family, "period": period, "line": None})
            row.update(data)
            out.append(row)
    return out


def load_picks(path):
    picks = []
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            line = line.rstrip("\n")
            if not line:
                continue
            fid, top, home, away, kickoff = line.split("|")
            picks.append({
                "fixture_id": fid,
                "top_market": top or None,
                "home": home,
                "away": away,
                "kickoff_utc": datetime.fromisoformat(kickoff.replace("Z", "+00:00")),
            })
    return picks


def match_pick(pick, matches, tz, used):
    best = None
    pick_day = pick["kickoff_utc"].astimezone(ZoneInfo(tz)).date()
    nh, na = norm(pick["home"]), norm(pick["away"])
    for key, m in matches.items():
        if key in used:
            continue
        sh = team_sim(nh, norm(m["home"]))
        sa = team_sim(na, norm(m["away"]))
        if sh < SIM_MIN or sa < SIM_MIN:
            continue
        delta = abs(pick["kickoff_utc"] - m["kickoff_utc"])
        same_day = pick_day == m["kickoff_utc"].astimezone(ZoneInfo(tz)).date()
        if not (same_day or delta <= TIME_WINDOW):
            continue
        score = sh + sa - delta.total_seconds() / 86400
        if best is None or score > best[0]:
            best = (score, key, delta)
    return best


def build_inserts(picks, rows, tz):
    matches = {}
    by_match = {}
    for r in rows:
        matches.setdefault(r["provider_id"], r)
        by_match.setdefault(r["provider_id"], []).append(r)
    used = set()
    stats = {"picks": len(picks), "matched": 0, "beyond_4h": 0}
    inserts = []
    for pick in picks:
        hit = match_pick(pick, matches, tz, used)
        if hit is None:
            continue
        _, key, delta = hit
        used.add(key)
        stats["matched"] += 1
        if delta > TIME_WINDOW:
            stats["beyond_4h"] += 1
        for r in by_match[key]:
            inserts.append((pick, r, delta))
    return inserts, stats


def summarize_market(r):
    head = "%s/%s" % (r["market_family"], r["period"])
    if r["market_family"] == "OVER_UNDER":
        return "%s %s o%s u%s p%s" % (head, r["line"], r["odds_over"], r["odds_under"], r["p_implied_over"])
    if r["market_family"] == "ASIAN_HANDICAP":
        return "%s %s(%s) h%s a%s" % (head, r["line"], r["handicap_side"], r["odds_home"], r["odds_away"])
    return "%s h%s d%s a%s" % (head, r["odds_home"], r["odds_draw"], r["odds_away"])


def to_records(inserts):
    out = []
    for pick, r, _ in inserts:
        out.append({
            "verified_fixture_id": pick["fixture_id"],
            "source": "bongdawap",
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
            "handicap_side": r.get("handicap_side"),
            "league": r.get("league"),
        })
    return out


def fetch_html(date_vn):
    req = urllib.request.Request(BASE_URL + date_vn, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        return resp.read().decode("utf-8", "replace")


def sb_request(sb_url, key, method, path, body=None, headers=None):
    hdrs = {"apikey": key, "Authorization": "Bearer " + key}
    if body is not None:
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(sb_url + "/rest/v1/" + path, data=data, method=method, headers=hdrs)
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else None


def fetch_picks(sb_url, key, now_utc):
    lo = now_utc.strftime("%Y-%m-%dT%H:%M:%SZ")
    hi = (now_utc + PICK_HORIZON).strftime("%Y-%m-%dT%H:%M:%SZ")
    picks = []
    offset = 0
    while True:
        path = "suggest_pick_log?select=fixture_id,top_market,home_team,away_team,kickoff_at&settled_at=is.null&kickoff_at=gt.%s&kickoff_at=lt.%s&order=kickoff_at.asc&limit=1000&offset=%d" % (lo, hi, offset)
        page = sb_request(sb_url, key, "GET", path)
        for p in page:
            picks.append({
                "fixture_id": p["fixture_id"],
                "top_market": p["top_market"],
                "home": p["home_team"],
                "away": p["away_team"],
                "kickoff_utc": datetime.fromisoformat(p["kickoff_at"].replace("Z", "+00:00")),
            })
        if len(page) < 1000:
            return picks
        offset += 1000


def push_records(sb_url, key, records):
    total = 0
    for i in range(0, len(records), BATCH_SIZE):
        total += sb_request(sb_url, key, "POST", "rpc/cfi_upsert_match_odds", {"p_rows": records[i:i + BATCH_SIZE]})
    return total


def purge_old(sb_url, key, now_utc):
    cutoff = (now_utc - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
    sb_request(sb_url, key, "DELETE", "match_odds?last_seen_at=lt." + cutoff, headers={"Prefer": "return=minimal"})
    return cutoff


def report(rows, stats, inserts):
    matches = {r["provider_id"] for r in rows}
    per_family = {}
    for r in rows:
        k = (r["market_family"], r["period"])
        per_family[k] = per_family.get(k, 0) + 1
    print(json.dumps({
        "parsed_matches": len(matches),
        "parsed_rows": len(rows),
        "rows_per_market": {"%s/%s" % k: v for k, v in sorted(per_family.items())},
        "avg_markets_per_match": round(len(rows) / max(len(matches), 1), 2),
        "match_stats": stats,
        "insert_rows": len(inserts),
    }, ensure_ascii=False, indent=1))
    grouped = {}
    for pick, r, delta in inserts:
        grouped.setdefault(pick["fixture_id"], (pick, delta, []))[2].append(r)
    for pick, delta, markets in list(grouped.values())[:5]:
        print(json.dumps({
            "verified_fixture_id": pick["fixture_id"],
            "pick": "%s v %s [%s]" % (pick["home"], pick["away"], pick["top_market"]),
            "bdw": "%s v %s" % (markets[0]["home"], markets[0]["away"]),
            "dt_min": int(delta.total_seconds() // 60),
            "markets": [summarize_market(m) for m in markets],
        }, ensure_ascii=False))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--html")
    ap.add_argument("--picks")
    ap.add_argument("--tz", default=TZ_DEFAULT)
    ap.add_argument("--date")
    args = ap.parse_args()
    now_utc = datetime.now(timezone.utc)
    if args.dry_run:
        if not args.html or not args.picks or not args.date:
            sys.exit("--dry-run needs --html, --picks and --date YYYY-MM-DD")
        with open(args.html, encoding="utf-8") as fh:
            html = fh.read()
        ref_date = datetime.strptime(args.date, "%Y-%m-%d").date()
        picks = load_picks(args.picks)
        sb_url = key = None
    else:
        sb_url = os.environ["SB_URL"].rstrip("/")
        key = os.environ["SB_SERVICE_ROLE_KEY"]
        ref_date = now_utc.astimezone(ZoneInfo(args.tz)).date()
        html = fetch_html(ref_date.strftime("%d/%m/%Y"))
        picks = fetch_picks(sb_url, key, now_utc)
    rows = parse_bongdawap_handicap(html, args.tz, ref_date)
    if not rows:
        print("no matches parsed (size=%d)" % len(html))
        return
    inserts, stats = build_inserts(picks, rows, args.tz)
    report(rows, stats, inserts)
    if args.dry_run:
        return
    pushed = push_records(sb_url, key, to_records(inserts))
    cutoff = purge_old(sb_url, key, now_utc)
    print(json.dumps({"upserted": pushed, "purged_before": cutoff}))


if __name__ == "__main__":
    main()
