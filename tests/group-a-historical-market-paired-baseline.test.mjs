import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHistoricalMarketBoardGate } from '../research/group-a-historical-market-board-gate.mjs';
import { GROUP_A_CHALLENGERS } from '../research/group-a-full-suite-v1.mjs';

const mm = (home, draw, away) => ({ oneXTwo: { ft: { home, draw, away } }, overUnder: { ft: {} }, asianHandicap: { ft: {} } });

function row(i) {
  const day = String((i % 20) + 1).padStart(2, '0');
  return { fixture_id: `fx-${i}`, match_date: `2025-09-${day}`, home_team: `H${i}`, away_team: `A${i}`, ft_home: 1, ft_away: 0 };
}

function evidence(r, i) {
  return {
    identity_key: `m-${i}`,
    source_sha256: 'b'.repeat(64),
    date: r.match_date,
    home_team: r.home_team,
    away_team: r.away_team,
    actual_ft_home: r.ft_home,
    actual_ft_away: r.ft_away,
    reconstructed: false,
    opening: { oneXTwo: { bookmaker: { bookmaker: 'Bet365', odds_home: 2, odds_draw: 3.5, odds_away: 4 }, marketAverage: null }, overUnder25: {}, asianHandicap: {} },
    temporalProvenance: { opening: { strictPriorSemantic: true, capturedAt: null, decisionEligible: true }, closing: { decisionEligible: false } },
    providerPolicy: { pinnacleUsed: false },
  };
}

test('historical market comparison uses each challenger exact eligible fixture cohort for baseline', () => {
  const corpus = Array.from({ length: 31 }, (_, i) => row(i));
  const marketEvidence = {
    version: 'CFI_GROUP_A_FOOTBALL_DATA_MARKET_EXPORT_V1', status: 'READY', researchOnly: true, decisionUse: false,
    productionMutationAllowed: false, canonicalWriteAllowed: false, reconstructed: false, capturedAtFabricated: false,
    coverage: { evidenceRows: 31 }, rows: corpus.map(evidence),
  };
  const baseline = new Map();
  const challengers = new Map(GROUP_A_CHALLENGERS.map(name => [name, new Map()]));
  for (let i = 0; i < corpus.length; i += 1) {
    const r = corpus[i];
    const target = { id: r.fixture_id, ft: { home: 1, away: 0 } };
    baseline.set(r.fixture_id, { kind: 'baseline', target, mm: mm(i === 30 ? 0.01 : 0.55, i === 30 ? 0.49 : 0.25, i === 30 ? 0.50 : 0.20) });
    for (const name of GROUP_A_CHALLENGERS) {
      if (name === GROUP_A_CHALLENGERS[0] && i === 30) continue;
      challengers.get(name).set(r.fixture_id, { kind: 'challenger', name, target, mm: mm(0.55, 0.25, 0.20) });
    }
  }
  const result = { challengers: Object.fromEntries(GROUP_A_CHALLENGERS.map(name => [name, { hardBlockers: ['NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'] }])) };
  const out = applyHistoricalMarketBoardGate(result, { baseline, challengers }, marketEvidence, corpus);
  const first = out.challengers[GROUP_A_CHALLENGERS[0]];
  assert.equal(out.historicalMarketBoardEvaluation.globalBaselineDiagnostic.pairedExecutableFixtures, 31);
  assert.equal(first.historicalMarketBoard.baseline.pairedExecutableFixtures, 30);
  assert.equal(first.historicalMarketBoard.challenger.pairedExecutableFixtures, 30);
  assert.equal(first.historicalMarketBoard.pairedFixtureCountMatches, true);
  assert.equal(first.historicalMarketBoard.sampleReady, true);
});
