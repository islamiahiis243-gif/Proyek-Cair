import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQtyInput, formatQtyInput, terbilangRupiah, formatRupiahInput, parseRupiahInput } from './numberFormat';

test('parseQtyInput supports decimal point and comma gracefully', () => {
  assert.equal(parseQtyInput('1.5'), 1.5);
  assert.equal(parseQtyInput('1,5'), 1.5);
  assert.equal(parseQtyInput('0.25'), 0.25);
  assert.equal(parseQtyInput('0,25'), 0.25);
  assert.equal(parseQtyInput('12.75'), 12.75);
  assert.equal(parseQtyInput('1.000'), 1000);
  assert.equal(parseQtyInput('1.000,5'), 1000.5);
  assert.equal(parseQtyInput('2.500.000'), 2500000);
  assert.equal(parseQtyInput(''), 0);
});

test('terbilangRupiah handles millions, thousands and exact Seribu correctly', () => {
  assert.equal(terbilangRupiah(1_000), 'Seribu Rupiah');
  assert.equal(terbilangRupiah(1_001_000), 'Satu Juta Seribu Rupiah');
  assert.equal(terbilangRupiah(1_500_000), 'Satu Juta Lima Ratus Ribu Rupiah');
  assert.equal(terbilangRupiah(21_000), 'Dua Puluh Satu Ribu Rupiah');
  assert.equal(terbilangRupiah(100_000), 'Seratus Ribu Rupiah');
  assert.equal(terbilangRupiah(0), 'Nol Rupiah');
  assert.equal(terbilangRupiah(null), '');
});
