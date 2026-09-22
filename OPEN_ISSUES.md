# CFI — Vấn đề tồn đọng (để tìm giải pháp free)

Danh sách tổng hợp mọi vấn đề đã phát hiện nhưng chưa xử lý, tính đến commit `b2c2bc6`. Ghi rõ vì sao chưa làm, để dễ tìm giải pháp free bù vào chỗ thiếu.

---

## 🔴 Dữ liệu / độ chính xác dự đoán

### 1. Trùng lặp canonical team identity
Một số CLB tồn tại dưới 2 `team_id` khác nhau trong DB do tên gọi khác nhau, không có alias nối lại:
- "Emmen" (1 trận) tách biệt khỏi "FC Emmen" (hàng chục trận)
- "Roda" (dữ liệu dày) tách biệt khỏi "Roda JC Kerkrade" (1 trận) và "CD Roda" (1 trận)
- Nghi ngờ thêm: "Waalwijk" và "RKC Waalwijk" cả hai đều có dữ liệu dày — có thể là 2 record trùng lặp thật (double-count) chứ không phải 2 CLB khác nhau

**Vì sao chưa fix:** phải re-point `fixtures.home_team_id/away_team_id` sang đúng team_id rồi xóa/alias-hóa record rỗng — thao tác sửa dữ liệu canonical, rủi ro cao nếu làm vội, cần một phiên riêng để làm cẩn thận + kiểm tra không double-count.

**Cần tìm:** cách audit hàng loạt (script SQL/fuzzy-match) để phát hiện hết các cặp trùng lặp còn lại trong DB, không chỉ 3 CLB đã biết.

### 2. Thuật toán dự đoán còn đơn giản
Poisson độc lập cho HT/FT, chưa có: recency weighting, tách biệt home/away, opponent-strength rating (kiểu Elo), backtest framework để đo cải thiện trước khi deploy.

**Vì sao chưa fix:** đã lên kế hoạch (xem phiên trước), dừng lại vì hết quota tuần.

### 3. CFI tự học / retrain calibration có kiểm soát
Hạ tầng approval-gate cho calibration đã có sẵn (3+ HT/7+ FT/Other HT), nhưng thiếu script tính lại calibration từ dữ liệu settlement thật + so sánh trước/sau.

**Vì sao chưa fix:** đã lên kế hoạch, dừng vì hết quota tuần.

---

## 🟠 Nguồn dữ liệu / hạ tầng miễn phí

### 4. Coverage giới hạn 21 giải/11 quốc gia châu Âu
Không có: Israel, các giải ngoài châu Âu, đội tuyển quốc gia (đã gặp: MC Alger/MC Oran, Nhật Bản/Uruguay, Hapoel Kfar Shalem/Maccabi Jaffa).

**Vì sao chưa fix:** mở rộng coverage cần backfill dữ liệu lịch sử cho từng giải mới — tốn nhiều lượt audit/test.

**Cần tìm:** nguồn dữ liệu lịch sử free khác ngoài football-data.co.uk cho các giải/quốc gia không có trong danh sách hiện tại.

### 5. Aiscore/Sofascore/Flashscore — chỉ có adapter scrape, chưa production
Code scrape đã có sẵn (`local-node/browser/fixture-collector/`) nhưng:
- Là scrape trái phép (vi phạm ToS), rủi ro pháp lý nếu dùng thương mại
- Đang phụ thuộc máy cá nhân người dùng phải bật liên tục
- Chưa thử chuyển sang GitHub Actions scheduled workflow (rủi ro: site có thể chặn IP datacenter của GitHub)

**Cần tìm:** giải pháp hosting free chạy headless browser ổn định mà không bị chặn IP (proxy free, hoặc dịch vụ free-tier nào cho phép residential IP).

### 6. `cfi-multimarket-settlement-eval` bị "statement timeout"
Phát hiện từ phiên trước, chưa fix. Không có chi tiết root cause được ghi lại — cần điều tra lại từ đầu.

### 7. GitHub Actions → Supabase deploy pathway bị hỏng
Lỗi `403 "Your account does not have the necessary privileges"` khi deploy Edge Function qua CI. Hiện đang workaround bằng cách deploy trực tiếp qua Supabase MCP thủ công — không bền vững cho việc bảo trì lâu dài.

**Nghi ngờ nguyên nhân:** liên quan tới Supabase Free Plan "Grace period is over" (Fair Use Policy đã kích hoạt) hoặc phạm vi (scope) của Personal Access Token bị thiếu quyền.

**Cần tìm:** cách cấp đúng quyền cho PAT/service token trong Supabase free tier để CI deploy được bình thường.

### 8. Supabase Free Plan — rủi ro giới hạn 402
Grace period đã kết thúc (09/09/2026), Fair Use Policy đang active. Nếu vượt quota có thể bị hạn chế truy cập (402).

**Cần tìm:** cách theo dõi usage free tier của Supabase để cảnh báo sớm trước khi bị khóa, hoặc alternative free Postgres hosting nếu cần fallback.

### 9. Cron jobs đã giảm tần suất nhưng chưa có giám sát dài hạn
Đã giảm từ 528 → 148 lần gọi/ngày (4 job) tuần trước. Chưa có cơ chế cảnh báo tự động nếu quota Supabase gần cạn.

---

## 🟡 UX / vận hành app

### 10. Discover tab không cảnh báo trận ngoài coverage
Người dùng chọn tự do bất kỳ trận nào kể cả ngoài phạm vi dữ liệu (Israel, đội tuyển...), dẫn đến hiểu nhầm là app lỗi khi thực ra là chặn đúng.

### 11. Phân phối app — chỉ có unsigned IPA (sideload)
Hiện không có Apple Developer Program trả phí ($99/năm) nên không thể ký chính thức / lên App Store hay TestFlight. Bản build hiện tại phải sideload qua AltStore/Sideloadly bằng Apple ID thường (giới hạn 7 ngày phải resign lại).

**Cần tìm:** giải pháp free để kéo dài thời gian giữa các lần resign (AltStore/SideStore có cơ chế tự resign qua Wi-Fi nền — cần setup), hoặc xác nhận rõ quy trình resign định kỳ ít tốn công sức nhất.

---

## Việc code-review đã fix (tham khảo, không cần tìm giải pháp thêm)
`unwrap()`, evidence-gate mismatch, stale pending requests, quick-search regex, cache TTL reset, health-check empty body — đã fix ở commit `b2c2bc6`, không nằm trong danh sách tồn đọng.

## Việc code-review được đánh giá KHÔNG phải bug / hoãn có chủ đích
AbortController cho request timeout, thông báo rõ nguyên nhân khi duplicate team block, công thức quality-score (ý kiến thiết kế), vài edge-case cosmetic (`kickoffLocal` fallback, trim trạng thái settlement, version hardcode trong Settings modal) — giá trị thấp, không cần tìm giải pháp bên ngoài, chỉ cần thời gian code khi có quota.
