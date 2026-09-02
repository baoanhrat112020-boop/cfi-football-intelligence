import { createClient } from "npm:@supabase/supabase-js@2";

const VERSION='CFI_MULTI_MARKET_SETTLEMENT_V2';
const FUSION_EVAL_VERSION='CFI_CHAMPION_FUSION_SETTLEMENT_V2_TOP1';
const CHALLENGER_EVAL_VERSION='CFI_CHAMPION_FUSION_V2_CHALLENGER_SETTLEMENT_V1_TOP1';
const CHALLENGER_VERSION='CFI_MULTI_MARKET_CHAMPION_FUSION_V2_CHALLENGER';
const j=(b:unknown,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{'content-type':'application/json'}});
const finite=(x:any)=>x!==null&&x!==undefined&&Number.isFinite(Number(x));
const mean=(xs:number[])=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
const brier=(p:number[],a:number)=>p.reduce((s,x,i)=>s+(x-(i===a?1:0))**2,0)/2;
const binaryBrier=(p:number,y:boolean)=>(p-(y?1:0))**2;
const logloss=(p:number[],a:number)=>-Math.log(Math.max(1e-15,Math.min(1,p[a]??0)));
function ouState(total:number,line:number){if(total>line+1e-9)return 0;if(Math.abs(total-line)<1e-9)return 2;return 4;}
function ahSingle(margin:number,line:number){const x=margin+line;return x>1e-9?'W':x<-1e-9?'L':'P';}
function ahState(margin:number,line:number){const q=Math.round(line*4);if(Math.abs(line*4-q)>1e-8)return null;if(Math.abs(q)%2===1){const a=ahSingle(margin,line-.25),b=ahSingle(margin,line+.25);if(a==='W'&&b==='W')return 0;if((a==='W'&&b==='P')||(a==='P'&&b==='W'))return 1;if(a==='P'&&b==='P')return 2;if((a==='L'&&b==='P')||(a==='P'&&b==='L'))return 3;if(a==='L'&&b==='L')return 4;return a==='W'||b==='W'?1:3;}const a=ahSingle(margin,line);return a==='W'?0:a==='P'?2:4;}
function probs(s:any){const p=[s?.fullWin,s?.halfWin,s?.push,s?.halfLoss,s?.fullLoss].map(Number);return p.every(Number.isFinite)?p:null;}
function evalSettlement(s:any,state:number){const p=probs(s);return p?{brier:brier(p,state),logLoss:logloss(p,state),state:['FULL_WIN','HALF_WIN','PUSH','HALF_LOSS','FULL_LOSS'][state]}:null;}
function oneXTwo(row:any,h:number,a:number){const p=[Number(row?.home),Number(row?.draw),Number(row?.away)];if(!p.every(Number.isFinite))return null;const y=h>a?0:h===a?1:2;return{brier:brier(p,y),logLoss:logloss(p,y),actual:['HOME','DRAW','AWAY'][y]};}
function ladderOu(mm:any,period:'ht'|'ft',h:number,a:number){const ladder=mm?.overUnder?.[period]??{},lines:any={};for(const [k,v] of Object.entries(ladder) as any){const line=Number(k);if(!Number.isFinite(line))continue;const e=evalSettlement(v?.over,ouState(h+a,line));if(e)lines[k]=e;}const vals=Object.values(lines) as any[];return{lines,meanBrier:mean(vals.map(x=>x.brier)),meanLogLoss:mean(vals.map(x=>x.logLoss)),evaluated:vals.length};}
function ladderAh(mm:any,period:'ht'|'ft',h:number,a:number){const ladder=mm?.asianHandicap?.[period]??{},lines:any={};for(const [k,v] of Object.entries(ladder) as any){const line=Number(k),state=ahState(h-a,line);if(!Number.isFinite(line)||state===null)continue;const e=evalSettlement(v?.home,state);if(e)lines[k]=e;}const vals=Object.values(lines) as any[];return{lines,meanBrier:mean(vals.map(x=>x.brier)),meanLogLoss:mean(vals.map(x=>x.logLoss)),evaluated:vals.length};}
function actuals(s:any){const hh=Number(s.actual_ht_home),ha=Number(s.actual_ht_away),fh=Number(s.actual_ft_home),fa=Number(s.actual_ft_away);return[hh,ha,fh,fa].every(Number.isInteger)?{hh,ha,fh,fa}:null;}
function exactTop1(row:any,home:number,away:number,source:string){const x=Array.isArray(row)?row[0]:row,actual=`${home}-${away}`,predicted=x&&typeof x==='object'?String(x.score??''):String(x??''),p=x&&typeof x==='object'?Number(x.probability):null;return{actual,predicted:predicted||null,hit:Boolean(predicted)&&predicted===actual,probability:Number.isFinite(p)?p:null,source};}
function fusionTop1(f:any,period:'ht'|'ft'){
  const c=f?.champion??{},suffix=period==='ht'?'HT':'FT',native=c?.[period==='ht'?'top1HT':'top1FT']??c?.[`Top-1 ${suffix}`];
  if(native)return{row:native,source:'NATIVE_TOP1',legacy:false};
  const legacy=c?.[period==='ht'?'top3HT':'top3FT']??c?.[`Top-3 ${suffix}`];
  if(Array.isArray(legacy)&&legacy.length)return{row:legacy[0],source:'LEGACY_SNAPSHOT_FIRST_RANK_AS_TOP1',legacy:true};
  return null;
}
function incumbentTop1(pred:any,period:'ht'|'ft'){
  const suffix=period==='ht'?'HT':'FT',matrix=pred?.primaryTargetMatrix?.exactScore??pred?.sixTargetMatrix?.exactScore??pred?.sixTargetMatrix?.scoreline??{},native=matrix?.[`Top-1 ${suffix}`]?.final??pred?.primaryTargets?.scorelineTargets?.[`Top-1 ${suffix}`]?.final??pred?.scoreline?.primaryTop1?.[period]?.final;
  if(native)return{row:native,source:'INCUMBENT_NATIVE_TOP1'};
  const ranked=pred?.scoreline?.[period]?.final;
  if(Array.isArray(ranked)&&ranked.length)return{row:ranked[0],source:'INCUMBENT_LEGACY_FIRST_RANK_AS_TOP1'};
  return null;
}
function championFromFusion(f:any,s:any){const a=actuals(s);if(!a)return null;const c=f?.champion?.thresholds??f?.champion??{},rows=[['3+ HT',a.hh+a.ha>=3],['7+ FT',a.fh+a.fa>=7],['Other HT',a.hh>=4||a.ha>=4],['Other FT',a.fh>=5||a.fa>=5]] as const;const markets:any={};for(const [k,y] of rows){const p=Number(c[k]);if(!Number.isFinite(p))return null;markets[k]={probability:p,actual:y,brier:binaryBrier(p,y)};}const hp=fusionTop1(f,'ht'),fp=fusionTop1(f,'ft');if(!hp||!fp)return null;const ht=exactTop1(hp.row,a.hh,a.ha,hp.source),ft=exactTop1(fp.row,a.fh,a.fa,fp.source);return{markets,meanBrier:mean(Object.values(markets).map((x:any)=>x.brier)),top1:{ht,ft},legacyCompatibilityUsed:hp.legacy||fp.legacy};}
function incumbentTop1Evaluation(pred:any,s:any){const a=actuals(s);if(!a)return null;const hp=incumbentTop1(pred,'ht'),fp=incumbentTop1(pred,'ft');if(!hp||!fp)return null;return{ht:exactTop1(hp.row,a.hh,a.ha,hp.source),ft:exactTop1(fp.row,a.fh,a.fa,fp.source)};}
function evaluateMm(mm:any,championMean:number|null,championSource:any,s:any,source:string,version:string){if(mm?.version!=='CFI_MULTI_MARKET_V1')return null;const a=actuals(s);if(!a)return null;const {hh,ha,fh,fa}=a,xht=oneXTwo(mm?.oneXTwo?.ht,hh,ha),xft=oneXTwo(mm?.oneXTwo?.ft,fh,fa),ouht=ladderOu(mm,'ht',hh,ha),ouft=ladderOu(mm,'ft',fh,fa),ahht=ladderAh(mm,'ht',hh,ha),ahft=ladderAh(mm,'ft',fh,fa);if(!xht||!xft)return null;const cross=[Math.abs(Number(championSource?.['3+ HT'])-Number(mm?.overUnder?.ht?.['2.5']?.over?.fullWin)),Math.abs(Number(championSource?.['7+ FT'])-Number(mm?.overUnder?.ft?.['6.5']?.over?.fullWin))].filter(Number.isFinite);const coherenceViolations=(mm?.consistencyGuard?.status==='PASS'?0:1)+cross.filter(x=>x>1e-8).length;const groups=[championMean,(xht.brier+xft.brier)/2,ouht.meanBrier,ouft.meanBrier,ahht.meanBrier,ahft.meanBrier].filter(finite).map(Number);return{version,researchOnly:true,decisionUse:false,source,multiMarketVersion:mm.version,model:mm.model??null,oneXTwo:{ht:xht,ft:xft},overUnder:{ht:ouht,ft:ouft},asianHandicap:{ht:ahht,ft:ahft},championBrierMean:championMean,aggregateBrier:mean(groups),coherence:{violations:coherenceViolations,internalStatus:mm?.consistencyGuard?.status??null,crossCoreDeltas:cross},actual:{ht:{home:hh,away:ha},ft:{home:fh,away:fa}}};}
function evaluate(pred:any,s:any){const legacy=Object.values(s.market_brier??{}).filter(finite).map(Number),championMean=mean(legacy),championSource={'3+ HT':pred?.markets?.['3+ HT']?.final,'7+ FT':pred?.markets?.['7+ FT']?.final};return evaluateMm(pred?.multiMarket,championMean,championSource,s,'IMMUTABLE_PREDICTION_SNAPSHOT_PLUS_SETTLED_ACTUAL',VERSION);}
function evaluateFusionNode(f:any,s:any,version:string,sourceName:string){if(!f?.multiMarket||f?.decisionUse===true)return null;const ch=championFromFusion(f,s);if(!ch)return null;const source=f?.champion?.thresholds??f?.champion??{};const ev:any=evaluateMm(f.multiMarket,ch.meanBrier,source,s,sourceName,version);if(!ev)return null;ev.fusionVersion=f.version??null;ev.lineage=f.lineage??f.architecture??null;ev.scorelineContract='TOP1_HT_PLUS_TOP1_FT';ev.gating=f.gating??null;ev.uncertainty=f.uncertainty??null;ev.champion=ch;return ev;}
function evaluateFusion(pred:any,s:any){return evaluateFusionNode(pred?.championFusion,s,FUSION_EVAL_VERSION,'IMMUTABLE_CHAMPION_FUSION_SNAPSHOT_PLUS_SETTLED_ACTUAL');}
function evaluateChallenger(pred:any,s:any){const f=pred?.championFusionChallenger;if(f?.version!==CHALLENGER_VERSION)return null;if(f?.researchProtocol?.sameCohortPromotionAllowed!==false||f?.researchProtocol?.prospectiveResetRequired!==true)return null;const ev:any=evaluateFusionNode(f,s,CHALLENGER_EVAL_VERSION,'IMMUTABLE_CHAMPION_FUSION_V2_CHALLENGER_SNAPSHOT_PLUS_SETTLED_ACTUAL');if(!ev)return null;ev.researchProtocol=f.researchProtocol??null;ev.prospectiveSnapshotVerified=true;return ev;}

Deno.serve(async(req)=>{
  if(req.method!=='POST')return j({error:'POST_REQUIRED'},405);
  const su=Deno.env.get('SUPABASE_URL'),sr=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!su||!sr)return j({error:'SERVER_SECRET_MISSING'},500);
  const db=createClient(su,sr,{auth:{persistSession:false,autoRefreshToken:false}});
  const body=await req.json().catch(()=>({})),limit=Math.max(1,Math.min(500,Number(body?.limit??200)||200)),offset=Math.max(0,Number(body?.offset??0)||0),forceRecompute=body?.forceRecompute===true;
  const {data:rows,error}=await db.from('cfi_prediction_settlements').select('snapshot_id,actual_ht_home,actual_ht_away,actual_ft_home,actual_ft_away,market_brier,audit,cfi_prediction_snapshots!inner(prediction,strict_prior,created_at)').order('settled_at',{ascending:false}).range(offset,offset+limit-1);
  if(error)return j({error:'SETTLEMENT_READ_FAILED',message:error.message},500);
  let evaluated=0,fusionEvaluated=0,challengerEvaluated=0,skippedLegacy=0,already=0,errors=0,legacyTop1CompatibilityUsed=0;
  for(const s of rows??[]){
    const snap=Array.isArray((s as any).cfi_prediction_snapshots)?(s as any).cfi_prediction_snapshots[0]:(s as any).cfi_prediction_snapshots,pred=snap?.prediction;
    const hasFusion=Boolean(pred?.championFusion?.multiMarket),hasChallenger=pred?.championFusionChallenger?.version===CHALLENGER_VERSION&&Boolean(pred?.championFusionChallenger?.multiMarket);
    const incumbentDone=!forceRecompute&&Boolean(s?.audit?.multiMarketEvaluation),fusionDone=!forceRecompute&&s?.audit?.championFusionEvaluation?.version===FUSION_EVAL_VERSION,challengerDone=!forceRecompute&&s?.audit?.championFusionChallengerEvaluation?.version===CHALLENGER_EVAL_VERSION;
    if(incumbentDone&&(!hasFusion||fusionDone)&&(!hasChallenger||challengerDone)){already++;continue;}
    if(!pred?.multiMarket){skippedLegacy++;continue;}
    let audit={...(s.audit??{})},marketBrier={...(s.market_brier??{})},changed=false,inc:any=incumbentDone?audit.multiMarketEvaluation:null;
    if(!incumbentDone){
      inc=evaluate(pred,s);if(!inc){errors++;continue;}
      audit.multiMarketEvaluation=inc;
      marketBrier['Multi-Market']={version:VERSION,aggregate:inc.aggregateBrier,oneXTwo:inc.oneXTwo,overUnder:{ht:inc.overUnder.ht.meanBrier,ft:inc.overUnder.ft.meanBrier},asianHandicap:{ht:inc.asianHandicap.ht.meanBrier,ft:inc.asianHandicap.ft.meanBrier},coherenceViolations:inc.coherence.violations};
      evaluated++;changed=true;
    }
    const incTop1=incumbentTop1Evaluation(pred,s);
    if(hasFusion&&!fusionDone){
      const fev=evaluateFusion(pred,s);
      if(fev&&incTop1){
        audit.championFusionEvaluation=fev;
        marketBrier['Champion-Fusion-Multi-Market']={version:FUSION_EVAL_VERSION,aggregate:fev.aggregateBrier,champion:fev.championBrierMean,top1:fev.champion.top1,oneXTwo:fev.oneXTwo,overUnder:{ht:fev.overUnder.ht.meanBrier,ft:fev.overUnder.ft.meanBrier},asianHandicap:{ht:fev.asianHandicap.ht.meanBrier,ft:fev.asianHandicap.ft.meanBrier},coherenceViolations:fev.coherence.violations};
        const incumbentAggregate=Number(inc?.aggregateBrier);
        audit.championFusionPair={version:FUSION_EVAL_VERSION,paired:true,scorelineContract:'TOP1_HT_PLUS_TOP1_FT',incumbentAggregateBrier:Number.isFinite(incumbentAggregate)?incumbentAggregate:null,fusionAggregateBrier:fev.aggregateBrier,delta:Number.isFinite(incumbentAggregate)&&finite(fev.aggregateBrier)?fev.aggregateBrier-incumbentAggregate:null,lowerIsBetter:true,top1:{incumbent:incTop1,fusion:fev.champion.top1}};
        if(fev.champion.legacyCompatibilityUsed)legacyTop1CompatibilityUsed++;
        fusionEvaluated++;changed=true;
      }else errors++;
    }
    if(hasChallenger&&!challengerDone){
      const cev=evaluateChallenger(pred,s);
      if(cev&&incTop1){
        audit.championFusionChallengerEvaluation=cev;
        marketBrier['Champion-Fusion-V2-Challenger-Multi-Market']={version:CHALLENGER_EVAL_VERSION,aggregate:cev.aggregateBrier,champion:cev.championBrierMean,top1:cev.champion.top1,oneXTwo:cev.oneXTwo,overUnder:{ht:cev.overUnder.ht.meanBrier,ft:cev.overUnder.ft.meanBrier},asianHandicap:{ht:cev.asianHandicap.ht.meanBrier,ft:cev.asianHandicap.ft.meanBrier},coherenceViolations:cev.coherence.violations};
        const incumbentAggregate=Number(inc?.aggregateBrier),v1Aggregate=Number(audit?.championFusionEvaluation?.aggregateBrier);
        audit.championFusionChallengerPair={version:CHALLENGER_EVAL_VERSION,paired:true,prospectiveOnly:true,reconstructed:false,scorelineContract:'TOP1_HT_PLUS_TOP1_FT',incumbentAggregateBrier:Number.isFinite(incumbentAggregate)?incumbentAggregate:null,v1AggregateBrier:Number.isFinite(v1Aggregate)?v1Aggregate:null,challengerAggregateBrier:cev.aggregateBrier,deltaVsIncumbent:Number.isFinite(incumbentAggregate)&&finite(cev.aggregateBrier)?cev.aggregateBrier-incumbentAggregate:null,deltaVsV1:Number.isFinite(v1Aggregate)&&finite(cev.aggregateBrier)?cev.aggregateBrier-v1Aggregate:null,lowerIsBetter:true,top1:{incumbent:incTop1,challenger:cev.champion.top1},researchProtocol:pred?.championFusionChallenger?.researchProtocol??null};
        challengerEvaluated++;changed=true;
      }else errors++;
    }
    if(!changed)continue;
    const {error:ue}=await db.from('cfi_prediction_settlements').update({audit,market_brier:marketBrier}).eq('snapshot_id',s.snapshot_id);
    if(ue){errors++;continue;}
  }
  return j({status:'OK',version:VERSION,fusionVersion:FUSION_EVAL_VERSION,challengerVersion:CHALLENGER_EVAL_VERSION,scorelineContract:'TOP1_HT_PLUS_TOP1_FT',checked:(rows??[]).length,offset,evaluated,fusionEvaluated,challengerEvaluated,already,skippedLegacy,errors,legacyTop1CompatibilityUsed,policy:{noPredictionReconstruction:true,immutablePredictionSnapshot:true,legacySnapshotsReadOnlyCompatibility:true,pairedFusionEvaluation:true,pairedChallengerEvaluation:true,challengerProspectiveOnly:true,sameCohortPromotionAllowed:false,decisionUse:false,top1Only:true}});
});
