import { buildPrediction } from "./final-engine.ts";
import { buildFutureSixPrediction } from "./future-six.ts";

export const PARALLEL_ENGINE_VERSION = "CFI_PARALLEL_V0.1";

export function buildParallelPrediction(args: {
  home: string;
  away: string;
  targetDate?: string;
  language?: string;
  homePayload: unknown;
  awayPayload: unknown;
  h2hPayload: unknown;
}) {
  const legacy = buildPrediction(args);
  const futureSix = buildFutureSixPrediction(args);

  return {
    engine: PARALLEL_ENGINE_VERSION,
    executionMode: "PARALLEL",
    primaryModel: {
      predictionType: "HISTORICAL_PRODUCTION",
      authoritative: true,
      result: legacy,
    },
    challengerModel: {
      predictionType: "FUTURE_SIX_FACTORS",
      authoritative: false,
      result: futureSix,
    },
    comparison: {
      thresholdMarkets: Object.fromEntries(
        Object.entries(futureSix.marketSignals).map(([market, challenger]) => {
          const production = (legacy.markets as Record<string, { final: number }>)[market]?.final ?? null;
          return [market, {
            production,
            futureSix: challenger,
            delta: production === null ? null : challenger - production,
          }];
        }),
      ),
    },
    outputLabels: {
      historical: "DỰ ĐOÁN KIỂU CŨ — HISTORICAL PRODUCTION",
      futureSix: "DỰ ĐOÁN 6 YẾU TỐ TƯƠNG LAI — CHALLENGER",
    },
    safety: {
      productionSnapshotRemainsAuthoritative: true,
      challengerMayOverwriteProduction: false,
      challengerRequiresSettlementBacktestBeforePromotion: true,
    },
  };
}
