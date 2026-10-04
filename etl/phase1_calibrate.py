from __future__ import annotations

from collections import defaultdict, deque

import numpy as np
from scipy.stats import poisson

from config import get_local_conn

WINDOW = 30
DECAY = 0.94
R_HT = 0.42
MIN_ROWS = 3
KMAX = 25

MARKETS = [
    "HT O0.5", "HT O1.5", "3+ HT", "HT BTTS", "Other HT",
    "FT O1.5", "FT O2.5", "FT O3.5", "FT O4.5", "FT O5.5", "7+ FT", "FT BTTS", "Other FT",
    "Home Win", "Away Win",
]


def load_fixtures():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT match_date, home_team_id, away_team_id, ht_home, ht_away, ft_home, ft_away
           FROM fixtures
           WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL
             AND ht_home IS NOT NULL AND ht_away IS NOT NULL
             AND match_date IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
           ORDER BY match_date, fixture_id"""
    )
    rows = cur.fetchall()
    conn.close()
    return rows


def outcomes(hh, ha, fh, fa):
    ht = hh + ha
    ft = fh + fa
    cols = [
        ht >= 1, ht >= 2, ht >= 3, (hh >= 1) & (ha >= 1), np.maximum(hh, ha) >= 4,
        ft >= 2, ft >= 3, ft >= 4, ft >= 5, ft >= 6, ft >= 7, (fh >= 1) & (fa >= 1), np.maximum(fh, fa) >= 5,
        fh > fa, fa > fh,
    ]
    return np.stack(cols, axis=1).astype(float)


def markets_from_lambda(lh_ft, la_ft, lh_ht, la_ht):
    def tot_ge(k, lam):
        return poisson.sf(k - 1, lam)

    def win(lh, la):
        k = np.arange(KMAX)
        ph = poisson.pmf(k[None, :], lh[:, None])
        ca = poisson.cdf(k[None, :] - 1, la[:, None])
        return (ph * ca).sum(axis=1)

    lt_ht = lh_ht + la_ht
    lt_ft = lh_ft + la_ft
    cols = [
        tot_ge(1, lt_ht), tot_ge(2, lt_ht), tot_ge(3, lt_ht),
        (1 - np.exp(-lh_ht)) * (1 - np.exp(-la_ht)),
        1 - poisson.cdf(3, lh_ht) * poisson.cdf(3, la_ht),
        tot_ge(2, lt_ft), tot_ge(3, lt_ft), tot_ge(4, lt_ft), tot_ge(5, lt_ft), tot_ge(6, lt_ft), tot_ge(7, lt_ft),
        (1 - np.exp(-lh_ft)) * (1 - np.exp(-la_ft)),
        1 - poisson.cdf(4, lh_ft) * poisson.cdf(4, la_ft),
        win(lh_ft, la_ft), win(la_ft, lh_ft),
    ]
    return np.clip(np.stack(cols, axis=1), 0.0, 1.0)


def build_samples(rows):
    hist = defaultdict(lambda: deque(maxlen=WINDOW))
    lam_ft = []
    ys = []
    for d, h, a, hh, ha, fh, fa in rows:
        dh, da = hist[h], hist[a]
        if len(dh) >= MIN_ROWS and len(da) >= MIN_ROWS:
            wh = DECAY ** np.arange(len(dh) - 1, -1, -1)
            wa = DECAY ** np.arange(len(da) - 1, -1, -1)
            ah = np.array(dh)
            aa = np.array(da)
            sh = wh.sum()
            sa = wa.sum()
            att_h = (ah[:, 0] * wh).sum() / sh
            def_h = (ah[:, 1] * wh).sum() / sh
            att_a = (aa[:, 0] * wa).sum() / sa
            def_a = (aa[:, 1] * wa).sum() / sa
            lam_ft.append(((att_h + def_a) / 2, (att_a + def_h) / 2))
            ys.append((hh, ha, fh, fa, d))
        dh.append((fh, fa))
        da.append((fa, fh))
    return np.array(lam_ft), ys


def brier(p, y):
    return ((p - y) ** 2).mean(axis=0)


def fit_linear(x, y):
    b, a = np.polyfit(x, y, 1)
    return a, b


def main():
    rows = load_fixtures()
    lam, ys = build_samples(rows)
    lam = np.clip(lam, 0.05, 12.0)
    y = outcomes(*[np.array([r[i] for r in ys]) for i in range(4)])
    n = len(y)
    i1, i2 = int(n * 0.6), int(n * 0.8)
    p = markets_from_lambda(lam[:, 0], lam[:, 1], lam[:, 0] * R_HT, lam[:, 1] * R_HT)
    cal = slice(i1, i2)
    hold = slice(i2, n)
    print(f"fixtures={len(rows)} samples={n} train={i1} cal={i2 - i1} hold={n - i2}")
    print(f"{'Market':<10} {'Brier raw':>10} {'Brier cal':>10} {'Improve %':>10} {'a':>9} {'b':>9}")
    for j, m in enumerate(MARKETS):
        a, b = fit_linear(p[cal, j], y[cal, j])
        pc = np.clip(a + b * p[hold, j], 0, 1)
        br = ((p[hold, j] - y[hold, j]) ** 2).mean()
        bc = ((pc - y[hold, j]) ** 2).mean()
        print(f"{m:<10} {br:>10.5f} {bc:>10.5f} {(br - bc) / br * 100:>10.2f} {a:>9.4f} {b:>9.4f}")


if __name__ == "__main__":
    main()
