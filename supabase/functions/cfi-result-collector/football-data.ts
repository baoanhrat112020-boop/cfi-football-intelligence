export type FootballDataEvent = {
  source: 'FOOTBALL_DATA';
  id: string;
  home: string;
  away: string;
  finished: boolean;
  hh: number|null;
  ha: number|null;
  fh: number|null;
  fa: number|null;
  htEvidence: string;
  detailVerified: boolean;
  seed: string;
  targetDate: string;
};

const EURO_CODES = ['E0','E1','E2','E3','EC','SC0','SC1','SC2','SC3','D1','D2','I1','I2','SP1','SP2','F1','F2','N1','B1','P1','T1','G1'];
const URLS = [
  ...EURO_CODES.map(code => ({ code, url: `https://www.football-data.co.uk/mmz4281/2627/${code}.csv` })),
  { code: 'WORLD', url: 'https://www.football-data.co.uk/new/Latest_Results.csv' },
];

function csvLine(line: string) {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i=0;i<line.length;i++) {
    const ch=line[i];
    if (ch==='"') {
      if (quoted && line[i+1]==='"') { cur+='"'; i++; }
      else quoted=!quoted;
    } else if (ch===',' && !quoted) { out.push(cur); cur=''; }
    else cur+=ch;
  }
  out.push(cur);
  return out;
}

function ymd(v: string) {
  const m=String(v??'').trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let y=Number(m[3]); if (y<100) y+=2000;
  return `${String(y).padStart(4,'0')}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}

function score(v: string|undefined) {
  const n=Number(v); return Number.isInteger(n) && n>=0 ? n : null;
}

async function fetchOne(code: string, url: string): Promise<FootballDataEvent[]> {
  const r=await fetch(url,{headers:{'user-agent':'CFI-Football-Intelligence/result-settlement','accept':'text/csv,*/*'}});
  if (!r.ok) return [];
  const text=await r.text();
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean);
  if (lines.length<2) return [];
  const h=csvLine(lines[0]);
  const idx=(name:string)=>h.indexOf(name);
  const iDate=idx('Date'), iHome=idx('HomeTeam'), iAway=idx('AwayTeam'), iFh=idx('FTHG'), iFa=idx('FTAG'), iHh=idx('HTHG'), iHa=idx('HTAG');
  if ([iDate,iHome,iAway,iFh,iFa,iHh,iHa].some(i=>i<0)) return [];
  const out: FootballDataEvent[]=[];
  for (const line of lines.slice(1)) {
    const c=csvLine(line), date=ymd(c[iDate]);
    if (!date) continue;
    const hh=score(c[iHh]),ha=score(c[iHa]),fh=score(c[iFh]),fa=score(c[iFa]);
    if ([hh,ha,fh,fa].some(x=>x===null)) continue;
    const home=String(c[iHome]??'').trim(), away=String(c[iAway]??'').trim();
    if (!home||!away) continue;
    out.push({source:'FOOTBALL_DATA',id:`${code}:${date}:${home}:${away}`,home,away,finished:true,hh,ha,fh,fa,htEvidence:'FOOTBALL_DATA_CSV_HT_FIELDS',detailVerified:true,seed:url,targetDate:date});
  }
  return out;
}

let cache: Promise<FootballDataEvent[]>|null=null;
async function all() {
  if (!cache) cache=Promise.all(URLS.map(x=>fetchOne(x.code,x.url))).then(parts=>parts.flat());
  return cache;
}

export async function footballDataList(date: string) {
  return (await all()).filter(x=>x.targetDate===date);
}
