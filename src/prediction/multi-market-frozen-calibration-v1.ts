import type { MulticlassCalibrator,BinaryCalibrator } from './multi-market-calibration.ts';
export const MULTI_MARKET_CALIBRATION_VERSION='CFI_MULTI_MARKET_FROZEN_CAL_V1';
export const MULTI_MARKET_CALIBRATION_PROTOCOL={trainThrough:'2024-12-31',validationYear:2025,refitThrough:'2025-12-31',holdoutYear:2026,decisionUse:false,status:'SHADOW_RESEARCH'} as const;
const platt=(a:number,b:number):BinaryCalibrator=>({method:'PLATT',a,b});
export const FROZEN_1X2={
 ft:{method:'PLATT',classes:{home:platt(.9932605647,.2628253689),draw:platt(.6510983643,-.3252062781),away:platt(1.0506349428,-.3108767501)},selection:{trainThrough:'2024-12-31',validationYear:2025,refitThrough:'2025-12-31',validationMetrics:{n:6714,brier:.20815902,logLoss:1.03983838}}} as MulticlassCalibrator,
 ht:{method:'PLATT',classes:{home:platt(.4981498450,-.2099178492),draw:platt(.2532001337,-.2923033928),away:platt(.5732994259,-.5552402814)},selection:{trainThrough:'2024-12-31',validationYear:2025,refitThrough:'2025-12-31',validationMetrics:{n:6714,brier:.21599893,logLoss:1.06888027}}} as MulticlassCalibrator,
} as const;
export const FROZEN_FT_AH:Record<string,{home:BinaryCalibrator;away:BinaryCalibrator}>={
 '-1.5':{home:platt(.8927172843,.0925417308),away:platt(.8927172843,-.0925417308)},
 '-0.5':{home:platt(.9726777323,.2569567754),away:platt(.9726777323,-.2569567754)},
 '0.5':{home:platt(1.0228027625,.3284210767),away:platt(1.0228027625,-.3284210767)},
 '1.5':{home:platt(1.0102554187,.3621547678),away:platt(1.0102554187,-.3621547678)},
};
// Historical/2026-holdout evidence is sufficient to admit these markets to a
// prospective locked live shadow trial, but NOT to the hard promotion state.
// PROMOTION_CANDIDATE requires the additional locked OOS gate to pass.
export const LOCKED_LIVE_TRIAL_CANDIDATES=['FT_1X2','HT_1X2','FT_AH_HALF_LINES'] as const;
