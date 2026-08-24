import test from 'node:test';
import assert from 'node:assert/strict';
import {buildK048TrajectoryEnsemble,buildK048ClosedSupportInput,buildClosedPoissonScoreMarginal,bucketScoreToClosedSupport,probabilityOfPathEvent,K048_CONTRACT} from '../research/trajectory-joint-forecast.mjs';

const base={targetDate:'2026-08-24',maxEvidenceDate:'2026-08-23',htMarginal:[{score:'0-0',probability:.55},{score:'1-0',probability:.25},{score:'0-1',probability:.20}],ftMarginal:[{score:'1-0',probability:.30},{score:'1-1',probability:.30},{score:'2-0',probability:.20},{score:'0-1',probability:.20}]};

test('K048 is research-only and R0 immutable',()=>{assert.equal(K048_CONTRACT.researchOnly,true);assert.equal(K048_CONTRACT.decisionUse,false);assert.equal(K048_CONTRACT.baselineLock,'R0_IMMUTABLE');assert.equal(K048_CONTRACT.productionMutationAllowed,false);assert.equal(K048_CONTRACT.closedSupportRequired,true);});

test('K048 preserves supplied HT and FT marginals over valid score trajectories',()=>{const x=buildK048TrajectoryEnsemble(base);assert.equal(x.marginalAudit.status,'PASS');assert.ok(x.marginalAudit.htMaxAbsError<1e-7);assert.ok(x.marginalAudit.ftMaxAbsError<1e-7);assert.ok(x.trajectories.every(t=>{const clean=s=>Number(String(s).replace('+',''));const [hh,ha]=t.ht.split('-').map(clean),[fh,fa]=t.ft.split('-').map(clean);return fh>=hh&&fa>=ha;}));const z=x.trajectories.reduce((s,t)=>s+t.probability,0);assert.ok(Math.abs(z-1)<1e-7);});

test('K048 path event probability is computed from joint trajectories rather than marginal multiplication',()=>{const x=buildK048TrajectoryEnsemble(base);const p=probabilityOfPathEvent(x,t=>t.ht==='0-0'&&t.ft==='1-1');assert.ok(p>=0&&p<=1);const naive=.55*.30;assert.notEqual(Number(p.toFixed(10)),Number(naive.toFixed(10)));});

test('K048 fails closed on same-date evidence',()=>{assert.throws(()=>buildK048TrajectoryEnsemble({...base,maxEvidenceDate:base.targetDate}),/STRICT_PRIOR_FAILURE/);});

test('K048 fails when score support cannot represent temporal goal monotonicity',()=>{assert.throws(()=>buildK048TrajectoryEnsemble({...base,htMarginal:[{score:'3-0',probability:1}],ftMarginal:[{score:'1-0',probability:1}]}),/K048_INFEASIBLE_HT_SUPPORT/);});

test('closed Poisson score marginal preserves total probability with overflow buckets',()=>{const x=buildClosedPoissonScoreMarginal({homeLambda:1.4,awayLambda:1.1,cap:6});assert.ok(x.some(r=>r.score.includes('+')));assert.ok(Math.abs(x.reduce((s,r)=>s+r.probability,0)-1)<1e-12);assert.ok(x.every(r=>r.probability>=0));});

test('actual score mapping cannot fall outside closed support',()=>{assert.equal(bucketScoreToClosedSupport('2-3',6),'2-3');assert.equal(bucketScoreToClosedSupport('8-1',6),'6+-1');assert.equal(bucketScoreToClosedSupport('8-9',6),'6+-6+');});

test('K048 closed-support input produces overflow-aware joint support without zeroing valid extreme actual scores',()=>{const input=buildK048ClosedSupportInput({targetDate:'2026-08-25',maxEvidenceDate:'2026-08-24',htExpectedGoals:{home:.7,away:.6},ftExpectedGoals:{home:1.5,away:1.3},htCap:5,ftCap:7});const x=buildK048TrajectoryEnsemble(input);assert.equal(x.supportAudit.closed,true);const ht=bucketScoreToClosedSupport('6-0',5),ft=bucketScoreToClosedSupport('8-1',7);const p=probabilityOfPathEvent(x,t=>t.ht===ht&&t.ft===ft);assert.ok(p>0);assert.equal(x.contract.decisionUse,false);assert.equal(x.baselineLock,'R0_IMMUTABLE');});
