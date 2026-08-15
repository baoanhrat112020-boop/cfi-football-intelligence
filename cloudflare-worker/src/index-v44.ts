import base from './index-v43';

type Env = {
  AI?: Ai;
  CFI_DB_BASE_URL?: string;
  CFI_DB_KEY?: string;
};

type Scope = 'HOME' | 'AWAY' | 'H2H';

type Fixture = {
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  ht?: { home: number; away: number } | null;
  ft?: { home: number; away: number } | null;
  sourceType?: string;
  sourceLabel?: string;
};

function asDataUri(file: File, bytes: ArrayBuffer) {
  let bin = '';
  const u8 = new Uint8Array(bytes);
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) bin += String.fromCharCode(...u8.subarray(i, i + chunk));
  return `data:${file.type || 'image/jpeg'};base64,${btoa(bin)}`;
}

function parseJsonAnswer(answer: string): any {
  const fenced = answer.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const raw = (fenced || answer).trim();
  try { return JSON.parse(raw); } catch {}
  const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(raw.slice(a, b + 1));
  throw new Error('VISION_JSON_PARSE_FAILED');
}

function validPair(x: any) {
  return x == null || (Number.isInteger(x.home) && Number.isInteger(x.away) && x.home >= 0 && x.away >= 0);
}

function cleanFixtures(value: any, scope: Scope): Fixture[] {
  const rows = Array.isArray(value?.fixtures) ? value.fixtures : [];
  const out: Fixture[] = [];
  for (const r of rows) {
    if (typeof r?.matchDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r.matchDate)) continue;
    if (typeof r?.homeTeam !== 'string' || typeof r?.awayTeam !== 'string') continue;
    if (!validPair(r.ht) || !validPair(r.ft)) continue;
    if (r.ht && r.ft && (r.ht.home > r.ft.home || r.ht.away > r.ft.away)) continue;
    out.push({
      matchDate: r.matchDate,
      homeTeam: r.homeTeam.trim(),
      awayTeam: r.awayTeam.trim(),
      ht: r.ht ?? null,
      ft: r.ft ?? null,
      sourceType: 'SCREENSHOT',
      sourceLabel: `user-upload-${scope.toLowerCase()}`,
    });
  }
  return out;
}

async function extractImage(env: Env, file: File, scope: Scope, home: string, away: string) {
  if (!env.AI) return { status: 'AI_BINDING_REQUIRED', fixtures: [] };
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength > 6 * 1024 * 1024) return { status: 'FILE_TOO_LARGE', fixtures: [], name: file.name };
  const image = asDataUri(file, bytes);
  const question = `You are the CFI football screenshot extraction engine. Scope=${scope}. Target HOME=${home || 'unknown'}, AWAY=${away || 'unknown'}.
Read ONLY fixture rows visibly supported by this screenshot. Return strict JSON only, no prose, shape:
{"fixtures":[{"matchDate":"YYYY-MM-DD","homeTeam":"exact visible name","awayTeam":"exact visible name","ht":{"home":0,"away":0}|null,"ft":{"home":0,"away":0}|null}]}
Rules: never invent a date or score; missing HT/FT must be null; do not infer 0 from blanks; ignore aggregate trend/statistic rows that are not identifiable fixtures; preserve visible team names; include reverse-venue H2H if exact identities match. If no safe fixture exists return {"fixtures":[]}.`;
  const response: any = await env.AI.run('@cf/moondream/moondream3.1-9B-A2B', {
    task: 'query', image, question, reasoning: false, stream: false, temperature: 0, max_tokens: 3500
  } as any);
  const answer = String(response?.answer ?? response?.result ?? '');
  const parsed = parseJsonAnswer(answer);
  return { status: 'OK', fixtures: cleanFixtures(parsed, scope), name: file.name };
}

async function mergeFixtures(env: Env, fixtures: Fixture[]) {
  if (!fixtures.length) return { status: 'NO_SAFE_FIXTURES', counters: { rows: 0 } };
  if (!env.CFI_DB_BASE_URL) return { status: 'CONFIG_REQUIRED', message: 'CFI_DB_BASE_URL missing' };
  const mergeUrl = env.CFI_DB_BASE_URL.replace(/\/cfi-db\/?$/, '/cfi-screenshot-merge');
  const headers: Record<string,string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (env.CFI_DB_KEY) headers['x-cfi-key'] = env.CFI_DB_KEY;
  const res = await fetch(mergeUrl, { method: 'POST', headers, body: JSON.stringify({ fixtures }) });
  const text = await res.text();
  let body: any = text; try { body = JSON.parse(text); } catch {}
  return { status: res.ok ? 'OK' : 'MERGE_HTTP_ERROR', httpStatus: res.status, body };
}

const IMAGE_UI = `<div class="card" id="image-intake" style="margin-top:14px"><div class="title">ẢNH USER → PERSISTENT DB → DỰ ĐOÁN</div><div class="small" style="margin-bottom:12px">CFI Vision đọc ảnh HOME / AWAY / H2H, canonicalize, đối chiếu DB và chỉ merge fixture an toàn. Conflict được quarantine; ảnh không đủ bằng chứng sẽ không tạo dữ liệu.</div><div class="uploadgrid"><label class="uploadbox"><b>🏠 Ảnh HOME</b><span>Lịch sử đội nhà</span><input id="imgHome" type="file" accept="image/*" multiple></label><label class="uploadbox"><b>✈️ Ảnh AWAY</b><span>Lịch sử đội khách</span><input id="imgAway" type="file" accept="image/*" multiple></label><label class="uploadbox"><b>↔️ Ảnh H2H</b><span>Đối đầu hai đội</span><input id="imgH2H" type="file" accept="image/*" multiple></label></div><div class="actions"><button class="btn go" id="imgRun" onclick="runImageIntake()">🧠 ĐỌC ẢNH & HỢP NHẤT DATABASE</button></div><div class="small" id="imgResult" style="margin-top:10px">Chưa có ảnh.</div></div>`;

const EXTRA_CSS = `<style>.uploadgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.uploadbox{display:grid;gap:7px;background:#111d30;border:1px dashed #405578;border-radius:9px;padding:15px;cursor:pointer}.uploadbox b{color:#dfe9ff}.uploadbox span{color:#8ea0b8;font-size:12px}.uploadbox input{max-width:100%;color:#aab8cc}.analysisgroups{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.ag{padding:9px;background:#0d192a;border:1px solid #263957;border-radius:7px}.ag b{color:#b99cff}@media(max-width:850px){.uploadgrid,.analysisgroups{grid-template-columns:1fr}}</style>`;

const IMAGE_SCRIPT = `<script>
async function runImageIntake(){
 const h=document.getElementById('home').value.trim(),a=document.getElementById('away').value.trim();
 if(!h||!a){document.getElementById('imgResult').textContent='Nhập HOME và AWAY trước khi đọc ảnh.';return}
 const fd=new FormData(); fd.append('home',h); fd.append('away',a);
 [['HOME','imgHome'],['AWAY','imgAway'],['H2H','imgH2H']].forEach(([scope,id])=>{for(const f of document.getElementById(id).files){fd.append(scope,f,f.name)}});
 if(![...fd.keys()].some(k=>['HOME','AWAY','H2H'].includes(k))){document.getElementById('imgResult').textContent='Chọn ít nhất 1 ảnh HOME, AWAY hoặc H2H.';return}
 const btn=document.getElementById('imgRun');btn.disabled=true;document.getElementById('imgResult').textContent='CFI Vision đang đọc ảnh, đối chiếu và hợp nhất database…';
 try{const r=await fetch('/api/image-intake',{method:'POST',body:fd});const d=await r.json();
   const ext=d.extracted||{}; const c=d.merge?.body?.counters||d.merge?.body||d.merge?.counters||{};
   document.getElementById('imgResult').innerHTML='<b>Extraction:</b> HOME '+(ext.HOME||0)+' · AWAY '+(ext.AWAY||0)+' · H2H '+(ext.H2H||0)+'<br><b>Merge:</b> '+(d.merge?.status||'—')+' · NEW '+(c.NEW??'—')+' · DUP '+(c.DUPLICATE_COMPATIBLE??'—')+' · COMPLEMENTARY '+(c.COMPLEMENTARY??'—')+' · CONFLICT '+(c.CONFLICT??'—')+' · REJECTED '+(c.REJECTED??'—');
   if(d.merge?.status==='OK'){setTimeout(()=>{if(typeof predict==='function')predict()},400)}
 }catch(e){document.getElementById('imgResult').textContent='Image pipeline error: '+e.message}finally{btn.disabled=false}
}
</script>`;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/api/image-intake' && request.method === 'POST') {
      try {
        const form = await request.formData();
        const home = String(form.get('home') || '').trim();
        const away = String(form.get('away') || '').trim();
        const all: Fixture[] = [];
        const extracted: Record<Scope, number> = { HOME: 0, AWAY: 0, H2H: 0 };
        const details: any[] = [];
        for (const scope of ['HOME','AWAY','H2H'] as Scope[]) {
          const files = form.getAll(scope).filter((x): x is File => x instanceof File).slice(0, 8);
          for (const file of files) {
            const result: any = await extractImage(env, file, scope, home, away);
            const fixtures = result.fixtures || [];
            extracted[scope] += fixtures.length;
            all.push(...fixtures);
            details.push({ scope, file: file.name, status: result.status, fixtures: fixtures.length });
          }
        }
        const unique = Array.from(new Map(all.map(f => [`${f.matchDate}|${f.homeTeam}|${f.awayTeam}`, f])).values());
        const merge = await mergeFixtures(env, unique);
        return Response.json({ status: 'OK', target: { home, away }, extracted, canonicalCandidates: unique.length, details, merge });
      } catch (e: any) {
        return Response.json({ status: 'ERROR', error: String(e?.message || e) }, { status: 500 });
      }
    }

    const res = await base.fetch(request, env, ctx);
    if (url.pathname !== '/' || !String(res.headers.get('content-type')).includes('text/html')) return res;
    let html = await res.text();
    html = html.replaceAll('CFI v4.3', 'CFI v4.4');
    html = html.replace('</head>', EXTRA_CSS + '</head>');
    html = html.replace('<div class="markets">', IMAGE_UI + '<div class="markets">');
    html = html.replace('</body>', IMAGE_SCRIPT + '</body>');
    return new Response(html, { status: res.status, headers: res.headers });
  }
} satisfies ExportedHandler<Env>;
