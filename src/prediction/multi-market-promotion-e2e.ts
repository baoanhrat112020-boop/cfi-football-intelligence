import { evaluateMultiMarketPromotionV2, type PromotionInput } from './multi-market-promotion-v2.ts';
import { evaluateSegmentRegression, type SegmentMetric, type SegmentRegressionOptions } from './multi-market-segment-regression.ts';

export function evaluateMultiMarketPromotionE2E(input:PromotionInput,segments:SegmentMetric[],options:SegmentRegressionOptions={}){
  const segmentGate=evaluateSegmentRegression(segments,options);
  const promotion=evaluateMultiMarketPromotionV2({...input,segmentWorstBrierDelta:segmentGate.worstBaselineDelta});
  const hardFailures=[...promotion.hardFailures,...segmentGate.hardFailures.map(x=>`SEGMENT_GATE:${x}`)];
  const shadowEligible=promotion.shadowEligible&&segmentGate.status==='PASS'&&hardFailures.length===0;
  return{
    version:'CFI_MULTI_MARKET_PROMOTION_E2E_V1',
    market:input.market,
    baselineLock:'R0_IMMUTABLE',
    decisionUse:false,
    productionEligible:false,
    shadowEligible,
    score:promotion.score,
    promotionGate:promotion,
    segmentGate,
    hardFailures:[...new Set(hardFailures)],
  };
}
