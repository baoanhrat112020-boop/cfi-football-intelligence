import { evaluateMultiMarketKnowledge, HUNT_WEIGHTS, TRACKS } from './multimarket-knowledge-policy.mjs';

export const CFI_KNOWLEDGE_SYNC_COMMAND = 'CFI KNOWLEDGE SYNC AUTO — HUNT → LAB → EVIDENCE — CONTINUOUS';

export const KNOWLEDGE_LIFECYCLE = Object.freeze([
  'DISCOVERED','VERIFIED_SOURCE','CANDIDATE','QUEUED','TESTING',
  'REJECTED','SHADOW_ELIGIBLE','LIVE_TESTING','VERIFIED_CFI','ARCHIVED'
]);

export const KNOWLEDGE_SYNC_CONTRACT = Object.freeze({
  version: 'CFI_KNOWLEDGE_SYNC_V1',
  researchOnly: true,
  r0Immutable: true,
  productionMutationAllowed: false,
  canonicalDbMutationAllowed: false,
  multiMarketFocus: true,
  candidateApplicabilityThreshold: 70,
  candidateMultiMarketRelevanceThreshold: 70,
  huntWeights: HUNT_WEIGHTS,
  priorityTracks: Object.keys(TRACKS),
  historicalPromotionThreshold: 80,
  directPaperToProduction: false,
  lifecycle: KNOWLEDGE_LIFECYCLE,
  loop: ['HUNT','PROVENANCE','DEDUP','REGISTRY','CANDIDATE_QUEUE','LAB','EVIDENCE','REGISTRY_FEEDBACK','SHADOW','RELEASE_GATE'],
});

export function candidateDecision(item = {}, context = {}) {
  const audit = evaluateMultiMarketKnowledge(item, context);
  return {
    candidate: audit.queueEligible,
    registryStatus: audit.queueEligible ? 'CANDIDATE' : 'DISCOVERED',
    queueStatus: audit.queueEligible ? 'QUEUED' : null,
    baselineLock: 'R0_IMMUTABLE',
    productionMutationAllowed: false,
    multiMarketFocus: true,
    huntScore: audit.huntScore,
    targetTrack: audit.track,
    hardFailures: audit.hardFailures,
    identity: audit.identity,
  };
}

export function evidenceTransition(verdict) {
  const map = {
    REJECTED: 'REJECTED',
    HARMFUL: 'REJECTED',
    NO_BENEFIT: 'REJECTED',
    SHADOW_ELIGIBLE: 'SHADOW_ELIGIBLE',
    VERIFIED_CFI: 'VERIFIED_CFI',
    SUPPORTED: 'TESTING',
    REGIME_SPECIFIC: 'TESTING',
    AUDIT_ONLY: 'TESTING',
  };
  return map[verdict] ?? null;
}

export function promotionDecision(score, hardFailures = []) {
  const s = Number(score);
  if (!Number.isFinite(s)) return 'INVALID';
  if (Array.isArray(hardFailures) && hardFailures.length) return 'HARD_FAIL';
  if (s < 70) return 'REJECT';
  if (s < 80) return 'RESEARCH';
  if (s < 90) return 'SHADOW_ELIGIBLE';
  if (s < 95) return 'STRONG_CANDIDATE';
  return 'EXCEPTIONAL';
}
