import { createHash } from 'node:crypto';

export const FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1 = Object.freeze({
  version: 'CFI_FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalWriteAllowed: false,
  reconstructed: false,
  capturedAtFabricated: false,
  timingMode: 'SOURCE_SEMANTIC_PREMATCH',
  sourceSemanticsUrl: 'https://www.football-data.co.uk/downloadm.php',
  pinnacleUnreliableFrom: '2025-07-23',
});

function text(value) {
  return String(value ?? '').trim();
}

function number(value) {
  const raw = text(value);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function odd(value) {
  const n = number(value);
  return n !== null && n > 1 ? n : null;
}

function splitCsvLine(line) {
  const out = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        value += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      out.push(value);
      value = '';
    } else value += c;
  }
  out.push(value);
  return out;
}

function normalizeDate(value) {
  const input = text(value);
  let m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  m = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const yyyy = Number(m[3]) >= 80 ? `19${m[3]}` : `20${m[3]}`;
  return `${yyyy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}

function value(cols, idx, names) {
  for (const name of names) {
    if (name in idx) return cols[idx[name]];
  }
  return null;
}

function threeWay(cols, idx, names) {
  const home = odd(value(cols, idx, names.home));
  const draw = odd(value(cols, idx, names.draw));
  const away = odd(value(cols, idx, names.away));
  return home && draw && away ? { odds_home: home, odds_draw: draw, odds_away: away } : null;
}

function twoWay(cols, idx, names) {
  const a = odd(value(cols, idx, names.a));
  const b = odd(value(cols, idx, names.b));
  return a && b ? { a, b } : null;
}

function openingMarkets(cols, idx) {
  const bookmaker1x2 = threeWay(cols, idx, {
    home: ['B365H'], draw: ['B365D'], away: ['B365A'],
  });
  const average1x2 = threeWay(cols, idx, {
    home: ['AvgH'], draw: ['AvgD'], away: ['AvgA'],
  });
  const bookmakerOu = twoWay(cols, idx, { a: ['B365>2.5'], b: ['B365<2.5'] });
  const averageOu = twoWay(cols, idx, { a: ['Avg>2.5'], b: ['Avg<2.5'] });
  const ahLine = number(value(cols, idx, ['AHh']));
  const bookmakerAh = twoWay(cols, idx, { a: ['B365AHH'], b: ['B365AHA'] });
  const averageAh = twoWay(cols, idx, { a: ['AvgAHH'], b: ['AvgAHA'] });
  return {
    oneXTwo: {
      bookmaker: bookmaker1x2 ? { bookmaker: 'Bet365', ...bookmaker1x2 } : null,
      marketAverage: average1x2 ? { provider: 'Football-Data market average', ...average1x2 } : null,
    },
    overUnder25: {
      line: bookmakerOu || averageOu ? 2.5 : null,
      bookmaker: bookmakerOu ? { bookmaker: 'Bet365', odds_over: bookmakerOu.a, odds_under: bookmakerOu.b } : null,
      marketAverage: averageOu ? { provider: 'Football-Data market average', odds_over: averageOu.a, odds_under: averageOu.b } : null,
    },
    asianHandicap: {
      line: ahLine,
      bookmaker: ahLine !== null && bookmakerAh ? { bookmaker: 'Bet365', odds_home: bookmakerAh.a, odds_away: bookmakerAh.b } : null,
      marketAverage: ahLine !== null && averageAh ? { provider: 'Football-Data market average', odds_home: averageAh.a, odds_away: averageAh.b } : null,
    },
  };
}

function closingMarkets(cols, idx) {
  const bookmaker1x2 = threeWay(cols, idx, {
    home: ['B365CH'], draw: ['B365CD'], away: ['B365CA'],
  });
  const average1x2 = threeWay(cols, idx, {
    home: ['AvgCH'], draw: ['AvgCD'], away: ['AvgCA'],
  });
  const bookmakerOu = twoWay(cols, idx, { a: ['B365C>2.5'], b: ['B365C<2.5'] });
  const averageOu = twoWay(cols, idx, { a: ['AvgC>2.5'], b: ['AvgC<2.5'] });
  const ahLine = number(value(cols, idx, ['AHCh']));
  const bookmakerAh = twoWay(cols, idx, { a: ['B365CAHH'], b: ['B365CAHA'] });
  const averageAh = twoWay(cols, idx, { a: ['AvgCAHH'], b: ['AvgCAHA'] });
  return {
    oneXTwo: {
      bookmaker: bookmaker1x2 ? { bookmaker: 'Bet365', ...bookmaker1x2 } : null,
      marketAverage: average1x2 ? { provider: 'Football-Data market average', ...average1x2 } : null,
    },
    overUnder25: {
      line: bookmakerOu || averageOu ? 2.5 : null,
      bookmaker: bookmakerOu ? { bookmaker: 'Bet365', odds_over: bookmakerOu.a, odds_under: bookmakerOu.b } : null,
      marketAverage: averageOu ? { provider: 'Football-Data market average', odds_over: averageOu.a, odds_under: averageOu.b } : null,
    },
    asianHandicap: {
      line: ahLine,
      bookmaker: ahLine !== null && bookmakerAh ? { bookmaker: 'Bet365', odds_home: bookmakerAh.a, odds_away: bookmakerAh.b } : null,
      marketAverage: ahLine !== null && averageAh ? { provider: 'Football-Data market average', odds_home: averageAh.a, odds_away: averageAh.b } : null,
    },
  };
}

function hasMarket(group) {
  return Boolean(
    group?.oneXTwo?.bookmaker || group?.oneXTwo?.marketAverage ||
    group?.overUnder25?.bookmaker || group?.overUnder25?.marketAverage ||
    group?.asianHandicap?.bookmaker || group?.asianHandicap?.marketAverage
  );
}

function identity(row) {
  return createHash('sha256').update([
    row.source_id, row.date, row.home_team, row.away_team,
  ].join('|').toLowerCase().normalize('NFKD')).digest('hex');
}

export function parseFootballDataHistoricalMarketEvidence(source, csvText, options = {}) {
  const textValue = String(csvText ?? '').replace(/^\uFEFF/, '');
  const lines = textValue.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error('FOOTBALL_DATA_HISTORICAL_MARKET_EMPTY_CSV');
  const headers = splitCsvLine(lines[0]).map(x => x.trim());
  const idx = Object.fromEntries(headers.map((header, i) => [header, i]));
  for (const field of ['Date', 'HomeTeam', 'AwayTeam', 'FTHG', 'FTAG']) {
    if (!(field in idx)) throw new Error(`FOOTBALL_DATA_HISTORICAL_MARKET_MISSING_COLUMN_${field}`);
  }
  const sourceSha256 = text(options.sourceSha256 ?? '') || createHash('sha256').update(Buffer.from(textValue, 'utf8')).digest('hex');
  const rows = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const date = normalizeDate(cols[idx.Date]);
    const home = text(cols[idx.HomeTeam]);
    const away = text(cols[idx.AwayTeam]);
    const ftHome = number(cols[idx.FTHG]);
    const ftAway = number(cols[idx.FTAG]);
    if (!date || !home || !away || !Number.isInteger(ftHome) || ftHome < 0 || !Number.isInteger(ftAway) || ftAway < 0) continue;
    const opening = openingMarkets(cols, idx);
    const closing = closingMarkets(cols, idx);
    if (!hasMarket(opening) && !hasMarket(closing)) continue;
    const row = {
      contract: FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1.version,
      researchOnly: true,
      decisionUse: false,
      productionMutationAllowed: false,
      canonicalWriteAllowed: false,
      reconstructed: false,
      source: 'football-data',
      source_id: source?.id ?? null,
      source_url: source?.url ?? null,
      source_sha256: sourceSha256,
      season: source?.season ?? null,
      competition: source?.competition ?? null,
      league: source?.league ?? null,
      date,
      home_team: home,
      away_team: away,
      actual_ft_home: ftHome,
      actual_ft_away: ftAway,
      opening,
      closing,
      temporalProvenance: {
        opening: {
          classification: 'SOURCE_DEFINED_PREMATCH_AFTER_MARKET_OPENING',
          capturedAt: null,
          sourceSemanticTimingOnly: true,
          strictPriorSemantic: true,
          decisionEligible: true,
          sourceSemanticsUrl: FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1.sourceSemanticsUrl,
        },
        closing: {
          classification: 'SOURCE_DEFINED_CLOSING_PREKICKOFF',
          capturedAt: null,
          sourceSemanticTimingOnly: true,
          strictPriorSemantic: true,
          decisionEligible: false,
          sourceSemanticsUrl: FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1.sourceSemanticsUrl,
        },
      },
      providerPolicy: {
        pinnacleUsed: false,
        pinnacleUnreliableFrom: FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1.pinnacleUnreliableFrom,
      },
    };
    row.identity_key = identity(row);
    rows.push(row);
  }
  return {
    ...FOOTBALL_DATA_HISTORICAL_MARKET_EVIDENCE_V1,
    source: source?.id ?? null,
    sourceUrl: source?.url ?? null,
    sourceSha256,
    rows: [...new Map(rows.map(row => [row.identity_key, row])).values()],
  };
}
