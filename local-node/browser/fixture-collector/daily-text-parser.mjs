const clean = value => String(value ?? '')
  .replace(/\u00a0/g, ' ')
  .trim()
  .replace(/\s+/g, ' ');

function isTime(value) {
  const match = clean(value).match(/^(?:[01]?\d|2[0-3]):[0-5]\d$/);
  return match ? match[0].padStart(5, '0') : null;
}

function normalizeDateParts(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    !Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d) ||
    date.getUTCFullYear() !== y || date.getUTCMonth() + 1 !== m || date.getUTCDate() !== d
  ) return null;
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function explicitDate(value) {
  const text = clean(value);
  let match = text.match(/\b(20\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (match) return normalizeDateParts(match[1], match[2], match[3]);
  match = text.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](20\d{2})\b/);
  if (match) return normalizeDateParts(match[3], match[2], match[1]);
  return null;
}

function isTerminalOrLiveStatus(value) {
  const text = clean(value);
  return /^(?:FT|AET|PEN|Finished|Full[- ]?time|Postponed|Cancelled|Canceled|Abandoned|Live|HT)$/i.test(text) ||
    /^\d{1,3}[’']$/.test(text) ||
    /^\d{1,3}\s*min$/i.test(text);
}

function isNoise(value) {
  const text = clean(value);
  if (!text) return true;
  if (/^(?:Advertisement|Featured|Standings|Odds|Prediction|Lineups?|H2H|Round\s+\d+|All|Football|Soccer)$/i.test(text)) return true;
  if (/^[+-]?\d+(?:\.\d+)?$/.test(text)) return true;
  if (/^\d+(?:\.\d+)?\s*%$/.test(text)) return true;
  return false;
}

function cleanTeam(value) {
  return clean(value)
    .replace(/\s+(?:Live|Prediction|H2H|Odds)\s*$/i, '')
    .trim();
}

function splitTeams(value) {
  const text = clean(value);
  const match = text.match(/^(.+?)\s+(?:vs\.?|v\.?|[-–—])\s+(.+?)(?:\s+Live)?$/i);
  if (!match) return null;
  const home = cleanTeam(match[1]);
  const away = cleanTeam(match[2]);
  if (!home || !away || home.toLowerCase() === away.toLowerCase()) return null;
  return { home, away };
}

function plausibleTeam(value) {
  const text = cleanTeam(value);
  if (!text || text.length < 2 || text.length > 100) return false;
  if (isTime(text) || explicitDate(text) || isTerminalOrLiveStatus(text) || isNoise(text)) return false;
  if (/^(?:Today|Tomorrow|Yesterday|Matches|Schedule|Fixtures?)$/i.test(text)) return false;
  return /[\p{L}\d]/u.test(text);
}

function kickoffIso(targetDate, time, timeZone) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(targetDate)) return null;
  if (timeZone === 'Asia/Ho_Chi_Minh') {
    const parsed = new Date(`${targetDate}T${time}:00+07:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (timeZone === 'UTC') {
    const parsed = new Date(`${targetDate}T${time}:00Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function candidateRecord({ source, targetDate, timeZone, time, home, away, evidence }) {
  const kickoff = kickoffIso(targetDate, time, timeZone);
  if (!kickoff) return null;
  return {
    source_id: source.id,
    source_url: source.url,
    provider_id: null,
    competition: source.competition || 'ALL FOOTBALL',
    country: source.country || 'GLOBAL',
    home_team: home,
    away_team: away,
    kickoff_utc: kickoff,
    parser_evidence: {
      provider: String(source.provider || '').toLowerCase(),
      parser: 'CFI_DAILY_TEXT_FIXTURE_V1',
      target_date: targetDate,
      time_line: time,
      home_line: home,
      away_line: away,
      browser_timezone: timeZone,
      ...evidence
    }
  };
}

export function parseDailyFixtureText(source, text, {
  targetDate,
  timeZone = source?.render_timezone || 'Asia/Ho_Chi_Minh'
} = {}) {
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(String(targetDate ?? ''))) {
    throw new Error('TARGET_DATE_REQUIRED');
  }

  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const candidates = [];
  const rejected = [];
  const identityOnly = [];
  let activeExplicitDate = null;
  let explicitDateAnchors = 0;

  const pushCandidate = payload => {
    const record = candidateRecord({ source, targetDate, timeZone, ...payload });
    if (!record) {
      rejected.push({ reason: 'UNSUPPORTED_TIMEZONE_OR_INVALID_KICKOFF', ...payload });
      return;
    }
    candidates.push(record);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const date = explicitDate(line);
    if (date) {
      activeExplicitDate = date;
      explicitDateAnchors += 1;
      const inlineAfterDate = clean(line.replace(/.*?20\d{2}[\/-]\d{1,2}[\/-]\d{1,2}/, ''));
      const dateTeams = splitTeams(inlineAfterDate);
      if (dateTeams && date === targetDate) {
        identityOnly.push({
          home: dateTeams.home,
          away: dateTeams.away,
          explicitDate: date,
          reason: 'MISSING_EXPLICIT_KICKOFF_TIME'
        });
      }
      continue;
    }

    if (activeExplicitDate && activeExplicitDate !== targetDate) continue;

    const inline = line.match(/^((?:[01]?\d|2[0-3]):[0-5]\d)\s+(.+)$/);
    if (inline) {
      const time = isTime(inline[1]);
      const teams = splitTeams(inline[2]);
      if (time && teams) {
        pushCandidate({
          time,
          ...teams,
          evidence: { extraction: 'INLINE_TIME_TEAMS', date_basis: activeExplicitDate ? 'EXPLICIT_DATE' : 'RUN_CONTEXT_TARGET_DATE' }
        });
        continue;
      }
    }

    const time = isTime(line);
    if (!time) {
      const teams = splitTeams(line);
      if (teams && (activeExplicitDate === targetDate || !activeExplicitDate)) {
        identityOnly.push({ ...teams, reason: 'MISSING_EXPLICIT_KICKOFF_TIME' });
      }
      continue;
    }

    let j = i + 1;
    const window = [];
    while (j < lines.length && window.length < 6) {
      const next = lines[j];
      if (isTime(next) || explicitDate(next)) break;
      if (!isNoise(next) && !isTerminalOrLiveStatus(next)) window.push(next);
      j += 1;
    }

    if (window.length === 0) {
      rejected.push({ time, reason: 'NO_TEAM_AFTER_TIME' });
      continue;
    }

    const joinedTeams = splitTeams(window[0]);
    if (joinedTeams) {
      pushCandidate({
        time,
        ...joinedTeams,
        evidence: { extraction: 'TIME_PLUS_JOINED_TEAMS', date_basis: activeExplicitDate ? 'EXPLICIT_DATE' : 'RUN_CONTEXT_TARGET_DATE' }
      });
      continue;
    }

    const home = cleanTeam(window[0]);
    const away = cleanTeam(window[1]);
    if (!plausibleTeam(home) || !plausibleTeam(away)) {
      rejected.push({ time, home: home || null, away: away || null, reason: 'TEAM_PAIR_NOT_EXPLICIT_ENOUGH' });
      continue;
    }

    pushCandidate({
      time,
      home,
      away,
      evidence: { extraction: 'TIME_PLUS_TWO_TEAM_LINES', date_basis: activeExplicitDate ? 'EXPLICIT_DATE' : 'RUN_CONTEXT_TARGET_DATE' }
    });
  }

  const unique = [];
  const seen = new Set();
  for (const row of candidates) {
    const key = `${row.home_team.toLowerCase()}|${row.away_team.toLowerCase()}|${row.kickoff_utc}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(row);
  }

  return {
    candidates: unique,
    rejected,
    identityOnly,
    telemetry: {
      lines: lines.length,
      explicitDateAnchors,
      rawCandidates: candidates.length,
      uniqueCandidates: unique.length,
      duplicatesRemoved: candidates.length - unique.length,
      rejected: rejected.length,
      identityOnly: identityOnly.length,
      targetDate,
      timeZone
    }
  };
}
