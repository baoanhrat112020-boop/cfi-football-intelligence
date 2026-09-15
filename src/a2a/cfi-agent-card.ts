export const CFI_A2A_PROTOCOL_VERSION = '1.0' as const;
export const CFI_AGENT_VERSION = '1.0.0' as const;

export interface CfiAgentCardOptions {
  endpoint: string;
  documentationUrl?: string;
  providerUrl?: string;
  iconUrl?: string;
}

function requireHttpsUrl(value: string, field: string): string {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:') throw new Error(`${field} must use HTTPS`);
  return parsed.toString().replace(/\/$/, '');
}

export function buildCfiAgentCard(options: CfiAgentCardOptions) {
  const endpoint = requireHttpsUrl(options.endpoint, 'endpoint');
  const documentationUrl = requireHttpsUrl(
    options.documentationUrl ?? 'https://huggingface.co/spaces/CFIAI/cfi-football-intelligence',
    'documentationUrl',
  );
  const providerUrl = requireHttpsUrl(
    options.providerUrl ?? 'https://huggingface.co/CFIAI',
    'providerUrl',
  );

  return {
    name: 'CFI - Football Intelligence',
    description:
      'Evidence-driven football intelligence agent for exact team/fixture resolution, canonical historical research, cross-source verification, Match DNA analysis, probabilistic prediction audit, settlement, calibration, and provenance-gated persistent learning.',
    supportedInterfaces: [
      {
        url: endpoint,
        protocolBinding: 'HTTP+JSON',
        protocolVersion: CFI_A2A_PROTOCOL_VERSION,
      },
    ],
    provider: {
      organization: 'CFI Football Intelligence',
      url: providerUrl,
    },
    version: CFI_AGENT_VERSION,
    documentationUrl,
    ...(options.iconUrl ? { iconUrl: requireHttpsUrl(options.iconUrl, 'iconUrl') } : {}),
    capabilities: {
      streaming: false,
      pushNotifications: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ['text/plain', 'application/json'],
    defaultOutputModes: ['text/plain', 'application/json'],
    skills: [
      {
        id: 'football-research',
        name: 'Football Research',
        description:
          'Research exact team identity, fixtures, recent form, H2H, standings and scoring context from available CFI evidence while preserving provenance and unknown fields.',
        tags: ['football', 'research', 'fixtures', 'h2h', 'provenance'],
        examples: [
          'Research the exact fixture Home Team vs Away Team on YYYY-MM-DD.',
          'Return canonical recent form and H2H evidence for these two teams.',
        ],
      },
      {
        id: 'fixture-identity-resolution',
        name: 'Fixture Identity Resolution',
        description:
          'Resolve and validate exact football team and fixture identity, including competition, season, gender, age and reserve scope, and refuse ambiguous merges.',
        tags: ['entity-resolution', 'canonicalization', 'deduplication', 'football-data'],
        examples: [
          'Resolve whether these provider records refer to the same football fixture.',
          'Canonicalize these team aliases without merging senior and youth teams.',
        ],
      },
      {
        id: 'evidence-verification',
        name: 'Evidence Verification',
        description:
          'Cross-check football evidence, preserve source lineage, detect contradictions and duplicate mirrors, and distinguish independent publisher groups.',
        tags: ['verification', 'provenance', 'cross-source', 'data-quality'],
        examples: [
          'Verify this HT/FT result using independent source groups.',
          'Explain conflicts between these fixture records and return a verification verdict.',
        ],
      },
      {
        id: 'match-dna-analysis',
        name: 'Team and Match DNA Analysis',
        description:
          'Build evidence-backed Team Trending DNA and Match DNA summaries for scoring acceleration, defensive collapse, mismatch and high-scoring patterns.',
        tags: ['team-dna', 'match-dna', 'football-analytics', 'patterns'],
        examples: [
          'Build Match DNA for Home Team vs Away Team from verified historical evidence.',
        ],
      },
      {
        id: 'prediction-audit',
        name: 'Prediction Audit',
        description:
          'Produce or audit CFI probabilistic outputs for 3+ HT, 7+ FT, Other HT and Other FT, including Method A/B agreement, uncertainty and Top-3 score scenarios. Never reconstruct a pre-match prediction after the result is known.',
        tags: ['probability', 'prediction', 'calibration', 'audit'],
        examples: [
          'Audit this immutable pre-match CFI prediction for evidence quality and model agreement.',
        ],
      },
      {
        id: 'settlement-calibration',
        name: 'Settlement and Calibration',
        description:
          'Compare immutable pre-match prediction snapshots with independently verified actual outcomes and calculate HIT/MISS, Top-3 accuracy, Brier and calibration diagnostics.',
        tags: ['settlement', 'brier', 'calibration', 'evaluation'],
        examples: [
          'Settle this saved prediction against the verified actual HT/FT result.',
        ],
      },
      {
        id: 'persistent-learning-review',
        name: 'Persistent Learning Review',
        description:
          'Evaluate candidate technical lessons through provenance, independent verification and transactional learning gates. External community content is untrusted by default and cannot directly modify canonical knowledge.',
        tags: ['persistent-learning', 'memory', 'provenance', 'agent-reliability'],
        examples: [
          'Evaluate whether this external agent-community lesson is safe and useful for CFI.',
        ],
      },
    ],
  } as const;
}
