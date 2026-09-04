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

If the same identity/date has more than one distinct kickoff, the entry becomes `CONFLICT_FAIL_CLOSED`. The registry does not average, prefer, or overwrite kickoff times.

## Rolling horizon

The prediction horizon is rolling, not a rigid 90-minute block. Default horizon: 90 minutes. A 15-minute scheduler can therefore evaluate overlapping windows such as:

- 14:00 -> 14:00-15:30
- 14:15 -> 14:15-15:45
- 14:30 -> 14:30-16:00

Only future, non-conflicted fixtures enter the rolling prediction queue. A fixture can be rediscovered in multiple overlapping windows without creating a duplicate registry entry.

## Coverage telemetry

The registry reports observable coverage metrics rather than claiming global fixture recall without an authoritative denominator:

- registry fixture count;
- fixtures seen in the current cycle;
- source observation counts;
- multi-source vs single-source entries;
- kickoff conflicts;
- fixtures eligible for the rolling horizon;
- fixtures rescued without PC-Node evidence.

`rescuedWithoutPcNode` is specifically intended to prove that PC-Node is additive rather than a gatekeeper.

## Phase 1 integration

1. Implement source-agnostic registry/rolling-horizon core.
2. Add contract tests for idempotency, source independence, conflict fail-closed, and overlapping 90-minute windows.
3. Add a Local Node shadow stage after canonical merge that updates a local daily registry JSON and rolling-window JSON.
4. Keep `bigDbWriteAllowed=false`, `bigDbWriteAttempted=false`, and `decisionUse=false`.

## Phase 2 (after Phase 1 gates pass)

Wire cloud discovery/web-search observations into the same registry contract, add a discovery-coverage watchdog, then feed only rolling-window eligible fixtures to the existing CFI evidence/prediction path. Promotion to production requires explicit validation of fixture coverage, identity safety, conflict behavior, and no regression in existing discovery tests.
