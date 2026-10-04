from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from datetime import timedelta
from difflib import SequenceMatcher

from config import get_local_conn

KEYS = {"E0": "england:e0", "SP1": "spain:sp1", "D1": "germany:d1", "I1": "italy:i1", "F1": "france:f1"}
STOP = {"fc", "cf", "ac", "as", "sc", "us", "ssc", "afc", "rc", "ud", "cd", "fk", "sv", "vfl", "vfb", "tsg", "fsv", "1", "de", "calcio", "club", "the"}
DDL = """
CREATE TABLE IF NOT EXISTS fd_match (
  div TEXT, season TEXT, date DATE, home_team TEXT, away_team TEXT,
  fixture_id TEXT, method TEXT, score NUMERIC,
  PRIMARY KEY (div, season, date, home_team, away_team)
)
"""


def norm(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    toks = [t for t in s.split() if t not in STOP]
    return " ".join(toks)


def sim(a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    r = SequenceMatcher(None, a, b).ratio()
    if a in b or b in a:
        r = max(r, 0.85)
    ta, tb = set(a.split()), set(b.split())
    if ta & tb:
        r = max(r, 0.5 + 0.5 * len(ta & tb) / max(len(ta), len(tb)))
    return r


def main():
    conn = get_local_conn()
    cur = conn.cursor()
    cur.execute("SELECT alias_normalized, team_id FROM team_aliases")
    alias = {norm(a): t for a, t in cur.fetchall()}
    cur.execute("SELECT team_id, canonical_name FROM teams")
    tname = {t: n for t, n in cur.fetchall()}
    cur.execute(
        """SELECT fixture_id, match_date, home_team_id, away_team_id, competition_key, ft_home, ft_away
           FROM fixtures WHERE competition_key = ANY(%s) AND match_date >= '2019-07-01' AND match_date < '2024-07-01'""",
        (list(KEYS.values()),),
    )
    fx = defaultdict(list)
    for fid, d, h, a, k, fh, fa in cur.fetchall():
        fx[(k, d)].append((fid, h, a, fh, fa))
    cur.execute("SELECT div, season, date, home_team, away_team, fthg, ftag FROM fd_odds")
    fd = cur.fetchall()

    cur.execute(DDL)
    cur.execute("TRUNCATE fd_match")
    stats = defaultdict(int)
    fuzzy, unmatched, out = [], [], []
    used = set()
    for dv, se, d, ht, at, fthg, ftag in fd:
        k = KEYS[dv]
        cands = []
        for dd in (0, -1, 1):
            cands += [(c, abs(dd)) for c in fx.get((k, d + timedelta(days=dd)), [])]
        nh, na = norm(ht), norm(at)
        th, ta = alias.get(nh), alias.get(na)
        best = None
        for (fid, h, a, fh, fa), off in cands:
            s_h = 1.0 if th == h else sim(nh, norm(tname.get(h, "")))
            s_a = 1.0 if ta == a else sim(na, norm(tname.get(a, "")))
            al = th == h and ta == a
            sc = s_h + s_a - 0.05 * off
            if fh == fthg and fa == ftag:
                sc += 0.3
            if best is None or sc > best[0]:
                best = (sc, fid, s_h, s_a, h, a, al, fh == fthg and fa == ftag)
        if best and best[2] >= 0.6 and best[3] >= 0.6 and best[1] not in used:
            method = "alias" if best[6] else ("name" if best[2] >= 0.99 and best[3] >= 0.99 else "fuzzy")
            stats["score_ok"] += int(best[7])
            used.add(best[1])
            stats[method] += 1
            out.append((dv, se, d, ht, at, best[1], method, round(best[0], 3)))
            if method == "fuzzy":
                fuzzy.append((ht, tname.get(best[4]), at, tname.get(best[5]), round(best[0], 2)))
        else:
            stats["none"] += 1
            unmatched.append((dv, se, d, ht, at, len(cands)))
    cur.executemany("INSERT INTO fd_match VALUES (%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING", out)
    conn.commit()
    conn.close()

    total = len(fd)
    ok = stats["alias"] + stats["name"] + stats["fuzzy"]
    print(f"fd_odds={total} matched={ok} ({ok / total * 100:.1f}%) alias={stats['alias']} exact_name={stats['name']} score_agree={stats['score_ok']} fuzzy={stats['fuzzy']} none={stats['none']}")
    print("unmatched by div:", {dv: sum(1 for u in unmatched if u[0] == dv) for dv in KEYS})
    print("fuzzy samples:")
    for r in fuzzy[:8]:
        print("  ", r)
    print("unmatched samples:")
    for r in unmatched[:8]:
        print("  ", r)


if __name__ == "__main__":
    main()
