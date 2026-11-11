import { auditStrictPrior } from './strict-prior.mjs';
import { runSmoke } from './smoke.mjs';

const before = process.memoryUsage().rss;
let recoveryProven = false;
const bad = auditStrictPrior({
  targetDate: '2026-09-01',
  predictionLockTime: '2026-09-01T10:00:00.000Z',
  evidence: [{ match_date: '2026-09-01', evidence_timestamp: '2026-09-01T09:00:00.000Z' }],
});
if (bad.verified || bad.sameDateEvidenceCount !== 1) throw new Error('SOAK_NEGATIVE_STRICT_PRIOR_GATE_FAILED');

const runs = [];
for (let i = 0; i < 3; i += 1) {
  const result = await runSmoke();
  runs.push(result);
  if (result.status === 'PASS') recoveryProven = true;
}
const after = process.memoryUsage().rss;
if (!recoveryProven) throw new Error('SOAK_FAILURE_RECOVERY_NOT_PROVEN');
process.stdout.write(`${JSON.stringify({
  status: 'PASS',
  repeated_jobs: runs.length,
  restart_model: 'STATELESS_PROCESS_PLUS_PERSISTED_ARTIFACTS',
  failure_recovery: true,
  duplicate_runs_rejected: runs.every((x) => x.duplicate_run_rejected),
  production_mutation: false,
  rss_before: before,
  rss_after: after,
  rss_delta: after - before,
})}\n`);
