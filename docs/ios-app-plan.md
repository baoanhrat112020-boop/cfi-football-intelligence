# CFI iOS Shell Plan

## Goal
Add a zero-hosting-cost iOS client shell that packages the existing local CFI frontend into an unsigned IPA while leaving prediction, database, calibration, settlement, and canonical fixture behavior unchanged.

## Scope
- Add a minimal SwiftUI + WKWebView iOS target.
- Package `web/index.html` as an app resource.
- Add a deterministic unsigned IPA packaging script.
- Add a manual/push GitHub Actions workflow on macOS to build and upload `CFI-iOS-unsigned.ipa`.
- Document local build and sideload expectations.

## Invariants
- No change to canonical fixture semantics.
- No change to the four frozen market definitions.
- No production database writes or deployment.
- No secrets or signing certificates stored in the repository.
- The app is a client only; model/database work remains server-side.

## Acceptance criteria
1. `xcodebuild` can build the iPhone target with code signing disabled.
2. The built app opens the bundled CFI frontend without requiring hosted frontend infrastructure.
3. Packaging produces `Payload/CFI.app` inside `CFI-iOS-unsigned.ipa`.
4. GitHub Actions uploads the unsigned IPA as an artifact.
5. Existing Node/CFI tests remain unaffected by the added iOS files.

## Risks
- GitHub-hosted macOS/Xcode availability can change over time.
- An unsigned IPA cannot install directly on stock iOS; a sideload tool must sign/provision it before installation.
- The current frontend is still a static/demo surface until its API calls are wired to the CFI backend.
