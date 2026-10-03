"""CFI ETL - pull delta from Supabase to local Postgres.

Uses composite cursor (cursor_col, key_col) to safely handle rows sharing
the same timestamp.
"""
from __future__ import annotations

import argparse
import sys
import time
import uuid
from typing import Any

from psycopg2.extras import Json

from config import get_supabase, get_local_conn

TABLES: dict[str, tuple[str, str, list[str]]] = {
    "teams": ("created_at", "team_id",
              ["team_id", "canonical_name", "normalized_name", "created_at"]),
    "team_aliases": ("updated_at", "alias_normalized",
                     ["alias_normalized", "alias_display", "team_id",
                      "source", "confidence", "created_at", "updated_at"]),
    "teams_elo": ("updated_at", "team_id",
                  ["team_id", "rating", "matches", "updated_at"]),
    "tier_c_log": ("predicted_at", "id",
                   ["id", "match_id", "predicted_at", "home_team", "away_team",
                    "p_home", "p_draw", "p_away", "p_over25", "p_btts",
                    "xg_home", "xg_away", "elo_home", "elo_away",
                    "model", "actual_home", "actual_away", "settled_at"]),
    "fixtures": ("updated_at", "fixture_id",
                 ["fixture_id", "match_date", "home_team_id", "away_team_id",
                  "ht_home", "ht_away", "ft_home", "ft_away", "status",
                  "created_at", "updated_at", "competition_key", "competition_name",
                  "country", "season", "competition_segment", "tier", "kickoff_at"]),
    "cfi_living_verified_fixtures": ("verified_at", "fixture_id",
                                      ["fixture_id", "target_date", "kickoff_at",
                                       "home_team", "away_team",
                                       "home_team_norm", "away_team_norm",
                                       "competition", "verification_status",
                                       "source_name", "source_url",
                                       "source_provenance", "verified_at",
                                       "canonical_home_team_id", "canonical_away_team_id"]),
}

RETRY_DELAYS = [1, 2, 4]


def log_event(conn: Any, run_id: str, phase: str, level: str,
              message: str, payload: dict | None = None) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO _pipeline_events (run_id, phase, level, message, payload) "
            "VALUES (%s, %s, %s, %s, %s)",
            (run_id, phase, level, message, Json(payload) if payload is not None else None),
        )
    conn.commit()


def get_cursor(conn: Any, table: str) -> tuple[str | None, str | None]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT last_sync_at, last_id FROM _sync_cursor WHERE table_name = %s",
            (table,),
        )
        row = cur.fetchone()
    if not row or row[0] is None:
        return (None, None)
    ts = row[0].isoformat() if hasattr(row[0], "isoformat") else str(row[0])
    return (ts, row[1])


def set_cursor(conn: Any, table: str, last_sync_at: str, last_id: str | None,
               row_count: int) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO _sync_cursor (table_name, last_sync_at, last_id, row_count, updated_at)
            VALUES (%s, %s, %s, %s, now())
            ON CONFLICT (table_name) DO UPDATE SET
                last_sync_at = EXCLUDED.last_sync_at,
                last_id = EXCLUDED.last_id,
                row_count = EXCLUDED.row_count,
                updated_at = now()
            """,
            (table, last_sync_at, last_id, row_count),
        )
    conn.commit()


def fetch_batch(sb: Any, table: str, cursor_col: str, key_col: str,
                last_ts: str | None, last_id: str | None,
                batch: int) -> list[dict]:
    q = sb.table(table).select("*")
    if last_ts is not None and last_id is not None:
        # Composite cursor: (cursor_col, key_col) > (last_ts, last_id)
        q = q.or_(
            f"{cursor_col}.gt.{last_ts},"
            f"and({cursor_col}.eq.{last_ts},{key_col}.gt.{last_id})"
        )
    q = q.order(cursor_col, desc=False).order(key_col, desc=False).limit(batch)

    for attempt, delay in enumerate([0] + RETRY_DELAYS):
        if delay:
            print(f"[pull] retry {attempt} sau {delay}s...", flush=True)
            time.sleep(delay)
        try:
            resp = q.execute()
            return resp.data or []
        except Exception as e:
            if attempt == len(RETRY_DELAYS):
                raise
            print(f"[pull] loi: {e}", file=sys.stderr, flush=True)
    return []


def _adapt(v: Any) -> Any:
    """Wrap dict/list for JSONB columns."""
    if isinstance(v, (dict, list)):
        return Json(v)
    return v


def upsert_local(conn: Any, table: str, cols: list[str],
                 rows: list[dict], key_col: str) -> int:
    if not rows:
        return 0
    placeholders = ", ".join(["%s"] * len(cols))
    col_list = ", ".join(cols)
    update_list = ", ".join(
        f"{c} = EXCLUDED.{c}" for c in cols if c != key_col
    )
    sql = (
        f"INSERT INTO {table} ({col_list}) VALUES ({placeholders}) "
        f"ON CONFLICT ({key_col}) DO UPDATE SET {update_list}"
    )
    with conn.cursor() as cur:
        for row in rows:
            cur.execute(sql, tuple(_adapt(row.get(c)) for c in cols))
    conn.commit()
    return len(rows)


def pull_table(table: str, batch: int, dry_run: bool) -> dict:
    if table not in TABLES:
        raise SystemExit(f"Unknown table: {table}. Known: {list(TABLES)}")
    cursor_col, key_col, cols = TABLES[table]
    run_id = uuid.uuid4().hex[:12]
    sb = get_supabase()
    conn = get_local_conn()

    print(f"[pull] run_id={run_id} table={table} cursor=({cursor_col},{key_col}) "
          f"batch={batch} dry_run={dry_run}", flush=True)

    last_ts, last_id = get_cursor(conn, table)
    print(f"[pull] cursor from ts={last_ts} id={last_id}", flush=True)

    pulled = 0
    total_batches = 0

    while True:
        rows = fetch_batch(sb, table, cursor_col, key_col, last_ts, last_id, batch)
        if not rows:
            break
        total_batches += 1

        # Advance cursor from LAST row of batch
        last_row = rows[-1]
        new_ts = last_row.get(cursor_col)
        new_id = str(last_row.get(key_col))

        if dry_run:
            pulled += len(rows)
            print(f"[pull] batch#{total_batches} dry-run would upsert {len(rows)} rows "
                  f"(ts={new_ts} id={new_id})", flush=True)
        else:
            n = upsert_local(conn, table, cols, rows, key_col)
            pulled += n
            log_event(conn, run_id, "pull", "INFO",
                      f"upsert {n} rows batch#{total_batches}",
                      {"table": table, "batch": total_batches})
            set_cursor(conn, table, new_ts, new_id, pulled)

        if new_ts:
            last_ts = new_ts
            last_id = new_id

        if len(rows) < batch:
            break

    if not dry_run:
        log_event(conn, run_id, "pull", "INFO",
                  f"done pulled={pulled}",
                  {"table": table, "batches": total_batches})

    conn.close()
    print(f"[pull] table={table} pulled={pulled} batches={total_batches}", flush=True)
    return {"table": table, "pulled": pulled, "batches": total_batches}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--table", default="teams", choices=list(TABLES))
    ap.add_argument("--batch", type=int, default=1000)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    pull_table(args.table, args.batch, args.dry_run)


if __name__ == "__main__":
    main()