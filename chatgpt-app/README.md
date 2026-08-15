# CFI v4 — Native ChatGPT App

This package is the ChatGPT-native presentation/integration layer for CFI Football Intelligence.

## Product surface
- Four frozen markets: 3+ HT, 7+ FT, Other HT, Other FT.
- Two prediction strategies per market plus calibrated selection/blend.
- Team Trend / Match State DNA / HOME-AWAY / H2H context.
- Live red-card escalation surface.
- Vietnamese-first multilingual presentation.

## Architecture
ChatGPT App UI -> MCP tools -> existing CFI services -> Persistent DB.

The existing standalone dashboard remains available independently. Canonical fixture semantics and prediction logic stay server-side; this package must not duplicate or fork the database.

## Required MCP tools
- `cfi_predict_match`
- `cfi_team_history`
- `cfi_h2h`
- `cfi_db_status`
- `cfi_live_event`

## Safety/data rules
- Strict-prior anti-leakage for pre-match predictions.
- Missing context is unknown, never guessed.
- Context adjustments remain bounded.
- Live events use only observations available at the request timestamp.
- Predictions are probabilistic analytical outputs, not guarantees.

## ChatGPT installation gate
The app can only become visible inside ChatGPT after an MCP endpoint is hosted/reachable and the app is connected/installed in ChatGPT developer/app configuration. Repository code alone cannot perform that account-level installation step.
