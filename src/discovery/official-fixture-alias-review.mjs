const clean = value => String(value ?? '').trim();
const fold = value => clean(value)
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .replace(/\s+/g, ' ');

export const OFFICIAL_FIXTURE_ALIAS_REVIEW_CONTRACT = 'CFI_OFFICIAL_FIXTURE_ALIAS_REVIEW_V1';

// These tokens are ignored only while generating a REVIEW candidate. They are
// never used to resolve a canonical identity or mutate an alias table.
const REVIEW_DECORATOR_TOKENS = new Set([
  'nữ', 'nu', 'women', 'womens', 'woman', 'female', 'ladies',
  'wfc', 'fc', 'afc', 'cf', 'club', 'football', 'team'
]);

function tokens(value) {
  return fold(value)
    .split(' ')
    .filter(Boolean)
    .filter(token => !REVIEW_DECORATOR_TOKENS.has(token));
}

function intersection(left, right) {
  const b = new Set(right);
  return [...new Set(left)].filter(token => b.has(token));
}

function sideEvidence(providerName, officialName) {
  const providerTokens = tokens(providerName);
  const officialTokens = tokens(officialName);
  const sharedTokens = intersection(providerTokens, officialTokens);
  return {
    providerName: clean(providerName),
    officialName: clean(officialName),
    providerTokens,
    officialTokens,
    sharedTokens,
    sharedCount: sharedTokens.length,
    exactAfterFold: fold(providerName) === fold(officialName),
    hasAnchor: sharedTokens.length >= 1,
    strongAnchor: sharedTokens.length >= 2
  };
}

function localParts(kickoffIso, timeZone) {
  const ms = Date.parse(clean(kickoffIso));
  if (!Number.isFinite(ms)) return null;
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));
  const get = type => values.find(item => item.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`
  };
}

function womenScoped(value) {
  const normalized = fold(value);
  return /(?:^| )(?:nữ|nu|women|womens|woman|female|ladies|wfc)(?: |$)/u.test(normalized);
}

function officialRowIdentity(row) {
  return clean(row?.providerId) || [clean(row?.home), clean(row?.away), clean(row?.kickoffIso)].join('|');
}

function compatibleOfficialRows(hint, officialRows, { targetDate, timeZone }) {
  const hintTime = clean(hint?.displayed_time ?? hint?.displayedTime);
  const hintDate = clean(hint?.source_page_date_claim ?? hint?.targetDate ?? targetDate);
  return officialRows.filter(row => {
    const local = localParts(row?.kickoffIso, timeZone);
    if (!local) return false;
    if (hintDate && local.date !== hintDate) return false;
    if (targetDate && local.date !== targetDate) return false;
    if (hintTime && local.time !== hintTime) return false;
    return true;
  });
}

function scoreOrientation(hint, official) {
  const home = sideEvidence(hint?.home_team ?? hint?.home, official?.home);
  const away = sideEvidence(hint?.away_team ?? hint?.away, official?.away);
  const reversedHome = sideEvidence(hint?.home_team ?? hint?.home, official?.away);
  const reversedAway = sideEvidence(hint?.away_team ?? hint?.away, official?.home);
  const twoSideAnchors = home.hasAnchor && away.hasAnchor;
  const oneSideStrong = home.strongAnchor || away.strongAnchor;
  const reversedSignal = reversedHome.hasAnchor && reversedAway.hasAnchor;
  const eligibleForReview = !reversedSignal && (twoSideAnchors || oneSideStrong);
  const strength = (home.sharedCount * 10) + (away.sharedCount * 10) +
    (home.exactAfterFold ? 4 : 0) + (away.exactAfterFold ? 4 : 0) +
    (twoSideAnchors ? 3 : 0) + (oneSideStrong ? 2 : 0);
  return {
    home,
    away,
    reversedHome,
    reversedAway,
    reversedSignal,
    twoSideAnchors,
    oneSideStrong,
    eligibleForReview,
    strength,
    reason: twoSideAnchors
      ? 'TWO_SIDE_LEXICAL_ANCHORS_REVIEW_ONLY'
      : oneSideStrong
        ? 'ONE_SIDE_STRONG_LEXICAL_ANCHOR_REVIEW_ONLY'
        : reversedSignal
          ? 'REVERSED_ORIENTATION_BLOCKED'
          : 'INSUFFICIENT_LEXICAL_ANCHOR'
  };
}

export function buildOfficialFixtureAliasReview(
  hints,
  officialRows,
  {
    targetDate,
    timeZone = 'Asia/Ho_Chi_Minh',
    officialProvider = 'OFFICIAL_FEDERATION',
    generatedAt = new Date().toISOString()
  } = {}
) {
  const sourceHints = Array.isArray(hints) ? hints : [];
  const sourceOfficialRows = Array.isArray(officialRows) ? officialRows : [];
  const provisionalProposals = [];
  const rejected = [];
  const ambiguous = [];

  for (const [index, hint] of sourceHints.entries()) {
    const homeName = clean(hint?.home_team ?? hint?.home);
    const awayName = clean(hint?.away_team ?? hint?.away);
    const hintTime = clean(hint?.displayed_time ?? hint?.displayedTime);
    const hintDate = clean(hint?.source_page_date_claim ?? hint?.targetDate ?? targetDate);

    if (!homeName || !awayName || !hintTime || !hintDate) {
      rejected.push({ index, home: homeName || null, away: awayName || null, reason: 'HINT_IDENTITY_DATE_TIME_REQUIRED' });
      continue;
    }
    if (targetDate && hintDate !== targetDate) {
      rejected.push({ index, home: homeName, away: awayName, reason: 'HINT_TARGET_DATE_MISMATCH', hintDate, targetDate });
      continue;
    }
    if (!womenScoped(homeName) && !womenScoped(awayName)) {
      rejected.push({ index, home: homeName, away: awayName, reason: 'WOMEN_ENTITY_SCOPE_REQUIRED' });
      continue;
    }

    const compatible = compatibleOfficialRows(hint, sourceOfficialRows, { targetDate, timeZone });
    if (!compatible.length) {
      rejected.push({ index, home: homeName, away: awayName, reason: 'NO_OFFICIAL_FIXTURE_SAME_DATE_TIME' });
      continue;
    }

    const evaluated = compatible
      .map(official => ({ official, evidence: scoreOrientation(hint, official) }))
      .filter(item => item.evidence.eligibleForReview)
      .sort((a, b) => b.evidence.strength - a.evidence.strength);

    if (!evaluated.length) {
      const reversed = compatible.some(official => scoreOrientation(hint, official).reversedSignal);
      rejected.push({
        index,
        home: homeName,
        away: awayName,
        reason: reversed ? 'REVERSED_ORIENTATION_BLOCKED' : 'NO_UNIQUE_LEXICAL_REVIEW_ANCHOR',
        compatibleOfficialFixtures: compatible.length
      });
      continue;
    }

    const bestStrength = evaluated[0].evidence.strength;
    const best = evaluated.filter(item => item.evidence.strength === bestStrength);
    if (best.length !== 1) {
      ambiguous.push({
        index,
        home: homeName,
        away: awayName,
        reason: 'AMBIGUOUS_OFFICIAL_ALIAS_REVIEW_CANDIDATE',
        displayedTime: hintTime,
        targetDate: hintDate,
        candidateProviderIds: best.map(item => officialRowIdentity(item.official)),
        autoAliasAllowed: false,
        canonicalTeamCreateAllowed: false,
        registryIngestAllowed: false,
        bigDbWriteAllowed: false,
        decisionUse: false
      });
      continue;
    }

    const { official, evidence } = best[0];
    const local = localParts(official?.kickoffIso, timeZone);
    provisionalProposals.push({
      contract: OFFICIAL_FIXTURE_ALIAS_REVIEW_CONTRACT,
      reviewIndex: index,
      classification: 'ALIAS_CANDIDATE_REVIEW_REQUIRED',
      providerObservation: {
        provider: clean(hint?.provider) || null,
        sourceId: clean(hint?.source_id) || null,
        sourceUrl: clean(hint?.source_url) || null,
        home: homeName,
        away: awayName,
        displayedTime: hintTime,
        targetDate: hintDate
      },
      officialFixture: {
        provider: officialProvider,
        providerId: clean(official?.providerId) || null,
        sourceUrl: clean(official?.sourceUrl) || null,
        home: clean(official?.home),
        away: clean(official?.away),
        kickoffIso: clean(official?.kickoffIso),
        localDate: local?.date ?? null,
        localTime: local?.time ?? null
      },
      reviewEvidence: {
        rule: evidence.reason,
        reviewOnlyHeuristic: true,
        fuzzyIdentityResolutionPerformed: false,
        home: evidence.home,
        away: evidence.away,
        reversedSignal: evidence.reversedSignal,
        strength: evidence.strength
      },
      proposedAliases: [
        {
          side: 'HOME',
          aliasDisplay: homeName,
          officialDisplay: clean(official?.home),
          canonicalTeamId: null,
          requiresCanonicalTeamReview: true
        },
        {
          side: 'AWAY',
          aliasDisplay: awayName,
          officialDisplay: clean(official?.away),
          canonicalTeamId: null,
          requiresCanonicalTeamReview: true
        }
      ],
      autoAliasAllowed: false,
      canonicalTeamCreateAllowed: false,
      registryIngestAllowed: false,
      rankingInputEligible: false,
      predictionExecutionAllowed: false,
      bigDbWriteAllowed: false,
      decisionUse: false
    });
  }

  // Batch-level fail-closed guard: the same official fixture cannot be used to
  // justify two localized observations. Such many-to-one cases are review
  // ambiguity, not alias evidence.
  const byOfficial = new Map();
  for (const proposal of provisionalProposals) {
    const key = officialRowIdentity(proposal.officialFixture);
    const current = byOfficial.get(key) ?? [];
    current.push(proposal);
    byOfficial.set(key, current);
  }
  const reusedOfficial = new Set(
    [...byOfficial.entries()]
      .filter(([, rows]) => rows.length > 1)
      .map(([key]) => key)
  );
  const proposals = provisionalProposals.filter(
    proposal => !reusedOfficial.has(officialRowIdentity(proposal.officialFixture))
  );
  for (const [providerId, rows] of byOfficial.entries()) {
    if (rows.length <= 1) continue;
    for (const row of rows) {
      ambiguous.push({
        index: row.reviewIndex,
        home: row.providerObservation.home,
        away: row.providerObservation.away,
        reason: 'OFFICIAL_FIXTURE_REUSED_BY_MULTIPLE_HINTS',
        displayedTime: row.providerObservation.displayedTime,
        targetDate: row.providerObservation.targetDate,
        candidateProviderIds: [providerId],
        conflictingHintCount: rows.length,
        autoAliasAllowed: false,
        canonicalTeamCreateAllowed: false,
        registryIngestAllowed: false,
        bigDbWriteAllowed: false,
        decisionUse: false
      });
    }
  }

  return {
    contract: OFFICIAL_FIXTURE_ALIAS_REVIEW_CONTRACT,
    generatedAt,
    targetDate: clean(targetDate) || null,
    timeZone,
    officialProvider,
    proposals,
    ambiguous,
    rejected,
    metrics: {
      hints: sourceHints.length,
      officialFixtures: sourceOfficialRows.length,
      proposals: proposals.length,
      ambiguous: ambiguous.length,
      rejected: rejected.length,
      accountedFor: proposals.length + ambiguous.length + rejected.length
    },
    policy: {
      reviewOnly: true,
      exactDateRequired: true,
      exactDisplayedTimeRequired: true,
      womenEntityScopeRequired: true,
      lexicalAnchorsMayOnlyCreateReviewProposal: true,
      fuzzyIdentityResolutionAllowed: false,
      reversedOrientationAllowed: false,
      ambiguousProposalAllowed: false,
      officialFixtureMayBackMultipleHints: false,
      autoAliasAllowed: false,
      canonicalTeamCreateAllowed: false,
      registryIngestAllowed: false,
      rankingInputEligible: false,
      predictionExecutionAllowed: false,
      bigDbWriteAllowed: false,
      decisionUse: false
    }
  };
}
