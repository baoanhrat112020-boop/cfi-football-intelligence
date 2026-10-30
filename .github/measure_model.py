import os, json, urllib.request, collections, math, bisect
from datetime import date, timedelta
U = "https://zbwkowqluwuvsnajkuvc.supabase.co/rest/v1/"
K = os.environ["K"]
H = {"apikey": K, "Authorization": "Bearer " + K}

def get(path):
    req = urllib.request.Request(U + path, headers=H)
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.loads(r.read())

def pages(path, size=1000, cap=400):
    out = []
    for i in range(cap):
        try:
            rows = get(path + "&limit=%d&offset=%d" % (size, i * size))
        except Exception as e:
            print("ERR", str(e)[:100]); break
        out += rows
        if len(rows) < size: break
    return out

since = (date.today() - timedelta(days=700)).isoformat()
fx = pages("fixtures?select=home_team_id,away_team_id,match_date,ft_home,ft_away,ht_home,ht_away,competition_key&ft_home=not.is.null&home_team_id=not.is.null&away_team_id=not.is.null&match_date=gte." + since + "&order=match_date.asc,fixture_id.asc")
print("fixtures", len(fx))
fx.sort(key=lambda r: r["match_date"])
TEST_DAYS = 60
cut = (date.today() - timedelta(days=TEST_DAYS)).isoformat()

home_m = collections.defaultdict(list)
away_m = collections.defaultdict(list)
cnt = collections.Counter()
lg_sum = collections.defaultdict(lambda: [0, 0.0, 0.0])
g_sum = [0, 0.0, 0.0]
tests = []

def pois(l, k):
    return math.exp(-l) * l ** k / math.factorial(k)

def dmean(lst, dec=0.94, cap=30):
    s = lst[-cap:][::-1]
    w = [dec ** i for i in range(len(s))]
    sw = sum(w)
    return sum(a * b for a, b in zip(w, [x[0] for x in s])) / sw, sum(a * b for a, b in zip(w, [x[1] for x in s])) / sw

def feats(h, a, lk):
    hm = home_m[h]; am = away_m[a]
    return {"n_h": cnt[h], "n_a": cnt[a], "hh": dmean(hm) if hm else None, "aa": dmean(am) if am else None,
            "lg": tuple(lg_sum[lk]), "g": tuple(g_sum)}

i = 0
for r in fx:
    h = str(r["home_team_id"]); a = str(r["away_team_id"]); lk = r["competition_key"] or "?"
    if r["match_date"] >= cut:
        f = feats(h, a, lk); f["r"] = r; tests.append(f)
    hm_ = (r["ft_home"], r["ft_away"]); am_ = (r["ft_away"], r["ft_home"])
    home_m[h].append(hm_); away_m[a].append(am_)
    cnt[h] += 1; cnt[a] += 1
    s = lg_sum[lk]; s[0] += 1; s[1] += r["ft_home"]; s[2] += r["ft_away"]
    g_sum[0] += 1; g_sum[1] += r["ft_home"]; g_sum[2] += r["ft_away"]
print("tests", len(tests))

def means(f, mode, kmin=15):
    gn, gh, ga = f["g"]; gmh, gma = gh / gn, ga / gn
    ln, lh_, la_ = f["lg"]
    if mode == "league" and ln >= kmin:
        w = ln / (ln + 30.0)
        return w * lh_ / ln + (1 - w) * gmh, w * la_ / ln + (1 - w) * gma
    return gmh, gma

def lambdas(f, v):
    mh, ma = means(f, v.get("tgt", "global"))
    k = v.get("k"); 
    def wt(n):
        return min(1.0, n / 10.0) if k is None else n / (n + k)
    wh, wa = wt(f["n_h"]), wt(f["n_a"])
    hh = f["hh"] or (mh, ma); aa = f["aa"] or (ma, mh)
    att_h = wh * hh[0] + (1 - wh) * mh
    def_h = wh * hh[1] + (1 - wh) * ma
    att_a = wa * aa[0] + (1 - wa) * ma
    def_a = wa * aa[1] + (1 - wa) * mh
    if v.get("mult"):
        lh = mh * (att_h / mh) * (def_a / mh) ** 1.0
        la = ma * (att_a / ma) * (def_h / ma) ** 1.0
    else:
        lh = (att_h + def_a) / 2.0
        la = (att_a + def_h) / 2.0
    s = v.get("scale", 1.0)
    c = v.get("reg")
    if c is not None:
        lh = mh + c * (lh - mh); la = ma + c * (la - ma)
    return max(lh * s, 0.05), max(la * s, 0.05)

def probs(lh, la, ratio):
    lt = lh + la
    pm = {}
    cdf = lambda l, k: sum(pois(l, j) for j in range(k + 1))
    for line in (2.0, 2.5, 3.0, 3.5):
        pm["o%g" % line] = 1 - cdf(lt, int(math.floor(line)))
    pm["btts"] = (1 - math.exp(-lh)) * (1 - math.exp(-la))
    ph = lt * ratio
    pm["o05ht"] = 1 - math.exp(-ph)
    pm["o15ht"] = 1 - cdf(ph, 1)
    hw = 0.0
    for x in range(0, 12):
        px = pois(lh, x)
        hw += px * cdf(la, x - 1) if x > 0 else 0
    pm["hw"] = hw
    return pm

def outcomes(r):
    t = r["ft_home"] + r["ft_away"]
    o = {"o2": t > 2, "o2.5": t > 2.5, "o3": t > 3, "o3.5": t > 3.5, "btts": r["ft_home"] > 0 and r["ft_away"] > 0, "hw": r["ft_home"] > r["ft_away"]}
    if r["ht_home"] is not None:
        th = r["ht_home"] + r["ht_away"]
        o["o05ht"] = th >= 1; o["o15ht"] = th >= 2
    return o

def evaluate(v, ratio=0.5, label=""):
    ll = collections.defaultdict(float); br = collections.defaultdict(float); n = collections.Counter()
    hi = collections.defaultdict(lambda: [0, 0, 0.0])
    for f in tests:
        lh, la = lambdas(f, v); pm = probs(lh, la, ratio); o = outcomes(f["r"])
        for k, p in pm.items():
            if k not in o: continue
            p = min(max(p, 1e-4), 1 - 1e-4); y = 1 if o[k] else 0
            ll[k] += -(y * math.log(p) + (1 - y) * math.log(1 - p)); br[k] += (p - y) ** 2; n[k] += 1
            if p >= 0.7:
                hi[k][0] += 1; hi[k][1] += y; hi[k][2] += p
    keys = ["o2.5", "btts", "hw", "o3.5", "o05ht", "o15ht"]
    print("%-34s ratio=%.2f " % (label, ratio) + " ".join("%s=%.4f" % (k, ll[k] / n[k]) for k in keys if n[k]) + " | sum=%.4f" % sum(ll[k] / n[k] for k in keys if n[k]))
    return ll, n, hi


def collect(v, ratio=0.5):
    rows = []
    for f in tests:
        lh, la = lambdas(f, v); pm = probs(lh, la, ratio); o = outcomes(f["r"])
        for k, p in pm.items():
            if k in o: rows.append((f["r"]["match_date"], k, min(max(p, 1e-4), 1 - 1e-4), 1 if o[k] else 0))
    return rows

def logloss(rows):
    return sum(-(y * math.log(p) + (1 - y) * math.log(1 - p)) for _, _, p, y in rows) / max(len(rows), 1)

def lg(p): return math.log(p / (1 - p))
def sg(x): return 1 / (1 + math.exp(-x))

def fit_platt(pts):
    a, b = 1.0, 0.0
    for _ in range(400):
        ga = gb = 0.0; ha = hb = hab = 1e-9
        for p, y in pts:
            z = lg(p); q = sg(a * z + b); d = q - y; w = q * (1 - q)
            ga += d * z; gb += d; ha += w * z * z; hb += w; hab += w * z
        det = ha * hb - hab * hab
        if abs(det) < 1e-12: break
        da = (ga * hb - gb * hab) / det; db = (gb * ha - ga * hab) / det
        a -= da; b -= db
        if abs(da) + abs(db) < 1e-8: break
    return a, b

split = (date.today() - timedelta(days=TEST_DAYS - 40)).isoformat()
KEYS = ["o2.5", "btts", "hw", "o3.5", "o05ht", "o15ht"]
def report(v, ratio, label):
    rows = [r for r in collect(v, ratio) if r[1] in KEYS]
    tr = [r for r in rows if r[0] < split]; te = [r for r in rows if r[0] >= split]
    raw = {k: logloss([r for r in te if r[1] == k]) for k in KEYS}
    cal = {}; par = {}
    for k in KEYS:
        a, b = fit_platt([(r[2], r[3]) for r in tr if r[1] == k]); par[k] = (round(a, 3), round(b, 3))
        cal[k] = logloss([(r[0], r[1], sg(a * lg(r[2]) + b), r[3]) for r in te if r[1] == k])
    print("%-26s RAW  " % label + " ".join("%s=%.4f" % (k, raw[k]) for k in KEYS) + " sum=%.4f" % sum(raw.values()))
    print("%-26s PLATT" % label + " ".join("%s=%.4f" % (k, cal[k]) for k in KEYS) + " sum=%.4f" % sum(cal.values()))
    print("   platt params(train->test):", par)
    return rows

report({"k": 10}, 0.47, "k10 global")
for c in (0.9, 0.85, 0.8):
    report({"k": 10, "reg": c}, 0.47, "k10 reg=%.2f" % c)
rows = report({"k": 10}, 0.47, "k10 global (again)")
allp = {}
for k in KEYS:
    allp[k] = fit_platt([(r[2], r[3]) for r in rows if r[1] == k])
print("FINAL platt all-test params:", {k: (round(a, 4), round(b, 4)) for k, (a, b) in allp.items()})
for k in KEYS:
    hi = [r for r in rows if r[1] == k and r[2] >= 0.7]
    if hi:
        a, b = allp[k]
        print("  %s p>=.7 n=%d hit=%.1f%% raw_pred=%.1f%% cal_pred=%.1f%%" % (k, len(hi), 100 * sum(r[3] for r in hi) / len(hi), 100 * sum(r[2] for r in hi) / len(hi), 100 * sum(sg(a * lg(r[2]) + b) for r in hi) / len(hi)))
