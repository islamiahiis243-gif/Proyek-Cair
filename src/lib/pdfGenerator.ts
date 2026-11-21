import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { DokumenLaporan, MutasiBarang, MutasiKas, UserProfile, ItemBarang, PhysicalMaterialItem, TenantBranding } from '../types';
import {
  analyzeIncomingProviderDiscrepancy,
  isClientProvidedRemark,
  summarizeMaterialIncomingDiscrepancy
} from './stockMutationEngine';

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

interface ResolvedPdfBranding {
  contractorName: string;
  contractorSlug: string;
  contractorNpwp: string;
  contractorAddress: string;
  contractorContact: string;
  contractorLogoUrl?: string;
  clientName: string;
  projectName: string;
  directorName: string;
  directorEmail: string;
}

function resolvePdfBranding(branding?: TenantBranding, overrideProjectName?: string): ResolvedPdfBranding {
  const contractorName = (branding?.contractorName || '').trim() || 'PERUSAHAAN KONTRAKTOR';
  const contractorSlug =
    contractorName
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'PROYEK';
  return {
    contractorName,
    contractorSlug,
    contractorNpwp: (branding?.contractorNpwp || '').trim(),
    contractorAddress: (branding?.contractorAddress || '').trim(),
    contractorContact: (branding?.contractorContact || '').trim(),
    contractorLogoUrl: (branding?.contractorLogoUrl || '').trim(),
    clientName: (branding?.clientName || '').trim() || 'Klien',
    projectName: (overrideProjectName || branding?.projectName || '').trim() || 'Proyek Aktif',
    directorName: (branding?.directorName || '').trim() || 'Direktur Utama',
    directorEmail: (branding?.directorEmail || '').trim(),
  };
}

/**
 * Render Kop Surat Resmi Dinamis (Multi-Tenant)
 */
function drawOfficialHeader(doc: jsPDF, pageWidth: number, branding: ResolvedPdfBranding) {
  let textStartX = 14;

  if (branding.contractorLogoUrl) {
    try {
      let format = 'JPEG';
      if (branding.contractorLogoUrl.startsWith('data:image/png')) {
        format = 'PNG';
      } else if (branding.contractorLogoUrl.startsWith('data:image/webp')) {
        format = 'WEBP';
      }
      doc.addImage(branding.contractorLogoUrl, format, 14, 10, 18, 18);
      textStartX = 36;
    } catch (e) {
      console.warn('Gagal menambahkan logo ke PDF kop surat:', e);
      textStartX = 14;
    }
  }

  // Nama Perusahaan Kontraktor
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(15, 23, 42);
  doc.text(branding.contractorName.toUpperCase(), textStartX, 15);

  // Alamat & Kontak Resmi (opsional jika tersedia di profil perusahaan)
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  if (branding.contractorAddress) {
    doc.text(branding.contractorAddress, textStartX, 20);
  } else {
    doc.text(`Proyek: ${branding.projectName}`, textStartX, 20);
  }
  if (branding.contractorContact) {
    doc.text(branding.contractorContact, textStartX, 25);
  } else {
    doc.text(`Laporan Operasional & Audit Proyek`, textStartX, 25);
  }

  // NPWP & Info Klien/Proyek di kanan atas
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 58, 138);
  if (branding.contractorNpwp) {
    doc.text(`NPWP: ${branding.contractorNpwp}`, pageWidth - 14, 15, { align: 'right' });
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`Klien: ${branding.clientName}`, pageWidth - 14, 20, { align: 'right' });
  doc.text(`Proyek: ${branding.projectName}`, pageWidth - 14, 24, { align: 'right' });

  // Garis Pembatas Kop Surat Biru Tebal
  doc.setDrawColor(37, 99, 235);
  doc.setLineWidth(1.2);
  doc.line(14, 32, pageWidth - 14, 32);

  doc.setDrawColor(148, 163, 184);
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
  physicalMaterials?: PhysicalMaterialItem[];
  branding?: TenantBranding;
  filterSummary?: string;
  customNotes?: string;
  selectedColumns?: string[];
}): Promise<DokumenLaporan> {
  const {
    docId,
    startDate,
    endDate,
    mutations,
    signer,
    projectName,
    physicalMaterials = [],
    branding: rawBranding,
    filterSummary,
    customNotes,
    selectedColumns
  } = params;
  const b = resolvePdfBranding(rawBranding, projectName);
  const providerLabels = { contractorName: b.contractorName, clientName: b.clientName };
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Kop Surat Resmi Dinamis
  drawOfficialHeader(doc, pageWidth, b);

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
  doc.text(`Tanggal Cetak    : ${formatDateOnly(new Date().toISOString())}${filterSummary ? ` | ${filterSummary}` : ''}${customNotes ? ` | Catatan: ${customNotes}` : ''}`, 14, 56);

  doc.text(`Proyek : ${b.projectName}`, pageWidth - 14, 48, { align: 'right' });
  doc.text(`Kontraktor : ${b.contractorName}`, pageWidth - 14, 52, { align: 'right' });
  doc.text(`Status Alur : Tervalidasi Berjenjang`, pageWidth - 14, 56, { align: 'right' });

  // Filter transaksi aktif (abaikan yang BATAL / DIGANTI untuk total)
  const activeMutations = mutations.filter(m => !m.is_batal && !m.is_ganti && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI');
  const totalMasuk = activeMutations.filter((m) => m.jenis === 'MASUK').reduce((acc, m) => acc + m.jumlah, 0);
  const totalKeluar = activeMutations.filter((m) => m.jenis === 'KELUAR').reduce((acc, m) => acc + m.jumlah, 0);

  // Analisis selisih penyedia (mis. Jatah Klien tapi ditalangi Kontraktor)
  const discrepancyByRow = mutations.map((m) => analyzeIncomingProviderDiscrepancy(m, physicalMaterials, mutations, providerLabels));
  const mismatchCount = mutations.filter(
    (m, i) => !m.is_batal && !m.is_ganti && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI' && discrepancyByRow[i].isMismatch
  ).length;

  // KPI Summary Box
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 60, pageWidth - 28, 14, 2, 2, 'FD');

  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('TOTAL TRANSAKSI', 18, 65);
  doc.text('TOTAL VOLUME MASUK', 62, 65);
  doc.text('TOTAL VOLUME KELUAR', 108, 65);
  doc.text('BEDA PENYEDIA / TALANGAN', 152, 65);

  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`${mutations.length} Transaksi`, 18, 71);

  doc.setTextColor(22, 101, 52);
  doc.text(`+ ${totalMasuk.toLocaleString('id-ID')} unit`, 62, 71);

  doc.setTextColor(159, 18, 57);
  doc.text(`- ${totalKeluar.toLocaleString('id-ID')} unit`, 108, 71);

  if (mismatchCount > 0) {
    doc.setTextColor(180, 83, 9);
    doc.text(`${mismatchCount} Transaksi`, 152, 71);
  } else {
    doc.setTextColor(100, 116, 139);
    doc.text('0 Transaksi', 152, 71);
  }

  // Definisi Pemetaan Kolom Fleksibel
  const stockColumnMap: Record<string, {
    header: string;
    width?: number;
    align?: 'left' | 'center' | 'right';
    getValue: (m: MutasiBarang, idx: number, disc: any, isVoid: boolean) => string;
  }> = {
    no: { header: 'No', width: 9, align: 'center', getValue: (_, idx) => String(idx + 1) },
    tanggal: { header: 'Waktu', width: 24, align: 'left', getValue: (m) => formatDateTime(m.tanggal) },
    nomor_surat_jalan: { header: 'No Surat Jalan', width: 24, align: 'left', getValue: (m) => m.nomor_surat_jalan || '-' },
    nama_barang: { header: 'Nama Material / Barang', width: 40, align: 'left', getValue: (m) => m.nama_barang },
    jenis: { header: 'Jenis', width: 14, align: 'center', getValue: (m) => m.jenis },
    jumlah: { header: 'Volume', width: 20, align: 'right', getValue: (m, _, __, isVoid) => isVoid ? '0 (Batal)' : `${m.jumlah} ${m.satuan}` },
    satuan: { header: 'Satuan', width: 14, align: 'center', getValue: (m) => m.satuan },
    tujuan_keperluan: {
      header: 'Asal / Peruntukan',
      width: 45,
      align: 'left',
      getValue: (m, _, disc) => {
        const providerLine =
          m.jenis === 'MASUK'
            ? `Asal: ${m.source_name || disc?.actualProviderLabel || '-'}`
            : m.beban_biaya === 'KLIEN' || (m.beban_biaya as string) === 'PERMINTAAN_KLIEN'
            ? 'Beban: Permintaan Klien'
            : m.beban_biaya === 'BONUS_KLIEN'
            ? 'Beban: Bonus Klien'
            : m.beban_biaya === 'OPERASIONAL'
            ? 'Beban: Operasional'
            : 'Beban: Proyek BOQ';
        const purposeRaw = (m.tujuan_keperluan || '-').trim();
        const mismatchLine = disc?.isMismatch ? `\n[!] ${disc.pdfNote}` : '';
        return disc?.isMismatch && purposeRaw.toLowerCase().includes('talangan')
          ? `${providerLine}${mismatchLine}`
          : `${providerLine}\n${purposeRaw}${mismatchLine}`;
      }
    },
    pic: { header: 'PIC', width: 18, align: 'left', getValue: (m) => m.pic_penerima_penyerah || '-' },
    status_dokumen: {
      header: 'Status',
      width: 16,
      align: 'center',
      getValue: (m, _, __, isVoid) => {
        const isReplaced = m.is_ganti || m.status_dokumen === 'DIGANTI';
        return isVoid ? 'BATAL' : isReplaced ? 'DIGANTI' : (m.status_dokumen || 'DITERBITKAN');
      }
    }
  };

  const defaultStockCols = ['no', 'tanggal', 'nama_barang', 'jenis', 'jumlah', 'tujuan_keperluan', 'pic', 'status_dokumen'];
  const activeStockCols = (selectedColumns && selectedColumns.length > 0)
    ? selectedColumns.filter(c => stockColumnMap[c])
    : defaultStockCols;

  const tableData = mutations.map((m, index) => {
    const isVoid = m.is_batal || m.status_dokumen === 'BATAL';
    const disc = discrepancyByRow[index];
    return activeStockCols.map(c => stockColumnMap[c].getValue(m, index, disc, isVoid));
  });

  const columnStylesConfig: any = {};
  activeStockCols.forEach((c, idx) => {
    columnStylesConfig[idx] = {
      cellWidth: stockColumnMap[c].width,
      halign: stockColumnMap[c].align
    };
  });

  const purposeColIdx = activeStockCols.indexOf('tujuan_keperluan');

  autoTable(doc, {
    startY: 78,
    head: [activeStockCols.map(c => stockColumnMap[c].header)],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    styles: {
      fontSize: 6.8,
      cellPadding: 1.8,
    },
    columnStyles: columnStylesConfig,
    didParseCell: (data) => {
      if (data.section === 'body') {
        const disc = discrepancyByRow[data.row.index];
        if (disc?.isMismatch) {
          data.cell.styles.fillColor = [254, 243, 199];
          if (purposeColIdx !== -1 && data.column.index === purposeColIdx) {
            data.cell.styles.textColor = [146, 64, 14];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
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
  doc.text(signer?.name || 'Pelaksana Administrasi', 14, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  if (signer?.email) doc.text(signer.email, 14, signY + 26);

  // 2. Diperiksa Oleh (Foreman / Spv)
  const col2X = 14 + colWidth;
  doc.setFontSize(7.5);
  doc.text('Diperiksa Oleh,', col2X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Spv. / Pengawas', col2X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Pengawas Lapangan', col2X, signY + 22);
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
  doc.text('Manajer Terkait', col3X, signY + 22);
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

  const qrPayload = `TTE-${b.contractorSlug}:${docId}:DIREKTUR:${b.directorName.replace(/\s+/g, '_')}:NPWP_${b.contractorNpwp || 'NA'}:STATUS_VALID_SAH`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 100, margin: 0 });
  doc.addImage(qrDataUrl, 'PNG', col4X, signY + 7, 16, 16);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(b.directorName, col4X, signY + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  if (b.directorEmail) doc.text(b.directorEmail, col4X, signY + 30);

  // Hash Keamanan Dokumen di Footer
  const snapshot = stableStringify({
    docId,
    startDate,
    endDate,
    company: b.contractorName,
    project: b.projectName,
    transactions: mutations.map(m => ({ id: m.id, qty: m.jumlah, barang: m.nama_barang, status: m.status_dokumen }))
  });
  const hash = await sha256Hex(snapshot);

  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | ${b.contractorName}`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  // Simpan PDF
  doc.save(`${docId}_Mutasi_Barang_${b.contractorSlug}.pdf`);

  return {
    id: docId,
    judul: `Rekap Mutasi Material & Barang ${b.contractorName}`,
    jenis: 'MUTASI_STOK',
    status: 'TERVERIFIKASI',
    periode_awal: startDate,
    periode_akhir: endDate,
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: b.directorName,
    penandatangan_jabatan: 'Direktur Utama',
    penandatangan_email: b.directorEmail,
    hash_keamanan: hash,
    total_transaksi: mutations.length,
    ringkasan_nilai_rp: totalMasuk - totalKeluar,
    qr_payload: qrPayload,
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
  branding?: TenantBranding;
  filterSummary?: string;
  customNotes?: string;
  selectedColumns?: string[];
}): Promise<DokumenLaporan> {
  const { docId, startDate, endDate, cashMutations, signer, projectName, branding: rawBranding, filterSummary, customNotes, selectedColumns } = params;
  const b = resolvePdfBranding(rawBranding, projectName);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Kop Surat Resmi Dinamis
  drawOfficialHeader(doc, pageWidth, b);

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
  doc.text(`Tanggal Cetak    : ${formatDateOnly(new Date().toISOString())}${filterSummary ? ` | ${filterSummary}` : ''}${customNotes ? ` | Catatan: ${customNotes}` : ''}`, 14, 56);

  doc.text(`Proyek : ${b.projectName}`, pageWidth - 14, 48, { align: 'right' });
  doc.text(`Kontraktor : ${b.contractorName}`, pageWidth - 14, 52, { align: 'right' });
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

  // Definisi Pemetaan Kolom Fleksibel Kas
  const cashColumnMap: Record<string, {
    header: string;
    width?: number;
    align?: 'left' | 'center' | 'right';
    getValue: (m: MutasiKas, idx: number, isVoid: boolean) => string;
  }> = {
    no: { header: 'No', width: 10, align: 'center', getValue: (_, idx) => String(idx + 1) },
    tanggal: { header: 'Waktu', width: 26, align: 'left', getValue: (m) => formatDateTime(m.tanggal) },
    nomor_kuitansi: { header: 'No Kuitansi', width: 24, align: 'left', getValue: (m) => m.nomor_kuitansi || '-' },
    untuk_apa: { header: 'Peruntukan / Keterangan', width: 46, align: 'left', getValue: (m) => m.untuk_apa },
    kategori_keperluan: { header: 'Kategori', width: 22, align: 'left', getValue: (m) => m.kategori_keperluan || 'Operasional' },
    jenis: { header: 'Jenis', width: 16, align: 'center', getValue: (m) => m.jenis },
    jumlah_rp: { header: 'Nominal (Rp)', width: 26, align: 'right', getValue: (m, _, isVoid) => isVoid ? 'Rp 0 (Batal)' : `${m.jenis === 'MASUK' ? '+' : '-'} ${formatRupiah(m.jumlah_rp)}` },
    saldo_setelah: { header: 'Saldo Kas (Rp)', width: 28, align: 'right', getValue: (m) => formatRupiah(m.saldo_setelah) },
    pic: { header: 'PIC', width: 18, align: 'left', getValue: (m) => m.pic },
    status_dokumen: {
      header: 'Status Alur',
      width: 18,
      align: 'center',
      getValue: (m, _, isVoid) => {
        const isReplaced = m.is_ganti || m.status_dokumen === 'DIGANTI';
        return isVoid ? 'BATAL' : isReplaced ? 'DIGANTI' : (m.status_dokumen || 'DITERBITKAN');
      }
    }
  };

  const defaultCashCols = ['no', 'tanggal', 'untuk_apa', 'kategori_keperluan', 'jenis', 'jumlah_rp', 'pic', 'status_dokumen'];
  const activeCashCols = (selectedColumns && selectedColumns.length > 0)
    ? selectedColumns.filter(c => cashColumnMap[c])
    : defaultCashCols;

  const tableData = cashMutations.map((m, index) => {
    const isVoid = m.is_batal || m.status_dokumen === 'BATAL';
    return activeCashCols.map(c => cashColumnMap[c].getValue(m, index, isVoid));
  });

  const columnStylesConfig: any = {};
  activeCashCols.forEach((c, idx) => {
    columnStylesConfig[idx] = {
      cellWidth: cashColumnMap[c].width,
      halign: cashColumnMap[c].align
    };
  });

  autoTable(doc, {
    startY: 78,
    head: [activeCashCols.map(c => cashColumnMap[c].header)],
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
    columnStyles: columnStylesConfig,
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
  doc.text(signer?.name || 'Pelaksana Administrasi', 14, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  if (signer?.email) doc.text(signer.email, 14, signY + 26);

  // 2. Diperiksa Oleh (Spv)
  const col2X = 14 + colWidth;
  doc.setFontSize(7.5);
  doc.text('Diperiksa Oleh,', col2X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Spv. / Pengawas', col2X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Pengawas Lapangan', col2X, signY + 22);
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
  doc.text('Manajer Terkait', col3X, signY + 22);
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

  const qrPayload = `TTE-${b.contractorSlug}:${docId}:DIREKTUR:${b.directorName.replace(/\s+/g, '_')}:NPWP_${b.contractorNpwp || 'NA'}:STATUS_VALID_SAH`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 100, margin: 0 });
  doc.addImage(qrDataUrl, 'PNG', col4X, signY + 7, 16, 16);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(b.directorName, col4X, signY + 26);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  if (b.directorEmail) doc.text(b.directorEmail, col4X, signY + 30);

  const snapshot = stableStringify({
    docId,
    startDate,
    endDate,
    company: b.contractorName,
    project: b.projectName,
    cash_mutations: cashMutations.map(m => ({ id: m.id, amount: m.jumlah_rp, jenis: m.jenis, status: m.status_dokumen }))
  });
  const hash = await sha256Hex(snapshot);

  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | ${b.contractorName}`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  doc.save(`${docId}_Buku_Kas_${b.contractorSlug}.pdf`);

  return {
    id: docId,
    judul: `Laporan Arus Kas & Dana Proyek ${b.contractorName}`,
    jenis: 'MUTASI_KAS',
    status: 'TERVERIFIKASI',
    periode_awal: startDate,
    periode_akhir: endDate,
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: b.directorName,
    penandatangan_jabatan: 'Direktur Utama',
    penandatangan_email: b.directorEmail,
    hash_keamanan: hash,
    total_transaksi: cashMutations.length,
    ringkasan_nilai_rp: endingBalance,
    qr_payload: qrPayload,
  };
}

/**
 * Generate PDF for Official BOQ & Material Tracking Report
 */
export async function generateBOQReportPDF(params: {
  docId: string;
  items: ItemBarang[];
  projectName?: string;
  signer?: UserProfile;
  preserveOrder?: boolean;
  filterSummary?: string;
  branding?: TenantBranding;
  hideFinancials?: boolean;
  customNotes?: string;
  selectedColumns?: string[];
}): Promise<DokumenLaporan> {
  const {
    docId,
    items,
    projectName,
    signer,
    preserveOrder = false,
    filterSummary,
    branding: rawBranding,
    hideFinancials = false,
    customNotes,
    selectedColumns
  } = params;
  const b = resolvePdfBranding(rawBranding, projectName);
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  // Kop Surat Resmi Dinamis
  drawOfficialHeader(doc, pageWidth, b);

  // Judul Dokumen
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('BILL OF QUANTITY (BOQ) & KONTROL PEMENUHAN MATERIAL', 14, 40);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Klien: ${b.clientName} | Proyek: ${b.projectName} | Tanggal Cetak: ${formatDateOnly(new Date().toISOString())}${filterSummary ? ` | ${filterSummary}` : ''}${customNotes ? ` | Catatan: ${customNotes}` : ''}`,
    14,
    45
  );

  // Hitung Ringkasan Nilai Kontrak Dinamis dari Item BOQ
  let contractMaterial = 0;
  let contractManpower = 0;
  let clientFreeIssue = 0;
  items.forEach((it) => {
    const lineTotal = (Number(it.harga_satuan) || 0) * (Number(it.qty_boq) || 0);
    const isClientItem = isClientProvidedRemark(it.keterangan, b.clientName);
    if (isClientItem) {
      clientFreeIssue += lineTotal;
    } else {
      const catUpper = (it.kategori || '').toUpperCase();
      const isManpower = !it.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH');
      if (isManpower) contractManpower += lineTotal;
      else contractMaterial += lineTotal;
    }
  });
  const contractTotal = contractMaterial + contractManpower;

  // Kotak Ringkasan Dokumen (Finansial vs Fisik Lapangan)
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, 48, pageWidth - 28, 14, 2, 2, 'FD');

  if (hideFinancials) {
    const matItemsCount = items.filter(it => !isClientProvidedRemark(it.keterangan, b.clientName) && it.satuan !== 'ls').length;
    const manItemsCount = items.filter(it => {
      const catUpper = (it.kategori || '').toUpperCase();
      return !it.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH') || it.satuan === 'ls';
    }).length;
    const clientItemsCount = items.filter(it => isClientProvidedRemark(it.keterangan, b.clientName)).length;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(`RINGKASAN FISIK BOQ (${b.contractorName.toUpperCase()}):`, 18, 53);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Pos Material:', 18, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(`${matItemsCount} Pos`, 40, 58);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text('Pos Upah & Jasa:', 70, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(`${manItemsCount} Pos`, 100, 58);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text('TOTAL RUANG LINGKUP:', 135, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${items.length} Pos Pekerjaan`, 175, 58);

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(126, 34, 206);
    doc.text(`* Material Klien (Free-Issue ${b.clientName}): ${clientItemsCount} Pos`, pageWidth - 18, 53, { align: 'right' });
  } else {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(`NILAI KONTRAK (${b.contractorName.toUpperCase()}):`, 18, 53);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Material Kontrak:', 18, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(formatRupiah(contractMaterial), 45, 58);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text('Upah & Jasa (Manpower):', 80, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(formatRupiah(contractManpower), 120, 58);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text('GRAND TOTAL KONTRAK:', 160, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(formatRupiah(contractTotal), 205, 58);

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(126, 34, 206);
    doc.text(`* Pengadaan Klien (Free-Issue ${b.clientName}): ${formatRupiah(clientFreeIssue)} (Beban Kontraktor: Rp 0)`, pageWidth - 18, 53, { align: 'right' });
  }

  // Siapkan Data Tabel Berdasarkan Hierarki
  const sortedItems = preserveOrder
    ? [...items]
    : [...items].sort((a, bItem) => (a.source_excel_row || 0) - (bItem.source_excel_row || 0));

  // Pemetaan Kolom Fleksibel BOQ
  const boqColumnMap: Record<string, {
    header: string;
    width: number;
    align: 'left' | 'center' | 'right';
    getValue: (it: ItemBarang, isClientItem: boolean, providerText: string) => string;
  }> = {
    kode_boq: { header: 'Kode BOQ', width: 22, align: 'left', getValue: (it) => it.kode_boq || '-' },
    nama_barang: { header: 'Uraian Material / Pekerjaan', width: hideFinancials ? 90 : 70, align: 'left', getValue: (it) => it.nama_barang },
    penyedia: { header: 'Penyedia', width: 26, align: 'center', getValue: (_, __, pText) => pText },
    qty_boq: { header: 'Target BOQ', width: 24, align: 'right', getValue: (it) => `${it.qty_boq.toLocaleString('id-ID')} ${it.satuan}` },
    harga_satuan: { header: 'Harga Satuan (Rp)', width: 28, align: 'right', getValue: (it, isClient) => isClient ? '0 (Klien)' : formatRupiah(it.harga_satuan) },
    total_kontrak: { header: 'Total Kontrak (Rp)', width: 32, align: 'right', getValue: (it, isClient) => isClient ? '0 (Klien)' : formatRupiah(it.harga_satuan * it.qty_boq) },
    qty_masuk: { header: 'Realisasi Masuk', width: 25, align: 'right', getValue: (it) => `${it.qty_masuk_total.toLocaleString('id-ID')} ${it.satuan}` },
    qty_sisa: { header: 'Sisa Belum Tiba', width: 25, align: 'right', getValue: (it) => `${it.qty_pemenuhan_sisa.toLocaleString('id-ID')} ${it.satuan}` },
    status: { header: 'Status', width: 22, align: 'center', getValue: (it) => it.status_pemenuhan }
  };

  const defaultBOQCols = hideFinancials
    ? ['kode_boq', 'nama_barang', 'penyedia', 'qty_boq', 'qty_masuk', 'qty_sisa', 'status']
    : ['kode_boq', 'nama_barang', 'penyedia', 'qty_boq', 'harga_satuan', 'total_kontrak', 'qty_masuk', 'qty_sisa', 'status'];

  const activeBOQCols = (selectedColumns && selectedColumns.length > 0)
    ? selectedColumns.filter(c => boqColumnMap[c] && !(hideFinancials && (c === 'harga_satuan' || c === 'total_kontrak')))
    : defaultBOQCols;

  const totalColSpan = activeBOQCols.length;
  const tableData: any[] = [];
  let currentDivision = '';
  let currentSubSection = '';

  sortedItems.forEach((it) => {
    const isClientItem = isClientProvidedRemark(it.keterangan, b.clientName);
    const catParts = (it.kategori || '').split(' / ');
    const divName = catParts[0] || 'UMUM';
    const subName = catParts[1] || '';

    if (divName !== currentDivision) {
      currentDivision = divName;
      tableData.push([
        {
          content: currentDivision,
          colSpan: totalColSpan,
          styles: { fillColor: [254, 240, 138], fontStyle: 'bold', textColor: [113, 63, 18], fontSize: 7.5 }
        }
      ]);
    }

    if (subName && subName !== currentSubSection) {
      currentSubSection = subName;
      tableData.push([
        {
          content: `  ${currentSubSection}`,
          colSpan: totalColSpan,
          styles: { fillColor: [220, 252, 231], fontStyle: 'bold', textColor: [20, 83, 45], fontSize: 7 }
        }
      ]);
    }

    const providerText = isClientItem ? b.clientName : b.contractorName;
    tableData.push(
      activeBOQCols.map(c => boqColumnMap[c].getValue(it, isClientItem, providerText))
    );
  });

  const columnStylesConfig: any = {};
  activeBOQCols.forEach((c, idx) => {
    columnStylesConfig[idx] = {
      cellWidth: boqColumnMap[c].width,
      halign: boqColumnMap[c].align
    };
  });

  autoTable(doc, {
    startY: 65,
    head: [activeBOQCols.map(c => boqColumnMap[c].header)],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7,
    },
    styles: {
      fontSize: 6,
      cellPadding: 1.5,
    },
    columnStyles: columnStylesConfig,
    margin: { left: 14, right: 14 },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 160;
  let signY = finalY + 8;

  if (signY + 45 > pageHeight) {
    doc.addPage();
    signY = 25;
  }

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.4);
  doc.line(14, signY, pageWidth - 14, signY);
  signY += 5;

  const colWidth = (pageWidth - 28) / 4;

  // 1. Diterbitkan Oleh (Clerk)
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Diterbitkan Oleh,', 14, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Clerk / Logistik', 14, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text(signer?.name || 'Pelaksana Administrasi', 14, signY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  if (signer?.email) doc.text(signer.email, 14, signY + 22);

  // 2. Diperiksa Oleh (Foreman)
  const col2X = 14 + colWidth;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Diperiksa Oleh,', col2X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Foreman Lapangan', col2X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Tim Pengawas Lapangan', col2X, signY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  doc.text('Status: Terverifikasi Lapangan', col2X, signY + 22);

  // 3. Diverifikasi (Site Engineer / PM)
  const col3X = 14 + colWidth * 2;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Diverifikasi Oleh,', col3X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Site Engineer / PM', col3X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text('Tim Teknis Proyek', col3X, signY + 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  doc.text('Status: Sesuai Gambar & Spesifikasi', col3X, signY + 22);

  // 4. Disetujui (Direktur Utama)
  const col4X = 14 + colWidth * 3;
  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text('Disetujui Oleh,', col4X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Direktur Utama', col4X, signY + 4);

  const qrPayload = `TTE-${b.contractorSlug}:${docId}:DIREKTUR:${b.directorName.replace(/\s+/g, '_')}:NPWP_${b.contractorNpwp || 'NA'}:BOQ_VALID`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 100, margin: 0 });
  doc.addImage(qrDataUrl, 'PNG', col4X, signY + 6, 14, 14);

  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(b.directorName, col4X, signY + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 116, 139);
  if (b.directorEmail) doc.text(b.directorEmail, col4X, signY + 26);

  const snapshot = stableStringify({
    docId,
    company: b.contractorName,
    project: b.projectName,
    total_items: items.length,
    contract_material: contractMaterial,
    contract_manpower: contractManpower,
    contract_total: contractTotal,
  });
  const hash = await sha256Hex(snapshot);

  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | ${b.contractorName}`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  doc.save(`${docId}_Laporan_BOQ_Pemenuhan_Material_${b.contractorSlug}.pdf`);

  return {
    id: docId,
    judul: 'Laporan Bill of Quantity (BOQ) & Kontrol Pemenuhan Material',
    jenis: 'GABUNGAN_PROYEK',
    status: 'TERVERIFIKASI',
    periode_awal: new Date().toISOString(),
    periode_akhir: new Date().toISOString(),
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: b.directorName,
    penandatangan_jabatan: 'Direktur Utama',
    penandatangan_email: b.directorEmail,
    hash_keamanan: hash,
    total_transaksi: items.length,
    ringkasan_nilai_rp: contractTotal,
    qr_payload: qrPayload,
  };
}

/**
 * Generate PDF for Rekap Gudang Material ("Satukan Masuk") sesuai filter & sortiran layar
 */
export async function generateWarehouseSummaryPDF(params: {
  docId: string;
  materials: PhysicalMaterialItem[];
  projectName?: string;
  filterSummary?: string;
  customNotes?: string;
  signer?: UserProfile;
  stockMutations?: MutasiBarang[];
  branding?: TenantBranding;
  selectedColumns?: string[];
}): Promise<DokumenLaporan> {
  const {
    docId,
    materials,
    projectName,
    filterSummary,
    customNotes,
    signer,
    stockMutations = [],
    branding: rawBranding,
    selectedColumns
  } = params;
  const b = resolvePdfBranding(rawBranding, projectName);
  const providerLabels = { contractorName: b.contractorName, clientName: b.clientName };

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  drawOfficialHeader(doc, pageWidth, b);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text('REKAPITULASI GUDANG MATERIAL ("SATUKAN MASUK")', 14, 40);

  const discrepancyList = materials.map((pm) => summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels));
  const mismatchMatCount = discrepancyList.filter((d) => d.hasMismatch).length;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Proyek: ${b.projectName} | Tanggal Cetak: ${formatDateOnly(new Date().toISOString())}${filterSummary ? ` | ${filterSummary}` : ''}${customNotes ? ` | Catatan: ${customNotes}` : ''} | Total Baris: ${materials.length} Material${mismatchMatCount > 0 ? ` | Beda Penyedia/Talangan: ${mismatchMatCount} Material` : ''}`,
    14,
    45
  );

  // Pemetaan Kolom Fleksibel Rekap Gudang
  const warehouseColumnMap: Record<string, {
    header: string;
    width: number;
    align: 'left' | 'center' | 'right';
    getValue: (pm: PhysicalMaterialItem, idx: number, disc: any) => string;
  }> = {
    no: { header: 'No', width: 10, align: 'center', getValue: (_, idx) => String(idx + 1) },
    nama_barang: {
      header: 'Nama Material & Cakupan Pos BOQ',
      width: 78,
      align: 'left',
      getValue: (pm, _, disc) => {
        const extraLines: string[] = [];
        if (disc?.mixedBreakdownText) extraLines.push(disc.mixedBreakdownText);
        if (disc?.hasMismatch) extraLines.push(`[!] ${disc.summaryText}`);
        return extraLines.length > 0
          ? `${pm.nama_barang} (${pm.budget_lines.length} Pos BOQ)\n${extraLines.join('\n')}`
          : `${pm.nama_barang} (${pm.budget_lines.length} Pos BOQ)`;
      }
    },
    satuan: { header: 'Satuan', width: 18, align: 'center', getValue: (pm) => pm.satuan },
    target_kebutuhan: { header: 'Kebutuhan BOQ', width: 26, align: 'right', getValue: (pm) => (pm.total_qty_boq || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 }) },
    sudah_masuk: {
      header: 'Masuk Gudang',
      width: 32,
      align: 'right',
      getValue: (pm) => {
        const totalTarget = pm.total_qty_boq || 0;
        const totalMasuk = pm.total_qty_masuk || 0;
        const pctTiba = totalTarget > 0 ? Math.round((totalMasuk / totalTarget) * 100) : 0;
        return `${totalMasuk.toLocaleString('id-ID', { maximumFractionDigits: 3 })} (${pctTiba}%)`;
      }
    },
    sisa_belum_tiba: {
      header: 'Sisa Belum Tiba',
      width: 26,
      align: 'right',
      getValue: (pm) => Math.max(0, (pm.total_qty_boq || 0) - (pm.total_qty_masuk || 0)).toLocaleString('id-ID', { maximumFractionDigits: 3 })
    },
    sudah_dipakai: {
      header: 'Sudah Dipakai',
      width: 26,
      align: 'right',
      getValue: (pm) => (pm.total_qty_keluar || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })
    },
    saldo_gudang: {
      header: 'Saldo Gudang',
      width: 26,
      align: 'right',
      getValue: (pm) => pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })
    },
    status_gudang: {
      header: 'Status Gudang',
      width: 26,
      align: 'center',
      getValue: (pm) => {
        return pm.stok_fisik > 0
          ? `Tersedia (${pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })})`
          : (pm.total_qty_masuk || 0) > 0
          ? 'Habis Terpakai'
          : 'Belum Ada Masuk';
      }
    }
  };

  const defaultWarehouseCols = ['no', 'nama_barang', 'satuan', 'target_kebutuhan', 'sudah_masuk', 'sisa_belum_tiba', 'sudah_dipakai', 'saldo_gudang', 'status_gudang'];
  const activeWarehouseCols = (selectedColumns && selectedColumns.length > 0)
    ? selectedColumns.filter(c => warehouseColumnMap[c])
    : defaultWarehouseCols;

  const tableBody = materials.map((pm, idx) => {
    const disc = discrepancyList[idx];
    return activeWarehouseCols.map(c => warehouseColumnMap[c].getValue(pm, idx, disc));
  });

  const columnStylesConfig: any = {};
  activeWarehouseCols.forEach((c, idx) => {
    columnStylesConfig[idx] = {
      cellWidth: warehouseColumnMap[c].width,
      halign: warehouseColumnMap[c].align
    };
  });

  autoTable(doc, {
    startY: 50,
    head: [activeWarehouseCols.map(c => warehouseColumnMap[c].header)],
    body: tableBody,
    theme: 'grid',
    headStyles: {
      fillColor: [15, 118, 110],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    styles: {
      fontSize: 7,
      cellPadding: 2,
    },
    columnStyles: columnStylesConfig,
    didParseCell: (data) => {
      if (data.section === 'body') {
        const disc = discrepancyList[data.row.index];
        if (disc?.hasMismatch) {
          data.cell.styles.fillColor = [254, 243, 199];
          if (data.column.index === 1) {
            data.cell.styles.textColor = [146, 64, 14];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    },
    margin: { left: 14, right: 14 },
  });

  const finalY = (doc as any).lastAutoTable?.finalY || 150;
  let signY = finalY + 8;
  if (signY + 35 > pageHeight) {
    doc.addPage();
    signY = 25;
  }

  const qrPayload = `TTE-${b.contractorSlug}:${docId}:GUDANG:${materials.length}_MATERIAL`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 100, margin: 0 });
  doc.addImage(qrDataUrl, 'PNG', pageWidth - 30, signY, 16, 16);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(`Dicetak oleh: ${signer?.name || 'Clerk'}`, 14, signY + 5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(`Kode Dokumen: ${docId} | ${b.contractorName}`, 14, signY + 10);

  const hash = await sha256Hex(stableStringify({ docId, count: materials.length, projectName: b.projectName, company: b.contractorName }));
  doc.setFontSize(6);
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | ${b.contractorName}`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  doc.save(`${docId}_Rekap_Gudang_Material_${b.contractorSlug}.pdf`);

  return {
    id: docId,
    judul: 'Rekapitulasi Gudang Material ("Satukan Masuk")',
    jenis: 'MUTASI_STOK',
    status: 'TERVERIFIKASI',
    periode_awal: new Date().toISOString(),
    periode_akhir: new Date().toISOString(),
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: signer?.name || 'Clerk',
    penandatangan_jabatan: 'Pelaksana Administrasi',
    penandatangan_email: signer?.email || '',
    hash_keamanan: hash,
    total_transaksi: materials.length,
    ringkasan_nilai_rp: 0,
    qr_payload: qrPayload,
  };
}
