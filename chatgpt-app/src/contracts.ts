export const CFI_MARKETS = ['3+ HT','7+ FT','Other HT','Other FT'] as const;
export type CfiMarket = typeof CFI_MARKETS[number];

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
export interface CfiPredictionResponse {
  homeTeam: string;
  awayTeam: string;
  targetDate?: string;
  language: string;
  dataQuality: 'GOOD'|'PARTIAL'|'INSUFFICIENT';
  predictions: MarketPrediction[];
  trends?: { home: string[]; away: string[] };
  contextSummary?: string[];
  redCardAlert?: { active: boolean; message: string; collapseRisk?: number; opponentSurgeRisk?: number };
}

export const CFI_TOOLS = {
  predict: 'cfi_predict_match',
  teamHistory: 'cfi_team_history',
  h2h: 'cfi_h2h',
  dbStatus: 'cfi_db_status',
  liveEvent: 'cfi_live_event',
} as const;
