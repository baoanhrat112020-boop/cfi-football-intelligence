from __future__ import annotations

import numpy as np
import pandas as pd

from config import get_local_conn
from phase1_calibrate import build_samples
from phase2_elo import KEY, MARKETS, eligible, outcomes, predict_lambda

TOP = 5
MIN_N = 30


def load():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT match_date, home_team_id, away_team_id, ht_home, ht_away, ft_home, ft_away, competition_key
           FROM fixtures
           WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL
             AND ht_home IS NOT NULL AND ht_away IS NOT NULL
             AND match_date IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
           ORDER BY match_date, fixture_id"""
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def main():
    full = load()
    rows = [r[:7] for r in full]
    kept_full = eligible(full)
    lam, _ = build_samples(rows)
    assert len(kept_full) == len(lam)
    lam = np.clip(lam, 0.05, 12.0)
    y = outcomes(*[np.array([r[i] for r in kept_full]) for i in (3, 4, 5, 6)])
    n = len(y)
    h0 = int(n * 0.8)
    p = predict_lambda(lam)
    cols = [MARKETS.index(m) for m in KEY]

    df = pd.DataFrame(y[:, cols], columns=KEY)
    df["league"] = [r[7] or "NA" for r in kept_full]
    df["month"] = pd.to_datetime([r[0] for r in kept_full]).to_period("M").astype(int)
    for k, c in enumerate(cols):
        df[f"p_{KEY[k]}"] = p[:, c]

    glob = df[KEY].iloc[:h0].mean().values

    cnt = df.groupby(["league", "month"])[KEY].agg(["sum", "count"])
    n_m = cnt.xs(KEY[0], axis=1, level=0)["count"].unstack(fill_value=0)
    months = np.arange(df["month"].min(), df["month"].max() + 1)
    n_m = n_m.reindex(columns=months, fill_value=0)
    s_m = {m: df.groupby(["league", "month"])[m].sum().unstack(fill_value=0).reindex(index=n_m.index, columns=months, fill_value=0) for m in KEY}
    n_cum = n_m.cumsum(axis=1)
    n_roll = n_cum - n_cum.shift(6, axis=1, fill_value=0)
    s_cum = {m: s_m[m].cumsum(axis=1) for m in KEY}
    s_roll = {m: s_cum[m] - s_cum[m].shift(6, axis=1, fill_value=0) for m in KEY}

    hold = df.iloc[h0:].copy()
    pos = {m: i for i, m in enumerate(months)}
    li = {l: i for i, l in enumerate(n_m.index)}
    ri = hold["league"].map(li).values
    ci = hold["month"].map(pos).values - 1
    ok = ci >= 0
    ci = np.where(ok, ci, 0)

    nn_all = n_cum.values[ri, ci]
    nn_roll = n_roll.values[ri, ci]
    base_all, base_roll = {}, {}
    for k, m in enumerate(KEY):
        ra = np.where(nn_all >= MIN_N, s_cum[m].values[ri, ci] / np.maximum(nn_all, 1), glob[k])
        rr = np.where(nn_roll >= MIN_N, s_roll[m].values[ri, ci] / np.maximum(nn_roll, 1), glob[k])
        base_all[m], base_roll[m] = ra, rr

    top = hold["league"].value_counts().head(TOP).index.tolist()
    print(f"samples={n} holdout={len(hold)} leagues={top}")
    print(f"{'League':<28} {'Market':<9} {'n':>6} {'rate':>7} {'model':>8} {'b_all':>8} {'b_roll':>8} {'vs_all':>7} {'vs_roll':>8} verdict")

    def verdict(a, b):
        d = (a - b) / b
        return "WIN" if d < -0.01 else ("LOSE" if d > 0.01 else "TIE")

    def line(name, mask):
        for m in KEY:
            yy = hold[m].values[mask]
            bm = ((hold[f"p_{m}"].values[mask] - yy) ** 2).mean()
            ba = ((base_all[m][mask] - yy) ** 2).mean()
            br = ((base_roll[m][mask] - yy) ** 2).mean()
            print(f"{str(name)[:28]:<28} {m:<9} {mask.sum():>6} {yy.mean():>7.4f} {bm:>8.5f} {ba:>8.5f} {br:>8.5f} {(bm - ba) / ba * 100:>6.1f}% {(bm - br) / br * 100:>7.1f}% {verdict(bm, ba)}/{verdict(bm, br)}")

    for l in top:
        line(l, (hold["league"] == l).values)
    line("ALL holdout", np.ones(len(hold), dtype=bool))


if __name__ == "__main__":
    main()
