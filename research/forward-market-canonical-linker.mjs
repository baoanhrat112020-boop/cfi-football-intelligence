export const FORWARD_MARKET_CANONICAL_LINKER_V1 = Object.freeze({
  version: 'CFI_FORWARD_MARKET_CANONICAL_LINKER_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalWriteAllowed: false,
  fuzzyMatchingAllowed: false,
  crossDateMatchingAllowed: false,
});

const LEADING_AFFIXES = [
  ['stade', 'de'],
  ['club', 'de'],
  ['as'],
  ['ac'],
  ['afc'],
  ['cf'],
  ['cd'],
  ['fc'],
  ['fk'],
  ['pfc'],
  ['sc'],
  ['sk'],
  ['nk'],
  ['rc'],
];

const TRAILING_AFFIXES = new Set([
  'ac', 'afc', 'bk', 'cd', 'cf', 'fc', 'fk', 'if', 'nk', 'pfc', 'rc', 'sc', 'sk', 'sv', 'ud',
]);

function text(value) {
  return String(value ?? '').trim();
}

export function normalizeResearchTeamName(value) {
  return text(value)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function stripConservativeAffixes(value) {
  const tokens = normalizeResearchTeamName(value).split(' ').filter(Boolean);
  if (!tokens.length) return '';
  let changed = true;
  while (changed && tokens.length > 1) {
    changed = false;
    for (const prefix of LEADING_AFFIXES) {
      if (tokens.length > prefix.length && prefix.every((token, index) => tokens[index] === token)) {
        tokens.splice(0, prefix.length);
        changed = true;
        break;
      }
    }
  }
  while (tokens.length > 1 && TRAILING_AFFIXES.has(tokens.at(-1))) tokens.pop();
  return tokens.join(' ');
}

function isoDate(value) {
  const raw = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = Date.parse(`${raw}T00:00:00Z`);
  return Number.isFinite(parsed) ? raw : null;
}

function fixtureDate(fixture) {
  return isoDate(fixture?.targetDate ?? fixture?.matchDate ?? fixture?.match_date);
}

function fixtureId(fixture) {
  return text(fixture?.fixtureId ?? fixture?.fixture_id ?? fixture?.id);
}

function fixtureHome(fixture) {
  return text(fixture?.homeTeam ?? fixture?.home_team ?? fixture?.home);
}

function fixtureAway(fixture) {
  return text(fixture?.awayTeam ?? fixture?.away_team ?? fixture?.away);
}

function fixtureHomeId(fixture) {
  return text(fixture?.homeTeamId ?? fixture?.home_team_id);
}

function fixtureAwayId(fixture) {
  return text(fixture?.awayTeamId ?? fixture?.away_team_id);
}

function aliasIndex(aliases = []) {
  const byName = new Map();
  for (const row of aliases) {
    const teamId = text(row?.teamId ?? row?.team_id);
    const confidence = Number(row?.confidence ?? 1);
    const alias = normalizeResearchTeamName(row?.aliasDisplay ?? row?.alias_display ?? row?.aliasNormalized ?? row?.alias_normalized);
    if (!teamId || !alias || !Number.isFinite(confidence) || confidence < 0.95) continue;
    if (!byName.has(alias)) byName.set(alias, new Set());
    byName.get(alias).add(teamId);
  }
  return byName;
}

function uniqueAliasTeam(index, name) {
  const ids = index.get(normalizeResearchTeamName(name));
  return ids?.size === 1 ? [...ids][0] : null;
}

function sideMatch(inputName, canonicalName, canonicalTeamId, aliases) {
  const inputExact = normalizeResearchTeamName(inputName);
  const canonicalExact = normalizeResearchTeamName(canonicalName);
  if (!inputExact || !canonicalExact) return { matched: false, tier: 0, method: 'NONE' };
  if (inputExact === canonicalExact) return { matched: true, tier: 3, method: 'EXACT_NORMALIZED' };

  const aliasTeamId = uniqueAliasTeam(aliases, inputName);
  if (aliasTeamId && canonicalTeamId && aliasTeamId === canonicalTeamId) {
    return { matched: true, tier: 2, method: 'EXACT_ALIAS_TEAM_ID' };
  }

  const inputAffix = stripConservativeAffixes(inputName);
  const canonicalAffix = stripConservativeAffixes(canonicalName);
  if (inputAffix && canonicalAffix && inputAffix === canonicalAffix) {
    return { matched: true, tier: 1, method: 'CONSERVATIVE_AFFIX_NORMALIZED' };
  }
  return { matched: false, tier: 0, method: 'NONE' };
}

function candidateScore(home, away) {
  return Math.min(home.tier, away.tier) * 100 + home.tier * 10 + away.tier;
}

export function linkForwardMarketCaptureToCanonicalFixture(capture = {}, fixtures = [], options = {}) {
  const targetDate = isoDate(capture?.targetDate ?? capture?.target_date);
  const homeTeam = text(capture?.homeTeam ?? capture?.home_team);
  const awayTeam = text(capture?.awayTeam ?? capture?.away_team);
  const externalFixtureKey = text(capture?.externalFixtureKey ?? capture?.external_fixture_key);

  const base = {
    version: FORWARD_MARKET_CANONICAL_LINKER_V1.version,
    researchOnly: true,
    decisionUse: false,
    productionMutationAllowed: false,
    canonicalWriteAllowed: false,
    externalFixtureKey: externalFixtureKey || null,
    targetDate,
    homeTeam: homeTeam || null,
    awayTeam: awayTeam || null,
  };

  if (!targetDate) return { ...base, status: 'BLOCKED', reason: 'TARGET_DATE_REQUIRED', fixture: null };
  if (!homeTeam || !awayTeam) return { ...base, status: 'BLOCKED', reason: 'TEAM_NAMES_REQUIRED', fixture: null };
  if (!Array.isArray(fixtures) || fixtures.length === 0) return { ...base, status: 'BLOCKED', reason: 'CANONICAL_FIXTURES_REQUIRED', fixture: null };

  const aliases = aliasIndex(options.aliases ?? []);
  const sameDate = fixtures.filter(row => fixtureDate(row) === targetDate && fixtureId(row));
  const candidates = [];
  for (const row of sameDate) {
    const home = sideMatch(homeTeam, fixtureHome(row), fixtureHomeId(row), aliases);
    if (!home.matched) continue;
    const away = sideMatch(awayTeam, fixtureAway(row), fixtureAwayId(row), aliases);
    if (!away.matched) continue;
    candidates.push({
      row,
      fixtureId: fixtureId(row),
      score: candidateScore(home, away),
      homeMethod: home.method,
      awayMethod: away.method,
    });
  }

  if (!candidates.length) {
    return {
      ...base,
      status: 'BLOCKED',
      reason: 'NO_UNIQUE_SAME_DATE_CANONICAL_MATCH',
      sameDateFixtureCount: sameDate.length,
      candidateCount: 0,
      fixture: null,
    };
  }

  candidates.sort((a, b) => b.score - a.score || a.fixtureId.localeCompare(b.fixtureId));
  const bestScore = candidates[0].score;
  const best = candidates.filter(row => row.score === bestScore);
  if (best.length !== 1) {
    return {
      ...base,
      status: 'BLOCKED',
      reason: 'AMBIGUOUS_CANONICAL_MATCH',
      sameDateFixtureCount: sameDate.length,
      candidateCount: candidates.length,
      bestCandidateCount: best.length,
      fixture: null,
    };
  }

  const winner = best[0];
  return {
    ...base,
    status: 'VERIFIED_RESEARCH_LINK',
    reason: null,
    sameDateFixtureCount: sameDate.length,
    candidateCount: candidates.length,
    matchMethod: winner.homeMethod === winner.awayMethod ? winner.homeMethod : `${winner.homeMethod}+${winner.awayMethod}`,
    fixture: {
      fixtureId: winner.fixtureId,
      targetDate,
      homeTeam: fixtureHome(winner.row),
      awayTeam: fixtureAway(winner.row),
      homeTeamId: fixtureHomeId(winner.row) || null,
      awayTeamId: fixtureAwayId(winner.row) || null,
      competitionKey: text(winner.row?.competitionKey ?? winner.row?.competition_key) || null,
    },
    provenance: {
      linkerVersion: FORWARD_MARKET_CANONICAL_LINKER_V1.version,
      fuzzyMatchingUsed: false,
      crossDateMatchingUsed: false,
      canonicalWritePerformed: false,
      homeMethod: winner.homeMethod,
      awayMethod: winner.awayMethod,
    },
  };
}

export function linkForwardMarketCaptureBatch(captures = [], fixtures = [], options = {}) {
  const rows = captures.map(capture => linkForwardMarketCaptureToCanonicalFixture(capture, fixtures, options));
  const verified = rows.filter(row => row.status === 'VERIFIED_RESEARCH_LINK').length;
  const blocked = rows.length - verified;
  const reasons = {};
  for (const row of rows) if (row.reason) reasons[row.reason] = (reasons[row.reason] ?? 0) + 1;
  return {
    version: FORWARD_MARKET_CANONICAL_LINKER_V1.version,
    researchOnly: true,
    decisionUse: false,
    productionMutationAllowed: false,
    canonicalWriteAllowed: false,
    total: rows.length,
    verified,
    blocked,
    reasons,
    rows,
  };
}
