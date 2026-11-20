import {
  AsalBarang,
  BebanBiaya,
  JenisMutasiBarang,
  MutasiBarang,
  PhysicalBudgetLine,
  PhysicalMaterialItem,
  TujuanPengeluaran
} from '../types';

export type WizardStepId =
  | 'PICK_ITEM'
  | 'CUSTOM_IDENTITY'
  | 'QTY_DATE'
  | 'ORIGIN'
  | 'CUSTOM_IN_PURPOSE'
  | 'EXIT_CATEGORY'
  | 'EXIT_BOQ_POS'
  | 'EXIT_NOTE'
  | 'SUMMARY';

export interface CustomStockOption {
  nama_barang: string;
  satuan: string;
  stok: number;
  lastPurposeIn: string;
}

export interface StockWizardAnswers {
  mutationType: JenisMutasiBarang;
  itemSource: 'NONE' | 'BOQ' | 'CUSTOM_EXISTING' | 'CUSTOM_NEW';
  physicalMaterial: PhysicalMaterialItem | null;
  customItemName: string;
  customItemUom: string;
  customExistingStock: number;
  customLastPurposeIn: string;
  qty: number;
  mutationDate: string; // YYYY-MM-DD lokal
  asalBarang: AsalBarang;
  tokoBebasName: string;
  customInPurpose: string;
  tujuanPengeluaran: TujuanPengeluaran;
  selectedBudgetLineId: string;
  exitNote: string;
  pic: string;
  suratJalan: string;
}

export interface StepVisualTheme {
  id: WizardStepId;
  badgeLabel: string;
  headerBg: string;
  headerBorder: string;
  accentBar: string;
  badgeClass: string;
  cardRing: string;
  primaryBtn: string;
}

export const getTodayLocalDate = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

export const toLocalDateInput = (iso?: string): string => {
  if (!iso) return getTodayLocalDate();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return getTodayLocalDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const buildOccurredAtIso = (dateStr: string): string => {
  if (!dateStr) return new Date().toISOString();
  if (dateStr === getTodayLocalDate()) {
    return new Date().toISOString();
  }
  // Tengah hari waktu lokal agar tanggal mundur tidak bergeser ke hari sebelumnya saat dikonversi ke UTC
  return new Date(`${dateStr}T12:00:00`).toISOString();
};

export const formatIndonesianDate = (dateStr: string): string => {
  if (!dateStr) return '-';
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('id-ID', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
};

export const getProviderMetaForMaterial = (
  pm: PhysicalMaterialItem | null
): { defaultAsal: 'KONTRAKTOR' | 'KLIEN'; isMixed: boolean; label: string } => {
  if (!pm || !pm.budget_lines || pm.budget_lines.length === 0) {
    return { defaultAsal: 'KONTRAKTOR', isMixed: false, label: 'Kontraktor' };
  }
  let imkQty = 0;
  let kontraktorQty = 0;
  let imkCount = 0;
  let kontraktorCount = 0;

  pm.budget_lines.forEach((bl) => {
    const isImk = (bl.keterangan || '').toLowerCase().includes('imk');
    const q = Number(bl.qty_boq || 0);
    if (isImk) {
      imkQty += q;
      imkCount += 1;
    } else {
      kontraktorQty += q;
      kontraktorCount += 1;
    }
  });

  const hasImk = imkQty > 0 || imkCount > 0;
  const hasKontraktor = kontraktorQty > 0 || kontraktorCount > 0;

  if (hasImk && !hasKontraktor) {
    return { defaultAsal: 'KLIEN', isMixed: false, label: 'Klien (PT IMK)' };
  }
  if (hasImk && hasKontraktor) {
    return {
      defaultAsal: imkQty > kontraktorQty ? 'KLIEN' : 'KONTRAKTOR',
      isMixed: true,
      label: 'Kontraktor & PT IMK'
    };
  }
  return { defaultAsal: 'KONTRAKTOR', isMixed: false, label: 'Kontraktor' };
};

export const createInitialWizardAnswers = (
  type: JenisMutasiBarang,
  picName: string,
  preselectedPm?: PhysicalMaterialItem | null,
  explicitLineId?: string
): StockWizardAnswers => {
  const base: StockWizardAnswers = {
    mutationType: type,
    itemSource: 'NONE',
    physicalMaterial: null,
    customItemName: '',
    customItemUom: '',
    customExistingStock: 0,
    customLastPurposeIn: '',
    qty: 1,
    mutationDate: getTodayLocalDate(),
    asalBarang: 'KONTRAKTOR',
    tokoBebasName: '',
    customInPurpose: '',
    tujuanPengeluaran: 'PROYEK_BOQ',
    selectedBudgetLineId: '',
    exitNote: '',
    pic: picName || '',
    suratJalan: ''
  };

  if (preselectedPm) {
    const prov = getProviderMetaForMaterial(preselectedPm);
    const matchedLine =
      (explicitLineId && preselectedPm.budget_lines.find((bl) => bl.id === explicitLineId)) ||
      preselectedPm.budget_lines[0] ||
      null;

    return {
      ...base,
      itemSource: 'BOQ',
      physicalMaterial: preselectedPm,
      asalBarang: type === 'MASUK' ? prov.defaultAsal : 'KONTRAKTOR',
      selectedBudgetLineId: matchedLine?.id || ''
    };
  }

  return base;
};

/**
 * ENGINE LANGKAH DINAMIS:
 * Menentukan daftar pertanyaan yang relevan berdasarkan jawaban Clerk sejauh ini.
 */
export const computeWizardSteps = (answers: StockWizardAnswers): WizardStepId[] => {
  const steps: WizardStepId[] = ['PICK_ITEM'];

  if (answers.itemSource === 'CUSTOM_NEW') {
    steps.push('CUSTOM_IDENTITY');
  }

  steps.push('QTY_DATE');

  if (answers.mutationType === 'MASUK') {
    steps.push('ORIGIN');
    if (answers.itemSource === 'CUSTOM_EXISTING' || answers.itemSource === 'CUSTOM_NEW') {
      steps.push('CUSTOM_IN_PURPOSE');
    }
  } else {
    steps.push('EXIT_CATEGORY');
    const isBoqProjectExit =
      answers.itemSource === 'BOQ' && answers.tujuanPengeluaran === 'PROYEK_BOQ';

    if (isBoqProjectExit) {
      // Jika material BOQ memiliki > 1 pos pekerjaan, tanyakan pos mana (Bedakan Keluar).
      // Jika hanya 1 pos, Engine otomatis memilihkannya tanpa menambah layar.
      if ((answers.physicalMaterial?.budget_lines.length || 0) > 1) {
        steps.push('EXIT_BOQ_POS');
      }
    } else {
      steps.push('EXIT_NOTE');
    }
  }

  steps.push('SUMMARY');
  return steps;
};

/**
 * ENGINE VALIDASI PER LANGKAH:
 * Memastikan jawaban di layar saat ini valid sebelum maju ke pertanyaan berikutnya.
 */
export const validateWizardStep = (
  stepId: WizardStepId,
  answers: StockWizardAnswers
): string | null => {
  switch (stepId) {
    case 'PICK_ITEM':
      if (answers.itemSource === 'NONE') {
        return 'Silakan cari dan pilih barang, atau klik "Lainnya" untuk barang baru.';
      }
      return null;

    case 'CUSTOM_IDENTITY':
      if (!answers.customItemName.trim()) {
        return 'Tuliskan nama barangnya terlebih dahulu.';
      }
      if (!answers.customItemUom.trim()) {
        return 'Tuliskan satuannya (contoh: Sak, Kg, Batang, Unit, Liter).';
      }
      return null;

    case 'QTY_DATE':
      if (!answers.qty || answers.qty <= 0) {
        return 'Jumlah barang harus lebih besar dari 0.';
      }
      if (!answers.mutationDate) {
        return 'Pilih tanggal kejadian terlebih dahulu.';
      }
      if (
        answers.mutationType === 'KELUAR' &&
        answers.itemSource === 'BOQ' &&
        answers.physicalMaterial
      ) {
        const stok = answers.physicalMaterial.stok_fisik || 0;
        if (answers.qty > stok) {
          return `Stok fisik di gudang (${stok.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${answers.physicalMaterial.satuan}) tidak mencukupi untuk pengeluaran ${answers.qty.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${answers.physicalMaterial.satuan}.`;
        }
      }
      return null;

    case 'ORIGIN':
      return null;

    case 'CUSTOM_IN_PURPOSE':
      if (!answers.customInPurpose.trim()) {
        return 'Tuliskan rencana keperluan barang kustom ini saat masuk.';
      }
      return null;

    case 'EXIT_CATEGORY':
      return null;

    case 'EXIT_BOQ_POS':
      if (!answers.selectedBudgetLineId && (answers.physicalMaterial?.budget_lines.length || 0) > 0) {
        return 'Pilih salah satu Pos Pekerjaan BOQ terlebih dahulu.';
      }
      return null;

    case 'EXIT_NOTE':
      if (!answers.exitNote.trim()) {
        return 'Tuliskan keterangan singkat pemakaian barang ini.';
      }
      return null;

    case 'SUMMARY':
      return null;
  }
};

export interface ProcessedStockSubmission {
  payload: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>;
  summary: {
    itemName: string;
    uom: string;
    isCustom: boolean;
    ruleBadge: string;
    dateLabel: string;
    detailLabel: string;
    detailValue: string;
    extraLabel?: string;
    extraValue?: string;
  };
}

/**
 * ENGINE PENGOLAH DATA AKHIR:
 * Menerjemahkan jawaban percakapan manusiawi dari Clerk menjadi payload database terstruktur.
 */
export const buildStockMutationPayload = (
  answers: StockWizardAnswers
): ProcessedStockSubmission => {
  const isCustom =
    answers.itemSource === 'CUSTOM_EXISTING' || answers.itemSource === 'CUSTOM_NEW';
  const pm = answers.physicalMaterial;

  const selectedLine: PhysicalBudgetLine | null =
    !isCustom && pm
      ? pm.budget_lines.find((bl) => bl.id === answers.selectedBudgetLineId) ||
        pm.budget_lines[0] ||
        null
      : null;

  const itemName = isCustom
    ? answers.customItemName.trim()
    : pm?.nama_barang || 'Material';
  const itemSatuan = isCustom
    ? answers.customItemUom.trim() || 'Unit'
    : pm?.satuan || 'Unit';

  const targetItemId = isCustom ? '' : selectedLine?.id || pm?.id || '';

  let calculatedSourceName = 'Pengadaan Kontraktor (CV Menara Megah)';
  let calculatedOwnerType: 'KONTRAKTOR' | 'KLIEN' = 'KONTRAKTOR';
  let calculatedBeban: BebanBiaya = 'KONTRAKTOR';
  let finalPurpose = 'Penyediaan Material Kontrak BOQ';
  let destinationName = answers.mutationType === 'MASUK' ? 'Gudang Utama Proyek' : 'Area Proyek';

  let detailLabel = 'Asal Barang';
  let detailValue = 'Kontraktor (CV Menara Megah)';
  let extraLabel: string | undefined;
  let extraValue: string | undefined;

  if (answers.mutationType === 'MASUK') {
    if (answers.asalBarang === 'KLIEN') {
      calculatedSourceName = 'Disediakan Klien / Owner';
      calculatedOwnerType = 'KLIEN';
      detailValue = 'Klien (PT IMK)';
    } else if (answers.asalBarang === 'TOKO_BEBAS') {
      calculatedSourceName = answers.tokoBebasName.trim()
        ? `Lainnya: ${answers.tokoBebasName.trim()}`
        : 'Lainnya / Toko Bebas';
      calculatedOwnerType = 'KONTRAKTOR';
      detailValue = answers.tokoBebasName.trim()
        ? `Lainnya (${answers.tokoBebasName.trim()})`
        : 'Lainnya / Toko Bebas';
    }

    if (isCustom) {
      finalPurpose = answers.customInPurpose.trim() || `Penerimaan ${itemName}`;
      extraLabel = 'Rencana Keperluan Masuk';
      extraValue = finalPurpose;
    } else {
      finalPurpose = 'Penyediaan Material Kontrak BOQ';
      extraLabel = 'Aturan Gudang';
      extraValue = 'Satukan Masuk ke Stok Gudang Proyek';
    }
  } else {
    detailLabel = 'Tujuan Pemakaian';
    if (answers.tujuanPengeluaran === 'PROYEK_BOQ') {
      calculatedBeban = 'PROYEK_BOQ';
      if (isCustom) {
        finalPurpose = answers.exitNote.trim() || 'Pemakaian Pekerjaan Proyek (Item Kustom)';
        detailValue = 'Pekerjaan Proyek (Barang Kustom)';
        extraLabel = 'Keterangan Pemakaian';
        extraValue = finalPurpose;
      } else {
        finalPurpose = selectedLine
          ? `Pekerjaan: ${selectedLine.kode_boq} - ${selectedLine.kategori}`
          : 'Pekerjaan Proyek BOQ';
        destinationName = selectedLine ? `Area Proyek - ${selectedLine.kategori}` : 'Area Proyek';
        detailValue = 'Pekerjaan Proyek (BOQ)';
        extraLabel = 'Pos Pekerjaan BOQ';
        extraValue = selectedLine ? `[${selectedLine.kode_boq}] ${selectedLine.kategori}` : '-';
      }
    } else if (answers.tujuanPengeluaran === 'OPERASIONAL') {
      calculatedBeban = 'OPERASIONAL';
      finalPurpose = answers.exitNote.trim() || 'Kebutuhan Operasional Lapangan';
      detailValue = 'Operasional Lapangan';
      extraLabel = 'Keterangan';
      extraValue = finalPurpose;
    } else if (answers.tujuanPengeluaran === 'PERMINTAAN_KLIEN') {
      calculatedBeban = 'KLIEN';
      calculatedOwnerType = 'KLIEN';
      finalPurpose = answers.exitNote.trim() || 'Permintaan Tambahan Klien (Kena Invoice)';
      detailValue = 'Permintaan Klien (Kena Invoice)';
      extraLabel = 'Keterangan';
      extraValue = finalPurpose;
    } else if (answers.tujuanPengeluaran === 'BONUS_KLIEN') {
      calculatedBeban = 'BONUS_KLIEN';
      finalPurpose = answers.exitNote.trim() || 'Bonus untuk Klien (Gratis / Beban Menara Megah)';
      detailValue = 'Bonus untuk Klien (Gratis)';
      extraLabel = 'Keterangan';
      extraValue = finalPurpose;
    }
  }

  const ruleBadge =
    answers.mutationType === 'MASUK'
      ? isCustom
        ? '✍️ Barang Kustom · Bedakan Masuk'
        : '📦 Material BOQ · Satukan Masuk'
      : isCustom
      ? '✍️ Barang Kustom · Bedakan Keluar'
      : '📦 Material BOQ · Bedakan Keluar';

  return {
    payload: {
      barang_id: targetItemId,
      nama_barang: itemName,
      jenis: answers.mutationType,
      jumlah: answers.qty,
      satuan: itemSatuan,
      tujuan_keperluan: finalPurpose,
      pic_penerima_penyerah: answers.pic.trim() || 'Clerk',
      nomor_surat_jalan: answers.suratJalan.trim() || undefined,
      tanggal: buildOccurredAtIso(answers.mutationDate),
      catatan: isCustom && answers.mutationType === 'MASUK' ? answers.customInPurpose.trim() || undefined : undefined,
      source_name: calculatedSourceName,
      destination_name: destinationName,
      recipient_name: answers.pic.trim() || undefined,
      owner_type: calculatedOwnerType,
      purpose: finalPurpose,
      beban_biaya: calculatedBeban,
      is_custom_item: isCustom
    },
    summary: {
      itemName,
      uom: itemSatuan,
      isCustom,
      ruleBadge,
      dateLabel: formatIndonesianDate(answers.mutationDate),
      detailLabel,
      detailValue,
      extraLabel,
      extraValue
    }
  };
};

/**
 * TEMA WARNA BERBEDA PER KARTU PERTANYAAN (KOGNISI CEPAT CLERK — LIGHT & DARK MODE)
 */
export const getStepTheme = (
  stepId: WizardStepId,
  mutationType: JenisMutasiBarang
): StepVisualTheme => {
  switch (stepId) {
    case 'PICK_ITEM':
      return mutationType === 'MASUK'
        ? {
            id: stepId,
            badgeLabel: 'Pilih Barang Masuk',
            headerBg: 'bg-emerald-700 dark:bg-emerald-950/90',
            headerBorder: 'border-emerald-600/40 dark:border-emerald-800',
            accentBar: 'bg-emerald-500',
            badgeClass: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-200',
            cardRing: 'border-emerald-300/80 dark:border-emerald-800/80',
            primaryBtn: 'bg-emerald-600 hover:bg-emerald-700'
          }
        : {
            id: stepId,
            badgeLabel: 'Pilih Barang Keluar',
            headerBg: 'bg-rose-700 dark:bg-rose-950/90',
            headerBorder: 'border-rose-600/40 dark:border-rose-800',
            accentBar: 'bg-rose-500',
            badgeClass: 'bg-rose-100 text-rose-900 dark:bg-rose-900/70 dark:text-rose-200',
            cardRing: 'border-rose-300/80 dark:border-rose-800/80',
            primaryBtn: 'bg-rose-600 hover:bg-rose-700'
          };

    case 'CUSTOM_IDENTITY':
      return {
        id: stepId,
        badgeLabel: 'Barang Baru (Lainnya)',
        headerBg: 'bg-purple-700 dark:bg-purple-950/90',
        headerBorder: 'border-purple-600/40 dark:border-purple-800',
        accentBar: 'bg-purple-500',
        badgeClass: 'bg-purple-100 text-purple-900 dark:bg-purple-900/70 dark:text-purple-200',
        cardRing: 'border-purple-300/80 dark:border-purple-800/80',
        primaryBtn: 'bg-purple-600 hover:bg-purple-700'
      };

    case 'QTY_DATE':
      return {
        id: stepId,
        badgeLabel: 'Jumlah & Tanggal',
        headerBg: 'bg-blue-700 dark:bg-blue-950/90',
        headerBorder: 'border-blue-600/40 dark:border-blue-800',
        accentBar: 'bg-blue-500',
        badgeClass: 'bg-blue-100 text-blue-900 dark:bg-blue-900/70 dark:text-blue-200',
        cardRing: 'border-blue-300/80 dark:border-blue-800/80',
        primaryBtn: 'bg-blue-600 hover:bg-blue-700'
      };

    case 'ORIGIN':
      return {
        id: stepId,
        badgeLabel: 'Asal / Penyedia Barang',
        headerBg: 'bg-teal-700 dark:bg-teal-950/90',
        headerBorder: 'border-teal-600/40 dark:border-teal-800',
        accentBar: 'bg-teal-500',
        badgeClass: 'bg-teal-100 text-teal-900 dark:bg-teal-900/70 dark:text-teal-200',
        cardRing: 'border-teal-300/80 dark:border-teal-800/80',
        primaryBtn: 'bg-teal-600 hover:bg-teal-700'
      };

    case 'CUSTOM_IN_PURPOSE':
      return {
        id: stepId,
        badgeLabel: 'Rencana Peruntukan',
        headerBg: 'bg-amber-700 dark:bg-amber-950/90',
        headerBorder: 'border-amber-600/40 dark:border-amber-800',
        accentBar: 'bg-amber-500',
        badgeClass: 'bg-amber-100 text-amber-900 dark:bg-amber-900/70 dark:text-amber-200',
        cardRing: 'border-amber-300/80 dark:border-amber-800/80',
        primaryBtn: 'bg-amber-600 hover:bg-amber-700'
      };

    case 'EXIT_CATEGORY':
      return {
        id: stepId,
        badgeLabel: 'Tujuan Pengeluaran',
        headerBg: 'bg-orange-700 dark:bg-orange-950/90',
        headerBorder: 'border-orange-600/40 dark:border-orange-800',
        accentBar: 'bg-orange-500',
        badgeClass: 'bg-orange-100 text-orange-900 dark:bg-orange-900/70 dark:text-orange-200',
        cardRing: 'border-orange-300/80 dark:border-orange-800/80',
        primaryBtn: 'bg-orange-600 hover:bg-orange-700'
      };

    case 'EXIT_BOQ_POS':
      return {
        id: stepId,
        badgeLabel: 'Pos Pekerjaan BOQ',
        headerBg: 'bg-indigo-700 dark:bg-indigo-950/90',
        headerBorder: 'border-indigo-600/40 dark:border-indigo-800',
        accentBar: 'bg-indigo-500',
        badgeClass: 'bg-indigo-100 text-indigo-900 dark:bg-indigo-900/70 dark:text-indigo-200',
        cardRing: 'border-indigo-300/80 dark:border-indigo-800/80',
        primaryBtn: 'bg-indigo-600 hover:bg-indigo-700'
      };

    case 'EXIT_NOTE':
      return {
        id: stepId,
        badgeLabel: 'Keterangan Pemakaian',
        headerBg: 'bg-sky-700 dark:bg-sky-950/90',
        headerBorder: 'border-sky-600/40 dark:border-sky-800',
        accentBar: 'bg-sky-500',
        badgeClass: 'bg-sky-100 text-sky-900 dark:bg-sky-900/70 dark:text-sky-200',
        cardRing: 'border-sky-300/80 dark:border-sky-800/80',
        primaryBtn: 'bg-sky-600 hover:bg-sky-700'
      };

    case 'SUMMARY':
      return mutationType === 'MASUK'
        ? {
            id: stepId,
            badgeLabel: 'Konfirmasi & Simpan',
            headerBg: 'bg-emerald-800 dark:bg-emerald-950',
            headerBorder: 'border-emerald-700/50 dark:border-emerald-800',
            accentBar: 'bg-emerald-500',
            badgeClass: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/70 dark:text-emerald-200',
            cardRing: 'border-emerald-400/80 dark:border-emerald-700',
            primaryBtn: 'bg-emerald-600 hover:bg-emerald-700'
          }
        : {
            id: stepId,
            badgeLabel: 'Konfirmasi & Simpan',
            headerBg: 'bg-rose-800 dark:bg-rose-950',
            headerBorder: 'border-rose-700/50 dark:border-rose-800',
            accentBar: 'bg-rose-500',
            badgeClass: 'bg-rose-100 text-rose-900 dark:bg-rose-900/70 dark:text-rose-200',
            cardRing: 'border-rose-400/80 dark:border-rose-700',
            primaryBtn: 'bg-rose-600 hover:bg-rose-700'
          };
  }
};
