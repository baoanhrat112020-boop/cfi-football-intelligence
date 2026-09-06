import { resolveFixtureSource } from './fixture-source-policy.mjs';

const clean = value => String(value ?? '').trim();

export const FIXTURE_VERIFICATION_CONTRACT =
  'CFI_FIXTURE_TRUSTED_VERIFICATION_V1';

function classifyObservation(source, pcSourceClass) {
  const resolved = resolveFixtureSource({
    provider: source?.provider,
    sourceUrl: source?.sourceUrl,
    sourceUrls: source?.sourceUrl ? [source.sourceUrl] : []
  });

  const sourceClass = clean(source?.sourceClass).toUpperCase();
  const provider = clean(source?.provider).toUpperCase() || resolved.key;
  const trustedTier = ['A', 'B'].includes(resolved.tier);

  return {
    sourceClass,
    provider,
    sourceKey: resolved.key,
    sourceTier: resolved.tier,
    sourcePriority: resolved.priority,
    trustedTier,
    pcNode: sourceClass === pcSourceClass,
    sourceUrl: source?.sourceUrl ?? null,
    kickoffIso: source?.kickoffIso ?? null
  };
}

export function evaluateFixtureVerification(
  entry,
  { pcSourceClass = 'PC_NODE' } = {}
) {
  const pcClass = clean(pcSourceClass).toUpperCase();
  const observations = (Array.isArray(entry?.sourceObservations)
    ? entry.sourceObservations
    : [])
    .map(source => classifyObservation(source, pcClass));

  const trusted = observations.filter(source => source.trustedTier);
  const trustedProviders = [...new Set(
    trusted.map(source => source.sourceKey).filter(key => key && key !== 'UNKNOWN')
  )].sort();
  const trustedLiveProviders = [...new Set(
    trusted
      .filter(source => !source.pcNode)
      .map(source => source.sourceKey)
      .filter(key => key && key !== 'UNKNOWN')
  )].sort();

  const hasCanonicalIdentity = Boolean(
    clean(entry?.canonicalHomeId) && clean(entry?.canonicalAwayId)
  );
  const hasKickoffConflict = entry?.hasKickoffConflict === true ||
    (Array.isArray(entry?.kickoffCandidates) && entry.kickoffCandidates.length > 1);
  const hasTerminal = entry?.hasTerminalObservation === true;
  const hasUpstreamFailClosed = entry?.hasUpstreamFailClosed === true;

  let status = 'SINGLE_SOURCE_OBSERVED';
  let rankingReady = false;
  let basis = 'NEEDS_TRUSTED_CROSSCHECK';

  if (hasTerminal) {
    status = 'TERMINAL_OBSERVED_FAIL_CLOSED';
    basis = 'TERMINAL_OBSERVATION';
  } else if (hasUpstreamFailClosed) {
    status = 'UPSTREAM_FAIL_CLOSED';
    basis = 'UPSTREAM_CANONICAL_FAIL_CLOSED';
  } else if (hasKickoffConflict) {
    status = 'KICKOFF_CONFLICT_FAIL_CLOSED';
    basis = 'MULTIPLE_KICKOFF_CANDIDATES';
  } else if (hasCanonicalIdentity && trustedLiveProviders.length >= 1) {
    status = 'CANONICAL_PLUS_LIVE_VERIFIED';
    rankingReady = true;
    basis = 'EXACT_CANONICAL_IDENTITY_PLUS_TRUSTED_LIVE_SOURCE';
  } else if (trustedProviders.length >= 2) {
    status = 'MULTI_SOURCE_VERIFIED';
    rankingReady = true;
    basis = 'TWO_OR_MORE_TRUSTED_A_B_PROVIDERS_SAME_IDENTITY_AND_KICKOFF';
  } else if (trustedProviders.length === 1) {
    status = 'SINGLE_TRUSTED_SOURCE_OBSERVED';
    basis = 'ONE_TRUSTED_A_B_PROVIDER_ONLY';
  } else if ((entry?.distinctProviderCount ?? 0) > 1) {
    status = 'MULTI_SOURCE_UNTRUSTED_OBSERVED';
    basis = 'MULTIPLE_SOURCES_BUT_NOT_TRUSTED_A_B_QUORUM';
  }

  return {
    contract: FIXTURE_VERIFICATION_CONTRACT,
    status,
    rankingReady,
    rankingLane: rankingReady ? 'VERIFIED_CANDIDATE' : 'DISCOVERY_ONLY',
    needsCrossCheck: !rankingReady && !status.endsWith('FAIL_CLOSED'),
    hasCanonicalIdentity,
    trustedProviderCount: trustedProviders.length,
    trustedProviders,
    trustedLiveProviderCount: trustedLiveProviders.length,
    trustedLiveProviders,
    observedProviderCount: new Set(
      observations.map(source => source.provider).filter(Boolean)
    ).size,
    sourceEvidence: observations,
    basis
  };
}

export function annotateRegistryFixtureVerification(
  registry,
  options = {}
) {
  const entries = (Array.isArray(registry?.entries) ? registry.entries : [])
    .map(entry => {
      const trustedVerification = evaluateFixtureVerification(entry, options);
      return {
        ...entry,
        trustedVerification,
        rankingReady: trustedVerification.rankingReady,
        rankingVerificationStatus: trustedVerification.status,
        rankingLane: trustedVerification.rankingLane
      };
    });

  const verified = entries.filter(entry => entry.rankingReady);
  const singleSource = entries.filter(entry =>
    ['SINGLE_SOURCE_OBSERVED', 'SINGLE_TRUSTED_SOURCE_OBSERVED'].includes(
      entry.rankingVerificationStatus
    )
  );
  const failClosed = entries.filter(entry =>
    entry.rankingVerificationStatus.endsWith('FAIL_CLOSED')
  );

  return {
    ...registry,
    entries,
    trustedVerificationCoverage: {
      contract: FIXTURE_VERIFICATION_CONTRACT,
      fixtures: entries.length,
      rankingReady: verified.length,
      discoveryOnly: entries.length - verified.length,
      multiSourceVerified: entries.filter(
        entry => entry.rankingVerificationStatus === 'MULTI_SOURCE_VERIFIED'
      ).length,
      canonicalPlusLiveVerified: entries.filter(
        entry => entry.rankingVerificationStatus === 'CANONICAL_PLUS_LIVE_VERIFIED'
      ).length,
      singleSourceObserved: singleSource.length,
      failClosed: failClosed.length,
      globalCoverageReadinessDoesNotVerifyIndividualFixture: true
    }
  };
}

export function annotateRollingVerification(rolling, registry) {
  const byIdentity = new Map(
    (Array.isArray(registry?.entries) ? registry.entries : [])
      .map(entry => [entry.identityKey, entry])
  );

  const fixtures = (Array.isArray(rolling?.fixtures) ? rolling.fixtures : [])
    .map(fixture => {
      const entry = byIdentity.get(fixture.identityKey);
      return {
        ...fixture,
        rankingReady: entry?.rankingReady === true,
        rankingVerificationStatus:
          entry?.rankingVerificationStatus ?? 'SINGLE_SOURCE_OBSERVED',
        rankingLane: entry?.rankingLane ?? 'DISCOVERY_ONLY',
        trustedVerification: entry?.trustedVerification ?? null
      };
    });

  return {
    ...rolling,
    fixtures,
    metrics: {
      ...(rolling?.metrics ?? {}),
      rankingReady: fixtures.filter(fixture => fixture.rankingReady).length,
      discoveryOnly: fixtures.filter(fixture => !fixture.rankingReady).length
    },
    rankingPolicy: {
      globalSourceCoverageIsInsufficient: true,
      multiSourceTrustedOrCanonicalPlusLiveRequired: true,
      singleSourceCanEnterEvidenceRefresh: true,
      singleSourceCanEnterHighConfidenceRanking: false,
      decisionUse: false
    }
  };
}
