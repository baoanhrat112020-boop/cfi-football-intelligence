export const FUSION_V3_PROMOTION_GATE_VERSION='CFI_MULTI_MARKET_FUSION_V3_PROMOTION_GATE_V1';
export const FUSION_V3_REQUIRED_GROUPS=Object.freeze([
  'HT_1X2',
  'FT_1X2',
  'HT_OU',
  'FT_OU',
  'HT_AH',
  'FT_AH',
  'EXTREME_THRESHOLDS',
]);

const finite=x=>Number.isFinite(Number(x));

export function evaluateFusionV3Promotion(input={}){
  const failures=[];
  const n=Number(input?.metrics?.n??0);
  const candidate=input?.metrics?.candidate??{};
  const baseline=input?.metrics?.baseline??{};
  const deltas={
    brier:finite(candidate.brier)&&finite(baseline.brier)?Number(candidate.brier)-Number(baseline.brier):null,
    logLoss:finite(candidate.logLoss)&&finite(baseline.logLoss)?Number(candidate.logLoss)-Number(baseline.logLoss):null,
    ece:finite(candidate.ece)&&finite(baseline.ece)?Number(candidate.ece)-Number(baseline.ece):null,
  };

  if(input.strictPrior!==true) failures.push('STRICT_PRIOR_REQUIRED');
  if(input.reconstructed===true) failures.push('RECONSTRUCTION_FORBIDDEN');
  if(input.predictionHistoryReplay===true) failures.push('PREDICTION_HISTORY_REPLAY_FORBIDDEN');
  if(input.prospectiveReset!==true) failures.push('PROSPECTIVE_RESET_REQUIRED');
  if(input.lockedOosPass!==true) failures.push('LOCKED_OOS_REQUIRED');
  if(input.deterministicPass!==true) failures.push('DETERMINISM_REQUIRED');
  if(input.directionalSwapPass!==true) failures.push('DIRECTIONAL_SWAP_REQUIRED');
  if(input.trajectoryStatus!=='PASS') failures.push('TRAJECTORY_COHERENCE_REQUIRED');
  if(input.crossMarketCoherenceStatus!=='PASS') failures.push('CROSS_MARKET_COHERENCE_REQUIRED');
  if(n<200) failures.push('MIN_200_LOCKED_OOS_ROWS_REQUIRED');

  for(const key of ['brier','logLoss','ece']){
    if(!finite(candidate[key])||!finite(baseline[key])) failures.push(`FINITE_${key.toUpperCase()}_REQUIRED`);
  }

  if(deltas.brier!==null&&deltas.brier>-.001) failures.push('AGGREGATE_BRIER_GAIN_TOO_SMALL');
  if(deltas.logLoss!==null&&deltas.logLoss>0) failures.push('AGGREGATE_LOGLOSS_REGRESSION');
  if(deltas.ece!==null&&deltas.ece>.005) failures.push('CALIBRATION_ECE_REGRESSION');

  const groups=input.groups??{};
  for(const group of FUSION_V3_REQUIRED_GROUPS){
    const row=groups[group];
    if(!row) { failures.push(`${group}_EVIDENCE_REQUIRED`); continue; }
    if(Number(row.n??0)<30) failures.push(`${group}_MIN_SAMPLE_REQUIRED`);
    if(!finite(row.brierDelta)||!finite(row.logLossDelta)) failures.push(`${group}_FINITE_DELTA_REQUIRED`);
    if(finite(row.brierDelta)&&Number(row.brierDelta)>.01) failures.push(`${group}_BRIER_REGRESSION`);
    if(finite(row.logLossDelta)&&Number(row.logLossDelta)>.02) failures.push(`${group}_LOGLOSS_REGRESSION`);
  }

  const segmentWorst=Number(input.segmentWorstBrierDelta);
  if(!finite(segmentWorst)) failures.push('SEGMENT_WORST_BRIER_DELTA_REQUIRED');
  else if(segmentWorst>.02) failures.push('SEGMENT_REGRESSION');

  const bigDb=input.bigDb??{};
  if(bigDb.used===true&&bigDb.strictPriorVerified!==true) failures.push('BIGDB_TEMPORAL_AUDIT_REQUIRED');
  if(bigDb.used===true&&bigDb.reproducible!==true) failures.push('BIGDB_REPRODUCIBILITY_REQUIRED');

  const unique=[...new Set(failures)];
  return {
    version:FUSION_V3_PROMOTION_GATE_VERSION,
    status:unique.length?'BLOCKED':'PASS',
    hardFailures:unique,
    n,
    deltas,
    requiredGroups:[...FUSION_V3_REQUIRED_GROUPS],
    shadowEligible:unique.length===0,
    productionEligible:false,
    decisionUse:false,
    baselineLock:'R0_IMMUTABLE',
    promotionAuthority:'EXPLICIT_SEPARATE_APPROVAL_REQUIRED',
  };
}
