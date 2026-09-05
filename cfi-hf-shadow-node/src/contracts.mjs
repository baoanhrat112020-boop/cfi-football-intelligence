export const HF_SHADOW_VERSION = 'CFI_HF_SHADOW_NODE_V1.0.0';
export const HF_SHADOW_CONTRACT = 'CFI_HF_SHADOW_RUNTIME_V1';
export const HF_INPUT_CONTRACT = 'CFI_HF_PINNED_ARTIFACT_V1';
export const HF_SHADOW_PREDICTION_CONTRACT = 'CFI_HF_SHADOW_PREDICTION_V1';

export const SIX_PRIMARY_TARGETS = Object.freeze([
  '3+ HT',
  '7+ FT',
  'Other HT',
  'Other FT',
  'Top-1 HT',
  'Top-1 FT',
]);

export const SHADOW_FLAGS = Object.freeze({
  research_only: true,
  shadow_only: true,
  production_mutation: false,
  decision_use: false,
  production_eligible: false,
});

export function shadowStamp(extra = {}) {
  return { ...SHADOW_FLAGS, ...extra };
}

export function buildInfo(env = process.env) {
  return {
    runtime_version: HF_SHADOW_VERSION,
    runtime_contract: HF_SHADOW_CONTRACT,
    code_commit_sha: String(env.CFI_CODE_COMMIT_SHA ?? env.SOURCE_COMMIT ?? env.GITHUB_SHA ?? 'UNKNOWN'),
    model_challenger_version: String(env.CFI_HF_MODEL_VERSION ?? 'CURRENT_REPO_RESEARCH_STACK'),
    node: process.version,
  };
}
