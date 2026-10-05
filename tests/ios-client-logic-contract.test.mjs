import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html=await readFile(new URL('../web/index.html',import.meta.url),'utf8');
const swift=await readFile(new URL('../ios/CFI/CFIWebView.swift',import.meta.url),'utf8');
const pbx=await readFile(new URL('../ios/CFI.xcodeproj/project.pbxproj',import.meta.url),'utf8');
const workflow=await readFile(new URL('../.github/workflows/build-ios-unsigned.yml',import.meta.url),'utf8');

function extractFunction(name){
  const marker='function '+name+'(';
  const start=html.indexOf(marker);
  assert.ok(start>=0,'missing '+name);
  const bodyStart=html.indexOf('{',start);
  let depth=0,quote=null,escape=false;
  for(let i=bodyStart;i<html.length;i++){
    const ch=html[i];
    if(quote){
      if(escape){escape=false;continue}
      if(ch==='\\'){escape=true;continue}
      if(ch===quote)quote=null;
      continue;
    }
    if(ch==='"'||ch==="'"){quote=ch;continue}
    if(ch==='{')depth++;
    if(ch==='}'){
      depth--;
      if(depth===0)return html.slice(start,i+1);
    }
  }
  throw new Error('unterminated '+name);
}

const makeScaler=new Function(extractFunction('makeScaler')+'; return makeScaler;')();
const signal=new Function(extractFunction('signal')+'; return signal;')();

test('probability scaler detects units per payload group instead of multiplying every <=1 value',()=>{
  const fraction=makeScaler([0.008,0.71,0.42]);
  assert.equal(fraction(0.008),0.8);
  assert.equal(fraction(0.71),71);
  const percent=makeScaler([0.8,8,71]);
  assert.equal(percent(0.8),0.8);
  assert.equal(percent(8),8);
  assert.equal(percent(71),71);
  assert.equal(makeScaler([0.2])('bad'),null);
});

test('unknown decision is fail-visible and never silently PASS',()=>{
  assert.deepEqual(signal({decision:'BET'}),['STRONG','sig-strong']);
  assert.deepEqual(signal({decision:'WATCH'}),['WATCH','sig-watch']);
  assert.deepEqual(signal({decision:'BLOCKED'}),['BLOCKED','sig-block']);
  assert.deepEqual(signal({decision:'PASS'}),['PASS','sig-pass']);
  const unknown=signal({decision:'SUPER_CONFIDENT'});
  assert.equal(unknown[1],'sig-block');
  assert.match(unknown[0],/^UNKNOWN/);
  assert.notEqual(unknown[0],'PASS');
});

test('native bridge is defensive and exposes required production paths',()=>{
  for(const path of ['/api/fixtures-day','/api/discover','/api/match-context','/api/predict']){
    assert.ok(swift.includes('"'+path+'"'),'missing native allowlist path '+path);
  }
  assert.match(html,/try\{data=JSON\.parse\(text\)\}catch\(parseErr\)/);
  assert.match(swift,/let ok = \(200\.\.\.299\)\.contains\(status\)/);
  assert.match(swift,/loadFileURL\(/);
});

test('version and build number are aligned across VERSION files UI Xcode and artifact workflow',async()=>{
  const version=(await readFile(new URL('../VERSION',import.meta.url),'utf8')).trim();
  const build=(await readFile(new URL('../BUILD_NUMBER',import.meta.url),'utf8')).trim();
  assert.match(version,/^\d+\.\d+\.\d+$/);
  assert.match(build,/^[1-9]\d*$/);
  const builds=[...new Set([...pbx.matchAll(/CURRENT_PROJECT_VERSION = (\d+);/g)].map(m=>m[1]))];
  assert.deepEqual(builds,[build]);
  const versions=[...new Set([...pbx.matchAll(/MARKETING_VERSION = ([\d.]+);/g)].map(m=>m[1]))];
  assert.deepEqual(versions,[version]);
  assert.equal((pbx.match(/MARKETING_VERSION = [\d.]+;/g)||[]).length,2);
  assert.equal((pbx.match(/CURRENT_PROJECT_VERSION = \d+;/g)||[]).length,2);
  assert.ok(html.includes('v'+version+' · Build '+build));
  assert.ok(!html.includes('Beta 1'));
  assert.ok(workflow.includes('CFI-iOS-v${VERSION}-build${BUILD_NUMBER}-unsigned.ipa'));
  assert.ok(workflow.includes('CFI-iOS-v${{ env.VERSION }}-build${{ env.BUILD_NUMBER }}'));
});

test('icon pipeline forces and verifies real PNG bytes',()=>{
  assert.match(workflow,/sips -s format png -z 180 180/);
  assert.match(workflow,/89504e47/);
  assert.match(workflow,/Not a real PNG/);
});

test('Fusion and Insights are functional result panels, not placeholder tabs',()=>{
  assert.ok(html.includes('data-resultpanel="fusion"'));
  assert.ok(html.includes('data-resultpanel="insights"'));
  assert.ok(html.includes('function renderFusion(out)'));
  assert.ok(html.includes('function renderInsights(out)'));
  assert.ok(html.includes('renderFusion(out);renderInsights(out);'));
});
