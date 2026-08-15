# CFI v2.1 — Screenshot Intelligence Merge Engine

## Goal
Every user screenshot used for prediction can also grow the same Persistent CFI Database without creating duplicate or contradictory fixture rows.

## Unified flow
`Screenshot -> vision extraction -> canonical team resolution -> existing DB comparison -> frozen canonical upsert -> provenance/quarantine -> prediction evidence`

## Frozen merge outcomes
- `NEW`: no canonical fixture existed.
- `DUPLICATE_COMPATIBLE`: same fixture and compatible scores; no duplicate canonical row is created.
- `COMPLEMENTARY`: incoming HT/FT completes missing canonical fields.
- `CONFLICT`: incompatible scores are preserved in quarantine and never overwrite canonical evidence.
- `REJECTED`: malformed/unsafe evidence is not written.

## Safety rules
- Missing score is never converted to zero.
- Partial HT or FT score pairs are rejected.
- Impossible HT > FT values are rejected.
- Automatic fuzzy team merging is forbidden. Exact canonical names and approved aliases may resolve automatically; unknown names remain separate canonical identities until explicitly linked.
- The frozen `cfi_upsert_fixture` function remains the final canonical authority.

## Performance model
The canonical `fixtures` table remains compact and stores team UUIDs instead of repeated team-name strings. Source metadata stays in `provenance`; contradictions stay in `quarantine`; aliases stay in `team_aliases`.

Indexes cover:
- `(match_date, home_team_id, away_team_id)`
- `(home_team_id, match_date desc)`
- `(away_team_id, match_date desc)`
- provenance fixture lookup

## Production components
1. Apply `supabase/sql/cfi_v2_1_screenshot_merge.sql`.
2. Apply `supabase/sql/cfi_ingest_fixtures_v2_batch.sql`.
3. Deploy `supabase/functions/cfi-screenshot-merge/index.ts` using the existing Supabase secrets.
4. Point the screenshot ingestion action to `cfi-screenshot-merge` instead of writing directly to the frozen upsert RPC.

## Request shape
```json
{
  "fixtures": [
    {
      "matchDate": "2025-08-15",
      "homeTeam": "Wallern",
      "awayTeam": "SC Gleisdorf",
      "ht": {"home": 2, "away": 1},
      "ft": {"home": 5, "away": 2},
      "sourceType": "SCREENSHOT",
      "sourceLabel": "user-upload",
      "imageHash": "optional-hash"
    }
  ]
}
```

## Acceptance gate
A repeated identical screenshot batch must produce `NEW = 0` and compatible duplicates. Complementary evidence must fill only null fields. Conflicting score evidence must increase `CONFLICT` and leave canonical scores unchanged.
