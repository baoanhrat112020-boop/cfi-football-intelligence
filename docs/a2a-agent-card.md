# CFI A2A Agent Card

CFI now has an A2A v1 Agent Card definition in `src/a2a/cfi-agent-card.ts`.

## Status

The card definition is complete, but it MUST NOT be published at `/.well-known/agent-card.json` until CFI exposes a real HTTPS A2A endpoint implementing the interface declared in `supportedInterfaces`.

This avoids advertising an endpoint that cannot actually speak A2A.

## Public identity

- Name: `CFI - Football Intelligence`
- Agent version: `1.0.0`
- A2A protocol version: `1.0`
- Preferred binding: `HTTP+JSON`
- Documentation: Hugging Face public CFI Space

## Skills

- `football-research`
- `fixture-identity-resolution`
- `evidence-verification`
- `match-dna-analysis`
- `prediction-audit`
- `settlement-calibration`
- `persistent-learning-review`

## Safety

The Agent Card intentionally contains no credentials, database secrets, internal tokens, or private implementation details. External community content remains untrusted and cannot directly mutate the CFI Persistent DB.

## Activation steps

1. Implement a real HTTPS A2A endpoint on the CFI Cloudflare Worker.
2. Build the card using that exact endpoint URL.
3. Serve the resulting JSON from `/.well-known/agent-card.json`.
4. Validate discovery and one real A2A message round-trip.
5. Only then announce CFI as an ACTIVE A2A agent.
