import json
import math
import random
import sys
import time
from collections import defaultdict, deque
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import requests

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "reports" / "backtest_lambda_results.json"
WORKER = "https://cfi-football-intelligence.baoanhrat112020.workers.dev/api/predict"
WINDOW, DECAY, SHRINK_N = 30, 0.94, 10
SAMPLE_N = int(sys.argv[2]) if len(sys.argv) > 2 else 200
WORKERS = int(sys.argv[3]) if len(sys.argv) > 3 else 4
SKIP_NAMES = {"Sao Paulo v Athletico Paranaense"}
LOOKBACK_DAYS = 90
MIN_PRIOR = 30


def load_env():
    env = {}
    for line in (ROOT / "etl" / ".env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.strip().startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


ENV = load_env()
BASE = ENV["SUPABASE_URL"].rstrip("/") + "/rest/v1"
HDR = {"apikey": ENV["SUPABASE_SERVICE_KEY"], "Authorization": "Bearer " + ENV["SUPABASE_SERVICE_KEY"]}


def fetch_all(path, select, filters="", order=None, page=1000):
    rows, off = [], 0
    while True:
        url = f"{BASE}/{path}?select={select}{filters}"
        if order:
            url += f"&order={order}"
        r = requests.get(url, headers={**HDR, "Range-Unit": "items", "Range": f"{off}-{off + page - 1}"}, timeout=60)
        r.raise_for_status()
        chunk = r.json()
        rows.extend(chunk)
        if len(chunk) < page:
            return rows
        off += page


def pois_logpmf(k, lam):
    lam = max(lam, 1e-6)
    return k * math.log(lam) - lam - math.lgamma(k + 1)


def wmean(dq, idx):
    if not dq:
        return None
    arr = np.array(dq)[:, idx]
    w = DECAY ** np.arange(len(arr) - 1, -1, -1)
    return float((arr * w).sum() / w.sum())


def team_params(t, home, away, n, avg_h, avg_a):
    w = min(1.0, n[t] / SHRINK_N)

    def sh(v, lg):
        return lg if v is None else w * v + (1 - w) * lg

    return {
        "ah": sh(wmean(home[t], 0), avg_h),
        "dh": sh(wmean(home[t], 1), avg_a),
        "aa": sh(wmean(away[t], 0), avg_a),
        "da": sh(wmean(away[t], 1), avg_h),
    }


def lam_from(ph, pa):
    return (ph["ah"] + pa["da"]) / 2.0, (pa["aa"] + ph["dh"]) / 2.0


def p_over(lam, k):
    s = 0.0
    p = math.exp(-lam)
    for i in range(k + 1):
        if i > 0:
            p *= lam / i
        s += p
    return 1.0 - s


def main():
    t0 = time.time()
    print("fetching fixtures ...", flush=True)
    fx = fetch_all(
        "fixtures",
        "fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away",
        "&ft_home=not.is.null&ft_away=not.is.null&home_team_id=not.is.null&away_team_id=not.is.null",
        order="match_date.asc,fixture_id.asc",
    )
    print(f"fixtures: {len(fx)} in {time.time() - t0:.0f}s", flush=True)
    stored = {r["team_id"]: r for r in fetch_all("team_stats", "team_id,attack_home,attack_away,defense_home,defense_away,n_matches")}
    teams = {r["team_id"]: r["canonical_name"] for r in fetch_all("teams", "team_id,canonical_name")}

    cutoff = (date.today() - timedelta(days=LOOKBACK_DAYS)).isoformat()
    last_ok = (date.today() - timedelta(days=3)).isoformat()
    home = defaultdict(lambda: deque(maxlen=WINDOW))
    away = defaultdict(lambda: deque(maxlen=WINDOW))
    n = defaultdict(int)
    sum_h = sum_a = cnt = 0
    evalset = []
    for r in fx:
        h, a, fh, fa = r["home_team_id"], r["away_team_id"], r["ft_home"], r["ft_away"]
        if r["match_date"] >= cutoff and r["match_date"] <= last_ok and cnt > 0 and r["ht_home"] is not None and r["ht_away"] is not None and fh >= r["ht_home"] and fa >= r["ht_away"] and n[h] >= SHRINK_N and n[a] >= SHRINK_N:
            avg_h, avg_a = sum_h / cnt, sum_a / cnt
            lh, la = lam_from(team_params(h, home, away, n, avg_h, avg_a), team_params(a, home, away, n, avg_h, avg_a))
            st_h, st_a = stored.get(h), stored.get(a)
            sl = None
            if st_h and st_a:
                sl = ((float(st_h["attack_home"]) + float(st_a["defense_away"])) / 2.0, (float(st_a["attack_away"]) + float(st_h["defense_home"])) / 2.0)
            evalset.append({
                "id": r["fixture_id"], "date": r["match_date"], "h": h, "a": a, "fh": fh, "fa": fa,
                "hth": r["ht_home"], "hta": r["ht_away"], "strict": (lh, la), "stored": sl,
                "nh": n[h], "na": n[a], "lg": (avg_h, avg_a),
            })
        home[h].append((fh, fa))
        away[a].append((fa, fh))
        n[h] += 1
        n[a] += 1
        sum_h += fh
        sum_a += fa
        cnt += 1
    print(f"eval set (last {LOOKBACK_DAYS}d, both teams >= {SHRINK_N} prior): {len(evalset)}", flush=True)

    res = {"meta": {"fixtures_total": len(fx), "eval_n": len(evalset), "lookback_days": LOOKBACK_DAYS, "generated": date.today().isoformat()}}

    ht_all = sum((r["ht_home"] or 0) + (r["ht_away"] or 0) for r in fx if r["ht_home"] is not None and r["ht_away"] is not None and r["ft_home"] >= r["ht_home"] and r["ft_away"] >= r["ht_away"])
    ft_all = sum(r["ft_home"] + r["ft_away"] for r in fx if r["ht_home"] is not None and r["ht_away"] is not None and r["ft_home"] >= r["ht_home"] and r["ft_away"] >= r["ht_away"])
    res["ht_ratio_all"] = ht_all / ft_all

    factors = [0.40, 0.42, 0.44, 0.45, 0.46, 0.48, 0.50]
    fres = {}
    for f in factors:
        ll = 0.0
        pred = 0.0
        act = 0.0
        for e in evalset:
            lam = (e["strict"][0] + e["strict"][1]) * f
            k = e["hth"] + e["hta"]
            ll += pois_logpmf(k, lam)
            pred += lam
            act += k
        fres[str(f)] = {"mean_loglik_ht_total": ll / len(evalset), "mean_pred_ht_goals": pred / len(evalset), "mean_actual_ht_goals": act / len(evalset)}
    res["ht_factor_eval_strict_lambda"] = fres
    res["ht_ratio_eval_actual"] = sum(e["hth"] + e["hta"] for e in evalset) / sum(e["fh"] + e["fa"] for e in evalset)

    cal = {}
    for f in (0.45, 0.46):
        rows = []
        for e in evalset:
            lht = (e["strict"][0] + e["strict"][1]) * f
            k = e["hth"] + e["hta"]
            p05 = 1 - math.exp(-lht)
            p1 = 1 - math.exp(-lht) * (1 + lht)
            p075 = p1 + 0.5 * math.exp(-lht) * lht
            real075 = (1.0 if k >= 2 else 0.5 if k == 1 else 0.0)
            rows.append((p05, p075, p1, 1 if k >= 1 else 0, real075, 1 if k >= 2 else 0))
        arr = np.array(rows)
        out = []
        for th in (0.50, 0.55, 0.58, 0.60, 0.62, 0.65, 0.68, 0.70):
            m = arr[:, 1] >= th
            if m.sum() == 0:
                continue
            sub = arr[m]
            out.append({
                "threshold_p075": th, "n": int(m.sum()), "share": float(m.mean()),
                "pred_p075": float(sub[:, 1].mean()), "real_p075_ev": float(sub[:, 4].mean()),
                "pred_p05": float(sub[:, 0].mean()), "real_p05": float(sub[:, 3].mean()),
                "pred_p1": float(sub[:, 2].mean()), "real_p1": float(sub[:, 5].mean()),
            })
        cal[str(f)] = out
    res["threshold_calibration_strict_lambda"] = cal

    rng = random.Random(42)
    pool = [e for e in evalset if e["nh"] >= MIN_PRIOR and e["na"] >= MIN_PRIOR and e["stored"] is not None]
    rng.shuffle(pool)
    pool = [e for e in pool if (teams[e["h"]] + " v " + teams[e["a"]]) not in SKIP_NAMES]
    sample = pool[:SAMPLE_N]
    print(f"engine sample: {len(sample)} (pool {len(pool)})", flush=True)

    def call(e):
        body = {"home": teams[e["h"]], "away": teams[e["a"]], "target_date": e["date"], "language": "vi", "input_mode": "SINGLE_MATCH", "response_mode": "full"}
        err = ""
        for attempt in range(3):
            try:
                r = requests.post(WORKER, json=body, headers={"x-cfi-dry-run": "1"}, timeout=70)
                j = r.json()
                lam = j.get("lambdaFT")
                if lam or r.status_code in (400, 422):
                    return {"id": e["id"], "http": r.status_code, "status": j.get("status") or j.get("error"), "tierC": bool(j.get("tierC")), "lam": [lam["home"], lam["away"]] if lam else None, "audit": (j.get("audit") or {}).get("reason"), "attempts": attempt + 1}
                err = "HTTP%s:%s" % (r.status_code, str(j.get("error") or j.get("status"))[:40])
            except Exception as ex:
                err = "EXC:" + str(ex)[:60]
            time.sleep(2 ** attempt * 2)
        return {"id": e["id"], "http": None, "status": err, "tierC": False, "lam": None, "audit": None, "attempts": 3}

    t1 = time.time()
    with ThreadPoolExecutor(max_workers=WORKERS) as ex:
        results = list(ex.map(call, sample))
    print(f"engine calls done in {time.time() - t1:.0f}s", flush=True)
    by_id = {r["id"]: r for r in results}
    from collections import Counter
    res["engine_status_counts"] = dict(Counter(str(r["status"]) + "|http=" + str(r.get("http")) for r in results))
    res["engine_calls"] = {
        "requested": len(sample),
        "ok": sum(1 for r in results if r["lam"] and not r["tierC"]),
        "tier_c": sum(1 for r in results if r["tierC"]),
        "failed": sum(1 for r in results if not r["lam"]),
        "audit_not_dry_run": sum(1 for r in results if r["lam"] and r["audit"] != "DRY_RUN" and not r["tierC"]),
        "seconds": time.time() - t1,
    }
    tierc_ids = [by_id[e["id"]] and (teams[e["h"]] + " v " + teams[e["a"]]) for e in sample if by_id[e["id"]]["tierC"]]
    res["engine_tier_c_matches"] = tierc_ids

    ok = [(e, by_id[e["id"]]["lam"]) for e in sample if by_id[e["id"]]["lam"] and not by_id[e["id"]]["tierC"]]

    def metrics(name, getter):
        mh = ma = mt = 0.0
        ll = 0.0
        bias_h = bias_a = 0.0
        hw = hn = aw = an = 0
        dirn = {"home_pick_n": 0, "home_pick_correct": 0, "away_pick_n": 0, "away_pick_correct": 0}
        br25 = 0.0
        br15 = 0.0
        for e, elam in ok:
            lh, la = getter(e, elam)
            mh += abs(lh - e["fh"])
            ma += abs(la - e["fa"])
            mt += abs((lh + la) - (e["fh"] + e["fa"]))
            ll += pois_logpmf(e["fh"], lh) + pois_logpmf(e["fa"], la)
            bias_h += lh - e["fh"]
            bias_a += la - e["fa"]
            tot = e["fh"] + e["fa"]
            br25 += (p_over(lh + la, 2) - (1 if tot >= 3 else 0)) ** 2
            br15 += (p_over(lh + la, 1) - (1 if tot >= 2 else 0)) ** 2
            if lh > la:
                dirn["home_pick_n"] += 1
                dirn["home_pick_correct"] += 1 if e["fh"] > e["fa"] else 0
            elif la > lh:
                dirn["away_pick_n"] += 1
                dirn["away_pick_correct"] += 1 if e["fa"] > e["fh"] else 0
        N = len(ok)
        return {
            "n": N, "mae_home": mh / N, "mae_away": ma / N, "mae_total": mt / N,
            "bias_home": bias_h / N, "bias_away": bias_a / N, "mean_loglik_per_team_goal": ll / (2 * N),
            "brier_o25": br25 / N, "brier_o15": br15 / N, **dirn,
        }

    league = lambda e, el: e["lg"]
    res["engine_vs_team_stats"] = {
        "league_average_baseline": metrics("league", league),
        "team_stats_stored_current": metrics("stored", lambda e, el: e["stored"]),
        "team_stats_strict_prior": metrics("strict", lambda e, el: e["strict"]),
        "engine": metrics("engine", lambda e, el: (el[0], el[1])),
    }
    res["actual_mean_goals"] = {"home": float(np.mean([e["fh"] for e, _ in ok])), "away": float(np.mean([e["fa"] for e, _ in ok]))}
    res["actual_home_win_rate"] = float(np.mean([1 if e["fh"] > e["fa"] else 0 for e, _ in ok]))
    res["lambda_corr_engine_vs_strict"] = float(np.corrcoef([el[0] + el[1] for _, el in ok], [e["strict"][0] + e["strict"][1] for e, _ in ok])[0, 1])
    res["lambda_corr_engine_vs_stored"] = float(np.corrcoef([el[0] + el[1] for _, el in ok], [e["stored"][0] + e["stored"][1] for e, _ in ok])[0, 1])

    OUT.write_text(json.dumps(res, indent=2), encoding="utf-8")
    print("done in %.0fs -> %s" % (time.time() - t0, OUT), flush=True)


main()
