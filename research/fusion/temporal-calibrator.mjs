import { clamp01 } from './contracts.mjs';

export function buildTemporalCalibrator(rows=[],options={}){
  const bins=Math.max(2,Number(options.bins??10));
  const minRows=Math.max(20,Number(options.minRows??100));
  const clean=rows.filter(r=>/^\d{4}-\d{2}-\d{2}$/.test(String(r.targetDate??''))&&Number.isFinite(r.p)&&[0,1].includes(r.y));
  return {
    calibrate(market,rawProbability,{targetDate}={}){
      if(!/^\d{4}-\d{2}-\d{2}$/.test(String(targetDate??''))) throw new Error('CALIBRATION_TARGET_DATE_REQUIRED');
      const prior=clean.filter(r=>r.market===market&&r.targetDate<targetDate);
      if(prior.length<minRows) return clamp01(rawProbability);
      const b=Math.min(bins-1,Math.max(0,Math.floor(clamp01(rawProbability)*bins)));
      const bucket=prior.filter(r=>Math.min(bins-1,Math.max(0,Math.floor(clamp01(r.p)*bins)))===b);
      if(bucket.length<Math.max(20,Math.floor(minRows/bins))) return clamp01(rawProbability);
      return clamp01(bucket.reduce((s,r)=>s+r.y,0)/bucket.length);
    },
    size:clean.length,
  };
}
