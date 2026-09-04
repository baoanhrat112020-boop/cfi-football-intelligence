import { FIXTURE_SOURCE_CATALOG } from './fixture-source-policy.mjs';

const clean = value => String(value ?? '').trim();

export const ROLLING_EVIDENCE_QUEUE_SET_CONTRACT =
  'CFI_ROLLING_EVIDENCE_QUEUE_SET_V1';
export const VERIFIED_RANKING_QUEUE_CONTRACT =
  'CFI_VERIFIED_RANKING_QUEUE_V1';
export const CROSSCHECK_REQUIRED_QUEUE_CONTRACT =
  'CFI_CROSSCHECK_REQUIRED_QUEUE_V1';
export const EVIDENCE_REQUEST_PLAN_CONTRACT =
  'CFI_ROLLING_EVIDENCE_REQUEST_PLAN_V1';

const TRUSTED_WEB_SOURCES = FIXTURE_SOURCE_CATALOG
  .filter(source => ['A', 'B'].includes(source.tier))
  .sort((a, b) => b.priority - a.priority)
  .map(source => source.key);

function urgency(minutesToKickoff) {
  const minutes = Number(minutesToKickoff);
  if (!Number.isFinite(minutes)) return 'NORMAL';
  if (minutes <= 15) return 'CRITICAL';
  if (minutes <= 30) return 'HIGH';
  if (minutes <= 60) return 'MEDIUM';
  return 'NORMAL';
}

function requestId(fixture, lane) {
  return `${lane}:${clean(fixture?.identityKey)}`;
}

function baseQueueItem(fixture, lane) {
  const trusted = fixture?.trustedVerification ?? {};
  return {
    requestId: requestId(fixture, lane),
    lane,
    identityKey: fixture?.identityKey ?? null,
    targetDate: fixture?.targetDate ?? null,
    home: fixture?.home ?? null,
    away: fixture?.away ?? null,
    competition: fixture?.competition ?? null,
    kickoffIso: fixture?.kickoffIso ?? null,
    kickoffLocal: fixture?.kickoffLocal ?? null,
    minutesToKickoff: fixture?.minutesToKickoff ?? null,
    urgency: urgency(fixture?.minutesToKickoff),
    queueStatus: fixture?.queueStatus ?? null,
    rankingVerificationStatus:
      fixture?.rankingVerificationStatus ?? 'SINGLE_SOURCE_OBSERVED',
    trustedProviders: Array.isArray(trusted?.trustedProviders)
      ? [...trusted.trustedProviders]
      : [],
    trustedLiveProviders: Array.isArray(trusted?.trustedLiveProviders)
      ? [...trusted.trustedLiveProviders]
      : [],
    hasCanonicalIdentity: trusted?.hasCanonicalIdentity === true,
    hasPcNodeEvidence: fixture?.hasPcNodeEvidence === true,
    rescuedWithoutPcNode: fixture?.rescuedWithoutPcNode === true,
    sourceClasses: Array.isArray(fixture?.sourceClasses)
      ? [...fixture.sourceClasses]
      : [],
    providers: Array.isArray(fixture?.providers)
      ? [...fixture.providers]
      : [],
    decisionUse: false,
    predictionExecutionAllowed: false,
    bigDbWriteAllowed: false
  };
}

function bigDbRequest(item, role) {
  return {
    adapter: 'CFI_BIGDB_RETRIEVAL',
    implementation: 'supabase/functions/cfi-bigdb-retrieval',
    mode: 'READ_ONLY',
    role,
    required: true,
    request: {
      method: 'POST',
      body: {
        home: item.home,
        away: item.away,
        target_date: item.targetDate
      }
    },
    writeAllowed: false
  };
}

function webQueries(item, role) {
  const fixtureLabel = `${item.home} vs ${item.away}`;
  return {
    adapter: 'CFI_WEB_SEARCH_RESCUE',
    implementation: 'local-node/registry/web-search-rescue.mjs',
    ingestFile: 'local-node/cache/registry/web-search-candidates.json',
    mode: 'READ_ONLY_EVIDENCE',
    role,
    trustedSourcePriority: [...TRUSTED_WEB_SOURCES],
    queries: [
      `${fixtureLabel} ${item.targetDate} kickoff fixture`,
      `${fixtureLabel} ${item.targetDate} form H2H`,
      `${fixtureLabel} ${item.targetDate} AiScore Flashscore Sofascore`
    ],
    candidateRequirements: {
      exactHomeAwayIdentityRequired: true,
      explicitKickoffRequiredForFixtureVerification: true,
      httpsProvenanceRequired: true,
      noFabrication: true
    },
    writeAllowed: false
  };
}

function evidencePlan(item, lane) {
  const verified = lane === 'VERIFIED_RANKING_QUEUE';
  return {
    contract: EVIDENCE_REQUEST_PLAN_CONTRACT,
    requestId: item.requestId,
    lane,
    bigDb: bigDbRequest(
      item,
      verified ? 'HISTORICAL_EVIDENCE_REFRESH' : 'IDENTITY_AND_HISTORY_CROSSCHECK'
    ),
    web: webQueries(
      item,
      verified ? 'SUPPLEMENTAL_EVIDENCE_REFRESH' : 'TRUSTED_FIXTURE_CROSSCHECK'
    ),
    routing: verified
      ? {
          bigDbFirst: true,
          webFallbackWhenBigDbInsufficient: true,
          webCanSupplementBigDb: true,
          reverifyFixtureAfterEvidence: false,
          rankingInputEligible: true
        }
      : {
          bigDbFirst: true,
          webFallbackWhenBigDbInsufficient: true,
          webCanSupplementBigDb: true,
          reverifyFixtureAfterEvidence: true,
          rankingInputEligible: false,
          promotionPolicy: 'REVERIFY_NEXT_REGISTRY_CYCLE',
          autoPromoteWithinCycle: false
        },
    safety: {
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false,
      productionMutationAllowed: false
    }
  };
}

function sortQueue(rows) {
  return [...rows].sort((a, b) => {
    const aMinutes = Number.isFinite(Number(a.minutesToKickoff))
      ? Number(a.minutesToKickoff)
      : Infinity;
    const bMinutes = Number.isFinite(Number(b.minutesToKickoff))
      ? Number(b.minutesToKickoff)
      : Infinity;
    return aMinutes - bMinutes || clean(a.identityKey).localeCompare(clean(b.identityKey));
  });
}

export function buildRollingEvidenceQueues(rolling) {
  const verified = [];
  const crosscheck = [];
  const excluded = [];

  for (const fixture of Array.isArray(rolling?.fixtures) ? rolling.fixtures : []) {
    const status = clean(fixture?.rankingVerificationStatus) || 'SINGLE_SOURCE_OBSERVED';
    const needsCrossCheck = fixture?.trustedVerification?.needsCrossCheck === true;

    if (status.endsWith('FAIL_CLOSED')) {
      excluded.push({
        identityKey: fixture?.identityKey ?? null,
        rankingVerificationStatus: status,
        reason: 'FAIL_CLOSED_FIXTURE',
        decisionUse: false
      });
      continue;
    }

    if (fixture?.rankingReady === true) {
      const item = baseQueueItem(fixture, 'VERIFIED_RANKING_QUEUE');
      verified.push({
        ...item,
        rankingInputEligible: true,
        evidencePlan: evidencePlan(item, 'VERIFIED_RANKING_QUEUE')
      });
      continue;
    }

    if (needsCrossCheck) {
      const item = baseQueueItem(fixture, 'CROSSCHECK_REQUIRED_QUEUE');
      crosscheck.push({
        ...item,
        rankingInputEligible: false,
        evidencePlan: evidencePlan(item, 'CROSSCHECK_REQUIRED_QUEUE')
      });
      continue;
    }

    excluded.push({
      identityKey: fixture?.identityKey ?? null,
      rankingVerificationStatus: status,
      reason: 'NOT_RANKING_READY_AND_NOT_CROSSCHECK_ELIGIBLE',
      decisionUse: false
    });
  }

  const verifiedRows = sortQueue(verified);
  const crosscheckRows = sortQueue(crosscheck);
  const evidenceRequests = [
    ...verifiedRows.map(row => row.evidencePlan),
    ...crosscheckRows.map(row => row.evidencePlan)
  ];

  return {
    contract: ROLLING_EVIDENCE_QUEUE_SET_CONTRACT,
    generatedAt: rolling?.generatedAt ?? new Date().toISOString(),
    targetDate: rolling?.targetDate ?? null,
    timeZone: rolling?.timeZone ?? 'Asia/Ho_Chi_Minh',
    horizonMinutes: rolling?.horizonMinutes ?? null,
    verifiedRankingQueue: {
      contract: VERIFIED_RANKING_QUEUE_CONTRACT,
      rows: verifiedRows,
      count: verifiedRows.length,
      decisionUse: false
    },
    crosscheckRequiredQueue: {
      contract: CROSSCHECK_REQUIRED_QUEUE_CONTRACT,
      rows: crosscheckRows,
      count: crosscheckRows.length,
      decisionUse: false
    },
    evidenceRequestPlan: {
      contract: EVIDENCE_REQUEST_PLAN_CONTRACT,
      requests: evidenceRequests,
      count: evidenceRequests.length,
      bigDbImplementation: 'supabase/functions/cfi-bigdb-retrieval',
      webRescueImplementation: 'local-node/registry/web-search-rescue.mjs',
      webRescueCandidateInput:
        'local-node/cache/registry/web-search-candidates.json',
      decisionUse: false,
      bigDbWriteAllowed: false
    },
    excluded,
    metrics: {
      rollingFixtures: Array.isArray(rolling?.fixtures) ? rolling.fixtures.length : 0,
      verifiedRanking: verifiedRows.length,
      crosscheckRequired: crosscheckRows.length,
      excluded: excluded.length,
      accountedFor:
        verifiedRows.length + crosscheckRows.length + excluded.length,
      droppedByQuota: 0
    },
    policy: {
      noRowQuotaDrop: true,
      singleSourceGoesToCrosscheck: true,
      verifiedFixtureStillRefreshesEvidence: true,
      crosscheckDoesNotAutoPromoteWithinCycle: true,
      promotionRequiresRegistryReverification: true,
      existingBigDbRetrievalReused: true,
      existingWebRescueIngestReused: true,
      predictionSemanticsChanged: false,
      decisionUse: false,
      bigDbWriteAllowed: false,
      automaticBetting: false
    }
  };
}
