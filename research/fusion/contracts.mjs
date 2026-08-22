export const FUSION_VERSION = 'CFI_FUSION_RESEARCH_V1.1';
export const MARKETS = Object.freeze(['3+ HT','7+ FT','Other HT','Other FT']);
export const SCORELINE_TARGETS = Object.freeze(['Top-3 HT','Top-3 FT']);
export const EXPERTS = Object.freeze(['FUTURE_SIX','HISTORICAL','MATCH_DNA','REGIME']);
export const IMAGE_STATES = Object.freeze(['PREMATCH_NORMAL','PREMATCH_COUNTDOWN','LIVE_1H','HALFTIME','LIVE_2H','FINISHED','TEAM_HISTORY','H2H','STANDINGS','ODDS','UNKNOWN']);

export const DEFAULT_FUSION_POLICY = Object.freeze({
  useTargetRouter: true,
  useSelectiveGate: false,
  useTemporalCalibration: false,
  useCoverageFallback: true,
  preserveFutureSixTop3: true,
  enableTailConditional: true,
  enableImageReliability: true,
  reason: 'ABLATION_PRUNED_V1: F4/F5/F6 experimental variants reduced score; keep proven routing/regime path plus safety/output layers',
});

export const FUSION_CONTRACT = Object.freeze({
  version: FUSION_VERSION,
  researchOnly: true,
  strictPriorRequired: true,
  productionMutationAllowed: false,
  canonicalDbMutationAllowed: false,
  baseline: 'R0_IMMUTABLE',
  promotionThreshold: 80,
  router: 'TARGET_SPECIFIC',
  calibration: 'TEMPORAL_ONLY_WHEN_ENABLED_BY_EVIDENCE',
  abstainAllowed: true,
  deterministicRequired: true,
  countdownPrematchEvidenceAllowed: true,
  countdownLiveEvidenceAllowed: false,
  defaultPolicy: DEFAULT_FUSION_POLICY,
});

export const clamp01 = x => Math.max(0, Math.min(1, Number.isFinite(Number(x)) ? Number(x) : 0));

export function assertTargetDate(targetDate){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate??''))) throw new Error('TARGET_DATE_REQUIRED');
  return String(targetDate);
}

export function assertStrictPriorDate(maxEvidenceDate,targetDate){
  assertTargetDate(targetDate);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(maxEvidenceDate??''))) throw new Error('MAX_EVIDENCE_DATE_REQUIRED');
  if(String(maxEvidenceDate) >= String(targetDate)) throw new Error('STRICT_PRIOR_FAILURE');
  return true;
}

export function assertExpertOutput(x){
  if(!x||typeof x!=='object') throw new Error('EXPERT_OUTPUT_REQUIRED');
  for(const market of MARKETS){
    const p=x.probabilities?.[market];
    if(!Number.isFinite(p)||p<0||p>1) throw new Error(`INVALID_PROBABILITY:${market}`);
  }
  return true;
}
