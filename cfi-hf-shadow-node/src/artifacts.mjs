import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { buildInfo, shadowStamp } from './contracts.mjs';

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export function newRunId(kind) {
  return `HF-${String(kind).toUpperCase()}-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
}

export async function persistRunArtifact({ root, runId, kind, dataset, modelVersion, strictPriorAudit, output }) {
  const safeRunId = String(runId ?? '').trim();
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(safeRunId)) throw new Error('INVALID_RUN_ID');
  const base = resolve(root);
  await mkdir(base, { recursive: true });
  const dir = join(base, safeRunId);
  await mkdir(dir, { recursive: false });

  const outputText = `${JSON.stringify(output, null, 2)}\n`;
  const outputSha256 = sha256(outputText);
  const manifest = shadowStamp({
    contract: 'CFI_HF_SHADOW_ARTIFACT_MANIFEST_V1',
    run_id: safeRunId,
    job_kind: kind,
    created_at: new Date().toISOString(),
    dataset: dataset ? {
      version: dataset.dataset_version,
      sha256: dataset.sha256,
      byte_length: dataset.byte_length,
    } : null,
    build: buildInfo(),
    model_challenger_version: modelVersion ?? buildInfo().model_challenger_version,
    strict_prior_audit: strictPriorAudit ?? null,
    output: { file: 'output.json', sha256: outputSha256 },
  });

  const outTmp = join(dir, 'output.json.tmp');
  const manifestTmp = join(dir, 'manifest.json.tmp');
  await writeFile(outTmp, outputText, 'utf8');
  await writeFile(manifestTmp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(outTmp, join(dir, 'output.json'));
  await rename(manifestTmp, join(dir, 'manifest.json'));
  return { dir, manifest };
}

export async function readRunManifest(root, runId) {
  const safeRunId = String(runId ?? '').trim();
  if (!/^[A-Za-z0-9._-]{8,120}$/.test(safeRunId)) throw new Error('INVALID_RUN_ID');
  return JSON.parse(await readFile(join(resolve(root), safeRunId, 'manifest.json'), 'utf8'));
}
