import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseIndonesianNumber,
  findMatchingItem,
  extractStoreName,
  detectCashCategory,
  parseAgentQuery,
  AgentContextSnapshot
} from './agentEngine';
import { ItemBarang } from '../types';

const MOCK_ITEMS: ItemBarang[] = [
  {
    id: 'item-1',
    kode_boq: 'MAT-01',
    nama_barang: 'Semen Padang 40kg',
    satuan: 'sak',
    stok_saat_ini: 120,
    stok_minimum: 20,
    harga_satuan: 65000,
    kategori: 'Material',
    status: 'Tersedia',
    qty_boq: 500,
    is_stock_item: true,
    has_stock_history: true,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 500,
    qty_masuk_total: 120,
    qty_keluar_total: 0,
    qty_pemenuhan_sisa: 380,
    progress_pemenuhan: 24,
    status_pemenuhan: 'Dalam pemenuhan'
  },
  {
    id: 'item-2',
    kode_boq: 'MAT-02',
    nama_barang: 'Besi Beton 10mm SNI',
    satuan: 'batang',
    stok_saat_ini: 45,
    stok_minimum: 10,
    harga_satuan: 85000,
    kategori: 'Material',
    status: 'Tersedia',
    qty_boq: 200,
    is_stock_item: true,
    has_stock_history: true,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 200,
    qty_masuk_total: 45,
    qty_keluar_total: 0,
    qty_pemenuhan_sisa: 155,
    progress_pemenuhan: 22.5,
    status_pemenuhan: 'Dalam pemenuhan'
  }
];

const MOCK_CONTEXT: AgentContextSnapshot = {
  userRole: 'Clerk',
  userName: 'Sumarlin',
  projectName: 'UDU Project',
  currentCashBalance: 15400000,
  items: MOCK_ITEMS,
  totalStockAssetValue: 11625000,
  stockMutationsCount: 18,
  cashMutationsCount: 12
};

test('1. parseIndonesianNumber handles words and numbers accurately', () => {
  assert.equal(parseIndonesianNumber('2.500.000'), 2500000);
  assert.equal(parseIndonesianNumber('75 ribu'), 75000);
  assert.equal(parseIndonesianNumber('dua juta lima ratus ribu'), 2500000);
  assert.equal(parseIndonesianNumber('tiga ratus delapan puluh ribu'), 380000);
});

test('2. findMatchingItem matches exact and substring item names', () => {
  const match1 = findMatchingItem('semen', MOCK_ITEMS);
  assert.equal(match1?.nama_barang, 'Semen Padang 40kg');

  const match2 = findMatchingItem('besi', MOCK_ITEMS);
  assert.equal(match2?.nama_barang, 'Besi Beton 10mm SNI');

  const noMatch = findMatchingItem('kabel listrik super', MOCK_ITEMS);
  assert.equal(noMatch, null);
});

test('3. extractStoreName extracts merchant name properly', () => {
  assert.equal(extractStoreName('Semen tiba dari TB Maju Jaya kemarin'), 'TB Maju Jaya');
  assert.equal(extractStoreName('beli paku di toko Berkah Abadi harga 50 ribu'), 'Berkah Abadi');
});

test('4. detectCashCategory correctly assigns category', () => {
  assert.equal(detectCashCategory('bayar upah tukang 500 ribu'), 'Upah & Konsumsi');
  assert.equal(detectCashCategory('sewa molen 2 hari tiga ratus ribu'), 'Sewa Alat & Angkut');
  assert.equal(detectCashCategory('beli bensin proyek 50 ribu'), 'Operasional Kantor & Lapangan');
  assert.equal(detectCashCategory('beli batako 200 biji'), 'Material');
});

test('5. parseAgentQuery recognizes balance check intent', () => {
  const result = parseAgentQuery('berapa saldo kas proyek kita sekarang?', MOCK_CONTEXT);
  assert.equal(result.type, 'CHECK_CASH_BALANCE');
  assert.equal(result.actionRequired, false);
  assert.ok(result.spokenResponse.includes('15.400.000'));
});

test('6. parseAgentQuery recognizes combined stock in and cash payment intent', () => {
  const result = parseAgentQuery('catat semen masuk 50 sak dari TB Maju Jaya total dua juta lima ratus langsung bayar kas', MOCK_CONTEXT);
  assert.equal(result.type, 'STOCK_IN_AND_CASH');
  assert.equal(result.actionRequired, true);
  assert.equal(result.data.quantity, 50);
  assert.equal(result.data.totalAmount, 2500000);
  assert.equal(result.data.matchedItemName, 'Semen Padang 40kg');
  assert.equal(result.data.storeName, 'TB Maju Jaya');
});

test('7. parseAgentQuery recognizes stock out intent', () => {
  const result = parseAgentQuery('keluarkan 20 sak semen untuk lantai 2', MOCK_CONTEXT);
  assert.equal(result.type, 'STOCK_OUT');
  assert.equal(result.actionRequired, true);
  assert.equal(result.data.quantity, 20);
  assert.equal(result.data.matchedItemName, 'Semen Padang 40kg');
});

test('8. parseAgentQuery recognizes quick navigation', () => {
  const res1 = parseAgentQuery('buka mutasi gudang', MOCK_CONTEXT);
  assert.equal(res1.type, 'NAVIGATE');
  assert.equal(res1.data.targetView, 'stock-mutations');

  const res2 = parseAgentQuery('tampilkan jurnal kas', MOCK_CONTEXT);
  assert.equal(res2.type, 'NAVIGATE');
  assert.equal(res2.data.targetView, 'cashflow');
});

test('9. parseAgentQuery handles affirmative confirm and cancel words', () => {
  const confirmRes = parseAgentQuery('ya, eksekusi', MOCK_CONTEXT);
  assert.equal(confirmRes.type, 'CONFIRM_ACTION');

  const cancelRes = parseAgentQuery('batal', MOCK_CONTEXT);
  assert.equal(cancelRes.type, 'CANCEL_ACTION');
});
