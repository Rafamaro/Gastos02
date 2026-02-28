import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRate, toBase, safeTags } from '../assets/js/utils.js';

test('resolveRate prioritizes custom rate when valid', () => {
  const config = { ratesByMonth: { '2026-02': { USD: 1200 } }, ratesToBase: { USD: 1100 } };
  assert.equal(resolveRate('USD', config, '2026-02-01', 1300), 1300);
});

test('resolveRate uses monthly rate before fallback', () => {
  const config = { ratesByMonth: { '2026-02': { USD: 1200 } }, ratesToBase: { USD: 1100 } };
  assert.equal(resolveRate('USD', config, '2026-02-05'), 1200);
});

test('resolveRate maps stable coins to USD rates', () => {
  const config = { ratesByMonth: { '2026-02': { USD: 1195 } }, ratesToBase: { USD: 1100 } };
  assert.equal(resolveRate('USDT', config, '2026-02-05'), 1195);
});

test('toBase multiplies using resolved rate', () => {
  const config = { ratesByMonth: {}, ratesToBase: { EUR: 1500 } };
  assert.equal(toBase(10, 'EUR', config), 15000);
});

test('safeTags trims values, removes empties and caps at 12', () => {
  const raw = ' a, ,b, c,d,e,f,g,h,i,j,k,l,m';
  assert.deepEqual(safeTags(raw), ['a','b','c','d','e','f','g','h','i','j','k','l']);
});
