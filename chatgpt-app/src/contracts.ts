export const CFI_MARKETS = ['3+ HT','7+ FT','Other HT','Other FT'] as const;
export type CfiMarket = typeof CFI_MARKETS[number];

export const CFI_LANGUAGES = [
  { code: 'vi', label: 'Tiếng Việt' },
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
  { code: 'th', label: 'ไทย' },
  { code: 'id', label: 'Bahasa Indonesia' },
] as const;
export type CfiLanguageCode = typeof CFI_LANGUAGES[number]['code'];

export interface StrategyResult { name: string; probability: number; brier?: number; }
export interface MarketPrediction {
  market: CfiMarket;
  optionA: StrategyResult;
  optionB: StrategyResult;
  selected: 'A'|'B'|'BLEND';
  finalProbability: number;
  uncertaintyLow: number;
  uncertaintyHigh: number;
  contextAdjustment: number;
}

export interface ScorelineCandidate {
  score: string;
  probability: number;
}

export interface ScorelineForecast {
  ht: ScorelineCandidate[];
  ft: ScorelineCandidate[];
  mostLikelyPath?: string;
  uncertainty?: 'LOW'|'MEDIUM'|'HIGH'|string;
  consistencyWarnings?: string[];
}

export interface CfiContextFactors {
  historicalDatabase?: string;
  teamTrendingDNA?: string;
  homeAwayForm?: string;
  h2h?: string;
  standingsOpponentStrength?: string;
  goalTimingProfile?: string;
  leadingTrailingBehavior?: string;
  collapseDNA?: string;
  opponentSurge?: string;
  restFatigue?: string;
  motivation?: string;
  styleMatchup?: string;
  goalkeeperDefensiveStability?: string;
  startingXIContinuity?: string;
  liveMomentum?: string;
  scorelinePressure?: string;
  refereeVolatility?: string;
  weatherPitch?: string;
  randomnessAllowance?: string;
  redCardIntelligence?: string;
}

export interface CfiPredictionResponse {
  homeTeam: string;
  awayTeam: string;
  targetDate?: string;
  language: CfiLanguageCode | string;
  dataQuality: 'GOOD'|'PARTIAL'|'INSUFFICIENT';
  predictions: MarketPrediction[];
  scoreline?: ScorelineForecast;
  trends?: { home: string[]; away: string[] };
  contextSummary?: string[];
  contextFactors?: CfiContextFactors;
  redCardAlert?: { active: boolean; message: string; collapseRisk?: number; opponentSurgeRisk?: number };
}

export const CFI_TOOLS = {
  predict: 'cfi_predict_match',
  teamHistory: 'cfi_team_history',
  h2h: 'cfi_h2h',
  dbStatus: 'cfi_db_status',
  liveEvent: 'cfi_live_event',
} as const;
