import { spawn } from 'node:child_process';

const ONCE = process.argv.includes('--once');
const rawInterval = Number(process.env.CFI_ORCHESTRATOR_INTERVAL_MINUTES ?? 15);
const INTERVAL_MINUTES = Number.isFinite(rawInterval) && rawInterval >= 1 ? rawInterval : 15;
const INTERVAL_MS = INTERVAL_MINUTES * 60_000;

let stopping = false;

function iso() {
  return new Date().toISOString();
}

function runNode(label, script, args = [], envPatch = {}) {
  return new Promise((resolve, reject) => {
    console.log(`[${iso()}] ORCHESTRATOR START ${label}`);
    const child = spawn(process.execPath, [script, ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...envPatch },
      stdio: 'inherit'
    });
    child.on('error', reject);
    child.on('exit', code => {
      if (code === 0) {
        console.log(`[${iso()}] ORCHESTRATOR PASS ${label}`);
        resolve({ label, ok: true, error: null });
        return;
      }
      reject(new Error(`${label}_FAILED_EXIT_${code}`));
    });
  });
}

async function isolatedSource(label, script, args = [], envPatch = {}) {
  try {
    await runNode(label, script, args, envPatch);
    return { label, ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${iso()}] ORCHESTRATOR SOURCE DEGRADED ${label} | ${message}`);
    return { label, ok: false, error: message };
  }
}

async function runCycle() {
  const startedAt = iso();
  const cycleId = `CFI-CYCLE-${startedAt}`;
  const cycleEnv = { CFI_ORCHESTRATOR_CYCLE_ID: cycleId };

  const [pcNode, tierABrowser, publicDiscovery, webSearchRescue] = await Promise.all([
    isolatedSource('PC_NODE_DISCOVERY_CYCLE', 'local-node/index.mjs', ['--once'], cycleEnv),
    isolatedSource('TIER_A_BROWSER_DISCOVERY', 'local-node/registry/tier-a-browser-discovery.mjs', [], cycleEnv),
    isolatedSource('PUBLIC_DISCOVERY', 'local-node/registry/public-discovery.mjs', [], cycleEnv),
    isolatedSource('WEB_SEARCH_RESCUE_INGEST', 'local-node/registry/web-search-rescue.mjs', [], cycleEnv)
  ]);

  const sourceStates = [pcNode, tierABrowser, publicDiscovery, webSearchRescue];
  const sourceFailures = sourceStates.filter(source => !source.ok);

  try {
    await runNode(
      'DAILY_FIXTURE_REGISTRY',
      'local-node/registry/daily-fixture-registry.mjs',
      [],
      {
        ...cycleEnv,
        ...(pcNode.ok ? {} : { CFI_REGISTRY_SKIP_PC_INPUT: '1' })
      }
    );

    await runNode(
      'ROLLING_EVIDENCE_QUEUES',
      'local-node/registry/rolling-evidence-queues.mjs',
      [],
      cycleEnv
    );

    const evidenceDispatcher = await isolatedSource(
      'SHADOW_EVIDENCE_DISPATCHER',
      'local-node/registry/shadow-evidence-dispatcher.mjs',
      [],
      cycleEnv
    );

    const status = sourceFailures.length === 0 && evidenceDispatcher.ok
      ? 'PASS'
      : 'PASS_WITH_DEGRADED_STAGE';

    console.log(JSON.stringify({
      contract: 'CFI_DISCOVERY_ORCHESTRATOR_V5',
      status,
      cycleId,
      startedAt,
      completedAt: iso(),
      intervalMinutes: INTERVAL_MINUTES,
      rollingHorizonMinutes: Number(process.env.CFI_ROLLING_HORIZON_MINUTES ?? 90),
      sources: { pcNode, tierABrowser, publicDiscovery, webSearchRescue },
      sourceFailures,
      evidenceDispatcher,
      pcNodeIsGatekeeper: false,
      tierABrowserIsGatekeeper: false,
      publicDiscoveryIsGatekeeper: false,
      webSearchRescueIsGatekeeper: false,
      evidenceDispatcherIsGatekeeper: false,
      tierABrowserHasDedicatedRegistryInput: true,
      registryStillRunsWithSourceFailures: true,
      rollingEvidenceQueuesMaterialized: true,
      verifiedRankingQueueMaterialized: true,
      crosscheckRequiredQueueMaterialized: true,
      evidenceRequestPlanMaterialized: true,
      shadowEvidenceReceiptsMaterialized: evidenceDispatcher.ok,
      webCrosscheckPlanMaterialized: evidenceDispatcher.ok,
      nextCycleReverificationPlanMaterialized: evidenceDispatcher.ok,
      bigDbRetrievalReused: true,
      webSearchRescueReused: true,
      liveEvidenceReadRequiresExplicitOptIn: true,
      sameCycleAutoPromotionAllowed: false,
      productionEvidenceWritePerformed: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    }));
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      contract: 'CFI_DISCOVERY_ORCHESTRATOR_V5',
      status: 'FAIL_REGISTRY_OR_QUEUE_BUILD',
      cycleId,
      startedAt,
      completedAt: iso(),
      sources: { pcNode, tierABrowser, publicDiscovery, webSearchRescue },
      sourceFailures,
      error: error instanceof Error ? error.message : String(error),
      note: 'Existing registry/queue/evidence artifacts remain on disk; failed cycles never delete prior fixtures. Consumers must enforce artifact freshness.',
      pcNodeIsGatekeeper: false,
      tierABrowserIsGatekeeper: false,
      publicDiscoveryIsGatekeeper: false,
      webSearchRescueIsGatekeeper: false,
      evidenceDispatcherIsGatekeeper: false,
      sameCycleAutoPromotionAllowed: false,
      productionEvidenceWritePerformed: false,
      predictionExecutionAllowed: false,
      decisionUse: false,
      bigDbWriteAllowed: false
    }));
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => { stopping = true; });
}

if (ONCE) {
  const ok = await runCycle();
  process.exitCode = ok ? 0 : 1;
} else {
  while (!stopping) {
    await runCycle();
    if (!stopping) await sleep(INTERVAL_MS);
  }
}
