#!/bin/bash
set -euo pipefail

APP_PATH="${1:-}"
OUTPUT_PATH="${2:-CFI-iOS-unsigned.ipa}"

if [[ -z "$APP_PATH" ]]; then
  echo "usage: $0 <path-to-CFI.app> [output.ipa]" >&2
  exit 64
fi

if [[ ! -d "$APP_PATH" ]]; then
  echo "CFI app bundle not found: $APP_PATH" >&2
  exit 66
fi

mkdir -p "$(dirname "$OUTPUT_PATH")"
OUTPUT_DIR="$(cd "$(dirname "$OUTPUT_PATH")" && pwd)"
OUTPUT_PATH="$OUTPUT_DIR/$(basename "$OUTPUT_PATH")"

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

mkdir -p "$WORK_DIR/Payload"
/usr/bin/ditto "$APP_PATH" "$WORK_DIR/Payload/CFI.app"

# The CI build already disables signing. Remove any accidentally copied
# provisioning/signature artifacts so the output is explicitly unsigned.
rm -rf "$WORK_DIR/Payload/CFI.app/_CodeSignature"
rm -f "$WORK_DIR/Payload/CFI.app/embedded.mobileprovision"

rm -f "$OUTPUT_PATH"
(
  cd "$WORK_DIR"
  /usr/bin/zip -qry "$OUTPUT_PATH" Payload
)

if ! /usr/bin/unzip -l "$OUTPUT_PATH" | /usr/bin/grep -q "Payload/CFI.app/"; then
  echo "IPA validation failed: Payload/CFI.app is missing" >&2
  exit 65
fi

echo "Created unsigned IPA: $OUTPUT_PATH"
