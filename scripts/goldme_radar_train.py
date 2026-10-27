import json
import os
import sys
import urllib.request
from collections import defaultdict, deque
from datetime import date, timedelta

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score
from supabase import create_client

SB_URL = "https://zbwkowqluwuvsnajkuvc.supabase.co"
KEY = os.environ["SB_SERVICE_ROLE_KEY"]
sb = create_client(SB_URL, KEY)
FEATURES = ["lrate", "hgf", "hga", "agf", "aga", "exp_total", "gap", "gold_pair"]
LEAGUE_DAYS = 60
FORM_DAYS = 120
FORM_N = 10
MIN_FORM = 4
EXCL = r"\b(?:U1[0-8]|Baller League|Oberliga|Verbandsliga|Landesliga|Bezirksliga|Kreisliga|Kreisklasse)\b"


def pull(table, select, fn, step=1000):
    out, off = [], 0
    while True:
        r = fn(sb.table(table).select(select)).range(off, off + step - 1).execute().data
        out += r
        if len(r) < step:
            return out
        off += step


since = (date.today() - timedelta(days=300)).isoformat()
cols = "match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,competition_key,competition_name"
rows = pull("fixtures", cols, lambda q: q.gte("match_date", since).not_.is_("ht_home", "null").not_.is_("ft_home", "null")
            .not_.is_("home_team_id", "null").not_.is_("away_team_id", "null").order("match_date").order("fixture_id"))
d = pd.DataFrame(rows)
d["day"] = pd.to_datetime(d.match_date)
d = d[~d.competition_name.fillna("").str.contains(EXCL, case=False, regex=True)].reset_index(drop=True)
for c in ("ht_home", "ht_away", "ft_home", "ft_away"):
    d[c] = d[c].astype(int)
d["gold"] = ((d.ht_home + d.ht_away >= 3) | (d.ht_home >= 4) | (d.ht_away >= 4) | (d.ft_home >= 5) | (d.ft_away >= 5) | (d.ft_home + d.ft_away >= 7)).astype(int)
d["lg"] = d.competition_key.fillna("UNK")
print("rows", len(d), "span", d.day.min().date(), d.day.max().date(), "base", round(d.gold.mean(), 4))

team = defaultdict(deque)
lgq = defaultdict(deque)
gq = deque()
G0 = d.gold.mean()
feat = [None] * len(d)


def lrate_of(lk, cutoff_l, gr):
    q = lgq[lk]
    while q and q[0][0] < cutoff_l:
        q.popleft()
    return (sum(x[1] for x in q) + 30 * gr) / (len(q) + 30)


for day, idx in d.groupby("day").groups.items():
    cutoff_l = day - pd.Timedelta(days=LEAGUE_DAYS)
    cutoff_f = day - pd.Timedelta(days=FORM_DAYS)
    while gq and gq[0][0] < cutoff_l:
        gq.popleft()
    gr = (sum(x[1] for x in gq) / len(gq)) if gq else G0

    def form(t):
        qq = team[t]
        while qq and qq[0][0] < cutoff_f:
            qq.popleft()
        k = list(qq)[-FORM_N:]
        if len(k) < MIN_FORM:
            return None
        lks = [x[4] for x in k]
        lk = max(set(lks), key=lks.count)
        return np.mean([x[1] for x in k]), np.mean([x[2] for x in k]), np.mean([x[3] for x in k]), lk

    cache = {}
    for i in idx:
        r = d.loc[i]
        fh = cache.setdefault(r.home_team_id, form(r.home_team_id))
        fa = cache.setdefault(r.away_team_id, form(r.away_team_id))
        if fh is None or fa is None:
            feat[i] = [np.nan] * len(FEATURES)
            continue
        hgf, hga, hgr, lkh = fh
        agf, aga, agr, lka = fa
        lrate = (lrate_of(lkh, cutoff_l, gr) + lrate_of(lka, cutoff_l, gr)) / 2
        feat[i] = [lrate, hgf, hga, agf, aga, (hgf + aga) / 2 + (agf + hga) / 2, abs((hgf - hga) - (agf - aga)), (hgr + agr) / 2]
    for i in idx:
        r = d.loc[i]
        gold = int(r.gold)
        team[r.home_team_id].append((day, r.ft_home, r.ft_away, gold, r.lg))
        team[r.away_team_id].append((day, r.ft_away, r.ft_home, gold, r.lg))
        lgq[r.lg].append((day, gold))
        gq.append((day, gold))
F = pd.DataFrame(feat, columns=FEATURES)
ok = F.notna().all(axis=1) & (d.day >= pd.Timestamp(date.today() - timedelta(days=210)))
y = d.gold.values
cut_test = pd.Timestamp(date.today() - timedelta(days=45))
tr = ok & (d.day < cut_test - pd.Timedelta(days=7))
te = ok & (d.day >= cut_test)
print("train", int(tr.sum()), "test", int(te.sum()), "test base", round(y[te].mean(), 4))


def fit(mask):
    mu, sd = F[mask].mean(), F[mask].std().replace(0, 1)
    m = LogisticRegression(max_iter=3000, C=0.5).fit(((F[mask] - mu) / sd).values, y[mask])
    return m, mu, sd


m, mu, sd = fit(tr)
p = m.predict_proba(((F[te] - mu) / sd).values)[:, 1]
yt = y[te]
o = np.argsort(-p)
metrics = {"auc": round(float(roc_auc_score(yt, p)), 4), "logloss": round(float(log_loss(yt, p)), 4), "base_logloss": round(float(log_loss(yt, np.full(len(yt), y[tr].mean()))), 4)}
for qq in (0.05, 0.10, 0.20):
    k = max(int(len(p) * qq), 1)
    metrics["prec_top%d" % int(qq * 100)] = round(float(yt[o[:k]].mean()), 3)
print("TEST", json.dumps(metrics))
full = ok & (d.day < d.day.max() + pd.Timedelta(days=1))
m2, mu2, sd2 = fit(full)
model = {
    "features": FEATURES,
    "mean": {f: round(float(mu2[f]), 6) for f in FEATURES},
    "std": {f: round(float(sd2[f]), 6) for f in FEATURES},
    "coef": {f: round(float(c), 6) for f, c in zip(FEATURES, m2.coef_[0])},
    "intercept": round(float(m2.intercept_[0]), 6),
    "n_train": int(full.sum()),
    "base_rate": round(float(y[full].mean()), 4),
    "league_days": LEAGUE_DAYS, "form_days": FORM_DAYS, "form_n": FORM_N, "min_form": MIN_FORM,
    "test": metrics,
}
print("MODEL", json.dumps(model))

if "--probe" in sys.argv:
    today = (date.today() + timedelta(days=0)).isoformat()
    up = sb.table("fixtures").select("fixture_id,match_date,home_team_id,away_team_id,ft_home,competition_key,kickoff_at", count="exact").gte("match_date", today).is_("ft_home", "null").limit(5).execute()
    print("upcoming fixtures in table (match_date >= today, ft null):", up.count)
    print("sample", json.dumps(up.data[:2], default=str))
    sn = sb.table("suggest_snapshot").select("snapshot_date,payload").order("snapshot_date", desc=True).limit(1).execute().data
    if sn:
        fx = [m_["fixture_id"] for sl in sn[0]["payload"].get("slots", []) for m_ in sl.get("matches", []) if m_.get("fixture_id")]
        print("snapshot", sn[0]["snapshot_date"], "matches", len(fx))
        inf = 0
        for i in range(0, len(fx), 100):
            inf += sb.table("fixtures").select("fixture_id", count="exact").in_("fixture_id", fx[i:i + 100]).limit(1).execute().count
        print("snapshot fixture_ids found in fixtures table:", inf)
