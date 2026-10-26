import json
import os
import urllib.request
from collections import Counter
from datetime import datetime, timedelta, timezone

BASE = "https://v3.football.api-sports.io"
KEY = os.environ["APIFOOTBALL_KEY"]


def call(path):
    req = urllib.request.Request(BASE + path, headers={"x-apisports-key": KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        remaining = r.headers.get("x-ratelimit-requests-remaining")
        body = json.load(r)
    print(path, "| remaining today:", remaining, "| errors:", body.get("errors"), "| results:", body.get("results"), "| paging:", body.get("paging"))
    return body


st = call("/status")
print("plan:", json.dumps((st.get("response") or {}).get("subscription"))) if isinstance(st.get("response"), dict) else None
today = datetime.now(timezone.utc).date()
for d in (today, today + timedelta(days=1)):
    fx = call("/fixtures?date=%s" % d)
    rows = fx.get("response") or []
    leagues = Counter((x["league"]["country"], x["league"]["name"]) for x in rows)
    print(str(d), "fixtures", len(rows), "leagues", len(leagues))
    print("sample leagues", list(leagues.items())[:12])
    od = call("/odds?date=%s&page=1" % d)
    orows = od.get("response") or []
    print(str(d), "odds page1 fixtures", len(orows))
    if orows:
        o = orows[0]
        print("sample fixture id", o["fixture"]["id"], "bookmakers", [b["name"] for b in o["bookmakers"]][:8])
        bets = Counter()
        for b in o["bookmakers"]:
            for bt in b["bets"]:
                bets[bt["name"]] += 1
        print("bets", dict(bets))
