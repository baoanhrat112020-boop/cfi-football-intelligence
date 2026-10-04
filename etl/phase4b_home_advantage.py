from __future__ import annotations

import sys

import numpy as np
from scipy.stats import poisson

from backtest_go_no_go import THRESH, lambdas, load, verdict
from phase2_elo import MARKETS, markets_from_lambda

HOME_ADD = 0.25
AWAY_ADD = -0.15


def predict(L):
    L = np.clip(L, 0.05, 12.0)
    p = markets_from_lambda(L[:, 0], L[:, 1], L[:, 0] * 0.42, L[:, 1] * 0.42)
    ph, pd_, pa = (p[:, MARKETS.index(m)] for m in ("Home Win", "Draw", "Away Win"))
    return ph, pd_, pa, poisson.sf(2, L[:, 0] + L[:, 1])


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows, odds = load()
    res = {r[0]: (r[6], r[7]) for r in rows}
    date = {r[0]: r[1] for r in rows}
    lam = lambdas(rows, set(odds))
    ids = sorted((f for f in odds if f in lam and f in res), key=lambda f: (date[f], f))
    hold = ids[int(len(ids) * 0.8):]
    print(f"holdout={len(hold)} from={date[hold[0]]} to={date[hold[-1]]}")

    L0 = np.array([lam[f] for f in hold])
    L1 = L0 + np.array([HOME_ADD, AWAY_ADD])
    old = predict(L0)
    new = predict(L1)

    g = np.array([res[f] for f in hold])
    y = np.stack([g[:, 0] > g[:, 1], g[:, 0] == g[:, 1], g[:, 0] < g[:, 1]], axis=1).astype(float)
    yo = (g.sum(axis=1) >= 3).astype(float)

    O = np.array([[float(x) if x is not None else np.nan for x in odds[f][2:7]] for f in hold])
    inv = 1.0 / O[:, :3]
    q = inv / inv.sum(axis=1, keepdims=True)
    inv_o = 1.0 / O[:, 3:5]
    qo = inv_o[:, 0] / inv_o.sum(axis=1)
    ok1 = ~np.isnan(q).any(axis=1)
    ok2 = ~np.isnan(qo)

    def b1(P):
        return ((np.stack(P, axis=1) - y) ** 2).sum(axis=1)

    bo, bn, bc = b1(old[:3]), b1(new[:3]), b1((q[:, 0], q[:, 1], q[:, 2]))
    oo, on, oc = (old[3] - yo) ** 2, (new[3] - yo) ** 2, (qo - yo) ** 2

    print(f"\n1X2 avg p (n={ok1.sum()})   home   draw   away")
    for name, P in (("old", old[:3]), ("new", new[:3])):
        print(f"  {name:<9} {P[0][ok1].mean():>14.3f} {P[1][ok1].mean():>6.3f} {P[2][ok1].mean():>6.3f}")
    print(f"  {'closing':<9} {q[ok1, 0].mean():>14.3f} {q[ok1, 1].mean():>6.3f} {q[ok1, 2].mean():>6.3f}")
    print(f"  {'actual':<9} {y[ok1, 0].mean():>14.3f} {y[ok1, 1].mean():>6.3f} {y[ok1, 2].mean():>6.3f}")
    print(f"avg over2.5: old={old[3][ok2].mean():.3f} new={new[3][ok2].mean():.3f} close={qo[ok2].mean():.3f} actual={yo[ok2].mean():.3f}")
    print(f"avg lambda home/away: old={L0[:, 0].mean():.3f}/{L0[:, 1].mean():.3f} new={L1[:, 0].mean():.3f}/{L1[:, 1].mean():.3f}")

    def se(d):
        return d.std(ddof=1) / np.sqrt(len(d))

    print(f"\n{'Market':<8} {'n':>5} {'old':>9} {'new':>9} {'closing':>9} {'new-close':>10} {'+-se':>8}  Verdict(new)")
    d1 = (bn - bc)[ok1]
    print(f"{'1X2':<8} {ok1.sum():>5} {bo[ok1].mean():>9.5f} {bn[ok1].mean():>9.5f} {bc[ok1].mean():>9.5f} {d1.mean():>10.5f} {se(d1):>8.5f}  {verdict(bn[ok1].mean(), bc[ok1].mean())}")
    d2 = (on - oc)[ok2]
    print(f"{'O/U 2.5':<8} {ok2.sum():>5} {oo[ok2].mean():>9.5f} {on[ok2].mean():>9.5f} {oc[ok2].mean():>9.5f} {d2.mean():>10.5f} {se(d2):>8.5f}  {verdict(on[ok2].mean(), oc[ok2].mean())}")
    clv = [(new[i] - q[:, i])[ok1].mean() for i in range(3)]
    print(f"CLV new 1X2: home={clv[0]:.4f} draw={clv[1]:.4f} away={clv[2]:.4f} | O/U={(new[3] - qo)[ok2].mean():.4f}")


if __name__ == "__main__":
    main()
