import os
from collections import defaultdict, deque
from datetime import date, timedelta

import numpy as np
import pandas as pd
from supabase import create_client
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

sb = create_client("https://zbwkowqluwuvsnajkuvc.supabase.co", os.environ["SB_SERVICE_ROLE_KEY"])
since = (date.today() - timedelta(days=270)).isoformat()
cols = "match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,tier,country,competition_key,competition_name"
rows, off = [], 0
while True:
    r = (sb.table("fixtures").select(cols).gte("match_date", since).not_.is_("ht_home", "null").not_.is_("ft_home", "null")
         .not_.is_("home_team_id", "null").not_.is_("away_team_id", "null").order("match_date").order("fixture_id")
         .range(off, off + 999).execute().data)
    rows += r
    if len(r) < 1000:
        break
    off += 1000
d = pd.DataFrame(rows)
d["day"] = pd.to_datetime(d.match_date)
d = d[~d.competition_name.fillna("").str.contains(r"\b(?:U1[0-8]|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\b", case=False, regex=True)].reset_index(drop=True)
for c in ("ht_home", "ht_away", "ft_home", "ft_away"):
    d[c] = d[c].astype(int)
d["gold"] = ((d.ht_home + d.ht_away >= 3) | (d.ht_home >= 4) | (d.ht_away >= 4) | (d.ft_home >= 5) | (d.ft_away >= 5) | (d.ft_home + d.ft_away >= 7)).astype(int)
d["lg"] = d.competition_key.fillna("UNK")
print("rows", len(d), "span", d.day.min().date(), d.day.max().date(), "base gold", round(d.gold.mean(), 4))

K = 10
hist = defaultdict(lambda: deque(maxlen=K))
lg_n, lg_g = defaultdict(float), defaultdict(float)
G0 = d.gold.mean()
feat = []
for r in d.itertuples(index=False):
    h, a = r.home_team_id, r.away_team_id
    hh, ha = hist[h], hist[a]
    ln, lgg = lg_n[r.lg], lg_g[r.lg]
    lrate = (lgg + 30 * G0) / (ln + 30)

    def agg(q):
        if not q:
            return (np.nan,) * 5
        gf = np.mean([x[0] for x in q])
        ga = np.mean([x[1] for x in q])
        gr = np.mean([x[2] for x in q])
        return len(q), gf, ga, gr, np.mean([x[3] for x in q])

    nh, hgf, hga, hgr, htot = agg(hh)
    na, agf, aga, agr, atot = agg(ha)
    feat.append((lrate, ln, nh, hgf, hga, hgr, htot, na, agf, aga, agr, atot))
    gold = r.gold
    hist[h].append((r.ft_home, r.ft_away, gold, r.ft_home + r.ft_away))
    hist[a].append((r.ft_away, r.ft_home, gold, r.ft_home + r.ft_away))
    lg_n[r.lg] += 1
    lg_g[r.lg] += gold
F = pd.DataFrame(feat, columns=["lrate", "ln", "nh", "hgf", "hga", "hgr", "htot", "na", "agf", "aga", "agr", "atot"])
F["exp_total"] = (F.hgf + F.aga) / 2 + (F.agf + F.hga) / 2
F["gap"] = np.abs((F.hgf - F.hga) - (F.agf - F.aga))
F["gold_pair"] = (F.hgr + F.agr) / 2
F["tot_pair"] = (F.htot + F.atot) / 2
F["maxgf_ga"] = np.maximum(F.hgf + F.aga, F.agf + F.hga)
F["dow"] = d.day.dt.dayofweek
F["month"] = d.day.dt.month
F["tier"] = d.tier.map({"major": 0, "minor": 1, "junk": 2}).fillna(1)
y = d.gold.values
ok = (F.nh >= 5) & (F.na >= 5) & (F.ln >= 40)
cut_test = pd.Timestamp(date.today() - timedelta(days=45))
cut_train = cut_test - pd.Timedelta(days=7)
tr = ok & (d.day < cut_train)
te = ok & (d.day >= cut_test)
print("train", int(tr.sum()), "test", int(te.sum()), "test base rate", round(y[te].mean(), 4))


ENG = d.competition_name.fillna("").str.contains(r"Isthmian|Southern League|Northern Premier|FA Trophy|FA Cup: Qualification|FA Vase|Combined Counties|Spartan|Wessex|United Counties|Eastern Counties|Hellenic|Western League|North West Counties|Northern Counties|Midland League|Essex Senior|Kent League|Sussex County|Northern League", case=False, regex=True).values


def report(name, p, mask=None):
    sel = np.ones(te.sum(), dtype=bool) if mask is None else mask
    p = p[sel]
    yt = y[te][sel]
    o = np.argsort(-p)
    n = len(p)
    out = {"model": name, "n": int(len(yt)), "base": round(float(yt.mean()), 3), "logloss": round(log_loss(yt, np.clip(p, 1e-4, 1 - 1e-4)), 4), "auc": round(roc_auc_score(yt, p), 4)}
    for q in (0.05, 0.10, 0.20):
        k = max(int(n * q), 1)
        out["prec@top%d%%" % int(q * 100)] = round(float(yt[o[:k]].mean()), 3)
    print(out)


report("A league base rate only", F.lrate[te].values)
cols_B = ["lrate", "hgr", "agr", "gold_pair"]
cols_C = cols_B + ["hgf", "hga", "agf", "aga", "exp_total", "gap", "tot_pair", "maxgf_ga"]
cols_D = cols_C + ["tier", "month", "dow"]
for name, cols in (("B + team gold rate", cols_B), ("C + goals attack/defense", cols_C), ("D + tier/calendar", cols_D)):
    X = F[cols].fillna(F[cols].mean())
    gb = HistGradientBoostingClassifier(max_depth=4, learning_rate=0.05, max_iter=250, min_samples_leaf=60, l2_regularization=1.0)
    gb.fit(X[tr], y[tr])
    report("GBM " + name, gb.predict_proba(X[te])[:, 1])
X = F[cols_C].fillna(F[cols_C].mean())
lr = LogisticRegression(max_iter=2000, C=0.5).fit((X[tr] - X[tr].mean()) / X[tr].std(), y[tr])
pl = lr.predict_proba((X[te] - X[tr].mean()) / X[tr].std())[:, 1]
report("LOGIT C", pl)
ne = ~ENG[te.values]
print("--- only NOT English low-league matches")
report("A league base rate only", F.lrate[te].values, ne)
report("LOGIT C", pl, ne)
for name, cs in (("LOGIT exp_total+gap+lrate", ["lrate", "exp_total", "gap"]), ("LOGIT exp_total only", ["exp_total"])):
    X2 = F[cs].fillna(F[cs].mean())
    l2 = LogisticRegression(max_iter=2000).fit((X2[tr] - X2[tr].mean()) / X2[tr].std(), y[tr])
    pp = l2.predict_proba((X2[te] - X2[tr].mean()) / X2[tr].std())[:, 1]
    report(name + " (all)", pp)
    report(name + " (not eng)", pp, ne)
