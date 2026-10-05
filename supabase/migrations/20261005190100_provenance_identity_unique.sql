ALTER TABLE public.provenance
  ADD CONSTRAINT provenance_identity_key
  UNIQUE NULLS NOT DISTINCT (fixture_id, source_type, source_label, image_hash);
