import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELDS, defaultConfig, calculate, normalizeRows, parseDelimited, importMapped, suggestMapping, inputCSV, allocationCSV, formatUnits, asNumber } from '../web/core.js';

const wallet = i => '0x' + BigInt(i).toString(16).padStart(40, '0');
const row = (i, values = {}) => ({ wallet: wallet(i), ...Object.fromEntries(FIELDS.map(f => [f.key, '0'])), ...values });
const config = (weights, overrides = {}) => ({ ...defaultConfig(), pool: '1000', weights: { ...Object.fromEntries(FIELDS.map(f => [f.key, '0'])), ...weights }, ...overrides });

test('separate field pools use within-field shares, not weighted raw counts', () => {
  const r = calculate([row(1, { points: '1000000', shields_bought: '0' }), row(2, { points: '0', shields_bought: '1' })], config({ points: '20', shields_bought: '80' }));
  assert.equal(formatUnits(r.rows.find(r => r.wallet === wallet(1)).units, 6), '200.000000');
  assert.equal(formatUnits(r.rows.find(r => r.wallet === wallet(2)).units, 6), '800.000000');
});
test('wallet receives sum of independently allocated fields', () => {
  const r = calculate([row(1, { points: '30', staked_fp: '3' }), row(2, { points: '70', staked_fp: '1' })], config({ points: '40', staked_fp: '60' }));
  assert.equal(formatUnits(r.rows.find(r => r.wallet === wallet(1)).units, 6), '570.000000');
});
test('binary potion use splits its budget among yes wallets only', () => {
  const rows = normalizeRows([row(1, { potion_use: 'Yes' }), row(2, { potion_use: 'true' }), row(3, { potion_use: 'No' })]).rows;
  const r = calculate(rows, config({ potion_use: '1' }));
  assert.deepEqual(r.rows.map(r => formatUnits(r.units, 6)), ['500.000000', '500.000000', '0.000000']);
  assert.throws(() => normalizeRows([row(1, { potion_use: '3' })]), /1\/0/);
});
test('duplicates aggregate counts and OR potion use case-insensitively', () => {
  const a = row(171, { points: '1.25', potion_use: '1' });
  const b = { ...row(171, { points: '2.75', potion_use: '1' }), wallet: wallet(171).toUpperCase() };
  const merged = normalizeRows([a, b]);
  assert.equal(merged.duplicates, 1); assert.equal(merged.rows[0].points, '4'); assert.equal(merged.rows[0].potion_use, '1');
});
test('empty weighted fields remain unallocated', () => {
  const r = calculate([row(1, { points: '3' })], config({ points: '70', revives_bought: '30' }));
  assert.equal(formatUnits(r.allocatedUnits, 6), '700.000000'); assert.equal(formatUnits(r.unallocatedUnits, 6), '300.000000');
});
test('direct percentages permit a reserve and reject over-allocation', () => {
  const r = calculate([row(1, { points: '1' })], config({ points: '25' }, { mode: 'percent' }));
  assert.equal(formatUnits(r.unallocatedUnits, 6), '750.000000');
  assert.throws(() => calculate([], config({ points: '101' }, { mode: 'percent' })), /exceed/);
  assert.throws(() => calculate([], config({})), /at least one/);
});
test('largest remainder conserves total and tie order is deterministic', () => {
  const rows = [row(3, { points: '1' }), row(1, { points: '1' }), row(2, { points: '1' })];
  const c = config({ points: '1' }, { pool: '1', precision: 2 });
  const r = calculate(rows, c), reverse = calculate([...rows].reverse(), c);
  assert.equal(r.rows.reduce((a, r) => a + r.units, 0n), 100n);
  assert.equal(r.rows[0].wallet, wallet(1)); assert.equal(r.rows[0].units, 34n);
  assert.deepEqual(r.rows.map(r => r.units), reverse.rows.map(r => r.units));
});
test('18-decimal allocations preserve precision beyond Number safe integers', () => {
  const c = config({ points: '1' }, { pool: '9007199254740993.123456789012345678', precision: 18 });
  const r = calculate([row(1, { points: '1' }), row(2, { points: '1' })], c);
  assert.equal(r.rows.reduce((a, r) => a + r.units, 0n), 9007199254740993123456789012345678n);
  assert.equal(r.unallocatedUnits, 0n);
  assert.throws(() => calculate([], { ...c, precision: 6 }), /decimal places/);
});
test('invalid, negative, missing and fractional purchase counts are rejected', () => {
  for (const v of ['-1', '', 'NaN', 'Infinity', '1e9']) assert.throws(() => normalizeRows([row(1, { points: v })]));
  assert.throws(() => normalizeRows([row(1, { shields_bought: '1.5' })]), /whole count/);
  assert.throws(() => normalizeRows([{ ...row(1), wallet: 'alice' }]), /wallet/);
});
test('CSV roundtrip, BOM, quoted cells and TSV', () => {
  const rows = [row(1, { points: '1.25' }), row(2, { potion_use: '1' })];
  const p = parseDelimited(inputCSV(rows));
  assert.deepEqual(importMapped(p, suggestMapping(p.headers)).rows, rows);
  assert.deepEqual(parseDelimited('wallet\tpoints\nabc\t1').records, [['abc', '1']]);
  assert.deepEqual(parseDelimited('a,b\n"one,two","three"').records, [['one,two', 'three']]);
  assert.throws(() => parseDelimited('a,b\n"unclosed,1'), /unclosed/);
  assert.throws(() => parseDelimited('a,b\n1,2,3'), /cells/);
});
test('missing source fields require explicit opt-in and unknown columns stay unmapped', () => {
  const p = parseDelimited(`wallet,points,unknownCount,unknownTotal\n${wallet(1)},3,99,300`);
  const m = suggestMapping(p.headers);
  assert.equal(m.shields_bought, -1); assert.throws(() => importMapped(p, m), /Map every field/);
  assert.equal(importMapped(p, m, true).rows[0].shields_bought, '0');
  assert.throws(() => importMapped(p, { ...m, petage_carrots: m.points }, true), /only one/);
});
test('export includes every field share and raw count with full wallet addresses', () => {
  const r = calculate([row(1, { points: '10' })], config({ points: '1' }));
  const p = parseDelimited(allocationCSV(r));
  assert.equal(p.headers.length, 40); assert.equal(p.records[0][0], wallet(1));
  assert.equal(p.records[0][p.headers.indexOf('points_within_field_pct')], '100');
});
test('conservation holds for varied rows, weights, reserves, and precision', () => {
  for (let seed = 1; seed < 35; seed++) {
    const rows = Array.from({ length: 17 }, (_, i) => row(i + 1, Object.fromEntries(FIELDS.map((f, j) => [f.key, f.binary ? String((i + seed) % 2) : String(((i + 3) * (j + seed)) % 91)]))));
    const c = config(Object.fromEntries(FIELDS.map((f, j) => [f.key, String((seed + j) % 11)])), { pool: '1003', precision: seed % 7 });
    const r = calculate(rows, c);
    assert.equal(r.rows.reduce((a, r) => a + r.units, 0n) + r.unallocatedUnits, 1003n * 10n ** BigInt(c.precision));
    assert.ok(Math.abs(r.rows.reduce((a, r) => a + asNumber(r.share), 0) - 1) < 1e-12);
  }
});
