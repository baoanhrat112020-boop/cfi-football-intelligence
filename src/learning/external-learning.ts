import {
  evaluateLearningProposal,
  type EntityScope,
  type EvidenceRef,
  type LearningGateResult,
  type TrustLevel,
} from './transactional-learning.ts';

export type ExternalNetwork = 'CREWAI' | 'HUGGING_FACE' | 'MOLTBOOK' | 'GITHUB' | 'A2A' | 'OTHER';
export type ExternalCandidateStatus = 'QUARANTINE' | 'REJECT' | 'VERIFIED_ELIGIBLE';

export interface ExternalLearningSource {
  id: string;
  network: ExternalNetwork;
  url?: string;
  author?: string;
  publisherGroup: string;
  trust: TrustLevel;
  verified: boolean;
  observedAt?: string;
}

export interface ExternalLearningCandidate {
  id: string;
  lessonType: string;
  claim: string;
  entityScope: EntityScope;
  communitySource: ExternalLearningSource;
  corroboratingEvidence: EvidenceRef[];
  corroboratingPublisherGroups: string[];
  contradicted?: boolean;
  predecessorVersion?: string | null;
  expectedPredecessorVersion?: string | null;
  createdAt?: string;
  now?: string;
}

export interface ExternalLearningDecision {
  status: ExternalCandidateStatus;
  reasons: string[];
  independentPublisherGroups: number;
  gate?: LearningGateResult;
  provenance: {
    community: ExternalLearningSource;
    evidenceIds: string[];
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map(v => v.trim()).filter(Boolean))];
}

export function evaluateExternalLearningCandidate(candidate: ExternalLearningCandidate): ExternalLearningDecision {
  const groups = uniqueNonEmpty(candidate.corroboratingPublisherGroups);
  const provenance = {
    community: candidate.communitySource,
    evidenceIds: candidate.corroboratingEvidence.map(e => e.id),
  };

  if (!candidate.id || !candidate.lessonType || !candidate.claim.trim()) {
    return { status: 'REJECT', reasons: ['MALFORMED_EXTERNAL_CANDIDATE'], independentPublisherGroups: groups.length, provenance };
  }

  if (candidate.contradicted) {
    return { status: 'REJECT', reasons: ['UNRESOLVED_CONTRADICTION'], independentPublisherGroups: groups.length, provenance };
  }

  if (groups.length < 2) {
    return { status: 'QUARANTINE', reasons: ['INSUFFICIENT_INDEPENDENT_CORROBORATION'], independentPublisherGroups: groups.length, provenance };
  }

  if (!candidate.corroboratingEvidence.length || candidate.corroboratingEvidence.some(e => !e.verified)) {
    return { status: 'QUARANTINE', reasons: ['UNVERIFIED_CORROBORATING_EVIDENCE'], independentPublisherGroups: groups.length, provenance };
  }

  const gate = evaluateLearningProposal({
    id: candidate.id,
    lessonType: candidate.lessonType,
    hypothesis: candidate.claim,
    evidence: candidate.corroboratingEvidence,
    entityScope: candidate.entityScope,
    predecessorVersion: candidate.predecessorVersion,
    expectedPredecessorVersion: candidate.expectedPredecessorVersion,
    createdAt: candidate.createdAt,
    now: candidate.now,
  });

  if (gate.decision === 'COMMIT') {
    return {
      status: 'VERIFIED_ELIGIBLE',
      reasons: ['COMMUNITY_CLAIM_INDEPENDENTLY_VERIFIED', ...gate.reasons],
      independentPublisherGroups: groups.length,
      gate,
      provenance,
    };
  }

  return {
    status: gate.decision === 'REJECT' ? 'REJECT' : 'QUARANTINE',
    reasons: gate.reasons,
    independentPublisherGroups: groups.length,
    gate,
    provenance,
  };
}
