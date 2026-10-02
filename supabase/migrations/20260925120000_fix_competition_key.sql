-- Fix competition_key
update fixtures
set competition_key = (
    select case c.competition
        when 'E0' then 'england:e0'
        when 'E1' then 'england:e1'
        when 'E2' then 'england:e2'
        when 'E3' then 'england:e3'
        when 'EC' then 'england:ec'
        when 'SP1' then 'spain:sp1'
        when 'SP2' then 'spain:sp2'
        when 'I1' then 'italy:i1'
        when 'I2' then 'italy:i2'
        when 'D1' then 'germany:d1'
        when 'D2' then 'germany:d2'
        when 'F1' then 'france:f1'
        when 'F2' then 'france:f2'
        when 'N1' then 'netherlands:n1'
        when 'P1' then 'portugal:p1'
        when 'B1' then 'belgium:b1'
        when 'T1' then 'turkey:t1'
        when 'G1' then 'greece:g1'
        when 'SC0' then 'scotland:sc0'
        when 'SC1' then 'scotland:sc1'
        when 'SC2' then 'scotland:sc2'
        when 'SC3' then 'scotland:sc3'
    end
    from cfi_living_verified_fixtures c
    where c.fixture_id = fixtures.fixture_id
    limit 1
)
where fixture_id in (
    select fixture_id from cfi_living_verified_fixtures
)
and (competition_key is null or competition_key = 'unknown');
