import os, json
import pandas as pd
import numpy as np
from supabase import create_client
from sklearn.ensemble import GradientBoostingClassifier
from sklearn.metrics import roc_auc_score, average_precision_score

df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home","ht_away","ft_home","ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date","ht_home","ht_away","ft_home","ft_away"])
df = df[df["competition_key"].notna()]
df = df[df["match_date"] >= "2019-01-01"].sort_values("match_date").reset_index(drop=True)
print(f"{len(df)} fixtures (2019+)")

Q, R, mu0, sig0 = 0.15, 1.8, 1.2, 0.6
def kupd(mu, sig, z):
    sp = sig + Q
    K = sp / (sp + R)
    return mu + K*(z-mu), (1-K)*sp

st_ft = {}; st_ht = {}
rows = []
for _, fx in df.iterrows():
    h, a = str(fx["home_team_id"]), str(fx["away_team_id"])
    hf = st_ft.get(h, (mu0, sig0)); af = st_ft.get(a, (mu0, sig0))
    hh = st_ht.get(h, (0.5, 0.4)); ah = st_ht.get(a, (0.5, 0.4))
    m = fx["match_date"].month
    rows.append({
        "y": fx["match_date"].year,
        "h_ft_mu": hf[0], "h_ft_sig": hf[1], "a_ft_mu": af[0], "a_ft_sig": af[1],
        "h_ht_mu": hh[0], "h_ht_sig": hh[1], "a_ht_mu": ah[0], "a_ht_sig": ah[1],
        "p_e": int(m in (8,9,10)), "p_m": int(m in (11,12,1,2)), "p_l": int(m in (3,4,5,6,7)),
        "ft_t": fx["ft_home"]+fx["ft_away"], "ft_m": max(fx["ft_home"], fx["ft_away"]),
        "ht_t": fx["ht_home"]+fx["ht_away"], "ht_m": max(fx["ht_home"], fx["ht_away"]),
    })
    st_ft[h] = kupd(hf[0], hf[1], fx["ft_home"]); st_ft[a] = kupd(af[0], af[1], fx["ft_away"])
    st_ht[h] = kupd(hh[0], hh[1], fx["ht_home"]); st_ht[a] = kupd(ah[0], ah[1], fx["ht_away"])

f = pd.DataFrame(rows)
f["mu_ft_sum"] = f["h_ft_mu"]+f["a_ft_mu"]
f["mu_ft_diff"] = (f["h_ft_mu"]-f["a_ft_mu"]).abs()
f["mu_ft_max"] = f[["h_ft_mu","a_ft_mu"]].max(axis=1)
f["sig_ft_sum"] = f["h_ft_sig"]+f["a_ft_sig"]
f["mu_ht_sum"] = f["h_ht_mu"]+f["a_ht_mu"]
f["mu_ht_max"] = f[["h_ht_mu","a_ht_mu"]].max(axis=1)
f["sig_ht_sum"] = f["h_ht_sig"]+f["a_ht_sig"]
f["y_7ft"]=(f["ft_t"]>=7).astype(int); f["y_oft"]=(f["ft_m"]>=5).astype(int)
f["y_3ht"]=(f["ht_t"]>=3).astype(int); f["y_oht"]=(f["ht_m"]>=4).astype(int)

FC = ["h_ft_mu","h_ft_sig","a_ft_mu","a_ft_sig","h_ht_mu","h_ht_sig","a_ht_mu","a_ht_sig",
      "mu_ft_sum","mu_ft_diff","mu_ft_max","sig_ft_sum","mu_ht_sum","mu_ht_max","sig_ht_sum",
      "p_e","p_m","p_l"]

res = {}
for m, tgt in [("7ft","y_7ft"),("oft","y_oft"),("3ht","y_3ht"),("oht","y_oht")]:
    lifts = []
    for ty in [2022, 2023, 2024, 2025]:
        tr = f[f["y"] < ty]; te = f[f["y"] == ty]
        if len(tr) < 2000: continue
        pr = tr[tgt].mean()
        w = np.where(tr[tgt].values==1, min(int((1-pr)/pr), 200), 1.0)
        c = GradientBoostingClassifier(n_estimators=200, max_depth=3, learning_rate=0.05, subsample=0.8, random_state=42)
        c.fit(tr[FC].values, tr[tgt].values, sample_weight=w)
        p = c.predict_proba(te[FC].values)[:,1]
        br = te[tgt].mean()
        top5 = p >= np.quantile(p, 0.95)
        lifts.append(te[tgt].values[top5].mean()/br if br>0 else 0)
    if lifts:
        res[m] = {"mean_lift5": round(float(np.mean(lifts)),2), "min_lift5": round(float(min(lifts)),2)}
        print(f"{m}: mean {res[m]['mean_lift5']}x, min {res[m]['min_lift5']}x")
print(json.dumps(res))