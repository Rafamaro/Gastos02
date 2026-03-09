import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveRate, toBase, safeTags, buildEffectiveExpenseEntries, fmtMoney, parseAmountInput, formatAmountInput } from '../assets/js/utils.js';

globalThis.localStorage = {
  getItem(){ return null; },
  setItem(){}
};

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


test('buildEffectiveExpenseEntries discounts linked reentries and caps at zero', () => {
  const config = { ratesByMonth: {}, ratesToBase: { ARS: 1 } };
  const tx = [
    { id: 'exp-1', type: 'expense', amount: 10000, currency: 'ARS', category: 'Comida', date: '2026-02-10' },
    { id: 'r1', type: 'income', pay: 'Reintegro', amount: 7000, currency: 'ARS', linkedExpenseId: 'exp-1', date: '2026-02-11' }
  ];

  const [entry] = buildEffectiveExpenseEntries(tx, config);
  assert.equal(entry.effectiveAmountBase, 3000);
});

test('buildEffectiveExpenseEntries handles full and over reentries safely', () => {
  const config = { ratesByMonth: {}, ratesToBase: { ARS: 1 } };
  const tx = [
    { id: 'exp-1', type: 'expense', amount: 10000, currency: 'ARS', category: 'Comida', date: '2026-02-10' },
    { id: 'r1', type: 'income', pay: 'Reintegro', amount: 12000, currency: 'ARS', linkedExpenseId: 'exp-1', date: '2026-02-11' }
  ];

  const [entry] = buildEffectiveExpenseEntries(tx, config);
  assert.equal(entry.effectiveAmountBase, 0);
});

test('buildEffectiveExpenseEntries accumulates partial reentries per linked expense', () => {
  const config = { ratesByMonth: {}, ratesToBase: { ARS: 1 } };
  const tx = [
    { id: 'exp-1', type: 'expense', amount: 10000, currency: 'ARS', category: 'Comida', date: '2026-02-10' },
    { id: 'exp-2', type: 'expense', amount: 5000, currency: 'ARS', category: 'Comida', date: '2026-02-12' },
    { id: 'r1', type: 'income', pay: 'Reintegro', amount: 2000, currency: 'ARS', linkedExpenseId: 'exp-1', date: '2026-02-13' },
    { id: 'r2', type: 'income', pay: 'Reintegro', amount: 1500, currency: 'ARS', linkedExpenseId: 'exp-1', date: '2026-02-14' },
    { id: 'r3', type: 'income', pay: 'Reintegro', amount: 1000, currency: 'ARS', linkedExpenseId: 'exp-2', date: '2026-02-15' }
  ];

  const entries = buildEffectiveExpenseEntries(tx, config);
  const exp1 = entries.find(x => x.id === 'exp-1');
  const exp2 = entries.find(x => x.id === 'exp-2');

  assert.equal(exp1.effectiveAmountBase, 6500);
  assert.equal(exp2.effectiveAmountBase, 4000);
});

test('fmtMoney formats fiat currencies with Intl currency style', () => {
  const out = fmtMoney(1000, 'USD', { locale: 'en-US' });
  assert.match(out, /\$1,000\.00/);
});

test('fmtMoney formats non-ISO tickers without throwing and appends ticker', () => {
  assert.doesNotThrow(() => fmtMoney(100, 'USDT', { locale: 'en-US' }));
  const out = fmtMoney(100, 'USDT', { locale: 'en-US' });
  assert.match(out, /100\.00 USDT$/);
});


test('parseAmountInput parses grouped and decimal amount strings', () => {
  assert.equal(parseAmountInput('1.234.567'), 1234567);
  assert.equal(parseAmountInput('1.234.567,89'), 1234567.89);
  assert.equal(parseAmountInput(''), 0);
});

test('formatAmountInput adds thousand separators while typing', () => {
  assert.equal(formatAmountInput('1000000'), '1.000.000');
  assert.equal(formatAmountInput('1234567,89'), '1.234.567,89');
  assert.equal(formatAmountInput('1000,'), '1.000,');
});
