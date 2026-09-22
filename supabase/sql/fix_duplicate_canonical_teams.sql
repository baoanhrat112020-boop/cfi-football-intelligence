-- GIẢ ĐỊNH (schema thật đã verify qua Supabase, khác spec gốc):
-- teams.team_id là UUID (không phải BIGINT), cột tên là canonical_name (không phải name).
-- team_aliases dùng alias_normalized + alias_display (không phải 1 cột "alias"), có team_id UUID FK.
-- fixtures dùng fixture_id làm PK, home_team_id/away_team_id là UUID.
-- Toàn bộ script bên dưới viết theo schema thật này để chạy được trên production.

-- ============ 1. SETUP ============
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- ============ 7a. GUARDRAILS (chạy trước audit để có normalized_name dùng chung) ============
ALTER TABLE teams ADD COLUMN IF NOT EXISTS normalized_name TEXT
  GENERATED ALWAYS AS (lower(unaccent(canonical_name))) STORED;

ALTER TABLE team_aliases DROP CONSTRAINT IF EXISTS uq_team_aliases_alias_normalized;
ALTER TABLE team_aliases ADD CONSTRAINT uq_team_aliases_alias_normalized UNIQUE (alias_normalized);

-- ============ 2. AUDIT: cặp team similarity >= 0.5 kèm fixture count + gợi ý keep/remove ============
CREATE OR REPLACE VIEW v_suspected_duplicates AS
WITH fixture_counts AS (
  SELECT team_id, COUNT(*) AS fixture_count FROM (
    SELECT home_team_id AS team_id FROM fixtures
    UNION ALL
    SELECT away_team_id AS team_id FROM fixtures
  ) x GROUP BY team_id
)
SELECT
  a.team_id AS team_a_id, a.canonical_name AS team_a_name, COALESCE(fa.fixture_count,0) AS team_a_fixtures,
  b.team_id AS team_b_id, b.canonical_name AS team_b_name, COALESCE(fb.fixture_count,0) AS team_b_fixtures,
  similarity(a.normalized_name, b.normalized_name) AS sim,
  CASE WHEN COALESCE(fa.fixture_count,0) >= COALESCE(fb.fixture_count,0) THEN a.team_id ELSE b.team_id END AS suggest_keep_id,
  CASE WHEN COALESCE(fa.fixture_count,0) >= COALESCE(fb.fixture_count,0) THEN b.team_id ELSE a.team_id END AS suggest_remove_id
FROM teams a
JOIN teams b ON a.team_id < b.team_id
LEFT JOIN fixture_counts fa ON fa.team_id = a.team_id
LEFT JOIN fixture_counts fb ON fb.team_id = b.team_id
WHERE similarity(a.normalized_name, b.normalized_name) >= 0.5
ORDER BY sim DESC;

-- Chạy audit:
-- SELECT * FROM v_suspected_duplicates;

-- ============ 3. Team <= 2 fixtures (nghi ngờ là bản rỗng) ============
CREATE OR REPLACE VIEW v_low_fixture_teams AS
SELECT t.team_id, t.canonical_name, COALESCE(f.fixture_count,0) AS fixture_count
FROM teams t
LEFT JOIN (
  SELECT team_id, COUNT(*) AS fixture_count FROM (
    SELECT home_team_id AS team_id FROM fixtures
    UNION ALL
    SELECT away_team_id AS team_id FROM fixtures
  ) x GROUP BY team_id
) f ON f.team_id = t.team_id
WHERE COALESCE(f.fixture_count,0) <= 2
ORDER BY fixture_count ASC;

-- ============ 4. LOG TABLE ============
CREATE TABLE IF NOT EXISTS team_merge_log (
  id BIGSERIAL PRIMARY KEY,
  merged_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  from_team_id UUID NOT NULL,
  to_team_id UUID NOT NULL,
  names TEXT NOT NULL,
  fixtures_moved INT NOT NULL,
  reason TEXT,
  rolled_back BOOLEAN NOT NULL DEFAULT FALSE
);

-- ============ 5. MERGE FUNCTION ============
-- An toàn: không bao giờ xóa team còn fixtures; không re-point fixture nếu tạo self-match
-- hoặc trùng với fixture đã tồn tại bên to_id (cùng đối thủ + cùng ngày).
CREATE OR REPLACE FUNCTION merge_team_pair(p_from_id UUID, p_to_id UUID, p_reason TEXT)
RETURNS TABLE(moved_fixtures INT, created_aliases INT, skipped_conflicts INT, from_team_deleted BOOLEAN) AS $$
DECLARE
  v_from_name TEXT; v_to_name TEXT;
  v_moved_home INT := 0; v_moved_away INT := 0;
  v_remaining INT; v_alias_created INT := 0;
BEGIN
  IF p_from_id IS NULL OR p_to_id IS NULL THEN RAISE EXCEPTION 'from/to team_id không được NULL'; END IF;
  IF p_from_id = p_to_id THEN RAISE EXCEPTION 'from_id và to_id trùng nhau'; END IF;

  SELECT canonical_name INTO v_from_name FROM teams WHERE team_id = p_from_id;
  SELECT canonical_name INTO v_to_name FROM teams WHERE team_id = p_to_id;
  IF v_from_name IS NULL THEN RAISE EXCEPTION 'from_id % không tồn tại trong teams', p_from_id; END IF;
  IF v_to_name IS NULL THEN RAISE EXCEPTION 'to_id % không tồn tại trong teams', p_to_id; END IF;

  -- re-point home_team_id, bỏ qua fixture sẽ thành self-match hoặc trùng lặp
  WITH movable AS (
    SELECT f.fixture_id FROM fixtures f
    WHERE f.home_team_id = p_from_id
      AND f.away_team_id <> p_to_id
      AND NOT EXISTS (
        SELECT 1 FROM fixtures g
        WHERE g.home_team_id = p_to_id AND g.away_team_id = f.away_team_id AND g.match_date = f.match_date
      )
  )
  UPDATE fixtures SET home_team_id = p_to_id WHERE fixture_id IN (SELECT fixture_id FROM movable);
  GET DIAGNOSTICS v_moved_home = ROW_COUNT;

  WITH movable AS (
    SELECT f.fixture_id FROM fixtures f
    WHERE f.away_team_id = p_from_id
      AND f.home_team_id <> p_to_id
      AND NOT EXISTS (
        SELECT 1 FROM fixtures g
        WHERE g.away_team_id = p_to_id AND g.home_team_id = f.home_team_id AND g.match_date = f.match_date
      )
  )
  UPDATE fixtures SET away_team_id = p_to_id WHERE fixture_id IN (SELECT fixture_id FROM movable);
  GET DIAGNOSTICS v_moved_away = ROW_COUNT;

  -- fixture còn sót lại bên from_id (do bị skip vì xung đột) -> KHÔNG được xóa team
  SELECT COUNT(*) INTO v_remaining FROM fixtures WHERE home_team_id = p_from_id OR away_team_id = p_from_id;

  INSERT INTO team_aliases(team_id, alias_normalized, alias_display, source, confidence)
  SELECT p_to_id, lower(unaccent(v_from_name)), v_from_name, 'MERGE_AUTO', 1.0
  WHERE NOT EXISTS (
    SELECT 1 FROM team_aliases WHERE alias_normalized = lower(unaccent(v_from_name))
  );
  GET DIAGNOSTICS v_alias_created = ROW_COUNT;

  IF v_remaining = 0 THEN
    DELETE FROM teams WHERE team_id = p_from_id;
  END IF;

  INSERT INTO team_merge_log(from_team_id, to_team_id, names, fixtures_moved, reason, rolled_back)
  VALUES (p_from_id, p_to_id, v_from_name || ' -> ' || v_to_name, v_moved_home + v_moved_away, p_reason, FALSE);

  RETURN QUERY SELECT (v_moved_home + v_moved_away), v_alias_created, v_remaining, (v_remaining = 0);
END;
$$ LANGUAGE plpgsql;

-- Cách gọi (BẮT BUỘC review v_suspected_duplicates trước, tự chọn from/to, KHÔNG chạy hàng loạt tự động):
-- SELECT * FROM merge_team_pair('<from_team_id_uuid>', '<to_team_id_uuid>', 'duplicate: Emmen -> FC Emmen');

-- ============ 6. VERIFY SAU MERGE (4 check) ============
-- 6.1 Không còn team rỗng bị nghi trùng (team <=2 fixtures mà vẫn có cặp similarity cao)
SELECT * FROM v_low_fixture_teams WHERE team_id IN (
  SELECT team_a_id FROM v_suspected_duplicates UNION SELECT team_b_id FROM v_suspected_duplicates
);
-- 6.2 Không còn cặp similarity cao chưa xử lý
SELECT * FROM v_suspected_duplicates;
-- 6.3 Tổng fixture count không đổi trước/sau (so sánh thủ công với snapshot trước khi merge)
SELECT COUNT(*) AS total_fixtures FROM fixtures;
-- 6.4 Không có fixture orphan (trỏ tới team_id đã bị xóa)
SELECT f.fixture_id, f.home_team_id, f.away_team_id FROM fixtures f
WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.team_id = f.home_team_id)
   OR NOT EXISTS (SELECT 1 FROM teams t WHERE t.team_id = f.away_team_id);
