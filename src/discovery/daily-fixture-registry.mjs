const TERMINAL = new Set([
  'finished',
  'ft',
  'match finished',
  'cancelled',
  'canceled',
  'postponed',
  'abandoned'
]);

const clean = value => String(value ?? '').trim();

export const DAILY_FIXTURE_REGISTRY_CONTRACT =
  'CFI_DAILY_FIXTURE_REGISTRY_V1';

export const ROLLING_FIXTURE_WINDOW_CONTRACT =
  'CFI_ROLLING_FIXTURE_WINDOW_V1';

function foldExact(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function localParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(ms));

  const get = type =>
    parts.find(part => part.type === type)?.value ?? '';

  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`
  };
}

function finiteMs(value) {
  const parsed = Date.parse(clean(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function minIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function maxIso(a, b) {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function sourceKey(source) {
  return [
    clean(source.sourceClass).toUpperCase(),
    clean(source.provider).toUpperCase(),
    clean(source.providerId),
    clean(source.kickoffIso),
    clean(source.sourceUrl)
  ].join('|');
}

function kickoffSourceKey(source) {
  return [
    clean(source.sourceClass).toUpperCase(),
    clean(source.provider).toUpperCase(),
    clean(source.providerId),
    clean(source.sourceUrl)
  ].join('|');
}

export function registryIdentityKey(row, targetDate = null) {
  const home =
    clean(row?.canonicalHomeId ?? row?.canonical_home_key) ||
    foldExact(row?.home ?? row?.home_team);

  const away =
    clean(row?.canonicalAwayId ?? row?.canonical_away_key) ||
    foldExact(row?.away ?? row?.away_team);

  const date = clean(targetDate ?? row?.targetDate ?? row?.target_date);

  if (!home || !away || !date) return null;
  return `${home}|${away}|${date}`;
}

export function normalizeRegistryObservation(
  row,
  {
    targetDate = null,
    timeZone = 'Asia/Ho_Chi_Minh',
    observedAt = new Date().toISOString(),
    sourceClass = null
  } = {}
) {
  const home = clean(row?.home ?? row?.home_team);
  const away = clean(row?.away ?? row?.away_team);
  const kickoffRaw =
    row?.kickoffIso ??
    row?.kickoff_utc ??
    row?.kickoffAt ??
    row?.kickoff_at ??
    row?.kickoff;

  const kickoffMs = finiteMs(kickoffRaw);
  const observedMs = finiteMs(
    row?.observedAt ?? row?.discoveredAt ?? observedAt
  );

  if (!home || !away) {
    return { accepted: false, reason: 'TEAM_REQUIRED', row };
  }

  if (kickoffMs === null) {
    return { accepted: false, reason: 'KICKOFF_REQUIRED', row };
  }

  if (observedMs === null) {
    return { accepted: false, reason: 'OBSERVED_AT_REQUIRED', row };
  }

  const local = localParts(kickoffMs, timeZone);
  const expectedDate = clean(targetDate) || local.date;

  if (local.date !== expectedDate) {
    return {
      accepted: false,
      reason: 'TARGET_DATE_MISMATCH',
      row,
      observedTargetDate: local.date
    };
  }

  const canonicalHomeId = clean(
    row?.canonicalHomeId ??
    row?.canonicalHomeTeamId ??
    row?.canonical_home_key ??
    row?.canonical_home_team_id
  ) || null;

  const canonicalAwayId = clean(
    row?.canonicalAwayId ??
    row?.canonicalAwayTeamId ??
    row?.canonical_away_key ??
    row?.canonical_away_team_id
  ) || null;

  const provider = clean(
    row?.provider ??
    row?.source_id ??
    row?.origin ??
    'UNKNOWN'
  ).toUpperCase();

  const resolvedSourceClass = clean(
    row?.sourceClass ?? sourceClass ?? row?.origin ?? provider
  ).toUpperCase();

  const status = clean(row?.status ?? 'scheduled').toLowerCase();
  const upstreamVerificationStatus = clean(
    row?.upstreamVerificationStatus ??
    row?.verificationStatus ??
    row?.verification_status
  ).toUpperCase() || null;

  const normalized = {
    home,
    away,
    canonicalHomeId,
    canonicalAwayId,
    targetDate: expectedDate,
    kickoffIso: new Date(kickoffMs).toISOString(),
    kickoffLocal: local.time,
    competition: clean(row?.competition) || null,
    country: clean(row?.country) || null,
    status,
    terminal: TERMINAL.has(status),
    upstreamVerificationStatus,
    upstreamFailClosed:
      Boolean(upstreamVerificationStatus) &&
      upstreamVerificationStatus.includes('FAIL_CLOSED'),
    observedAt: new Date(observedMs).toISOString(),
    sourceClass: resolvedSourceClass,
    provider,
    providerId: clean(
      row?.providerId ??
      row?.provider_id ??
      row?.sourceFixtureId ??
      row?.canonical_fixture_id
    ) || null,
    sourceUrl: clean(row?.sourceUrl ?? row?.source_url) || null
  };

  const identityKey = registryIdentityKey(normalized, expectedDate);

  if (!identityKey) {
    return { accepted: false, reason: 'IDENTITY_REQUIRED', row };
  }

  return {
    accepted: true,
    observation: {
      ...normalized,
      identityKey
    }
  };
}

function cloneList(list) {
  return Array.isArray(list) ? list.map(value => ({ ...value })) : [];
}

function cloneEntry(entry) {
  return {
    ...entry,
    sourceObservations: cloneList(entry?.sourceObservations),
    terminalObservations: cloneList(entry?.terminalObservations),
    blockingObservations: cloneList(entry?.blockingObservations),
    kickoffCandidates: Array.isArray(entry?.kickoffCandidates)
      ? entry.kickoffCandidates.map(candidate => ({
          ...candidate,
          sources: cloneList(candidate?.sources)
        }))
      : []
  };
}

function newEntry(observation) {
  return {
    contract: 'CFI_DAILY_FIXTURE_ENTRY_V1',
    identityKey: observation.identityKey,
    targetDate: observation.targetDate,
    canonicalHomeId: observation.canonicalHomeId,
    canonicalAwayId: observation.canonicalAwayId,
    home: observation.home,
    away: observation.away,
    competition: observation.competition,
    country: observation.country,
    firstSeenAt: observation.observedAt,
    lastSeenAt: observation.observedAt,
    seenInCurrentCycle: false,
    currentCycleSourceClasses: [],
    sourceObservations: [],
    kickoffCandidates: [],
    terminalObservations: [],
    blockingObservations: [],
    verificationStatus: 'SINGLE_SOURCE',
    decisionUse: false,
    bigDbWriteEligible: false
  };
}

function sourceProjection(observation) {
  return {
    sourceClass: observation.sourceClass,
    provider: observation.provider,
    providerId: observation.providerId,
    sourceUrl: observation.sourceUrl,
    kickoffIso: observation.kickoffIso,
    status: observation.status,
    upstreamVerificationStatus: observation.upstreamVerificationStatus,
    observedAt: observation.observedAt
  };
}

function upsertByKey(list, keyFn, value) {
  const map = new Map(list.map(item => [keyFn(item), item]));
  const key = keyFn(value);
  const previous = map.get(key);
  map.set(key, {
    ...(previous ?? value),
    status: value.status ?? previous?.status ?? null,
    upstreamVerificationStatus:
      value.upstreamVerificationStatus ??
      previous?.upstreamVerificationStatus ??
      null,
    observedAt: maxIso(previous?.observedAt, value.observedAt)
  });
  return [...map.values()];
}

function upsertObservation(entry, observation) {
  entry.firstSeenAt = minIso(entry.firstSeenAt, observation.observedAt);
  entry.lastSeenAt = maxIso(entry.lastSeenAt, observation.observedAt);
  entry.seenInCurrentCycle = true;

  if (!entry.canonicalHomeId && observation.canonicalHomeId) {
    entry.canonicalHomeId = observation.canonicalHomeId;
  }
  if (!entry.canonicalAwayId && observation.canonicalAwayId) {
    entry.canonicalAwayId = observation.canonicalAwayId;
  }
  if (!entry.competition && observation.competition) {
    entry.competition = observation.competition;
  }
  if (!entry.country && observation.country) {
    entry.country = observation.country;
  }

  const projected = sourceProjection(observation);
  entry.sourceObservations = upsertByKey(
    entry.sourceObservations,
    sourceKey,
    projected
  );

  const cycleClasses = new Set(entry.currentCycleSourceClasses);
  cycleClasses.add(observation.sourceClass);
  entry.currentCycleSourceClasses = [...cycleClasses].sort();

  const kickoffs = new Map(
    entry.kickoffCandidates.map(candidate => [candidate.kickoffIso, candidate])
  );

  const kickoff = kickoffs.get(observation.kickoffIso) ?? {
    kickoffIso: observation.kickoffIso,
    kickoffLocal: observation.kickoffLocal,
    firstSeenAt: observation.observedAt,
    lastSeenAt: observation.observedAt,
    sources: []
  };

  kickoff.firstSeenAt = minIso(kickoff.firstSeenAt, observation.observedAt);
  kickoff.lastSeenAt = maxIso(kickoff.lastSeenAt, observation.observedAt);
  kickoff.sources = upsertByKey(
    kickoff.sources,
    kickoffSourceKey,
    {
      sourceClass: observation.sourceClass,
      provider: observation.provider,
      providerId: observation.providerId,
      sourceUrl: observation.sourceUrl,
      status: observation.status,
      upstreamVerificationStatus: observation.upstreamVerificationStatus,
      observedAt: observation.observedAt
    }
  );

  kickoffs.set(kickoff.kickoffIso, kickoff);
  entry.kickoffCandidates = [...kickoffs.values()]
    .sort((a, b) => Date.parse(a.kickoffIso) - Date.parse(b.kickoffIso));

  if (observation.terminal) {
    entry.terminalObservations = upsertByKey(
      entry.terminalObservations,
      sourceKey,
      projected
    );
  }

  if (observation.upstreamFailClosed) {
    entry.blockingObservations = upsertByKey(
      entry.blockingObservations,
      sourceKey,
      projected
    );
  }
}

function finalizeEntry(entry, pcSourceClass) {
  const sourceClasses = new Set(
    entry.sourceObservations
      .map(source => clean(source.sourceClass).toUpperCase())
      .filter(Boolean)
  );

  const providers = new Set(
    entry.sourceObservations
      .map(source => clean(source.provider).toUpperCase())
      .filter(Boolean)
  );

  entry.sourceClasses = [...sourceClasses].sort();
  entry.providers = [...providers].sort();
  entry.sourceCount = entry.sourceObservations.length;
  entry.distinctProviderCount = providers.size;
  entry.hasPcNodeEvidence = sourceClasses.has(pcSourceClass);
  entry.rescuedWithoutPcNode = !entry.hasPcNodeEvidence;
  entry.hasKickoffConflict = entry.kickoffCandidates.length > 1;
  entry.hasTerminalObservation = entry.terminalObservations.length > 0;
  entry.hasUpstreamFailClosed = entry.blockingObservations.length > 0;

  if (entry.hasTerminalObservation) {
    entry.verificationStatus = 'TERMINAL_OBSERVED_FAIL_CLOSED';
  } else if (entry.hasUpstreamFailClosed) {
    entry.verificationStatus = 'UPSTREAM_FAIL_CLOSED';
  } else if (entry.hasKickoffConflict) {
    entry.verificationStatus = 'CONFLICT_FAIL_CLOSED';
  } else if (providers.size > 1 || sourceClasses.size > 1) {
    entry.verificationStatus = 'MULTI_SOURCE_EXACT';
  } else {
    entry.verificationStatus = 'SINGLE_SOURCE';
  }

  entry.decisionUse = false;
  entry.bigDbWriteEligible = false;
  return entry;
}

export function mergeDailyFixtureRegistry(
  previousRegistry,
  rows,
  {
    targetDate,
    timeZone = 'Asia/Ho_Chi_Minh',
    nowMs = Date.now(),
    pcSourceClass = 'PC_NODE',
    defaultSourceClass = null
  } = {}
) {
  const nowIso = new Date(nowMs).toISOString();
  const date = clean(targetDate);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('TARGET_DATE_INVALID');
  }

  const entries = new Map();

  for (const prior of Array.isArray(previousRegistry?.entries)
    ? previousRegistry.entries
    : []) {
    if (clean(prior?.targetDate) !== date || !clean(prior?.identityKey)) {
      continue;
    }

    const cloned = cloneEntry(prior);
    cloned.seenInCurrentCycle = false;
    cloned.currentCycleSourceClasses = [];
    entries.set(cloned.identityKey, cloned);
  }

  const rejected = [];
  let acceptedObservations = 0;

  for (const row of Array.isArray(rows) ? rows : []) {
    const normalized = normalizeRegistryObservation(row, {
      targetDate: date,
      timeZone,
      observedAt: nowIso,
      sourceClass: defaultSourceClass
    });

    if (!normalized.accepted) {
      rejected.push({
        reason: normalized.reason,
        home: clean(row?.home ?? row?.home_team) || null,
        away: clean(row?.away ?? row?.away_team) || null
      });
      continue;
    }

    acceptedObservations += 1;
    const observation = normalized.observation;
    const entry = entries.get(observation.identityKey) ?? newEntry(observation);
    upsertObservation(entry, observation);
    entries.set(observation.identityKey, entry);
  }

  const pcClass = clean(pcSourceClass).toUpperCase();
  const finalized = [...entries.values()]
    .map(entry => finalizeEntry(entry, pcClass))
    .sort((a, b) => {
      const aKickoff = finiteMs(a.kickoffCandidates?.[0]?.kickoffIso) ?? Infinity;
      const bKickoff = finiteMs(b.kickoffCandidates?.[0]?.kickoffIso) ?? Infinity;
      return aKickoff - bKickoff || a.identityKey.localeCompare(b.identityKey);
    });

  const sourceObservationCounts = {};
  for (const entry of finalized) {
    for (const source of entry.sourceObservations) {
      const label = clean(source.provider).toUpperCase() || 'UNKNOWN';
      sourceObservationCounts[label] =
        (sourceObservationCounts[label] ?? 0) + 1;
    }
  }

  const coverage = {
    registryFixtures: finalized.length,
    seenInCurrentCycle: finalized.filter(entry => entry.seenInCurrentCycle).length,
    notSeenInCurrentCycle: finalized.filter(entry => !entry.seenInCurrentCycle).length,
    singleSourceFixtures: finalized.filter(
      entry => entry.verificationStatus === 'SINGLE_SOURCE'
    ).length,
    multiSourceFixtures: finalized.filter(
      entry => entry.verificationStatus === 'MULTI_SOURCE_EXACT'
    ).length,
    kickoffConflicts: finalized.filter(entry => entry.hasKickoffConflict).length,
    upstreamFailClosed: finalized.filter(entry => entry.hasUpstreamFailClosed).length,
    terminalObserved: finalized.filter(entry => entry.hasTerminalObservation).length,
    withPcNodeEvidence: finalized.filter(entry => entry.hasPcNodeEvidence).length,
    rescuedWithoutPcNode: finalized.filter(entry => entry.rescuedWithoutPcNode).length,
    sourceObservationCounts
  };

  return {
    contract: DAILY_FIXTURE_REGISTRY_CONTRACT,
    generatedAt: nowIso,
    targetDate: date,
    timeZone,
    policy: {
      appendUpdateOnly: true,
      sourceFailureDeletesFixture: false,
      pcNodeIsGatekeeper: false,
      automaticKickoffCorrection: false,
      upstreamFailClosedPropagates: true,
      conflictPolicy: 'FAIL_CLOSED',
      decisionUse: false,
      bigDbWriteAllowed: false
    },
    entries: finalized,
    coverage,
    ingest: {
      inputRows: Array.isArray(rows) ? rows.length : 0,
      acceptedObservations,
      rejectedObservations: rejected.length,
      rejected
    },
    decisionUse: false,
    bigDbWriteAllowed: false,
    bigDbWriteAttempted: false
  };
}

export function selectRollingFixtureWindow(
  registry,
  {
    nowMs = Date.now(),
    horizonMinutes = 90
  } = {}
) {
  const horizon = Number(horizonMinutes);
  if (!Number.isFinite(horizon) || horizon <= 0) {
    throw new Error('HORIZON_MINUTES_INVALID');
  }

  const endMs = nowMs + horizon * 60_000;
  const selected = [];
  const excluded = [];

  for (const entry of Array.isArray(registry?.entries) ? registry.entries : []) {
    if (entry?.hasTerminalObservation) {
      excluded.push({
        identityKey: entry.identityKey,
        reason: 'TERMINAL_OBSERVED'
      });
      continue;
    }

    if (entry?.hasUpstreamFailClosed) {
      excluded.push({
        identityKey: entry.identityKey,
        reason: 'UPSTREAM_FAIL_CLOSED'
      });
      continue;
    }

    if (entry?.hasKickoffConflict || entry?.kickoffCandidates?.length !== 1) {
      excluded.push({
        identityKey: entry.identityKey,
        reason: 'KICKOFF_CONFLICT'
      });
      continue;
    }

    const kickoffIso = entry.kickoffCandidates[0].kickoffIso;
    const kickoffMs = finiteMs(kickoffIso);

    if (kickoffMs === null) {
      excluded.push({ identityKey: entry.identityKey, reason: 'INVALID_KICKOFF' });
      continue;
    }

    if (kickoffMs <= nowMs) {
      excluded.push({
        identityKey: entry.identityKey,
        reason: 'KICKOFF_NOT_FUTURE'
      });
      continue;
    }

    if (kickoffMs > endMs) {
      excluded.push({
        identityKey: entry.identityKey,
        reason: 'OUTSIDE_ROLLING_HORIZON'
      });
      continue;
    }

    selected.push({
      identityKey: entry.identityKey,
      targetDate: entry.targetDate,
      home: entry.home,
      away: entry.away,
      competition: entry.competition,
      kickoffIso,
      kickoffLocal: entry.kickoffCandidates[0].kickoffLocal,
      minutesToKickoff:
        Math.round(((kickoffMs - nowMs) / 60_000) * 10) / 10,
      verificationStatus: entry.verificationStatus,
      seenInCurrentCycle: entry.seenInCurrentCycle,
      queueStatus: entry.seenInCurrentCycle
        ? 'READY_FOR_EVIDENCE_REFRESH'
        : 'REFRESH_REQUIRED',
      hasPcNodeEvidence: entry.hasPcNodeEvidence,
      rescuedWithoutPcNode: entry.rescuedWithoutPcNode,
      sourceClasses: entry.sourceClasses,
      providers: entry.providers,
      decisionUse: false
    });
  }

  selected.sort(
    (a, b) => Date.parse(a.kickoffIso) - Date.parse(b.kickoffIso)
  );

  return {
    contract: ROLLING_FIXTURE_WINDOW_CONTRACT,
    generatedAt: new Date(nowMs).toISOString(),
    targetDate: registry?.targetDate ?? null,
    timeZone: registry?.timeZone ?? 'Asia/Ho_Chi_Minh',
    horizonMinutes: horizon,
    startsAt: new Date(nowMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
    fixtures: selected,
    excluded,
    metrics: {
      selected: selected.length,
      rescuedWithoutPcNode: selected.filter(row => row.rescuedWithoutPcNode).length,
      refreshRequired: selected.filter(
        row => row.queueStatus === 'REFRESH_REQUIRED'
      ).length,
      conflictsExcluded: excluded.filter(
        row => row.reason === 'KICKOFF_CONFLICT'
      ).length,
      upstreamFailClosedExcluded: excluded.filter(
        row => row.reason === 'UPSTREAM_FAIL_CLOSED'
      ).length
    },
    decisionUse: false
  };
}
