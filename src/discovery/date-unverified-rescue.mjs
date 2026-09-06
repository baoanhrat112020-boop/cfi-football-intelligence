import { fixtureSourceByKey } from './fixture-source-policy.mjs';

const clean = value => String(value ?? '').trim();

export const DATE_UNVERIFIED_WEB_PLAN_CONTRACT =
  'CFI_TIER_A_DATE_UNVERIFIED_WEB_PLAN_V1';
export const DATE_UNVERIFIED_RESOLUTION_CONTRACT =
  'CFI_TIER_A_DATE_UNVERIFIED_RESOLUTION_V1';

function foldIdentity(value) {
  return clean(value)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function exactIdentityKey(home, away) {
  return `${foldIdentity(home)}|${foldIdentity(away)}`;
}

function localDateTimeParts(kickoffIso, timeZone) {
  const kickoff = new Date(kickoffIso);
  if (Number.isNaN(kickoff.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(kickoff);
    const value = Object.fromEntries(parts.map(part => [part.type, part.value]));
    if (!value.year || !value.month || !value.day || !value.hour || !value.minute) return null;
    return {
      date: `${value.year}-${value.month}-${value.day}`,
      time: `${value.hour}:${value.minute}`
    };
  } catch {
    return null;
  }
}

function candidateDisplayedTime(row, timeZone) {
  const explicit = clean(
    row?.parserEvidence?.time_line ??
    row?.parser_evidence?.time_line ??
    row?.displayedTime ??
    row?.displayed_time
  );
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(explicit)) return explicit;
  return localDateTimeParts(row?.kickoffIso ?? row?.kickoff_utc, timeZone)?.time ?? null;
}

function trustedIndependentCandidate(row, hintProvider) {
  const provider = clean(row?.provider).toUpperCase();
  if (!provider || provider === hintProvider) return false;
  const source = fixtureSourceByKey(provider);
  return ['A', 'B'].includes(source.tier);
}

export function addIsoDays(date, delta) {
  const match = clean(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() + Number(delta));
  return value.toISOString().slice(0, 10);
}

export function resolveDateUnverifiedHints(hints, trustedRows, {
  generatedAt = new Date().toISOString(),
  targetDate,
  timeZone = 'Asia/Ho_Chi_Minh'
} = {}) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(clean(targetDate))) {
    throw new Error('TARGET_DATE_REQUIRED');
  }

  const candidateIndex = new Map();
  for (const candidate of Array.isArray(trustedRows) ? trustedRows : []) {
    const home = clean(candidate?.home ?? candidate?.home_team);
    const away = clean(candidate?.away ?? candidate?.away_team);
    const provider = clean(candidate?.provider).toUpperCase();
    const kickoffIso = clean(candidate?.kickoffIso ?? candidate?.kickoff_utc);
    if (!home || !away || !provider || !kickoffIso) continue;
    const key = exactIdentityKey(home, away);
    const bucket = candidateIndex.get(key) ?? [];
    bucket.push(candidate);
    candidateIndex.set(key, bucket);
  }

  const recoveredRows = [];
  const unresolvedHints = [];
  const conflictHints = [];
  const resolvedOutsideTargetDate = [];
  const seenHints = new Set();

  for (const hint of Array.isArray(hints) ? hints : []) {
    const home = clean(hint?.home_team ?? hint?.home);
    const away = clean(hint?.away_team ?? hint?.away);
    const displayedTime = clean(hint?.displayed_time ?? hint?.displayedTime);
    const provider = clean(hint?.provider).toUpperCase();
    if (!home || !away || !displayedTime || !provider) continue;

    const hintKey = `${provider}|${exactIdentityKey(home, away)}|${displayedTime}`;
    if (seenHints.has(hintKey)) continue;
    seenHints.add(hintKey);

    const identityMatches = (candidateIndex.get(exactIdentityKey(home, away)) ?? [])
      .filter(candidate => trustedIndependentCandidate(candidate, provider));
    const sameTimeMatches = identityMatches.filter(candidate =>
      candidateDisplayedTime(candidate, hint?.render_timezone ?? hint?.renderTimezone ?? timeZone) === displayedTime
    );

    if (sameTimeMatches.length === 0) {
      const review = {
        ...hint,
        resolutionStatus: identityMatches.length > 0
          ? 'KICKOFF_TIME_CONFLICT_FAIL_CLOSED'
          : 'NO_EXACT_INDEPENDENT_MATCH',
        exactIndependentMatches: identityMatches.map(candidate => ({
          provider: clean(candidate?.provider).toUpperCase(),
          kickoffIso: candidate?.kickoffIso ?? candidate?.kickoff_utc ?? null,
          displayedTime: candidateDisplayedTime(
            candidate,
            hint?.render_timezone ?? hint?.renderTimezone ?? timeZone
          ),
          sourceUrl: candidate?.sourceUrl ?? candidate?.source_url ?? null
        })),
        canEnterRegistry: false,
        canEnterRanking: false,
        predictionExecutionAllowed: false,
        decisionUse: false,
        bigDbWriteAllowed: false
      };
      if (identityMatches.length > 0) conflictHints.push(review);
      else unresolvedHints.push(review);
      continue;
    }

    const byKickoff = new Map();
    for (const candidate of sameTimeMatches) {
      const kickoffIso = clean(candidate?.kickoffIso ?? candidate?.kickoff_utc);
      const current = byKickoff.get(kickoffIso) ?? [];
      current.push(candidate);
      byKickoff.set(kickoffIso, current);
    }

    if (byKickoff.size !== 1) {
      conflictHints.push({
        ...hint,
        resolutionStatus: 'MULTIPLE_EXACT_KICKOFFS_FAIL_CLOSED',
        exactIndependentMatches: sameTimeMatches.map(candidate => ({
          provider: clean(candidate?.provider).toUpperCase(),
          kickoffIso: candidate?.kickoffIso ?? candidate?.kickoff_utc ?? null,
          displayedTime: candidateDisplayedTime(
            candidate,
            hint?.render_timezone ?? hint?.renderTimezone ?? timeZone
          ),
          sourceUrl: candidate?.sourceUrl ?? candidate?.source_url ?? null
        })),
        canEnterRegistry: false,
        canEnterRanking: false,
        predictionExecutionAllowed: false,
        decisionUse: false,
        bigDbWriteAllowed: false
      });
      continue;
    }

    const [kickoffIso, agreeingCandidates] = [...byKickoff.entries()][0];
    const local = localDateTimeParts(
      kickoffIso,
      hint?.render_timezone ?? hint?.renderTimezone ?? timeZone
    );
    if (!local) {
      unresolvedHints.push({
        ...hint,
        resolutionStatus: 'INDEPENDENT_KICKOFF_TIMEZONE_UNRESOLVED',
        canEnterRegistry: false,
        canEnterRanking: false,
        predictionExecutionAllowed: false,
        decisionUse: false,
        bigDbWriteAllowed: false
      });
      continue;
    }

    const independentProviders = [...new Set(
      agreeingCandidates.map(candidate => clean(candidate?.provider).toUpperCase())
    )].sort();
    const independentSourceUrls = [...new Set(
      agreeingCandidates
        .map(candidate => clean(candidate?.sourceUrl ?? candidate?.source_url))
        .filter(Boolean)
    )];

    if (local.date !== targetDate) {
      resolvedOutsideTargetDate.push({
        ...hint,
        resolutionStatus: 'RESOLVED_OUTSIDE_TARGET_DATE',
        resolvedKickoffIso: kickoffIso,
        resolvedLocalDate: local.date,
        resolvedLocalTime: local.time,
        independentProviders,
        independentSourceUrls,
        canEnterCurrentRegistry: false,
        canEnterRanking: false,
        predictionExecutionAllowed: false,
        decisionUse: false,
        bigDbWriteAllowed: false
      });
      continue;
    }

    const primaryEvidence = agreeingCandidates[0];
    const hintSourceUrl = clean(hint?.source_url ?? hint?.sourceUrl);
    recoveredRows.push({
      sourceClass: 'TIER_A_DATE_RECOVERED',
      provider,
      providerId: hint?.provider_id ?? hint?.providerId ?? null,
      sourceUrl: hintSourceUrl || null,
      sourceUrls: [...new Set([hintSourceUrl, ...independentSourceUrls].filter(Boolean))],
      home,
      away,
      competition: primaryEvidence?.competition ?? null,
      country: primaryEvidence?.country ?? null,
      kickoffIso,
      targetDate,
      status: 'scheduled',
      observedAt: generatedAt,
      parserEvidence: {
        provider: provider.toLowerCase(),
        parser: 'CFI_DATE_UNVERIFIED_CROSS_SOURCE_RECOVERY_V1',
        displayed_time: displayedTime,
        source_page_date_claim: hint?.source_page_date_claim ?? hint?.sourcePageDateClaim ?? null,
        date_basis: 'EXACT_IDENTITY_PLUS_SAME_DISPLAYED_TIME_INDEPENDENT_TRUSTED_PROVIDER',
        independent_providers: independentProviders,
        independent_source_urls: independentSourceUrls,
        independent_kickoff_iso: kickoffIso,
        resolved_local_date: local.date,
        resolved_local_time: local.time,
        fuzzy_identity_used: false,
        automatic_kickoff_correction_used: false
      },
      dateRecoveryVerified: true,
      rankingReady: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    });
  }

  const webRequiredHints = [...unresolvedHints, ...conflictHints];
  return {
    contract: DATE_UNVERIFIED_RESOLUTION_CONTRACT,
    generatedAt,
    targetDate,
    timeZone,
    recoveredRows,
    unresolvedHints,
    conflictHints,
    resolvedOutsideTargetDate,
    webRequiredHints,
    metrics: {
      hints: seenHints.size,
      recovered: recoveredRows.length,
      unresolved: unresolvedHints.length,
      conflicts: conflictHints.length,
      resolvedOutsideTargetDate: resolvedOutsideTargetDate.length,
      webRequired: webRequiredHints.length
    },
    policy: {
      exactHomeAwayIdentityOnly: true,
      fuzzyIdentityAllowed: false,
      independentProviderRequired: true,
      trustedTierABProviderRequired: true,
      displayedTimeMustMatch: true,
      oneDistinctKickoffRequired: true,
      recoveredKickoffLocalDateMustEqualTargetDate: true,
      conflictingKickoffAutoCorrectionAllowed: false,
      recoveredObservationMayEnterRegistry: true,
      recoveredObservationMaySelfSetRankingReady: false,
      unresolvedHintCanEnterRegistry: false,
      conflictHintCanEnterRegistry: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    }
  };
}

export function buildDateUnverifiedWebPlan(rows, {
  generatedAt = new Date().toISOString(),
  targetDate,
  timeZone = 'Asia/Ho_Chi_Minh'
} = {}) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(clean(targetDate))) {
    throw new Error('TARGET_DATE_REQUIRED');
  }

  const unique = [];
  const seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const home = clean(row?.home_team ?? row?.home);
    const away = clean(row?.away_team ?? row?.away);
    const displayedTime = clean(row?.displayed_time ?? row?.displayedTime);
    const provider = clean(row?.provider).toUpperCase();
    if (!home || !away || !displayedTime || !provider) continue;

    const key = `${provider}|${home.toLowerCase()}|${away.toLowerCase()}|${displayedTime}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const candidateDates = [
      addIsoDays(targetDate, -1),
      targetDate,
      addIsoDays(targetDate, 1)
    ].filter(Boolean);

    unique.push({
      provider,
      sourceId: row?.source_id ?? row?.sourceId ?? null,
      sourceUrl: row?.source_url ?? row?.sourceUrl ?? null,
      home,
      away,
      displayedTime,
      sourcePageDateClaim: row?.source_page_date_claim ?? row?.sourcePageDateClaim ?? targetDate,
      candidateDates,
      queries: [
        `${home} vs ${away} kickoff ${candidateDates.join(' or ')} UTC`,
        `${home} vs ${away} ${targetDate} ${addIsoDays(targetDate, 1)} fixture time`,
        `${home} vs ${away} AiScore Flashscore Sofascore kickoff`
      ],
      reason: row?.resolutionStatus ?? row?.reason ?? 'SOURCE_DATE_CONTEXT_UNVERIFIED',
      exactIndependentMatches: Array.isArray(row?.exactIndependentMatches)
        ? row.exactIndependentMatches
        : [],
      requiredEvidence: {
        exactHomeAwayIdentity: true,
        explicitKickoffRequired: true,
        timezoneOrUtcRequired: true,
        trustedIndependentSourceRequired: true,
        sourcePageDateClaimCannotVerifyKickoff: true
      },
      kickoffIso: null,
      canEnterRegistry: false,
      canEnterRanking: false,
      autoCorrectKickoffAllowed: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    });
  }

  return {
    contract: DATE_UNVERIFIED_WEB_PLAN_CONTRACT,
    generatedAt,
    targetDate,
    timeZone,
    rows: unique,
    count: unique.length,
    policy: {
      reuseExistingWebRescueIngress: true,
      candidateOutput: 'local-node/cache/registry/web-search-candidates.json',
      exactIdentityRequired: true,
      explicitKickoffRequired: true,
      sourcePageDateClaimTrustedAsKickoffDate: false,
      dateSearchWindowDays: [-1, 0, 1],
      noFabrication: true,
      canEnterRegistryBeforeVerification: false,
      canEnterRankingBeforeVerification: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    }
  };
}
