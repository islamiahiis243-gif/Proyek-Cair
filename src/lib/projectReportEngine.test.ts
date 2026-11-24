import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildIntegratedProjectReport,
  filterDocumentsForPov,
} from './projectReportEngine';
import {
  DokumenLaporan,
  ItemBarang,
  MutasiBarang,
  MutasiKas,
  PhysicalMaterialItem,
  ProjectReceipt,
} from '../types';

const sampleDocs: DokumenLaporan[] = [
  {
    id: 'BA-KAS-001',
    judul: 'Berita Acara Arus Kas November',
    jenis: 'MUTASI_KAS',
    document_type: 'MUTASI_KAS',
    audience_pov: 'KONTRAKTOR',
    status: 'SIGNED',
    status_dokumen: 'MENGETAHUI',
    periode_awal: '2026-11-01',
    periode_akhir: '2026-11-30',
    dibuat_pada: '2026-11-20T10:00:00Z',
    penandatangan_nama: 'Clerk A',
    penandatangan_jabatan: 'Clerk',
    penandatangan_email: 'clerk@example.com',
    hash_keamanan: 'abc123',
    total_transaksi: 5,
    ringkasan_nilai_rp: 25_000_000,
    qr_payload: 'DOC:BA-KAS-001',
  },
  {
    id: 'BA-STOK-001',
    judul: 'Berita Acara Mutasi Barang Mingguan',
    jenis: 'MUTASI_STOK',
    document_type: 'MUTASI_STOK',
    audience_pov: 'UMUM',
    status: 'ISSUED',
    status_dokumen: 'DITERBITKAN',
    periode_awal: '2026-11-01',
    periode_akhir: '2026-11-07',
    dibuat_pada: '2026-11-08T10:00:00Z',
    penandatangan_nama: 'Clerk A',
    penandatangan_jabatan: 'Clerk',
    penandatangan_email: 'clerk@example.com',
    hash_keamanan: 'def456',
    total_transaksi: 3,
    ringkasan_nilai_rp: 0,
    qr_payload: 'DOC:BA-STOK-001',
  },
  {
    id: 'BA-PROYEK-INT-001',
    judul: 'Laporan Proyek Terpadu Internal Manajemen',
    jenis: 'GABUNGAN_PROYEK',
    document_type: 'GABUNGAN_PROYEK',
    audience_pov: 'KONTRAKTOR',
    status: 'SIGNED',
    status_dokumen: 'MENGETAHUI',
    periode_awal: '2026-11-01',
    periode_akhir: '2026-11-30',
    dibuat_pada: '2026-11-22T10:00:00Z',
    penandatangan_nama: 'Clerk A',
    penandatangan_jabatan: 'Clerk',
    penandatangan_email: 'clerk@example.com',
    hash_keamanan: 'ghi789',
    total_transaksi: 10,
    ringkasan_nilai_rp: 50_000_000,
    qr_payload: 'DOC:BA-PROYEK-INT-001',
  },
  {
    id: 'BA-PROYEK-KLN-001',
    judul: 'Laporan Progres Fisik Proyek Terpadu (Edisi Klien)',
    jenis: 'GABUNGAN_PROYEK',
    document_type: 'GABUNGAN_PROYEK',
    audience_pov: 'KLIEN',
    status: 'SIGNED',
    status_dokumen: 'MENGETAHUI',
    periode_awal: '2026-11-01',
    periode_akhir: '2026-11-30',
    dibuat_pada: '2026-11-23T10:00:00Z',
    penandatangan_nama: 'Clerk A',
    penandatangan_jabatan: 'Clerk',
    penandatangan_email: 'clerk@example.com',
    hash_keamanan: 'jkl012',
    total_transaksi: 8,
    ringkasan_nilai_rp: 0,
    qr_payload: 'DOC:BA-PROYEK-KLN-001',
  },
];

const sampleItems: ItemBarang[] = [
  {
    id: 'it-1',
    kode_boq: 'I/1',
    nama_barang: 'Semen 50kg',
    kategori: 'Divisi I / Struktur',
    satuan: 'sak',
    qty_boq: 100,
    is_stock_item: true,
    has_stock_history: true,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 100,
    qty_masuk_total: 50,
    qty_keluar_total: 50,
    qty_pemenuhan_sisa: 50,
    progress_pemenuhan: 50,
    status_pemenuhan: 'Dalam pemenuhan',
    harga_satuan: 80_000,
    stok_saat_ini: 20,
    stok_minimum: 0,
    status: 'Tersedia',
  },
  {
    id: 'it-2',
    kode_boq: 'II/1',
    nama_barang: 'Panel Listrik',
    kategori: 'Divisi II / Elektrikal',
    satuan: 'unit',
    qty_boq: 2,
    is_stock_item: true,
    has_stock_history: false,
    qty_tambahan_disetujui: 0,
    target_kebutuhan_total: 2,
    qty_masuk_total: 0,
    qty_keluar_total: 0,
    qty_pemenuhan_sisa: 2,
    progress_pemenuhan: 0,
    status_pemenuhan: 'Belum dipenuhi',
    harga_satuan: 5_000_000,
    stok_saat_ini: 0,
    stok_minimum: 0,
    status: 'Belum Dicatat',
    keterangan: 'Free-Issue by PT INDO MURO KENCANA',
  },
];

const samplePhysical: PhysicalMaterialItem[] = [
  {
    id: 'it-1',
    nama_barang: 'Semen 50kg',
    satuan: 'sak',
    stok_fisik: 20,
    total_qty_boq: 100,
    total_qty_masuk: 70,
    total_qty_keluar: 50,
    is_stock_item: true,
    harga_beli_rata_rata: 75_000,
    budget_lines: [
      { id: 'it-1', kode_boq: 'I/1', kategori: 'Divisi I / Struktur', qty_boq: 100, qty_keluar_total: 50, sisa_anggaran: 50 },
    ],
  },
];

const sampleStockMut: MutasiBarang[] = [
  {
    id: 'sm-1',
    barang_id: 'it-1',
    nama_barang: 'Semen 50kg',
    jenis: 'MASUK',
    jumlah: 70,
    satuan: 'sak',
    tujuan_keperluan: 'Pengadaan BOQ',
    pic_penerima_penyerah: 'Andi',
    tanggal: '2026-11-05T08:00:00Z',
    stok_sebelum: 0,
    stok_sesudah: 70,
    owner_type: 'KONTRAKTOR',
    harga_satuan_beli: 75_000,
    nomor_nota: 'NTA-77',
    nama_toko: 'TB Karya',
    receipt_id: 'rc-1',
  },
];

const sampleReceipts: ProjectReceipt[] = [
  {
    id: 'rc-1',
    project_id: 'proj-1',
    reference_no: 'NTA-77',
    nama_toko: 'TB Karya',
    tanggal_nota: '2026-11-05',
    total_nota_fisik: 5_250_000,
    receipt_scope: 'BELANJA_BARANG',
  },
];

const sampleCash: MutasiKas[] = [
  {
    id: 'cs-1',
    jenis: 'MASUK',
    jumlah_rp: 20_000_000,
    untuk_apa: 'Termin 1',
    kategori_keperluan: 'Dana Termin Proyek',
    pic: 'Bendahara',
    tanggal: '2026-11-01T08:00:00Z',
    saldo_setelah: 20_000_000,
    source_module: 'KAS_LANGSUNG',
  },
  {
    id: 'cs-2',
    jenis: 'KELUAR',
    jumlah_rp: 2_000_000,
    untuk_apa: 'Talangan pasang panel klien',
    kategori_keperluan: 'Talangan Klien',
    beban_biaya: 'KLIEN',
    pic: 'Mandor B',
    tanggal: '2026-11-10T08:00:00Z',
    saldo_setelah: 18_000_000,
    source_module: 'KAS_LANGSUNG',
  },
];

test('filterDocumentsForPov protects internal MUTASI_KAS and KONTRAKTOR reports from KLIEN', () => {
  const contractorVisible = filterDocumentsForPov(sampleDocs, 'KONTRAKTOR');
  assert.equal(contractorVisible.length, 4);

  const clientVisible = filterDocumentsForPov(sampleDocs, 'KLIEN');
  assert.deepEqual(
    clientVisible.map((d) => d.id),
    ['BA-STOK-001', 'BA-PROYEK-KLN-001']
  );
  assert.equal(clientVisible.some((d) => d.jenis === 'MUTASI_KAS'), false);
  assert.equal(clientVisible.some((d) => d.audience_pov === 'KONTRAKTOR'), false);
});

test('buildIntegratedProjectReport computes full 3-pillar control triangle for KONTRAKTOR', () => {
  const report = buildIntegratedProjectReport({
    activeRole: 'CEO/Direktur',
    canViewFinancials: true,
    items: sampleItems,
    physicalMaterials: samplePhysical,
    stockMutations: sampleStockMut,
    cashMutations: sampleCash,
    projectReceipts: sampleReceipts,
    documents: sampleDocs,
    branding: {
      projectName: 'Proyek UDU Office',
      contractorName: 'CV. MENARA MEGAH',
      clientName: 'PT INDO MURO KENCANA',
    },
  });

  assert.equal(report.partyPov, 'KONTRAKTOR');
  assert.equal(report.includeFinancials, true);
  assert.equal(report.contractStats.paguMaterialRp, 8_000_000);
  assert.equal(report.contractStats.nilaiJatahKlienRp, 10_000_000);
  assert.equal(report.physicalProgress.totalPosCount, 2);
  assert.equal(report.physicalProgress.jatahKlienBelumSerahCount, 1);

  assert.ok(report.cashMetrics);
  assert.equal(report.cashMetrics!.saldoSaatIni, 18_000_000);

  assert.ok(report.reconciliation);
  // Valuasi stok = 20 sak * 75.000 = 1.500.000
  assert.equal(report.reconciliation!.valuasiStokGudangRp, 1_500_000);
  // Total aset kerja = 18.000.000 + 1.500.000 = 19.500.000
  assert.equal(report.reconciliation!.totalAsetKerjaProyekRp, 19_500_000);
  // Utang nota gudang belum dibayar = 5.250.000
  assert.equal(report.reconciliation!.selisihNotaBelumDibayarRp, 5_250_000);
  assert.equal(report.reconciliation!.unreconciledReceipts.length, 1);
  assert.equal(report.reconciliation!.moduleContributions.length, 6);
  assert.equal(report.receiptIndex.length, 1);
  assert.equal(report.officialDocumentsSummary.totalDocs, 4);
});

test('buildIntegratedProjectReport strips all internal cash, valuations, and contractor receipts for Viewer/Pengamat (KLIEN)', () => {
  const report = buildIntegratedProjectReport({
    activeRole: 'Viewer/Pengamat',
    canViewFinancials: true, // bahkan jika salah dikirim true, Viewer tetap terkunci!
    items: sampleItems,
    physicalMaterials: samplePhysical,
    stockMutations: sampleStockMut,
    cashMutations: sampleCash,
    projectReceipts: sampleReceipts,
    documents: sampleDocs,
    branding: {
      projectName: 'Proyek UDU Office',
      contractorName: 'CV. MENARA MEGAH',
      clientName: 'PT INDO MURO KENCANA',
    },
  });

  assert.equal(report.partyPov, 'KLIEN');
  assert.equal(report.includeFinancials, false);
  assert.equal(report.cashMetrics, null);
  assert.equal(report.reconciliation, null);
  assert.equal(report.budgetCategories.length, 0);
  assert.equal(report.receiptIndex.length, 0);
  assert.equal(report.contractStats.paguKontraktorRp, 0);
  // Progres fisik & arsip dokumen terfilter tetap akurat
  assert.equal(report.physicalProgress.totalPosCount, 2);
  assert.equal(report.physicalProgress.jatahKlienBelumSerahCount, 1);
  assert.equal(report.officialDocumentsSummary.totalDocs, 2);

  // Pastikan clientClaimSummary pada POV KLIEN tidak pernah membocorkan saldo_setelah atau metadata toko internal
  if (report.clientClaimSummary) {
    for (const tx of report.clientClaimSummary.transactions) {
      assert.equal(tx.saldo_setelah, 0);
      assert.equal(tx.nama_toko, undefined);
      assert.equal(tx.catatan, undefined);
      assert.deepEqual(tx.lampiran_nota_urls, []);
    }
  }
});

test('buildIntegratedProjectReport excludes owner_type IMK from materialNotaGudangRp', () => {
  const report = buildIntegratedProjectReport({
    activeRole: 'CEO/Direktur',
    canViewFinancials: true,
    items: sampleItems,
    physicalMaterials: samplePhysical,
    stockMutations: [
      ...sampleStockMut,
      {
        id: 'sm-imk',
        barang_id: 'it-2',
        nama_barang: 'Panel Listrik',
        jenis: 'MASUK',
        jumlah: 2,
        satuan: 'unit',
        tujuan_keperluan: 'Serah Terima Klien',
        pic_penerima_penyerah: 'Andi',
        tanggal: '2026-11-06T08:00:00Z',
        stok_sebelum: 0,
        stok_sesudah: 2,
        owner_type: 'IMK',
        harga_satuan_beli: 5_000_000,
      },
    ],
    cashMutations: sampleCash,
    projectReceipts: sampleReceipts,
    documents: sampleDocs,
    branding: {
      projectName: 'Proyek UDU Office',
      contractorName: 'CV. MENARA MEGAH',
      clientName: 'PT INDO MURO KENCANA',
    },
  });

  // Hanya sm-1 (70 * 75.000 = 5.250.000), TIDAK termasuk sm-imk (10.000.000)
  assert.equal(report.reconciliation!.materialNotaGudangRp, 5_250_000);
});

test('filterDocumentsForPov blocks GABUNGAN_PROYEK with KONTRAKTOR or missing audience_pov in StockMutation Tab 4 for KLIEN', () => {
  const docsWithUntaggedIntegrated = [
    ...sampleDocs,
    {
      ...sampleDocs[2],
      id: 'BA-PROYEK-UNTAGGED-001',
      audience_pov: undefined,
    },
  ];
  const stockTabForClient = filterDocumentsForPov(docsWithUntaggedIntegrated, 'KLIEN').filter(
    (d) => d.jenis === 'MUTASI_STOK' || d.jenis === 'GABUNGAN_PROYEK'
  );
  assert.deepEqual(
    stockTabForClient.map((d) => d.id),
    ['BA-STOK-001', 'BA-PROYEK-KLN-001']
  );

  const stockTabForContractor = filterDocumentsForPov(docsWithUntaggedIntegrated, 'KONTRAKTOR').filter(
    (d) => d.jenis === 'MUTASI_STOK' || d.jenis === 'GABUNGAN_PROYEK'
  );
  assert.deepEqual(
    stockTabForContractor.map((d) => d.id),
    ['BA-STOK-001', 'BA-PROYEK-INT-001', 'BA-PROYEK-KLN-001', 'BA-PROYEK-UNTAGGED-001']
  );
});

test('buildIntegratedProjectReport counts contractor purchases from stores sharing a client-name token (e.g. TB Indo Makmur)', () => {
  const report = buildIntegratedProjectReport({
    activeRole: 'CEO/Direktur',
    canViewFinancials: true,
    items: sampleItems,
    physicalMaterials: samplePhysical,
    stockMutations: [
      ...sampleStockMut,
      {
        id: 'sm-indo-store',
        barang_id: 'it-1',
        nama_barang: 'Semen 50kg',
        jenis: 'MASUK',
        jumlah: 10,
        satuan: 'sak',
        tujuan_keperluan: 'Pengadaan BOQ',
        pic_penerima_penyerah: 'Andi',
        tanggal: '2026-11-06T08:00:00Z',
        stok_sebelum: 70,
        stok_sesudah: 80,
        owner_type: 'KONTRAKTOR',
        status_harga: 'TERCATAT',
        source_name: 'Lainnya: TB Indo Makmur',
        nama_toko: 'TB Indo Makmur',
        harga_satuan_beli: 80_000,
      },
    ],
    cashMutations: sampleCash,
    projectReceipts: sampleReceipts,
    documents: sampleDocs,
    branding: {
      projectName: 'Proyek UDU Office',
      contractorName: 'CV. MENARA MEGAH',
      clientName: 'PT INDO MURO KENCANA',
    },
  });

  // 5.250.000 (sm-1) + 800.000 (sm-indo-store) = 6.050.000
  assert.equal(report.reconciliation!.materialNotaGudangRp, 6_050_000);
});

test('PO_PENGADAAN is marked AKTIF in IntegratedProjectReport and blocked from KLIEN in filterDocumentsForPov', () => {
  const poDoc: DokumenLaporan = {
    ...sampleDocs[0],
    id: 'PO-20261124-001',
    jenis: 'PO_PENGADAAN',
    audience_pov: 'KONTRAKTOR',
  };
  assert.equal(
    filterDocumentsForPov([...sampleDocs, poDoc], 'KLIEN').some((d) => d.jenis === 'PO_PENGADAAN'),
    false
  );
  assert.equal(
    filterDocumentsForPov([...sampleDocs, poDoc], 'KONTRAKTOR').some((d) => d.jenis === 'PO_PENGADAAN'),
    true
  );

  const report = buildIntegratedProjectReport({
    activeRole: 'CEO/Direktur',
    canViewFinancials: true,
    items: sampleItems,
    physicalMaterials: samplePhysical,
    stockMutations: sampleStockMut,
    cashMutations: sampleCash,
    projectReceipts: sampleReceipts,
    documents: [...sampleDocs, poDoc],
    branding: {
      projectName: 'Proyek UDU Office',
      contractorName: 'CV. MENARA MEGAH',
      clientName: 'PT INDO MURO KENCANA',
    },
  });
  const poModule = report.reconciliation!.moduleContributions.find((m) => m.moduleCode === 'PO_PENGADAAN');
  assert.ok(poModule);
  assert.equal(poModule!.status, 'AKTIF');
});
