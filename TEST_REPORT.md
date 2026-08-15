# Automated Test Report

The credential-free suite validates:

- manifest schema, unique IDs, multiple countries/leagues, and five seasons;
- the frozen 380-row E0 contract (`380 NEW`, then `380 DUPLICATE_COMPATIBLE`);
- malformed, blank-score, partial-score, and impossible-score rejection;
- duplicate import idempotency;
- partial source failure isolation and retry checkpoint output.

Run with `npm test`. Production deployment verification remains a post-merge operation because repository tests never contain production credentials.
