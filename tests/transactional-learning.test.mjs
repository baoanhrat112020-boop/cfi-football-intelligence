import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LEARNING_POLICY_VERSION,
  cascadeInvalidate,
  derivedTrustCannotExceedWeakestSource,
  evaluateLearningProposal,
} from '../src/learning/transactional-learning.ts';

const scope={homeTeamId:'home-1',awayTeamId:'away-1',competitionId:'league-1',season:'2026',gender:'men',ageLevel:'senior',reserveLevel:'first'};
const verified={id:'e1',sourceType:'PRIMARY_SOURCE',trust:'HIGH',verified:true,entityScope:scope};
const base={id:'l1',lessonType:'CALIBRATION',hypothesis:'Verified reusable pattern',evidence:[verified],entityScope:scope,predecessorVersion:'v1',expectedPredecessorVersion:'v1',createdAt:'2026-08-17T00:00:00Z',now:'2026-08-17T01:00:00Z'};

test('verified scoped evidence can COMMIT',()=>{
  const out=evaluateLearningProposal(base);
  assert.equal(out.policyVersion,LEARNING_POLICY_VERSION);
  assert.equal(out.decision,'COMMIT');
  assert.equal(out.reversible,true);
});

test('community/model evidence is quarantined even when claimed high trust',()=>{
  const community={...verified,id:'community',sourceType:'COMMUNITY',trust:'HIGH',verified:false};
  const out=evaluateLearningProposal({...base,evidence:[community]});
  assert.equal(out.decision,'QUARANTINE');
  assert.equal(out.effectiveTrust,'HIGH');
});

test('prediction-derived learning defers until settled outcome is verified',()=>{
  const out=evaluateLearningProposal({...base,settledOutcomeRequired:true,settledOutcomeVerified:false});
  assert.equal(out.decision,'DEFER');
  assert.deepEqual(out.reasons,['SETTLED_OUTCOME_REQUIRED']);
});

test('entity scope mismatch is rejected to prevent senior/youth/reserve contamination',()=>{
  const wrong={...verified,entityScope:{...scope,ageLevel:'U21'}};
  const out=evaluateLearningProposal({...base,evidence:[wrong]});
  assert.equal(out.decision,'REJECT');
  assert.ok(out.reasons.includes('ENTITY_SCOPE_MISMATCH'));
});

test('stale predecessor, duplicate and stale proposal are deterministic rejects',()=>{
  const p={...base,predecessorVersion:'v0',duplicateKey:'same',existingDuplicateKeys:['same'],createdAt:'2026-01-01T00:00:00Z',now:'2026-08-17T00:00:00Z',maxAgeDays:30};
  const a=evaluateLearningProposal(p),b=evaluateLearningProposal(structuredClone(p));
  assert.equal(a.decision,'REJECT');
  assert.deepEqual(a,b);
  assert.ok(a.reasons.includes('PREDECESSOR_MISMATCH'));
  assert.ok(a.reasons.includes('DUPLICATE_PROPOSAL'));
  assert.ok(a.reasons.includes('STALE_PROPOSAL'));
});

test('trust laundering is blocked by weakest-source invariant',()=>{
  const evidence=[verified,{...verified,id:'low',trust:'LOW'}];
  assert.equal(derivedTrustCannotExceedWeakestSource('AUTHORITATIVE',evidence),'LOW');
  assert.equal(derivedTrustCannotExceedWeakestSource('LOW',evidence),'LOW');
});

test('dependency rollback invalidates only affected downstream branch',()=>{
  const graph=[
    {id:'E1',dependsOn:[]},
    {id:'T1',dependsOn:['E1']},
    {id:'M1',dependsOn:['T1']},
    {id:'P1',dependsOn:['M1']},
    {id:'L1',dependsOn:['P1']},
    {id:'E2',dependsOn:[]},
    {id:'P2',dependsOn:['E2']},
  ];
  const out=cascadeInvalidate(graph,['E1']);
  const byId=Object.fromEntries(out.map(x=>[x.id,x.status]));
  for(const id of ['E1','T1','M1','P1','L1']) assert.equal(byId[id],'INVALIDATED');
  assert.equal(byId.E2,'ACTIVE');
  assert.equal(byId.P2,'ACTIVE');
});

test('repeated evaluation remains idempotent across many runs',()=>{
  const first=evaluateLearningProposal(base);
  for(let i=0;i<100;i++) assert.deepEqual(evaluateLearningProposal(structuredClone(base)),first);
});
