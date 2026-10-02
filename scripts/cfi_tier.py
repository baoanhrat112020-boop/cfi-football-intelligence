import re

MAJOR_PREFIXES = re.compile(
    r"^(england|spain|italy|germany|france|netherlands|portugal|belgium|turkey|greece|scotland):"
)

MAJOR_EXACT = {
    "premier_league",
    "laliga",
    "la_liga",
    "bundesliga",
    "serie_a",
    "ligue_1",
    "eredivisie",
    "primeira_liga",
    "liga_portugal",
    "jupiler_pro_league",
    "super_lig",
    "süper_lig",
    "super_league_1",
    "premiership",
    "scottish_premiership",
    "fa_cup",
    "efl_cup",
    "dfb_pokal",
    "coppa_italia",
    "copa_del_rey",
    "coupe_de_france",
    "uefa_champions_league",
    "uefa_europa_league",
    "uefa_europa_conference_league",
    "uefa_nations_league",
    "champions_league",
    "europa_league",
    "conference_league",
}

def _normalize(comp_key):
    s = comp_key or ""
    for prefix in ("livescore:", "flashscore:"):
        if s.startswith(prefix):
            s = s[len(prefix):]
    s = s.replace("Æ", "ae").replace("æ", "ae")
    s = re.sub(r"[:\s]+", "_", s)
    s = re.sub(r"_+", "_", s)
    return s.strip("_").lower()

def classify_tier(competition_key):
    if not competition_key:
        return "junk"
    if MAJOR_PREFIXES.match(competition_key):
        return "major"
    inner = _normalize(competition_key)
    if inner in MAJOR_EXACT:
        return "major"
    return "minor"
