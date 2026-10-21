# CFI review 2026-10-21
ACTION: CÓ
ALERTS (4): CI_FAIL[Fill Odds Gaps (OddsPortal): 12 lần fail]; CI_FAIL[Bongdawap Odds Sync: 13 lần fail]; CI_FAIL[CFI Livescore Ingest: 11 lần fail]; CI_FAIL[CFI Tests: 1 lần fail]
HEALTH: snapshot 0.0345h/236 trận; chưa chấm>8h 173 (8-72h: 7.7%, mức nền ~6% là kèo không có kết quả); parlay_log mới nhất 5.2804h, chờ chấm 266; odds 13.1105h
WORKER: health 200/218ms, suggest 200/1487ms, parlays 200/2065ms, mvp 200/1819ms; thẻ xiên 0; MVP 15 dòng
CI fail 4 ngày: {"Fill Odds Gaps (OddsPortal)":12,"Bongdawap Odds Sync":13,"CFI Livescore Ingest":11,"CFI Tests":1}
ĐỘ CHÍNH XÁC (14 ngày vs 14 ngày trước; 4 ngày chỉ tham khảo): n 727/141; trúng kèo chính 63.4%/51.1% z 0.0; Brier O0.5HT 0.195/0.1799; O1HT 0.2403/0.2473; 4 ngày 64.9% → chưa đủ mẫu
ỨNG VIÊN HIỆU CHỈNH (train 29 ngày → test 7 ngày): p_over05_ht: bin -2.2194%, shift -0.0016 → 0.0722%, co 0.7341 → -0.1619% (n 780/220) | p_over1_ht: bin -3.7782%, shift 0.0273 → -1.1199%, co 0.5113 → -2.3219% (n 780/220) | p_over075_ht: bin -6.4508%, shift 0.0128 → -0.7357%, co 0.5968 → -1.5914% (n 780/220)
XIÊN 30 ngày: std đã chấm 1124 trúng 22.1% chờ 27; single đã chấm 123 trúng 57.7% chờ 0; extreme đã chấm 351 trúng 2.9% chờ 76
MVP top: ou_ht0.75(leg) 71.5% n123; over_ft2.5(pick) 64.1% n343; over_ht1(pick) 62.5% n483; btts_yes(pick) 58.8% n1409; over_ft2.25(pick) 60.9% n408
