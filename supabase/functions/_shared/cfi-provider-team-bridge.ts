const foldProviderTeamName=(value:string)=>
  String(value??'')
    .normalize('NFKD')
    .replace(/\p{M}+/gu,'')
    .toLowerCase()
    .replace(/&/g,' and ')
    .replace(/[^\p{L}\p{N}]+/gu,' ')
    .trim()
    .replace(/\s+/g,' ');

/**
 * Exact curated provider-name bridge.
 *
 * HARD SAFETY:
 * - exact normalized keys only
 * - zero fuzzy/similarity matching
 * - no token similarity
 * - no entity-scope collapsing
 * - result must still resolve uniquely in Persistent DB
 */
const providerTeamAliases=new Map<string,string>([
  ['Manchester City','Man City'],
  ['Manchester United','Man United'],
  ['Birmingham City','Birmingham'],
  ['AC Milan','Milan'],

  ['FC Bayern Munchen','Bayern Munich'],
  ['Bayern Munchen','Bayern Munich'],

  ['Paris Saint Germain','Paris Saint-Germain'],
  ['PSG','Paris Saint-Germain'],

  ['Deportivo Alaves','Alaves'],
  ['Nottingham Forest',"Nott'm Forest"],
  ['Wolverhampton Wanderers','Wolves'],
  ['Tottenham Hotspur','Tottenham'],
  ['Newcastle United','Newcastle'],
  ['West Ham United','West Ham'],
  ['West Bromwich Albion','West Brom'],

  ['Brighton & Hove Albion','Brighton'],
  ['Brighton and Hove Albion','Brighton'],

  // Canonical registry identities observed in repository manifest.
  ['Leeds United','Leeds'],
  ['Leeds United AFC','Leeds'],

  ['Royal Antwerp','Royal Antwerp FC'],
  ['Antwerp','Royal Antwerp FC'],

  ['Athletico Paranaense','Club Athletico Paranaense'],
  ['Atletico Paranaense','Club Athletico Paranaense'],
  ['Athletico-PR','Club Athletico Paranaense'],

  ['Flora Tallinn','FC Flora Tallinn']
].map(([alias,canonical])=>[
  foldProviderTeamName(alias),
  canonical
]));

export function bridgeProviderTeamName(name:string){
  const raw=String(name??'').trim();
  if(!raw)return raw;

  return providerTeamAliases.get(
    foldProviderTeamName(raw)
  )??raw;
}

export {foldProviderTeamName};