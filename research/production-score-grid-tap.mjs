import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PRODUCTION_BASELINE_LOCK, verifyProductionBaselineLock } from './production-baseline-lock.mjs';

export const PRODUCTION_SCORE_GRID_TAP = Object.freeze({
  version: 'CFI_PRODUCTION_SCORE_GRID_TAP_V1',
  researchOnly: true,
  decisionUse: false,
  productionMutationAllowed: false,
  noReconstruction: true,
  baselineCommitSha: PRODUCTION_BASELINE_LOCK.commitSha,
  baselineEngine: PRODUCTION_BASELINE_LOCK.engine,
  primaryContract: PRODUCTION_BASELINE_LOCK.primaryContract,
});

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const enginePath = path.join(repoRoot, 'src', 'prediction', 'final-engine.ts');
const RETURN_ANCHOR = "return{status:evidence.unique.length?'DATA_READY':'INSUFFICIENT_DATA'";
const GRID_INJECTION = "return{__researchFullScoreGrid:{ht:htFinal.map(r=>{const[h,a]=String(r.score).split('-').map(Number);return{...r,home:h,away:a,total:h+a}}),ft:ftFinal.map(r=>{const[h,a]=String(r.score).split('-').map(Number);return{...r,home:h,away:a,total:h+a}})},status:evidence.unique.length?'DATA_READY':'INSUFFICIENT_DATA'";

function count(text, needle) {
  let n = 0;
  let offset = 0;
  while ((offset = text.indexOf(needle, offset)) !== -1) {
    n += 1;
    offset += needle.length;
  }
  return n;
}

function rewriteRelativeImports(source, sourceDir) {
  return source.replace(/from\s+(['"])(\.\/[^'"]+)\1/g, (_match, quote, specifier) => {
    const resolved = pathToFileURL(path.resolve(sourceDir, specifier)).href;
    return `from ${quote}${resolved}${quote}`;
  });
}

function validateGrid(grid, label) {
  if (!Array.isArray(grid) || grid.length === 0) throw new Error(`RESEARCH_SCORE_GRID_${label}_MISSING`);
  let sum = 0;
  for (const row of grid) {
    const p = Number(row?.probability);
    if (!Number.isFinite(p) || p < 0) throw new Error(`RESEARCH_SCORE_GRID_${label}_INVALID_PROBABILITY`);
    if (!Number.isSafeInteger(Number(row?.home)) || Number(row.home) < 0 || !Number.isSafeInteger(Number(row?.away)) || Number(row.away) < 0) {
      throw new Error(`RESEARCH_SCORE_GRID_${label}_INVALID_SCORE`);
    }
    if (String(row?.score) !== `${Number(row.home)}-${Number(row.away)}` || Number(row?.total) !== Number(row.home) + Number(row.away)) {
      throw new Error(`RESEARCH_SCORE_GRID_${label}_SCORE_IDENTITY_MISMATCH`);
    }
    sum += p;
  }
  if (Math.abs(sum - 1) > 1e-8) throw new Error(`RESEARCH_SCORE_GRID_${label}_NOT_NORMALIZED`);
}

function eventMass(grid, predicate) {
  return grid.reduce((sum, row) => sum + (predicate(row) ? Number(row.probability) : 0), 0);
}

function assertPredictionCoherence(prediction) {
  const grids = prediction?.__researchFullScoreGrid;
  validateGrid(grids?.ht, 'HT');
  validateGrid(grids?.ft, 'FT');
  const expected = {
    '3+ HT': eventMass(grids.ht, row => Number(row.total) >= 3),
    '7+ FT': eventMass(grids.ft, row => Number(row.total) >= 7),
    'Other HT': eventMass(grids.ht, row => Math.max(Number(row.home), Number(row.away)) >= 4),
    'Other FT': eventMass(grids.ft, row => Math.max(Number(row.home), Number(row.away)) >= 5),
  };
  for (const [market, mass] of Object.entries(expected)) {
    const exposed = Number(prediction?.markets?.[market]?.final);
    if (!Number.isFinite(exposed) || Math.abs(exposed - mass) > 1e-9) {
      throw new Error(`RESEARCH_SCORE_GRID_MARKET_COHERENCE_FAIL:${market}`);
    }
  }
  if (prediction?.multiMarket?.consistencyGuard?.status !== 'PASS') throw new Error('RESEARCH_SCORE_GRID_MULTIMARKET_COHERENCE_FAIL');
  if (prediction?.engine !== PRODUCTION_BASELINE_LOCK.engine || prediction?.contract !== PRODUCTION_BASELINE_LOCK.primaryContract) {
    throw new Error('RESEARCH_SCORE_GRID_BASELINE_IDENTITY_DRIFT');
  }
}

async function loadPinnedTappedEngine() {
  verifyProductionBaselineLock();
  const original = await fs.readFile(enginePath, 'utf8');
  if (count(original, RETURN_ANCHOR) !== 1) throw new Error('RESEARCH_SCORE_GRID_RETURN_ANCHOR_DRIFT');
  let transformed = original.replace(RETURN_ANCHOR, GRID_INJECTION);
  transformed = rewriteRelativeImports(transformed, path.dirname(enginePath));
  const tempPath = path.join(os.tmpdir(), `cfi-production-score-grid-tap-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.ts`);
  await fs.writeFile(tempPath, transformed, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  try {
    return await import(`${pathToFileURL(tempPath).href}?cfi_research_grid_tap=1`);
  } finally {
    await fs.rm(tempPath, { force: true });
  }
}

const tappedEngine = await loadPinnedTappedEngine();
if (typeof tappedEngine?.buildPrediction !== 'function') throw new Error('RESEARCH_SCORE_GRID_BUILD_PREDICTION_MISSING');

export function buildPinnedProductionPredictionWithResearchGrid(args) {
  const prediction = tappedEngine.buildPrediction(args);
  assertPredictionCoherence(prediction);
  return prediction;
}

export function stripResearchScoreGrid(prediction) {
  if (!prediction || typeof prediction !== 'object') return prediction;
  const { __researchFullScoreGrid: _grid, ...publicPrediction } = prediction;
  return publicPrediction;
}
