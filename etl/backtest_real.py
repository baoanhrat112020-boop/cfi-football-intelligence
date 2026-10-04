from __future__ import annotations

import math
import sys
from bisect import bisect_left
from collections import defaultdict

import numpy as np

from config import get_local_conn

N_RECENT = int(sys.argv[1]) if len(sys.argv) > 1 else 10
MIN_ROWS = 3
DECAY = 0.94
H2H_W = 1.35
MARKETS = ["3+ HT", "7+ FT", "Other HT", "Other FT"]


def poisson_cdf(k, lam):
    term = math.exp(-lam)
    s = term
    for i in range(1, k + 1):
        term *= lam / i
        s += term
    return min(1.0, max(0.0, s))


def hit(r, m):
    d, ht_h, ht_a, ft_h, ft_a = r
    if m == "3+ HT":
        return int(ht_h + ht_a >= 3)
    if m == "7+ FT":
        return int(ft_h + ft_a >= 7)
    if m == "Other HT":
        return int(max(ht_h, ht_a) >= 4)
    return int(max(ft_h, ft_a) >= 5)


def prior(lst, dates, d, n):
    i = bisect_left(dates, d)
    return lst[max(0, i - n):i]


def predict(rows_w):
    tot = sum(w for _, w in rows_w)
    if not rows_w or not tot:
        return None
    lam = [0.0] * 6
    for r, w in rows_w:
        _, hh, ha, fh, fa = r
        for j, v in enumerate((hh + ha, fh + fa, hh, ha, fh, fa)):
            lam[j] += v * w
    ht, ft, hth, hta, fth, fta = (x / tot for x in lam)
    return {
        "3+ HT": 1 - poisson_cdf(2, ht),
        "7+ FT": 1 - poisson_cdf(6, ft),
        "Other HT": 1 - poisson_cdf(3, hth) * poisson_cdf(3, hta),
        "Other FT": 1 - poisson_cdf(4, fth) * poisson_cdf(4, fta),
    }


def main():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT match_date, home_team_id, away_team_id, ht_home, ht_away, ft_home, ft_away
           FROM fixtures
           WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL
             AND ht_home IS NOT NULL AND ht_away IS NOT NULL
             AND match_date IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
           ORDER BY match_date"""
    )
    data = cur.fetchall()
    conn.close()

    team = defaultdict(list)
    h2h = defaultdict(list)
    for d, h, a, hh, ha, fh, fa in data:
        r = (d, hh, ha, fh, fa)
        team[h].append(r)
        team[a].append(r)
        h2h[frozenset((h, a))].append(r)
    team_dates = {k: [x[0] for x in v] for k, v in team.items()}
    h2h_dates = {k: [x[0] for x in v] for k, v in h2h.items()}

    split = int(len(data) * 0.8)
    test = data[split:]
    print(f"fixtures={len(data)} test={len(test)} from={test[0][0]} N_RECENT={N_RECENT}")

    preds = {m: [] for m in MARKETS}
    outs = {m: [] for m in MARKETS}
    for d, h, a, hh, ha, fh, fa in test:
        hist_h = prior(team[h], team_dates[h], d, N_RECENT)
        hist_a = prior(team[a], team_dates[a], d, N_RECENT)
        key = frozenset((h, a))
        hist_x = prior(h2h[key], h2h_dates[key], d, N_RECENT)
        if len(hist_h) < MIN_ROWS or len(hist_a) < MIN_ROWS:
            continue
        rows_w = []
        for lst, base in ((hist_h, 1.0), (hist_a, 1.0), (hist_x, H2H_W)):
            n = len(lst)
            for i, r in enumerate(lst):
                rows_w.append((r, base * DECAY ** (n - 1 - i)))
        p = predict(rows_w)
        if p is None:
            continue
        actual = (d, hh, ha, fh, fa)
        for m in MARKETS:
            preds[m].append(p[m])
            outs[m].append(hit(actual, m))

    for m in MARKETS:
        p = np.array(preds[m])
        y = np.array(outs[m])
        n = len(p)
        brier = float(np.mean((p - y) ** 2))
        print(f"\n=== {m} | n={n} base_rate={y.mean():.4f} avg_pred={p.mean():.4f} Brier={brier:.4f} ===")
        order = np.argsort(p, kind="stable")
        bins = np.array_split(order, 10)
        print(f"{'bin':>4} {'n':>7} {'avg_pred':>9} {'actual':>8}")
        for bi in list(range(5)) + list(range(5, 10)):
            idx = bins[bi]
            print(f"{bi + 1:>4} {len(idx):>7} {p[idx].mean():>9.4f} {y[idx].mean():>8.4f}")


if __name__ == "__main__":
    main()
