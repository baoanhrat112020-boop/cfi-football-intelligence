const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim().replace(/\s+/g,' ');

export function normalizeTeamName(name) {
  return norm(name);
}

export function assertVerifiedFixture(input = {}) {
  const v = input.fixtureVerification;
  if (!v || v.verificationStatus !== 'VERIFIED') throw new Error('FIXTURE_NOT_VERIFIED');
  if (!v.fixtureId) throw new Error('VERIFIED_FIXTURE_ID_REQUIRED');
  if (String(v.targetDate ?? '') !== String(input.targetDate ?? '')) throw new Error('FIXTURE_TARGET_DATE_MISMATCH');
  const expectedKickoff = Date.parse(String(v.kickoffAt ?? ''));
  const actualKickoff = Date.parse(String(input.kickoffAt ?? ''));
  if (!Number.isFinite(expectedKickoff) || !Number.isFinite(actualKickoff) || expectedKickoff !== actualKickoff) {
    throw new Error('FIXTURE_KICKOFF_MISMATCH');
  }
  if (norm(v.homeTeam) !== norm(input.homeTeam) || norm(v.awayTeam) !== norm(input.awayTeam)) {
    throw new Error('FIXTURE_IDENTITY_MISMATCH');
  }
  if (!v.sourceName || !v.sourceUrl) throw new Error('FIXTURE_PROVENANCE_REQUIRED');
  return true;
}

export function assertSnapshotSource(input = {}) {
  if (!input.sourceSnapshotId) throw new Error('SOURCE_SNAPSHOT_ID_REQUIRED');
  if (!input.sourcePredictionHash) throw new Error('SOURCE_PREDICTION_HASH_REQUIRED');
  if (!['DATA_READY','SUCCESS'].includes(String(input.sourceSnapshotStatus ?? ''))) {
    throw new Error('SOURCE_SNAPSHOT_NOT_READY');
  }
  if (String(input.sourceSnapshotTargetDate ?? '') !== String(input.targetDate ?? '')) {
    throw new Error('SOURCE_SNAPSHOT_TARGET_DATE_MISMATCH');
  }
  if (norm(input.sourceSnapshotHomeTeam) !== norm(input.homeTeam) || norm(input.sourceSnapshotAwayTeam) !== norm(input.awayTeam)) {
    throw new Error('SOURCE_SNAPSHOT_IDENTITY_MISMATCH');
  }
  const created = Date.parse(String(input.sourceSnapshotCreatedAt ?? ''));
  const kickoff = Date.parse(String(input.kickoffAt ?? ''));
  if (!Number.isFinite(created)) throw new Error('SOURCE_SNAPSHOT_CREATED_AT_REQUIRED');
  if (!Number.isFinite(kickoff)) throw new Error('INVALID_KICKOFF_AT');
  if (created >= kickoff) throw new Error('SOURCE_SNAPSHOT_NOT_PREMATCH');
  return true;
}
