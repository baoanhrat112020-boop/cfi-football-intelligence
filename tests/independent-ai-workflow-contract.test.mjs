import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';

const testWorkflow=fs.readFileSync('.github/workflows/test.yml','utf8');
const aiWorkflow=fs.readFileSync('.github/workflows/cfi-independent-ai-auditor.yml','utf8');
const policy=fs.readFileSync('.github/cfi-independent-ai-review.md','utf8');

test('independent AI workflow is valid YAML with both trusted jobs',()=>{
  const parsed=YAML.parse(aiWorkflow);
  assert.equal(parsed?.name,'CFI Independent AI Auditor V1');
  assert.ok(parsed?.jobs?.['independent-ai-review']);
  assert.ok(parsed?.jobs?.['bootstrap-provider-e2e']);
});

test('PR workflow is secret-free and runs zero-AI deterministic CFI gate',()=>{
  assert.match(testWorkflow,/Zero-AI deterministic CFI gate/);
  assert.match(testWorkflow,/node tools\/cfi-audit\.mjs --full --no-cache/);
  assert.doesNotMatch(testWorkflow,/CLOUDFLARE_API_TOKEN/);
  assert.doesNotMatch(testWorkflow,/CLOUDFLARE_WORKERS_AI_API_TOKEN/);
  assert.doesNotMatch(testWorkflow,/independent-ai-review:/);
});

test('independent AI review is manual-dispatch only (automatic workflow_run trigger disabled for cost control) and checks out trusted default branch',()=>{
  assert.match(aiWorkflow,/^on:\s*\n\s*workflow_dispatch:/m);
  assert.doesNotMatch(aiWorkflow,/workflow_run:/);
  assert.match(aiWorkflow,/workflow_run\.conclusion == 'success'/);
  assert.match(aiWorkflow,/Checkout trusted auditor from default branch/);
  assert.match(aiWorkflow,/ref:\s*\$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(aiWorkflow,/persist-credentials:\s*false/);
  assert.match(aiWorkflow,/actions\/download-artifact@v4/);
});

test('secret-bearing AI job uses dedicated Workers AI token and cannot write contents or PRs',()=>{
  assert.match(aiWorkflow,/contents:\s*read/);
  assert.match(aiWorkflow,/pull-requests:\s*read/);
  assert.match(aiWorkflow,/statuses:\s*write/);
  assert.doesNotMatch(aiWorkflow,/contents:\s*write/);
  assert.doesNotMatch(aiWorkflow,/pull-requests:\s*write/);
  assert.match(aiWorkflow,/CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_WORKERS_AI_API_TOKEN \}\}/);
  assert.doesNotMatch(aiWorkflow,/CLOUDFLARE_API_TOKEN:\s*\$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(aiWorkflow,/CLOUDFLARE_ACCOUNT_ID/);
  assert.match(aiWorkflow,/@cf\/openai\/gpt-oss-120b/);
  assert.doesNotMatch(aiWorkflow,/@cf\/openai\/gpt-oss-20b/);
  assert.doesNotMatch(aiWorkflow,/@cf\/zai-org\/glm-4\.7-flash/);
  assert.match(aiWorkflow,/cfi-publish-ai-audit-status\.mjs/);
  assert.doesNotMatch(aiWorkflow,/wrangler\s+deploy/);
  assert.doesNotMatch(aiWorkflow,/supabase\s+(db|functions)\s+(push|deploy)/);
});

test('bootstrap provider E2E job still targets trusted-main push semantics even though the workflow itself is now manual-dispatch only',()=>{
  assert.doesNotMatch(aiWorkflow,/\n\s*push:\s*\n\s*branches:\s*\[main\]/);
  assert.match(aiWorkflow,/bootstrap-provider-e2e:/);
  assert.match(aiWorkflow,/github\.event_name == 'push'/);
  assert.match(aiWorkflow,/Re-run zero-AI deterministic gate on trusted main/);
  assert.match(aiWorkflow,/tools\/cfi-resolve-associated-pr\.mjs/);
  assert.match(aiWorkflow,/--commit-sha/);
  assert.match(aiWorkflow,/--github-output/);
  assert.match(aiWorkflow,/tools\/cfi-resolve-associated-pr\.mjs'/);
  assert.match(aiWorkflow,/Enforce bootstrap AI verdict/);
  assert.doesNotMatch(aiWorkflow,/node - <<'NODE'[\s\S]*commits\/\$\{sha\}\/pulls/);
});

test('independent review policy locks CFI integrity and structured verdict fields',()=>{
  for(const token of [
    'STRICT_PRIOR','SETTLEMENT_INTEGRITY','SHADOW_ISOLATION','MULTI_MARKET',
    'ARCHITECTURE','TEST_EVIDENCE','BLOCK_PROMOTION','END_CFI_AI_AUDIT_V1',
    'NO_AUTO_PRODUCTION_PROMOTION',
  ]) assert.match(policy,new RegExp(token));
  assert.match(policy,/reconstruct historical predictions/i);
});

test('trusted auditor runtime attestation separates reviewer from prediction engine and locks fail-closed provider semantics',()=>{
  assert.match(policy,/Trusted auditor runtime attestation/i);
  assert.match(policy,/AUDITOR_ROLE/);
  assert.match(policy,/read-only code\/policy reviewer/i);
  assert.match(policy,/AI_PROVIDER.*Cloudflare Workers AI/is);
  assert.match(policy,/@cf\/openai\/gpt-oss-120b/);
  assert.doesNotMatch(policy,/@cf\/openai\/gpt-oss-20b/);
  assert.match(policy,/CLOUDFLARE_WORKERS_AI_API_TOKEN/);
  assert.match(policy,/production\/deployment `CLOUDFLARE_API_TOKEN` secret is not supplied/i);
  assert.match(policy,/no alternate-model or alternate-provider fallback path/i);
  assert.match(policy,/provider\/auth HTTP errors, timeouts, missing response text, malformed structured verdicts/i);
  assert.match(policy,/LIVE_INVOCATION_EVIDENCE/);
  assert.match(policy,/provider authentication, endpoint reachability, and model execution have succeeded for this invocation/i);
  assert.match(policy,/SETUP_NODE_SEMANTICS/);
  assert.match(policy,/resolves\/downloads the requested Node version/i);
});

test('policy evaluates Multi-Market impact by component scope without calibrating the reviewer model',()=>{
  assert.match(policy,/auditor model itself.*calibrated against football markets/is);
  assert.match(policy,/code-review control plane, not a football forecasting model/i);
  assert.match(policy,/when the reviewed change can alter prediction\/research model behavior or market outputs/i);
  assert.match(policy,/do not demand football calibration of the reviewer model/i);
  assert.match(policy,/successful.*current live independent-auditor invocation.*runtime reachability evidence/is);
  assert.match(policy,/do not require a second redundant provider smoke call inside the same review/i);
});
