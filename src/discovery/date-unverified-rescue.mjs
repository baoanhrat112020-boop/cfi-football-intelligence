const clean = value => String(value ?? '').trim();

export const DATE_UNVERIFIED_WEB_PLAN_CONTRACT =
  'CFI_TIER_A_DATE_UNVERIFIED_WEB_PLAN_V1';

export function addIsoDays(date, delta) {
  const match = clean(date).match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const value = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(value.getTime())) return null;
  value.setUTCDate(value.getUTCDate() + Number(delta));
  return value.toISOString().slice(0, 10);
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
      renderTimezone: row?.render_timezone ?? row?.renderTimezone ?? timeZone,
      candidateDates,
      queries: [
        `${home} vs ${away} kickoff ${candidateDates.join(' or ')} UTC`,
        `${home} vs ${away} ${targetDate} ${addIsoDays(targetDate, 1)} fixture time`,
        `${home} vs ${away} AiScore Flashscore Sofascore kickoff`
      ],
      reason: 'SOURCE_DATE_CONTEXT_UNVERIFIED',
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
