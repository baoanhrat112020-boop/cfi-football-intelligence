import { evaluateRun, compareAblation, deriveTemporalStability } from '../promotion-gate.mjs';

export const FUSION_STAGES=Object.freeze([
  'F0_FUTURE_SIX','F1_DNA','F2_REGIME','F3_ROUTER','F4_SELECTIVE_GATE','F5_TEMPORAL_CALIBRATION','F6_OOD_COVERAGE','F7_JOINT_HT_FT','F8_TAIL_CONDITIONAL','F9_IMAGE_RELIABILITY','F10_FULL_FUSION'
]);

export function evaluateStage(rows,options={}){
  const markets=options.markets??['3+ HT','7+ FT','Other HT','Other FT'];
  const stability=deriveTemporalStability(rows,markets,options.stabilityOptions??{}).score;
  return evaluateRun(rows,{...options,markets,stability});
}

export function pairedSubset(referenceRows,challengerRows){
  const keys=new Set(challengerRows.map(r=>`${r.fixtureId}|${r.targetTimestamp}`));
  return referenceRows.filter(r=>keys.has(`${r.fixtureId}|${r.targetTimestamp}`));
}

export function comparePaired(referenceRows,challengerRows,options={}){
  const ref=pairedSubset(referenceRows,challengerRows);
  if(ref.length!==challengerRows.length) return {status:'PAIRING_MISMATCH',referenceCount:ref.length,challengerCount:challengerRows.length};
  const baseline=evaluateStage(ref,options),challenger=evaluateStage(challengerRows,options);
  return {status:'OK',baseline,challenger,ablation:compareAblation(baseline,challenger)};
}
