import fs from 'node:fs/promises';
import { fairThreeWayProbabilities, fairTwoWayProbabilities } from './market-snapshot-contract.mjs';
import { linkForwardMarketCaptureToCanonicalFixture } from './forward-market-canonical-linker.mjs';
import { runGroupAFullSuitePrimaryV2ScoreGrid } from './group-a-primary-v2-scoregrid-gate.mjs';
import { GROUP_A_CHALLENGERS } from './group-a-full-suite-v1.mjs';
import { MULTIMARKET_MIN_SAMPLES } from './multimarket-promotion-gate-v2.mjs';

export const GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1 = Object.freeze({
  version: 'CFI_GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  canonicalWriteAllowed: false,
  noReconstruction: true,
  sourceSemanticTimingAllowed: true,
  fabricatedCaptureTimestampAllowed: false,
  pairedBaselineEvaluation: true,
  minimumPairedExecutableFixtures: MULTIMARKET_MIN_SAMPLES,
  decisionEdgeFloor: 0.03,
  outcomeBrierRegressionTolerance: 0.001,
  roiRegressionTolerance: 0.02,
  minimumRoiComparisonBets: 10,
});

const EPS = 1e-12;

function text(value) { return String(value ?? '').trim(); }
function finiteScore(value) { return Number.isInteger(Number(value)) && Number(value) >= 0; }
function fixtureId(row) { return text(row?.fixture_id ?? row?.id ?? `${text(row?.match_date)}|${text(row?.home_team)}|${text(row?.away_team)}`); }
function fixtureDate(row) { return text(row?.match_date ?? row?.matchDate).slice(0, 10); }
function fixtureHome(row) { return text(row?.home_team ?? row?.homeTeam); }
function fixtureAway(row) { return text(row?.away_team ?? row?.awayTeam); }
function actualFt(row) { return { home: Number(row?.ft_home ?? row?.ft?.home), away: Number(row?.ft_away ?? row?.ft?.away) }; }
function keyForTarget(target) { return text(target?.id); }

function canonicalFixtures(corpus) {
  const input = Array.isArray(corpus) ? corpus : (corpus?.fixtures ?? []);
  return input.map(row => ({
    fixtureId: fixtureId(row),
    targetDate: fixtureDate(row),
    homeTeam: fixtureHome(row),
    awayTeam: fixtureAway(row),
    homeTeamId: text(row?.home_team_id) || null,
    awayTeamId: text(row?.away_team_id) || null,
    competitionKey: text(row?.competition_key) || null,
    actualFt: actualFt(row),
  })).filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.targetDate) && row.homeTeam && row.awayTeam && finiteScore(row.actualFt.home) && finiteScore(row.actualFt.away));
}

function evidenceAudit(doc) {
  const hardBlockers = [];
  if (doc?.status !== 'READY') hardBlockers.push('HISTORICAL_MARKET_EVIDENCE_NOT_READY');
  if (doc?.researchOnly !== true || doc?.decisionUse !== false || doc?.productionMutationAllowed !== false || doc?.canonicalWriteAllowed !== false) hardBlockers.push('HISTORICAL_MARKET_EVIDENCE_ISOLATION_FAIL');
  if (doc?.reconstructed !== false || doc?.capturedAtFabricated !== false) hardBlockers.push('HISTORICAL_MARKET_EVIDENCE_RECONSTRUCTION_FAIL');
  if (!Array.isArray(doc?.rows) || !doc.rows.length) hardBlockers.push('HISTORICAL_MARKET_EVIDENCE_ROWS_REQUIRED');
  for (const row of doc?.rows ?? []) {
    if (!/^[a-f0-9]{64}$/.test(text(row?.source_sha256))) hardBlockers.push('HISTORICAL_MARKET_SOURCE_SHA256_REQUIRED');
    if (row?.temporalProvenance?.opening?.strictPriorSemantic !== true || row?.temporalProvenance?.opening?.capturedAt !== null || row?.temporalProvenance?.opening?.decisionEligible !== true) hardBlockers.push('HISTORICAL_MARKET_OPENING_TIMING_INVALID');
    if (row?.temporalProvenance?.closing?.decisionEligible !== false) hardBlockers.push('HISTORICAL_MARKET_CLOSING_DECISION_LEAKAGE');
    if (row?.providerPolicy?.pinnacleUsed !== false) hardBlockers.push('HISTORICAL_MARKET_PINNACLE_POLICY_FAIL');
  }
  return [...new Set(hardBlockers)];
}

function linkEvidence(doc, fixtures) {
  const fixturesByDate = new Map();
  const fixtureById = new Map();
  for (const fixture of fixtures) {
    fixtureById.set(fixture.fixtureId, fixture);
    const bucket = fixturesByDate.get(fixture.targetDate) ?? [];
    bucket.push(fixture);
    fixturesByDate.set(fixture.targetDate, bucket);
  }
  const rows = [];
  const reasons = {};
  let verified = 0;
  let resultMismatch = 0;
  for (const evidence of doc.rows ?? []) {
    const targetDate = text(evidence.date);
    const sameDateFixtures = fixturesByDate.get(targetDate) ?? [];
    const link = linkForwardMarketCaptureToCanonicalFixture({
      targetDate,
      homeTeam: evidence.home_team,
      awayTeam: evidence.away_team,
      externalFixtureKey: evidence.identity_key,
    }, sameDateFixtures);
    if (link.status !== 'VERIFIED_RESEARCH_LINK') {
      const reason = link.reason ?? 'UNKNOWN';
      reasons[reason] = (reasons[reason] ?? 0) + 1;
      continue;
    }
    verified += 1;
    const canonical = fixtureById.get(link.fixture.fixtureId);
    if (!canonical) continue;
    if (Number(evidence.actual_ft_home) !== canonical.actualFt.home || Number(evidence.actual_ft_away) !== canonical.actualFt.away) {
      resultMismatch += 1;
      continue;
    }
    rows.push({ fixtureId: canonical.fixtureId, evidence, canonical, link });
  }
  const byFixture = new Map();
  for (const row of rows) {
    const bucket = byFixture.get(row.fixtureId) ?? [];
    bucket.push(row);
    byFixture.set(row.fixtureId, bucket);
  }
  const unique = new Map();
  let duplicateFixtureEvidence = 0;
  for (const [id, bucket] of byFixture) {
    if (bucket.length !== 1) { duplicateFixtureEvidence += bucket.length; continue; }
    unique.set(id, bucket[0]);
  }
  return {
    linked: {
      total: doc.rows?.length ?? 0,
      verified,
      blocked: (doc.rows?.length ?? 0) - verified,
      reasons,
    },
    unique,
    resultMismatch,
    duplicateFixtureEvidence,
  };
}

function brier(probabilities, actualIndex) {
  return probabilities.reduce((sum, p, index) => sum + (p - (index === actualIndex ? 1 : 0)) ** 2, 0) / probabilities.length;
}

function outcomeIndex(actual) { return actual.home > actual.away ? 0 : actual.home === actual.away ? 1 : 2; }
function settledProfit(odds, won) { return won ? odds - 1 : -1; }

function splitQuarter(line) {
  const q = Math.round(Number(line) * 4) / 4;
  const f = Math.abs(q - Math.trunc(q));
  return Math.abs(f - 0.25) < 1e-9 || Math.abs(f - 0.75) < 1e-9 ? [q - 0.25, q + 0.25] : [q, q];
}
function classify(value) { return value > 1e-9 ? 1 : value < -1e-9 ? -1 : 0; }
function ahProfit(diff, line, odds) {
  const [a, b] = splitQuarter(line);
  const x = classify(diff + a), y = classify(diff + b);
  const leg = state => state === 1 ? odds - 1 : state === -1 ? -1 : 0;
  return (leg(x) + leg(y)) / 2;
}
function modelStateEv(states, odds) {
  return Number(states?.fullWin ?? 0) * (odds - 1) + Number(states?.halfWin ?? 0) * ((odds - 1) / 2) - Number(states?.halfLoss ?? 0) * 0.5 - Number(states?.fullLoss ?? 0);
}

function initBoard() {
  return { fixtures: new Set(), scoringRows: 0, modelBrier: 0, marketBrier: 0, bets: 0, pnl: 0, executableRows: 0, selections: new Map() };
}

function addDecision(board, id, marketKey, selection, profit) {
  board.bets += 1;
  board.pnl += profit;
  board.selections.set(`${id}|${marketKey}`, selection);
}

function evaluateObservation(board, observation, linkedEvidence, options = {}) {
  const id = keyForTarget(observation.target);
  const pair = linkedEvidence.get(id);
  if (!pair) return;
  const evidence = pair.evidence;
  const actual = observation.target.ft;
  const mm = observation.mm;
  let executable = false;

  const one = evidence?.opening?.oneXTwo;
  const oneMarket = one?.marketAverage ?? one?.bookmaker;
  if (oneMarket && mm?.oneXTwo?.ft) {
    try {
      const fair = fairThreeWayProbabilities(oneMarket.odds_home, oneMarket.odds_draw, oneMarket.odds_away);
      const marketP = [fair.home, fair.draw, fair.away];
      const modelP = [Number(mm.oneXTwo.ft.home), Number(mm.oneXTwo.ft.draw), Number(mm.oneXTwo.ft.away)];
      if (modelP.every(p => Number.isFinite(p) && p >= 0)) {
        const idx = outcomeIndex(actual);
        board.modelBrier += brier(modelP, idx);
        board.marketBrier += brier(marketP, idx);
        board.scoringRows += 1;
      }
      const book = one?.bookmaker;
      if (book) {
        executable = true;
        board.executableRows += 1;
        const bf = fairThreeWayProbabilities(book.odds_home, book.odds_draw, book.odds_away);
        const fairBook = [bf.home, bf.draw, bf.away];
        const odds = [book.odds_home, book.odds_draw, book.odds_away];
        const labels = ['HOME', 'DRAW', 'AWAY'];
        const edges = modelP.map((p, i) => p - fairBook[i]);
        const best = edges.indexOf(Math.max(...edges));
        if (edges[best] >= Number(options.decisionEdgeFloor ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.decisionEdgeFloor)) {
          addDecision(board, id, '1X2_FT', labels[best], settledProfit(odds[best], best === outcomeIndex(actual)));
        }
      }
    } catch { /* invalid market row remains non-executable */ }
  }

  const ou = evidence?.opening?.overUnder25;
  const ouMarket = ou?.marketAverage ?? ou?.bookmaker;
  const modelOu = mm?.overUnder?.ft?.['2.5'];
  if (ouMarket && modelOu) {
    try {
      const fair = fairTwoWayProbabilities(ouMarket.odds_over, ouMarket.odds_under);
      const modelP = [Number(modelOu?.over?.fullWin ?? 0), Number(modelOu?.under?.fullWin ?? 0)];
      const z = modelP[0] + modelP[1];
      if (z > EPS) {
        modelP[0] /= z; modelP[1] /= z;
        const actualOver = actual.home + actual.away > 2.5 ? 0 : 1;
        board.modelBrier += brier(modelP, actualOver);
        board.marketBrier += brier([fair.a, fair.b], actualOver);
        board.scoringRows += 1;
      }
      const book = ou?.bookmaker;
      if (book) {
        executable = true;
        board.executableRows += 1;
        const bf = fairTwoWayProbabilities(book.odds_over, book.odds_under);
        const edges = [modelP[0] - bf.a, modelP[1] - bf.b];
        const best = edges.indexOf(Math.max(...edges));
        if (edges[best] >= Number(options.decisionEdgeFloor ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.decisionEdgeFloor)) {
          const actualOver = actual.home + actual.away > 2.5;
          const odds = best === 0 ? book.odds_over : book.odds_under;
          addDecision(board, id, 'OU_2.5_FT', best === 0 ? 'OVER' : 'UNDER', settledProfit(odds, best === 0 ? actualOver : !actualOver));
        }
      }
    } catch { /* invalid market row remains non-executable */ }
  }

  const ah = evidence?.opening?.asianHandicap;
  const bookAh = ah?.bookmaker;
  const line = Number(ah?.line);
  const modelAh = Number.isFinite(line) ? mm?.asianHandicap?.ft?.[String(line)] : null;
  if (bookAh && modelAh) {
    executable = true;
    board.executableRows += 1;
    const evHome = modelStateEv(modelAh.home, Number(bookAh.odds_home));
    const evAway = modelStateEv(modelAh.away, Number(bookAh.odds_away));
    const bestEv = Math.max(evHome, evAway);
    if (bestEv >= Number(options.decisionEdgeFloor ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.decisionEdgeFloor)) {
      const home = evHome >= evAway;
      const diff = home ? actual.home - actual.away : actual.away - actual.home;
      const selectedLine = home ? line : -line;
      const odds = home ? Number(bookAh.odds_home) : Number(bookAh.odds_away);
      addDecision(board, id, `AH_${line}_FT`, home ? 'HOME' : 'AWAY', ahProfit(diff, selectedLine, odds));
    }
  }

  if (executable) board.fixtures.add(id);
}

function finishBoard(board) {
  return {
    pairedExecutableFixtures: board.fixtures.size,
    executableMarketRows: board.executableRows,
    scoringRows: board.scoringRows,
    outcomeBrier: board.scoringRows ? board.modelBrier / board.scoringRows : null,
    marketOutcomeBrier: board.scoringRows ? board.marketBrier / board.scoringRows : null,
    simulatedBets: board.bets,
    simulatedPnlUnits: board.pnl,
    simulatedRoi: board.bets ? board.pnl / board.bets : null,
  };
}

function selectionChanges(a, b) {
  let compared = 0, changed = 0;
  for (const [key, selection] of b.selections) {
    if (!a.selections.has(key)) continue;
    compared += 1;
    if (a.selections.get(key) !== selection) changed += 1;
  }
  return { compared, changed, rate: compared ? changed / compared : null };
}

export function applyHistoricalMarketBoardGate(result, observations, marketEvidence, corpus, options = {}) {
  const globalBlockers = evidenceAudit(marketEvidence);
  const fixtures = canonicalFixtures(corpus);
  const linkage = globalBlockers.length ? { unique: new Map(), linked: { total: 0, verified: 0, blocked: 0, reasons: {} }, resultMismatch: 0, duplicateFixtureEvidence: 0 } : linkEvidence(marketEvidence, fixtures);
  if (linkage.resultMismatch > 0) globalBlockers.push('HISTORICAL_MARKET_RESULT_MISMATCH');
  if (linkage.duplicateFixtureEvidence > 0) globalBlockers.push('HISTORICAL_MARKET_DUPLICATE_CANONICAL_EVIDENCE');

  const globalBaselineBoard = initBoard();
  for (const row of observations.baseline.values()) evaluateObservation(globalBaselineBoard, row, linkage.unique, options);
  const globalBaselineFinished = finishBoard(globalBaselineBoard);
  const challengers = {};
  const pairedBaselineByCandidate = {};

  for (const name of GROUP_A_CHALLENGERS) {
    const candidateRows = observations.challengers.get(name) ?? new Map();
    const pairedBaselineBoard = initBoard();
    const candidateBoard = initBoard();
    for (const [id, row] of candidateRows) {
      const baselineRow = observations.baseline.get(id);
      if (baselineRow) evaluateObservation(pairedBaselineBoard, baselineRow, linkage.unique, options);
      evaluateObservation(candidateBoard, row, linkage.unique, options);
    }
    const baselineFinished = finishBoard(pairedBaselineBoard);
    const candidateFinished = finishBoard(candidateBoard);
    pairedBaselineByCandidate[name] = baselineFinished;
    const pairCountMatches = baselineFinished.pairedExecutableFixtures === candidateFinished.pairedExecutableFixtures;
    const sampleReady = globalBlockers.length === 0 && pairCountMatches && candidateFinished.pairedExecutableFixtures >= Number(options.minimumPairedExecutableFixtures ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.minimumPairedExecutableFixtures);
    const boardRegressions = [];
    if (!pairCountMatches) boardRegressions.push('HISTORICAL_MARKET_PAIRED_BASELINE_COVERAGE_MISMATCH');
    if (sampleReady && candidateFinished.outcomeBrier !== null && baselineFinished.outcomeBrier !== null && candidateFinished.outcomeBrier - baselineFinished.outcomeBrier > Number(options.outcomeBrierRegressionTolerance ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.outcomeBrierRegressionTolerance)) boardRegressions.push('HISTORICAL_MARKET_OUTCOME_BRIER_REGRESSION');
    if (sampleReady && candidateFinished.simulatedBets >= Number(options.minimumRoiComparisonBets ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.minimumRoiComparisonBets) && baselineFinished.simulatedBets >= Number(options.minimumRoiComparisonBets ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.minimumRoiComparisonBets) && candidateFinished.simulatedRoi !== null && baselineFinished.simulatedRoi !== null && candidateFinished.simulatedRoi - baselineFinished.simulatedRoi < -Number(options.roiRegressionTolerance ?? GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1.roiRegressionTolerance)) boardRegressions.push('HISTORICAL_MARKET_BOARD_UTILITY_REGRESSION');
    const current = result.challengers?.[name] ?? {};
    const blockers = (current.hardBlockers ?? []).filter(blocker => blocker !== 'NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT');
    if (!sampleReady) blockers.push('NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT');
    blockers.push(...globalBlockers, ...boardRegressions);
    challengers[name] = {
      ...current,
      historicalMarketBoard: {
        ...GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1,
        baseline: baselineFinished,
        challenger: candidateFinished,
        deltaVsBaseline: {
          outcomeBrier: candidateFinished.outcomeBrier !== null && baselineFinished.outcomeBrier !== null ? candidateFinished.outcomeBrier - baselineFinished.outcomeBrier : null,
          simulatedRoi: candidateFinished.simulatedRoi !== null && baselineFinished.simulatedRoi !== null ? candidateFinished.simulatedRoi - baselineFinished.simulatedRoi : null,
          simulatedPnlUnits: candidateFinished.simulatedPnlUnits - baselineFinished.simulatedPnlUnits,
        },
        selectionChanges: selectionChanges(pairedBaselineBoard, candidateBoard),
        pairedFixtureCountMatches: pairCountMatches,
        sampleReady,
        boardRegressions,
      },
      hardBlockers: [...new Set(blockers)],
      shadowEligible: false,
      promotionDecision: 'HOLD',
      productionEligible: false,
      decisionUse: false,
      productionMutationAllowed: false,
    };
  }
  return {
    ...result,
    historicalMarketBoardEvaluation: {
      ...GROUP_A_HISTORICAL_MARKET_BOARD_GATE_V1,
      evidenceVersion: marketEvidence?.version ?? null,
      evidenceRows: marketEvidence?.coverage?.evidenceRows ?? marketEvidence?.rows?.length ?? 0,
      canonicalLinkage: {
        total: linkage.linked.total,
        verified: linkage.linked.verified,
        blocked: linkage.linked.blocked,
        reasons: linkage.linked.reasons,
        uniqueCanonicalEvidenceFixtures: linkage.unique.size,
        resultMismatch: linkage.resultMismatch,
        duplicateFixtureEvidence: linkage.duplicateFixtureEvidence,
      },
      globalBlockers: [...new Set(globalBlockers)],
      globalBaselineDiagnostic: globalBaselineFinished,
      pairedBaselineByCandidate,
    },
    challengers,
    groupAVerdict: Object.values(challengers).every(candidate => candidate.hardBlockers.length === 0) ? 'PASS' : 'HOLD',
    decisionUse: false,
    productionMutationAllowed: false,
  };
}

export function runGroupAWithHistoricalMarketBoard(corpus, featureBundle, marketEvidence, options = {}) {
  const observations = {
    baseline: new Map(),
    challengers: new Map(GROUP_A_CHALLENGERS.map(name => [name, new Map()])),
  };
  const rowObserver = observation => {
    const id = keyForTarget(observation.target);
    if (!id) return;
    if (observation.kind === 'baseline') observations.baseline.set(id, observation);
    else if (observation.kind === 'challenger' && observations.challengers.has(observation.name)) observations.challengers.get(observation.name).set(id, observation);
  };
  const result = runGroupAFullSuitePrimaryV2ScoreGrid(corpus, featureBundle, { ...options, rowObserver });
  return applyHistoricalMarketBoardGate(result, observations, marketEvidence, corpus, options.marketBoardOptions ?? {});
}

async function main() {
  const corpusPath = process.argv[2];
  const featurePath = process.argv[3];
  const marketPath = process.argv[4];
  const outputPath = process.argv[5] ?? 'group-a-historical-market-board-result.json';
  if (!corpusPath || !featurePath || !marketPath) throw new Error('USAGE: node research/group-a-historical-market-board-gate.mjs <r0.json> <group-a.json> <market-evidence.json> [output.json]');
  const [corpus, features, marketEvidence] = await Promise.all([
    fs.readFile(corpusPath, 'utf8').then(JSON.parse),
    fs.readFile(featurePath, 'utf8').then(JSON.parse),
    fs.readFile(marketPath, 'utf8').then(JSON.parse),
  ]);
  const result = runGroupAWithHistoricalMarketBoard(corpus, features, marketEvidence);
  await fs.writeFile(outputPath, `${JSON.stringify(result)}\n`);
  process.stdout.write(`${JSON.stringify({
    outputPath,
    version: result.historicalMarketBoardEvaluation.version,
    groupAVerdict: result.groupAVerdict,
    linkage: result.historicalMarketBoardEvaluation.canonicalLinkage,
    globalBlockers: result.historicalMarketBoardEvaluation.globalBlockers,
    challengers: Object.fromEntries(Object.entries(result.challengers).map(([name, candidate]) => [name, {
      pairedExecutableFixtures: candidate.historicalMarketBoard?.challenger?.pairedExecutableFixtures ?? 0,
      pairedBaselineFixtures: candidate.historicalMarketBoard?.baseline?.pairedExecutableFixtures ?? 0,
      sampleReady: candidate.historicalMarketBoard?.sampleReady ?? false,
      boardRegressions: candidate.historicalMarketBoard?.boardRegressions ?? [],
      hardBlockers: candidate.hardBlockers,
    }])),
    decisionUse: result.decisionUse,
    productionMutationAllowed: result.productionMutationAllowed,
  }, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
