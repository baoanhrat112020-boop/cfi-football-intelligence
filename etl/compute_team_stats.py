from __future__ import annotations

import argparse
import sys
from collections import defaultdict, deque
from typing import Any

import numpy as np

from config import get_local_conn, get_supabase

WINDOW = 30
DECAY = 0.94
SHRINK_N = 10

DDL = """
CREATE TABLE IF NOT EXISTS team_stats (
  team_id TEXT PRIMARY KEY,
  attack_home NUMERIC,
  attack_away NUMERIC,
  defense_home NUMERIC,
  defense_away NUMERIC,
  n_matches INT,
  updated_at TIMESTAMPTZ DEFAULT now()
)
"""


def fetch_fixtures(conn: Any) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(
            """SELECT home_team_id, away_team_id, ft_home, ft_away
               FROM fixtures
               WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL
                 AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
               ORDER BY match_date, fixture_id"""
        )
        return cur.fetchall()


def wmean(dq: deque, idx: int) -> float | None:
    if not dq:
        return None
    arr = np.array(dq)[:, idx]
    w = DECAY ** np.arange(len(arr) - 1, -1, -1)
    return float((arr * w).sum() / w.sum())


def compute(fixtures: list[tuple]) -> list[dict]:
    home = defaultdict(lambda: deque(maxlen=WINDOW))
    away = defaultdict(lambda: deque(maxlen=WINDOW))
    n = defaultdict(int)
    sum_h = sum_a = 0
    for h, a, fh, fa in fixtures:
        home[h].append((fh, fa))
        away[a].append((fa, fh))
        n[h] += 1
        n[a] += 1
        sum_h += fh
        sum_a += fa
    avg_h = sum_h / len(fixtures)
    avg_a = sum_a / len(fixtures)

    rows = []
    for t in n:
        raw = {
            "attack_home": (wmean(home[t], 0), avg_h),
            "defense_home": (wmean(home[t], 1), avg_a),
            "attack_away": (wmean(away[t], 0), avg_a),
            "defense_away": (wmean(away[t], 1), avg_h),
        }
        w = min(1.0, n[t] / SHRINK_N)
        row = {"team_id": t, "n_matches": n[t]}
        for k, (v, lg) in raw.items():
            row[k] = round(lg if v is None else w * v + (1 - w) * lg, 4)
        rows.append(row)
    return rows


def upsert_local(conn: Any, rows: list[dict]) -> int:
    with conn.cursor() as cur:
        cur.execute(DDL)
        for r in rows:
            cur.execute(
                """INSERT INTO team_stats (team_id, attack_home, attack_away, defense_home, defense_away, n_matches, updated_at)
                   VALUES (%(team_id)s, %(attack_home)s, %(attack_away)s, %(defense_home)s, %(defense_away)s, %(n_matches)s, now())
                   ON CONFLICT (team_id) DO UPDATE SET
                     attack_home = EXCLUDED.attack_home, attack_away = EXCLUDED.attack_away,
                     defense_home = EXCLUDED.defense_home, defense_away = EXCLUDED.defense_away,
                     n_matches = EXCLUDED.n_matches, updated_at = now()""",
                r,
            )
    conn.commit()
    return len(rows)


def push_supabase(sb: Any, rows: list[dict]) -> int:
    ok = 0
    for i in range(0, len(rows), 500):
        chunk = rows[i:i + 500]
        try:
            resp = sb.table("team_stats").upsert(chunk, on_conflict="team_id").execute()
            ok += len(resp.data) if resp.data else 0
        except Exception as e:
            print(f"  [supabase] chunk {i} failed: {e}", file=sys.stderr)
    return ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--push", action="store_true")
    args = ap.parse_args()
    conn = get_local_conn()
    fixtures = fetch_fixtures(conn)
    print(f"[team_stats] {len(fixtures)} fixtures")
    rows = compute(fixtures)
    print(f"[team_stats] {len(rows)} teams computed")
    n_local = upsert_local(conn, rows)
    print(f"[team_stats] wrote {n_local} rows to local")
    if args.push:
        n_sb = push_supabase(get_supabase(), rows)
        print(f"[team_stats] pushed {n_sb} rows to Supabase")
    conn.close()


if __name__ == "__main__":
    main()
