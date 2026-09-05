#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
COMMIT_SHA="$(git -C "$ROOT" rev-parse HEAD)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

command -v hf >/dev/null || { echo 'hf CLI is required'; exit 2; }
hf auth whoami >/dev/null || { echo 'Hugging Face authentication with write permission is required'; exit 3; }

if [[ -n "${HF_SPACE_ID:-}" ]]; then
  SPACE_ID="$HF_SPACE_ID"
else
  NAMESPACE="$(python - <<'PY'
from huggingface_hub import HfApi
identity = HfApi().whoami()
name = identity.get('name') or identity.get('fullname')
if not name:
    raise SystemExit('HF_NAMESPACE_UNRESOLVED')
print(name)
PY
)"
  SPACE_ID="${NAMESPACE}/cfi-football-intelligence-shadow-v1"
fi

git -C "$ROOT" archive HEAD | tar -x -C "$STAGE"
cp "$STAGE/cfi-hf-shadow-node/Dockerfile" "$STAGE/Dockerfile"
cp "$STAGE/cfi-hf-shadow-node/hf-space/README.md" "$STAGE/README.md"

hf repos create "$SPACE_ID" --repo-type space --sdk docker --private --exist-ok
hf spaces variables add "$SPACE_ID" \
  -e CFI_HF_SHADOW_MODE=1 \
  -e CFI_HF_ARTIFACT_ROOT=/home/node/artifacts \
  -e CFI_CODE_COMMIT_SHA="$COMMIT_SHA"
hf upload "$SPACE_ID" "$STAGE" . --repo-type space

echo "DEPLOYED_SPACE=$SPACE_ID"
echo "DEPLOYED_COMMIT_SHA=$COMMIT_SHA"
