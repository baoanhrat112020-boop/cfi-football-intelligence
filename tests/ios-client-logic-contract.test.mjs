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

test('v0.2.2 build 4 is aligned across UI Xcode and artifact workflow',()=>{
  assert.ok(html.includes('v0.2.2 Beta 1 · Build 4'));
  assert.equal((pbx.match(/MARKETING_VERSION = 0\.2\.2;/g)||[]).length,2);
  assert.equal((pbx.match(/CURRENT_PROJECT_VERSION = 4;/g)||[]).length,2);
  assert.ok(workflow.includes('CFI-iOS-v0.2.2-beta1-build4-unsigned.ipa'));
  assert.ok(workflow.includes('CFI-iOS-v0.2.2-beta1-build4'));
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


test('probText never guesses an isolated value or treats missing data as zero',()=>{
  const probText=new Function(extractFunction('makeScaler')+extractFunction('probText')+';return probText')();
  assert.equal(probText(0.8),'—');
  assert.equal(probText(0.008),'—');
  assert.equal(probText(0.8,[0.8,8,71]),'0.8%');
  assert.equal(probText(0.008,null,'fraction'),'0.8%');
  assert.equal(probText(0.8,null,'percent'),'0.8%');
  for(const x of [null,undefined,'',true,{},-1,101])assert.equal(probText(x,null,'percent'),'—');
});

function clientLogic(extra=''){
  const names=['makeScaler','payloadUnit','marketTier','collectMarkets','collectCore','signal','probText','weightHtml','renderFusion','renderInsights','renderMulti','renderDNA'];
  const boxes={};
  const $=id=>boxes[id]||(boxes[id]={innerHTML:''});
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return new Function('$','esc','var TIER_CHAMPION="CHAMPION",TIER_SHADOW="SHADOW",TIER_RESEARCH="RESEARCH",CORE_MARKETS=["3+ HT","7+ FT","Other HT","Other FT"];'+names.map(extractFunction).join('\n')+extra+';return {'+names.join(',')+'};')($,esc);
}

test('reads all branches, keeps provenance and blocks conflicting champion sources',()=>{
  const c=clientLogic();
  const out={probabilityUnit:'percent',champion:{thresholds:[{market:'3+ HT',probability:12,tier:'CHAMPION',decision:'BET',decisionUse:true}]},ranking:[{target:'7+ FT',probability:0.8,tier:'CHAMPION',decisionUse:true}],markets:{'3+ HT':{final:25,tier:'CHAMPION',decision:'BET',decisionUse:true},'Other FT':{final:3,tier:'CHAMPION',decisionUse:true}}};
  const rows=c.collectCore(out);
  assert.equal(rows.length,3);
  assert.equal(rows.find(r=>r.market==='7+ FT').p,0.8);
  const conflict=rows.find(r=>r.market==='3+ HT');
  assert.equal(conflict.p,25);
  assert.deepEqual(conflict.sources.map(x=>x.source),['champion.thresholds','markets']);
  assert.equal(conflict.decisionUse,false);
  assert.equal(c.signal(conflict)[0],'CONFLICT');
});

test('shadow and research cannot fill a champion gap or inherit a BET decision',()=>{
  const c=clientLogic();
  const rows=c.collectMarkets({probabilityUnit:'fraction',champion:{thresholds:[{market:'3+ HT',probability:null,decision:'BET',decisionUse:true}]},markets:{'3+ HT':{final:0.9,tier:'SHADOW',decision:'BET',decisionUse:true},'Other HT':{final:0.8,tier:'RESEARCH',decision:'BET'}}});
  assert.equal(rows.find(r=>r.tier==='CHAMPION').p,null);
  assert.equal(c.signal(rows.find(r=>r.tier==='SHADOW'))[0],'SHADOW');
  assert.equal(c.signal(rows.find(r=>r.tier==='RESEARCH'))[0],'RESEARCH');
  assert.equal(c.marketTier({tier:'CHAMPION',researchState:'SHADOW'},'markets'),'SHADOW');
});

test('source groups use their own units and V3 honors fraction producer contract',()=>{
  const c=clientLogic();
  const rows=c.collectMarkets({champion:{thresholds:[{market:'3+ HT',probability:0.008,probabilityUnit:'fraction'},{market:'7+ FT',probability:0.02,probabilityUnit:'fraction'}]},markets:{'Other HT':{probability:0.8,probabilityUnit:'percent'}}});
  assert.equal(rows[0].p,0.8);assert.equal(rows[2].p,0.8);
  assert.equal(c.collectCore({version:'CFI_PRACTICAL_OUTPUT_V3',champion:{thresholds:[{market:'3+ HT',probability:0.008}]}})[0].p,0.8);
  assert.equal(c.probText(null,[0.1,0.4]),'—');
});

test('actual renderers honor units, unavailable states and escape payload text',()=>{
  const boxes={};const $=id=>boxes[id]||(boxes[id]={innerHTML:''});
  const esc=v=>String(v??'').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const names=['makeScaler','payloadUnit','marketTier','collectMarkets','signal','probText','weightHtml','renderFusion','renderInsights','renderMulti','renderDNA'];
  const c=new Function('$','esc','var TIER_CHAMPION="CHAMPION",TIER_SHADOW="SHADOW",TIER_RESEARCH="RESEARCH",CORE_MARKETS=["3+ HT","7+ FT","Other HT","Other FT"];'+names.map(extractFunction).join('\n')+';return {renderFusion,renderInsights,renderMulti,renderDNA};')($,esc);
  c.renderFusion({probabilityUnit:'percent',championFusion:{uncertainty:{confidence:0.8},gating:{ht:{weights:{a:0.8,b:99.2}}}}});
  assert.match(boxes.fusionContent.innerHTML,/0\.8%/);
  assert.doesNotMatch(boxes.fusionContent.innerHTML,/80\.0%/);
  c.renderInsights({});assert.match(boxes.insightsContent.innerHTML,/Fixture identity<\/span><b>—/);
  c.renderMulti({version:'CFI_PRACTICAL_OUTPUT_V3',multiMarket:{oneXTwo:[{market:'HT 1',probability:0.8,decision:'BET',decisionUse:true}]}});
  assert.match(boxes.multiContent.innerHTML,/SHADOW/);assert.doesNotMatch(boxes.multiContent.innerHTML,/BET/);
  assert.match(boxes.multiContent.innerHTML,/BTTS/);
  c.renderDNA({});assert.match(boxes.dnaContent.innerHTML,/DỮ LIỆU KHÔNG CÓ/);
  c.renderDNA({version:'CFI_PRACTICAL_OUTPUT_V3',champion:{path:'<script>',top3HT:[{score:'1-0',probability:0.008}]}});
  assert.match(boxes.dnaContent.innerHTML,/0\.8%/);assert.match(boxes.dnaContent.innerHTML,/&lt;script&gt;/);
});

test('health updates runtime alone; four subsystem states stay independent',async()=>{
  const state={subsystems:{runtime:'UNAVAILABLE',db:'CACHED',strict:'BLOCKED',market:'UPSTREAM'}};
  const code='var SUBSYSTEMS=["runtime","db","strict","market"],SUB_STATE={ONLINE:"ok",READY:"ok",CACHED:"warn",CHECKING:"warn",UPSTREAM:"bad",UNAVAILABLE:"bad",BLOCKED:"bad"};';
  const refresh=new Function('state','api','setStatus','toast',code+extractFunction('setSubsystem')+'async '+extractFunction('refreshStatus')+';return refreshStatus;')(state,async()=>({data:{status:'OK'}}),()=>{},()=>{});
  await refresh(true);
  assert.deepEqual(state.subsystems,{runtime:'ONLINE',db:'CACHED',strict:'BLOCKED',market:'UPSTREAM'});
  for(const panel of ['multi','dna','raw'])assert.ok(html.includes('data-resultpanel="'+panel+'"'));
});
