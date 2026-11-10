import os, json, re, urllib.request, math, collections
U = "https://zbwkowqluwuvsnajkuvc.supabase.co/rest/v1/"
K = os.environ["K"]
H = {"apikey": K, "Authorization": "Bearer " + K}

def get(path):
    r = urllib.request.Request(U + path, headers=H)
    with urllib.request.urlopen(r, timeout=90) as x:
        return json.loads(x.read())

def pages(path, size=1000, cap=40):
    out = []
    for i in range(cap):
        rows = get(path + "&limit=%d&offset=%d" % (size, i * size))
        out += rows
        if len(rows) < size: break
    return out

rows = []
for tbl, per in (("best_choice_daily", "FT"), ("best_choice_ht", "HT")):
    for r in pages(tbl + "?select=day,fixture_id,market,p_model,p_win,hit,void,settled_at&settled_at=not.is.null&hit=not.is.null&void=eq.false"):
        r["per"] = per; r["tbl"] = tbl; rows.append(r)
print("bc settled rows", len(rows))
ids = sorted(set(r["fixture_id"] for r in rows))
odds = collections.defaultdict(list)
for i in range(0, len(ids), 60):
    chunk = ",".join(ids[i:i + 60])
    for o in get("match_odds?select=verified_fixture_id,period,line,odds_over,odds_under,p_implied_over,source,last_seen_at&market_family=eq.OVER_UNDER&verified_fixture_id=in.(%s)&limit=5000" % chunk):
        odds[o["verified_fixture_id"]].append(o)

def line_of(market):
    m = re.match(r"^over_(\d)(\d*)_(ht|ft)$", market)
    if not m: return None
    return float(m.group(1) + ("." + m.group(2) if m.group(2) else ""))

data = []
for r in rows:
    L = line_of(r["market"])
    if L is None: continue
    cands = [o for o in odds.get(r["fixture_id"], []) if o["period"] == r["per"] and o["line"] is not None and abs(float(o["line"]) - L) < 1e-6 and o.get("odds_over") and o.get("odds_under")]
    if not cands: continue
    cands.sort(key=lambda o: o["last_seen_at"] or "")
    o = cands[-1]
    a, b = 1 / float(o["odds_over"]), 1 / float(o["odds_under"])
    data.append({"per": r["per"], "L": L, "y": 1 if r["hit"] else 0, "pw": float(r["p_win"]), "pm": float(r["p_model"]), "pi": a / (a + b), "half": abs(L * 2 - round(L * 2)) < 1e-6 and abs(L - round(L)) > 1e-6})
print("rows with odds", len(data), "half-line", sum(1 for d in data if d["half"]))

def brier(rs, f):
    return sum((f(d) - d["y"]) ** 2 for d in rs) / max(len(rs), 1)

def report(rs, title):
    if not rs: print(title, "n=0"); return
    base = sum(d["y"] for d in rs) / len(rs)
    print("-- %s n=%d hit=%.1f%% mean_pwin=%.1f%% mean_implied=%.1f%%" % (title, len(rs), 100 * base, 100 * sum(d["pw"] for d in rs) / len(rs), 100 * sum(d["pi"] for d in rs) / len(rs)))
    print("   brier p_win=%.4f p_model=%.4f implied=%.4f const=%.4f" % (brier(rs, lambda d: d["pw"]), brier(rs, lambda d: d["pm"]), brier(rs, lambda d: d["pi"]), base * (1 - base)))
    for w in (0.25, 0.5, 0.75):
        print("   blend w_model=%.2f brier=%.4f" % (w, brier(rs, lambda d: w * d["pw"] + (1 - w) * d["pi"])))

report(data, "ALL")
report([d for d in data if d["per"] == "FT"], "FT")
report([d for d in data if d["per"] == "HT"], "HT")
report([d for d in data if d["half"]], "HALF LINES")
report([d for d in data if not d["half"]], "OTHER LINES (quarter/integer)")
