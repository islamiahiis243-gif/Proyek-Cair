import test from 'node:test';
import assert from 'node:assert/strict';
import { ItemBarang, MutasiBarang, MutasiKas, PurchaseOrder } from '../types';
import { resolveCashEvalContext } from './cashflowEngine';
import {
  buildPoModuleContribution,
  computeDueDateFromTerms,
  computePoPaymentProgress,
  computePoReceiveProgress,
  computeProcurementNeeds,
  computeProcurementSummaryMetrics,
  countPendingPoApprovals,
  evaluatePurchaseOrder,
  generateNextPoNumber,
  isPoRowExcluded,
} from './procurementEngine';

function makeBoqItem(overrides: Partial<ItemBarang> = {}): ItemBarang {
  return {
    id: 'boq-1',
    kode_boq: 'B.1.1',
    nama_barang: 'Semen Portland 50kg',
    kategori: 'Pekerjaan Struktur',
    satuan: 'Sak',
    qty_boq: 100,
    is_stock_item: true,
    has_stock_history: false,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 100,
    qty_masuk_total: 20,
    qty_keluar_total: 10,
    qty_pemenuhan_sisa: 80,
    progress_pemenuhan: 20,
    status_pemenuhan: 'Dalam pemenuhan',
    harga_satuan: 70000,
    stok_saat_ini: 10,
    stok_minimum: 5,
    status: 'Tersedia',
    ...overrides,
  };
}

function makePo(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    project_id: 'proj-1',
    po_no: 'PO-20261124-001',
    nama_toko: 'TB Sinar Bangunan',
    toko_kontak: '0812-3456-7890',
    tanggal_po: '2026-11-20T08:00:00Z',
    estimasi_tiba: '2026-11-25',
    payment_terms: 'TEMPO_14',
    jatuh_tempo_bayar: '2026-12-04',
    dp_amount_rp: 0,
    total_amount_rp: 3250000,
    status_dokumen: 'MENGETAHUI',
    sent_to_store_at: '2026-11-20T09:00:00Z',
    items: [
      {
        id: 'poi-1',
        po_id: 'po-1',
        project_id: 'proj-1',
        boq_item_id: 'boq-1',
        nama_barang: 'Semen Portland 50kg',
        satuan: 'Sak',
        qty_pesan: 50,
        harga_satuan_po: 65000,
        harga_pagu_boq: 70000,
        subtotal_rp: 3250000,
      },
    ],
    ...overrides,
  };
}

function makeStockIn(overrides: Partial<MutasiBarang> = {}): MutasiBarang {
  return {
    id: 'sm-1',
    barang_id: 'boq-1',
    nama_barang: 'Semen Portland 50kg',
    jenis: 'MASUK',
    jumlah: 30,
    satuan: 'Sak',
    tujuan_keperluan: 'Penerimaan PO-20261124-001',
    pic_penerima_penyerah: 'Budi Gudang',
    tanggal: '2026-11-22T10:00:00Z',
    stok_sebelum: 10,
    stok_sesudah: 40,
    po_id: 'po-1',
    po_item_id: 'poi-1',
    harga_satuan_beli: 65000,
    ...overrides,
  };
}

function makeCashOutPo(overrides: Partial<MutasiKas> = {}): MutasiKas {
  return {
    id: 'cash-1',
    jenis: 'KELUAR',
    jumlah_rp: 1000000,
    untuk_apa: 'Pembayaran PO-20261124-001 (TB Sinar Bangunan)',
    kategori_keperluan: 'Material',
    pic: 'Budi Admin',
    tanggal: '2026-11-22T11:00:00Z',
    saldo_setelah: 5000000,
    source_module: 'PO_PENGADAAN',
    source_entity_id: 'po-1',
    source_entity_no: 'PO-20261124-001',
    ...overrides,
  };
}

const clerkCtx = resolveCashEvalContext(
  'Clerk',
  { canIssue: true, canInitiateBatalGanti: true, canInstructBatalGanti: false },
  { contractorName: 'PT Kontraktor Jaya', clientName: 'PT Klien Utama' },
  true
);
const foremanCtx = resolveCashEvalContext(
  'Foreman',
  { canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true },
  { contractorName: 'PT Kontraktor Jaya', clientName: 'PT Klien Utama' },
  true
);
const spvCtx = resolveCashEvalContext(
  'Spv.',
  { canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true },
  { contractorName: 'PT Kontraktor Jaya', clientName: 'PT Klien Utama' },
  true
);
const managerCtx = resolveCashEvalContext(
  'Dept. Manager',
  { canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true },
  { contractorName: 'PT Kontraktor Jaya', clientName: 'PT Klien Utama' },
  true
);

test('1. Anti Beli Ganda: sisaPerluDipesan = max(0, qty_boq - qty_masuk - qty_sedang_dipesan_po)', () => {
  const item = makeBoqItem({ qty_boq: 100, target_kebutuhan_total: 100, qty_masuk_total: 20 });
  // PO memesan 50 sak, baru tiba 30 sak → masih 20 sak sedang dipesan di PO aktif
  const po = makePo();
  const stockIn = makeStockIn({ jumlah: 30 });

  const needs = computeProcurementNeeds([item], [po], [stockIn]);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].qtySedangDipesanPo, 20);
  // 100 - 20 (sudah masuk gudang) - 20 (sisa di PO aktif) = 60
  assert.equal(needs[0].sisaPerluDipesan, 60);
  assert.equal(needs[0].status, 'PERLU_DIPESAN');
  assert.equal(needs[0].actionType, 'PESAN');
});

test('2. Anti Beli Ganda: item yang seluruh sisanya sudah masuk PO berubah menjadi PANTAU', () => {
  const item = makeBoqItem({ qty_boq: 50, target_kebutuhan_total: 50, qty_masuk_total: 0 });
  const po = makePo(); // pesan 50 sak, belum tiba
  const needs = computeProcurementNeeds([item], [po], []);
  assert.equal(needs[0].sisaPerluDipesan, 0);
  assert.equal(needs[0].qtySedangDipesanPo, 50);
  assert.equal(needs[0].status, 'SEDANG_DIPESAN');
  assert.equal(needs[0].actionType, 'PANTAU');
});

test('3. Pengecualian otomatis Jatah Klien/IMK dan Pos Jasa dari Tab 1 Kebutuhan PO', () => {
  const contractorStock = makeBoqItem({ id: 'b-1', is_stock_item: true, keterangan: '' });
  const clientImk = makeBoqItem({
    id: 'b-2',
    nama_barang: 'Kabel Panel Jatah Klien',
    is_stock_item: true,
    keterangan: 'Material disediakan oleh klien (IMK)',
  });
  const serviceItem = makeBoqItem({
    id: 'b-3',
    nama_barang: 'Jasa Pemasangan Pondasi',
    is_stock_item: false,
  });

  const needs = computeProcurementNeeds([contractorStock, clientImk, serviceItem], [], []);
  assert.equal(needs.length, 1);
  assert.equal(needs[0].boqItemId, 'b-1');
});

test('4. PO BATAL/DIGANTI tidak menahan kuota pesanan BOQ', () => {
  const item = makeBoqItem({ qty_boq: 50, target_kebutuhan_total: 50, qty_masuk_total: 0 });
  const batalPo = makePo({ is_batal: true, status_dokumen: 'BATAL' });
  const gantiPo = makePo({ id: 'po-2', is_ganti: true, status_dokumen: 'DIGANTI' });
  assert.equal(isPoRowExcluded(batalPo), true);
  assert.equal(isPoRowExcluded(gantiPo), true);

  const needs = computeProcurementNeeds([item], [batalPo, gantiPo], []);
  assert.equal(needs[0].qtySedangDipesanPo, 0);
  assert.equal(needs[0].sisaPerluDipesan, 50);
});

test('5. Progres penerimaan parsial dan penuh mengabaikan mutasi gudang yang dibatalkan', () => {
  const po = makePo();
  const s1 = makeStockIn({ id: 'sm-1', jumlah: 20 });
  const s2Batal = makeStockIn({ id: 'sm-2', jumlah: 30, is_batal: true, status_dokumen: 'BATAL' });
  const prog = computePoReceiveProgress(po, [s1, s2Batal]);
  assert.equal(prog.totalQtyDiterima, 20);
  assert.equal(prog.totalQtySisaTerima, 30);
  assert.equal(prog.receivePct, 40);
});

test('6. Kalkulasi pembayaran PO dan sisa tagihan hanya menghitung kas keluar PO_PENGADAAN aktif', () => {
  const po = makePo({ total_amount_rp: 3250000 });
  const pay1 = makeCashOutPo({ id: 'c-1', jumlah_rp: 1250000 });
  const payBatal = makeCashOutPo({ id: 'c-2', jumlah_rp: 2000000, is_batal: true });
  const payOtherModule = makeCashOutPo({ id: 'c-3', jumlah_rp: 500000, source_module: 'KAS_LANGSUNG' });

  const prog = computePoPaymentProgress(po, [pay1, payBatal, payOtherModule]);
  assert.equal(prog.totalDibayarRp, 1250000);
  assert.equal(prog.sisaBayarRp, 2000000);
  assert.equal(prog.payPct, 38);
});

test('7. State Machine PO-1: Pengesahan serial 4 tingkat menampilkan Smart-Button tepat sesuai giliran jabatan', () => {
  const poDraft = makePo({ status_dokumen: 'DITERBITKAN', sent_to_store_at: null });
  const poPeriksa = makePo({ status_dokumen: 'DIPERIKSA', sent_to_store_at: null });
  const poSetuju = makePo({ status_dokumen: 'DISETUJUI', sent_to_store_at: null });

  assert.equal(evaluatePurchaseOrder(poDraft, [], [], foremanCtx, 10000000).actionLabel, 'Periksa');
  assert.equal(evaluatePurchaseOrder(poDraft, [], [], spvCtx, 10000000).actionType, 'RIWAYAT');
  assert.equal(evaluatePurchaseOrder(poDraft, [], [], clerkCtx, 10000000).actionType, 'KOREKSI');

  assert.equal(evaluatePurchaseOrder(poPeriksa, [], [], spvCtx, 10000000).actionLabel, 'Setuju');
  assert.equal(evaluatePurchaseOrder(poPeriksa, [], [], managerCtx, 10000000).actionType, 'RIWAYAT');

  assert.equal(evaluatePurchaseOrder(poSetuju, [], [], managerCtx, 10000000).actionLabel, 'Sahkan');
  assert.equal(countPendingPoApprovals([poDraft, poPeriksa, poSetuju], 'Foreman'), 1);
  assert.equal(countPendingPoApprovals([poDraft, poPeriksa, poSetuju], 'Spv.'), 1);
  assert.equal(countPendingPoApprovals([poDraft, poPeriksa, poSetuju], 'Dept. Manager'), 1);
});

test('8. State Machine PO-2: PO sah belum dikirim ke toko menawarkan Kirim PO untuk Clerk', () => {
  const po = makePo({ status_dokumen: 'MENGETAHUI', sent_to_store_at: null });
  const evalClerk = evaluatePurchaseOrder(po, [], [], clerkCtx, 10000000, '2026-11-24');
  assert.equal(evalClerk.stateCode, 'PO-2');
  assert.equal(evalClerk.actionType, 'KIRIM_PO');
  assert.equal(evalClerk.actionLabel, 'Kirim PO');

  const evalSpv = evaluatePurchaseOrder(po, [], [], spvCtx, 10000000, '2026-11-24');
  assert.equal(evalSpv.actionType, 'RIWAYAT');
});

test('9. State Machine PO-3: PO terkirim dengan sisa barang menawarkan Terima untuk Clerk', () => {
  const po = makePo({ status_dokumen: 'MENGETAHUI', sent_to_store_at: '2026-11-20T09:00:00Z' });
  const stockPartial = makeStockIn({ jumlah: 20 });
  const ev = evaluatePurchaseOrder(po, [stockPartial], [], clerkCtx, 10000000, '2026-11-24');
  assert.equal(ev.stateCode, 'PO-3');
  assert.equal(ev.statusLabel, 'Tiba Sebagian');
  assert.equal(ev.actionType, 'TERIMA_BARANG');
  assert.equal(ev.actionLabel, 'Terima');
});

test('10. State Machine PO-4: Barang tiba 100% belum lunas → Bayar saat kas > 0, berubah Isi Kas saat saldo <= 0', () => {
  const po = makePo();
  const stockFull = makeStockIn({ jumlah: 50 });

  const evHasCash = evaluatePurchaseOrder(po, [stockFull], [], clerkCtx, 5000000, '2026-11-24');
  assert.equal(evHasCash.stateCode, 'PO-4');
  assert.equal(evHasCash.actionType, 'BAYAR_PO');
  assert.equal(evHasCash.actionLabel, 'Bayar');

  const evZeroCash = evaluatePurchaseOrder(po, [stockFull], [], clerkCtx, 0, '2026-11-24');
  assert.equal(evZeroCash.stateCode, 'PO-4');
  assert.equal(evZeroCash.actionType, 'ISI_KAS');
  assert.equal(evZeroCash.actionLabel, 'Isi Kas');
  assert.equal(evZeroCash.actionVariant, 'emerald');
});

test('11. State Machine PO-4 DP: PO dengan DP belum dibayar mengarahkan ke Bayar DP sebelum barang tiba', () => {
  const poDp = makePo({
    payment_terms: 'DP_PELUNASAN',
    dp_amount_rp: 1000000,
    total_amount_rp: 3250000,
  });
  const ev = evaluatePurchaseOrder(poDp, [], [], clerkCtx, 5000000, '2026-11-24');
  assert.equal(ev.stateCode, 'PO-4');
  assert.equal(ev.isDpPending, true);
  assert.equal(ev.actionType, 'BAYAR_PO');
  assert.equal(ev.actionLabel, 'Bayar DP');
  assert.equal(ev.recommendedPayAmountRp, 1000000);

  // Setelah DP dibayar, langsung beralih ke PO-3 (Menunggu Tiba → Terima)
  const dpPaid = makeCashOutPo({ jumlah_rp: 1000000 });
  const evAfterDp = evaluatePurchaseOrder(poDp, [], [dpPaid], clerkCtx, 4000000, '2026-11-24');
  assert.equal(evAfterDp.stateCode, 'PO-3');
  assert.equal(evAfterDp.actionType, 'TERIMA_BARANG');
});

test('12. State Machine PO-5, PO-6, PO-7: Tuntas, Diganti, dan Batal', () => {
  const po = makePo();
  const fullReceive = makeStockIn({ jumlah: 50 });
  const fullPay = makeCashOutPo({ jumlah_rp: 3250000 });

  const evDone = evaluatePurchaseOrder(po, [fullReceive], [fullPay], clerkCtx, 5000000, '2026-11-24');
  assert.equal(evDone.stateCode, 'PO-5');
  assert.equal(evDone.statusLabel, 'Tuntas');
  assert.equal(evDone.actionType, 'RIWAYAT');
  // Hemat 50 * (70.000 - 65.000) = Rp 250.000
  assert.equal(evDone.selisihBoqRp, 250000);

  const poGanti = makePo({ is_ganti: true, status_dokumen: 'DIGANTI', referensi_ganti_id: 'po-rev' });
  const evGanti = evaluatePurchaseOrder(poGanti, [], [], clerkCtx, 5000000, '2026-11-24');
  assert.equal(evGanti.stateCode, 'PO-6');
  assert.equal(evGanti.actionType, 'LIHAT_PENGGANTI');

  const poBatal = makePo({ is_batal: true, status_dokumen: 'BATAL' });
  const evBatal = evaluatePurchaseOrder(poBatal, [], [], clerkCtx, 5000000, '2026-11-24');
  assert.equal(evBatal.stateCode, 'PO-7');
  assert.equal(evBatal.actionLabel, 'Rincian');
});

test('13. Proteksi Koreksi 3-Way: canBatal dan canGanti terkunci bila sudah ada penerimaan barang atau pembayaran kas', () => {
  const po = makePo();
  const evClean = evaluatePurchaseOrder(po, [], [], clerkCtx, 5000000, '2026-11-24');
  assert.equal(evClean.canBatal, true);
  assert.equal(evClean.canGanti, true);

  const evReceived = evaluatePurchaseOrder(po, [makeStockIn({ jumlah: 10 })], [], clerkCtx, 5000000, '2026-11-24');
  assert.equal(evReceived.canBatal, false);
  assert.equal(evReceived.canGanti, false);
  assert.match(evReceived.batalBlockReason || '', /penerimaan barang/i);

  const evPaid = evaluatePurchaseOrder(po, [], [makeCashOutPo({ jumlah_rp: 500000 })], clerkCtx, 5000000, '2026-11-24');
  assert.equal(evPaid.canBatal, false);
  assert.match(evPaid.batalBlockReason || '', /pembayaran kas/i);
});

test('14. Anti Alarm Palsu State Machine A (P-1): Proyek baru tanpa PO tidak pernah berstatus kritis', () => {
  const summary = computeProcurementSummaryMetrics([], [makeBoqItem()], [], [], 'Clerk', '2026-11-24');
  assert.equal(summary.healthCode, 'P-1');
  assert.equal(summary.healthLabel, 'Belum Ada PO');
  assert.equal(summary.isPoCritical, false);
  assert.equal(summary.needOrderItemsCount, 1);
});

test('15. State Machine A (P-2, P-3, P-4): Lancar, Kirim Terlambat, dan Jatuh Tempo Bayar', () => {
  const poOnTime = makePo({ estimasi_tiba: '2026-11-26', jatuh_tempo_bayar: '2026-12-04' });
  const sP2 = computeProcurementSummaryMetrics([poOnTime], [], [], [], 'Clerk', '2026-11-24');
  assert.equal(sP2.healthCode, 'P-2');
  assert.equal(sP2.isPoCritical, false);

  const poLateShip = makePo({ estimasi_tiba: '2026-11-20', jatuh_tempo_bayar: '2026-12-04' });
  const sP3 = computeProcurementSummaryMetrics([poLateShip], [], [], [], 'Clerk', '2026-11-24');
  assert.equal(sP3.healthCode, 'P-3');
  assert.equal(sP3.overdueDeliveryCount, 1);
  assert.equal(sP3.isPoCritical, false);

  const poLatePay = makePo({ estimasi_tiba: '2026-11-20', jatuh_tempo_bayar: '2026-11-22' });
  const sP4 = computeProcurementSummaryMetrics([poLatePay], [], [], [], 'Clerk', '2026-11-24');
  assert.equal(sP4.healthCode, 'P-4');
  assert.equal(sP4.overduePaymentCount, 1);
  assert.equal(sP4.isPoCritical, true);
});

test('16. Kontribusi modul PO_PENGADAAN untuk Laporan Terpadu dan helper jatuh tempo/nomor PO', () => {
  const po = makePo();
  const contrib = buildPoModuleContribution([po], [], [makeCashOutPo({ jumlah_rp: 1500000 })]);
  assert.equal(contrib.moduleCode, 'PO_PENGADAAN');
  assert.equal(contrib.status, 'AKTIF');
  assert.equal(contrib.transactionCount, 1);
  assert.equal(contrib.totalOutRp, 1500000);
  assert.equal(contrib.pendingCount, 1);

  assert.equal(computeDueDateFromTerms('2026-11-24', 'TEMPO_14'), '2026-12-08');
  assert.equal(computeDueDateFromTerms('2026-11-24', 'TUNAI_SAAT_TIBA'), null);
  assert.equal(generateNextPoNumber([po], '2026-11-24'), 'PO-20261124-002');
});
