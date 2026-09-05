const clean = value => String(value ?? '').trim();
const fold = value => clean(value)
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const WEB_ALIAS_GAP_AUDIT_CONTRACT = 'CFI_WEB_ALIAS_GAP_AUDIT_V1';

function iso(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function partitionWebRescueCandidates(candidates, unresolvedRows, {
  generatedAt = new Date().toISOString()
} = {}) {
  const unresolvedByIdentity = new Map(
    (Array.isArray(unresolvedRows) ? unresolvedRows : [])
      .map(row => [clean(row?.identityKey), row])
      .filter(([key]) => Boolean(key))
  );
  const accepted = [];
  const aliasReview = [];
  const rejected = [];

  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    const rescueIdentityKey = clean(candidate?.rescueIdentityKey);
    if (!rescueIdentityKey) {
      accepted.push(candidate);
      continue;
    }

    const unresolved = unresolvedByIdentity.get(rescueIdentityKey);
    if (!unresolved) {
      rejected.push({
        rescueIdentityKey,
        provider: clean(candidate?.provider) || null,
        providerId: clean(candidate?.providerId) || null,
        reason: 'RESCUE_IDENTITY_KEY_NOT_FOUND'
      });
      continue;
    }

    const candidateKickoff = iso(candidate?.kickoffIso);
    const unresolvedKickoff = iso(unresolved?.kickoffIso);
    if (!candidateKickoff || !unresolvedKickoff || candidateKickoff !== unresolvedKickoff) {
      rejected.push({
        rescueIdentityKey,
        provider: clean(candidate?.provider) || null,
        providerId: clean(candidate?.providerId) || null,
        candidateKickoff,
        unresolvedKickoff,
        reason: 'RESCUE_KICKOFF_MISMATCH'
      });
      continue;
    }

    const candidateTargetDate = clean(candidate?.targetDate);
    const unresolvedTargetDate = clean(unresolved?.targetDate);
    if (candidateTargetDate && unresolvedTargetDate && candidateTargetDate !== unresolvedTargetDate) {
      rejected.push({
        rescueIdentityKey,
        provider: clean(candidate?.provider) || null,
        providerId: clean(candidate?.providerId) || null,
        candidateTargetDate,
        unresolvedTargetDate,
        reason: 'RESCUE_TARGET_DATE_MISMATCH'
      });
      continue;
    }

    const exactHome = fold(candidate?.home) === fold(unresolved?.home);
    const exactAway = fold(candidate?.away) === fold(unresolved?.away);
    if (!exactHome || !exactAway) {
      aliasReview.push({
        contract: WEB_ALIAS_GAP_AUDIT_CONTRACT,
        rescueIdentityKey,
        original: {
          home: unresolved?.home ?? null,
          away: unresolved?.away ?? null,
          targetDate: unresolved?.targetDate ?? null,
          kickoffIso: unresolvedKickoff
        },
        proposed: {
          home: candidate?.home ?? null,
          away: candidate?.away ?? null,
          targetDate: candidateTargetDate || unresolvedTargetDate || null,
          kickoffIso: candidateKickoff
        },
        provider: clean(candidate?.provider) || null,
        providerId: clean(candidate?.providerId) || null,
        sourceUrls: Array.isArray(candidate?.sourceUrls) ? [...candidate.sourceUrls] : [],
        classification: 'ALIAS_CANDIDATE_REVIEW_REQUIRED',
        exactHome,
        exactAway,
        autoAliasAllowed: false,
        registryIngestAllowed: false,
        bigDbWriteAllowed: false,
        decisionUse: false
      });
      continue;
    }

    accepted.push(candidate);
  }

  return {
    contract: WEB_ALIAS_GAP_AUDIT_CONTRACT,
    generatedAt,
    inputCandidates: Array.isArray(candidates) ? candidates.length : 0,
    unresolvedFixtures: unresolvedByIdentity.size,
    accepted,
    aliasReview,
    rejected,
    metrics: {
      accepted: accepted.length,
      aliasReviewRequired: aliasReview.length,
      rejected: rejected.length,
      accountedFor: accepted.length + aliasReview.length + rejected.length
    },
    policy: {
      rescueJoinRequiresExactIdentityKey: true,
      rescueJoinRequiresExactKickoff: true,
      changedTeamNamesRequireReview: true,
      aliasCandidateCanCreateFixture: false,
      autoAliasAllowed: false,
      bigDbWriteAllowed: false,
      decisionUse: false
    }
  };
}
