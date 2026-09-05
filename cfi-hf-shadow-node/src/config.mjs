import { resolve } from 'node:path';

const FORBIDDEN_WRITE_ENV = Object.freeze([
  'SUPABASE_SERVICE_ROLE_KEY',
  'CFI_SUPABASE_SERVICE_ROLE_KEY',
  'CFI_ACTION_KEY',
  'CFI_WRITE_KEY',
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_KEY',
]);

export function assertShadowEnvironment(env = process.env) {
  if (String(env.CFI_HF_SHADOW_MODE ?? '1') !== '1') throw new Error('CFI_HF_SHADOW_MODE_REQUIRED');
  const present = FORBIDDEN_WRITE_ENV.filter((name) => String(env[name] ?? '').trim());
  if (present.length) throw new Error(`PRODUCTION_WRITE_SECRET_FORBIDDEN:${present.join(',')}`);
  return { shadowMode: true, productionWriteSecretsPresent: false };
}

export function runtimeConfig(env = process.env) {
  assertShadowEnvironment(env);
  const port = Number(env.PORT ?? 7860);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('INVALID_PORT');
  return {
    port,
    artifactRoot: resolve(env.CFI_HF_ARTIFACT_ROOT ?? 'cfi-hf-shadow-node/artifacts'),
    maxBodyBytes: Math.max(16_384, Number(env.CFI_HF_MAX_BODY_BYTES ?? 1_048_576)),
  };
}
