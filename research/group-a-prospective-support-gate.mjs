import fs from 'node:fs/promises';
import { createResearchSupabaseReader, resolveResearchCredentials } from './supabase-read-adapter.mjs';
import { MULTIMARKET_MIN_SAMPLES } from './multimarket-promotion-gate-v2.mjs';

export const GROUP_A_PROSPECTIVE_CANDIDATES = Object.freeze([
  'OPPONENT_STRENGTH_ARM_V1',
  'HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1',
  'PROMOTION_RELEGATION_STRENGTH_BRIDGE_V1',
  'ADAPTIVE_SCORE_DISPERSION_V1',
]);

export const GROUP_A_PROSPECTIVE_SUPPORT_GATE = Object.freeze({
  version: 'CFI_GROUP_A_PROSPECTIVE_SUPPORT_GATE_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  productionEligible: false,
  noReconstruction: true,
  strictPriorRequired: true,
  immutablePrematchRequired: true,
  minSettledDistinctFixturesPerCandidate: MULTIMARKET_MIN_SAMPLES,
});

const text = value => String(value ?? '').trim();
const finiteDate = value => Number.isFinite(Date.parse(text(value)));

function validPrematchSnapshot(row) {
  return row?.strict_prior === true
    && Boolean(text(row?.prediction_hash))
    && finiteDate(row?.created_at)
    && finiteDate(row?.kickoff_at)
    && Date.parse(row.created_at) < Date.parse(row.kickoff_at);
}

function validMarketSnapshot(row) {
  return row?.research_only === true
    && finiteDate(row?.captured_at)
    && finiteDate(row?.kickoff_at)
    && Date.parse(row.captured_at) < Date.parse(row.kickoff_at);
}

function validDecision(row, snapshot, market) {
  if (!snapshot || !market) return false;
  const kickoff = Math.min(Date.parse(snapshot.kickoff_at), Date.parse(market.kickoff_at));
  return row?.research_only === true
    && row?.decision_use === false
    && text(row?.research_prediction_snapshot_id) === text(snapshot.snapshot_id)
    && finiteDate(row?.decision_timestamp)
    && Number.isFinite(kickoff)
    && Date.parse(row.decision_timestamp) < kickoff;
}

function validSettlement(row, decision, snapshot) {
  if (!decision || !snapshot) return false;
  return row?.research_only === true
    && row?.immutable === true
    && text(row?.decision_snapshot_id) === text(decision.decision_snapshot_id)
    && finiteDate(row?.settled_at)
    && Date.parse(row.settled_at) > Date.parse(snapshot.kickoff_at);
}

export function evaluateGroupAProspectiveSupport(
  { snapshots = [], decisions = [], marketSnapshots = [], settlements = [] } = {},
  { candidateNames = GROUP_A_PROSPECTIVE_CANDIDATES, minSamples = MULTIMARKET_MIN_SAMPLES } = {},
) {
  const requiredCandidates = [...new Set(candidateNames.map(text).filter(Boolean))];
  const requiredMin = Math.max(1, Math.floor(Number(minSamples) || MULTIMARKET_MIN_SAMPLES));
  const marketById = new Map(marketSnapshots.map(row => [text(row?.market_snapshot_id), row]));
  const decisionsByResearchSnapshot = new Map();
  for (const row of decisions) {
    const key = text(row?.research_prediction_snapshot_id);
    if (!key) continue;
    const list = decisionsByResearchSnapshot.get(key) ?? [];
    list.push(row);
    decisionsByResearchSnapshot.set(key, list);
  }
  const settlementsByDecision = new Map();
  for (const row of settlements) {
    const key = text(row?.decision_snapshot_id);
    if (!key) continue;
    const list = settlementsByDecision.get(key) ?? [];
    list.push(row);
    settlementsByDecision.set(key, list);
  }

  const candidates = {};
  for (const modelName of requiredCandidates) {
    const modelSnapshots = snapshots.filter(row => text(row?.model_name) === modelName);
    const validSnapshots = modelSnapshots.filter(validPrematchSnapshot);
    const settledFixtureIds = new Set();
    let validDecisions = 0;
    let validSettlementRows = 0;

    for (const snapshot of validSnapshots) {
      const linkedDecisions = decisionsByResearchSnapshot.get(text(snapshot.snapshot_id)) ?? [];
      for (const decision of linkedDecisions) {
        const market = marketById.get(text(decision.market_snapshot_id));
        if (!validMarketSnapshot(market) || !validDecision(decision, snapshot, market)) continue;
        validDecisions += 1;
        const linkedSettlements = settlementsByDecision.get(text(decision.decision_snapshot_id)) ?? [];
        for (const settlement of linkedSettlements) {
          if (!validSettlement(settlement, decision, snapshot)) continue;
          validSettlementRows += 1;
          const fixtureId = text(snapshot.fixture_id)
            || text(settlement.verified_fixture_id)
            || text(settlement.fixture_id)
            || text(market.verified_fixture_id);
          if (fixtureId) settledFixtureIds.add(fixtureId);
        }
      }
    }

    const settledDistinctFixtures = settledFixtureIds.size;
    const sampleReady = settledDistinctFixtures >= requiredMin;
    const blocker = sampleReady
      ? null
      : modelSnapshots.length === 0
        ? 'GROUP_A_PROSPECTIVE_PREMATCH_SNAPSHOTS_REQUIRED'
        : 'INSUFFICIENT_GROUP_A_PROSPECTIVE_SUPPORT';

    candidates[modelName] = {
      modelName,
      prematchSnapshots: modelSnapshots.length,
      validStrictPriorPrematchSnapshots: validSnapshots.length,
      invalidPrematchSnapshots: modelSnapshots.length - validSnapshots.length,
      validPairedDecisions: validDecisions,
      validSettlementRows,
      settledDistinctFixtures,
      requiredMinSamples: requiredMin,
      remainingToMinimum: Math.max(0, requiredMin - settledDistinctFixtures),
      sampleReady,
      blocker,
      performanceEvaluationRequired: sampleReady,
      promotionDecision: 'HOLD',
      shadowEligible: false,
      productionEligible: false,
      decisionUse: false,
      productionMutationAllowed: false,
    };
  }

  const sampleReady = requiredCandidates.length > 0
    && requiredCandidates.every(name => candidates[name]?.sampleReady === true);
  const blockers = [...new Set(requiredCandidates.map(name => candidates[name]?.blocker).filter(Boolean))];

  return {
    ...GROUP_A_PROSPECTIVE_SUPPORT_GATE,
    status: sampleReady ? 'SAMPLE_READY' : 'BLOCKED',
    blocker: sampleReady ? null : 'GROUP_A_CANDIDATE_SPECIFIC_PROSPECTIVE_SUPPORT_INCOMPLETE',
    candidateNames: requiredCandidates,
    requiredMinSamples: requiredMin,
    sampleReady,
    blockers,
    candidates,
    performanceGateRequiredAfterSampleReady: true,
    promotionDecision: 'HOLD',
    shadowEligible: false,
  };
}

export async function exportGroupAProspectiveSupport({ reader, outputPath }) {
  if (!reader?.readAll) throw new Error('CFI_RESEARCH_READER_REQUIRED');
  const [snapshots, decisions, marketSnapshots, settlements] = await Promise.all([
    reader.readAll(
      'cfi_research_prematch_snapshots?select=snapshot_id,fixture_id,model_name,model_version,target_date,kickoff_at,prediction_hash,status,strict_prior,created_at',
      { critical: false, label: 'group_a_research_prematch_snapshots' },
    ),
    reader.readAll(
      'cfi_decision_snapshots?select=decision_snapshot_id,research_prediction_snapshot_id,market_snapshot_id,decision_timestamp,decision_use,research_only&research_only=eq.true',
      { critical: false, label: 'group_a_research_decisions' },
    ),
    reader.readAll(
      'cfi_market_snapshots?select=market_snapshot_id,verified_fixture_id,captured_at,kickoff_at,research_only&research_only=eq.true',
      { critical: false, label: 'group_a_research_market_snapshots' },
    ),
    reader.readAll(
      'cfi_market_decision_settlements?select=settlement_id,decision_snapshot_id,fixture_id,verified_fixture_id,settled_at,research_only,immutable&research_only=eq.true',
      { critical: false, label: 'group_a_research_market_settlements' },
    ),
  ]);

  const result = evaluateGroupAProspectiveSupport({ snapshots, decisions, marketSnapshots, settlements });
  if (result.productionMutationAllowed !== false || result.productionEligible !== false || result.decisionUse !== false || result.noReconstruction !== true) {
    throw new Error('GROUP_A_PROSPECTIVE_SUPPORT_ISOLATION_FAIL');
  }
  if (outputPath) await fs.writeFile(outputPath, `${JSON.stringify(result)}\n`);
  return result;
}

async function main() {
  const outputPath = process.argv[2] ?? 'group-a-prospective-support.json';
  const { baseUrl, key } = resolveResearchCredentials();
  const reader = createResearchSupabaseReader({ baseUrl, key });
  const result = await exportGroupAProspectiveSupport({ reader, outputPath });
  process.stdout.write(`${JSON.stringify({
    outputPath,
    version: result.version,
    status: result.status,
    blocker: result.blocker,
    requiredMinSamples: result.requiredMinSamples,
    candidates: result.candidates,
    promotionDecision: result.promotionDecision,
    productionEligible: result.productionEligible,
    decisionUse: result.decisionUse,
    productionMutationAllowed: result.productionMutationAllowed,
  })}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
