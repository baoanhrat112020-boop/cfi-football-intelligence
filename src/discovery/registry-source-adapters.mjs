import { normalizeAiFixtureCandidates } from './cfi-discovery.ts';
import {
  annotateFixtureSource,
  evaluateFixtureSourceCoverage
} from './fixture-source-policy.mjs';

const clean = value => String(value ?? '').trim();

export const PUBLIC_DISCOVERY_SOURCE_CLASS = 'PUBLIC_DISCOVERY';
export const WEB_SEARCH_RESCUE_SOURCE_CLASS = 'WEB_SEARCH_RESCUE';
export const TIER_A_BROWSER_SOURCE_CLASS = 'TIER_A_BROWSER_DISCOVERY';

function httpsUrls(values) {
  const out = [];
  for (const value of Array.isArray(values) ? values : []) {
    const url = clean(value);
    if (!url) continue;
    try {
      if (new URL(url).protocol !== 'https:') continue;
    } catch {
      continue;
    }
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function successfulProviderUrls(discovery) {
  const map = new Map();
  for (const attempt of Array.isArray(discovery?.attempts) ? discovery.attempts : []) {
    if (attempt?.ok !== true) continue;
    const provider = clean(attempt?.provider).toUpperCase();
    const url = clean(attempt?.url);
    if (!provider || !url) continue;
    const current = map.get(provider) ?? [];
    if (!current.includes(url)) current.push(url);
    map.set(provider, current);
  }
  return map;
}

function normalizedHost(value) {
  return clean(value).toLowerCase().replace(/^www\./, '');
}

/**
 * A missing providerId may only be recovered from a URL when the URL itself
 * exposes a provider-native, event-level identifier under a narrowly whitelisted
 * first-party pattern. This is not a synthetic-ID fallback.
 *
 * Explicitly forbidden examples:
 * - matchup-level Sofascore slugs (same slug can represent multiple meetings),
 * - schedule/list pages without an event id,
 * - arbitrary path fragments,
 * - a URL whose provider contradicts candidate.provider.
 */
export function deriveProviderIdFromProvenance(candidate = {}) {
  const existing = clean(candidate?.providerId);
  if (existing) {
    return {
      providerId: existing,
      derived: false,
      provider: clean(candidate?.provider).toUpperCase() || null,
      sourceUrl: null,
      rule: 'EXPLICIT_PROVIDER_ID'
    };
  }

  const declaredProvider = clean(candidate?.provider).toUpperCase();
  const urls = httpsUrls(candidate?.sourceUrls);

  for (const value of urls) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      continue;
    }

    const host = normalizedHost(parsed.hostname);
    const path = parsed.pathname.replace(/\/+$/, '') || '/';

    if (host === 'kwff.or.kr') {
      if (declaredProvider && declaredProvider !== 'KWFF') continue;
      const match = path.match(/^\/matches\/(\d+)$/);
      if (!match) continue;
      return {
        providerId: `KWFF:${match[1]}`,
        derived: true,
        provider: 'KWFF',
        sourceUrl: value,
        rule: 'KWFF_MATCH_CENTER_NUMERIC_ID'
      };
    }
  }

  return {
    providerId: null,
    derived: false,
    provider: declaredProvider || null,
    sourceUrl: null,
    rule: null
  };
}

export function publicDiscoveryToSupplement(
  discovery,
  { observedAt = new Date().toISOString() } = {}
) {
  const providerUrls = successfulProviderUrls(discovery);
  const rows = [];

  for (const row of Array.isArray(discovery?.rows) ? discovery.rows : []) {
    const provider = clean(row?.provider).toUpperCase() || 'PUBLIC_DISCOVERY';
    const sourceUrls = httpsUrls([
      ...(providerUrls.get(provider) ?? []),
      ...(Array.isArray(row?.sourceUrls) ? row.sourceUrls : []),
      row?.sourceUrl
    ]);

    rows.push(annotateFixtureSource({
      sourceClass: PUBLIC_DISCOVERY_SOURCE_CLASS,
      provider,
      providerId: clean(row?.providerId) || null,
      sourceUrl: sourceUrls[0] ?? null,
      sourceUrls,
      home: clean(row?.home),
      away: clean(row?.away),
      competition: clean(row?.competition) || null,
      country: clean(row?.country) || null,
      kickoffIso: clean(row?.kickoffIso),
      targetDate: clean(row?.targetDate) || null,
      status: clean(row?.status) || 'scheduled',
      observedAt
    }));
  }

  const sourceHealth = evaluateFixtureSourceCoverage(rows);

  return {
    contract: 'CFI_PUBLIC_DISCOVERY_SUPPLEMENT_V2',
    generatedAt: observedAt,
    sourceClass: PUBLIC_DISCOVERY_SOURCE_CLASS,
    rows,
    telemetry: {
      provider: discovery?.provider ?? 'NONE',
      providers: Array.isArray(discovery?.providers) ? discovery.providers : [],
      attempts: Array.isArray(discovery?.attempts) ? discovery.attempts : [],
      search: discovery?.search ?? null,
      rows: rows.length,
      sourceHealth
    },
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  };
}

export function webSearchCandidatesToSupplement(candidates, window) {
  const derivations = [];
  const prepared = (Array.isArray(candidates) ? candidates : []).map((candidate, index) => {
    const resolution = deriveProviderIdFromProvenance(candidate);
    if (!resolution.derived) return candidate;
    derivations.push({
      index,
      providerId: resolution.providerId,
      provider: resolution.provider,
      sourceUrl: resolution.sourceUrl,
      rule: resolution.rule
    });
    return {
      ...candidate,
      provider: clean(candidate?.provider) || resolution.provider,
      providerId: resolution.providerId
    };
  });

  const normalized = normalizeAiFixtureCandidates(prepared, window);
  const rows = normalized.rows.map(row => annotateFixtureSource({
    sourceClass: WEB_SEARCH_RESCUE_SOURCE_CLASS,
    provider: row.provider,
    providerId: row.providerId,
    sourceUrl: row.sourceUrls[0] ?? null,
    sourceUrls: row.sourceUrls,
    home: row.home,
    away: row.away,
    competition: row.competition,
    country: row.country,
    kickoffIso: row.kickoffIso,
    targetDate: row.targetDate,
    status: row.status,
    observedAt: row.discoveredAt,
    discoveryMode: row.discoveryMode
  }));

  const generatedAt = new Date(Number(window?.nowMs ?? Date.now())).toISOString();
  const sourceHealth = evaluateFixtureSourceCoverage(rows);

  return {
    contract: 'CFI_WEB_SEARCH_RESCUE_SUPPLEMENT_V3',
    generatedAt,
    sourceClass: WEB_SEARCH_RESCUE_SOURCE_CLASS,
    rows,
    rejected: normalized.rejected,
    providerIdDerivations: derivations,
    sourceHealth,
    policy: {
      httpsProvenanceRequired: true,
      providerIdRequired: true,
      providerIdMayBeDerivedOnlyFromWhitelistedFirstPartyEventUrl: true,
      providerIdSyntheticFallbackAllowed: false,
      providerIdDerivationRules: ['KWFF_MATCH_CENTER_NUMERIC_ID'],
      matchupSlugAcceptedAsProviderId: false,
      providerMismatchDerivationAllowed: false,
      prematchOnly: true,
      targetDateRequired: true,
      futureKickoffRequiredForCurrentDay: true,
      prioritySources: [
        'AISCORE',
        'BONGDAWAP',
        'SOFASCORE',
        'FLASHSCORE',
        'SOCCERWAY',
        'FOTMOB',
        'LIVESCORE',
        '365SCORES'
      ],
      espnCanSatisfyCoverageReadiness: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    },
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  };
}

export function snapshotFreshness(
  snapshot,
  { nowMs = Date.now(), ttlMinutes = 30 } = {}
) {
  const ttl = Number(ttlMinutes);
  const generatedMs = Date.parse(clean(snapshot?.generatedAt));

  if (!Number.isFinite(ttl) || ttl <= 0) {
    throw new Error('SNAPSHOT_TTL_INVALID');
  }

  if (!Number.isFinite(generatedMs)) {
    return {
      fresh: false,
      reason: 'GENERATED_AT_REQUIRED',
      ageMinutes: null
    };
  }

  const ageMinutes = (nowMs - generatedMs) / 60_000;

  if (ageMinutes < -1) {
    return {
      fresh: false,
      reason: 'FUTURE_SNAPSHOT_TIMESTAMP',
      ageMinutes
    };
  }

  if (ageMinutes > ttl) {
    return {
      fresh: false,
      reason: 'SNAPSHOT_STALE',
      ageMinutes
    };
  }

  return {
    fresh: true,
    reason: null,
    ageMinutes
  };
}

export function buildRegistryCoverageMatrix(
  registry,
  {
    pcSourceClass = 'PC_NODE',
    tierABrowserSourceClass = TIER_A_BROWSER_SOURCE_CLASS,
    publicSourceClass = PUBLIC_DISCOVERY_SOURCE_CLASS,
    webSourceClass = WEB_SEARCH_RESCUE_SOURCE_CLASS
  } = {}
) {
  const pcClass = clean(pcSourceClass).toUpperCase();
  const tierAClass = clean(tierABrowserSourceClass).toUpperCase();
  const publicClass = clean(publicSourceClass).toUpperCase();
  const webClass = clean(webSourceClass).toUpperCase();
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];

  const matrix = {
    unionFixtures: entries.length,
    pcNodeFixtures: 0,
    tierABrowserFixtures: 0,
    publicDiscoveryFixtures: 0,
    webSearchRescueFixtures: 0,
    pcOnly: 0,
    publicOnly: 0,
    webOnly: 0,
    pcAndPublic: 0,
    pcAndWeb: 0,
    publicAndWeb: 0,
    allThree: 0,
    rescuedWithoutPcNode: 0,
    rescuedByTierABrowser: 0,
    rescuedByPublicDiscovery: 0,
    rescuedByWebSearch: 0
  };

  for (const entry of entries) {
    const classes = new Set(
      (Array.isArray(entry?.sourceClasses) ? entry.sourceClasses : [])
        .map(value => clean(value).toUpperCase())
        .filter(Boolean)
    );

    const pc = classes.has(pcClass);
    const tierA = classes.has(tierAClass);
    const pub = classes.has(publicClass);
    const web = classes.has(webClass);

    if (pc) matrix.pcNodeFixtures += 1;
    if (tierA) matrix.tierABrowserFixtures += 1;
    if (pub) matrix.publicDiscoveryFixtures += 1;
    if (web) matrix.webSearchRescueFixtures += 1;

    if (pc && !pub && !web) matrix.pcOnly += 1;
    if (!pc && pub && !web) matrix.publicOnly += 1;
    if (!pc && !pub && web) matrix.webOnly += 1;
    if (pc && pub && !web) matrix.pcAndPublic += 1;
    if (pc && !pub && web) matrix.pcAndWeb += 1;
    if (!pc && pub && web) matrix.publicAndWeb += 1;
    if (pc && pub && web) matrix.allThree += 1;

    if (!pc && (tierA || pub || web)) matrix.rescuedWithoutPcNode += 1;
    if (!pc && tierA) matrix.rescuedByTierABrowser += 1;
    if (!pc && pub) matrix.rescuedByPublicDiscovery += 1;
    if (!pc && web) matrix.rescuedByWebSearch += 1;
  }

  return matrix;
}
