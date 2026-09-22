-- ============================================================================
-- CFI — Fix duplicate canonical team identity
-- File: supabase/sql/fix_duplicate_canonical_teams.sql
-- Issue: OPEN_ISSUES.md #1
--
-- SCHEMA THẬT (đã verify):
--   teams.team_id UUID PK, teams.canonical_name TEXT
--   team_aliases(team_id UUID FK, alias_normalized TEXT, alias_display TEXT, source TEXT, confidence NUMERIC)
--   fixtures.fixture_id PK, home_team_id UUID, away_team_id UUID, match_date DATE
--
-- CÁCH CHẠY:
--   1. Chạy PHẦN 1 → 6 (setup, backup, function) — an toàn, không sửa dữ liệu
--   2. Chạy PHẦN 7 (audit) → xem kết quả, classify cặp trùng
--   3. Chạy PHẦN 8 (dry-run) → BEGIN → merge → verify → ROLLBACK
--   4. Nếu OK → chạy PHẦN 9 (apply thật)
--   5. Nếu sai → chạy PHẦN 10 (rollback)
-- ============================================================================


-- ============================================================================
-- PHẦN 1: SETUP EXTENSIONS
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;


-- ============================================================================
-- PHẦN 2: BACKUP TABLES (BẮT BUỘC — chạy trước khi sửa bất cứ gì)
-- ============================================================================
DROP TABLE IF EXISTS teams_backup_before_merge;
CREATE TABLE teams_backup_before_merge AS SELECT * FROM teams;

DROP TABLE IF EXISTS fixtures_backup_before_merge;
CREATE TABLE fixtures_backup_before_merge AS
  SELECT fixture_id, home_team_id, away_team_id FROM fixtures;

DROP TABLE IF EXISTS team_aliases_backup_before_merge;
CREATE TABLE team_aliases_backup_before_merge AS SELECT * FROM team_aliases;

-- Verify backup
SELECT 'teams'    AS tbl, COUNT(*) AS rows FROM teams_backup_before_merge
UNION ALL
SELECT 'fixtures',       COUNT(*) FROM fixtures_backup_before_merge
UNION ALL
SELECT 'aliases',        COUNT(*) FROM team_aliases_backup_before_merge;


-- ============================================================================
-- PHẦN 3: GUARDRAILS
-- ============================================================================

-- 3a. Thêm cột normalized_name (generated, dùng cho audit similarity)
ALTER TABLE teams ADD COLUMN IF NOT EXISTS normalized_name TEXT
  GENERATED ALWAYS AS (lower(unaccent(canonical_name))) STORED;

-- 3b. CHECK DUPLICATE ALIAS TRƯỚC KHI ADD UNIQUE CONSTRAINT
--     Query dưới PHẢI trả về RỖNG. Nếu có kết quả → xử lý thủ công trước.
SELECT
  alias_normalized,
  COUNT(*) AS cnt,
  array_agg(team_id) AS team_ids
FROM team_aliases
GROUP BY alias_normalized
HAVING COUNT(*) > 1
ORDER BY cnt DESC;

-- 3c. Add UNIQUE constraint (CHỈ chạy khi query 3b trả rỗng)
--     Nếu query 3b có kết quả → comment dòng dưới lại, xử lý duplicate alias trước.
ALTER TABLE team_aliases DROP CONSTRAINT IF EXISTS uq_team_aliases_alias_normalized;
ALTER TABLE team_aliases ADD CONSTRAINT uq_team_aliases_alias_normalized UNIQUE (alias_normalized);


-- ============================================================================
-- PHẦN 4: AUDIT VIEWS
-- ============================================================================

-- 4a. View: cặp team similarity >= 0.5 kèm fixture count + gợi ý keep/remove
CREATE OR REPLACE VIEW v_suspected_duplicates AS
WITH fixture_counts AS (
  SELECT team_id, COUNT(*) AS fixture_count FROM (
    SELECT home_team_id AS team_id FROM fixtures
    UNION ALL
    SELECT away_team_id AS team_id FROM fixtures
  ) x GROUP BY team_id
)
SELECT
  a.team_id        AS team_a_id,
  a.canonical_name AS team_a_name,
  COALESCE(fa.fixture_count, 0) AS team_a_fixtures,
  b.team_id        AS team_b_id,
  b.canonical_name AS team_b_name,
  COALESCE(fb.fixture_count, 0) AS team_b_fixtures,
  ROUND(similarity(a.normalized_name, b.normalized_name)::numeric, 3) AS sim,
  CASE WHEN COALESCE(fa.fixture_count,0) >= COALESCE(fb.fixture_count,0)
       THEN a.team_id ELSE b.team_id END AS suggest_keep_id,
  CASE WHEN COALESCE(fa.fixture_count,0) >= COALESCE(fb.fixture_count,0)
       THEN b.team_id ELSE a.team_id END AS suggest_remove_id
FROM teams a
JOIN teams b ON a.team_id < b.team_id
LEFT JOIN fixture_counts fa ON fa.team_id = a.team_id
LEFT JOIN fixture_counts fb ON fb.team_id = b.team_id
WHERE similarity(a.normalized_name, b.normalized_name) >= 0.5
ORDER BY sim DESC;

-- 4b. View: team có <= 2 fixture (nghi là bản rỗng)
CREATE OR REPLACE VIEW v_low_fixture_teams AS
SELECT t.team_id, t.canonical_name, COALESCE(f.fixture_count, 0) AS fixture_count
FROM teams t
LEFT JOIN (
  SELECT team_id, COUNT(*) AS fixture_count FROM (
    SELECT home_team_id AS team_id FROM fixtures
    UNION ALL
    SELECT away_team_id AS team_id FROM fixtures
  ) x GROUP BY team_id
) f ON f.team_id = t.team_id
WHERE COALESCE(f.fixture_count, 0) <= 2
ORDER BY fixture_count ASC;


-- ============================================================================
-- PHẦN 5: LOG TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS team_merge_log (
  id             BIGSERIAL PRIMARY KEY,
  merged_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_team_id   UUID NOT NULL,
  to_team_id     UUID NOT NULL,
  names          TEXT NOT NULL,
  fixtures_moved INT NOT NULL,
  reason         TEXT,
  rolled_back    BOOLEAN NOT NULL DEFAULT FALSE
);


-- ============================================================================
-- PHẦN 6: MERGE FUNCTION
-- ============================================================================
-- An toàn:
--   - Không xóa team còn fixtures (self-match hoặc duplicate)
--   - Re-point alias cũ của from_id sang to_id (FIX Bug 1)
--   - Tạo alias mới cho tên from_id
--   - Log lại để rollback
CREATE OR REPLACE FUNCTION merge_team_pair(
  p_from_id UUID,
  p_to_id   UUID,
  p_reason  TEXT DEFAULT 'duplicate_merge'
)
RETURNS TABLE(
  moved_fixtures   INT,
  created_aliases  INT,
  skipped_conflicts INT,
  from_team_deleted BOOLEAN
) AS $$
DECLARE
  v_from_name TEXT;
  v_to_name   TEXT;
  v_moved_home INT := 0;
  v_moved_away INT := 0;
  v_remaining  INT;
  v_alias_created INT := 0;
BEGIN
  -- Validate
  IF p_from_id IS NULL OR p_to_id IS NULL THEN
    RAISE EXCEPTION 'from/to team_id không được NULL';
  END IF;
  IF p_from_id = p_to_id THEN
    RAISE EXCEPTION 'from_id và to_id trùng nhau';
  END IF;

  SELECT canonical_name INTO v_from_name FROM teams WHERE team_id = p_from_id;
  SELECT canonical_name INTO v_to_name   FROM teams WHERE team_id = p_to_id;
  IF v_from_name IS NULL THEN
    RAISE EXCEPTION 'from_id % không tồn tại trong teams', p_from_id;
  END IF;
  IF v_to_name IS NULL THEN
    RAISE EXCEPTION 'to_id % không tồn tại trong teams', p_to_id;
  END IF;

  -- Re-point home_team_id (bỏ qua fixture sẽ thành self-match hoặc trùng lặp)
  WITH movable AS (
    SELECT f.fixture_id FROM fixtures f
    WHERE f.home_team_id = p_from_id
      AND f.away_team_id <> p_to_id
      AND NOT EXISTS (
        SELECT 1 FROM fixtures g
        WHERE g.home_team_id = p_to_id
          AND g.away_team_id = f.away_team_id
          AND g.match_date = f.match_date
      )
  )
  UPDATE fixtures SET home_team_id = p_to_id
  WHERE fixture_id IN (SELECT fixture_id FROM movable);
  GET DIAGNOSTICS v_moved_home = ROW_COUNT;

  -- Re-point away_team_id
  WITH movable AS (
    SELECT f.fixture_id FROM fixtures f
    WHERE f.away_team_id = p_from_id
      AND f.home_team_id <> p_to_id
      AND NOT EXISTS (
        SELECT 1 FROM fixtures g
        WHERE g.away_team_id = p_to_id
          AND g.home_team_id = f.home_team_id
          AND g.match_date = f.match_date
      )
  )
  UPDATE fixtures SET away_team_id = p_to_id
  WHERE fixture_id IN (SELECT fixture_id FROM movable);
  GET DIAGNOSTICS v_moved_away = ROW_COUNT;

  -- Fixture còn sót lại bên from_id (do skip vì xung đột)
  SELECT COUNT(*) INTO v_remaining
  FROM fixtures
  WHERE home_team_id = p_from_id OR away_team_id = p_from_id;

  -- FIX Bug 1: Re-point alias cũ của from_id sang to_id
  UPDATE team_aliases SET team_id = p_to_id WHERE team_id = p_from_id;

  -- Tạo alias mới cho tên from_id (nếu chưa có)
  INSERT INTO team_aliases(team_id, alias_normalized, alias_display, source, confidence)
  SELECT p_to_id, lower(unaccent(v_from_name)), v_from_name, 'MERGE_AUTO', 1.0
  WHERE NOT EXISTS (
    SELECT 1 FROM team_aliases
    WHERE alias_normalized = lower(unaccent(v_from_name))
  );
  GET DIAGNOSTICS v_alias_created = ROW_COUNT;

  -- Chỉ xóa team khi không còn fixture
  IF v_remaining = 0 THEN
    DELETE FROM teams WHERE team_id = p_from_id;
  END IF;

  -- Log
  INSERT INTO team_merge_log(from_team_id, to_team_id, names, fixtures_moved, reason, rolled_back)
  VALUES (p_from_id, p_to_id, v_from_name || ' -> ' || v_to_name,
          v_moved_home + v_moved_away, p_reason, FALSE);

  RETURN QUERY SELECT
    (v_moved_home + v_moved_away),
    v_alias_created,
    v_remaining,
    (v_remaining = 0);
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- PHẦN 7: ROLLBACK FUNCTION
-- ============================================================================
CREATE OR REPLACE FUNCTION rollback_team_merge(p_log_id BIGINT)
RETURNS VOID AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT * INTO r FROM team_merge_log
  WHERE id = p_log_id AND rolled_back = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Log % không tồn tại hoặc đã rollback rồi', p_log_id;
  END IF;

  -- Restore team từ backup
  INSERT INTO teams (team_id, canonical_name)
  SELECT team_id, canonical_name
  FROM teams_backup_before_merge
  WHERE team_id = r.from_team_id
  ON CONFLICT (team_id) DO NOTHING;

  -- Restore fixtures từ backup
  UPDATE fixtures f
  SET home_team_id = b.home_team_id
  FROM fixtures_backup_before_merge b
  WHERE f.fixture_id = b.fixture_id
    AND b.home_team_id = r.from_team_id;

  UPDATE fixtures f
  SET away_team_id = b.away_team_id
  FROM fixtures_backup_before_merge b
  WHERE f.fixture_id = b.fixture_id
    AND b.away_team_id = r.from_team_id;

  -- Restore aliases
  INSERT INTO team_aliases
  SELECT * FROM team_aliases_backup_before_merge a
  WHERE a.team_id = r.from_team_id
  ON CONFLICT DO NOTHING;

  UPDATE team_merge_log SET rolled_back = TRUE WHERE id = p_log_id;

  RAISE NOTICE 'Rolled back merge % (% -> %)', p_log_id, r.from_team_id, r.to_team_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================================================
-- PHẦN 8: AUDIT — CHẠY ĐỂ XEM KẾT QUẢ (không sửa dữ liệu)
-- ============================================================================

-- 8a. Danh sách cặp nghi trùng (BẮT BUỘC xem trước khi merge)
SELECT * FROM v_suspected_duplicates;

-- 8b. Danh sách team ít fixture
SELECT * FROM v_low_fixture_teams;


-- ============================================================================
-- PHẦN 9: DRY-RUN 1 CẶP (BẮT BUỘC trước khi apply thật)
-- ============================================================================
-- Thay <from_id> và <to_id> bằng UUID thật từ kết quả 8a.
-- Chạy BEGIN → merge → verify → ROLLBACK để xem trước.

/*
BEGIN;

SELECT * FROM merge_team_pair(
  '<from_id>'::uuid,
  '<to_id>'::uuid,
  'duplicate: test dry-run'
);

-- Xem log
SELECT * FROM team_merge_log ORDER BY id DESC LIMIT 1;

-- Xem fixtures còn trỏ from_id không (phải = 0)
SELECT COUNT(*) FROM fixtures
WHERE home_team_id = '<from_id>'::uuid OR away_team_id = '<from_id>'::uuid;

ROLLBACK;
*/


-- ============================================================================
-- PHẦN 10: APPLY THẬT (chỉ chạy sau khi dry-run OK)
-- ============================================================================
-- Merge từng cặp trong 1 transaction. Nếu 1 cặp fail → rollback toàn bộ.
-- Thay UUID thật vào. Ví dụ dưới là template.

/*
BEGIN;

-- Cặp 1: Emmen -> FC Emmen
SELECT * FROM merge_team_pair(
  '<emmen_id>'::uuid,
  '<fc_emmen_id>'::uuid,
  'duplicate: Emmen -> FC Emmen'
);

-- Cặp 2: Roda JC Kerkrade -> Roda (hoặc ngược lại, tùy fixture count)
SELECT * FROM merge_team_pair(
  '<roda_jc_id>'::uuid,
  '<roda_id>'::uuid,
  'duplicate: Roda JC -> Roda'
);

-- ... thêm các cặp khác

-- Verify tổng kết
SELECT * FROM team_merge_log
WHERE merged_at > NOW() - INTERVAL '5 minutes'
ORDER BY id;

-- Nếu OK:
COMMIT;

-- Nếu sai:
-- ROLLBACK;
*/


-- ============================================================================
-- PHẦN 11: VERIFY SAU KHI MERGE (chạy sau COMMIT)
-- ============================================================================

-- 11.1 Không còn cặp similarity cao chưa xử lý
SELECT * FROM v_suspected_duplicates;

-- 11.2 Tổng fixture count (so sánh với trước merge)
SELECT COUNT(*) AS total_fixtures FROM fixtures;

-- 11.3 Không có fixture orphan
SELECT f.fixture_id, f.home_team_id, f.away_team_id
FROM fixtures f
WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.team_id = f.home_team_id)
   OR NOT EXISTS (SELECT 1 FROM teams t WHERE t.team_id = f.away_team_id);

-- 11.4 Không còn team rỗng nằm trong cặp nghi trùng
SELECT * FROM v_low_fixture_teams
WHERE team_id IN (
  SELECT team_a_id FROM v_suspected_duplicates
  UNION
  SELECT team_b_id FROM v_suspected_duplicates
);


-- ============================================================================
-- PHẦN 12: ROLLBACK (chỉ chạy nếu phát hiện merge sai)
-- ============================================================================
-- Lấy log_id cần rollback:
--   SELECT * FROM team_merge_log ORDER BY id DESC;
-- Rồi gọi:
--   SELECT rollback_team_merge(<log_id>);
--
-- Nếu rollback nhiều cái, chạy lần lượt từ ID lớn xuống nhỏ.