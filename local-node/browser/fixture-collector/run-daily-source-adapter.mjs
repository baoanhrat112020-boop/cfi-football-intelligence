import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { localDateNow } from '../../../src/discovery/cfi-discovery.ts';
import {
  DATE_CONTEXT_POLICIES,
  parseDailyFixtureText
} from './daily-text-parser.mjs';

const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const PROBE = resolve(
  process.env.CFI_BROWSER_PROBE_AUDIT ||
  'local-node/cache/browser/source-probe-audit.json'
);

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function writeEmpty({ output, auditOutput, provider, sourceId, targetDate, status, reason = null, dateContextPolicy }) {
  const generatedAt = new Date().toISOString();
  const audit = {
    contract: `CFI_${provider}_DAILY_ADAPTER_AUDIT_V1`,
    generatedAt,
    provider,
    sourceId,
    targetDate,
    dateContextPolicy,
    status,
    reason,
    rawCandidates: 0,
    prospectiveCandidates: 0,
    dateUnverifiedHints: 0,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  };
  await Promise.all([
    saveJson(output, {
      contract: `CFI_${provider}_RAW_CANDIDATES_V1`,
      generatedAt,
      provider,
      targetDate,
      dateContextPolicy,
      candidates: [],
      identityOnly: [],
      dateUnverified: [],
      decisionUse: false,
      bigDbWriteAllowed: false,
      bigDbWriteAttempted: false
    }),
    saveJson(auditOutput, audit)
  ]);
  console.log(JSON.stringify(audit));
  return audit;
}

function dateUnverifiedHints(parsed, source, provider, targetDate) {
  const seen = new Set();
  const rows = [];
  for (const rejected of Array.isArray(parsed?.rejected) ? parsed.rejected : []) {
    if (rejected?.reason !== 'MISSING_EXPLICIT_DATE_ANCHOR') continue;
    const home = String(rejected?.home ?? '').trim();
    const away = String(rejected?.away ?? '').trim();
    const displayedTime = String(rejected?.time ?? '').trim();
    if (!home || !away || !displayedTime) continue;
    const key = `${home.toLowerCase()}|${away.toLowerCase()}|${displayedTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      provider,
      source_id: source.id,
      source_url: source.url,
      home_team: home,
      away_team: away,
      displayed_time: displayedTime,
      source_page_date_claim: targetDate,
      render_timezone: source.render_timezone,
      reason: 'DATE_CONTEXT_UNVERIFIED',
      kickoff_utc: null,
      can_enter_registry: false,
      can_enter_ranking: false,
      requires_external_kickoff_verification: true,
      decisionUse: false,
      bigDbWriteAllowed: false
    });
  }
  return rows;
}

export async function runDailySourceAdapter({
  providerKey,
  dateContextPolicy = DATE_CONTEXT_POLICIES.RUN_CONTEXT_ALLOWED
}) {
  const provider = String(providerKey ?? '').trim().toUpperCase();
  if (!provider) throw new Error('PROVIDER_KEY_REQUIRED');
  if (!Object.values(DATE_CONTEXT_POLICIES).includes(dateContextPolicy)) {
    throw new Error('DATE_CONTEXT_POLICY_INVALID');
  }

  const targetDate = String(process.env.CFI_TARGET_DATE ?? '').trim() ||
    localDateNow(TIME_ZONE, Date.now());
  const sourceId = `daily-${provider.toLowerCase()}`;
  const output = resolve(
    process.env[`CFI_${provider}_ADAPTER_OUTPUT`] ||
    `local-node/browser/fixture-collector/input/${provider.toLowerCase()}-candidates.json`
  );
  const auditOutput = resolve(
    process.env[`CFI_${provider}_ADAPTER_AUDIT`] ||
    `local-node/cache/browser/${provider.toLowerCase()}-adapter-audit.json`
  );

  const probe = JSON.parse(await readFile(PROBE, 'utf8'));
  const sourceProbe = (probe.results ?? []).find(row => row.source_id === sourceId);

  if (!sourceProbe?.snapshot) {
    return writeEmpty({ output, auditOutput, provider, sourceId, targetDate, status: 'NO_SNAPSHOT', dateContextPolicy });
  }

  const httpOk = typeof sourceProbe.http_status === 'number' &&
    sourceProbe.http_status >= 200 && sourceProbe.http_status < 400;
  if (sourceProbe.blocked === true || sourceProbe.status === 'ERROR' || !httpOk) {
    return writeEmpty({
      output,
      auditOutput,
      provider,
      sourceId,
      targetDate,
      dateContextPolicy,
      status: 'SOURCE_UNAVAILABLE',
      reason: sourceProbe.blocked ? `BLOCKED:${sourceProbe.blockMarker ?? 'UNKNOWN'}` : sourceProbe.error ?? `HTTP_${sourceProbe.http_status ?? 'UNKNOWN'}`
    });
  }

  const text = await readFile(sourceProbe.snapshot, 'utf8');
  const source = {
    id: sourceId,
    provider: provider.toLowerCase(),
    url: sourceProbe.requested_url || sourceProbe.final_url,
    competition: 'ALL FOOTBALL',
    country: 'GLOBAL',
    render_timezone: sourceProbe.render_timezone || TIME_ZONE
  };
  const referenceDate = localDateNow(source.render_timezone, Date.now());

  const parsed = parseDailyFixtureText(source, text, {
    targetDate,
    timeZone: source.render_timezone,
    referenceDate,
    dateContextPolicy
  });

  const prospective = parsed.candidates.filter(row =>
    new Date(row.kickoff_utc).getTime() > Date.now()
  );
  const pastOrStarted = parsed.candidates.length - prospective.length;
  const dateUnverified = dateUnverifiedHints(parsed, source, provider, targetDate);

  const generatedAt = new Date().toISOString();
  const manifest = {
    contract: `CFI_${provider}_RAW_CANDIDATES_V1`,
    generatedAt,
    provider,
    targetDate,
    referenceDate,
    dateContextPolicy,
    timeBasis: source.render_timezone,
    candidates: prospective,
    identityOnly: parsed.identityOnly,
    dateUnverified,
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  };

  const audit = {
    contract: `CFI_${provider}_DAILY_ADAPTER_AUDIT_V1`,
    generatedAt,
    provider,
    sourceId,
    targetDate,
    referenceDate,
    dateContextPolicy,
    status: prospective.length > 0
      ? (parsed.rejected.length > 0 || parsed.identityOnly.length > 0 ? 'PASS_WITH_REJECTIONS' : 'PASS')
      : dateUnverified.length > 0
        ? 'DATE_CONTEXT_UNVERIFIED'
        : (parsed.identityOnly.length > 0 ? 'IDENTITY_ONLY_NO_KICKOFF' : 'PASS_EMPTY'),
    rawCandidates: parsed.candidates.length,
    prospectiveCandidates: prospective.length,
    pastOrStartedSkipped: pastOrStarted,
    rejectedSegments: parsed.rejected.length,
    identityOnlySegments: parsed.identityOnly.length,
    dateUnverifiedHints: dateUnverified.length,
    parserTelemetry: parsed.telemetry,
    safeguards: {
      successfulProbeRequired: true,
      blockedPageRejected: true,
      explicitKickoffTimeRequired: true,
      relativeDateSectionsHonored: true,
      referenceDateDerivedFromBrowserTimezone: true,
      unanchoredKickoffAllowed: dateContextPolicy === DATE_CONTEXT_POLICIES.RUN_CONTEXT_ALLOWED,
      explicitTextDateRequired: dateContextPolicy === DATE_CONTEXT_POLICIES.EXPLICIT_TEXT_DATE_REQUIRED,
      dateUnverifiedCanEnterRegistry: false,
      dateUnverifiedRequiresExternalKickoffVerification: true,
      missingKickoffFabrication: false,
      currentTargetDateOnly: true,
      prospectiveOnly: true,
      fixtureOnly: true,
      generatePrediction: false,
      generateOdds: false,
      generateResult: false
    },
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false,
    rejected: parsed.rejected,
    identityOnly: parsed.identityOnly,
    dateUnverified
  };

  await Promise.all([
    saveJson(output, manifest),
    saveJson(auditOutput, audit)
  ]);

  console.log(JSON.stringify({
    contract: audit.contract,
    status: audit.status,
    provider,
    targetDate,
    referenceDate,
    dateContextPolicy,
    prospectiveCandidates: audit.prospectiveCandidates,
    relativeDateAnchors: parsed.telemetry.relativeDateAnchors,
    missingDateAnchorRejected: parsed.telemetry.missingDateAnchorRejected,
    dateUnverifiedHints: audit.dateUnverifiedHints,
    rejectedSegments: audit.rejectedSegments,
    identityOnlySegments: audit.identityOnlySegments,
    decisionUse: false,
    bigDbWriteAllowed: false
  }));

  return audit;
}
