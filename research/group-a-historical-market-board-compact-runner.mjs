import fs from 'node:fs/promises';
import { runGroupAFullSuitePrimaryV2ScoreGrid } from './group-a-primary-v2-scoregrid-gate.mjs';
import { applyHistoricalMarketBoardGate } from './group-a-historical-market-board-gate.mjs';
import { linkForwardMarketCaptureToCanonicalFixture } from './forward-market-canonical-linker.mjs';
import { GROUP_A_CHALLENGERS } from './group-a-full-suite-v1.mjs';

export const GROUP_A_MARKET_BOARD_COMPACT_RUNNER_V1 = Object.freeze({
  version: 'CFI_GROUP_A_MARKET_BOARD_COMPACT_RUNNER_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  noReconstruction: true,
  observationPolicy: 'PRELINKED_MARKET_FIXTURES_COMPACT_FT_ONLY',
});

const text = value => String(value ?? '').trim();
const finiteScore = value => Number.isInteger(Number(value)) && Number(value) >= 0;
const fixtureDate = row => text(row?.match_date ?? row?.matchDate).slice(0, 10);
const fixtureHome = row => text(row?.home_team ?? row?.homeTeam);
const fixtureAway = row => text(row?.away_team ?? row?.awayTeam);
const fixtureId = row => text(row?.fixture_id ?? row?.id ?? `${fixtureDate(row)}|${fixtureHome(row)}|${fixtureAway(row)}`);

function canonicalFixtures(corpus) {
  const input = Array.isArray(corpus) ? corpus : (corpus?.fixtures ?? []);
  return input.map(row => ({
    fixtureId: fixtureId(row),
    targetDate: fixtureDate(row),
    homeTeam: fixtureHome(row),
    awayTeam: fixtureAway(row),
    homeTeamId: text(row?.home_team_id) || null,
    awayTeamId: text(row?.away_team_id) || null,
    competitionKey: text(row?.competition_key) || null,
    actualFt: { home: Number(row?.ft_home ?? row?.ft?.home), away: Number(row?.ft_away ?? row?.ft?.away) },
  })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.targetDate) && row.homeTeam && row.awayTeam && finiteScore(row.actualFt.home) && finiteScore(row.actualFt.away));
}

export function prelinkHistoricalMarketFixtureIds(corpus, marketEvidence) {
  const fixtures = canonicalFixtures(corpus);
  const fixturesByDate = new Map();
  for (const fixture of fixtures) {
    const bucket = fixturesByDate.get(fixture.targetDate) ?? [];
    bucket.push(fixture);
    fixturesByDate.set(fixture.targetDate, bucket);
  }
  const ids = new Set();
  for (const evidence of marketEvidence?.rows ?? []) {
    const targetDate = text(evidence?.date);
    const link = linkForwardMarketCaptureToCanonicalFixture({
      targetDate,
      homeTeam: evidence?.home_team,
      awayTeam: evidence?.away_team,
      externalFixtureKey: evidence?.identity_key,
    }, fixturesByDate.get(targetDate) ?? []);
    if (link?.status === 'VERIFIED_RESEARCH_LINK' && link?.fixture?.fixtureId) ids.add(text(link.fixture.fixtureId));
  }
  return ids;
}

export function compactMarketObservation(observation, linkedFixtureIds, marketEvidenceByFixture = null) {
  const id = text(observation?.target?.id);
  if (!id || !linkedFixtureIds?.has(id)) return null;
  const evidence = marketEvidenceByFixture?.get?.(id)?.evidence ?? null;
  const ahLine = Number(evidence?.opening?.asianHandicap?.line);
  const ahKey = Number.isFinite(ahLine) ? String(ahLine) : null;
  const mm = observation?.mm;
  return {
    kind: observation.kind,
    name: observation.name ?? null,
    target: {
      id,
      ft: {
        home: Number(observation?.target?.ft?.home),
        away: Number(observation?.target?.ft?.away),
      },
    },
    mm: {
      oneXTwo: { ft: mm?.oneXTwo?.ft ?? null },
      overUnder: { ft: { '2.5': mm?.overUnder?.ft?.['2.5'] ?? null } },
      asianHandicap: { ft: ahKey ? { [ahKey]: mm?.asianHandicap?.ft?.[ahKey] ?? null } : {} },
    },
  };
}

function buildLinkedEvidenceByFixture(corpus, marketEvidence) {
  const fixtures = canonicalFixtures(corpus);
  const fixturesByDate = new Map();
  for (const fixture of fixtures) {
    const bucket = fixturesByDate.get(fixture.targetDate) ?? [];
    bucket.push(fixture);
    fixturesByDate.set(fixture.targetDate, bucket);
  }
  const byFixture = new Map();
  for (const evidence of marketEvidence?.rows ?? []) {
    const targetDate = text(evidence?.date);
    const link = linkForwardMarketCaptureToCanonicalFixture({
      targetDate,
      homeTeam: evidence?.home_team,
      awayTeam: evidence?.away_team,
      externalFixtureKey: evidence?.identity_key,
    }, fixturesByDate.get(targetDate) ?? []);
    if (link?.status !== 'VERIFIED_RESEARCH_LINK' || !link?.fixture?.fixtureId) continue;
    const id = text(link.fixture.fixtureId);
    if (!byFixture.has(id)) byFixture.set(id, { evidence, link });
    else byFixture.set(id, null); // duplicate evidence stays fail-closed in the authoritative gate
  }
  for (const [id, value] of byFixture) if (value === null) byFixture.delete(id);
  return byFixture;
}

export function runGroupAWithHistoricalMarketBoardCompact(corpus, featureBundle, marketEvidence, options = {}) {
  const linkedEvidenceByFixture = buildLinkedEvidenceByFixture(corpus, marketEvidence);
  const linkedFixtureIds = new Set(linkedEvidenceByFixture.keys());
  const observations = {
    baseline: new Map(),
    challengers: new Map(GROUP_A_CHALLENGERS.map(name => [name, new Map()])),
  };
  let observedRows = 0;
  let retainedRows = 0;
  const rowObserver = observation => {
    observedRows += 1;
    const compact = compactMarketObservation(observation, linkedFixtureIds, linkedEvidenceByFixture);
    if (!compact) return;
    retainedRows += 1;
    const id = compact.target.id;
    if (compact.kind === 'baseline') observations.baseline.set(id, compact);
    else if (compact.kind === 'challenger' && observations.challengers.has(compact.name)) observations.challengers.get(compact.name).set(id, compact);
  };
  const result = runGroupAFullSuitePrimaryV2ScoreGrid(corpus, featureBundle, { ...options, rowObserver });
  const gated = applyHistoricalMarketBoardGate(result, observations, marketEvidence, corpus, options.marketBoardOptions ?? {});
  return {
    ...gated,
    marketBoardMemoryPolicy: {
      ...GROUP_A_MARKET_BOARD_COMPACT_RUNNER_V1,
      linkedFixtureIds: linkedFixtureIds.size,
      observedRows,
      retainedRows,
      baselineRowsRetained: observations.baseline.size,
      challengerRowsRetained: Object.fromEntries([...observations.challengers].map(([name, rows]) => [name, rows.size])),
    },
  };
}

async function main() {
  const corpusPath = process.argv[2];
  const featurePath = process.argv[3];
  const marketPath = process.argv[4];
  const outputPath = process.argv[5] ?? 'group-a-historical-market-board-result.json';
  if (!corpusPath || !featurePath || !marketPath) throw new Error('USAGE: node research/group-a-historical-market-board-compact-runner.mjs <r0.json> <group-a.json> <market-evidence.json> [output.json]');
  const [corpus, features, marketEvidence] = await Promise.all([
    fs.readFile(corpusPath, 'utf8').then(JSON.parse),
    fs.readFile(featurePath, 'utf8').then(JSON.parse),
    fs.readFile(marketPath, 'utf8').then(JSON.parse),
  ]);
  const result = runGroupAWithHistoricalMarketBoardCompact(corpus, features, marketEvidence);
  await fs.writeFile(outputPath, `${JSON.stringify(result)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    runnerVersion: result.marketBoardMemoryPolicy.version,
    memoryPolicy: result.marketBoardMemoryPolicy.observationPolicy,
    linkedFixtureIds: result.marketBoardMemoryPolicy.linkedFixtureIds,
    observedRows: result.marketBoardMemoryPolicy.observedRows,
    retainedRows: result.marketBoardMemoryPolicy.retainedRows,
    groupAVerdict: result.groupAVerdict,
    scoreGridEvaluation: result.scoreGridEvaluation,
    linkage: result.historicalMarketBoardEvaluation?.canonicalLinkage,
    globalBlockers: result.historicalMarketBoardEvaluation?.globalBlockers,
    challengers: Object.fromEntries(Object.entries(result.challengers ?? {}).map(([name, candidate]) => [name, {
      scoreGridLogLossEvaluation: candidate.scoreGridLogLossEvaluation,
      pairedExecutableFixtures: candidate.historicalMarketBoard?.challenger?.pairedExecutableFixtures ?? 0,
      sampleReady: candidate.historicalMarketBoard?.sampleReady ?? false,
      boardRegressions: candidate.historicalMarketBoard?.boardRegressions ?? [],
      hardBlockers: candidate.hardBlockers,
      promotionDecision: candidate.promotionDecision,
    }])),
    decisionUse: result.decisionUse,
    productionMutationAllowed: result.productionMutationAllowed,
  }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
