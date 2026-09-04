const clean = value => String(value ?? '').trim();

export const SHADOW_EVIDENCE_DISPATCH_CONTRACT =
  'CFI_SHADOW_EVIDENCE_DISPATCH_V1';
export const SHADOW_EVIDENCE_RECEIPT_CONTRACT =
  'CFI_SHADOW_EVIDENCE_RECEIPT_V1';
export const WEB_CROSSCHECK_REQUEST_PLAN_CONTRACT =
  'CFI_WEB_CROSSCHECK_REQUEST_PLAN_V1';
export const NEXT_CYCLE_REVERIFICATION_CONTRACT =
  'CFI_NEXT_CYCLE_REVERIFICATION_CANDIDATES_V1';

export function resolveBigDbRetrievalUrl(baseUrl) {
  const base = clean(baseUrl).replace(/\/+$/, '');
  if (!base) return { ok: false, reason: 'CFI_DB_BASE_URL_MISSING', url: null };
  if (/\/cfi-bigdb-retrieval$/i.test(base)) return { ok: true, reason: null, url: base };
  if (/\/cfi-db$/i.test(base)) {
    return {
      ok: true,
      reason: null,
      url: base.replace(/\/cfi-db$/i, '/cfi-bigdb-retrieval')
    };
  }
  return { ok: false, reason: 'CFI_DB_BASE_URL_UNSUPPORTED', url: null };
}

export function classifyBigDbReceipt({ httpStatus = null, body = null, error = null } = {}) {
  const statusCode = Number(httpStatus);
  const payload = body && typeof body === 'object' ? body : {};

  if (error) {
    return {
      status: 'ERROR',
      reason: 'BIGDB_PREFLIGHT_EXCEPTION',
      ready: false,
      error: clean(error),
      identity: null,
      exactTeam: null,
      temporalAudit: null
    };
  }

  if (statusCode === 401 || payload?.error === 'UNAUTHORIZED') {
    return {
      status: 'UNAUTHORIZED',
      reason: 'BIGDB_UNAUTHORIZED',
      ready: false,
      error: payload?.error ?? 'UNAUTHORIZED',
      identity: null,
      exactTeam: null,
      temporalAudit: null
    };
  }

  if (Number.isFinite(statusCode) && statusCode >= 500) {
    return {
      status: 'UNAVAILABLE',
      reason: payload?.error ?? 'BIGDB_SERVER_ERROR',
      ready: false,
      error: payload?.message ?? payload?.error ?? `HTTP_${statusCode}`,
      identity: null,
      exactTeam: null,
      temporalAudit: null
    };
  }

  if (Number.isFinite(statusCode) && (statusCode < 200 || statusCode >= 300)) {
    return {
      status: 'ERROR',
      reason: payload?.error ?? `BIGDB_HTTP_${statusCode}`,
      ready: false,
      error: payload?.message ?? payload?.error ?? `HTTP_${statusCode}`,
      identity: null,
      exactTeam: null,
      temporalAudit: null
    };
  }

  const homeId = clean(payload?.identity?.homeTeamId) || null;
  const awayId = clean(payload?.identity?.awayTeamId) || null;
  const homeCanonical = clean(payload?.identity?.homeCanonical) || null;
  const awayCanonical = clean(payload?.identity?.awayCanonical) || null;
  const homeHistory = Number(payload?.exactTeam?.home?.retrieved ?? 0);
  const awayHistory = Number(payload?.exactTeam?.away?.retrieved ?? 0);
  const h2hHistory = Number(payload?.exactTeam?.h2h?.retrieved ?? 0);
  const temporalVerified = payload?.temporalAudit?.verified === true;
  const responseOk = payload?.status === 'OK';

  let reason = 'BIGDB_PREFLIGHT_FAIL';
  if (!homeId || !awayId) reason = 'NO_EXACT_IDENTITY';
  else if (homeHistory <= 0 || awayHistory <= 0) reason = 'ZERO_EXACT_TEAM_EVIDENCE';
  else if (!temporalVerified) reason = 'STRICT_PRIOR_PREFLIGHT_FAIL';
  else if (responseOk) reason = 'EVIDENCE_READY';

  const ready =
    responseOk &&
    Boolean(homeId) &&
    Boolean(awayId) &&
    homeHistory > 0 &&
    awayHistory > 0 &&
    temporalVerified;

  return {
    status: ready ? 'FOUND' : 'INSUFFICIENT',
    reason,
    ready,
    error: null,
    identity: {
      homeFound: Boolean(homeId),
      awayFound: Boolean(awayId),
      homeTeamId: homeId,
      awayTeamId: awayId,
      homeCanonical,
      awayCanonical,
      homeResolution: payload?.identity?.homeResolution ?? null,
      awayResolution: payload?.identity?.awayResolution ?? null
    },
    exactTeam: {
      homeRetrieved: Number.isFinite(homeHistory) ? homeHistory : 0,
      awayRetrieved: Number.isFinite(awayHistory) ? awayHistory : 0,
      h2hRetrieved: Number.isFinite(h2hHistory) ? h2hHistory : 0
    },
    temporalAudit: payload?.temporalAudit ?? null,
    version: payload?.version ?? null
  };
}

function baseReceipt(request) {
  return {
    contract: SHADOW_EVIDENCE_RECEIPT_CONTRACT,
    requestId: request?.requestId ?? null,
    lane: request?.lane ?? null,
    identityKey: request?.identityKey ?? null,
    home: request?.home ?? null,
    away: request?.away ?? null,
    targetDate: request?.targetDate ?? null,
    kickoffIso: request?.kickoffIso ?? null,
    rankingInputEligibleAtDispatch:
      request?.routing?.rankingInputEligible === true,
    bigDb: {
      status: 'NOT_DISPATCHED_SHADOW',
      reason: 'LIVE_READ_DISABLED',
      ready: false
    },
    web: {
      status: 'PENDING',
      reason: 'TRUSTED_CROSSCHECK_PENDING'
    },
    eligibleForNextCycleReverification: false,
    nextCycleReverificationReason: null,
    autoPromoted: false,
    rankingReady: false,
    predictionExecutionAllowed: false,
    decisionUse: false,
    bigDbWriteAllowed: false,
    productionMutationAllowed: false
  };
}

export function buildWebCrosscheckRequest(request, bigDbReceipt = null) {
  const web = request?.web ?? {};
  const bigDb = bigDbReceipt ?? { status: 'NOT_DISPATCHED_SHADOW', ready: false };
  const crosscheckLane = request?.lane === 'CROSSCHECK_REQUIRED_QUEUE';
  const shouldRequest =
    crosscheckLane ||
    bigDb.ready !== true ||
    request?.routing?.webCanSupplementBigDb === true;

  return {
    requestId: request?.requestId ?? null,
    identityKey: request?.identityKey ?? null,
    lane: request?.lane ?? null,
    home: request?.bigDb?.request?.body?.home ?? null,
    away: request?.bigDb?.request?.body?.away ?? null,
    targetDate: request?.bigDb?.request?.body?.target_date ?? null,
    kickoffIso: request?.kickoffIso ?? null,
    shouldRequest,
    trustedSourcePriority: Array.isArray(web?.trustedSourcePriority)
      ? [...web.trustedSourcePriority]
      : [],
    queries: Array.isArray(web?.queries) ? [...web.queries] : [],
    candidateRequirements: {
      exactHomeAwayIdentityRequired: true,
      explicitKickoffRequiredForFixtureVerification: true,
      httpsProvenanceRequired: true,
      noFabrication: true,
      ...(web?.candidateRequirements ?? {})
    },
    ingestFile:
      web?.ingestFile ?? 'local-node/cache/registry/web-search-candidates.json',
    existingIngestImplementation:
      web?.implementation ?? 'local-node/registry/web-search-rescue.mjs',
    bigDbStatus: bigDb.status,
    bigDbReason: bigDb.reason,
    decisionUse: false,
    productionMutationAllowed: false
  };
}

export function finalizeEvidenceReceipt(request, bigDbReceipt, webState = null) {
  const receipt = baseReceipt(request);
  receipt.bigDb = bigDbReceipt ?? receipt.bigDb;
  receipt.web = webState ?? receipt.web;

  const canonicalResolved =
    Boolean(receipt.bigDb?.identity?.homeTeamId) &&
    Boolean(receipt.bigDb?.identity?.awayTeamId);
  const crosscheckLane = request?.lane === 'CROSSCHECK_REQUIRED_QUEUE';
  const hasTrustedLiveProvider = Array.isArray(request?.web?.trustedSourcePriority)
    ? true
    : false;

  if (crosscheckLane && canonicalResolved && hasTrustedLiveProvider) {
    receipt.eligibleForNextCycleReverification = true;
    receipt.nextCycleReverificationReason = 'CANONICAL_IDENTITY_RESOLVED_REVERIFY_WITH_TRUSTED_LIVE_SOURCE';
  } else if (request?.lane === 'VERIFIED_RANKING_QUEUE' && receipt.bigDb?.ready === true) {
    receipt.nextCycleReverificationReason = 'VERIFIED_FIXTURE_EVIDENCE_REFRESH_COMPLETE';
  }

  // Dispatcher never promotes a fixture. Ranking status can change only after a
  // later registry cycle consumes audited evidence and re-runs fixture verification.
  receipt.autoPromoted = false;
  receipt.rankingReady = false;
  receipt.predictionExecutionAllowed = false;
  receipt.decisionUse = false;
  receipt.bigDbWriteAllowed = false;
  receipt.productionMutationAllowed = false;
  return receipt;
}

export function buildNextCycleReverificationCandidates(receipts, requests, {
  generatedAt = new Date().toISOString(),
  sourceCycleId = null
} = {}) {
  const requestById = new Map(
    (Array.isArray(requests) ? requests : []).map(request => [request?.requestId, request])
  );
  const rows = [];

  for (const receipt of Array.isArray(receipts) ? receipts : []) {
    if (receipt?.eligibleForNextCycleReverification !== true) continue;
    const request = requestById.get(receipt?.requestId);
    const identity = receipt?.bigDb?.identity ?? {};
    if (!request || !identity?.homeTeamId || !identity?.awayTeamId) continue;

    rows.push({
      sourceClass: 'EVIDENCE_REVERIFICATION',
      provider: 'CFI_BIGDB_RETRIEVAL',
      providerId: receipt.requestId,
      sourceUrl: null,
      home: identity.homeCanonical || request?.bigDb?.request?.body?.home || null,
      away: identity.awayCanonical || request?.bigDb?.request?.body?.away || null,
      canonicalHomeId: identity.homeTeamId,
      canonicalAwayId: identity.awayTeamId,
      targetDate: request?.bigDb?.request?.body?.target_date ?? null,
      kickoffIso: request?.kickoffIso ?? null,
      status: 'scheduled',
      upstreamVerificationStatus: 'BIGDB_CANONICAL_IDENTITY_RESOLVED',
      observedAt: generatedAt,
      sourceCycleId,
      reverifyOnly: true,
      decisionUse: false,
      bigDbWriteAllowed: false
    });
  }

  return {
    contract: NEXT_CYCLE_REVERIFICATION_CONTRACT,
    generatedAt,
    sourceCycleId,
    rows,
    count: rows.length,
    policy: {
      consumeOnlyInLaterRegistryCycle: true,
      sameCycleAutoPromotionAllowed: false,
      requiresTrustedLiveSourceInRegistry: true,
      decisionUse: false,
      bigDbWriteAllowed: false
    }
  };
}

export function buildShadowEvidenceDispatch(plan, bigDbResults = new Map(), {
  liveReadEnabled = false,
  generatedAt = new Date().toISOString(),
  sourceCycleId = null
} = {}) {
  const requests = Array.isArray(plan?.requests) ? plan.requests : [];
  const receipts = [];
  const webRequests = [];

  for (const request of requests) {
    const result = bigDbResults instanceof Map
      ? bigDbResults.get(request?.requestId)
      : bigDbResults?.[request?.requestId];
    const bigDb = result
      ? classifyBigDbReceipt(result)
      : liveReadEnabled
        ? {
            status: 'ERROR',
            reason: 'BIGDB_RESULT_MISSING',
            ready: false,
            error: 'No dispatch result was provided'
          }
        : {
            status: 'NOT_DISPATCHED_SHADOW',
            reason: 'LIVE_READ_DISABLED',
            ready: false
          };
    const receipt = finalizeEvidenceReceipt(request, bigDb);
    receipts.push(receipt);
    webRequests.push(buildWebCrosscheckRequest(request, bigDb));
  }

  const nextCycle = buildNextCycleReverificationCandidates(receipts, requests, {
    generatedAt,
    sourceCycleId
  });

  return {
    contract: SHADOW_EVIDENCE_DISPATCH_CONTRACT,
    generatedAt,
    sourceCycleId,
    liveReadEnabled,
    receipts,
    webCrosscheckPlan: {
      contract: WEB_CROSSCHECK_REQUEST_PLAN_CONTRACT,
      generatedAt,
      rows: webRequests,
      count: webRequests.length,
      ingestFile: 'local-node/cache/registry/web-search-candidates.json',
      existingIngestImplementation: 'local-node/registry/web-search-rescue.mjs',
      decisionUse: false
    },
    nextCycleReverification: nextCycle,
    metrics: {
      requests: requests.length,
      receipts: receipts.length,
      bigDbFound: receipts.filter(row => row.bigDb?.status === 'FOUND').length,
      bigDbInsufficient: receipts.filter(row => row.bigDb?.status === 'INSUFFICIENT').length,
      bigDbUnavailable: receipts.filter(row => row.bigDb?.status === 'UNAVAILABLE').length,
      bigDbUnauthorized: receipts.filter(row => row.bigDb?.status === 'UNAUTHORIZED').length,
      bigDbErrors: receipts.filter(row => row.bigDb?.status === 'ERROR').length,
      bigDbNotDispatched: receipts.filter(row => row.bigDb?.status === 'NOT_DISPATCHED_SHADOW').length,
      webCrosschecksRequested: webRequests.filter(row => row.shouldRequest).length,
      nextCycleReverificationCandidates: nextCycle.count,
      autoPromoted: 0,
      droppedByQuota: Math.max(0, requests.length - receipts.length)
    },
    safety: {
      noServiceRoleKeyInDispatcher: true,
      existingBigDbEndpointContractReused: true,
      existingWebRescueIngestReused: true,
      sameCycleAutoPromotionAllowed: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false,
      productionMutationAllowed: false,
      automaticBetting: false
    }
  };
}
