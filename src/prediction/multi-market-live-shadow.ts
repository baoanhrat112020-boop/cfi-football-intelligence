export type LockedShadowSnapshot<T>={version:'CFI_MULTI_MARKET_LIVE_SHADOW_V1';status:'LOCKED_SHADOW';decisionUse:false;fixtureId:string;targetDate:string;createdAt:string;modelVersion:string;payload:T;fingerprint:string};
function fnv(s:string){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return(h>>>0).toString(16).padStart(8,'0');}
function stable(v:unknown):string{if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return`[${v.map(stable).join(',')}]`;return`{${Object.keys(v as any).sort().map(k=>`${JSON.stringify(k)}:${stable((v as any)[k])}`).join(',')}}`;}
export function lockMultiMarketShadow<T>(args:{fixtureId:string;targetDate:string;createdAt:string;modelVersion:string;payload:T}):LockedShadowSnapshot<T>{
 if(!/^\d{4}-\d{2}-\d{2}/.test(args.createdAt)||!/^\d{4}-\d{2}-\d{2}$/.test(args.targetDate))throw new Error('INVALID_SHADOW_TIMESTAMP');
 const core={version:'CFI_MULTI_MARKET_LIVE_SHADOW_V1' as const,status:'LOCKED_SHADOW' as const,decisionUse:false as const,...args};
 return {...core,fingerprint:fnv(stable(core))};
}
export function verifyLockedShadow<T>(x:LockedShadowSnapshot<T>){const {fingerprint,...core}=x;return fingerprint===fnv(stable(core));}
