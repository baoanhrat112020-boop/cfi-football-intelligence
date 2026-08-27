# CFI Workflow Policy

Production-first policy, effective 2026-08-27.

Keep only workflows that directly support one of these outcomes:

1. production tests/regression safety;
2. production deploy;
3. production discovery health;
4. truthful 5-match practical acceptance;
5. production control-plane deployment;
6. append-only prospective settlement when it creates new verified evaluation evidence.

Do not add a recurring workflow for diagnostics, provider probing, research deployment, self-learning, calibration, challenger benchmarking, or unchanged evidence replay. Such work must be manual/one-shot and must prove a distinct measurable outcome before it can become recurring.

The canonical production path is:

real fixture source -> canonical fixture -> existing BigDB -> existing strict-prior predictor -> Champion -> canonical score distribution -> Multi-Market -> ranking/board -> immutable snapshot -> verified result -> append-only settlement.

A production acceptance request with max_matches=5 is PASS only when all five fixtures reach full prediction output. Workflow success, CI success, provider activity, row-count growth, or NO_BET with zero prediction execution are not substitutes.
