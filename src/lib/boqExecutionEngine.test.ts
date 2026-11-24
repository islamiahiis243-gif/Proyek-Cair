import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateBoqPos,
  evaluateWarehouseMaterial,
  resolveEvalContext,
  getActionVariantClass,
  getResidualChipClass,
  BoqEvalContext,
} from './boqExecutionEngine';
import { ItemBarang, MutasiBarang, PhysicalMaterialItem } from '../types';

const defaultBranding = {
  contractorName: 'CV. MENARA MEGAH',
  clientName: 'PT INDO MURO KENCANA',
};

test('resolveEvalContext resolves 3 axes properly across roles', () => {
  const clerkCtx = resolveEvalContext('Clerk', true, defaultBranding);
  assert.equal(clerkCtx.activeRole, 'Clerk');
  assert.equal(clerkCtx.partyPov, 'KONTRAKTOR');
  assert.equal(clerkCtx.authority, 'EKSEKUTOR');
  assert.equal(clerkCtx.canIssue, true);
  assert.equal(clerkCtx.canViewFinancials, true);

  const viewerCtx = resolveEvalContext('Viewer/Pengamat', false, defaultBranding);
  assert.equal(viewerCtx.activeRole, 'Viewer/Pengamat');
  assert.equal(viewerCtx.partyPov, 'KLIEN');
  assert.equal(viewerCtx.authority, 'PENGAMAT_KLIEN');
  assert.equal(viewerCtx.canIssue, false);
  assert.equal(viewerCtx.canViewFinancials, false);

  const foremanCtx = resolveEvalContext('Foreman', false, defaultBranding);
  assert.equal(foremanCtx.authority, 'PENGAWAS_INTERNAL');
  assert.equal(foremanCtx.partyPov, 'KONTRAKTOR');
  assert.equal(foremanCtx.canViewFinancials, true);

  const spvCtx = resolveEvalContext('Spv.', false, defaultBranding);
  assert.equal(spvCtx.authority, 'PENGAWAS_INTERNAL');

  const deptCtx = resolveEvalContext('Dept. Manager', false, defaultBranding);
  assert.equal(deptCtx.authority, 'PENGAWAS_INTERNAL');

  const kttCtx = resolveEvalContext('KTT/Proj. Manager', false, defaultBranding);
  assert.equal(kttCtx.authority, 'PENGAWAS_INTERNAL');

  const ceoCtx = resolveEvalContext('CEO/Direktur', false, defaultBranding);
  assert.equal(ceoCtx.authority, 'PENGAWAS_INTERNAL');
});

test('Pos Jasa / Upah (Jalur B: J-1 s.d. J-4)', () => {
  const clerkCtx = resolveEvalContext('Clerk', true, defaultBranding);
  const baseJasaItem: ItemBarang = {
    id: 'item-jasa-1',
    kode_boq: 'IV/A/1',
    nama_barang: 'Upah Tukang Cat & Pasang Plafond',
    kategori: 'Divisi IV / Upah',
    satuan: 'ls',
    qty_boq: 10,
    is_stock_item: false,
    has_stock_history: false,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 10,
    qty_masuk_total: 0,
    qty_keluar_total: 0,
    qty_pemenuhan_sisa: 10,
    progress_pemenuhan: 0,
    status_pemenuhan: 'Belum dipenuhi',
    harga_satuan: 1000000,
    stok_saat_ini: 0,
    stok_minimum: 0,
    status: 'Tidak Tersedia',
  };

  // J-1: Belum Jalan
  const evalJ1 = evaluateBoqPos(baseJasaItem, undefined, [], clerkCtx);
  assert.equal(evalJ1.stateCode, 'J-1');
  assert.equal(evalJ1.statusKey, 'BELUM_JALAN');
  assert.equal(evalJ1.statusLabel, 'Belum Jalan');
  assert.equal(evalJ1.actionType, 'CATAT_JASA');
  assert.equal(evalJ1.actionLabel, 'Catat');
  assert.equal(evalJ1.actionVariant, 'indigo');
  assert.equal(evalJ1.actionIcon, 'clipboard-check');
  assert.equal(evalJ1.isCriticalShortage, false);

  // J-2: Proses
  const evalJ2 = evaluateBoqPos(
    { ...baseJasaItem, qty_keluar_total: 4, qty_pemenuhan_sisa: 6 },
    undefined,
    [],
    clerkCtx
  );
  assert.equal(evalJ2.stateCode, 'J-2');
  assert.equal(evalJ2.statusKey, 'PROSES');
  assert.equal(evalJ2.statusLabel, 'Proses');
  assert.equal(evalJ2.actionType, 'CATAT_JASA');

  // J-3: Tuntas 100%
  const evalJ3 = evaluateBoqPos(
    { ...baseJasaItem, qty_keluar_total: 10, qty_pemenuhan_sisa: 0 },
    undefined,
    [],
    clerkCtx
  );
  assert.equal(evalJ3.stateCode, 'J-3');
  assert.equal(evalJ3.statusKey, 'TUNTAS');
  assert.equal(evalJ3.statusLabel, 'Tuntas');
  assert.equal(evalJ3.actionType, 'RIWAYAT');
  assert.equal(evalJ3.actionLabel, 'Riwayat');
  assert.equal(evalJ3.actionVariant, 'neutral');
  assert.equal(evalJ3.showSecondaryHistoryIcon, false);

  // J-4: Lebih
  const evalJ4 = evaluateBoqPos(
    { ...baseJasaItem, qty_keluar_total: 12, qty_pemenuhan_sisa: 0 },
    undefined,
    [],
    clerkCtx
  );
  assert.equal(evalJ4.stateCode, 'J-4');
  assert.equal(evalJ4.statusKey, 'LEBIH');
  assert.equal(evalJ4.statusLabel, 'Lebih');
  assert.equal(evalJ4.actionType, 'RIWAYAT');
});

test('Material Fisik (Jalur A: S-1 s.d. S-6) & Anti Alarm Palsu', () => {
  const clerkCtx = resolveEvalContext('Clerk', true, defaultBranding);
  const viewerCtx = resolveEvalContext('Viewer/Pengamat', false, defaultBranding);

  const baseMaterial: ItemBarang = {
    id: 'mat-1',
    kode_boq: 'I/B/1',
    nama_barang: 'Papan Semen Silika 6mm',
    kategori: 'Dinding & Partisi',
    satuan: 'lbr',
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
    harga_satuan: 85000,
    stok_saat_ini: 0,
    stok_minimum: 10,
    status: 'Tidak Tersedia',
  };

  const pmMock: PhysicalMaterialItem = {
    id: 'mat-1',
    nama_barang: 'Papan Semen Silika 6mm',
    satuan: 'lbr',
    stok_fisik: 0,
    total_qty_boq: 100,
    total_qty_masuk: 0,
    total_qty_keluar: 0,
    is_stock_item: true,
    budget_lines: [
      {
        id: 'mat-1',
        kode_boq: 'I/B/1',
        kategori: 'Dinding & Partisi',
        qty_boq: 100,
        qty_keluar_total: 0,
        sisa_anggaran: 100,
      },
    ],
  };

  // S-1: Belum Masuk (Kontraktor) -> must NOT trigger isCriticalShortage!
  const evalS1 = evaluateBoqPos(baseMaterial, pmMock, [], clerkCtx);
  assert.equal(evalS1.stateCode, 'S-1');
  assert.equal(evalS1.statusKey, 'BELUM_MASUK');
  assert.equal(evalS1.statusLabel, 'Belum Masuk');
  assert.equal(evalS1.isCriticalShortage, false); // Anti alarm palsu!
  assert.equal(evalS1.actionType, 'MASUK');
  assert.equal(evalS1.actionLabel, 'Masuk');
  assert.equal(evalS1.actionVariant, 'emerald'); // Belanja Kontraktor = Hijau

  // S-1 Jatah Klien (POV Klien)
  const clientPos: ItemBarang = {
    ...baseMaterial,
    keterangan: 'Pengadaan Free-Issue Klien (PT INDO MURO KENCANA)',
  };
  const evalS1Client = evaluateBoqPos(clientPos, pmMock, [], viewerCtx);
  assert.equal(evalS1Client.stateCode, 'S-1');
  assert.equal(evalS1Client.statusKey, 'BELUM_SERAH');
  assert.equal(evalS1Client.statusLabel, 'Belum Serah');
  assert.equal(evalS1Client.actionType, 'RIWAYAT'); // Viewer selalu bersih

  // S-1 Jatah Klien (POV Kontraktor / Clerk) -> action Masuk Ungu Rp 0
  const evalS1ClientForClerk = evaluateBoqPos(clientPos, pmMock, [], clerkCtx);
  assert.equal(evalS1ClientForClerk.stateCode, 'S-1');
  assert.equal(evalS1ClientForClerk.statusKey, 'BELUM_MASUK');
  assert.equal(evalS1ClientForClerk.actionType, 'MASUK');
  assert.equal(evalS1ClientForClerk.actionVariant, 'purple'); // Jatah Klien = Ungu

  // S-2: Siap Pakai (Stok ada > 0, keluar = 0)
  const pmS2: PhysicalMaterialItem = { ...pmMock, stok_fisik: 50, total_qty_masuk: 50 };
  const evalS2 = evaluateBoqPos({ ...baseMaterial, stok_saat_ini: 50 }, pmS2, [], clerkCtx);
  assert.equal(evalS2.stateCode, 'S-2');
  assert.equal(evalS2.statusKey, 'SIAP_PAKAI');
  assert.equal(evalS2.statusLabel, 'Siap Pakai');
  assert.equal(evalS2.actionType, 'PAKAI');
  assert.equal(evalS2.actionLabel, 'Pakai');
  assert.equal(evalS2.actionVariant, 'rose');
  assert.equal(evalS2.isCriticalShortage, false);

  // S-3: Proses (Stok ada > 0, keluar > 0)
  const pmS3: PhysicalMaterialItem = {
    ...pmMock,
    stok_fisik: 20,
    total_qty_masuk: 50,
    total_qty_keluar: 30,
  };
  const evalS3 = evaluateBoqPos(
    { ...baseMaterial, stok_saat_ini: 20, qty_keluar_total: 30 },
    pmS3,
    [],
    clerkCtx
  );
  assert.equal(evalS3.stateCode, 'S-3');
  assert.equal(evalS3.statusKey, 'PROSES');
  assert.equal(evalS3.statusLabel, 'Proses');
  assert.equal(evalS3.actionType, 'PAKAI');
  assert.equal(evalS3.actionVariant, 'rose');
  assert.equal(evalS3.isCriticalShortage, false);

  // S-4: Habis (Stok <= 0, keluar > 0, belum tuntas) -> MUST trigger isCriticalShortage = true!
  const pmS4: PhysicalMaterialItem = {
    ...pmMock,
    stok_fisik: 0,
    total_qty_masuk: 50,
    total_qty_keluar: 50,
  };
  const evalS4 = evaluateBoqPos(
    { ...baseMaterial, stok_saat_ini: 0, qty_keluar_total: 50, has_stock_history: true },
    pmS4,
    [],
    clerkCtx
  );
  assert.equal(evalS4.stateCode, 'S-4');
  assert.equal(evalS4.statusKey, 'HABIS');
  assert.equal(evalS4.statusLabel, 'Habis');
  assert.equal(evalS4.isCriticalShortage, true); // Alarm darurat aktif!
  assert.equal(evalS4.actionType, 'MASUK');
  assert.equal(evalS4.actionVariant, 'emerald');

  // S-5: Tuntas (Keluar == Target)
  const pmS5: PhysicalMaterialItem = {
    ...pmMock,
    stok_fisik: 0,
    total_qty_masuk: 100,
    total_qty_keluar: 100,
  };
  const evalS5 = evaluateBoqPos(
    { ...baseMaterial, stok_saat_ini: 0, qty_keluar_total: 100 },
    pmS5,
    [],
    clerkCtx
  );
  assert.equal(evalS5.stateCode, 'S-5');
  assert.equal(evalS5.statusKey, 'TUNTAS');
  assert.equal(evalS5.statusLabel, 'Tuntas');
  assert.equal(evalS5.actionType, 'RIWAYAT');
  assert.equal(evalS5.actionLabel, 'Riwayat');
  assert.equal(evalS5.actionVariant, 'neutral');
  assert.equal(evalS5.showSecondaryHistoryIcon, false);

  // S-6: Lebih (Keluar > Target)
  const evalS6 = evaluateBoqPos(
    { ...baseMaterial, stok_saat_ini: 0, qty_keluar_total: 110 },
    pmS5,
    [],
    clerkCtx
  );
  assert.equal(evalS6.stateCode, 'S-6');
  assert.equal(evalS6.statusKey, 'LEBIH');
  assert.equal(evalS6.statusLabel, 'Lebih');
  assert.equal(evalS6.actionType, 'RIWAYAT');
});

test('Material Campuran (Mixed Provider Protection — 19 mm Wall Angel Grid)', () => {
  const clerkCtx = resolveEvalContext('Clerk', true, defaultBranding);
  const viewerCtx = resolveEvalContext('Viewer/Pengamat', false, defaultBranding);

  // Pos 1: Kontraktor jatah 25
  const itemKontraktor: ItemBarang = {
    id: 'pos-kontraktor-14',
    kode_boq: 'I/E/14',
    nama_barang: '19 mm Wall Angel Grid',
    kategori: 'Plafond',
    satuan: 'ea',
    qty_boq: 25,
    is_stock_item: true,
    has_stock_history: true,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 25,
    qty_masuk_total: 25,
    qty_keluar_total: 0,
    qty_pemenuhan_sisa: 25,
    progress_pemenuhan: 0,
    status_pemenuhan: 'Belum dipenuhi',
    harga_satuan: 45000,
    stok_saat_ini: 25,
    stok_minimum: 5,
    status: 'Tersedia',
    keterangan: 'Pengadaan Kontraktor (CV. MENARA MEGAH)',
  };

  // Pos 2: Klien jatah 43
  const itemKlien: ItemBarang = {
    id: 'pos-klien-8',
    kode_boq: 'I/F/8',
    nama_barang: '19 mm Wall Angel Grid',
    kategori: 'Plafond',
    satuan: 'ea',
    qty_boq: 43,
    is_stock_item: true,
    has_stock_history: false,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 43,
    qty_masuk_total: 0,
    qty_keluar_total: 0,
    qty_pemenuhan_sisa: 43,
    progress_pemenuhan: 0,
    status_pemenuhan: 'Belum dipenuhi',
    harga_satuan: 0,
    stok_saat_ini: 25,
    stok_minimum: 5,
    status: 'Tersedia',
    keterangan: 'Jatah Klien (PT INDO MURO KENCANA)',
  };

  const mixedPm: PhysicalMaterialItem = {
    id: 'pm-wall-angel',
    nama_barang: '19 mm Wall Angel Grid',
    satuan: 'ea',
    stok_fisik: 25, // Di gudang ada 25 milik Kontraktor
    total_qty_boq: 68,
    total_qty_masuk: 25,
    total_qty_keluar: 0,
    is_stock_item: true,
    budget_lines: [
      {
        id: 'pos-kontraktor-14',
        kode_boq: 'I/E/14',
        kategori: 'Plafond',
        qty_boq: 25,
        qty_keluar_total: 0,
        sisa_anggaran: 25,
        keterangan: 'Pengadaan Kontraktor (CV. MENARA MEGAH)',
      },
      {
        id: 'pos-klien-8',
        kode_boq: 'I/F/8',
        kategori: 'Plafond',
        qty_boq: 43,
        qty_keluar_total: 0,
        sisa_anggaran: 43,
        keterangan: 'Jatah Klien (PT INDO MURO KENCANA)',
      },
    ],
  };

  const mutations: MutasiBarang[] = [
    {
      id: 'mut-in-1',
      barang_id: 'pos-kontraktor-14',
      nama_barang: '19 mm Wall Angel Grid',
      jenis: 'MASUK',
      jumlah: 25,
      satuan: 'ea',
      tujuan_keperluan: 'Stok gudang',
      pic_penerima_penyerah: 'Supir Toko',
      tanggal: '2026-11-20T10:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 25,
      source_name: 'CV. MENARA MEGAH',
      owner_type: 'KONTRAKTOR',
    },
  ];

  // Evaluasi Pos Kontraktor: stok tersedia 25 -> Siap Pakai
  const evalKontraktor = evaluateBoqPos(itemKontraktor, mixedPm, mutations, clerkCtx);
  assert.equal(evalKontraktor.stateCode, 'S-2');
  assert.equal(evalKontraktor.statusKey, 'SIAP_PAKAI');
  assert.equal(evalKontraktor.actionType, 'PAKAI');
  assert.equal(evalKontraktor.actionVariant, 'rose');
  assert.equal(evalKontraktor.providerStockLabel, 'Porsi Kontraktor: 25 ea');

  // Evaluasi Pos Klien: Klien belum kirim -> Belum Masuk / Belum Serah (TIDAK BOLEH Siap Pakai!)
  const evalKlienClerk = evaluateBoqPos(itemKlien, mixedPm, mutations, clerkCtx);
  assert.equal(evalKlienClerk.stateCode, 'S-1');
  assert.equal(evalKlienClerk.statusKey, 'BELUM_MASUK');
  assert.equal(evalKlienClerk.actionType, 'MASUK');
  assert.equal(evalKlienClerk.actionVariant, 'purple'); // Tombol Masuk Ungu Jatah Klien
  assert.equal(evalKlienClerk.providerStockLabel, 'Porsi Klien: 0 ea');
  assert.equal(evalKlienClerk.providerStockSubLabel, '(Stok Kontraktor: 25 ea)');
  assert.match(evalKlienClerk.providerAlert || '', /Talangan/);

  // Evaluasi Pos Klien dari POV Klien (Viewer)
  const evalKlienViewer = evaluateBoqPos(itemKlien, mixedPm, mutations, viewerCtx);
  assert.equal(evalKlienViewer.stateCode, 'S-1');
  assert.equal(evalKlienViewer.statusKey, 'BELUM_SERAH');
  assert.equal(evalKlienViewer.actionType, 'RIWAYAT');
});

test('Alur Persetujuan Serial Pengawas & Hitungan Antrean (Pending Approvals)', () => {
  const foremanCtx = resolveEvalContext('Foreman', false, defaultBranding);
  const spvCtx = resolveEvalContext('Spv.', false, defaultBranding);
  const deptCtx = resolveEvalContext('Dept. Manager', false, defaultBranding);

  const item: ItemBarang = {
    id: 'mat-appr-1',
    kode_boq: 'II/A/1',
    nama_barang: 'Semen Portland 50kg',
    kategori: 'Struktur',
    satuan: 'sak',
    qty_boq: 200,
    is_stock_item: true,
    has_stock_history: true,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 200,
    qty_masuk_total: 100,
    qty_keluar_total: 50,
    qty_pemenuhan_sisa: 150,
    progress_pemenuhan: 25,
    status_pemenuhan: 'Dalam pemenuhan',
    harga_satuan: 72000,
    stok_saat_ini: 50,
    stok_minimum: 20,
    status: 'Tersedia',
  };

  const pm: PhysicalMaterialItem = {
    id: 'mat-appr-1',
    nama_barang: 'Semen Portland 50kg',
    satuan: 'sak',
    stok_fisik: 50,
    total_qty_boq: 200,
    total_qty_masuk: 100,
    total_qty_keluar: 50,
    is_stock_item: true,
    budget_lines: [
      {
        id: 'mat-appr-1',
        kode_boq: 'II/A/1',
        kategori: 'Struktur',
        qty_boq: 200,
        qty_keluar_total: 50,
        sisa_anggaran: 150,
      },
    ],
  };

  // Mutasi 1: DITERBITKAN (menunggu Foreman)
  // Mutasi 2: DITERBITKAN (menunggu Foreman)
  const mutations: MutasiBarang[] = [
    {
      id: 'mut-101',
      barang_id: 'mat-appr-1',
      nama_barang: 'Semen Portland 50kg',
      jenis: 'MASUK',
      jumlah: 50,
      satuan: 'sak',
      tujuan_keperluan: 'Gudang',
      pic_penerima_penyerah: 'Toko',
      tanggal: '2026-11-21T09:00:00Z',
      stok_sebelum: 0,
      stok_sesudah: 50,
      status_dokumen: 'DITERBITKAN',
    },
    {
      id: 'mut-102',
      barang_id: 'mat-appr-1',
      nama_barang: 'Semen Portland 50kg',
      jenis: 'MASUK',
      jumlah: 50,
      satuan: 'sak',
      tujuan_keperluan: 'Gudang',
      pic_penerima_penyerah: 'Toko',
      tanggal: '2026-11-21T14:00:00Z',
      stok_sebelum: 50,
      stok_sesudah: 100,
      status_dokumen: 'DITERBITKAN',
    },
  ];

  // Foreman melihat antrean 2 transaksi -> [ ✓ Periksa · 2 ] (sky)
  const evalForeman = evaluateBoqPos(item, pm, mutations, foremanCtx);
  assert.equal(evalForeman.actionType, 'APPROVE');
  assert.equal(evalForeman.actionLabel, 'Periksa · 2');
  assert.equal(evalForeman.actionVariant, 'sky');
  assert.equal(evalForeman.pendingApprovalAction, 'PERIKSA');
  assert.equal(evalForeman.pendingApprovalCount, 2);
  assert.equal(evalForeman.pendingApprovalMutationId, 'mut-101');
  assert.equal(evalForeman.showSecondaryHistoryIcon, true);

  // Spv. pada tahap ini belum punya antrean (karena dokumen masih DITERBITKAN, belum DIPERIKSA) -> [ 🕒 Riwayat ]
  const evalSpvIdle = evaluateBoqPos(item, pm, mutations, spvCtx);
  assert.equal(evalSpvIdle.actionType, 'RIWAYAT');
  assert.equal(evalSpvIdle.actionLabel, 'Riwayat');
  assert.equal(evalSpvIdle.actionVariant, 'neutral');
  assert.equal(evalSpvIdle.showSecondaryHistoryIcon, false);

  // Ubah status mut-101 menjadi DIPERIKSA -> Spv sekarang melihat antrean [ ✓ Setuju ]
  const mutationsWithChecked: MutasiBarang[] = [
    { ...mutations[0], status_dokumen: 'DIPERIKSA' },
    mutations[1],
  ];
  const evalSpvActive = evaluateBoqPos(item, pm, mutationsWithChecked, spvCtx);
  assert.equal(evalSpvActive.actionType, 'APPROVE');
  assert.equal(evalSpvActive.actionLabel, 'Setuju');
  assert.equal(evalSpvActive.actionVariant, 'amber');
  assert.equal(evalSpvActive.pendingApprovalAction, 'SETUJU');

  // Ubah mut-101 menjadi DISETUJUI -> Dept. Manager melihat [ ✓ Sahkan ]
  const mutationsWithApproved: MutasiBarang[] = [
    { ...mutations[0], status_dokumen: 'DISETUJUI' },
    mutations[1],
  ];
  const evalDept = evaluateBoqPos(item, pm, mutationsWithApproved, deptCtx);
  assert.equal(evalDept.actionType, 'APPROVE');
  assert.equal(evalDept.actionLabel, 'Sahkan');
  assert.equal(evalDept.actionVariant, 'teal');
  assert.equal(evalDept.pendingApprovalAction, 'SAHKAN');
});

test('evaluateWarehouseMaterial (Tab 1 Stok Gudang, Micro-Chip & Truk Susulan)', () => {
  const clerkCtx = resolveEvalContext('Clerk', true, defaultBranding);

  // Kasus Atap Spandek: tiba 50 dari 149.6, sisa belum tiba 99.6, ada stok 50 di gudang
  const pmSpandek: PhysicalMaterialItem = {
    id: 'pm-spandek',
    nama_barang: 'Atap Spandek 0.35mm',
    satuan: 'sht',
    stok_fisik: 50,
    total_qty_boq: 149.6,
    total_qty_masuk: 50,
    total_qty_keluar: 0,
    is_stock_item: true,
    budget_lines: [
      {
        id: 'pm-spandek-pos1',
        kode_boq: 'III/B/1',
        kategori: 'Atap',
        qty_boq: 149.6,
        qty_keluar_total: 0,
        sisa_anggaran: 149.6,
      },
    ],
  };

  const evalWh = evaluateWarehouseMaterial(pmSpandek, [], clerkCtx);
  assert.equal(evalWh.statusKey, 'TERSEDIA');
  assert.equal(evalWh.actionType, 'PAKAI');
  assert.equal(evalWh.actionLabel, 'Pakai');
  assert.equal(evalWh.actionVariant, 'rose');
  assert.equal(evalWh.sisaBelumTiba, 99.6);
  assert.equal(evalWh.canQuickAddResidual, true); // Clerk can click micro-chip [ 99.6 + ]!
  assert.equal(evalWh.residualChipVariant, 'emerald'); // Belanja Kontraktor

  // Jika material sudah tuntas: total target 100, masuk 100, keluar 100, stok fisik 0
  const pmTuntas: PhysicalMaterialItem = {
    id: 'pm-tuntas',
    nama_barang: 'Cat Dasar 20L',
    satuan: 'pl',
    stok_fisik: 0,
    total_qty_boq: 10,
    total_qty_masuk: 10,
    total_qty_keluar: 10,
    is_stock_item: true,
    budget_lines: [
      {
        id: 'pm-tuntas-pos1',
        kode_boq: 'V/A/1',
        kategori: 'Finishing',
        qty_boq: 10,
        qty_keluar_total: 10,
        sisa_anggaran: 0,
      },
    ],
  };
  const evalTuntas = evaluateWarehouseMaterial(pmTuntas, [], clerkCtx);
  assert.equal(evalTuntas.statusKey, 'TUNTAS');
  assert.equal(evalTuntas.actionType, 'RIWAYAT');
  assert.equal(evalTuntas.actionLabel, 'Riwayat');
  assert.equal(evalTuntas.actionVariant, 'neutral');
  assert.equal(evalTuntas.showSecondaryHistoryIcon, false);
});

test('Tailwind class helpers generate standard token classes', () => {
  assert.match(getActionVariantClass('emerald'), /bg-emerald-600/);
  assert.match(getActionVariantClass('purple'), /bg-purple-600/);
  assert.match(getActionVariantClass('rose'), /bg-rose-600/);
  assert.match(getActionVariantClass('indigo'), /bg-indigo-600/);
  assert.match(getActionVariantClass('sky'), /bg-sky-600/);
  assert.match(getActionVariantClass('amber'), /bg-amber-600/);
  assert.match(getActionVariantClass('teal'), /bg-teal-600/);
  assert.match(getActionVariantClass('neutral'), /bg-slate-100/);

  assert.match(getResidualChipClass('emerald'), /border-dashed border-emerald-500/);
  assert.match(getResidualChipClass('purple'), /border-dashed border-purple-500/);
});
