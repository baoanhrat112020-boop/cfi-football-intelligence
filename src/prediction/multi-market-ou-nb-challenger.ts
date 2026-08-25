import { buildPrediction, type CanonicalFixture } from './final-engine.ts';

export const OU_NB_CHALLENGER_VERSION='CFI_OU_NB_CHALLENGER_V1';
const FT_LINES=[1.5,2.5,3.5,4.5,5.5,6.5,7.5] as const;
const key=(s:string)=>s.trim().toLowerCase();
const involves=(f:CanonicalFixture,t:string)=>key(f.homeTeam)===key(t)||key(f.awayTeam)===key(t);
const pair=(f:CanonicalFixture,h:string,a:string)=>{const x=key(f.homeTeam),y=key(f.awayTeam),hh=key(h),aa=key(a);return (x===hh&&y===aa)||(x===aa&&y===hh);};
const dedupe=(xs:CanonicalFixture[])=>[...new Map(xs.map(r=>[`${r.matchDate}|${key(r.homeTeam)}|${key(r.awayTeam)}`,r])).values()].sort((a,b)=>a.matchDate.localeCompare(b.matchDate)||a.id.localeCompare(b.id));
const tail=<T>(xs:T[],n:number)=>xs.length<=n?xs:xs.slice(xs.length-n);
function poissonOver(mean:number,line:number){let p=Math.exp(-mean),cdf=p;const k=Math.floor(line);for(let i=1;i<=k;i++){p=p*mean/i;cdf+=p;}return Math.max(0,Math.min(1,1-cdf));}
function nbOver(mean:number,dispersion:number,line:number){
  if(!(mean>0)||!(dispersion>1+1e-9))return poissonOver(mean,line);
  const variance=mean*dispersion;
  const r=mean*mean/(variance-mean),q=mean/(mean+r),p0=Math.pow(r/(r+mean),r);
  let pmf=p0,cdf=pmf;const k=Math.floor(line);
  for(let x=1;x<=k;x++){pmf*=((x-1+r)/x)*q;cdf+=pmf;}
  return Math.max(0,Math.min(1,1-cdf));
}
function dispersionFromTotals(totals:number[]){
  if(totals.length<6)return null;
  const mean=totals.reduce((a,b)=>a+b,0)/totals.length;if(mean<=0)return null;
  const variance=totals.reduce((s,x)=>s+(x-mean)**2,0)/(totals.length-1);
  return variance/mean;
}
export function walkForwardOuNbChallenger(fixtures:CanonicalFixture[],options:{historyCap?:number;minTeamPrior?:number;minDispersionN?:number}={}){
  const cap=Math.max(6,Math.floor(options.historyCap??20)),minPrior=Math.max(1,Math.floor(options.minTeamPrior??6)),minDispersionN=Math.max(6,Math.floor(options.minDispersionN??12));
  const rows=dedupe(fixtures);const metrics=Object.fromEntries(FT_LINES.map(l=>[String(l),{n:0,poissonBrier:0,challengerBrier:0,overdispersed:0}]));
  let leakage=false,evaluated=0;
  for(let i=0;i<rows.length;i++){
    const target=rows[i];if(!target.ft)continue;
    const prior=rows.slice(0,i).filter(r=>r.matchDate<target.matchDate);
    const hp=tail(prior.filter(r=>involves(r,target.homeTeam)&&r.ft),cap),ap=tail(prior.filter(r=>involves(r,target.awayTeam)&&r.ft),cap);
    if(hp.length<minPrior||ap.length<minPrior)continue;
    const h2h=tail(prior.filter(r=>pair(r,target.homeTeam,target.awayTeam)),cap);
    const maxEvidence=[...hp,...ap,...h2h].reduce((m,r)=>r.matchDate>m?r.matchDate:m,'');if(!maxEvidence||maxEvidence>=target.matchDate){leakage=true;continue;}
    const pred:any=buildPrediction({home:target.homeTeam,away:target.awayTeam,targetDate:target.matchDate,language:'en',homePayload:hp,awayPayload:ap,h2hPayload:h2h});
    const mean=Number(pred?.scoreline?.expectedGoals?.ftHome)+Number(pred?.scoreline?.expectedGoals?.ftAway);if(!Number.isFinite(mean)||mean<0)continue;
    const totals=[...hp,...ap].map(r=>r.ft!.home+r.ft!.away);
    const d=totals.length>=minDispersionN?dispersionFromTotals(totals):null;
    const useNb=d!==null&&d>1.2;
    const actual=target.ft.home+target.ft.away;evaluated++;
    for(const line of FT_LINES){const y=actual>line?1:0,pp=poissonOver(mean,line),pc=useNb?nbOver(mean,d!,line):pp,m=metrics[String(line)];m.n++;m.poissonBrier+=(pp-y)**2;m.challengerBrier+=(pc-y)**2;if(useNb)m.overdispersed++;}
  }
  const out=Object.fromEntries(Object.entries(metrics).map(([line,m])=>[line,{n:m.n,poissonBrier:m.n?m.poissonBrier/m.n:null,challengerBrier:m.n?m.challengerBrier/m.n:null,delta:m.n?(m.challengerBrier-m.poissonBrier)/m.n:null,overdispersedRate:m.n?m.overdispersed/m.n:null}]));
  return {version:OU_NB_CHALLENGER_VERSION,status:'RESEARCH_ONLY',strictPrior:true,sameDateExcluded:true,leakage,decisionUse:false,productionEligible:false,historyCap:cap,minTeamPrior:minPrior,minDispersionN,evaluatedMatches:evaluated,ft:out};
}
