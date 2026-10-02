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

BUNDLE="$WORK_DIR/Payload/CFI.app"
test -s "$BUNDLE/Info.plist" || { echo "IPA validation failed: Info.plist missing" >&2; exit 65; }
test -s "$BUNDLE/index.html" || { echo "IPA validation failed: bundled index.html missing" >&2; exit 65; }
test -s "$BUNDLE/CFI" || { echo "IPA validation failed: executable missing" >&2; exit 65; }

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BUNDLE/Info.plist")"
BUILD="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$BUNDLE/Info.plist")"
[[ "$VERSION" == "0.2.2" && "$BUILD" == "8" ]] || {
  echo "IPA validation failed: expected 0.2.2 build 8, got $VERSION build $BUILD" >&2
  exit 65
}

grep -q 'v0.2.2 Beta 1 · Build 8' "$BUNDLE/index.html" || {
  echo "IPA validation failed: bundled UI version does not match 0.2.2 Build 8" >&2
  exit 65
}

for icon in "$BUNDLE"/AppIcon*.png "$BUNDLE"/iTunesArtwork.png; do
  [[ -f "$icon" ]] || { echo "IPA validation failed: icon missing" >&2; exit 65; }
  MAGIC="$(head -c4 "$icon" | od -An -tx1 | tr -d ' \n')"
  [[ "$MAGIC" == "89504e47" ]] || {
    echo "IPA validation failed: icon is not PNG: $icon ($MAGIC)" >&2
    exit 65
  }
done

if grep -RIEq 'SUPABASE_SERVICE_ROLE_KEY|CLOUDFLARE_API_TOKEN|CFI_PC_NODE_KEY|CFI_ACTION_KEY[[:space:]]*=' "$BUNDLE"; then
  echo "IPA validation failed: secret marker found in app bundle" >&2
  exit 65
fi

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
