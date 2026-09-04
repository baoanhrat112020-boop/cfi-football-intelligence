const clean = value => String(value ?? '').trim();

export const FIXTURE_SOURCE_CATALOG = Object.freeze([
  {
    key: 'AISCORE',
    tier: 'A',
    priority: 100,
    domains: ['aiscore.com'],
    entryUrls: ['https://www.aiscore.com/'],
    modes: ['BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_PRIMARY', 'RESULT_CROSSCHECK'],
    primaryCoverage: true
  },
  {
    key: 'BONGDAWAP',
    tier: 'A',
    priority: 98,
    domains: ['bongdawap.com', 'bongda.wap.vn'],
    entryUrls: [
      'https://bongdawap.com/lich-thi-dau-bong-da.html',
      'https://bongda.wap.vn/'
    ],
    modes: ['HTML', 'BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_PRIMARY', 'RESULT_CROSSCHECK'],
    primaryCoverage: true
  },
  {
    key: 'SOFASCORE',
    tier: 'A',
    priority: 96,
    domains: ['sofascore.com'],
    entryUrls: ['https://www.sofascore.com/football'],
    modes: ['DIRECT_API', 'BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_PRIMARY', 'RESULT_CROSSCHECK', 'EVIDENCE'],
    primaryCoverage: true
  },
  {
    key: 'FLASHSCORE',
    tier: 'A',
    priority: 94,
    domains: ['flashscore.com'],
    entryUrls: ['https://www.flashscore.com/football/'],
    modes: ['BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_PRIMARY', 'RESULT_CROSSCHECK'],
    primaryCoverage: true
  },
  {
    key: 'SOCCERWAY',
    tier: 'B',
    priority: 84,
    domains: ['soccerway.com'],
    entryUrls: ['https://www.soccerway.com/'],
    modes: ['BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_SECONDARY', 'RESULT_CROSSCHECK', 'EVIDENCE'],
    primaryCoverage: false
  },
  {
    key: 'FOTMOB',
    tier: 'B',
    priority: 82,
    domains: ['fotmob.com'],
    entryUrls: ['https://www.fotmob.com/'],
    modes: ['BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_SECONDARY', 'RESULT_CROSSCHECK', 'EVIDENCE'],
    primaryCoverage: false
  },
  {
    key: 'LIVESCORE',
    tier: 'B',
    priority: 80,
    domains: ['livescore.com'],
    entryUrls: ['https://www.livescore.com/en/football/'],
    modes: ['BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_SECONDARY', 'RESULT_CROSSCHECK'],
    primaryCoverage: false
  },
  {
    key: '365SCORES',
    tier: 'B',
    priority: 78,
    domains: ['365scores.com'],
    entryUrls: ['https://www.365scores.com/'],
    modes: ['BROWSER', 'WEB_SEARCH'],
    roles: ['DISCOVERY_SECONDARY', 'RESULT_CROSSCHECK'],
    primaryCoverage: false
  },
  {
    key: 'THESPORTSDB',
    tier: 'C',
    priority: 35,
    domains: ['thesportsdb.com'],
    entryUrls: ['https://www.thesportsdb.com/'],
    modes: ['DIRECT_API'],
    roles: ['DISCOVERY_FALLBACK'],
    primaryCoverage: false
  },
  {
    key: 'ESPN',
    tier: 'D',
    priority: 5,
    domains: ['espn.com'],
    entryUrls: ['https://www.espn.com/soccer/fixtures'],
    modes: ['DIRECT_API', 'WEB_SEARCH'],
    roles: ['DISCOVERY_LAST_RESORT'],
    primaryCoverage: false
  }
]);

const UNKNOWN_SOURCE = Object.freeze({
  key: 'UNKNOWN',
  tier: 'X',
  priority: 0,
  domains: [],
  entryUrls: [],
  modes: [],
  roles: ['UNCLASSIFIED'],
  primaryCoverage: false
});

function hostFromUrl(value) {
  const raw = clean(value);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

function domainMatches(host, domain) {
  const d = clean(domain).toLowerCase().replace(/^www\./, '');
  return Boolean(host && d && (host === d || host.endsWith(`.${d}`)));
}

export function fixtureSourceByKey(key) {
  const normalized = clean(key).toUpperCase();
  return FIXTURE_SOURCE_CATALOG.find(source => source.key === normalized) ?? UNKNOWN_SOURCE;
}

export function resolveFixtureSource({ provider, sourceUrl, sourceUrls } = {}) {
  const providerKey = clean(provider).toUpperCase();
  const byProvider = FIXTURE_SOURCE_CATALOG.find(source => source.key === providerKey);
  if (byProvider) return byProvider;

  const urls = [
    sourceUrl,
    ...(Array.isArray(sourceUrls) ? sourceUrls : [])
  ].filter(Boolean);

  for (const value of urls) {
    const host = hostFromUrl(value);
    if (!host) continue;
    const match = FIXTURE_SOURCE_CATALOG.find(source =>
      source.domains.some(domain => domainMatches(host, domain))
    );
    if (match) return match;
  }

  return UNKNOWN_SOURCE;
}

export function annotateFixtureSource(row = {}) {
  const source = resolveFixtureSource(row);
  return {
    ...row,
    sourceKey: source.key,
    sourceTier: source.tier,
    sourcePriority: source.priority,
    sourcePrimaryCoverage: source.primaryCoverage
  };
}

export function buildFixtureSourceScanPlan({ includeFallback = true } = {}) {
  return FIXTURE_SOURCE_CATALOG
    .filter(source => includeFallback || ['A', 'B'].includes(source.tier))
    .map(source => ({
      key: source.key,
      tier: source.tier,
      priority: source.priority,
      entryUrls: [...source.entryUrls],
      domains: [...source.domains],
      modes: [...source.modes],
      roles: [...source.roles],
      primaryCoverage: source.primaryCoverage
    }));
}

export function evaluateFixtureSourceCoverage(rows = []) {
  const sourceMap = new Map();
  let primaryRows = 0;
  let secondaryRows = 0;
  let fallbackRows = 0;
  let unknownRows = 0;

  for (const raw of Array.isArray(rows) ? rows : []) {
    const row = annotateFixtureSource(raw);
    const source = fixtureSourceByKey(row.sourceKey);
    const current = sourceMap.get(source.key) ?? {
      key: source.key,
      tier: source.tier,
      priority: source.priority,
      rows: 0,
      primaryCoverage: source.primaryCoverage
    };
    current.rows += 1;
    sourceMap.set(source.key, current);

    if (source.tier === 'A') primaryRows += 1;
    else if (source.tier === 'B') secondaryRows += 1;
    else if (['C', 'D'].includes(source.tier)) fallbackRows += 1;
    else unknownRows += 1;
  }

  const sources = [...sourceMap.values()].sort((a, b) => b.priority - a.priority);
  const tierASources = sources.filter(source => source.tier === 'A').length;
  const tierBSources = sources.filter(source => source.tier === 'B').length;
  const trustedSources = tierASources + tierBSources;

  const status = tierASources >= 2
    ? 'PRIMARY_MULTI_SOURCE'
    : tierASources === 1 && trustedSources >= 2
      ? 'PRIMARY_PLUS_SECONDARY'
      : tierASources === 1
        ? 'PRIMARY_SINGLE_SOURCE'
        : tierBSources > 0
          ? 'SECONDARY_ONLY'
          : fallbackRows > 0
            ? 'FALLBACK_ONLY'
            : unknownRows > 0
              ? 'UNKNOWN_ONLY'
              : 'NO_SOURCE';

  return {
    status,
    coverageReadyForRanking: tierASources >= 1 && trustedSources >= 2,
    globalRecallClaimAllowed: false,
    primaryRows,
    secondaryRows,
    fallbackRows,
    unknownRows,
    distinctSources: sources.length,
    tierASources,
    tierBSources,
    sources
  };
}
