# CFI Football Intelligence

## Stack
- TypeScript + Supabase + Cloudflare Worker
- Local: D:\CFI\DEEPSEEK\cfi-football-intelligence

## Files quan trọng
- src/runtime/match-context.ts — Tier C logic (tryTierC)
- cloudflare-worker/src/index-gpt-core-v5.ts — API /api/predict
- supabase/functions/cfi-db/index.ts — routes

## Rules
- CHỈ sửa file được chỉ định trong task
- KHÔNG viết comment trong code
- KHÔNG giải thích, chỉ in diff
- KHÔNG scan toàn repo, đọc đúng file được yêu cầu
- Không tự ý refactor