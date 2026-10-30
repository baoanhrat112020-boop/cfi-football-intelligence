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

base = {}
evaluate(base, 0.5, "V0 current")
for rt in (0.40, 0.44, 0.47):
    evaluate(base, rt, "V0 ratio")
for k in (3, 5, 10, 20):
    evaluate({"k": k}, 0.5, "shrink k=%d global" % k)
for k in (5, 10, 20):
    evaluate({"k": k, "tgt": "league"}, 0.5, "shrink k=%d league" % k)
for sc in (0.9, 0.95, 1.05):
    evaluate({"scale": sc}, 0.5, "scale %.2f" % sc)
evaluate({"mult": True}, 0.5, "multiplicative")
evaluate({"mult": True, "k": 10, "tgt": "league"}, 0.5, "mult+k10+league")
evaluate({"k": 10, "tgt": "league", "scale": 0.95}, 0.5, "k10 league scale.95")

ll, n, hi = evaluate(base, 0.5, "V0 again")
print("V0 high-confidence (p>=0.7) test calibration:")
for k, (c, y, sp) in hi.items():
    if c: print("  %s n=%d hit=%.1f%% pred=%.1f%%" % (k, c, 100 * y / c, 100 * sp / c))
ht_tot = [(f["r"]["ht_home"] + f["r"]["ht_away"], f["r"]["ft_home"] + f["r"]["ft_away"]) for f in tests if f["r"]["ht_home"] is not None]
print("actual HT/FT goal ratio:", round(sum(a for a, b in ht_tot) / max(sum(b for a, b in ht_tot), 1), 4))
