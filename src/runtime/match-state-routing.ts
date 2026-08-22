const PREMATCH_STATES=new Set(['SCHEDULED','COUNTDOWN','NOT_STARTED','NOTSTARTED','NS','PREMATCH','PRE_MATCH','UPCOMING']);
const TERMINAL_STATES=new Set(['FT','FINISHED','FINAL','CANCELLED','CANCELED','POSTPONED','ABANDONED']);
const DATE_RE=/^\d{4}-\d{2}-\d{2}$/;

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

function dateOnly(v:any){
  const raw=String(v??'').trim();
  if(DATE_RE.test(raw))return raw;
  const m=raw.match(/^(\d{4}-\d{2}-\d{2})T/);
  return m?.[1]??null;
}

export function resolveTargetDate(input:any){
  const candidates:[string,any][]=[
    ['target_date',input?.target_date],['matchDate',input?.matchDate],['fixtureDate',input?.fixtureDate],
    ['kickoffDate',input?.kickoffDate],['clientLocalDate',input?.clientLocalDate],['kickoffAt',input?.kickoffAt],
    ['scheduledStart',input?.scheduledStart],['startTime',input?.startTime]
  ];
  for(const [source,value] of candidates){const date=dateOnly(value);if(date)return {date,source};}
  return {date:null,source:null};
}
