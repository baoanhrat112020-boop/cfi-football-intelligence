export const CFI_EVIDENCE_SUFFICIENCY_VERSION='CFI_EVIDENCE_SUFFICIENCY_V1';
export const MIN_DISPLAY_FIXTURES_PER_TEAM=1;
export const MIN_DECISION_FIXTURES_PER_TEAM=8;

const count=(value:unknown)=>Number.isFinite(Number(value))&&Number(value)>=0?Math.floor(Number(value)):0;

export function evaluateEvidenceSufficiency(body:any){
  const exact=body?.bigDbRetrieval?.exactTeam??body?.exactTeam??{};
  const input=body?.bigDbRetrieval?.predictionInput??{};
  const evidence=body?.evidence?.counts??body?.evidence??{};
  const home=count(exact?.home?.retrieved??input?.homeFixtures??evidence?.homeFixtures);
  const away=count(exact?.away?.retrieved??input?.awayFixtures??evidence?.awayFixtures);
  const h2h=count(exact?.h2h?.retrieved??input?.h2hFixtures??evidence?.h2hFixtures);
  const minimum=Math.min(home,away);
  const displayEligible=home>=MIN_DISPLAY_FIXTURES_PER_TEAM&&away>=MIN_DISPLAY_FIXTURES_PER_TEAM;
  const decisionEligible=home>=MIN_DECISION_FIXTURES_PER_TEAM&&away>=MIN_DECISION_FIXTURES_PER_TEAM;
  const status=!displayEligible?'BLOCKED':decisionEligible?'SUFFICIENT':'LIMITED';
  return{
    version:CFI_EVIDENCE_SUFFICIENCY_VERSION,
    status,
    homeFixtures:home,
    awayFixtures:away,
    h2hFixtures:h2h,
    minimumTeamFixtures:minimum,
    displayEligible,
    decisionEligible,
    requiredPerTeam:MIN_DECISION_FIXTURES_PER_TEAM,
    reason:!displayEligible?'EXACT_TEAM_EVIDENCE_REQUIRED':!decisionEligible?'MINIMUM_TEAM_HISTORY_NOT_MET':null,
    probabilityUse:decisionEligible?'PRACTICAL_DECISION':'RESEARCH_DISPLAY_ONLY',
  } as const;
}
