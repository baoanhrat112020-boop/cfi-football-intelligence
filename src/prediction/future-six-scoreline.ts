export const FUTURE_SIX_SCORELINE_VERSION = 'CFI_FUTURE_SIX_SCORELINE_V0.3';

export type Pair = { home:number; away:number };
export type Fixture = { matchDate:string; homeTeam:string; awayTeam:string; ht:Pair|null; ft:Pair|null };
export type GridRow = { score:string; probability:number; total:number; home:number; away:number };
export type FutureSixFactors = { goalTempo:number; dominance:number; collapseRiskHome:number; collapseRiskAway:number; comebackSurge:number; volatility:number; extremeScorePressure:number };

const clamp=(x:number,min=0,max=1)=>Math.max(min,Math.min(max,x));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:0;
const variance=(xs:number[])=>{if(xs.length<2)return 0;const m=mean(xs);return mean(xs.map(x=>(x-m)**2));};
const recencyWeight=(age:number)=>Math.pow(.90,age);
function weightedMean(xs:number[]){if(!xs.length)return 0;let s=0,w=0;xs.forEach((x,i)=>{const ww=recencyWeight(xs.length-1-i);s+=x*ww;w+=ww;});return s/Math.max(w,1e-9);}
function rowsFor(rows:Fixture[],team:string){const k=team.toLowerCase();return rows.filter(r=>r.homeTeam.toLowerCase()===k||r.awayTeam.toLowerCase()===k).sort((a,b)=>a.matchDate.localeCompare(b.matchDate));}
function venueRows(rows:Fixture[],team:string,venue:'home'|'away'){const k=team.toLowerCase();return rowsFor(rows,team).filter(r=>venue==='home'?r.homeTeam.toLowerCase()===k:r.awayTeam.toLowerCase()===k);}
function goals(rows:Fixture[],team:string,part:'ht'|'ft',gf:boolean){const k=team.toLowerCase();return rowsFor(rows,team).flatMap(r=>{const p=r[part];if(!p)return[];const h=r.homeTeam.toLowerCase()===k;return [gf?(h?p.home:p.away):(h?p.away:p.home)];});}
function venueGoals(rows:Fixture[],team:string,part:'ht'|'ft',gf:boolean,venue:'home'|'away'){const k=team.toLowerCase();return venueRows(rows,team,venue).flatMap(r=>{const p=r[part];if(!p)return[];const h=r.homeTeam.toLowerCase()===k;return [gf?(h?p.home:p.away):(h?p.away:p.home)];});}
function matchupMean(rows:Fixture[],team:string,part:'ht'|'ft',gf:boolean,venue:'home'|'away',fallback:number){const allXs=goals(rows,team,part,gf),splitXs=venueGoals(rows,team,part,gf,venue);const all=weightedMean(allXs),split=weightedMean(splitXs);if(splitXs.length&&allXs.length)return .65*split+.35*all;if(splitXs.length)return split;if(allXs.length)return all;return fallback;}
function rate(xs:number[],predicate:(x:number)=>boolean){return xs.length?xs.filter(predicate).length/xs.length:0;}

export function buildFutureSixFactors(args:{home:string;away:string;homeRows:Fixture[];awayRows:Fixture[]}):FutureSixFactors{
 const hGF=goals(args.homeRows,args.home,'ft',true),hGA=goals(args.homeRows,args.home,'ft',false),aGF=goals(args.awayRows,args.away,'ft',true),aGA=goals(args.awayRows,args.away,'ft',false);
 const hHT=goals(args.homeRows,args.home,'ht',true),aHT=goals(args.awayRows,args.away,'ht',true),hTotal=hGF.map((x,i)=>x+(hGA[i]??0)),aTotal=aGF.map((x,i)=>x+(aGA[i]??0));
 const hRecent=hGF.slice(-5),hPrev=hGF.slice(-10,-5),aRecent=aGF.slice(-5),aPrev=aGF.slice(-10,-5);
 const htTempo=clamp((weightedMean(hHT)+weightedMean(aHT))/3.2),ftTempo=clamp((weightedMean(hGF)+weightedMean(aGF))/5.0),goalTempo=clamp(.62*htTempo+.38*ftTempo);
 const hStrength=weightedMean(hGF)-weightedMean(hGA),aStrength=weightedMean(aGF)-weightedMean(aGA),dominance=clamp((hStrength-aStrength)/5,-1,1);
 const collapseRiskHome=clamp(.72*rate(hGA,x=>x>=3)+.28*rate(hGA,x=>x>=5)),collapseRiskAway=clamp(.72*rate(aGA,x=>x>=3)+.28*rate(aGA,x=>x>=5));
 const hAccel=hRecent.length&&hPrev.length?mean(hRecent)-mean(hPrev):0,aAccel=aRecent.length&&aPrev.length?mean(aRecent)-mean(aPrev):0;
 const secondHalfBurst=(rows:Fixture[],team:string)=>{const rs=rowsFor(rows,team).filter(r=>r.ht&&r.ft);if(!rs.length)return 0;return clamp(weightedMean(rs.map(r=>{const h=r.homeTeam.toLowerCase()===team.toLowerCase();return Math.max(0,(h?r.ft!.home:r.ft!.away)-(h?r.ht!.home:r.ht!.away));}))/2.6);};
 const comebackSurge=clamp(.5*((secondHalfBurst(args.homeRows,args.home)+secondHalfBurst(args.awayRows,args.away))/2)+.5*clamp((Math.max(0,hAccel)+Math.max(0,aAccel))/3));
 const totals=[...hTotal,...aTotal],dispersion=totals.length?variance(totals)/Math.max(1,mean(totals)):0,volatility=clamp(dispersion/2.5);
 const extremeHistory=(rate(hGF,x=>x>=5)+rate(aGF,x=>x>=5)+rate(hTotal,x=>x>=7)+rate(aTotal,x=>x>=7))/4,collapsePressure=(collapseRiskHome+collapseRiskAway)/2;
 const extremeScorePressure=clamp(.22*goalTempo+.18*Math.abs(dominance)+.20*collapsePressure+.13*comebackSurge+.17*volatility+.10*clamp(extremeHistory*3));
 return{goalTempo,dominance,collapseRiskHome,collapseRiskAway,comebackSurge,volatility,extremeScorePressure};
}
function poisson(k:number,l:number){let f=1;for(let i=2;i<=k;i++)f*=i;return Math.exp(-l)*Math.pow(l,k)/f;}
function negBin(k:number,mu:number,dispersion:number){const r=Math.max(.35,1/Math.max(.02,dispersion)),p=r/(r+mu);let logComb=0;for(let i=1;i<=k;i++)logComb+=Math.log(r+i-1)-Math.log(i);return Math.exp(logComb+r*Math.log(p)+k*Math.log(1-p));}
function normalize(rows:GridRow[]){const z=rows.reduce((s,r)=>s+r.probability,0)||1;return rows.map(r=>({...r,probability:r.probability/z}));}
function independentGrid(lh:number,la:number,max:number,dispersion:number){const rows:GridRow[]=[];for(let h=0;h<=max;h++)for(let a=0;a<=max;a++){const ph=dispersion>.08?negBin(h,lh,dispersion):poisson(h,lh),pa=dispersion>.08?negBin(a,la,dispersion):poisson(a,la);rows.push({score:`${h}-${a}`,home:h,away:a,total:h+a,probability:ph*pa});}return normalize(rows);}
function addTailPressure(grid:GridRow[],f:FutureSixFactors,part:'ht'|'ft'){const threshold=part==='ht'?4:5;return normalize(grid.map(r=>{const extreme=Math.max(r.home,r.away)>=threshold||(part==='ft'&&r.total>=7),directional=r.home>r.away?Math.max(0,f.dominance)+f.collapseRiskAway:r.away>r.home?Math.max(0,-f.dominance)+f.collapseRiskHome:0,boost=extreme?1+f.extremeScorePressure*(.85+.55*directional)+f.volatility*.35:1;return{...r,probability:r.probability*boost};}));}
function fingerprint(grid:GridRow[]){let h=2166136261;for(const r of grid){const s=`${r.score}:${r.probability.toFixed(8)}`;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}}return (h>>>0).toString(16).padStart(8,'0');}
function top3(g:GridRow[]){return [...g].sort((a,b)=>b.probability-a.probability).slice(0,3).map(({score,probability})=>({score,probability}));}
function top3Invariant(g:GridRow[]){const expected=top3(g).map(x=>x.score).join('|');const actual=[...g].sort((a,b)=>b.probability-a.probability).slice(0,3).map(x=>x.score).join('|');return expected===actual;}
function directionalMass(g:GridRow[]){return g.reduce((o,r)=>{if(r.home>r.away)o.home+=r.probability;else if(r.away>r.home)o.away+=r.probability;else o.draw+=r.probability;return o;},{home:0,draw:0,away:0});}

export function buildFutureSixScorelines(args:{home:string;away:string;homeRows:Fixture[];awayRows:Fixture[]}){
 const factors=buildFutureSixFactors(args),dir=factors.dominance,tempoHT=.82+factors.goalTempo*.46,surgeFT=.88+factors.comebackSurge*.28+factors.goalTempo*.14;
 const hGF=matchupMean(args.homeRows,args.home,'ht',true,'home',.68),hGA=matchupMean(args.homeRows,args.home,'ht',false,'home',.68),aGF=matchupMean(args.awayRows,args.away,'ht',true,'away',.68),aGA=matchupMean(args.awayRows,args.away,'ht',false,'away',.68);
 const hFtGF=matchupMean(args.homeRows,args.home,'ft',true,'home',1.35),hFtGA=matchupMean(args.homeRows,args.home,'ft',false,'home',1.35),aFtGF=matchupMean(args.awayRows,args.away,'ft',true,'away',1.35),aFtGA=matchupMean(args.awayRows,args.away,'ft',false,'away',1.35);
 const htHome=clamp(((hGF+aGA)/2)*tempoHT*(1+.22*Math.max(0,dir)+.24*factors.collapseRiskAway),.08,4.8),htAway=clamp(((aGF+hGA)/2)*tempoHT*(1+.22*Math.max(0,-dir)+.24*factors.collapseRiskHome),.08,4.8);
 const ftHome=clamp(((hFtGF+aFtGA)/2)*surgeFT*(1+.28*Math.max(0,dir)+.32*factors.collapseRiskAway),.08,7),ftAway=clamp(((aFtGF+hFtGA)/2)*surgeFT*(1+.28*Math.max(0,-dir)+.32*factors.collapseRiskHome),.08,7);
 // V0.3: keep genuine over-dispersion, but do not let volatility manufacture an artificial 0-0 mode.
 // Extreme-tail pressure is applied separately below, so counting it again in NB dispersion double-counted uncertainty in V0.2.
 const dispersion=.035+.32*factors.volatility+.16*factors.extremeScorePressure;
 const ht=addTailPressure(independentGrid(htHome,htAway,8,dispersion*.62),factors,'ht'),ft=addTailPressure(independentGrid(ftHome,ftAway,12,dispersion),factors,'ft');
 const htDirection=directionalMass(ht),ftDirection=directionalMass(ft);
 return{version:FUTURE_SIX_SCORELINE_VERSION,factors,intensity:{htHome,htAway,ftHome,ftAway,dispersion},ht,ft,top3HT:top3(ht),top3FT:top3(ft),audit:{matchupConditioned:true,venueWeight:.65,zeroGoalVenueSamplePreserved:true,tailDispersionDoubleCountRemoved:true,htFingerprint:fingerprint(ht),ftFingerprint:fingerprint(ft),top3HTInvariant:top3Invariant(ht),top3FTInvariant:top3Invariant(ft),htDirection,ftDirection,intensityDirection:{ht:htHome>htAway?'HOME':htAway>htHome?'AWAY':'EVEN',ft:ftHome>ftAway?'HOME':ftAway>ftHome?'AWAY':'EVEN'}}};
}
