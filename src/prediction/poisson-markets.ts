export const R_HT=0.42;

export function poissonPmf(lambda:number,k:number):number{
  if(!(lambda>=0)||!Number.isInteger(k)||k<0)return 0;
  if(lambda===0)return k===0?1:0;
  let logPmf=-lambda+k*Math.log(lambda);
  for(let i=2;i<=k;i++)logPmf-=Math.log(i);
  return Math.exp(logPmf);
}

export function poissonOver(lambda:number,n:number):number{
  const k=Math.floor(n);
  if(k<0)return 1;
  let cdf=0;
  for(let i=0;i<=k;i++)cdf+=poissonPmf(lambda,i);
  return Math.max(0,1-cdf);
}

export function poissonRange(lambda:number,a:number,b:number):number{
  let sum=0;
  for(let i=a;i<=b;i++)sum+=poissonPmf(lambda,i);
  return sum;
}

const round4=(p:number)=>Number(p.toFixed(4));

function poissonMarket(market:string,label:string,group:string,pick:string,p:number,confidence:string|null,approximate=false){
  const probability=round4(p);
  const row:any={market,label,group,pick,probability,fairOdds:probability>0?Number((1/probability).toFixed(2)):null,decision:'WATCH',confidence};
  if(approximate)row.approximate=true;
  return row;
}

export function poissonExtraMarkets(lambdaHome:number,lambdaAway:number,confidence:string|null=null){
  if(!Number.isFinite(lambdaHome)||!Number.isFinite(lambdaAway)||lambdaHome<0||lambdaAway<0||lambdaHome+lambdaAway<=0)return[];
  const lambdaFt=lambdaHome+lambdaAway;
  const lambdaHt=lambdaFt*R_HT;
  const bttsH1=(1-Math.exp(-lambdaHome*R_HT))*(1-Math.exp(-lambdaAway*R_HT));
  return[
    poissonMarket('O0.5 HT','Over 0.5 H1','ht_detail','OVER',poissonOver(lambdaHt,0.5),confidence),
    poissonMarket('O1.5 HT','Over 1.5 H1','ht_detail','OVER',poissonOver(lambdaHt,1.5),confidence),
    poissonMarket('BTTS H1','BTTS H1','ht_detail','YES',bttsH1,confidence,true),
    poissonMarket('O3.5 FT','Over 3.5','ft_detail','OVER',poissonOver(lambdaFt,3.5),confidence),
    poissonMarket('O4.5 FT','Over 4.5','ft_detail','OVER',poissonOver(lambdaFt,4.5),confidence),
    poissonMarket('O5.5 FT','Over 5.5','ft_detail','OVER',poissonOver(lambdaFt,5.5),confidence),
    poissonMarket('2-3 FT','2-3 bàn','range','RANGE',poissonRange(lambdaFt,2,3),confidence),
    poissonMarket('4-6 FT','4-6 bàn','range','RANGE',poissonRange(lambdaFt,4,6),confidence)
  ];
}
