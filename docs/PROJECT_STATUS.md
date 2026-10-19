# CFI Football Intelligence — Trạng thái dự án / bàn giao (cập nhật 2026-10-19)

Mục đích: ai (hoặc Claude trên PC) mở repo cũng biết đã làm gì, đang ở trạng thái nào, làm tiếp thế nào.

## 1. Dự án
- Stack: TypeScript + Supabase (project `zbwkowqluwuvsnajkuvc`) + Cloudflare Worker + app iOS (WKWebView bọc `web/index.html`).
- File chính:
  - `web/index.html` — toàn bộ UI (i18n VI/EN nằm trong file này).
  - `cloudflare-worker/src/index-gpt-core-v5.ts` — API (`/api/suggest`, `/api/suggest-parlays`, `/api/mvp`, `/api/goldme`, ...).
  - `cloudflare-worker/src/live-livescore.ts` — tỉ số live (Livescore).
  - `ios/CFI/CFIWebView.swift` — `allowedPaths`: mỗi API path mới PHẢI thêm vào đây và build lại IPA.
  - `supabase/migrations/` — SQL; người dùng tự chạy trong Supabase SQL Editor (Claude không chạy migration).
  - `src/runtime/match-context.ts` — Tier C (`tryTierC`); `supabase/functions/cfi-db/index.ts` — routes.
- Quy tắc trong `CLAUDE.md`: chỉ sửa file được giao; KHÔNG viết comment trong code; không giải thích dài; không quét cả repo; không tự refactor.

## 2. Quy trình làm việc (đã dùng suốt)
1. Sửa code → chạy `npm test` (hiện 652 test đạt) → commit → PR → chờ CI (check `test`) xanh → merge squash.
2. Đổi Worker → chạy workflow `deploy-cloudflare.yml`. Đổi UI/Swift → chạy `build-ios-unsigned.yml` (ra file `CFI-iOS-vX.Y.Z-buildN-unsigned.ipa`).
3. Cần SQL → người dùng chạy tay trong Supabase SQL Editor (Claude dán SQL trong chat). Không đưa secret vào code/log.
4. Quy tắc version: BUILD_NUMBER chạy 1–9, sau đó tăng patch và reset về 1. Phải khớp ở 4 nơi: `VERSION`, `BUILD_NUMBER`, `ios/CFI.xcodeproj/project.pbxproj` (`MARKETING_VERSION`, `CURRENT_PROJECT_VERSION`), chữ "vX · Build N" trong `web/index.html` (test kiểm tra).
5. i18n: `I18N.vi` (EN→VI), `I18N.en` (VI→EN); test `tests/i18n-lint.test.mjs`: không có key trùng giá trị, không trùng key, chữ tĩnh phải có entry hoặc nằm trong `NEUTRAL_EN_STATIC` (ví dụ `MVP`, `GoldMe`).

## 3. Trạng thái hiện tại
- Phiên bản: v0.3.8 build 4. Mới nhất trên `main`: PR #265. Mọi PR dưới đây đã merge; Worker đã deploy và IPA build 4 đã build thành công.
- IPA mới nhất: `CFI-iOS-v0.3.8-build4-unsigned.ipa` (workflow Build iOS unsigned).

## 4. Đã làm (theo tab)
**Suggest → Picks:** dự đoán theo Poisson từ snapshot `suggest_snapshot`; kèo FT bám line nhà cái và không bao giờ dưới 2.0; kèo HT không dưới 0.75 (Worker + SQL, PR #253/#255); chip "Cùng giờ" (mặc định bật) gom theo giờ đá chính xác (#264).
**Parlay (Suggest / Round / Special):** log xiên `parlay_log`, chấm kèo tự động, thống kê, odds hòa vốn, Kelly, cờ "Đã đặt", hệ số hiệu chỉnh (cần ≥30 xiên đã chốt mỗi loại), lọc theo nhóm giờ/loại/số chân, nhóm theo buổi 6h, chỉ trận có odds (bật/tắt), loại U10–U18 và giải Đức hạng 5 trở xuống; xiên đã có chân kick off thì ẩn; mục "Đang đá" cuối tab hiện xiên đã đặt đang chạy kèm tỉ số live, tự làm mới 60s (#265).
**Extreme:** Special (khung 4h cố định theo giờ VN, mỗi khung ≥2 trận, #259) và Daily; 4 loại: 3+ HT, Other HT, Other FT, 7+ FT; có thống kê riêng.
**Singles (Kèo lẻ):** kèo lẻ có odds/EV/Kelly/đã đặt/thống kê riêng; giữ trận đã kick off tới 120 phút kèm tỉ số live, làm mới 60s (#262/#263).
**MVP (tab thứ 5):**
- "Top kèo": market thắng nhiều nhất 60 ngày (xếp theo cận dưới Wilson 95%, tối thiểu 30 trận; bỏ Over FT < 2 và Over HT < 0.75) + độ chính xác 4 ngày gần nhất so với 4 ngày trước (`/api/mvp`, cache 6h).
- "GoldMe": các trận đã chốt có kết quả extreme (tối đa 400 trận, 30 ngày) kèm ngày, giờ, giải, tỉ số HT/FT, kèo hệ thống dự đoán, xác suất 4 loại extreme, bảng tổng tỉ lệ ra thật theo loại, chip lọc theo loại (`/api/goldme`, RPC `cfi_goldme`, #260/#261).
**Giao diện:** nền ảnh huyền thoại World Cup (ảnh nhúng base64 trong `body::before`).

## 5. Hệ thống review mỗi 4 ngày
- `.github/workflows/cfi-review.yml` (cron 00:23 UTC các ngày 1,5,9,13,17,21,25,29): chạy `scripts/review_collect.mjs` (không dùng LLM), ghi báo cáo ~10 dòng vào nhánh `review-data` (`reports/review/latest.md`, `latest.json`, `history.jsonl`). Cần secret `CFI_SUPABASE_SERVICE_ROLE_KEY` (chỉ đọc).
- Báo cáo gồm: sức khỏe dữ liệu, endpoint Worker, CI lỗi 4 ngày, độ chính xác 3 cửa sổ 4 ngày, ứng viên hiệu chỉnh walk-forward, thống kê xiên, MVP top, và cảnh báo.
- Phiên Claude định kỳ: scheduled task `trig_01CC3746tFXV74cdr5bxgpUV`, 01:23 UTC cùng các ngày, đọc báo cáo + `docs/review/PLAYBOOK.md`; chỉ mở PR, không merge/deploy/migration/secret; kết thúc bằng tóm tắt tiếng Việt ≤12 dòng. Chưa kiểm chứng phiên này có repo/GitHub MCP hay không.
- Playbook: `docs/review/PLAYBOOK.md`; nhật ký nghiên cứu: `docs/review/RESEARCH_LOG.md`. Backlog "cho user khác dùng" nằm trong playbook (lưu theo user/RLS, đăng nhập, rate limit, error beacon, privacy/onboarding, TestFlight).

## 6. Migration SQL (người dùng đã chạy trong Supabase)
`20261017000000_parlay_log_stats`, `20261017010000_parlay_stats_v2`, `20261017020000_parlay_recent`, `20261018000000_parlay_extreme`, `20261018010000_parlay_placed`, `20261018020000_parlay_group_filter`, `20261019000000_parlay_singles` (tạo mode `single`; chưa thấy xác nhận rõ — nếu Singles báo lỗi thì chạy lại), `20261019010000_suggest_ft_line_market`, `20261019020000_suggest_ht_min_line`, `20261020000000_goldme` + `20261020010000_goldme_400` (đã chạy, kiểm tra ra 400 dòng). Trước đó: `cfi_round_hit_rates`, round stats, v.v.

## 7. Chưa kiểm chứng / lưu ý
- Môi trường Claude cloud không gọi được Worker hay Supabase production → các tính năng live (tỉ số, Đang đá, Singles live, GoldMe, MVP) mới chỉ thử bằng dữ liệu giả; cần xem thực tế trên app.
- Tỉ số live phụ thuộc Livescore: trận không khớp được chỉ hiện "Đang đá" không có tỉ số.
- Kèo Singles đã log trước PR #262 không có tên giải (log cũ không lưu `competition`).
- 503 ở Parlay/Round khi tắt lọc odds từng xảy ra (Worker CPU); đã tối ưu nhưng chưa xác nhận hết trên production. Nếu lặp lại: mở thẳng URL Worker trong Safari để xem lỗi.
- Nghi vấn còn mở: khung 9–11h ở Extreme Special (đã đổi cách gom, chưa xác nhận trên dữ liệu thật).
- Còn 22 PR cũ đang mở (ví dụ #209), chưa xử lý, không thuộc các việc trên.
- Việc có thể làm tiếp: đo xem Over 2/2.5 FT có thật sự lãi sau khi có đủ trận chốt; mở rộng GoldMe để tìm dấu hiệu extreme (so xác suất mô hình khi ra và không ra); chuẩn bị cho nhiều người dùng (xem backlog trong playbook); "việc bổ sung sau" ở mục 5 của yêu cầu review.

## 8. Mở lại trên PC
```
git clone https://github.com/baoanhrat112020-boop/cfi-football-intelligence
cd cfi-football-intelligence && npm install && npm test
```
Thư mục cục bộ cũ: `D:\CFI\DEEPSEEK\cfi-football-intelligence`. Bảo Claude đọc `docs/PROJECT_STATUS.md` và `CLAUDE.md` trước khi làm.
