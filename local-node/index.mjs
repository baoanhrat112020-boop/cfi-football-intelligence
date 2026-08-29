import { spawn } from "node:child_process";
import {
  appendFile,
  mkdir,
  open,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { resolve, dirname } from "node:path";

const ROOT = process.cwd();
const STATE_FILE = resolve("local-node/state/node-status.json");
const LOCK_FILE = resolve("local-node/state/node.lock");
const LOG_DIR = resolve("local-node/logs");

const ONCE = process.argv.includes("--once");
const DEEP = process.argv.includes("--deep");

const rawInterval = Number(
  process.env.CFI_NODE_INTERVAL_MINUTES ?? 15
);

const INTERVAL_MINUTES =
  Number.isFinite(rawInterval) && rawInterval >= 1
    ? rawInterval
    : 15;

const INTERVAL_MS = INTERVAL_MINUTES * 60_000;

let lockOwned = false;
let stopping = false;

let state = {
  contract: "CFI_LOCAL_DATA_NODE_STATUS_V1",
  status: "BOOTING",
  progressPercent: 0,
  currentStage: "BOOT",
  cycleId: null,
  lastStartedAt: null,
  lastCompletedAt: null,
  nextRunAt: null,
  intervalMinutes: INTERVAL_MINUTES,
  pid: process.pid,
  summary: null,
  lastError: null
};

function iso() {
  return new Date().toISOString();
}

function logFile() {
  return resolve(
    LOG_DIR,
    `cfi-node-${new Date().toISOString().slice(0, 10)}.log`
  );
}

async function log(message) {
  const line = `[${iso()}] ${message}`;

  console.log(line);

  await mkdir(LOG_DIR, { recursive: true });

  await appendFile(
    logFile(),
    `${line}\n`,
    "utf8"
  );
}

async function saveState(patch = {}) {
  state = {
    ...state,
    ...patch,
    updatedAt: iso()
  };

  await mkdir(dirname(STATE_FILE), {
    recursive: true
  });

  await writeFile(
    STATE_FILE,
    JSON.stringify(state, null, 2),
    "utf8"
  );
}

async function progress(percent, stage, message) {
  await saveState({
    progressPercent: percent,
    currentStage: stage,
    status: "RUNNING"
  });

  await log(
    `CFI NODE ${String(percent).padStart(3, " ")}% | ${stage} | ${message}`
  );
}

async function readJsonSafe(path) {
  try {
    return JSON.parse(
      await readFile(resolve(path), "utf8")
    );
  } catch {
    return null;
  }
}

async function runNode(label, script, args = []) {
  const scriptPath = resolve(script);

  await log(`START ${label}`);

  return await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [scriptPath, ...args],
      {
        cwd: ROOT,
        env: process.env,
        stdio: [
          "ignore",
          "pipe",
          "pipe"
        ]
      }
    );

    child.stdout.on("data", async chunk => {
      const text = String(chunk).trimEnd();

      if (!text) return;

      process.stdout.write(`${text}\n`);

      await appendFile(
        logFile(),
        `${text}\n`,
        "utf8"
      ).catch(() => {});
    });

    child.stderr.on("data", async chunk => {
      const text = String(chunk).trimEnd();

      if (!text) return;

      process.stderr.write(`${text}\n`);

      await appendFile(
        logFile(),
        `[STDERR ${label}] ${text}\n`,
        "utf8"
      ).catch(() => {});
    });

    child.on("error", rejectPromise);

    child.on("exit", code => {
      if (code === 0) {
        resolvePromise();
        return;
      }

      rejectPromise(
        new Error(
          `${label}_FAILED_EXIT_${code}`
        )
      );
    });
  });

  await log(`PASS ${label}`);
}

async function runStage(label, script, args = []) {
  await runNode(label, script, args);
  await log(`PASS ${label}`);
}

async function acquireLock() {
  await mkdir(dirname(LOCK_FILE), {
    recursive: true
  });

  try {
    const handle = await open(
      LOCK_FILE,
      "wx"
    );

    await handle.writeFile(
      JSON.stringify({
        pid: process.pid,
        startedAt: iso()
      })
    );

    await handle.close();

    lockOwned = true;
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  let oldPid = null;

  try {
    const old = JSON.parse(
      await readFile(LOCK_FILE, "utf8")
    );

    oldPid = Number(old?.pid);
  } catch {}

  let active = false;

  if (Number.isInteger(oldPid) && oldPid > 0) {
    try {
      process.kill(oldPid, 0);
      active = true;
    } catch {}
  }

  if (active) {
    throw new Error(
      `CFI_NODE_ALREADY_RUNNING_PID_${oldPid}`
    );
  }

  await rm(LOCK_FILE, {
    force: true
  });

  return acquireLock();
}

async function releaseLock() {
  if (!lockOwned) return;

  await rm(LOCK_FILE, {
    force: true
  }).catch(() => {});

  lockOwned = false;
}

async function buildSummary() {
  const footballData = await readJsonSafe(
    "local-node/cache/football-data-prospective.json"
  );

  const browser = await readJsonSafe(
    "local-node/cache/browser/fixture-candidates.json"
  );

  const cross = await readJsonSafe(
    "local-node/cache/browser/cross-source-verification-audit.json"
  );

  const canonical = await readJsonSafe(
    "local-node/cache/canonical/canonical-merge-audit.json"
  );

  const dryRun = await readJsonSafe(
    "local-node/cache/canonical/bigdb-dry-run-audit.json"
  );

  return {
    footballDataProspective:
      Array.isArray(footballData?.candidates)
        ? footballData.candidates.length
        : Number(footballData?.count ?? 0),

    browserProspective:
      Array.isArray(browser?.fixtures)
        ? browser.fixtures.length
        : 0,

    crossVerifiedStrong:
      Number(
        cross?.crossVerifiedStrong ??
        cross?.verificationStatus?.CROSS_VERIFIED_STRONG ??
        0
      ),

    crossVerifiedTimeDisagreement:
      Number(
        cross?.crossVerifiedTimeDisagreement ??
        cross?.verificationStatus?.CROSS_VERIFIED_TIME_DISAGREEMENT ??
        0
      ),

    crossProviderConflicts:
      Number(
        cross?.conflicts ??
        cross?.crossProviderConflicts ??
        0
      ),

    canonicalFixtures:
      Number(
        canonical?.canonicalFixtures ??
        0
      ),

    eligibleProspectiveDryRun:
      Number(
        dryRun?.eligibleDryRunRows ??
        0
      ),

    blockedProspective:
      Number(
        dryRun?.blockedRows ??
        0
      ),

    duplicateCanonicalIds:
      Number(
        dryRun?.duplicateCanonicalIds ??
        0
      ),

    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  };
}

async function runDeepMaintenance() {
  await progress(
    8,
    "DEEP_SYNC",
    "Historical/OpenFootball maintenance"
  );

  await Promise.all([
    runStage(
      "HISTORICAL_REGISTRY",
      "local-node/harvester/football-data/historical-registry-runner.mjs"
    ),

    runStage(
      "OPENFOOTBALL_SYNC",
      "local-node/harvester/openfootball/sync.mjs"
    )
  ]);

  await Promise.all([
    runStage(
      "HISTORICAL_AUDIT",
      "local-node/harvester/football-data/historical-audit.mjs"
    ),

    runStage(
      "OPENFOOTBALL_AUDIT",
      "local-node/harvester/openfootball/world-audit.mjs"
    )
  ]);

  await runStage(
    "OPENFOOTBALL_PARSE",
    "local-node/harvester/openfootball/world-parse.mjs"
  );
}

async function runCycle() {
  const cycleId =
    `CFI-${Date.now()}-${process.pid}`;

  await saveState({
    cycleId,
    lastStartedAt: iso(),
    lastError: null,
    summary: null
  });

  try {
    await progress(
      2,
      "START",
      `Cycle ${cycleId}`
    );

    if (DEEP) {
      await runDeepMaintenance();
    }

    await progress(
      15,
      "FOOTBALL_DATA",
      "Refreshing Football-Data fixture feed"
    );

    await runStage(
      "FOOTBALL_DATA_FIXTURE_REFRESH",
      "local-node/fixture-refresh.mjs"
    );

    await progress(
      30,
      "BROWSER",
      "Refreshing Soccerway + Sofascore in parallel"
    );

    await Promise.all([
      runStage(
        "SOCCERWAY",
        "local-node/browser/fixture-collector/soccerway-adapter.mjs"
      ),

      runStage(
        "SOFASCORE",
        "local-node/browser/fixture-collector/sofascore-adapter.mjs"
      )
    ]);

    await progress(
      55,
      "CROSS_VERIFY",
      "Cross-source verification"
    );

    await runStage(
      "CROSS_VERIFY",
      "local-node/browser/fixture-collector/cross-verify.mjs"
    );

    await progress(
      72,
      "CANONICAL",
      "Canonical fixture merge"
    );

    await runStage(
      "CANONICAL_MERGE",
      "local-node/canonical/canonical-merge.mjs"
    );

    await progress(
      88,
      "DRY_RUN",
      "Prospective store dry-run gate"
    );

    await runStage(
      "PROSPECTIVE_DRY_RUN",
      "local-node/canonical/bigdb-dry-run.mjs"
    );

    await progress(
      97,
      "AUDIT",
      "Building Local Node cycle summary"
    );

    const summary =
      await buildSummary();

    const completedAt = iso();

    const nextRunAt =
      ONCE
        ? null
        : new Date(
            Date.now() + INTERVAL_MS
          ).toISOString();

    await saveState({
      status: "PASS",
      progressPercent: 100,
      currentStage: "COMPLETE",
      lastCompletedAt: completedAt,
      nextRunAt,
      summary,
      lastError: null
    });

    await log(
      `CFI NODE 100% | COMPLETE | ${JSON.stringify(summary)}`
    );

    return true;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    await saveState({
      status: "FAIL",
      lastCompletedAt: iso(),
      lastError: {
        stage: state.currentStage,
        message
      }
    });

    await log(
      `CFI NODE FAIL | ${state.currentStage} | ${message}`
    );

    return false;
  }
}

async function main() {
  await acquireLock();

  await saveState({
    status: "READY",
    pid: process.pid,
    intervalMinutes:
      INTERVAL_MINUTES
  });

  await log(
    `CFI LOCAL DATA NODE START | pid=${process.pid} | interval=${INTERVAL_MINUTES}m | once=${ONCE} | deep=${DEEP}`
  );

  if (ONCE) {
    const ok = await runCycle();

    await releaseLock();

    process.exitCode =
      ok ? 0 : 1;

    return;
  }

  while (!stopping) {
    await runCycle();

    if (stopping) break;

    const next =
      new Date(
        Date.now() + INTERVAL_MS
      ).toISOString();

    await saveState({
      status: "SLEEPING",
      currentStage: "WAIT",
      progressPercent: 100,
      nextRunAt: next
    });

    await log(
      `NEXT CYCLE ${next}`
    );

    await new Promise(resolvePromise => {
      const timer = setTimeout(
        resolvePromise,
        INTERVAL_MS
      );

      const check = setInterval(() => {
        if (!stopping) return;

        clearTimeout(timer);
        clearInterval(check);
        resolvePromise();
      }, 250);
    });
  }

  await saveState({
    status: "STOPPED",
    currentStage: "STOPPED",
    nextRunAt: null
  });

  await releaseLock();
}

process.on("SIGINT", () => {
  stopping = true;
});

process.on("SIGTERM", () => {
  stopping = true;
});

process.on("exit", () => {
  if (lockOwned) {
    try {
      const fs = require("node:fs");
      fs.rmSync(LOCK_FILE, {
        force: true
      });
    } catch {}
  }
});

await main();

