import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT,
  runK038StationarityRetrieval,
  runK039AnchoredRouting,
  partitionK040Evidence,
  buildK040ErrorCorrelation,
  auditK040IdenticalEvidence,
  buildRealChallengerEvaluation,
  evaluateRealCandidateRows,
} from '../research/knowledge-candidate-runners.mjs';

const dates={targetDate:'2026-08-19',maxEvidenceDate:'2026-08-18'};
const markets=['3+ HT','7+ FT','Other HT','Other FT'];
const p=(base)=>Object.fromEntries(markets.map((m,i)=>[m,Math.max(.01,Math.min(.99,base-i*.03))]));

test('candidate runner contract is research-only and R0 immutable',()=>{
  assert.equal(KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT.researchOnly,true);
  assert.equal(KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT.baselineLock,'R0_IMMUTABLE');
  assert.equal(KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT.productionMutationAllowed,false);
  assert.equal(KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT.canonicalDbMutationAllowed,false);
  assert.equal(KNOWLEDGE_CANDIDATE_RUNNER_CONTRACT.syntheticEvaluationAllowed,false);
});

test('K038 produces paired similarity baseline and deterministic stationarity ranking',()=>{
  const candidates=[
    {id:'a',similarity:.95,stationarityScore:.20},
    {id:'b',similarity:.80,stationarityScore:.95},
    {id:'c',similarity:.70,stationarityScore:.70},
  ];
  const a=runK038StationarityRetrieval({...dates,candidates});
  const b=runK038StationarityRetrieval({...dates,candidates:[...candidates].reverse()});
  assert.equal(a.artifact.pairedSimilarityBaseline[0].id,'a');
  assert.equal(a.artifact.challengerRanking[0].id,'b');
  assert.deepEqual(a.artifact.challengerRanking,b.artifact.challengerRanking);
  assert.equal(a.productionEligible,false);
  assert.equal(a.baselineLock,'R0_IMMUTABLE');
});

test('K038 fails closed on same-date evidence',()=>{
  assert.throws(()=>runK038StationarityRetrieval({targetDate:'2026-08-19',maxEvidenceDate:'2026-08-19',candidates:[{id:'a',similarity:.8,stationarityScore:.8},{id:'b',similarity:.7,stationarityScore:.7}]}),/STRICT_PRIOR_FAILURE/);
});

test('K039 anchored routing is deterministic and carries fixed-ensemble paired baseline',()=>{
  const experts=[
    {expert:'REGIME',anchorWeight:.6,regimeFit:.9,probabilities:p(.70)},
    {expert:'MATCH_DNA',anchorWeight:.3,regimeFit:.7,probabilities:p(.55)},
    {expert:'FUTURE_SIX',anchorWeight:.1,regimeFit:.5,probabilities:p(.40)},
  ];
  const a=runK039AnchoredRouting({...dates,regimeDescriptor:{segment:'WOMEN'},experts});
  const b=runK039AnchoredRouting({...dates,regimeDescriptor:{segment:'WOMEN'},experts:[...experts].reverse()});
  assert.ok(Math.abs(a.artifact.routingStability.weightSum-1)<1e-12);
  assert.deepEqual(a.artifact.anchoredWeights,b.artifact.anchoredWeights);
  assert.deepEqual(a.artifact.challenger.probabilities,b.artifact.challenger.probabilities);
  assert.equal(Object.keys(a.artifact.fixedEnsembleBaseline.weights).length,3);
  assert.equal(a.productionEligible,false);
});

test('K039 rejects incomplete expert probabilities',()=>{
  assert.throws(()=>runK039AnchoredRouting({...dates,experts:[{expert:'A',anchorWeight:.5,regimeFit:.5,probabilities:p(.5)},{expert:'B',anchorWeight:.5,regimeFit:.5,probabilities:{'3+ HT':.5}}]}),/K039_INVALID_PROBABILITY/);
});

test('K040 strict-prior evidence partition is deterministic and disjoint',()=>{
  const evidence=[
    {evidenceId:'e4',maxEvidenceDate:'2026-08-18'},
    {evidenceId:'e1',maxEvidenceDate:'2026-08-17'},
    {evidenceId:'e3',maxEvidenceDate:'2026-08-18'},
    {evidenceId:'e2',maxEvidenceDate:'2026-08-16'},
  ];
  const a=partitionK040Evidence({...dates,evidence,agentCount:2});
  const b=partitionK040Evidence({...dates,evidence:[...evidence].reverse(),agentCount:2});
  assert.deepEqual(a.artifact.partitions,b.artifact.partitions);
  const ids=a.artifact.partitions.flatMap(x=>x.evidenceIds);
  assert.equal(new Set(ids).size,ids.length);
  assert.equal(a.artifact.disjoint,true);
  assert.equal(a.productionEligible,false);
});

test('K040 identical-evidence ablation catches cross-agent overlap',()=>{
  const audit=auditK040IdenticalEvidence([
    {agent:'A',evidenceIds:['e1','e2']},
    {agent:'B',evidenceIds:['e2','e3']},
  ]);
  assert.equal(audit.pass,false);
  assert.equal(audit.identicalEvidenceDetected,true);
  assert.deepEqual(audit.hardFailures,['K040_IDENTICAL_EVIDENCE_ABLATION_FAIL']);
});

test('K040 error-correlation matrix uses supplied error vectors only',()=>{
  const x=buildK040ErrorCorrelation({A:[1,0,-1,.5],B:[.5,0,-.5,.25],C:[-1,0,1,-.5]});
  assert.equal(x.sampleCount,4);
  assert.equal(x.matrix.A.A,1);
  assert.ok(x.matrix.A.B>.99);
  assert.ok(x.matrix.A.C<-.99);
  assert.equal(x.productionEligible,false);
});

test('real challenger evaluation refuses synthetic, reconstructed, invalid, or leaking rows',()=>{
  const base={experimentCode:'K038-STATIONARITY-RETRIEVAL',fixtureId:'fixture-1',...dates,probabilities:p(.6),outcomes:Object.fromEntries(markets.map((m,i)=>[m,i%2]))};
  assert.throws(()=>buildRealChallengerEvaluation({...base,synthetic:true}),/REAL_STRICT_PRIOR_EVALUATION_REQUIRED/);
  assert.throws(()=>buildRealChallengerEvaluation({...base,reconstructed:true}),/REAL_STRICT_PRIOR_EVALUATION_REQUIRED/);
  assert.throws(()=>buildRealChallengerEvaluation({...base,maxEvidenceDate:base.targetDate}),/STRICT_PRIOR_FAILURE/);
  assert.throws(()=>buildRealChallengerEvaluation({...base,probabilities:{...base.probabilities,'7+ FT':1.2}}),/INVALID_PROBABILITY/);
  const row=buildRealChallengerEvaluation(base);
  assert.equal(row.reconstructed,false);
  assert.equal(row.replayedPredictionHistory,false);
  assert.equal(row.productionEligible,false);
});

test('candidate promotion evaluator remains fail-closed without real rows',()=>{
  const result=evaluateRealCandidateRows([]);
  assert.equal(result.status,'FAIL_HARD_GATE');
  assert.equal(result.shadowEligible,false);
  assert.equal(result.productionEligible,false);
  assert.deepEqual(result.hardFailures,['INSUFFICIENT_REAL_EVIDENCE']);
});
