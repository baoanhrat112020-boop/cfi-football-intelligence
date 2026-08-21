import { buildSnapshots } from './live-historical-snapshot-builder.mjs';

export const STATSBOMB_OPEN_DATA_BASE='https://raw.githubusercontent.com/statsbomb/open-data/master/data';

async function getJson(url,fetchImpl=fetch){
  const r=await fetchImpl(url,{headers:{accept:'application/json'}});
  if(!r.ok) throw new Error(`STATSBOMB_FETCH_FAILED:${r.status}:${url}`);
  return r.json();
}

export async function listStatsBombCompetitions(fetchImpl=fetch){
  return getJson(`${STATSBOMB_OPEN_DATA_BASE}/competitions.json`,fetchImpl);
}

export async function listStatsBombMatches(competitionId,seasonId,fetchImpl=fetch){
  return getJson(`${STATSBOMB_OPEN_DATA_BASE}/matches/${competitionId}/${seasonId}.json`,fetchImpl);
}

export async function fetchStatsBombEvents(matchId,fetchImpl=fetch){
  return getJson(`${STATSBOMB_OPEN_DATA_BASE}/events/${matchId}.json`,fetchImpl);
}

export async function buildStatsBombMatchSnapshots(match,fetchImpl=fetch){
  const matchId=match?.match_id;
  const homeTeam=match?.home_team?.home_team_name;
  const awayTeam=match?.away_team?.away_team_name;
  if(!matchId||!homeTeam||!awayTeam) throw new Error('INVALID_STATSBOMB_MATCH_METADATA');
  const events=await fetchStatsBombEvents(matchId,fetchImpl);
  return buildSnapshots({matchId,homeTeam,awayTeam,events,source:'STATSBOMB_OPEN_DATA'});
}
