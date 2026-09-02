const SEASONS = [
  '2526',
  '2425',
  '2324',
  '2223',
  '2122',
  '2021',
  '1920',
  '1819',
  '1718',
  '1617',
  '1516',
];

export const FOOTBALL_DATA_DIVISIONS = Object.freeze([
  ['E0', 'England Premier League', 'England'],
  ['E1', 'England Championship', 'England'],
  ['E2', 'England League One', 'England'],
  ['E3', 'England League Two', 'England'],
  ['EC', 'England National League', 'England'],
  ['SC0', 'Scotland Premiership', 'Scotland'],
  ['SC1', 'Scotland Championship', 'Scotland'],
  ['SC2', 'Scotland League One', 'Scotland'],
  ['SC3', 'Scotland League Two', 'Scotland'],
  ['D1', 'Germany Bundesliga', 'Germany'],
  ['D2', 'Germany 2 Bundesliga', 'Germany'],
  ['I1', 'Italy Serie A', 'Italy'],
  ['I2', 'Italy Serie B', 'Italy'],
  ['SP1', 'Spain La Liga', 'Spain'],
  ['SP2', 'Spain Segunda Division', 'Spain'],
  ['F1', 'France Ligue 1', 'France'],
  ['F2', 'France Ligue 2', 'France'],
  ['N1', 'Netherlands Eredivisie', 'Netherlands'],
  ['B1', 'Belgium First Division A', 'Belgium'],
  ['P1', 'Portugal Primeira Liga', 'Portugal'],
  ['T1', 'Turkey Super Lig', 'Turkey'],
  ['G1', 'Greece Super League', 'Greece'],
].map(([competition, league, country]) => Object.freeze({
  competition,
  league,
  country,
  canonicalCompetitionKey: `${country.toLowerCase()}:${competition.toLowerCase()}`,
})));

export const HISTORICAL_SOURCES = FOOTBALL_DATA_DIVISIONS.flatMap(({ competition, league }) =>
  SEASONS.map((season) => ({
    league,
    season,
    competition,
    url: `https://www.football-data.co.uk/mmz4281/${season}/${competition}.csv`,
  })),
);

export function resolveFootballDataDivision(competition) {
  const key = String(competition ?? '').trim().toUpperCase();
  return FOOTBALL_DATA_DIVISIONS.find((row) => row.competition === key) ?? null;
}

if (HISTORICAL_SOURCES.length !== 242) {
  throw new Error(`HISTORICAL_REGISTRY_COUNT_MISMATCH:${HISTORICAL_SOURCES.length}`);
}
