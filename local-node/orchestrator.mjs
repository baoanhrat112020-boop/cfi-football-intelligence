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
        resolve();
        return;
      }

      reject(new Error(`${label}_FAILED_EXIT_${code}`));
    });
  });
}

async function runCycle() {
  const startedAt = iso();
  let pcNodeOk = true;
  let pcNodeError = null;

  try {
    await runNode(
      'PC_NODE_DISCOVERY_CYCLE',
      'local-node/index.mjs',
      ['--once']
    );
  } catch (error) {
    pcNodeOk = false;
    pcNodeError = error instanceof Error ? error.message : String(error);
    console.error(
      `[${iso()}] ORCHESTRATOR PC_NODE DEGRADED | ${pcNodeError}`
    );
  }

  try {
    await runNode(
      'DAILY_FIXTURE_REGISTRY',
      'local-node/registry/daily-fixture-registry.mjs',
      [],
      pcNodeOk
        ? {}
        : { CFI_REGISTRY_SKIP_PC_INPUT: '1' }
    );

    const status = pcNodeOk
      ? 'PASS'
      : 'PASS_WITH_PC_NODE_FAILURE';

    console.log(JSON.stringify({
      contract: 'CFI_DISCOVERY_ORCHESTRATOR_V1',
      status,
      startedAt,
      completedAt: iso(),
      intervalMinutes: INTERVAL_MINUTES,
      rollingHorizonMinutes: Number(
        process.env.CFI_ROLLING_HORIZON_MINUTES ?? 90
      ),
      pcNode: {
        ok: pcNodeOk,
        error: pcNodeError
      },
      pcNodeIsGatekeeper: false,
      registryStillRunsWithoutPcNode: true,
      decisionUse: false,
      bigDbWriteAllowed: false
    }));

    return true;
  } catch (error) {
    console.error(JSON.stringify({
      contract: 'CFI_DISCOVERY_ORCHESTRATOR_V1',
      status: 'FAIL',
      startedAt,
      completedAt: iso(),
      pcNode: {
        ok: pcNodeOk,
        error: pcNodeError
      },
      error: error instanceof Error ? error.message : String(error),
      note: 'Existing daily registry remains on disk; failed cycles never delete prior fixtures.',
      pcNodeIsGatekeeper: false,
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
