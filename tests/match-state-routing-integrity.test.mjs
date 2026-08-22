import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyMatchState } from '../src/runtime/match-state-routing.ts';

test('terminal fixture state dominates stale live period and minute fields',()=>{
  assert.equal(classifyMatchState({fixtureStatus:'FT',live:{period:'2H',minute:94}}),'TERMINAL');
  assert.equal(classifyMatchState({matchStatus:'FINISHED',live:{period:'2H',minute:90}}),'TERMINAL');
  assert.equal(classifyMatchState({status:'CANCELLED',live:{period:'1H',minute:12}}),'TERMINAL');
});

test('positive live evidence dominates a stale prematch label',()=>{
  assert.equal(classifyMatchState({fixtureStatus:'SCHEDULED',live:{period:'1H',minute:4}}),'LIVE');
  assert.equal(classifyMatchState({fixtureStatus:'COUNTDOWN',live:{minute:2}}),'LIVE');
});

test('prematch remains prematch when no positive live evidence exists',()=>{
  assert.equal(classifyMatchState({fixtureStatus:'COUNTDOWN'}),'PREMATCH');
  assert.equal(classifyMatchState({matchStatus:'NOT_STARTED'}),'PREMATCH');
});
