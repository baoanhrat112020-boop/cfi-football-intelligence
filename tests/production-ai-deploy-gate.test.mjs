import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import YAML from 'yaml';
import {
  AUDIT_CONTEXT,
  MAIN_REF,
  TRUSTED_STATUS_CREATOR,
  TRUSTED_AUDIT_WORKFLOW_PATH,
  parseAuditAttestation,
  parseTrustedRunId,
  validateTrustedAuditRun,
  selectValidPreMergeAuditStatus,
  evaluateDeploymentGate,
} from '../tools/cfi-production-ai-deploy-gate.mjs';

const gateSource=fs.readFileSync('tools/cfi-production-ai-deploy-gate.mjs','utf8');
const baseSha='a'.repeat(40);
const headSha='b'.repeat(40);
const mergeSha='c'.repeat(40);
const diffSha256='d'.repeat(64);
const mergedAt='2026-09-03T01:00:00Z';
const repo='baoanhrat112020-boop/cfi-football-intelligence';
const trustedTarget=`https://github.com/${repo}/actions/runs/123`;
const targetPrefix=`https://github.com/${repo}/actions/runs/`;

function pr(overrides={}){
  return {
    number:179,
    merged_at:mergedAt,
    merge_commit_sha:mergeSha,
    head:{sha:headSha},
    base:{sha:baseSha},
    ...overrides,
  };
}

function status(overrides={}){
  return {
    context:AUDIT_CONTEXT,
    state:'success',
    description:`PASS base=${baseSha} diff=${diffSha256}`,
    created_at:'2026-09-03T00:59:00Z',
    target_url:trustedTarget,
    creator:{login:TRUSTED_STATUS_CREATOR},
    ...overrides,
  };
}

function auditRun(overrides={}){
  return {
    name:AUDIT_CONTEXT,
    path:TRUSTED_AUDIT_WORKFLOW_PATH,
    event:'workflow_run',
    conclusion:'success',
    head_branch:'main',
    repository:{full_name:repo},
    ...overrides,
  };
}

test('attestation parser requires full base SHA and diff SHA-256',()=>{
  assert.deepEqual(parseAuditAttestation(`PASS base=${baseSha} diff=${diffSha256}`),{baseSha,diffSha256});
  assert.equal(parseAuditAttestation('Independent AI audit PASS'),null);
  assert.equal(parseAuditAttestation(`PASS base=${baseSha.slice(0,12)} diff=${diffSha256}`),null);
});

test('exact trusted pre-merge attestation authorizes production deploy',()=>{
  const result=evaluateDeploymentGate({
    ref:MAIN_REF,mergeSha,pr:pr(),diffSha256,statuses:[status()],targetUrlPrefix:targetPrefix,
  });
  assert.equal(result.ok,true);
  assert.equal(result.reason,'AI_AUDIT_PREMERGE_ATTESTATION_MATCH');
});

test('trusted status target must resolve to the exact independent AI workflow run',()=>{
  assert.equal(parseTrustedRunId(trustedTarget,repo),123);
  assert.equal(parseTrustedRunId(`https://github.com/${repo}/actions/runs/123/attempts/2`,repo),null);
  assert.equal(parseTrustedRunId('https://example.test/actions/runs/123',repo),null);
  assert.equal(validateTrustedAuditRun(auditRun(),{repo}).ok,true);
  const bad=[
    auditRun({name:'Other Workflow'}),
    auditRun({path:'.github/workflows/other.yml'}),
    auditRun({event:'push'}),
    auditRun({conclusion:'failure'}),
    auditRun({head_branch:'feature'}),
    auditRun({repository:{full_name:'other/repo'}}),
  ];
  for(const run of bad) assert.equal(validateTrustedAuditRun(run,{repo}).ok,false);
});

test('GitHub reads use bounded retry and timeout without fail-open fallback',()=>{
  assert.match(gateSource,/for \(let attempt = 0; attempt < 3; attempt \+= 1\)/);
  assert.match(gateSource,/response\.status === 429 \|\| response\.status >= 500/);
  assert.match(gateSource,/AbortSignal\.timeout\(20_000\)/);
  assert.match(gateSource,/throw lastError \?\? new Error\('GITHUB_REQUEST_FAILED'\)/);
  assert.match(gateSource,/main\(\)\.catch\(error => \{[\s\S]*fail\(`GATE_RUNTIME_ERROR:/);
});

test('post-merge bootstrap PASS cannot launder a bypassed merge',()=>{
  const result=evaluateDeploymentGate({
    ref:MAIN_REF,mergeSha,pr:pr(),diffSha256,
    statuses:[status({created_at:'2026-09-03T01:00:01Z'})],targetUrlPrefix:targetPrefix,
  });
  assert.equal(result.ok,false);
  assert.equal(result.reason,'AI_AUDIT_PREMERGE_STATUS_MISSING');
});

test('old unattested PASS, wrong base, wrong diff, wrong creator and wrong target all fail closed',()=>{
  const cases=[
    status({description:'Independent AI audit PASS'}),
    status({description:`PASS base=${'e'.repeat(40)} diff=${diffSha256}`}),
    status({description:`PASS base=${baseSha} diff=${'e'.repeat(64)}`}),
    status({creator:{login:'someone-else'}}),
    status({target_url:'https://example.test/fake'}),
  ];
  for(const candidate of cases){
    const result=selectValidPreMergeAuditStatus({
      statuses:[candidate],mergedAt,baseSha,diffSha256,targetUrlPrefix:targetPrefix,
    });
    assert.equal(result.ok,false);
  }
});

test('pre-merge failure/error cannot authorize deploy',()=>{
  for(const state of ['failure','error']){
    const result=selectValidPreMergeAuditStatus({
      statuses:[status({state})],mergedAt,baseSha,diffSha256,targetUrlPrefix:targetPrefix,
    });
    assert.equal(result.ok,false);
    assert.match(result.reason,/AI_AUDIT_PREMERGE_(FAILURE|ERROR)/);
  }
});

test('non-main, merge identity mismatch and incomplete PR identity fail closed',()=>{
  assert.equal(evaluateDeploymentGate({ref:'refs/heads/dev',mergeSha,pr:pr(),diffSha256,statuses:[status()]}).reason,'PRODUCTION_DEPLOY_REF_NOT_MAIN');
  assert.equal(evaluateDeploymentGate({ref:MAIN_REF,mergeSha,pr:pr({merge_commit_sha:'f'.repeat(40)}),diffSha256,statuses:[status()]}).reason,'MERGE_COMMIT_SHA_MISMATCH');
  assert.equal(evaluateDeploymentGate({ref:MAIN_REF,mergeSha,pr:pr({head:{sha:null}}),diffSha256,statuses:[status()]}).reason,'ASSOCIATED_PR_IDENTITY_INCOMPLETE');
});

test('deployment workflows gate production secrets and use explicit Node 22 LTS baseline',()=>{
  const cloudflare=fs.readFileSync('.github/workflows/deploy-cloudflare.yml','utf8');
  const supabase=fs.readFileSync('.github/workflows/deploy-supabase-gpt-control.yml','utf8');
  const cloud=YAML.parse(cloudflare);
  const supa=YAML.parse(supabase);

  assert.ok(cloud?.jobs?.['ai-deploy-gate']);
  assert.equal(cloud?.jobs?.deploy?.needs,'ai-deploy-gate');
  assert.ok(supa?.jobs?.['ai-deploy-gate']);
  assert.deepEqual(supa?.jobs?.deploy?.needs,['verify','ai-deploy-gate']);
  assert.deepEqual(supa?.jobs?.['native-production-gate']?.needs,['verify','ai-deploy-gate','deploy']);

  for(const [workflow,parsed] of [[cloudflare,cloud],[supabase,supa]]){
    assert.match(workflow,/cfi-production-ai-deploy-gate\.mjs/);
    assert.match(workflow,/actions:\s*read/);
    assert.match(workflow,/pull-requests:\s*read/);
    assert.match(workflow,/statuses:\s*read/);
    assert.match(workflow,/uses: actions\/setup-node@v4/);
    assert.match(workflow,/node-version:\s*22/);
    assert.equal(parsed?.permissions?.actions,'read');
    const gate=JSON.stringify(parsed?.jobs?.['ai-deploy-gate'] ?? {});
    assert.doesNotMatch(gate,/CLOUDFLARE_API_TOKEN/);
    assert.doesNotMatch(gate,/SUPABASE_ACCESS_TOKEN/);
    assert.doesNotMatch(gate,/secrets\./);
  }
  assert.equal(cloud?.jobs?.['ai-deploy-gate']?.steps?.[1]?.with?.['node-version'],22);
  assert.equal(cloud?.jobs?.deploy?.steps?.[1]?.with?.['node-version'],22);
  assert.equal(supa?.jobs?.['ai-deploy-gate']?.steps?.[1]?.with?.['node-version'],22);
  assert.equal(supa?.jobs?.verify?.steps?.[1]?.with?.['node-version'],22);
  assert.equal(supa?.jobs?.['native-production-gate']?.steps?.[0]?.with?.['node-version'],22);
  assert.doesNotMatch(cloudflare,/\.github\/workflows\/deploy-cloudflare\.yml'\s*$/m);
  assert.doesNotMatch(supabase,/\.github\/workflows\/deploy-supabase-gpt-control\.yml'\s*$/m);
});
