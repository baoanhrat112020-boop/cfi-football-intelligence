# CFI review 2026-10-20
ACTION: CÓ
ALERTS (4): CI_FAIL[CFI Livescore Ingest: 11 lần fail]; CI_FAIL[Fill Odds Gaps (OddsPortal): 12 lần fail]; CI_FAIL[Bongdawap Odds Sync: 13 lần fail]; CI_FAIL[CFI Tests: 3 lần fail]
HEALTH: snapshot 0.1686h/351 trận; chưa chấm>8h 170 (8-72h: 5.0%, mức nền ~6% là kèo không có kết quả); parlay_log mới nhất 0.6233h, chờ chấm 192; odds 0.1251h
WORKER: health 200/348ms, suggest 200/1649ms, parlays 200/1267ms, mvp 200/1102ms; thẻ xiên 74; MVP 15 dòng
CI fail 4 ngày: {"CFI Livescore Ingest":11,"Fill Odds Gaps (OddsPortal)":12,"Bongdawap Odds Sync":13,"CFI Tests":3}
ĐỘ CHÍNH XÁC (14 ngày vs 14 ngày trước; 4 ngày chỉ tham khảo): n 827/46; trúng kèo chính 62.6%/43.5% z 0.0; Brier O0.5HT 0.1925/0.2018; O1HT 0.2433/0.2232; 4 ngày 60.9% → chưa đủ mẫu
ỨNG VIÊN HIỆU CHỈNH (train 29 ngày → test 7 ngày): p_over05_ht: bin -0.8346%, shift -0.006 → 0.1947%, co 0.7374 → 0.2352% (n 688/312) | p_over1_ht: bin -1.2441%, shift 0.0146 → -0.1989%, co 0.4769 → -0.5504% (n 688/312) | p_over075_ht: bin -2.4635%, shift 0.0043 → -0.1281%, co 0.5749 → -0.2414% (n 688/312)
XIÊN 30 ngày: std đã chấm 1143 trúng 21.5% chờ 100; single đã chấm 123 trúng 57.7% chờ 0; extreme đã chấm 353 trúng 4.3% chờ 92
MVP top: ou_ht0.75(leg) 71.7% n127; over_ft2.5(pick) 66.2% n396; over_ht1(pick) 61.9% n465; 1x2_ft_home(pick) 61.6% n445; btts_yes(pick) 59.2% n1478
