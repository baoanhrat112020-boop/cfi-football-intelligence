"""CFI ETL - aggregate tier_c_log settlements into daily summary.

Computes per-day, per-market hit_rate + Brier score.
Dedupes by match_id (keeps latest prediction per match).
"""
from __future__ import annotations

import argparse
import sys
import uuid
from datetime import datetime, timezone
from typing import Any, Callable

from psycopg2.extras import Json

from config import get_local_conn, get_supabase


# (market_name, prob_col, actual_pred_fn)  — single-market YES/NO
# For 1X2 we handle separately.
SINGLE_MARKETS: list[tuple[str, str, Callable[[int, int], bool]]] = [
    ("O/U_2.5_FT", "p_over25",  lambda fh, fa: (fh + fa) > 2.5),
    ("BTTS_FT",    "p_btts",    lambda fh, fa: fh >= 1 and fa >= 1),
    ("O0.5_HT",    "p_o05_ht",  lambda fh, fa: (fh + fa) > 0.5),
    ("O1.5_HT",    "p_o15_ht",  lambda fh, fa: (fh + fa) > 1.5),
    ("BTTS_H1",    "p_btts_h1", lambda fh, fa: fh >= 1 and fa >= 1),
    ("O3.5_FT",    "p_o35_ft",  lambda fh, fa: (fh + fa) > 3.5),
    ("O4.5_FT",    "p_o45_ft",  lambda fh, fa: (fh + fa) > 4.5),
    ("O5.5_FT",    "p_o55_ft",  lambda fh, fa: (fh + fa) > 5.5),
    ("2-3_FT",     "p_2_3_ft",  lambda fh, fa: 2 <= (fh + fa) <= 3),
    ("4-6_FT",     "p_4_6_ft",  lambda fh, fa: 4 <= (fh + fa) <= 6),
]


def log_event(conn: Any, run_id: str, phase: str, level: str,
              message: str, payload: dict | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO _pipeline_events (run_id, phase, level, message, payload) "
            "VALUES (%s, %s, %s, %s, %s)",
            (run_id, phase, level, message, Json(payload) if payload else None),
        )
    conn.commit()


def fetch_settled(conn: Any) -> list[dict]:
    """Latest prediction per match_id among settled rows."""
    with conn.cursor() as cur:
        cur.execute("""
            WITH ranked AS (
                SELECT *,
                       ROW_NUMBER() OVER (
                         PARTITION BY match_id
                         ORDER BY predicted_at DESC
                       ) AS rn
                FROM tier_c_log
                WHERE settled_at IS NOT NULL
                  AND actual_home IS NOT NULL
                  AND actual_away IS NOT NULL
            )
            SELECT * FROM ranked WHERE rn = 1
        """)
        cols = [d[0] for d in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def actual_1x2(ft_h: int, ft_a: int) -> str:
    if ft_h > ft_a:
        return "HOME"
    if ft_h < ft_a:
        return "AWAY"
    return "DRAW"


def compute_1x2(rows: list[dict]) -> tuple[int, int, float, float, float, float]:
    """Returns (n_total, n_hit, hit_rate, brier, avg_pred, actual_rate)."""
    n = len(rows)
    if n == 0:
        return (0, 0, None, None, None, None)
    hits = 0
    brier_sum = 0.0
    pred_sum = 0.0
    for r in rows:
        ph, pd_, pa = r.get("p_home"), r.get("p_draw"), r.get("p_away")
        if ph is None or pd_ is None or pa is None:
            continue
        probs = [ph, pd_, pa]
        pick = ["HOME", "DRAW", "AWAY"][probs.index(max(probs))]
        act = actual_1x2(r["actual_home"], r["actual_away"])
        if pick == act:
            hits += 1
        y = [
            1.0 if act == "HOME" else 0.0,
            1.0 if act == "DRAW" else 0.0,
            1.0 if act == "AWAY" else 0.0,
        ]
        brier_sum += sum((pi - yi) ** 2 for pi, yi in zip(probs, y))
        pred_sum += max(probs)
    return (n, hits, hits / n, brier_sum / n, pred_sum / n, None)


def compute_single(rows: list[dict], prob_col: str,
                   pred_fn: Callable[[int, int], bool]
                   ) -> tuple[int, int, float, float, float, float]:
    """Returns (n, n_hit, hit_rate, brier, avg_pred, actual_rate)."""
    n = 0
    hits = 0
    brier_sum = 0.0
    pred_sum = 0.0
    actual_sum = 0
    for r in rows:
        p = r.get(prob_col)
        if p is None:
            continue
        ft_h = r["actual_home"]
        ft_a = r["actual_away"]
        # For HT markets, need actual_ht
        col = prob_col
        if col in ("p_o05_ht", "p_o15_ht", "p_btts_h1"):
            if r.get("actual_ht_home") is None or r.get("actual_ht_away") is None:
                continue
            fh = r["actual_ht_home"]
            fa = r["actual_ht_away"]
        else:
            fh = ft_h
            fa = ft_a
        actual = pred_fn(fh, fa)
        n += 1
        actual_sum += 1 if actual else 0
        y = 1.0 if actual else 0.0
        if (p >= 0.5) == actual:
            hits += 1
        brier_sum += (p - y) ** 2
        pred_sum += p
    if n == 0:
        return (0, 0, None, None, None, None)
    return (n, hits, hits / n, brier_sum / n, pred_sum / n, actual_sum / n)


def upsert_summary(conn: Any, day: str, market: str, stats: tuple) -> None:
    n, n_hit, hit_rate, brier, avg_pred, actual_rate = stats
    with conn.cursor() as cur:
        cur.execute("""
            INSERT INTO tier_c_summary_daily
              (day, market, n_total, n_hit, hit_rate, brier, avg_pred, actual_rate, updated_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, now())
            ON CONFLICT (day, market) DO UPDATE SET
              n_total = EXCLUDED.n_total,
              n_hit = EXCLUDED.n_hit,
              hit_rate = EXCLUDED.hit_rate,
              brier = EXCLUDED.brier,
              avg_pred = EXCLUDED.avg_pred,
              actual_rate = EXCLUDED.actual_rate,
              updated_at = now()
        """, (day, market, n, n_hit, hit_rate, brier, avg_pred, actual_rate))
    conn.commit()


def push_summary_supabase(sb: Any, rows: list[dict]) -> int:
    ok = 0
    for r in rows:
        try:
            resp = sb.table("tier_c_summary_daily").upsert(
                r, on_conflict="day,market"
            ).execute()
            if resp.data:
                ok += 1
        except Exception as e:
            print(f"  [supabase] upsert {r['day']}/{r['market']} failed: {e}",
                  file=sys.stderr)
    return ok


def run(push: bool) -> None:
    run_id = uuid.uuid4().hex[:12]
    conn = get_local_conn()
    sb = get_supabase() if push else None

    print(f"[agg] run_id={run_id} push={push}")

    rows = fetch_settled(conn)
    print(f"[agg] {len(rows)} settled predictions (deduped by match_id)")

    if not rows:
        print("[agg] nothing to aggregate")
        conn.close()
        return

    # Group by (day, market)
    from collections import defaultdict
    buckets: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for r in rows:
        day = r["predicted_at"].strftime("%Y-%m-%d") if hasattr(r["predicted_at"], "strftime") else str(r["predicted_at"])[:10]
        buckets[(day, "1X2_FT")].append(r)
        for mkt, col, _ in SINGLE_MARKETS:
            buckets[(day, mkt)].append(r)

    summary_rows: list[dict] = []
    for (day, market), mrows in sorted(buckets.items()):
        if market == "1X2_FT":
            stats = compute_1x2(mrows)
        else:
            fn = next(f for m, c, f in SINGLE_MARKETS if m == market)
            col = next(c for m, c, f in SINGLE_MARKETS if m == market)
            stats = compute_single(mrows, col, fn)

        if stats[0] == 0:
            continue

        n, n_hit, hit_rate, brier, avg_pred, actual_rate = stats
        print(f"  {day} | {market:12} | n={n} hit={n_hit} rate={hit_rate:.3f} brier={brier:.4f}")
        upsert_summary(conn, day, market, stats)

        summary_rows.append({
            "day": day,
            "market": market,
            "n_total": n,
            "n_hit": n_hit,
            "hit_rate": hit_rate,
            "brier": brier,
            "avg_pred": avg_pred,
            "actual_rate": actual_rate,
        })

    log_event(conn, run_id, "aggregate", "INFO",
              f"aggregated {len(summary_rows)} (day,market) rows",
              {"count": len(summary_rows)})

    if push and summary_rows:
        n = push_summary_supabase(sb, summary_rows)
        print(f"[agg] pushed {n}/{len(summary_rows)} to Supabase")

    conn.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()
    run(args.push)


if __name__ == "__main__":
    main()