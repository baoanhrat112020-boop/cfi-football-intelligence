import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import YAML from 'yaml';

const workflow=YAML.parse(fs.readFileSync('.github/workflows/cfi-final-production-e2e.yml','utf8'));
const script=workflow.jobs['practical-acceptance'].steps.find(s=>s.name==='Run supplied-fixture production acceptance').run;
const validator=script.match(/node - "\$REQUEST" "\$BODY" <<'NODE'\n([\s\S]*?)\nNODE/)[1];
function fixture(){
  const supplied=Array.from({length:5},(_,i)=>({providerId:String(i),provider:'TEST',home:`Home ${i}`,away:`Away ${i}`}));
  return{request:{max_matches:5,fixture_candidates:supplied},body:{
    status:'OK',search:{mode:'SUPPLIED_FIXTURE_ONLY',suppliedFixtureOnly:true,externalAcquisitionAllowed:false,canonicalFeedMerged:false,workerProviderFallbackAllowed:false,aiCandidatesReceived:5,aiCandidatesAccepted:5,aiCandidatesRejected:[]},
    rules:{providerFallbackOnShortfall:false,noForcedFive:true},providerAttempts:[],
    counts:{fixturesDiscovered:5,predictionAttempts:5,predictionSuccess:5,fullPredictionsExecuted:5},
    board:supplied.map(r=>({...r,strictPrior:true,multiMarketDecisionUse:false,prediction:{status:'SUCCESS',strictPrior:{verified:true},sixTargetMatrix:{verification:{complete:true}},consistencyGuard:{status:'PASS'}}}))
  }};
}
function run(t,data){
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'cfi-acceptance-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const request=path.join(cwd,'request.json'),body=path.join(cwd,'body.json');
  fs.writeFileSync(request,JSON.stringify(data.request));fs.writeFileSync(body,JSON.stringify(data.body));
  return spawnSync(process.execPath,['-',request,body],{input:validator,encoding:'utf8'});
}
test('five complete strict-prior outputs pass the production acceptance gate',t=>{
  const r=run(t,fixture());assert.equal(r.status,0,r.stdout+r.stderr);
});
test('zero executed predictions cannot pass on valid discovery bookkeeping',t=>{
  const f=fixture();f.body.board=[];f.body.counts.predictionSuccess=0;f.body.counts.fullPredictionsExecuted=0;
  assert.equal(run(t,f).status,1);
});
test('duplicate board rows cannot stand in for five distinct predictions',t=>{
  const f=fixture();f.body.board[4]=f.body.board[0];assert.equal(run(t,f).status,1);
});
test('a row without a complete prediction cannot pass',t=>{
  const f=fixture();delete f.body.board[0].prediction;assert.equal(run(t,f).status,1);
});
test('partial six-target output cannot pass',t=>{
  const f=fixture();f.body.board[0].prediction.sixTargetMatrix.verification.complete=false;assert.equal(run(t,f).status,1);
});
test('acquisition shortfalls exit nonzero instead of green workflow success',()=>{
  for(const reason of ['CFI_DB_KEY_UNAVAILABLE_FOR_ACQUISITION','ACQUISITION_FEED_UNAVAILABLE','NO_AUDITABLE_CANDIDATES_TODAY']){
    const block=script.slice(script.indexOf(reason)).split('\nfi')[0];
    assert.match(block,/exit [1-9]/);assert.doesNotMatch(block,/exit 0/);
  }
});
