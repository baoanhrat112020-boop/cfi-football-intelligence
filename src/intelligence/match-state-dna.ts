export type Market = '3+ HT' | '7+ FT' | 'Other HT' | 'Other FT';

export interface ContextSignal {
  name: string;
  value: number; // normalized -1..1
  confidence: number; // 0..1
  markets: Partial<Record<Market, number>>; // market-specific signed sensitivity
  source: 'history'|'live'|'verified-lineup'|'standings'|'schedule'|'weather'|'referee';
}

export interface MatchStateDNA {
  earlyGoalTempo?: number;
  lateHTTempo?: number;
  lateFTTempo?: number;
  keepsAttackingWhenAhead?: number;
  responseWhenBehind?: number;
  collapseAfterRapidConcessions?: number;
  opponentSurgeAfterAdvantage?: number;
  opponentStrengthAdjustedForm?: number;
  restFatigue?: number;
  motivation?: number;
  styleMatchup?: number;
  goalkeeperDefenceStability?: number;
  startingXIContinuity?: number;
  liveMomentum?: number;
  scorelinePressure?: number;
  refereeVolatility?: number;
  extremeWeatherPitch?: number;
}

const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));

/** Context never replaces the calibrated core model. It may only move it inside a bounded envelope. */
export function applyMatchStateDNA(base: Record<Market, number>, signals: ContextSignal[], randomShock=0.025) {
  const caps: Record<Market, number> = {'3+ HT':0.12,'7+ FT':0.10,'Other HT':0.08,'Other FT':0.10};
  const final = {} as Record<Market, number>;
  const adjustments = {} as Record<Market, number>;
  for (const market of Object.keys(base) as Market[]) {
    let raw=0;
    for (const s of signals) {
      const sensitivity=s.markets[market] ?? 0;
      raw += clamp(s.value,-1,1)*clamp(s.confidence,0,1)*sensitivity;
    }
    const adj=clamp(raw,-caps[market],caps[market]);
    adjustments[market]=adj;
    final[market]=clamp(base[market]+adj,0.001,0.999);
  }
  return {final,adjustments,uncertaintyBand:clamp(randomShock,0.01,0.06)};
}

export function buildSignals(dna: MatchStateDNA): ContextSignal[] {
  const out: ContextSignal[]=[];
  const add=(name:keyof MatchStateDNA, markets:ContextSignal['markets'], source:ContextSignal['source']='history', confidence=.65)=>{
    const v=dna[name]; if(v==null) return; out.push({name:String(name),value:clamp(v,-1,1),confidence,markets,source});
  };
  add('earlyGoalTempo',{'3+ HT':.055,'Other HT':.025});
  add('lateHTTempo',{'3+ HT':.045,'Other HT':.025});
  add('lateFTTempo',{'7+ FT':.035,'Other FT':.025});
  add('keepsAttackingWhenAhead',{'3+ HT':.025,'7+ FT':.045,'Other FT':.035});
  add('responseWhenBehind',{'3+ HT':.025,'7+ FT':.04,'Other FT':.025});
  add('collapseAfterRapidConcessions',{'7+ FT':.055,'Other FT':.055,'Other HT':.02});
  add('opponentSurgeAfterAdvantage',{'7+ FT':.045,'Other FT':.045});
  add('opponentStrengthAdjustedForm',{'3+ HT':.025,'7+ FT':.025,'Other HT':.015,'Other FT':.02});
  add('restFatigue',{'3+ HT':.015,'7+ FT':.025,'Other FT':.02},'schedule',.6);
  add('motivation',{'3+ HT':.015,'7+ FT':.02,'Other HT':.01,'Other FT':.015},'history',.45);
  add('styleMatchup',{'3+ HT':.03,'7+ FT':.035,'Other HT':.02,'Other FT':.025});
  add('goalkeeperDefenceStability',{'3+ HT':.025,'7+ FT':.04,'Other HT':.015,'Other FT':.035},'verified-lineup',.75);
  add('startingXIContinuity',{'3+ HT':.015,'7+ FT':.02,'Other HT':.01,'Other FT':.015},'verified-lineup',.75);
  add('liveMomentum',{'3+ HT':.05,'7+ FT':.055,'Other HT':.035,'Other FT':.045},'live',.75);
  add('scorelinePressure',{'3+ HT':.035,'7+ FT':.05,'Other HT':.025,'Other FT':.04},'live',.8);
  add('refereeVolatility',{'3+ HT':.01,'7+ FT':.015,'Other HT':.008,'Other FT':.012},'referee',.4);
  add('extremeWeatherPitch',{'3+ HT':.012,'7+ FT':.015,'Other HT':.008,'Other FT':.01},'weather',.55);
  return out;
}
