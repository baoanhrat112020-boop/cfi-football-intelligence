import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrozenBaselineContext,
  buildGroupAProspectivePredictions,
  resolveProspectiveCompetition,
} from '../research/group-a-prospective-context-v1.mjs';

function frozenCorpus(days=24){
  const fixtures=[];
  const teams=[['a','Alpha'],['b','Beta'],['c','Gamma'],['d','Delta']];
  for(let n=0;n<days;n+=1){
    const d=new Date(Date.UTC(2026,6,20+n)).toISOString().slice(0,10);
    const pairs=n%2===0?[[0,2],[1,3]]:[[0,3],[1,2]];
    for(let j=0;j<pairs.length;j+=1){
      const [hi,ai]=pairs[j], [hid,home]=teams[hi], [aid,away]=teams[ai];
      const ftHome=(n+j)%4,ftAway=(n+2*j)%3;
      fixtures.push({
        fixture_id:`hist-${n}-${j}`,
        match_date:d,
        home_team_id:hid,
        away_team_id:aid,
        home_team:home,
        away_team:away,
        ht_home:Math.min(ftHome,(n+j)%2),
        ht_away:Math.min(ftAway,(n+j+1)%2),
        ft_home:ftHome,
        ft_away:ftAway,
        status:'CANONICAL',
        competition_key:'england:e1',
        competition_name:'England Championship',
        country:'England',
        season:'2026-27',
        competition_segment:'MID_PRO',
      });
    }
  }
  return {fixtures};
}

function frozenFeatures(){
  return {
    baselineCommitSha:'518dfb57aafc8428e09b3ec84e440146c839a19e',
    strengths:[
      {team_id:'a',as_of_date:'2026-08-19',strict_prior:true,attack_index:.7,defense_index:-.2,net_strength:.5,confidence:.9,competition_key:'england:e1',segment_v2:'M|SENIOR|MID_PRO'},
      {team_id:'b',as_of_date:'2026-08-19',strict_prior:true,attack_index:.2,defense_index:.1,net_strength:-.1,confidence:.85,competition_key:'england:e1',segment_v2:'M|SENIOR|MID_PRO'},
      {team_id:'a',as_of_date:'2026-08-18',strict_prior:true,attack_index:.6,defense_index:-.1,net_strength:.4,confidence:.8,competition_key:'england:e1',segment_v2:'M|SENIOR|MID_PRO'},
      {team_id:'b',as_of_date:'2026-08-18',strict_prior:true,attack_index:.1,defense_index:.2,net_strength:-.2,confidence:.8,competition_key:'england:e1',segment_v2:'M|SENIOR|MID_PRO'},
    ],
  };
}

const profile={competition_key:'england:e1',competition_name:'England Championship',segment:'MID_PRO',source:'CFI_COMPETITION_PROFILE_V1',confidence:1};
function futureFixture(overrides={}){
  return {
    fixture_id:'vf-1',
    target_date:'2026-09-02',
    kickoff_at:'2026-09-02T18:45:00Z',
    home_team:'Alpha',
    away_team:'Beta',
    canonical_home_team_id:'a',
    canonical_away_team_id:'b',
    competition:'E1',
    source_name:'Football-Data',
    source_provenance:{provider:'football-data',sourceDivision:'E1'},
    verification_status:'VERIFIED',
    ...overrides,
  };
}

function frozenSuite(){
  return {
    strictPrior:true,
    noReconstruction:true,
    decisionUse:false,
    productionMutationAllowed:false,
    challengers:{
      OPPONENT_STRENGTH_ARM_V1:{
        learner:{stateVersion:'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',trainedThrough:'2026-08-19',ht:{n:1000,beta:[.01,.10,-.05,.08]},ft:{n:1000,beta:[.02,.20,-.10,.16]}},
      },
      HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1:{
        learner:{stateVersion:'CFI_GROUP_A_FROZEN_PROSPECTIVE_STATE_V1',trainedThrough:'2026-08-19',globalHt:{n:1000,h:.06,a:-.02},globalFt:{n:1000,h:.12,a:-.04},segmentHt:{MID_PRO:{n:500,h:.10,a:.02}},segmentFt:{MID_PRO:{n:500,h:.20,a:.01}},segmentPriorWeight:500},
      },
    },
  };
}

test('competition resolution reuses Football-Data registry and canonical profile taxonomy',()=>{
  const out=resolveProspectiveCompetition({fixture:futureFixture(),competitionProfiles:[profile]});
  assert.equal(out.sourceDivision,'E1');
  assert.equal(out.competitionKey,'england:e1');
  assert.equal(out.competitionSegment,'MID_PRO');
  assert.equal(out.profileSource,'CFI_COMPETITION_PROFILE_V1');
});

test('frozen context uses canonical team ids and never crosses the Aug-20 holdout',()=>{
  const context=buildFrozenBaselineContext({corpus:frozenCorpus(),featureBundle:frozenFeatures(),fixture:futureFixture(),competitionProfiles:[profile]});
  assert.equal(context.fixture.canonicalHomeTeamId,'a');
  assert.equal(context.fixture.canonicalAwayTeamId,'b');
  assert.ok(context.historySupport.home>=6);
  assert.ok(context.historySupport.away>=6);
  assert.equal(context.maxEvidenceDate,'2026-08-19');
  assert.ok(context.maxEvidenceDate<'2026-08-20');
  assert.equal(context.homeStrength.as_of_date,'2026-08-19');
  assert.equal(context.awayStrength.as_of_date,'2026-08-19');
  assert.equal(context.competition.competitionSegment,'MID_PRO');
  assert.ok(Object.values(context.baseExpectedGoals).every(Number.isFinite));
  assert.equal(context.researchOnly,true);
  assert.equal(context.decisionUse,false);
  assert.equal(context.productionMutationAllowed,false);
  assert.equal(context.noReconstruction,true);
});

test('prospective output deterministically contains only the two historically clean candidates',()=>{
  const args={corpus:frozenCorpus(),featureBundle:frozenFeatures(),fixture:futureFixture(),competitionProfiles:[profile],suiteResult:frozenSuite()};
  const a=buildGroupAProspectivePredictions(args);
  const b=buildGroupAProspectivePredictions(args);
  assert.deepEqual(Object.keys(a.predictions).sort(),['HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1','OPPONENT_STRENGTH_ARM_V1']);
  assert.equal(a.predictions.OPPONENT_STRENGTH_ARM_V1.status,'READY');
  assert.equal(a.predictions.HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1.status,'READY');
  assert.equal(a.predictions.OPPONENT_STRENGTH_ARM_V1.predictionHash,b.predictions.OPPONENT_STRENGTH_ARM_V1.predictionHash);
  assert.equal(a.predictions.HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1.predictionHash,b.predictions.HIERARCHICAL_LEAGUE_SEGMENT_CALIBRATION_V1.predictionHash);
  assert.equal(a.productionEligible,false);
  assert.equal(a.productionMutationAllowed,false);
  assert.equal(a.noReconstruction,true);
});

test('pre-holdout targets, unresolved divisions and missing profiles fail closed',()=>{
  const common={corpus:frozenCorpus(),featureBundle:frozenFeatures(),competitionProfiles:[profile]};
  assert.throws(()=>buildFrozenBaselineContext({...common,fixture:futureFixture({target_date:'2026-08-19',kickoff_at:'2026-08-19T18:45:00Z'})}),/TARGET_MUST_BE_HOLDOUT/);
  assert.throws(()=>resolveProspectiveCompetition({fixture:futureFixture({competition:'ZZ',source_provenance:{provider:'football-data',sourceDivision:'ZZ'}}),competitionProfiles:[profile]}),/DIVISION_UNRESOLVED/);
  assert.throws(()=>resolveProspectiveCompetition({fixture:futureFixture(),competitionProfiles:[]}),/COMPETITION_PROFILE_REQUIRED/);
});

test('any result row at or after holdout is rejected instead of being replayed into future context',()=>{
  const corpus=frozenCorpus();
  corpus.fixtures.push({...corpus.fixtures[0],fixture_id:'forbidden-holdout-result',match_date:'2026-08-20'});
  assert.throws(()=>buildFrozenBaselineContext({corpus,featureBundle:frozenFeatures(),fixture:futureFixture(),competitionProfiles:[profile]}),/CORPUS_HOLDOUT_LEAKAGE/);
});

test('non Football-Data prospective fixture cannot silently borrow the division mapping',()=>{
  assert.throws(()=>resolveProspectiveCompetition({fixture:futureFixture({source_name:'Other',source_provenance:{provider:'other',sourceDivision:'E1'}}),competitionProfiles:[profile]}),/FOOTBALL_DATA_FIXTURE_REQUIRED/);
});
