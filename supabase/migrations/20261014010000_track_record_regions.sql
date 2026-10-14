BEGIN;

CREATE TABLE IF NOT EXISTS public.cfi_country_region (
  country text PRIMARY KEY,
  region text NOT NULL CHECK (region IN ('europe','asia','americas','africa','oceania','international'))
);

CREATE TABLE IF NOT EXISTS public.cfi_competition_country (
  competition text PRIMARY KEY,
  country text NOT NULL,
  league text
);

ALTER TABLE public.cfi_country_region ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cfi_competition_country ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cfi_country_region, public.cfi_competition_country FROM anon, authenticated;

INSERT INTO public.cfi_country_region (country, region) VALUES
  ('England', 'europe'),
  ('Scotland', 'europe'),
  ('Wales', 'europe'),
  ('Northern Ireland', 'europe'),
  ('Ireland', 'europe'),
  ('Republic of Ireland', 'europe'),
  ('Germany', 'europe'),
  ('France', 'europe'),
  ('Italy', 'europe'),
  ('Spain', 'europe'),
  ('Portugal', 'europe'),
  ('Netherlands', 'europe'),
  ('Belgium', 'europe'),
  ('Switzerland', 'europe'),
  ('Austria', 'europe'),
  ('Denmark', 'europe'),
  ('Sweden', 'europe'),
  ('Norway', 'europe'),
  ('Finland', 'europe'),
  ('Iceland', 'europe'),
  ('Poland', 'europe'),
  ('Czech Republic', 'europe'),
  ('Czechia', 'europe'),
  ('Slovakia', 'europe'),
  ('Slovenia', 'europe'),
  ('Croatia', 'europe'),
  ('Serbia', 'europe'),
  ('Bosnia and Herzegovina', 'europe'),
  ('Montenegro', 'europe'),
  ('North Macedonia', 'europe'),
  ('Albania', 'europe'),
  ('Kosovo', 'europe'),
  ('Bulgaria', 'europe'),
  ('Romania', 'europe'),
  ('Hungary', 'europe'),
  ('Greece', 'europe'),
  ('Turkiye', 'europe'),
  ('Turkey', 'europe'),
  ('Cyprus', 'europe'),
  ('Malta', 'europe'),
  ('Luxembourg', 'europe'),
  ('Ukraine', 'europe'),
  ('Belarus', 'europe'),
  ('Russia', 'europe'),
  ('Moldova', 'europe'),
  ('Lithuania', 'europe'),
  ('Latvia', 'europe'),
  ('Estonia', 'europe'),
  ('Faroe Islands', 'europe'),
  ('Gibraltar', 'europe'),
  ('Andorra', 'europe'),
  ('San Marino', 'europe'),
  ('Liechtenstein', 'europe'),
  ('Israel', 'europe'),
  ('Kazakhstan', 'europe'),
  ('Georgia', 'europe'),
  ('Armenia', 'europe'),
  ('Azerbaijan', 'europe'),
  ('Japan', 'asia'),
  ('South Korea', 'asia'),
  ('Korea Republic', 'asia'),
  ('Republic of Korea', 'asia'),
  ('China', 'asia'),
  ('China PR', 'asia'),
  ('Hong Kong', 'asia'),
  ('Taiwan', 'asia'),
  ('Thailand', 'asia'),
  ('Vietnam', 'asia'),
  ('Malaysia', 'asia'),
  ('Indonesia', 'asia'),
  ('Singapore', 'asia'),
  ('Philippines', 'asia'),
  ('India', 'asia'),
  ('Bangladesh', 'asia'),
  ('Pakistan', 'asia'),
  ('Sri Lanka', 'asia'),
  ('Nepal', 'asia'),
  ('Saudi Arabia', 'asia'),
  ('UAE', 'asia'),
  ('United Arab Emirates', 'asia'),
  ('Qatar', 'asia'),
  ('Kuwait', 'asia'),
  ('Bahrain', 'asia'),
  ('Oman', 'asia'),
  ('Iraq', 'asia'),
  ('Iran', 'asia'),
  ('Jordan', 'asia'),
  ('Lebanon', 'asia'),
  ('Syria', 'asia'),
  ('Yemen', 'asia'),
  ('Uzbekistan', 'asia'),
  ('Kyrgyzstan', 'asia'),
  ('Tajikistan', 'asia'),
  ('Turkmenistan', 'asia'),
  ('Cambodia', 'asia'),
  ('Laos', 'asia'),
  ('Myanmar', 'asia'),
  ('Mongolia', 'asia'),
  ('Palestine', 'asia'),
  ('Afghanistan', 'asia'),
  ('Brunei', 'asia'),
  ('Bhutan', 'asia'),
  ('Maldives', 'asia'),
  ('Macau', 'asia'),
  ('Australia', 'asia'),
  ('North Korea', 'asia'),
  ('Timor-Leste', 'asia'),
  ('Chinese Taipei', 'asia'),
  ('Guam', 'asia'),
  ('USA', 'americas'),
  ('United States', 'americas'),
  ('Canada', 'americas'),
  ('Mexico', 'americas'),
  ('Brazil', 'americas'),
  ('Argentina', 'americas'),
  ('Chile', 'americas'),
  ('Colombia', 'americas'),
  ('Uruguay', 'americas'),
  ('Paraguay', 'americas'),
  ('Bolivia', 'americas'),
  ('Peru', 'americas'),
  ('Ecuador', 'americas'),
  ('Venezuela', 'americas'),
  ('Costa Rica', 'americas'),
  ('Panama', 'americas'),
  ('Honduras', 'americas'),
  ('Guatemala', 'americas'),
  ('El Salvador', 'americas'),
  ('Nicaragua', 'americas'),
  ('Jamaica', 'americas'),
  ('Haiti', 'americas'),
  ('Trinidad and Tobago', 'americas'),
  ('Dominican Republic', 'americas'),
  ('Cuba', 'americas'),
  ('Puerto Rico', 'americas'),
  ('Suriname', 'americas'),
  ('Guyana', 'americas'),
  ('Curacao', 'americas'),
  ('Egypt', 'africa'),
  ('Morocco', 'africa'),
  ('Algeria', 'africa'),
  ('Tunisia', 'africa'),
  ('Libya', 'africa'),
  ('South Africa', 'africa'),
  ('Nigeria', 'africa'),
  ('Ghana', 'africa'),
  ('Kenya', 'africa'),
  ('Tanzania', 'africa'),
  ('Uganda', 'africa'),
  ('Ethiopia', 'africa'),
  ('Zambia', 'africa'),
  ('Zimbabwe', 'africa'),
  ('Cameroon', 'africa'),
  ('Senegal', 'africa'),
  ('Ivory Coast', 'africa'),
  ('Cote d''Ivoire', 'africa'),
  ('Mali', 'africa'),
  ('Burkina Faso', 'africa'),
  ('Angola', 'africa'),
  ('Mozambique', 'africa'),
  ('DR Congo', 'africa'),
  ('Congo', 'africa'),
  ('Rwanda', 'africa'),
  ('Sudan', 'africa'),
  ('Botswana', 'africa'),
  ('Namibia', 'africa'),
  ('Malawi', 'africa'),
  ('Madagascar', 'africa'),
  ('Gabon', 'africa'),
  ('Guinea', 'africa'),
  ('Benin', 'africa'),
  ('Togo', 'africa'),
  ('Mauritania', 'africa'),
  ('Mauritius', 'africa'),
  ('Lesotho', 'africa'),
  ('Eswatini', 'africa'),
  ('Niger', 'africa'),
  ('New Zealand', 'oceania'),
  ('Fiji', 'oceania'),
  ('Papua New Guinea', 'oceania'),
  ('Samoa', 'oceania'),
  ('Tahiti', 'oceania'),
  ('New Caledonia', 'oceania'),
  ('Solomon Islands', 'oceania'),
  ('Vanuatu', 'oceania'),
  ('International', 'international'),
  ('International Friendlies', 'international'),
  ('Club Friendlies', 'international'),
  ('UEFA Nations League', 'international'),
  ('CONCACAF Nations League', 'international'),
  ('Euro U21 2027', 'international'),
  ('UEFA Champions League', 'international'),
  ('UEFA Europa League', 'international'),
  ('UEFA Conference League', 'international'),
  ('Copa Libertadores', 'international'),
  ('Copa Sudamericana', 'international'),
  ('AFC Champions League', 'international'),
  ('CAF Champions League', 'international'),
  ('Asia', 'international'),
  ('Africa Cup of Nations Qualification', 'international'),
  ('Women''s World Cup Qualification', 'international'),
  ('Women''s Euro U17', 'international'),
  ('Women''s Euro U19', 'international'),
  ('Euro U17', 'international'),
  ('UEFA Youth League', 'international'),
  ('UEFA Women''s Champions League', 'international'),
  ('Conference League', 'international'),
  ('Champions League', 'international'),
  ('Europa League', 'international')
ON CONFLICT (country) DO UPDATE SET region = EXCLUDED.region;

INSERT INTO public.cfi_competition_country (competition, country, league) VALUES
  ('1.Liga Classic Group 1', 'Switzerland', NULL),
  ('1.Liga Classic Group 2', 'Switzerland', NULL),
  ('1.Liga Classic Group 3', 'Switzerland', NULL),
  ('2. Lig Red Group', 'Turkiye', NULL),
  ('2. Lig White Group', 'Turkiye', NULL),
  ('2. SNL', 'Slovenia', NULL),
  ('3. CFL - Group A', 'Czech Republic', NULL),
  ('3. CFL - Group B', 'Czech Republic', NULL),
  ('3. Lig Group 1', 'Turkiye', NULL),
  ('3. Lig Group 2', 'Turkiye', NULL),
  ('3. Lig Group 3', 'Turkiye', NULL),
  ('3. Liga - Central', 'Slovakia', NULL),
  ('3. Liga - East', 'Slovakia', NULL),
  ('3. Liga - West', 'Slovakia', NULL),
  ('3. MSFL', 'Czech Republic', NULL),
  ('3. SNL - East', 'Slovenia', NULL),
  ('3. SNL - West', 'Slovenia', NULL),
  ('4. liga - Bratislava', 'Slovakia', NULL),
  ('4. liga - Central', 'Slovakia', NULL),
  ('4. liga - East', 'Slovakia', NULL),
  ('4. liga - West', 'Slovakia', NULL),
  ('ASEAN Cup 2026 Final', 'International', NULL),
  ('Arabian Gulf Cup', 'International', NULL),
  ('B1', 'Belgium', 'Pro League'),
  ('Belgian Cup', 'Belgium', NULL),
  ('Botola 2', 'Morocco', NULL),
  ('Botola Pro', 'Morocco', NULL),
  ('Brasiliense 2', 'Brazil', NULL),
  ('Burgenland', 'Austria', NULL),
  ('CONCACAF Nations League - League B', 'International', NULL),
  ('CONCACAF Nations League - League C', 'International', NULL),
  ('Campeonato de Portugal - Group D', 'Portugal', NULL),
  ('Canadian Premier League', 'Canada', NULL),
  ('Carioca B2', 'Brazil', NULL),
  ('Catarinense 3', 'Brazil', NULL),
  ('Cearense 3 - Play Offs', 'Brazil', NULL),
  ('Club Friendly', 'International', NULL),
  ('Copa Chile - Play Offs', 'Chile', NULL),
  ('Copa Pacena', 'Bolivia', NULL),
  ('Copa Parana', 'Brazil', NULL),
  ('Copa Paulista - Play Offs', 'Brazil', NULL),
  ('Copa Rio', 'Brazil', NULL),
  ('Copa Santa Catarina', 'Brazil', NULL),
  ('Copa Simon Bolivar', 'Bolivia', NULL),
  ('Copa del Rey', 'Spain', NULL),
  ('Coppa Italia Primavera', 'Italy', NULL),
  ('Cymru North', 'Wales', NULL),
  ('Cymru Premier', 'Wales', NULL),
  ('Cymru South', 'Wales', NULL),
  ('D1', 'Germany', 'Bundesliga'),
  ('D2', 'Germany', '2. Bundesliga'),
  ('DFB Youth League - Preliminary', 'Germany', NULL),
  ('Derde Divisie', 'Netherlands', NULL),
  ('Diski Challenge', 'South Africa', NULL),
  ('Division 1 - Norra', 'Sweden', NULL),
  ('Division 1 - Södra', 'Sweden', NULL),
  ('Division 2 - Norra Götaland', 'Sweden', NULL),
  ('Division 2 - Norra Svealand', 'Sweden', NULL),
  ('Division 2 - Norrland - Promotion Group', 'Sweden', NULL),
  ('Division 2 - Norrland - Relegation Group', 'Sweden', NULL),
  ('Division 2 - Södra Götaland', 'Sweden', NULL),
  ('Division 2 - Södra Svealand', 'Sweden', NULL),
  ('Division 2 - Västra Götaland', 'Sweden', NULL),
  ('Division Intermedia', 'Paraguay', NULL),
  ('Druha Liga', 'Ukraine', NULL),
  ('E0', 'England', 'Premier League'),
  ('E1', 'England', 'Championship'),
  ('E2', 'England', 'League One'),
  ('E3', 'England', 'League Two'),
  ('EC', 'England', 'National League'),
  ('EFL', 'England', NULL),
  ('EFL Championship', 'England', 'Championship'),
  ('ENGLAND: League One', 'England', 'League One'),
  ('ENGLAND: League Two', 'England', 'League Two'),
  ('ENGLAND: National League', 'England', 'National League'),
  ('Eerste Divisie', 'Netherlands', NULL),
  ('F1', 'France', 'Ligue 1'),
  ('F2', 'France', 'Ligue 2'),
  ('FA Trophy - Qualification', 'England', NULL),
  ('FIFA ASEAN Cup - Division 2', 'International', NULL),
  ('FNL', 'Russia', NULL),
  ('FNL 2 - Division A Silver - Fall Season', 'Russia', NULL),
  ('FNL 2 - Division B - Group 1', 'Russia', NULL),
  ('FNL 2 - Division B - Group 2', 'Russia', NULL),
  ('FNL 2 - Division B - Group 3', 'Russia', NULL),
  ('Friendly International', 'International', NULL),
  ('G1', 'Greece', 'Super League'),
  ('Gamma Ethniki - Group 2', 'Greece', NULL),
  ('Gamma Ethniki - Group 4', 'Greece', NULL),
  ('Gamma Ethniki - Group 5', 'Greece', NULL),
  ('Gamma Ethniki - Group 6', 'Greece', NULL),
  ('Gaucho 2', 'Brazil', NULL),
  ('Gaucho 3', 'Brazil', NULL),
  ('Georgian Cup', 'Georgia', NULL),
  ('Goiano 2', 'Brazil', NULL),
  ('Highland League', 'Scotland', NULL),
  ('I1', 'Italy', 'Serie A'),
  ('I2', 'Italy', 'Serie B'),
  ('IFA Shield', 'India', NULL),
  ('III Liga - Group I', 'Poland', NULL),
  ('III Liga - Group III', 'Poland', NULL),
  ('III Liga - Group IV', 'Poland', NULL),
  ('Isthmian League Premier Division', 'England', NULL),
  ('Italy Serie A', 'Italy', NULL),
  ('J1 League', 'Japan', NULL),
  ('J2 League', 'Japan', NULL),
  ('J3 League', 'Japan', NULL),
  ('Jihocesky KP', 'Czech Republic', NULL),
  ('Jihomoravsky KP', 'Czech Republic', NULL),
  ('Kakkonen Group A - Losers stage', 'Finland', NULL),
  ('Kakkonen Group B - Losers stage', 'Finland', NULL),
  ('Kakkonen Group C - Losers stage', 'Finland', NULL),
  ('Karlovarsky KP', 'Czech Republic', NULL),
  ('Kings League - MENA', 'International', NULL),
  ('Kralovehradecky KP', 'Czech Republic', NULL),
  ('LaLiga2', 'Spain', NULL),
  ('Liberecky KP', 'Czech Republic', NULL),
  ('Liga 3 - Seria 1', 'Romania', NULL),
  ('Liga 3 - Seria 2', 'Romania', NULL),
  ('Liga 3 - Seria 3', 'Romania', NULL),
  ('Liga 3 - Seria 4', 'Romania', NULL),
  ('Liga 3 - Seria 5', 'Romania', NULL),
  ('Liga 3 - Seria 6', 'Romania', NULL),
  ('Liga 3 - Seria 7', 'Romania', NULL),
  ('Liga 3 - Seria 8', 'Romania', NULL),
  ('Liga AUF Uruguaya - Clausura', 'Uruguay', NULL),
  ('Liga FUTVE 2', 'Venezuela', NULL),
  ('Liga MX - Apertura', 'Mexico', NULL),
  ('Liga Premier Serie A', 'Mexico', NULL),
  ('Liga de Expansion MX - Apertura', 'Mexico', NULL),
  ('Ligue 1', 'France', NULL),
  ('Ligue 2', 'France', NULL),
  ('Ligue 3', 'France', NULL),
  ('Lowland League', 'Scotland', NULL),
  ('Mineiro 3', 'Brazil', NULL),
  ('Moravskoslezsky KP', 'Czech Republic', NULL),
  ('Mozzart Bet Prva Liga', 'Serbia', NULL),
  ('N1', 'Netherlands', 'Eredivisie'),
  ('NB III - Northeast', 'Hungary', NULL),
  ('NB III - Northwest', 'Hungary', NULL),
  ('NB III - Southeast', 'Hungary', NULL),
  ('NB III - Southwest', 'Hungary', NULL),
  ('NIFL Championship', 'Northern Ireland', NULL),
  ('NIFL Premiership', 'Northern Ireland', NULL),
  ('National Division 1 - VV', 'Belgium', NULL),
  ('National League', 'England', 'National League'),
  ('Oberliga Baden-Württemberg', 'Germany', NULL),
  ('Oberliga Bayern Nord', 'Germany', NULL),
  ('Oberliga Bayern Süd', 'Germany', NULL),
  ('Oberliga Bremen', 'Germany', NULL),
  ('Oberliga Hamburg', 'Germany', NULL),
  ('Oberliga Hessen', 'Germany', NULL),
  ('Oberliga Mittelrhein', 'Germany', NULL),
  ('Oberliga NOFV- Sud', 'Germany', NULL),
  ('Oberliga NOFV-Nord', 'Germany', NULL),
  ('Oberliga Niederrhein', 'Germany', NULL),
  ('Oberliga Niedersachsen', 'Germany', NULL),
  ('Oberliga Rheinland-Pfalz/Saar', 'Germany', NULL),
  ('Oberliga Schleswig-Holstein', 'Germany', NULL),
  ('Oberliga Westfalen', 'Germany', NULL),
  ('Olomoucky KP', 'Czech Republic', NULL),
  ('P1', 'Portugal', 'Primeira Liga'),
  ('Paraibano 2', 'Brazil', NULL),
  ('Paranaense 3 - Play Offs', 'Brazil', NULL),
  ('Pardubicky KP', 'Czech Republic', NULL),
  ('Persha Liga', 'Ukraine', NULL),
  ('Pershaya Liga', 'Belarus', NULL),
  ('Plzensky KP', 'Czech Republic', NULL),
  ('Primera A - Clausura', 'Colombia', NULL),
  ('Primera Nacional', 'Argentina', NULL),
  ('Primera RFEF - Group 1', 'Spain', NULL),
  ('Primera RFEF - Group 2', 'Spain', NULL),
  ('Promotion League', 'Switzerland', NULL),
  ('Prva Liga - FBiH', 'Bosnia and Herzegovina', NULL),
  ('Prva NL', 'Croatia', NULL),
  ('Regionalliga Bayern', 'Germany', NULL),
  ('Regionalliga Nordost', 'Germany', NULL),
  ('Regionalliga North', 'Germany', NULL),
  ('Regionalliga South', 'Germany', NULL),
  ('Regionalliga Sudwest', 'Germany', NULL),
  ('Regionalliga West', 'Germany', NULL),
  ('SC0', 'Scotland', 'Premiership'),
  ('SC1', 'Scotland', 'Championship'),
  ('SC2', 'Scotland', 'League One'),
  ('SP1', 'Spain', 'LaLiga'),
  ('SP2', 'Spain', 'LaLiga2'),
  ('Salzburg', 'Austria', NULL),
  ('Saudi Pro League', 'Saudi Arabia', NULL),
  ('Second Amateur Division Group ACFF', 'Belgium', NULL),
  ('Second Amateur Division Group VFV A', 'Belgium', NULL),
  ('Second Amateur Division Group VFV B', 'Belgium', NULL),
  ('Segunda RFEF - Group 1', 'Spain', NULL),
  ('Segunda RFEF - Group 2', 'Spain', NULL),
  ('Segunda RFEF - Group 4', 'Spain', NULL),
  ('Segunda RFEF - Group 5', 'Spain', NULL),
  ('Serie B - Relegation Group', 'Italy', NULL),
  ('Serie C - Group A', 'Italy', NULL),
  ('Serie C - Group B', 'Italy', NULL),
  ('Serie C - Group C', 'Italy', NULL),
  ('Serie C - Second stage', 'Italy', NULL),
  ('Serie D - Group F', 'Italy', NULL),
  ('Serie D - Group I', 'Italy', NULL),
  ('Srpska Liga - Belgrade', 'Serbia', NULL),
  ('Srpska Liga - East', 'Serbia', NULL),
  ('Srpska Liga - Vojvodina', 'Serbia', NULL),
  ('Stredocesky KP', 'Czech Republic', NULL),
  ('T1', 'Turkiye', 'Super Lig'),
  ('Tercera RFEF - Group 1', 'Spain', NULL),
  ('Tercera RFEF - Group 10', 'Spain', NULL),
  ('Tercera RFEF - Group 11', 'Spain', NULL),
  ('Tercera RFEF - Group 12', 'Spain', NULL),
  ('Tercera RFEF - Group 13', 'Spain', NULL),
  ('Tercera RFEF - Group 15', 'Spain', NULL),
  ('Tercera RFEF - Group 16', 'Spain', NULL),
  ('Tercera RFEF - Group 17', 'Spain', NULL),
  ('Tercera RFEF - Group 18', 'Spain', NULL),
  ('Tercera RFEF - Group 2', 'Spain', NULL),
  ('Tercera RFEF - Group 3', 'Spain', NULL),
  ('Tercera RFEF - Group 4', 'Spain', NULL),
  ('Tercera RFEF - Group 5', 'Spain', NULL),
  ('Tercera RFEF - Group 6', 'Spain', NULL),
  ('Tercera RFEF - Group 7', 'Spain', NULL),
  ('Tercera RFEF - Group 8', 'Spain', NULL),
  ('Tercera RFEF - Group 9', 'Spain', NULL),
  ('Third League - South-East', 'Bulgaria', NULL),
  ('Tirol', 'Austria', NULL),
  ('Torneo Federal - Additional match', 'Argentina', NULL),
  ('Torneo Federal - Play Offs', 'Argentina', NULL),
  ('Torneo Promocional Amateur - Promotion', 'Argentina', NULL),
  ('Tweede Divisie', 'Netherlands', NULL),
  ('U19 Elit A Ligi', 'Turkiye', NULL),
  ('U19 PAF Ligi', 'Turkiye', NULL),
  ('UEFA Conference League Qualifying', 'International', NULL),
  ('USL Championship', 'USA', NULL),
  ('USL League One', 'USA', NULL),
  ('Ustecky KP', 'Czech Republic', NULL),
  ('Vorarlberg', 'Austria', NULL),
  ('Vysocina KP', 'Czech Republic', NULL),
  ('WSL', 'England', NULL),
  ('WSL 2', 'England', NULL),
  ('Wien', 'Austria', NULL),
  ('Ykkonen - Championship Group', 'Finland', NULL),
  ('Ykkonen - Relegation Group', 'Finland', NULL),
  ('Zlinsky KP', 'Czech Republic', NULL)
ON CONFLICT (competition) DO UPDATE SET country = EXCLUDED.country, league = EXCLUDED.league;

DROP FUNCTION IF EXISTS public.cfi_suggest_track_record(integer, text, timestamp with time zone, integer, uuid, text, text, text[]);

CREATE FUNCTION public.cfi_suggest_track_record(p_days integer DEFAULT NULL::integer, p_tier text DEFAULT NULL::text, p_before_kickoff timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 100, p_before_fixture uuid DEFAULT NULL::uuid, p_model_version text DEFAULT NULL::text, p_market text DEFAULT NULL::text, p_competitions text[] DEFAULT NULL::text[], p_regions text[] DEFAULT NULL::text[], p_countries text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
WITH comp AS (
  SELECT s.fixture_id,
         COALESCE(
           CASE WHEN v.source_provenance->>'stage' IS NOT NULL AND v.source_provenance->>'league' IS NOT NULL AND v.source_provenance->>'league' <> v.source_provenance->>'stage'
                  THEN (v.source_provenance->>'stage') || ' · ' || (v.source_provenance->>'league')
                WHEN v.source_provenance->>'stage' IS NOT NULL THEN v.source_provenance->>'stage'
                WHEN cc.country IS NOT NULL THEN cc.country || ' · ' || COALESCE(cc.league, v.competition)
                ELSE NULL END,
           v.competition) AS name,
         COALESCE(v.source_provenance->>'stage', cc.country, 'Unknown') AS country,
         COALESCE(cr.region, 'unknown') AS region
  FROM public.suggest_pick_log s
  JOIN public.cfi_living_verified_fixtures v ON v.fixture_id = s.fixture_id
  LEFT JOIN public.cfi_competition_country cc ON cc.competition = v.competition AND v.source_provenance->>'stage' IS NULL
  LEFT JOIN public.cfi_country_region cr ON cr.country = COALESCE(v.source_provenance->>'stage', cc.country)
),
base AS (
  SELECT * FROM public.suggest_pick_log
  WHERE (p_days IS NULL OR kickoff_at >= now() - make_interval(days => p_days))
    AND (p_tier IS NULL OR confidence_tier = p_tier)
    AND (p_model_version IS NULL OR model_version = p_model_version)
    AND (p_market IS NULL OR CASE WHEN top_market = 'over_2_5_ft' OR top_market ~ '^over_\d\d*_ft$' THEN 'over_ft'
                                  WHEN top_market ~ '^over_\d\d*_ht$' THEN 'over_ht'
                                  ELSE top_market END = p_market)
    AND (
      (p_competitions IS NULL AND p_regions IS NULL AND p_countries IS NULL)
      OR fixture_id IN (
        SELECT c.fixture_id FROM comp c
        WHERE (p_regions IS NULL OR c.region = ANY(p_regions))
          AND (p_countries IS NULL OR c.country = ANY(p_countries))
          AND (p_competitions IS NULL OR c.name = ANY(p_competitions))
      )
    )
),
scored AS (
  SELECT * FROM base WHERE settled_at IS NOT NULL AND void_reason IS NULL
),
tiers(tier, ord) AS (
  VALUES ('CAO', 1), ('KHA', 2), ('TB', 3), ('THAP', 4), ('RAT_THAP', 5)
),
tier_stats AS (
  SELECT t.tier, t.ord,
         count(s.fixture_id) AS n,
         avg(s.p_over05_ht) AS o05_pred,
         avg(s.hit_o05_ht::int) AS o05_actual,
         avg(s.p_over075_ht) AS o075_pred,
         (count(*) FILTER (WHERE s.result_o075 = 'WIN') + 0.5 * count(*) FILTER (WHERE s.result_o075 = 'HALF_WIN'))::double precision
           / NULLIF(count(s.fixture_id), 0) AS o075_actual,
         avg(s.p_over1_ht) AS o1_pred,
         avg(s.hit_o1_ht::int) AS o1_actual,
         count(*) FILTER (WHERE s.result_o075 = 'WIN') AS win,
         count(*) FILTER (WHERE s.result_o075 = 'HALF_WIN') AS half,
         count(*) FILTER (WHERE s.result_o075 = 'LOSS') AS loss
  FROM tiers t
  LEFT JOIN scored s ON s.confidence_tier = t.tier
  GROUP BY t.tier, t.ord
),
tier_ci AS (
  SELECT ts.*,
         CASE WHEN ts.n > 0 THEN
           greatest(0, (ts.o075_actual + 3.841459 / (2 * ts.n)
             - 1.959964 * sqrt(ts.o075_actual * (1 - ts.o075_actual) / ts.n + 3.841459 / (4 * ts.n * ts.n)))
             / (1 + 3.841459 / ts.n)) END AS ci_low,
         CASE WHEN ts.n > 0 THEN
           least(1, (ts.o075_actual + 3.841459 / (2 * ts.n)
             + 1.959964 * sqrt(ts.o075_actual * (1 - ts.o075_actual) / ts.n + 3.841459 / (4 * ts.n * ts.n)))
             / (1 + 3.841459 / ts.n)) END AS ci_high
  FROM tier_stats ts
),
labeled AS (
  SELECT b.*, x.line AS ou_line, x.label AS top_result
  FROM base b
  CROSS JOIN LATERAL (
    SELECT m.line,
           CASE
             WHEN b.top_market IS NULL OR b.settled_at IS NULL THEN NULL
             WHEN m.period = 'ht' THEN CASE WHEN b.ht_home IS NOT NULL THEN public.ou_result(b.ht_home + b.ht_away, m.line) END
             WHEN m.period = 'ft' THEN public.ou_result(b.ft_home + b.ft_away, m.line)
             ELSE CASE b.hit_top_market WHEN true THEN 'WIN' WHEN false THEN 'LOSS' END
           END AS label
    FROM (
      SELECT CASE WHEN b.top_market = 'over_2_5_ft' THEN 'ft' ELSE q.r[3] END AS period,
             CASE WHEN b.top_market = 'over_2_5_ft' THEN 2.5
                  WHEN q.r IS NULL THEN NULL
                  WHEN q.r[2] = '' THEN q.r[1]::numeric
                  ELSE (q.r[1] || '.' || q.r[2])::numeric END AS line
      FROM (SELECT regexp_match(b.top_market, '^over_(\d)(\d*)_(ht|ft)$') AS r) q
    ) m
  ) x
),
market_stats AS (
  SELECT l.model_version,
         CASE WHEN l.top_market = 'over_2_5_ft' OR l.top_market ~ '^over_\d\d*_ft$' THEN 'over_ft'
              WHEN l.top_market ~ '^over_\d\d*_ht$' THEN 'over_ht'
              ELSE l.top_market END AS market,
         l.ou_line AS line,
         count(*) FILTER (WHERE l.top_result = 'WIN') AS n_win,
         count(*) FILTER (WHERE l.top_result = 'HALF_WIN') AS n_half_win,
         count(*) FILTER (WHERE l.top_result = 'PUSH') AS n_push,
         count(*) FILTER (WHERE l.top_result = 'HALF_LOSS') AS n_half_loss,
         count(*) FILTER (WHERE l.top_result = 'LOSS') AS n_loss,
         avg(l.top_market_prob) FILTER (WHERE l.top_result <> 'PUSH') AS prob_avg
  FROM labeled l
  WHERE l.settled_at IS NOT NULL AND l.void_reason IS DISTINCT FROM 'NO_RESULT' AND l.top_result IS NOT NULL
  GROUP BY 1, 2, 3
),
market_rate AS (
  SELECT ms.*,
         (ms.n_win + ms.n_half_win + ms.n_half_loss + ms.n_loss) AS n,
         (ms.n_win + 0.75 * ms.n_half_win + 0.25 * ms.n_half_loss)::double precision
           / NULLIF(ms.n_win + ms.n_half_win + ms.n_half_loss + ms.n_loss, 0) AS hit_rate
  FROM market_stats ms
),
market_ci AS (
  SELECT mr.*,
         CASE WHEN mr.n > 0 THEN
           greatest(0, (mr.hit_rate + 3.841459 / (2 * mr.n)
             - 1.959964 * sqrt(mr.hit_rate * (1 - mr.hit_rate) / mr.n + 3.841459 / (4 * mr.n * mr.n)))
             / (1 + 3.841459 / mr.n)) END AS ci_low,
         CASE WHEN mr.n > 0 THEN
           least(1, (mr.hit_rate + 3.841459 / (2 * mr.n)
             + 1.959964 * sqrt(mr.hit_rate * (1 - mr.hit_rate) / mr.n + 3.841459 / (4 * mr.n * mr.n)))
             / (1 + 3.841459 / mr.n)) END AS ci_high
  FROM market_rate mr
),
recent AS (
  SELECT fixture_id, kickoff_at, home_team, away_team,
         CASE WHEN ht_home IS NOT NULL THEN ht_home || '-' || ht_away END AS ht_score,
         ft_home || '-' || ft_away AS ft_score,
         confidence_tier, top_market, hit_top_market, result_o075, ou_line, top_result, model_version, top_market_prob,
         (SELECT c.name FROM comp c WHERE c.fixture_id = labeled.fixture_id LIMIT 1) AS competition
  FROM labeled
  WHERE settled_at IS NOT NULL AND void_reason IS DISTINCT FROM 'NO_RESULT'
    AND (p_before_kickoff IS NULL
         OR kickoff_at < p_before_kickoff
         OR (p_before_fixture IS NOT NULL AND kickoff_at = p_before_kickoff AND fixture_id < p_before_fixture))
  ORDER BY kickoff_at DESC, fixture_id DESC
  LIMIT CASE WHEN p_before_kickoff IS NULL THEN 100 ELSE least(greatest(COALESCE(p_limit, 100), 1), 200) END
)
SELECT jsonb_build_object(
  'days', p_days,
  'tier', p_tier,
  'model_version', p_model_version,
  'market', p_market,
  'competitions_filter', to_jsonb(p_competitions),
  'regions_filter', to_jsonb(p_regions),
  'countries_filter', to_jsonb(p_countries),
  'competitions', COALESCE((SELECT jsonb_agg(jsonb_build_object('name', name, 'n', n, 'country', country, 'region', region) ORDER BY n DESC, name) FROM (SELECT name, min(country) AS country, min(region) AS region, count(*) AS n FROM comp WHERE name IS NOT NULL GROUP BY name) cn), '[]'::jsonb),
  'generated_at', now(),
  'counts', jsonb_build_object(
    'pending', (SELECT count(*) FROM base WHERE settled_at IS NULL),
    'scored', (SELECT count(*) FROM scored),
    'void_no_result', (SELECT count(*) FROM base WHERE void_reason = 'NO_RESULT'),
    'void_no_ht', (SELECT count(*) FROM base WHERE void_reason = 'NO_HT'),
    'logging_since', (SELECT min(first_logged_at) FROM public.suggest_pick_log)
  ),
  'calibration_by_tier', (
    SELECT jsonb_agg(jsonb_build_object(
      'tier', tier, 'n', n,
      'o05_pred', round(o05_pred::numeric, 4), 'o05_actual', round(o05_actual::numeric, 4),
      'o075_pred', round(o075_pred::numeric, 4), 'o075_actual', round(o075_actual::numeric, 4),
      'o1_pred', round(o1_pred::numeric, 4), 'o1_actual', round(o1_actual::numeric, 4),
      'win', win, 'half', half, 'loss', loss,
      'wilson_95_low', round(ci_low::numeric, 4), 'wilson_95_high', round(ci_high::numeric, 4)
    ) ORDER BY ord) FROM tier_ci
  ),
  'by_top_market', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'market', market, 'line', line, 'model_version', model_version,
      'n', n, 'n_win', n_win, 'n_half_win', n_half_win, 'n_push', n_push,
      'n_half_loss', n_half_loss, 'n_loss', n_loss,
      'prob_avg', round(prob_avg::numeric, 4), 'hit_rate', round(hit_rate::numeric, 4),
      'wilson_95_low', round(ci_low::numeric, 4), 'wilson_95_high', round(ci_high::numeric, 4)
    ) ORDER BY n DESC, market, line, model_version) FROM market_ci
  ), '[]'::jsonb),
  'recent_settled', COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'fixture_id', fixture_id,
      'kickoff', kickoff_at, 'home', home_team, 'away', away_team,
      'ht_score', ht_score, 'ft_score', ft_score, 'tier', confidence_tier,
      'top_market', top_market, 'top_line', ou_line, 'top_result', top_result,
      'hit', hit_top_market, 'o075_result', result_o075, 'model_version', model_version,
      'top_market_prob', round(top_market_prob::numeric, 4), 'league', competition
    ) ORDER BY kickoff_at DESC, fixture_id DESC) FROM recent
  ), '[]'::jsonb)
);
$function$;

REVOKE ALL ON FUNCTION public.cfi_suggest_track_record(integer, text, timestamp with time zone, integer, uuid, text, text, text[], text[], text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cfi_suggest_track_record(integer, text, timestamp with time zone, integer, uuid, text, text, text[], text[], text[]) TO service_role;

COMMIT;
