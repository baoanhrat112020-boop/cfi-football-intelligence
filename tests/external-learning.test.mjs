import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExternalLearningCandidate } from '../src/learning/external-learning.ts';

const scope={homeTeamId:'A',awayTeamId:'B',competitionId:'L1',season:'2026'};
const community={id:'c1',network:'CREWAI',publisherGroup:'crewai-community',trust:'LOW',verified:false};
const ev=(id,group,trust='HIGH')=>({id,sourceType:'VERIFIED_SECONDARY',trust,verified:true,entityScope:scope,publisherGroup:group});

function base(){
  return {
    id:'lesson-1',lessonType:'agent-reliability',claim:'Independent verification should precede persistent learning.',
    entityScope:scope,communitySource:community,
    corroboratingEvidence:[],corroboratingPublisherGroups:[],
  };
}

test('community-only knowledge remains quarantined',()=>{
  const out=evaluateExternalLearningCandidate(base());
  assert.equal(out.status,'QUARANTINE');
  assert.ok(out.reasons.includes('INSUFFICIENT_INDEPENDENT_CORROBORATION'));
});

test('one publisher group is insufficient even with multiple mirrors',()=>{
  const c=base();
  c.corroboratingEvidence=[ev('e1','paper-a'),ev('e2','paper-a')];
  c.corroboratingPublisherGroups=['paper-a','paper-a'];
  const out=evaluateExternalLearningCandidate(c);
  assert.equal(out.status,'QUARANTINE');
  assert.equal(out.independentPublisherGroups,1);
});

test('two independent verified publisher groups can become eligible',()=>{
  const c=base();
  c.corroboratingEvidence=[ev('e1','paper-a'),ev('e2','docs-b')];
  c.corroboratingPublisherGroups=['paper-a','docs-b'];
  const out=evaluateExternalLearningCandidate(c);
  assert.equal(out.status,'VERIFIED_ELIGIBLE');
  assert.equal(out.gate.decision,'COMMIT');
  assert.deepEqual(out.provenance.evidenceIds,['e1','e2']);
});

test('unresolved contradictions reject promotion',()=>{
  const c=base();
  c.contradicted=true;
  c.corroboratingEvidence=[ev('e1','paper-a'),ev('e2','docs-b')];
  c.corroboratingPublisherGroups=['paper-a','docs-b'];
  const out=evaluateExternalLearningCandidate(c);
  assert.equal(out.status,'REJECT');
  assert.ok(out.reasons.includes('UNRESOLVED_CONTRADICTION'));
});

test('unverified corroborating evidence stays quarantined',()=>{
  const c=base();
  c.corroboratingEvidence=[ev('e1','paper-a'),{...ev('e2','docs-b'),verified:false}];
  c.corroboratingPublisherGroups=['paper-a','docs-b'];
  const out=evaluateExternalLearningCandidate(c);
  assert.equal(out.status,'QUARANTINE');
  assert.ok(out.reasons.includes('UNVERIFIED_CORROBORATING_EVIDENCE'));
});
