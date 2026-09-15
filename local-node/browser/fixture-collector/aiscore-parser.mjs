function clean(value){
  return String(value??"")
    .replace(/\u00a0/g," ")
    .trim()
    .replace(/\s+/g," ");
}

function fold(value){
  return clean(value)
    .normalize("NFKD")
    .replace(/\p{M}+/gu,"")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu," ")
    .replace(/\s+/g," ")
    .trim();
}

function getTimeZoneOffsetMs(date,timeZone){
  const parts=new Intl.DateTimeFormat("en-US",{
    timeZone,
    year:"numeric",month:"2-digit",day:"2-digit",
    hour:"2-digit",minute:"2-digit",second:"2-digit",
    hourCycle:"h23"
  }).formatToParts(date);

  const values=Object.fromEntries(
    parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value])
  );

  const representedAsUtc=Date.UTC(
    Number(values.year),
    Number(values.month)-1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );

  return representedAsUtc-date.getTime();
}

function zonedLocalToUtc(localIso,timeZone){
  const m=String(localIso).match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/
  );
  if(!m)return null;

  const [,y,mo,d,h,mi,s]=m;
  const wall=Date.UTC(
    Number(y),Number(mo)-1,Number(d),
    Number(h),Number(mi),Number(s)
  );

  let guess=wall;
  for(let i=0;i<3;i++){
    guess=wall-getTimeZoneOffsetMs(new Date(guess),timeZone);
  }

  return new Date(guess).toISOString();
}

function isNoise(value){
  const x=clean(value);
  return !x
    || /^(FT|HT|AET|PEN|H2H|Prediction|Live|Lineups?|Setting|Sign in|Favorites?|VS)$/i.test(x)
    || /^\d+\s*-\s*\d+$/.test(x)
    || /^Total:\d+\s+Matches/i.test(x)
    || /^Football Today/i.test(x)
    || /^(All|Live|Finished|Schedule)$/i.test(x);
}

export function parseAiScoreBodyText(
  text,
  {
    targetDate,
    timeZone="Asia/Ho_Chi_Minh",
    sourceUrl="https://www.aiscore.com/today-matches"
  }
){
  const lines=String(text??"")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);

  const fixtures=[];
  const rejected=[];
  let competition=null;
  let country=null;

  for(let i=0;i<lines.length;i++){
    const line=lines[i];

    const comp=line.match(/^([^:]{2,60}):\s+(.{2,140})$/);
    if(comp&&!/^\d{1,2}:\d{2}$/.test(line)){
      country=clean(comp[1]);
      competition=clean(comp[2]);
      continue;
    }

    if(!/^\d{1,2}:\d{2}$/.test(line))continue;
    const time=line.padStart(5,"0");

    let j=i+1;
    let status="scheduled";

    if(/^FT$/i.test(lines[j]||"")){status="finished";j++;}
    else if(/^(HT|AET|PEN)$/i.test(lines[j]||"")){status="live";j++;}

    while(j<Math.min(lines.length,i+12)&&isNoise(lines[j]))j++;
    const home=clean(lines[j]);
    if(!home){
      rejected.push({line:i+1,time,reason:"HOME_MISSING"});
      continue;
    }
    j++;

    while(
      j<Math.min(lines.length,i+14)
      && !/^VS$/i.test(lines[j])
      && !/^\d+\s*-\s*\d+$/.test(lines[j])
    ){
      if(/^FT$/i.test(lines[j]))status="finished";
      j++;
    }

    if(j>=Math.min(lines.length,i+14)){
      rejected.push({line:i+1,time,home,reason:"SEPARATOR_MISSING"});
      continue;
    }

    if(/^\d+\s*-\s*\d+$/.test(lines[j]))status="finished";
    j++;

    while(j<Math.min(lines.length,i+18)&&isNoise(lines[j]))j++;
    const away=clean(lines[j]);

    if(!away||home===away||/^\d{1,2}:\d{2}$/.test(away)){
      rejected.push({line:i+1,time,home,away,reason:"AWAY_INVALID"});
      continue;
    }

    const kickoffUtc=zonedLocalToUtc(
      `${targetDate}T${time}:00`,
      timeZone
    );

    if(!kickoffUtc){
      rejected.push({line:i+1,time,home,away,reason:"KICKOFF_INVALID"});
      continue;
    }

    fixtures.push({
      provider:"AISCORE",
      providerId:[
        "AISCORE",
        targetDate,
        time,
        fold(home),
        fold(away)
      ].join("-").slice(0,180),

      home,
      away,
      competition:competition||null,
      country:country||null,

      kickoffIso:kickoffUtc,
      kickoffLocal:time,
      targetDate,
      status,

      sourceUrls:[sourceUrl],
      discoveredAt:new Date().toISOString()
    });
  }

  const seen=new Set();
  const unique=[];

  for(const fixture of fixtures){
    const key=[
      fold(fixture.home),
      fold(fixture.away),
      fixture.targetDate
    ].join("|");

    if(seen.has(key))continue;
    seen.add(key);
    unique.push(fixture);
  }

  return{
    fixtures:unique,
    rejected,
    stats:{
      lines:lines.length,
      parsed:fixtures.length,
      unique:unique.length,
      rejected:rejected.length
    }
  };
}
