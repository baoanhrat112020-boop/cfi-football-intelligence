from __future__ import annotations

import numpy as np

from phase1_calibrate import fit_linear
from phase2_elo import MARKETS, load_dataset, load_elo, elo_lambda, predict_lambda
from phase3_form import form_lambda


def avg_brier(p, y):
    return ((p - y) ** 2).mean()


def main():
    rows, kept, lam_cur, y = load_dataset()
    n = len(y)
    i1, i2 = int(n * 0.6), int(n * 0.8)
    cal, hold = slice(i1, i2), slice(i2, n)
    p1 = predict_lambda(lam_cur)
    p2 = predict_lambda(elo_lambda(kept, load_elo()))
    p3 = predict_lambda(form_lambda(rows))

    grid = [(a / 10, b / 10, (10 - a - b) / 10) for a in range(11) for b in range(11 - a)]
    best = min(grid, key=lambda w: avg_brier(w[0] * p1[cal] + w[1] * p2[cal] + w[2] * p3[cal], y[cal]))
    bh = min(grid, key=lambda w: avg_brier(w[0] * p1[hold] + w[1] * p2[hold] + w[2] * p3[hold], y[hold]))
    pe = best[0] * p1 + best[1] * p2 + best[2] * p3

    pc = np.empty_like(pe)
    coef = []
    for j in range(len(MARKETS)):
        a, b = fit_linear(pe[cal, j], y[cal, j])
        coef.append((a, b))
        pc[:, j] = np.clip(a + b * pe[:, j], 0, 1)

    print(f"samples={n} cal={i2 - i1} hold={n - i2}")
    print(f"weights (fit on cal slice) w1={best[0]} w2={best[1]} w3={best[2]}")
    print(f"weights (fit on holdout)   w1={bh[0]} w2={bh[1]} w3={bh[2]}")
    for name, p in (("current", p1), ("elo", p2), ("form", p3), ("ensemble", pe), ("ensemble_cal", pc)):
        print(f"Brier {name:<13} {avg_brier(p[hold], y[hold]):.5f}")
    print(f"\n{'Market':<10} {'cur':>8} {'elo':>8} {'form':>8} {'ens':>8} {'ens_cal':>8} {'a':>8} {'b':>8}")
    for j, m in enumerate(MARKETS):
        r = [avg_brier(p[hold, j], y[hold, j]) for p in (p1, p2, p3, pe, pc)]
        print(f"{m:<10} " + " ".join(f"{v:>8.5f}" for v in r) + f" {coef[j][0]:>8.4f} {coef[j][1]:>8.4f}")


if __name__ == "__main__":
    main()
