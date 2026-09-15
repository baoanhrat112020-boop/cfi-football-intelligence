import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAiScoreBodyText } from '../local-node/browser/fixture-collector/aiscore-parser.mjs';

const text=`
Football Today’s Matches
Total:200 Matches found for Today
England: English U21 Premier League
19:00
Blackburn Rovers U21
VS
Reading U21
H2H
Prediction
Live
20:00
FT
Team A
2 - 1
Team B
H2H
Live
`;

test('AiScore PC parser extracts scheduled and completed fixtures', ()=>{
  const out=parseAiScoreBodyText(text,{
    targetDate:'2026-09-15',
    timeZone:'Asia/Ho_Chi_Minh'
  });

  assert.equal(out.fixtures.length,2);
  assert.equal(out.fixtures[0].provider,'AISCORE');
  assert.equal(out.fixtures[0].home,'Blackburn Rovers U21');
  assert.equal(out.fixtures[0].away,'Reading U21');
  assert.equal(out.fixtures[0].competition,'English U21 Premier League');
  assert.equal(out.fixtures[0].kickoffLocal,'19:00');
  assert.ok(out.fixtures[0].kickoffIso);
  assert.equal(out.fixtures[1].status,'finished');
  assert.equal(out.fixtures[1].home,'Team A');
  assert.equal(out.fixtures[1].away,'Team B');
});

test('AiScore PC parser does not dedupe unrelated matches with same time', ()=>{
  const out=parseAiScoreBodyText(`
Vietnam: Test League
18:00
A FC
VS
B FC
18:00
C FC
VS
D FC
`,{
    targetDate:'2026-09-15',
    timeZone:'Asia/Ho_Chi_Minh'
  });

  assert.equal(out.fixtures.length,2);
});
