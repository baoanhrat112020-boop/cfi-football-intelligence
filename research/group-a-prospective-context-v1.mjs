import { buildPrediction } from '../src/prediction/final-engine.ts';
import { resolveFootballDataDivision } from '../local-node/harvester/football-data/historical-registry.mjs';
import { runGroupAFullSuiteV1 } from './group-a-full-suite-v1.mjs';
import { applyFrozenGroupACandidate, GROUP_A_PROSPECTIVE_MODEL_V1 } from './group-a-prospective-model-v1.mjs';

export const GROUP_A_PROSPECTIVE_CONTEXT_V1 = Object.freeze({
  version: 'CFI_GROUP_A_PROSPECTIVE_CONTEXT_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  noReconstruction: true,
  historyCap: 40,
  minTeamPrior: 6,
  trainedThrough: GROUP_A_PROSPECTIVE_MODEL_V1.trainedThrough,
  holdoutStart: GROUP_A_PROSPECTIVE_MODEL_V1.holdoutStart,
});

const text = value => String(value ?? '').trim();
const date10 = value => text(value).slice(0, 10);
const keyPair = (a, b) => [text(a), text(b)].sort().join('|');

function scoreValid(row) {
  return [row?.ht_home,row?.ht_away,row?.ft_home,row?.ft_away].every(x => Number.isInteger(Number(x)) && Number(x) >= 0)
    && Number(row.ht_home) <= Number(row.ft_home)
    && Number(row.ht_away) <= Number(row.ft_away);
}

function historyRow(row) {
  return {
    id: text(row.fixture_id),
    matchDate: date10(row.match_date),
    homeTeam: text(row.home_team),
    awayTeam: text(row.away_team),
    ht: { home: Number(row.ht_home), away: Number(row.ht_away) },
    ft: { home: Number(row.ft_home), away: Number(row.ft_away) },
  };
}

function corpusRows(corpus) {
  const rows = Array.isArray(corpus) ? corpus : (corpus?.fixtures ?? []);
  const valid = rows.filter(row => {
    const d = date10(row?.match_date);
    return /^\d{4}-\d{2}-\d{2}$/.test(d)
      && d <= GROUP_A_PROSPECTIVE_CONTEXT_V1.trainedThrough
      && text(row?.home_team_id)
      && text(row?.away_team_id)
      && text(row?.home_team)
      && text(row?.away_team)
      && scoreValid(row);
  });
  if (!valid.length) throw new Error('GROUP_A_PROSPECTIVE_FROZEN_CORPUS_REQUIRED');
  if (rows.some(row => date10(row?.match_date) >= GROUP_A_PROSPECTIVE_CONTEXT_V1.holdoutStart)) {
    throw new Error('GROUP_A_PROSPECTIVE_CORPUS_HOLDOUT_LEAKAGE');
  }
  return [...valid].sort((a,b) => date10(a.match_date).localeCompare(date10(b.match_date)) || text(a.fixture_id).localeCompare(text(b.fixture_id)));
}

function latestFrozenStrength(featureBundle, teamId) {
  const strengths = Array.isArray(featureBundle) ? featureBundle : (featureBundle?.strengths ?? []);
  const rows = strengths.filter(row => text(row?.team_id) === text(teamId));
  if (rows.some(row => row?.strict_prior !== true)) throw new Error(`GROUP_A_PROSPECTIVE_NON_STRICT_STRENGTH_LINEAGE:${teamId}`);
  const eligible = rows
    .filter(row => date10(row?.as_of_date) && date10(row.as_of_date) < GROUP_A_PROSPECTIVE_CONTEXT_V1.holdoutStart)
    .sort((a,b) => date10(b.as_of_date).localeCompare(date10(a.as_of_date)));
  if (!eligible.length) throw new Error(`GROUP_A_PROSPECTIVE_FROZEN_STRENGTH_REQUIRED:${teamId}`);
  return eligible[0];
}

export function resolveProspectiveCompetition({ fixture, competitionProfiles = [] } = {}) {
  const provenance = fixture?.source_provenance ?? {};
  const sourceName = text(fixture?.source_name).toLowerCase();
  const sourceCode = text(provenance?.source).toUpperCase();
  const provider = text(provenance?.provider).toLowerCase();
  const isFootballData = sourceName.startsWith('football-data')
    || sourceCode === 'FOOTBALL_DATA_FIXTURES_CSV'
    || provider === 'football-data';
  if (!isFootballData) throw new Error('GROUP_A_PROSPECTIVE_FOOTBALL_DATA_FIXTURE_REQUIRED');
  const sourceDivision = text(provenance?.sourceDivision ?? provenance?.division ?? fixture?.competition).toUpperCase();
  const registry = resolveFootballDataDivision(sourceDivision);
  if (!registry) throw new Error(`GROUP_A_PROSPECTIVE_DIVISION_UNRESOLVED:${sourceDivision || 'EMPTY'}`);
  const matches = competitionProfiles.filter(row => text(row?.competition_key) === registry.canonicalCompetitionKey);
  if (matches.length !== 1) throw new Error(`GROUP_A_PROSPECTIVE_COMPETITION_PROFILE_REQUIRED:${registry.canonicalCompetitionKey}`);
  const profile = matches[0];
  const segment = text(profile?.segment);
  if (!segment) throw new Error(`GROUP_A_PROSPECTIVE_COMPETITION_SEGMENT_REQUIRED:${registry.canonicalCompetitionKey}`);
  return {
    sourceDivision,
    registry,
    competitionKey: registry.canonicalCompetitionKey,
    competitionSegment: segment,
    profileSource: text(profile?.source) || null,
    profileConfidence: Number.isFinite(Number(profile?.confidence)) ? Number(profile.confidence) : null,
  };
}

export function buildFrozenBaselineContext({ corpus, featureBundle, fixture, competitionProfiles = [] } = {}) {
  const targetDate = date10(fixture?.target_date);
  const kickoffAt = text(fixture?.kickoff_at);
  const homeTeamId = text(fixture?.canonical_home_team_id);
  const awayTeamId = text(fixture?.canonical_away_team_id);
  const homeTeam = text(fixture?.home_team);
  const awayTeam = text(fixture?.away_team);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || targetDate < GROUP_A_PROSPECTIVE_CONTEXT_V1.holdoutStart) throw new Error('GROUP_A_PROSPECTIVE_TARGET_MUST_BE_HOLDOUT');
  if (!Number.isFinite(Date.parse(kickoffAt))) throw new Error('GROUP_A_PROSPECTIVE_KICKOFF_REQUIRED');
  if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId || !homeTeam || !awayTeam) throw new Error('GROUP_A_PROSPECTIVE_CANONICAL_FIXTURE_IDENTITY_REQUIRED');
  if (fixture?.verification_status !== 'VERIFIED') throw new Error('GROUP_A_PROSPECTIVE_VERIFIED_FIXTURE_REQUIRED');

  const rows = corpusRows(corpus);
  const homeHistory = rows.filter(row => [text(row.home_team_id),text(row.away_team_id)].includes(homeTeamId)).slice(-GROUP_A_PROSPECTIVE_CONTEXT_V1.historyCap);
  const awayHistory = rows.filter(row => [text(row.home_team_id),text(row.away_team_id)].includes(awayTeamId)).slice(-GROUP_A_PROSPECTIVE_CONTEXT_V1.historyCap);
  const h2h = rows.filter(row => keyPair(row.home_team_id,row.away_team_id) === keyPair(homeTeamId,awayTeamId)).slice(-GROUP_A_PROSPECTIVE_CONTEXT_V1.historyCap);
  if (homeHistory.length < GROUP_A_PROSPECTIVE_CONTEXT_V1.minTeamPrior || awayHistory.length < GROUP_A_PROSPECTIVE_CONTEXT_V1.minTeamPrior) {
    throw new Error('GROUP_A_PROSPECTIVE_MIN_TEAM_PRIOR_REQUIRED');
  }

  const homeStrength = latestFrozenStrength(featureBundle,homeTeamId);
  const awayStrength = latestFrozenStrength(featureBundle,awayTeamId);
  const competition = resolveProspectiveCompetition({fixture,competitionProfiles});
  const baseline = buildPrediction({
    home: homeTeam,
    away: awayTeam,
    targetDate,
    language: 'en',
    homePayload: homeHistory.map(historyRow),
    awayPayload: awayHistory.map(historyRow),
    h2hPayload: h2h.map(historyRow),
  });
  if (baseline?.multiMarket?.consistencyGuard?.status !== 'PASS') throw new Error('GROUP_A_PROSPECTIVE_BASELINE_COHERENCE_FAIL');
  const e = baseline?.scoreline?.expectedGoals;
  const baseExpectedGoals = { htHome:Number(e?.htHome), htAway:Number(e?.htAway), ftHome:Number(e?.ftHome), ftAway:Number(e?.ftAway) };
  if (!Object.values(baseExpectedGoals).every(x => Number.isFinite(x) && x >= 0)) throw new Error('GROUP_A_PROSPECTIVE_BASE_EXPECTED_GOALS_REQUIRED');
  const evidenceDates = [
    ...homeHistory.map(row => date10(row.match_date)),
    ...awayHistory.map(row => date10(row.match_date)),
    ...h2h.map(row => date10(row.match_date)),
    date10(homeStrength.as_of_date),
    date10(awayStrength.as_of_date),
  ].filter(Boolean).sort();
  const maxEvidenceDate = evidenceDates.at(-1) ?? null;
  if (!maxEvidenceDate || maxEvidenceDate >= targetDate || maxEvidenceDate >= GROUP_A_PROSPECTIVE_CONTEXT_V1.holdoutStart) {
    throw new Error('GROUP_A_PROSPECTIVE_MAX_EVIDENCE_INVALID');
  }
  return {
    version: GROUP_A_PROSPECTIVE_CONTEXT_V1.version,
    fixture: {
      fixtureId:text(fixture.fixture_id),targetDate,kickoffAt,homeTeam,awayTeam,
      canonicalHomeTeamId:homeTeamId,canonicalAwayTeamId:awayTeamId,
    },
    competition,
    historySupport:{home:homeHistory.length,away:awayHistory.length,h2h:h2h.length},
    maxEvidenceDate,
    homeStrength,
    awayStrength,
    baseExpectedGoals,
    baselineFingerprint:text(baseline?.engineVersion ?? baseline?.version ?? 'CFI_FINAL_V5.3.1'),
    researchOnly:true,decisionUse:false,productionMutationAllowed:false,noReconstruction:true,
  };
}

export function buildGroupAProspectivePredictions({ corpus, featureBundle, fixture, competitionProfiles = [], suiteResult = null, suiteOptions = {} } = {}) {
  const context = buildFrozenBaselineContext({corpus,featureBundle,fixture,competitionProfiles});
  const suite = suiteResult ?? runGroupAFullSuiteV1(corpus,featureBundle,suiteOptions);
  if (suite?.strictPrior !== true || suite?.noReconstruction !== true || suite?.decisionUse !== false || suite?.productionMutationAllowed !== false) {
    throw new Error('GROUP_A_PROSPECTIVE_FROZEN_SUITE_CONTRACT_FAIL');
  }
  const out = {};
  for (const modelName of GROUP_A_PROSPECTIVE_MODEL_V1.selectedCandidates) {
    const learner = suite?.challengers?.[modelName]?.learner;
    const args = modelName === 'OPPONENT_STRENGTH_ARM_V1'
      ? {modelName,baseExpectedGoals:context.baseExpectedGoals,homeStrength:context.homeStrength,awayStrength:context.awayStrength,learner}
      : {modelName,baseExpectedGoals:context.baseExpectedGoals,competitionSegment:context.competition.competitionSegment,learner};
    out[modelName] = applyFrozenGroupACandidate(args);
  }
  return {
    version:'CFI_GROUP_A_PROSPECTIVE_PREDICTIONS_V1',
    context,
    predictions:out,
    researchOnly:true,decisionUse:false,productionMutationAllowed:false,productionEligible:false,noReconstruction:true,
  };
}
