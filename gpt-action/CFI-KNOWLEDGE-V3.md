# CFI KNOWLEDGE V3 — STABLE DOMAIN & DATA CONTRACT

Status: Production stable knowledge  
Scope: canonical football evidence, Persistent DB, screenshot ingestion, strict-prior, six-target semantics, Multi-Market, Champion Fusion semantics, runtime boundaries.

Dynamic fixtures, predictions, odds, results, promotion state, deployment/CI/PR status and runtime health MUST come from authorized Actions/runtime, not this file.

---

## 1. ROLE BOUNDARY

Knowledge defines stable CFI semantics and data-integrity rules.

It does NOT define current runtime state and does NOT replace production Actions.

CFI production is a prediction and ranking core for real identified fixtures.

Fixture acquisition may come from:

- user-supplied fixtures
- screenshots
- Local Node
- explicit Web Search
- verified external schedules

CFI core then performs:

real fixture input  
→ canonical identity  
→ deduplication  
→ temporal validation  
→ strict-prior BigDB evidence  
→ production prediction  
→ Champion six targets  
→ Multi-Market  
→ optional Champion Fusion shadow  
→ ranking / practical output.

Never manufacture a prediction from Knowledge, historical rates, screenshots, Web Search, conversation memory or File Library.

CFI probabilities are authoritative only when returned by the authorized production prediction engine.

---

## 2. PERSISTENT DB CONTRACT

Persistent DB is authoritative for persisted CFI evidence when corresponding Actions are available.

### getDatabaseStatus
For CFI DB STATUS, use the production DB status Action. Failure = `PERSISTENT_UNAVAILABLE`, never zero.

### getTeamHistory
Use for exact canonical team history when required.

### getH2H
Use for the exact canonical team pair. Reverse venue direction is valid only when the same two canonical identities match.

### upsertFixtures
Use only for validated fixture-level evidence.

Authoritative outcomes:
`NEW | DUPLICATE_COMPATIBLE | COMPLEMENTARY | CONFLICT | REJECTED | ERROR`

Never claim persistence without Action confirmation. Persistent counters come only from actual DB responses.

---

## 3. CANONICAL FIXTURE

Core fields include:
- verified match date/time when available
- canonical home team
- canonical away team
- HT home goals or null
- HT away goals or null
- FT home goals or null
- FT away goals or null
- competition
- provider
- provenance

Missing = `null`, never zero.

A score pair is usable only when both sides are supported. Never guess cropped, hidden or missing scores.

Penalty/shootout notation does not inflate regulation FT. Example: `1(6)-1(7)` → regulation FT = `1-1`.

Future, scheduled, postponed, cancelled and unplayed fixtures are not completed historical evidence.

---

## 4. IDENTITY

Identity rules must prevent cross-team contamination.

Never merge teams merely because names look similar.

Youth, reserve, academy, women and senior teams are separate entities unless the canonical registry explicitly proves otherwise.

Never silently map:
- U19 → senior
- U21 → senior
- reserve → first team
- women → men

Reject self-vs-self after resolution.

Verified provider/registry identity outranks fuzzy interpretation.

Unresolved identity is not verified analytical evidence.

---

## 5. DEDUPLICATION

Primary duplicate identity:
match date + exact canonical home + exact canonical away.

One real fixture remains one canonical fixture even when observed through HOME history, AWAY history, H2H, screenshots or multiple providers.

### DUPLICATE_COMPATIBLE
Known protected fields agree. Merge provenance. Canonical fixture count does not increase.

### COMPLEMENTARY
Adds previously missing fields without contradiction.

### CONFLICT
Contradicts protected known data. Quarantine. Never silently overwrite.

### NEW
No canonical equivalent exists and validation passes.

---

## 6. FIXTURE ACQUISITION BOUNDARY

Fixture acquisition is separate from prediction.

Normal sources may include:
- User
- Local Node
- explicit Web Search
- screenshot/export
- other verified schedule feeds

The CFI prediction core does NOT need to autonomously crawl until a quota such as five fixtures is reached.

A supplied candidate set may contain 1, 2, 5, 10 or more fixtures.

CFI ranks only candidates that survive canonical identity, temporal, strict-prior, evidence and runtime-contract gates.

A short fixture list is not automatically a production failure.

`max_matches` means maximum rows returned, not a requirement to manufacture or discover that many.

If explicit external fixture search is requested:
search → verify teams/date/kickoff/provenance → construct fixture candidates → send them to CFI.

Web Search does not generate CFI probabilities.

---

## 7. SCREENSHOT / IMAGE INGESTION

Screenshots are optional evidence and input sources.

When supplied:
identify fixture/team → classify match state → extract only visibly supported facts → canonicalize → deduplicate → quarantine conflicts → persist only validated fixture-level evidence when authorized.

Screenshots may provide HOME/AWAY, competition, date/countdown, bookmaker, market line, visible odds and match state.

Aggregate/trend statistics without identifiable fixture-level date + teams + score do not create canonical fixtures.

Never invent fixture records from aggregate statistics.

Raw screenshot content does not automatically become strict-prior model evidence.

Screenshot ingestion does not itself prove prediction accuracy or model readiness.

---

## 8. MATCH STATE

Stable states:
`PRE_MATCH | COUNTDOWN | LIVE | HT | FT | UNKNOWN`

Countdown `HH:MM:SS` without kickoff proof is not elapsed football time.

A generic `Live` label alone does not prove LIVE.

LIVE requires positive post-kickoff evidence such as elapsed football minute, active 1H/2H clock or confirmed post-kickoff event.

When uncertain, remain PREMATCH or UNKNOWN according to production routing rules.

LIVE/HT/FT evidence must never reconstruct or modify PREMATCH predictions.

---

## 9. STRICT-PRIOR / ANTI-LEAKAGE

Predictive evidence must have been available before the target fixture.

Core rule: `fixtureDate < targetDate` or the stricter target-kickoff rule enforced by runtime.

Exclude target match outcome, later/future fixtures, post-match information, evidence unavailable at prediction time, records that cannot safely be placed before kickoff, and reconstructed historical predictions.

When only day-level precision exists, same-day records are not automatically prior.

Never reconstruct a prediction after the result is known. Never modify an immutable prediction. Never replay an old snapshot and label it NEW.

File Library is not authoritative production prediction history.

If valid prior evidence is insufficient, fail closed.

---

## 10. EVIDENCE STREAMS

Maintain provenance separately when relevant:
- HOME HISTORY
- AWAY HISTORY
- H2H

The same real fixture appearing in multiple streams remains one canonical fixture.

Stream-specific descriptive statistics may remain separate from the deduplicated canonical set.

Historical rates are observational evidence only. They are NOT automatically calibrated CFI probabilities, fair odds, profitability estimates or betting edge unless an authorized validated runtime model explicitly returns those values.

Zero historical hits = `0/n`. It does not prove zero future probability.

---

## 11. SIX PRIMARY TARGETS

CFI production has exactly six primary Champion targets.

1. `3+ HT`: HT total goals >= 3.
2. `7+ FT`: regulation FT total goals >= 7.
3. `Other HT`: either team scores >= 4 goals in HT.
4. `Other FT`: either team scores >= 5 goals in regulation FT.
5. `Top-3 HT`: three highest-probability exact HT scorelines returned by the engine.
6. `Top-3 FT`: three highest-probability exact FT scorelines returned by the engine.

The first four are threshold events.

Top-3 coverage is probability mass over selected scorelines and must not be interpreted as the same quantity as a threshold probability.

Never describe current CFI production as a four-target system.

---

## 12. TWO-METHOD SEMANTICS

All six Champion targets are evaluated by the authorized engine using:

### METHOD A
Historical/statistical branch.

### METHOD B — FUTURE SIX
Independent model branch using Goal Tempo, Dominance, Collapse Risk, Comeback / Surge, Volatility and Extreme Score Pressure.

### FINAL CFI
Production reconciliation of Method A and Method B.

Knowledge defines these semantics only.

GPT must never calculate Method B itself, copy Method A into Method B, manually average A/B, override FINAL or reconstruct missing probabilities.

The production runtime is authoritative.

---

## 13. MULTI-MARKET BOUNDARY

Runtime may expose additive Multi-Market output:
- 1X2 HT
- 1X2 FT
- Over/Under ladders HT
- Over/Under ladders FT
- projected Total Goals
- Asian Handicap HT
- Asian Handicap FT
- quarter-line AH when supported

Values, probabilities, fair prices, status and `decisionUse` come from authorized runtime output.

Research-only markets remain `SHADOW_RESEARCH` with `decisionUse=false`.

Knowledge cannot promote a market. `SHADOW != ACTIONABLE`.

Cross-market consistency/coherence guards returned by runtime must be respected. Do not silently repair contradictions. Do not infer a missing market from another market.

Without verified bookmaker odds, model probability does not prove VALUE or positive EV.

---

## 14. CHAMPION FUSION V1

Runtime may return an additive object named `championFusion`.

Champion Fusion V1 is a score-distribution fusion layer. It combines multiple expert distributions through context-adaptive weighting, creates a fused latent HT/FT distribution, then derives markets consistently from that same distribution.

Intended derivation:
expert score distributions → context-adaptive gating → fused HT/FT distribution → Champion threshold targets → Top-3 HT/FT → 1X2 HT/FT → O/U HT/FT → AH HT/FT → coherence checks.

This architecture is intended to reduce contradictory probabilities across markets.

### V1 active experts
Stable semantic roles:
- `INCUMBENT_FINAL` — incumbent production distribution / safety anchor
- `FUTURE_SIX` — tempo, dominance, collapse, volatility and extreme-tail specialist
- `HISTORICAL_RECENCY` — empirical recent-history stabilizer

Runtime remains authoritative for the actual active expert list.

### Candidate / research experts
These may exist as research candidates and MUST NOT be silently activated:
- F5 Temporal Calibration
- F10P Pruned Full Fusion
- K048 joint HT→FT trajectory specialist
- K034 real-market intensity specialist

Knowledge does not promote them.

### Fusion output may include
version, lineage, status, activeExperts, candidateExperts, gating weights for HT/FT, expert disagreement, uncertainty level/confidence, abstain flag/reasons, fused four threshold targets, fused Top-3 HT/FT, fused 1X2/O-U/AH HT/FT, quarter lines, coherence/consistency status and strict-prior audit.

### Fusion hard rules
If `decisionUse=false` or `status=SHADOW_RESEARCH`, Champion Fusion is SHADOW only.

It must NOT become BET/LEAN, override incumbent FINAL, replace incumbent Champion, be described as promoted/production-superior, or be used to guarantee a result.

If `uncertainty.abstain=true`, preserve `ABSTAIN` and its reasons. Do not reinterpret abstention as confidence.

Until formal promotion, production presentation keeps incumbent Champion 2 Methods × 6 Targets + incumbent Multi-Market + Champion Fusion as additive SHADOW_RESEARCH.

Formal promotion requires authorized historical and prospective evidence. Knowledge alone cannot promote Fusion.

---

## 15. FUSION SETTLEMENT

Champion Fusion evaluation must use the immutable Fusion snapshot created before kickoff.

Settlement pair:
immutable incumbent prematch snapshot + immutable championFusion prematch snapshot + same verified actual HT/FT.

Never recompute Fusion after seeing the result.

Never construct a historical Fusion prediction from current model state and present it as an original prematch prediction.

Paired evaluation may compare incumbent vs Fusion on the same outcome set.

When returned by authorized research/settlement runtime, metrics may include Brier, log-loss, calibration, Top-3 accuracy, threshold-event accuracy, coherence, segment performance and Multi-Market performance.

Model promotion cannot be inferred from one match or a small anecdotal sample.

---

## 16. DATA QUALITY

`DATA_READY`: verified identity and coverage are sufficient for the requested operation; not a guarantee of prediction accuracy.

`PARTIAL`: useful verified evidence exists, but important coverage is incomplete.

`INSUFFICIENT`: valid evidence is insufficient, including after strict-prior filtering.

`PERSISTENT_UNAVAILABLE`: a required Persistent DB operation failed.

`CONFLICT / QUARANTINE`: contradictory evidence has been isolated.

Missing information must remain missing.

---

## 17. SESSION VS PERSISTENT

Persistent DB survives conversation boundaries only after confirmed writes.

Session evidence is temporary working context.

Never substitute session counts for Persistent DB counts. Never claim persistence because information appeared earlier in a conversation. Never use File Library as authoritative production prediction history.

---

## 18. DATABASE GROWTH

Database growth is evidence accumulation. It is not automatic model training.

Imports must not silently alter model weights, calibration, Champion logic, Method A, Method B, Multi-Market promotion, Fusion expert activation or prediction behavior.

Model/calibration/Fusion changes require their own validated research and production contracts.

---

## 19. RUNTIME TRUTH

Current runtime state must come from authorized Actions/runtime.

This includes current fixture acceptance, canonical resolution, prediction execution, current probabilities, current odds, current Multi-Market state, current Fusion state, prediction history, settlement status, market promotion state and runtime health.

GitHub merge, CI pass, deployment success or documentation does not prove a prediction executed successfully.

If the prediction Action did not successfully execute, GPT must not substitute its own prediction.

---

## 20. RUNTIME CONTRACT

Successful Champion production output requires runtime confirmation of the canonical six-target contract.

Expected contract: `CFI_2_METHODS_X_6_TARGETS_V1`.

A valid successful output must preserve Method A, Method B — Future Six, FINAL, all four threshold targets, Top-3 HT and Top-3 FT.

If the runtime reports the contract incomplete, do not reconstruct missing output. Return the runtime contract failure.

Champion Fusion is additive and does not replace this incumbent contract while shadow-only.

---

## 21. SETTLEMENT

Settlement compares verified actual results only against immutable pre-match prediction snapshots created before the target match.

Never reconstruct predictions after knowing HT/FT.

When runtime provides them, settlement may report threshold HIT/MISS, Top-3 HT HIT@3, Top-3 FT HIT@3, Top-1, rank-of-hit, Brier, log-loss, calibration, Multi-Market settlement, Fusion paired settlement and settlement status.

Actual results do not retroactively modify prediction snapshots.

---

## 22. BETTING / DECISION BOUNDARY

Probability does not guarantee a winning outcome.

Model confidence and evidence quality are different concepts.

A practical VALUE/BET claim requires the authorized runtime gates.

If bookmaker odds are unavailable or unverified, do not claim positive EV or VALUE.

If a market has `decisionUse=false`, it is not actionable.

Do not lower thresholds to manufacture recommendations.

`NO_BET`, `WATCH`, `LEAN` or `ABSTAIN` are valid production outcomes when returned by runtime.

---

## 23. CORE OPERATING PRINCIPLE

Permanent CFI integrity sequence:

real fixture input → exact canonical identity → verified fixture facts → deduplication / enrichment / quarantine → confirmed persistence when required → strict-prior filtering → production engine execution → runtime contract validation → incumbent Champion 2 Methods × 6 Targets → Multi-Market → optional Champion Fusion shadow → practical output / ranking → immutable settlement.

Fixture acquisition occurs before the prediction sequence and may be supplied by User, Local Node, screenshots or explicit Web Search.

CFI does not need to autonomously find enough fixtures to satisfy a fixed quota.

When evidence is missing, say it is missing. When identity is unresolved, reject it. When an Action fails, report the failure. When a record conflicts, quarantine it. When prediction did not execute, do not create a replacement prediction. When Fusion is SHADOW, keep it SHADOW. Never fill uncertainty with fabricated data.
