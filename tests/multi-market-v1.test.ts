import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMultiMarketV1 } from '../src/prediction/multi-market-v1.ts';

const approx=(a:number,b:number,eps=1e-9)=>assert.ok(Math.abs(a-b)<=eps,`${a} != ${b}`);

test('multi-market V1 is deterministic and internally consistent',()=>{
  const input={htHome:1.15,htAway:.72,ftHome:2.25,ftAway:1.05};
  const a=buildMultiMarketV1(input),b=buildMultiMarketV1(input);
  assert.deepEqual(a,b);
  assert.equal(a.version,'CFI_MULTI_MARKET_V1');
  assert.equal(a.status,'SHADOW_RESEARCH');
  assert.equal(a.decisionUse,false);
  assert.equal(a.consistencyGuard.status,'PASS');
});

test('1X2 masses sum to one and AH -0.5 reconciles with win probability',()=>{
  const p=buildMultiMarketV1({htHome:.9,htAway:.8,ftHome:1.9,ftAway:1.1});
  approx(p.oneXTwo.ht.home+p.oneXTwo.ht.draw+p.oneXTwo.ht.away,1);
  approx(p.oneXTwo.ft.home+p.oneXTwo.ft.draw+p.oneXTwo.ft.away,1);
  approx(p.asianHandicap.ht['-0.5'].home.fullWin,p.oneXTwo.ht.home);
  approx(p.asianHandicap.ft['-0.5'].home.fullWin,p.oneXTwo.ft.home);
});

test('O/U over probability is monotone across half-goal lines',()=>{
  const p=buildMultiMarketV1({htHome:1.2,htAway:1.0,ftHome:2.4,ftAway:1.7});
  const ht=[.5,1.5,2.5,3.5,4.5].map(x=>p.overUnder.ht[String(x)].over.fullWin);
  const ft=[1.5,2.5,3.5,4.5,5.5,6.5,7.5].map(x=>p.overUnder.ft[String(x)].over.fullWin);
  for(let i=1;i<ht.length;i++)assert.ok(ht[i]<=ht[i-1]);
  for(let i=1;i<ft.length;i++)assert.ok(ft[i]<=ft[i-1]);
  approx(p.derivedChecks.ftOver6_5,p.overUnder.ft['6.5'].over.fullWin);
  approx(p.derivedChecks.htOver2_5,p.overUnder.ht['2.5'].over.fullWin);
});

test('quarter Asian handicap settlement partitions probability mass',()=>{
  const p=buildMultiMarketV1({htHome:.7,htAway:.9,ftHome:1.4,ftAway:1.8});
  const s=p.asianHandicap.ft['-0.25'].home;
  approx(s.fullWin+s.halfWin+s.push+s.halfLoss+s.fullLoss,1);
  assert.ok(s.halfWin>0||s.halfLoss>0);
  assert.ok(s.fairDecimal===null||s.fairDecimal>=1);
});

test('stronger home expectation increases FT home win probability',()=>{
  const balanced=buildMultiMarketV1({htHome:.8,htAway:.8,ftHome:1.4,ftAway:1.4});
  const stronger=buildMultiMarketV1({htHome:1.1,htAway:.6,ftHome:2.3,ftAway:.8});
  assert.ok(stronger.oneXTwo.ft.home>balanced.oneXTwo.ft.home);
  assert.ok(stronger.asianHandicap.ft['-1.5'].home.fullWin>balanced.asianHandicap.ft['-1.5'].home.fullWin);
});
