import { createHash } from 'node:crypto';

export const SNAPSHOT_MINUTES = Object.freeze([15,30,45,60,75]);

const num=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const name=v=>typeof v==='string'?v:(v?.name??'');
const teamOf=e=>name(e?.team);
const typeOf=e=>name(e?.type).toLowerCase();
const outcomeOf=e=>name(e?.shot?.outcome).toLowerCase();
const cardOf=e=>name(e?.foul_committed?.card).toLowerCase();
const secondKey=e=>num(e?.period)*100000+num(e?.minute)*60+num(e?.second);
const before=(e,m)=>num(e?.minute)<m || (num(e?.minute)===m && num(e?.second)===0);
const stable=x=>JSON.stringify(x,Object.keys(x).sort());

function prefixHash(events){return createHash('sha256').update(JSON.stringify(events)).digest('hex');}
function isGoal(e){return typeOf(e)==='shot' && ['goal'].includes(outcomeOf(e));}
function isShot(e){return typeOf(e)==='shot';}
function isSot(e){return isShot(e) && ['goal','saved','saved to post'].includes(outcomeOf(e));}
function isRed(e){const c=cardOf(e);return c.includes('red');}
function xg(e){return isShot(e)?num(e?.shot?.statsbomb_xg, num(e?.shot_statsbomb_xg,0)):0;}

export function buildSnapshots({matchId,homeTeam,awayTeam,events,source='STATSBOMB_OPEN_DATA',minutes=SNAPSHOT_MINUTES}){
  if(!matchId||!homeTeam||!awayTeam||!Array.isArray(events)) throw new Error('INVALID_SNAPSHOT_INPUT');
  const ordered=[...events].sort((a,b)=>secondKey(a)-secondKey(b)||num(a?.index)-num(b?.index));
  const ft={home:ordered.filter(e=>isGoal(e)&&teamOf(e)===homeTeam).length,away:ordered.filter(e=>isGoal(e)&&teamOf(e)===awayTeam).length};
  return minutes.map(minute=>{
    const prefix=ordered.filter(e=>before(e,minute));
    const count=(pred,team)=>prefix.filter(e=>pred(e)&&(!team||teamOf(e)===team)).length;
    const sum=(fn,team)=>prefix.filter(e=>!team||teamOf(e)===team).reduce((a,e)=>a+fn(e),0);
    const score={home:count(isGoal,homeTeam),away:count(isGoal,awayTeam)};
    const snapshot={
      version:'CFI_LIVE_HISTORICAL_SNAPSHOT_V1',source,matchId,minute,
      eventCutoff:`<${minute}:00`,homeTeam,awayTeam,score,
      shots:{home:count(isShot,homeTeam),away:count(isShot,awayTeam)},
      shotsOnTarget:{home:count(isSot,homeTeam),away:count(isSot,awayTeam)},
      xg:{home:sum(xg,homeTeam),away:sum(xg,awayTeam)},
      redCards:{home:count(isRed,homeTeam),away:count(isRed,awayTeam)},
      substitutions:{home:count(e=>typeOf(e)==='substitution',homeTeam),away:count(e=>typeOf(e)==='substitution',awayTeam)},
      provenance:{eventPrefixCount:prefix.length,eventPrefixSha256:prefixHash(prefix),strictPrefix:true,futureEventsIncluded:false},
      labels:{ftScore:ft,remainingGoals:{home:ft.home-score.home,away:ft.away-score.away},sevenPlusFT:Number(ft.home+ft.away>=7),otherFT:Number(Math.max(ft.home,ft.away)>=5)}
    };
    return snapshot;
  });
}

export function validateNoFutureLeakage(snapshot,events){
  const prefix=[...events].filter(e=>before(e,snapshot.minute)).sort((a,b)=>secondKey(a)-secondKey(b)||num(a?.index)-num(b?.index));
  return snapshot?.provenance?.strictPrefix===true && snapshot?.provenance?.futureEventsIncluded===false && snapshot?.provenance?.eventPrefixCount===prefix.length && snapshot?.provenance?.eventPrefixSha256===prefixHash(prefix);
}
