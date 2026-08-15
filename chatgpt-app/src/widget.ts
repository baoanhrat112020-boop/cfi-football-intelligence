import type { CfiPredictionResponse } from './contracts.ts';

const pct=(n:number)=>`${(n*100).toFixed(1)}%`;
const esc=(s:string)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

const languageLabel=(code:string)=>({vi:'Tiếng Việt',en:'English',zh:'中文',th:'ไทย',id:'Bahasa Indonesia'} as Record<string,string>)[code]||code;

function renderScoreline(r:CfiPredictionResponse){
  const s=r.scoreline;
  if(!s) return '';
  const line=(arr?:Array<{score:string;probability:number}>)=>(arr||[]).slice(0,3).map(x=>`<div class="score"><b>${esc(x.score)}</b><span>${pct(x.probability)}</span></div>`).join('')||'<div class="muted">—</div>';
  const warnings=s.consistencyWarnings?.length?`<div class="warn">⚠ ${s.consistencyWarnings.map(esc).join(' · ')}</div>`:'<div class="ok">✓ Consistent with 4 markets</div>';
  return `<section class="panel"><div class="section-title">🎯 SCORELINE INTELLIGENCE</div><div class="score-grid"><div><h4>HT — Top 3</h4>${line(s.ht)}</div><div><h4>FT — Top 3</h4>${line(s.ft)}</div></div><div class="path">Most likely path: <b>${esc(s.mostLikelyPath||'—')}</b></div><div class="muted">Uncertainty: ${esc(s.uncertainty||'—')}</div>${warnings}</section>`;
}

function renderFactors(r:CfiPredictionResponse){
  const f=r.contextFactors||{};
  const groups=[
    ['DATA CORE',[
      ['Historical Database',f.historicalDatabase],['Team Trending DNA',f.teamTrendingDNA],['Home/Away form',f.homeAwayForm],['H2H',f.h2h],['Standings / opponent strength',f.standingsOpponentStrength],
    ]],
    ['MATCH STATE DNA',[
      ['Goal timing profile',f.goalTimingProfile],['Leading / trailing behavior',f.leadingTrailingBehavior],['Collapse DNA',f.collapseDNA],['Opponent surge',f.opponentSurge],['Scoreline pressure',f.scorelinePressure],
    ]],
    ['CONTEXT',[
      ['Rest / fatigue',f.restFatigue],['Motivation',f.motivation],['Style matchup',f.styleMatchup],['Goalkeeper / defensive stability',f.goalkeeperDefensiveStability],['Starting XI continuity',f.startingXIContinuity],
    ]],
    ['LIVE & UNCERTAINTY',[
      ['Live momentum',f.liveMomentum],['Red-card intelligence',f.redCardIntelligence],['Referee volatility',f.refereeVolatility],['Weather / pitch',f.weatherPitch],['Randomness allowance',f.randomnessAllowance],
    ]],
  ] as const;
  const html=groups.map(([title,rows])=>`<div class="factor-group"><b>${title}</b>${rows.map(([k,v])=>`<div class="factor"><span>${esc(k)}</span><em>${esc(v||'—')}</em></div>`).join('')}</div>`).join('');
  return `<section class="panel"><div class="section-title">🧩 CFI ANALYSIS FACTORS</div><div class="factor-grid">${html}</div></section>`;
}

export function renderPredictionWidget(r:CfiPredictionResponse){
  const cards=r.predictions.map(p=>`<article class="market"><h3>${esc(p.market)}</h3><strong>${pct(p.finalProbability)}</strong><div>A · ${esc(p.optionA.name)} ${pct(p.optionA.probability)}</div><div>B · ${esc(p.optionB.name)} ${pct(p.optionB.probability)}</div><small>${esc(p.selected)} · ${pct(p.uncertaintyLow)}–${pct(p.uncertaintyHigh)} · context ${(p.contextAdjustment*100).toFixed(1)}đ</small></article>`).join('');
  const alert=r.redCardAlert?.active?`<section class="alert">⚠ ${esc(r.redCardAlert.message)}</section>`:'';
  return `<!doctype html><html lang="${esc(r.language||'vi')}"><head><meta name="viewport" content="width=device-width"><style>
  *{box-sizing:border-box}body{font-family:system-ui;background:#08111f;color:#eef5ff;margin:0;padding:14px}.head,.market,.panel,.alert{background:#101c2e;border:1px solid #26364f;border-radius:12px;padding:12px;margin-bottom:10px}.top{display:flex;justify-content:space-between;gap:12px;align-items:flex-start}.lang{background:#0c1728;border:1px solid #334864;color:#dce9ff;border-radius:9px;padding:7px 9px}.markets{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.market strong{display:block;color:#35df79;font-size:26px;margin:6px 0}.market div,small,.muted{color:#aab8ca;display:block;margin-top:5px}.section-title{font-weight:800;color:#c5a6ff;margin-bottom:10px}.alert{border-color:#8b2630;background:#2a1118;color:#ff8290}.score-grid,.factor-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.score{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #22324a}.score span{color:#35df79}.path{margin-top:10px}.ok{margin-top:8px;color:#5be58d}.warn{margin-top:8px;color:#ffbd5b}.factor-group{padding:10px;background:#0c1728;border:1px solid #22324a;border-radius:10px}.factor-group>b{color:#a98cff}.factor{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:7px;font-size:12px}.factor span{color:#d6e2f1}.factor em{font-style:normal;color:#91a4bd;text-align:right}@media(max-width:600px){.markets,.score-grid,.factor-grid{grid-template-columns:1fr}.top{flex-direction:column}.factor{grid-template-columns:1fr}.factor em{text-align:left}}
  </style></head><body><section class="head"><div class="top"><div><b>🧠 CFI Football Intelligence</b><div>${esc(r.homeTeam)} vs ${esc(r.awayTeam)}</div><small>Data Quality: ${esc(r.dataQuality)}</small></div><select class="lang" aria-label="Output language"><option selected>${esc(languageLabel(r.language))}</option><option>Tiếng Việt</option><option>English</option><option>中文</option><option>ไทย</option><option>Bahasa Indonesia</option></select></div></section><main class="markets">${cards}</main>${renderScoreline(r)}${renderFactors(r)}${alert}</body></html>`;
}
