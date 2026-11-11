import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCfiAgentCard } from '../src/a2a/cfi-agent-card.ts';

test('CFI Agent Card exposes A2A v1 identity and required skills', () => {
  const card = buildCfiAgentCard({ endpoint: 'https://agent.example.com/a2a' });
  assert.equal(card.name, 'CFI - Football Intelligence');
  assert.equal(card.version, '1.0.0');
  assert.equal(card.supportedInterfaces[0].protocolVersion, '1.0');
  assert.equal(card.supportedInterfaces[0].protocolBinding, 'HTTP+JSON');
  assert.deepEqual(card.defaultInputModes, ['text/plain', 'application/json']);
  assert.deepEqual(card.defaultOutputModes, ['text/plain', 'application/json']);
  const ids = new Set(card.skills.map(s => s.id));
  for (const id of [
    'football-research',
    'fixture-identity-resolution',
    'evidence-verification',
    'match-dna-analysis',
    'prediction-audit',
    'settlement-calibration',
    'persistent-learning-review',
  ]) assert.ok(ids.has(id), `missing skill ${id}`);
});

test('CFI Agent Card refuses non-HTTPS endpoints', () => {
  assert.throws(() => buildCfiAgentCard({ endpoint: 'http://localhost:8787/a2a' }), /must use HTTPS/);
});

test('CFI Agent Card does not expose credentials or internal DB secrets', () => {
  const serialized = JSON.stringify(buildCfiAgentCard({ endpoint: 'https://agent.example.com/a2a' })).toLowerCase();
  for (const forbidden of ['api_key', 'apikey', 'service_role', 'password', 'cfi_db_key', 'supabase_key']) {
    assert.equal(serialized.includes(forbidden), false, `card leaked forbidden marker: ${forbidden}`);
  }
});
