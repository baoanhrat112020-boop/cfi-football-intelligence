import os, sys
import pandas as pd
import numpy as np
from supabase import create_client

SB_URL = "https://kovmddkkzttquupdgmel.supabase.co"
SB_KEY = os.environ.get("SB_SERVICE_ROLE_KEY", "")
if not SB_KEY:
    print("ERROR: set $env:SB_SERVICE_ROLE_KEY")
    sys.exit(1)

sb = create_client(SB_URL, SB_KEY)

# ============================================================
# LOAD ALL FINISHED FIXTURES WITH RESULTS
# ============================================================
print("Loading fixtures_cache.csv...")
df = pd.read_csv("fixtures_cache.csv", encoding="utf-8-sig", low_memory=False)
df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
for c in ["ht_home", "ht_away", "ft_home", "ft_away"]:
    df[c] = pd.to_numeric(df[c], errors="coerce")
df = df.dropna(subset=["match_date", "ft_home", "ft_away"])
print(f"  {len(df)} historical fixtures")

print("Loading finished fixtures from DB...")
offset = 0
db_rows = []
while True:
    r = sb.table("fixtures").select(
        "fixture_id, match_date, home_team_id, away_team_id, "
        "ht_home, ht_away, ft_home, ft_away, competition_key, country"
    ).not_.is_("ft_home", "null").range(offset, offset+999).execute()
    if not r.data:
        break
    db_rows.extend(r.data)
    offset += 1000
    if len(r.data) < 1000:
        break
db_df = pd.DataFrame(db_rows)
print(f"  {len(db_df)} finished fixtures from DB")

if len(db_df):
    db_df["match_date"] = pd.to_datetime(db_df["match_date"], errors="coerce")
    for c in ["ht_home", "ht_away", "ft_home", "ft_away"]:
        db_df[c] = pd.to_numeric(db_df[c], errors="coerce")
    db_df = db_df.dropna(subset=["match_date", "ft_home", "ft_away"])
    combined = pd.concat([df, db_df], ignore_index=True)
    combined = combined.drop_duplicates(subset=["fixture_id"], keep="last")
else:
    combined = df

print(f"  Combined: {len(combined)} fixtures")

# ============================================================
# COMPUTE TARGETS
# ============================================================
combined["ft_total"] = combined["ft_home"] + combined["ft_away"]
combined["ft_max"]   = combined[["ft_home", "ft_away"]].max(axis=1)
combined["ht_total"] = combined["ht_home"].fillna(0) + combined["ht_away"].fillna(0)
combined["ht_max"]   = combined[["ht_home", "ht_away"]].max(axis=1)
combined["y_7ft"]    = (combined["ft_total"] >= 7).astype(int)
combined["y_oft"]    = (combined["ft_max"]   >= 5).astype(int)
combined["y_3ht"]    = (combined["ht_total"] >= 3).astype(int)
combined["y_oht"]    = (combined["ht_max"]   >= 4).astype(int)
combined["competition_key"] = combined["competition_key"].fillna("unknown").astype(str)

# ============================================================
# COMPUTE LEAGUE PRIORS
# ============================================================
print("\nComputing league priors...")

# Global baseline
global_stats = {
    "prior_3ht": float(combined["y_3ht"].mean()),
    "prior_oht": float(combined["y_oht"].mean()),
    "prior_7ft": float(combined["y_7ft"].mean()),
    "prior_oft": float(combined["y_oft"].mean()),
    "avg_ft_total": float(combined["ft_total"].mean()),
    "avg_ht_total": float(combined["ht_total"].mean()),
}

# Country mapping — extract from competition_key
def extract_country(ck):
    if ":" in ck:
        return ck.split(":")[0]
    if "_" in ck:
        return ck.split("_")[0]
    return ck

combined["country_code"] = combined["competition_key"].apply(extract_country)

# Per-league stats
league_stats = combined.groupby("competition_key").agg(
    n_fixtures=("y_3ht", "size"),
    prior_3ht=("y_3ht", "mean"),
    prior_oht=("y_oht", "mean"),
    prior_7ft=("y_7ft", "mean"),
    prior_oft=("y_oft", "mean"),
    avg_ft_total=("ft_total", "mean"),
    avg_ht_total=("ht_total", "mean"),
).reset_index()

# Per-country stats (for fallback)
country_stats = combined.groupby("country_code").agg(
    c_3ht=("y_3ht", "mean"),
    c_oht=("y_oht", "mean"),
    c_7ft=("y_7ft", "mean"),
    c_oft=("y_oft", "mean"),
    c_ft_total=("ft_total", "mean"),
    c_ht_total=("ht_total", "mean"),
).reset_index()

# Minimum sample size — dưới ngưỡng này thì dùng country avg
MIN_SAMPLES = 100

rows = []
for _, lr in league_stats.iterrows():
    ck = lr["competition_key"]
    country = extract_country(ck)
    n = int(lr["n_fixtures"])

    if n >= MIN_SAMPLES:
        # League has enough data — dùng league stats
        row = {
            "competition_key": ck,
            "country": country,
            "n_fixtures": n,
            "prior_3ht": float(lr["prior_3ht"]),
            "prior_oht": float(lr["prior_oht"]),
            "prior_7ft": float(lr["prior_7ft"]),
            "prior_oft": float(lr["prior_oft"]),
            "avg_ft_total": float(lr["avg_ft_total"]),
            "avg_ht_total": float(lr["avg_ht_total"]),
            "source": "historical",
        }
    else:
        # Few samples — dùng country avg
        c_row = country_stats[country_stats["country_code"] == country]
        if len(c_row) > 0:
            cs = c_row.iloc[0]
            row = {
                "competition_key": ck,
                "country": country,
                "n_fixtures": n,
                "prior_3ht": float(cs["c_3ht"]),
                "prior_oht": float(cs["c_oht"]),
                "prior_7ft": float(cs["c_7ft"]),
                "prior_oft": float(cs["c_oft"]),
                "avg_ft_total": float(cs["c_ft_total"]),
                "avg_ht_total": float(cs["c_ht_total"]),
                "source": "country_avg",
            }
        else:
            # Fallback global
            row = {
                "competition_key": ck,
                "country": country,
                "n_fixtures": n,
                "source": "global_avg",
                **global_stats,
            }
    rows.append(row)

print(f"  {len(rows)} leagues computed")
print(f"  Sources: {pd.Series([r['source'] for r in rows]).value_counts().to_dict()}")

# ============================================================
# UPSERT
# ============================================================
print("\nUploading to cfi_league_priors...")
for i in range(0, len(rows), 500):
    sb.table("cfi_league_priors").upsert(rows[i:i+500]).execute()

print(f"\n✓ Inserted {len(rows)} league priors")
print(f"\nGlobal baseline: {global_stats}")