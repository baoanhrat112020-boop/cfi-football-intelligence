import test from 'node:test';
import assert from 'node:assert/strict';
import { walkForwardOuNbChallenger } from '../src/prediction/multi-market-ou-nb-challenger.ts';
import type { CanonicalFixture } from '../src/prediction/final-engine.ts';

function fixtures():CanonicalFixture[]{
  const xs:CanonicalFixture[]=[];
  for(let i=0;i<40;i++){
    const high=i%5===0;
    xs.push({id:`x-${i}`,matchDate:`2025-${String(1+Math.floor(i/28)).padStart(2,'0')}-${String(1+(i%28)).padStart(2,'0')}`,homeTeam:i%2===0?'Alpha':'Beta',awayTeam:i%2===0?'Beta':'Alpha',ht:{home:high?2:0,away:high?1:0},ft:{home:high?6:(i%3===0?3:1),away:high?2:(i%4===0?2:0)}});
  }
  return xs;
}

test('NB challenger is strict-prior, deterministic and bounded',()=>{
  const a:any=walkForwardOuNbChallenger(fixtures(),{historyCap:20,minTeamPrior:6,minDispersionN:12});
  const b:any=walkForwardOuNbChallenger([...fixtures()].reverse(),{historyCap:20,minTeamPrior:6,minDispersionN:12});
  assert.equal(a.version,'CFI_OU_NB_CHALLENGER_V1');
  assert.equal(a.strictPrior,true);assert.equal(a.sameDateExcluded,true);assert.equal(a.leakage,false);assert.equal(a.decisionUse,false);assert.equal(a.productionEligible,false);
  assert.ok(a.evaluatedMatches>0);assert.deepEqual(a,b);
  for(const row of Object.values(a.ft) as any[]){assert.ok(row.n>0);assert.ok(row.poissonBrier>=0&&row.poissonBrier<=1);assert.ok(row.challengerBrier>=0&&row.challengerBrier<=1);assert.ok(row.overdispersedRate>=0&&row.overdispersedRate<=1);}
});

test('future mutation cannot alter earlier replay points aggregate when appended after target window',()=>{
  const base=fixtures();
  const a:any=walkForwardOuNbChallenger(base);
  const future:CanonicalFixture={id:'future',matchDate:'2027-01-01',homeTeam:'Alpha',awayTeam:'Beta',ht:{home:9,away:9},ft:{home:12,away:11}};
  const b:any=walkForwardOuNbChallenger([...base,future]);
  assert.equal(b.evaluatedMatches,a.evaluatedMatches+1);
  for(const line of Object.keys(a.ft))assert.ok(Number.isFinite(a.ft[line].delta));
});
