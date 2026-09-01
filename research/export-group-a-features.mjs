import fs from 'node:fs/promises';
import { R0_DATASET_CONTRACT } from './run-r0-bulk.mjs';
import { createResearchSupabaseReader, resolveResearchCredentials } from './supabase-read-adapter.mjs';

export const GROUP_A_FEATURE_BUNDLE_VERSION = 'CFI_GROUP_A_FEATURE_BUNDLE_V1';

export async function exportGroupAFeatures({ baseUrl, serviceRoleKey, key, fetchImpl = fetch } = {}) {
  const reader = createResearchSupabaseReader({
    baseUrl,
    serviceRoleKey: serviceRoleKey ?? key,
    fetchImpl,
  });

  const teams = await reader.readAll(
    'teams?select=team_id,canonical_name&order=team_id.asc',
    { critical: true, label: 'teams' },
  );
  const teamNames = new Map(teams.map(t => [t.team_id, t.canonical_name]));

  const strengths = await reader.readAll([
    'cfi_team_strength_feature_store_v1?select=team_id,as_of_date,prior_matches,recent20_matches,ft_gf_mean,ft_ga_mean,ht_gf_mean,ht_ga_mean,recent20_ft_gf_mean,recent20_ft_ga_mean,recent20_ht_gf_mean,recent20_ht_ga_mean,attack_index,defense_index,net_strength,competition_key,segment_v2,confidence,strict_prior,feature_version',
    'strict_prior=eq.true',
    `as_of_date=gte.${R0_DATASET_CONTRACT.warmupStart}`,
    `as_of_date=lt.${R0_DATASET_CONTRACT.prospectiveHoldoutStart}`,
    'order=as_of_date.asc,team_id.asc',
  ].join('&'), { critical: true, label: 'team_strength_feature_store_v1' });

  if (strengths.some(r => r.strict_prior !== true)) {
    throw new Error('GROUP_A_NON_STRICT_PRIOR_STRENGTH_ROW');
  }
  if (strengths.some(r => String(r.as_of_date) >= R0_DATASET_CONTRACT.prospectiveHoldoutStart)) {
    throw new Error('GROUP_A_STRENGTH_HOLDOUT_LEAKAGE');
  }

  const rows = strengths.map(r => ({
    ...r,
    team_name: teamNames.get(r.team_id) ?? null,
  })).filter(r => r.team_name);
  if (!rows.length) throw new Error('CFI_RESEARCH_EMPTY_GROUP_A_STRENGTH_ROWS');

  const competitions = new Set(rows.map(r => r.competition_key).filter(Boolean));
  const segments = new Set(rows.map(r => r.segment_v2).filter(Boolean));

  return {
    version: GROUP_A_FEATURE_BUNDLE_VERSION,
    manifestVersion: R0_DATASET_CONTRACT.manifestVersion,
    baselineCommitSha: R0_DATASET_CONTRACT.baselineCommitSha,
    strictPrior: true,
    sameDayExcluded: true,
    prospectiveHoldoutStart: R0_DATASET_CONTRACT.prospectiveHoldoutStart,
    privilegedResearchRead: true,
    strengthRowCount: rows.length,
    sourceStrengthRowCount: strengths.length,
    droppedUnresolvedTeamCount: strengths.length - rows.length,
    competitionCount: competitions.size,
    segmentCount: segments.size,
    decisionUse: false,
    productionMutationAllowed: false,
    strengths: rows,
  };
}

async function main() {
  const { baseUrl, key } = resolveResearchCredentials(process.env);
  const output = process.argv[2] ?? 'group-a-features.json';
  const bundle = await exportGroupAFeatures({ baseUrl, serviceRoleKey: key });
  await fs.writeFile(output, JSON.stringify(bundle) + '\n');
  process.stdout.write(JSON.stringify({
    output,
    version: bundle.version,
    strengthRowCount: bundle.strengthRowCount,
    competitionCount: bundle.competitionCount,
    segmentCount: bundle.segmentCount,
    strictPrior: bundle.strictPrior,
    decisionUse: bundle.decisionUse,
    productionMutationAllowed: bundle.productionMutationAllowed,
  }) + '\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error(error?.stack ?? String(error));
    process.exitCode = 1;
  });
}
