export const MARKET_COHERENCE_VERSION='CFI_MARKET_COHERENCE_V1';
export const MARKET_COHERENCE_MAX_TOLERANCE=.01;

type CheckStatus='PASS'|'FAIL'|'UNAVAILABLE'|'NOT_APPLICABLE';

type CoherenceCheck={
  id:string;
  relation:'EQ'|'SUBSET';
  leftMarket:string;
  rightMarket:string;
  leftProbability:number|null;
  rightProbability:number|null;
  tolerance:number;
  delta:number|null;
  status:CheckStatus;
  blockedMarkets:string[];
};

const finite=(v:any)=>
  v===null||v===undefined||v===''?
    null:
    Number.isFinite(Number(v))?Number(v):null;

const round=(v:number,d=6)=>{
  const p=10**d;
  return Math.round(v*p)/p;
};

function marketProbability(body:any,target:string){
  const row=Array.isArray(body?.ranking)
    ?body.ranking.find((x:any)=>String(x?.target??'')===target)
    :null;

  return finite(body?.markets?.[target]?.final ?? row?.probability);
}

function ouProbability(body:any,period:'ht'|'ft',line:string){
  return finite(
    body?.multiMarket?.overUnder?.[period]?.[line]?.over?.fullWin
  );
}

function eqCheck(
  id:string,
  leftMarket:string,
  rightMarket:string,
  left:number|null,
  right:number|null,
  tolerance:number
):CoherenceCheck{
  if(left===null&&right===null){
    return{
      id,relation:'EQ',leftMarket,rightMarket,
      leftProbability:null,rightProbability:null,
      tolerance,delta:null,status:'NOT_APPLICABLE',
      blockedMarkets:[]
    };
  }

  if(left===null||right===null){
    return{
      id,relation:'EQ',leftMarket,rightMarket,
      leftProbability:left,rightProbability:right,
      tolerance,delta:null,status:'UNAVAILABLE',
      blockedMarkets:[leftMarket,rightMarket]
    };
  }

  const delta=Math.abs(left-right);
  const pass=delta<=tolerance+1e-12;

  return{
    id,relation:'EQ',leftMarket,rightMarket,
    leftProbability:left,rightProbability:right,
    tolerance,delta:round(delta),
    status:pass?'PASS':'FAIL',
    blockedMarkets:pass?[]:[leftMarket,rightMarket]
  };
}

function subsetCheck(
  id:string,
  leftMarket:string,
  rightMarket:string,
  left:number|null,
  right:number|null,
  tolerance:number
):CoherenceCheck{
  if(left===null){
    return{
      id,relation:'SUBSET',leftMarket,rightMarket,
      leftProbability:null,rightProbability:right,
      tolerance,delta:null,status:'NOT_APPLICABLE',
      blockedMarkets:[]
    };
  }

  if(right===null){
    return{
      id,relation:'SUBSET',leftMarket,rightMarket,
      leftProbability:left,rightProbability:null,
      tolerance,delta:null,status:'UNAVAILABLE',
      blockedMarkets:[leftMarket]
    };
  }

  const excess=left-right;
  const pass=excess<=tolerance+1e-12;

  return{
    id,relation:'SUBSET',leftMarket,rightMarket,
    leftProbability:left,rightProbability:right,
    tolerance,delta:round(excess),
    status:pass?'PASS':'FAIL',
    blockedMarkets:pass?[]:[leftMarket]
  };
}

export function evaluateMarketCoherence(body:any){
  const requestedTolerance=finite(
    body?.multiMarketIntegration?.crossCoreConsistency?.tolerance ??
    body?.multiMarket?.crossCoreConsistency?.tolerance
  );

  const tolerance=Math.min(
    MARKET_COHERENCE_MAX_TOLERANCE,
    Math.max(0,requestedTolerance??MARKET_COHERENCE_MAX_TOLERANCE)
  );

  const threePlusHt=marketProbability(body,'3+ HT');
  const sevenPlusFt=marketProbability(body,'7+ FT');
  const otherHt=marketProbability(body,'Other HT');
  const otherFt=marketProbability(body,'Other FT');

  const htO25=ouProbability(body,'ht','2.5');
  const ftO45=ouProbability(body,'ft','4.5');
  const ftO65=ouProbability(body,'ft','6.5');

  const checks:CoherenceCheck[]=[
    eqCheck(
      'THREE_PLUS_HT_EQ_HT_O2_5',
      '3+ HT','HT O2.5',
      threePlusHt,htO25,tolerance
    ),
    eqCheck(
      'SEVEN_PLUS_FT_EQ_FT_O6_5',
      '7+ FT','FT O6.5',
      sevenPlusFt,ftO65,tolerance
    ),
    subsetCheck(
      'OTHER_HT_LE_THREE_PLUS_HT',
      'Other HT','3+ HT',
      otherHt,threePlusHt,tolerance
    ),
    subsetCheck(
      'OTHER_FT_LE_FT_O4_5',
      'Other FT','FT O4.5',
      otherFt,ftO45,tolerance
    ),
    subsetCheck(
      'FT_O6_5_LE_FT_O4_5',
      'FT O6.5','FT O4.5',
      ftO65,ftO45,tolerance
    )
  ];

  const failed=checks.filter(x=>x.status==='FAIL');
  const unavailable=checks.filter(x=>x.status==='UNAVAILABLE');

  const blockedMarkets=[
    ...new Set(checks.flatMap(x=>x.blockedMarkets))
  ];

  const status=
    failed.length?'FAIL':
    unavailable.length?'UNAVAILABLE':
    'PASS';

  return{
    version:MARKET_COHERENCE_VERSION,
    status,
    decisionUse:status==='PASS',
    tolerance,
    checks,
    blockedMarkets,
    reasons:[
      ...failed.map(x=>x.id),
      ...unavailable.map(x=>`${x.id}_UNAVAILABLE`)
    ],
    invariants:{
      threePlusHtEqualsHtOver25:true,
      sevenPlusFtEqualsFtOver65:true,
      otherHtSubsetOfThreePlusHt:true,
      otherFtSubsetOfFtOver45:true,
      ftOver65SubsetOfFtOver45:true
    },
    policy:'FAIL_CLOSED_ON_MARKET_LOGIC_VIOLATION'
  } as const;
}