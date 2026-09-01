import { buildPrediction, FINAL_VERSION, MARKET_CODES, normalizeFixtures } from '../../src/prediction/final-engine.ts';
import { verifyPrimaryContractV2 } from '../../src/prediction/primary-contract-v2.ts';
import { lockMultiMarketShadow, verifyLockedShadow } from '../../src/prediction/multi-market-live-shadow.ts';
import { evaluateLockedOosGate } from '../../src/prediction/multi-market-locked-oos-gate.ts';
import { walkForwardMultiMarketBacktest } from '../../src/prediction/multi-market-backtest.ts';
import { MULTI_MARKET_HISTORICAL_V2 } from '../../research/multi-market-historical-learning-v2.mjs';
import { runR0Bulk } from '../../research/run-r0-bulk.mjs';
import { HF_SHADOW_PREDICTION_CONTRACT, SIX_PRIMARY_TARGETS, shadowStamp } from './contracts.mjs';
import { loadPinnedArtifact } from './data-source.mjs';
import { assertStrictPrior } from './strict-prior.mjs';

function fixtureIdentity(snapshot) {
  const f = snapshot?.fixture ?? {};
  const fixtureId = String(f.fixture_id ?? f.fixtureId ?? f.id ?? '').trim();
  const targetDate = String(f.target_date ?? f.match_date ?? f.matchDate ?? '').slice(0, 10);
  const home = String(f.home_team ?? f.homeTeam ?? '').trim();
  const away = String(f.away_team ?? f.awayTeam ?? '').trim();
  const kickoffAt = String(f.kickoff_at ?? f.kickoffAt ?? '').trim();
  if (!fixtureId || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || !home || !away || !Number.isFinite(Date.parse(kickoffAt))) {
    throw new Error('SHADOW_FIXTURE_IDENTITY_INCOMPLETE');
  }
  return { fixtureId, targetDate, home, away, kickoffAt: new Date(Date.parse(kickoffAt)).toISOString() };
}

export async function runHistoricalJob(spec) {
  const dataset = await loadPinnedArtifact(spec.dataset);
  const fixtures = normalizeFixtures(dataset.payload);
  if (!fixtures.length) throw new Error('HISTORICAL_CORPUS_EMPTY');
  const r0 = runR0Bulk(dataset.payload, spec.options?.r0 ?? {});
  const multiMarket = walkForwardMultiMarketBacktest(
    fixtures,
    Number(spec.options?.min_team_prior ?? 1),
    Number(spec.options?.history_cap ?? 10),
  );
  const strictPriorVerified = r0?.replay?.strictPrior === true
    && r0?.replay?.sameDateLeakage === false
    && r0?.replay?.temporalProvenanceComplete === true
    && multiMarket?.strictPrior === true
    && multiMarket?.sameDateExcluded === true
    && multiMarket?.leakage === false;
  if (!strictPriorVerified) throw new Error('HISTORICAL_STRICT_PRIOR_GATE_FAILED');
  return {
    kind: 'historical',
    dataset,
    modelVersion: FINAL_VERSION,
    strictPriorAudit: {
      verified: true,
      r0: r0.replay,
      multiMarket: {
        version: multiMarket.version,
        strictPrior: multiMarket.strictPrior,
        sameDateExcluded: multiMarket.sameDateExcluded,
        leakage: multiMarket.leakage,
        evaluatedMatches: multiMarket.evaluatedMatches,
      },
    },
    output: shadowStamp({
      contract: 'CFI_HF_HISTORICAL_JOB_V1',
      historical_learning_contract: MULTI_MARKET_HISTORICAL_V2,
      corpus_fixture_count: fixtures.length,
      r0,
      multi_market: multiMarket,
      promotion_effect: 'NONE',
    }),
  };
}

export async function runShadowPredictionJob(spec) {
  const dataset = await loadPinnedArtifact(spec.snapshot);
  const snapshot = dataset.payload;
  const fixture = fixtureIdentity(snapshot);
  const predictionLockTime = String(snapshot.prediction_lock_time ?? '').trim();
  const lockMs = Date.parse(predictionLockTime);
  const kickoffMs = Date.parse(fixture.kickoffAt);
  const createdAt = new Date().toISOString();
  if (!Number.isFinite(lockMs) || lockMs >= kickoffMs) throw new Error('PREDICTION_LOCK_NOT_PREKICKOFF');
  if (Date.parse(createdAt) >= kickoffMs) throw new Error('SHADOW_EXECUTION_NOT_PREKICKOFF');

  const strictPriorAudit = assertStrictPrior({
    targetDate: fixture.targetDate,
    predictionLockTime,
    homePayload: snapshot.homePayload,
    awayPayload: snapshot.awayPayload,
    h2hPayload: snapshot.h2hPayload,
  });

  const prediction = buildPrediction({
    home: fixture.home,
    away: fixture.away,
    targetDate: fixture.targetDate,
    language: snapshot.language ?? 'en',
    homePayload: snapshot.homePayload,
    awayPayload: snapshot.awayPayload,
    h2hPayload: snapshot.h2hPayload,
  });
  const primaryVerification = verifyPrimaryContractV2(
    prediction.markets,
    prediction.primaryTargets?.scorelineTargets,
    MARKET_CODES,
  );
  if (!primaryVerification.complete || prediction.primaryTargets?.count !== SIX_PRIMARY_TARGETS.length) {
    throw new Error('SIX_TARGET_CONTRACT_INCOMPLETE');
  }
  if (prediction.multiMarket?.consistencyGuard?.status !== 'PASS') throw new Error('MULTI_MARKET_COHERENCE_FAILED');

  const payload = shadowStamp({
    contract: HF_SHADOW_PREDICTION_CONTRACT,
    fixture: {
      fixture_id: fixture.fixtureId,
      target_date: fixture.targetDate,
      home_team: fixture.home,
      away_team: fixture.away,
      kickoff_at: fixture.kickoffAt,
    },
    prediction_lock_time: new Date(lockMs).toISOString(),
    prediction_timestamp: createdAt,
    evidence_cutoff: strictPriorAudit.maxEvidenceTimestamp,
    strict_prior: strictPriorAudit,
    model_version: prediction.engine ?? FINAL_VERSION,
    six_target_verification: primaryVerification,
    primary_targets: prediction.primaryTargets,
    markets: prediction.markets,
    scoreline: prediction.scoreline,
    multi_market: prediction.multiMarket,
  });
  const locked = lockMultiMarketShadow({
    fixtureId: fixture.fixtureId,
    targetDate: fixture.targetDate,
    createdAt,
    modelVersion: prediction.engine ?? FINAL_VERSION,
    payload,
  });
  if (!verifyLockedShadow(locked)) throw new Error('SHADOW_LOCK_VERIFICATION_FAILED');

  return {
    kind: 'shadow_prediction',
    dataset,
    modelVersion: prediction.engine ?? FINAL_VERSION,
    strictPriorAudit,
    output: shadowStamp({
      contract: 'CFI_HF_SHADOW_PREDICTION_ARTIFACT_V1',
      locked_shadow: locked,
      canonical_production_write: false,
      canonical_settlement_write: false,
    }),
  };
}

export async function runLockedOosGateJob(spec) {
  const dataset = await loadPinnedArtifact(spec.dataset);
  const rows = Array.isArray(dataset.payload) ? dataset.payload : dataset.payload?.rows;
  if (!Array.isArray(rows)) throw new Error('LOCKED_OOS_ROWS_REQUIRED');
  const gate = evaluateLockedOosGate(rows, spec.options ?? {});
  return {
    kind: 'locked_oos_gate',
    dataset,
    modelVersion: String(spec.model_version ?? 'LOCKED_CHALLENGER'),
    strictPriorAudit: { verified: gate.hardFailures?.every((x) => !String(x).includes('STRICT_PRIOR')) ?? false },
    output: shadowStamp({ contract: 'CFI_HF_LOCKED_OOS_GATE_JOB_V1', gate, promotion_effect: 'NONE' }),
  };
}

export async function runJob(spec) {
  const kind = String(spec?.kind ?? '');
  if (kind === 'historical') return runHistoricalJob(spec);
  if (kind === 'shadow_prediction') return runShadowPredictionJob(spec);
  if (kind === 'locked_oos_gate') return runLockedOosGateJob(spec);
  throw new Error('UNSUPPORTED_HF_SHADOW_JOB');
}
