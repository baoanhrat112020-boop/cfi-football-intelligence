import { buildFutureSixScorelines } from './future-six-scoreline.ts';

export const FINAL_VERSION = "CFI_FINAL_V5.2.0";
export const MARKET_CODES = ["3+ HT", "7+ FT", "Other HT", "Other FT"] as const;
export const PRIMARY_TARGETS = [...MARKET_CODES, "Top-3 HT", "Top-3 FT"] as const;

export type Pair = { home:number; away:number };
export type CanonicalFixture = { id:string; matchDate:string; homeTeam:string; awayTeam:string; ht:Pair|null; ft:Pair|null };
type GridRow = { score:string; probability:number; total:number };

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const finite=(v:unknown)=>{ if(v===null||v===undefined||v==='') return null; const n=Number(v); return Number.isFinite(n)&&n>=0?n:null; };
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
 const alpha=.12, cells=(max+1)*(max+1),den=z+alpha*cells,grid:GridRow[]=[];
 for(let h=0;h<=max;h++)for(let a=0;a<=max;a++){const score=`${h}-${a}`;grid.push({score,total:h+a,probability:((counts.get(score)??0)+alpha)/den});}
 return grid;
}
function blendGrid(a:GridRow[],b:GridRow[],wA:number):GridRow[]{const mb=new Map(b.map(r=>[r.score,r]));return a.map(r=>({score:r.score,total:r.total,probability:r.probability*wA+(mb.get(r.score)?.probability??0)*(1-wA)}));}
function structuralMass(grid:GridRow[],m:typeof MARKET_CODES[number]){return grid.filter(r=>{const[h,a]=r.score.split('-').map(Number);return m==='3+ HT'?r.total>=3:m==='7+ FT'?r.total>=7:m==='Other HT'?h>=4||a>=4:h>=5||a>=5;}).reduce((s,r)=>s+r.probability,0);}
function top3(grid:GridRow[]){return [...grid].sort((a,b)=>b.probability-a.probability).slice(0,3).map(({score,probability})=>({score,probability}));}
function scoreRank(top:Array<{score:string}>,actual:string){const i=top.findIndex(x=>x.score===actual);return i<0?null:i+1;}
function teamDna(team:string,rows:CanonicalFixture[]){const gf=teamGoals(rows,team,'ft',true),ga=teamGoals(rows,team,'ft',false),ht=teamGoals(rows,team,'ht',true),recent=gf.slice(-5),prev=gf.slice(-10,-5);return{fixtures:teamRows(rows,team).length,recencyWeightedGF:weightedMean(gf),recencyWeightedGA:weightedMean(ga),htGoalMean:mean(ht),ftGoalMean:mean(gf),homeSplit:teamRows(rows,team).filter(r=>r.homeTeam.toLowerCase()===team.toLowerCase()).length,awaySplit:teamRows(rows,team).filter(r=>r.awayTeam.toLowerCase()===team.toLowerCase()).length,scoringStreak:[...gf].reverse().findIndex(x=>x===0)===-1?gf.length:[...gf].reverse().findIndex(x=>x===0),scorelessStreak:[...gf].reverse().findIndex(x=>x>0)===-1?gf.length:[...gf].reverse().findIndex(x=>x>0),highScoreCluster:gf.filter(x=>x>=3).length,lowScoreCluster:gf.filter(x=>x<=1).length,scoringAcceleration:recent.length&&prev.length?mean(recent)!-mean(prev)!:null,extremeScoreRecurrence:gf.filter(x=>x>=5).length,goalTimingProfile:ht.length?{firstHalfShare:ht.reduce((a,b)=>a+b,0)/Math.max(1,gf.reduce((a,b)=>a+b,0))}:'unavailable',leadTrailBehavior:'unavailable',collapseRiskProxy:ga.length?ga.filter(x=>x>=3).length/ga.length:null};}

export function buildPrediction(args:{home:string;away:string;targetDate?:string;language?:string;homePayload:unknown;awayPayload:unknown;h2hPayload:unknown}){
 const language=['vi','en','zh','th','id'].includes(args.language??'')?args.language!:'vi';
 const evidence=strictPriorEvidence(args.homePayload,args.awayPayload,args.h2hPayload,args.targetDate);
 const homeRows=evidence.streams.home,awayRows=evidence.streams.away;
 const homeHtFor=weightedMean(teamGoals(homeRows,args.home,'ht',true))??.68,homeHtAgainst=weightedMean(teamGoals(homeRows,args.home,'ht',false))??.68;
 const awayHtFor=weightedMean(teamGoals(awayRows,args.away,'ht',true))??.68,awayHtAgainst=weightedMean(teamGoals(awayRows,args.away,'ht',false))??.68;
 const homeFtFor=weightedMean(teamGoals(homeRows,args.home,'ft',true))??1.35,homeFtAgainst=weightedMean(teamGoals(homeRows,args.home,'ft',false))??1.35;
 const awayFtFor=weightedMean(teamGoals(awayRows,args.away,'ft',true))??1.35,awayFtAgainst=weightedMean(teamGoals(awayRows,args.away,'ft',false))??1.35;
 const htA=empiricalGrid(evidence.unique,'ht',8),ftA=empiricalGrid(evidence.unique,'ft',12);
 const futureSix=buildFutureSixScorelines({home:args.home,away:args.away,homeRows,awayRows});
 const htB:GridRow[]=futureSix.ht,ftB:GridRow[]=futureSix.ft;
 const completeness=Math.min(1,evidence.unique.length/40),h2hBoost=Math.min(.12,evidence.streams.h2h.length*.02),weightA=clamp(.48+.22*completeness+h2hBoost,.45,.78);
 const htFinal=blendGrid(htA,htB,weightA),ftFinal=blendGrid(ftA,ftB,weightA);
 const markets=Object.fromEntries(MARKET_CODES.map(m=>{const gA=m.includes('HT')?htA:ftA,gB=m.includes('HT')?htB:ftB,gF=m.includes('HT')?htFinal:ftFinal;const methodA=structuralMass(gA,m),methodB=structuralMass(gB,m),final=structuralMass(gF,m),eligible=evidence.unique.filter(r=>marketHit(r,m)!==null),hits=eligible.filter(r=>marketHit(r,m)===true).length;return[m,{methodA,methodB,final,confidence:eligible.length>=30?'HIGH':eligible.length>=12?'MEDIUM':'LOW',hits,eligible:eligible.length,rawRate:eligible.length?hits/eligible.length:null,smoothedRate:methodA,scorelineMass:final,consistency:{status:'PASS',finalDelta:0,construction:'FINAL_MARKET_IS_INTEGRAL_OF_FINAL_SCORE_DISTRIBUTION'},supportingFactors:[`dual_distribution:true`,`future_six:${futureSix.version}`,`weightA:${weightA.toFixed(3)}`],opposingFactors:eligible.length<12?['SMALL_SAMPLE']:[],calibration:{version:'future-six-dual-score-distribution-v1',weightA,weightB:1-weightA}}]}));
 const scoreline={ht:{methodA:top3(htA),methodB:futureSix.top3HT,final:top3(htFinal)},ft:{methodA:top3(ftA),methodB:futureSix.top3FT,final:top3(ftFinal)},expectedGoals:{htHome:(homeHtFor+awayHtAgainst)/2,htAway:(awayHtFor+homeHtAgainst)/2,ftHome:(homeFtFor+awayFtAgainst)/2,ftAway:(awayFtFor+homeFtAgainst)/2},futureSix:{version:futureSix.version,factors:futureSix.factors,intensity:futureSix.intensity},mostLikelyPath:`${top3(htFinal)[0]?.score??'—'} HT → ${top3(ftFinal)[0]?.score??'—'} FT`,uncertainty:evidence.unique.length>=30?'MEDIUM':'HIGH',consistencyWarnings:[] as string[]};
 const ranking=[...Object.entries(markets).map(([market,v]:any)=>({target:market,probability:v.final,confidence:v.confidence})),{target:'Top-3 HT',probability:scoreline.ht.final.reduce((s,x)=>s+x.probability,0),confidence:evidence.counts.htCoverage>=30?'HIGH':evidence.counts.htCoverage>=12?'MEDIUM':'LOW'},{target:'Top-3 FT',probability:scoreline.ft.final.reduce((s,x)=>s+x.probability,0),confidence:evidence.counts.ftCoverage>=30?'HIGH':evidence.counts.ftCoverage>=12?'MEDIUM':'LOW'}].sort((a,b)=>b.probability-a.probability);
 const max=ranking[0]?.probability??0,verdict=max>=.6?'STRONG_SIGNAL':'NO_STRONG_SIGNAL';
 return{status:evidence.unique.length?'DATA_READY':'INSUFFICIENT_DATA',engine:FINAL_VERSION,language,target:{home:args.home,away:args.away,date:args.targetDate??null},evidence:{...evidence.counts,strictPrior:Boolean(args.targetDate)},teamTrendingDNA:{home:teamDna(args.home,evidence.unique),away:teamDna(args.away,evidence.unique)},context:{standings:'unavailable',opponentStrength:'unavailable',restFatigue:'unavailable',lineupInjuries:'unavailable',tacticalTempo:'unavailable',liveMomentum:'unavailable',randomnessAllowance:.025},markets,scoreline,primaryTargets:{count:6,codes:[...PRIMARY_TARGETS],scorelineTargets:{'Top-3 HT':scoreline.ht,'Top-3 FT':scoreline.ft}},ranking,verdict,localized:{verdict,probabilityUnit:'0..1',unavailable:language==='vi'?'không có dữ liệu':'unavailable'}};
}

export function walkForwardBacktest(fixtures:CanonicalFixture[]){
 const sorted=[...new Map(fixtures.map(r=>[`${r.matchDate}|${r.homeTeam}|${r.awayTeam}`,r])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate));
 const marketMetrics:any=Object.fromEntries(MARKET_CODES.map(m=>[m,{n:0,brierMethodA:0,brierMethodB:0,brierFinal:0,positive:0}]));let htN=0,htHit=0,ftN=0,ftHit=0;
 for(let i=8;i<sorted.length;i++){const t=sorted[i],prior=sorted.slice(0,i).filter(r=>r.matchDate<t.matchDate);const p=buildPrediction({home:t.homeTeam,away:t.awayTeam,targetDate:t.matchDate,language:'en',homePayload:prior,awayPayload:prior,h2hPayload:prior});for(const m of MARKET_CODES){const y=marketHit(t,m);if(y===null)continue;const outcome=y?1:0;const row=(p.markets as any)[m];marketMetrics[m].n++;marketMetrics[m].positive+=outcome;marketMetrics[m].brierMethodA+=(row.methodA-outcome)**2;marketMetrics[m].brierMethodB+=(row.methodB-outcome)**2;marketMetrics[m].brierFinal+=(row.final-outcome)**2;}if(t.ht){htN++;if(scoreRank((p.scoreline as any).ht.final,`${t.ht.home}-${t.ht.away}`))htHit++;}if(t.ft){ftN++;if(scoreRank((p.scoreline as any).ft.final,`${t.ft.home}-${t.ft.away}`))ftHit++;}}
 for(const m of MARKET_CODES){const r=marketMetrics[m];r.prevalence=r.n?r.positive/r.n:null;r.brierMethodA=r.n?r.brierMethodA/r.n:null;r.brierMethodB=r.n?r.brierMethodB/r.n:null;r.brierFinal=r.n?r.brierFinal/r.n:null;delete r.positive;}
 return{evaluatedMatches:Math.max(0,sorted.length-8),markets:marketMetrics,scorelineTargets:{'Top-3 HT':{eligible:htN,hitAt3:htHit,accuracy:htN?htHit/htN:null},'Top-3 FT':{eligible:ftN,hitAt3:ftHit,accuracy:ftN?ftHit/ftN:null}},primaryTargets:6,calibration:{method:'strict-prior-walk-forward',leakage:false}};
}
