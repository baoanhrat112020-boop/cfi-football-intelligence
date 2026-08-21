const PREMATCH_STATES=new Set(['SCHEDULED','COUNTDOWN','NOT_STARTED','NOTSTARTED','NS','PREMATCH','PRE_MATCH','UPCOMING']);
const TERMINAL_STATES=new Set(['FT','FINISHED','FINAL','CANCELLED','CANCELED','POSTPONED','ABANDONED']);

export function normalizeMatchState(v:any){return String(v??'').trim().toUpperCase().replace(/[\s-]+/g,'_');}

export function classifyMatchState(input:any){
  const period=normalizeMatchState(input?.live?.period);
  if(['1H','HT','2H'].includes(period))return 'LIVE';
  const explicit=normalizeMatchState(input?.matchStatus??input?.fixtureStatus??input?.match_state??input?.fixture_state??input?.status);
  if(PREMATCH_STATES.has(explicit))return 'PREMATCH';
  if(TERMINAL_STATES.has(explicit))return 'TERMINAL';
  if(input?.live&&Number.isFinite(Number(input.live.minute)))return 'LIVE';
  return 'UNKNOWN';
}
