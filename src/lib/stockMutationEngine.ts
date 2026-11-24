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
  | 'SUMMARY'
  | 'DONE_NEXT';

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
  hargaNotaSatuan?: number | null;
  isHargaBelumDiketahui: boolean;
  isNotaMenyusul: boolean;
  actualItemNameReplacement?: string;
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

export interface ProviderLabels {
  contractorName?: string;
  clientName?: string;
}

const resolveProviderLabels = (labels?: ProviderLabels) => {
  const contractor = (labels?.contractorName || '').trim() || 'Kontraktor';
  const client = (labels?.clientName || '').trim() || 'Klien';
  return { contractor, client };
};

const clientTokensCache = new Map<string, string[]>();
function getClientTokens(clientName: string): string[] {
  let tokens = clientTokensCache.get(clientName);
  if (!tokens) {
    const stopWords = new Set(['pt', 'cv', 'tbk', 'persero', 'ltd', 'inc', 'co', 'dan', 'the']);
    tokens = clientName
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !stopWords.has(t));
    clientTokensCache.set(clientName, tokens);
  }
  return tokens;
}

const remarkCache = new Map<string, boolean>();

/**
 * Deteksi generik apakah sebuah pos BOQ merupakan barang free-issue / pasokan Klien.
 * Mendukung pola umum ('by klien', 'by client', 'by owner', 'free-issue', 'pemilik')
 * maupun nama klien proyek aktif (termasuk singkatan seperti 'imk').
 * Dioptimasi dengan caching instan agar filtering/sorting ratusan baris BOQ < 1ms.
 */
export const isClientProvidedRemark = (remark?: string, clientName?: string): boolean => {
  if (!remark) return false;
  const key = `${remark}__${clientName || ''}`;
  const cached = remarkCache.get(key);
  if (cached !== undefined) return cached;

  const lower = remark.toLowerCase();
  let result = false;
  if (
    lower.includes('by klien') ||
    lower.includes('by client') ||
    lower.includes('by owner') ||
    lower.includes('free-issue') ||
    lower.includes('free issue') ||
    lower.includes('klien') ||
    lower.includes('client') ||
    lower.includes('owner') ||
    lower.includes('pemilik') ||
    /\bimk\b/.test(lower)
  ) {
    result = true;
  } else if (clientName) {
    const tokens = getClientTokens(clientName);
    if (tokens.some((t) => lower.includes(t))) {
      result = true;
    }
  }

  remarkCache.set(key, result);
  return result;
};

export const getProviderMetaForMaterial = (
  pm: PhysicalMaterialItem | null,
  labels?: ProviderLabels
): {
  defaultAsal: 'KONTRAKTOR' | 'KLIEN';
  isMixed: boolean;
  label: string;
  kontraktorQty: number;
  imkQty: number;
} => {
  const { contractor, client } = resolveProviderLabels(labels);
  if (!pm || !pm.budget_lines || pm.budget_lines.length === 0) {
    return { defaultAsal: 'KONTRAKTOR', isMixed: false, label: contractor, kontraktorQty: 0, imkQty: 0 };
  }
  let imkQty = 0;
  let kontraktorQty = 0;
  let imkCount = 0;
  let kontraktorCount = 0;

  pm.budget_lines.forEach((bl) => {
    const isClient = isClientProvidedRemark(bl.keterangan, labels?.clientName);
    const q = Number(bl.qty_boq || 0);
    if (isClient) {
      imkQty += q;
      imkCount += 1;
    } else {
      kontraktorQty += q;
      kontraktorCount += 1;
    }
  });

  const hasClient = imkQty > 0 || imkCount > 0;
  const hasKontraktor = kontraktorQty > 0 || kontraktorCount > 0;

  if (hasClient && !hasKontraktor) {
    return { defaultAsal: 'KLIEN', isMixed: false, label: client, kontraktorQty: 0, imkQty };
  }
  if (hasClient && hasKontraktor) {
    return {
      defaultAsal: imkQty > kontraktorQty ? 'KLIEN' : 'KONTRAKTOR',
      isMixed: true,
      label: `${contractor} & ${client}`,
      kontraktorQty,
      imkQty
    };
  }
  return { defaultAsal: 'KONTRAKTOR', isMixed: false, label: contractor, kontraktorQty, imkQty: 0 };
};

export interface ProviderDiscrepancyInfo {
  isMismatch: boolean;
  kind: 'NONE' | 'TALANGAN_KONTRAKTOR' | 'DIPASOK_KLIEN';
  contractProviderLabel: string;
  actualProviderLabel: string;
  shortBadge: string;
  pdfNote: string;
}

const isActualClientMutation = (
  mut: Pick<MutasiBarang, 'source_name' | 'owner_type'>,
  clientName?: string
): boolean => {
  if (mut.owner_type === 'KLIEN') return true;
  return isClientProvidedRemark(mut.source_name, clientName);
};

/**
 * Deteksi otomatis selisih penyedia antara Kontrak BOQ vs Realisasi Barang Masuk di lapangan.
 * Mendukung barang murni 1 penyedia MAUPUN barang campuran (Kontraktor & Klien) jika melampaui kuota penyedia.
 */
export const analyzeIncomingProviderDiscrepancy = (
  mut: Pick<MutasiBarang, 'id' | 'tanggal' | 'barang_id' | 'nama_barang' | 'jenis' | 'jumlah' | 'satuan' | 'is_custom_item' | 'source_name' | 'owner_type'>,
  physicalMaterials: PhysicalMaterialItem[],
  allMutations?: MutasiBarang[],
  labels?: ProviderLabels
): ProviderDiscrepancyInfo => {
  const { contractor, client } = resolveProviderLabels(labels);
  const actualRaw = (mut.source_name || '').trim();
  const actualLower = actualRaw.toLowerCase();
  const isActualClient = isActualClientMutation(mut, labels?.clientName);
  const isActualOther =
    !isActualClient && (actualLower.includes('lainnya') || actualLower.includes('toko'));

  const actualProviderLabel = isActualClient
    ? `Klien (${client})`
    : isActualOther
    ? actualRaw || 'Lainnya / Toko Bebas'
    : `Kontraktor (${contractor})`;

  if (mut.jenis !== 'MASUK' || mut.is_custom_item) {
    return {
      isMismatch: false,
      kind: 'NONE',
      contractProviderLabel: mut.is_custom_item ? 'Barang Kustom' : '-',
      actualProviderLabel,
      shortBadge: '',
      pdfNote: ''
    };
  }

  const normName = (mut.nama_barang || '').trim().toLowerCase();
  const matchedPm =
    physicalMaterials.find(
      (pm) =>
        (mut.barang_id && (pm.id === mut.barang_id || pm.budget_lines.some((bl) => bl.id === mut.barang_id))) ||
        pm.nama_barang.trim().toLowerCase() === normName
    ) || null;

  if (!matchedPm) {
    return {
      isMismatch: false,
      kind: 'NONE',
      contractProviderLabel: '-',
      actualProviderLabel,
      shortBadge: '',
      pdfNote: ''
    };
  }

  const prov = getProviderMetaForMaterial(matchedPm, labels);

  // 1) Jatah murni Klien, tetapi realisasi lapangan masuk oleh Kontraktor / Lainnya
  if (!prov.isMixed && prov.defaultAsal === 'KLIEN' && !isActualClient) {
    const label = isActualOther
      ? `Pengadaan Lainnya (Jatah BOQ: ${client})`
      : `Talangan Kontraktor (Jatah BOQ: ${client})`;
    return {
      isMismatch: true,
      kind: 'TALANGAN_KONTRAKTOR',
      contractProviderLabel: client,
      actualProviderLabel,
      shortBadge: label,
      pdfNote: label
    };
  }

  // 2) Jatah murni Kontraktor, tetapi realisasi lapangan dipasok Klien
  if (!prov.isMixed && prov.defaultAsal === 'KONTRAKTOR' && isActualClient) {
    const label = `Dipasok ${client} (Jatah BOQ: ${contractor})`;
    return {
      isMismatch: true,
      kind: 'DIPASOK_KLIEN',
      contractProviderLabel: contractor,
      actualProviderLabel,
      shortBadge: label,
      pdfNote: label
    };
  }

  // 3) Material Campuran (Kontraktor & Klien): cek apakah kumulatif masuk penyedia ini melampaui kuota BOQ-nya
  if (prov.isMixed && allMutations && allMutations.length > 0) {
    const lineIds = new Set([matchedPm.id, ...matchedPm.budget_lines.map((bl) => bl.id)]);
    const relatedIn = allMutations
      .filter(
        (m) =>
          m.jenis === 'MASUK' &&
          !m.is_custom_item &&
          !m.is_batal &&
          !m.is_ganti &&
          m.status_dokumen !== 'BATAL' &&
          m.status_dokumen !== 'DIGANTI' &&
          ((m.barang_id && lineIds.has(m.barang_id)) || (m.nama_barang || '').trim().toLowerCase() === normName)
      )
      .sort((a, b) => {
        const diff = new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
        return diff !== 0 ? diff : a.id.localeCompare(b.id);
      });

    let cumKontraktor = 0;
    let cumKlien = 0;
    for (const m of relatedIn) {
      const mIsClient = isActualClientMutation(m, labels?.clientName);
      if (mIsClient) cumKlien += Number(m.jumlah || 0);
      else cumKontraktor += Number(m.jumlah || 0);

      if (m.id === mut.id) {
        if (!mIsClient && cumKontraktor > prov.kontraktorQty + 0.0001) {
          const excess = Math.min(Number(mut.jumlah || 0), cumKontraktor - prov.kontraktorQty);
          const label = `Talangan Kontraktor +${excess.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${mut.satuan} (Melebihi Kuota Kontraktor · Jatah ${client})`;
          return {
            isMismatch: true,
            kind: 'TALANGAN_KONTRAKTOR',
            contractProviderLabel: `${contractor} & ${client}`,
            actualProviderLabel,
            shortBadge: label,
            pdfNote: label
          };
        }
        if (mIsClient && cumKlien > prov.imkQty + 0.0001) {
          const excess = Math.min(Number(mut.jumlah || 0), cumKlien - prov.imkQty);
          const label = `Dipasok ${client} +${excess.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${mut.satuan} (Melebihi Kuota Klien · Jatah ${contractor})`;
          return {
            isMismatch: true,
            kind: 'DIPASOK_KLIEN',
            contractProviderLabel: `${contractor} & ${client}`,
            actualProviderLabel,
            shortBadge: label,
            pdfNote: label
          };
        }
        break;
      }
    }
  }

  return {
    isMismatch: false,
    kind: 'NONE',
    contractProviderLabel: prov.label,
    actualProviderLabel,
    shortBadge: '',
    pdfNote: ''
  };
};

export interface MaterialDiscrepancySummary {
  hasMismatch: boolean;
  kind: 'NONE' | 'TALANGAN_KONTRAKTOR' | 'DIPASOK_KLIEN';
  mismatchQty: number;
  contractProviderLabel: string;
  actualProviderLabel: string;
  summaryText: string;
  mixedBreakdownText: string;
  masukKontraktor: number;
  masukKlien: number;
  kontraktorTargetQty: number;
  imkTargetQty: number;
  kontraktorSisaQty: number;
  imkSisaQty: number;
}

/**
 * Rekap selisih penyedia & porsi masuk per material fisik (untuk Tab 1 Rekap Gudang & PDF Rekap Gudang).
 */
export const summarizeMaterialIncomingDiscrepancy = (
  pm: PhysicalMaterialItem,
  stockMutations: MutasiBarang[],
  labels?: ProviderLabels
): MaterialDiscrepancySummary => {
  const { contractor, client } = resolveProviderLabels(labels);
  const prov = getProviderMetaForMaterial(pm, labels);
  const lineIds = new Set([pm.id, ...pm.budget_lines.map((bl) => bl.id)]);
  const normName = pm.nama_barang.trim().toLowerCase();

  let masukKontraktor = 0;
  let masukKlien = 0;

  for (const m of stockMutations) {
    if (m.jenis !== 'MASUK' || m.is_custom_item || m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') {
      continue;
    }
    const match = (m.barang_id && lineIds.has(m.barang_id)) || (m.nama_barang || '').trim().toLowerCase() === normName;
    if (!match) continue;

    if (isActualClientMutation(m, labels?.clientName)) {
      masukKlien += Number(m.jumlah || 0);
    } else {
      masukKontraktor += Number(m.jumlah || 0);
    }
  }

  const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 3 });

  const kontraktorTargetQty = prov.kontraktorQty;
  const imkTargetQty = prov.imkQty;
  const kontraktorSisaQty = Math.max(0, prov.kontraktorQty - masukKontraktor);
  const imkSisaQty = Math.max(0, prov.imkQty - masukKlien);

  const baseMetrics = {
    masukKontraktor,
    masukKlien,
    kontraktorTargetQty,
    imkTargetQty,
    kontraktorSisaQty,
    imkSisaQty
  };

  if (prov.isMixed) {
    const mixedBreakdownText = `Porsi Masuk — ${contractor}: ${fmt(masukKontraktor)}/${fmt(prov.kontraktorQty)} · ${client}: ${fmt(masukKlien)}/${fmt(prov.imkQty)} ${pm.satuan}`;

    if (masukKontraktor > prov.kontraktorQty + 0.0001) {
      const excess = masukKontraktor - prov.kontraktorQty;
      return {
        ...baseMetrics,
        hasMismatch: true,
        kind: 'TALANGAN_KONTRAKTOR',
        mismatchQty: excess,
        contractProviderLabel: prov.label,
        actualProviderLabel: contractor,
        summaryText: `Talangan Kontraktor: +${fmt(excess)} ${pm.satuan} melebihi porsi Kontraktor (Jatah ${client})`,
        mixedBreakdownText
      };
    }

    if (masukKlien > prov.imkQty + 0.0001) {
      const excess = masukKlien - prov.imkQty;
      return {
        ...baseMetrics,
        hasMismatch: true,
        kind: 'DIPASOK_KLIEN',
        mismatchQty: excess,
        contractProviderLabel: prov.label,
        actualProviderLabel: client,
        summaryText: `Dipasok ${client}: +${fmt(excess)} ${pm.satuan} melebihi porsi Klien (Jatah ${contractor})`,
        mixedBreakdownText
      };
    }

    return {
      ...baseMetrics,
      hasMismatch: false,
      kind: 'NONE',
      mismatchQty: 0,
      contractProviderLabel: prov.label,
      actualProviderLabel: '',
      summaryText: '',
      mixedBreakdownText
    };
  }

  if (prov.defaultAsal === 'KLIEN' && masukKontraktor > 0) {
    return {
      ...baseMetrics,
      hasMismatch: true,
      kind: 'TALANGAN_KONTRAKTOR',
      mismatchQty: masukKontraktor,
      contractProviderLabel: client,
      actualProviderLabel: contractor,
      summaryText: `Talangan Kontraktor: ${fmt(masukKontraktor)} ${pm.satuan} (Jatah BOQ: ${client})`,
      mixedBreakdownText: ''
    };
  }

  if (prov.defaultAsal === 'KONTRAKTOR' && masukKlien > 0) {
    return {
      ...baseMetrics,
      hasMismatch: true,
      kind: 'DIPASOK_KLIEN',
      mismatchQty: masukKlien,
      contractProviderLabel: contractor,
      actualProviderLabel: client,
      summaryText: `Dipasok ${client}: ${fmt(masukKlien)} ${pm.satuan} (Jatah BOQ: ${contractor})`,
      mixedBreakdownText: ''
    };
  }

  return {
    ...baseMetrics,
    hasMismatch: false,
    kind: 'NONE',
    mismatchQty: 0,
    contractProviderLabel: prov.label,
    actualProviderLabel: '',
    summaryText: '',
    mixedBreakdownText: ''
  };
};

export const createInitialWizardAnswers = (
  type: JenisMutasiBarang,
  picName: string,
  preselectedPm?: PhysicalMaterialItem | null,
  explicitLineId?: string,
  labels?: ProviderLabels
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
    hargaNotaSatuan: null,
    isHargaBelumDiketahui: false,
    isNotaMenyusul: false,
    actualItemNameReplacement: '',
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
    const prov = getProviderMetaForMaterial(preselectedPm, labels);
    const matchedLine =
      (explicitLineId && preselectedPm.budget_lines.find((bl) => bl.id === explicitLineId)) ||
      preselectedPm.budget_lines[0] ||
      null;
    const isLineClient = matchedLine ? isClientProvidedRemark(matchedLine.keterangan, labels?.clientName) : false;
    const resolvedAsal: AsalBarang = type === 'MASUK' ? (isLineClient ? 'KLIEN' : prov.defaultAsal) : 'KONTRAKTOR';

    return {
      ...base,
      itemSource: 'BOQ',
      physicalMaterial: preselectedPm,
      asalBarang: resolvedAsal,
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

  if (answers.mutationType === 'MASUK') {
    // Alur Masuk: Tentukan Asal/Penyedia Dulu agar saat input QTY & Harga tahu status kewajiban harganya
    steps.push('ORIGIN');
    if (answers.itemSource === 'CUSTOM_EXISTING' || answers.itemSource === 'CUSTOM_NEW') {
      steps.push('CUSTOM_IN_PURPOSE');
    }
    steps.push('QTY_DATE');
  } else {
    // Alur Keluar: QTY & Tanggal -> Kategori Keluar -> Pos BOQ / Uraian
    steps.push('QTY_DATE');
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
  answers: StockWizardAnswers,
  labels?: ProviderLabels
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
        answers.physicalMaterial &&
        answers.physicalMaterial.is_stock_item
      ) {
        const stok = answers.physicalMaterial.stok_fisik || 0;
        if (answers.qty > stok) {
          return `Stok fisik di gudang (${stok.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${answers.physicalMaterial.satuan}) tidak mencukupi untuk pengeluaran ${answers.qty.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${answers.physicalMaterial.satuan}.`;
        }
      }
      if (answers.mutationType === 'MASUK') {
        const prov = answers.physicalMaterial ? getProviderMetaForMaterial(answers.physicalMaterial, labels) : null;
        const isClientFreeIssue = prov && !prov.isMixed && prov.defaultAsal === 'KLIEN';
        const isClientSource = answers.asalBarang === 'KLIEN';
        const isPendingSource = answers.asalBarang === 'BELUM_DIPASTIKAN';

        // Hanya wajib jika tanggungan Kontraktor dan belum dicentang 'Harga belum diketahui' atau 'Nota menyusul'
        if (!isClientFreeIssue && !isClientSource && !isPendingSource) {
          if (!answers.isHargaBelumDiketahui && !answers.isNotaMenyusul) {
            if (answers.hargaNotaSatuan == null || answers.hargaNotaSatuan <= 0) {
              return 'Harga Nota/Satuan wajib diisi untuk tanggungan kontraktor, atau centang salah satu opsi jika harga riil belum tercantum di nota.';
            }
          }
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
    case 'DONE_NEXT':
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
    hargaDisplay?: string;
    actualItemNameReplacement?: string;
  };
}

/**
 * ENGINE PENGOLAH DATA AKHIR:
 * Menerjemahkan jawaban percakapan manusiawi dari Clerk menjadi payload database terstruktur.
 */
export const buildStockMutationPayload = (
  answers: StockWizardAnswers,
  labels?: ProviderLabels
): ProcessedStockSubmission => {
  const { contractor, client } = resolveProviderLabels(labels);
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

  let calculatedSourceName = `Pengadaan Kontraktor (${contractor})`;
  let calculatedOwnerType: 'KONTRAKTOR' | 'KLIEN' = 'KONTRAKTOR';
  let calculatedBeban: BebanBiaya = 'KONTRAKTOR';
  let finalPurpose = 'Penyediaan Material Kontrak BOQ';
  let destinationName = answers.mutationType === 'MASUK' ? 'Gudang Utama Proyek' : 'Area Proyek';

  let detailLabel = 'Asal Barang';
  let detailValue = `Kontraktor (${contractor})`;
  let extraLabel: string | undefined;
  let extraValue: string | undefined;

  if (answers.mutationType === 'MASUK') {
    if (answers.asalBarang === 'KLIEN') {
      calculatedSourceName = `Disediakan Klien (${client})`;
      calculatedOwnerType = 'KLIEN';
      detailValue = `Klien (${client})`;
    } else if (answers.asalBarang === 'TOKO_BEBAS') {
      calculatedSourceName = answers.tokoBebasName.trim()
        ? `Lainnya: ${answers.tokoBebasName.trim()}`
        : 'Lainnya / Toko Bebas';
      calculatedOwnerType = 'KONTRAKTOR';
      detailValue = answers.tokoBebasName.trim()
        ? `Lainnya (${answers.tokoBebasName.trim()})`
        : 'Lainnya / Toko Bebas';
    } else if (answers.asalBarang === 'BELUM_DIPASTIKAN') {
      calculatedSourceName = 'Belum Dipastikan (Menyusul)';
      calculatedOwnerType = 'KONTRAKTOR';
      detailValue = 'Belum Dipastikan (Menyusul / Verifikasi)';
    }

    if (isCustom) {
      finalPurpose = answers.customInPurpose.trim() || `Penerimaan ${itemName}`;
      extraLabel = 'Rencana Keperluan Masuk';
      extraValue = finalPurpose;
    } else {
      const prov = getProviderMetaForMaterial(pm, labels);
      if (!prov.isMixed && prov.defaultAsal === 'KLIEN' && answers.asalBarang === 'KONTRAKTOR') {
        finalPurpose = `Penyediaan Material Kontrak BOQ — Talangan Kontraktor (Jatah BOQ: ${client})`;
        extraLabel = 'Selisih Penyedia (Otomatis)';
        extraValue = `Jatah BOQ: ${client} · Realisasi Masuk: Kontraktor (${contractor})`;
      } else if (!prov.isMixed && prov.defaultAsal === 'KLIEN' && answers.asalBarang === 'TOKO_BEBAS') {
        finalPurpose = `Penyediaan Material Kontrak BOQ — Pengadaan Lainnya (Jatah BOQ: ${client})`;
        extraLabel = 'Selisih Penyedia (Otomatis)';
        extraValue = `Jatah BOQ: ${client} · Realisasi Masuk: ${detailValue}`;
      } else if (!prov.isMixed && prov.defaultAsal === 'KONTRAKTOR' && answers.asalBarang === 'KLIEN') {
        finalPurpose = `Penyediaan Material Kontrak BOQ — Dipasok ${client} (Jatah BOQ: ${contractor})`;
        extraLabel = 'Selisih Penyedia (Otomatis)';
        extraValue = `Jatah BOQ: ${contractor} · Realisasi Masuk: Klien (${client})`;
      } else {
        finalPurpose = 'Penyediaan Material Kontrak BOQ';
        extraLabel = 'Lokasi';
        extraValue = 'Stok Fisik Gudang Proyek';
      }
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
      finalPurpose = answers.exitNote.trim() || `Bonus untuk Klien (Gratis / Beban ${contractor})`;
      detailValue = 'Bonus untuk Klien (Gratis)';
      extraLabel = 'Keterangan';
      extraValue = finalPurpose;
    }
  }

  let calculatedStatusHarga: 'TERCATAT' | 'BELUM_DIKETAHUI' | 'NOTA_MENYUSUL' | 'JATAH_KLIEN' | undefined = undefined;
  let calculatedHargaSatuan: number | undefined = undefined;

  if (answers.mutationType === 'MASUK') {
    const prov = !isCustom && pm ? getProviderMetaForMaterial(pm, labels) : null;
    const isClientFreeIssue = prov && !prov.isMixed && prov.defaultAsal === 'KLIEN';
    const isClientSource = answers.asalBarang === 'KLIEN';

    if (isClientFreeIssue || isClientSource) {
      calculatedStatusHarga = 'JATAH_KLIEN';
      if (answers.hargaNotaSatuan && answers.hargaNotaSatuan > 0) {
        calculatedHargaSatuan = answers.hargaNotaSatuan;
      }
    } else if (answers.isHargaBelumDiketahui) {
      calculatedStatusHarga = 'BELUM_DIKETAHUI';
    } else if (answers.isNotaMenyusul) {
      calculatedStatusHarga = 'NOTA_MENYUSUL';
    } else if (answers.hargaNotaSatuan && answers.hargaNotaSatuan > 0) {
      calculatedStatusHarga = 'TERCATAT';
      calculatedHargaSatuan = answers.hargaNotaSatuan;
    }
  }

  const hargaDisplay =
    calculatedStatusHarga === 'TERCATAT' && calculatedHargaSatuan
      ? `Rp ${calculatedHargaSatuan.toLocaleString('id-ID')} / ${itemSatuan}`
      : calculatedStatusHarga === 'NOTA_MENYUSUL'
      ? 'Nota Menyusul (Pending)'
      : calculatedStatusHarga === 'BELUM_DIKETAHUI'
      ? 'Harga Belum Diketahui'
      : calculatedStatusHarga === 'JATAH_KLIEN'
      ? `Jatah Pengadaan Klien (${client})`
      : undefined;

  const ruleBadge =
    answers.mutationType === 'MASUK'
      ? isCustom
        ? '✍️ Barang Kustom Non-BOQ'
        : pm && !pm.is_stock_item
        ? '🛠️ Jasa / Upah BOQ · Belanja Langsung'
        : '📦 Material BOQ · Stok Masuk'
      : isCustom
      ? '✍️ Barang Kustom Non-BOQ'
      : pm && !pm.is_stock_item
      ? '🛠️ Realisasi Pos Jasa / Upah BOQ'
      : '📦 Alokasi Pos BOQ';

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
      is_custom_item: isCustom,
      harga_satuan_beli: calculatedHargaSatuan,
      status_harga: calculatedStatusHarga,
      nama_item_aktual: answers.mutationType === 'MASUK' && answers.actualItemNameReplacement?.trim() ? answers.actualItemNameReplacement.trim() : undefined
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
      extraValue,
      hargaDisplay,
      actualItemNameReplacement: answers.mutationType === 'MASUK' && answers.actualItemNameReplacement?.trim() ? answers.actualItemNameReplacement.trim() : undefined
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

    case 'DONE_NEXT':
      return {
        id: stepId,
        badgeLabel: 'Tersimpan · Lanjut?',
        headerBg: 'bg-cyan-700 dark:bg-cyan-950/90',
        headerBorder: 'border-cyan-600/40 dark:border-cyan-800',
        accentBar: 'bg-cyan-500',
        badgeClass: 'bg-cyan-100 text-cyan-900 dark:bg-cyan-900/70 dark:text-cyan-200',
        cardRing: 'border-cyan-300/80 dark:border-cyan-700',
        primaryBtn: 'bg-cyan-600 hover:bg-cyan-700'
      };
  }
};

/**
 * PENCARIAN CERDAS TOLERAN TYPO & MULTI-KATA:
 * Mendukung kata acak ("screw baja"), typo ringan ("holow gipsum", "square" -> "squere", "angle" -> "angel"),
 * dan singkatan tanpa harus sama persis hurufnya.
 */
const normalizeSearchText = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  if (Math.abs(al - bl) > 2) return 3;

  let prev = new Array<number>(bl + 1);
  let curr = new Array<number>(bl + 1);
  for (let j = 0; j <= bl; j++) prev[j] = j;

  for (let i = 1; i <= al; i++) {
    curr[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= bl; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    const tmp = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[bl];
};

const isSubsequence = (needle: string, haystack: string): boolean => {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (needle[i] === haystack[j]) i++;
  }
  return i === needle.length;
};

export const scoreFuzzyMatch = (rawQuery: string, ...fields: string[]): number => {
  const normQuery = normalizeSearchText(rawQuery);
  if (!normQuery) return 0;

  const combined = normalizeSearchText(fields.filter(Boolean).join(' '));
  if (!combined) return 0;

  const queryTokens = normQuery.split(' ').filter(Boolean);
  const targetTokens = combined.split(' ').filter(Boolean);

  let totalScore = 0;

  // Bonus jika keseluruhan frasa cocok langsung
  if (combined.includes(normQuery)) {
    totalScore += combined.startsWith(normQuery) ? 140 : 90;
  }

  for (const qt of queryTokens) {
    let bestTokenScore = 0;
    const maxEdit = qt.length >= 5 ? 2 : qt.length >= 3 ? 1 : 0;

    for (const tw of targetTokens) {
      if (tw === qt) {
        bestTokenScore = Math.max(bestTokenScore, 100);
        break;
      }
      if (tw.startsWith(qt)) {
        bestTokenScore = Math.max(bestTokenScore, 80);
        break;
      } else if (tw.includes(qt)) {
        bestTokenScore = Math.max(bestTokenScore, 65);
      } else if (maxEdit > 0 && Math.abs(tw.length - qt.length) <= maxEdit + 2) {
        // Cek jarak edit terhadap kata penuh maupun awalan kata hanya jika panjangnya mirip
        const distFull = levenshteinDistance(qt, tw);
        const prefixCandidate = tw.slice(0, Math.min(tw.length, qt.length + 1));
        const distPrefix = levenshteinDistance(qt, prefixCandidate);
        const dist = Math.min(distFull, distPrefix);
        if (dist <= maxEdit) {
          bestTokenScore = Math.max(bestTokenScore, dist === 1 ? 50 : 38);
        }
      }
    }

    // Fallback: cek subsequence pada teks gabungan untuk singkatan (cth: "hlg" -> "hollow gypsum")
    if (bestTokenScore === 0 && qt.length >= 3 && isSubsequence(qt, combined.replace(/\s+/g, ''))) {
      bestTokenScore = 20;
    }

    if (bestTokenScore === 0) {
      return 0; // Semua kata kunci harus menemukan kecocokan (toleran typo)
    }
    totalScore += bestTokenScore;
  }

  return totalScore;
};
