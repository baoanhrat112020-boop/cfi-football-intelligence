import { createClient } from "npm:@supabase/supabase-js@2";
import { validateBetRecord, settleBet } from "../../../src/ledger/bet-ledger.ts";

const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json"}});

Deno.serve(async(request)=>{
  const expectedKey=Deno.env.get("CFI_ACTION_KEY");
  if(!expectedKey||request.headers.get("x-cfi-key")!==expectedKey)return json({error:"UNAUTHORIZED"},401);
  const supabaseUrl=Deno.env.get("SUPABASE_URL"),serviceRole=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if(!supabaseUrl||!serviceRole)return json({error:"SUPABASE_SERVER_SECRET_MISSING"},500);
  const db=createClient(supabaseUrl,serviceRole,{auth:{persistSession:false,autoRefreshToken:false}});
  if(request.method==='GET'){
    const url=new URL(request.url),limit=Math.max(1,Math.min(100,Number(url.searchParams.get('limit')??20)||20));
    let query=db.from('cfi_user_bet_status').select('*').order('confirmed_at',{ascending:false}).limit(limit);
    const status=url.searchParams.get('status');if(status)query=query.eq('status',status.toUpperCase());
    const {data,error}=await query;if(error)return json({error:'BET_HISTORY_FAILED',message:error.message},500);
    return json({status:'OK',count:data?.length??0,rows:data??[]});
  }
  if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
  const body=await request.json().catch(()=>({})),action=String(body?.action??'RECORD').toUpperCase();
  if(action==='RECORD'){
    const checked=validateBetRecord(body);if(!checked.valid)return json({error:'INVALID_BET_RECORD',details:checked.errors},422);
    const b=checked.normalized,idempotencyKey=String(body?.idempotency_key??await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(b))).then(hash=>Array.from(new Uint8Array(hash)).map(x=>x.toString(16).padStart(2,'0')).join('')));
    const {data,error}=await db.from('cfi_user_bets').upsert({idempotency_key:idempotencyKey,prediction_snapshot_id:b.predictionSnapshotId,target_date:b.targetDate,home_team:b.home,away_team:b.away,market_family:b.marketFamily,market:b.market,period:b.period,selection:b.selection,line:b.line,decimal_odds:b.odds,stake:b.stake,bookmaker:b.bookmaker,confirmed_at:b.confirmedAt,confirmed_by_user:true,manual_override:b.manualOverride,source_url:b.sourceUrl,notes:b.notes},{onConflict:'idempotency_key',ignoreDuplicates:true}).select('bet_id').maybeSingle();
    if(error)return json({error:'BET_RECORD_FAILED',message:error.message},500);
    return json({status:'RECORDED',betId:data?.bet_id??null,idempotencyKey,autoPlaced:false,explicitUserConfirmation:true});
  }
  if(action==='SETTLE'){
    const betId=String(body?.bet_id??'');if(!betId)return json({error:'BET_ID_REQUIRED'},400);
    const {data:bet,error:betError}=await db.from('cfi_user_bets').select('*').eq('bet_id',betId).single();if(betError)return json({error:'BET_NOT_FOUND',message:betError.message},404);
    if(body?.result_verified!==true||!body?.result_source_url||!body?.result_provenance||typeof body.result_provenance!=='object'||Array.isArray(body.result_provenance)||Object.keys(body.result_provenance).length===0)return json({error:'VERIFIED_RESULT_PROVENANCE_REQUIRED'},422);
    const result={htHome:Number(body.ht_home),htAway:Number(body.ht_away),ftHome:Number(body.ft_home),ftAway:Number(body.ft_away)};
    const settlement=settleBet({target_date:bet.target_date,home:bet.home_team,away:bet.away_team,market_family:bet.market_family,market:bet.market,period:bet.period,selection:bet.selection,line:bet.line,odds:bet.decimal_odds,stake:bet.stake,bookmaker:bet.bookmaker,confirmed_at:bet.confirmed_at},result);
    const {error}=await db.from('cfi_user_bet_settlements').insert({bet_id:betId,settlement_state:settlement.state,profit_loss:settlement.profit,return_amount:settlement.returnAmount,actual_ht_home:result.htHome,actual_ht_away:result.htAway,actual_ft_home:result.ftHome,actual_ft_away:result.ftAway,result_source_url:String(body.result_source_url),result_provenance:body.result_provenance});
    if(error)return json({error:'BET_SETTLEMENT_FAILED',message:error.message},500);
    return json({status:'SETTLED',betId,...settlement});
  }
  return json({error:'INVALID_ACTION',allowed:['RECORD','SETTLE']},400);
});
