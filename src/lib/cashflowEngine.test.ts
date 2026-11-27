import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCashMutationPayloadFromWizard,
  buildTerpaduReceiptIndex,
  computeCashSummaryMetrics,
  computeRunningCashBalances,
  countPendingCashApprovals,
  createInitialCashWizardAnswers,
  deriveBebanBiayaFromCategory,
  detectCashCategoryFromStockReceipt,
  doReceiptStoresMatch,
  evaluateBudgetCategories,
  evaluateCashRow,
  findLinkedCashMutationsForStockMutation,
  findRelatedStockMutationsForReceipt,
  findUnreconciledStockReceipts,
  getCashActionVariantClass,
  getPendingApprovalForRole,
  isCashRowExcluded,
  isClientSuppliedStockMutation,
  isStockMutationPaidViaCash,
  planKasbonSettlement,
  resolveCashEvalContext,
  resolveStockApprovalTargetTab,
  summarizeClientAdvanceReceivables,
  summarizeOpenKasbon,
  validateCashWizardStep,
  validateSerialWorkflowTransition,
} from './cashflowEngine';
import { DokumenLaporan, ItemBarang, MutasiBarang, MutasiKas, ProjectReceipt } from '../types';

const branding = {
  contractorName: 'CV. MENARA MEGAH',
  clientName: 'PT INDO MURO KENCANA',
};

const clerkPerms = {
  canIssue: true,
  canInitiateBatalGanti: true,
  canInstructBatalGanti: false,
};

const supervisorPerms = {
  canIssue: false,
  canInitiateBatalGanti: false,
  canInstructBatalGanti: true,
};

const viewerPerms = {
  canIssue: false,
  canInitiateBatalGanti: false,
  canInstructBatalGanti: false,
};

function makeCash(overrides: Partial<MutasiKas>): MutasiKas {
  return {
    id: overrides.id || 'tx-1',
    jenis: overrides.jenis || 'MASUK',
    jumlah_rp: overrides.jumlah_rp ?? 1_000_000,
    untuk_apa: overrides.untuk_apa || 'Transaksi Uji',
    kategori_keperluan: overrides.kategori_keperluan || 'Dana Termin Proyek',
    pic: overrides.pic || 'Budi',
    tanggal: overrides.tanggal || '2026-11-01T09:00:00.000Z',
    saldo_setelah: overrides.saldo_setelah ?? 0,
    status_dokumen: overrides.status_dokumen || 'DITERBITKAN',
    ...overrides,
  };
}

// 1
test('isCashRowExcluded reliably excludes BATAL and DIGANTI rows', () => {
  assert.equal(isCashRowExcluded(makeCash({})), false);
  assert.equal(isCashRowExcluded(makeCash({ is_batal: true })), true);
  assert.equal(isCashRowExcluded(makeCash({ is_ganti: true })), true);
  assert.equal(isCashRowExcluded(makeCash({ status_dokumen: 'BATAL' })), true);
  assert.equal(isCashRowExcluded(makeCash({ status_dokumen: 'DIGANTI' })), true);
  assert.equal(isCashRowExcluded(null), true);
});

// 2
test('computeRunningCashBalances sorts chronologically and returns null for excluded rows without shifting balance', () => {
  const rows: MutasiKas[] = [
    // sengaja tidak urut waktu
    makeCash({ id: 'c3', jenis: 'KELUAR', jumlah_rp: 3_000_000, tanggal: '2026-11-03T10:00:00.000Z', kategori_keperluan: 'Material' }),
    makeCash({ id: 'c2-batal', jenis: 'KELUAR', jumlah_rp: 99_000_000, tanggal: '2026-11-02T10:00:00.000Z', is_batal: true, status_dokumen: 'BATAL' }),
    makeCash({ id: 'c2-ganti', jenis: 'MASUK', jumlah_rp: 50_000_000, tanggal: '2026-11-02T11:00:00.000Z', is_ganti: true, status_dokumen: 'DIGANTI' }),
    makeCash({ id: 'c1', jenis: 'MASUK', jumlah_rp: 10_000_000, tanggal: '2026-11-01T08:00:00.000Z' }),
    makeCash({ id: 'c4', jenis: 'KELUAR', jumlah_rp: 2_500_000, tanggal: '2026-11-04T08:00:00.000Z', kategori_keperluan: 'Operasional' }),
  ];

  const balances = computeRunningCashBalances(rows);
  assert.equal(balances.get('c1'), 10_000_000);
  assert.equal(balances.get('c2-batal'), null);
  assert.equal(balances.get('c2-ganti'), null);
  assert.equal(balances.get('c3'), 7_000_000);
  assert.equal(balances.get('c4'), 4_500_000);
});

// 3
test('resolveCashEvalContext hard-locks Viewer/Pengamat privacy even if flag is true', () => {
  const viewerCtx = resolveCashEvalContext('Viewer/Pengamat', viewerPerms, branding, true);
  assert.equal(viewerCtx.partyPov, 'KLIEN');
  assert.equal(viewerCtx.authority, 'PENGAMAT_KLIEN');
  assert.equal(viewerCtx.canViewFinancials, false);
  assert.equal(viewerCtx.canIssue, false);
  assert.equal(viewerCtx.canCorrect, false);

  const clerkCtx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);
  assert.equal(clerkCtx.partyPov, 'KONTRAKTOR');
  assert.equal(clerkCtx.authority, 'EKSEKUTOR');
  assert.equal(clerkCtx.canIssue, true);
  assert.equal(clerkCtx.canViewFinancials, true);

  const foremanCtx = resolveCashEvalContext('Foreman', supervisorPerms, branding, true);
  assert.equal(foremanCtx.authority, 'PENGAWAS_INTERNAL');
  assert.equal(foremanCtx.canIssue, false);
  assert.equal(foremanCtx.canCorrect, true);
});

// 4
test('State Machine A (K-1): zero active cash transactions NEVER triggers false critical alarm', () => {
  const ctx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);
  // Bahkan jika ada baris BATAL saja, activeCount === 0 tetap K-1
  const metrics = computeCashSummaryMetrics(
    [makeCash({ id: 'void-only', is_batal: true, status_dokumen: 'BATAL', jumlah_rp: 5_000_000 })],
    [],
    [],
    ctx
  );

  assert.equal(metrics.activeCount, 0);
  assert.equal(metrics.excludedCount, 1);
  assert.equal(metrics.saldoSaatIni, 0);
  assert.equal(metrics.healthCode, 'K-1');
  assert.equal(metrics.healthLabel, 'Belum Ada Kas');
  assert.equal(metrics.isCashCritical, false); // Anti alarm palsu!
});

// 5
test('State Machine A (K-2 Sehat, K-3 Menipis, K-4 Saldo Habis)', () => {
  const ctx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);

  // K-2: Masuk 50jt, Keluar 10jt => Saldo 40jt (> ambang 5jt) => Sehat
  const k2 = computeCashSummaryMetrics(
    [
      makeCash({ id: '1', jenis: 'MASUK', jumlah_rp: 50_000_000, kategori_keperluan: 'Dana Termin Proyek' }),
      makeCash({ id: '2', jenis: 'KELUAR', jumlah_rp: 10_000_000, kategori_keperluan: 'Material' }),
    ],
    [],
    [],
    ctx
  );
  assert.equal(k2.healthCode, 'K-2');
  assert.equal(k2.healthLabel, 'Sehat');
  assert.equal(k2.isCashCritical, false);
  assert.equal(k2.saldoSaatIni, 40_000_000);

  // K-3: Masuk 50jt, Keluar 46jt => Saldo 4jt (<= ambang 5jt, > 0) => Menipis
  const k3 = computeCashSummaryMetrics(
    [
      makeCash({ id: '1', jenis: 'MASUK', jumlah_rp: 50_000_000 }),
      makeCash({ id: '2', jenis: 'KELUAR', jumlah_rp: 46_000_000, kategori_keperluan: 'Material' }),
    ],
    [],
    [],
    ctx
  );
  assert.equal(k3.healthCode, 'K-3');
  assert.equal(k3.healthLabel, 'Menipis');
  assert.equal(k3.isCashCritical, false);

  // K-4: Masuk 10jt, Keluar 10jt => Saldo 0 & activeCount > 0 => Saldo Habis (CRITICAL)
  const k4 = computeCashSummaryMetrics(
    [
      makeCash({ id: '1', jenis: 'MASUK', jumlah_rp: 10_000_000 }),
      makeCash({ id: '2', jenis: 'KELUAR', jumlah_rp: 10_000_000, kategori_keperluan: 'Material' }),
    ],
    [],
    [],
    ctx
  );
  assert.equal(k4.healthCode, 'K-4');
  assert.equal(k4.healthLabel, 'Saldo Habis');
  assert.equal(k4.isCashCritical, true);
});

// 6
test('State Machine B (T-1..T-7) produces exact Smart-Buttons for Clerk', () => {
  const clerkCtx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);

  // T-6: BATAL
  const t6 = evaluateCashRow(makeCash({ is_batal: true, status_dokumen: 'BATAL' }), clerkCtx);
  assert.equal(t6.stateCode, 'T-6');
  assert.equal(t6.actionType, 'RIWAYAT');
  assert.equal(t6.actionLabel, 'Rincian');
  assert.equal(t6.showSecondaryHistoryIcon, false);

  // T-7: DIGANTI
  const t7 = evaluateCashRow(makeCash({ is_ganti: true, status_dokumen: 'DIGANTI' }), clerkCtx);
  assert.equal(t7.stateCode, 'T-7');
  assert.equal(t7.actionType, 'LIHAT_PENGGANTI');
  assert.equal(t7.actionLabel, 'Pengganti');
  assert.equal(t7.showSecondaryHistoryIcon, false);

  // T-2: Panjar Terbuka
  const t2 = evaluateCashRow(
    makeCash({
      jenis: 'KELUAR',
      kategori_keperluan: 'Panjar / Kasbon',
      is_kasbon: true,
      status_kasbon: 'TERBUKA',
    }),
    clerkCtx
  );
  assert.equal(t2.stateCode, 'T-2');
  assert.equal(t2.actionType, 'LUNASI_PANJAR');
  assert.equal(t2.actionLabel, 'Lunasi');
  assert.equal(t2.actionVariant, 'indigo');
  assert.equal(t2.showSecondaryHistoryIcon, true);

  // T-1: Bukti Menyusul
  const t1 = evaluateCashRow(
    makeCash({ jenis: 'KELUAR', kategori_keperluan: 'Operasional', status_bukti: 'BUKTI_MENYUSUL' }),
    clerkCtx
  );
  assert.equal(t1.stateCode, 'T-1');
  assert.equal(t1.actionType, 'UNGGAH_BUKTI');
  assert.equal(t1.actionLabel, 'Bukti');
  assert.equal(t1.actionVariant, 'blue');

  // T-5: Sah TTE
  const t5 = evaluateCashRow(
    makeCash({ status_dokumen: 'MENGETAHUI', status_bukti: 'TERLAMPIR' }),
    clerkCtx
  );
  assert.equal(t5.stateCode, 'T-5');
  assert.equal(t5.statusLabel, 'Sah (TTE)');
  assert.equal(t5.actionType, 'RIWAYAT');
  assert.equal(t5.showSecondaryHistoryIcon, false);

  // T-4: Aktif Normal
  const t4 = evaluateCashRow(
    makeCash({ status_dokumen: 'DITERBITKAN', status_bukti: 'TERLAMPIR' }),
    clerkCtx
  );
  assert.equal(t4.stateCode, 'T-4');
  assert.equal(t4.actionType, 'KOREKSI');
  assert.equal(t4.actionLabel, 'Koreksi');
  assert.equal(t4.actionVariant, 'slate');
  assert.equal(t4.showSecondaryHistoryIcon, true);
});

// 7
test('Serial approval Smart-Buttons across 5 internal supervisor roles (T-3)', () => {
  const txIssued = makeCash({ id: 'a1', status_dokumen: 'DITERBITKAN' });
  const txChecked = makeCash({ id: 'a2', status_dokumen: 'DIPERIKSA' });
  const txApproved = makeCash({ id: 'a3', status_dokumen: 'DISETUJUI' });

  const foremanCtx = resolveCashEvalContext('Foreman', supervisorPerms, branding, true);
  const spvCtx = resolveCashEvalContext('Spv.', supervisorPerms, branding, true);
  const deptCtx = resolveCashEvalContext('Dept. Manager', supervisorPerms, branding, true);
  const kttCtx = resolveCashEvalContext('KTT/Proj. Manager', supervisorPerms, branding, true);
  const ceoCtx = resolveCashEvalContext('CEO/Direktur', supervisorPerms, branding, true);

  // Foreman hanya dapat Periksa pada DITERBITKAN
  assert.equal(evaluateCashRow(txIssued, foremanCtx).actionLabel, 'Periksa');
  assert.equal(evaluateCashRow(txIssued, foremanCtx).nextWorkflowTarget, 'DIPERIKSA');
  assert.equal(evaluateCashRow(txChecked, foremanCtx).actionType, 'RIWAYAT');

  // Spv. hanya dapat Setuju pada DIPERIKSA
  assert.equal(evaluateCashRow(txIssued, spvCtx).actionType, 'RIWAYAT');
  assert.equal(evaluateCashRow(txChecked, spvCtx).actionLabel, 'Setuju');
  assert.equal(evaluateCashRow(txChecked, spvCtx).nextWorkflowTarget, 'DISETUJUI');

  // Dept. Manager / KTT / CEO hanya dapat Sahkan pada DISETUJUI
  for (const ctx of [deptCtx, kttCtx, ceoCtx]) {
    assert.equal(evaluateCashRow(txChecked, ctx).actionType, 'RIWAYAT');
    const ev = evaluateCashRow(txApproved, ctx);
    assert.equal(ev.stateCode, 'T-3');
    assert.equal(ev.actionLabel, 'Sahkan');
    assert.equal(ev.actionVariant, 'teal');
    assert.equal(ev.nextWorkflowTarget, 'MENGETAHUI');
  }

  // Hitungan antrean persetujuan serial mengecualikan BATAL
  const all = [txIssued, txChecked, txApproved, makeCash({ id: 'void', status_dokumen: 'DITERBITKAN', is_batal: true })];
  assert.equal(countPendingCashApprovals(all, 'Foreman'), 1);
  assert.equal(countPendingCashApprovals(all, 'Spv.'), 1);
  assert.equal(countPendingCashApprovals(all, 'CEO/Direktur'), 1);
  assert.equal(countPendingCashApprovals(all, 'Clerk'), 0);
});

// 8
test('validateSerialWorkflowTransition forbids skipping stages and modifying voided rows', () => {
  assert.equal(validateSerialWorkflowTransition('DITERBITKAN', 'DIPERIKSA'), null);
  assert.ok(validateSerialWorkflowTransition('DITERBITKAN', 'DISETUJUI'));
  assert.ok(validateSerialWorkflowTransition('DITERBITKAN', 'MENGETAHUI'));
  assert.equal(validateSerialWorkflowTransition('DIPERIKSA', 'DISETUJUI'), null);
  assert.ok(validateSerialWorkflowTransition('DIPERIKSA', 'MENGETAHUI'));
  assert.equal(validateSerialWorkflowTransition('DISETUJUI', 'MENGETAHUI'), null);
  assert.ok(validateSerialWorkflowTransition('BATAL', 'DIPERIKSA'));
  assert.ok(validateSerialWorkflowTransition('DIGANTI', 'DIPERIKSA'));
});

// 9
test('evaluateBudgetCategories switches Smart-Button to ISI_KAS when kas is empty (K-1 / K-4) and BAYAR when available', () => {
  const clerkCtx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);
  const boqItems: ItemBarang[] = [
    {
      id: 'b1',
      kode_boq: 'I/1',
      nama_barang: 'Semen 50kg',
      kategori: 'Material Struktur',
      satuan: 'sak',
      qty_boq: 100,
      is_stock_item: true,
      has_stock_history: false,
      qty_tambahan_disetujui: 0,
      target_kebutuhan_total: 100,
      qty_masuk_total: 0,
      qty_keluar_total: 0,
      qty_pemenuhan_sisa: 100,
      progress_pemenuhan: 0,
      status_pemenuhan: 'Belum dipenuhi',
      harga_satuan: 100_000, // Pagu Material = 10jt
      stok_saat_ini: 0,
      stok_minimum: 0,
      status: 'Belum Dicatat',
    },
    {
      id: 'b2',
      kode_boq: 'IV/1',
      nama_barang: 'Upah Pemasangan',
      kategori: 'Divisi IV / Upah',
      satuan: 'ls',
      qty_boq: 1,
      is_stock_item: false,
      has_stock_history: false,
      qty_tambahan_disetujui: 0,
      target_kebutuhan_total: 1,
      qty_masuk_total: 0,
      qty_keluar_total: 0,
      qty_pemenuhan_sisa: 1,
      progress_pemenuhan: 0,
      status_pemenuhan: 'Belum dipenuhi',
      harga_satuan: 5_000_000, // Pagu Upah = 5jt
      stok_saat_ini: 0,
      stok_minimum: 0,
      status: 'Belum Dicatat',
    },
  ];

  // Kas kosong (K-1): tombol harus ISI_KAS (hijau)
  const emptyBudget = evaluateBudgetCategories([], boqItems, clerkCtx);
  assert.equal(emptyBudget.length, 8);
  const matEmpty = emptyBudget.find((b) => b.categoryKey === 'Material')!;
  assert.equal(matEmpty.paguAcuanRp, 10_000_000);
  assert.equal(matEmpty.stateCode, 'A-1');
  assert.equal(matEmpty.actionType, 'ISI_KAS');
  assert.equal(matEmpty.actionLabel, 'Isi Kas');
  assert.equal(matEmpty.actionVariant, 'emerald');

  // Kas tersedia (K-2): Material 8.5jt (85% => A-3 Waspada), Upah 6jt (> 5jt => A-4 Lebih)
  const funded = evaluateBudgetCategories(
    [
      makeCash({ id: 'm1', jenis: 'MASUK', jumlah_rp: 30_000_000 }),
      makeCash({ id: 'k1', jenis: 'KELUAR', jumlah_rp: 8_500_000, kategori_keperluan: 'Material' }),
      makeCash({ id: 'k2', jenis: 'KELUAR', jumlah_rp: 6_000_000, kategori_keperluan: 'Upah & Konsumsi' }),
    ],
    boqItems,
    clerkCtx
  );
  const matFunded = funded.find((b) => b.categoryKey === 'Material')!;
  assert.equal(matFunded.stateCode, 'A-3');
  assert.equal(matFunded.statusLabel, 'Waspada');
  assert.equal(matFunded.actionType, 'BAYAR');
  assert.equal(matFunded.actionVariant, 'amber');

  const upahOver = funded.find((b) => b.categoryKey === 'Upah & Konsumsi')!;
  assert.equal(upahOver.stateCode, 'A-4');
  assert.equal(upahOver.statusLabel, 'Lebih');
  assert.equal(upahOver.actionType, 'RIWAYAT');
  assert.equal(upahOver.showSecondaryHistoryIcon, false);
});

// 10
test('LPJ Panjar Case 1 (Belanja Riil < Panjar): zero double-counting & auto return MASUK', () => {
  const panjar = makeCash({
    id: 'p-1',
    jenis: 'KELUAR',
    jumlah_rp: 5_000_000,
    untuk_apa: 'Panjar Upah Mandor A',
    kategori_keperluan: 'Panjar / Kasbon',
    is_kasbon: true,
    status_kasbon: 'TERBUKA',
    pic: 'Mandor A',
  });

  const plan = planKasbonSettlement({
    kasbonTx: panjar,
    realSpentRp: 4_350_000,
    lpjCategory: 'Upah & Konsumsi',
    settlementDate: '2026-11-10T10:00:00.000Z',
  });

  assert.equal(plan.scenario, 'BELANJA_KURANG');
  assert.equal(plan.updatedParent.status_kasbon, 'LUNAS');
  assert.equal(plan.updatedParent.nominal_lpj, 4_350_000);
  assert.equal(plan.updatedParent.lpj_kategori_riil, 'Upah & Konsumsi');
  assert.ok(plan.followUpTransaction);
  assert.equal(plan.followUpTransaction!.jenis, 'MASUK');
  assert.equal(plan.followUpTransaction!.kategori_keperluan, 'Pengembalian Panjar');
  assert.equal(plan.followUpTransaction!.jumlah_rp, 650_000);
  assert.equal(plan.followUpTransaction!.kasbon_induk_id, 'p-1');
  assert.equal(plan.netCashImpactTotalRp, 4_350_000);

  // Simulasikan ledger penuh setelah pelunasan: modal awal 10jt -> sisa kas harus persis 5.650.000
  const ledger: MutasiKas[] = [
    makeCash({ id: 'modal', jenis: 'MASUK', jumlah_rp: 10_000_000, tanggal: '2026-11-01T08:00:00.000Z' }),
    { ...panjar, ...plan.updatedParent },
    { ...plan.followUpTransaction!, id: 'ret-1', saldo_setelah: 0 },
  ];

  const ctx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);
  const metrics = computeCashSummaryMetrics(ledger, [], [], ctx);
  assert.equal(metrics.saldoSaatIni, 5_650_000);
  assert.equal(metrics.totalKeluarUpah, 4_350_000);
  assert.equal(metrics.totalKeluarPanjarTerbuka, 0);
  assert.equal(metrics.openKasbonCount, 0);
});

// 11
test('LPJ Panjar Case 2 (Belanja Riil == Panjar): NO Rp 0 row generated (CHECK amount > 0 safe)', () => {
  const panjar = makeCash({
    id: 'p-2',
    jenis: 'KELUAR',
    jumlah_rp: 5_000_000,
    untuk_apa: 'Panjar Belanja Pipa',
    kategori_keperluan: 'Panjar / Kasbon',
    is_kasbon: true,
    status_kasbon: 'TERBUKA',
  });

  const plan = planKasbonSettlement({
    kasbonTx: panjar,
    realSpentRp: 5_000_000,
    lpjCategory: 'Material',
    settlementDate: '2026-11-11T10:00:00.000Z',
  });

  assert.equal(plan.scenario, 'BELANJA_PAS');
  assert.equal(plan.updatedParent.status_kasbon, 'LUNAS');
  assert.equal(plan.updatedParent.nominal_lpj, 5_000_000);
  assert.equal(plan.updatedParent.lpj_kategori_riil, 'Material');
  assert.equal(plan.followUpTransaction, null); // Tidak boleh ada transaksi Rp 0!

  const ledger: MutasiKas[] = [
    makeCash({ id: 'modal', jenis: 'MASUK', jumlah_rp: 10_000_000 }),
    { ...panjar, ...plan.updatedParent },
  ];
  const ctx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);
  const metrics = computeCashSummaryMetrics(ledger, [], [], ctx);
  assert.equal(metrics.saldoSaatIni, 5_000_000);
  assert.equal(metrics.totalKeluarMaterial, 5_000_000);
  assert.equal(metrics.totalKeluarPanjarTerbuka, 0);
});

// 12
test('LPJ Panjar Case 3 (Belanja Riil > Panjar): auto KELUAR top-up for shortfall & exact budget sum', () => {
  const panjar = makeCash({
    id: 'p-3',
    jenis: 'KELUAR',
    jumlah_rp: 5_000_000,
    untuk_apa: 'Panjar Borongan Plafond',
    kategori_keperluan: 'Panjar / Kasbon',
    is_kasbon: true,
    status_kasbon: 'TERBUKA',
  });

  const plan = planKasbonSettlement({
    kasbonTx: panjar,
    realSpentRp: 5_400_000,
    lpjCategory: 'Upah & Konsumsi',
    settlementDate: '2026-11-12T10:00:00.000Z',
  });

  assert.equal(plan.scenario, 'BELANJA_LEBIH');
  assert.equal(plan.updatedParent.status_kasbon, 'LUNAS');
  assert.equal(plan.updatedParent.nominal_lpj, 5_000_000);
  assert.ok(plan.followUpTransaction);
  assert.equal(plan.followUpTransaction!.jenis, 'KELUAR');
  assert.equal(plan.followUpTransaction!.jumlah_rp, 400_000);
  assert.equal(plan.followUpTransaction!.kategori_keperluan, 'Upah & Konsumsi');
  assert.equal(plan.followUpTransaction!.kasbon_induk_id, 'p-3');

  const ledger: MutasiKas[] = [
    makeCash({ id: 'modal', jenis: 'MASUK', jumlah_rp: 10_000_000 }),
    { ...panjar, ...plan.updatedParent },
    { ...plan.followUpTransaction!, id: 'topup-1', saldo_setelah: 0 },
  ];
  const ctx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);
  const metrics = computeCashSummaryMetrics(ledger, [], [], ctx);
  assert.equal(metrics.saldoSaatIni, 4_600_000); // 10jt - 5.4jt persis!
  assert.equal(metrics.totalKeluarUpah, 5_400_000); // 5jt LPJ + 400rb topup = 5.4jt!
  assert.equal(metrics.totalKeluarPanjarTerbuka, 0);
});

// 13
test('LPJ Panjar partial settlement (SEBAGIAN) keeps remaining open panjar tracked', () => {
  const panjar = makeCash({
    id: 'p-4',
    jenis: 'KELUAR',
    jumlah_rp: 5_000_000,
    kategori_keperluan: 'Panjar / Kasbon',
    is_kasbon: true,
    status_kasbon: 'TERBUKA',
  });

  const plan = planKasbonSettlement({
    kasbonTx: panjar,
    realSpentRp: 2_000_000,
    lpjCategory: 'Operasional',
    isPartial: true,
    settlementDate: '2026-11-12T10:00:00.000Z',
  });

  assert.equal(plan.scenario, 'BERTAHAP');
  assert.equal(plan.updatedParent.status_kasbon, 'SEBAGIAN');
  assert.equal(plan.updatedParent.nominal_lpj, 2_000_000);
  assert.equal(plan.remainingOpenRp, 3_000_000);

  const openList = summarizeOpenKasbon([{ ...panjar, ...plan.updatedParent }]);
  assert.equal(openList.length, 1);
  assert.equal(openList[0].sisaTerbukaRp, 3_000_000);
  assert.equal(openList[0].statusKasbon, 'SEBAGIAN');
});

// 14
test('findUnreconciledStockReceipts detects contractor invoices, excludes Jatah Klien Rp 0 & paid receipts', () => {
  const receipts: ProjectReceipt[] = [
    {
      id: 'rc-unpaid',
      project_id: 'proj-1',
      reference_no: 'NTA-001',
      nama_toko: 'TB Sinar Jaya',
      tanggal_nota: '2026-11-05',
      total_nota_fisik: 4_500_000,
      lampiran_nota_urls: ['https://example.com/nta001.jpg'],
      receipt_scope: 'BELANJA_BARANG',
    },
    {
      id: 'rc-paid',
      project_id: 'proj-1',
      reference_no: 'NTA-002',
      nama_toko: 'TB Maju',
      tanggal_nota: '2026-11-04',
      total_nota_fisik: 2_000_000,
      receipt_scope: 'TERPADU',
    },
    {
      id: 'rc-cash-only',
      project_id: 'proj-1',
      reference_no: 'KWT-009',
      nama_toko: 'SPBU',
      tanggal_nota: '2026-11-06',
      total_nota_fisik: 500_000,
      receipt_scope: 'KAS_OPERASIONAL',
    },
  ];

  const stockMutations: MutasiBarang[] = [
    {
      id: 'st-1',
      barang_id: 'b1',
      nama_barang: 'Semen 50kg',
      jenis: 'MASUK',
      jumlah: 50,
      satuan: 'sak',
      tujuan_keperluan: 'Pengadaan BOQ',
      pic_penerima_penyerah: 'Andi',
      tanggal: '2026-11-05T08:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 50,
      owner_type: 'KONTRAKTOR',
      harga_satuan_beli: 90_000,
      nomor_nota: 'NTA-001',
      nama_toko: 'TB Sinar Jaya',
      receipt_id: 'rc-unpaid',
    },
    // Jatah Klien harus dikecualikan
    {
      id: 'st-client',
      barang_id: 'b2',
      nama_barang: 'Kabel NYY',
      jenis: 'MASUK',
      jumlah: 100,
      satuan: 'm',
      tujuan_keperluan: 'Free-Issue Klien',
      pic_penerima_penyerah: 'Andi',
      tanggal: '2026-11-05T09:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 100,
      owner_type: 'KLIEN',
      status_harga: 'JATAH_KLIEN',
      harga_satuan_beli: 0,
    },
    // Nota sudah dibayar di kas lewat receipt_id
    {
      id: 'st-paid',
      barang_id: 'b3',
      nama_barang: 'Pasir',
      jenis: 'MASUK',
      jumlah: 2,
      satuan: 'rit',
      tujuan_keperluan: 'Pengadaan BOQ',
      pic_penerima_penyerah: 'Andi',
      tanggal: '2026-11-04T09:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 2,
      owner_type: 'KONTRAKTOR',
      harga_satuan_beli: 1_000_000,
      nomor_nota: 'NTA-002',
      receipt_id: 'rc-paid',
    },
    // Baris BATAL harus dikecualikan
    {
      id: 'st-void',
      barang_id: 'b4',
      nama_barang: 'Batu Split',
      jenis: 'MASUK',
      jumlah: 10,
      satuan: 'm3',
      tujuan_keperluan: 'Pengadaan BOQ',
      pic_penerima_penyerah: 'Andi',
      tanggal: '2026-11-05T10:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 0,
      owner_type: 'KONTRAKTOR',
      harga_satuan_beli: 300_000,
      is_batal: true,
      status_dokumen: 'BATAL',
    },
  ];

  const cashMutations: MutasiKas[] = [
    makeCash({
      id: 'cash-paid-nta2',
      jenis: 'KELUAR',
      jumlah_rp: 2_000_000,
      kategori_keperluan: 'Material',
      receipt_id: 'rc-paid',
      nomor_kuitansi: 'NTA-002',
    }),
  ];

  const queue = findUnreconciledStockReceipts(stockMutations, receipts, cashMutations, branding.clientName);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].receiptId, 'rc-unpaid');
  assert.equal(queue[0].receiptNo, 'NTA-001');
  assert.equal(queue[0].totalAmountRp, 4_500_000);
  assert.equal(queue[0].storeName, 'TB Sinar Jaya');
});

// 15
test('summarizeClientAdvanceReceivables calculates net client receivables excluding voided rows', () => {
  const rows: MutasiKas[] = [
    makeCash({ id: 't1', jenis: 'KELUAR', jumlah_rp: 3_000_000, kategori_keperluan: 'Talangan Klien', beban_biaya: 'KLIEN' }),
    makeCash({ id: 't2', jenis: 'KELUAR', jumlah_rp: 1_500_000, kategori_keperluan: 'Material', beban_biaya: 'KLIEN' }),
    makeCash({ id: 't3-void', jenis: 'KELUAR', jumlah_rp: 9_000_000, kategori_keperluan: 'Talangan Klien', is_batal: true }),
    makeCash({ id: 'r1', jenis: 'MASUK', jumlah_rp: 2_000_000, kategori_keperluan: 'Penggantian Talangan Klien', beban_biaya: 'KLIEN' }),
  ];

  const summary = summarizeClientAdvanceReceivables(rows);
  assert.equal(summary.totalTalanganRp, 4_500_000);
  assert.equal(summary.totalDigantiRp, 2_000_000);
  assert.equal(summary.sisaPiutangRp, 2_500_000);
  assert.equal(summary.transactions.length, 3);
});

// 16
test('deriveBebanBiayaFromCategory auto-derives exact beban_biaya for all categories', () => {
  assert.equal(deriveBebanBiayaFromCategory('KELUAR', 'Material'), 'PROYEK_BOQ');
  assert.equal(deriveBebanBiayaFromCategory('KELUAR', 'Upah & Konsumsi'), 'PROYEK_BOQ');
  assert.equal(deriveBebanBiayaFromCategory('KELUAR', 'Sewa Alat & Angkut'), 'OPERASIONAL');
  assert.equal(deriveBebanBiayaFromCategory('KELUAR', 'Operasional'), 'OPERASIONAL');
  assert.equal(deriveBebanBiayaFromCategory('KELUAR', 'Talangan Klien'), 'KLIEN');
  assert.equal(deriveBebanBiayaFromCategory('KELUAR', 'Bonus Klien'), 'BONUS_KLIEN');
  assert.equal(deriveBebanBiayaFromCategory('KELUAR', 'Panjar / Kasbon'), 'KONTRAKTOR');
  assert.equal(deriveBebanBiayaFromCategory('MASUK', 'Penggantian Talangan Klien'), 'KLIEN');
  assert.equal(deriveBebanBiayaFromCategory('MASUK', 'Dana Termin Proyek'), 'KONTRAKTOR');
});

// 17
test('Wizard express prefill from stock receipt populates 100% fields & validates balance guard', () => {
  const answers = createInitialCashWizardAnswers({
    jenis: 'KELUAR',
    defaultPic: 'Siti Clerk',
    preselectedReceipt: {
      key: 'rc-1',
      receiptId: 'rc-1',
      receiptNo: 'NTA-8821',
      storeName: 'TB Makmur',
      receiptDate: '2026-11-20',
      totalAmountRp: 7_500_000,
      attachmentUrls: ['https://example.com/nota.jpg'],
      itemSummary: 'Semen 50kg, Besi 10mm',
      itemCount: 2,
      isTalangan: false,
    },
  });

  assert.equal(answers.jenis, 'KELUAR');
  assert.equal(answers.kategori_keperluan, 'Material');
  assert.equal(answers.beban_biaya, 'PROYEK_BOQ');
  assert.equal(answers.source_module, 'MUTASI_BARANG');
  assert.equal(answers.receipt_id, 'rc-1');
  assert.equal(answers.jumlah_rp, 7_500_000);
  assert.equal(answers.status_bukti, 'REKONSILIASI_NOTA');

  // Saldo kurang -> error informatif
  const errLow = validateCashWizardStep('REVIEW', answers, 1_000_000);
  assert.ok(errLow && errLow.includes('tidak mencukupi'));

  // Saldo cukup -> valid
  assert.equal(validateCashWizardStep('REVIEW', answers, 10_000_000), null);

  const payload = buildCashMutationPayloadFromWizard(answers, '2026-11-20T12:00:00.000Z');
  assert.equal(payload.source_module, 'MUTASI_BARANG');
  assert.equal(payload.source_entity_no, 'NTA-8821');
  assert.equal(payload.receipt_id, 'rc-1');
  assert.equal(payload.is_kasbon, false);
});

// 18
test('Wizard Panjar payload auto-flags is_kasbon & status_kasbon TERBUKA and Tailwind classes are non-empty', () => {
  const answers = createInitialCashWizardAnswers({
    jenis: 'KELUAR',
    defaultPic: 'Mandor Dedi',
    preselectedCategory: 'Panjar / Kasbon',
    preselectedAmount: 3_000_000,
    preselectedPurpose: 'Panjar mingguan pekerjaan bata',
  });
  const payload = buildCashMutationPayloadFromWizard(answers, '2026-11-22T09:00:00.000Z');
  assert.equal(payload.is_kasbon, true);
  assert.equal(payload.status_kasbon, 'TERBUKA');

  for (const variant of ['emerald', 'rose', 'blue', 'indigo', 'sky', 'amber', 'teal', 'slate', 'neutral'] as const) {
    const cls = getCashActionVariantClass(variant);
    assert.ok(cls.length > 10);
  }
});

// 19
test('Multi-step LPJ Panjar with prior partial return (previousReturnedRp) prevents phantom returns & wrong direction', () => {
  const ctx = resolveCashEvalContext('Clerk', clerkPerms, branding, true);
  const modal = makeCash({ id: 'm0', jenis: 'MASUK', jumlah_rp: 10_000_000, tanggal: '2026-11-01T08:00:00Z' });
  const panjarAwal = makeCash({
    id: 'p-multi',
    jenis: 'KELUAR',
    jumlah_rp: 5_000_000,
    untuk_apa: 'Panjar Mandor Multi-Tahap',
    kategori_keperluan: 'Panjar / Kasbon',
    is_kasbon: true,
    status_kasbon: 'TERBUKA',
    pic: 'Mandor Rudi',
    tanggal: '2026-11-02T08:00:00Z',
  });

  // Tahap 1: LPJ sebagian Rp 2.000.000 + setor tunai sebagian Rp 1.000.000 => sisa terbuka Rp 2.000.000
  const step1 = planKasbonSettlement({
    kasbonTx: panjarAwal,
    realSpentRp: 2_000_000,
    lpjCategory: 'Upah & Konsumsi',
    isPartial: true,
    returnedCashRp: 1_000_000,
    settlementDate: '2026-11-05T10:00:00Z',
  });
  assert.equal(step1.scenario, 'BERTAHAP');
  assert.equal(step1.remainingOpenRp, 2_000_000);
  assert.equal(step1.followUpTransaction?.jenis, 'MASUK');
  assert.equal(step1.followUpTransaction?.jumlah_rp, 1_000_000);

  const panjarAfterStep1: MutasiKas = { ...panjarAwal, ...step1.updatedParent };
  const ret1: MutasiKas = { ...step1.followUpTransaction!, id: 'ret-step1', saldo_setelah: 0 };

  // Tahap 2A (Kurang): Belanja riil tambahan Rp 1.500.000 (total belanja 3.5jt) -> harus kembali Rp 500.000 (BUKAN 1.5jt!)
  const finalLess = planKasbonSettlement({
    kasbonTx: panjarAfterStep1,
    realSpentRp: 1_500_000,
    lpjCategory: 'Upah & Konsumsi',
    previousReturnedRp: 1_000_000,
    settlementDate: '2026-11-08T10:00:00Z',
  });
  assert.equal(finalLess.scenario, 'BELANJA_KURANG');
  assert.equal(finalLess.returnAmountRp, 500_000);
  assert.equal(finalLess.followUpTransaction?.jenis, 'MASUK');
  assert.equal(finalLess.followUpTransaction?.jumlah_rp, 500_000);
  assert.equal(finalLess.updatedParent.nominal_lpj, 3_500_000);

  const metricsLess = computeCashSummaryMetrics(
    [
      modal,
      { ...panjarAfterStep1, ...finalLess.updatedParent },
      ret1,
      { ...finalLess.followUpTransaction!, id: 'ret-step2', saldo_setelah: 0 },
    ],
    [],
    [],
    ctx
  );
  assert.equal(metricsLess.saldoSaatIni, 6_500_000); // 10jt - 3.5jt persis!
  assert.equal(metricsLess.totalKeluarUpah, 3_500_000);
  assert.equal(metricsLess.totalKeluarPanjarTerbuka, 0);

  // Tahap 2B (Pas): Belanja riil tambahan Rp 2.000.000 (total belanja 4jt == pokok efektif 5jt - 1jt) -> BELANJA_PAS, null followUp!
  const finalExact = planKasbonSettlement({
    kasbonTx: panjarAfterStep1,
    realSpentRp: 2_000_000,
    lpjCategory: 'Upah & Konsumsi',
    previousReturnedRp: 1_000_000,
    settlementDate: '2026-11-08T10:00:00Z',
  });
  assert.equal(finalExact.scenario, 'BELANJA_PAS');
  assert.equal(finalExact.followUpTransaction, null);
  assert.equal(finalExact.updatedParent.nominal_lpj, 4_000_000);

  // Tahap 2C (Lebih): Belanja riil tambahan Rp 2.300.000 (total belanja 4.3jt > 4jt efektif) -> KELUAR tambahan Rp 300.000!
  const finalOver = planKasbonSettlement({
    kasbonTx: panjarAfterStep1,
    realSpentRp: 2_300_000,
    lpjCategory: 'Upah & Konsumsi',
    previousReturnedRp: 1_000_000,
    settlementDate: '2026-11-08T10:00:00Z',
  });
  assert.equal(finalOver.scenario, 'BELANJA_LEBIH');
  assert.equal(finalOver.topUpAmountRp, 300_000);
  assert.equal(finalOver.followUpTransaction?.jenis, 'KELUAR');
  assert.equal(finalOver.followUpTransaction?.jumlah_rp, 300_000);
  assert.equal(finalOver.updatedParent.nominal_lpj, 4_000_000);

  const metricsOver = computeCashSummaryMetrics(
    [
      modal,
      { ...panjarAfterStep1, ...finalOver.updatedParent },
      ret1,
      { ...finalOver.followUpTransaction!, id: 'topup-step2', saldo_setelah: 0 },
    ],
    [],
    [],
    ctx
  );
  assert.equal(metricsOver.saldoSaatIni, 5_700_000); // 10jt - 4.3jt persis!
  assert.equal(metricsOver.totalKeluarUpah, 4_300_000); // 4jt LPJ + 300rb topup = 4.3jt!
  assert.equal(metricsOver.totalKeluarPanjarTerbuka, 0);
});

// 20
test('findUnreconciledStockReceipts excludes owner_type IMK, cancelled receipt links, and prevents cross-store duplicate receiptNo collisions', () => {
  const receipts: ProjectReceipt[] = [
    {
      id: 'rc-toko-a',
      project_id: 'p1',
      reference_no: '001',
      nama_toko: 'TB Sinar A',
      tanggal_nota: '2026-11-10',
      total_nota_fisik: 1_000_000,
      receipt_scope: 'BELANJA_BARANG',
    },
    {
      id: 'rc-toko-b',
      project_id: 'p1',
      reference_no: '001',
      nama_toko: 'TB Makmur B',
      tanggal_nota: '2026-11-11',
      total_nota_fisik: 2_500_000,
      receipt_scope: 'BELANJA_BARANG',
    },
    {
      id: 'rc-voided-stock',
      project_id: 'p1',
      reference_no: '999',
      nama_toko: 'TB Batal',
      tanggal_nota: '2026-11-12',
      total_nota_fisik: 3_000_000,
      receipt_scope: 'BELANJA_BARANG',
    },
  ];

  const stockMutations: MutasiBarang[] = [
    {
      id: 's-imk',
      barang_id: 'b-imk',
      nama_barang: 'Kabel Free-Issue IMK',
      jenis: 'MASUK',
      jumlah: 10,
      satuan: 'roll',
      tujuan_keperluan: 'Pasokan Klien',
      pic_penerima_penyerah: 'Andi',
      tanggal: '2026-11-10T08:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 10,
      owner_type: 'IMK', // Nilai aktual constraint DB!
      harga_satuan_beli: 500_000,
      total_nota_fisik: 5_000_000,
      nomor_nota: 'SJ-IMK-01',
      nama_toko: 'Gudang IMK',
    },
    {
      id: 's-void',
      barang_id: 'b-v',
      nama_barang: 'Batu Split',
      jenis: 'MASUK',
      jumlah: 5,
      satuan: 'm3',
      tujuan_keperluan: 'Salah Input',
      pic_penerima_penyerah: 'Andi',
      tanggal: '2026-11-12T08:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 5,
      owner_type: 'KONTRAKTOR',
      harga_satuan_beli: 600_000,
      receipt_id: 'rc-voided-stock',
      is_batal: true,
      status_dokumen: 'BATAL',
    },
  ];

  // Pembayaran kas HANYA untuk TB Sinar A No. 001 (tidak boleh menyembunyikan TB Makmur B No. 001!)
  const cashMutations: MutasiKas[] = [
    makeCash({
      id: 'c-pay-a',
      jenis: 'KELUAR',
      jumlah_rp: 1_000_000,
      kategori_keperluan: 'Material',
      nomor_kuitansi: '001',
      nama_toko: 'TB Sinar A',
    }),
  ];

  const queue = findUnreconciledStockReceipts(stockMutations, receipts, cashMutations, branding.clientName);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].receiptId, 'rc-toko-b');
  assert.equal(queue[0].storeName, 'TB Makmur B');

  // Juga verifikasi validateSerialWorkflowTransition menolak status mundur/tidak valid
  assert.ok(validateSerialWorkflowTransition('DISETUJUI', 'DITERBITKAN'));
  assert.ok(validateSerialWorkflowTransition('DITERBITKAN', 'DRAFT'));
});

// 21
test('summarizeClientAdvanceReceivables includes LPJ-reclassified Panjar for Talangan Klien at nominal_lpj only', () => {
  const rows: MutasiKas[] = [
    makeCash({
      id: 'p-talangan',
      jenis: 'KELUAR',
      jumlah_rp: 5_000_000,
      kategori_keperluan: 'Panjar / Kasbon',
      is_kasbon: true,
      status_kasbon: 'LUNAS',
      nominal_lpj: 3_200_000,
      lpj_kategori_riil: 'Talangan Klien',
    }),
    makeCash({
      id: 'in-ganti',
      jenis: 'MASUK',
      jumlah_rp: 1_200_000,
      kategori_keperluan: 'Penggantian Talangan Klien',
      beban_biaya: 'KLIEN',
    }),
  ];
  const summary = summarizeClientAdvanceReceivables(rows);
  assert.equal(summary.totalTalanganRp, 3_200_000);
  assert.equal(summary.totalDigantiRp, 1_200_000);
  assert.equal(summary.sisaPiutangRp, 2_000_000);
});

// 22
test('isStockMutationPaidViaCash & findLinkedCashMutationsForStockMutation prevent cross-store receiptNo collision and respect distinct receipt_ids', () => {
  const receipts: ProjectReceipt[] = [
    {
      id: 'rc-a',
      project_id: 'p1',
      reference_no: 'INV-001',
      nama_toko: 'TB. Sinar A',
      tanggal_nota: '2026-11-10',
      total_nota_fisik: 1_500_000,
      receipt_scope: 'TERPADU',
    },
    {
      id: 'rc-b',
      project_id: 'p1',
      reference_no: 'INV-001',
      nama_toko: 'TB Makmur B',
      tanggal_nota: '2026-11-11',
      total_nota_fisik: 2_000_000,
      receipt_scope: 'BELANJA_BARANG',
    },
  ];

  const stockStoreA: MutasiBarang = {
    id: 'st-a',
    barang_id: 'b1',
    nama_barang: 'Semen 50kg',
    jenis: 'MASUK',
    jumlah: 20,
    satuan: 'sak',
    tujuan_keperluan: 'Pengadaan BOQ',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-10T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 20,
    owner_type: 'KONTRAKTOR',
    harga_satuan_beli: 75_000,
    nomor_nota: 'INV-001',
    nama_toko: 'TB Sinar A', // tanpa titik — harus tetap cocok dengan 'TB. Sinar A'
  };

  const stockStoreB: MutasiBarang = {
    ...stockStoreA,
    id: 'st-b',
    nama_barang: 'Cat Tembok',
    nama_toko: 'TB Makmur B',
    receipt_id: 'rc-b',
  };

  const stockStoreBNoId: MutasiBarang = {
    ...stockStoreB,
    id: 'st-b-legacy',
    receipt_id: undefined,
  };

  const stockOutSameNo: MutasiBarang = {
    ...stockStoreA,
    id: 'st-out',
    jenis: 'KELUAR',
  };

  const cashMutations: MutasiKas[] = [
    makeCash({
      id: 'c-pay-a',
      jenis: 'KELUAR',
      jumlah_rp: 1_500_000,
      kategori_keperluan: 'Material',
      nomor_kuitansi: 'INV-001',
      nama_toko: 'TB. Sinar A',
      receipt_id: 'rc-a',
    }),
    // Baris MASUK dengan nomor sama tidak boleh dihitung pembayaran nota
    makeCash({
      id: 'c-in-noise',
      jenis: 'MASUK',
      jumlah_rp: 2_000_000,
      kategori_keperluan: 'Dana Termin Proyek',
      nomor_kuitansi: 'INV-001',
      nama_toko: 'TB Makmur B',
    }),
    // Baris BATAL untuk TB Makmur B tidak boleh dihitung terbayar
    makeCash({
      id: 'c-void-b',
      jenis: 'KELUAR',
      jumlah_rp: 2_000_000,
      kategori_keperluan: 'Material',
      nomor_kuitansi: 'INV-001',
      nama_toko: 'TB Makmur B',
      is_batal: true,
      status_dokumen: 'BATAL',
    }),
  ];

  const idx = buildTerpaduReceiptIndex(receipts, cashMutations);

  assert.equal(doReceiptStoresMatch('TB. Sinar A', 'TB Sinar A'), true);
  assert.equal(doReceiptStoresMatch('TB. Sinar A', 'TB Makmur B'), false);

  // Store A cocok; Store B (dengan maupun tanpa receipt_id) & mutasi KELUAR tidak boleh cocok
  assert.equal(isStockMutationPaidViaCash(stockStoreA, idx, branding.clientName), true);
  assert.equal(isStockMutationPaidViaCash(stockStoreB, idx, branding.clientName), false);
  assert.equal(isStockMutationPaidViaCash(stockStoreBNoId, idx, branding.clientName), false);
  assert.equal(isStockMutationPaidViaCash(stockOutSameNo, idx, branding.clientName), false);

  const linkedA = findLinkedCashMutationsForStockMutation(stockStoreA, cashMutations, branding.clientName);
  assert.deepEqual(linkedA.map((c) => c.id), ['c-pay-a']);

  const linkedB = findLinkedCashMutationsForStockMutation(stockStoreB, cashMutations, branding.clientName);
  assert.deepEqual(linkedB, []);

  const linkedBNoId = findLinkedCashMutationsForStockMutation(stockStoreBNoId, cashMutations, branding.clientName);
  assert.deepEqual(linkedBNoId, []);

  // Bahkan jika kas untuk rc-a punya nama_toko kosong, distinct receipt_id rc-b tetap tidak boleh cocok
  const cashBlankStoreForA: MutasiKas[] = [
    makeCash({
      id: 'c-pay-a-blank',
      jenis: 'KELUAR',
      jumlah_rp: 1_500_000,
      kategori_keperluan: 'Material',
      nomor_kuitansi: 'INV-001',
      nama_toko: '',
      receipt_id: 'rc-a',
    }),
  ];
  const idxBlank = buildTerpaduReceiptIndex([], cashBlankStoreForA);
  assert.equal(isStockMutationPaidViaCash(stockStoreB, idxBlank, branding.clientName), false);
  assert.deepEqual(findLinkedCashMutationsForStockMutation(stockStoreB, cashBlankStoreForA, branding.clientName), []);
});

// 23
test('Jatah Klien (IMK / KLIEN / JATAH_KLIEN / client source_name) is NEVER marked Terbayar Kas or linked to cash', () => {
  const cashMutations: MutasiKas[] = [
    makeCash({
      id: 'c-1',
      jenis: 'KELUAR',
      jumlah_rp: 1_000_000,
      kategori_keperluan: 'Material',
      nomor_kuitansi: 'SJ-001',
      nama_toko: '',
    }),
  ];
  const idx = buildTerpaduReceiptIndex([], cashMutations);

  const baseMut: MutasiBarang = {
    id: 'st-klien',
    barang_id: 'b-k',
    nama_barang: 'Kabel Free-Issue',
    jenis: 'MASUK',
    jumlah: 10,
    satuan: 'roll',
    tujuan_keperluan: 'Pasokan Klien',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-12T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 10,
    nomor_nota: 'SJ-001',
  };

  const variants: MutasiBarang[] = [
    { ...baseMut, id: 'v1', owner_type: 'IMK' },
    { ...baseMut, id: 'v2', owner_type: 'KLIEN' },
    { ...baseMut, id: 'v3', owner_type: 'KONTRAKTOR', status_harga: 'JATAH_KLIEN' },
    { ...baseMut, id: 'v4', owner_type: 'KONTRAKTOR', source_name: 'Pasokan PT INDO MURO KENCANA' },
  ];

  for (const mut of variants) {
    assert.equal(isClientSuppliedStockMutation(mut, branding.clientName), true);
    assert.equal(isStockMutationPaidViaCash(mut, idx, branding.clientName), false);
    assert.deepEqual(findLinkedCashMutationsForStockMutation(mut, cashMutations, branding.clientName), []);
  }
});

// 24
test('findRelatedStockMutationsForReceipt isolates same receiptNo across two different stores', () => {
  const m1: MutasiBarang = {
    id: 'm1',
    barang_id: 'b1',
    nama_barang: 'Semen',
    jenis: 'MASUK',
    jumlah: 10,
    satuan: 'sak',
    tujuan_keperluan: 'BOQ',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-10T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 10,
    nomor_nota: '001',
    nama_toko: 'TB Sinar A',
  };
  const m2: MutasiBarang = { ...m1, id: 'm2', nama_barang: 'Besi', nama_toko: 'TB. Sinar A' };
  const m3: MutasiBarang = { ...m1, id: 'm3', nama_barang: 'Cat', nama_toko: 'TB Makmur B' };
  const m4Void: MutasiBarang = { ...m1, id: 'm4', is_batal: true, status_dokumen: 'BATAL' };

  const relatedA = findRelatedStockMutationsForReceipt(m1, [m1, m2, m3, m4Void]);
  assert.deepEqual(relatedA.map((m) => m.id), ['m1', 'm2']);

  const relatedB = findRelatedStockMutationsForReceipt(m3, [m1, m2, m3, m4Void]);
  assert.deepEqual(relatedB.map((m) => m.id), ['m3']);
});

// 25
test('resolveStockApprovalTargetTab routes to OFFICIAL_DOCUMENTS when only MUTASI_STOK documents await approval', () => {
  const pendingRow: MutasiBarang = {
    id: 'st-pending',
    barang_id: 'b1',
    nama_barang: 'Semen',
    jenis: 'MASUK',
    jumlah: 10,
    satuan: 'sak',
    tujuan_keperluan: 'BOQ',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-10T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 10,
    status_dokumen: 'DITERBITKAN',
  };
  const approvedRow: MutasiBarang = {
    ...pendingRow,
    id: 'st-approved',
    status_dokumen: 'DIPERIKSA',
  };
  const pendingStockDoc: DokumenLaporan = {
    id: 'BA-STOK-01',
    judul: 'BA Mutasi Barang',
    jenis: 'MUTASI_STOK',
    status: 'ISSUED',
    periode_awal: '2026-11-01',
    periode_akhir: '2026-11-30',
    penandatangan_nama: 'Clerk',
    penandatangan_jabatan: 'Clerk',
    penandatangan_email: 'clerk@example.com',
    dibuat_pada: '2026-11-10T08:00:00Z',
    hash_keamanan: 'h1',
    total_transaksi: 10,
    ringkasan_nilai_rp: 0,
    qr_payload: 'DOC:BA-STOK-01',
    status_dokumen: 'DITERBITKAN',
  };
  const pendingCashDoc: DokumenLaporan = {
    ...pendingStockDoc,
    id: 'BA-KAS-01',
    jenis: 'MUTASI_KAS',
  };

  // Hanya dokumen MUTASI_STOK yang menunggu Foreman -> arahkan ke OFFICIAL_DOCUMENTS
  assert.equal(
    resolveStockApprovalTargetTab([approvedRow], [pendingStockDoc], 'Foreman'),
    'OFFICIAL_DOCUMENTS'
  );

  // Jika ada baris stok pending + dokumen pending -> prioritaskan MUTATION_HISTORY
  assert.equal(
    resolveStockApprovalTargetTab([pendingRow], [pendingStockDoc], 'Foreman'),
    'MUTATION_HISTORY'
  );

  // Untuk Spv., baris DIPERIKSA menunggu -> MUTATION_HISTORY
  assert.equal(
    resolveStockApprovalTargetTab([approvedRow], [pendingStockDoc], 'Spv.'),
    'MUTATION_HISTORY'
  );

  // Dokumen MUTASI_KAS saja tidak memicu OFFICIAL_DOCUMENTS untuk Mutasi Barang
  assert.equal(
    resolveStockApprovalTargetTab([], [pendingCashDoc], 'Foreman'),
    'MUTATION_HISTORY'
  );

  // Dokumen MUTASI_STOK yang BATAL diabaikan
  assert.equal(
    resolveStockApprovalTargetTab(
      [],
      [{ ...pendingStockDoc, is_batal: true, status_dokumen: 'BATAL' }],
      'Foreman'
    ),
    'MUTATION_HISTORY'
  );
});

// 26
test('doReceiptStoresMatch blocks substring & blank-store collisions while matching normalized store prefixes', () => {
  // Prefiks & variasi tanda baca toko yang sama harus cocok
  assert.equal(doReceiptStoresMatch('TB. Sinar A', 'TB Sinar A'), true);
  assert.equal(doReceiptStoresMatch('Lainnya: TB Sinar A', 'Toko Sinar A'), true);
  assert.equal(doReceiptStoresMatch('CV. Sinar Jaya', 'Sinar Jaya'), true);

  // Nama toko berbeda yang saling mengandung substring DILARANG cocok
  assert.equal(doReceiptStoresMatch('TB Sinar A', 'TB Sinar Abadi'), false);
  assert.equal(doReceiptStoresMatch('TB A', 'TB Abadi'), false);
  assert.equal(doReceiptStoresMatch('TB Sinar', 'TB Sinar B'), false);

  // Kas tanpa nama toko DILARANG cocok dengan nota toko bernama (mencegah tabrakan lintas toko)
  assert.equal(doReceiptStoresMatch('TB Sinar A', ''), false);
  assert.equal(doReceiptStoresMatch('TB Sinar A', 'Andi / Kas Lapangan'), false);
  assert.equal(doReceiptStoresMatch('', 'TB Makmur B'), false);

  // Dua baris legacy sama-sama tanpa nama toko tetap cocok
  assert.equal(doReceiptStoresMatch('', ''), true);
  assert.equal(doReceiptStoresMatch('Pengadaan Kontraktor (CV. X)', 'Kas Lapangan'), true);
});

// 27
test('Blank-store petty cash row does NOT mark named-store invoices as Terbayar Kas or hide them from reconciliation', () => {
  const storeAStock: MutasiBarang = {
    id: 'st-named-a',
    barang_id: 'b1',
    nama_barang: 'Semen 50kg',
    jenis: 'MASUK',
    jumlah: 10,
    satuan: 'sak',
    tujuan_keperluan: 'Pengadaan BOQ',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-10T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 10,
    owner_type: 'KONTRAKTOR',
    harga_satuan_beli: 75_000,
    nomor_nota: '001',
    nama_toko: 'TB Sinar A',
  };
  const storeAbadiStock: MutasiBarang = {
    ...storeAStock,
    id: 'st-named-abadi',
    nama_barang: 'Besi 10mm',
    nama_toko: 'TB Sinar Abadi',
  };
  const blankStoreStock: MutasiBarang = {
    ...storeAStock,
    id: 'st-blank',
    nama_toko: undefined,
    source_name: 'Pengadaan Kontraktor (CV. MENARA MEGAH)',
  };

  const cashBlankOperasional = makeCash({
    id: 'c-blank-ops',
    jenis: 'KELUAR',
    jumlah_rp: 100_000,
    kategori_keperluan: 'Operasional',
    nomor_kuitansi: '001',
    nama_toko: '',
  });
  const cashBlankMaterial = makeCash({
    id: 'c-blank-mat',
    jenis: 'KELUAR',
    jumlah_rp: 750_000,
    kategori_keperluan: 'Material',
    nomor_kuitansi: '001',
    nama_toko: '',
  });
  const cashPayA = makeCash({
    id: 'c-pay-sinar-a',
    jenis: 'KELUAR',
    jumlah_rp: 750_000,
    kategori_keperluan: 'Material',
    nomor_kuitansi: '001',
    nama_toko: 'TB. Sinar A',
  });

  // Kas Operasional kosong toko TIDAK mencocokkan nota apa pun (baik toko bernama maupun legacy kosong toko)
  const idxOps = buildTerpaduReceiptIndex([], [cashBlankOperasional]);
  assert.equal(isStockMutationPaidViaCash(storeAStock, idxOps, branding.clientName), false);
  assert.equal(isStockMutationPaidViaCash(blankStoreStock, idxOps, branding.clientName), false);
  assert.deepEqual(findLinkedCashMutationsForStockMutation(storeAStock, [cashBlankOperasional], branding.clientName), []);
  assert.deepEqual(findLinkedCashMutationsForStockMutation(blankStoreStock, [cashBlankOperasional], branding.clientName), []);

  // Kas Material kosong toko hanya mencocokkan legacy kosong toko, BUKAN toko bernama "TB Sinar A" / "TB Sinar Abadi"
  const idxBlankMat = buildTerpaduReceiptIndex([], [cashBlankMaterial]);
  assert.equal(isStockMutationPaidViaCash(storeAStock, idxBlankMat, branding.clientName), false);
  assert.equal(isStockMutationPaidViaCash(storeAbadiStock, idxBlankMat, branding.clientName), false);
  assert.equal(isStockMutationPaidViaCash(blankStoreStock, idxBlankMat, branding.clientName), true);

  // Pembayaran "TB. Sinar A" TIDAK mencocokkan "TB Sinar Abadi" (anti tabrakan substring)
  const idxPayA = buildTerpaduReceiptIndex([], [cashPayA]);
  assert.equal(isStockMutationPaidViaCash(storeAStock, idxPayA, branding.clientName), true);
  assert.equal(isStockMutationPaidViaCash(storeAbadiStock, idxPayA, branding.clientName), false);
  const queue = findUnreconciledStockReceipts([storeAStock, storeAbadiStock], [], [cashPayA], branding.clientName);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].storeName, 'TB Sinar Abadi');
});

// 28
test('Contractor hardware store containing a single client-name token (e.g. "TB Indo Makmur") is NOT misclassified as Jatah Klien', () => {
  const contractorIndoStore: MutasiBarang = {
    id: 'st-indo-store',
    barang_id: 'b1',
    nama_barang: 'Semen 50kg',
    jenis: 'MASUK',
    jumlah: 20,
    satuan: 'sak',
    tujuan_keperluan: 'Pengadaan BOQ',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-12T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 20,
    owner_type: 'KONTRAKTOR',
    status_harga: 'TERCATAT',
    harga_satuan_beli: 75_000,
    source_name: 'Lainnya: TB Indo Makmur',
    nama_toko: 'TB Indo Makmur',
    nomor_nota: 'INV-INDO-01',
  };

  assert.equal(isClientSuppliedStockMutation(contractorIndoStore, 'PT INDO MURO KENCANA'), false);

  const queue = findUnreconciledStockReceipts([contractorIndoStore], [], [], 'PT INDO MURO KENCANA');
  assert.equal(queue.length, 1);
  assert.equal(queue[0].storeName, 'TB Indo Makmur');
  assert.equal(queue[0].totalAmountRp, 1_500_000);

  const cashPay = makeCash({
    id: 'c-indo-pay',
    jenis: 'KELUAR',
    jumlah_rp: 1_500_000,
    kategori_keperluan: 'Material',
    nomor_kuitansi: 'INV-INDO-01',
    nama_toko: 'TB Indo Makmur',
  });
  const idx = buildTerpaduReceiptIndex([], [cashPay]);
  assert.equal(isStockMutationPaidViaCash(contractorIndoStore, idx, 'PT INDO MURO KENCANA'), true);
  assert.deepEqual(
    findLinkedCashMutationsForStockMutation(contractorIndoStore, [cashPay], 'PT INDO MURO KENCANA').map((c) => c.id),
    ['c-indo-pay']
  );
});

// 29
test('findRelatedStockMutationsForReceipt isolates MASUK vs KELUAR and Kontraktor vs Jatah Klien with identical document number', () => {
  const masukKontraktor: MutasiBarang = {
    id: 'm-in-k',
    barang_id: 'b1',
    nama_barang: 'Semen',
    jenis: 'MASUK',
    jumlah: 10,
    satuan: 'sak',
    tujuan_keperluan: 'BOQ',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-10T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 10,
    owner_type: 'KONTRAKTOR',
    nomor_nota: 'DOC-001',
    nama_toko: 'TB Sinar A',
  };
  const keluarSameNo: MutasiBarang = {
    ...masukKontraktor,
    id: 'm-out-same',
    jenis: 'KELUAR',
  };
  const masukKlienSameNo: MutasiBarang = {
    ...masukKontraktor,
    id: 'm-in-klien',
    owner_type: 'IMK',
  };

  const related = findRelatedStockMutationsForReceipt(
    masukKontraktor,
    [masukKontraktor, keluarSameNo, masukKlienSameNo],
    branding.clientName
  );
  assert.deepEqual(related.map((m) => m.id), ['m-in-k']);
});

// 30
test('findUnreconciledStockReceipts prevents double-billing for stock receipts whose PO is paid via PO_PENGADAAN', () => {
  const rcPo: ProjectReceipt = {
    id: 'rc-po-1',
    project_id: 'p1',
    reference_no: 'SJ-PO-01',
    nama_toko: 'TB Sinar Bangunan',
    tanggal_nota: '2026-11-22',
    total_nota_fisik: 3_250_000,
    receipt_scope: 'BELANJA_BARANG',
  };
  const stockFromPo: MutasiBarang = {
    id: 'sm-po-1',
    barang_id: 'b1',
    nama_barang: 'Semen 50kg',
    jenis: 'MASUK',
    jumlah: 50,
    satuan: 'sak',
    tujuan_keperluan: 'Penerimaan PO-20261124-001',
    pic_penerima_penyerah: 'Budi',
    tanggal: '2026-11-22T09:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 50,
    owner_type: 'KONTRAKTOR',
    harga_satuan_beli: 65_000,
    total_nota_fisik: 3_250_000,
    nomor_nota: 'SJ-PO-01',
    nama_toko: 'TB Sinar Bangunan',
    receipt_id: 'rc-po-1',
    po_id: 'po-1',
    po_item_id: 'poi-1',
  };
  const cashPayPo = makeCash({
    id: 'c-po-pay-1',
    jenis: 'KELUAR',
    jumlah_rp: 3_250_000,
    kategori_keperluan: 'Material',
    source_module: 'PO_PENGADAAN',
    source_entity_id: 'po-1',
    source_entity_no: 'PO-20261124-001',
    nama_toko: 'TB Sinar Bangunan',
  });

  // Setelah PO lunas lewat PO_PENGADAAN, tidak boleh muncul ganda di Tab 2 Rekonsiliasi Kas
  const queuePaid = findUnreconciledStockReceipts([stockFromPo], [rcPo], [cashPayPo], branding.clientName);
  assert.equal(queuePaid.length, 0);

  // Dan mutasi gudang tersebut otomatis ditandai Terbayar Kas + tertaut ke transaksi kas PO
  const idx = buildTerpaduReceiptIndex([rcPo], [cashPayPo]);
  assert.equal(isStockMutationPaidViaCash(stockFromPo, idx, branding.clientName), true);
  assert.deepEqual(
    findLinkedCashMutationsForStockMutation(stockFromPo, [cashPayPo], branding.clientName).map((c) => c.id),
    ['c-po-pay-1']
  );
});

test('auto-reconciles stock/manpower receipt with blank receipt number via generated INV- ref and matches smart category', () => {
  const mutId = 'cd8b5ca1-dbc3-4958-a312-81c7e2604c4c';
  const manpowerStock: MutasiBarang = {
    id: mutId,
    barang_id: 'b-manpower',
    nama_barang: 'Tenaga Kerja Sipil',
    jenis: 'MASUK',
    jumlah: 500,
    satuan: 'oh',
    tujuan_keperluan: 'Pekerjaan Sipil',
    pic_penerima_penyerah: 'Sumarlin',
    tanggal: '2026-11-23T03:42:16Z',
    stok_sebelum: 0,
    stok_sesudah: 500,
    owner_type: 'KONTRAKTOR',
    harga_satuan_beli: 280_000,
    nama_toko: 'Pengadaan Kontraktor (CV. MENARA MEGAH)',
    // nomor_nota & nomor_surat_jalan kosong
  };

  // 1. Sebelum dibayar: masuk ke antrean rekonsiliasi dengan ref INV-CD8B5C
  const queueBefore = findUnreconciledStockReceipts([manpowerStock], [], [], branding.clientName);
  assert.equal(queueBefore.length, 1);
  assert.equal(queueBefore[0].receiptNo, 'INV-CD8B5C');
  assert.equal(queueBefore[0].totalAmountRp, 140_000_000);
  assert.deepEqual(queueBefore[0].mutationIds, [mutId]);

  // 2. Deteksi cerdas kategori: Tenaga Kerja otomatis menjadi Upah & Konsumsi (bukan Material)
  const smartCat = detectCashCategoryFromStockReceipt(queueBefore[0]);
  assert.equal(smartCat, 'Upah & Konsumsi');

  // 3. Wizard answers otomatis mengisi kategori Upah & Konsumsi dan source_entity_id = mutId
  const wizardAnswers = createInitialCashWizardAnswers({
    jenis: 'KELUAR',
    defaultPic: 'Clerk',
    preselectedReceipt: queueBefore[0],
  });
  assert.equal(wizardAnswers.kategori_keperluan, 'Upah & Konsumsi');
  assert.equal(wizardAnswers.source_entity_id, mutId);
  assert.equal(wizardAnswers.source_entity_no, 'INV-CD8B5C');

  // 4. Setelah transaksi kas dicatat (dengan ref INV-CD8B5C):
  const cashPayManpower = makeCash({
    id: 'c-pay-manpower',
    jenis: 'KELUAR',
    jumlah_rp: 140_000_000,
    kategori_keperluan: 'Upah & Konsumsi',
    source_module: 'MUTASI_BARANG',
    source_entity_id: mutId,
    source_entity_no: 'INV-CD8B5C',
    nomor_kuitansi: 'INV-CD8B5C',
    nama_toko: 'Pengadaan Kontraktor (CV. MENARA MEGAH)',
  });

  // Antrean rekonsiliasi harus bersih (0 antrean)
  const queueAfter = findUnreconciledStockReceipts([manpowerStock], [], [cashPayManpower], branding.clientName);
  assert.equal(queueAfter.length, 0);

  // Status mutasi barang harus Terbayar Kas
  const index = buildTerpaduReceiptIndex([], [cashPayManpower]);
  assert.equal(isStockMutationPaidViaCash(manpowerStock, index, branding.clientName), true);
});

test('Wewenang Dinamis RFIN-B & Preset Klerk Mandiri Lapangan (Solo / All-in-One)', () => {
  const soloPerms = {
    canIssue: true,
    canInitiateBatalGanti: true,
    canInstructBatalGanti: true,
    canCheck: true,
    canApprove: true,
    canAcknowledge: true,
  };

  // 1. Klerk standar tanpa wewenang kustom tidak mendapatkan giliran persetujuan
  assert.equal(getPendingApprovalForRole('DITERBITKAN', 'Clerk'), null);
  assert.equal(getPendingApprovalForRole('DIPERIKSA', 'Clerk'), null);
  assert.equal(getPendingApprovalForRole('DISETUJUI', 'Clerk'), null);

  // 2. Klerk Solo Lapangan dengan custom_permissions mendapatkan giliran di setiap tahap
  const turn1 = getPendingApprovalForRole('DITERBITKAN', 'Clerk', soloPerms);
  assert.ok(turn1);
  assert.equal(turn1.action, 'PERIKSA');
  assert.equal(turn1.nextTarget, 'DIPERIKSA');

  const turn2 = getPendingApprovalForRole('DIPERIKSA', 'Clerk', soloPerms);
  assert.ok(turn2);
  assert.equal(turn2.action, 'SETUJU');
  assert.equal(turn2.nextTarget, 'DISETUJUI');

  const turn3 = getPendingApprovalForRole('DISETUJUI', 'Clerk', soloPerms);
  assert.ok(turn3);
  assert.equal(turn3.action, 'SAHKAN');
  assert.equal(turn3.nextTarget, 'MENGETAHUI');

  // 3. Wewenang parsial kustom: CSA hanya memberikan canCheck kepada jabatan tertentu
  const checkOnlyPerms = { canCheck: true, canApprove: false, canAcknowledge: false };
  assert.equal(getPendingApprovalForRole('DITERBITKAN', 'Clerk', checkOnlyPerms)?.action, 'PERIKSA');
  assert.equal(getPendingApprovalForRole('DIPERIKSA', 'Clerk', checkOnlyPerms), null);
  assert.equal(getPendingApprovalForRole('DISETUJUI', 'Clerk', checkOnlyPerms), null);

  // 4. Hitungan antrean (countPendingCashApprovals & countPendingStockApprovals) akurat untuk Klerk Solo
  const tx1 = makeCash({ id: 'c1', jenis: 'KELUAR', jumlah_rp: 500_000, status_dokumen: 'DITERBITKAN' });
  const tx2 = makeCash({ id: 'c2', jenis: 'KELUAR', jumlah_rp: 1_000_000, status_dokumen: 'DIPERIKSA' });
  const tx3 = makeCash({ id: 'c3', jenis: 'KELUAR', jumlah_rp: 750_000, status_dokumen: 'DISETUJUI' });
  const tx4 = makeCash({ id: 'c4', jenis: 'KELUAR', jumlah_rp: 200_000, status_dokumen: 'MENGETAHUI' });

  // Klerk biasa: 0 antrean
  assert.equal(countPendingCashApprovals([tx1, tx2, tx3, tx4], 'Clerk'), 0);

  // Klerk Solo: 3 antrean aktif (DITERBITKAN, DIPERIKSA, DISETUJUI)
  assert.equal(countPendingCashApprovals([tx1, tx2, tx3, tx4], 'Clerk', soloPerms), 3);

  // 5. Smart-Button evaluateCashRow menghasilkan tombol APPROVE yang tepat untuk Klerk Solo
  const soloCtx = resolveCashEvalContext('Clerk', soloPerms, branding, true);
  const evalRow1 = evaluateCashRow(tx1, soloCtx);
  assert.equal(evalRow1.actionType, 'APPROVE');
  assert.equal(evalRow1.actionLabel, 'Periksa');
  assert.equal(evalRow1.nextWorkflowTarget, 'DIPERIKSA');

  const evalRow3 = evaluateCashRow(tx3, soloCtx);
  assert.equal(evalRow3.actionType, 'APPROVE');
  assert.equal(evalRow3.actionLabel, 'Sahkan');
  assert.equal(evalRow3.nextWorkflowTarget, 'MENGETAHUI');
});
