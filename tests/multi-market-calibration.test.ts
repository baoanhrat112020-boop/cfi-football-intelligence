import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBinaryCalibrator, applyMulticlassCalibrator, evaluateFrozenBinaryOnYear, evaluateFrozenMulticlassOnYear, selectAndFreezeBinaryCalibration, selectAndFreezeMulticlassCalibration, type BinaryPoint, type MultiClassPoint } from '../src/prediction/multi-market-calibration.ts';

function binaryPoints():BinaryPoint[]{
  const out:BinaryPoint[]=[];
  for(const year of [2023,2024,2025,2026])for(let i=0;i<160;i++){
    const latent=(i%20)/19;
    const y:(0|1)=((i*7+year)%20)/19<latent?1:0;
    const raw=Math.min(.98,Math.max(.02,.12+.72*latent));
    out.push({date:`${year}-06-${String((i%28)+1).padStart(2,'0')}`,p:raw,y});
  }
  return out;
}
function multiclassPoints():MultiClassPoint[]{
  const out:MultiClassPoint[]=[];
  for(const year of [2023,2024,2025,2026])for(let i=0;i<240;i++){
    const y=(i%3===0?'home':i%3===1?'draw':'away') as 'home'|'draw'|'away';
    const p=y==='home'?{home:.62,draw:.23,away:.15}:y==='draw'?{home:.28,draw:.44,away:.28}:{home:.16,draw:.24,away:.60};
    out.push({date:`${year}-07-${String((i%28)+1).padStart(2,'0')}`,p,y});
  }
  return out;
}

test('binary calibration selects on 2025 and freezes before evaluating 2026',()=>{
  const points=binaryPoints();
  const fitted=selectAndFreezeBinaryCalibration(points,2025);
  assert.equal(fitted.selection.trainThrough,'2024-12-31');
  assert.equal(fitted.selection.validationYear,2025);
  assert.equal(fitted.selection.refitThrough,'2025-12-31');
  const before=JSON.stringify(fitted.frozen);
  const report=evaluateFrozenBinaryOnYear(points,fitted.frozen,2026);
  assert.equal(JSON.stringify(fitted.frozen),before);
  assert.equal(report.raw.n,160);
  assert.equal(report.calibrated.n,160);
  assert.ok((report.calibrated.logLoss??Infinity)>=0);
  for(const p of [.001,.1,.5,.9,.999])assert.ok(applyBinaryCalibrator(fitted.frozen,p)>0&&applyBinaryCalibrator(fitted.frozen,p)<1);
});

test('2026 labels cannot influence frozen binary transform',()=>{
  const points=binaryPoints();
  const a=selectAndFreezeBinaryCalibration(points,2025);
  const mutated=points.map(r=>r.date.startsWith('2026-')?{...r,y:(r.y?0:1) as 0|1}:r);
  const b=selectAndFreezeBinaryCalibration(mutated,2025);
  assert.deepEqual(a.frozen,b.frozen);
  assert.equal(a.method,b.method);
});

test('multiclass calibration renormalizes to one and never fits on 2026',()=>{
  const points=multiclassPoints();
  const fitted=selectAndFreezeMulticlassCalibration(points,2025);
  assert.equal(fitted.selection.trainThrough,'2024-12-31');
  assert.equal(fitted.selection.refitThrough,'2025-12-31');
  const changed=points.map(r=>r.date.startsWith('2026-')?{...r,y:(r.y==='home'?'away':'home') as 'home'|'draw'|'away'}:r);
  const refit=selectAndFreezeMulticlassCalibration(changed,2025);
  assert.deepEqual(fitted.classes,refit.classes);
  const p=applyMulticlassCalibrator(fitted,{home:.55,draw:.27,away:.18});
  assert.ok(Math.abs(p.home+p.draw+p.away-1)<1e-12);
  const report=evaluateFrozenMulticlassOnYear(points,fitted,2026);
  assert.equal(report.raw.n,240);
  assert.equal(report.calibrated.n,240);
});
