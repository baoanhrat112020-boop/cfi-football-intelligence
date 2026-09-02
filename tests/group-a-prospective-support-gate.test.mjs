import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROUP_A_PROSPECTIVE_CANDIDATES,
  evaluateGroupAProspectiveSupport,
} from '../research/group-a-prospective-support-gate.mjs';

function genericForwardCohort(n = 30) {
  const snapshots = [];
  const decisions = [];
  const marketSnapshots = [];
  const settlements = [];
  for (let i = 0; i < n; i += 1) {
    snapshots.push({
      snapshot_id: `generic-s-${i}`,
      fixture_id: `generic-f-${i}`,
      model_name: 'FUTURE_SIX_FACTORS',
      kickoff_at: '2026-09-01T12:00:00Z',
      created_at: '2026-09-01T10:00:00Z',
      strict_prior: true,
      prediction_hash: `hash-${i}`,
    });
    marketSnapshots.push({
      market_snapshot_id: `generic-m-${i}`,
      verified_fixture_id: `generic-f-${i}`,
      captured_at: '2026-09-01T10:30:00Z',
      kickoff_at: '2026-09-01T12:00:00Z',
      research_only: true,
    });
    decisions.push({
      decision_snapshot_id: `generic-d-${i}`,
      research_prediction_snapshot_id: `generic-s-${i}`,
      market_snapshot_id: `generic-m-${i}`,
      decision_timestamp: '2026-09-01T10:45:00Z',
      decision_use: false,
      research_only: true,
    });
    settlements.push({
      settlement_id: `generic-x-${i}`,
      decision_snapshot_id: `generic-d-${i}`,
      fixture_id: `generic-f-${i}`,
      verified_fixture_id: `generic-f-${i}`,
      settled_at: '2026-09-01T15:00:00Z',
      research_only: true,
      immutable: true,
    });
  }
  return { snapshots, decisions, marketSnapshots, settlements };
}

function candidateCohort(modelName, n = 30) {
  const snapshots = [];
  const decisions = [];
  const marketSnapshots = [];
  const settlements = [];
  for (let i = 0; i < n; i += 1) {
    snapshots.push({
      snapshot_id: `${modelName}-s-${i}`,
      fixture_id: `${modelName}-f-${i}`,
      model_name: modelName,
      kickoff_at: '2026-09-01T12:00:00Z',
      created_at: '2026-09-01T10:00:00Z',
      strict_prior: true,
      prediction_hash: `${modelName}-hash-${i}`,
    });
    marketSnapshots.push({
      market_snapshot_id: `${modelName}-m-${i}`,
      verified_fixture_id: `${modelName}-f-${i}`,
      captured_at: '2026-09-01T10:30:00Z',
      kickoff_at: '2026-09-01T12:00:00Z',
      research_only: true,
    });
    decisions.push({
      decision_snapshot_id: `${modelName}-d-${i}`,
      research_prediction_snapshot_id: `${modelName}-s-${i}`,
      market_snapshot_id: `${modelName}-m-${i}`,
      decision_timestamp: '2026-09-01T10:45:00Z',
      decision_use: false,
      research_only: true,
    });
    settlements.push({
      settlement_id: `${modelName}-x-${i}`,
      decision_snapshot_id: `${modelName}-d-${i}`,
      fixture_id: `${modelName}-f-${i}`,
      verified_fixture_id: `${modelName}-f-${i}`,
      settled_at: '2026-09-01T15:00:00Z',
      research_only: true,
      immutable: true,
    });
  }
  return { snapshots, decisions, marketSnapshots, settlements };
}

test('generic 30-settlement forward cohort cannot satisfy Group A candidate support', () => {
  const out = evaluateGroupAProspectiveSupport(genericForwardCohort(30));
  assert.equal(out.status, 'BLOCKED');
  assert.equal(out.sampleReady, false);
  assert.equal(out.promotionDecision, 'HOLD');
  assert.equal(out.productionEligible, false);
  assert.equal(out.productionMutationAllowed, false);
  assert.equal(out.noReconstruction, true);
  for (const modelName of GROUP_A_PROSPECTIVE_CANDIDATES) {
    assert.equal(out.candidates[modelName].prematchSnapshots, 0);
    assert.equal(out.candidates[modelName].settledDistinctFixtures, 0);
    assert.equal(out.candidates[modelName].blocker, 'GROUP_A_PROSPECTIVE_PREMATCH_SNAPSHOTS_REQUIRED');
  }
});

test('candidate-specific 30 settled fixtures only clears sample support, never production promotion', () => {
  const modelName = 'OPPONENT_STRENGTH_ARM_V1';
  const out = evaluateGroupAProspectiveSupport(candidateCohort(modelName, 30), { candidateNames: [modelName] });
  assert.equal(out.status, 'SAMPLE_READY');
  assert.equal(out.sampleReady, true);
  assert.equal(out.candidates[modelName].validStrictPriorPrematchSnapshots, 30);
  assert.equal(out.candidates[modelName].validPairedDecisions, 30);
  assert.equal(out.candidates[modelName].settledDistinctFixtures, 30);
  assert.equal(out.candidates[modelName].performanceEvaluationRequired, true);
  assert.equal(out.candidates[modelName].promotionDecision, 'HOLD');
  assert.equal(out.shadowEligible, false);
  assert.equal(out.productionEligible, false);
});

test('post-kickoff, decision-use, mutable or non-strict evidence cannot count', () => {
  const modelName = 'OPPONENT_STRENGTH_ARM_V1';
  const cohort = candidateCohort(modelName, 1);
  cohort.snapshots[0].strict_prior = false;
  cohort.decisions[0].decision_use = true;
  cohort.marketSnapshots[0].captured_at = '2026-09-01T12:01:00Z';
  cohort.settlements[0].immutable = false;
  const out = evaluateGroupAProspectiveSupport(cohort, { candidateNames: [modelName], minSamples: 1 });
  assert.equal(out.status, 'BLOCKED');
  assert.equal(out.candidates[modelName].invalidPrematchSnapshots, 1);
  assert.equal(out.candidates[modelName].settledDistinctFixtures, 0);
  assert.equal(out.candidates[modelName].blocker, 'INSUFFICIENT_GROUP_A_PROSPECTIVE_SUPPORT');
});
