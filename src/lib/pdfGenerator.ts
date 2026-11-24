import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';
import { DokumenLaporan, MutasiBarang, MutasiKas, UserProfile, ItemBarang, PhysicalMaterialItem, TenantBranding, ImpersonateRole, PurchaseOrder } from '../types';
import { PO_PAYMENT_TERMS_LABELS } from './procurementEngine';
import {
  analyzeIncomingProviderDiscrepancy,
  isClientProvidedRemark,
  summarizeMaterialIncomingDiscrepancy
} from './stockMutationEngine';
import { resolveEvalContext, evaluateBoqPos, evaluateWarehouseMaterial } from './boqExecutionEngine';
import {
  BEBAN_BIAYA_LABELS,
  computeRunningCashBalances,
  isCashRowExcluded,
  PAYMENT_METHOD_LABELS,
  SOURCE_MODULE_LABELS,
  STATUS_BUKTI_LABELS,
} from './cashflowEngine';
import { IntegratedProjectReportData } from './projectReportEngine';

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
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
 * Buat nama file PDF yang bersih, deskriptif, dan relevan dengan judul dokumen & proyek
 */
function buildCleanPdfFilename(customTitle: string | undefined, defaultCategory: string, projectName?: string): string {
  const today = new Date().toISOString().slice(0, 10);
  const baseTitle = (customTitle && customTitle.trim()) ? customTitle.trim() : defaultCategory;
  // Bersihkan karakter yang dilarang pada sistem berkas (Windows/Linux/Mac)
  const safeTitle = baseTitle
    .replace(/[\\/:*?"<>|()]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 60);
  const safeProject = (projectName || 'Proyek')
    .replace(/[\\/:*?"<>|()]/g, '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/_{2,}/g, '_')
    .slice(0, 30);
  return `${safeTitle}_${safeProject}_${today}.pdf`;
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
  customTitle?: string;
  customNotes?: string;
  selectedColumns?: string[];
  orientation?: 'portrait' | 'landscape';
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
    customTitle,
    customNotes,
    selectedColumns,
    orientation: requestedOrientation
  } = params;
  const b = resolvePdfBranding(rawBranding, projectName);
  const providerLabels = { contractorName: b.contractorName, clientName: b.clientName };

  // Map harga riil material dari data fisik gudang
  const materialPriceMap = new Map<string, number>();
  (physicalMaterials || []).forEach((pm) => {
    const p =
      pm.harga_beli_rata_rata ||
      pm.harga_beli_terakhir ||
      (pm.total_qty_masuk > 0 && pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0
        ? Math.round(pm.total_nilai_belanja_riil / pm.total_qty_masuk)
        : 0);
    if (p > 0) {
      materialPriceMap.set(pm.id, p);
      materialPriceMap.set(pm.nama_barang.trim().toLowerCase(), p);
    }
  });

  const getPdfEffectivePrice = (m: MutasiBarang): number | null => {
    if (m.harga_satuan_beli != null && Number(m.harga_satuan_beli) > 0) {
      return Number(m.harga_satuan_beli);
    }
    const fromMap =
      materialPriceMap.get(m.barang_id) ||
      materialPriceMap.get((m.nama_barang || '').trim().toLowerCase());
    return fromMap || null;
  };

  // Definisi Pemetaan Kolom Fleksibel
  const stockColumnMap: Record<string, {
    header: string;
    width?: number;
    align?: 'left' | 'center' | 'right';
    getValue: (m: MutasiBarang, idx: number, disc: any, isVoid: boolean) => string;
  }> = {
    no: { header: 'No', width: 9, align: 'center', getValue: (_, idx) => String(idx + 1) },
    tanggal: { header: 'Waktu', width: 22, align: 'left', getValue: (m) => formatDateTime(m.tanggal) },
    nomor_surat_jalan: { header: 'No Surat Jalan / Nota', width: 24, align: 'left', getValue: (m) => m.nomor_nota || m.nomor_surat_jalan || '-' },
    nama_barang: { header: 'Nama Material / Barang', width: 44, align: 'left', getValue: (m) => m.nama_barang },
    nama_item_aktual: {
      header: 'Item Aktual / Pengganti',
      width: 34,
      align: 'left',
      getValue: (m) => m.nama_item_aktual || '-'
    },
    jenis: { header: 'Jenis', width: 13, align: 'center', getValue: (m) => m.jenis },
    jumlah: { header: 'Volume', width: 18, align: 'right', getValue: (m, _, __, isVoid) => isVoid ? '0 (Batal)' : `${m.jumlah} ${m.satuan}` },
    satuan: { header: 'Satuan', width: 13, align: 'center', getValue: (m) => m.satuan },
    harga_satuan_beli: {
      header: 'Harga Satuan',
      width: 24,
      align: 'right',
      getValue: (m, _, __, isVoid) => {
        if (isVoid) return '-';
        const price = getPdfEffectivePrice(m);
        return price != null ? `Rp ${price.toLocaleString('id-ID')}` : '-';
      }
    },
    total_harga_nota: {
      header: 'Total Nilai / Belanja',
      width: 26,
      align: 'right',
      getValue: (m, _, __, isVoid) => {
        if (isVoid) return 'Rp 0';
        const price = getPdfEffectivePrice(m);
        return price != null ? `Rp ${(price * m.jumlah).toLocaleString('id-ID')}` : '-';
      }
    },
    status_harga: {
      header: 'Status Nota',
      width: 22,
      align: 'center',
      getValue: (m) => m.status_harga === 'NOTA_MENYUSUL' ? 'Nota Menyusul' : m.status_harga === 'BELUM_DIKETAHUI' ? 'Belum Tahu' : m.harga_satuan_beli != null ? 'Tercatat' : '-'
    },
    tujuan_keperluan: {
      header: 'Asal / Peruntukan',
      width: 42,
      align: 'left',
      getValue: (m, _, disc) => {
        const storeOrProvider = m.nama_toko ? `Toko: ${m.nama_toko}` : (m.source_name || disc?.actualProviderLabel || '-');
        const providerLine =
          m.jenis === 'MASUK'
            ? `Asal: ${storeOrProvider}`
            : m.beban_biaya === 'KLIEN' || (m.beban_biaya as string) === 'PERMINTAAN_KLIEN'
            ? 'Beban: Permintaan Klien'
            : m.beban_biaya === 'BONUS_KLIEN'
            ? 'Beban: Bonus Klien'
            : m.beban_biaya === 'OPERASIONAL'
            ? 'Beban: Operasional'
            : 'Beban: Proyek BOQ';
        const purposeRaw = (m.tujuan_keperluan || '-').trim();
        const mismatchLine = disc?.isMismatch ? `\n[!] ${disc.pdfNote}` : '';
        const attachmentLine = (m.lampiran_nota_urls && m.lampiran_nota_urls.length > 0) ? '\n[✓ Nota Fisik Terlampir]' : '';
        return disc?.isMismatch && purposeRaw.toLowerCase().includes('talangan')
          ? `${providerLine}${mismatchLine}${attachmentLine}`
          : `${providerLine}\n${purposeRaw}${mismatchLine}${attachmentLine}`;
      }
    },
    pic: { header: 'PIC', width: 18, align: 'left', getValue: (m) => m.pic_penerima_penyerah || '-' },
    status_dokumen: {
      header: 'Status',
      width: 17,
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

  const hasFinancialCols = activeStockCols.includes('harga_satuan_beli') || activeStockCols.includes('total_harga_nota') || activeStockCols.includes('status_harga');

  // Deteksi Cerdas Orientasi: Default Lanskap untuk dokumen jurnal multi-kolom agar lega & bebas terpotong
  const isLandscape = requestedOrientation
    ? requestedOrientation === 'landscape'
    : (activeStockCols.length > 6 || hasFinancialCols || true);

  const doc = new jsPDF({
    orientation: isLandscape ? 'landscape' : 'portrait',
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
  doc.text(customTitle || 'BERITA ACARA & REKAPITULASI MUTASI BARANG', 14, 42);

  // Metadata Laporan
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);

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

  // Analisis Belanja Riil Finansial (transaksi MASUK dan KELUAR dengan harga satuan valid)
  const activeMasukWithPrice = activeMutations.filter(
    (m) => m.jenis === 'MASUK' && getPdfEffectivePrice(m) != null && getPdfEffectivePrice(m)! > 0
  );
  const totalBelanjaRiil = activeMasukWithPrice.reduce(
    (acc, m) => acc + (getPdfEffectivePrice(m)! * m.jumlah), 0
  );

  const activeKeluarWithPrice = activeMutations.filter(
    (m) => m.jenis === 'KELUAR' && getPdfEffectivePrice(m) != null && getPdfEffectivePrice(m)! > 0
  );
  const totalKeluarRiil = activeKeluarWithPrice.reduce(
    (acc, m) => acc + (getPdfEffectivePrice(m)! * m.jumlah), 0
  );

  const notaLengkapCount = activeMutations.filter(
    (m) => m.jenis === 'MASUK' && m.harga_satuan_beli != null && m.harga_satuan_beli > 0
  ).length;
  const notaPendingCount = activeMutations.filter(
    (m) => m.jenis === 'MASUK' && (m.status_harga === 'NOTA_MENYUSUL' || m.status_harga === 'BELUM_DIKETAHUI' || m.harga_satuan_beli == null)
  ).length;

  // Analisis selisih penyedia (mis. Jatah Klien tapi ditalangi Kontraktor)
  const discrepancyByRow = mutations.map((m) => analyzeIncomingProviderDiscrepancy(m, physicalMaterials, mutations, providerLabels));
  const mismatchCount = mutations.filter(
    (m, i) => !m.is_batal && !m.is_ganti && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI' && discrepancyByRow[i].isMismatch
  ).length;

  // KPI Summary Box Dinamis & Adaptif
  const summaryBoxY = 60;
  const summaryBoxHeight = 14;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, summaryBoxY, pageWidth - 28, summaryBoxHeight, 2, 2, 'FD');

  if (hasFinancialCols && isLandscape) {
    // 6 KARTU KPI LENGKAP PADA MODE LANSKAP (Finansial + Kuantitas + Nota)
    const colStep = (pageWidth - 28) / 6;

    // 1. Total Transaksi
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL TRANSAKSI', 18, summaryBoxY + 5);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${mutations.length} Transaksi`, 18, summaryBoxY + 11);

    // 2. Total Volume Masuk
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL VOLUME MASUK', 14 + colStep * 1 + 3, summaryBoxY + 5);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text(`+ ${totalMasuk.toLocaleString('id-ID')} unit`, 14 + colStep * 1 + 3, summaryBoxY + 11);

    // 3. Total Volume Keluar
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL VOLUME KELUAR', 14 + colStep * 2 + 3, summaryBoxY + 5);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(159, 18, 57);
    doc.text(`- ${totalKeluar.toLocaleString('id-ID')} unit`, 14 + colStep * 2 + 3, summaryBoxY + 11);

    // 4. Total Nilai Finansial (Masuk / Keluar)
    const isOutReport = totalMasuk === 0 && totalKeluar > 0;
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(isOutReport ? 'TOTAL ALOKASI (KELUAR)' : 'TOTAL BELANJA RIIL (MASUK)', 14 + colStep * 3 + 3, summaryBoxY + 5);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    const displayFinValue = isOutReport ? totalKeluarRiil : totalBelanjaRiil;
    doc.text(displayFinValue > 0 ? `Rp ${displayFinValue.toLocaleString('id-ID')}` : 'Rp 0', 14 + colStep * 3 + 3, summaryBoxY + 11);

    // 5. Status Kelengkapan Nota
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('STATUS NOTA FISIK', 14 + colStep * 4 + 3, summaryBoxY + 5);
    doc.setFontSize(8.8);
    doc.setFont('helvetica', 'bold');
    if (notaPendingCount > 0) {
      doc.setTextColor(180, 83, 9);
      doc.text(`${notaLengkapCount} Nota · ${notaPendingCount} Pending`, 14 + colStep * 4 + 3, summaryBoxY + 11);
    } else {
      doc.setTextColor(22, 101, 52);
      doc.text(`${notaLengkapCount} Nota Lengkap`, 14 + colStep * 4 + 3, summaryBoxY + 11);
    }

    // 6. Beda Penyedia / Talangan
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('BEDA PENYEDIA / TALANGAN', 14 + colStep * 5 + 3, summaryBoxY + 5);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    if (mismatchCount > 0) {
      doc.setTextColor(180, 83, 9);
      doc.text(`${mismatchCount} Transaksi`, 14 + colStep * 5 + 3, summaryBoxY + 11);
    } else {
      doc.setTextColor(100, 116, 139);
      doc.text('0 Transaksi', 14 + colStep * 5 + 3, summaryBoxY + 11);
    }
  } else {
    // 4 KARTU FORMAT STANDAR ATAU MURNI FISIK KUANTITAS
    const colStep = (pageWidth - 28) / 4;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL TRANSAKSI', 18, summaryBoxY + 5);
    doc.text('TOTAL VOLUME MASUK', 14 + colStep * 1 + 4, summaryBoxY + 5);
    doc.text('TOTAL VOLUME KELUAR', 14 + colStep * 2 + 4, summaryBoxY + 5);
    doc.text(hasFinancialCols ? 'TOTAL BELANJA RIIL' : 'BEDA PENYEDIA / TALANGAN', 14 + colStep * 3 + 4, summaryBoxY + 5);

    doc.setFontSize(9.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${mutations.length} Transaksi`, 18, summaryBoxY + 11);

    doc.setTextColor(22, 101, 52);
    doc.text(`+ ${totalMasuk.toLocaleString('id-ID')} unit`, 14 + colStep * 1 + 4, summaryBoxY + 11);

    doc.setTextColor(159, 18, 57);
    doc.text(`- ${totalKeluar.toLocaleString('id-ID')} unit`, 14 + colStep * 2 + 4, summaryBoxY + 11);

    if (hasFinancialCols) {
      doc.setTextColor(15, 23, 42);
      doc.text(totalBelanjaRiil > 0 ? `Rp ${totalBelanjaRiil.toLocaleString('id-ID')}` : 'Rp 0', 14 + colStep * 3 + 4, summaryBoxY + 11);
    } else if (mismatchCount > 0) {
      doc.setTextColor(180, 83, 9);
      doc.text(`${mismatchCount} Transaksi`, 14 + colStep * 3 + 4, summaryBoxY + 11);
    } else {
      doc.setTextColor(100, 116, 139);
      doc.text('0 Transaksi', 14 + colStep * 3 + 4, summaryBoxY + 11);
    }
  }

  const tableData = mutations.map((m, index) => {
    const isVoid = m.is_batal || m.status_dokumen === 'BATAL';
    const disc = discrepancyByRow[index];
    return activeStockCols.map(c => stockColumnMap[c].getValue(m, index, disc, isVoid));
  });

  const availableTableWidth = pageWidth - 28;
  const baseTotalWidth = activeStockCols.reduce((sum, col) => sum + (stockColumnMap[col]?.width || 20), 0);
  const widthScale = baseTotalWidth > 0 ? availableTableWidth / baseTotalWidth : 1;

  const columnStylesConfig: any = {};
  activeStockCols.forEach((c, idx) => {
    const colDef = stockColumnMap[c];
    columnStylesConfig[idx] = {
      cellWidth: (colDef && colDef.width) ? Math.round(colDef.width * widthScale * 10) / 10 : 'auto',
      halign: colDef?.align || 'left'
    };
  });

  const purposeColIdx = activeStockCols.indexOf('tujuan_keperluan');

  // Baris Total Keseluruhan (Footer Tabel)
  const footRow = activeStockCols.map((c) => {
    if (c === 'no') return '';
    if (c === 'nama_barang') return 'TOTAL KESELURUHAN (RIIL)';
    if (c === 'jumlah') return `+${totalMasuk.toLocaleString('id-ID')}`;
    if (c === 'total_harga_nota') return totalBelanjaRiil > 0 ? `Rp ${totalBelanjaRiil.toLocaleString('id-ID')}` : '-';
    if (c === 'status_harga') return `${notaLengkapCount} Nota · ${notaPendingCount} Pending`;
    return '';
  });

  autoTable(doc, {
    startY: 78,
    head: [activeStockCols.map(c => stockColumnMap[c].header)],
    body: tableData,
    foot: [footRow],
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 9,
    },
    footStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: isLandscape ? 9 : 8.5,
      cellPadding: 2.5,
      lineColor: [51, 65, 85],
      lineWidth: 0.2,
    },
    styles: {
      font: 'helvetica',
      fontSize: isLandscape ? 8.8 : (activeStockCols.length <= 5 ? 9.5 : 8.5),
      cellPadding: 2.5,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    columnStyles: columnStylesConfig,
    didParseCell: (data) => {
      if (data.section === 'body') {
        const m = mutations[data.row.index];
        const isVoid = m?.is_batal || m?.status_dokumen === 'BATAL';
        const isReplaced = m?.is_ganti || m?.status_dokumen === 'DIGANTI';
        const disc = discrepancyByRow[data.row.index];

        if (isVoid || isReplaced) {
          data.cell.styles.fillColor = [248, 250, 252];
          data.cell.styles.textColor = [148, 163, 184];
        } else if (disc?.isMismatch) {
          data.cell.styles.fillColor = [254, 243, 199];
          if (purposeColIdx !== -1 && data.column.index === purposeColIdx) {
            data.cell.styles.textColor = [120, 53, 15];
            data.cell.styles.fontStyle = 'bold';
          }
        } else {
          data.cell.styles.textColor = [15, 23, 42];
        }
      } else if (data.section === 'foot') {
        const colKey = activeStockCols[data.column.index];
        if (colKey === 'jumlah' || colKey === 'total_harga_nota' || colKey === 'harga_satuan_beli') {
          data.cell.styles.halign = 'right';
        } else if (colKey === 'nama_barang') {
          data.cell.styles.halign = 'left';
          data.cell.styles.fontStyle = 'bold';
        } else {
          data.cell.styles.halign = 'center';
        }
      }
    },
    margin: { left: 14, right: 14 },
  });

  // Bagian Tanda Tangan Berjenjang (Serial 4 Tingkat Sesuai Dokumen)
  const finalY = (doc as any).lastAutoTable?.finalY || 160;
  let currentY = finalY;

  // Catatan Kaki Akuntabilitas Finansial (jika ada transaksi nota pending & kolom finansial aktif)
  if (hasFinancialCols && notaPendingCount > 0) {
    currentY += 4;
    doc.setFontSize(6.8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100, 116, 139);
    doc.text(
      `* Catatan: Total Belanja Riil mengakumulasikan transaksi dengan nota fisik tercatat (${notaLengkapCount} item). Sebanyak ${notaPendingCount} item berstatus Nota Menyusul / Belum Ada Harga belum terakumulasi ke dalam total nominal.`,
      14,
      currentY
    );
    currentY += 2;
  }

  let signY = currentY + 8;

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

  // Simpan PDF dengan nama file yang relevan
  const fileName = buildCleanPdfFilename(customTitle, 'Jurnal_Mutasi_Barang', b.projectName);
  doc.save(fileName);

  return {
    id: docId,
    judul: customTitle || `Rekap Mutasi Material & Barang ${b.contractorName}`,
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
  customTitle?: string;
  customNotes?: string;
  selectedColumns?: string[];
  orientation?: 'portrait' | 'landscape';
  hideRunningBalance?: boolean;
  approvers?: {
    issuerName?: string;
    checkerName?: string;
    approverName?: string;
    directorName?: string;
  };
}): Promise<DokumenLaporan> {
  const {
    docId,
    startDate,
    endDate,
    cashMutations,
    signer,
    projectName,
    branding: rawBranding,
    filterSummary,
    customTitle,
    customNotes,
    selectedColumns,
    orientation: requestedOrientation,
    hideRunningBalance = false,
    approvers,
  } = params;
  const b = resolvePdfBranding(rawBranding, projectName);

  // Gunakan sumber tunggal pengecualian BATAL & DIGANTI + saldo berjalan kronologis
  const activeCash = cashMutations.filter((m) => !isCashRowExcluded(m));
  const runningBalanceMap = computeRunningCashBalances(cashMutations);
  const totalMasuk = activeCash
    .filter((m) => m.jenis === 'MASUK')
    .reduce((acc, m) => acc + (Number(m.jumlah_rp) || 0), 0);
  const totalKeluar = activeCash
    .filter((m) => m.jenis === 'KELUAR')
    .reduce((acc, m) => acc + (Number(m.jumlah_rp) || 0), 0);
  const endingBalance = totalMasuk - totalKeluar;

  // Definisi Pemetaan Kolom Fleksibel Kas (termasuk kolom baru paritas)
  const cashColumnMap: Record<
    string,
    {
      header: string;
      width?: number;
      align?: 'left' | 'center' | 'right';
      getValue: (m: MutasiKas, idx: number, excluded: boolean) => string;
    }
  > = {
    no: { header: 'No', width: 9, align: 'center', getValue: (_, idx) => String(idx + 1) },
    tanggal: { header: 'Waktu', width: 24, align: 'left', getValue: (m) => formatDateTime(m.tanggal) },
    nomor_kuitansi: { header: 'No. Bukti', width: 22, align: 'left', getValue: (m) => m.nomor_kuitansi || '-' },
    untuk_apa: { header: 'Uraian Keperluan', width: 42, align: 'left', getValue: (m) => m.untuk_apa },
    nama_toko: { header: 'Toko / Pihak', width: 24, align: 'left', getValue: (m) => m.nama_toko || '-' },
    kategori_keperluan: { header: 'Kategori', width: 22, align: 'left', getValue: (m) => m.kategori_keperluan || 'Operasional' },
    payment_method: {
      header: 'Metode',
      width: 18,
      align: 'center',
      getValue: (m) => PAYMENT_METHOD_LABELS[m.payment_method || 'TUNAI'] || 'Tunai',
    },
    beban_biaya: {
      header: 'Beban',
      width: 18,
      align: 'center',
      getValue: (m) => (m.beban_biaya ? BEBAN_BIAYA_LABELS[m.beban_biaya] : 'Kontraktor'),
    },
    status_bukti: {
      header: 'Bukti',
      width: 20,
      align: 'center',
      getValue: (m) => (m.status_bukti ? STATUS_BUKTI_LABELS[m.status_bukti] : 'Tanpa Bukti'),
    },
    jenis: {
      header: 'Arus',
      width: 14,
      align: 'center',
      getValue: (m) => (m.jenis === 'MASUK' ? 'Masuk' : 'Keluar'),
    },
    jumlah_rp: {
      header: 'Nominal (Rp)',
      width: 26,
      align: 'right',
      getValue: (m, _, excluded) => {
        if (excluded) {
          const tag = m.is_ganti || m.status_dokumen === 'DIGANTI' ? 'Diganti' : 'Batal';
          return `Rp 0 (${tag})`;
        }
        return `${m.jenis === 'MASUK' ? '+' : '-'} ${formatRupiah(m.jumlah_rp)}`;
      },
    },
    saldo_setelah: {
      header: 'Saldo Berjalan',
      width: 26,
      align: 'right',
      getValue: (m) => {
        const bal = runningBalanceMap.get(m.id);
        return bal == null ? '—' : formatRupiah(bal);
      },
    },
    pic: { header: 'PIC', width: 20, align: 'left', getValue: (m) => m.pic || '-' },
    source_module: {
      header: 'Sumber',
      width: 20,
      align: 'center',
      getValue: (m) => SOURCE_MODULE_LABELS[m.source_module || 'KAS_LANGSUNG'],
    },
    status_dokumen: {
      header: 'Status',
      width: 18,
      align: 'center',
      getValue: (m) => {
        if (m.is_batal || m.status_dokumen === 'BATAL') return 'Batal';
        if (m.is_ganti || m.status_dokumen === 'DIGANTI') return 'Diganti';
        if (m.status_dokumen === 'MENGETAHUI') return 'Sah (TTE)';
        if (m.status_dokumen === 'DISETUJUI') return 'Disetujui';
        if (m.status_dokumen === 'DIPERIKSA') return 'Diperiksa';
        return 'Terbit';
      },
    },
  };

  const defaultCashCols = hideRunningBalance
    ? ['no', 'tanggal', 'nomor_kuitansi', 'nama_toko', 'untuk_apa', 'payment_method', 'jumlah_rp', 'pic']
    : ['no', 'tanggal', 'nomor_kuitansi', 'untuk_apa', 'nama_toko', 'kategori_keperluan', 'payment_method', 'jenis', 'jumlah_rp', 'saldo_setelah', 'pic', 'status_dokumen'];

  const activeCashCols = (selectedColumns && selectedColumns.length > 0
    ? selectedColumns.filter((c) => cashColumnMap[c])
    : defaultCashCols
  ).filter((c) => !(hideRunningBalance && c === 'saldo_setelah'));

  // Otomatis Landscape bila kolom > 6 kecuali diminta eksplisit portrait
  const effectiveOrientation =
    requestedOrientation || (activeCashCols.length > 6 ? 'landscape' : 'portrait');

  const doc = new jsPDF({
    orientation: effectiveOrientation,
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
  doc.text(customTitle || 'BUKU KAS & LAPORAN ARUS DANA PROYEK', 14, 42);

  // Metadata
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);

  doc.text(`Nomor Registrasi : ${docId}`, 14, 48);
  doc.text(`Periode Laporan  : ${formatDateOnly(startDate)} s/d ${formatDateOnly(endDate)}`, 14, 52);
  doc.text(
    `Tanggal Cetak    : ${formatDateOnly(new Date().toISOString())}${filterSummary ? ` | ${filterSummary}` : ''}${customNotes ? ` | Catatan: ${customNotes}` : ''}`,
    14,
    56
  );

  doc.text(`Proyek : ${b.projectName}`, pageWidth - 14, 48, { align: 'right' });
  doc.text(`Kontraktor : ${b.contractorName}`, pageWidth - 14, 52, { align: 'right' });
  doc.text(
    `Transaksi Aktif : ${activeCash.length} baris (dikecualikan: ${cashMutations.length - activeCash.length})`,
    pageWidth - 14,
    56,
    { align: 'right' }
  );

  // KPI Summary Strip (Adaptif: sembunyikan saldo internal bila preset Tagihan Penggantian Klien)
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, 60, pageWidth - 28, 19, 2, 2, 'FD');

  const thirdW = (pageWidth - 28) / 3;
  doc.setFontSize(7.5);
  doc.setTextColor(100, 116, 139);
  if (hideRunningBalance) {
    doc.text('TOTAL TAGIHAN TALANGAN AKTIF', 20, 65);
    doc.text('JUMLAH BUKTI / ITEM', 20 + thirdW, 65);
    doc.text('PIHAK TERTAGIH (KLIEN)', 20 + thirdW * 2, 65);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(159, 18, 57);
    doc.text(formatRupiah(totalKeluar), 20, 71);
    doc.setTextColor(15, 23, 42);
    doc.text(`${activeCash.length} Transaksi`, 20 + thirdW, 71);
    doc.text(b.clientName.slice(0, 32), 20 + thirdW * 2, 71);
  } else {
    doc.text('TOTAL DANA MASUK (AKTIF)', 20, 65);
    doc.text('TOTAL DANA KELUAR (AKTIF)', 20 + thirdW, 65);
    doc.text('SALDO BERSIH TERFILTER', 20 + thirdW * 2, 65);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(22, 101, 52);
    doc.text(`+ ${formatRupiah(totalMasuk)}`, 20, 71);
    doc.setTextColor(159, 18, 57);
    doc.text(`- ${formatRupiah(totalKeluar)}`, 20 + thirdW, 71);
    doc.setTextColor(15, 23, 42);
    doc.text(formatRupiah(endingBalance), 20 + thirdW * 2, 71);
  }

  // Strip Ringkasan Metode Pembayaran & Pos Utama
  const byMethod = new Map<string, number>();
  const byCategory = new Map<string, number>();
  for (const m of activeCash) {
    const pmLabel = PAYMENT_METHOD_LABELS[m.payment_method || 'TUNAI'] || 'Tunai';
    byMethod.set(pmLabel, (byMethod.get(pmLabel) || 0) + (Number(m.jumlah_rp) || 0));
    if (m.jenis === 'KELUAR') {
      byCategory.set(m.kategori_keperluan, (byCategory.get(m.kategori_keperluan) || 0) + (Number(m.jumlah_rp) || 0));
    }
  }
  const methodSummary = Array.from(byMethod.entries())
    .map(([k, v]) => `${k}: ${formatRupiah(v)}`)
    .join(' · ');
  const catSummary = Array.from(byCategory.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${formatRupiah(v)}`)
    .join(' · ');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.8);
  doc.setTextColor(71, 85, 105);
  doc.text(
    `Metode: ${methodSummary || '-'}${catSummary ? `  |  Pos Keluar Terbesar: ${catSummary}` : ''}`,
    20,
    76.5,
    { maxWidth: pageWidth - 40 }
  );

  const tableData = cashMutations.map((m, index) => {
    const excluded = isCashRowExcluded(m);
    return activeCashCols.map((c) => cashColumnMap[c].getValue(m, index, excluded));
  });

  const availableTableWidth = pageWidth - 28;
  const baseTotalWidth = activeCashCols.reduce((sum, col) => sum + (cashColumnMap[col]?.width || 20), 0);
  const widthScale = baseTotalWidth > 0 ? availableTableWidth / baseTotalWidth : 1;

  const columnStylesConfig: any = {};
  activeCashCols.forEach((c, idx) => {
    const colDef = cashColumnMap[c];
    columnStylesConfig[idx] = {
      cellWidth: colDef && colDef.width ? Math.round(colDef.width * widthScale * 10) / 10 : 'auto',
      halign: colDef?.align || 'left',
    };
  });

  autoTable(doc, {
    startY: 82,
    head: [activeCashCols.map((c) => cashColumnMap[c].header)],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: activeCashCols.length > 9 ? 7.5 : 8.5,
    },
    styles: {
      font: 'helvetica',
      fontSize: activeCashCols.length > 9 ? 7.2 : activeCashCols.length <= 5 ? 9 : 8,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    columnStyles: columnStylesConfig,
    margin: { left: 14, right: 14 },
  });

  // Resolusi Nama Penyetuju Aktual (bukan teks statis hardcode!)
  const latestChecker =
    approvers?.checkerName ||
    activeCash.find((m) => m.diperiksa_oleh)?.diperiksa_oleh ||
    'Menunggu Pemeriksaan';
  const latestApprover =
    approvers?.approverName ||
    activeCash.find((m) => m.disetujui_oleh)?.disetujui_oleh ||
    'Menunggu Persetujuan';
  const latestDirector =
    approvers?.directorName ||
    activeCash.find((m) => m.mengetahui_oleh)?.mengetahui_oleh ||
    b.directorName;
  const issuerName = approvers?.issuerName || signer?.name || 'Pelaksana Administrasi';

  // Tanda Tangan 4 Kolom Berjenjang
  const finalY = (doc as any).lastAutoTable?.finalY || 160;
  let signY = finalY + 10;

  if (signY + 46 > pageHeight) {
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
  doc.text(issuerName, 14, signY + 22, { maxWidth: colWidth - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  if (signer?.email) doc.text(signer.email, 14, signY + 26, { maxWidth: colWidth - 4 });

  // 2. Diperiksa Oleh (Foreman / Spv.)
  const col2X = 14 + colWidth;
  doc.setFontSize(7.5);
  doc.text('Diperiksa Oleh,', col2X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Foreman / Pengawas', col2X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text(latestChecker.split('·')[0].trim(), col2X, signY + 22, { maxWidth: colWidth - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    latestChecker === 'Menunggu Pemeriksaan' ? 'Status: Menunggu' : 'Status: Terperiksa',
    col2X,
    signY + 26
  );

  // 3. Disetujui Oleh (Spv. / Dept. Manager)
  const col3X = 14 + colWidth * 2;
  doc.setFontSize(7.5);
  doc.text('Disetujui Oleh,', col3X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Spv. / Dept. Manager', col3X, signY + 4);
  doc.setTextColor(15, 23, 42);
  doc.text(latestApprover.split('·')[0].trim(), col3X, signY + 22, { maxWidth: colWidth - 4 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 116, 139);
  doc.text(
    latestApprover === 'Menunggu Persetujuan' ? 'Status: Menunggu' : 'Status: Disetujui',
    col3X,
    signY + 26
  );

  // 4. Mengetahui / Disahkan (Dept. Mgr / KTT-PM / CEO + TTE/QR)
  const col4X = 14 + colWidth * 3;
  doc.setFontSize(7.5);
  doc.text('Mengetahui / TTE,', col4X, signY);
  doc.setFont('helvetica', 'bold');
  doc.text('Pimpinan Proyek / Direktur', col4X, signY + 4);

  const qrPayload = `TTE-${b.contractorSlug}:${docId}:DIREKTUR:${latestDirector.replace(/\s+/g, '_')}:NPWP_${b.contractorNpwp || 'NA'}:STATUS_VALID_SAH`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 100, margin: 0 });
  doc.addImage(qrDataUrl, 'PNG', col4X, signY + 7, 16, 16);

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(15, 23, 42);
  doc.text(latestDirector.split('·')[0].trim(), col4X, signY + 26, { maxWidth: colWidth - 4 });
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
    totalMasuk,
    totalKeluar,
    endingBalance: hideRunningBalance ? null : endingBalance,
    cash_mutations: cashMutations.map((m) => ({
      id: m.id,
      amount: m.jumlah_rp,
      jenis: m.jenis,
      status: m.status_dokumen,
      excluded: isCashRowExcluded(m),
    })),
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

  const fileName = buildCleanPdfFilename(customTitle, 'Buku_Kas_Proyek', b.projectName);
  doc.save(fileName);

  return {
    id: docId,
    judul: customTitle || `Laporan Arus Kas & Dana Proyek ${b.contractorName}`,
    jenis: 'MUTASI_KAS',
    status: 'TERVERIFIKASI',
    periode_awal: startDate,
    periode_akhir: endDate,
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: latestDirector,
    penandatangan_jabatan: 'Direktur Utama',
    penandatangan_email: b.directorEmail,
    hash_keamanan: hash,
    total_transaksi: activeCash.length,
    ringkasan_nilai_rp: hideRunningBalance ? totalKeluar : endingBalance,
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
  customTitle?: string;
  customNotes?: string;
  selectedColumns?: string[];
  orientation?: 'portrait' | 'landscape';
  mutations?: MutasiBarang[];
  physicalMaterials?: PhysicalMaterialItem[];
  role?: ImpersonateRole;
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
    customTitle,
    customNotes,
    selectedColumns,
    orientation: requestedOrientation,
    mutations,
    physicalMaterials,
    role
  } = params;
  const b = resolvePdfBranding(rawBranding, projectName);
  const evalContext = resolveEvalContext(role || (hideFinancials ? 'Viewer/Pengamat' : 'Foreman'), false, b);
  const doc = new jsPDF({
    orientation: requestedOrientation || 'landscape',
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
  doc.text(customTitle || 'BILL OF QUANTITY (BOQ) & KONTROL PEMENUHAN MATERIAL', 14, 40);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
  doc.text(
    `Klien: ${b.clientName} | Proyek: ${b.projectName} | Tanggal Cetak: ${formatDateOnly(new Date().toISOString())}${filterSummary ? ` | ${filterSummary}` : ''}${customNotes ? ` | Catatan: ${customNotes}` : ''}`,
    14,
    45
  );

  // Hitung Ringkasan Nilai Kontrak Dinamis & Realisasi Pemenuhan dari Item BOQ
  let contractMaterial = 0;
  let contractManpower = 0;
  let clientFreeIssue = 0;
  let realizedContractMaterial = 0;
  let remainingContractMaterial = 0;
  let fullyFulfilledCount = 0;
  let partialFulfilledCount = 0;
  let unfulfilledCount = 0;

  items.forEach((it) => {
    const lineTotal = (Number(it.harga_satuan) || 0) * (Number(it.qty_boq) || 0);
    const isClientItem = isClientProvidedRemark(it.keterangan, b.clientName);
    if (isClientItem) {
      clientFreeIssue += lineTotal;
    } else {
      const catUpper = (it.kategori || '').toUpperCase();
      const isManpower = !it.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH');
      if (isManpower) {
        contractManpower += lineTotal;
        if (it.status_pemenuhan === 'Terpenuhi' || it.status_pemenuhan === 'Melebihi BOQ') {
          fullyFulfilledCount += 1;
        } else if (it.status_pemenuhan === 'Dalam pemenuhan') {
          partialFulfilledCount += 1;
        } else {
          unfulfilledCount += 1;
        }
      } else {
        contractMaterial += lineTotal;
        const unitRate = Number(it.harga_satuan) || 0;
        const masukQty = Number(it.qty_masuk_total) || 0;
        const targetQty = Number(it.qty_boq) || 0;
        const sisaQty = Number(it.qty_pemenuhan_sisa) || Math.max(0, targetQty - masukQty);

        const realizedLine = Math.min(masukQty, targetQty) * unitRate;
        const remainingLine = sisaQty * unitRate;

        realizedContractMaterial += realizedLine;
        remainingContractMaterial += remainingLine;

        if (it.status_pemenuhan === 'Terpenuhi' || it.status_pemenuhan === 'Melebihi BOQ') {
          fullyFulfilledCount += 1;
        } else if (it.status_pemenuhan === 'Dalam pemenuhan') {
          partialFulfilledCount += 1;
        } else {
          unfulfilledCount += 1;
        }
      }
    }
  });
  const contractTotal = contractMaterial + contractManpower;
  const percentRealized = contractMaterial > 0 ? (realizedContractMaterial / contractMaterial) * 100 : 0;
  const percentRemaining = Math.max(0, 100 - percentRealized);

  // Kotak Ringkasan Dokumen (Finansial vs Fisik Lapangan)
  const summaryBoxY = 48;
  const summaryBoxHeight = hideFinancials ? 14 : 18;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(203, 213, 225);
  doc.roundedRect(14, summaryBoxY, pageWidth - 28, summaryBoxHeight, 2, 2, 'FD');

  if (hideFinancials) {
    const matItemsCount = items.filter(it => !isClientProvidedRemark(it.keterangan, b.clientName) && it.satuan !== 'ls').length;
    const manItemsCount = items.filter(it => {
      const catUpper = (it.kategori || '').toUpperCase();
      return !it.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH') || it.satuan === 'ls';
    }).length;
    const clientItemsCount = items.filter(it => isClientProvidedRemark(it.keterangan, b.clientName)).length;
    const isMixedScope = clientItemsCount > 0 && (items.length - clientItemsCount) > 0;

    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(isMixedScope ? 'RINGKASAN FISIK RUANG LINGKUP BOQ (GABUNGAN PROYEK):' : `RINGKASAN FISIK BOQ (${b.contractorName.toUpperCase()}):`, 18, 53);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text('Pos Material Kontraktor:', 18, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text(`${matItemsCount} Pos`, 52, 58);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text('Pos Upah & Jasa:', 78, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(16, 185, 129);
    doc.text(`${manItemsCount} Pos`, 104, 58);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 41, 59);
    doc.text('TOTAL RUANG LINGKUP:', 135, 58);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${items.length} Pos Pekerjaan`, 175, 58);

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(126, 34, 206);
    doc.text(`* Material Klien (Jatah Klien ${b.clientName}): ${clientItemsCount} Pos`, pageWidth - 18, 53, { align: 'right' });
  } else {
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(30, 41, 59);
    doc.text(`KONTROL NILAI KONTRAK & REALISASI PEMENUHAN MATERIAL (${b.contractorName.toUpperCase()}):`, 18, 52.5);

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(6.5);
    doc.setTextColor(126, 34, 206);
    doc.text(`* Pengadaan Klien (Jatah Klien ${b.clientName}): ${formatRupiah(clientFreeIssue)} (Beban Kontraktor: Rp 0)`, pageWidth - 18, 52.5, { align: 'right' });

    // Garis pemisah tipis antar baris
    doc.setDrawColor(226, 232, 240);
    doc.line(18, 54, pageWidth - 18, 54);

    // 5 Pilar Finansial Komprehensif
    // 1. Pagu Material BOQ
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text('PAGU MATERIAL BOQ', 18, 57.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(37, 99, 235);
    doc.text(formatRupiah(contractMaterial), 18, 61.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${items.filter(it => !isClientProvidedRemark(it.keterangan, b.clientName) && it.satuan !== 'ls').length} Pos Material Kontrak`, 18, 64.5);

    // 2. Realisasi Nilai Tiba
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(5, 150, 105);
    doc.text('REALISASI NILAI TIBA', 71, 57.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(5, 150, 105);
    doc.text(formatRupiah(realizedContractMaterial), 71, 61.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(5.8);
    doc.setTextColor(5, 150, 105);
    doc.text(`+${percentRealized.toFixed(1)}% Tiba (${fullyFulfilledCount} Pos Lengkap)`, 71, 64.5);

    // 3. Sisa Nilai Belum Tiba
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(217, 119, 6);
    doc.text('SISA NILAI BELUM TIBA', 126, 57.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(217, 119, 6);
    doc.text(formatRupiah(remainingContractMaterial), 126, 61.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(180, 83, 9);
    doc.text(`${percentRemaining.toFixed(1)}% Sisa (${unfulfilledCount + partialFulfilledCount} Pos Pending)`, 126, 64.5);

    // 4. Upah & Jasa (Manpower)
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(100, 116, 139);
    doc.text('UPAH & JASA (MANPOWER)', 181, 57.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(51, 65, 85);
    doc.text(formatRupiah(contractManpower), 181, 61.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(100, 116, 139);
    doc.text(`${items.filter(it => { const catUpper = (it.kategori || '').toUpperCase(); return !it.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH') || it.satuan === 'ls'; }).length} Pos Upah BOQ`, 181, 64.5);

    // 5. Grand Total Kontrak
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(15, 23, 42);
    doc.text('GRAND TOTAL KONTRAK', 236, 57.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.2);
    doc.setTextColor(15, 23, 42);
    doc.text(formatRupiah(contractTotal), 236, 61.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(5.8);
    doc.setTextColor(71, 85, 105);
    doc.text('Pagu Material + Upah', 236, 64.5);
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
    qty_masuk: { header: 'Realisasi Masuk', width: 25, align: 'right', getValue: (it) => `${(it.is_stock_item ? it.qty_masuk_total : Math.max(it.qty_masuk_total, it.qty_keluar_total)).toLocaleString('id-ID')} ${it.satuan}` },
    qty_sisa: { header: 'Sisa Belum Tiba', width: 25, align: 'right', getValue: (it) => `${it.qty_pemenuhan_sisa.toLocaleString('id-ID')} ${it.satuan}` },
    status: {
      header: 'Status',
      width: 22,
      align: 'center',
      getValue: (it) => {
        if (mutations && physicalMaterials) {
          const pm = physicalMaterials.find(
            (p) => p.id === it.id || (p.budget_lines && p.budget_lines.some((bl) => bl.id === it.id)) || p.nama_barang === it.nama_barang
          );
          const ev = evaluateBoqPos(it, pm, mutations, evalContext);
          return ev.statusLabel;
        }
        return it.status_pemenuhan;
      }
    }
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

  const availableTableWidth = pageWidth - 28;
  const baseTotalWidth = activeBOQCols.reduce((sum, col) => sum + (boqColumnMap[col]?.width || 25), 0);
  const widthScale = baseTotalWidth > 0 ? availableTableWidth / baseTotalWidth : 1;

  const columnStylesConfig: any = {};
  activeBOQCols.forEach((c, idx) => {
    const colDef = boqColumnMap[c];
    columnStylesConfig[idx] = {
      cellWidth: colDef ? Math.round(colDef.width * widthScale * 10) / 10 : 'auto',
      halign: colDef?.align || 'left'
    };
  });

  autoTable(doc, {
    startY: hideFinancials ? 65 : 69,
    head: [activeBOQCols.map(c => boqColumnMap[c].header)],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: activeBOQCols.length <= 5 ? 9.5 : 8.8,
    },
    styles: {
      font: 'helvetica',
      fontSize: activeBOQCols.length <= 4 ? 9.5 : activeBOQCols.length <= 6 ? 8.8 : 8.0,
      cellPadding: 2.4,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
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

  const fileName = buildCleanPdfFilename(customTitle, 'Laporan_BOQ_Pemenuhan_Material', b.projectName);
  doc.save(fileName);

  return {
    id: docId,
    judul: customTitle || 'Laporan Bill of Quantity (BOQ) & Kontrol Pemenuhan Material',
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
  customTitle?: string;
  customNotes?: string;
  signer?: UserProfile;
  stockMutations?: MutasiBarang[];
  branding?: TenantBranding;
  selectedColumns?: string[];
  providerScope?: 'ALL' | 'KONTRAKTOR' | 'IMK';
  orientation?: 'portrait' | 'landscape';
  role?: ImpersonateRole;
}): Promise<DokumenLaporan> {
  const {
    docId,
    materials,
    projectName,
    filterSummary,
    customTitle,
    customNotes,
    signer,
    stockMutations = [],
    branding: rawBranding,
    selectedColumns,
    providerScope = 'ALL',
    orientation: requestedOrientation,
    role
  } = params;
  const b = resolvePdfBranding(rawBranding, projectName);
  const evalContext = resolveEvalContext(role || 'Foreman', false, b);
  const providerLabels = { contractorName: b.contractorName, clientName: b.clientName };

  const doc = new jsPDF({
    orientation: requestedOrientation || 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  drawOfficialHeader(doc, pageWidth, b);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(13);
  doc.setFont('helvetica', 'bold');
  doc.text(customTitle || 'REKAPITULASI STOK GUDANG MATERIAL', 14, 40);

  const discrepancyList = materials.map((pm) => summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels));
  const mismatchMatCount = discrepancyList.filter((d) => d.hasMismatch).length;

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(30, 41, 59);
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
        if (providerScope === 'KONTRAKTOR') {
          if (disc?.imkTargetQty > 0) {
            extraLines.push(`Lingkup Kontraktor: ${disc.masukKontraktor}/${disc.kontraktorTargetQty} ${pm.satuan} · [Jatah Klien ${disc.imkTargetQty} ${pm.satuan} Dikecualikan]`);
          }
        } else if (providerScope === 'IMK') {
          if (disc?.kontraktorTargetQty > 0) {
            extraLines.push(`Jatah Pengadaan Klien: ${disc.masukKlien}/${disc.imkTargetQty} ${pm.satuan} · [Lingkup Kontraktor ${disc.kontraktorTargetQty} ${pm.satuan} Dikecualikan]`);
          }
        } else {
          if (disc?.mixedBreakdownText) extraLines.push(disc.mixedBreakdownText);
          if (disc?.hasMismatch) extraLines.push(`[!] ${disc.summaryText}`);
        }
        return extraLines.length > 0
          ? `${pm.nama_barang} (${pm.budget_lines.length} Pos BOQ)\n${extraLines.join('\n')}`
          : `${pm.nama_barang} (${pm.budget_lines.length} Pos BOQ)`;
      }
    },
    satuan: { header: 'Satuan', width: 18, align: 'center', getValue: (pm) => pm.satuan },
    target_kebutuhan: {
      header: 'Target BOQ',
      width: 26,
      align: 'right',
      getValue: (pm, _, disc) => {
        let qty = pm.total_qty_boq || 0;
        if (providerScope === 'KONTRAKTOR') {
          qty = disc?.kontraktorTargetQty ?? qty;
        } else if (providerScope === 'IMK') {
          qty = disc?.imkTargetQty ?? qty;
        }
        return qty.toLocaleString('id-ID', { maximumFractionDigits: 3 });
      }
    },
    sudah_masuk: {
      header: 'Total Masuk',
      width: 32,
      align: 'right',
      getValue: (pm, _, disc) => {
        let totalTarget = pm.total_qty_boq || 0;
        let totalMasuk = pm.total_qty_masuk || 0;
        if (providerScope === 'KONTRAKTOR') {
          totalTarget = disc?.kontraktorTargetQty ?? totalTarget;
          totalMasuk = disc?.masukKontraktor ?? totalMasuk;
        } else if (providerScope === 'IMK') {
          totalTarget = disc?.imkTargetQty ?? totalTarget;
          totalMasuk = disc?.masukKlien ?? totalMasuk;
        }
        const pctTiba = totalTarget > 0 ? Math.round((totalMasuk / totalTarget) * 100) : 0;
        return `${totalMasuk.toLocaleString('id-ID', { maximumFractionDigits: 3 })} (${pctTiba}%)`;
      }
    },
    sisa_belum_tiba: {
      header: 'Sisa Belum Tiba',
      width: 26,
      align: 'right',
      getValue: (pm, _, disc) => {
        let sisa = Math.max(0, (pm.total_qty_boq || 0) - (pm.total_qty_masuk || 0));
        if (providerScope === 'KONTRAKTOR') {
          sisa = disc?.kontraktorSisaQty ?? sisa;
        } else if (providerScope === 'IMK') {
          sisa = disc?.imkSisaQty ?? sisa;
        }
        return sisa.toLocaleString('id-ID', { maximumFractionDigits: 3 });
      }
    },
    sudah_dipakai: {
      header: 'Sudah Terpakai',
      width: 26,
      align: 'right',
      getValue: (pm) => (pm.total_qty_keluar || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })
    },
    saldo_gudang: {
      header: 'Stok Gudang (Riil)',
      width: 26,
      align: 'right',
      getValue: (pm) => pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })
    },
    harga_beli_rata_rata: {
      header: 'Harga Rata-Rata',
      width: 28,
      align: 'right',
      getValue: (pm) => {
        if (pm.harga_beli_rata_rata != null && pm.harga_beli_rata_rata > 0) {
          const base = `Rp ${pm.harga_beli_rata_rata.toLocaleString('id-ID')}`;
          return (pm.count_nota_menyusul && pm.count_nota_menyusul > 0)
            ? `${base}\n(! ${pm.count_nota_menyusul} nota menyusul)`
            : base;
        }
        return (pm.count_nota_menyusul && pm.count_nota_menyusul > 0)
          ? `(! ${pm.count_nota_menyusul} nota menyusul)`
          : '-';
      }
    },
    total_nilai_belanja_riil: {
      header: 'Total Belanja Riil',
      width: 32,
      align: 'right',
      getValue: (pm) => {
        if (pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0) {
          return `Rp ${pm.total_nilai_belanja_riil.toLocaleString('id-ID')}`;
        }
        return '-';
      }
    },
    status_gudang: {
      header: 'Status Stok',
      width: 26,
      align: 'center',
      getValue: (pm) => {
        const ev = evaluateWarehouseMaterial(pm, stockMutations, evalContext);
        return pm.stok_fisik > 0
          ? `Tersedia (${pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })})`
          : ev.statusLabel;
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

  const availableTableWidth = pageWidth - 28;
  const baseTotalWidth = activeWarehouseCols.reduce((sum, col) => sum + (warehouseColumnMap[col]?.width || 25), 0);
  const widthScale = baseTotalWidth > 0 ? availableTableWidth / baseTotalWidth : 1;

  const columnStylesConfig: any = {};
  activeWarehouseCols.forEach((c, idx) => {
    const colDef = warehouseColumnMap[c];
    columnStylesConfig[idx] = {
      cellWidth: colDef ? Math.round(colDef.width * widthScale * 10) / 10 : 'auto',
      halign: colDef?.align || 'left'
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
      fontSize: activeWarehouseCols.length <= 4 ? 9.5 : 9,
    },
    styles: {
      font: 'helvetica',
      fontSize: activeWarehouseCols.length <= 4 ? 9.5 : activeWarehouseCols.length <= 6 ? 8.8 : 8.2,
      cellPadding: 2.6,
      textColor: [15, 23, 42],
      lineColor: [203, 213, 225],
      lineWidth: 0.15,
    },
    columnStyles: columnStylesConfig,
    didParseCell: (data) => {
      if (data.section === 'body') {
        const disc = discrepancyList[data.row.index];
        if (disc?.hasMismatch) {
          data.cell.styles.fillColor = [254, 243, 199];
          if (data.column.index === 1) {
            data.cell.styles.textColor = [120, 53, 15];
            data.cell.styles.fontStyle = 'bold';
          }
        } else {
          data.cell.styles.textColor = [15, 23, 42];
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

  const fileName = buildCleanPdfFilename(customTitle, 'Rekapitulasi_Gudang_Material', b.projectName);
  doc.save(fileName);

  return {
    id: docId,
    judul: customTitle || 'Rekapitulasi Stok Gudang Material',
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

/**
 * Generate PDF Laporan Eksekutif Proyek Terpadu (6 Bab — Satu Kesatuan GABUNGAN_PROYEK)
 * Otomatis beradaptasi pada POV KONTRAKTOR (lengkap 6 bab) vs POV KLIEN (progres fisik & serah terima bebas kebocoran kas internal).
 */
export async function generateIntegratedProjectReportPDF(params: {
  docId: string;
  report: IntegratedProjectReportData;
  signer: UserProfile;
  branding?: TenantBranding;
  selectedSections?: string[];
  customTitle?: string;
  customNotes?: string;
  orientation?: 'portrait' | 'landscape';
  includeClientClaim?: boolean;
  approvers?: {
    issuerName?: string;
    checkerName?: string;
    approverName?: string;
    directorName?: string;
  };
}): Promise<DokumenLaporan> {
  const {
    docId,
    report,
    signer,
    branding: rawBranding,
    selectedSections,
    customTitle,
    customNotes,
    orientation = 'landscape',
    includeClientClaim = false,
    approvers,
  } = params;

  const b = resolvePdfBranding(rawBranding, report.projectName);
  const isContractor = report.partyPov === 'KONTRAKTOR' && report.includeFinancials;
  const hasSection = (key: string) =>
    !selectedSections || selectedSections.length === 0 || selectedSections.includes(key);

  const doc = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const ensureSpace = (neededMm: number, currentY: number): number => {
    if (currentY + neededMm > pageHeight - 16) {
      doc.addPage();
      return 20;
    }
    return currentY;
  };

  drawOfficialHeader(doc, pageWidth, b);

  const defaultTitle = isContractor
    ? 'LAPORAN PROYEK TERPADU (FISIK BOQ, STOK GUDANG, ARUS KAS & REKONSILIASI)'
    : 'LAPORAN PROGRES FISIK & SERAH TERIMA PROYEK TERPADU (EDISI KLIEN)';
  const finalTitle = customTitle?.trim() || defaultTitle;

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text(finalTitle, 14, 41);

  doc.setFontSize(8.2);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(51, 65, 85);
  doc.text(
    `No. Dokumen: ${docId} | Edisi POV: ${isContractor ? 'Kontraktor (Lengkap)' : 'Klien (Progres Fisik)'} | Dicetak: ${formatDateOnly(report.generatedAt)}`,
    14,
    46
  );
  if (customNotes) {
    doc.text(`Catatan: ${customNotes}`, 14, 50.5, { maxWidth: pageWidth - 28 });
  }

  let cursorY = customNotes ? 55 : 51;

  // =========================================================================
  // BAB 1 — RINGKASAN EKSEKUTIF & SEGITIGA KONTROL PROYEK
  // =========================================================================
  if (hasSection('bab_eksekutif')) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 58, 138);
    doc.text('BAB 1 · RINGKASAN EKSEKUTIF & SEGITIGA KONTROL PROYEK', 14, cursorY);
    cursorY += 3;

    const bab1Rows: string[][] = isContractor
      ? [
          ['Nilai Kontrak Kontraktor (Material + Upah)', formatRupiah(report.contractStats.paguKontraktorRp), 'Capaian Serapan Fisik BOQ', `${report.physicalProgress.serapanFisikPct}% (${report.physicalProgress.tuntasCount}/${report.physicalProgress.totalPosCount} pos tuntas)`],
          ['Nilai Aset Jatah Klien', formatRupiah(report.contractStats.nilaiJatahKlienRp), 'Pos Kritis Habis / Belum Serah', `${report.physicalProgress.habisKritisCount} pos habis · ${report.physicalProgress.jatahKlienBelumSerahCount} jatah Klien belum serah`],
          ['Total Dana Masuk Aktif', formatRupiah(report.cashMetrics?.totalMasukAktif || 0), 'Total Dana Keluar Aktif', formatRupiah(report.cashMetrics?.totalKeluarAktif || 0)],
          ['Saldo Kas Operasional', `${formatRupiah(report.cashMetrics?.saldoSaatIni || 0)} (${report.cashMetrics?.healthLabel || '-'})`, 'Valuasi Stok Fisik Gudang', formatRupiah(report.reconciliation?.valuasiStokGudangRp || 0)],
          ['Total Aset Kerja Proyek (Kas + Stok)', formatRupiah(report.reconciliation?.totalAsetKerjaProyekRp || 0), 'Utang Nota Gudang Belum Dibayar', formatRupiah(report.reconciliation?.selisihNotaBelumDibayarRp || 0)],
        ]
      : [
          ['Total Pos Pekerjaan & Material BOQ', `${report.physicalProgress.totalPosCount} Pos`, 'Capaian Serapan Fisik BOQ', `${report.physicalProgress.serapanFisikPct}% (${report.physicalProgress.tuntasCount} tuntas)`],
          ['Sedang Berjalan (Proses)', `${report.physicalProgress.prosesCount} Pos`, 'Siap Pakai di Gudang', `${report.physicalProgress.siapPakaiCount} Pos`],
          ['Belum Masuk / Belum Serah', `${report.physicalProgress.belumMasukAtauSerahCount} Pos`, 'Kewajiban Jatah Klien Belum Serah', `${report.physicalProgress.jatahKlienBelumSerahCount} Pos`],
          ['Dokumen Resmi Terbit (POV Klien)', `${report.officialDocumentsSummary.totalDocs} Dokumen`, 'Dokumen Sah TTE/QR', `${report.officialDocumentsSummary.sahTteCount} Dokumen`],
        ];

    autoTable(doc, {
      startY: cursorY,
      head: [['Indikator Utama', 'Nilai / Status', 'Indikator Pendamping', 'Nilai / Status']],
      body: bab1Rows,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2.2 },
      margin: { left: 14, right: 14 },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 30) + 7;
  }

  // =========================================================================
  // BAB 2 — MATRIKS REKONSILIASI LINTAS MODUL (KHUSUS KONTRAKTOR)
  // =========================================================================
  if (isContractor && hasSection('bab_rekonsiliasi') && report.reconciliation) {
    cursorY = ensureSpace(38, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 58, 138);
    doc.text('BAB 2 · MATRIKS REKONSILIASI LINTAS MODUL, PANJAR & KONTRIBUSI EKOSISTEM', 14, cursorY);
    cursorY += 3;

    const recon = report.reconciliation;
    autoTable(doc, {
      startY: cursorY,
      head: [['Modul Ekosistem', 'Status', 'Jml Transaksi', 'Arus Masuk (Rp)', 'Arus Keluar (Rp)', 'Antrean Tindak Lanjut']],
      body: recon.moduleContributions.map((mc) => [
        mc.moduleLabel,
        mc.status === 'AKTIF' ? 'Aktif' : 'Siap Ekspansi',
        String(mc.transactionCount),
        formatRupiah(mc.totalInRp),
        formatRupiah(mc.totalOutRp),
        mc.pendingCount > 0 ? `${mc.pendingCount} item` : 'Tuntas',
      ]),
      theme: 'grid',
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontSize: 8 },
      styles: { fontSize: 7.8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 30) + 5;

    // Ringkasan Utang Nota, Panjar Terbuka, Piutang Talangan
    const openPanjarTotal = recon.openKasbonList.reduce((s, k) => s + k.sisaTerbukaRp, 0);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(30, 41, 59);
    doc.text(
      `Rekonsiliasi Belanja Material Nota Gudang: ${formatRupiah(recon.materialNotaGudangRp)} | Dibayar Kas Material: ${formatRupiah(recon.materialKasKeluarRp)} | Utang Nota Belum Dibayar: ${formatRupiah(recon.selisihNotaBelumDibayarRp)} (${recon.unreconciledReceipts.length} nota)`,
      14,
      cursorY
    );
    cursorY += 4.5;
    doc.text(
      `Panjar / Kasbon Terbuka: ${formatRupiah(openPanjarTotal)} (${recon.openKasbonList.filter((k) => k.statusKasbon !== 'LUNAS').length} aktif) | Piutang Talangan Klien: ${formatRupiah(recon.clientAdvanceSummary.sisaPiutangRp)}`,
      14,
      cursorY
    );
    cursorY += 7;
  }

  // =========================================================================
  // BAB 3 — REKAPITULASI CAPAIAN BOQ PER DIVISI
  // =========================================================================
  if (hasSection('bab_boq_gudang') && report.divisionSummaries.length > 0) {
    cursorY = ensureSpace(36, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 58, 138);
    doc.text('BAB 3 · REKAPITULASI CAPAIAN BOQ PER DIVISI PEKERJAAN', 14, cursorY);
    cursorY += 3;

    const head = isContractor
      ? [['No', 'Divisi / Kategori BOQ', 'Jumlah Pos', 'Pos Tuntas', 'Pagu Kontrak (Rp)', 'Serapan Fisik (%)']]
      : [['No', 'Divisi / Kategori BOQ', 'Jumlah Pos', 'Pos Tuntas', 'Serapan Fisik (%)']];

    const body = report.divisionSummaries.map((d, idx) =>
      isContractor
        ? [String(idx + 1), d.divisionName, String(d.totalPos), String(d.tuntasPos), formatRupiah(d.paguRp), `${d.realisasiFisikPct}%`]
        : [String(idx + 1), d.divisionName, String(d.totalPos), String(d.tuntasPos), `${d.realisasiFisikPct}%`]
    );

    autoTable(doc, {
      startY: cursorY,
      head,
      body,
      theme: 'grid',
      headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontSize: 8 },
      styles: { fontSize: 7.8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 30) + 7;
  }

  // =========================================================================
  // BAB 4 — SERAPAN ANGGARAN POS BIAYA KAS (KHUSUS KONTRAKTOR)
  // =========================================================================
  if (isContractor && hasSection('bab_anggaran_kas') && report.budgetCategories.length > 0) {
    cursorY = ensureSpace(38, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 58, 138);
    doc.text('BAB 4 · REKAPITULASI SERAPAN ANGGARAN PER POS BIAYA KAS', 14, cursorY);
    cursorY += 3;

    autoTable(doc, {
      startY: cursorY,
      head: [['Pos Biaya / Kategori', 'Pagu Acuan (Rp)', 'Realisasi Kas (Rp)', 'Sisa Pagu (Rp)', 'Serapan', 'Transaksi', 'Status']],
      body: report.budgetCategories.map((cat) => [
        cat.label,
        cat.paguAcuanRp > 0 ? formatRupiah(cat.paguAcuanRp) : 'Tanpa Pagu BOQ',
        formatRupiah(cat.realisasiKasRp),
        cat.paguAcuanRp > 0 ? formatRupiah(cat.sisaPaguRp) : '—',
        cat.paguAcuanRp > 0 ? `${cat.serapanPct}%` : '—',
        String(cat.txCount),
        cat.statusLabel,
      ]),
      theme: 'grid',
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontSize: 8 },
      styles: { fontSize: 7.8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 30) + 7;
  }

  // Opsional Lampiran Tagihan Talangan Klien pada Edisi Klien (tanpa bocorkan kas internal)
  if (
    !isContractor &&
    (includeClientClaim || selectedSections?.includes('lampirkan_talangan_klien')) &&
    report.clientClaimSummary &&
    report.clientClaimSummary.totalTalanganRp > 0
  ) {
    cursorY = ensureSpace(32, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(180, 83, 9);
    doc.text('LAMPIRAN · RINCIAN TAGIHAN TALANGAN PERMINTAAN KLIEN', 14, cursorY);
    cursorY += 3;

    autoTable(doc, {
      startY: cursorY,
      head: [['Tanggal', 'No. Bukti', 'Uraian Pengeluaran Talangan', 'Nominal (Rp)']],
      body: report.clientClaimSummary.transactions
        .filter((t) => t.jenis === 'KELUAR')
        .map((t) => [
          formatDateOnly(t.tanggal),
          t.nomor_kuitansi || '-',
          t.untuk_apa,
          formatRupiah(t.jumlah_rp),
        ]),
      theme: 'grid',
      headStyles: { fillColor: [180, 83, 9], textColor: [255, 255, 255], fontSize: 8 },
      styles: { fontSize: 7.8, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 25) + 7;
  }

  // =========================================================================
  // BAB 5 — INDEKS LAMPIRAN BUKTI NOTA & KUITANSI TERPADU (KHUSUS KONTRAKTOR)
  // =========================================================================
  if (isContractor && hasSection('bab_indeks_nota')) {
    cursorY = ensureSpace(32, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(30, 58, 138);
    doc.text(`BAB 5 · INDEKS LAMPIRAN BUKTI NOTA & KUITANSI TERPADU (${report.receiptIndex.length} BERKAS AKTIF)`, 14, cursorY);
    cursorY += 3;

    autoTable(doc, {
      startY: cursorY,
      head: [['No', 'Tanggal Nota', 'Nomor Bukti', 'Toko / Pihak Lawan', 'Cakupan', 'Nominal Bukti (Rp)']],
      body:
        report.receiptIndex.length > 0
          ? report.receiptIndex.slice(0, 30).map((rc, idx) => [
              String(idx + 1),
              formatDateOnly(rc.tanggal_nota),
              rc.reference_no,
              rc.nama_toko,
              rc.receipt_scope === 'TERPADU'
                ? 'Terpadu (Terbayar Kas)'
                : rc.receipt_scope === 'KAS_OPERASIONAL'
                ? 'Kuitansi Kas'
                : 'Nota Belanja Gudang',
              formatRupiah(Number(rc.total_nota_fisik) || 0),
            ])
          : [['—', '—', 'Belum ada berkas nota/kuitansi aktif pada proyek ini', '—', '—', 'Rp 0']],
      theme: 'grid',
      headStyles: { fillColor: [67, 56, 202], textColor: [255, 255, 255], fontSize: 8 },
      styles: { fontSize: 7.6, cellPadding: 2 },
      margin: { left: 14, right: 14 },
    });
    cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 25) + 7;
  }

  // =========================================================================
  // BAB 6 — PENGESAHAN BERJENJANG 4 TINGKAT, TTE/QR & HASH SHA-256
  // =========================================================================
  cursorY = ensureSpace(46, cursorY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(30, 58, 138);
  doc.text('BAB 6 · PENGESAHAN BERJENJANG 4 TINGKAT & VALIDASI INTEGRITAS SHA-256', 14, cursorY);
  cursorY += 5;

  const colW = (pageWidth - 28) / 4;
  const issuerName = approvers?.issuerName || signer?.name || 'Clerk / Pelaksana';
  const checkerName = approvers?.checkerName || report.officialDocumentsSummary.latestApprovedDoc?.diperiksa_oleh || 'Menunggu Pemeriksaan';
  const approverName = approvers?.approverName || report.officialDocumentsSummary.latestApprovedDoc?.disetujui_oleh || 'Menunggu Persetujuan';
  const directorName = approvers?.directorName || report.officialDocumentsSummary.latestApprovedDoc?.mengetahui_oleh || b.directorName;

  const qrPayload = `TTE-${b.contractorSlug}:${docId}:GABUNGAN_PROYEK:${report.partyPov}:NPWP_${b.contractorNpwp || 'NA'}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 100, margin: 0 });

  const signCols = [
    { label: '1. Diterbitkan Oleh', role: 'Clerk / Pelaksana', name: issuerName },
    { label: '2. Diperiksa Oleh', role: 'Foreman / Pengawas', name: checkerName.split('·')[0].trim() },
    { label: '3. Disetujui Oleh', role: 'Spv. / Dept. Manager', name: approverName.split('·')[0].trim() },
    { label: '4. Mengetahui / Sah TTE', role: 'KTT-PM / Direktur', name: directorName.split('·')[0].trim() },
  ];

  signCols.forEach((sc, i) => {
    const x = 14 + colW * i;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(sc.label, x, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.text(sc.role, x, cursorY + 4);
    if (i === 3) {
      doc.addImage(qrDataUrl, 'PNG', x, cursorY + 6.5, 16, 16);
    }
    doc.setTextColor(15, 23, 42);
    doc.text(sc.name, x, cursorY + 26, { maxWidth: colW - 4 });
  });

  const snapshotPayload = stableStringify({
    docId,
    jenis: 'GABUNGAN_PROYEK',
    partyPov: report.partyPov,
    project: b.projectName,
    contractor: b.contractorName,
    physical: report.physicalProgress,
    saldoKas: isContractor ? report.cashMetrics?.saldoSaatIni ?? 0 : null,
    totalAsetKerja: isContractor ? report.reconciliation?.totalAsetKerjaProyekRp ?? 0 : null,
  });
  const hash = await sha256Hex(snapshotPayload);

  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | ${b.contractorName}`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  const fileName = buildCleanPdfFilename(
    finalTitle,
    isContractor ? 'Laporan_Proyek_Terpadu' : 'Laporan_Progres_Proyek_Klien',
    b.projectName
  );
  doc.save(fileName);

  return {
    id: docId,
    judul: finalTitle,
    jenis: 'GABUNGAN_PROYEK',
    audience_pov: isContractor ? 'KONTRAKTOR' : 'KLIEN',
    status: 'TERVERIFIKASI',
    periode_awal: report.generatedAt,
    periode_akhir: report.generatedAt,
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: directorName,
    penandatangan_jabatan: 'Direktur Utama',
    penandatangan_email: b.directorEmail,
    hash_keamanan: hash,
    total_transaksi: report.physicalProgress.totalPosCount + (report.cashMetrics?.activeCount || 0),
    ringkasan_nilai_rp: isContractor ? report.reconciliation?.totalAsetKerjaProyekRp || 0 : 0,
    qr_payload: qrPayload,
  };
}

/**
 * Generate PDF Resmi Surat Pesanan Material (PO Toko) siap kirim ke Toko Rekanan
 */
export async function generatePurchaseOrderPDF(params: {
  po: PurchaseOrder;
  signer: UserProfile;
  projectName?: string;
  branding?: TenantBranding;
  storeAddress?: string;
  storePic?: string;
  docId?: string;
}): Promise<DokumenLaporan> {
  const { po, signer, projectName, branding: rawBranding, storeAddress, storePic } = params;
  const docId = params.docId || po.po_no;
  const b = resolvePdfBranding(rawBranding, projectName);

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  drawOfficialHeader(doc, pageWidth, b);

  // Banner Judul PO
  doc.setFillColor(239, 246, 255);
  doc.setDrawColor(191, 219, 254);
  doc.roundedRect(14, 38, pageWidth - 28, 14, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(30, 58, 138);
  doc.text('SURAT PESANAN MATERIAL (PO TOKO)', 18, 44.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51, 65, 85);
  doc.text(`No. Surat Pesanan: ${po.po_no}`, 18, 49.5);

  const statusText =
    po.is_batal || po.status_dokumen === 'BATAL'
      ? 'STATUS: BATAL'
      : po.is_ganti || po.status_dokumen === 'DIGANTI'
        ? 'STATUS: DIGANTI (REVISI)'
        : po.status_dokumen === 'MENGETAHUI'
          ? 'STATUS: SAH TTE / QR'
          : 'STATUS: MENUNGGU PENGESAHAN';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(
    po.is_batal ? 190 : po.status_dokumen === 'MENGETAHUI' ? 15 : 180,
    po.is_batal ? 18 : po.status_dokumen === 'MENGETAHUI' ? 118 : 83,
    po.is_batal ? 60 : po.status_dokumen === 'MENGETAHUI' ? 110 : 9
  );
  doc.text(statusText, pageWidth - 18, 46.5, { align: 'right' });

  // Blok Metadata 2 Kolom: Toko Rekanan vs Info Syarat & Jadwal
  let cursorY = 56;
  const halfW = (pageWidth - 32) / 2;

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.roundedRect(14, cursorY, halfW, 28, 2, 2, 'FD');
  doc.roundedRect(14 + halfW + 4, cursorY, halfW, 28, 2, 2, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('KEPADA YTH. TOKO REKANAN:', 17, cursorY + 5.5);
  doc.setFontSize(9.5);
  doc.setTextColor(15, 23, 42);
  doc.text(po.nama_toko || '-', 17, cursorY + 11, { maxWidth: halfW - 6 });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  if (storePic) {
    doc.text(`UP / Kontak PIC: ${storePic}`, 17, cursorY + 16, { maxWidth: halfW - 6 });
  }
  doc.text(`Telepon / WA: ${po.toko_kontak || '-'}`, 17, cursorY + (storePic ? 20.5 : 16.5), {
    maxWidth: halfW - 6,
  });
  if (storeAddress) {
    doc.text(`Alamat: ${storeAddress}`, 17, cursorY + 25, { maxWidth: halfW - 6 });
  }

  const rightX = 14 + halfW + 7;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('RINCIAN PESANAN & SYARAT PEMBAYARAN:', rightX, cursorY + 5.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(15, 23, 42);
  doc.text(`Tanggal PO: ${formatDateOnly(po.tanggal_po)}`, rightX, cursorY + 11);
  doc.text(
    `Estimasi Tiba: ${po.estimasi_tiba ? formatDateOnly(po.estimasi_tiba) : 'Sesuai Kesepakatan'}`,
    rightX,
    cursorY + 15.5
  );
  doc.text(
    `Syarat Bayar: ${PO_PAYMENT_TERMS_LABELS[po.payment_terms] || po.payment_terms}`,
    rightX,
    cursorY + 20
  );
  const tempoOrDpText =
    po.payment_terms === 'DP_PELUNASAN' && (po.dp_amount_rp || 0) > 0
      ? `Uang Muka (DP): ${formatRupiah(po.dp_amount_rp)}`
      : po.jatuh_tempo_bayar
        ? `Jatuh Tempo: ${formatDateOnly(po.jatuh_tempo_bayar)}`
        : `Proyek: ${b.projectName}`;
  doc.text(tempoOrDpText, rightX, cursorY + 24.5, { maxWidth: halfW - 6 });

  cursorY += 34;

  // Tabel Item Pesanan (Harga Satuan PO Terkunci)
  const items = po.items || [];
  autoTable(doc, {
    startY: cursorY,
    head: [['No', 'Nama Material / Spesifikasi', 'Qty', 'Satuan', 'Harga Satuan PO', 'Subtotal (Rp)', 'Catatan']],
    body: items.map((it, idx) => [
      String(idx + 1),
      it.nama_barang,
      new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 }).format(Number(it.qty_pesan) || 0),
      it.satuan || 'Unit',
      formatRupiah(Number(it.harga_satuan_po) || 0),
      formatRupiah(Number(it.subtotal_rp) || 0),
      it.catatan || '-',
    ]),
    foot: [
      [
        '',
        'TOTAL NILAI SURAT PESANAN (PO)',
        '',
        '',
        '',
        formatRupiah(Number(po.total_amount_rp) || 0),
        '',
      ],
    ],
    theme: 'grid',
    headStyles: { fillColor: [30, 58, 138], textColor: [255, 255, 255], fontSize: 8 },
    footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold', fontSize: 8.5 },
    styles: { fontSize: 8, cellPadding: 2.4 },
    columnStyles: {
      0: { halign: 'center', cellWidth: 9 },
      2: { halign: 'right', cellWidth: 16 },
      3: { halign: 'center', cellWidth: 16 },
      4: { halign: 'right', cellWidth: 28 },
      5: { halign: 'right', cellWidth: 30 },
      6: { cellWidth: 26 },
    },
    margin: { left: 14, right: 14 },
  });

  cursorY = ((doc as any).lastAutoTable?.finalY || cursorY + 30) + 6;

  // Catatan Pengiriman ke Toko
  if (cursorY > pageHeight - 68) {
    doc.addPage();
    cursorY = 18;
  }

  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  const noteLines = [
    `1. Mohon sertakan Surat Jalan / Nota Toko resmi yang mencantumkan nomor ${po.po_no} saat pengiriman ke lokasi proyek.`,
    `2. Harga satuan di atas mengikat sesuai kesepakatan pesanan. Perubahan harga atau spesifikasi wajib konfirmasi terlebih dahulu.`,
    ...(po.catatan_toko ? [`3. Catatan Khusus: ${po.catatan_toko}`] : []),
  ];
  const noteBoxH = 8 + noteLines.length * 4.5;
  doc.roundedRect(14, cursorY, pageWidth - 28, noteBoxH, 2, 2, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(30, 58, 138);
  doc.text('KETENTUAN PENGIRIMAN & PENAGIHAN:', 17, cursorY + 5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.6);
  doc.setTextColor(51, 65, 85);
  noteLines.forEach((line, idx) => {
    doc.text(line, 17, cursorY + 10 + idx * 4.5, { maxWidth: pageWidth - 34 });
  });
  cursorY += noteBoxH + 8;

  // Blok Pengesahan Berjenjang 4 Tingkat + TTE/QR
  if (cursorY > pageHeight - 44) {
    doc.addPage();
    cursorY = 18;
  }

  const colW = (pageWidth - 28) / 4;
  const issuerName = po.created_by_name || signer?.name || 'Clerk / Pelaksana';
  const checkerName = po.diperiksa_oleh || 'Menunggu Pemeriksaan';
  const approverName = po.disetujui_oleh || 'Menunggu Persetujuan';
  const directorName = po.mengetahui_oleh || (po.status_dokumen === 'MENGETAHUI' ? b.directorName : 'Menunggu Pengesahan');

  const qrPayload =
    po.tte_qr_code ||
    `TTE-${b.contractorSlug}:${docId}:PO_PENGADAAN:KONTRAKTOR:NPWP_${b.contractorNpwp || 'NA'}`;
  const qrDataUrl = await QRCode.toDataURL(qrPayload, { width: 100, margin: 0 });

  const signCols = [
    { label: '1. Diterbitkan Oleh', role: 'Clerk / Pelaksana', name: issuerName },
    { label: '2. Diperiksa Oleh', role: 'Foreman / Lapangan', name: checkerName.split('·')[0].trim() },
    { label: '3. Disetujui Oleh', role: 'Spv. / Pengawas', name: approverName.split('·')[0].trim() },
    { label: '4. Mengetahui / Sah TTE', role: 'Dept. Mgr / KTT / Dir.', name: directorName.split('·')[0].trim() },
  ];

  signCols.forEach((sc, i) => {
    const x = 14 + colW * i;
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(sc.label, x, cursorY);
    doc.setFont('helvetica', 'bold');
    doc.text(sc.role, x, cursorY + 4);
    if (i === 3) {
      doc.addImage(qrDataUrl, 'PNG', x, cursorY + 6.5, 16, 16);
    }
    doc.setTextColor(15, 23, 42);
    doc.text(sc.name, x, cursorY + 26, { maxWidth: colW - 4 });
  });

  const snapshotPayload = stableStringify({
    docId,
    jenis: 'PO_PENGADAAN',
    poId: po.id,
    poNo: po.po_no,
    store: po.nama_toko,
    totalAmountRp: po.total_amount_rp,
    itemCount: items.length,
    status: po.status_dokumen,
  });
  const hash = await sha256Hex(snapshotPayload);

  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(148, 163, 184);
  doc.text(
    `Integritas Dokumen SHA-256: ${hash} | ${b.contractorName}`,
    pageWidth / 2,
    pageHeight - 5,
    { align: 'center' }
  );

  const fileName = buildCleanPdfFilename(
    `Surat_Pesanan_${po.po_no}_${po.nama_toko}`,
    'Surat_Pesanan_PO',
    b.projectName
  );
  doc.save(fileName);

  return {
    id: docId,
    judul: `Surat Pesanan (PO) ${po.po_no} — ${po.nama_toko}`,
    jenis: 'PO_PENGADAAN',
    audience_pov: 'KONTRAKTOR',
    status: po.status_dokumen === 'MENGETAHUI' ? 'TERVERIFIKASI' : 'MENUNGGU',
    periode_awal: po.tanggal_po,
    periode_akhir: po.estimasi_tiba || po.tanggal_po,
    dibuat_pada: new Date().toISOString(),
    penandatangan_nama: directorName,
    penandatangan_jabatan: 'Pengesah PO',
    penandatangan_email: b.directorEmail,
    hash_keamanan: hash,
    total_transaksi: items.length,
    ringkasan_nilai_rp: Number(po.total_amount_rp) || 0,
    qr_payload: qrPayload,
  };
}
