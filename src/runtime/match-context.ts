export type MatchContextPair={home:number;away:number};
export type MatchContextFixture={
  id:string;
  matchDate:string;
  homeTeam:string;
  awayTeam:string;
  competition:string|null;
  country:string|null;
  season:string|null;
  ht:MatchContextPair|null;
  ft:MatchContextPair|null;
};

const finite=(value:unknown)=>{
  if(value===null||value===undefined||value==='')return null;
  const n=Number(value);
  return Number.isFinite(n)&&n>=0?n:null;
};

export function normalizeMatchContextFixture(row:any):MatchContextFixture|null{
  const matchDate=String(row?.match_date??row?.matchDate??'').slice(0,10);
  const homeTeam=String(row?.home_name??row?.homeTeam??row?.home_team??'').trim();
  const awayTeam=String(row?.away_name??row?.awayTeam??row?.away_team??'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(matchDate)||!homeTeam||!awayTeam)return null;
  const score=(h:any,a:any):MatchContextPair|null=>{
    const hh=finite(h),aa=finite(a);
    return hh===null||aa===null?null:{home:hh,away:aa};
  };
  return{
    id:String(row?.fixture_id??row?.id??[matchDate,homeTeam,awayTeam].join('|')),
    matchDate,homeTeam,awayTeam,
    competition:String(row?.competition_name??row?.competition_key??'').trim()||null,
    country:String(row?.country??'').trim()||null,
    season:String(row?.season??'').trim()||null,
    ht:score(row?.ht_home,row?.ht_away),
    ft:score(row?.ft_home,row?.ft_away)
  };
}

export function buildTeamContextSummary(team:string,rows:any[]){
  const key=team.toLowerCase();
  const normalized=(Array.isArray(rows)?rows:[])
    .map(normalizeMatchContextFixture)
    .filter((x):x is MatchContextFixture=>x!==null)
    .sort((a,b)=>b.matchDate.localeCompare(a.matchDate));

  let wins=0,draws=0,losses=0,gf=0,ga=0,htGf=0,htGa=0,ftN=0,htN=0,btts=0,over25=0,cleanSheets=0,scored=0;
  const form:string[]=[];

  for(const row of normalized){
    const isHome=row.homeTeam.toLowerCase()===key;
    if(row.ft){
      const f=isHome?row.ft.home:row.ft.away;
      const a=isHome?row.ft.away:row.ft.home;
      gf+=f;ga+=a;ftN++;
      if(f>a){wins++;form.push('W')}
      else if(f===a){draws++;form.push('D')}
      else{losses++;form.push('L')}
      if(f>0)scored++;
      if(a===0)cleanSheets++;
      if(f>0&&a>0)btts++;
      if(f+a>=3)over25++;
    }
    if(row.ht){
      htGf+=isHome?row.ht.home:row.ht.away;
      htGa+=isHome?row.ht.away:row.ht.home;
      htN++;
    }
  }

  const pct=(n:number,d:number)=>d?Math.round((n/d)*1000)/10:null;
  const avg=(n:number,d:number)=>d?Math.round((n/d)*100)/100:null;

  return{
    fixtures:normalized.length,
    completed:ftN,
    wins,draws,losses,
    avgGoalsFor:avg(gf,ftN),
    avgGoalsAgainst:avg(ga,ftN),
    avgHtGoalsFor:avg(htGf,htN),
    avgHtGoalsAgainst:avg(htGa,htN),
    scoringRate:pct(scored,ftN),
    cleanSheetRate:pct(cleanSheets,ftN),
    bttsRate:pct(btts,ftN),
    over25Rate:pct(over25,ftN),
    form:form.slice(0,5),
    recent:normalized.slice(0,10)
  };
}

export function bigDbContextHttpStatus(upstreamStatus:number){
  return upstreamStatus===402?503:502;
}

export function buildMatchContextPayload(big:any,home:string,away:string,targetDate:string){
  const homeRows=Array.isArray(big?.fixtures?.home)?big.fixtures.home:[];
  const awayRows=Array.isArray(big?.fixtures?.away)?big.fixtures.away:[];
  const h2hRows=Array.isArray(big?.fixtures?.h2h)?big.fixtures.h2h:[];
  const homeCanonical=String(big?.identity?.homeCanonical??home);
  const awayCanonical=String(big?.identity?.awayCanonical??away);
  const h2h=h2hRows
    .map(normalizeMatchContextFixture)
    .filter((x):x is MatchContextFixture=>x!==null)
    .sort((a,b)=>b.matchDate.localeCompare(a.matchDate))
    .slice(0,10);

  return{
    status:'OK',
    action:'CFI_MATCH_CONTEXT',
    readOnly:true,
    strictPrior:true,
    target:{home:homeCanonical,away:awayCanonical,date:targetDate},
    identity:big?.identity??null,
    temporalAudit:big?.temporalAudit??null,
    exactTeam:big?.exactTeam??null,
    home:buildTeamContextSummary(homeCanonical,homeRows),
    away:buildTeamContextSummary(awayCanonical,awayRows),
    h2h:{fixtures:h2hRows.length,recent:h2h},
    provenance:{source:'CFI_BIG_DB_RETRIEVAL',futureEvidenceExcluded:true,sameDateExcluded:true}
  };
}
