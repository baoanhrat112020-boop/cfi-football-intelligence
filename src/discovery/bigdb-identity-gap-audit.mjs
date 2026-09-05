const clean = value => String(value ?? '').trim();
const fold = value => clean(value)
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const BIGDB_IDENTITY_GAP_AUDIT_CONTRACT =
  'CFI_BIGDB_IDENTITY_GAP_AUDIT_V1';

export function identityCohort(value) {
  const tokens = fold(value).split(' ').filter(Boolean);
  const youth = tokens.find(token => /^u(?:17|18|19|20|21|23)$/.test(token));
  if (youth) return youth.toUpperCase();
  if (tokens.some(token => [
    'w', 'women', 'woman', 'ladies', 'lady',
    'feminine', 'feminin', 'femenino', 'femenina', 'femenil'
  ].includes(token))) return 'WOMEN';
  const last = tokens.at(-1) ?? '';
  if (tokens.includes('reserve') || tokens.includes('reserves') || last === 'ii') {
    return 'RESERVE';
  }
  return 'SENIOR';
}

export function classifyIdentityGap(receipt) {
  const bigDb = receipt?.bigDb ?? {};
  const identity = bigDb?.identity ?? {};
  const homeFound = Boolean(identity?.homeTeamId);
  const awayFound = Boolean(identity?.awayTeamId);

  if (bigDb?.ready === true) return 'READY';
  if (bigDb?.reason === 'NO_EXACT_IDENTITY') {
    if (!homeFound && !awayFound) return 'BOTH_IDENTITIES_MISSING';
    if (!homeFound) return 'HOME_IDENTITY_MISSING';
    if (!awayFound) return 'AWAY_IDENTITY_MISSING';
  }
  if (homeFound && awayFound && bigDb?.reason === 'ZERO_EXACT_TEAM_EVIDENCE') {
    return 'IDENTITIES_RESOLVED_HISTORY_MISSING';
  }
  if (homeFound && awayFound && bigDb?.reason === 'STRICT_PRIOR_PREFLIGHT_FAIL') {
    return 'IDENTITIES_RESOLVED_STRICT_PRIOR_FAIL';
  }
  return 'OTHER_BIGDB_GAP';
}

function cohortGuard(receipt) {
  const identity = receipt?.bigDb?.identity ?? {};
  const inputHome = identityCohort(receipt?.home);
  const inputAway = identityCohort(receipt?.away);
  const canonicalHome = identity?.homeCanonical
    ? identityCohort(identity.homeCanonical)
    : null;
  const canonicalAway = identity?.awayCanonical
    ? identityCohort(identity.awayCanonical)
    : null;

  const inputMismatch = inputHome !== inputAway;
  const canonicalMismatch =
    (canonicalHome && canonicalHome !== inputHome) ||
    (canonicalAway && canonicalAway !== inputAway);

  return {
    inputHome,
    inputAway,
    canonicalHome,
    canonicalAway,
    status: inputMismatch || canonicalMismatch ? 'FAIL_CLOSED_REVIEW' : 'PASS'
  };
}

export function buildBigDbIdentityGapAudit(receiptsDocument, {
  generatedAt = new Date().toISOString(),
  sourceCycleId = null
} = {}) {
  const receipts = Array.isArray(receiptsDocument?.rows)
    ? receiptsDocument.rows
    : Array.isArray(receiptsDocument)
      ? receiptsDocument
      : [];

  const rows = receipts.map(receipt => {
    const identity = receipt?.bigDb?.identity ?? {};
    const gapClass = classifyIdentityGap(receipt);
    return {
      requestId: receipt?.requestId ?? null,
      identityKey: receipt?.identityKey ?? null,
      lane: receipt?.lane ?? null,
      home: receipt?.home ?? null,
      away: receipt?.away ?? null,
      targetDate: receipt?.targetDate ?? null,
      kickoffIso: receipt?.kickoffIso ?? null,
      bigDbStatus: receipt?.bigDb?.status ?? null,
      bigDbReason: receipt?.bigDb?.reason ?? null,
      gapClass,
      identity: {
        homeFound: Boolean(identity?.homeTeamId),
        awayFound: Boolean(identity?.awayTeamId),
        homeTeamId: identity?.homeTeamId ?? null,
        awayTeamId: identity?.awayTeamId ?? null,
        homeCanonical: identity?.homeCanonical ?? null,
        awayCanonical: identity?.awayCanonical ?? null,
        homeResolution: identity?.homeResolution ?? null,
        awayResolution: identity?.awayResolution ?? null
      },
      cohortGuard: cohortGuard(receipt),
      action: gapClass === 'READY'
        ? 'NO_RESCUE_REQUIRED'
        : gapClass.includes('IDENTITY_MISSING') || gapClass === 'BOTH_IDENTITIES_MISSING'
          ? 'WEB_CANONICAL_IDENTITY_REVIEW'
          : 'EVIDENCE_REVIEW',
      autoAliasAllowed: false,
      canonicalTeamCreateAllowed: false,
      bigDbWriteAllowed: false,
      predictionExecutionAllowed: false,
      decisionUse: false
    };
  });

  const gaps = rows.filter(row => row.gapClass !== 'READY');
  const byClass = Object.fromEntries(
    [...new Set(rows.map(row => row.gapClass))]
      .sort()
      .map(key => [key, rows.filter(row => row.gapClass === key).length])
  );

  return {
    contract: BIGDB_IDENTITY_GAP_AUDIT_CONTRACT,
    generatedAt,
    sourceCycleId,
    status: rows.some(row => row.cohortGuard.status !== 'PASS')
      ? 'PASS_WITH_COHORT_REVIEW'
      : 'PASS',
    rows,
    metrics: {
      receipts: rows.length,
      gaps: gaps.length,
      ready: rows.length - gaps.length,
      byClass,
      cohortReviewRequired: rows.filter(row => row.cohortGuard.status !== 'PASS').length
    },
    policy: {
      webMayProposeCanonicalIdentity: true,
      webMayAutoCreateCanonicalTeam: false,
      autoAliasAllowed: false,
      existingAliasPromotionRpc: 'cfi_upsert_team_alias',
      aliasPromotionRequiresVerifiedCanonicalTeam: true,
      rawFixtureUpsertForIdentityRescueAllowed: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    }
  };
}
