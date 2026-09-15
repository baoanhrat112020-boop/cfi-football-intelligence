export type AiScoreWindow={
  targetDate:string;
  timeZone:string;
  nowMs?:number;
};

export type AiScoreDayRow={
  provider:string;
  providerId:string;
  home:string;
  away:string;
  competition:string|null;
  country:string|null;
  kickoff:number|null;
  kickoffIso:string|null;
  kickoffLocal:string|null;
  targetDate:string;
  status:string;
  provenance:string;
};

const AISCORE_TODAY_URL='https://www.aiscore.com/today-matches';

const clean=(value:any)=>String(value??'').trim();

const fold=(value:string)=>clean(value)
  .normalize('NFKD')
  .replace(/\p{M}+/gu,'')
  .toLowerCase()
  .replace(/&/g,' and ')
  .replace(/[^\p{L}\p{N}]+/gu,' ')
  .replace(/\s+/g,' ')
  .trim();

function decodeHtmlText(value:string){
  return value
    .replace(/&nbsp;|&#160;/gi,' ')
    .replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&apos;/gi,"'")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/&[a-z]+;/gi,' ');
}

function textLines(html:string){
  return decodeHtmlText(
    String(html||'')
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi,' ')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi,' ')
      .replace(/<(br|hr)\b[^>]*>/gi,'\n')
      .replace(/<\/(a|div|li|p|span|h1|h2|h3|h4|tr|td|th|section)>/gi,'\n')
      .replace(/<[^>]+>/g,' ')
  )
    .split(/\r?\n/)
    .map(x=>x.replace(/\s+/g,' ').trim())
    .filter(Boolean);
}

function noise(value:string){
  const x=clean(value);
  return !x
    || /^(FT|HT|AET|PEN|H2H|Prediction|Live|Lineups?|Setting|Sign in|Favorites?|VS)$/i.test(x)
    || /^\d+\s*-\s*\d+$/.test(x)
    || /^Total:\d+\s+Matches/i.test(x)
    || /^Football Today/i.test(x);
}

function localDateAt(ms:number,timeZone:string){
  const parts=new Intl.DateTimeFormat('en-CA',{
    timeZone,year:'numeric',month:'2-digit',day:'2-digit'
  }).formatToParts(new Date(ms));
  const g=(t:string)=>parts.find(x=>x.type===t)?.value??'';
  return `${g('year')}-${g('month')}-${g('day')}`;
}

export function parseAiScoreTodayHtml(html:string,window:AiScoreWindow):AiScoreDayRow[]{
  const lines=textLines(html);
  const out:AiScoreDayRow[]=[];
  let competition:string|null=null;

  for(let i=0;i<lines.length;i++){
    const line=lines[i];

    if(
      /:\s+/.test(line)
      && !/^\d{1,2}:\d{2}$/.test(line)
      && !/^https?:/i.test(line)
      && line.length<180
    ){
      competition=line.split(/:\s+/).slice(1).join(': ').trim()||competition;
    }

    if(!/^\d{1,2}:\d{2}$/.test(line))continue;
    const time=line.padStart(5,'0');

    let j=i+1;
    let status='scheduled';

    if(/^FT$/i.test(lines[j]||'')){status='finished';j++;}
    else if(/^(HT|AET|PEN)$/i.test(lines[j]||'')){status='live';j++;}

    while(j<Math.min(lines.length,i+12)&&noise(lines[j]))j++;
    const home=clean(lines[j]);
    if(!home)continue;
    j++;

    while(
      j<Math.min(lines.length,i+14)
      && !/^VS$/i.test(lines[j])
      && !/^\d+\s*-\s*\d+$/.test(lines[j])
    ){
      if(/^FT$/i.test(lines[j]))status='finished';
      j++;
    }

    if(j>=Math.min(lines.length,i+14))continue;
    if(/^\d+\s*-\s*\d+$/.test(lines[j]))status='finished';
    j++;

    while(j<Math.min(lines.length,i+18)&&noise(lines[j]))j++;
    const away=clean(lines[j]);
    if(!away||home===away||/^\d{1,2}:\d{2}$/.test(away))continue;

    out.push({
      provider:'AISCORE',
      providerId:['AISCORE',window.targetDate,time,fold(home),fold(away)].join('-').slice(0,220),
      home,
      away,
      competition:competition||null,
      country:null,
      kickoff:null,
      kickoffIso:null,
      kickoffLocal:time,
      targetDate:window.targetDate,
      status,
      provenance:'AISCORE_TODAY_MATCHES_HTML'
    });
  }

  const seen=new Set<string>();
  return out.filter(row=>{
    const key=`${fold(row.home)}|${fold(row.away)}|${row.targetDate}`;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}

export async function fetchAiScoreToday(
  window:AiScoreWindow,
  fetchFn:typeof fetch=fetch,
  timeoutMs=2500
){
  const localToday=localDateAt(Number(window.nowMs??Date.now()),window.timeZone);

  if(window.targetDate!==localToday){
    return{
      rows:[] as AiScoreDayRow[],
      attempt:{
        stage:'AISCORE',
        provider:'AISCORE',
        ok:true,
        skipped:true,
        rows:0,
        error:'TODAY_ONLY_SOURCE'
      }
    };
  }

  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);

  try{
    const response=await fetchFn(AISCORE_TODAY_URL,{
      headers:{
        accept:'text/html,application/xhtml+xml',
        'user-agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'
      },
      signal:controller.signal
    });

    if(!response.ok){
      return{
        rows:[] as AiScoreDayRow[],
        attempt:{
          stage:'AISCORE',
          provider:'AISCORE',
          ok:false,
          httpStatus:response.status,
          rows:0,
          error:`HTTP_${response.status}`
        }
      };
    }

    const rows=parseAiScoreTodayHtml(await response.text(),window);

    return{
      rows,
      attempt:{
        stage:'AISCORE',
        provider:'AISCORE',
        ok:rows.length>0,
        httpStatus:response.status,
        rows:rows.length,
        error:rows.length?'': 'AISCORE_PARSE_ZERO_ROWS'
      }
    };
  }catch(error:any){
    return{
      rows:[] as AiScoreDayRow[],
      attempt:{
        stage:'AISCORE',
        provider:'AISCORE',
        ok:false,
        httpStatus:null,
        rows:0,
        error:String(error?.message||error)
      }
    };
  }finally{
    clearTimeout(timer);
  }
}
