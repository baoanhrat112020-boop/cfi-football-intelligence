# CFI 4-day review playbook

Run every 4 days after the `CFI Review Collect` workflow. Goal: small, cheap, safe.

## Inputs (read only these)
- `git fetch origin review-data` then `reports/review/latest.md` (about 10 lines) and the last 3 lines of `reports/review/history.jsonl`.
- This file and `docs/review/RESEARCH_LOG.md` (last 20 lines). Do not scan the repo.

## Rules
- Never merge, deploy, run migrations or touch secrets. Open PRs only; the owner approves.
- Fix only what an ALERT code points at. Max about 80 changed lines per PR, one PR per code, branch `auto/YYYY-MM-DD-CODE`.
- Run `node --test tests/*.mjs` before opening a PR. Red tests means no PR, report the blocker.
- SQL changes go in a new `supabase/migrations/` file; paste the SQL in the notification.
- No code comments. Keep every answer short.

## 1. Auto fix
Map alerts to files:
- SNAPSHOT_STALE, SETTLE_LAG, ODDS_STALE: check the cron/ingest workflows named in the report, propose the fix.
- PARLAY_LOG_STALE, WORKER_*: `cloudflare-worker/src/index-gpt-core-v5.ts` routes `/api/suggest-parlays`, `/api/parlay-*`.
- CI_FAIL: read the failing job via `get_job_logs`, fix, PR.
- ACC_DROP, BRIER_UP: go to step 2.

## 2. Prediction research (one candidate per cycle)
Candidates in order: bin calibration per market (report line `ỨNG VIÊN HIỆU CHỈNH`), bias shift, HT share fitted per league (replace the fixed 0.50), tier thresholds, elo-to-lambda scale.
Accept only if walk-forward test Brier improves at least 1 percent and the previous window is not worse. Otherwise log it and take the next candidate next cycle. Append 3 lines to `docs/review/RESEARCH_LOG.md`: date, candidate, result.
Accepted candidates become a PR (Worker post-processing first, SQL migration second).

## 3. Multi-user readiness backlog (one item per cycle, tick when merged)
- [ ] per-user storage: placed flags and odds edits are global today; add a user key and RLS
- [ ] Supabase Auth or signed device token on Worker routes
- [ ] rate limit on Worker routes
- [ ] error beacon from app to Worker, aggregated into the review report
- [ ] privacy and terms screen, onboarding
- [ ] TestFlight or signed IPA path

## 4. MVP tab
Automatic: Worker `/api/mvp`. Alert `MVP_EMPTY` only.

## 5. Notification (Vietnamese, at most 12 lines)
`Đã tự sửa:` PR links. `Cần duyệt:` proposals and SQL. `Dự đoán:` 4 ngày gần nhất tốt hơn/kém hơn kèm 2 số. `Tiếp theo:` one line.
