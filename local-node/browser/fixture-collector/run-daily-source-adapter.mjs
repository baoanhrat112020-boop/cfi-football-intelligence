import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { localDateNow } from '../../../src/discovery/cfi-discovery.ts';
import { parseDailyFixtureText } from './daily-text-parser.mjs';

const TIME_ZONE = process.env.CFI_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const PROBE = resolve(
  process.env.CFI_BROWSER_PROBE_AUDIT ||
  'local-node/cache/browser/source-probe-audit.json'
);

async function saveJson(file, data) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

export async function runDailySourceAdapter({ providerKey }) {
  const provider = String(providerKey ?? '').trim().toUpperCase();
  if (!provider) throw new Error('PROVIDER_KEY_REQUIRED');

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
    const audit = {
      contract: `CFI_${provider}_DAILY_ADAPTER_AUDIT_V1`,
      generatedAt: new Date().toISOString(),
      provider,
      sourceId,
      targetDate,
      status: 'NO_SNAPSHOT',
      rawCandidates: 0,
      decisionUse: false,
      bigDbWriteAllowed: false,
      bigDbWriteAttempted: false
    };
    await Promise.all([
      saveJson(output, {
        contract: `CFI_${provider}_RAW_CANDIDATES_V1`,
        generatedAt: audit.generatedAt,
        targetDate,
        candidates: []
      }),
      saveJson(auditOutput, audit)
    ]);
    console.log(JSON.stringify(audit));
    return audit;
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

  const parsed = parseDailyFixtureText(source, text, {
    targetDate,
    timeZone: source.render_timezone
  });

  const prospective = parsed.candidates.filter(row =>
    new Date(row.kickoff_utc).getTime() > Date.now()
  );
  const pastOrStarted = parsed.candidates.length - prospective.length;

  const generatedAt = new Date().toISOString();
  const manifest = {
    contract: `CFI_${provider}_RAW_CANDIDATES_V1`,
    generatedAt,
    provider,
    targetDate,
    timeBasis: source.render_timezone,
    candidates: prospective,
    identityOnly: parsed.identityOnly,
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
    status: prospective.length > 0
      ? (parsed.rejected.length > 0 || parsed.identityOnly.length > 0 ? 'PASS_WITH_REJECTIONS' : 'PASS')
      : (parsed.identityOnly.length > 0 ? 'IDENTITY_ONLY_NO_KICKOFF' : 'PASS_EMPTY'),
    rawCandidates: parsed.candidates.length,
    prospectiveCandidates: prospective.length,
    pastOrStartedSkipped: pastOrStarted,
    rejectedSegments: parsed.rejected.length,
    identityOnlySegments: parsed.identityOnly.length,
    parserTelemetry: parsed.telemetry,
    safeguards: {
      explicitKickoffTimeRequired: true,
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
    identityOnly: parsed.identityOnly
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
    prospectiveCandidates: audit.prospectiveCandidates,
    rejectedSegments: audit.rejectedSegments,
    identityOnlySegments: audit.identityOnlySegments,
    decisionUse: false,
    bigDbWriteAllowed: false
  }));

  return audit;
}
