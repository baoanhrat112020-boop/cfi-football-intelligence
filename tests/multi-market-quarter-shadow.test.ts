import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiMarketV1 } from '../src/prediction/multi-market-v1.ts';
import { quarterMetrics,quarterStateFromDifference } from '../src/prediction/multi-market-quarter-evaluation.ts';
import { lockMultiMarketShadow,verifyLockedShadow } from '../src/prediction/multi-market-live-shadow.ts';
import { FROZEN_1X2,FROZEN_FT_AH,MULTI_MARKET_CALIBRATION_PROTOCOL } from '../src/prediction/multi-market-frozen-calibration-v1.ts';
import { applyMulticlassCalibrator,applyBinaryCalibrator } from '../src/prediction/multi-market-calibration.ts';

test('quarter line evaluation uses five settlement states',()=>{
 assert.equal(quarterStateFromDifference(0,-.25),'HALF_LOSS');
 assert.equal(quarterStateFromDifference(1,-.25),'FULL_WIN');
 const mm=buildMultiMarketV1({htHome:.9,htAway:.8,ftHome:1.7,ftAway:1.2});
 const p=mm.asianHandicap.ft['-0.25'].home;
 const m=quarterMetrics([{p,y:'HALF_LOSS'}]);
 assert.equal(m.n,1);assert.ok(Number.isFinite(m.brier));assert.ok(Number.isFinite(m.logLoss));
});

test('frozen calibration is pre-2026 and remains shadow-only',()=>{
 assert.equal(MULTI_MARKET_CALIBRATION_PROTOCOL.refitThrough,'2025-12-31');
 assert.equal(MULTI_MARKET_CALIBRATION_PROTOCOL.holdoutYear,2026);
 assert.equal(MULTI_MARKET_CALIBRATION_PROTOCOL.decisionUse,false);
 const p=applyMulticlassCalibrator(FROZEN_1X2.ft,{home:.4,draw:.25,away:.35});
 assert.ok(Math.abs(p.home+p.draw+p.away-1)<1e-9);
 assert.ok(applyBinaryCalibrator(FROZEN_FT_AH['-0.5'].home,.4)>0&&applyBinaryCalibrator(FROZEN_FT_AH['-0.5'].home,.4)<1);
});

test('live shadow snapshot is immutable by fingerprint and never decision-use',()=>{
 const x=lockMultiMarketShadow({fixtureId:'fx1',targetDate:'2026-08-24',createdAt:'2026-08-23T23:00:00Z',modelVersion:'CFI_MULTI_MARKET_V1',payload:{p:.61}});
 assert.equal(x.decisionUse,false);assert.equal(verifyLockedShadow(x),true);
 const tampered={...x,payload:{p:.62}};
 assert.equal(verifyLockedShadow(tampered),false);
});
