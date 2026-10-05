# Backtest λ engine vs team_stats + hệ số HT (2026-10-05)

Chỉ research. Không sửa SQL/RPC/worker, không ghi `cfi_prediction_snapshots` (snapshot vẫn 2173 dòng).
Script: `reports/backtest_lambda.py`. Dữ liệu thô: `backtest-lambda-20261005-run1.json`, `-run2.json`.

## Kết luận ngắn

1. **Không có bằng chứng engine λ chính xác hơn team_stats.** Trên 121 trận, engine và team_stats (công thức hiện tại, tính strict-prior) cho kết quả gần như bằng nhau, chênh lệch nằm trong sai số mẫu. Không nên đổi Suggest sang engine λ vì lý do độ chính xác.
2. **Hệ số HT 0.45 đúng.** Tỉ lệ thật trên 193.738 trận là 0.4457. Hệ số tốt nhất trên 13.589 trận gần đây là 0.46, nhưng khác 0.45 không đáng kể.
3. **Ngưỡng `p_over075_ht` 0.62 hiệu chuẩn tốt** (lệch 1.6 điểm %). Từ 0.68 trở lên mô hình tự tin quá mức 4–5 điểm %.

## Cảnh báo về chất lượng dữ liệu của Q1

- **Engine chỉ trả λ cho 121/200 trận (lần 1) và 28/200 trận (lần 2).** Các trận còn lại nhận phản hồi `503 error code: 1102` (Cloudflare: `Worker exceeded CPU time limit`). Lần 1 tôi không ghi lý do lỗi từng trận, nên việc 78 lỗi đó cũng là 1102 là suy luận (khớp với lần 2, nơi 172/172 lỗi đều là phản hồi không phải JSON).
- Nếu trận lỗi thường là trận có nhiều dữ liệu (tốn CPU hơn), mẫu 121 trận bị lệch về đội ít dữ liệu. Chưa kiểm chứng.
- Số liệu Q1 dưới đây dùng lần 1 (n=121). Lần 2 (n=28) quá nhỏ để kết luận.
- Backtest dùng λ strict-prior: tái dựng công thức của `etl/compute_team_stats.py` (cửa sổ 30 trận, decay 0.94, shrink 10) chỉ từ các trận trước ngày đá. Bảng `team_stats` đang lưu là bản mới nhất nên có rò rỉ tương lai (xem cột "stored").
- Engine được gọi với `target_date` quá khứ qua header `x-cfi-dry-run: 1`. Engine tự áp strict-prior, nên không rò rỉ.

## Q1: λ engine vs team_stats (mẫu 121 trận, 90 ngày gần nhất, mỗi đội ≥ 30 trận trước đó)

| Nguồn λ | MAE home | MAE away | MAE tổng bàn | Log-lik / bàn | Brier O2.5 | Bias home | Bias away |
|---|---|---|---|---|---|---|---|
| Trung bình giải (nền) | 1.020 | 1.059 | 1.420 | -1.579 | 0.2480 | -0.036 | -0.134 |
| team_stats đang lưu (có rò rỉ) | 0.888 | 0.914 | 1.284 | -1.458 | 0.2166 | +0.027 | -0.098 |
| **team_stats strict-prior** | 0.957 | 0.992 | 1.383 | -1.532 | 0.2417 | -0.006 | -0.123 |
| **Engine** | 0.934 | 1.019 | 1.360 | -1.534 | 0.2373 | -0.137 | +0.038 |
| Delta engine − strict | -0.023 | +0.027 | -0.023 | -0.002 | -0.0044 | | |

Trung bình thực tế: home 1.554, away 1.347 bàn. Tỉ lệ home thắng thực tế: 44.6%.

- Hai nguồn đều chỉ tốt hơn mức trung bình giải khoảng 0.04–0.06 bàn MAE.
- Engine hơi tốt hơn ở MAE tổng và Brier O2.5; strict team_stats hơi tốt hơn ở log-lik. Với n=121, sai số chuẩn của MAE khoảng 0.1, nên đây là hòa.
- Bản "stored" trông tốt nhất chỉ vì rò rỉ tương lai (thấy kết quả trận đang dự đoán). Hiệu năng thực của team_stats đang chạy gần với cột strict-prior.
- Tương quan tổng λ giữa engine và strict-prior: 0.83.
- Hướng dự đoán (home/away theo dấu λ_home − λ_away, bỏ qua hòa):

| Nguồn | Chọn home đúng | Chọn away đúng |
|---|---|---|
| team_stats strict-prior | 48/95 (50.5%) | 14/26 (53.8%) |
| Engine | 34/69 (49.3%) | 25/52 (48.1%) |

Cả hai gần 50%, không phân biệt được.

## Q2: hệ số HT

Toàn bộ 193.738 trận có đủ HT và FT (loại 5 dòng có FT < HT):

| Nhóm | Số trận | HT/FT | Home | Away | Bàn FT/trận |
|---|---|---|---|---|---|
| **Tất cả** | 193.738 | **0.4457** | 0.4475 | 0.4434 | 2.756 |
| League Two (Anh) | 11.875 | 0.4413 | 0.4468 | 0.4345 | 2.569 |
| Premier League | 11.790 | 0.4447 | 0.4505 | 0.4372 | 2.705 |
| League One | 11.788 | 0.4470 | 0.4448 | 0.4497 | 2.619 |
| Championship | 11.615 | 0.4384 | 0.4420 | 0.4338 | 2.549 |
| National League (Anh) | 10.719 | 0.4448 | 0.4451 | 0.4444 | 2.725 |
| Không rõ giải | 8.737 | 0.4403 | 0.4402 | 0.4404 | 3.047 |
| Ligue 1 | 6.158 | 0.4379 | 0.4385 | 0.4371 | 2.602 |
| Serie A | 6.016 | 0.4357 | 0.4379 | 0.4330 | 2.697 |
| La Liga | 5.562 | 0.4406 | 0.4440 | 0.4360 | 2.678 |
| Segunda Division | 5.083 | 0.4271 | 0.4422 | 0.4062 | 2.295 |

- Khoảng dao động giữa các giải lớn: 0.427–0.447. 90 ngày gần nhất: 0.4618 (26.501 trận, trung bình 3.04 bàn/trận, cao hơn mức 2.76 của toàn bộ dữ liệu).
- Theo tổng bàn FT: 0–1 bàn → 0.427, 2–3 → 0.442, 4–5 → 0.449, 6+ → 0.457 (tăng nhẹ theo tổng bàn).
- Chọn hệ số bằng log-likelihood của tổng bàn HT (13.589 trận, λ strict-prior):

| Hệ số | Log-lik | HT bàn dự đoán | HT bàn thực |
|---|---|---|---|
| 0.42 | -1.4683 | 1.218 | 1.328 |
| 0.44 | -1.4645 | 1.276 | 1.328 |
| 0.45 | -1.4637 | 1.305 | 1.328 |
| **0.46** | **-1.4635** | 1.334 | 1.328 |
| 0.48 | -1.4650 | 1.392 | 1.328 |

Khác biệt giữa 0.45 và 0.46 là 0.0002 log-lik, không đáng kể. **Giữ 0.45** (thấp hơn thực tế 1.7% về số bàn HT).

## Hiệu chuẩn ngưỡng `p_over075_ht` (13.589 trận, λ strict-prior, hệ số 0.45)

"O0.75" ở đây là kỳ vọng thắng (P(≥2 bàn HT) + 0.5 × P(đúng 1 bàn)), không phải xác suất thật.

| Ngưỡng | Số trận | % trận qua | O0.75 dự đoán | O0.75 thực | Lệch | O0.5 dự đoán / thực | O1 dự đoán / thực |
|---|---|---|---|---|---|---|---|
| ≥ 0.50 | 9.437 | 69.4% | 0.589 | 0.592 | +0.3 | 0.758 / 0.759 | 0.420 / 0.425 |
| ≥ 0.55 | 6.343 | 46.7% | 0.620 | 0.619 | -0.1 | 0.783 / 0.785 | 0.456 / 0.452 |
| ≥ 0.58 | 4.519 | 33.3% | 0.642 | 0.638 | -0.4 | 0.801 / 0.800 | 0.484 / 0.476 |
| ≥ 0.60 | 3.486 | 25.7% | 0.658 | 0.646 | -1.2 | 0.813 / 0.803 | 0.503 / 0.488 |
| **≥ 0.62** | 2.627 | 19.3% | 0.673 | 0.658 | -1.6 | 0.825 / 0.812 | 0.522 / 0.504 |
| ≥ 0.65 | 1.574 | 11.6% | 0.700 | 0.678 | -2.2 | 0.844 / 0.825 | 0.556 / 0.530 |
| ≥ 0.68 | 940 | 6.9% | 0.724 | 0.680 | -4.4 | 0.860 / 0.821 | 0.587 / 0.539 |
| ≥ 0.70 | 620 | 4.6% | 0.742 | 0.694 | -4.8 | 0.872 / 0.824 | 0.611 / 0.563 |

- Mức nền (≥ 0.50): O0.75 thực 0.592. Ngưỡng 0.62 chọn 19% số trận với kết quả thực 0.658, tức hơn mức nền 6.6 điểm %. Ngưỡng 0.65 chọn 11.6% trận với 0.678 (+8.6 điểm %).
- Từ 0.65 trở lên mô hình tự tin quá mức rõ hơn: 4–5 điểm % ở 0.68–0.70.
- Hệ số 0.46 cho kết quả tương tự (xem JSON).
- Giới hạn: tập đánh giá yêu cầu cả hai đội có ≥ 10 trận trước đó. Suggest thật gồm cả đội ít dữ liệu (30 trong 228 fixture 48h tới có đội dưới 5 trận), nên chất lượng thực tế thấp hơn bảng trên.

## Đề xuất

- **Đổi sang engine λ cho Suggest? Không.** Không có lợi thế đo được (hòa trên n=121), trong khi engine tốn 3.6–5.9 giây mỗi trận và hiện đang bị lỗi CPU limit (1102). Nếu mục tiêu chỉ là hai tab khớp nhau, cách rẻ hơn là cho khối Predict dùng cùng λ `team_stats` hoặc ghi rõ nguồn λ trên mỗi tab. Nếu vẫn muốn đổi, nên chạy lại phần engine khi worker ổn định, với mẫu ≥ 300 trận và ghi lý do mọi trận lỗi.
- **Hệ số HT thật:** 0.4457 trên toàn dữ liệu (0.46 trên 90 ngày gần nhất). **Giữ 0.45.**
- **Ngưỡng `p_over075_ht`:** giữ **0.62** (lệch 1.6 điểm %). Có thể gắn nhãn "cao" cho ≥ 0.65. Trên 0.68 không nên coi con số hiển thị là xác suất thật.

## Sự cố phát hiện khi chạy

- `/api/predict` trả `503 error code: 1102` cho **mọi** request ở 04:25 UTC (kể cả không có header dry-run, kể cả `response_mode` mặc định). `/health`, `/api/status`, `/api/suggest` vẫn hoạt động. `wrangler tail` ghi `outcome: exceededCpu`, `cpuTime: 34ms`.
- Phiên bản đang chạy là `41abbe08` (GitHub Actions deploy lúc 03:32:45Z). Trước đó có một lần deploy `a31cf561` lúc 03:32:05Z mà tôi không thực hiện. Lúc 03:24–03:33Z `/api/predict` còn chạy được. Tỉ lệ lỗi tăng dần trong lúc backtest (78/200 → 172/200 → 100% hiện tại).
- Chưa rõ nguyên nhân (tải backtest, thay đổi phiên bản, hay giới hạn CPU của gói). Cần kiểm tra sau.
- Backtest ghi 1 dòng vào `tier_c_log`: id 15, `Sao Paulo v Club Athletico Paranaense`, `source = 'SUGGEST_ENGINE'` (trận Tier C). Không đụng bảng nào khác.
