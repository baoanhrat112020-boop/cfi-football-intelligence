import os
import numpy as np
import pandas as pd
from scipy.stats import poisson
from supabase import create_client
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])


def pull(table, select, fn=None, step=1000):
    out, off = [], 0
    while True:
        q = sb.table(table).select(select)
        if fn:
            q = fn(q)
        r = q.range(off, off + step - 1).execute().data
        out += r
        if len(r) < step:
            break
        off += step
    return out


d = pd.DataFrame(pull("suggest_pick_log", "fixture_id,kickoff_at,lambda_home_ft,lambda_away_ft,ht_home,ht_away,ft_home,ft_away",
                      lambda q: q.not_.is_("ft_home", "null").not_.is_("ht_home", "null").order("kickoff_at")))
ids = d.fixture_id.tolist()
o = []
for i in range(0, len(ids), 150):
    o += pull("match_odds", "verified_fixture_id,market_family,period,line,p_implied_over,odds_home,odds_draw,odds_away,league",
              lambda q, ch=ids[i:i + 150]: q.in_("verified_fixture_id", ch))
o = pd.DataFrame(o)
for c in ["line", "p_implied_over", "odds_home", "odds_draw", "odds_away"]:
    o[c] = pd.to_numeric(o[c], errors="coerce")

x = o[o.market_family == "1X2"].dropna(subset=["odds_home", "odds_draw", "odds_away"]).groupby("verified_fixture_id").first()
inv = 1 / x[["odds_home", "odds_draw", "odds_away"]]
inv = inv.div(inv.sum(axis=1), axis=0)
feat = pd.DataFrame({"m_h": inv.odds_home, "m_d": inv.odds_draw, "m_a": inv.odds_away})
ou = o[o.market_family == "OVER_UNDER"].dropna(subset=["p_implied_over", "line"])
for per, lines in (("FT", (2.5, 3.5)), ("HT", (1.5,))):
    for L in lines:
        s = ou[(ou.period == per) & (ou.line.sub(L).abs() < 1e-9)].groupby("verified_fixture_id").p_implied_over.mean()
        feat[f"m_ou_{per}_{L}"] = s
comp = {}
snaps = sb.table("suggest_snapshot").select("snapshot_date").order("snapshot_date", desc=True).limit(400).execute().data
fids = set(ids)
for sd in sorted({r["snapshot_date"] for r in snaps}):
    r = sb.table("suggest_snapshot").select("payload").eq("snapshot_date", sd).order("generated_at", desc=True).limit(1).execute().data
    if not r:
        continue
    for sl in r[0]["payload"].get("slots", []):
        for m in sl.get("matches", []):
            if m.get("fixture_id") in fids and m.get("competition"):
                comp[m["fixture_id"]] = m["competition"]
print("fixtures with competition", len(comp))
tiers = {}
for name in set(comp.values()):
    try:
        tiers[name] = sb.rpc("cfi_league_tier", {"p_comp": name}).execute().data
    except Exception:
        tiers[name] = None
lg = pd.Series(comp)
feat["tier"] = lg.map(tiers).reindex(feat.index).astype(float)
print("tier counts", feat.tier.value_counts(dropna=False).to_dict())

d = d.merge(feat, left_on="fixture_id", right_index=True)
d = d[d.m_h.notna()].sort_values("kickoff_at").reset_index(drop=True)
h, a = d.lambda_home_ft.values.astype(float), d.lambda_away_ft.values.astype(float)
t = h + a
lc = 3.2 ** 0.4 * t ** 0.6
hc, ac = h * lc / t, a * lc / t
G = np.arange(0, 15)


def base(x_, y_):
    P = poisson.pmf(G[None, :, None], x_[:, None, None]) * poisson.pmf(G[None, None, :], y_[:, None, None])
    i, j = np.meshgrid(G, G, indexing="ij")
    return {"home_win_ft": (P * (i > j)).sum((1, 2)), "over25_ft": (P * (i + j >= 3)).sum((1, 2)),
            "over35_ft": (P * (i + j >= 4)).sum((1, 2)), "btts": (P * ((i > 0) & (j > 0))).sum((1, 2))}


cal = base(hc, ac)
y = {"home_win_ft": (d.ft_home > d.ft_away), "over25_ft": (d.ft_home + d.ft_away >= 3), "over35_ft": (d.ft_home + d.ft_away >= 4),
     "btts": ((d.ft_home > 0) & (d.ft_away > 0)), "home_win_ht": (d.ht_home > d.ht_away), "over15_ht": (d.ht_home + d.ht_away >= 2)}
mk = {"home_win_ft": "m_h", "over25_ft": "m_ou_FT_2.5", "over35_ft": "m_ou_FT_3.5", "over15_ht": "m_ou_HT_1.5"}
n = len(d)
k = int(n * 0.7)
print("rows", n, "train", k, "test", n - k)
B = np.column_stack([np.log(h + 0.05), np.log(a + 0.05), np.log(t + 0.1), h - a])
F = d[["m_h", "m_d", "m_a", "m_ou_FT_2.5", "m_ou_FT_3.5", "m_ou_HT_1.5", "tier"]].values.astype(float)
mi = np.isnan(F)
Fi = np.where(mi, np.nanmean(F, axis=0), F)
XA = np.column_stack([B, Fi, mi.astype(float)])
XG = np.column_stack([B, F])
eps = 1e-6
for tr in (1, 2, 3):
    mt = (d.tier == tr).values
    if mt.sum() < 30:
        continue
    r = {"tier": tr, "n": int(mt.sum())}
    yh = y["home_win_ft"].values.astype(int)
    r["hw_calib"] = log_loss(yh[mt], np.clip(cal["home_win_ft"][mt], eps, 1 - eps))
    r["hw_market"] = log_loss(yh[mt], np.clip(d.m_h.values[mt], eps, 1 - eps))
    y25 = y["over25_ft"].values.astype(int)
    p25 = d["m_ou_FT_2.5"].values
    ok = mt & ~np.isnan(p25)
    if ok.sum() >= 30:
        r["o25_n"] = int(ok.sum())
        r["o25_calib"] = log_loss(y25[ok], np.clip(cal["over25_ft"][ok], eps, 1 - eps))
        r["o25_market"] = log_loss(y25[ok], np.clip(p25[ok], eps, 1 - eps))
    print(r)
for m, col in (("home_win_ft", "m_h"), ("over35_ft", "m_ou_FT_3.5"), ("over25_ft", "m_ou_FT_2.5")):
    pm = d[col].values
    ok = ~np.isnan(pm)
    yy = y[m].values.astype(int)
    res = {}
    for w in np.arange(0, 1.01, 0.1):
        res[round(w, 1)] = round(log_loss(yy[ok], np.clip(w * pm[ok] + (1 - w) * cal[m][ok], eps, 1 - eps)), 4)
    print("blend", m, int(ok.sum()), res)
out = []
for m, yy in y.items():
    yy = yy.values.astype(int)
    ytr, yte = yy[:k], yy[k:]
    rec = {"market": m, "n_test": len(yte)}
    if m in cal:
        rec["calib"] = log_loss(yte, np.clip(cal[m][k:], eps, 1 - eps))
    if m in mk:
        p = d[mk[m]].values[k:]
        ok = ~np.isnan(p)
        rec["market"] = m
        rec["mkt_only"] = log_loss(yte[ok], np.clip(p[ok], eps, 1 - eps)) if ok.sum() > 50 else np.nan
    lr0 = LogisticRegression(max_iter=1000).fit(B[:k], ytr)
    rec["logit_lam"] = log_loss(yte, lr0.predict_proba(B[k:])[:, 1])
    lr1 = LogisticRegression(C=0.5, max_iter=2000).fit(XA[:k], ytr)
    rec["logit_all"] = log_loss(yte, lr1.predict_proba(XA[k:])[:, 1])
    gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=120, min_samples_leaf=40).fit(XG[:k], ytr)
    rec["gbm_all"] = log_loss(yte, gb.predict_proba(XG[k:])[:, 1])
    out.append(rec)
print(pd.DataFrame(out).round(4).to_string(index=False))
