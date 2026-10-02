import { hash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HF_INPUT_CONTRACT } from './contracts.mjs';

export function sha256Bytes(bytes) {
  return hash('sha256', bytes, 'hex');
}

export async function sha256File(path) {
  return sha256Bytes(await readFile(path));
}

async function readLocation(location, fetchImpl = fetch) {
  const value = String(location ?? '').trim();
  if (!value) throw new Error('PINNED_ARTIFACT_LOCATION_REQUIRED');
  if (/^https:\/\//i.test(value)) {
    const url = new URL(value);
    if (url.hostname === 'supabase.co' || url.hostname.endsWith('.supabase.co')) {
      throw new Error('DIRECT_SUPABASE_ARTIFACT_READ_FORBIDDEN');
    }
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`PINNED_ARTIFACT_FETCH_FAILED:${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (/^[a-z]+:\/\//i.test(value)) {
    if (!value.startsWith('file://')) throw new Error('UNSUPPORTED_ARTIFACT_SCHEME');
    return readFile(fileURLToPath(value));
  }
  return readFile(resolve(value));
}

export async function loadPinnedArtifact(spec, options = {}) {
  if (!spec || typeof spec !== 'object') throw new Error('PINNED_ARTIFACT_SPEC_REQUIRED');
  const expected = String(spec.sha256 ?? '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('PINNED_ARTIFACT_SHA256_REQUIRED');
  const bytes = await readLocation(spec.location, options.fetchImpl);
  const actual = sha256Bytes(bytes);
  if (actual !== expected) throw new Error(`PINNED_ARTIFACT_HASH_MISMATCH:${actual}`);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('PINNED_ARTIFACT_JSON_INVALID'); }
  const datasetVersion = String(spec.version ?? payload?.dataset_version ?? payload?.manifestVersion ?? payload?.version ?? '').trim();
  if (!datasetVersion) throw new Error('PINNED_ARTIFACT_VERSION_REQUIRED');
  return {
    contract: HF_INPUT_CONTRACT,
    location: String(spec.location),
    sha256: actual,
    dataset_version: datasetVersion,
    byte_length: bytes.length,
    payload,
  };
}
