export { CHAMPION_FUSION_VERSION, CHAMPION_FUSION_LINEAGE, buildMultiMarketChampionFusion } from './multi-market-champion-fusion.ts';

export const CHAMPION_FUSION_STATUS='SHADOW_RESEARCH';

/**
 * Compatibility guard only. The sole Champion Fusion implementation lives in
 * multi-market-champion-fusion.ts and is invoked inside buildPrediction so the
 * resulting shadow output is present before immutable snapshotting.
 */
export function buildChampionFusionV1(){
  throw new Error('DEPRECATED_DUPLICATE_FUSION_ENTRYPOINT_USE_BUILD_PREDICTION');
}
