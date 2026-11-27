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

test('10. parseAgentQuery recognizes Scenario A: prepaid by office (CBD/Transfer Kantor)', () => {
  const result = parseAgentQuery('catat besi masuk 40 batang dari TB Berkah lunas transfer kantor pusat', MOCK_CONTEXT);
  assert.equal(result.type, 'STOCK_IN_ONLY');
  assert.equal(result.data.paymentScenario, 'KANTOR_PUSAT');
  assert.ok(result.spokenResponse.includes('kantor pusat'));
  assert.ok(result.proposedActionTitle?.includes('Lunas Transfer Kantor Pusat'));
});

test('11. parseAgentQuery recognizes Scenario B: store credit / tempo toko', () => {
  const result = parseAgentQuery('semen masuk 100 sak dari TB Maju Jaya tempo 30 hari tagihan menyusul', MOCK_CONTEXT);
  assert.equal(result.type, 'STOCK_IN_ONLY');
  assert.equal(result.data.paymentScenario, 'TEMPO_TOKO');
  assert.ok(result.spokenResponse.includes('tempo toko'));
  assert.ok(result.proposedActionTitle?.includes('Tempo Toko'));
});

test('12. parseAgentQuery recognizes Scenario C: petty cash / panjar lapangan', () => {
  const result = parseAgentQuery('catat paku masuk 5 box dari Toko Jaya tiga ratus ribu bayar pakai uang panjar mandor', MOCK_CONTEXT);
  assert.equal(result.type, 'STOCK_IN_AND_CASH');
  assert.equal(result.data.paymentScenario, 'PANJAR_LAPANGAN');
  assert.ok(result.spokenResponse.includes('panjar lapangan'));
  assert.ok(result.proposedActionTitle?.includes('Panjar'));
});

test('13. parseAgentQuery correctly distinguishes payment words from material usage', () => {
  // Masuk barang bayar pakai kas dengan nominal -> STOCK_IN_AND_CASH
  const inResult = parseAgentQuery('semen masuk 10 sak beli di TB Maju Jaya total lima ratus ribu bayar pakai kas proyek', MOCK_CONTEXT);
  assert.equal(inResult.type, 'STOCK_IN_AND_CASH');
  assert.equal(inResult.data.paymentScenario, 'KAS_PROYEK');
  assert.equal(inResult.data.totalAmount, 500000);

  // Pengeluaran barang pakai ke lapangan -> STOCK_OUT
  const outResult = parseAgentQuery('pakai 10 sak semen untuk lantai 2', MOCK_CONTEXT);
  assert.equal(outResult.type, 'STOCK_OUT');
  assert.equal(outResult.data.quantity, 10);
});

test('14. parseAgentQuery recognizes approval queue and pending documents query', () => {
  const ctxWithQueue = { ...MOCK_CONTEXT, pendingApprovalCount: 4 };
  const resWithQueue = parseAgentQuery('apakah ada antrean persetujuan dokumen?', ctxWithQueue);
  assert.equal(resWithQueue.type, 'CHECK_APPROVAL_QUEUE');
  assert.ok(resWithQueue.spokenResponse.includes('4 transaksi'));
  assert.equal(resWithQueue.data.targetView, 'stock-mutations');

  const ctxEmpty = { ...MOCK_CONTEXT, pendingApprovalCount: 0 };
  const resEmpty = parseAgentQuery('cek dokumen yang belum disetujui', ctxEmpty);
  assert.equal(resEmpty.type, 'CHECK_APPROVAL_QUEUE');
  assert.ok(resEmpty.spokenResponse.toLowerCase().includes('telah disahkan'));
});

