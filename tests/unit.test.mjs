// Unit tests for Saathi's core rules. Run with: npm test  (uses Node's built-in test runner)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judgeReading, formatReading } from '../server/health.js';
import { routineLabel, partOfDay, niceTime, addDays } from '../server/time.js';
import { guessCategory, categoryOf, CATEGORY_KEYS } from '../shared/categories.js';
import { normalizeMed, amountText, stockInfo } from '../server/logic.js';
import { languageOf, LANGUAGE_CODES } from '../shared/languages.js';

test('BP readings are judged against home-monitoring ranges', () => {
  assert.equal(judgeReading('bp', 120, 80).level, 'ok');
  assert.equal(judgeReading('bp', 150, 85).level, 'high');
  assert.equal(judgeReading('bp', 185, 100).level, 'danger');
  assert.equal(judgeReading('bp', 85, 55).level, 'low');
});

test('sugar readings flag low, high and dangerous values', () => {
  assert.equal(judgeReading('sugar', 110).level, 'ok');
  assert.equal(judgeReading('sugar', 65).level, 'low');
  assert.equal(judgeReading('sugar', 200).level, 'high');
  assert.equal(judgeReading('sugar', 50).level, 'danger');
  assert.equal(judgeReading('sugar', 320).level, 'danger');
});

test('readings are formatted with their units', () => {
  assert.equal(formatReading('bp', 132, 84), '132/84 mmHg');
  assert.equal(formatReading('sugar', 124), '124 mg/dL');
  assert.equal(formatReading('weight', 61.25), '61.3 kg');
});

test('dose times are described by the daily routine, not the clock', () => {
  const routine = { wake: '06:30', breakfast: '08:00', lunch: '13:00', tea: '17:00', dinner: '20:00', bed: '22:00' };
  assert.deepEqual(routineLabel('08:30', routine), { anchor: 'breakfast', rel: 'after' });
  assert.deepEqual(routineLabel('07:30', routine), { anchor: 'breakfast', rel: 'before' });
  assert.deepEqual(routineLabel('22:00', routine), { anchor: 'bed', rel: 'at' });
  assert.deepEqual(routineLabel('03:00', routine), { anchor: null, rel: null });
});

test('time helpers', () => {
  assert.equal(partOfDay('08:30'), 'morning');
  assert.equal(partOfDay('13:30'), 'afternoon');
  assert.equal(partOfDay('19:00'), 'evening');
  assert.equal(partOfDay('23:00'), 'night');
  assert.equal(niceTime('13:05'), '1:05 PM');
  assert.equal(niceTime('00:15'), '12:15 AM');
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
});

test('medicine category is guessed from the name or purpose', () => {
  assert.equal(guessCategory('Metformin'), 'sugar');
  assert.equal(guessCategory('Amlodipine'), 'bp');
  assert.equal(guessCategory('Pan 40', 'for gas'), 'acidity');
  assert.equal(guessCategory('Something new'), 'other');
  assert.equal(categoryOf('unknown-key').key, 'other');
  assert.ok(CATEGORY_KEYS.includes('thinner'));
});

test('medicines are validated and cleaned before saving', () => {
  assert.throws(() => normalizeMed({ name: '', times: ['08:00'] }), /name/);
  assert.throws(() => normalizeMed({ name: 'X', times: [] }), /time/);
  const m = normalizeMed({ name: ' Metformin ', times: ['20:30', '08:30', '08:30', 'bad'], amount: '0', stock: '' });
  assert.equal(m.name, 'Metformin');
  assert.deepEqual(m.times, ['08:30', '20:30']);
  assert.equal(m.amount, 1);
  assert.equal(m.stock, null);
  assert.equal(m.category, 'sugar');
  assert.equal(m.days, 'daily');
});

test('amounts read naturally', () => {
  assert.equal(amountText(1, 'tablet'), '1 tablet');
  assert.equal(amountText(2, 'tablet'), '2 tablets');
  assert.equal(amountText(0.5, 'tablet'), 'half tablet');
});

test('refill forecast flags low stock', () => {
  const info = stockInfo({ stock: 6, times: ['08:30', '20:30'], amount: 1, days: 'daily', refill_at_days: 5 });
  assert.equal(info.daysLeft, 3);
  assert.equal(info.low, true);
  assert.equal(stockInfo({ stock: null, times: ['08:30'], amount: 1, days: 'daily' }), null);
});

test('languages fall back to English for unknown codes', () => {
  assert.equal(LANGUAGE_CODES.length, 20);
  assert.equal(languageOf('ta').speech, 'ta-IN');
  assert.equal(languageOf('xx').code, 'en');
  assert.equal(languageOf('ur').rtl, true);
});
