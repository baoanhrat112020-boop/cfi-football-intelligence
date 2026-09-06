import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';

function runNode(script, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [script], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', code => resolveRun({ code, stdout, stderr }));
  });
}

function plan() {
  return {
    contract: 'CFI_ROLLING_EVIDENCE_REQUEST_PLAN_V1',
    requests: [
      {
        requestId: 'CROSSCHECK_REQUIRED_QUEUE:runner-test',
        lane: 'CROSSCHECK_REQUIRED_QUEUE',
        identityKey: 'runner test home|runner test away|2026-09-05',
        targetDate: '2026-09-05',
        home: 'Runner Test Home',
        away: 'Runner Test Away',
        kickoffIso: '2026-09-05T08:00:00.000Z',
        trustedProviders: ['FLASHSCORE'],
        trustedLiveProviders: ['FLASHSCORE'],
        bigDb: {
          request: {
            method: 'POST',
            body: {
              home: 'Runner Test Home',
              away: 'Runner Test Away',
              target_date: '2026-09-05'
            }
          }
        },
        web: {
          implementation: 'local-node/registry/web-search-rescue.mjs',
          ingestFile: 'local-node/cache/registry/web-search-candidates.json',
          trustedSourcePriority: ['AISCORE', 'FLASHSCORE'],
          queries: ['Runner Test Home vs Runner Test Away 2026-09-05 kickoff fixture']
        },
        routing: {
          rankingInputEligible: false,
          webCanSupplementBigDb: true
        }
      }
    ]
  };
}

test('live shadow runner reuses x-cfi-key contract without service-role or secret logging', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cfi-shadow-evidence-'));
  const input = join(dir, 'plan.json');
  const receipts = join(dir, 'receipts.json');
  const webPlan = join(dir, 'web.json');
  const reverify = join(dir, 'reverify.json');
  const audit = join(dir, 'audit.json');
  const secret = 'runner-test-action-key-never-log';
  await writeFile(input, JSON.stringify(plan()), 'utf8');

  const captured = [];
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    captured.push({
      url: req.url,
      method: req.method,
      xCfiKey: req.headers['x-cfi-key'] ?? null,
      authorization: req.headers.authorization ?? null,
      apikey: req.headers.apikey ?? null,
      body: JSON.parse(body || '{}')
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      status: 'OK',
      version: 'CFI_BIG_DB_RETRIEVAL_TEST',
      identity: {
        homeTeamId: 'TEAM-H',
        awayTeamId: 'TEAM-A',
        homeCanonical: 'Runner Canonical Home',
        awayCanonical: 'Runner Canonical Away'
      },
      exactTeam: {
        home: { retrieved: 9 },
        away: { retrieved: 10 },
        h2h: { retrieved: 1 }
      },
      temporalAudit: { verified: true }
    }));
  });

  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}/functions/v1/cfi-db`;

  try {
    const result = await runNode(
      resolve('local-node/registry/shadow-evidence-dispatcher.mjs'),
      {
        CFI_EVIDENCE_REQUEST_PLAN_FILE: input,
        CFI_SHADOW_EVIDENCE_RECEIPTS_FILE: receipts,
        CFI_WEB_CROSSCHECK_REQUEST_PLAN_FILE: webPlan,
        CFI_NEXT_CYCLE_REVERIFICATION_FILE: reverify,
        CFI_SHADOW_EVIDENCE_AUDIT_FILE: audit,
        CFI_SHADOW_EVIDENCE_LIVE: '1',
        CFI_DB_BASE_URL: base,
        CFI_DB_KEY: secret,
        CFI_SHADOW_EVIDENCE_CONCURRENCY: '1',
        CFI_SHADOW_EVIDENCE_TIMEOUT_MS: '3000',
        CFI_ORCHESTRATOR_CYCLE_ID: 'runner-cycle-1'
      }
    );

    assert.equal(result.code, 0, result.stderr || result.stdout);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].url, '/functions/v1/cfi-bigdb-retrieval');
    assert.equal(captured[0].method, 'POST');
    assert.equal(captured[0].xCfiKey, secret);
    assert.equal(captured[0].authorization, null);
    assert.equal(captured[0].apikey, null);
    assert.deepEqual(captured[0].body, {
      home: 'Runner Test Home',
      away: 'Runner Test Away',
      target_date: '2026-09-05'
    });
    assert.equal(result.stdout.includes(secret), false);
    assert.equal(result.stderr.includes(secret), false);

    const receiptBody = JSON.parse(await readFile(receipts, 'utf8'));
    const reverifyBody = JSON.parse(await readFile(reverify, 'utf8'));
    const auditBody = JSON.parse(await readFile(audit, 'utf8'));
    assert.equal(receiptBody.count, 1);
    assert.equal(receiptBody.rows[0].bigDb.status, 'FOUND');
    assert.equal(receiptBody.rows[0].rankingReady, false);
    assert.equal(reverifyBody.count, 1);
    assert.equal(reverifyBody.rows[0].canonicalHomeId, 'TEAM-H');
    assert.equal(reverifyBody.rows[0].canonicalAwayId, 'TEAM-A');
    assert.equal(reverifyBody.rows[0].sourceCycleId, 'runner-cycle-1');
    assert.equal(auditBody.liveRead.authHeader, 'x-cfi-key');
    assert.equal(auditBody.liveRead.serviceRoleKeyUsed, false);
    assert.equal(auditBody.integration.sameCycleRegistryMutationPerformed, false);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    await rm(dir, { recursive: true, force: true });
  }
});
