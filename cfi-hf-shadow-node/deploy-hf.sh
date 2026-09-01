#!/usr/bin/env bash
set -euo pipefail

SPACE_ID="${HF_SPACE_ID:-CFIAI/cfi-football-intelligence-shadow-v1}"
ROOT="$(git rev-parse --show-toplevel)"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

command -v hf >/dev/null || { echo 'hf CLI is required'; exit 2; }
hf auth whoami >/dev/null || { echo 'Hugging Face authentication with write permission is required'; exit 3; }

git -C "$ROOT" archive HEAD | tar -x -C "$STAGE"
cp "$STAGE/cfi-hf-shadow-node/Dockerfile" "$STAGE/Dockerfile"
cp "$STAGE/cfi-hf-shadow-node/hf-space/README.md" "$STAGE/README.md"

hf repos create "$SPACE_ID" --repo-type space --sdk docker --private --exist-ok
hf spaces variables add "$SPACE_ID" -e CFI_HF_SHADOW_MODE=1 -e CFI_HF_ARTIFACT_ROOT=/artifacts
hf upload "$SPACE_ID" "$STAGE" . --repo-type space

echo "DEPLOYED_SPACE=$SPACE_ID"
