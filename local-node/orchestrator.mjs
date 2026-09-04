import { spawn } from 'node:child_process';

const ONCE = process.argv.includes('--once');
const rawInterval = Number(process.env.CFI_ORCHESTRATOR_INTERVAL_MINUTES ?? 15);
const INTERVAL_MINUTES =
  Number.isFinite(rawInterval) && rawInterval >= 1
    ? rawInterval
    : 15;
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
      env: {
        ...process.env,
        ...envPatch
      },
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

async function isolatedSource(label, script, args = []) {
  try {
    await runNode(label, script, args);
    return { label, ok: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${iso()}] ORCHESTRATOR SOURCE DEGRADED ${label} | ${message}`);
    return { label, ok: false, error: message };
  }
}

async function runCycle() {
  const startedAt = iso();

  const [pcNode, publicDiscovery, webSearchRescue] = await Promise.all([
    isolatedSource(
      'PC_NODE_DISCOVERY_CYCLE',
      'local-node/index.mjs',
      ['--once']
    ),
    isolatedSource(
      'PUBLIC_DISCOVERY',
      'local-node/registry/public-discovery.mjs'
    ),
    isolatedSource(
      'WEB_SEARCH_RESCUE_INGEST',
      'local-node/registry/web-search-rescue.mjs'
    )
  ]);

  const sourceStates = [pcNode, publicDiscovery, webSearchRescue];
  const sourceFailures = sourceStates.filter(source => !source.ok);

  try {
    await runNode(
      'DAILY_FIXTURE_REGISTRY',
      'local-node/registry/daily-fixture-registry.mjs',
      [],
      pcNode.ok
        ? {}
        : { CFI_REGISTRY_SKIP_PC_INPUT: '1' }
    );

    const status = sourceFailures.length === 0
      ? 'PASS'
      : 'PASS_WITH_SOURCE_FAILURES';

    console.log(JSON.stringify({
      contract: 'CFI_DISCOVERY_ORCHESTRATOR_V2',
      status,
      startedAt,
      completedAt: iso(),
      intervalMinutes: INTERVAL_MINUTES,
      rollingHorizonMinutes: Number(
        process.env.CFI_ROLLING_HORIZON_MINUTES ?? 90
      ),
      sources: {
        pcNode,
        publicDiscovery,
        webSearchRescue
      },
      sourceFailures,
      pcNodeIsGatekeeper: false,
      publicDiscoveryIsGatekeeper: false,
      webSearchRescueIsGatekeeper: false,
      registryStillRunsWithSourceFailures: true,
      decisionUse: false,
      bigDbWriteAllowed: false
    }));

    return true;
  } catch (error) {
    console.error(JSON.stringify({
      contract: 'CFI_DISCOVERY_ORCHESTRATOR_V2',
      status: 'FAIL_REGISTRY',
      startedAt,
      completedAt: iso(),
      sources: {
        pcNode,
        publicDiscovery,
        webSearchRescue
      },
      sourceFailures,
      error: error instanceof Error ? error.message : String(error),
      note: 'Existing daily registry remains on disk; failed cycles never delete prior fixtures.',
      pcNodeIsGatekeeper: false,
      publicDiscoveryIsGatekeeper: false,
      webSearchRescueIsGatekeeper: false,
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
  process.on(signal, () => {
    stopping = true;
  });
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
