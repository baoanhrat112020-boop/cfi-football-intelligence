# CFI Independent AI Normal-Route Canary

Purpose: exercise the trusted CI chain only:

`pull_request -> CFI Tests zero-AI gate -> workflow_run independent AI review -> PR-head commit status`

This canary is documentation-only. It does not change prediction logic, settlement behavior, provider routing, database writes, model promotion, deployment, or production runtime.

Expected safety properties:
- strict-prior unchanged
- settlement integrity unchanged
- shadow isolation unchanged
- Multi-Market calculations unchanged
- no production mutation authority added
- no credential or provider configuration changed
