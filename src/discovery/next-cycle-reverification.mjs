import { evaluateFixtureVerification } from './fixture-verification.mjs';

const clean = value => String(value ?? '').trim();

export const NEXT_CYCLE_REVERIFICATION_APPLY_CONTRACT =
  'CFI_NEXT_CYCLE_REVERIFICATION_APPLY_V1';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function kickoffMatches(entry, candidate) {
  const candidateKickoff = clean(candidate?.kickoffIso);
  const kickoffs = Array.isArray(entry?.kickoffCandidates)
    ? entry.kickoffCandidates.map(row => clean(row?.kickoffIso)).filter(Boolean)
    : [];
  return Boolean(candidateKickoff) && kickoffs.length === 1 && kickoffs[0] === candidateKickoff;
}

function appendEvidence(entry, candidate, sourceCycleId) {
  const evidence = Array.isArray(entry?.reverificationEvidence)
    ? [...entry.reverificationEvidence]
    : [];
  const key = `${clean(candidate?.providerId)}|${clean(sourceCycleId)}`;
  const exists = evidence.some(row =>
    `${clean(row?.providerId)}|${clean(row?.sourceCycleId)}` === key
  );
  if (!exists) {
    evidence.push({
      provider: clean(candidate?.provider) || 'CFI_BIGDB_RETRIEVAL',
      providerId: clean(candidate?.providerId) || null,
      sourceCycleId,
      observedAt: candidate?.observedAt ?? null,
      canonicalHomeId: candidate?.canonicalHomeId ?? null,
      canonicalAwayId: candidate?.canonicalAwayId ?? null,
      upstreamVerificationStatus:
        candidate?.upstreamVerificationStatus ?? 'BIGDB_CANONICAL_IDENTITY_RESOLVED',
      decisionUse: false,
      bigDbWriteAllowed: false
    });
  }
  return evidence;
}

export function applyNextCycleReverification(
  previousRegistry,
  snapshot,
  {
    currentCycleId = null,
    targetDate = null,
    pcSourceClass = 'PC_NODE'
  } = {}
) {
  const registry = clone(previousRegistry) ?? null;
  const entries = Array.isArray(registry?.entries) ? registry.entries : [];
  const candidates = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const sourceCycleId = clean(snapshot?.sourceCycleId) || null;
  const cycleId = clean(currentCycleId) || null;
  const date = clean(targetDate ?? registry?.targetDate) || null;
  const applied = [];
  const rejected = [];

  const rejectAll = reason => {
    for (const candidate of candidates) {
      rejected.push({
        identityKey: candidate?.identityKey ?? null,
        reason
      });
    }
  };

  if (!registry || !Array.isArray(registry?.entries)) {
    return {
      registry: previousRegistry,
      audit: {
        contract: NEXT_CYCLE_REVERIFICATION_APPLY_CONTRACT,
        status: 'NO_PREVIOUS_REGISTRY',
        currentCycleId: cycleId,
        sourceCycleId,
        inputCandidates: candidates.length,
        applied: 0,
        rejected: candidates.length,
        rejectedRows: candidates.map(row => ({
          identityKey: row?.identityKey ?? null,
          reason: 'NO_PREVIOUS_REGISTRY'
        })),
        sameCycleBlocked: 0,
        decisionUse: false,
        bigDbWriteAllowed: false
      }
    };
  }

  if (candidates.length === 0) {
    return {
      registry,
      audit: {
        contract: NEXT_CYCLE_REVERIFICATION_APPLY_CONTRACT,
        status: 'NO_CANDIDATES',
        currentCycleId: cycleId,
        sourceCycleId,
        inputCandidates: 0,
        applied: 0,
        rejected: 0,
        rejectedRows: [],
        sameCycleBlocked: 0,
        decisionUse: false,
        bigDbWriteAllowed: false
      }
    };
  }

  if (!cycleId) {
    rejectAll('CURRENT_CYCLE_ID_REQUIRED');
  } else if (!sourceCycleId) {
    rejectAll('SOURCE_CYCLE_ID_REQUIRED');
  } else if (sourceCycleId === cycleId) {
    rejectAll('SAME_CYCLE_REVERIFICATION_FORBIDDEN');
  } else {
    const byIdentity = new Map(entries.map(entry => [entry?.identityKey, entry]));

    for (const candidate of candidates) {
      const identityKey = clean(candidate?.identityKey);
      if (!identityKey) {
        rejected.push({ identityKey: null, reason: 'IDENTITY_KEY_REQUIRED' });
        continue;
      }

      const entry = byIdentity.get(identityKey);
      if (!entry) {
        rejected.push({ identityKey, reason: 'REGISTRY_ENTRY_NOT_FOUND' });
        continue;
      }
      if (date && clean(candidate?.targetDate) !== date) {
        rejected.push({ identityKey, reason: 'TARGET_DATE_MISMATCH' });
        continue;
      }
      if (!kickoffMatches(entry, candidate)) {
        rejected.push({ identityKey, reason: 'KICKOFF_MISMATCH_FAIL_CLOSED' });
        continue;
      }

      const homeId = clean(candidate?.canonicalHomeId);
      const awayId = clean(candidate?.canonicalAwayId);
      if (!homeId || !awayId) {
        rejected.push({ identityKey, reason: 'CANONICAL_IDS_REQUIRED' });
        continue;
      }
      if (
        (clean(entry?.canonicalHomeId) && clean(entry.canonicalHomeId) !== homeId) ||
        (clean(entry?.canonicalAwayId) && clean(entry.canonicalAwayId) !== awayId)
      ) {
        rejected.push({ identityKey, reason: 'CANONICAL_ID_CONFLICT_FAIL_CLOSED' });
        continue;
      }

      const verification = entry?.trustedVerification ??
        evaluateFixtureVerification(entry, { pcSourceClass });
      const trustedLive = Array.isArray(verification?.trustedLiveProviders)
        ? verification.trustedLiveProviders
        : [];
      if (trustedLive.length === 0) {
        rejected.push({ identityKey, reason: 'TRUSTED_LIVE_SOURCE_REQUIRED' });
        continue;
      }

      entry.canonicalHomeId = homeId;
      entry.canonicalAwayId = awayId;
      entry.reverificationEvidence = appendEvidence(entry, candidate, sourceCycleId);
      entry.lastReverifiedAt = candidate?.observedAt ?? snapshot?.generatedAt ?? null;
      entry.reverificationSourceCycleId = sourceCycleId;
      applied.push({
        identityKey,
        canonicalHomeId: homeId,
        canonicalAwayId: awayId,
        trustedLiveProviders: [...trustedLive],
        sourceCycleId
      });
    }
  }

  const sameCycleBlocked = rejected.filter(row =>
    row.reason === 'SAME_CYCLE_REVERIFICATION_FORBIDDEN'
  ).length;

  return {
    registry,
    audit: {
      contract: NEXT_CYCLE_REVERIFICATION_APPLY_CONTRACT,
      status: rejected.length > 0
        ? applied.length > 0
          ? 'PASS_WITH_REJECTIONS'
          : 'NO_APPLICABLE_CANDIDATES'
        : 'PASS',
      currentCycleId: cycleId,
      sourceCycleId,
      inputCandidates: candidates.length,
      applied: applied.length,
      rejected: rejected.length,
      appliedRows: applied,
      rejectedRows: rejected,
      sameCycleBlocked,
      policy: {
        exactRegistryIdentityKeyRequired: true,
        exactKickoffMatchRequired: true,
        trustedLiveSourceRequired: true,
        canonicalIdConflictFailClosed: true,
        sameCycleReverificationAllowed: false,
        createsNewFixture: false
      },
      decisionUse: false,
      bigDbWriteAllowed: false
    }
  };
}
