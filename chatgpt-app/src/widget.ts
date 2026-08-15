import type { CfiPredictionResponse } from './contracts.ts';

const pct=(n:number)=>`${(n*100).toFixed(1)}%`;
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function renderPredictionWidget(r:CfiPredictionResponse){
  const cards=r.predictions.map(p=>`<article class="market"><h3>${esc(p.market)}</h3><strong>${pct(p.finalProbability)}</strong><div>A · ${esc(p.optionA.name)} ${pct(p.optionA.probability)}</div><div>B · ${esc(p.optionB.name)} ${pct(p.optionB.probability)}</div><small>${esc(p.selected)} · ${pct(p.uncertaintyLow)}–${pct(p.uncertaintyHigh)} · context ${(p.contextAdjustment*100).toFixed(1)}đ</small></article>`).join('');
  const alert=r.redCardAlert?.active?`<section class="alert">⚠ ${esc(r.redCardAlert.message)}</section>`:'';
  return `<!doctype html><html lang="vi"><head><meta name="viewport" content="width=device-width"><style>body{font-family:system-ui;background:#08111f;color:#eef5ff;margin:0;padding:14px}.head,.market,.alert{background:#101c2e;border:1px solid #26364f;border-radius:12px;padding:12px;margin-bottom:10px}.markets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.market strong{display:block;color:#35df79;font-size:26px;margin:6px 0}.market div,small{color:#aab8ca;display:block;margin-top:5px}.alert{border-color:#8b2630;background:#2a1118;color:#ff8290}@media(max-width:600px){.markets{grid-template-columns:1fr}}</style></head><body><section class="head"><b>🧠 CFI Football Intelligence</b><div>${esc(r.homeTeam)} vs ${esc(r.awayTeam)}</div><small>Data Quality: ${esc(r.dataQuality)} · ${esc(r.language)}</small></section><main class="markets">${cards}</main>${alert}</body></html>`;
}
