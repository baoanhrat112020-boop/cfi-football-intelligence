import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPrediction } from '../src/prediction/final-engine.ts';
import {
  PRODUCTION_SCORE_GRID_TAP,
  buildPinnedProductionPredictionWithResearchGrid,
  stripResearchScoreGrid,
} from '../research/production-score-grid-tap.mjs';
import { runGroupAFullSuitePrimaryV2ScoreGrid } from '../research/group-a-primary-v2-scoregrid-gate.mjs';

function fixture(id, date, homeTeam, awayTeam, htHome, htAway, ftHome, ftAway, extra = {}) {
  return {
    id,
    fixture_id: id,
    matchDate: date,
    match_date: date,
    homeTeam,
    home_team: homeTeam,
    awayTeam,
    away_team: awayTeam,
    ht: { home: htHome, away: htAway },
    ft: { home: ftHome, away: ftAway },
    ht_home: htHome,
    ht_away: htAway,
    ft_home: ftHome,
    ft_away: ftAway,
    ...extra,
  };
}

function priorPayloads() {
  const home = [];
  const away = [];
  for (let i = 1; i <= 12; i++) {
    const date = `2015-01-${String(i).padStart(2, '0')}`;
    home.push(fixture(`h${i}`, date, 'Alpha', `H${i}`, i % 3, i % 2, 1 + (i % 4), i % 3));
    away.push(fixture(`a${i}`, date, `A${i}`, 'Beta', i % 2, i % 3, i % 3, 1 + (i % 4)));
  }
  return { home, away };
}

function mass(grid) {
  return grid.reduce((sum, row) => sum + Number(row.probability), 0);
}

test('research score-grid tap preserves exact public production prediction while exposing normalized internal grids', () => {
  const p = priorPayloads();
  const args = {
    home: 'Alpha',
    away: 'Beta',
    targetDate: '2015-02-01',
    language: 'en',
    homePayload: p.home,
    awayPayload: p.away,
    h2hPayload: [],
  };
  const production = buildPrediction(args);
  const tapped = buildPinnedProductionPredictionWithResearchGrid(args);
  assert.equal(PRODUCTION_SCORE_GRID_TAP.productionMutationAllowed, false);
  assert.equal(PRODUCTION_SCORE_GRID_TAP.noReconstruction, true);
  assert.deepEqual(stripResearchScoreGrid(tapped), production);
  assert.ok(Array.isArray(tapped.__researchFullScoreGrid.ht));
  assert.ok(Array.isArray(tapped.__researchFullScoreGrid.ft));
  assert.ok(Math.abs(mass(tapped.__researchFullScoreGrid.ht) - 1) < 1e-8);
  assert.ok(Math.abs(mass(tapped.__researchFullScoreGrid.ft) - 1) < 1e-8);
});

function groupAFixtureSet() {
  const corpus = [];
  const strengths = [];
  for (let i = 1; i <= 16; i++) {
    const date = `2016-01-${String(i).padStart(2, '0')}`;
    const htHome = i % 4 === 0 ? 2 : i % 2;
    const htAway = i % 5 === 0 ? 2 : (i + 1) % 2;
    const ftHome = htHome + 1 + (i % 3);
    const ftAway = htAway + (i % 2);
    corpus.push(fixture(`g${i}`, date, 'Alpha', 'Beta', htHome, htAway, ftHome, ftAway, {
      home_team_id: 'T_ALPHA',
      away_team_id: 'T_BETA',
      competition_key: 'test:league',
      competition_segment: 'TEST_SEGMENT',
      season: '2015/16',
      country: 'TEST',
    }));
    strengths.push({
      team_id: 'T_ALPHA',
      as_of_date: date,
      competition_key: 'test:league',
      segment_v2: 'TEST_SEGMENT',
      confidence: 0.9,
      attack_index: 0.25 + i * 0.001,
      defense_index: -0.05,
      net_strength: 0.3 + i * 0.001,
      strict_prior: true,
    });
    strengths.push({
      team_id: 'T_BETA',
      as_of_date: date,
      competition_key: 'test:league',
      segment_v2: 'TEST_SEGMENT',
      confidence: 0.9,
      attack_index: -0.1,
      defense_index: 0.1,
      net_strength: -0.2 - i * 0.001,
      strict_prior: true,
    });
  }
  return {
    corpus,
    features: { baselineCommitSha: '8ca9a3634f536f2f838135df062f5bbbf7da0d9a', strengths },
  };
}

test('Group A score-grid gate uses exact paired baseline rows and clears only the full-grid blocker', () => {
  const { corpus, features } = groupAFixtureSet();
  const result = runGroupAFullSuitePrimaryV2ScoreGrid(corpus, features, {
    minTeamPrior: 1,
    minOnlineSamples: 0,
    evaluationStart: '2016-01-03',
    evaluationEnd: '2016-01-16',
  });
  assert.equal(result.productionMutationAllowed, false);
  assert.equal(result.decisionUse, false);
  assert.equal(result.noReconstruction, true);
  assert.equal(result.evaluationContract.pairedBaseline, true);
  assert.equal(result.evaluationContract.fullScoreGridLogLoss, true);
  assert.equal(result.baselineMetrics.scoreline.ht.fullGridAvailable, true);
  assert.equal(result.baselineMetrics.scoreline.ft.fullGridAvailable, true);
  assert.ok(Number.isFinite(result.baselineMetrics.scoreline.ht.logLoss));
  assert.ok(Number.isFinite(result.baselineMetrics.scoreline.ft.logLoss));

  const eligible = Object.values(result.challengers).filter(x => Number(x.coverage?.eligible ?? 0) > 0);
  assert.ok(eligible.length > 0);
  for (const candidate of eligible) {
    assert.equal(candidate.pairedBaselineEvaluation, true);
    assert.equal(candidate.pairedBaselineMetrics.scoreline.ht.n, candidate.metrics.scoreline.ht.n);
    assert.equal(candidate.pairedBaselineMetrics.scoreline.ft.n, candidate.metrics.scoreline.ft.n);
    assert.ok(Number.isFinite(candidate.pairedBaselineMetrics.scoreline.ht.logLoss));
    assert.ok(Number.isFinite(candidate.pairedBaselineMetrics.scoreline.ft.logLoss));
    assert.ok(Number.isFinite(candidate.scoreGridLogLossEvaluation.ht.delta));
    assert.ok(Number.isFinite(candidate.scoreGridLogLossEvaluation.ft.delta));
    assert.ok(!candidate.hardBlockers.includes('BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS'));
    assert.ok(candidate.hardBlockers.includes('NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'));
    assert.equal(candidate.productionEligible, false);
    assert.equal(candidate.promotionDecision, 'HOLD');
  }
});