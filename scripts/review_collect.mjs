import { writeFileSync, mkdirSync } from 'node:fs';

const SB = process.env.SB_URL || 'https://zbwkowqluwuvsnajkuvc.supabase.co';
const KEY = process.env.SB_KEY || '';
const GHT = process.env.GH_TOKEN || '';
const REPO = process.env.REPO || 'baoanhrat112020-boop/cfi-football-intelligence';
const W = 'https://cfi-football-intelligence.baoanhrat112020.workers.dev';
const OUT = process.env.OUT_DIR || '/tmp/review';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
const DAY = 86400000;
const now = Date.now();

const jget = async (url, headers = {}, ms = 20000) => {
  try {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
    const t0 = Date.now();
    return { ok: r.ok, status: r.status, data: r.ok ? await r.json() : null, ms: Date.now() - t0 };
  } catch (e) { return { ok: false, status: 0, data: null, err: String(e.message || e) }; }
};
const sb = (path) => jget(`${SB}/rest/v1/${path}`, H);
const count = async (path) => {
  try {
    const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' }, signal: AbortSignal.timeout(20000) });
    const m = /\/(\d+)$/.exec(r.headers.get('content-range') || '');
    return m ? Number(m[1]) : null;
  } catch { return null; }
};
const pct = (v) => (v == null ? '—' : (v * 100).toFixed(1) + '%');
const r4 = (v) => (v == null ? null : Math.round(v * 1e4) / 1e4);
const alerts = [];
const alert = (code, msg) => alerts.push({ code, msg });

const health = {};
const snap = await sb('suggest_snapshot?select=snapshot_date,generated_at,match_count&order=snapshot_date.desc&limit=1');
if (snap.ok && snap.data?.[0]) {
  const ageH = (now - Date.parse(snap.data[0].generated_at)) / 3600000;
  health.snapshot = { age_h: r4(ageH), matches: snap.data[0].match_count };
  if (ageH > 3) alert('SNAPSHOT_STALE', `snapshot ${ageH.toFixed(1)}h cũ`);
} else alert('SNAPSHOT_MISSING', 'không đọc được suggest_snapshot');

health.unsettled_old = await count(`suggest_pick_log?select=fixture_id&settled_at=is.null&kickoff_at=lt.${new Date(now - 8 * 3600000).toISOString()}`);
if (health.unsettled_old > 50) alert('SETTLE_LAG', `${health.unsettled_old} kèo quá 8h chưa chấm`);

const pl = await sb('parlay_log?select=created_at&order=created_at.desc&limit=1');
health.parlay_last_h = pl.ok && pl.data?.[0] ? r4((now - Date.parse(pl.data[0].created_at)) / 3600000) : null;
if (health.parlay_last_h == null || health.parlay_last_h > 30) alert('PARLAY_LOG_STALE', `parlay_log không có dòng mới ${health.parlay_last_h ?? '?'}h`);
health.parlay_unsettled = await count('parlay_log?select=pkey&settled_at=is.null');

const od = await sb('match_odds?select=last_seen_at&order=last_seen_at.desc&limit=1');
health.odds_age_h = od.ok && od.data?.[0] ? r4((now - Date.parse(od.data[0].last_seen_at)) / 3600000) : null;
if (health.odds_age_h == null || health.odds_age_h > 14) alert('ODDS_STALE', `odds mới nhất ${health.odds_age_h ?? '?'}h trước`);

const wk = {};
for (const [k, p] of [['health', '/health'], ['suggest', '/api/suggest?minutes=1440'], ['parlays', '/api/suggest-parlays?mode=suggest'], ['mvp', '/api/mvp']]) {
  const t0 = Date.now(); const r = await jget(W + p, {}, 30000); r.ms = Date.now() - t0;
  wk[k] = { ok: r.ok, status: r.status, ms: r.ms };
  if (!r.ok) alert('WORKER_' + k.toUpperCase(), `${p} → HTTP ${r.status}`);
  else if (r.ms > 8000) alert('WORKER_SLOW', `${p} ${r.ms}ms`);
  if (k === 'mvp' && r.ok) wk.mvp_rows = r.data?.markets?.length ?? 0;
  if (k === 'parlays' && r.ok) wk.parlay_cards = r.data?.parlays?.length ?? 0;
  if (k === 'mvp' && r.ok) wk.mvp_top = (r.data?.markets || []).slice(0, 5);
}
if (wk.mvp_rows === 0) alert('MVP_EMPTY', 'MVP chưa có market đủ mẫu');

const ci = {};
if (GHT) {
  const since = new Date(now - 4 * DAY).toISOString().slice(0, 10);
  const r = await jget(`https://api.github.com/repos/${REPO}/actions/runs?status=failure&per_page=50&created=>=${since}`, { Authorization: `Bearer ${GHT}`, 'User-Agent': 'cfi-review' });
  for (const x of r.data?.workflow_runs || []) ci[x.name] = (ci[x.name] || 0) + 1;
  for (const [n, c] of Object.entries(ci)) alert('CI_FAIL', `${n}: ${c} lần fail`);
}

const since = new Date(now - 36 * DAY).toISOString();
const pk = await sb(`suggest_pick_log?select=kickoff_at,p_over05_ht,p_over1_ht,hit_o05_ht,hit_o1_ht,top_market_prob,hit_top_market&settled_at=not.is.null&void_reason=is.null&kickoff_at=gte.${since}&limit=30000`);
const rows = (pk.data || []).map((x) => ({ ...x, t: Date.parse(x.kickoff_at) }));
const win = (a, b) => {
  const r = rows.filter((x) => x.t >= now - b * DAY && x.t < now - a * DAY);
  const mean = (f) => { const v = r.map(f).filter((z) => typeof z === 'number'); return v.length ? v.reduce((s, z) => s + z, 0) / v.length : null; };
  const br = (p, h) => mean((x) => (typeof x[p] === 'number' && typeof x[h] === 'boolean' ? (x[p] - (x[h] ? 1 : 0)) ** 2 : null));
  return { n: r.length, top_hit: r4(mean((x) => (typeof x.hit_top_market === 'boolean' ? +x.hit_top_market : null))), top_p: r4(mean((x) => x.top_market_prob)), b05: r4(br('p_over05_ht', 'hit_o05_ht')), b1: r4(br('p_over1_ht', 'hit_o1_ht')) };
};
const A = win(0, 4), B = win(4, 8), C = win(8, 12);
if (A.n >= 30 && B.n >= 30) {
  if (A.top_hit != null && B.top_hit != null && A.top_hit < B.top_hit - 0.05) alert('ACC_DROP', `tỉ lệ trúng kèo chính ${pct(A.top_hit)} < ${pct(B.top_hit)}`);
  if (A.b05 != null && B.b05 != null && A.b05 > B.b05 * 1.03) alert('BRIER_UP', `Brier O0.5HT ${A.b05} > ${B.b05}`);
}

const cand = [];
const fit = (pk_, hk) => {
  const tr = rows.filter((x) => x.t < now - 4 * DAY && typeof x[pk_] === 'number' && typeof x[hk] === 'boolean');
  const te = rows.filter((x) => x.t >= now - 4 * DAY && typeof x[pk_] === 'number' && typeof x[hk] === 'boolean');
  if (tr.length < 200 || te.length < 40) return;
  const bins = Array.from({ length: 10 }, () => ({ n: 0, h: 0 }));
  const bi = (p) => Math.min(9, Math.floor(p * 10));
  for (const x of tr) { const b = bins[bi(x[pk_])]; b.n++; b.h += x[hk] ? 1 : 0; }
  const cal = (p) => { const b = bins[bi(p)]; return b.n >= 15 ? b.h / b.n : p; };
  const bias = tr.reduce((s, x) => s + ((x[hk] ? 1 : 0) - x[pk_]), 0) / tr.length;
  const mse = (f) => te.reduce((s, x) => s + (f(x[pk_]) - (x[hk] ? 1 : 0)) ** 2, 0) / te.length;
  const raw = mse((p) => p), c1 = mse(cal), c2 = mse((p) => Math.min(0.99, Math.max(0.01, p + bias)));
  cand.push({ market: pk_, n_train: tr.length, n_test: te.length, raw: r4(raw), bin_cal_gain_pct: r4(((raw - c1) / raw) * 100), bias_shift: r4(bias), bias_gain_pct: r4(((raw - c2) / raw) * 100) });
};
fit('p_over05_ht', 'hit_o05_ht'); fit('p_over1_ht', 'hit_o1_ht');

const ps = {};
for (const [g, n] of [['std', 'std'], ['s', 'single'], ['x', 'extreme']]) {
  const r = await jget(`${W}/api/parlay-stats?days=30&group=${g}`, {}, 40000);
  if (r.ok) ps[n] = { settled: (r.data.totals || []).reduce((s, x) => s + x.n, 0), pending: r.data.pending, hit: r4((r.data.totals || []).reduce((s, x) => s + (x.wins || 0), 0) / Math.max(1, (r.data.totals || []).reduce((s, x) => s + x.n, 0))) };
}

const d = new Date(now).toISOString().slice(0, 10);
const verdict = A.top_hit != null && B.top_hit != null ? (A.top_hit >= B.top_hit ? 'tốt hơn' : 'kém hơn') : 'chưa đủ mẫu';
const md = [
  `# CFI review ${d}`,
  `ALERTS (${alerts.length}): ${alerts.length ? alerts.map((a) => `${a.code}[${a.msg}]`).join('; ') : 'không'}`,
  `HEALTH: snapshot ${health.snapshot ? health.snapshot.age_h + 'h/' + health.snapshot.matches + ' trận' : '?'}; chưa chấm>8h ${health.unsettled_old}; parlay_log mới nhất ${health.parlay_last_h}h, chờ chấm ${health.parlay_unsettled}; odds ${health.odds_age_h}h`,
  `WORKER: ${Object.entries(wk).filter(([, v]) => v && v.ms != null).map(([k, v]) => `${k} ${v.status}/${v.ms}ms`).join(', ')}; thẻ xiên ${wk.parlay_cards ?? '?'}; MVP ${wk.mvp_rows ?? '?'} dòng`,
  `CI fail 4 ngày: ${Object.keys(ci).length ? JSON.stringify(ci) : 'không'}`,
  `ĐỘ CHÍNH XÁC (4 ngày, trước đó, trước nữa): n ${A.n}/${B.n}/${C.n}; trúng kèo chính ${pct(A.top_hit)}/${pct(B.top_hit)}/${pct(C.top_hit)}; Brier O0.5HT ${A.b05}/${B.b05}/${C.b05}; O1HT ${A.b1}/${B.b1}/${C.b1} → 4 ngày gần nhất ${verdict}`,
  `ỨNG VIÊN HIỆU CHỈNH (train 32 ngày → test 4 ngày): ${cand.length ? cand.map((c) => `${c.market}: bin ${c.bin_cal_gain_pct}%, shift ${c.bias_shift} → ${c.bias_gain_pct}% (n ${c.n_train}/${c.n_test})`).join(' | ') : 'chưa đủ mẫu'}`,
  `XIÊN 30 ngày: ${Object.entries(ps).map(([k, v]) => `${k} đã chấm ${v.settled} trúng ${pct(v.hit)} chờ ${v.pending}`).join('; ')}`,
  `MVP top: ${(wk.mvp_top || []).map((m) => `${m.market}${m.line ?? ''}(${m.src}) ${pct(m.hit)} n${m.n}`).join('; ') || '—'}`,
].join('\n') + '\n';

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/latest.md`, md);
writeFileSync(`${OUT}/latest.json`, JSON.stringify({ date: d, alerts, health, worker: wk, ci, acc: { A, B, C }, cand, parlay: ps }));
writeFileSync(`${OUT}/line.json`, JSON.stringify({ d, alerts: alerts.map((a) => a.code), A, B, cand: cand.map((c) => ({ m: c.market, g: c.bin_cal_gain_pct })) }) + '\n');
console.log(md);
