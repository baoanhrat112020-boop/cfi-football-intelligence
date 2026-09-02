# CFI Independent AI Auditor V1

## Purpose

CFI Independent AI Auditor V1 adds a second, independent review layer above the existing deterministic `tools/cfi-audit.mjs` gate.

The two layers have different responsibilities and must not be collapsed into one system:

1. **Zero-AI deterministic auditor** — tests, strict contracts, static guards, Wrangler dry-run, secret scanning, shadow isolation checks, and repeatable fail-closed rules.
2. **Independent AI reviewer** — challenges architecture, hidden regressions, test quality, research validity, settlement integrity, Multi-Market impact, duplicate pipelines, leakage risk, and scope drift that can survive deterministic tests.

The AI reviewer is not the CFI prediction engine and has no production mutation authority.

## Default provider

V1 uses **Cloudflare Workers AI** with `@cf/zai-org/glm-4.7-flash` as the independent reviewer. The provider is outside the CFI prediction runtime and is invoked only after the deterministic `CFI Tests` workflow succeeds.

The parser and promotion gate remain provider-neutral: any future independent reviewer must produce the same `CFI_AI_AUDIT_V1` structured footer and report contract.

## Trusted execution boundary

The PR workflow is intentionally secret-free. It runs CFI code and the zero-AI auditor, then uploads the deterministic report.

The AI workflow is a separate trusted `workflow_run` workflow stored on the default branch. It:

- starts only after `CFI Tests` completes successfully for a pull request;
- checks out the auditor from the default branch, never the untrusted PR head;
- downloads the deterministic audit artifact from the completed upstream run;
- fetches PR metadata and the unified diff as read-only evidence;
- treats all PR diff text as untrusted data and ignores instructions embedded in it;
- calls Workers AI using repository secrets available only to the trusted workflow;
- has GitHub permissions limited to `actions: read`, `contents: read`, and `pull-requests: read`;
- never executes PR code with the Cloudflare API token;
- never deploys Cloudflare, Supabase, or production CFI resources.

This boundary is required. Do not move `CLOUDFLARE_API_TOKEN` into a workflow that executes code from a PR head.

## Pipeline

```text
PR / code change
  -> CFI Tests (no AI secrets)
     -> zero-AI deterministic auditor
     -> deterministic audit artifact
  -> trusted workflow_run on default branch
     -> Cloudflare Workers AI independent review
     -> structured verdict parser
     -> PASS | FIX_REQUIRED | BLOCK_PROMOTION
     -> report artifact
  -> human-controlled merge / promotion decision
```

No stage automatically promotes an experimental model or writes production prediction/settlement state.

## Structured verdict

The AI reviewer must emit:

```text
CFI_AI_AUDIT_V1
VERDICT: PASS|FIX_REQUIRED|BLOCK_PROMOTION
HIGHEST_SEVERITY: NONE|P3|P2|P1|P0
STRICT_PRIOR: PASS|FAIL|UNKNOWN
SETTLEMENT_INTEGRITY: PASS|FAIL|UNKNOWN
SHADOW_ISOLATION: PASS|FAIL|UNKNOWN
MULTI_MARKET: PASS|FAIL|UNKNOWN
ARCHITECTURE: PASS|FAIL|UNKNOWN
TEST_EVIDENCE: PASS|FAIL|UNKNOWN
END_CFI_AI_AUDIT_V1
```

Missing, incomplete, malformed, stale-head, empty-diff, provider-error, or over-limit evidence is not approval.

## Fail-closed normalization

The deterministic parser can make an AI verdict stricter but never weaker:

- P0/P1 => `BLOCK_PROMOTION`.
- STRICT_PRIOR != PASS => `BLOCK_PROMOTION`.
- SETTLEMENT_INTEGRITY != PASS => `BLOCK_PROMOTION`.
- SHADOW_ISOLATION != PASS => `BLOCK_PROMOTION`.
- P2 => at least `FIX_REQUIRED`.
- MULTI_MARKET / ARCHITECTURE / TEST_EVIDENCE != PASS => at least `FIX_REQUIRED`.
- Missing or malformed structured evidence => `BLOCK_PROMOTION`.
- PR head mismatch => `BLOCK_PROMOTION`.
- PR diff larger than the single-review budget => `BLOCK_PROMOTION`; never silently truncate the diff.
- Workers AI HTTP/auth/model failure => `BLOCK_PROMOTION`.

## Promotion contract

`research/independent-ai-promotion-gate.mjs` accepts only an explicit isolated `PASS` audit with:

- `contract = CFI_INDEPENDENT_AI_AUDITOR_V1`
- `verdict = PASS`
- `promotionAllowed = true`
- `decisionUse = false`
- `productionMutationAllowed = false`

Anything else produces `BLOCK_PROMOTION`.

## CFI review dimensions

The independent reviewer must evaluate changes against:

- strict-prior / temporal leakage;
- immutable pre-kickoff prediction snapshots;
- append-only settlement and verified actual HT/FT evidence;
- no post-result prediction reconstruction;
- research/shadow isolation;
- Champion/challenger separation;
- Multi-Market calibration, cross-market coherence and regressions;
- no metric cherry-picking for promotion;
- exact/fail-closed team identity resolution;
- no duplicate provider/prediction pipelines;
- frozen R0 lineage preservation;
- test quality rather than test pass count alone;
- no fabrication of fixtures, odds, evidence, results or benchmarks.

## Report artifacts

Workflow artifacts are written under:

```text
audit-reports/independent-ai/latest.json
audit-reports/independent-ai/latest.md
audit-reports/independent-ai/review.txt
```

`review.txt` contains the external model's review text. Reports must never contain Cloudflare or GitHub tokens.

## Safety boundary

A `PASS` means the independent AI review gate found no blocking issue under the contract. It does **not** mean:

- automatic merge is allowed;
- automatic production promotion is allowed;
- the AI may modify production code/data;
- deterministic checks may be skipped;
- historical predictions may be reconstructed.

The independent AI layer complements deterministic validation; it never replaces it.
