# CFI review 2026-10-29
ACTION: CÓ
ALERTS (7): SETTLE_LAG[20.5% kèo 8-72h chưa chấm (125/610)]; CI_FAIL[Tmp U21 Check: 2 lần fail]; CI_FAIL[Fill Odds Gaps (OddsPortal): 1 lần fail]; CI_FAIL[Bongdawap Odds Sync: 10 lần fail]; CI_FAIL[API-Football Odds: 2 lần fail]; CI_FAIL[GoldMe Top Eval: 1 lần fail]; CI_FAIL[CFI ML Calibration Eval: 1 lần fail]
HEALTH: snapshot 0.0491h/322 trận; chưa chấm>8h 419 (8-72h: 20.5%, mức nền ~6% là kèo không có kết quả); parlay_log mới nhất 5.2977h, chờ chấm 295; odds 3.0053h
WORKER: health 200/259ms, suggest 200/1164ms, parlays 200/2098ms, mvp 200/2093ms; thẻ xiên 21; MVP 15 dòng
CI fail 4 ngày: {"Tmp U21 Check":2,"Fill Odds Gaps (OddsPortal)":1,"Bongdawap Odds Sync":10,"API-Football Odds":2,"GoldMe Top Eval":1,"CFI ML Calibration Eval":1}
ĐỘ CHÍNH XÁC (14 ngày vs 14 ngày trước; 4 ngày chỉ tham khảo): n 203/669; trúng kèo chính 60.6%/62.0% z -0.4; Brier O0.5HT 0.1944/0.1887; O1HT 0.2254/0.2462; 4 ngày 0.0% → khác biệt không đáng kể
ỨNG VIÊN HIỆU CHỈNH (train 29 ngày → test 7 ngày): chưa đủ mẫu
XIÊN 30 ngày: std đã chấm 2002 trúng 24.9% chờ 118; single đã chấm 278 trúng 57.9% chờ 11; extreme đã chấm 467 trúng 3.6% chờ 20
MVP top: ou_ht0.75(leg) 71.6% n211; over_ht1(pick) 61.9% n909; over_ft2.5(pick) 63.8% n351; btts_yes(pick) 60.8% n2022; btts(leg) 62.8% n401
