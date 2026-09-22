# CFI — Football Intelligence: Project Briefing (for AI agents)

This document exists so another AI session (a fresh Claude Code session, ChatGPT, or any other agent) can quickly understand what CFI is, how it is built, and what "exporting to an unsigned IPA" means in this project — without re-deriving it from scratch by reading the whole codebase.

## 1. What CFI is

CFI (Cfi Football Intelligence) is a football-match prediction system with one non-negotiable design principle: **fail-closed, never fabricate**. It will refuse to produce a number rather than guess when evidence is thin, unverified, or the teams cannot be identified with certainty. The full frozen behavioral contract lives in `AGENTS.md` at the repo root — any agent working on this repo must read that file first.

Core prediction targets (4 frozen markets, defined in `AGENTS.md` and never to be redefined):
- **3+ HT**: total half-time goals ≥ 3
- **7+ FT**: total full-time goals ≥ 7
- **Other HT**: either team's HT goals ≥ 4
- **Other FT**: either team's FT goals ≥ 5

Plus a Top-1/Top-3 exact-scoreline forecast (HT and FT), built on a Poisson goal-distribution model with shrinkage toward league priors (`src/prediction/scoreline.ts`).

## 2. Architecture

```
football-data.co.uk (free CSV, primary data source)
        │
        ▼
Supabase Edge Functions (Deno)              ─── Postgres (canonical DB)
  cfi-historical-backfill                        tables: fixtures, teams,
  cfi-current-refresh (cron)                      team_aliases,
  cfi-bigdb-retrieval (identity + evidence)       cfi_prediction_evaluation, …
  cfi-prediction-audit
        │
        ▼
Cloudflare Worker (cfi-football-intelligence)  ← the live API
  /api/predict, /api/predict-live,
  /api/match-context, /api/discover, /health
        │
        ▼
web/index.html  (single-file JS app, the actual UI)
        │
        ▼
iOS native shell (CFIWebView.swift) wraps web/index.html
  → built into an unsigned .ipa by GitHub Actions
```

Key fact for any agent: **the deployed Cloudflare Worker code is a bundled chain of many source files** (`cloudflare-worker/src/index-v*.ts`, esbuild-bundled), not a single obvious entrypoint. Always verify behavior against the *live deployed bundle* (`workers_get_worker_code` via the Cloudflare MCP tool) when debugging — the repo source and the deployed bundle can drift, and Supabase Edge Functions in particular have been found to differ from their repo counterparts.

## 3. Prediction pipeline safety gates (why CFI blocks so often)

Before any prediction is returned, request goes through, in order:
1. **Canonical identity resolution** — both team names must resolve to a unique `team_id` in the `teams`/`team_aliases` tables. Fails → `CANONICAL_IDENTITY_UNRESOLVED` (422).
2. **Exact-team evidence gate** — each team needs ≥3 retrieved historical fixtures (raised from `>0` in Sept 2026 after discovering 1-2-fixture teams were slipping through). Fails → `ZERO_EXACT_TEAM_EVIDENCE` (422).
3. **Strict-prior temporal audit** — every piece of evidence must have `match_date < target_date`; future or same-day fixtures are rejected outright. Fails → `STRICT_PRIOR_GATE_ERROR`.
4. **Market coherence / consistency guard** — cross-market contradictions fail-close only the affected market(s), never the whole response.
5. **Calibration approval gates** — the three extreme-threshold markets (3+ HT, 7+ FT, Other HT) carry a *raw* model probability and a separate *approved-for-betting* probability. Until a human-approved calibration exists, `decisionUse=false` and the market shows as `WATCH`, never `BET`. This logic lives in `src/prediction/{three-plus-ht,seven-plus-ft,other-ht}-safety.ts` and is enforced in `src/presentation/cfi-output-v3.ts`.

Current known limitation (flagged, not yet fixed): a handful of clubs exist as **duplicate canonical team records** under slightly different name spellings (e.g. "Emmen" vs "FC Emmen" as two separate `team_id`s with no alias linking them), which can cause a team with rich history to be matched to its near-empty duplicate. Fixing this requires a careful data migration (re-pointing `fixtures.home_team_id/away_team_id`), not a quick patch — deliberately deferred pending dedicated review.

## 4. Data sourcing

- **Primary, free, legal**: football-data.co.uk — static per-league CSV, no key required (`Date,HomeTeam,AwayTeam,FTHG,FTAG,HTHG,HTAG`). Covers 21 leagues across 11 European countries currently.
- **Supplementary (not wired to production yet)**: browser-scrape adapters for aiscore/sofascore/flashscore exist under `local-node/browser/fixture-collector/` — these are unofficial scrapes (ToS risk), meant to run on a user's own machine or a GitHub Actions scheduled job, cross-verified against each other before being merged into the canonical DB with provenance tags (per `AGENTS.md`'s "every source must have provenance" rule).
- Every import must satisfy the **validation gate** in `AGENTS.md`: first import creates expected NEW records, re-import is a no-op (idempotent), malformed rows are rejected not fabricated, persistent counters reconcile.

## 5. Exporting the app to an unsigned IPA

The iOS app is a **thin native shell** (`CFIWebView.swift`) that loads `web/index.html` and talks to the production Cloudflare Worker API over HTTPS. There is no separate native business logic — all prediction logic lives server-side.

"Unsigned IPA" means: the build is **not signed with an Apple Developer certificate/provisioning profile**, so it cannot be installed through the normal App Store / TestFlight path. It is built anyway (via `.github/workflows/build-ios-unsigned.yml` on GitHub Actions, triggered on every push to `main`) so a human can sideload it onto a personal device through a jailbreak/sideloading tool (e.g. AltStore, Sideloadly) that re-signs it locally with the user's own free Apple ID — this is the standard free (non-paid-developer-account) distribution path for a personal-use iOS app.

The workflow:
1. Builds the Xcode project without a code-signing identity.
2. Derives all required app-icon sizes (`AppIcon60x60@2x/@3x`, `iTunesArtwork`) from a single 1024×1024 source PNG (`ios/Resources/cfi-icon.jpg.b64`, base64-encoded) via `sips`.
3. Packages the unsigned `.app` into a `.ipa` and uploads it as a workflow artifact — downloadable from the Actions run page, no App Store involved at any point.

## 6. Governance model an AI should respect when touching this repo

- Read `AGENTS.md` before any change — it defines frozen behavior that must never be silently altered (deduplication rules, null-vs-zero score semantics, the four market definitions, idempotency).
- Never let "more data" silently retune calibration/weights — any calibration change must go through the existing `*CalibrationApproval` human-approval mechanism, never auto-apply.
- Treat the live deployed Cloudflare Worker bundle and the live deployed Supabase Edge Functions as the source of truth when debugging production behavior — they can differ from what's in the repo until a fresh deploy runs.
- Large/risky changes (data migrations, threshold changes affecting production predictions) should be scoped, tested, and confirmed before deploying — not bundled casually with unrelated fixes.

---
*Generated as a project briefing for AI-to-AI handoff. Reflects repo state as of the CFI evidence-gate and response-mode fixes (commit `d5c601c`).*
