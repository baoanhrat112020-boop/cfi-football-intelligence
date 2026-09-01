import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PRODUCTION_SCORE_GRID_TAP } from './production-score-grid-tap.mjs';

export const GROUP_A_SCOREGRID_EVALUATOR_V1 = Object.freeze({
  version: 'CFI_GROUP_A_SCOREGRID_EVALUATOR_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  noReconstruction: true,
  pairedBaseline: true,
  scoreGridSource: PRODUCTION_SCORE_GRID_TAP.version,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const suitePath = path.join(here, 'group-a-full-suite-v1.mjs');
const tapUrl = pathToFileURL(path.join(here, 'production-score-grid-tap.mjs')).href;

function count(text, needle) {
  let n = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) !== -1) {
    n += 1;
    offset += needle.length;
  }
  return n;
}

function replaceOnce(source, anchor, replacement, errorCode) {
  if (count(source, anchor) !== 1) throw new Error(errorCode);
  return source.replace(anchor, replacement);
}

function rewriteRelativeImports(source, sourceDir) {
  return source.replace(/from\s+(['"])(\.\.?\/[^'"]+)\1/g, (_match, quote, specifier) => {
    return `from ${quote}${pathToFileURL(path.resolve(sourceDir, specifier)).href}${quote}`;
  });
}

async function loadPairedSuite() {
  let source = await fs.readFile(suitePath, 'utf8');

  source = replaceOnce(
    source,
    "import { buildPrediction } from '../src/prediction/final-engine.ts';",
    `import { buildPinnedProductionPredictionWithResearchGrid as buildPrediction } from '${tapUrl}';`,
    'GROUP_A_SCOREGRID_BUILD_PREDICTION_IMPORT_DRIFT',
  );

  source = replaceOnce(
    source,
    "function candidateState(){return {metrics:initMetrics(),segments:new Map(),eligible:0,active:0,abstain:0,featureMissing:0,coherenceFailures:0,clipped:0};}",
    "function candidateState(){return {metrics:initMetrics(),baselineMetrics:initMetrics(),segments:new Map(),baselineSegments:new Map(),eligible:0,active:0,abstain:0,featureMissing:0,coherenceFailures:0,clipped:0};}",
    'GROUP_A_SCOREGRID_CANDIDATE_STATE_DRIFT',
  );

  source = replaceOnce(
    source,
    "const m=finish(s.metrics),a=aggregate(m),b=aggregate(baselineFinished),segments=pairCandidateSegments(segDone(s.segments),baselineSegmentFinished);",
    "const m=finish(s.metrics),pairedBaseline=finish(s.baselineMetrics),a=aggregate(m),b=aggregate(pairedBaseline),pairedBaselineSegments=segDone(s.baselineSegments),segments=pairCandidateSegments(segDone(s.segments),pairedBaselineSegments);",
    'GROUP_A_SCOREGRID_FINISH_CANDIDATE_DRIFT',
  );

  source = replaceOnce(
    source,
    "baselineFinished[fam][part].brier",
    "pairedBaseline[fam][part].brier",
    'GROUP_A_SCOREGRID_REGRESSION_BASELINE_DRIFT',
  );

  source = replaceOnce(
    source,
    "const blockers=['BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS','NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT'];",
    "const blockers=[];if(!(pairedBaseline.scoreline.ht.fullGridAvailable===true&&pairedBaseline.scoreline.ft.fullGridAvailable===true&&pairedBaseline.scoreline.ht.logLoss!==null&&pairedBaseline.scoreline.ft.logLoss!==null))blockers.push('BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS');blockers.push('NO_SYNCHRONIZED_HISTORICAL_ODDS_FOR_BOARD_IMPACT');",
    'GROUP_A_SCOREGRID_BLOCKER_POLICY_DRIFT',
  );

  source = replaceOnce(
    source,
    "metrics:m,aggregate:{baseline:b,challenger:a,deltaVsProduction:",
    "metrics:m,pairedBaselineMetrics:pairedBaseline,aggregate:{baseline:b,challenger:a,deltaVsProduction:",
    'GROUP_A_SCOREGRID_PAIRED_METRICS_EXPORT_DRIFT',
  );

  source = replaceOnce(
    source,
    "if(inEval){const rb=record(baselineMetrics,{mm:pred.multiMarket,htGrid:null,ftGrid:null,pred,target});",
    "if(inEval){const productionGrid=pred.__researchFullScoreGrid;if(!productionGrid?.ht||!productionGrid?.ft)throw new Error('BASELINE_FULL_SCORE_GRID_TAP_MISSING');const rb=record(baselineMetrics,{mm:pred.multiMarket,htGrid:productionGrid.ht,ftGrid:productionGrid.ft,pred,target});if(typeof options.rowObserver==='function')options.rowObserver({kind:'baseline',target,mm:pred.multiMarket});",
    'GROUP_A_SCOREGRID_GLOBAL_BASELINE_RECORD_DRIFT',
  );

  source = replaceOnce(
    source,
    "const rq=record(s.metrics,{mm,htGrid,ftGrid,pred:null,target});segAdd(s.segments,target.competitionSegment||'UNKNOWN','challenger',rq);s.eligible++;",
    "const productionGrid=pred.__researchFullScoreGrid;if(!productionGrid?.ht||!productionGrid?.ft)throw new Error('BASELINE_FULL_SCORE_GRID_TAP_MISSING');const rbq=record(s.baselineMetrics,{mm:pred.multiMarket,htGrid:productionGrid.ht,ftGrid:productionGrid.ft,pred,target});segAdd(s.baselineSegments,target.competitionSegment||'UNKNOWN','baseline',rbq);const rq=record(s.metrics,{mm,htGrid,ftGrid,pred:null,target});segAdd(s.segments,target.competitionSegment||'UNKNOWN','challenger',rq);if(typeof options.rowObserver==='function')options.rowObserver({kind:'challenger',name,target,mm});s.eligible++;",
    'GROUP_A_SCOREGRID_PAIRED_BASELINE_RECORD_DRIFT',
  );

  source = rewriteRelativeImports(source, here);
  const tempPath = path.join(os.tmpdir(), `cfi-group-a-scoregrid-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  await fs.writeFile(tempPath, source, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    return await import(`${pathToFileURL(tempPath).href}?cfi_group_a_scoregrid=1`);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

const pairedSuite = await loadPairedSuite();
if (typeof pairedSuite?.runGroupAFullSuiteV1 !== 'function') throw new Error('GROUP_A_SCOREGRID_RUNNER_MISSING');

export function runGroupAFullSuiteScoreGridV1(corpus, featureBundle, options = {}) {
  const result = pairedSuite.runGroupAFullSuiteV1(corpus, featureBundle, options);
  if (result?.productionMutationAllowed !== false || result?.decisionUse !== false || result?.noReconstruction !== true) {
    throw new Error('GROUP_A_SCOREGRID_RESEARCH_ISOLATION_FAIL');
  }
  if (result?.baselineMetrics?.scoreline?.ht?.fullGridAvailable !== true || result?.baselineMetrics?.scoreline?.ft?.fullGridAvailable !== true) {
    throw new Error('GROUP_A_SCOREGRID_GLOBAL_BASELINE_GRID_MISSING');
  }
  for (const candidate of Object.values(result?.challengers ?? {})) {
    const paired = candidate?.pairedBaselineMetrics;
    if (Number(candidate?.coverage?.eligible ?? 0) > 0) {
      if (paired?.scoreline?.ht?.fullGridAvailable !== true || paired?.scoreline?.ft?.fullGridAvailable !== true) throw new Error('GROUP_A_SCOREGRID_PAIRED_BASELINE_GRID_MISSING');
      if (paired?.scoreline?.ht?.n !== candidate?.metrics?.scoreline?.ht?.n || paired?.scoreline?.ft?.n !== candidate?.metrics?.scoreline?.ft?.n) throw new Error('GROUP_A_SCOREGRID_PAIR_COUNT_MISMATCH');
      if ((candidate?.hardBlockers ?? []).includes('BASELINE_FULL_SCORE_GRID_NOT_EXPOSED_FOR_PAIRED_SCORELINE_LOGLOSS')) throw new Error('GROUP_A_SCOREGRID_BLOCKER_NOT_CLEARED');
    }
  }
  return {
    ...result,
    scoreGridEvaluation: {
      ...GROUP_A_SCOREGRID_EVALUATOR_V1,
      globalBaselineHtLogLoss: result.baselineMetrics.scoreline.ht.logLoss,
      globalBaselineFtLogLoss: result.baselineMetrics.scoreline.ft.logLoss,
    },
  };
}
