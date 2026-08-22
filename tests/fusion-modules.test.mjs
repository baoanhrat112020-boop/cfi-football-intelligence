import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpertCouncil } from '../research/fusion/experts.mjs';
import { buildTemporalCalibrator } from '../research/fusion/temporal-calibrator.mjs';
import { validateJointConsistency } from '../research/fusion/joint-consistency.mjs';
import { pairedSubset } from '../research/fusion/fusion-ablation.mjs';

const p={'3+ HT':.1,'7+ FT':.02,'Other HT':.01,'Other FT':.03};

test('expert council canonicalizes all four markets',()=>{
  const x=buildExpertCouncil({futureSix:{probabilities:p},historical:{probabilities:p},dna:{probabilities:p,confidence:{coverage:.8,localSample:80}},regime:{probabilities:p}});
  assert.deepEqual(Object.keys(x.FUTURE_SIX.probabilities),['3+ HT','7+ FT','Other HT','Other FT']);
  assert.equal(x.MATCH_DNA.confidence.localSample,80);
});

test('temporal calibrator never uses same-date or future outcomes',()=>{
  const rows=[];
  for(let i=0;i<150;i++) rows.push({market:'7+ FT',targetDate:'2026-08-20',p:.08,y:i%10===0?1:0});
  for(let i=0;i<150;i++) rows.push({market:'7+ FT',targetDate:'2026-08-22',p:.08,y:1});
  const c=buildTemporalCalibrator(rows,{minRows:100,bins:10});
  const q=c.calibrate('7+ FT',.08,{targetDate:'2026-08-21'});
  assert.ok(q<.2,'future 100% outcomes must not contaminate prior calibration');
  assert.throws(()=>c.calibrate('7+ FT',.08,{}),/CALIBRATION_TARGET_DATE_REQUIRED/);
});

test('joint guard catches impossible HT to FT paths',()=>{
  const x=validateJointConsistency({probabilities:p,paths:[{ht:'2-1',ft:'1-1'}]});
  assert.equal(x.pass,false);
  assert.ok(x.warnings.includes('FT_BELOW_HT_PATH'));
});

test('paired subset compares exact fixture and target timestamp',()=>{
  const ref=[{fixtureId:'a',targetTimestamp:'2026-01-01T00:00:00Z'},{fixtureId:'b',targetTimestamp:'2026-01-02T00:00:00Z'}];
  const ch=[{fixtureId:'b',targetTimestamp:'2026-01-02T00:00:00Z'}];
  assert.deepEqual(pairedSubset(ref,ch),[ref[1]]);
});
