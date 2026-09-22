-- Auto-merge cặp team trùng lặp an toàn. Restore nếu cần:
-- TRUNCATE teams, fixtures; INSERT INTO teams SELECT * FROM teams_backup_pre_merge;
-- INSERT INTO fixtures SELECT * FROM fixtures_backup_pre_merge;
BEGIN;

DROP TABLE IF EXISTS teams_backup_pre_merge;
DROP TABLE IF EXISTS fixtures_backup_pre_merge;
CREATE TABLE teams_backup_pre_merge AS SELECT * FROM teams;
CREATE TABLE fixtures_backup_pre_merge AS SELECT * FROM fixtures;

DROP TABLE IF EXISTS candidates_to_merge;
CREATE TEMP TABLE candidates_to_merge AS
SELECT DISTINCT ON (from_id) from_id, to_id, from_name, to_name, sim
FROM (
  SELECT
    CASE WHEN team_a_fixtures <= team_b_fixtures THEN team_a_id ELSE team_b_id END AS from_id,
    CASE WHEN team_a_fixtures <= team_b_fixtures THEN team_b_id ELSE team_a_id END AS to_id,
    CASE WHEN team_a_fixtures <= team_b_fixtures THEN team_a_name ELSE team_b_name END AS from_name,
    CASE WHEN team_a_fixtures <= team_b_fixtures THEN team_b_name ELSE team_a_name END AS to_name,
    sim
  FROM v_suspected_duplicates
  WHERE sim >= 0.9
    AND team_a_name !~* '\y(U19|U20|U21|U23|Women|Reserves|Youth)\y' AND team_a_name !~* '\(W\)' AND team_a_name !~* '\yW\y'
    AND team_b_name !~* '\y(U19|U20|U21|U23|Women|Reserves|Youth)\y' AND team_b_name !~* '\(W\)' AND team_b_name !~* '\yW\y'
    AND LEAST(team_a_fixtures, team_b_fixtures) <= 5
    AND GREATEST(team_a_fixtures, team_b_fixtures) >= 3
) x
ORDER BY from_id, sim DESC;

DO $$
DECLARE
  r RECORD; v_result RECORD;
  v_merges INT := 0; v_fixtures_moved INT := 0; v_errors INT := 0;
BEGIN
  FOR r IN SELECT * FROM candidates_to_merge LOOP
    BEGIN
      SELECT * INTO v_result FROM merge_team_pair(r.from_id, r.to_id, format('auto-merge sim=%.3f batch', r.sim));
      v_merges := v_merges + 1;
      v_fixtures_moved := v_fixtures_moved + COALESCE(v_result.moved_fixtures, 0);
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors + 1;
      RAISE NOTICE 'MERGE FAILED % (%) -> % (%): %', r.from_id, r.from_name, r.to_id, r.to_name, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'BATCH SUMMARY: merges_done=%, fixtures_moved=%, errors=%', v_merges, v_fixtures_moved, v_errors;
END $$;

DO $$
DECLARE
  v_remaining_dup INT; v_orphan INT;
BEGIN
  SELECT COUNT(*) INTO v_remaining_dup FROM v_suspected_duplicates
  WHERE sim >= 0.9
    AND team_a_name !~* '\y(U19|U20|U21|U23|Women|Reserves|Youth)\y' AND team_a_name !~* '\(W\)' AND team_a_name !~* '\yW\y'
    AND team_b_name !~* '\y(U19|U20|U21|U23|Women|Reserves|Youth)\y' AND team_b_name !~* '\(W\)' AND team_b_name !~* '\yW\y'
    AND LEAST(team_a_fixtures, team_b_fixtures) <= 5
    AND GREATEST(team_a_fixtures, team_b_fixtures) >= 3;

  SELECT COUNT(*) INTO v_orphan FROM fixtures f
  WHERE NOT EXISTS (SELECT 1 FROM teams t WHERE t.team_id = f.home_team_id)
     OR NOT EXISTS (SELECT 1 FROM teams t WHERE t.team_id = f.away_team_id);

  RAISE NOTICE 'VERIFY: remaining_duplicates=%, orphan_fixtures=%', v_remaining_dup, v_orphan;
  IF v_orphan > 0 THEN
    RAISE WARNING 'orphan_fixtures > 0 — kiem tra truoc khi tin batch nay an toan';
  END IF;
END $$;

COMMIT;
