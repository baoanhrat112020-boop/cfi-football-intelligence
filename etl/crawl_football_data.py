from __future__ import annotations

import io

import pandas as pd
import requests
from psycopg2.extras import execute_values

from config import get_local_conn

LEAGUES = ["E0", "SP1", "D1", "I1", "F1"]
SEASONS = ["1920", "2021", "2122", "2223", "2324"]
URL = "https://www.football-data.co.uk/mmz4281/{season}/{league}.csv"

DDL = """
CREATE TABLE IF NOT EXISTS fd_odds (
  div TEXT, season TEXT, date DATE, home_team TEXT, away_team TEXT,
  fthg INT, ftag INT, fthg_ht INT, ftag_ht INT,
  ps_h NUMERIC, ps_d NUMERIC, ps_a NUMERIC,
  ps_over25 NUMERIC, ps_under25 NUMERIC,
  PRIMARY KEY (div, season, date, home_team, away_team)
)
"""


def pick(df, *names):
    for n in names:
        if n in df.columns:
            return pd.to_numeric(df[n], errors="coerce")
    return pd.Series([None] * len(df), index=df.index, dtype="float64")


def fetch(season, league):
    r = requests.get(URL.format(season=season, league=league), timeout=60)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.content.decode("latin-1")), on_bad_lines="skip")
    df = df.dropna(subset=["HomeTeam", "AwayTeam", "Date"])
    out = pd.DataFrame({
        "div": league,
        "season": season,
        "date": pd.to_datetime(df["Date"], dayfirst=True, errors="coerce").dt.date,
        "home_team": df["HomeTeam"].str.strip(),
        "away_team": df["AwayTeam"].str.strip(),
        "fthg": pick(df, "FTHG"),
        "ftag": pick(df, "FTAG"),
        "fthg_ht": pick(df, "HTHG"),
        "ftag_ht": pick(df, "HTAG"),
        "ps_h": pick(df, "PSCH", "PSH"),
        "ps_d": pick(df, "PSCD", "PSD"),
        "ps_a": pick(df, "PSCA", "PSA"),
        "ps_over25": pick(df, "PC>2.5", "P>2.5"),
        "ps_under25": pick(df, "PC<2.5", "P<2.5"),
    })
    return out.dropna(subset=["date"])


def main():
    frames = []
    for s in SEASONS:
        for l in LEAGUES:
            try:
                f = fetch(s, l)
                frames.append(f)
                print(f"{s} {l} rows={len(f)} ps_h={f['ps_h'].notna().sum()} ou={f['ps_over25'].notna().sum()}")
            except Exception as e:
                print(f"{s} {l} FAIL {e}")
    df = pd.concat(frames, ignore_index=True)
    df = df.astype(object).where(df.notna(), None)
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute(DDL)
    cur.execute("TRUNCATE fd_odds")
    cols = list(df.columns)
    execute_values(
        cur,
        f"INSERT INTO fd_odds ({','.join(cols)}) VALUES %s ON CONFLICT DO NOTHING",
        [tuple(None if v is None else (int(v) if c in ("fthg", "ftag", "fthg_ht", "ftag_ht") and v == v else v) for c, v in zip(cols, r)) for r in df.itertuples(index=False)],
    )
    conn.commit()
    cur.execute("SELECT count(*) FROM fd_odds")
    print("fd_odds rows:", cur.fetchone()[0])
    cur.execute("SELECT * FROM fd_odds ORDER BY date LIMIT 1")
    print(cur.fetchall())
    cur.execute("SELECT * FROM fd_odds ORDER BY random() LIMIT 2")
    for r in cur.fetchall():
        print(r)
    conn.close()


if __name__ == "__main__":
    main()
