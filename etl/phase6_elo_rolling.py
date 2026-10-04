from __future__ import annotations

from collections import defaultdict

import numpy as np

from phase1_calibrate import MIN_ROWS, fit_linear
from phase2_elo import KEY, MARKETS, elo_lambda, load_dataset, load_elo, predict_lambda
from phase3_form import form_lambda


def rolling_elo_lambda(rows):
    elo = defaultdict(lambda: 1500.0)
    cnt = defaultdict(int)
    out = []
    for r in rows:
        h, a, fh, fa = r[1], r[2], r[5], r[6]
        eh, ea = elo[h], elo[a]
        if cnt[h] >= MIN_ROWS and cnt[a] >= MIN_ROWS:
            diff = (eh - ea) / 400.0
            out.append((1.35 * np.exp(diff * 0.5), 1.15 * np.exp(-diff * 0.5)))
        e_home = 1.0 / (1.0 + 10 ** ((ea - eh - 100.0) / 400.0))
        actual = 1.0 if fh > fa else (0.0 if fh < fa else 0.5)
        k = 32.0 if min(cnt[h], cnt[a]) < 30 else 20.0
        delta = k * (actual - e_home)
        elo[h] = eh + delta
        elo[a] = ea - delta
        cnt[h] += 1
        cnt[a] += 1
    return np.array(out)


def bm(p, y):
    return ((p - y) ** 2).mean()


def best_weights(p1, p2, p3, y, sl):
    grid = [(a / 10, b / 10, (10 - a - b) / 10) for a in range(11) for b in range(11 - a)]
    return min(grid, key=lambda w: bm(w[0] * p1[sl] + w[1] * p2[sl] + w[2] * p3[sl], y[sl]))


def ensemble(p1, p2, p3, y, cal, hold):
    w = best_weights(p1, p2, p3, y, cal)
    pe = w[0] * p1 + w[1] * p2 + w[2] * p3
    pc = np.empty_like(pe)
    for j in range(pe.shape[1]):
        a, b = fit_linear(pe[cal, j], y[cal, j])
        pc[:, j] = np.clip(a + b * pe[:, j], 0, 1)
    return w, pe, pc


def main():
    rows, kept, lam_cur, y = load_dataset()
    n = len(y)
    i1, i2 = int(n * 0.6), int(n * 0.8)
    cal, hold = slice(i1, i2), slice(i2, n)
    lam_r = rolling_elo_lambda(rows)
    assert len(lam_r) == n
    p1 = predict_lambda(lam_cur)
    p3 = predict_lambda(form_lambda(rows))
    p2_old = predict_lambda(elo_lambda(kept, load_elo()))
    p2_new = predict_lambda(lam_r)

    w4, pe4, pc4 = ensemble(p1, p2_old, p3, y, cal, hold)
    w6, pe6, pc6 = ensemble(p1, p2_new, p3, y, cal, hold)

    print(f"samples={n} cal={i2 - i1} hold={n - i2}")
    print(f"weights P4 (snapshot ELO) w1={w4[0]} w2={w4[1]} w3={w4[2]}")
    print(f"weights P6 (rolling ELO)  w1={w6[0]} w2={w6[1]} w3={w6[2]}")
    print(f"\n{'Model':<14} {'Brier P4':>10} {'Brier P6':>10}")
    for name, a, b in (
        ("current", p1, p1), ("elo", p2_old, p2_new), ("form", p3, p3),
        ("ensemble", pe4, pe6), ("ensemble_cal", pc4, pc6),
    ):
        print(f"{name:<14} {bm(a[hold], y[hold]):>10.5f} {bm(b[hold], y[hold]):>10.5f}")

    print(f"\n{'Market':<10} {'cur':>8} {'elo_roll':>9} {'form':>8} {'ens':>8} {'ens_cal':>8}")
    for m in KEY:
        j = MARKETS.index(m)
        v = [bm(p[hold, j], y[hold, j]) for p in (p1, p2_new, p3, pe6, pc6)]
        print(f"{m:<10} {v[0]:>8.5f} {v[1]:>9.5f} {v[2]:>8.5f} {v[3]:>8.5f} {v[4]:>8.5f}")


if __name__ == "__main__":
    main()
