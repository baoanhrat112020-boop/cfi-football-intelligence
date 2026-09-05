#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';

const clean = value => String(value ?? '').trim();

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function saveJson(file, body) {
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(body, null, 2), 'utf8');
}

function runChild(script, env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, ['--experimental-strip-types', script], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', code => resolvePromise({ code, stdout, stderr }));
  });
}

function assertShadowSafety({ supplement, audit, aliasAudit }) {
  if (supplement?.decisionUse !== false || supplement?.bigDbWriteAllowed !== false || supplement?.bigDbWriteAttempted !== false) {
    throw new Error('SHADOW_SUPPLEMENT_SAFETY_CHANGED');
  }
  if (audit?.safety?.decisionUse !== false || audit?.safety?.bigDbWriteAllowed !== false || audit?.safety?.bigDbWriteAttempted !== false) {
    throw new Error('SHADOW_AUDIT_SAFETY_CHANGED');
  }
  if (audit?.policy?.providerIdRequired !== true || audit?.policy?.providerIdSyntheticFallbackAllowed !== false) {
    throw new Error('SHADOW_PROVIDER_ID_POLICY_WEAKENED');
  }
  if (audit?.policy?.providerIdMayBeDerivedOnlyFromWhitelistedFirstPartyEventUrl !== true) {
    throw new Error('SHADOW_PROVIDER_ID_DERIVATION_POLICY_WEAKENED');
  }
  if (audit?.policy?.matchupSlugAcceptedAsProviderId !== false || audit?.policy?.providerMismatchDerivationAllowed !== false) {
    throw new Error('SHADOW_PROVIDER_ID_UNSAFE_DERIVATION_ENABLED');
  }
  if (aliasAudit?.policy?.autoAliasAllowed !== false || aliasAudit?.policy?.bigDbWriteAllowed !== false || aliasAudit?.policy?.decisionUse !== false) {
    throw new Error('SHADOW_ALIAS_POLICY_WEAKENED');
  }
  if ((supplement?.rows ?? []).some(row => row?.sourceClass !== 'WEB_SEARCH_RESCUE')) {
    throw new Error('SHADOW_UNEXPECTED_SOURCE_CLASS');
  }
}

export async function runWebRescueShadowInjection({
  inputFile,
  targetDate,
  timeZone = 'Asia/Ho_Chi_Minh',
  reportFile = null,
  keepTemp = false
} = {}) {
  const input = resolve(clean(inputFile));
  if (!clean(inputFile)) throw new Error('CFI_WEB_RESCUE_SHADOW_INPUT_REQUIRED');
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(clean(targetDate))) throw new Error('CFI_TARGET_DATE_REQUIRED');

  const inputBody = await readJson(input);
  const inputCandidates = Array.isArray(inputBody)
    ? inputBody
    : Array.isArray(inputBody?.candidates)
      ? inputBody.candidates
      : null;
  if (!inputCandidates) throw new Error('CFI_WEB_RESCUE_SHADOW_INPUT_SHAPE_INVALID');

  const sandbox = await mkdtemp(join(tmpdir(), 'cfi-web-rescue-shadow-'));
  const output = join(sandbox, 'web-search-rescue.json');
  const auditOutput = join(sandbox, 'web-search-rescue-audit.json');
  const unresolved = join(sandbox, 'unresolved.json');
  const aliasAudit = join(sandbox, 'web-alias-gap-audit.json');
  await saveJson(unresolved, { contract: 'CFI_SHADOW_UNRESOLVED_EMPTY_V1', rows: [] });

  const startedAt = new Date().toISOString();
  let childResult;
  try {
    childResult = await runChild('local-node/registry/web-search-rescue.mjs', {
      CFI_WEB_RESCUE_INPUT_FILE: input,
      CFI_WEB_RESCUE_OUTPUT_FILE: output,
      CFI_WEB_RESCUE_AUDIT_FILE: auditOutput,
      CFI_WEB_RESCUE_UNRESOLVED_FILE: unresolved,
      CFI_WEB_ALIAS_GAP_AUDIT_FILE: aliasAudit,
      CFI_TARGET_DATE: targetDate,
      CFI_TIME_ZONE: timeZone
    });

    if (childResult.code !== 0) {
      throw new Error(`WEB_RESCUE_RUNTIME_FAILED:${childResult.code}:${clean(childResult.stderr).slice(0, 500)}`);
    }

    const [supplement, audit, alias] = await Promise.all([
      readJson(output),
      readJson(auditOutput),
      readJson(aliasAudit)
    ]);
    if (clean(audit?.status).startsWith('FAIL_')) {
      throw new Error(`WEB_RESCUE_RUNTIME_AUDIT_FAILED:${audit.status}`);
    }
    assertShadowSafety({ supplement, audit, aliasAudit: alias });

    const report = {
      contract: 'CFI_WEB_RESCUE_SHADOW_INJECTION_V1',
      generatedAt: new Date().toISOString(),
      startedAt,
      status: 'PASS',
      targetDate,
      timeZone,
      runner: {
        implementation: 'local-node/registry/web-search-rescue.mjs',
        actualRuntimePathExecuted: true,
        exitCode: childResult.code
      },
      input: {
        file: input,
        candidates: inputCandidates.length
      },
      runtime: {
        auditContract: audit?.contract ?? null,
        auditStatus: audit?.status ?? null,
        accepted: Number(audit?.accepted ?? supplement?.rows?.length ?? 0),
        rejected: Number(audit?.rejected ?? supplement?.rejected?.length ?? 0),
        aliasReviewRequired: Number(audit?.aliasReviewRequired ?? 0),
        providerIdDerivations: Array.isArray(supplement?.providerIdDerivations)
          ? supplement.providerIdDerivations
          : [],
        rows: Array.isArray(supplement?.rows)
          ? supplement.rows.map(row => ({
              sourceClass: row?.sourceClass ?? null,
              provider: row?.provider ?? null,
              providerId: row?.providerId ?? null,
              home: row?.home ?? null,
              away: row?.away ?? null,
              kickoffIso: row?.kickoffIso ?? null,
              targetDate: row?.targetDate ?? null,
              sourceUrl: row?.sourceUrl ?? null,
              sourceTier: row?.sourceTier ?? null,
              sourceKey: row?.sourceKey ?? null
            }))
          : []
      },
      isolation: {
        temporaryDirectory: sandbox,
        registryInvoked: false,
        orchestratorInvoked: false,
        predictionExecutionAllowed: false,
        bigDbNetworkInvoked: false,
        bigDbWriteAllowed: false,
        productionMutationAllowed: false,
        autoAliasAllowed: false,
        canonicalTeamCreateAllowed: false,
        inputFileModified: false
      },
      policy: {
        usesExistingWebRescueImplementation: true,
        providerIdRequired: audit?.policy?.providerIdRequired === true,
        syntheticProviderIdAllowed: false,
        firstPartyWhitelistedEventUrlOnly: true,
        sourceTrustPromotionPerformed: false,
        runtimeFixtureDataCommitted: false,
        decisionUse: false
      }
    };

    if (reportFile) await saveJson(resolve(reportFile), report);
    console.log(JSON.stringify(report));
    return report;
  } finally {
    if (!keepTemp) await rm(sandbox, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const inputFile = clean(process.env.CFI_WEB_RESCUE_SHADOW_INPUT || process.argv[2]);
  const targetDate = clean(process.env.CFI_TARGET_DATE);
  const timeZone = clean(process.env.CFI_TIME_ZONE) || 'Asia/Ho_Chi_Minh';
  const reportFile = clean(process.env.CFI_WEB_RESCUE_SHADOW_REPORT) || null;
  const keepTemp = process.env.CFI_WEB_RESCUE_SHADOW_KEEP_TEMP === '1';
  await runWebRescueShadowInjection({ inputFile, targetDate, timeZone, reportFile, keepTemp });
}
