const time=v=>{const n=Date.parse(v);return Number.isFinite(n)?n:null};
const date=v=>typeof v==='string'?v.slice(0,10):null;

export function validateStrictPrematchSnapshot(snapshot,fixture){
  const reasons=[];
  if(!snapshot||!fixture) return {eligible:false,reasons:['SNAPSHOT_OR_FIXTURE_REQUIRED']};
  if(snapshot.strict_prior!==true) reasons.push('STRICT_PRIOR_REQUIRED');
  if(String(snapshot.status??'')!=='SUCCESS') reasons.push('SNAPSHOT_STATUS_NOT_SUCCESS');
  const target=date(snapshot.target_date),fixtureDate=date(fixture.target_date??fixture.match_date??fixture.kickoff_at);
  if(!target||!fixtureDate||target!==fixtureDate) reasons.push('TARGET_DATE_MISMATCH');
  const created=time(snapshot.created_at),kickoff=time(fixture.kickoff_at);
  if(created==null||kickoff==null||created>=kickoff) reasons.push('SNAPSHOT_NOT_FROZEN_BEFORE_KICKOFF');
  const maxEvidence=date(snapshot.max_evidence_date);
  if(!maxEvidence||!target||maxEvidence>=target) reasons.push('EVIDENCE_NOT_STRICTLY_PRIOR_DATE');
  const version=String(snapshot.model_version??snapshot.engine_version??snapshot.prediction?.engine??'');
  if(version && !version.includes('5.2.5')) reasons.push('PREMATCH_VERSION_NOT_V5_2_5');
  return {eligible:reasons.length===0,reasons};
}

export function selectStrictPrematchPrior(fixture,snapshots){
  const candidates=(snapshots??[])
    .filter(s=>validateStrictPrematchSnapshot(s,fixture).eligible)
    .sort((a,b)=>time(b.created_at)-time(a.created_at));
  if(!candidates.length) return {status:'EXCLUDE_NO_STRICT_PRIOR',snapshot:null,reasons:['NO_STRICT_PREMATCH_V5_2_5_SNAPSHOT']};
  const snapshot=candidates[0];
  return {status:'OK',snapshot,reasons:[]};
}

export function bridgeFixturesToPriors(fixtures,snapshotsByFixture){
  return (fixtures??[]).map(fixture=>{
    const key=String(fixture.fixture_id??fixture.matchId??'');
    const selected=selectStrictPrematchPrior(fixture,snapshotsByFixture?.[key]??[]);
    return {fixture,...selected};
  });
}
