import { buildFixtureSourceScanPlan } from '../../../src/discovery/fixture-source-policy.mjs';

const broadSources = buildFixtureSourceScanPlan({ includeFallback: false })
  .filter(source => source.modes.includes('BROWSER'))
  .flatMap(source => source.entryUrls.slice(0, 1).map(url => ({
    id: `daily-${source.key.toLowerCase()}`,
    provider: source.key.toLowerCase(),
    url,
    competition: 'ALL FOOTBALL',
    country: 'GLOBAL',
    target_class: 'ALL',
    render_timezone: 'Asia/Ho_Chi_Minh',
    source_tier: source.tier,
    source_priority: source.priority,
    primary_coverage: source.primaryCoverage,
    discovery_scope: 'DAILY_BROAD'
  })));

const targetedSoccerwaySources = [
  {
    id: 'soccerway-club-friendly-women',
    provider: 'soccerway',
    url: 'https://www.soccerway.com/world/club-friendly-women/fixtures/',
    competition: 'Club Friendly Women',
    country: 'World',
    target_class: 'WOMEN',
    render_timezone: 'UTC',
    source_tier: 'B',
    source_priority: 84,
    primary_coverage: false,
    discovery_scope: 'TARGETED'
  },
  {
    id: 'soccerway-world-cup-women-u20',
    provider: 'soccerway',
    url: 'https://www.soccerway.com/world/world-cup-women-u20/fixtures/',
    competition: 'World Cup Women U20',
    country: 'World',
    target_class: 'YOUTH_WOMEN',
    render_timezone: 'UTC',
    source_tier: 'B',
    source_priority: 84,
    primary_coverage: false,
    discovery_scope: 'TARGETED'
  },
  {
    id: 'soccerway-turkey-u19',
    provider: 'soccerway',
    url: 'https://www.soccerway.com/turkey/u19-league/fixtures/',
    competition: 'U19 Elit A Ligi',
    country: 'Turkey',
    target_class: 'YOUTH',
    render_timezone: 'UTC',
    source_tier: 'B',
    source_priority: 84,
    primary_coverage: false,
    discovery_scope: 'TARGETED'
  },
  {
    id: 'soccerway-argentina-reserve',
    provider: 'soccerway',
    url: 'https://www.soccerway.com/argentina/reserve-league/',
    competition: 'Campeonato de Reserva de Primera Division',
    country: 'Argentina',
    target_class: 'RESERVE',
    render_timezone: 'UTC',
    source_tier: 'B',
    source_priority: 84,
    primary_coverage: false,
    discovery_scope: 'TARGETED'
  },
  {
    id: 'soccerway-argentina-amateur',
    provider: 'soccerway',
    url: 'https://www.soccerway.com/argentina/torneo-promocional-amateur/',
    competition: 'Torneo Promocional Amateur',
    country: 'Argentina',
    target_class: 'AMATEUR',
    render_timezone: 'UTC',
    source_tier: 'B',
    source_priority: 84,
    primary_coverage: false,
    discovery_scope: 'TARGETED'
  }
];

export const BROWSER_FIXTURE_SOURCES = [
  ...broadSources,
  ...targetedSoccerwaySources
];
