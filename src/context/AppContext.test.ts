import test from 'node:test';
import assert from 'node:assert/strict';
import { computeItemStatus } from './AppContext';

test('inventory status distinguishes unrecorded stock from zero stock', () => {
  assert.equal(computeItemStatus(0, 0, false), 'Belum Dicatat');
  assert.equal(computeItemStatus(0, 0, true), 'Tidak Tersedia');
});

test('inventory status applies the minimum-stock threshold consistently', () => {
  assert.equal(computeItemStatus(2, 2, true), 'Stok Menipis');
  assert.equal(computeItemStatus(3, 2, true), 'Tersedia');
  assert.equal(computeItemStatus(1, 2, true), 'Stok Menipis');
});
