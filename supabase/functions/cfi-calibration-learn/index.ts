import { createClient } from "npm:@supabase/supabase-js@2";

const VERSION = "CFI_CAL_LEARNER_V3_1_LIVE_FEEDBACK";
const SOURCE = "SETTLED_PRODUCTION";
const MARKETS = ["3+ HT","7+ FT","Other HT","Other FT"] as const;
const WEIGHTS = [0,.1,.2,.3,.4,.5,.6,.7,.8,.9,1] as const;
const COLS:any = {
  "3+ HT":["method_a_3plus_ht","method_b_3plus_ht","final_3plus_ht"],
  "7+ FT":["method_a_7plus_ft","method_b_7plus_ft","final_7plus_ft"],
  "Other HT":["method_a_other_ht","method_b_other_ht","final_other_ht"],
  "Other FT":["method_a_other_ft","method_b_other_ft","final_other_ft"]
};
const json=(x:unknown,s=200)=>new Response(JSON.stringify(x),{status:s,headers:{"content-type":"application/json"}});
const clamp=(x:number)=>Math.max(0,Math.min(1,x));
const localYmd=()=>{const p=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Ho_Chi_Minh",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());const g=(t:string)=>p.find(x=>x.type===t)?.value;return `${g("year")}-${g("month")}-${g("day")}`;};
const addDays=(ymd:string,n:number)=>{const d=new Date(`${ymd}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
const rankOf=(top:any[],score:string)=>{const i=(Array.isArray(top)?top:[]).findIndex((x:any)=>String(x?.score??"")===score);return i<0?null:i+1;};
type Acc={sum:number;n:number};
const acc=():Acc=>({sum:0,n:0});
const add=(a:Acc,x:number)=>{a.sum+=x;a.n++;};
const avg=(a:Acc)=>a.n?a.sum/a.n:null;
const errText=(e:any)=>{try{return JSON.stringify({message:e?.message??null,code:e?.code??null,details:e?.details??null,hint:e?.hint??null,name:e?.name??null});}catch{return String(e);}};
async function allRows(db:any,select:string){const out:any[]=[];for(let from=0;;from+=1000){const {data,error}=await db.from("cfi_prediction_history").select(select).eq("selected_for_match_audit",true).eq("settlement_status","SETTLED").order("created_at").range(from,from+999);if(error)throw error;out.push(...(data??[]));if((data??[]).length<1000)break;}return out;}

Deno.serve(async(req)=>{
  if(req.method!=="POST")return json({status:"ERROR",error:"POST_REQUIRED"},405);
  const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!url||!key)return json({status:"ERROR",error:"SERVER_SECRET_MISSING"},500);
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:tokenRow,error:tokenError}=await db.from("cfi_scheduler_tokens").select("token").eq("token_name","calibration_learning").maybeSingle();
  if(tokenError||!tokenRow?.token)return json({status:"ERROR",error:"LEARNING_SCHEDULER_AUTH_NOT_CONFIGURED",message:errText(tokenError)},500);
  if(req.headers.get("x-cfi-scheduler-token")!==String(tokenRow.token))return json({status:"UNAUTHORIZED"},401);
  const body=await req.json().catch(()=>({}));
  const force=body?.force===true;
  let stage="PREFLIGHT";

  try{
    const [{count:settledCount,error:countError},{data:last,error:lastError}]=await Promise.all([
      db.from("cfi_prediction_history").select("snapshot_id",{count:"exact",head:true}).eq("selected_for_match_audit",true).eq("settlement_status","SETTLED"),
      db.from("cfi_calibration_runs").select("run_id,metrics,created_at").eq("source",SOURCE).order("created_at",{ascending:false}).limit(1).maybeSingle()
    ]);
    if(countError)throw countError;if(lastError)throw lastError;
    const settled=settledCount??0,lastSettled=Number(last?.metrics?.settledProduction??-1);
    if(!force&&last&&lastSettled===settled)return json({status:"SKIPPED",version:VERSION,reason:"NO_NEW_SELECTED_SETTLEMENTS",settledProduction:settled,lastRunAt:last.created_at});

    stage="READ_SETTLED_HISTORY";
    const selectCols=["snapshot_id","target_date","engine_version","created_at","actual_markets","actual_ht_home","actual_ht_away","actual_ft_home","actual_ft_away","top3_ht","top3_ft",
      "method_a_3plus_ht","method_b_3plus_ht","final_3plus_ht","method_a_7plus_ft","method_b_7plus_ft","final_7plus_ft","method_a_other_ht","method_b_other_ht","final_other_ht","method_a_other_ft","method_b_other_ft","final_other_ft"].join(",");
    const rows=await allRows(db,selectCols);

    stage="COMPUTE_METRICS";
    const market:any={};
    for(const m of MARKETS){market[m]={baseline:acc(),methodA:acc(),methodB:acc(),weights:Object.fromEntries(WEIGHTS.map(w=>[String(w),acc()]))};}
    const score:any={HT:{n:0,hit1:0,hit3:0,rr:0},FT:{n:0,hit1:0,hit3:0,rr:0}};
    const engines=new Set<string>();
    for(const r of rows){
      if(r?.engine_version)engines.add(String(r.engine_version));
      for(const m of MARKETS){
        const [ca,cb,cf]=COLS[m];const A=Number(r?.[ca]),B=Number(r?.[cb]),F=Number(r?.[cf]),raw=r?.actual_markets?.[m];
        if(typeof raw!=="boolean"||![A,B,F].every(Number.isFinite))continue;const y=raw?1:0;
        add(market[m].baseline,(clamp(F)-y)**2);add(market[m].methodA,(clamp(A)-y)**2);add(market[m].methodB,(clamp(B)-y)**2);
        for(const w of WEIGHTS){const q=clamp(A*w+B*(1-w));add(market[m].weights[String(w)],(q-y)**2);}
      }
      if(Number.isInteger(r.actual_ht_home)&&Number.isInteger(r.actual_ht_away)){
        const rr=rankOf(r.top3_ht,`${r.actual_ht_home}-${r.actual_ht_away}`);score.HT.n++;if(rr===1)score.HT.hit1++;if(rr!==null){score.HT.hit3++;score.HT.rr+=1/rr;}
      }
      if(Number.isInteger(r.actual_ft_home)&&Number.isInteger(r.actual_ft_away)){
        const rr=rankOf(r.top3_ft,`${r.actual_ft_home}-${r.actual_ft_away}`);score.FT.n++;if(rr===1)score.FT.hit1++;if(rr!==null){score.FT.hit3++;score.FT.rr+=1/rr;}
      }
    }

    const metrics:any={};let minLive=Number.POSITIVE_INFINITY,impSum=0,maxDeg=0;
    for(const m of MARKETS){
      const s=market[m],candidates=WEIGHTS.map(w=>({weightA:w,brier:avg(s.weights[String(w)]),n:s.weights[String(w)].n})).filter(x=>x.brier!==null).sort((a:any,b:any)=>(a.brier-b.brier)||Math.abs(a.weightA-.5)-Math.abs(b.weightA-.5));
      const base=avg(s.baseline),best=candidates[0]?.brier??null,imp=base===null||best===null?null:base-best;
      metrics[m]={eligible:s.baseline.n,brierFinal:base,brierMethodA:avg(s.methodA),brierMethodB:avg(s.methodB),challengerWeightA:candidates[0]?.weightA??null,challengerWeightB:candidates[0]?1-candidates[0].weightA:null,brierChallenger:best,brierImprovement:imp};
      minLive=Math.min(minLive,s.baseline.n);if(imp!==null){impSum+=imp;maxDeg=Math.max(maxDeg,-imp);}
    }
    if(!Number.isFinite(minLive))minLive=0;
    const scorelines={
      "Top-3 HT":{eligible:score.HT.n,hitAt1:score.HT.n?score.HT.hit1/score.HT.n:null,hitAt3:score.HT.n?score.HT.hit3/score.HT.n:null,mrr:score.HT.n?score.HT.rr/score.HT.n:null},
      "Top-3 FT":{eligible:score.FT.n,hitAt1:score.FT.n?score.FT.hit1/score.FT.n:null,hitAt3:score.FT.n?score.FT.hit3/score.FT.n:null,mrr:score.FT.n?score.FT.rr/score.FT.n:null}
    };

    stage="RECENT_COVERAGE";
    const today=localYmd(),yesterday=addDays(today,-1);
    const {data:evalRows,error:evalError}=await db.from("cfi_prediction_evaluation").select("settlement_status").eq("target_date",yesterday).eq("selected_for_match_audit",true);
    if(evalError)throw evalError;
    const selectedYesterday=(evalRows??[]).length,settledYesterday=(evalRows??[]).filter((x:any)=>x.settlement_status==="SETTLED").length,pendingYesterday=selectedYesterday-settledYesterday;
    const coverage=selectedYesterday?settledYesterday/selectedYesterday:1;
    const coverageGate=selectedYesterday===0||coverage>=.90;
    const avgImp=impSum/MARKETS.length;
    const marketGate=minLive>=80&&avgImp>=0&&maxDeg<=.005;
    const scoreGate=score.HT.n>=80&&score.FT.n>=80;
    const promotion=marketGate&&scoreGate&&coverageGate;
    const reason=!coverageGate?"RECENT_SETTLEMENT_COVERAGE_INCOMPLETE":!marketGate?"LIVE_MARKET_GATE_FAILED":!scoreGate?"INSUFFICIENT_SETTLED_SCORELINE_PRODUCTION":"PROMOTION_GATE_PASSED";
    const coverageSummary={targetDate:yesterday,selected:selectedYesterday,settled:settledYesterday,pending:pendingYesterday,coverage,requiredCoverage:.90,pass:coverageGate};

    stage="WRITE_CALIBRATION_RUN";
    const engineVersion=engines.size===1?[...engines][0]:"CFI_PRODUCTION_MIXED";
    const {data:run,error:runError}=await db.from("cfi_calibration_runs").insert({learner_version:VERSION,engine_version:engineVersion,source:SOURCE,strict_prior:true,fixture_count:settled,replay_count:0,metrics:{liveMarkets:metrics,liveScorelines:scorelines,settledProduction:settled,newSettlements:lastSettled<0?settled:settled-lastSettled,recentCoverage:coverageSummary,marketGate,scorelineGate:scoreGate,coverageGate,partialLabelsBlockedFromPromotion:true},promotion_eligible:promotion,promotion_reason:reason}).select("run_id").single();
    if(runError)throw runError;
    return json({status:"COMPLETED",version:VERSION,source:SOURCE,strictPrior:true,settledProduction:settled,newSettlements:lastSettled<0?settled:settled-lastSettled,metrics:{liveMarkets:metrics,liveScorelines:scorelines},recentCoverage:coverageSummary,promotion:{eligible:promotion,reason,marketGate,scorelineGate:scoreGate,coverageGate},runId:run.run_id});
  }catch(e){return json({status:"ERROR",version:VERSION,error:"LEARNER_FAILED",stage,message:errText(e)},500);}
});
