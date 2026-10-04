from __future__ import annotations

from collections import defaultdict, deque

import numpy as np

from phase1_calibrate import MIN_ROWS
from phase2_elo import load_dataset, predict_lambda, report


def form_lambda(rows):
    hist = defaultdict(lambda: deque(maxlen=5))
    out = []
    for r in rows:
        h, a, fh, fa = r[1], r[2], r[5], r[6]
        dh, da = hist[h], hist[a]
        if len(dh) >= MIN_ROWS and len(da) >= MIN_ROWS:
            out.append((np.mean([x[0] for x in dh]), np.mean([x[0] for x in da])))
        dh.append((fh, fa))
        da.append((fa, fh))
    return np.array(out)


def main():
    rows, kept, lam_cur, y = load_dataset()
    n = len(y)
    hold = slice(int(n * 0.8), n)
    lam = form_lambda(rows)
    assert len(lam) == n
    p = predict_lambda(lam)
    report("FORM", p, y, hold)


if __name__ == "__main__":
    main()
