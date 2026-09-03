export const FOOTBALL_DATA_FORWARD_V2 = Object.freeze({
  version: 'CFI_FOOTBALL_DATA_FORWARD_V2',
  sourceUrl: 'https://www.football-data.co.uk/fixtures.csv',
  sourceTimeZone: 'Europe/London',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalWriteAllowed: false,
});

export type CsvRow = Record<string, string>;

export function text(value: unknown): string {
  return String(value ?? '').trim();
}

export function normalizeName(value: unknown): string {
  return text(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseCsv(input: string): CsvRow[] {
  const source = input.replace(/^\uFEFF/, '');
  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field.replace(/\r$/, ''));
      records.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (quoted) throw new Error('FOOTBALL_DATA_CSV_UNTERMINATED_QUOTE');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    records.push(row);
  }
  if (records.length < 2) return [];
  const headers = records[0].map(text);
  if (!headers.includes('Div') || !headers.includes('Date') || !headers.includes('Time') || !headers.includes('HomeTeam') || !headers.includes('AwayTeam')) {
    throw new Error('FOOTBALL_DATA_CSV_REQUIRED_HEADERS_MISSING');
  }
  return records.slice(1)
    .filter(values => values.some(value => text(value)))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, text(values[index])]))) as CsvRow[];
}

export function footballDataDateToYmd(value: unknown): string | null {
  const m = text(value).match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

function localParts(ms: number, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const parts = formatter.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

export function zonedDateTimeToUtcIso(dateYmd: string, timeHm: string, timeZone = FOOTBALL_DATA_FORWARD_V2.sourceTimeZone): string {
  const dm = text(dateYmd).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const tm = text(timeHm).match(/^(\d{1,2}):(\d{2})$/);
  if (!dm || !tm) throw new Error('FOOTBALL_DATA_DATE_TIME_INVALID');
  const wanted = {
    year: Number(dm[1]), month: Number(dm[2]), day: Number(dm[3]),
    hour: Number(tm[1]), minute: Number(tm[2]), second: 0,
  };
  if (wanted.hour > 23 || wanted.minute > 59) throw new Error('FOOTBALL_DATA_TIME_INVALID');

  const naiveUtc = Date.UTC(wanted.year, wanted.month - 1, wanted.day, wanted.hour, wanted.minute, 0);
  let candidate = naiveUtc;
  for (let i = 0; i < 4; i += 1) {
    const observed = localParts(candidate, timeZone);
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute, observed.second);
    const delta = naiveUtc - observedAsUtc;
    if (delta === 0) break;
    candidate += delta;
  }
  const check = localParts(candidate, timeZone);
  if (check.year !== wanted.year || check.month !== wanted.month || check.day !== wanted.day || check.hour !== wanted.hour || check.minute !== wanted.minute) {
    throw new Error('FOOTBALL_DATA_TIMEZONE_CONVERSION_UNVERIFIED');
  }
  return new Date(candidate).toISOString();
}

function decimal(row: CsvRow, key: string): number | null {
  const value = Number(text(row[key]));
  return Number.isFinite(value) && value > 1 ? value : null;
}

export function chooseOpening1x2(row: CsvRow): { bookmaker: string; home: number; draw: number; away: number; columns: string[] } | null {
  const families: Array<[string, string, string, string]> = [
    ['FOOTBALL_DATA_AVG_OPENING', 'AvgH', 'AvgD', 'AvgA'],
    ['BET365_OPENING', 'B365H', 'B365D', 'B365A'],
    ['BETFAIR_DATA_OPENING', 'BFDH', 'BFDD', 'BFDA'],
    ['BETVICTOR_OPENING', 'BVH', 'BVD', 'BVA'],
    ['BETWAY_OPENING', 'BWH', 'BWD', 'BWA'],
    ['PADDY_POWER_OPENING', 'PPH', 'PPD', 'PPA'],
    ['SKYBET_OPENING', 'SKBH', 'SKBD', 'SKBA'],
  ];
  for (const [bookmaker, h, d, a] of families) {
    const home = decimal(row, h), draw = decimal(row, d), away = decimal(row, a);
    if (home && draw && away) return { bookmaker, home, draw, away, columns: [h, d, a] };
  }
  return null;
}

export function normalized1x2(odds: { home: number; draw: number; away: number }) {
  if (![odds.home, odds.draw, odds.away].every(value => Number.isFinite(value) && value > 1)) throw new Error('FORWARD_MARKET_ODDS_INVALID');
  const home = 1 / odds.home, draw = 1 / odds.draw, away = 1 / odds.away;
  const z = home + draw + away;
  return { home: home / z, draw: draw / z, away: away / z };
}

export function model1x2(prediction: any): { home: number; draw: number; away: number } | null {
  const ft = prediction?.multiMarket?.oneXTwo?.ft;
  const home = Number(ft?.home), draw = Number(ft?.draw), away = Number(ft?.away);
  if (![home, draw, away].every(Number.isFinite)) return null;
  const z = home + draw + away;
  if (home < 0 || draw < 0 || away < 0 || Math.abs(z - 1) > 1e-6) return null;
  return { home, draw, away };
}

export function predictionStrictOk(prediction: any, targetDate: string): boolean {
  const audit = prediction?.strictPriorAudit;
  const evidence = audit?.evidence ?? prediction?.temporalEvidenceAudit ?? prediction?.bigDbRetrieval?.temporalAudit;
  const maxEvidenceDate = text(evidence?.maxEvidenceDate).slice(0, 10);
  return audit?.verified === true
    && evidence?.verified === true
    && Number(evidence?.futureEvidenceCount) === 0
    && Number(evidence?.sameDateEvidenceCount) === 0
    && /^\d{4}-\d{2}-\d{2}$/.test(maxEvidenceDate)
    && maxEvidenceDate < targetDate;
}

export function chooseSelection(model: { home: number; draw: number; away: number }, market: { home: number; draw: number; away: number }) {
  const rows = [
    { selection: 'HOME' as const, cfiProbability: model.home, marketProbability: market.home },
    { selection: 'DRAW' as const, cfiProbability: model.draw, marketProbability: market.draw },
    { selection: 'AWAY' as const, cfiProbability: model.away, marketProbability: market.away },
  ].map(row => ({ ...row, edge: row.cfiProbability - row.marketProbability }));
  rows.sort((a, b) => b.edge - a.edge || b.cfiProbability - a.cfiProbability || a.selection.localeCompare(b.selection));
  return rows[0];
}
