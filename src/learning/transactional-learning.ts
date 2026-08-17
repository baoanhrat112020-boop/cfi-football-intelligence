export const LEARNING_POLICY_VERSION = 'CFI_LEARNING_POLICY_V1' as const;

export type LearningDecision = 'COMMIT' | 'REJECT' | 'QUARANTINE' | 'DEFER';
export type TrustLevel = 'UNTRUSTED' | 'LOW' | 'MEDIUM' | 'HIGH' | 'AUTHORITATIVE';

export interface EntityScope {
  homeTeamId: string;
  awayTeamId: string;
  competitionId: string;
  season: string;
  gender?: string;
  ageLevel?: string;
  reserveLevel?: string;
}

export interface EvidenceRef {
  id: string;
  sourceType: 'PERSISTENT_DB' | 'PRIMARY_SOURCE' | 'VERIFIED_SECONDARY' | 'COMMUNITY' | 'USER_SCREENSHOT' | 'MODEL_OUTPUT';
  trust: TrustLevel;
  verified: boolean;
  observedAt?: string;
  entityScope?: EntityScope;
}

export interface LearningProposal {
  id: string;
  lessonType: string;
  hypothesis: string;
  evidence: EvidenceRef[];
  entityScope: EntityScope;
  predecessorVersion?: string | null;
  expectedPredecessorVersion?: string | null;
  settledOutcomeRequired?: boolean;
  settledOutcomeVerified?: boolean;
  duplicateKey?: string | null;
  existingDuplicateKeys?: string[];
  createdAt?: string;
  now?: string;
  maxAgeDays?: number;
}

export interface LearningGateResult {
  policyVersion: typeof LEARNING_POLICY_VERSION;
  decision: LearningDecision;
  reasons: string[];
  effectiveTrust: TrustLevel;
  reversible: true;
}

const TRUST_SCORE: Record<TrustLevel, number> = {
  UNTRUSTED: 0,
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  AUTHORITATIVE: 4,
};

function minTrust(refs: EvidenceRef[]): TrustLevel {
  if (!refs.length) return 'UNTRUSTED';
  return refs.reduce<TrustLevel>((lowest, ref) =>
    TRUST_SCORE[ref.trust] < TRUST_SCORE[lowest] ? ref.trust : lowest,
  refs[0].trust);
}

export function sameEntityScope(a?: EntityScope, b?: EntityScope): boolean {
  if (!a || !b) return false;
  return a.homeTeamId === b.homeTeamId &&
    a.awayTeamId === b.awayTeamId &&
    a.competitionId === b.competitionId &&
    a.season === b.season &&
    (a.gender ?? '') === (b.gender ?? '') &&
    (a.ageLevel ?? '') === (b.ageLevel ?? '') &&
    (a.reserveLevel ?? '') === (b.reserveLevel ?? '');
}

function isFresh(createdAt?: string, now?: string, maxAgeDays = 30): boolean {
  if (!createdAt || !now) return true;
  const created = Date.parse(createdAt), current = Date.parse(now);
  if (!Number.isFinite(created) || !Number.isFinite(current) || current < created) return false;
  return current - created <= maxAgeDays * 86400000;
}

export function evaluateLearningProposal(p: LearningProposal): LearningGateResult {
  const reasons: string[] = [];
  const effectiveTrust = minTrust(p.evidence);

  if (!p.id || !p.lessonType || !p.hypothesis.trim()) reasons.push('MALFORMED_PROPOSAL');
  if (!p.evidence.length) reasons.push('NO_EVIDENCE');
  if (p.evidence.some(ref => ref.entityScope && !sameEntityScope(ref.entityScope, p.entityScope))) reasons.push('ENTITY_SCOPE_MISMATCH');
  if (p.expectedPredecessorVersion != null && p.predecessorVersion !== p.expectedPredecessorVersion) reasons.push('PREDECESSOR_MISMATCH');
  if (p.duplicateKey && (p.existingDuplicateKeys ?? []).includes(p.duplicateKey)) reasons.push('DUPLICATE_PROPOSAL');
  if (!isFresh(p.createdAt, p.now, p.maxAgeDays)) reasons.push('STALE_PROPOSAL');

  if (reasons.some(r => ['MALFORMED_PROPOSAL','ENTITY_SCOPE_MISMATCH','PREDECESSOR_MISMATCH','DUPLICATE_PROPOSAL','STALE_PROPOSAL'].includes(r))) {
    return { policyVersion: LEARNING_POLICY_VERSION, decision: 'REJECT', reasons, effectiveTrust, reversible: true };
  }

  if (p.settledOutcomeRequired && !p.settledOutcomeVerified) {
    return { policyVersion: LEARNING_POLICY_VERSION, decision: 'DEFER', reasons: ['SETTLED_OUTCOME_REQUIRED'], effectiveTrust, reversible: true };
  }

  const unverifiedExternal = p.evidence.some(ref => !ref.verified || ref.sourceType === 'COMMUNITY' || ref.sourceType === 'MODEL_OUTPUT');
  if (unverifiedExternal || TRUST_SCORE[effectiveTrust] < TRUST_SCORE.MEDIUM) {
    return { policyVersion: LEARNING_POLICY_VERSION, decision: 'QUARANTINE', reasons: ['UNVERIFIED_OR_LOW_TRUST_EVIDENCE'], effectiveTrust, reversible: true };
  }

  return { policyVersion: LEARNING_POLICY_VERSION, decision: 'COMMIT', reasons: ['ALL_GATES_PASSED'], effectiveTrust, reversible: true };
}

export interface DependencyNode {
  id: string;
  dependsOn: string[];
  status?: 'ACTIVE' | 'STALE' | 'INVALIDATED';
}

export function cascadeInvalidate(nodes: DependencyNode[], invalidRootIds: string[]): DependencyNode[] {
  const invalid = new Set(invalidRootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (!invalid.has(node.id) && node.dependsOn.some(id => invalid.has(id))) {
        invalid.add(node.id);
        changed = true;
      }
    }
  }
  return nodes.map(node => ({ ...node, status: invalid.has(node.id) ? 'INVALIDATED' : (node.status ?? 'ACTIVE') }));
}

export function derivedTrustCannotExceedWeakestSource(claimed: TrustLevel, evidence: EvidenceRef[]): TrustLevel {
  const weakest = minTrust(evidence);
  return TRUST_SCORE[claimed] <= TRUST_SCORE[weakest] ? claimed : weakest;
}
