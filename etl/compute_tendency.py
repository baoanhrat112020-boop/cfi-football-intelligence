"""CFI ETL - compute team_tendency flags for 4 rare markets."""
from __future__ import annotations

import argparse
import sys
import uuid
from collections import defaultdict
from datetime import date
from typing import Any

from psycopg2.extras import Json

from config import get_local_conn, get_supabase


# (market, base_rate) — fixed from DB analysis 2026-10-03
MARKETS = {
    "Other HT": 0.0111,
    "Other FT": 0.0423,
    "3+ HT":    0.1264,
    "7+ FT":    0.0263,
}

# Flag thresholds
LOW_MIN_MATCHES    = 15
LOW_MIN_LIFT       = 2.0
MEDIUM_MIN_MATCHES = 30
MEDIUM_MIN_LIFT    = 2.0
HIGH_MIN_MATCHES   = 50
HIGH_MIN_LIFT      = 3.0


def log_event(conn: Any, run_id: str, message: str, payload: dict | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO _pipeline_events (run_id, phase, level, message, payload) "
            "VALUES (%s, %s, %s, %s, %s)",
            (run_id, "tendency", "INFO", message, Json(payload) if payload else None),
        )
    conn.commit()


def fetch_fixtures(conn: Any) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute("""
            SELECT home_team_id, away_team_id,
                   ht_home, ht_away, ft_home, ft_away, match_date
            FROM fixtures
            WHERE ft_home IS NOT NULL
              AND ft_away IS NOT NULL
        """)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def compute_tendencies(fixtures: list[dict]) -> list[dict]:
    """Return list of {team_id, market, n_matches, n_events, rate, base_rate, lift, flag}."""
    # n_matches per team = count of fixtures they participated in
    # n_events per (team, market)
    n_matches: dict[str, int] = defaultdict(int)
    n_events: dict[tuple[str, str], int] = defaultdict(int)

    for f in fixtures:
        h = f["home_team_id"]
        a = f["away_team_id"]
        hth = f["ht_home"]
        hta = f["ht_away"]
        fth = f["ft_home"]
        fta = f["ft_away"]

        if h:
            n_matches[h] += 1
            if hth is not None and hth >= 4:
                n_events[(h, "Other HT")] += 1
            if fth >= 5:
                n_events[(h, "Other FT")] += 1
            if hth is not None and hta is not None and (hth + hta) >= 3:
                n_events[(h, "3+ HT")] += 1
            if (fth + fta) >= 7:
                n_events[(h, "7+ FT")] += 1

        if a:
            n_matches[a] += 1
            if hta is not None and hta >= 4:
                n_events[(a, "Other HT")] += 1
            if fta >= 5:
                n_events[(a, "Other FT")] += 1
            if hth is not None and hta is not None and (hth + hta) >= 3:
                n_events[(a, "3+ HT")] += 1
            if (fth + fta) >= 7:
                n_events[(a, "7+ FT")] += 1

    rows: list[dict] = []
    for (team_id, market), ev in n_events.items():
        n = n_matches[team_id]
        if n == 0:
            continue
        rate = ev / n
        base = MARKETS[market]
        lift = rate / base if base > 0 else 0.0

        flag = None
        if n >= HIGH_MIN_MATCHES and lift >= HIGH_MIN_LIFT:
            flag = "HIGH"
        elif n >= MEDIUM_MIN_MATCHES and lift >= MEDIUM_MIN_LIFT:
            flag = "MEDIUM"
        elif n >= LOW_MIN_MATCHES and lift >= LOW_MIN_LIFT:
            flag = "LOW"

        if flag is None:
            continue

        rows.append({
            "team_id": team_id,
            "market": market,
            "n_matches": n,
            "n_events": ev,
            "rate": round(rate, 6),
            "base_rate": base,
            "lift": round(lift, 4),
            "flag": flag,
        })

    return rows


def upsert_local(conn: Any, rows: list[dict], window_start: date, window_end: date) -> int:
    with conn.cursor() as cur:
        # Clear old rows cho 4 markets nay (rebuild full)
        cur.execute("DELETE FROM team_tendency WHERE market = ANY(%s)", (list(MARKETS.keys()),))
        for r in rows:
            cur.execute("""
                INSERT INTO team_tendency
                  (team_id, market, n_matches, n_events, rate, base_rate, lift, flag,
                   window_start, window_end, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s, now())
            """, (r["team_id"], r["market"], r["n_matches"], r["n_events"],
                  r["rate"], r["base_rate"], r["lift"], r["flag"],
                  window_start, window_end))
    conn.commit()
    return len(rows)


def push_supabase(sb: Any, rows: list[dict], window_start: date, window_end: date) -> int:
    if not rows:
        return 0
    payload = []
    for r in rows:
        payload.append({
            **r,
            "window_start": str(window_start),
            "window_end": str(window_end),
        })
    # Upsert in chunks of 500
    ok = 0
    for i in range(0, len(payload), 500):
        chunk = payload[i:i+500]
        try:
            resp = sb.table("team_tendency").upsert(
                chunk, on_conflict="team_id,market"
            ).execute()
            ok += len(resp.data) if resp.data else 0
        except Exception as e:
            print(f"  [supabase] chunk {i} failed: {e}", file=sys.stderr)
    return ok


def run(push: bool) -> None:
    run_id = uuid.uuid4().hex[:12]
    conn = get_local_conn()
    print(f"[tendency] run_id={run_id} push={push}")

    fixtures = fetch_fixtures(conn)
    print(f"[tendency] {len(fixtures)} fixtures with FT score")

    if not fixtures:
        print("[tendency] nothing to compute")
        conn.close()
        return

    # Window = min/max match_date
    dates = [f["match_date"] for f in fixtures if f["match_date"]]
    window_start = min(dates) if dates else date.today()
    window_end = max(dates) if dates else date.today()

    rows = compute_tendencies(fixtures)
    print(f"[tendency] {len(rows)} (team,market) rows above threshold")

    # Print summary
    from collections import Counter
    by_market_flag = Counter((r["market"], r["flag"]) for r in rows)
    for market in MARKETS:
        for flag in ("HIGH", "MEDIUM", "LOW"):
            n = by_market_flag.get((market, flag), 0)
            if n:
                print(f"  {market:10} {flag:6} : {n}")

    if not push:
        # dry-run: just show
        print("[tendency] (dry-run, not writing)")
        conn.close()
        return

    n_local = upsert_local(conn, rows, window_start, window_end)
    print(f"[tendency] wrote {n_local} rows to local")

    sb = get_supabase()
    n_sb = push_supabase(sb, rows, window_start, window_end)
    print(f"[tendency] pushed {n_sb} rows to Supabase")

    log_event(conn, run_id, f"computed {len(rows)} rows, pushed {n_sb}",
              {"window_start": str(window_start), "window_end": str(window_end)})
    conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true",
                    help="Ghi local + push Supabase. Khong co = dry-run.")
    args = ap.parse_args()
    run(args.push)


if __name__ == "__main__":
    main()