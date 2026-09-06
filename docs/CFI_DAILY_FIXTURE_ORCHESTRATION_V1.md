# CFI Daily Fixture Orchestration V1

## Goal

Build a shadow/read-only orchestration layer that discovers as many prematch fixtures as possible, retains a daily fixture registry, and exposes an overlapping rolling prediction horizon without making PC-Node a gatekeeper.

## Non-goals

- No production prediction mutation.
- No automatic betting or stake execution.
- No changes to frozen 3+ HT, 7+ FT, Other HT, or Other FT definitions.
- No automatic kickoff correction.
- No fuzzy identity reconstruction.
- No canonical BigDB writes from this feature.

## Authority boundaries

Existing canonical fixture authority remains unchanged. This layer never replaces `cfi_upsert_fixture` and never silently resolves canonical conflicts.

The orchestrator accepts additive discovery observations from any available source, including:

- PC-Node/local collectors;
- CFI public-provider discovery;
- BigDB/known prematch fixture sources;
- audited web-search candidates.

No source is mandatory. In particular, PC-Node absence must not suppress a fixture discovered elsewhere.

## Daily Fixture Registry

Registry identity is the exact/canonical home identity + exact/canonical away identity + target local date. A registry entry retains:

- firstSeenAt / lastSeenAt;
- all source observations and provenance;
- all observed kickoff candidates;
- current-cycle source coverage;
- conflict state;
- shadow-only decisionUse=false.

Repeated identical observations are idempotent. Source failure or absence never deletes a previously seen fixture.

If the same identity/date has more than one distinct kickoff, the entry becomes `CONFLICT_FAIL_CLOSED`. The registry does not average, prefer, or overwrite kickoff times. Upstream canonical fail-closed states also propagate into the registry and rolling gate.

## Rolling horizon

The prediction horizon is rolling, not a rigid 90-minute block. Default horizon: 90 minutes. A 15-minute scheduler can therefore evaluate overlapping windows such as:

- 14:00 -> 14:00-15:30
- 14:15 -> 14:15-15:45
- 14:30 -> 14:30-16:00

Only future, non-conflicted fixtures enter the rolling prediction queue. A fixture can be rediscovered in multiple overlapping windows without creating a duplicate registry entry.

## Phase 2 source model

Three source classes are measured independently:

1. `PC_NODE` — existing local Football-Data / Soccerway / Sofascore canonical path.
2. `PUBLIC_DISCOVERY` — existing CFI public discovery path using Sofascore, TheSportsDB and ESPN fallbacks.
3. `WEB_SEARCH_RESCUE` — externally discovered candidates that pass the existing GPT search-first validation contract.

The three source runners are isolated. A failure in one does not prevent the registry from executing. The orchestrator reports `PASS_WITH_SOURCE_FAILURES` when one or more source stages fail but the registry still completes.

### Public discovery

`local-node/registry/public-discovery.mjs` executes the existing `discoverFixtures()` implementation and writes a shadow supplement snapshot. It requests the broadest currently supported pool (`minimumRows=100`) while retaining the existing provider implementation instead of creating a duplicate provider pipeline.

### Web-search rescue

`local-node/registry/web-search-rescue.mjs` reads candidate JSON and reuses `normalizeAiFixtureCandidates()`. A rescue candidate is rejected unless it has:

- exact home and away labels;
- provider ID;
- valid kickoff;
- HTTPS provenance;
- valid discovery timestamp;
- same target local date;
- prematch/future status.

Web search is therefore additive evidence, not an unaudited fixture injection path.

### Snapshot freshness

Public and web rescue snapshots have a default 30-minute TTL. Stale or future-dated snapshots are not re-ingested as current-cycle evidence. Previously registered fixtures remain in the daily registry, but they become `seenInCurrentCycle=false` until a source observes them again.

## Coverage telemetry

The registry reports observable coverage metrics rather than claiming global fixture recall without an authoritative denominator.

Phase 2 adds a three-source coverage matrix:

- union fixtures;
- PC-Node fixtures;
- public-discovery fixtures;
- web-search-rescue fixtures;
- PC-only / public-only / web-only;
- pairwise overlaps;
- all-three overlap;
- rescued without PC-Node;
- rescued by public discovery;
- rescued by web search.

`rescuedWithoutPcNode` is specifically intended to prove that PC-Node is additive rather than a gatekeeper.

## Commands

- `npm run cfi:public-discovery`
- `npm run cfi:web-rescue`
- `npm run cfi:registry`
- `npm run cfi:orchestrator:once`
- `npm run cfi:orchestrator`

## Safety state

All Phase 1/2 outputs remain:

- `decisionUse=false`;
- `bigDbWriteAllowed=false`;
- `bigDbWriteAttempted=false`;
- no production scheduler activation;
- no prediction weight/calibration mutation.

## Promotion gate

Do not merge into an active production schedule until:

1. deterministic CI is green;
2. real current-day source coverage has been sampled;
3. public/web rescue demonstrates recovered PC misses without identity leakage;
4. kickoff conflict behavior is observed and remains fail-closed;
5. source-failure cycles preserve prior registry state;
6. a soak run shows stable duplicate/conflict/coverage counters.
