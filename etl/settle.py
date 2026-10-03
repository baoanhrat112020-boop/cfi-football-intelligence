"""CFI ETL - settle tier_c_log from Livescore API.

Options:
    --dry-run     khong update gi, chi in ket qua
    --limit N     chi xu ly N rows (default 100)
    --push        push updates len Supabase sau khi settle local
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from curl_cffi import requests as cf
from psycopg2.extras import Json

from config import get_supabase, get_local_conn

VN_TZ = timezone(timedelta(hours=7))
LIVESCORE_URL = "https://prod-cdn-mev-api.livescore.com/v1/api/app/date/soccer/{ymd}/{page}?MD=1"


def extract_name(v: Any) -> str:
    """Livescore T1/T2 co the la string hoac list[{Nm: ...}]."""
    if v is None:
        return ""
    if isinstance(v, str):
        return v
    if isinstance(v, list) and v:
        first = v[0]
        if isinstance(first, dict):
            return first.get("Nm") or first.get("Name") or ""
        return str(first)
    if isinstance(v, dict):
        return v.get("Nm") or v.get("Name") or ""
    return str(v)


def norm(s: Any) -> str:
    if not s:
        return ""
    if not isinstance(s, str):
        s = extract_name(s)
    return re.sub(r"\s+", " ", s.lower().strip())


def log_event(conn: Any, run_id: str, phase: str, level: str,
              message: str, payload: dict | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO _pipeline_events (run_id, phase, level, message, payload) "
            "VALUES (%s, %s, %s, %s, %s)",
            (run_id, phase, level, message, Json(payload) if payload else None),
        )
    conn.commit()


def parse_match_id(match_id: str) -> tuple[str | None, str | None, str | None]:
    """match_id = {home_id}_{away_id}_{YYYY-MM-DD}"""
    parts = match_id.split("_")
    if len(parts) < 3:
        return (None, None, None)
    return (parts[0], parts[1], "_".join(parts[2:]))


def fetch_livescore_day(ymd: str) -> list[dict]:
    """Fetch all events for a day (YYYYMMDD format)."""
    events: dict[str, dict] = {}
    for page in range(5):
        url = LIVESCORE_URL.format(ymd=ymd, page=page)
        try:
            r = cf.get(url, impersonate="chrome120", timeout=20)
            if r.status_code != 200:
                break
            d = json.loads(r.text)
            stages = d.get("Stages", [])
            if not stages:
                break
            n_new = 0
            for stage in stages:
                for ev in stage.get("Events", []):
                    eid = ev.get("Eid")
                    if eid and eid not in events:
                        events[eid] = ev
                        n_new += 1
            if n_new == 0:
                break
        except Exception as e:
            print(f"  [livescore] err {ymd} page {page}: {e}", file=sys.stderr)
            break
        time.sleep(0.3)
    return list(events.values())


def find_event(pred_home: str, pred_away: str, events: list[dict]) -> dict | None:
    """Match by normalized team names. Exact first, then partial."""
    ph, pa = norm(pred_home), norm(pred_away)
    # Exact
    for ev in events:
        h = norm(extract_name(ev.get("T1")))
        a = norm(extract_name(ev.get("T2")))
        if h == ph and a == pa:
            return ev
    # Partial: one contains the other
    for ev in events:
        h = norm(extract_name(ev.get("T1")))
        a = norm(extract_name(ev.get("T2")))
        if not h or not a:
            continue
        if (h in ph or ph in h) and (a in pa or pa in a):
            return ev
    return None


def extract_score(ev: dict) -> tuple[int | None, int | None, int | None, int | None]:
    """Return (ht_h, ht_a, ft_h, ft_a). Any can be None."""
    try:
        ft_h = int(ev["Tr1"]) if ev.get("Tr1") is not None else None
        ft_a = int(ev["Tr2"]) if ev.get("Tr2") is not None else None
    except (ValueError, TypeError):
        ft_h = ft_a = None
    try:
        ht_h = int(ev["Trh1"]) if ev.get("Trh1") is not None else None
        ht_a = int(ev["Trh2"]) if ev.get("Trh2") is not None else None
    except (ValueError, TypeError):
        ht_h = ht_a = None
    return (ht_h, ht_a, ft_h, ft_a)


def get_unsettled(conn: Any, limit: int) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, match_id, home_team, away_team, predicted_at,
                   p_home, p_draw, p_away, p_over25, p_btts
            FROM tier_c_log
            WHERE settled_at IS NULL
              AND actual_home IS NULL
              AND predicted_at < now() - interval '3 hours'
            ORDER BY predicted_at ASC
            LIMIT %s
            """,
            (limit,),
        )
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def settle_row(conn: Any, pred: dict, ft_h: int, ft_a: int, dry_run: bool) -> bool:
    if dry_run:
        return True
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE tier_c_log SET actual_home = %s, actual_away = %s, settled_at = now() "
            "WHERE id = %s AND settled_at IS NULL",
            (ft_h, ft_a, pred["id"]),
        )
        return cur.rowcount == 1
    conn.commit()  # (unreachable here, committed after loop)


def push_to_supabase(sb: Any, updates: list[dict]) -> int:
    """Update Supabase tier_c_log for rows [{'id': int, 'actual_home': int, 'actual_away': int}]."""
    ok = 0
    for u in updates:
        try:
            r = sb.table("tier_c_log").update({
                "actual_home": u["actual_home"],
                "actual_away": u["actual_away"],
                "settled_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", u["id"]).execute()
            if r.data:
                ok += 1
        except Exception as e:
            print(f"  [supabase] push id={u['id']} failed: {e}", file=sys.stderr)
    return ok


def run(limit: int, dry_run: bool, push: bool) -> None:
    run_id = uuid.uuid4().hex[:12]
    conn = get_local_conn()
    sb = get_supabase() if push else None

    print(f"[settle] run_id={run_id} limit={limit} dry_run={dry_run} push={push}")

    preds = get_unsettled(conn, limit)
    print(f"[settle] {len(preds)} rows need settling")

    if not preds:
        conn.close()
        return

    # Group by target date (from match_id)
    by_date: dict[str, list[dict]] = {}
    for p in preds:
        _, _, date = parse_match_id(p["match_id"])
        if not date:
            print(f"[settle] skip id={p['id']} (bad match_id)")
            continue
        by_date.setdefault(date, []).append(p)

    # Cache livescore per date
    ls_cache: dict[str, list[dict]] = {}
    total_ok = 0
    total_fail = 0
    updates_for_push: list[dict] = []

    for date, rows in by_date.items():
        ymd = date.replace("-", "")
        print(f"\n[settle] date={date} ({len(rows)} predictions)")
        if ymd not in ls_cache:
            print(f"  [livescore] fetch {ymd}...")
            ls_cache[ymd] = fetch_livescore_day(ymd)
            print(f"  [livescore] {len(ls_cache[ymd])} events")
        events = ls_cache[ymd]

        for p in rows:
            ev = find_event(p["home_team"], p["away_team"], events)
            if not ev:
                print(f"  [{p['id']}] {p['home_team']} vs {p['away_team']}: NO MATCH")
                total_fail += 1
                continue

            ht_h, ht_a, ft_h, ft_a = extract_score(ev)
            if ft_h is None or ft_a is None:
                print(f"  [{p['id']}] {p['home_team']} vs {p['away_team']}: no FT yet (status={ev.get('Eps')})")
                total_fail += 1
                continue

            print(f"  [{p['id']}] {p['home_team']} {ft_h}-{ft_a} {p['away_team']} (HT {ht_h}-{ht_a})")

            if settle_row(conn, p, ft_h, ft_a, dry_run):
                total_ok += 1
                if not dry_run:
                    updates_for_push.append({
                        "id": p["id"],
                        "actual_home": ft_h,
                        "actual_away": ft_a,
                    })
                    log_event(conn, run_id, "settle", "INFO",
                              f"settled id={p['id']} {ft_h}-{ft_a}",
                              {"pred_id": p["id"], "match_id": p["match_id"]})

    if not dry_run:
        conn.commit()

    print(f"\n[settle] DONE: ok={total_ok} fail={total_fail}")

    if push and updates_for_push and not dry_run:
        n = push_to_supabase(sb, updates_for_push)
        print(f"[settle] pushed {n}/{len(updates_for_push)} to Supabase")
        log_event(conn, run_id, "settle", "INFO",
                  f"pushed {n} to Supabase", {"count": n})

    conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()
    run(args.limit, args.dry_run, args.push)


if __name__ == "__main__":
    main()