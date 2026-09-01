import fs from 'node:fs/promises';
import { createResearchSupabaseReader, resolveResearchCredentials } from './supabase-read-adapter.mjs';
import { linkForwardMarketCaptureBatch } from './forward-market-canonical-linker.mjs';
import { MULTIMARKET_MIN_SAMPLES } from './multimarket-promotion-gate-v2.mjs';

export const FORWARD_MARKET_LINK_AUDIT_V1 = Object.freeze({
  version: 'CFI_FORWARD_MARKET_LINK_AUDIT_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalWriteAllowed: false,
});

function text(value) {
  return String(value ?? '').trim();
}

function targetDateForCapture(row) {
  const key = text(row?.external_fixture_key);
  const keyDate = key.match(/^(\d{4}-\d{2}-\d{2})(?:\||__|T|$)/)?.[1];
  if (keyDate) return { targetDate: keyDate, targetDateSource: 'EXTERNAL_FIXTURE_KEY' };
  const scheduled = text(row?.scheduled_at_raw).match(/^(\d{4}-\d{2}-\d{2})/)?.[1];
  if (scheduled) return { targetDate: scheduled, targetDateSource: 'SCHEDULED_AT_RAW' };
  const kickoffMs = Date.parse(text(row?.kickoff_at));
  if (Number.isFinite(kickoffMs)) return { targetDate: new Date(kickoffMs).toISOString().slice(0, 10), targetDateSource: 'KICKOFF_UTC_DATE' };
  return { targetDate: null, targetDateSource: null };
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function fixtureRange(captures) {
  const dates = captures.map(row => row.targetDate).filter(Boolean).sort();
  if (!dates.length) throw new Error('FORWARD_MARKET_LINK_AUDIT_TARGET_DATES_REQUIRED');
  return { minDate: dates[0], maxDate: dates.at(-1) };
}

function attachTeamNames(fixtures, teams) {
  const byId = new Map(teams.map(row => [text(row.team_id), text(row.canonical_name)]));
  return fixtures.map(row => ({
    fixtureId: row.fixture_id,
    targetDate: row.match_date,
    homeTeamId: row.home_team_id,
    awayTeamId: row.away_team_id,
    homeTeam: byId.get(text(row.home_team_id)) ?? '',
    awayTeam: byId.get(text(row.away_team_id)) ?? '',
    competitionKey: row.competition_key,
    htHome: Number.isInteger(row.ht_home) ? row.ht_home : null,
    htAway: Number.isInteger(row.ht_away) ? row.ht_away : null,
    ftHome: Number.isInteger(row.ft_home) ? row.ft_home : null,
    ftAway: Number.isInteger(row.ft_away) ? row.ft_away : null,
  })).filter(row => row.fixtureId && row.targetDate && row.homeTeam && row.awayTeam);
}

function latestPrematchSnapshotByFixture(snapshots, fixtures, aliases, kickoffByFixture) {
  const prepared = snapshots.map(row => ({
    ...row,
    externalFixtureKey: row.snapshot_id,
    targetDate: row.target_date,
    homeTeam: row.home_team,
    awayTeam: row.away_team,
  }));
  const links = linkForwardMarketCaptureBatch(prepared, fixtures, { aliases });
  const latest = new Map();
  links.rows.forEach((link, index) => {
    if (link.status !== 'VERIFIED_RESEARCH_LINK') return;
    const snapshot = snapshots[index];
    if (snapshot?.strict_prior !== true) return;
    const createdAt = Date.parse(text(snapshot?.created_at));
    const kickoffAt = Date.parse(text(kickoffByFixture.get(link.fixture.fixtureId)));
    if (!Number.isFinite(createdAt) || !Number.isFinite(kickoffAt) || createdAt >= kickoffAt) return;
    const existing = latest.get(link.fixture.fixtureId);
    if (!existing || Date.parse(existing.created_at) < createdAt) latest.set(link.fixture.fixtureId, snapshot);
  });
  return latest;
}

function buildMarketComparisonReadiness({ captures, linkedRows, fixtures, snapshots, aliases }) {
  const kickoffByFixture = new Map();
  linkedRows.forEach((link, index) => {
    if (link.status !== 'VERIFIED_RESEARCH_LINK') return;
    const kickoffAt = captures[index]?.kickoff_at;
    const existing = kickoffByFixture.get(link.fixture.fixtureId);
    if (!existing || Date.parse(kickoffAt) < Date.parse(existing)) kickoffByFixture.set(link.fixture.fixtureId, kickoffAt);
  });
  const latestSnapshot = latestPrematchSnapshotByFixture(snapshots, fixtures, aliases, kickoffByFixture);
  const fixtureById = new Map(fixtures.map(row => [row.fixtureId, row]));
  const pairsByExternal = new Map();

  linkedRows.forEach((link, index) => {
    if (link.status !== 'VERIFIED_RESEARCH_LINK') return;
    const externalKey = link.externalFixtureKey || captures[index]?.capture_id;
    const fixtureId = link.fixture.fixtureId;
    const fixture = fixtureById.get(fixtureId);
    const snapshot = latestSnapshot.get(fixtureId);
    const settled = Number.isInteger(fixture?.ftHome) && Number.isInteger(fixture?.ftAway);
    const current = pairsByExternal.get(externalKey);
    const row = {
      externalFixtureKey: externalKey,
      fixtureId,
      snapshotId: snapshot?.snapshot_id ?? null,
      snapshotCreatedAt: snapshot?.created_at ?? null,
      kickoffAt: captures[index]?.kickoff_at ?? null,
      settled,
    };
    if (!current || (!current.snapshotId && row.snapshotId)) pairsByExternal.set(externalKey, row);
  });

  const pairs = [...pairsByExternal.values()];
  const strictPriorPredictionPairs = pairs.filter(row => row.snapshotId).length;
  const settledStrictPriorPairs = pairs.filter(row => row.snapshotId && row.settled).length;
  return {
    version: 'CFI_FORWARD_MARKET_COMPARISON_READINESS_V1',
    status: settledStrictPriorPairs >= MULTIMARKET_MIN_SAMPLES ? 'READY' : 'BLOCKED',
    blocker: settledStrictPriorPairs >= MULTIMARKET_MIN_SAMPLES ? null : 'INSUFFICIENT_CANONICAL_MARKET_PREDICTION_PAIRS',
    requiredMinSamples: MULTIMARKET_MIN_SAMPLES,
    verifiedCanonicalMarketFixtures: unique(pairs.map(row => row.fixtureId)).length,
    strictPriorPredictionPairs,
    settledStrictPriorPairs,
    remainingToMinimum: Math.max(0, MULTIMARKET_MIN_SAMPLES - settledStrictPriorPairs),
    strictPriorRequired: true,
    preKickoffSnapshotRequired: true,
    settledResultRequired: true,
    decisionUse: false,
    productionEligible: false,
    pairs,
  };
}

export async function exportForwardMarketCanonicalLinkAudit({ reader, outputPath }) {
  if (!reader?.readAll) throw new Error('CFI_RESEARCH_READER_REQUIRED');
  const rawCaptures = await reader.readAll(
    'cfi_forward_market_captures?select=capture_id,external_fixture_key,home_team,away_team,competition,scheduled_at_raw,kickoff_at,kickoff_verified,bookmaker,market_family,period,line,odds_home,odds_draw,odds_away,odds_over,odds_under,source_name,source_url,source_provenance,captured_at,verification_status,research_only&verification_status=eq.VERIFIED_PREMATCH&kickoff_verified=eq.true&research_only=eq.true',
    { critical: true, label: 'forward_market_verified_prematch' },
  );

  const captures = rawCaptures
    .filter(row => Number.isFinite(Date.parse(text(row.captured_at))) && Number.isFinite(Date.parse(text(row.kickoff_at))) && Date.parse(row.captured_at) < Date.parse(row.kickoff_at))
    .map(row => ({ ...row, ...targetDateForCapture(row), homeTeam: row.home_team, awayTeam: row.away_team, externalFixtureKey: row.external_fixture_key }));
  if (!captures.length) throw new Error('CFI_RESEARCH_EMPTY_VERIFIED_PREKICKOFF_FORWARD_MARKET');

  const { minDate, maxDate } = fixtureRange(captures);
  const [fixtureRows, teams, aliases, snapshots] = await Promise.all([
    reader.readAll(
      `fixtures?select=fixture_id,match_date,home_team_id,away_team_id,competition_key,ht_home,ht_away,ft_home,ft_away&match_date=gte.${encodeURIComponent(minDate)}&match_date=lte.${encodeURIComponent(maxDate)}`,
      { critical: true, label: 'forward_market_candidate_fixtures' },
    ),
    reader.readAll('teams?select=team_id,canonical_name', { critical: true, label: 'teams' }),
    reader.readAll('team_aliases?select=alias_normalized,alias_display,team_id,source,confidence&confidence=gte.0.95', { critical: false, label: 'team_aliases' }),
    reader.readAll(
      `cfi_prediction_snapshots?select=snapshot_id,created_at,target_date,home_team,away_team,strict_prior,prediction_hash&strict_prior=eq.true&target_date=gte.${encodeURIComponent(minDate)}&target_date=lte.${encodeURIComponent(maxDate)}`,
      { critical: false, label: 'strict_prior_prediction_snapshots' },
    ),
  ]);

  const fixtures = attachTeamNames(fixtureRows, teams);
  const linked = linkForwardMarketCaptureBatch(captures, fixtures, { aliases });
  const verifiedRows = linked.rows.filter(row => row.status === 'VERIFIED_RESEARCH_LINK');
  const blockedRows = linked.rows.filter(row => row.status !== 'VERIFIED_RESEARCH_LINK');
  const verifiedExternalFixtureKeys = unique(verifiedRows.map(row => row.externalFixtureKey));
  const verifiedCanonicalFixtureIds = unique(verifiedRows.map(row => row.fixture?.fixtureId));
  const marketComparisonReadiness = buildMarketComparisonReadiness({ captures, linkedRows: linked.rows, fixtures, snapshots, aliases });

  const result = {
    ...FORWARD_MARKET_LINK_AUDIT_V1,
    generatedAt: new Date().toISOString(),
    input: {
      verifiedPrematchRows: captures.length,
      verifiedPrematchExternalFixtures: unique(captures.map(row => row.externalFixtureKey)).length,
      targetDateRange: { minDate, maxDate },
      canonicalCandidateFixtures: fixtures.length,
      highConfidenceAliases: aliases.length,
      strictPriorPredictionSnapshots: snapshots.length,
    },
    linkage: {
      verifiedRows: verifiedRows.length,
      blockedRows: blockedRows.length,
      verifiedExternalFixtures: verifiedExternalFixtureKeys.length,
      verifiedCanonicalFixtures: verifiedCanonicalFixtureIds.length,
      reasons: linked.reasons,
      matchMethods: verifiedRows.reduce((acc, row) => {
        const key = row.matchMethod ?? 'UNKNOWN';
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {}),
    },
    marketComparisonReadiness,
    rows: linked.rows.map((row, index) => ({
      ...row,
      captureId: captures[index]?.capture_id ?? null,
      targetDateSource: captures[index]?.targetDateSource ?? null,
      sourceName: captures[index]?.source_name ?? null,
      bookmaker: captures[index]?.bookmaker ?? null,
      marketFamily: captures[index]?.market_family ?? null,
      period: captures[index]?.period ?? null,
      capturedAt: captures[index]?.captured_at ?? null,
      kickoffAt: captures[index]?.kickoff_at ?? null,
    })),
  };

  if (result.productionMutationAllowed !== false || result.canonicalWriteAllowed !== false || result.decisionUse !== false || result.marketComparisonReadiness.productionEligible !== false) {
    throw new Error('FORWARD_MARKET_LINK_AUDIT_ISOLATION_FAIL');
  }
  if (outputPath) await fs.writeFile(outputPath, `${JSON.stringify(result)}\n`);
  return result;
}

async function main() {
  const outputPath = process.argv[2] ?? 'forward-market-canonical-link-audit.json';
  const { baseUrl, key } = resolveResearchCredentials();
  const reader = createResearchSupabaseReader({ baseUrl, key });
  const result = await exportForwardMarketCanonicalLinkAudit({ reader, outputPath });
  process.stdout.write(`${JSON.stringify({
    outputPath,
    version: result.version,
    input: result.input,
    linkage: result.linkage,
    marketComparisonReadiness: result.marketComparisonReadiness,
    decisionUse: result.decisionUse,
    productionMutationAllowed: result.productionMutationAllowed,
    canonicalWriteAllowed: result.canonicalWriteAllowed,
  })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
