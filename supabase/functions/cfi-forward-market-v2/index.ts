import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  FOOTBALL_DATA_FORWARD_V2,
  chooseOpening1x2,
  chooseSelection,
  footballDataDateToYmd,
  model1x2,
  normalizeName,
  normalized1x2,
  parseCsv,
  predictionStrictOk,
  text,
  zonedDateTimeToUtcIso,
} from './football-data.ts';

const VERSION = 'CFI_FORWARD_MARKET_AUTOMATION_V2';
const MAX_HORIZON_MS = 72 * 60 * 60 * 1000;
const MIN_LEAD_MS = 5 * 60 * 1000;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Db = ReturnType<typeof createClient>;
type Snapshot = {
  snapshot_id: string;
  created_at: string;
  target_date: string;
  home_team: string;
  away_team: string;
  strict_prior: boolean;
  prediction: any;
  prediction_hash: string;
  source: string;
};
type Team = { team_id: string; canonical_name: string };
type Alias = { alias_normalized: string; alias_display: string; team_id: string; confidence: number | string };

type Planned = {
  row: Record<string, string>;
  targetDate: string;
  kickoffAt: string;
  snapshot: Snapshot;
  homeTeamId: string;
  awayTeamId: string;
  odds: { bookmaker: string; home: number; draw: number; away: number; columns: string[] };
};

function identityMaps(teams: Team[], aliases: Alias[]) {
  const canonical = new Map<string, string>();
  for (const team of teams) {
    const key = normalizeName(team.canonical_name);
    if (!key) continue;
    if (!canonical.has(key)) canonical.set(key, team.team_id);
    else if (canonical.get(key) !== team.team_id) canonical.set(key, '');
  }
  const alias = new Map<string, string>();
  for (const row of aliases) {
    const key = normalizeName(row.alias_normalized || row.alias_display);
    if (!key || Number(row.confidence) < 0.95) continue;
    if (!alias.has(key)) alias.set(key, row.team_id);
    else if (alias.get(key) !== row.team_id) alias.set(key, '');
  }
  const resolve = (name: string) => canonical.get(normalizeName(name)) || alias.get(normalizeName(name)) || null;
  return { resolve };
}

function latestEligibleSnapshot(rows: Snapshot[], kickoffAt: string, targetDate: string): Snapshot | null {
  const kickoff = Date.parse(kickoffAt);
  return rows
    .filter(row => row.strict_prior === true)
    .filter(row => row.source !== 'FORWARD_MARKET_AUTOMATION' && row.source !== 'FORWARD_MARKET_AUTOMATION_V2')
    .filter(row => Number.isFinite(Date.parse(row.created_at)) && Date.parse(row.created_at) < kickoff)
    .filter(row => predictionStrictOk(row.prediction, targetDate))
    .filter(row => model1x2(row.prediction) !== null)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0] ?? null;
}

async function fetchFootballDataCsv() {
  const response = await fetch(FOOTBALL_DATA_FORWARD_V2.sourceUrl, {
    headers: { accept: 'text/csv,text/plain;q=0.9,*/*;q=0.1', 'user-agent': 'CFI-Football-Intelligence/forward-market-v2' },
  });
  if (!response.ok) throw new Error(`FOOTBALL_DATA_HTTP_${response.status}`);
  return await response.text();
}

async function buildPlan(db: Db) {
  const observedAt = new Date().toISOString();
  const observedMs = Date.parse(observedAt);
  const csv = await fetchFootballDataCsv();
  const parsed = parseCsv(csv);
  const candidates: Array<{ row: Record<string, string>; targetDate: string; kickoffAt: string; odds: NonNullable<ReturnType<typeof chooseOpening1x2>> }> = [];
  const skipped: any[] = [];

  for (const row of parsed) {
    const targetDate = footballDataDateToYmd(row.Date);
    const odds = chooseOpening1x2(row);
    if (!targetDate || !text(row.Time) || !text(row.HomeTeam) || !text(row.AwayTeam)) continue;
    let kickoffAt: string;
    try {
      kickoffAt = zonedDateTimeToUtcIso(targetDate, row.Time);
    } catch (error: any) {
      skipped.push({ date: row.Date, time: row.Time, home: row.HomeTeam, away: row.AwayTeam, reason: 'TIMEZONE_CONVERSION_BLOCKED', error: String(error?.message ?? error) });
      continue;
    }
    const kickoffMs = Date.parse(kickoffAt);
    if (kickoffMs <= observedMs + MIN_LEAD_MS || kickoffMs > observedMs + MAX_HORIZON_MS) continue;
    if (!odds) {
      skipped.push({ targetDate, kickoffAt, home: row.HomeTeam, away: row.AwayTeam, reason: 'OPENING_1X2_UNAVAILABLE' });
      continue;
    }
    candidates.push({ row, targetDate, kickoffAt, odds });
  }

  if (!candidates.length) return { observedAt, parsedRows: parsed.length, candidates: 0, planned: [] as Planned[], skipped };
  const targetDates = [...new Set(candidates.map(row => row.targetDate))];
  const [{ data: snapshots, error: snapshotError }, { data: teams, error: teamError }, { data: aliases, error: aliasError }] = await Promise.all([
    db.from('cfi_prediction_snapshots')
      .select('snapshot_id,created_at,target_date,home_team,away_team,strict_prior,prediction,prediction_hash,source')
      .eq('strict_prior', true)
      .in('target_date', targetDates)
      .order('created_at', { ascending: false })
      .limit(2000),
    db.from('teams').select('team_id,canonical_name').limit(100000),
    db.from('team_aliases').select('alias_normalized,alias_display,team_id,confidence').gte('confidence', 0.95).limit(100000),
  ]);
  if (snapshotError) throw snapshotError;
  if (teamError) throw teamError;
  if (aliasError) throw aliasError;

  const ids = identityMaps((teams ?? []) as Team[], (aliases ?? []) as Alias[]);
  const snapshotBuckets = new Map<string, Snapshot[]>();
  for (const snapshot of (snapshots ?? []) as Snapshot[]) {
    const homeId = ids.resolve(snapshot.home_team), awayId = ids.resolve(snapshot.away_team);
    if (!homeId || !awayId) continue;
    const key = `${snapshot.target_date}|${homeId}|${awayId}`;
    const bucket = snapshotBuckets.get(key) ?? [];
    bucket.push(snapshot);
    snapshotBuckets.set(key, bucket);
  }

  const planned: Planned[] = [];
  for (const candidate of candidates) {
    const homeTeamId = ids.resolve(candidate.row.HomeTeam), awayTeamId = ids.resolve(candidate.row.AwayTeam);
    if (!homeTeamId || !awayTeamId) {
      skipped.push({ targetDate: candidate.targetDate, kickoffAt: candidate.kickoffAt, home: candidate.row.HomeTeam, away: candidate.row.AwayTeam, reason: 'TEAM_IDENTITY_NOT_HIGH_CONFIDENCE' });
      continue;
    }
    const key = `${candidate.targetDate}|${homeTeamId}|${awayTeamId}`;
    const snapshot = latestEligibleSnapshot(snapshotBuckets.get(key) ?? [], candidate.kickoffAt, candidate.targetDate);
    if (!snapshot) {
      skipped.push({ targetDate: candidate.targetDate, kickoffAt: candidate.kickoffAt, home: candidate.row.HomeTeam, away: candidate.row.AwayTeam, reason: 'STRICT_PRIOR_SNAPSHOT_NOT_AVAILABLE' });
      continue;
    }
    planned.push({ ...candidate, snapshot, homeTeamId, awayTeamId });
  }
  return { observedAt, parsedRows: parsed.length, candidates: candidates.length, planned, skipped };
}

async function getOrCreateLivingFixture(db: Db, item: Planned) {
  const { data: existing, error: existingError } = await db.from('cfi_living_verified_fixtures')
    .select('fixture_id,target_date,kickoff_at,home_team,away_team,canonical_home_team_id,canonical_away_team_id,verification_status')
    .eq('target_date', item.targetDate)
    .eq('kickoff_at', item.kickoffAt)
    .eq('canonical_home_team_id', item.homeTeamId)
    .eq('canonical_away_team_id', item.awayTeamId)
    .eq('verification_status', 'VERIFIED')
    .limit(2);
  if (existingError) throw existingError;
  if ((existing ?? []).length > 1) throw new Error('LIVING_FIXTURE_IDENTITY_AMBIGUOUS');
  if (existing?.[0]) return existing[0];

  const provenance = {
    contract: VERSION,
    source: 'FOOTBALL_DATA_FIXTURES_CSV',
    sourceUrl: FOOTBALL_DATA_FORWARD_V2.sourceUrl,
    sourceTimeZone: FOOTBALL_DATA_FORWARD_V2.sourceTimeZone,
    sourceDate: item.row.Date,
    sourceTime: item.row.Time,
    sourceDivision: item.row.Div || null,
    sourceHomeTeam: item.row.HomeTeam,
    sourceAwayTeam: item.row.AwayTeam,
    matchedPredictionSnapshotId: item.snapshot.snapshot_id,
    matchedPredictionHash: item.snapshot.prediction_hash,
    strictPriorRequired: true,
    canonicalWriteAllowed: false,
  };
  const payload = {
    target_date: item.targetDate,
    kickoff_at: item.kickoffAt,
    home_team: item.snapshot.home_team,
    away_team: item.snapshot.away_team,
    home_team_norm: normalizeName(item.snapshot.home_team),
    away_team_norm: normalizeName(item.snapshot.away_team),
    competition: item.row.Div || null,
    verification_status: 'VERIFIED',
    source_name: 'Football-Data fixtures.csv',
    source_url: FOOTBALL_DATA_FORWARD_V2.sourceUrl,
    source_provenance: provenance,
    verified_at: new Date().toISOString(),
    canonical_home_team_id: item.homeTeamId,
    canonical_away_team_id: item.awayTeamId,
  };
  const inserted = await db.from('cfi_living_verified_fixtures').insert(payload).select('fixture_id,target_date,kickoff_at,home_team,away_team,canonical_home_team_id,canonical_away_team_id,verification_status').single();
  if (!inserted.error) return inserted.data;
  if (inserted.error.code !== '23505') throw inserted.error;
  const race = await db.from('cfi_living_verified_fixtures')
    .select('fixture_id,target_date,kickoff_at,home_team,away_team,canonical_home_team_id,canonical_away_team_id,verification_status')
    .eq('target_date', item.targetDate).eq('kickoff_at', item.kickoffAt)
    .eq('home_team_norm', payload.home_team_norm).eq('away_team_norm', payload.away_team_norm)
    .eq('verification_status', 'VERIFIED').limit(2);
  if (race.error) throw race.error;
  if ((race.data ?? []).length !== 1) throw new Error('LIVING_FIXTURE_RACE_UNRESOLVED');
  return race.data![0];
}

async function hasDecisionForLivingFixture(db: Db, livingFixtureId: string) {
  const markets = await db.from('cfi_market_snapshots').select('market_snapshot_id').eq('verified_fixture_id', livingFixtureId).eq('research_only', true).limit(100);
  if (markets.error) throw markets.error;
  const ids = (markets.data ?? []).map(row => row.market_snapshot_id);
  if (!ids.length) return false;
  const decisions = await db.from('cfi_decision_snapshots').select('decision_snapshot_id').in('market_snapshot_id', ids).limit(1);
  if (decisions.error) throw decisions.error;
  return Boolean(decisions.data?.length);
}

async function createMarketSnapshot(db: Db, item: Planned, livingFixtureId: string, capturedAt: string) {
  if (Date.parse(capturedAt) >= Date.parse(item.kickoffAt)) throw new Error('MARKET_CAPTURE_NOT_PREKICKOFF');
  const sourceProvenance = {
    contract: VERSION,
    source: 'FOOTBALL_DATA_FIXTURES_CSV',
    sourceUrl: FOOTBALL_DATA_FORWARD_V2.sourceUrl,
    sourceObservedAt: capturedAt,
    providerCollectionTiming: 'Football-Data states weekend odds are generally collected Friday afternoons and midweek odds Tuesday afternoons; exact per-row provider timestamp is not fabricated.',
    sourceTimeZone: FOOTBALL_DATA_FORWARD_V2.sourceTimeZone,
    sourceDate: item.row.Date,
    sourceTime: item.row.Time,
    sourceDivision: item.row.Div || null,
    sourceHomeTeam: item.row.HomeTeam,
    sourceAwayTeam: item.row.AwayTeam,
    oddsColumns: item.odds.columns,
    predictionSnapshotId: item.snapshot.snapshot_id,
    researchOnly: true,
    decisionUse: false,
    canonicalWriteAllowed: false,
  };
  const result = await db.from('cfi_market_snapshots').insert({
    fixture_id: null,
    verified_fixture_id: livingFixtureId,
    captured_at: capturedAt,
    kickoff_at: item.kickoffAt,
    bookmaker: item.odds.bookmaker,
    market_family: '1X2',
    period: 'FT',
    line: null,
    odds_home: item.odds.home,
    odds_draw: item.odds.draw,
    odds_away: item.odds.away,
    odds_over: null,
    odds_under: null,
    source_name: 'Football-Data fixtures.csv',
    source_url: FOOTBALL_DATA_FORWARD_V2.sourceUrl,
    source_provenance: sourceProvenance,
    is_closing: false,
    research_only: true,
  }).select('market_snapshot_id').single();
  if (result.error) throw result.error;
  return result.data.market_snapshot_id as string;
}

async function createShadowDecision(db: Db, item: Planned, marketSnapshotId: string, decisionTime: string) {
  const model = model1x2(item.snapshot.prediction);
  if (!model) throw new Error('FT_1X2_MODEL_UNAVAILABLE');
  const market = normalized1x2(item.odds);
  const pick = chooseSelection(model, market);
  if (Date.parse(decisionTime) >= Date.parse(item.kickoffAt)) throw new Error('DECISION_NOT_PREKICKOFF');
  const result = await db.from('cfi_decision_snapshots').insert({
    prediction_snapshot_id: item.snapshot.snapshot_id,
    research_prediction_snapshot_id: null,
    market_snapshot_id: marketSnapshotId,
    cfi_probability: pick.cfiProbability,
    market_probability: pick.marketProbability,
    edge: pick.edge,
    uncertainty: {
      version: VERSION,
      baselineLock: 'R0_IMMUTABLE',
      source: 'FOOTBALL_DATA_FIXTURES_CSV',
      noReconstruction: true,
      strictPrior: true,
      stakePolicy: 'ZERO_SHADOW_ONLY',
    },
    decision: 'SHADOW',
    stake_simulated: 0,
    decision_timestamp: decisionTime,
    decision_use: false,
    research_only: true,
    selection: pick.selection,
  }).select('decision_snapshot_id').single();
  if (result.error) throw result.error;
  return { decisionSnapshotId: result.data.decision_snapshot_id as string, ...pick };
}

async function capture(db: Db, dryRun: boolean) {
  const plan = await buildPlan(db);
  if (dryRun) {
    return {
      status: 'OK', version: VERSION, mode: 'DRY_RUN', researchOnly: true, decisionUse: false, productionMutation: false, canonicalWriteAllowed: false,
      observedAt: plan.observedAt, parsedRows: plan.parsedRows, candidateRows: plan.candidates, matchedStrictPriorFixtures: plan.planned.length,
      matched: plan.planned.map(item => ({ targetDate: item.targetDate, kickoffAt: item.kickoffAt, sourceHomeTeam: item.row.HomeTeam, sourceAwayTeam: item.row.AwayTeam, snapshotHomeTeam: item.snapshot.home_team, snapshotAwayTeam: item.snapshot.away_team, snapshotId: item.snapshot.snapshot_id, bookmaker: item.odds.bookmaker })),
      skipped: plan.skipped,
    };
  }

  const promoted: any[] = [];
  const skipped = [...plan.skipped];
  for (const item of plan.planned) {
    try {
      if (Date.now() + MIN_LEAD_MS >= Date.parse(item.kickoffAt)) {
        skipped.push({ targetDate: item.targetDate, home: item.snapshot.home_team, away: item.snapshot.away_team, reason: 'LEAD_TIME_EXPIRED' });
        continue;
      }
      const living = await getOrCreateLivingFixture(db, item);
      if (await hasDecisionForLivingFixture(db, living.fixture_id)) {
        skipped.push({ targetDate: item.targetDate, home: item.snapshot.home_team, away: item.snapshot.away_team, livingFixtureId: living.fixture_id, reason: 'VERIFIED_FIXTURE_DECISION_ALREADY_EXISTS' });
        continue;
      }
      const capturedAt = new Date().toISOString();
      const marketSnapshotId = await createMarketSnapshot(db, item, living.fixture_id, capturedAt);
      const decision = await createShadowDecision(db, item, marketSnapshotId, new Date().toISOString());
      promoted.push({
        targetDate: item.targetDate,
        kickoffAt: item.kickoffAt,
        homeTeam: item.snapshot.home_team,
        awayTeam: item.snapshot.away_team,
        livingFixtureId: living.fixture_id,
        predictionSnapshotId: item.snapshot.snapshot_id,
        marketSnapshotId,
        ...decision,
        bookmaker: item.odds.bookmaker,
        decisionUse: false,
      });
    } catch (error: any) {
      skipped.push({ targetDate: item.targetDate, home: item.snapshot.home_team, away: item.snapshot.away_team, reason: 'FAIL_CLOSED', error: String(error?.message ?? error) });
    }
  }
  return {
    status: 'OK', version: VERSION, mode: 'CAPTURE', researchOnly: true, decisionUse: false, productionMutation: false, canonicalWriteAllowed: false,
    observedAt: plan.observedAt, parsedRows: plan.parsedRows, candidateRows: plan.candidates, matchedStrictPriorFixtures: plan.planned.length,
    promoted, skipped,
  };
}

Deno.serve(async req => {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRole = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRole) return json({ status: 'BLOCKED', version: VERSION, error: 'SERVER_SECRET_MISSING' }, 500);
  const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = req.headers.get('x-cfi-forward-token') ?? '';
  const auth = await db.from('cfi_forward_automation_auth').select('token').eq('singleton', true).maybeSingle();
  if (auth.error || !auth.data?.token) return json({ status: 'BLOCKED', version: VERSION, error: 'AUTOMATION_AUTH_UNAVAILABLE' }, 500);
  if (token !== String(auth.data.token)) return json({ status: 'UNAUTHORIZED', version: VERSION }, 401);

  const body = await req.json().catch(() => ({}));
  const action = String(body?.action ?? 'DRY_RUN').toUpperCase();
  try {
    if (action === 'DRY_RUN') return json(await capture(db, true));
    if (action === 'CAPTURE') return json(await capture(db, false));
    if (action === 'SETTLE') {
      const settled = await db.rpc('cfi_settle_forward_market_ready_v2');
      if (settled.error) throw settled.error;
      return json({ status: 'OK', version: VERSION, researchOnly: true, decisionUse: false, productionMutation: false, settlement: settled.data });
    }
    if (action === 'RUN') {
      const captured = await capture(db, false);
      const settled = await db.rpc('cfi_settle_forward_market_ready_v2');
      if (settled.error) throw settled.error;
      return json({ status: 'OK', version: VERSION, researchOnly: true, decisionUse: false, productionMutation: false, canonicalWriteAllowed: false, capture: captured, settlement: settled.data });
    }
    return json({ status: 'INVALID_ACTION', version: VERSION, allowed: ['DRY_RUN', 'CAPTURE', 'SETTLE', 'RUN'] }, 400);
  } catch (error: any) {
    return json({ status: 'ERROR', version: VERSION, researchOnly: true, decisionUse: false, productionMutation: false, canonicalWriteAllowed: false, error: String(error?.message ?? error) }, 500);
  }
});
