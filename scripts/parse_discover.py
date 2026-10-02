import requests, json
r = requests.post(
    "https://cfi-football-intelligence.baoanhrat112020.workers.dev/api/discover",
    json={"target_date":"2026-09-26","timezone":"Asia/Ho_Chi_Minh","max_matches":5,"response_mode":"compact"},
    timeout=180
)
d = json.loads(r.text)
print(f"status: {d.get('status')}")
print(f"final: {d.get('final')}")
print(f"counts: {json.dumps(d.get('counts'), indent=2)}")
print(f"\n--- BOARD ({len(d.get('board',[]))} rows) ---")
for row in d.get("board", []):
    print(f"\n{row.get('match')}")
    print(f"  competition: {row.get('competition')} | {row.get('country')}")
    print(f"  status: {row.get('status')} | bestMarket: {row.get('bestMarket')}")
    print(f"  modelProb: {row.get('modelProbability')} | fairOdds: {row.get('fairOdds')}")
    print(f"  confidence: {row.get('confidence')} | strictPrior: {row.get('strictPrior')}")
print(f"\n--- TOP PICKS ---")
for pick in d.get("topPicks", []):
    print(f"  {pick.get('match')} | {pick.get('bestMarket')} | {pick.get('modelProbability')}")