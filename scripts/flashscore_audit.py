import os, re, uuid
from datetime import datetime, timedelta
from curl_cffi import requests as cf

SEP_EVENT="~"; SEP_FIELD="\u00ac"; SEP_KV="\u00f7"

def fetch(day):
    try:
        r = cf.get(f"https://global.flashscore.ninja/2/x/feed/f_1_{day}_3_en_1",
                   headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=20)
        return r.text if r.status_code == 200 else ""
    except: return ""

def parse(text):
    cur_lg=None; out=[]
    for ev in text.split(SEP_EVENT):
        if not ev.strip(): continue
        f={}
        for x in ev.split(SEP_FIELD):
            if SEP_KV in x:
                k,v=x.split(SEP_KV,1); f[k]=v
        if "ZA" in f: cur_lg=f["ZA"]
        if "AA" in f and "AE" in f and "AF" in f:
            out.append({"mid":f.get("AA",""),"home":f.get("AE",""),"away":f.get("AF",""),
                        "league":cur_lg or "","hg":f.get("AG",""),"ag":f.get("AH","")})
    return out

print("Fetching Flashscore today+tomorrow...")
all_fx = []
for day in [0, 1]:
    text = fetch(day)
    if not text:
        print(f"  day {day}: FAIL")
        continue
    matches = parse(text)
    md = (datetime.now().date()+timedelta(days=day)).strftime("%Y-%m-%d")
    print(f"  day {day} ({md}): {len(matches)} matches")
    for m in matches:
        m["date"] = md
        all_fx.append(m)

print(f"\nTotal: {len(all_fx)}")
from collections import Counter
leagues = Counter(m["league"] for m in all_fx)
print("\nTop 30 leagues:")
for lg, n in leagues.most_common(30):
    print(f"  {n:4d}  {lg}")