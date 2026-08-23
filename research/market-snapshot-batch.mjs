import { validateMarketSnapshot, validateDecisionSnapshot } from './market-snapshot-contract.mjs';

export function validateMarketSnapshotBatch(rows=[]){
  const seen=new Set(),accepted=[],rejected=[];
  for(const row of rows){
    const key=[row.fixture_id,row.bookmaker,row.market_family,row.period,row.line??'',row.captured_at].join('|');
    if(seen.has(key)){rejected.push({row,error:'DUPLICATE_SNAPSHOT'});continue;}
    seen.add(key);
    const audit=validateMarketSnapshot(row);
    if(!audit.valid)rejected.push({row,error:audit.errors.join('|')});else accepted.push(row);
  }
  return {version:'CFI_MARKET_SNAPSHOT_BATCH_V1',accepted,rejected,writeEligible:rejected.length===0&&accepted.length>0,researchOnly:true};
}

export function validateDecisionBatch(decisions=[],marketById={}){
  const accepted=[],rejected=[];
  for(const row of decisions){
    const market=marketById[row.market_snapshot_id];
    if(!market){rejected.push({row,error:'MARKET_SNAPSHOT_NOT_FOUND'});continue;}
    const audit=validateDecisionSnapshot(row,market);
    if(!audit.valid)rejected.push({row,error:audit.errors.join('|')});else accepted.push(row);
  }
  return {version:'CFI_DECISION_SNAPSHOT_BATCH_V1',accepted,rejected,writeEligible:rejected.length===0&&accepted.length>0,researchOnly:true,decisionUse:false};
}
