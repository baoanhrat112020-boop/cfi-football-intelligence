import fs from 'node:fs';

export const LIVE_SELF_LEARNING_CONTRACT = Object.freeze({
  version: 'CFI_LIVE_SELF_LEARNING_V1.1',
  champion: 'CFI_LIVE_V1',
  cadenceHours: 4,
  strictPrior: true,
  prematchFrozen: true,
  autoProductionPromotion: false,
  requiredSnapshots: Object.freeze([15,30,45,60,75]),
  requiredMarkets: Object.freeze(['3+ HT','7+ FT','Other HT','Other FT']),
  minSamples: 400,
  minLeagues: 5,
  minCountries: 3,
  maxCalibrationError: 0.06,
  minBrierImprovement: 0.01,
  minLogLossImprovement: 0.01,
  maxMarketRegression: 0.015,
});

const finite=x=>x!==null&&x!==undefined&&x!==''&&Number.isFinite(Number(x));
const nonNegative=x=>finite(x)&&Number(x)>=0;
const unitInterval=x=>finite(x)&&Number(x)>=0&&Number(x)<=1;
const integerCount=x=>Number.isSafeInteger(x)&&x>=0;
const allFinite=(o,keys)=>keys.every(k=>finite(o?.[k]));

export function evaluateLiveCandidate(candidate){
  const reasons=[];
  if(!candidate||typeof candidate!=='object') reasons.push('CANDIDATE_REQUIRED');
  const meta=candidate?.meta??{}, champ=candidate?.champion??{}, chal=candidate?.challenger??{};
  if(meta.strictPrior!==true) reasons.push('STRICT_PRIOR_REQUIRED');
  if(!Number.isSafeInteger(meta.futureLeakageCount)||!Number.isSafeInteger(meta.sameDateLeakageCount)||meta.futureLeakageCount!==0||meta.sameDateLeakageCount!==0) reasons.push('TEMPORAL_LEAKAGE');
  if(meta.deterministic!==true||!finite(meta.maxDeterminismDelta)||Number(meta.maxDeterminismDelta)!==0) reasons.push('NON_DETERMINISTIC');

  if(!integerCount(meta.samples)) reasons.push('SAMPLE_COUNT_REQUIRED');
  else if(meta.samples<LIVE_SELF_LEARNING_CONTRACT.minSamples) reasons.push('INSUFFICIENT_SAMPLE');
  if(!integerCount(meta.leagues)) reasons.push('LEAGUE_COUNT_REQUIRED');
  else if(meta.leagues<LIVE_SELF_LEARNING_CONTRACT.minLeagues) reasons.push('INSUFFICIENT_LEAGUE_DIVERSITY');
  if(!integerCount(meta.countries)) reasons.push('COUNTRY_COUNT_REQUIRED');
  else if(meta.countries<LIVE_SELF_LEARNING_CONTRACT.minCountries) reasons.push('INSUFFICIENT_COUNTRY_DIVERSITY');

  const snapshots=Array.isArray(meta.snapshotMinutes)?meta.snapshotMinutes:[];
  const snapshotSet=new Set(snapshots.filter(Number.isSafeInteger));
  const missingSnapshots=LIVE_SELF_LEARNING_CONTRACT.requiredSnapshots.filter(minute=>!snapshotSet.has(minute));
  if(missingSnapshots.length) reasons.push(`SNAPSHOT_COVERAGE_INCOMPLETE:${missingSnapshots.join(',')}`);

  const required=['brier','logLoss','calibrationError'];
  if(!allFinite(champ,required)||!allFinite(chal,required)) reasons.push('METRICS_INCOMPLETE');
  if(!unitInterval(champ.brier)||!unitInterval(chal.brier)||!nonNegative(champ.logLoss)||!nonNegative(chal.logLoss)||!unitInterval(champ.calibrationError)||!unitInterval(chal.calibrationError)) reasons.push('METRICS_OUT_OF_RANGE');
  if(unitInterval(chal.calibrationError)&&Number(chal.calibrationError)>LIVE_SELF_LEARNING_CONTRACT.maxCalibrationError) reasons.push('CALIBRATION_GATE_FAIL');
  if(unitInterval(champ.brier)&&unitInterval(chal.brier)&&Number(champ.brier)-Number(chal.brier)<LIVE_SELF_LEARNING_CONTRACT.minBrierImprovement) reasons.push('BRIER_IMPROVEMENT_TOO_SMALL');
  if(nonNegative(champ.logLoss)&&nonNegative(chal.logLoss)&&Number(champ.logLoss)-Number(chal.logLoss)<LIVE_SELF_LEARNING_CONTRACT.minLogLossImprovement) reasons.push('LOGLOSS_IMPROVEMENT_TOO_SMALL');

  const marketRows=chal.markets??{};
  const missingMarkets=LIVE_SELF_LEARNING_CONTRACT.requiredMarkets.filter(market=>!finite(marketRows?.[market]?.brierDelta));
  if(missingMarkets.length) reasons.push(`MARKET_METRICS_INCOMPLETE:${missingMarkets.join(',')}`);
  const marketRegressions=LIVE_SELF_LEARNING_CONTRACT.requiredMarkets
    .filter(market=>finite(marketRows?.[market]?.brierDelta)&&Number(marketRows[market].brierDelta)>LIVE_SELF_LEARNING_CONTRACT.maxMarketRegression);
  if(marketRegressions.length) reasons.push(`MARKET_REGRESSION:${marketRegressions.join(',')}`);

  const decision=reasons.length===0?'SHADOW_ELIGIBLE':'HOLD';
  return {contract:LIVE_SELF_LEARNING_CONTRACT,decision,reasons,productionMutationAllowed:false,canaryEligible:decision==='SHADOW_ELIGIBLE'};
}

export function runFromFile(path='research/live-candidate.json'){
  if(!fs.existsSync(path)) return {contract:LIVE_SELF_LEARNING_CONTRACT,decision:'HOLD',reasons:['NO_CANDIDATE_ARTIFACT'],productionMutationAllowed:false,canaryEligible:false};
  return evaluateLiveCandidate(JSON.parse(fs.readFileSync(path,'utf8')));
}

if(import.meta.url===`file://${process.argv[1]}`){
  const result=runFromFile(process.argv[2]);
  fs.mkdirSync('artifacts',{recursive:true});
  fs.writeFileSync('artifacts/live-self-learning-result.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result,null,2));
  process.exit(0);
}
