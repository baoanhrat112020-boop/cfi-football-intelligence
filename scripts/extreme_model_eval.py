from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import time
import urllib.parse
import urllib.request
from collections import defaultdict

import numpy as np

WINDOW = 30
DECAY = 0.94
SHRINK_N = 10
K = 20
MARKETS = ("HT>=1", "HT>=2", "3+ HT", "7+ FT", "Other HT", "Other FT")
R_GRID = [0.8, 1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0, 20.0, 40.0, 100.0, 1000.0]
BASE_SHARE = 0.50
LG = np.array([math.lgamma(i + 1) for i in range(80)])
WT = {n: [DECAY ** (n - 1 - i) for i in range(n)] for n in range(1, WINDOW + 1)}
WSUM = {n: sum(WT[n]) for n in WT}

BASE_COLS = "fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away"
LEAGUE_COLS = BASE_COLS + ",competition_key,competition_name,country"

QUERY = (
    "SELECT fixture_id, match_date, home_team_id, away_team_id, ht_home, ht_away, ft_home, ft_away, "
    "competition_key, competition_name, country "
    "FROM fixtures WHERE ft_home IS NOT NULL AND ft_away IS NOT NULL "
    "AND match_date IS NOT NULL AND home_team_id IS NOT NULL AND away_team_id IS NOT NULL"
)


def to_int(v):
    if v is None or v == "":
        return None
    return int(v)


def league_of(key, name, country):
    k = str(key or "").strip()
    if k:
        return k
    return f"{country or ''}|{name or ''}".strip("|")


def fetch_page(base, key, last, cols):
    q = {
        "select": cols,
        "ft_home": "not.is.null",
        "ft_away": "not.is.null",
        "match_date": "not.is.null",
        "home_team_id": "not.is.null",
        "away_team_id": "not.is.null",
        "order": "fixture_id.asc",
        "limit": "1000",
    }
    if last is not None:
        q["fixture_id"] = "gt." + last
    url = f"{base}/rest/v1/fixtures?{urllib.parse.urlencode(q, safe='.,:')}"
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            if attempt == 3:
                raise
            print(f"retry {attempt + 1}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def load_rest(base, key):
    cols = LEAGUE_COLS
    try:
        fetch_page(base.rstrip("/"), key, None, cols)
    except Exception as e:
        print(f"league columns unavailable ({e}), continuing without league analysis", file=sys.stderr)
        cols = BASE_COLS
    rows = []
    last = None
    while True:
        page = fetch_page(base.rstrip("/"), key, last, cols)
        if not page:
            break
        for r in page:
            rows.append((str(r["match_date"]), str(r["fixture_id"]), str(r["home_team_id"]), str(r["away_team_id"]),
                         to_int(r.get("ht_home")), to_int(r.get("ht_away")), int(r["ft_home"]), int(r["ft_away"]),
                         league_of(r.get("competition_key"), r.get("competition_name"), r.get("country"))))
        last = str(page[-1]["fixture_id"])
        if len(page) < 1000:
            break
    return rows


def load_rows(args):
    rows = []
    if args.csv:
        with open(args.csv, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                rows.append((str(r["match_date"]), str(r["fixture_id"]), str(r["home_team_id"]), str(r["away_team_id"]),
                             to_int(r.get("ht_home")), to_int(r.get("ht_away")), int(r["ft_home"]), int(r["ft_away"]),
                             league_of(r.get("competition_key"), r.get("competition_name"), r.get("country")) if "competition_key" in r or "country" in r else ""))
    elif os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_KEY"):
        rows = load_rest(os.environ["SUPABASE_URL"], os.environ["SUPABASE_KEY"])
    else:
        url = os.environ.get("DATABASE_URL")
        if not url:
            sys.exit("set SUPABASE_URL and SUPABASE_KEY, or DATABASE_URL, or pass --csv")
        import psycopg2
        conn = psycopg2.connect(url)
        with conn.cursor() as cur:
            cur.execute(QUERY)
            for fid, d, h, a, hth, hta, fh, fa, ck, cn, co in cur.fetchall():
                rows.append((str(d), str(fid), str(h), str(a), hth, hta, int(fh), int(fa), league_of(ck, cn, co)))
        conn.close()
    rows.sort(key=lambda x: (x[0], x[1]))
    if args.limit and len(rows) > args.limit:
        rows = rows[-args.limit:]
    return rows


def wmean(lst, idx):
    n = len(lst)
    if n == 0:
        return None
    w = WT[n]
    return sum(x[idx] * wi for x, wi in zip(lst, w)) / WSUM[n]


def shrink(v, lg, n):
    w = min(1.0, n / SHRINK_N)
    return lg if v is None else w * v + (1 - w) * lg


def walk_forward(rows):
    homeq = defaultdict(list)
    awayq = defaultdict(list)
    cnt = defaultdict(int)
    sum_h = sum_a = 0.0
    m = 0
    n = len(rows)
    lam_h = np.zeros(n)
    lam_a = np.zeros(n)
    prior_h = np.zeros(n, dtype=int)
    prior_a = np.zeros(n, dtype=int)
    for i, (_, _, h, a, _, _, fh, fa, _) in enumerate(rows):
        avg_h = sum_h / m if m else 1.5
        avg_a = sum_a / m if m else 1.2
        nh, na = cnt[h], cnt[a]
        att_h = shrink(wmean(homeq[h], 0), avg_h, nh)
        def_h = shrink(wmean(homeq[h], 1), avg_a, nh)
        att_a = shrink(wmean(awayq[a], 0), avg_a, na)
        def_a = shrink(wmean(awayq[a], 1), avg_h, na)
        lam_h[i] = (att_h + def_a) / 2.0
        lam_a[i] = (att_a + def_h) / 2.0
        prior_h[i] = nh
        prior_a[i] = na
        homeq[h].append((fh, fa))
        awayq[a].append((fa, fh))
        if len(homeq[h]) > WINDOW:
            homeq[h].pop(0)
        if len(awayq[a]) > WINDOW:
            awayq[a].pop(0)
        cnt[h] += 1
        cnt[a] += 1
        sum_h += fh
        sum_a += fa
        m += 1
    return lam_h, lam_a, prior_h, prior_a


def pmf_table(lam, r):
    lam = np.clip(lam, 1e-3, 15.0)
    k = np.arange(K + 1)[None, :]
    l = lam[:, None]
    if r is None:
        logp = k * np.log(l) - l - LG[: K + 1][None, :]
    else:
        lgr = np.array([math.lgamma(i + r) for i in range(K + 1)])[None, :]
        logp = lgr - math.lgamma(r) - LG[: K + 1][None, :] + r * np.log(r / (r + l)) + k * np.log(l / (r + l))
    return np.exp(logp)


def logpmf_obs(y, lam, r):
    lam = np.clip(lam, 1e-3, 15.0)
    y = np.clip(y, 0, 79)
    if r is None:
        return y * np.log(lam) - lam - LG[y]
    lgr = np.array([math.lgamma(i + r) for i in range(80)])
    return lgr[y] - math.lgamma(r) - LG[y] + r * np.log(r / (r + lam)) + y * np.log(lam / (r + lam))


def tail_total(ph, pa, t):
    ca = np.cumsum(pa, axis=1)
    below = np.zeros(ph.shape[0])
    for x in range(t):
        below += ph[:, x] * ca[:, t - 1 - x]
    return np.clip(1.0 - below, 1e-6, 1 - 1e-6)


def tail_team(ph, pa, t):
    ch = np.cumsum(ph, axis=1)[:, t - 1]
    ca = np.cumsum(pa, axis=1)[:, t - 1]
    return np.clip(1.0 - ch * ca, 1e-6, 1 - 1e-6)


def event_probs(lam_h, lam_a, share, r_ft, r_ht):
    ph, pa = pmf_table(lam_h, r_ft), pmf_table(lam_a, r_ft)
    qh, qa = pmf_table(lam_h * share, r_ht), pmf_table(lam_a * share, r_ht)
    return {
        "HT>=1": np.clip(1.0 - qh[:, 0] * qa[:, 0], 1e-6, 1 - 1e-6),
        "HT>=2": tail_total(qh, qa, 2),
        "3+ HT": tail_total(qh, qa, 3),
        "7+ FT": tail_total(ph, pa, 7),
        "Other HT": tail_team(qh, qa, 4),
        "Other FT": tail_team(ph, pa, 5),
    }


def fit_dispersion(y_h, y_a, lam_h, lam_a):
    best, best_ll = None, -1e18
    for r in R_GRID:
        rr = None if r >= 1000.0 else r
        ll = logpmf_obs(y_h, lam_h, rr).sum() + logpmf_obs(y_a, lam_a, rr).sum()
        if ll > best_ll:
            best, best_ll = rr, ll
    return best


def metrics(p, y):
    ll = -(y * np.log(p) + (1 - y) * np.log(1 - p))
    return {
        "n": int(len(y)),
        "events": int(y.sum()),
        "obs": float(y.mean()),
        "pred": float(p.mean()),
        "logloss": float(ll.mean()),
        "brier": float(((p - y) ** 2).mean()),
    }, ll


def top_slice(p, y, frac=0.05):
    k = max(1, int(len(p) * frac))
    idx = np.argsort(-p)[:k]
    return float(p[idx].mean()), float(y[idx].mean())


def fmt(v, d=4):
    return f"{v:.{d}f}"


def share_by_bins(lam_tot, ht_tot, ft_tot, edges):
    b = np.searchsorted(edges, lam_tot, side="right")
    out = []
    for k in range(len(edges) + 1):
        m = b == k
        if not m.any():
            out.append(None)
            continue
        out.append({
            "n": int(m.sum()),
            "lam": float(lam_tot[m].mean()),
            "ft": float(ft_tot[m].mean()),
            "ht": float(ht_tot[m].mean()),
            "share_lam": float(ht_tot[m].sum() / lam_tot[m].sum()),
            "share_ft": float(ht_tot[m].sum() / max(ft_tot[m].sum(), 1)),
        })
    return b, out


def print_bins(table):
    print(f"{'bin':>4}{'n':>8}{'exp_total':>11}{'act_total':>11}{'act_HT':>9}{'HT/exp':>9}{'HT/FT':>9}")
    for k, t in enumerate(table):
        if t:
            print(f"{k + 1:>4}{t['n']:>8}{fmt(t['lam'], 3):>11}{fmt(t['ft'], 3):>11}{fmt(t['ht'], 3):>9}{fmt(t['share_lam'], 4):>9}{fmt(t['share_ft'], 4):>9}")


def league_stats(leagues, lam_tot, ht_tot, ft_tot, share_g, min_n):
    acc = defaultdict(lambda: [0, 0.0, 0.0, 0.0])
    for lg, l, h, f in zip(leagues, lam_tot, ht_tot, ft_tot):
        a = acc[lg]
        a[0] += 1
        a[1] += l
        a[2] += h
        a[3] += f
    rows = []
    for lg, (n, sl, sh, sf) in acc.items():
        if n < min_n or not lg:
            continue
        z = (sh - share_g * sl) / math.sqrt(max(sh, 1.0))
        rows.append({"league": lg, "n": n, "share_lam": sh / sl, "share_ft": sh / max(sf, 1.0), "z": z})
    return rows


def print_leagues(rows, share_g, top=10):
    if not rows:
        print("no league data")
        return
    big = sum(1 for r in rows if abs(r["z"]) > 3)
    print(f"leagues={len(rows)} |z|>3: {big} ({fmt(100.0 * big / len(rows), 1)}%) global_share={fmt(share_g)}")
    ordered = sorted(rows, key=lambda r: r["share_lam"])
    print(f"{'league':<46}{'n':>7}{'HT/exp':>9}{'HT/FT':>9}{'z':>8}")
    shown = ordered if len(ordered) <= 2 * top else ordered[:top] + [None] + ordered[-top:]
    for r in shown:
        if r is None:
            print("  ...")
            continue
        print(f"{r['league'][:45]:<46}{r['n']:>7}{fmt(r['share_lam'], 4):>9}{fmt(r['share_ft'], 4):>9}{r['z']:>+8.1f}")


def run(args):
    rows = load_rows(args)
    if len(rows) < 2000:
        sys.exit(f"only {len(rows)} rows, need at least 2000")
    lam_h, lam_a, ph_, pa_ = walk_forward(rows)
    fh = np.array([r[6] for r in rows])
    fa = np.array([r[7] for r in rows])
    ht_ok = np.array([r[4] is not None and r[5] is not None for r in rows])
    hh = np.array([r[4] if r[4] is not None else 0 for r in rows])
    ha = np.array([r[5] if r[5] is not None else 0 for r in rows])
    leagues = np.array([r[8] for r in rows], dtype=object)
    elig = (ph_ >= args.min_n) & (pa_ >= args.min_n)
    idx = np.where(elig)[0]
    cut = int(len(idx) * (1 - args.test_frac))
    tr, te = idx[:cut], idx[cut:]
    print(f"rows={len(rows)} eligible={len(idx)} train={len(tr)} test={len(te)} min_n={args.min_n}")
    if len(tr) < 1000 or len(te) < 500:
        sys.exit("not enough eligible rows")

    lam_tot = lam_h + lam_a
    ht_tot = (hh + ha).astype(float)
    ft_tot = (fh + fa).astype(float)
    r_ft = fit_dispersion(fh[tr], fa[tr], lam_h[tr], lam_a[tr])
    trh = tr[ht_ok[tr]]
    share = float(ht_tot[trh].sum() / lam_tot[trh].sum())
    r_ht = fit_dispersion(hh[trh], ha[trh], lam_h[trh] * share, lam_a[trh] * share)
    print(f"fit: ft_dispersion_r={'poisson' if r_ft is None else r_ft} ht_share={fmt(share)} ht_dispersion_r={'poisson' if r_ht is None else r_ht}")

    edges = np.quantile(lam_tot[trh], np.linspace(0, 1, args.bins + 1)[1:-1])
    allh = idx[ht_ok[idx]]
    print("\n== HT share by expected total goals (all eligible, bins from train quantiles)")
    _, table_all = share_by_bins(lam_tot[allh], ht_tot[allh], ft_tot[allh], edges)
    print_bins(table_all)
    _, table_tr = share_by_bins(lam_tot[trh], ht_tot[trh], ft_tot[trh], edges)
    bin_share = np.array([t["share_lam"] if t else share for t in table_tr])

    has_league = any(r[8] for r in rows)
    league_share = {}
    if has_league:
        print(f"\n== HT share by league (all eligible, min {args.min_league} matches)")
        stats = league_stats(leagues[allh], lam_tot[allh], ht_tot[allh], ft_tot[allh], share, args.min_league)
        print_leagues(stats, share)
        acc = defaultdict(lambda: [0.0, 0.0])
        for lg, l, h in zip(leagues[trh], lam_tot[trh], ht_tot[trh]):
            acc[lg][0] += h
            acc[lg][1] += l
        a0 = args.league_prior
        league_share = {lg: (sh + a0 * share) / (sl + a0) for lg, (sh, sl) in acc.items() if lg}

    te_b = np.searchsorted(edges, lam_tot[te], side="right")
    s_bin = bin_share[te_b]
    s_lg = np.array([league_share.get(lg, share) for lg in leagues[te]]) if has_league else None
    models = {
        "poisson_0.50": event_probs(lam_h[te], lam_a[te], BASE_SHARE, None, None),
        "share_global": event_probs(lam_h[te], lam_a[te], share, None, None),
        "share_by_bin": event_probs(lam_h[te], lam_a[te], s_bin, None, None),
    }
    if has_league:
        models["share_by_league"] = event_probs(lam_h[te], lam_a[te], s_lg, None, None)
    if r_ft is not None or r_ht is not None:
        models["negbin_fit"] = event_probs(lam_h[te], lam_a[te], share, r_ft, r_ht)
    ys = {
        "HT>=1": (ht_tot[te] >= 1).astype(float),
        "HT>=2": (ht_tot[te] >= 2).astype(float),
        "3+ HT": (ht_tot[te] >= 3).astype(float),
        "7+ FT": (ft_tot[te] >= 7).astype(float),
        "Other HT": (np.maximum(hh[te], ha[te]) >= 4).astype(float),
        "Other FT": (np.maximum(fh[te], fa[te]) >= 5).astype(float),
    }
    ht_markets = ("HT>=1", "HT>=2", "3+ HT", "Other HT")
    ok = {mk: (ht_ok[te] if mk in ht_markets else np.ones(len(te), bool)) for mk in MARKETS}

    report = {"fit": {"ft_r": r_ft, "ht_share": share, "ht_r": r_ht}, "bins": table_all, "markets": {}}
    for mk in MARKETS:
        m = ok[mk]
        y = ys[mk][m]
        names = list(models) if mk in ht_markets else ["poisson_0.50"]
        print(f"\n== {mk} | n={int(m.sum())} events={int(y.sum())} base={fmt(y.mean())}")
        print(f"{'model':<17}{'pred':>8}{'pred/obs':>10}{'logloss':>10}{'brier':>10}{'top5% pred':>12}{'top5% obs':>11}{'z vs 0.50':>11}{'z vs global':>13}")
        lls = {}
        report["markets"][mk] = {}
        for name in names:
            p = models[name][mk][m]
            mt, ll = metrics(p, y)
            lls[name] = ll
            tp, to = top_slice(p, y)

            def zs(ref):
                if ref not in lls or ref == name:
                    return ""
                d = lls[ref] - ll
                se = d.std(ddof=1) / math.sqrt(len(d))
                return f"{d.mean() / se:+.2f}" if se > 0 else "n/a"

            ratio = fmt(mt["pred"] / mt["obs"], 2) if mt["obs"] else "n/a"
            print(f"{name:<17}{fmt(mt['pred']):>8}{ratio:>10}{fmt(mt['logloss'], 5):>10}{fmt(mt['brier'], 5):>10}{fmt(tp):>12}{fmt(to):>11}{zs('poisson_0.50'):>11}{zs('share_global'):>13}")
            report["markets"][mk][name] = {**mt, "top5_pred": tp, "top5_obs": to}
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh_:
            json.dump(report, fh_, indent=2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--min-n", type=int, default=15)
    ap.add_argument("--test-frac", type=float, default=0.4)
    ap.add_argument("--bins", type=int, default=10)
    ap.add_argument("--min-league", type=int, default=800)
    ap.add_argument("--league-prior", type=float, default=400.0)
    ap.add_argument("--json")
    run(ap.parse_args())


if __name__ == "__main__":
    main()
