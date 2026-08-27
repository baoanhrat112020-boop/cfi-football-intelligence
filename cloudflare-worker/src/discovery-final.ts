export function discoveryFinal(body:any){
  const counts=body?.counts??{};
  if(Number(counts.predictionSuccess)!==0)return body?.final;
  if(Number(counts.fixturesDiscovered)===0)return 'DISCOVERY_UNAVAILABLE';
  if(Number(counts.predictionAttempts)===0)return 'PREDICTION_NOT_EXECUTED';
  if(Number(counts.insufficient)===Number(counts.predictionAttempts))return 'INSUFFICIENT_EVIDENCE';
  return 'PREDICTION_NOT_EXECUTED';
}
