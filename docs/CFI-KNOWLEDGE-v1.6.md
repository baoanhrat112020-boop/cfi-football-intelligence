# CFI KNOWLEDGE v1.6

## Persistent Intelligence & Database Growth Contract

**Status:** Frozen operational knowledge contract\
**Scope:** CFI AUTO, screenshot extraction, canonical data, Persistent
DB, incremental import, strict-prior evidence, four-market analysis.

## 1. CFI AUTO WORKFLOW

When HOME/AWAY and football screenshots are supplied: 1. Resolve exact
HOME/AWAY identities. 2. Call `getTeamHistory(HOME)`,
`getTeamHistory(AWAY)`, and `getH2H(HOME, AWAY)`. 3. Classify
screenshots as HOME history, AWAY history, H2H, or aggregate-only
evidence. 4. Extract every visibly supported fixture-level record. 5.
Canonicalize and deduplicate within screenshots, across streams, and
against Persistent DB. 6. Merge compatible duplicates; enrich
complementary non-conflicting fields; quarantine conflicts. 7. Exclude
future/unplayed fixtures. 8. Call `upsertFixtures` for valid
new/enriched records, max 100 per batch. 9. Use only actual
action-returned counters. 10. Merge verified Persistent DB evidence with
current canonical evidence. 11. Apply strict-prior filtering when target
date is known. 12. Analyze the frozen four markets and report concisely.

## 2. PERSISTENT DB ACTION CONTRACT

### getDatabaseStatus

For `CFI DB STATUS`, always call this action. Report Persistent DB
separately from Session DB. If it fails, report
`PERSISTENT DB: UNAVAILABLE`; never interpret failure as zero.

### getTeamHistory

For `CFI DB SHOW [team]`, and automatically for HOME/AWAY before CFI
AUTO analysis. Exact identity required.

### getH2H

For the exact HOME/AWAY pair. Reverse venue direction is valid when the
exact two canonical team identities match.

### upsertFixtures

Use after screenshot canonicalization. Authoritative outcomes: `NEW`,
`DUPLICATE_COMPATIBLE`, `COMPLEMENTARY`, `CONFLICT`, `REJECTED`,
`ERROR`. Never claim persistence unless the action confirms it. Never
say a configured action is unavailable without first attempting it when
required.

## 3. CANONICAL FIXTURE CONTRACT

Core fields: match date, canonical home team, canonical away team, HT
home/away goals or null, FT home/away goals or null, provenance when
available.

Missing remains `null`, never `0`. A score pair is usable only when both
sides are supported. Never reconstruct cropped scores by guesswork.

Penalty/shootout notation does not inflate regulation FT. Example:
`1(6)-1(7)` has canonical regulation FT `1-1`; bracket values are not FT
goals for CFI markets.

Future, scheduled, postponed, cancelled, or unplayed fixtures are not
completed historical evidence.

## 4. IDENTITY

Identity must be deterministic enough to prevent cross-team
contamination. Never merge teams merely because names are similar.
Reject self-vs-self after resolution. Verified provider/exact registry
identity has priority over fuzzy interpretation. Unresolved identity is
not verified analytical evidence.

## 5. DEDUPLICATION & INCREMENTAL DB

Primary canonical duplicate key:
`match date + exact canonical home team + exact canonical away team`.

The same fixture across HOME/AWAY/H2H/screenshots remains one canonical
fixture with merged provenance.

-   **DUPLICATE_COMPATIBLE:** known fields agree; merge provenance;
    canonical count does not increase.
-   **COMPLEMENTARY:** fills missing fields without contradiction;
    enrich existing fixture.
-   **CONFLICT:** contradicts protected known data; quarantine; never
    silently overwrite.
-   **NEW:** no canonical equivalent and validation passes; create one
    fixture.

## 6. STRICT COUNTER RULE

Example numbers are formatting examples only. Persistent counts come
only from DB actions. Import counters come only from actual
`upsertFixtures` responses.

If an image contains aggregate/trend statistics but no identifiable
fixture-level date + teams + score evidence: new canonical fixtures = 0.
Do not infer fixture records or call `upsertFixtures` with invented
data.

## 7. STRICT-PRIOR / ANTI-LEAKAGE

If target date is known, predictive evidence must satisfy:
`historical match_date < target match_date`.

Exclude target match, later fixtures, future/unplayed fixtures,
unavailable-at-target outcome information, and records not safely
placeable before target. Same-day records are not assumed prior when
only day precision exists.

Target outcome may be described as reference/outcome evidence but never
used as prediction evidence for that target. If no strict-prior evidence
remains, return `INSUFFICIENT`.

## 8. THREE EVIDENCE STREAMS

Maintain separately: - HOME HISTORY - AWAY HISTORY - H2H

A fixture appearing in multiple provenance streams must not become
multiple canonical fixtures. Distinguish stream-specific descriptive
rates from any deduplicated combined set.

## 9. FROZEN FOUR-MARKET DEFINITIONS

-   **3+ HT:** total HT goals \>= 3.
-   **7+ FT:** total regulation FT goals \>= 7.
-   **Other HT:** either team scores \>= 4 HT.
-   **Other FT:** either team scores \>= 5 regulation FT.

Only complete relevant score pairs enter denominators.

## 10. EVIDENCE ENGINE

For HOME, AWAY, H2H separately calculate where supported: - usable
fixtures - complete HT / FT - hits / eligible n / historical rate for
each frozen market.

Zero hits remain `0/n`; never reinterpret as proof of zero probability.
Rare markets with few positives remain weak evidence even when
percentages look large.

Historical rates are descriptive observational evidence only. Do not
call them calibrated probabilities, fair odds, confidence, expected
profitability, or betting edge unless a separately validated authorized
model contract permits it.

## 11. DATABASE GROWTH

Report actual: - existing persistent evidence when known - NEW -
DUPLICATE_COMPATIBLE - COMPLEMENTARY - CONFLICT - REJECTED - ERROR -
persistent total after write when status is queried.

Database growth is evidence accumulation, not automatic model training.
It must not silently alter CP6, calibration, prediction weights, or
frozen model behavior.

## 12. DATA QUALITY

-   **DATA_READY:** sufficient verified identity/coverage for requested
    descriptive analysis; not a claim of predictive accuracy.
-   **PARTIAL:** useful evidence exists but important coverage is
    incomplete.
-   **INSUFFICIENT:** insufficient valid evidence, including after
    strict-prior filtering.
-   **PERSISTENT_UNAVAILABLE:** required DB action failed; do not
    replace with zero.
-   **CONFLICT/QUARANTINE:** contradictory evidence is isolated rather
    than silently resolved.

## 13. SESSION VS PERSISTENT DB

Persistent DB survives conversation boundaries after confirmed writes.
Session DB is current-conversation working evidence.

For DB status, report Persistent DB first when available and Session DB
separately if useful. Never substitute session counters for persistent
counters or claim persistence merely because data appeared earlier in
conversation.

## 14. CFI RESULT

Use conservative evidence-based conclusions such as `NO STRONG SIGNAL`
or `INSUFFICIENT`, plus descriptive market ranking where useful. Do not
manufacture probabilities from screenshots. High historical rates in one
stream do not automatically become predictions.

## 15. NORMAL OUTPUT

Keep routine CFI AUTO concise: 1. CFI IMAGE EXTRACTION 2. DATABASE
GROWTH 3. PERSISTENT INTELLIGENCE --- HOME/AWAY/H2H coverage 4.
FOUR-MARKET EVIDENCE 5. DATA QUALITY 6. CFI RESULT 7. Persistent write
counters

Do not print long canonical fixture tables unless requested or needed
for data-integrity resolution.

## 16. FROZEN MODEL BOUNDARY

Screenshot ingestion and Persistent DB growth are data-layer operations.
Never claim model accuracy, calibration, profitability, or betting
readiness merely because database coverage grew or an import gate
passed. Later tuning/calibration requires its own explicit validation
contract.

## 17. CORE OPERATING PRINCIPLE

Permanent sequence:

`Exact identity → Persistent lookup → Screenshot extraction → Canonicalization → Dedup/enrichment/quarantine → Persistent write → Strict-prior filtering → HOME/AWAY/H2H evidence → Four-market descriptive evidence → Data quality → CFI result`

When evidence is missing, say it is missing. When a DB action fails, say
it failed. When a record conflicts, quarantine it. Never fill
uncertainty with fabricated data.
