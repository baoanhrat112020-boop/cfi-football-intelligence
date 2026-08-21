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
  candidateApplicabilityThreshold: 70,
  historicalPromotionThreshold: 80,
  directPaperToProduction: false,
  lifecycle: KNOWLEDGE_LIFECYCLE,
  loop: ['HUNT','PROVENANCE','DEDUP','REGISTRY','CANDIDATE_QUEUE','LAB','EVIDENCE','REGISTRY_FEEDBACK','SHADOW','RELEASE_GATE'],
});

const VERIFIED_PROVENANCE = new Set(['SOURCE_VERIFIED','CROSS_CHECKED','VERIFIED']);

export function candidateDecision(item = {}) {
  const applicability = Math.max(0, Math.min(100, Number(item.applicability_score ?? 0)));
  const provenance = String(item.provenance_status ?? 'UNVERIFIED');
  const candidate = applicability >= KNOWLEDGE_SYNC_CONTRACT.candidateApplicabilityThreshold && VERIFIED_PROVENANCE.has(provenance);
  return {
    candidate,
    registryStatus: candidate ? 'CANDIDATE' : 'DISCOVERED',
    queueStatus: candidate ? 'QUEUED' : null,
    baselineLock: 'R0_IMMUTABLE',
    productionMutationAllowed: false,
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
