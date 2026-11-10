import os, sys, json, math, bisect, collections, urllib.request, unicodedata, re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cfi_tier import classify_tier

PRIOR = {"h1": (0.676, 0.547), "ft": (1.562, 1.279)}
ALPHA = {"h1": 6.0, "ft": 13.8}
CLIP = {"h1": (0.12, 0.82), "ft": (0.35, 0.97)}
CAP = {"h1": 0.65, "ft": 0.85}
K_CUR, K_PREV, K_TIER = 120.0, 100.0, 300.0
K_ATT, K_DEF = 8.0, 10.0
HALF_LIFE = 240.0
H2H_DAYS = 8 * 365
H2H_HALF = 4 * 365.0
VN = ZoneInfo("Asia/Ho_Chi_Minh")

def norm_name(s):
    s = unicodedata.normalize("NFD", s or "")
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    return re.sub(r"[^a-z0-9]+", "", s)

def name_key(home, away, kickoff_iso):
    d = datetime.fromisoformat(kickoff_iso.replace("Z", "+00:00")).astimezone(VN).strftime("%Y-%m-%d")
    return norm_name(home) + "|" + norm_name(away) + "|" + d

def tier_of(key, prod_tier):
    k = key or ""
    if k.startswith("livescore:"):
        return "major" if classify_tier(k) == "major" else "minor"
    return "major" if prod_tier == "major" else "minor"

class Api:
    def __init__(self, url, key):
        self.url = url.rstrip("/") + "/rest/v1/"
        self.h = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json"}

    def get(self, path):
        r = urllib.request.Request(self.url + path, headers=self.h)
        with urllib.request.urlopen(r, timeout=120) as x:
            return json.loads(x.read())

    def pages(self, path, size=1000):
        out, off = [], 0
        while True:
            rows = self.get(path + "&limit=%d&offset=%d" % (size, off))
            out += rows
            if len(rows) < size:
                return out
            off += size

    def rpc(self, name, body):
        r = urllib.request.Request(self.url + "rpc/" + name, headers=self.h, data=json.dumps(body).encode(), method="POST")
        with urllib.request.urlopen(r, timeout=120) as x:
            return json.loads(x.read())

class Window:
    def __init__(self):
        self.d = []
        self.c = [[0] for _ in range(5)]

    def add(self, ordn, vals):
        self.d.append(ordn)
        self.c[0].append(self.c[0][-1] + 1)
        for i in range(4):
            self.c[i + 1].append(self.c[i + 1][-1] + vals[i])

    def sums(self, lo, hi):
        a = bisect.bisect_left(self.d, lo)
        b = bisect.bisect_left(self.d, hi)
        return [self.c[i][b] - self.c[i][a] for i in range(5)]

class Model:
    def __init__(self):
        self.leagues = collections.defaultdict(Window)
        self.tiers = collections.defaultdict(Window)
        self.hist = collections.defaultdict(lambda: collections.deque(maxlen=20))
        self.home = collections.defaultdict(lambda: collections.deque(maxlen=10))
        self.away = collections.defaultdict(lambda: collections.deque(maxlen=10))
        self.games = collections.Counter()
        self.h2h = collections.defaultdict(list)
        self.elo = collections.defaultdict(lambda: 1500.0)
        self.cache = {}
        self.cache_ord = None

    def rate(self, lg, tier, ev, tf):
        if self.cache_ord != ev:
            self.cache, self.cache_ord = {}, ev
        ck = (lg, ev, tf)
        if ck in self.cache:
            return self.cache[ck]
        i = 1 if tf == "h1" else 3
        ph, pa = PRIOR[tf]
        cur = self.leagues[lg].sums(ev - 365, ev) if lg in self.leagues else [0] * 5
        prev = self.leagues[lg].sums(ev - 730, ev - 365) if lg in self.leagues else [0] * 5
        tr = self.tiers[tier].sums(ev - 365, ev) if tier in self.tiers else [0] * 5
        res = []
        for j, pr in ((i, ph), (i + 1, pa)):
            t = (tr[j] + K_TIER * pr) / (tr[0] + K_TIER)
            p = (prev[j] + K_PREV * t) / (prev[0] + K_PREV)
            res.append((cur[j] + K_CUR * p) / (cur[0] + K_CUR))
        out = (res[0], res[1], cur[0])
        self.cache[ck] = out
        return out

    def strength(self, entries, ev, tf, kk):
        if not entries:
            return 1.0, 1.0, 0.0
        gi = 0 if tf == "h1" else 2
        sw = sf = se = sa = sx = 0.0
        for e in entries:
            w = 0.5 ** ((ev - e[0]) / HALF_LIFE)
            rh, ra, _ = self.rate(e[1], e[2], ev, tf)
            ef, ea = (rh, ra) if e[3] else (ra, rh)
            gf, ga = e[4 + gi], e[5 + gi]
            sw += w
            sf += w * gf
            se += w * ef
            sa += w * ga
            sx += w * ea
        att = 1 + (sf / se - 1) * sw / (sw + K_ATT) if se > 0 else 1.0
        dfn = 1 + (sa / sx - 1) * sw / (sw + K_DEF) if sx > 0 else 1.0
        return min(1.8, max(0.55, att)), min(1.8, max(0.55, dfn)), sw

    def team_strength(self, t, is_home, ev, tf):
        a_all, d_all, w = self.strength(self.hist[t], ev, tf, 0)
        ven = self.home[t] if is_home else self.away[t]
        if not ven:
            return a_all, d_all
        a_v, d_v, _ = self.strength(ven, ev, tf, 1)
        return (a_all ** 0.65) * (a_v ** 0.35), (d_all ** 0.65) * (d_v ** 0.35)

    def h2h_mult(self, h, a, ev, tf):
        key = (h, a) if h < a else (a, h)
        gi = 0 if tf == "h1" else 2
        oh = eh = oa = ea = 0.0
        for e in self.h2h.get(key, ()):
            age = ev - e[0]
            if age > H2H_DAYS or age <= 0:
                continue
            base = 0.5 ** (age / H2H_HALF)
            rh, ra, _ = self.rate(e[2], e[3], ev, tf)
            hg, ag = e[5 + gi], e[6 + gi]
            if e[1] == h:
                w = base
                oh += w * hg
                eh += w * rh
                oa += w * ag
                ea += w * ra
            else:
                w = base * 0.6
                oh += w * ag
                eh += w * ra
                oa += w * hg
                ea += w * rh
        al = ALPHA[tf]
        mh = min(1.12, max(0.90, ((oh + al) / (eh + al)) ** 0.25))
        ma = min(1.12, max(0.90, ((oa + al) / (ea + al)) ** 0.25))
        return mh, ma

    def predict(self, h, a, lg, tier, ev):
        d = max(-1.2, min(1.2, (self.elo[h] - self.elo[a]) / 400.0))
        conf = min(min(self.games[h], self.games[a]), 10) / 10.0
        mc_h, mc_a = math.exp(0.22 * d * conf), math.exp(-0.22 * d * conf)
        out = {}
        for tf in ("h1", "ft"):
            rh, ra, n = self.rate(lg, tier, ev, tf)
            ah, dh = self.team_strength(h, True, ev, tf)
            aa, da = self.team_strength(a, False, ev, tf)
            mh, ma = self.h2h_mult(h, a, ev, tf)
            lam_h = rh * ah * da * mh * mc_h
            lam_a = ra * aa * dh * ma * mc_a
            out[tf] = (1 - math.exp(-lam_h), 1 - math.exp(-lam_a), n)
        return out

    def add(self, f):
        o = f["ord"]
        lg, tier = f["lg"], f["tier"]
        h, a = f["h"], f["a"]
        v = f["g"]
        self.leagues[lg].add(o, v)
        self.tiers[tier].add(o, v)
        eh = (o, lg, tier, True, v[0], v[1], v[2], v[3])
        ea = (o, lg, tier, False, v[1], v[0], v[3], v[2])
        self.hist[h].append(eh)
        self.hist[a].append(ea)
        self.home[h].append(eh)
        self.away[a].append(ea)
        self.games[h] += 1
        self.games[a] += 1
        key = (h, a) if h < a else (a, h)
        self.h2h[key].append((o, h, lg, tier, 0, v[0], v[1], v[2], v[3]))
        diff = self.elo[h] + 60.0 - self.elo[a]
        exp_h = 1.0 / (1.0 + 10 ** (-diff / 400.0))
        res = 1.0 if v[2] > v[3] else 0.5 if v[2] == v[3] else 0.0
        self.elo[h] += 20.0 * (res - exp_h)
        self.elo[a] -= 20.0 * (res - exp_h)

def logit(p):
    p = min(1 - 1e-4, max(1e-4, p))
    return math.log(p / (1 - p))

def sigmoid(z):
    return 1.0 / (1.0 + math.exp(-z))

def fit_platt(pts):
    a, b = 1.0, 0.0
    if len(pts) < 200:
        return a, b
    zs = [(logit(p), y) for p, y in pts]
    for _ in range(40):
        ga = gb = haa = hbb = hab = 0.0
        for z, y in zs:
            q = sigmoid(a * z + b)
            e = q - y
            w = q * (1 - q)
            ga += e * z
            gb += e
            haa += w * z * z
            hbb += w
            hab += w * z
        haa += 1e-6
        hbb += 1e-6
        det = haa * hbb - hab * hab
        if abs(det) < 1e-12:
            break
        da = (ga * hbb - gb * hab) / det
        db = (gb * haa - ga * hab) / det
        a, b = a - da, b - db
        if abs(da) + abs(db) < 1e-7:
            break
    return a, b

def apply_platt(p, par, tf):
    a, b = par
    lo, hi = CLIP[tf]
    return min(CAP[tf], min(hi, max(lo, sigmoid(a * logit(p) + b))))

def load_fixtures(api, since):
    q = "fixtures?select=fixture_id,match_date,home_team_id,away_team_id,ht_home,ht_away,ft_home,ft_away,competition_key,tier&ht_home=not.is.null&ht_away=not.is.null&ft_home=not.is.null&ft_away=not.is.null&home_team_id=not.is.null&away_team_id=not.is.null&tier=in.(major,minor)&match_date=gte.%s&order=match_date.asc,fixture_id.asc" % since
    rows = api.pages(q)
    out = []
    for r in rows:
        k = r["competition_key"] or "?"
        if k == "livescore:england":
            continue
        t = tier_of(k, r["tier"])
        out.append({"ord": date.fromisoformat(r["match_date"]).toordinal(), "h": str(r["home_team_id"]), "a": str(r["away_team_id"]),
                    "lg": k + "|" + t, "tier": t, "g": (r["ht_home"], r["ht_away"], r["ft_home"], r["ft_away"])})
    return out

def run_history(fx, today_ord, fit_from):
    m = Model()
    recs = []
    i = 0
    n = len(fx)
    while i < n:
        j = i
        while j < n and fx[j]["ord"] == fx[i]["ord"]:
            j += 1
        ev = fx[i]["ord"]
        if ev >= today_ord:
            break
        if ev >= fit_from:
            for f in fx[i:j]:
                pr = m.predict(f["h"], f["a"], f["lg"], f["tier"], ev)
                recs.append((ev, f["tier"], f["g"], pr))
        for f in fx[i:j]:
            m.add(f)
        i = j
    return m, recs

def platt_groups(recs):
    g = collections.defaultdict(list)
    for ev, tier, v, pr in recs:
        for tf in ("h1", "ft"):
            gi = 0 if tf == "h1" else 2
            g[(tf, tier, "h")].append((pr[tf][0], 1 if v[gi] > 0 else 0))
            g[(tf, tier, "a")].append((pr[tf][1], 1 if v[gi + 1] > 0 else 0))
    return {k: fit_platt(v) for k, v in g.items()}

def bss_report(recs, cut):
    tr = [r for r in recs if r[0] < cut]
    te = [r for r in recs if r[0] >= cut]
    if len(tr) < 1000 or len(te) < 200:
        print("holdout skipped", len(tr), len(te))
        return
    par = platt_groups(tr)
    for tf in ("h1", "ft"):
        gi = 0 if tf == "h1" else 2
        base = {}
        for side in ("h", "a"):
            ys = [1 if r[2][gi + (0 if side == "h" else 1)] > 0 else 0 for r in tr]
            base[side] = sum(ys) / len(ys)
        b_m = b_b = b_r = 0.0
        cnt = 0
        for ev, tier, v, pr in te:
            for side, idx in (("h", 0), ("a", 1)):
                y = 1 if v[gi + idx] > 0 else 0
                p = apply_platt(pr[tf][idx], par.get((tf, tier, side), (1.0, 0.0)), tf)
                b_m += (p - y) ** 2
                b_b += (base[side] - y) ** 2
                b_r += (pr[tf][idx] - y) ** 2
                cnt += 1
        print("holdout %s n=%d brier_model=%.4f brier_base=%.4f bss=%.2f%% raw_bss=%.2f%%" % (tf, cnt, b_m / cnt, b_b / cnt, 100 * (1 - b_m / b_b), 100 * (1 - b_r / b_b)))

def confidence(m, h, a, n_league):
    g = min(m.games[h], m.games[a])
    if g >= 20 and n_league >= 200:
        return "high"
    if g >= 8 and n_league >= 60:
        return "medium"
    return "low"

def main():
    url = os.environ["SB_URL"]
    key = os.environ["SB_SERVICE_ROLE_KEY"]
    api = Api(url, key)
    now = datetime.now(timezone.utc)
    today = now.astimezone(VN).date()
    today_ord = today.toordinal()
    since = os.environ.get("GOAL_PROBS_SINCE", "2018-01-01")
    fx = load_fixtures(api, since)
    print("fixtures", len(fx))
    fit_from = today_ord - int(os.environ.get("GOAL_PROBS_FIT_DAYS", "540"))
    m, recs = run_history(fx, today_ord, fit_from)
    print("fit records", len(recs))
    bss_report(recs, today_ord - 45)
    par = platt_groups(recs)
    lo = (now - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
    hi = (now + timedelta(hours=72)).strftime("%Y-%m-%dT%H:%M:%SZ")
    up = api.pages("cfi_living_verified_fixtures?select=fixture_id,kickoff_at,home_team,away_team,canonical_home_team_id,canonical_away_team_id&kickoff_at=gte.%s&kickoff_at=lte.%s&canonical_home_team_id=not.is.null&canonical_away_team_id=not.is.null&order=kickoff_at.asc" % (lo, hi))
    seen, rows = set(), []
    for u in up:
        fid = u["fixture_id"]
        if fid in seen:
            continue
        seen.add(fid)
        h, a = str(u["canonical_home_team_id"]), str(u["canonical_away_team_id"])
        if h == a:
            continue
        lgk = "?"
        for t in (h, a):
            if m.hist[t]:
                lgk = m.hist[t][-1][1]
                break
        tier = "minor"
        for t in (h, a):
            for e in reversed(m.hist[t]):
                if e[2] == "major":
                    tier = "major"
                    break
            if tier == "major":
                break
        pr = m.predict(h, a, lgk if lgk != "?" else "?|minor", tier, today_ord)
        x1 = apply_platt(pr["h1"][0], par.get(("h1", tier, "h"), (1.0, 0.0)), "h1")
        y1 = apply_platt(pr["h1"][1], par.get(("h1", tier, "a"), (1.0, 0.0)), "h1")
        xf = apply_platt(pr["ft"][0], par.get(("ft", tier, "h"), (1.0, 0.0)), "ft")
        yf = apply_platt(pr["ft"][1], par.get(("ft", tier, "a"), (1.0, 0.0)), "ft")
        if any(math.isnan(v) for v in (x1, y1, xf, yf)):
            continue
        rows.append({"fixture_id": fid, "kickoff_at": u["kickoff_at"], "home_team": u["home_team"], "away_team": u["away_team"], "home_id": h, "away_id": a, "tier": tier,
                     "nk": name_key(u["home_team"], u["away_team"], u["kickoff_at"]),
                     "h1_home": round(x1, 4), "h1_away": round(y1, 4), "ft_home": round(xf, 4), "ft_away": round(yf, 4),
                     "conf": confidence(m, h, a, pr["ft"][2])})
    print("upcoming", len(up), "rows", len(rows))
    for i in range(0, len(rows), 300):
        print(api.rpc("cfi_goal_probs_upsert", {"p_rows": rows[i:i + 300]}))
    if not rows:
        print(api.rpc("cfi_goal_probs_upsert", {"p_rows": []}))

if __name__ == "__main__":
    main()
