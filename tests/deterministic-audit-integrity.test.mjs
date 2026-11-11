import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

const auditor=path.resolve('tools/cfi-audit.mjs');
function fixture(t){
  const cwd=fs.mkdtempSync(path.join(os.tmpdir(),'cfi-audit-integrity-'));
  t.after(()=>fs.rmSync(cwd,{recursive:true,force:true}));
  const git=(...args)=>{const r=spawnSync('git',args,{cwd,encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
  git('init','-q');
  fs.writeFileSync(path.join(cwd,'.gitignore'),'.cfi-audit/\naudit-reports/\nchecks.log\n');
  fs.writeFileSync(path.join(cwd,'package.json'),JSON.stringify({scripts:{test:'node check.cjs'}}));
  fs.writeFileSync(path.join(cwd,'check.cjs'),"require('node:fs').appendFileSync('checks.log','ran\\n')");
  const commit=()=>{git('add','.');git('-c','user.name=CFI Test','-c','user.email=test@example.invalid','commit','-qm','fixture');};
  const run=(...args)=>spawnSync(process.execPath,[auditor,...args],{cwd,encoding:'utf8',timeout:15000});
  const report=()=>JSON.parse(fs.readFileSync(path.join(cwd,'audit-reports/cfi-audit-latest.json'),'utf8'));
  return{cwd,git,commit,run,report};
}

test('FULL scans unchanged tracked files including paths with spaces',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.cwd,'old snapshot.sql'),'TRUNCATE canonical_fixtures;');
  f.commit();
  fs.writeFileSync(path.join(f.cwd,'README.md'),'second commit');f.commit();
  const r=f.run('--full','--no-cache');
  assert.equal(r.status,1,r.stdout+r.stderr);
  assert.ok(f.report().findings.some(x=>x.file==='old snapshot.sql'&&x.rule==='DESTRUCTIVE_CANONICAL_SQL'));
});

test('FULL reruns checks even after a previous PASS',t=>{
  const f=fixture(t);f.commit();
  assert.equal(f.run('--full').status,0);
  assert.equal(f.run('--full').status,0);
  assert.equal(fs.readFileSync(path.join(f.cwd,'checks.log'),'utf8'),'ran\nran\n');
});

test('FULL cannot pass without the declared test command',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.cwd,'package.json'),'{}');f.commit();
  const r=f.run('--full');assert.equal(r.status,1,r.stdout+r.stderr);
  assert.ok(f.report().checks.some(x=>x.status==='FAIL'&&/test/.test(x.name)));
});

test('FULL cannot silently skip Worker build when Wrangler is missing',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.cwd,'wrangler.json'),'{}');f.commit();
  const r=f.run('--full');assert.equal(r.status,1,r.stdout+r.stderr);
  assert.ok(f.report().checks.some(x=>x.status==='FAIL'&&/wrangler/i.test(x.name)));
});

test('invalid package manifest fails closed',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.cwd,'package.json'),'{');f.commit();
  assert.equal(f.run('--full').status,1);
  assert.ok(f.report().checks.some(x=>x.status==='FAIL'&&/package/.test(x.name)));
});

test('reconstruction rejection guards and crypto hashing are not unsafe operations',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.cwd,'prediction-guard.ts'),"type Row={reconstructed?:boolean;predictionHistoryReplay?:boolean};\nif(r.reconstructed)reasons.push('RECONSTRUCTED_PREDICTION_FORBIDDEN');");
  fs.writeFileSync(path.join(f.cwd,'research-hash.mjs'),"import {createHash} from 'node:crypto';\ncreateHash('sha256').update(JSON.stringify(events)).digest('hex');");
  f.commit();const r=f.run('--full');assert.equal(r.status,0,r.stdout+r.stderr);
});

test('reconstruction callables and actual research database writes still block',t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.cwd,'prediction-reconstruction.ts'),'function reconstructPrediction(actual){return actual;}');
  fs.writeFileSync(path.join(f.cwd,'research-write.mjs'),"db.from('canonical').update({score:2});");
  f.commit();assert.equal(f.run('--full').status,1);
  const rules=f.report().findings.map(x=>x.rule);
  assert.ok(rules.includes('POSTMATCH_RECONSTRUCTION_RISK'));
  assert.ok(rules.includes('SHADOW_DB_WRITE_REVIEW_REQUIRED'));
});
