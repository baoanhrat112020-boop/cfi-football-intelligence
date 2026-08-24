import test from 'node:test';
import assert from 'node:assert/strict';
import {buildK048TrajectoryEnsemble,probabilityOfPathEvent,K048_CONTRACT} from '../research/trajectory-joint-forecast.mjs';

const base={targetDate:'2026-08-24',maxEvidenceDate:'2026-08-23',htMarginal:[{score:'0-0',probability:.55},{score:'1-0',probability:.25},{score:'0-1',probability:.20}],ftMarginal:[{score:'1-0',probability:.30},{score:'1-1',probability:.30},{score:'2-0',probability:.20},{score:'0-1',probability:.20}]};

test('K048 is research-only and R0 immutable',()=>{assert.equal(K048_CONTRACT.researchOnly,true);assert.equal(K048_CONTRACT.decisionUse,false);assert.equal(K048_CONTRACT.baselineLock,'R0_IMMUTABLE');assert.equal(K048_CONTRACT.productionMutationAllowed,false);});

test('K048 preserves supplied HT and FT marginals over valid score trajectories',()=>{const x=buildK048TrajectoryEnsemble(base);assert.equal(x.marginalAudit.status,'PASS');assert.ok(x.marginalAudit.htMaxAbsError<1e-7);assert.ok(x.marginalAudit.ftMaxAbsError<1e-7);assert.ok(x.trajectories.every(t=>{const [hh,ha]=t.ht.split('-').map(Number),[fh,fa]=t.ft.split('-').map(Number);return fh>=hh&&fa>=ha;}));const z=x.trajectories.reduce((s,t)=>s+t.probability,0);assert.ok(Math.abs(z-1)<1e-7);});

test('K048 path event probability is computed from joint trajectories rather than marginal multiplication',()=>{const x=buildK048TrajectoryEnsemble(base);const p=probabilityOfPathEvent(x,t=>t.ht==='0-0'&&t.ft==='1-1');assert.ok(p>=0&&p<=1);const naive=.55*.30;assert.notEqual(Number(p.toFixed(10)),Number(naive.toFixed(10)));});

test('K048 fails closed on same-date evidence',()=>{assert.throws(()=>buildK048TrajectoryEnsemble({...base,maxEvidenceDate:base.targetDate}),/STRICT_PRIOR_FAILURE/);});

test('K048 fails when score support cannot represent temporal goal monotonicity',()=>{assert.throws(()=>buildK048TrajectoryEnsemble({...base,htMarginal:[{score:'3-0',probability:1}],ftMarginal:[{score:'1-0',probability:1}]}),/K048_INFEASIBLE_HT_SUPPORT/);});
