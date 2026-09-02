import fs from 'node:fs/promises';
import { resolveResearchCredentials, createResearchSupabaseReader } from './supabase-read-adapter.mjs';
import { buildFrozenBaselineContext } from './group-a-prospective-context-v1.mjs';
import { applyFrozenGroupACandidate, GROUP_A_PROSPECTIVE_MODEL_V1 } from './group-a-prospective-model-v1.mjs';
import {
  GROUP_A_PROSPECTIVE_CAPTURE_V1,
  createGroupAProspectiveResearchWriter,
  persistGroupAProspectiveCandidate,
  selectProspectiveFt1X2Market,
} from './group-a-prospective-capture-v1.mjs';

export const GROUP_A_PROSPECTIVE_RUNNER_V1=Object.freeze({
  version:'CFI_GROUP_A_PROSPECTIVE_RUNNER_V1',
  researchOnly:true,
  decisionUse:false,
  productionMutationAllowed:false,
  productionEligible:false,
  noReconstruction:true,
  selectedCandidates:[...GROUP_A_PROSPECTIVE_MODEL_V1.selectedCandidates],
  defaultMaxFixtures:20,
  maxFixtureCap:100,
  settlementWriterIncluded:false,
});

const text=x=>String(x??'').trim();
const errCode=error=>text(error?.message||error).split('\n')[0].slice(0,300)||'UNKNOWN_ERROR';
const enc=x=>encodeURIComponent(String(x));

function assertFrozenSummary(summary){
  if(summary?.version!=='CFI_HF_GROUP_A_SHADOW_V1')throw new Error('GROUP_A_PROSPECTIVE_HF_SUMMARY_REQUIRED');
  if(summary?.frozenStateVersion!=='CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1'||summary?.trainedThrough!=='2026-08-19')throw new Error('GROUP_A_PROSPECTIVE_HF_FROZEN_STATE_DRIFT');
  if(summary?.strictPrior!==true||summary?.noReconstruction!==true||summary?.decisionUse!==false||summary?.productionMutationAllowed!==false)throw new Error('GROUP_A_PROSPECTIVE_HF_CONTRACT_FAIL');
  if(JSON.stringify(summary?.selectedCandidates)!==JSON.stringify(GROUP_A_PROSPECTIVE_RUNNER_V1.selectedCandidates))throw new Error('GROUP_A_PROSPECTIVE_CANDIDATE_SET_DRIFT');
  for(const name of GROUP_A_PROSPECTIVE_RUNNER_V1.selectedCandidates){
    const learner=summary?.frozenLearners?.[name];
    if(!learner||learner.stateVersion!=='CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1'||learner.trainedThrough!=='2026-08-19')throw new Error(`GROUP_A_PROSPECTIVE_FROZEN_LEARNER_REQUIRED:${name}`);
  }
}

function limitValue(raw){
  const n=Math.floor(Number(raw));
  if(!Number.isFinite(n)||n<1)return GROUP_A_PROSPECTIVE_RUNNER_V1.defaultMaxFixtures;
  return Math.min(GROUP_A_PROSPECTIVE_RUNNER_V1.maxFixtureCap,n);
}

export async function loadGroupAProspectiveLiveInputs({reader,nowIso}={}){
  if(!reader?.readAll)throw new Error('GROUP_A_PROSPECTIVE_READER_REQUIRED');
  if(!Number.isFinite(Date.parse(text(nowIso))))throw new Error('GROUP_A_PROSPECTIVE_NOW_REQUIRED');
  const future=enc(nowIso);
  const [fixtures,markets,competitionProfiles]=await Promise.all([
    reader.readAll(`cfi_living_verified_fixtures?select=fixture_id,target_date,kickoff_at,home_team,away_team,canonical_home_team_id,canonical_away_team_id,competition,source_name,source_provenance,verification_status&verification_status=eq.VERIFIED&kickoff_at=gt.${future}&order=kickoff_at.asc,fixture_id.asc`,{critical:false,label:'group_a_future_verified_fixtures'}),
    reader.readAll(`cfi_market_snapshots?select=market_snapshot_id,fixture_id,verified_fixture_id,captured_at,kickoff_at,bookmaker,market_family,period,line,odds_home,odds_draw,odds_away,odds_over,odds_under,source_name,source_url,source_provenance,is_closing,research_only&research_only=eq.true&verified_fixture_id=not.is.null&market_family=eq.1X2&period=eq.FT&is_closing=eq.false&kickoff_at=gt.${future}&order=kickoff_at.asc,captured_at.desc`,{critical:false,label:'group_a_future_market_snapshots'}),
    reader.readAll('cfi_competition_profiles?select=competition_key,competition_name,country,segment,gender,age_class,professional_level,source,confidence',{critical:true,label:'competition_profiles'}),
  ]);
  return {fixtures,markets,competitionProfiles};
}

export async function runGroupAProspectiveCapture({corpus,featureBundle,hfSummary,reader,writer,nowIso,maxFixtures=GROUP_A_PROSPECTIVE_RUNNER_V1.defaultMaxFixtures,write=false}={}){
  assertFrozenSummary(hfSummary);
  if(!reader?.readAll)throw new Error('GROUP_A_PROSPECTIVE_READER_REQUIRED');
  if(write&&(!writer?.persistSnapshot||!writer?.persistDecision))throw new Error('GROUP_A_PROSPECTIVE_WRITER_REQUIRED');
  const startedAt=text(nowIso);
  if(!Number.isFinite(Date.parse(startedAt)))throw new Error('GROUP_A_PROSPECTIVE_NOW_REQUIRED');
  const inputs=await loadGroupAProspectiveLiveInputs({reader,nowIso:startedAt});
  const marketsByFixture=new Map();
  for(const row of inputs.markets){const id=text(row?.verified_fixture_id);if(!id)continue;const list=marketsByFixture.get(id)??[];list.push(row);marketsByFixture.set(id,list);}
  const results=[],blocked=[];
  let considered=0;
  for(const fixture of inputs.fixtures){
    if(considered>=limitValue(maxFixtures))break;
    const fixtureId=text(fixture?.fixture_id),marketSnapshots=marketsByFixture.get(fixtureId)??[];
    try{
      selectProspectiveFt1X2Market({fixtureId,marketSnapshots,decisionTimestamp:startedAt});
      const context=buildFrozenBaselineContext({corpus,featureBundle,fixture,competitionProfiles:inputs.competitionProfiles});
      considered+=1;
      for(const modelName of GROUP_A_PROSPECTIVE_RUNNER_V1.selectedCandidates){
        const learner=hfSummary.frozenLearners[modelName];
        const args=modelName==='OPPONENT_STRENGTH_ARM_V1'
          ? {modelName,baseExpectedGoals:context.baseExpectedGoals,homeStrength:context.homeStrength,awayStrength:context.awayStrength,learner}
          : {modelName,baseExpectedGoals:context.baseExpectedGoals,competitionSegment:context.competition.competitionSegment,learner};
        const candidate=applyFrozenGroupACandidate(args);
        if(candidate.status==='ABSTAIN'){
          blocked.push({fixtureId,modelName,status:'ABSTAIN',reason:candidate.reason});
          continue;
        }
        if(!write){
          results.push({fixtureId,modelName,status:'DRY_RUN_READY',predictionHash:candidate.predictionHash,researchOnly:true,decisionUse:false,productionMutationAllowed:false});
          continue;
        }
        const saved=await persistGroupAProspectiveCandidate({writer,fixture,context,candidate,learner,marketSnapshots,decisionTimestamp:startedAt});
        results.push({...saved,status:'CAPTURED'});
      }
    }catch(error){
      blocked.push({fixtureId,status:'BLOCKED',reason:errCode(error)});
    }
  }
  return {
    version:GROUP_A_PROSPECTIVE_RUNNER_V1.version,
    startedAt,
    mode:write?'WRITE_RESEARCH_ONLY':'DRY_RUN',
    input:{futureVerifiedFixtures:inputs.fixtures.length,futureFt1X2MarketRows:inputs.markets.length,competitionProfiles:inputs.competitionProfiles.length,maxFixtures:limitValue(maxFixtures)},
    consideredFixtures:considered,
    capturedDecisions:results.filter(x=>x.status==='CAPTURED').length,
    dryRunReady:results.filter(x=>x.status==='DRY_RUN_READY').length,
    results,blocked,
    researchOnly:true,decisionUse:false,productionMutationAllowed:false,productionEligible:false,noReconstruction:true,
    settlementWriterIncluded:false,
    settlementPath:GROUP_A_PROSPECTIVE_CAPTURE_V1.settlementPath,
  };
}

async function main(){
  const [corpusPath,featurePath,hfSummaryPath,outputPath='group-a-prospective-capture-result.json',mode='--dry-run']=process.argv.slice(2);
  if(!corpusPath||!featurePath||!hfSummaryPath)throw new Error('USAGE: node research/group-a-prospective-runner-v1.mjs <r0.json> <group-a.json> <hf-summary.json> [output.json] [--dry-run|--write]');
  if(!['--dry-run','--write'].includes(mode))throw new Error('GROUP_A_PROSPECTIVE_MODE_INVALID');
  const [corpus,featureBundle,hfSummary]=await Promise.all([corpusPath,featurePath,hfSummaryPath].map(async p=>JSON.parse(await fs.readFile(p,'utf8'))));
  const {baseUrl,key}=resolveResearchCredentials(process.env);
  const reader=createResearchSupabaseReader({baseUrl,key});
  const writer=mode==='--write'?createGroupAProspectiveResearchWriter({baseUrl,key,reader}):null;
  const nowIso=new Date().toISOString();
  const result=await runGroupAProspectiveCapture({corpus,featureBundle,hfSummary,reader,writer,nowIso,maxFixtures:process.env.CFI_GROUP_A_PROSPECTIVE_MAX_FIXTURES,write:mode==='--write'});
  await fs.writeFile(outputPath,`${JSON.stringify(result,null,2)}\n`);
  process.stdout.write(`${JSON.stringify({outputPath,version:result.version,mode:result.mode,consideredFixtures:result.consideredFixtures,capturedDecisions:result.capturedDecisions,dryRunReady:result.dryRunReady,blocked:result.blocked.length,researchOnly:result.researchOnly,decisionUse:result.decisionUse,productionMutationAllowed:result.productionMutationAllowed,settlementWriterIncluded:result.settlementWriterIncluded})}\n`);
}
if(import.meta.url===`file://${process.argv[1]}`)main().catch(error=>{console.error(error?.stack??String(error));process.exitCode=1});
