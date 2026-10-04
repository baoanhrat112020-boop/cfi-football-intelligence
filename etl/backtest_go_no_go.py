from __future__ import annotations

from collections import defaultdict, deque

import sys

import numpy as np
from scipy.stats import poisson

from config import get_local_conn
from phase1_calibrate import DECAY, MIN_ROWS, WINDOW
from phase2_elo import MARKETS, markets_from_lambda

THRESH = 0.005


def load():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute(
        """SELECT fixture_id, match_date, home_team_id, away_team_id, ht_home, ht_away, ft_home, ft_away
           FROM fixtures
           WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL AND ht_home IS NOT NULL AND ht_away IS NOT NULL
             AND match_date IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL
           ORDER BY match_date, fixture_id"""
    )
    rows = cur.fetchall()
    cur.execute(
        """SELECT m.fixture_id, m.date, o.ps_h, o.ps_d, o.ps_a, o.ps_over25, o.ps_under25
           FROM fd_match m JOIN fd_odds o USING (div, season, date, home_team, away_team)"""
    )
    odds = {r[0]: r for r in cur.fetchall()}
    conn.close()
    return rows, odds


def lambdas(rows, wanted):
    hist = defaultdict(lambda: deque(maxlen=WINDOW))
    out = {}
    for fid, d, h, a, hh, ha, fh, fa in rows:
        dh, da = hist[h], hist[a]
        if fid in wanted and len(dh) >= MIN_ROWS and len(da) >= MIN_ROWS:
            wh = DECAY ** np.arange(len(dh) - 1, -1, -1)
            wa = DECAY ** np.arange(len(da) - 1, -1, -1)
            ah, aa = np.array(dh), np.array(da)
            att_h = (ah[:, 0] * wh).sum() / wh.sum()
            def_h = (ah[:, 1] * wh).sum() / wh.sum()
            att_a = (aa[:, 0] * wa).sum() / wa.sum()
            def_a = (aa[:, 1] * wa).sum() / wa.sum()
            out[fid] = ((att_h + def_a) / 2, (att_a + def_h) / 2)
        dh.append((fh, fa))
        da.append((fa, fh))
    return out


def verdict(bm, bc):
    if bm < bc - THRESH:
        return "WIN"
    if bm > bc:
        return "LOSE"
    return "TIE"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows, odds = load()
    res = {r[0]: (r[6], r[7]) for r in rows}
    date = {r[0]: r[1] for r in rows}
    lam = lambdas(rows, set(odds))
    ids = sorted((f for f in odds if f in lam and f in res), key=lambda f: (date[f], f))
    cut = int(len(ids) * 0.8)
    hold = ids[cut:]
    print(f"matched={len(odds)} usable={len(ids)} holdout={len(hold)} from={date[hold[0]]} to={date[hold[-1]]}")

    L = np.clip(np.array([lam[f] for f in hold]), 0.05, 12.0)
    p = markets_from_lambda(L[:, 0], L[:, 1], L[:, 0] * 0.42, L[:, 1] * 0.42)
    ph, pd_, pa = (p[:, MARKETS.index(m)] for m in ("Home Win", "Draw", "Away Win"))
    pover = poisson.sf(2, L[:, 0] + L[:, 1])

    g = np.array([res[f] for f in hold])
    yh, yd, ya = (g[:, 0] > g[:, 1]).astype(float), (g[:, 0] == g[:, 1]).astype(float), (g[:, 0] < g[:, 1]).astype(float)
    yo = (g.sum(axis=1) >= 3).astype(float)

    O = np.array([[float(x) if x is not None else np.nan for x in odds[f][2:7]] for f in hold])
    inv = 1.0 / O[:, :3]
    q = inv / inv.sum(axis=1, keepdims=True)
    ok1 = ~np.isnan(q).any(axis=1)
    inv_o = 1.0 / O[:, 3:5]
    qo = inv_o[:, 0] / inv_o.sum(axis=1)
    ok2 = ~np.isnan(qo)

    b_m1 = (ph - yh) ** 2 + (pd_ - yd) ** 2 + (pa - ya) ** 2
    b_c1 = (q[:, 0] - yh) ** 2 + (q[:, 1] - yd) ** 2 + (q[:, 2] - ya) ** 2
    b_m2 = (pover - yo) ** 2
    b_c2 = (qo - yo) ** 2

    def se(d):
        return d.std(ddof=1) / np.sqrt(len(d))

    d1 = (b_m1 - b_c1)[ok1]
    d2 = (b_m2 - b_c2)[ok2]
    print(f"\n{'Market':<10} {'n':>5} {'Brier model':>12} {'Brier close':>12} {'diff':>8} {'+-se':>7} {'CLV mean':>9} Verdict")
    r1 = (b_m1[ok1].mean(), b_c1[ok1].mean())
    r2 = (b_m2[ok2].mean(), b_c2[ok2].mean())
    clv1 = (ph - q[:, 0])[ok1].mean()
    print(f"{'1X2':<10} {ok1.sum():>5} {r1[0]:>12.5f} {r1[1]:>12.5f} {d1.mean():>8.5f} {se(d1):>7.5f} {clv1:>9.4f} {verdict(*r1)}")
    print(f"{'O/U 2.5':<10} {ok2.sum():>5} {r2[0]:>12.5f} {r2[1]:>12.5f} {d2.mean():>8.5f} {se(d2):>7.5f} {(pover - qo)[ok2].mean():>9.4f} {verdict(*r2)}")
    print(f"CLV 1X2 per outcome: home={clv1:.4f} draw={(pd_ - q[:, 1])[ok1].mean():.4f} away={(pa - q[:, 2])[ok1].mean():.4f}")
    print(f"avg p: model home/draw/away={ph.mean():.3f}/{pd_.mean():.3f}/{pa.mean():.3f} close={q[:, 0].mean():.3f}/{q[:, 1].mean():.3f}/{q[:, 2].mean():.3f} actual={yh.mean():.3f}/{yd.mean():.3f}/{ya.mean():.3f}")
    print(f"avg over: model={pover.mean():.3f} close={np.nanmean(qo):.3f} actual={yo.mean():.3f}")
    win = verdict(*r1) == "WIN" or verdict(*r2) == "WIN"
    print("\nCFI có thể bet" if win else "\nKhông khả thi")


if __name__ == "__main__":
    main()
