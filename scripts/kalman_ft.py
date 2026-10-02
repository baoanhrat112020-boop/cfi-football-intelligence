import os, json, uuid
import pandas as pd
import numpy as np
from datetime import datetime
from supabase import create_client
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.metrics import roc_auc_score, average_precision_score

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")

print("Loading fixtures...")
df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home","ht_away","ft_home","ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date","ht_home","ht_away","ft_home","ft_away"])
df = df[df["competition_key"].notna()].copy()
df = df.sort_values("match_date").reset_index(drop=True)
print(f"  {len(df)} fixtures")

# Kalman 1D
Q = 0.15   # process noise
R = 1.8    # observation noise
mu0 = 1.2
sig0 = 0.6

def kalman_update(mu, sig, z):
    mu_pred = mu
    sig_pred = sig + Q
    K = sig_pred / (sig_pred + R)
    return mu_pred + K*(z - mu_pred), (1-K)*sig_pred

# Two Kalman states per team: FT scored, HT scored
state_ft = {}
state_ht = {}

features = []
print("Running Kalman filter over all fixtures...")
for i, fx in df.iterrows():
    h = str(fx["home_team_id"]); a = str(fx["away_team_id"])
    h_ft_mu, h_ft_sig = state_ft.get(h, (mu0, sig0))
    a_ft_mu, a_ft_sig = state_ft.get(a, (mu0, sig0))
    h_ht_mu, h_ht_sig = state_ht.get(h, (0.5, 0.4))
    a_ht_mu, a_ht_sig = state_ht.get(a, (0.5, 0.4))

    features.append({
        "fixture_id": fx["fixture_id"],
        "match_date": fx["match_date"],
        "year": fx["match_date"].year,
        "competition_key": fx["competition_key"],
        "month": fx["match_date"].month,
        "h_ft_mu": h_ft_mu, "h_ft_sig": h_ft_sig,
        "a_ft_mu": a_ft_mu, "a_ft_sig": a_ft_sig,
        "h_ht_mu": h_ht_mu, "h_ht_sig": h_ht_sig,
        "a_ht_mu": a_ht_mu, "a_ht_sig": a_ht_sig,
        "ft_total": fx["ft_home"]+fx["ft_away"],
        "ft_max": max(fx["ft_home"], fx["ft_away"]),
        "ht_total": fx["ht_home"]+fx["ht_away"],
        "ht_max": max(fx["ht_home"], fx["ht_away"]),
    })

    # Update FT state
    new_h_ft_mu, new_h_ft_sig = kalman_update(h_ft_mu, h_ft_sig, fx["ft_home"])
    new_a_ft_mu, new_a_ft_sig = kalman_update(a_ft_mu, a_ft_sig, fx["ft_away"])
    state_ft[h] = (new_h_ft_mu, new_h_ft_sig)
    state_ft[a] = (new_a_ft_mu, new_a_ft_sig)

    # Update HT state
    new_h_ht_mu, new_h_ht_sig = kalman_update(h_ht_mu, h_ht_sig, fx["ht_home"])
    new_a_ht_mu, new_a_ht_sig = kalman_update(a_ht_mu, a_ht_sig, fx["ht_away"])
    state_ht[h] = (new_h_ht_mu, new_h_ht_sig)
    state_ht[a] = (new_a_ht_mu, new_a_ht_sig)

    if i % 50000 == 0 and i > 0:
        print(f"  processed {i}/{len(df)}")

feat_df = pd.DataFrame(features)
feat_df["mu_ft_sum"] = feat_df["h_ft_mu"] + feat_df["a_ft_mu"]
feat_df["mu_ft_diff"] = (feat_df["h_ft_mu"] - feat_df["a_ft_mu"]).abs()
feat_df["mu_ft_max"] = feat_df[["h_ft_mu","a_ft_mu"]].max(axis=1)
feat_df["sig_ft_sum"] = feat_df["h_ft_sig"] + feat_df["a_ft_sig"]
feat_df["mu_ht_sum"] = feat_df["h_ht_mu"] + feat_df["a_ht_mu"]
feat_df["mu_ht_max"] = feat_df[["h_ht_mu","a_ht_mu"]].max(axis=1)
feat_df["sig_ht_sum"] = feat_df["h_ht_sig"] + feat_df["a_ht_sig"]

feat_df["phase_early"] = feat_df["month"].isin([8,9,10]).astype(int)
feat_df["phase_mid"]   = feat_df["month"].isin([11,12,1,2]).astype(int)
feat_df["phase_late"]  = feat_df["month"].isin([3,4,5,6,7]).astype(int)

feat_df["y_7ft"] = (feat_df["ft_total"] >= 7).astype(int)
feat_df["y_oft"] = (feat_df["ft_max"] >= 5).astype(int)
feat_df["y_3ht"] = (feat_df["ht_total"] >= 3).astype(int)
feat_df["y_oht"] = (feat_df["ht_max"] >= 4).astype(int)

print(f"Feature matrix: {feat_df.shape}")

# Walk-forward for each market
FEAT_COLS = ["h_ft_mu","h_ft_sig","a_ft_mu","a_ft_sig",
             "h_ht_mu","h_ht_sig","a_ht_mu","a_ht_sig",
             "mu_ft_sum","mu_ft_diff","mu_ft_max","sig_ft_sum",
             "mu_ht_sum","mu_ht_max","sig_ht_sum",
             "phase_early","phase_mid","phase_late"]

def walk_forward(target):
    rows = []
    for ty in range(2018, 2027):
        tr = feat_df[feat_df["year"] < ty]
        te = feat_df[feat_df["year"] == ty]
        if len(tr) < 2000 or len(te) < 100: continue
        X_tr = tr[FEAT_COLS].values; y_tr = tr[target].values
        X_te = te[FEAT_COLS].values; y_te = te[target].values
        pos_rate = y_tr.mean()
        w = np.where(y_tr == 1, min(int((1-pos_rate)/pos_rate), 200), 1.0)
        clf = GradientBoostingClassifier(n_estimators=200, max_depth=3,
            learning_rate=0.05, subsample=0.8, random_state=42)
        clf.fit(X_tr, y_tr, sample_weight=w)
        p = clf.predict_proba(X_te)[:,1]
        br = y_te.mean()
        top5 = p >= np.quantile(p, 0.95)
        rows.append({
            "year": ty, "auc": roc_auc_score(y_te, p),
            "pr_auc": average_precision_score(y_te, p),
            "lift5": y_te[top5].mean()/br if br>0 else 0,
        })
    return pd.DataFrame(rows)

results = {}
for market, target in [("7ft","y_7ft"), ("oft","y_oft"), ("3ht","y_3ht"), ("oht","y_oht")]:
    print(f"\n=== {market.upper()} (Kalman FT) ===")
    wf = walk_forward(target)
    if len(wf):
        print(wf.to_string(index=False))
        print(f"  mean AUC: {wf['auc'].mean():.4f} | mean PR-AUC: {wf['pr_auc'].mean():.4f} | mean lift@5%: {wf['lift5'].mean():.3f}x")
        results[market] = {
            "mean_auc": float(wf["auc"].mean()),
            "mean_pr_auc": float(wf["pr_auc"].mean()),
            "mean_lift5": float(wf["lift5"].mean()),
            "min_lift5": float(wf["lift5"].min()),
        }

print("\n=== SUMMARY ===")
print(json.dumps(results, indent=2))