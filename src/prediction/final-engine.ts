import { buildFutureSixScorelines } from './future-six-scoreline.ts';
import { calibrateMarketProbability, predictiveConfidence, sampleConfidence } from './probability-calibration.ts';
import { calibrateScoreDistribution } from './score-distribution-calibration.ts';
import { buildMultiMarketFromScoreGrids } from './multi-market-v1.ts';
import { buildMultiMarketChampionFusion, CHAMPION_FUSION_VERSION, CHAMPION_FUSION_LINEAGE } from './multi-market-champion-fusion.ts';

export const FINAL_VERSION = "CFI_FINAL_V5.3.0";
export const PRIMARY_CONTRACT = "CFI_2_METHODS_X_6_TARGETS_V2";
export const MARKET_CODES = ["3+ HT", "7+ FT", "Other HT", "Other FT"] as const;
export const PRIMARY_TARGETS = [...MARKET_CODES, "Top-1 HT", "Top-1 FT"] as const;

export type Pair = { home:number; away:number };
export type CanonicalFixture = { id:string; matchDate:string; homeTeam:string; awayTeam:string; ht:Pair|null; ft:Pair|null };
type GridRow = { score:string; probability:number; total:number };

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(v:unknown)=>{ if(v===null||v===undefined||v==='') return null; const n=Number(v); return Number.isSafeInteger(n)&&n>=0?n:null; };
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const recencyWeight=(age:number)=>Math.pow(.92,age);

export function normalizePair(value:unknown):Pair|null{
 if(typeof value==='string'){const m=value.trim().match(/^(\d+)\s*[-:]\s*(\d+)$/);return m?{home:+m[1],away:+m[2]}:null;}
 if(Array.isArray(value)&&value.length>=2){const h=finite(value[0]),a=finite(value[1]);return h===null||a===null?null:{home:h,away:a};}
 if(value&&typeof value==='object'){const r=value as Record<string,unknown>;const h=finite(r.home??r.h??r.homeGoals),a=finite(r.away??r.a??r.awayGoals);return h===null||a===null?null:{home:h,away:a};}
 return null;
}
function unwrapRows(payload:unknown):unknown[]{
 if(Array.isArray(payload)) return payload;
 if(!payload||typeof payload!=='object') return [];
 const r=payload as Record<string,unknown>;
 for(const k of ['fixtures','history','rows','data']){const v=r[k];if(Array.isArray(v))return v;const n=unwrapRows(v);if(n.length)return n;}
 for(const k of ['result','body']){const n=unwrapRows(r[k]);if(n.length)return n;}
 return [];
}
export function normalizeFixture(input:unknown):CanonicalFixture|null{
 if(!input||typeof input!=='object')return null;
 const outer=input as Record<string,unknown>;const r=(outer.fixture??outer.match??outer) as Record<string,unknown>;
 const team=(v:unknown)=>v&&typeof v==='object'?String((v as any).canonical_name??(v as any).name??''):String(v??'');
 const matchDate=String(r.matchDate??r.match_date??r.date??'').slice(0,10),homeTeam=team(r.homeTeam??r.home_team??r.home_name??r.home).trim(),awayTeam=team(r.awayTeam??r.away_team??r.away_name??r.away).trim();
 if(!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)||!homeTeam||!awayTeam)return null;
 const ht=normalizePair(r.ht??r.htScore??r.ht_score??r.halfTime??r.half_time??r.halftimeScore)??normalizePair([r.ht_home??r.hthg??r.home_ht,r.ht_away??r.htag??r.away_ht]);
 const ft=normalizePair(r.ft??r.ftScore??r.ft_score??r.fullTime??r.full_time??r.fulltimeScore)??normalizePair([r.ft_home??r.fthg??r.home_ft,r.ft_away??r.ftag??r.away_ft]);
 if(ht&&ft&&(ht.home>ft.home||ht.away>ft.away))return null;
 const identity=`${matchDate}|${homeTeam.toLowerCase()}|${awayTeam.toLowerCase()}`;
 return {id:String(r.fixture_id??r.fixtureId??r.id??identity),matchDate,homeTeam,awayTeam,ht,ft};
}
export function normalizeFixtures(payload:unknown){return unwrapRows(payload).map(normalizeFixture).filter((x):x is CanonicalFixture=>x!==null);}
export function strictPriorEvidence(homePayload:unknown,awayPayload:unknown,h2hPayload:unknown,targetDate?:string){
 const prior=(xs:CanonicalFixture[])=>xs.filter(x=>!targetDate||x.matchDate<targetDate);
 const home=prior(normalizeFixtures(homePayload)),away=prior(normalizeFixtures(awayPayload)),h2h=prior(normalizeFixtures(h2hPayload));
 const unique=[...new Map([...home,...away,...h2h].map(x=>[`${x.matchDate}|${x.homeTeam.toLowerCase()}|${x.awayTeam.toLowerCase()}`,x])).values()];
 return {streams:{home,away,h2h},unique,counts:{homeFixtures:home.length,awayFixtures:away.length,h2hFixtures:h2h.length,uniqueCanonical:unique.length,htCoverage:unique.filter(x=>x.ht).length,ftCoverage:unique.filter(x=>x.ft).length}};
}
export function marketHit(f:CanonicalFixture,m:typeof MARKET_CODES[number]){
 if(m==='3+ HT')return f.ht?f.ht.home+f.ht.away>=3:null;
 if(m==='7+ FT')return f.ft?f.ft.home+f.ft.away>=7:null;
 if(m==='Other HT')return f.ht?f.ht.home>=4||f.ht.away>=4:null;
 return f.ft?f.ft.home>=5||f.ft.away>=5:null;
}
function teamRows(rows:CanonicalFixture[],team:string){const k=team.toLowerCase();return rows.filter(r=>r.homeTeam.toLowerCase()===k||r.awayTeam.toLowerCase()===k).sort((a,b)=>a.matchDate.localeCompare(b.matchDate));}
function teamGoals(rows:CanonicalFixture[],team:string,part:'ht'|'ft',forGoals=true){const k=team.toLowerCase();return teamRows(rows,team).flatMap(r=>{const p=r[part];if(!p)return[];const isHome=r.homeTeam.toLowerCase()===k;return [forGoals?(isHome?p.home:p.away):(isHome?p.away:p.home)];});}
function weightedMean(xs:number[]){if(!xs.length)return null;let s=0,w=0;xs.forEach((x,i)=>{const ww=recencyWeight(xs.length-1-i);s+=x*ww;w+=ww;});return s/w;}
function empiricalGrid(rows:CanonicalFixture[],part:'ht'|'ft',max:number):GridRow[]{
 const usable=rows.filter(r=>r[part]);const counts=new Map<string,number>();let z=0;
 usable.forEach((r,i)=>{const p=r[part]!;const h=Math.min(max,p.home),a=Math.min(max,p.away),key=`${h}-${a}`,w=recencyWeight(usable.length-1-i);counts.set(key,(counts.get(key)??0)+w);z+=w;});
 const alpha=.12,cells=(max+1)*(max+1),den=z+alpha*cells,grid:GridRow[]=[];
 for(let h=0;h<=max;h++)for(let a=0;a<=max;a++){const score=`${h}-${a}`;grid.push({score,total:h+a,probability:((counts.get(score)??0)+alpha)/den});}
 return grid;
}
function normalizeGrid(rows:GridRow[]):GridRow[]{const z=rows.reduce((s,r)=>s+r.probability,0)||1;return rows.map(r=>({...r,probability:r.probability/z}));}
function blendGrid(a:GridRow[],b:GridRow[],wA:number):GridRow[]{const mb=new Map(b.map(r=>[r.score,r]));return normalizeGrid(a.map(r=>({score:r.score,total:r.total,probability:r.probability*wA+(mb.get(r.score)?.probability??0)*(1-wA)})));}
function scoreDirection(score:string){const[h,a]=score.split('-').map(Number);return h>a?1:a>h?-1:0;}
function gridFingerprint(grid:GridRow[]){let h=2166136261;for(const r of grid){const s=`${r.score}:${r.probability.toFixed(8)}`;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}}return(h>>>0).toString(16).padStart(8,'0');}
function reconcileScoreGrid(a:GridRow[],b:GridRow[],baseWeightA:number,expectedHome:number,expectedAway:number,bHome:number,bAway:number){
 const expectedDelta=expectedHome-expectedAway,challengerDelta=bHome-bAway,consensusDelta=.45*expectedDelta+.55*challengerDelta;
 const directionalStrength=clamp(Math.abs(consensusDelta)/1.5,0,1);
 const weightA=clamp(baseWeightA-.30*directionalStrength,.34,.56);
 let grid=blendGrid(a,b,weightA);
 const direction=consensusDelta>.18?1:consensusDelta<-.18?-1:0;
 if(direction!==0&&directionalStrength>.12){
   grid=normalizeGrid(grid.map(r=>{const d=scoreDirection(r.score);let factor=1;if(d===direction)factor+=.38*directionalStrength;else if(d===-direction)factor-=.28*directionalStrength;else factor-=.04*directionalStrength;return{...r,probability:r.probability*Math.max(.55,factor)};}));
 }
 const t3=top3(grid),aligned=t3.filter(x=>scoreDirection(x.score)===direction).length;
 return{grid,audit:{version:'CFI_SCORELINE_RECONCILIATION_V1',baseWeightA,scorelineWeightA:weightA,scorelineWeightB:1-weightA,expectedDelta,challengerDelta,consensusDelta,direction:direction===1?'HOME':direction===-1?'AWAY':'BALANCED',directionalStrength,top3AlignedCount:direction===0?null:aligned,fingerprint:gridFingerprint(grid)}};
}
function marketPredicate(m:typeof MARKET_CODES[number]){return(r:GridRow)=>{const[h,a]=r.score.split('-').map(Number);return m==='3+ HT'?r.total>=3:m==='7+ FT'?r.total>=7:m==='Other HT'?h>=4||a>=4:h>=5||a>=5;};}
function structuralMass(grid:GridRow[],m:typeof MARKET_CODES[number]){return grid.filter(marketPredicate(m)).reduce((s,r)=>s+r.probability,0);}
function top3(grid:GridRow[]){return [...grid].sort((a,b)=>b.probability-a.probability).slice(0,3).map(({score,probability})=>({score,probability}));}
function top1(grid:GridRow[]){return top3(grid)[0]??null;}
function teamDna(team:string,rows:CanonicalFixture[]){const gf=teamGoals(rows,team,'ft',true),ga=teamGoals(rows,team,'ft',false),ht=teamGoals(rows,team,'ht',true),recent=gf.slice(-5),prev=gf.slice(-10,-5);return{fixtures:teamRows(rows,team).length,recencyWeightedGF:weightedMean(gf),recencyWeightedGA:weightedMean(ga),htGoalMean:mean(ht),ftGoalMean:mean(gf),homeSplit:teamRows(rows,team).filter(r=>r.homeTeam.toLowerCase()===team.toLowerCase()).length,awaySplit:teamRows(rows,team).filter(r=>r.awayTeam.toLowerCase()===team.toLowerCase()).length,scoringStreak:[...gf].reverse().findIndex(x=>x===0)===-1?gf.length:[...gf].reverse().findIndex(x=>x===0),scorelessStreak:[...gf].reverse().findIndex(x=>x>0)===-1?gf.length:[...gf].reverse().findIndex(x=>x>0),highScoreCluster:gf.filter(x=>x>=3).length,lowScoreCluster:gf.filter(x=>x<=1).length,scoringAcceleration:recent.length&&prev.length?mean(recent)!-mean(prev)!:null,extremeScoreRecurrence:gf.filter(x=>x>=5).length,goalTimingProfile:ht.length?{firstHalfShare:ht.reduce((a,b)=>a+b,0)/Math.max(1,gf.reduce((a,b)=>a+b,0))}:'unavailable',leadTrailBehavior:'unavailable',collapseRiskProxy:ga.length?ga.filter(x=>x>=3).length/ga.length:null};}

export function buildPrediction(args:{home:string;away:string;targetDate?:string;language?:string;homePayload:unknown;awayPayload:unknown;h2hPayload:unknown}){
 const language=['vi','en','zh','th','id'].includes(args.language??'')?args.language!:'vi';
 const evidence=strictPriorEvidence(args.homePayload,args.awayPayload,args.h2hPayload,args.targetDate);
 const homeRows=evidence.streams.home,awayRows=evidence.streams.away;
 const homeHtFor=weightedMean(teamGoals(homeRows,args.home,'ht',true))??.68,homeHtAgainst=weightedMean(teamGoals(homeRows,args.home,'ht',false))??.68;
 const awayHtFor=weightedMean(teamGoals(awayRows,args.away,'ht',true))??.68,awayHtAgainst=weightedMean(teamGoals(awayRows,args.away,'ht',false))??.68;
 const homeFtFor=weightedMean(teamGoals(homeRows,args.home,'ft',true))??1.35,homeFtAgainst=weightedMean(teamGoals(homeRows,args.home,'ft',false))??1.35;
 const awayFtFor=weightedMean(teamGoals(awayRows,args.away,'ft',true))??1.35,awayFtAgainst=weightedMean(teamGoals(awayRows,args.away,'ft',false))??1.35;
 const htExpectedHome=(homeHtFor+awayHtAgainst)/2,htExpectedAway=(awayHtFor+homeHtAgainst)/2,ftExpectedHome=(homeFtFor+awayFtAgainst)/2,ftExpectedAway=(awayFtFor+homeFtAgainst)/2;
 const htA=empiricalGrid(evidence.unique,'ht',8),ftA=empiricalGrid(evidence.unique,'ft',12);
 const futureSix=buildFutureSixScorelines({home:args.home,away:args.away,homeRows,awayRows});
 const htB:GridRow[]=futureSix.ht,ftB:GridRow[]=futureSix.ft;
 const completeness=Math.min(1,evidence.unique.length/40),h2hBoost=Math.min(.12,evidence.streams.h2h.length*.02),weightA=clamp(.48+.22*completeness+h2hBoost,.45,.78);
 const htRecon=reconcileScoreGrid(htA,htB,weightA,htExpectedHome,htExpectedAway,futureSix.intensity.htHome,futureSix.intensity.htAway);
 const ftRecon=reconcileScoreGrid(ftA,ftB,weightA,ftExpectedHome,ftExpectedAway,futureSix.intensity.ftHome,futureSix.intensity.ftAway);
 const marketStats=Object.fromEntries(MARKET_CODES.map(m=>{const eligible=evidence.unique.filter(r=>marketHit(r,m)!==null),hits=eligible.filter(r=>marketHit(r,m)===true).length;return[m,{eligible,hits,rawRate:eligible.length?hits/eligible.length:null}];})) as Record<typeof MARKET_CODES[number],{eligible:CanonicalFixture[];hits:number;rawRate:number|null}>;
 const calibrationTargets=Object.fromEntries(MARKET_CODES.map(m=>{const isHt=m.includes('HT'),rawGrid=isHt?htRecon.grid:ftRecon.grid,gB=isHt?htB:ftB,stats=marketStats[m];const rawFinal=structuralMass(rawGrid,m),challenger=structuralMass(gB,m);return[m,calibrateMarketProbability({rawRate:stats.rawRate,structural:rawFinal,challenger,eligible:stats.eligible.length,hits:stats.hits})];})) as Record<typeof MARKET_CODES[number],number>;
 calibrationTargets['Other HT']=Math.min(calibrationTargets['Other HT'],calibrationTargets['3+ HT']);
 const htCalibration=calibrateScoreDistribution(htRecon.grid,[{name:'3+ HT',target:calibrationTargets['3+ HT'],matches:marketPredicate('3+ HT')},{name:'Other HT',target:calibrationTargets['Other HT'],matches:marketPredicate('Other HT')}]);
 const ftCalibration=calibrateScoreDistribution(ftRecon.grid,[{name:'7+ FT',target:calibrationTargets['7+ FT'],matches:marketPredicate('7+ FT')},{name:'Other FT',target:calibrationTargets['Other FT'],matches:marketPredicate('Other FT')}]);
 if(!htCalibration.audit.converged||!ftCalibration.audit.converged)throw new Error('SCORE_DISTRIBUTION_CALIBRATION_DID_NOT_CONVERGE');
 const htFinal=htCalibration.grid as GridRow[],ftFinal=ftCalibration.grid as GridRow[];
 const markets=Object.fromEntries(MARKET_CODES.map(m=>{
   const isHt=m.includes('HT'),gA=isHt?htA:ftA,gB=isHt?htB:ftB,gFinal=isHt?htFinal:ftFinal,rawGrid=isHt?htRecon.grid:ftRecon.grid,recon=isHt?htRecon:ftRecon,distributionCalibration=isHt?htCalibration:ftCalibration;
   const structuralA=structuralMass(gA,m),structuralB=structuralMass(gB,m),rawFinalMass=structuralMass(rawGrid,m),finalMass=structuralMass(gFinal,m);
   const stats=marketStats[m],eligible=stats.eligible,hits=stats.hits,rawRate=stats.rawRate;
   const methodA=calibrateMarketProbability({rawRate,structural:structuralA,challenger:structuralA,eligible:eligible.length,hits});
   const methodB=calibrateMarketProbability({rawRate,structural:structuralB,challenger:structuralB,eligible:eligible.length,hits});
   const final=finalMass;
   const sConfidence=sampleConfidence(eligible.length),pConfidence=predictiveConfidence(final,rawRate,eligible.length);
   return[m,{methodA,methodB,final,confidence:pConfidence,sampleConfidence:sConfidence,predictiveConfidence:pConfidence,hits,eligible:eligible.length,rawRate,smoothedRate:structuralA,scorelineMass:finalMass,consistency:{status:'PASS',construction:'FINAL_MARKET_IS_INTEGRAL_OF_FINAL_SCORE_DISTRIBUTION',rawDistributionMass:rawFinalMass,calibratedFinal:final,finalDelta:0},supportingFactors:[`dual_distribution:true`,`future_six:${futureSix.version}`,`scoreline_integral:true`,`distribution_calibrated:true`,`empirical_anchor:${rawRate===null?'NA':rawRate.toFixed(4)}`],opposingFactors:eligible.length<12?['SMALL_SAMPLE']:[],calibration:{version:'final-score-distribution-calibration-v2',distributionVersion:distributionCalibration.audit.version,baseWeightA:recon.audit.baseWeightA,weightA:recon.audit.scorelineWeightA,weightB:recon.audit.scorelineWeightB,empiricalAnchor:rawRate,structuralA,structuralB,rawFinal:rawFinalMass,target:calibrationTargets[m],actualFinal:final,converged:distributionCalibration.audit.converged,maxConstraintError:distributionCalibration.audit.maxError}}];
 }));
 const multiMarket=buildMultiMarketFromScoreGrids({ht:htFinal,ft:ftFinal});
 const maxEvidenceDate=evidence.unique.reduce((m,r)=>r.matchDate>m?r.matchDate:m,'');
 let championFusion:any;
 try{
   championFusion=buildMultiMarketChampionFusion({targetDate:args.targetDate??null,maxEvidenceDate:maxEvidenceDate||null,ht:{incumbent:htFinal,futureSix:htB,historical:htA},ft:{incumbent:ftFinal,futureSix:ftB,historical:ftA},context:{evidenceCount:evidence.unique.length,h2hCount:evidence.streams.h2h.length,volatility:futureSix.factors.volatility,extremeScorePressure:futureSix.factors.extremeScorePressure,dominance:futureSix.factors.dominance,goalTempo:futureSix.factors.goalTempo}});
 }catch(error){
   championFusion={version:CHAMPION_FUSION_VERSION,lineage:CHAMPION_FUSION_LINEAGE,status:'SHADOW_UNAVAILABLE',researchOnly:true,decisionUse:false,productionEligible:false,promotionRequired:true,championMutation:false,reason:error instanceof Error?error.message:'CHAMPION_FUSION_RUNTIME_ERROR',audit:{incumbentUnmodified:true,isolatedFailure:true}};
 }
 const warnings:string[]=[];
 if(ftRecon.audit.direction!=='BALANCED'&&ftRecon.audit.directionalStrength>=.35&&ftRecon.audit.top3AlignedCount===0)warnings.push('FINAL_FT_DIRECTION_MISMATCH');
 if(htRecon.audit.direction!=='BALANCED'&&htRecon.audit.directionalStrength>=.40&&htRecon.audit.top3AlignedCount===0)warnings.push('FINAL_HT_DIRECTION_MISMATCH');
 const htTop3A=top3(htA),htTop3B=futureSix.top3HT,htTop3Final=top3(htFinal),ftTop3A=top3(ftA),ftTop3B=futureSix.top3FT,ftTop3Final=top3(ftFinal);
 const primaryTop1={ht:{methodA:htTop3A[0]??null,methodB:htTop3B[0]??null,final:top1(htFinal)},ft:{methodA:ftTop3A[0]??null,methodB:ftTop3B[0]??null,final:top1(ftFinal)}};
 const scoreline={ht:{methodA:htTop3A,methodB:htTop3B,final:htTop3Final},ft:{methodA:ftTop3A,methodB:ftTop3B,final:ftTop3Final},primaryTop1,diagnosticTop3:{ht:{methodA:htTop3A,methodB:htTop3B,final:htTop3Final},ft:{methodA:ftTop3A,methodB:ftTop3B,final:ftTop3Final},primary:false,compatibilityOnly:true},expectedGoals:{htHome:htExpectedHome,htAway:htExpectedAway,ftHome:ftExpectedHome,ftAway:ftExpectedAway},futureSix:{version:futureSix.version,factors:futureSix.factors,intensity:futureSix.intensity,audit:futureSix.audit},reconciliation:{ht:htRecon.audit,ft:ftRecon.audit},distributionCalibration:{ht:htCalibration.audit,ft:ftCalibration.audit},mostLikelyPath:`${primaryTop1.ht.final?.score??'—'} HT → ${primaryTop1.ft.final?.score??'—'} FT`,uncertainty:evidence.unique.length>=30?'MEDIUM':'HIGH',consistencyWarnings:warnings};
 const ranking=Object.entries(markets).map(([market,v]:any)=>({target:market,probability:v.final,confidence:v.predictiveConfidence,sampleConfidence:v.sampleConfidence})).sort((a,b)=>b.probability-a.probability);
 const scorelineTargets={'Top-1 HT':{methodA:primaryTop1.ht.methodA,methodB:primaryTop1.ht.methodB,final:primaryTop1.ht.final,probability:primaryTop1.ht.final?.probability??null,rankingClass:'EXACT_SCORE_TOP1'},'Top-1 FT':{methodA:primaryTop1.ft.methodA,methodB:primaryTop1.ft.methodB,final:primaryTop1.ft.final,probability:primaryTop1.ft.final?.probability??null,rankingClass:'EXACT_SCORE_TOP1'}};
 const max=ranking[0]?.probability??0,verdict=max>=.6?'STRONG_SIGNAL':'NO_STRONG_SIGNAL';
 return{status:evidence.unique.length?'DATA_READY':'INSUFFICIENT_DATA',engine:FINAL_VERSION,contract:PRIMARY_CONTRACT,language,target:{home:args.home,away:args.away,date:args.targetDate??null},evidence:{...evidence.counts,strictPrior:Boolean(args.targetDate)},teamTrendingDNA:{home:teamDna(args.home,evidence.unique),away:teamDna(args.away,evidence.unique)},context:{standings:'unavailable',opponentStrength:'unavailable',restFatigue:'unavailable',lineupInjuries:'unavailable',tacticalTempo:'unavailable',liveMomentum:'unavailable',randomnessAllowance:.025},markets,multiMarket,championFusion,scoreline,primaryTargets:{contract:PRIMARY_CONTRACT,count:6,codes:[...PRIMARY_TARGETS],scorelineTargets},ranking,rankingPolicy:{thresholdMarkets:'RANK_BY_CALIBRATED_FINAL_SCORE_DISTRIBUTION_EVENT_MASS',scorelineTargets:'REPORT_TOP1_EXACT_SCORE_PROBABILITY',crossTypeRanking:false},verdict,localized:{verdict,probabilityUnit:'0..1',unavailable:language==='vi'?'không có dữ liệu':'unavailable'}};
}

export function walkForwardBacktest(fixtures:CanonicalFixture[]){
 const sorted=[...new Map(fixtures.map(r=>[`${r.matchDate}|${r.homeTeam}|${r.awayTeam}`,r])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate));
 const marketMetrics:any=Object.fromEntries(MARKET_CODES.map(m=>[m,{n:0,brierMethodA:0,brierMethodB:0,brierFinal:0,positive:0}]));let htN=0,htHit=0,ftN=0,ftHit=0;
 for(let i=8;i<sorted.length;i++){const t=sorted[i],prior=sorted.slice(0,i).filter(r=>r.matchDate<t.matchDate);const p=buildPrediction({home:t.homeTeam,away:t.awayTeam,targetDate:t.matchDate,language:'en',homePayload:prior,awayPayload:prior,h2hPayload:prior});for(const m of MARKET_CODES){const y=marketHit(t,m);if(y===null)continue;const outcome=y?1:0;const row=(p.markets as any)[m];marketMetrics[m].n++;marketMetrics[m].positive+=outcome;marketMetrics[m].brierMethodA+=(row.methodA-outcome)**2;marketMetrics[m].brierMethodB+=(row.methodB-outcome)**2;marketMetrics[m].brierFinal+=(row.final-outcome)**2;}if(t.ht){htN++;const a=`${t.ht.home}-${t.ht.away}`;if((p.scoreline as any).primaryTop1?.ht?.final?.score===a)htHit++;}if(t.ft){ftN++;const a=`${t.ft.home}-${t.ft.away}`;if((p.scoreline as any).primaryTop1?.ft?.final?.score===a)ftHit++;}}
 for(const m of MARKET_CODES){const r=marketMetrics[m];r.prevalence=r.n?r.positive/r.n:null;r.brierMethodA=r.n?r.brierMethodA/r.n:null;r.brierMethodB=r.n?r.brierMethodB/r.n:null;r.brierFinal=r.n?r.brierFinal/r.n:null;delete r.positive;}
 return{evaluatedMatches:Math.max(0,sorted.length-8),markets:marketMetrics,scorelineTargets:{'Top-1 HT':{eligible:htN,hitAt1:htHit,accuracy:htN?htHit/htN:null},'Top-1 FT':{eligible:ftN,hitAt1:ftHit,accuracy:ftN?ftHit/ftN:null}},primaryTargets:6,contract:PRIMARY_CONTRACT,calibration:{method:'strict-prior-walk-forward+final-score-distribution-calibration-v2+scoreline-reconciliation-v1',leakage:false}};
}
