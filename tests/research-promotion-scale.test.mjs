import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveTemporalStability, evaluateRun } from '../research/promotion-gate.mjs';

const market='3+ HT';
const mk=(p,y,i,year=2025)=>({
  targetTimestamp:`${year}-01-${String((i%20)+1).padStart(2,'0')}T12:00:00Z`,
  maxEvidenceTimestamp:`${year}-01-${String((i%20)+1).padStart(2,'0')}T00:00:00Z`,
  probabilities:{[market]:p,'7+ FT':p,'Other HT':p,'Other FT':p},
  actual:{[market]:y,'7+ FT':y,'Other HT':y,'Other FT':y},
  top3HT:['__ACTUAL__','x','y'],top3FT:['__ACTUAL__','x','y'],actualScore:{ht:'__ACTUAL__',ft:'__ACTUAL__'}
});

test('rank AUC preserves tie-aware Mann-Whitney semantics',()=>{
  const rows=[mk(.9,1,1),mk(.8,1,2),mk(.8,0,3),mk(.1,0,4)];
  const r=evaluateRun(rows,{markets:[market],stability:1,robustness:1});
  assert.equal(r.metrics.auc,0.875);
});

test('temporal stability is measured from year windows, not assumed perfect',()=>{
  const rows=[];
  for(let i=0;i<25;i++) rows.push(mk(i%2?.9:.1,i%2?1:0,i,2024));
  for(let i=0;i<25;i++) rows.push(mk(.5,i%2?1:0,i,2025));
  const s=deriveTemporalStability(rows,[market],{minRowsPerWindow:20,driftScale:.10});
  assert.equal(s.windows.length,2);
  assert.ok(s.score<1);
  assert.ok(s.score>=0);
});
