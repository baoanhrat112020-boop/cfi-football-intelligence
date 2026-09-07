const BASE=String(process.env.SUPABASE_URL??process.env.CFI_SUPABASE_URL??'').replace(/\/$/,'');
const KEY=String(process.env.SUPABASE_SERVICE_ROLE_KEY??process.env.CFI_SUPABASE_SERVICE_ROLE_KEY??'');
if(!BASE||!KEY){console.error('CFI RESEARCH REPLAY BLOCKED: SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY missing');process.exit(2);}

function vnYmd(d){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(d),g=t=>p.find(x=>x.type===t)?.value;return`${g('year')}-${g('month')}-${g('day')}`;}
function addDays(ymd,days){const d=new Date(`${ymd}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function arg(name){const x=process.argv.find(v=>v.startsWith(`--${name}=`));return x?x.slice(name.length+3):null;}
const today=vnYmd(new Date()),from=arg('from')??addDays(today,-2),to=arg('to')??addDays(today,-1);
if(from>to||to>=today)throw new Error(`COMPLETED_DAYS_ONLY:${from}:${to}:today=${today}`);

const r=await fetch(`${BASE}/rest/v1/rpc/cfi_research_replay_audit_range`,{method:'POST',signal:AbortSignal.timeout(120000),headers:{apikey:KEY,Authorization:`Bearer ${KEY}`,'content-type':'application/json'},body:JSON.stringify({p_from:from,p_to:to})});
const text=await r.text();let data;try{data=JSON.parse(text);}catch{data={raw:text.slice(0,2000)};}
if(!r.ok){console.error(JSON.stringify({status:'ERROR',httpStatus:r.status,from,to,data},null,2));process.exit(1);}
console.log(JSON.stringify({command:'CFI_RESEARCH_LAST_2_COMPLETED_DAYS',timezone:'Asia/Ho_Chi_Minh',from,to,...data},null,2));