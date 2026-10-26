import os
import numpy as np
import pandas as pd
from scipy.stats import poisson
from supabase import create_client
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import log_loss

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
cols = "kickoff_at,lambda_home_ft,lambda_away_ft,ht_home,ht_away,ft_home,ft_away"
rows, off = [], 0
while True:
    r = sb.table("suggest_pick_log").select(cols).not_.is_("ft_home", "null").not_.is_("ht_home", "null").order("kickoff_at").range(off, off + 999).execute().data
    rows += r
    if len(r) < 1000:
        break
    off += 1000
d = pd.DataFrame(rows).sort_values("kickoff_at").reset_index(drop=True)
h, a = d.lambda_home_ft.values.astype(float), d.lambda_away_ft.values.astype(float)
t = h + a
lc = 3.2 ** 0.4 * t ** 0.6
hc, ac = h * lc / t, a * lc / t
G = np.arange(0, 15)


def grid(x, y):
    return poisson.pmf(G[None, :, None], x[:, None, None]) * poisson.pmf(G[None, None, :], y[:, None, None])


def base(x, y):
    P = grid(x, y)
    i, j = np.meshgrid(G, G, indexing="ij")
    tot = i + j
    return {
        "home_win_ft": (P * (i > j)).sum((1, 2)),
        "over25_ft": (P * (tot >= 3)).sum((1, 2)),
        "over35_ft": (P * (tot >= 4)).sum((1, 2)),
        "btts": (P * ((i > 0) & (j > 0))).sum((1, 2)),
    }


raw, cal = base(h, a), base(hc, ac)
y = {
    "home_win_ft": (d.ft_home > d.ft_away).values,
    "over25_ft": (d.ft_home + d.ft_away >= 3).values,
    "over35_ft": (d.ft_home + d.ft_away >= 4).values,
    "btts": ((d.ft_home > 0) & (d.ft_away > 0)).values,
    "home_win_ht": (d.ht_home > d.ht_away).values,
    "over15_ht": (d.ht_home + d.ht_away >= 2).values,
}
X = np.column_stack([np.log(h + 0.05), np.log(a + 0.05), np.log(t + 0.1), h - a])
n = len(d)
k = int(n * 0.7)
print("rows", n, "train", k, "test", n - k)
eps = 1e-6
out = []
for m, yy in y.items():
    yy = yy.astype(int)
    ytr, yte = yy[:k], yy[k:]
    rec = {"market": m, "base_rate": round(yte.mean(), 4)}
    if m in raw:
        rec["raw"] = log_loss(yte, np.clip(raw[m][k:], eps, 1 - eps))
        rec["calib"] = log_loss(yte, np.clip(cal[m][k:], eps, 1 - eps))
    rec["const"] = log_loss(yte, np.full(len(yte), ytr.mean()))
    lr = LogisticRegression(C=1.0, max_iter=1000).fit(X[:k], ytr)
    rec["logit"] = log_loss(yte, lr.predict_proba(X[k:])[:, 1])
    gb = HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=150, min_samples_leaf=50).fit(X[:k], ytr)
    rec["gbm"] = log_loss(yte, gb.predict_proba(X[k:])[:, 1])
    out.append(rec)
print(pd.DataFrame(out).round(4).to_string(index=False))
