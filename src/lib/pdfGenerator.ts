import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { DokumenLaporan, MutasiBarang, MutasiKas, UserProfile } from '../types';

function stableStringify(value: any): string {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export function formatRupiah(value: number): string {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDateTime(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

export function formatDateOnly(dateString: string): string {
  try {
    const d = new Date(dateString);
    return d.toLocaleDateString('id-ID', {
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

/**
 * Render Kop Surat Resmi CV. MENARA MEGAH
 */
function drawOfficialHeader(doc: jsPDF, pageWidth: number) {
  // Nama Perusahaan
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(15, 23, 42); // slate-900
  doc.text('CV. MENARA MEGAH', 14, 15);

  // Alamat & Kontak Resmi
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85); // slate-700
  doc.text('Jl. Veteran Gg. Margo Rukun No. 144', 14, 20);
  doc.text('Puruk Cahu Kalimantan Tengah - Indonesia', 14, 24);
  doc.text('Telpon/Hand Phone : 0822 9152 5049   e-mail : menara.megah.cv@gmail.com', 14, 28);

  // NPWP badge di kanan atas
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 58, 138); // blue-900
  doc.text('NPWP: 00.243.765.8-471.000', pageWidth - 14, 15, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Klien: PT INDO MURO KENCANA', pageWidth - 14, 20, { align: 'right' });
  doc.text('Proyek: UDU Project (Trainer & Office)', pageWidth - 14, 24, { align: 'right' });

  // Garis Pembatas Kop Surat Biru Tebal
  doc.setDrawColor(37, 99, 235); // blue-600
  doc.setLineWidth(1.2);
  doc.line(14, 32, pageWidth - 14, 32);

  doc.setDrawColor(148, 163, 184); // slate-400
  doc.setLineWidth(0.3);
  doc.line(14, 33.5, pageWidth - 14, 33.5);
}

/**
 * Generate PDF for Stock Mutation Report
 */
export async function generateStockMutationPDF(params: {
  docId: string;
  startDate: string;
  endDate: string;
  mutations: MutasiBarang[];
  signer: UserProfile;
  projectName?: string;
}): Promise<DokumenLaporan> {
  const { docId, startDate, endDate, mutations, signer, projectName = 'UDU Project (Trainer & UDU Office)' } = params;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Kop Surat Resmi
  drawOfficialHeader(doc, pageWidth);

  // Judul Dokumen
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('BERITA ACARA & REKAPITULASI MUTASI BARANG', 14, 42);

  // Metadata Laporan
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);

  doc.text(`Nomor Registrasi : ${docId}`, 14, 48);
  doc.text(`Periode Laporan  : ${formatDateOnly(startDate)} s/d ${formatDateOnly(endDate)}`, 14, 52);
  doc.text(`Tanggal Cetak    : ${formatDateOnly(new Date().toISOString())}`, 14, 56);

  doc.text(`Project : ${projectName}`, pageWidth - 14, 48, { align: 'right' });
  doc.text(`Kontraktor : CV. MENARA MEGAH`, pageWidth - 14, 52, { align: 'right' });
  doc.text(`Status Alur : Tervalidasi Berjenjang`, pageWidth - 14, 56, { align: 'right' });

  // Filter transaksi aktif (abaikan yang BATAL / DIGANTI untuk total)
  const activeMutations = mutations.filter(m => !m.is_batal && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI');
  const totalMasuk = activeMutations.filter((m) => m.jenis === 'MASUK').reduce((acc, m) => acc + m.jumlah, 0);
  const totalKeluar = activeMutations.filter((m) => m.jenis === 'KELUAR').reduce((acc, m) => acc + m.jumlah, 0);

  // KPI Summary Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 60, pageWidth - 28, 14, 2, 2, 'FD');

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TOTAL TRANSAKSI', 20, 65);
  doc.text('TOTAL VOLUME MASUK', 80, 65);
  doc.text('TOTAL VOLUME KELUAR', 140, 65);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`${mutations.length} Transaksi`, 20, 71);

  doc.setTextColor(22, 101, 52);
  doc.text(`+ ${totalMasuk.toLocaleString('id-ID')} unit`, 80, 71);

  doc.setTextColor(159, 18, 57);
  doc.text(`- ${totalKeluar.toLocaleString('id-ID')} unit`, 140, 71);

  // Table Mutasi
  const tableData = mutations.map((m, index) => {
    const isVoid = m.is_batal || m.status_dokumen === 'BATAL';
    const isReplaced = m.is_ganti || m.status_dokumen === 'DIGANTI';
    const statusText = isVoid ? 'BATAL' : isReplaced ? 'DIGANTI' : (m.status_dokumen || 'DITERBITKAN');
    return [
      (index + 1).toString(),
      formatDateTime(m.tanggal),
      m.nama_barang,
      m.jenis,
      isVoid ? '0 (Batal)' : `${m.jumlah} ${m.satuan}`,
      m.tujuan_keperluan || '-',
      m.pic_penerima_penyerah || '-',
      statusText
    ];
  });

  autoTable(doc, {
    startY: 78,
    head: [['No', 'Waktu', 'Nama Material / Barang', 'Jenis', 'Volume', 'Peruntukan / Lokasi', 'PIC', 'Status Alur']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    styles: {
      fontSize: 7,
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 26 },
      2: { cellWidth: 46 },
      3: { cellWidth: 16, halign: 'center' },
      4: { cellWidth: 22, halign: 'right' },
      5: { cellWidth: 32 },
      6: { cellWidth: 20 },
      7: { cellWidth: 20, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
  });

  // Bagian Tanda Tangan Berjenjang (Serial 4 Tingkat Sesuai Dokumen)
  const finalY = (doc as any).lastAutoTable?.finalY || 160;
  let signY = finalY + 10;

  if (signY + 50 > pageHeight) {
    doc.addPage();
    signY = 25;
  }

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(14, signY, pageWidth - 14, signY);
  signY += 5;

  const colWidth = (pageWidth - 28) / 4;

  // 1. Diterbitkan Oleh (Clerk)
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Diterbitkan Oleh,', 14, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Clerk / Logistik', 14, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Sumarlin', 14, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('sumarlin.1103@gmail.com', 14, signY + 26);

  // 2. Diperiksa Oleh (Foreman / Spv)
  const col2X = 14 + colWidth;
  doc.setFontSize(7.5);
  doc.text('Diperiksa Oleh,', col2X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Spv. / Pengawas', col2X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Sumarlin', col2X, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Status: Terverifikasi', col2X, signY + 26);

  // 3. Disetujui Oleh (Dept. Manager)
  const col3X = 14 + colWidth * 2;
  doc.setFontSize(7.5);
  doc.text('Disetujui Oleh,', col3X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Dept. Manager', col3X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Sumarlin', col3X, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Status: Disetujui', col3X, signY + 26);

  // 4. Mengetahui / Disahkan (Direktur + TTE/QR)
  const col4X = 14 + colWidth * 3;
  doc.setFontSize(7.5);
  doc.text('Mengetahui / TTE,', col4X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Direktur Utama', col4X, signY + 4);

  // Generate QR Code untuk Direktur
  const qrDataUrl = await QRCode.toDataURL(
    `TTE-CV-MENARA-MEGAH:${docId}:DIREKTUR:ROLLY_YOHANES_KARINAH:NPWP_0024376584714000:STATUS_VALID_SAH`,
    { width: 100, margin: 0 }
  );
  doc.addImage(qrDataUrl, 'PNG', col4X, signY + 7, 16, 16);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('ROLLY YOHANES KARINAH', col4X, signY + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('rrollyy6@gmail.com', col4X, signY + 30);

  // Hash Keamanan Dokumen di Footer
  const snapshot = stableStringify({
    docId,
    startDate,
    endDate,
    company: 'CV. MENARA MEGAH',
    project: projectName,
    transactions: mutations.map(m => ({ id: m.id, qty: m.jumlah, barang: m.nama_barang, status: m.status_dokumen }))
  });
  const hash = await sha256Hex(snapshot);

  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | CV. MENARA MEGAH - Puruk Cahu`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  // Simpan PDF
  doc.save(`${docId}_Mutasi_Barang_CV_MENARA_MEGAH.pdf`);

  return {
    id: docId,
    judul: 'Rekap Mutasi Material & Barang CV. Menara Megah',
    jenis: 'MUTASI_STOK',
    status: 'TERVERIFIKASI',
    periode_awal: startDate,
    periode_akhir: endDate,
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: 'ROLLY YOHANES KARINAH',
    penandatangan_jabatan: 'Direktur Utama',
    penandatangan_email: 'rrollyy6@gmail.com',
    hash_keamanan: hash,
    total_transaksi: mutations.length,
    ringkasan_nilai_rp: totalMasuk - totalKeluar,
    qr_payload: `TTE-CV-MENARA-MEGAH:${docId}:DIREKTUR:ROLLY_YOHANES_KARINAH:NPWP_0024376584714000:STATUS_VALID_SAH`,
  };
}

/**
 * Generate PDF for Cashflow Ledger Report
 */
export async function generateCashflowPDF(params: {
  docId: string;
  startDate: string;
  endDate: string;
  cashMutations: MutasiKas[];
  signer: UserProfile;
  projectName?: string;
}): Promise<DokumenLaporan> {
  const { docId, startDate, endDate, cashMutations, signer, projectName = 'UDU Project (Trainer & UDU Office)' } = params;
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Kop Surat Resmi
  drawOfficialHeader(doc, pageWidth);

  // Judul
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('BUKU KAS & LAPORAN ARUS DANA PROYEK', 14, 42);

  // Metadata
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);

  doc.text(`Nomor Registrasi : ${docId}`, 14, 48);
  doc.text(`Periode Laporan  : ${formatDateOnly(startDate)} s/d ${formatDateOnly(endDate)}`, 14, 52);
  doc.text(`Tanggal Cetak    : ${formatDateOnly(new Date().toISOString())}`, 14, 56);

  doc.text(`Project : ${projectName}`, pageWidth - 14, 48, { align: 'right' });
  doc.text(`Kontraktor : CV. MENARA MEGAH`, pageWidth - 14, 52, { align: 'right' });
  doc.text(`Status Alur : Tervalidasi Berjenjang`, pageWidth - 14, 56, { align: 'right' });

  const activeCash = cashMutations.filter(m => !m.is_batal && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI');
  const totalMasuk = activeCash.filter((m) => m.jenis === 'MASUK').reduce((acc, m) => acc + m.jumlah_rp, 0);
  const totalKeluar = activeCash.filter((m) => m.jenis === 'KELUAR').reduce((acc, m) => acc + m.jumlah_rp, 0);
  const endingBalance = activeCash[0]?.saldo_setelah || 0;

  // KPI Summary Strip
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 60, pageWidth - 28, 14, 2, 2, 'FD');

  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text('TOTAL DANA MASUK', 20, 65);
  doc.text('TOTAL DANA KELUAR', 80, 65);
  doc.text('SALDO AKHIR PROYEK', 140, 65);

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(22, 101, 52);
  doc.text(`+ ${formatRupiah(totalMasuk)}`, 20, 71);

  doc.setTextColor(159, 18, 57);
  doc.text(`- ${formatRupiah(totalKeluar)}`, 80, 71);

  doc.setTextColor(15, 23, 42);
  doc.text(formatRupiah(endingBalance), 140, 71);

  // Table Mutasi Kas
  const tableData = cashMutations.map((m, index) => {
    const isVoid = m.is_batal || m.status_dokumen === 'BATAL';
    const isReplaced = m.is_ganti || m.status_dokumen === 'DIGANTI';
    const statusText = isVoid ? 'BATAL' : isReplaced ? 'DIGANTI' : (m.status_dokumen || 'DITERBITKAN');
    return [
      (index + 1).toString(),
      formatDateTime(m.tanggal),
      m.untuk_apa,
      m.kategori_keperluan || 'Operasional',
      m.jenis,
      isVoid ? 'Rp 0 (Batal)' : formatRupiah(m.jumlah_rp),
      m.pic,
      statusText
    ];
  });

  autoTable(doc, {
    startY: 78,
    head: [['No', 'Waktu', 'Peruntukan / Keterangan', 'Kategori', 'Jenis', 'Nominal (Rp)', 'PIC', 'Status Alur']],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    styles: {
      fontSize: 7,
      cellPadding: 2,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 26 },
      2: { cellWidth: 46 },
      3: { cellWidth: 22 },
      4: { cellWidth: 16, halign: 'center' },
      5: { cellWidth: 26, halign: 'right' },
      6: { cellWidth: 18 },
      7: { cellWidth: 18, halign: 'center' },
    },
    margin: { left: 14, right: 14 },
  });

  // Tanda Tangan 4 Kolom Berjenjang
  const finalY = (doc as any).lastAutoTable?.finalY || 160;
  let signY = finalY + 10;

  if (signY + 50 > pageHeight) {
    doc.addPage();
    signY = 25;
  }

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(14, signY, pageWidth - 14, signY);
  signY += 5;

  const colWidth = (pageWidth - 28) / 4;

  // 1. Diterbitkan Oleh (Clerk)
  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Diterbitkan Oleh,', 14, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Clerk / Kasir', 14, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Sumarlin', 14, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('sumarlin.1103@gmail.com', 14, signY + 26);

  // 2. Diperiksa Oleh (Spv)
  const col2X = 14 + colWidth;
  doc.setFontSize(7.5);
  doc.text('Diperiksa Oleh,', col2X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Spv. / Pengawas', col2X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Sumarlin', col2X, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Status: Terverifikasi', col2X, signY + 26);

  // 3. Disetujui Oleh (Dept. Manager)
  const col3X = 14 + colWidth * 2;
  doc.setFontSize(7.5);
  doc.text('Disetujui Oleh,', col3X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Dept. Manager', col3X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Sumarlin', col3X, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('Status: Disetujui', col3X, signY + 26);

  // 4. Mengetahui / Disahkan (Direktur + TTE/QR)
  const col4X = 14 + colWidth * 3;
  doc.setFontSize(7.5);
  doc.text('Mengetahui / TTE,', col4X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Direktur Utama', col4X, signY + 4);

  const qrDataUrl = await QRCode.toDataURL(
    `TTE-CV-MENARA-MEGAH:${docId}:DIREKTUR:ROLLY_YOHANES_KARINAH:NPWP_0024376584714000:STATUS_VALID_SAH`,
    { width: 100, margin: 0 }
  );
  doc.addImage(qrDataUrl, 'PNG', col4X, signY + 7, 16, 16);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text('ROLLY YOHANES KARINAH', col4X, signY + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text('rrollyy6@gmail.com', col4X, signY + 30);

  const snapshot = stableStringify({
    docId,
    startDate,
    endDate,
    company: 'CV. MENARA MEGAH',
    project: projectName,
    cash_mutations: cashMutations.map(m => ({ id: m.id, amount: m.jumlah_rp, jenis: m.jenis, status: m.status_dokumen }))
  });
  const hash = await sha256Hex(snapshot);

  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | CV. MENARA MEGAH - Puruk Cahu`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  doc.save(`${docId}_Buku_Kas_CV_MENARA_MEGAH.pdf`);

  return {
    id: docId,
    judul: 'Laporan Arus Kas & Dana Proyek CV. Menara Megah',
    jenis: 'MUTASI_KAS',
    status: 'TERVERIFIKASI',
    periode_awal: startDate,
    periode_akhir: endDate,
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: 'ROLLY YOHANES KARINAH',
    penandatangan_jabatan: 'Direktur Utama',
    penandatangan_email: 'rrollyy6@gmail.com',
    hash_keamanan: hash,
    total_transaksi: cashMutations.length,
    ringkasan_nilai_rp: endingBalance,
    qr_payload: `TTE-CV-MENARA-MEGAH:${docId}:DIREKTUR:ROLLY_YOHANES_KARINAH:NPWP_0024376584714000:STATUS_VALID_SAH`,
  };
}
