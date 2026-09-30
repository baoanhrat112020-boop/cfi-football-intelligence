import requests, csv, io, sys, subprocess

SUPA_URL = "https://kovmddkkzttquupdgmel.supabase.co"
import os
SUPA_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SUPA_KEY:
    print("ERROR: SB_SERVICE_ROLE_KEY not set"); sys.exit(1)

try:
    import pycountry
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "pycountry", "-q"])
    import pycountry

SPECIAL = {"EN": "England", "WA": "Wales", "SC": "Scotland", "NI": "Northern Ireland", "XK": "Kosovo"}

ALIAS = {
    "Korea, Republic of": "South Korea",
    "Iran, Islamic Republic of": "Iran",
    "United States": "USA",
    "Cote d'Ivoire": "Ivory Coast",
    "Côte d'Ivoire": "Ivory Coast",
    "Bosnia and Herzegovina": "Bosnia and Herzegovina",
    "Macedonia, North": "North Macedonia",
    "Congo, The Democratic Republic of the": "Congo DR",
    "Cabo Verde": "Cape Verde",
    "Czechia": "Czechia",
    "Russian Federation": "Russia",
    "Viet Nam": "Vietnam",
    "Syrian Arab Republic": "Syria",
    "Lao People's Democratic Republic": "Laos",
    "Venezuela, Bolivarian Republic of": "Venezuela",
    "Korea, Democratic People's Republic of": "North Korea",
    "Taiwan, Province of China": "Taiwan",
    "Palestine, State of": "Palestine",
    "Türkiye": "Turkiye",
    "Turkey": "Turkiye",
    "Czech Republic": "Czechia",
    "Bosnia": "Bosnia and Herzegovina",
    "United Arab Emirates": "UAE",
    "Curaçao": "Curacao",
    "Bolivia, Plurinational State of": "Bolivia",
    "Moldova, Republic of": "Moldova",
    "Tanzania, United Republic of": "Tanzania",
    "Hong Kong": "Hong Kong",
    "Samoa": "Samoa",
}

def code_to_name(code):
    code = code.strip()
    if code in SPECIAL: return SPECIAL[code]
    c = pycountry.countries.get(alpha_2=code)
    if not c: return None
    return ALIAS.get(c.name, c.name)

def fetch():
    r = requests.get("https://www.eloratings.net/World.tsv", timeout=20)
    r.encoding = "utf-8"
    out = {}
    for row in csv.reader(io.StringIO(r.text), delimiter="\t"):
        if len(row) < 4: continue
        try: rating = float(row[3])
        except ValueError: continue
        name = code_to_name(row[2])
        if name: out[name] = rating
    return out

def resolve_names(names):
    filt = ",".join('"' + n + '"' for n in names)
    r = requests.get(SUPA_URL + "/rest/v1/teams",
        headers={"apikey": SUPA_KEY, "Authorization": SUPA_KEY},
        params={"select": "team_id,canonical_name", "canonical_name": "in.(" + filt + ")"}, timeout=15).json()
    return {row["canonical_name"]: row["team_id"] for row in r}

def push(pairs):
    payload = [{"team_id": tid, "rating": r, "matches": 100} for tid, r in pairs]
    resp = requests.post(SUPA_URL + "/rest/v1/teams_elo",
        headers={"apikey": SUPA_KEY, "Authorization": SUPA_KEY,
                 "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates"},
        json=payload, timeout=30)
    return resp.status_code

def main():
    elo = fetch()
    print("Fetched " + str(len(elo)) + " NT ratings")
    for n in sorted(elo, key=lambda x: -elo[x])[:5]:
        print("  " + n + ": " + str(elo[n]))
    ids = resolve_names(list(elo.keys()))
    print("Resolved " + str(len(ids)) + "/" + str(len(elo)))
    pairs = [(ids[n], elo[n]) for n in elo if n in ids]
    if not pairs:
        print("Nothing to push"); return
    code = push(pairs)
    print("Pushed " + str(len(pairs)) + ": HTTP " + str(code))
    missing = [n for n in elo if n not in ids]
    if missing: print("Missing (" + str(len(missing)) + "): " + str(missing[:30]))

if __name__ == "__main__":
    main()