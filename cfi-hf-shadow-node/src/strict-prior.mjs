function rowsOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  for (const key of ['fixtures', 'history', 'rows', 'data']) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    const nested = rowsOf(value);
    if (nested.length) return nested;
  }
  for (const key of ['result', 'body']) {
    const nested = rowsOf(payload[key]);
    if (nested.length) return nested;
  }
  return [];
}

function matchDate(row) {
  const value = row?.matchDate ?? row?.match_date ?? row?.date ?? row?.fixture?.match_date ?? row?.fixture?.matchDate;
  const date = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function evidenceTimestamp(row, date) {
  const explicit = row?.evidence_timestamp ?? row?.evidenceTimestamp ?? row?.captured_at ?? row?.capturedAt ?? row?.available_at ?? row?.availableAt;
  if (explicit) {
    const n = Date.parse(String(explicit));
    return Number.isFinite(n) ? new Date(n).toISOString() : null;
  }
  if (!date) return null;
  return `${date}T23:59:59.999Z`;
}

export function auditStrictPrior({ targetDate, predictionLockTime, evidence }) {
  const target = String(targetDate ?? '').slice(0, 10);
  const lockMs = Date.parse(String(predictionLockTime ?? ''));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('STRICT_PRIOR_TARGET_DATE_REQUIRED');
  if (!Number.isFinite(lockMs)) throw new Error('STRICT_PRIOR_LOCK_TIME_REQUIRED');

  const rows = rowsOf(evidence);
  let futureEvidenceCount = 0;
  let sameDateEvidenceCount = 0;
  let invalidTimestampCount = 0;
  let maxEvidenceMs = null;

  for (const row of rows) {
    const date = matchDate(row);
    const timestamp = evidenceTimestamp(row, date);
    const tsMs = timestamp ? Date.parse(timestamp) : NaN;
    if (!date || !Number.isFinite(tsMs)) {
      invalidTimestampCount += 1;
      continue;
    }
    if (date === target) sameDateEvidenceCount += 1;
    if (date > target || tsMs >= lockMs) futureEvidenceCount += 1;
    maxEvidenceMs = maxEvidenceMs === null ? tsMs : Math.max(maxEvidenceMs, tsMs);
  }

  const maxEvidenceTimestamp = maxEvidenceMs === null ? null : new Date(maxEvidenceMs).toISOString();
  const verified = rows.length > 0
    && futureEvidenceCount === 0
    && sameDateEvidenceCount === 0
    && invalidTimestampCount === 0
    && maxEvidenceMs < lockMs;

  return {
    contract: 'CFI_HF_STRICT_PRIOR_AUDIT_V1',
    verified,
    evidenceCount: rows.length,
    futureEvidenceCount,
    sameDateEvidenceCount,
    invalidTimestampCount,
    maxEvidenceTimestamp,
    targetDate: target,
    predictionLockTime: new Date(lockMs).toISOString(),
  };
}

export function auditEvidenceStreams({ targetDate, predictionLockTime, homePayload, awayPayload, h2hPayload }) {
  return auditStrictPrior({
    targetDate,
    predictionLockTime,
    evidence: [...rowsOf(homePayload), ...rowsOf(awayPayload), ...rowsOf(h2hPayload)],
  });
}

export function assertStrictPrior(args) {
  const audit = auditEvidenceStreams(args);
  if (!audit.verified) {
    const error = new Error('STRICT_PRIOR_REJECTED');
    error.audit = audit;
    throw error;
  }
  return audit;
}
