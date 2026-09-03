# Supabase Production Deploy-Gate Canary

This file is a non-executable control-plane canary.

Purpose: trigger the source-controlled Supabase production workflow after merge so the exact pre-merge Independent AI attestation gate, verification job, production deploy path, and native production discovery gate are exercised end to end.

Safety invariants:
- no Edge Function source code changes
- no schema or migration changes
- no prediction/model/threshold changes
- no settlement semantics changes
- no canonical data writes introduced by this file
- merge is allowed only after deterministic CFI Tests and `CFI Independent AI Auditor V1` both PASS on the exact PR diff
