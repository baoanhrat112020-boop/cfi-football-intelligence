# CFI iOS Shell

This target is a thin iPhone client for CFI. It embeds the repository's `web/index.html` inside a native SwiftUI/WKWebView shell. Prediction, historical data, calibration, settlement, and canonical fixture behavior remain outside the app.

## Build locally on macOS

Requirements:
- Xcode with the iOS SDK.
- No Apple Developer certificate is required to produce the unsigned artifact.

```bash
xcodebuild \
  -project ios/CFI.xcodeproj \
  -scheme CFI \
  -configuration Release \
  -sdk iphoneos \
  -derivedDataPath .build/cfi-ios \
  CODE_SIGNING_ALLOWED=NO \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  build

bash ios/scripts/package-unsigned-ipa.sh \
  .build/cfi-ios/Build/Products/Release-iphoneos/CFI.app \
  .build/CFI-iOS-unsigned.ipa
```

## GitHub Actions

Run **CFI iOS Unsigned IPA** manually, or push changes that touch `ios/**` or `web/**` on the iOS feature branch/main after merge. The workflow uploads `CFI-iOS-unsigned.ipa` as an artifact.

## Installation model

The produced IPA is intentionally unsigned. Stock iOS will not install it directly. A sideloading tool must sign/provision the app for the target device before installation.

Bundle identifier: `com.cfi.footballintelligence`

Deployment target: iOS 16+

Target device family: iPhone

## Backend boundary

No service-role keys, provider credentials, or signing secrets belong in this target. Backend integration must use a public/client-safe HTTPS endpoint and fail closed when prediction evidence is unavailable.

The current bundled `web/index.html` is still the existing static/demo CFI surface. Wiring real prediction requests to a backend endpoint is a separate change because the repository does not currently expose a confirmed client-safe API contract for this UI.
