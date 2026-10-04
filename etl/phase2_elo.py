from __future__ import annotations

from collections import defaultdict

import numpy as np
from scipy.stats import poisson

from config import get_local_conn
from phase1_calibrate import MIN_ROWS, R_HT, KMAX, build_samples, load_fixtures

MARKETS = [
    "HT O0.5", "HT O1.5", "3+ HT", "HT BTTS", "Other HT",
    "FT O3.5", "FT O4.5", "FT O5.5", "7+ FT", "FT BTTS", "Other FT",
    "Home Win", "Away Win", "2-3 FT", "4-6 FT", "Draw",
]
KEY = ["3+ HT", "7+ FT", "Other HT", "Other FT"]


def outcomes(hh, ha, fh, fa):
    ht = hh + ha
    ft = fh + fa
    cols = [
        ht >= 1, ht >= 2, ht >= 3, (hh >= 1) & (ha >= 1), np.maximum(hh, ha) >= 4,
        ft >= 4, ft >= 5, ft >= 6, ft >= 7, (fh >= 1) & (fa >= 1), np.maximum(fh, fa) >= 5,
        fh > fa, fa > fh, (ft >= 2) & (ft <= 3), (ft >= 4) & (ft <= 6), fh == fa,
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
    wh = win(lh_ft, la_ft)
    wa = win(la_ft, lh_ft)
    cols = [
        tot_ge(1, lt_ht), tot_ge(2, lt_ht), tot_ge(3, lt_ht),
        (1 - np.exp(-lh_ht)) * (1 - np.exp(-la_ht)),
        1 - poisson.cdf(3, lh_ht) * poisson.cdf(3, la_ht),
        tot_ge(4, lt_ft), tot_ge(5, lt_ft), tot_ge(6, lt_ft), tot_ge(7, lt_ft),
        (1 - np.exp(-lh_ft)) * (1 - np.exp(-la_ft)),
        1 - poisson.cdf(4, lh_ft) * poisson.cdf(4, la_ft),
        wh, wa, tot_ge(2, lt_ft) - tot_ge(4, lt_ft), tot_ge(4, lt_ft) - tot_ge(7, lt_ft), 1 - wh - wa,
    ]
    return np.clip(np.stack(cols, axis=1), 0.0, 1.0)


def eligible(rows):
    cnt = defaultdict(int)
    keep = []
    for r in rows:
        h, a = r[1], r[2]
        if cnt[h] >= MIN_ROWS and cnt[a] >= MIN_ROWS:
            keep.append(r)
        cnt[h] += 1
        cnt[a] += 1
    return keep


def load_elo():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute("SELECT team_id, rating FROM teams_elo WHERE rating IS NOT NULL")
    d = {t: float(r) for t, r in cur.fetchall()}
    conn.close()
    return d


def load_dataset():
    rows = load_fixtures()
    kept = eligible(rows)
    lam_cur, _ = build_samples(rows)
    assert len(kept) == len(lam_cur)
    hh = np.array([r[3] for r in kept])
    ha = np.array([r[4] for r in kept])
    fh = np.array([r[5] for r in kept])
    fa = np.array([r[6] for r in kept])
    return rows, kept, np.clip(lam_cur, 0.05, 12.0), outcomes(hh, ha, fh, fa)


def predict_lambda(lam):
    lam = np.clip(lam, 0.05, 12.0)
    return markets_from_lambda(lam[:, 0], lam[:, 1], lam[:, 0] * R_HT, lam[:, 1] * R_HT)


def elo_lambda(kept, elo):
    h = np.array([elo.get(r[1], 1500.0) for r in kept])
    a = np.array([elo.get(r[2], 1500.0) for r in kept])
    diff = (h - a) / 400.0
    return np.stack([1.35 * np.exp(diff * 0.5), 1.15 * np.exp(-diff * 0.5)], axis=1)


def report(name, p, y, hold):
    br = ((p[hold] - y[hold]) ** 2).mean(axis=0)
    print(f"\n{name} | holdout n={len(y[hold])} | Brier avg={br.mean():.5f}")
    print(f"{'Market':<10} {'Brier':>9} {'base':>8} {'avg_p':>8}")
    for j, m in enumerate(MARKETS):
        print(f"{m:<10} {br[j]:>9.5f} {y[hold, j].mean():>8.4f} {p[hold, j].mean():>8.4f}")
    for m in KEY:
        j = MARKETS.index(m)
        pj, yj = p[hold, j], y[hold, j]
        bins = np.array_split(np.argsort(pj, kind="stable"), 10)
        print(f"-- bins {m}")
        for bi in range(10):
            idx = bins[bi]
            print(f"{bi + 1:>3} n={len(idx):>6} pred={pj[idx].mean():.4f} act={yj[idx].mean():.4f}")


def main():
    rows, kept, lam_cur, y = load_dataset()
    n = len(y)
    hold = slice(int(n * 0.8), n)
    elo = load_elo()
    p = predict_lambda(elo_lambda(kept, elo))
    report("ELO", p, y, hold)


if __name__ == "__main__":
    main()
