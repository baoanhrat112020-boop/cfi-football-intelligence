# CFI Independent AI Auditor V1

## Purpose

CFI Independent AI Auditor V1 adds a second, independent review layer above the existing deterministic `tools/cfi-audit.mjs` gate.

The two layers have different responsibilities and must not be collapsed into one system:

1. **Zero-AI deterministic auditor** — tests, strict contracts, static guards, Wrangler dry-run, secret scanning, shadow isolation checks, and repeatable fail-closed rules.
2. **Independent AI reviewer** — challenges architecture, hidden regressions, test quality, research validity, settlement integrity, Multi-Market impact, duplicate pipelines, leakage risk, and scope drift that can survive deterministic tests.

The AI reviewer is not the CFI prediction engine and has no production mutation authority.

## Default provider

V1 uses **GitHub Copilot Code Review** as the independent reviewer. The workflow requests `copilot-pull-request-reviewer[bot]` after the deterministic gate passes, waits for review evidence tied to the current PR head, parses the required structured verdict, and fails closed when the verdict is absent or malformed.

The parser and promotion gate are provider-neutral. A later provider can be substituted by producing the same `CFI_AI_AUDIT_V1` structured footer and the same report contract; promotion logic does not need to change.

## Pipeline

```text
PR / code change
  -> CFI zero-AI deterministic auditor
  -> independent AI reviewer
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

Missing, incomplete, malformed, or stale-head evidence is not approval.

## Fail-closed normalization

The deterministic parser can make an AI verdict stricter but never weaker:

- P0/P1 => `BLOCK_PROMOTION`.
- STRICT_PRIOR != PASS => `BLOCK_PROMOTION`.
- SETTLEMENT_INTEGRITY != PASS => `BLOCK_PROMOTION`.
- SHADOW_ISOLATION != PASS => `BLOCK_PROMOTION`.
- P2 => at least `FIX_REQUIRED`.
- MULTI_MARKET / ARCHITECTURE / TEST_EVIDENCE != PASS => at least `FIX_REQUIRED`.
- Missing structured evidence => `BLOCK_PROMOTION`.

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
```

The JSON report is machine-readable and the Markdown report is added to the GitHub Actions job summary.

## Safety boundary

A `PASS` means the independent AI review gate found no blocking issue under the contract. It does **not** mean:

- automatic merge is allowed;
- automatic production promotion is allowed;
- the AI may modify production code/data;
- deterministic checks may be skipped;
- historical predictions may be reconstructed.

The independent AI layer complements deterministic validation; it never replaces it.
