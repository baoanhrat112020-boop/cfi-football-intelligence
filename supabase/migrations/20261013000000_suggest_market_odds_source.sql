DO $$
DECLARE
  fn oid;
  def text;
BEGIN
  FOR fn IN
    SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'cfi_suggest_upcoming'
  LOOP
    def := pg_get_functiondef(fn);
    IF position('''source'', mo.source' IN def) = 0
       AND position('''handicap_side'', mo.handicap_side' IN def) > 0 THEN
      def := replace(def, '''handicap_side'', mo.handicap_side', '''handicap_side'', mo.handicap_side, ''source'', mo.source');
      EXECUTE def;
    END IF;
  END LOOP;
END $$;
