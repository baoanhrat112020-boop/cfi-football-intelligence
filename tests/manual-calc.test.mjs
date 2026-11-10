import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');

function extract(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i++) {
    if (html[i] === '{') depth++;
    if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
  }
  throw new Error(name);
}

const calc = new Function(`${extract('mcPois')}${extract('mcEv')}${extract('mcCalc')}return mcCalc;`)();

test('fair 2.5 line at even odds gives about 2.7 expected goals', () => {
  const r = calc(2.5, 1.95, 1.95, 0.55);
  assert.ok(r.lam > 2.5 && r.lam < 3.0, String(r.lam));
});

test('home scores more often when home share is larger', () => {
  const a = calc(2.5, 1.9, 1.9, 0.64);
  const b = calc(2.5, 1.9, 1.9, 0.42);
  assert.ok(a.ft[0] > b.ft[0] && a.ft[1] < b.ft[1]);
});

test('shorter Over odds raise expected goals', () => {
  const lo = calc(2.5, 1.7, 2.2, 0.55);
  const hi = calc(2.5, 2.2, 1.7, 0.55);
  assert.ok(lo.lam > hi.lam);
});

test('quarter lines and Hong Kong style odds are accepted', () => {
  assert.ok(calc(2.25, 0.9, 0.9, 0.55).lam > 0);
  assert.equal(calc(2.5, 0, 1.9, 0.55), null);
});

test('probabilities stay between 0 and 1 and half-time is below full-time', () => {
  const r = calc(3, 1.85, 1.95, 0.55);
  for (const v of [...r.ft, ...r.h1, r.btts, ...r.over, ...r.overH1]) assert.ok(v > 0 && v < 1);
  assert.ok(r.h1[0] < r.ft[0] && r.h1[1] < r.ft[1]);
});
