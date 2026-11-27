import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSafeReceiptFields, buildProjectReceiptAlbum, getReceiptSignedUrl } from './receiptStorage';
import { MutasiBarang, MutasiKas, ProjectReceipt } from '../types';

test('buildSafeReceiptFields enforces non-null fallbacks for empty cash receipt metadata', () => {
  const safe = buildSafeReceiptFields(
    { reference_no: '   ', nama_toko: '', tanggal_nota: '' },
    'Pak Budi'
  );
  assert.match(safe.reference_no, /^KWT-\d{8}-[A-Z0-9]{4}$/);
  assert.equal(safe.nama_toko, 'Pak Budi / Kas Lapangan');
  assert.match(safe.tanggal_nota, /^\d{4}-\d{2}-\d{2}$/);

  const dashRef = buildSafeReceiptFields({ reference_no: '-', nama_toko: '', tanggal_nota: '2026-11-24T10:30:00Z' });
  assert.match(dashRef.reference_no, /^KWT-\d{8}-[A-Z0-9]{4}$/);
  assert.equal(dashRef.nama_toko, 'Kas Lapangan');
  assert.equal(dashRef.tanggal_nota, '2026-11-24');

  const explicit = buildSafeReceiptFields({
    reference_no: 'INV-TB-009',
    nama_toko: 'TB Sinar Jaya',
    tanggal_nota: '2026-11-20',
  });
  assert.equal(explicit.reference_no, 'INV-TB-009');
  assert.equal(explicit.nama_toko, 'TB Sinar Jaya');
  assert.equal(explicit.tanggal_nota, '2026-11-20');
});

test('buildProjectReceiptAlbum unifies stock receipts, cash receipts, and TERPADU scope cleanly', () => {
  const dbReceipts: ProjectReceipt[] = [
    {
      id: 'rc-terpadu-1',
      project_id: 'proj-1',
      reference_no: 'NOTA-001',
      nama_toko: 'TB Maju',
      tanggal_nota: '2026-11-20',
      total_nota_fisik: 1500000,
      lampiran_nota_urls: ['https://example.com/nota-001.jpg'],
      receipt_scope: 'BELANJA_BARANG',
    },
    {
      id: 'rc-kas-1',
      project_id: 'proj-1',
      reference_no: 'KWT-KAS-01',
      nama_toko: 'Warung Kopi Site',
      tanggal_nota: '2026-11-21',
      total_nota_fisik: 250000,
      lampiran_nota_urls: ['https://example.com/kwt-01.jpg'],
      receipt_scope: 'KAS_OPERASIONAL',
    },
  ];

  const stockMutations: MutasiBarang[] = [
    {
      id: 'st-1',
      barang_id: 'item-1',
      nama_barang: 'Semen 50kg',
      jenis: 'MASUK',
      jumlah: 20,
      satuan: 'Sak',
      stok_sebelum: 0,
      stok_sesudah: 20,
      pic_penerima_penyerah: 'Andi',
      tujuan_keperluan: 'Cor Lantai',
      tanggal: '2026-11-20T09:00:00Z',
      receipt_id: 'rc-terpadu-1',
      nomor_nota: 'NOTA-001',
      nama_toko: 'TB Maju',
      total_nota_fisik: 1500000,
      lampiran_nota_urls: ['https://example.com/nota-001.jpg'],
    },
  ];

  const cashMutations: MutasiKas[] = [
    {
      id: 'cs-1',
      jenis: 'KELUAR',
      jumlah_rp: 1500000,
      untuk_apa: 'Pelunasan Nota TB Maju',
      kategori_keperluan: 'Material',
      pic: 'Andi',
      tanggal: '2026-11-20T14:00:00Z',
      saldo_setelah: 8500000,
      receipt_id: 'rc-terpadu-1',
      nomor_kuitansi: 'NOTA-001',
      nama_toko: 'TB Maju',
      lampiran_nota_urls: ['https://example.com/nota-001.jpg'],
    },
    {
      id: 'cs-2',
      jenis: 'KELUAR',
      jumlah_rp: 250000,
      untuk_apa: 'Konsumsi Lembur Tim',
      kategori_keperluan: 'Upah & Konsumsi',
      pic: 'Budi',
      tanggal: '2026-11-21T18:00:00Z',
      saldo_setelah: 8250000,
      receipt_id: 'rc-kas-1',
      nomor_kuitansi: 'KWT-KAS-01',
      nama_toko: 'Warung Kopi Site',
      lampiran_nota_urls: ['https://example.com/kwt-01.jpg'],
    },
    {
      // Baris kas dibatalkan tidak boleh menaikkan cakupan atau jumlah tautan
      id: 'cs-void',
      jenis: 'KELUAR',
      jumlah_rp: 999999,
      untuk_apa: 'Salah Catat',
      kategori_keperluan: 'Material',
      pic: 'Budi',
      tanggal: '2026-11-22T09:00:00Z',
      saldo_setelah: 8250000,
      receipt_id: 'rc-kas-1',
      is_batal: true,
      status_dokumen: 'BATAL',
    },
  ];

  const album = buildProjectReceiptAlbum(stockMutations, dbReceipts, cashMutations);
  assert.equal(album.length, 2);

  const terpadu = album.find((a) => a.receiptId === 'rc-terpadu-1');
  assert.ok(terpadu, 'TERPADU receipt must be present');
  assert.equal(terpadu.receiptScope, 'TERPADU', 'Receipt linked to both stock and active cash must upgrade to TERPADU');
  assert.equal(terpadu.rawMutations.length, 1);
  assert.equal(terpadu.rawCashMutations?.length, 1);
  assert.equal(terpadu.linkedMutationsCount, 2);

  const kasOnly = album.find((a) => a.receiptId === 'rc-kas-1');
  assert.ok(kasOnly, 'Cash-only receipt must be present');
  assert.equal(kasOnly.receiptScope, 'KAS_OPERASIONAL');
  assert.equal(kasOnly.rawCashMutations?.length, 1, 'Voided cash mutation must not be counted');
});

test('buildProjectReceiptAlbum does not falsely merge same receipt number from two different stores', () => {
  const dbReceipts: ProjectReceipt[] = [
    {
      id: 'rc-a',
      project_id: 'proj-1',
      reference_no: '001',
      nama_toko: 'TB Sinar A',
      tanggal_nota: '2026-11-20',
      total_nota_fisik: 1_000_000,
      lampiran_nota_urls: ['https://example.com/a.jpg'],
      receipt_scope: 'BELANJA_BARANG',
    },
  ];
  const cashMutations: MutasiKas[] = [
    {
      id: 'cs-b',
      jenis: 'KELUAR',
      jumlah_rp: 500_000,
      untuk_apa: 'Beli cat di toko lain',
      kategori_keperluan: 'Material',
      pic: 'Budi',
      tanggal: '2026-11-21T10:00:00Z',
      saldo_setelah: 4_500_000,
      nomor_kuitansi: '001',
      nama_toko: 'TB Makmur B',
      lampiran_nota_urls: ['https://example.com/b.jpg'],
    },
  ];

  const album = buildProjectReceiptAlbum([], dbReceipts, cashMutations);
  assert.equal(album.length, 2);
  const rcA = album.find((i) => i.receiptId === 'rc-a')!;
  assert.equal(rcA.receiptScope, 'BELANJA_BARANG');
  assert.equal(rcA.rawCashMutations?.length || 0, 0);
});

test('buildProjectReceiptAlbum blocks substring store collision, blank-store cash merge, MASUK cash merge, and Jatah Klien TERPADU upgrade', () => {
  const dbReceipts: ProjectReceipt[] = [
    {
      id: 'rc-sinar-a',
      project_id: 'proj-1',
      reference_no: '001',
      nama_toko: 'TB Sinar A',
      tanggal_nota: '2026-11-20',
      total_nota_fisik: 1_000_000,
      lampiran_nota_urls: ['https://example.com/sinar-a.jpg'],
      receipt_scope: 'BELANJA_BARANG',
    },
    {
      id: 'rc-sinar-abadi',
      project_id: 'proj-1',
      reference_no: '001',
      nama_toko: 'TB Sinar Abadi',
      tanggal_nota: '2026-11-21',
      total_nota_fisik: 2_000_000,
      lampiran_nota_urls: ['https://example.com/sinar-abadi.jpg'],
      receipt_scope: 'BELANJA_BARANG',
    },
    {
      id: 'rc-imk-sj',
      project_id: 'proj-1',
      reference_no: 'SJ-99',
      nama_toko: 'Gudang IMK',
      tanggal_nota: '2026-11-22',
      total_nota_fisik: 0,
      lampiran_nota_urls: ['https://example.com/sj-99.jpg'],
      receipt_scope: 'BELANJA_BARANG',
    },
  ];

  const stockMutations: MutasiBarang[] = [
    {
      id: 'st-sinar-a',
      barang_id: 'b1',
      nama_barang: 'Semen',
      jenis: 'MASUK',
      jumlah: 10,
      satuan: 'sak',
      stok_sebelum: 0,
      stok_sesudah: 10,
      pic_penerima_penyerah: 'Andi',
      tujuan_keperluan: 'BOQ',
      tanggal: '2026-11-20T08:00:00Z',
      owner_type: 'KONTRAKTOR',
      receipt_id: 'rc-sinar-a',
      nomor_nota: '001',
      nama_toko: 'TB Sinar A',
    },
    {
      id: 'st-sinar-abadi',
      barang_id: 'b2',
      nama_barang: 'Cat',
      jenis: 'MASUK',
      jumlah: 5,
      satuan: 'pail',
      stok_sebelum: 0,
      stok_sesudah: 5,
      pic_penerima_penyerah: 'Andi',
      tujuan_keperluan: 'BOQ',
      tanggal: '2026-11-21T08:00:00Z',
      owner_type: 'KONTRAKTOR',
      receipt_id: 'rc-sinar-abadi',
      nomor_nota: '001',
      nama_toko: 'TB Sinar Abadi',
    },
    {
      id: 'st-imk',
      barang_id: 'b3',
      nama_barang: 'Panel Klien',
      jenis: 'MASUK',
      jumlah: 1,
      satuan: 'unit',
      stok_sebelum: 0,
      stok_sesudah: 1,
      pic_penerima_penyerah: 'Andi',
      tujuan_keperluan: 'Jatah Klien',
      tanggal: '2026-11-22T08:00:00Z',
      owner_type: 'IMK',
      receipt_id: 'rc-imk-sj',
      nomor_nota: 'SJ-99',
      nama_toko: 'Gudang IMK',
    },
  ];

  const cashMutations: MutasiKas[] = [
    // Kas KELUAR tanpa toko bernomor 001 tidak boleh masuk ke TB Sinar A maupun TB Sinar Abadi
    {
      id: 'cs-blank',
      jenis: 'KELUAR',
      jumlah_rp: 100_000,
      untuk_apa: 'Beli air mineral',
      kategori_keperluan: 'Operasional',
      pic: 'Budi',
      tanggal: '2026-11-20T12:00:00Z',
      saldo_setelah: 9_900_000,
      nomor_kuitansi: '001',
      nama_toko: '',
    },
    // Kas MASUK bernomor 001 bertoko TB Sinar Abadi tidak boleh menaikkan nota barang jadi TERPADU
    {
      id: 'cs-in-abadi',
      jenis: 'MASUK',
      jumlah_rp: 2_000_000,
      untuk_apa: 'Pengembalian dana',
      kategori_keperluan: 'Penerimaan Lainnya',
      pic: 'Budi',
      tanggal: '2026-11-21T12:00:00Z',
      saldo_setelah: 11_900_000,
      nomor_kuitansi: '001',
      nama_toko: 'TB Sinar Abadi',
    },
    // Kas KELUAR bernomor SJ-99 tidak boleh menaikkan nota Jatah Klien IMK jadi TERPADU
    {
      id: 'cs-imk-clash',
      jenis: 'KELUAR',
      jumlah_rp: 500_000,
      untuk_apa: 'Angkut barang',
      kategori_keperluan: 'Material',
      pic: 'Budi',
      tanggal: '2026-11-22T12:00:00Z',
      saldo_setelah: 11_400_000,
      nomor_kuitansi: 'SJ-99',
      nama_toko: 'Gudang IMK',
    },
    // Pembayaran sah hanya untuk TB Sinar A
    {
      id: 'cs-pay-sinar-a',
      jenis: 'KELUAR',
      jumlah_rp: 1_000_000,
      untuk_apa: 'Bayar nota TB Sinar A',
      kategori_keperluan: 'Material',
      pic: 'Andi',
      tanggal: '2026-11-20T15:00:00Z',
      saldo_setelah: 10_400_000,
      nomor_kuitansi: '001',
      nama_toko: 'TB. Sinar A',
    },
  ];

  const album = buildProjectReceiptAlbum(stockMutations, dbReceipts, cashMutations, 'PT INDO MURO KENCANA');
  const sinarA = album.find((i) => i.receiptId === 'rc-sinar-a')!;
  const sinarAbadi = album.find((i) => i.receiptId === 'rc-sinar-abadi')!;
  const imkSj = album.find((i) => i.receiptId === 'rc-imk-sj')!;

  assert.equal(sinarA.receiptScope, 'TERPADU');
  assert.deepEqual(sinarA.rawCashMutations?.map((c) => c.id), ['cs-pay-sinar-a']);

  assert.equal(sinarAbadi.receiptScope, 'BELANJA_BARANG');
  assert.equal(sinarAbadi.rawCashMutations?.length || 0, 0);

  assert.equal(imkSj.receiptScope, 'BELANJA_BARANG');
  assert.equal(imkSj.rawCashMutations?.length || 0, 0);
});

test('getReceiptSignedUrl handles empty, data URLs, blobs, presigned, and external URLs safely', async () => {
  // 1. Empty string
  assert.equal(await getReceiptSignedUrl(''), '');

  // 2. Data URL
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY44YAAAAASUVORK5CYII=';
  assert.equal(await getReceiptSignedUrl(dataUrl), dataUrl);

  // 3. Blob URL
  const blobUrl = 'blob:http://localhost:5173/1234-5678-90ab';
  assert.equal(await getReceiptSignedUrl(blobUrl), blobUrl);

  // 4. Pre-signed URL
  const presigned = 'https://supabase.co/storage/v1/object/sign/receipts/proj-1/bon.jpg?token=abc';
  assert.equal(await getReceiptSignedUrl(presigned), presigned);

  // 5. External URL
  const external = 'https://example.com/receipt.jpg';
  assert.equal(await getReceiptSignedUrl(external), external);
});
