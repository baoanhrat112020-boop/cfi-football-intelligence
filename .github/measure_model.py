import os, json, urllib.request, collections, math
from datetime import date, timedelta
U = "https://zbwkowqluwuvsnajkuvc.supabase.co/rest/v1/"
K = os.environ["K"]
H = {"apikey": K, "Authorization": "Bearer " + K}

def get(path, extra=None):
    h = dict(H)
    if extra: h.update(extra)
    req = urllib.request.Request(U + path, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read()), r.headers

def pages(path, size=1000, cap=60):
    out = []
    for i in range(cap):
        try:
            rows, _ = get(path + "&limit=%d&offset=%d" % (size, i * size))
        except Exception as e:
            print("ERR", path[:60], str(e)[:120]); break
        out += rows
        if len(rows) < size: break
    return out

try:
    s, h = get("team_stats?select=*&limit=1", {"Prefer": "count=exact", "Range": "0-0"})
    print("team_stats cols:", list(s[0].keys()) if s else None, "total:", h.get("content-range"))
except Exception as e:
    print("team_stats ERR", str(e)[:200])

ts = pages("team_stats?select=team_id")
tsset = set(str(r["team_id"]) for r in ts)
print("team_stats rows:", len(ts))

since = (date.today() - timedelta(days=365)).isoformat()
fx = pages("fixtures?select=home_team_id,away_team_id,match_date,ft_home,ft_away,ht_home&ft_home=not.is.null&match_date=gte." + since + "&order=match_date.desc", cap=120)
print("fixtures FT last 365d:", len(fx))
cnt = collections.Counter()
for r in fx:
    cnt[str(r["home_team_id"])] += 1; cnt[str(r["away_team_id"])] += 1
teams = len(cnt)
print("teams in fixtures:", teams, "with team_stats:", sum(1 for t in cnt if t in tsset))
for n in (1, 3, 5, 10, 20):
    print("teams with >= %d matches: %d" % (n, sum(1 for v in cnt.values() if v >= n)))
print("fixtures missing HT:", sum(1 for r in fx if r["ht_home"] is None), "of", len(fx))
avg_g = sum(r["ft_home"] + r["ft_away"] for r in fx) / max(len(fx), 1)
print("avg FT goals:", round(avg_g, 3))

pk = pages("suggest_pick_log?select=top_market,top_market_prob,hit_top_market,home_team_id,away_team_id,kickoff_at&settled_at=not.is.null&hit_top_market=not.is.null&top_market=not.is.null", cap=80)
print("settled picks:", len(pk))
if pk:
    print("earliest", min(r["kickoff_at"] for r in pk)[:10], "latest", max(r["kickoff_at"] for r in pk)[:10])
    noids = sum(1 for r in pk if not r["home_team_id"] or not r["away_team_id"])
    nostats = sum(1 for r in pk if r["home_team_id"] and r["away_team_id"] and (str(r["home_team_id"]) not in tsset or str(r["away_team_id"]) not in tsset))
    print("picks no ids:", noids, "ids but no team_stats:", nostats)
    def block(rows, title):
        b = collections.defaultdict(lambda: [0, 0, 0.0])
        for r in rows:
            p = float(r["top_market_prob"]); k = min(int(p * 10), 9)
            b[k][0] += 1; b[k][1] += 1 if r["hit_top_market"] else 0; b[k][2] += p
        print("--", title, "n=", len(rows))
        for k in sorted(b):
            n, w, sp = b[k]
            print("  p %d0-%d0%%: n=%d hit=%.1f%% pred=%.1f%%" % (k, k + 1, n, 100 * w / n, 100 * sp / n))
        n = len(rows)
        if n:
            br = sum((float(r["top_market_prob"]) - (1 if r["hit_top_market"] else 0)) ** 2 for r in rows) / n
            base = sum(1 if r["hit_top_market"] else 0 for r in rows) / n
            brb = sum((base - (1 if r["hit_top_market"] else 0)) ** 2 for r in rows) / n
            print("  brier model=%.4f  constant-base-rate=%.4f  base=%.3f" % (br, brb, base))
    block(pk, "ALL")
    byk = collections.defaultdict(list)
    for r in pk: byk[r["top_market"]].append(r)
    for k, v in sorted(byk.items(), key=lambda x: -len(x[1]))[:8]:
        block(v, k)
    withstats = [r for r in pk if r["home_team_id"] and r["away_team_id"] and str(r["home_team_id"]) in tsset and str(r["away_team_id"]) in tsset]
    nost = [r for r in pk if r not in withstats]
    block(withstats, "teams WITH team_stats")
    block(nost, "teams WITHOUT team_stats/ids")
