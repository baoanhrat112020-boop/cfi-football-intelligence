import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  authorizeCfiDbRequest,
  authorizePcNodeAction
} from '../supabase/functions/_shared/cfi-auth.ts';

test('cfi-db rejects missing and wrong x-cfi-key', ()=>{
  assert.deepEqual(
    authorizeCfiDbRequest(null,null),
    {ok:false,status:500,error:'SERVER_KEY_NOT_CONFIGURED'}
  );
  assert.deepEqual(
    authorizeCfiDbRequest(null,'secret'),
    {ok:false,status:401,error:'UNAUTHORIZED'}
  );
  assert.deepEqual(
    authorizeCfiDbRequest('wrong','secret'),
    {ok:false,status:401,error:'UNAUTHORIZED'}
  );
  assert.deepEqual(
    authorizeCfiDbRequest('secret','secret'),
    {ok:true}
  );
});

test('pc-node fixture discovery requires node secret, bridge actions require bridge secret', ()=>{
  assert.deepEqual(
    authorizePcNodeAction('FIXTURE_DISCOVERY_BATCH',null,'node-secret',null,'bridge-secret'),
    {ok:false,status:401,error:'UNAUTHORIZED'}
  );
  assert.deepEqual(
    authorizePcNodeAction('FIXTURE_DISCOVERY_BATCH','node-secret','node-secret',null,'bridge-secret'),
    {ok:true}
  );
  assert.deepEqual(
    authorizePcNodeAction('URGENT_FIXTURE_QUEUE','node-secret','node-secret',null,'bridge-secret'),
    {ok:false,status:401,error:'UNAUTHORIZED_BRIDGE'}
  );
  assert.deepEqual(
    authorizePcNodeAction('URGENT_FIXTURE_QUEUE',null,'node-secret','bridge-secret','bridge-secret'),
    {ok:true}
  );
});

test('cfi-db authenticates before service-role client and fixtures-day route', async()=>{
  const source=await readFile(new URL('../supabase/functions/cfi-db/index.ts',import.meta.url),'utf8');
  const authAt=source.indexOf('authorizeCfiDbRequest(');
  const clientAt=source.indexOf('createClient(supabaseUrl, serviceRole');
  const fixturesAt=source.indexOf('route === "fixtures-day"');

  assert.ok(authAt>=0,'missing cfi-db auth guard');
  assert.ok(clientAt>authAt,'service-role client must be created after auth');
  assert.ok(fixturesAt>authAt,'fixtures-day route must be behind auth');
  assert.match(source,/req\.headers\.get\("x-cfi-key"\)/);
  assert.match(source,/Deno\.env\.get\("CFI_ACTION_KEY"\)/);
});

test('pc-node authenticates before service-role client and fixture discovery write', async()=>{
  const source=await readFile(new URL('../supabase/functions/cfi-pc-node-ingest/index.ts',import.meta.url),'utf8');
  const authAt=source.indexOf('authorizePcNodeAction(');
  const clientAt=source.indexOf('createClient(su,sr');
  const discoveryAt=source.indexOf('action==="FIXTURE_DISCOVERY_BATCH"');

  assert.ok(authAt>=0,'missing pc-node auth guard');
  assert.ok(clientAt>authAt,'service-role client must be created after auth');
  assert.ok(discoveryAt>authAt,'fixture discovery batch must be behind auth');
  assert.match(source,/req\.headers\.get\("x-cfi-node-key"\)/);
  assert.match(source,/req\.headers\.get\("x-cfi-bridge-key"\)/);
});
