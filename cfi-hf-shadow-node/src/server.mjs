import http from 'node:http';
import { mkdir } from 'node:fs/promises';
import { buildInfo, shadowStamp } from './contracts.mjs';
import { runtimeConfig } from './config.mjs';
import { newRunId, persistRunArtifact, readRunManifest } from './artifacts.mjs';
import { runJob } from './jobs.mjs';

const config = runtimeConfig();
await mkdir(config.artifactRoot, { recursive: true });
let inFlight = false;

function log(event, fields = {}) {
  process.stdout.write(`${JSON.stringify({ ts: new Date().toISOString(), event, ...shadowStamp(), ...fields })}\n`);
}

function send(res, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

async function bodyJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > config.maxBodyBytes) throw new Error('REQUEST_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw new Error('INVALID_JSON'); }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, shadowStamp({
        status: 'PASS',
        mode: 'HF_SHADOW_ONLY',
        production_dependency: false,
        production_write_capability: false,
        build: buildInfo(),
      }));
    }
    const runMatch = url.pathname.match(/^\/v1\/runs\/([A-Za-z0-9._-]{8,120})\/manifest$/);
    if (req.method === 'GET' && runMatch) {
      return send(res, 200, await readRunManifest(config.artifactRoot, runMatch[1]));
    }
    if (req.method === 'POST' && url.pathname === '/v1/jobs') {
      if (inFlight) return send(res, 429, shadowStamp({ status: 'BUSY', retryable: true }));
      const spec = await bodyJson(req);
      const runId = String(spec.run_id ?? newRunId(spec.kind));
      inFlight = true;
      log('job_start', { run_id: runId, kind: spec.kind });
      try {
        const result = await runJob(spec);
        const persisted = await persistRunArtifact({
          root: config.artifactRoot,
          runId,
          kind: result.kind,
          dataset: result.dataset,
          modelVersion: result.modelVersion,
          strictPriorAudit: result.strictPriorAudit,
          output: result.output,
        });
        log('job_pass', { run_id: runId, kind: result.kind, artifact_dir: persisted.dir });
        return send(res, 200, shadowStamp({ status: 'PASS', run_id: runId, manifest: persisted.manifest }));
      } finally {
        inFlight = false;
      }
    }
    return send(res, 404, shadowStamp({ status: 'NOT_FOUND' }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('request_fail', { message });
    const status = message === 'REQUEST_BODY_TOO_LARGE' ? 413 : message === 'INVALID_JSON' ? 400 : 422;
    return send(res, status, shadowStamp({ status: 'FAIL_CLOSED', reason: message, strict_prior_audit: error?.audit ?? null }));
  }
});

server.listen(config.port, '0.0.0.0', () => log('boot', { port: config.port, artifact_root: config.artifactRoot, build: buildInfo() }));
