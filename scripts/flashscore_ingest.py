import os, re, uuid, hashlib, json
from datetime import datetime, timedelta
from curl_cffi import requests as cf

SEP_EVENT="~"; SEP_FIELD="\u00ac"; SEP_KV="\u00f7"
INGEST="https://kovmddkkzttquupdgmel.supabase.co/functions/v1/cfi-pc-node-ingest"
KEY=os.environ.get("CFI_PC_NODE_KEY","")
if not KEY:
    print("ERROR: set $env:CFI_PC_NODE_KEY"); exit(1)

SKIP = re.compile(r"\b(W|Women|U19|U20|U21|U23|Reserve|Reserves|II\b)\b", re.I)

def fetch(day):
    try:
        r = cf.get(f"https://global.flashscore.ninja/2/x/feed/f_1_{day}_3_en_1",
                   headers={"x-fsign":"SW9D1eZo"}, impersonate="chrome120", timeout=20)
        return r.text if r.status_code == 200 else ""
    except: return ""

def parse(text, target_date):
    cur_lg=None; cur_country=None
    out=[]
    for ev in text.split(SEP_EVENT):
        if not ev.strip(): continue
        f={}
        for x in ev.split(SEP_FIELD):
            if SEP_KV in x:
                k,v=x.split(SEP_KV,1); f[k]=v
        if "ZA" in f:
            lg_name = f.get("ZA","")
            if ":" in lg_name:
                cur_country, cur_lg = lg_name.split(":", 1)
                cur_country = cur_country.strip()
                cur_lg = cur_lg.strip()
            else:
                cur_lg = lg_name.strip()
                cur_country = None
        if "AA" in f and "AE" in f and "AF" in f:
            mid = f.get("AA","")
            home = f.get("AE","").strip()
            away = f.get("AF","").strip()
            ts = f.get("AD","")
            if not home or not away or not mid: continue
            try:
                kickoff = datetime.fromtimestamp(int(ts), tz=None).isoformat() + "Z"
            except:
                kickoff = None
            out.append({
                "mid": mid, "home": home, "away": away,
                "league": cur_lg or "", "country": cur_country,
                "kickoff": kickoff, "date": target_date
            })
    return out

def to_contract(m):
    h = hashlib.sha256(f"{m['home'].lower()}|{m['away'].lower()}|{m['kickoff']}".encode()).hexdigest()[:32]
    return {
        "provider": "FLASHSCORE",
        "providerId": m["mid"],
        "home": m["home"],
        "away": m["away"],
        "competition": m["league"],
        "country": m["country"],
        "kickoffIso": m["kickoff"],
        "kickoffLocal": None,
        "targetDate": m["date"],
        "status": "scheduled",
        "sourceUrls": [f"https://www.flashscore.com/match/{m['mid']}"],
        "discoveredAt": datetime.utcnow().isoformat() + "Z",
    }

print("Fetching...")
all_matches = []
for day in [0, 1]:
    text = fetch(day)
    if not text: continue
    md = (datetime.now().date()+timedelta(days=day)).strftime("%Y-%m-%d")
    ms = parse(text, md)
    all_matches.extend(ms)
    print(f"  day {day}: {len(ms)} matches")

# Filter senior
senior = [m for m in all_matches if m["league"] and not SKIP.search(m["league"])]
print(f"\nSenior matches (after filter): {len(senior)}")

# Dedup by mid
seen = set(); uniq = []
for m in senior:
    if m["mid"] in seen: continue
    seen.add(m["mid"]); uniq.append(m)
print(f"Unique: {len(uniq)}")

# Payload
payload = {
    "action": "FIXTURE_DISCOVERY_BATCH",
    "node_id": "FLASHSCORE_FEED_V1",
    "source": "FLASHSCORE",
    "target_date": datetime.now().strftime("%Y-%m-%d"),
    "generated_at": datetime.utcnow().isoformat() + "Z",
    "fixtures": [to_contract(m) for m in uniq]
}

print(f"\nUploading {len(payload['fixtures'])} fixtures to cfi-pc-node-ingest...")
r = cf.post(INGEST, json=payload, headers={"x-cfi-node-key": KEY, "content-type": "application/json"}, impersonate="chrome120", timeout=60)
print(f"HTTP {r.status_code}")
print(f"Response: {r.text[:1000]}")