# CFI FINALIZE — Autonomous Codex Mission

## ONE-LINE COMMAND FOR CODEX
`Read AGENTS.md and CODEX_FINALIZE.md, inspect the entire repository, then autonomously implement, test, fix, and finish CFI end-to-end until every acceptance gate below passes; do not stop for intermediate manual QA, do not invent data or secrets, preserve frozen market/canonical semantics, and return only the final production-ready result with changed files, tests, deployment status, and any truly external blocker.`

## Objective
Finish CFI as a usable production football-intelligence system, not a prototype. The user should be able to use the deployed web app and GPT Action without being turned into a QA tester.

## Frozen contracts — MUST NOT CHANGE
Obey AGENTS.md exactly.
- `cfi_upsert_fixture` remains canonical single-fixture authority.
- Conflicts are quarantined; never silently overwritten.
- Missing scores remain null, never zero.
- Future/target fixtures are never historical evidence.
- 3+ HT = HT total >= 3.
- 7+ FT = FT total >= 7.
- Other HT = either team HT >= 4.
- Other FT = either team FT >= 5.
- Do not commit secrets.

## Current production facts to preserve
- Cloudflare Worker hostname: `cfi-football-intelligence.baoanhrat112020.workers.dev`.
- Persistent DB is Supabase-backed through Worker secrets/bindings.
- Screenshot merge and canonical DB already exist.
- Current fallback engine has reached `CFI_PERSISTENT_FALLBACK_V4.6.2` and correctly reads canonical score columns including `ht_home`, `ht_away`, `ft_home`, `ft_away`.
- Verified example has 21 HOME + 21 AWAY + 2 H2H, with HT/FT coverage 44/44.
- GPT Action calls Worker `/api/predict`.

## Required final architecture
Use one stable production prediction path:

`GPT/Web UI -> Cloudflare /api/predict -> canonical data adapter -> strict-prior evidence -> feature engine -> Method A + Method B -> calibrated synthesis -> scoreline model -> uncertainty -> localized response`

The legacy Supabase `/predict` endpoint may remain as an optional upstream source, but `NOT_FOUND` must never make a valid match unusable. The Worker/native prediction engine must be capable of producing the complete result directly from Persistent DB evidence.

## 1. Canonical data adapter
Create one reusable adapter that normalizes every supported fixture response shape into one internal fixture type.
It must support at minimum:
- `ht_home`, `ht_away`, `ft_home`, `ft_away`
- nested `{ ht:{home,away}, ft:{home,away} }`
- string score forms such as `"1-0"`
- common response wrappers already used by CFI (`fixtures`, `history`, `rows`, `data`, nested result/body forms)

Add tests proving equivalent normalization for all supported shapes.

## 2. Strict-prior evidence engine
For target date D, evidence must satisfy `match_date < D`.
Return explicit counts:
- home fixtures
- away fixtures
- H2H fixtures
- unique canonical evidence count
- HT coverage
- FT coverage

Avoid double-count inflation: HOME/AWAY/H2H streams may overlap. Use stream counts for reporting, but compute global statistics from a deduplicated canonical fixture set whenever the same fixture appears in multiple streams.

## 3. Team Trending DNA
Implement a real, explicit Team Trending DNA feature set rather than prose-only interpretation.
Include where supported:
- recency-weighted GF/GA
- HT/FT goal distributions
- home/away split
- scoring/conceding streaks
- high-score and low-score clusters
- acceleration/deceleration of scoring
- extreme-score recurrence
- goal-timing profile when data exists
- lead/trail behavior when derivable
- collapse-risk proxy

Expose the numeric/structured factors used by the model so the output can explain itself.

## 4. Method A — historical/statistical
For each frozen market, compute a robust historical estimate using:
- eligible denominator only
- Bayesian/Beta smoothing so zero hits never becomes literal 0 probability
- HOME/AWAY relevance
- H2H only at bounded weight because sample sizes are often tiny
- recency weighting
- opponent-strength adjustment only if supported by data; otherwise mark unavailable

Never produce fake precision from tiny samples.

## 5. Method B — Match DNA/context
Build Method B from available structured context, including:
- recent Team Trending DNA
- home/away form
- attack/defense balance
- H2H context
- standings/opponent strength when available
- rest/fatigue/schedule congestion when available
- lineup/injury/suspension/goalkeeper/starting-XI continuity when available
- tactical/tempo context when available
- live momentum and red-card mode when live data is supplied
- randomness allowance

Unavailable factors must be `unavailable`, not fabricated.

## 6. Final CFI calibration
Do not simply average A and B.
Implement calibrated synthesis with bounded weights based on:
- sample size
- evidence completeness
- recency relevance
- H2H sample reliability
- model disagreement

Use historical strict-prior backtesting to calibrate weights without leakage. At minimum:
- walk-forward/time-split evaluation
- Brier score for each of the four markets
- calibration error/reliability buckets where sample size permits
- compare Method A, Method B, and Final

Persist calibration parameters in versioned config/code, not hidden mutable state.
Database growth must not silently change calibration.

## 7. Scoreline Intelligence
Return for both HT and FT:
- Top 3 scorelines with normalized probabilities
- expected HOME goals
- expected AWAY goals
- most likely HT -> FT path
- uncertainty/spread

Scoreline and market probabilities must be internally cross-checked.
Add consistency warnings for contradictions such as a very low 3+ HT probability while scoreline mass heavily favors 3+ HT outcomes.

Do not use a hard-coded lambda floor that creates artificial 0-0 dominance when coverage exists.

## 8. Four-market result contract
For every market return a stable object with at least:
- `methodA`
- `methodB`
- `final`
- `confidence`
- `hits`
- `eligible`
- `rawRate`
- `smoothedRate`
- key supporting factors
- key opposing factors

A `NO_STRONG_SIGNAL` verdict is allowed but MUST still include the complete analysis.

## 9. Language/output localization
Support at least:
- `vi` Vietnamese (default)
- `en` English
- `zh` Chinese
- `th` Thai
- `id` Indonesian

Keep team names, numbers, market definitions, and database classifications invariant.
Return a machine-readable language code in API output.

## 10. Smart Image Intake
Preserve and harden the current single-upload UX:
- user uploads unlabeled screenshots
- CFI identifies likely target HOME/AWAY when evidence supports it
- auto-classifies HOME/AWAY/H2H/RELATED
- extracts only visibly supported fixtures
- canonicalizes/deduplicates
- merges through screenshot merge
- quarantines conflicts
- automatically runs prediction after successful merge

Never infer missing scores as zero.
Never write ambiguous target identity as canonical fact.

## 11. Live / red-card intelligence
When a verified live red card is supplied, evaluate:
- team receiving card
- minute
- score state
- historical response of that team to red cards if data exists
- opponent behavior against 10 players if data exists
- collapse-risk change
- attacking-surge change
- market probability deltas for all four markets
- scoreline forecast delta

Return a prominent alert only when evidence supports a meaningful shift.

## 12. Web app
Finish the existing Cloudflare dashboard for practical use on phone and desktop.
It must expose:
- HOME / AWAY
- language selector
- Smart Image Intake
- 4 market cards with Method A / B / Final
- Scoreline HT/FT top 3
- Team Trending DNA
- key analysis factors
- data quality/coverage
- final ranking/verdict
- clear loading/error states

No manual stat-entry fields.

## 13. GPT Action
Keep the GPT Action stable and production-usable.
`POST /api/predict` must accept:
```json
{"home":"...","away":"...","target_date":"YYYY-MM-DD","language":"vi"}
```
It must return the complete result in one call whenever Persistent DB has usable evidence.

`GET /api/status` must expose health/version/database connectivity without leaking secrets.

## 14. Self-test and regression suite
Codex must run and fix tests until all pass.
Minimum tests:
1. canonical score-shape normalization
2. strict-prior leakage rejection
3. overlapping HOME/AWAY/H2H deduplication
4. zero-hit Bayesian smoothing
5. four frozen market definitions
6. scoreline normalization and consistency
7. language field behavior
8. screenshot merge idempotency contract
9. historical CSV 380 NEW -> rerun 380 DUPLICATE_COMPATIBLE regression
10. current production fallback example yields nonzero HT/FT coverage
11. `/api/predict` returns complete Method A/B/Final + scoreline contract even if upstream `/predict` is NOT_FOUND
12. invalid/missing data never becomes fabricated zero scores

## 15. Historical backtest acceptance
Run a strict-prior backtest on as much existing canonical history as practical without leakage.
Report:
- evaluated match count
- each market prevalence
- Brier score Method A
- Brier score Method B
- Brier score Final
- calibration summary
- scoreline top-1/top-3 hit rates if enough data exists

Do not claim accuracy improvements unless the measured backtest supports them.

## 16. Production gate
Before declaring completion:
- typecheck/build passes
- automated tests pass
- no secrets in git
- Cloudflare entrypoint points to the final production worker
- `/health` and `/api/status` succeed
- `/api/predict` works on the known example without 0/0 denominator
- web dashboard renders the final fields
- GPT Action schema remains compatible
- README documents one final user workflow, not a long QA procedure

## Final response from Codex
Do not stop at a plan. Implement and self-correct until done.
Return only:
- final version
- final commit/branch/PR if applicable
- tests and backtest summary
- production URL
- one example prediction response
- only genuine external blockers that cannot be solved from the repository/runtime
