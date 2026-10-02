import os, re, uuid
from datetime import datetime, timedelta
from curl_cffi import requests as cf
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
sb = create_client(SB_URL, SB_KEY)

SEP_EVENT="~"; SEP_FIELD="\u00ac"; SEP_KV="\u00f7"
U_REGEX = re.compile(r"\bU(19|20|21|23)\b", re.I)

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

def norm(n): return n.lower().strip()
def t_uuid(n): return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"cfi_team:{n.lower().strip()}"))

print("Loading teams...")
teams = []
off=0
while True:
    r = sb.table("teams").select("team_id,canonical_name").range(off,off+999).execute()
    if not r.data: break
    teams.extend(r.data); off+=1000
    if len(r.data)<1000: break
by_name = {t["canonical_name"]: t["team_id"] for t in teams}
print(f"  {len(by_name)} teams")

print("Crawling past 7 days (Flashscore limit)...")
all_fx = []
for day in range(-7, 1):
    text = fetch(day)
    if not text: continue
    day_matches = [m for m in parse(text) if U_REGEX.search(m["league"])]
    finished = [m for m in day_matches if m["hg"] not in ("","-1") and m["ag"] not in ("","-1")]
    print(f"  day {day}: {len(finished)} finished U-matches")
    md = (datetime.now().date() + timedelta(days=day)).strftime("%Y-%m-%d")
    for m in finished:
        m["date"] = md
        all_fx.append(m)

print(f"\nTotal: {len(all_fx)}")

# Dedup teams
new_names = set()
for m in all_fx:
    new_names.add(m["home"]); new_names.add(m["away"])

new_main=[]; new_tn=[]
for n in new_names:
    if n in by_name: continue
    tid = t_uuid(n)
    new_main.append({"team_id":tid,"canonical_name":n})
    new_tn.append({"team_id":tid,"canonical_name":n,"norm_name":norm(n),"domestic_competition_id":"youth"})
    by_name[n] = tid

if new_main:
    print(f"Inserting {len(new_main)} teams...")
    for i in range(0,len(new_main),500):
        sb.table("teams").upsert(new_main[i:i+500]).execute()
    for i in range(0,len(new_tn),500):
        sb.table("cfi_team_names").upsert(new_tn[i:i+500]).execute()

# Insert fixtures
rows = {}
for m in all_fx:
    hid = by_name.get(m["home"]); aid = by_name.get(m["away"])
    if not hid or not aid: continue
    try: hg=int(m["hg"]); ag=int(m["ag"])
    except: continue
    fid = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"flashscore:{m['mid']}"))
    rows[fid] = {
        "fixture_id": fid, "match_date": m["date"],
        "home_team_id": hid, "away_team_id": aid,
        "competition_key": f"youth:{m['league']}",
        "status": "CANONICAL", "ft_home": hg, "ft_away": ag,
    }

rows = list(rows.values())
print(f"Inserting {len(rows)} fixtures...")
for i in range(0,len(rows),500):
    sb.table("fixtures").upsert(rows[i:i+500]).execute()
print(f"OK - {len(rows)} U-fixtures")