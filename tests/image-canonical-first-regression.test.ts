import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  fixtureIdentityAudit,
  exactTeamEvidenceAudit,
} from '../cloudflare-worker/src/index-v50.ts';
import { bridgeProviderTeamName } from '../supabase/functions/_shared/cfi-provider-team-bridge.ts';

test('IMAGE_ANALYSIS Gintra/Sturm identity rescue reaches exact-team evidence after canonical verification', () => {
  const rawHome='Gintra Universitetas W';
  const rawAway='Sturm Graz / Stattegg W';
  const canonicalHome=bridgeProviderTeamName(rawHome);
  const canonicalAway=bridgeProviderTeamName(rawAway);

  assert.equal(canonicalHome,'Gintra Universitetas Women');
  assert.equal(canonicalAway,'Sturm Graz/Stattegg Women');

  const big={
    identity:{
      homeFound:true,
      awayFound:true,
      homeTeamId:'team-gintra-women',
      awayTeamId:'team-sturm-stattegg-women',
      homeCanonical:canonicalHome,
      awayCanonical:canonicalAway,
      homeResolution:'PROVIDER_TEAM_BRIDGE',
      awayResolution:'PROVIDER_TEAM_BRIDGE',
    },
    exactTeam:{
      home:{retrieved:20},
      away:{retrieved:20},
      h2h:{retrieved:1},
    },
  };

  const identity=fixtureIdentityAudit(big);
  assert.equal(identity.verified,true);
  assert.equal(identity.source,'SHARED_IDENTITY_BRIDGE');

  const evidence=exactTeamEvidenceAudit(big);
  assert.deepEqual(evidence,{
    verified:true,
    home:20,
    away:20,
    h2h:1,
  });
});

test('ZERO_EXACT gate is structurally ordered after the shared identity audit', () => {
  const source=readFileSync(
    new URL('../cloudflare-worker/src/index-v50.ts',import.meta.url),
    'utf8'
  );
  const identityCall=source.indexOf('const identity=fixtureIdentityAudit(big)');
  const exactCall=source.indexOf('const exact=exactTeamEvidenceAudit(big)');

  assert.ok(identityCall>=0,'canonical identity audit must exist');
  assert.ok(exactCall>identityCall,'ZERO_EXACT evidence audit must run after canonical identity audit');
  assert.match(source,/CANONICAL_IDENTITY_UNRESOLVED/);
  assert.match(source,/CANONICAL_SELF_MATCH_REJECTED/);
});

test('unresolved or self-mapped identity cannot be mislabeled ZERO_EXACT_TEAM_EVIDENCE', () => {
  const unresolved=fixtureIdentityAudit({
    identity:{homeFound:false,awayFound:true,awayTeamId:'away',awayCanonical:'Away'},
    exactTeam:{home:{retrieved:0},away:{retrieved:20},h2h:{retrieved:0}},
  });
  assert.equal(unresolved.verified,false);
  assert.equal(unresolved.reason,'CANONICAL_IDENTITY_UNRESOLVED');

  const selfMatch=fixtureIdentityAudit({
    identity:{
      homeFound:true,
      awayFound:true,
      homeTeamId:'same-team',
      awayTeamId:'same-team',
      homeCanonical:'Same Team',
      awayCanonical:'Same Team',
    },
  });
  assert.equal(selfMatch.verified,false);
  assert.equal(selfMatch.reason,'CANONICAL_SELF_MATCH_REJECTED');
});

test('verified runtime identity is propagated before practical output V3 gates', () => {
  const source=readFileSync(
    new URL('../cloudflare-worker/src/index-v55.ts',import.meta.url),
    'utf8'
  );
  const propagation=source.indexOf('input.fixture_identity=');
  const practical=source.indexOf('attachCfiOutputV3(body,input)');

  assert.ok(propagation>=0,'runtime canonical identity must propagate to request practical gate input');
  assert.ok(practical>propagation,'fixture identity verification must propagate before CFI_OUTPUT_V3');
  assert.match(source,/body\.fixtureIdentityVerified=true/);
  assert.match(source,/source:'SHARED_IDENTITY_BRIDGE'/);
});