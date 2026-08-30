import assert from 'node:assert/strict';
import fs from 'node:fs';

const engine=fs.readFileSync(new URL('../src/prediction/final-engine.ts',import.meta.url),'utf8');
const wrapper=fs.readFileSync(new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),'utf8');
const live=fs.readFileSync(new URL('../cloudflare-worker/src/index-live-router.ts',import.meta.url),'utf8');

assert.match(engine,/Top-1 HT/);
assert.match(engine,/Top-1 FT/);
assert.doesNotMatch(engine,/PRIMARY_TARGETS = \[\.\.\.MARKET_CODES, "Top-3 HT", "Top-3 FT"\]/);
assert.match(engine,/primaryTargets:\{contract:PRIMARY_CONTRACT,count:6/);
assert.match(engine,/CFI_2_METHODS_X_6_TARGETS_V2/);
assert.match(wrapper,/import \{ MARKET_CODES, PRIMARY_CONTRACT \} from '\.\.\/\.\.\/src\/prediction\/final-engine\.ts'/);
assert.match(wrapper,/sixTargetMatrix=\{contract:PRIMARY_CONTRACT/);
assert.match(wrapper,/presentationContract=.*contract:PRIMARY_CONTRACT/);
assert.match(wrapper,/TOP-1 HT/);
assert.match(wrapper,/TOP-1 FT/);
assert.match(wrapper,/verifyPrimaryContractV2/);
assert.match(wrapper,/RUNTIME_CONTRACT_ERROR/);
assert.match(wrapper,/RUNTIME_CONTRACT_FAIL_CLOSED/);
assert.match(live,/CFI_PRIMARY_TOP1_RUNTIME_V2/);
console.log('top1-primary-contract: PASS');
