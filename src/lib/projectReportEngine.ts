import {
  DokumenLaporan,
  ImpersonateRole,
  ItemBarang,
  MutasiBarang,
  MutasiKas,
  PhysicalMaterialItem,
  ProjectModuleCode,
  ProjectReceipt,
} from '../types';
import { evaluateBoqPos, PartyPOV, resolveEvalContext } from './boqExecutionEngine';
import {
  BudgetCategoryEvaluation,
  CashSummaryMetrics,
  ClientAdvanceReceivableSummary,
  computeCashSummaryMetrics,
  evaluateBudgetCategories,
  findUnreconciledStockReceipts,
  isCashRowExcluded,
  isClientSuppliedStockMutation,
  OpenKasbonItem,
  resolveCashEvalContext,
  SOURCE_MODULE_LABELS,
  summarizeClientAdvanceReceivables,
  summarizeOpenKasbon,
  UnreconciledStockReceiptItem,
} from './cashflowEngine';
import { isClientProvidedRemark } from './stockMutationEngine';

export interface ProjectModuleContribution {
  moduleCode: ProjectModuleCode;
  moduleLabel: string;
  status: 'AKTIF' | 'TAHAP_LANJUT';
  transactionCount: number;
  totalInRp: number;
  totalOutRp: number;
  pendingCount: number;
}

export interface CrossModuleReconciliation {
  materialNotaGudangRp: number;
  materialKasKeluarRp: number;
  selisihNotaBelumDibayarRp: number;
  unreconciledReceipts: UnreconciledStockReceiptItem[];
  openKasbonList: OpenKasbonItem[];
  clientAdvanceSummary: ClientAdvanceReceivableSummary;
  valuasiStokGudangRp: number;
  totalAsetKerjaProyekRp: number; // saldoKas + valuasiStokGudang
  moduleContributions: ProjectModuleContribution[];
}

export interface IntegratedProjectReportData {
  generatedAt: string;
  partyPov: PartyPOV;
  includeFinancials: boolean;
  projectName: string;
  contractorName: string;
  clientName: string;
  contractStats: {
    paguKontraktorRp: number;
    paguMaterialRp: number;
    paguUpahJasaRp: number;
    nilaiJatahKlienRp: number;
    brutoKontrakRp: number;
  };
  physicalProgress: {
    totalPosCount: number;
    tuntasCount: number;
    prosesCount: number;
    siapPakaiCount: number;
    habisKritisCount: number;
    belumMasukAtauSerahCount: number;
    serapanFisikPct: number;
    jatahKlienBelumSerahCount: number;
  };
  cashMetrics: CashSummaryMetrics | null; // null saat partyPov === 'KLIEN'
  budgetCategories: BudgetCategoryEvaluation[];
  reconciliation: CrossModuleReconciliation | null; // null saat partyPov === 'KLIEN'
  clientClaimSummary: ClientAdvanceReceivableSummary | null; // dapat dicetak terpisah bila dicentang
  divisionSummaries: Array<{
    divisionName: string;
    totalPos: number;
    tuntasPos: number;
    paguRp: number;
    realisasiFisikPct: number;
  }>;
  receiptIndex: ProjectReceipt[];
  officialDocumentsSummary: {
    totalDocs: number;
    sahTteCount: number;
    pendingApprovalCount: number;
    latestApprovedDoc?: DokumenLaporan;
  };
}

/**
 * Saring arsip dokumen resmi berdasarkan POV pihak aktif.
 * KLIEN (Viewer/Pengamat) 100% diblokir dari dokumen MUTASI_KAS maupun dokumen berlabel KONTRAKTOR.
 */
export function filterDocumentsForPov(
  documents: DokumenLaporan[],
  partyPov: PartyPOV
): DokumenLaporan[] {
  const list = documents || [];
  if (partyPov === 'KONTRAKTOR') {
    return list;
  }

  return list.filter((doc) => {
    // Arsip kas internal kontraktor dilarang keras tampil di POV Klien
    if (doc.jenis === 'MUTASI_KAS' || doc.document_type === 'MUTASI_KAS') {
      return false;
    }

    const pov = doc.audience_pov;
    if (pov === 'KONTRAKTOR') {
      return false;
    }

    if (doc.jenis === 'GABUNGAN_PROYEK' || doc.document_type === 'GABUNGAN_PROYEK') {
      // Laporan gabungan hanya terlihat oleh Klien jika memang ditujukan untuk KLIEN / UMUM
      return pov === 'KLIEN' || pov === 'UMUM';
    }

    // Dokumen stok/fisik (MUTASI_STOK) diperbolehkan kecuali secara eksplisit dikunci KONTRAKTOR
    return true;
  });
}

/**
 * Agregator Tunggal Lintas Modul — Segitiga Emas Kontrol Proyek
 * Menggabungkan Mutasi Barang + Master BOQ + Stok Gudang + Mutasi Dana + Album Nota + Dokumen Resmi + slot modul Tahap 2-3.
 */
export function buildIntegratedProjectReport(params: {
  activeRole: ImpersonateRole;
  canViewFinancials: boolean;
  items: ItemBarang[];
  physicalMaterials: PhysicalMaterialItem[];
  stockMutations: MutasiBarang[];
  cashMutations: MutasiKas[];
  projectReceipts: ProjectReceipt[];
  documents: DokumenLaporan[];
  branding: { projectName?: string; contractorName?: string; clientName?: string };
  externalContributions?: ProjectModuleContribution[];
}): IntegratedProjectReportData {
  const {
    activeRole,
    canViewFinancials,
    items,
    physicalMaterials,
    stockMutations,
    cashMutations,
    projectReceipts,
    documents,
    branding,
    externalContributions = [],
  } = params;

  const contractorName = branding.contractorName?.trim() || 'Kontraktor';
  const clientName = branding.clientName?.trim() || 'Klien';
  const projectName = branding.projectName?.trim() || 'Proyek Aktif';

  const isClientPov = activeRole === 'Viewer/Pengamat' || !canViewFinancials;
  const partyPov: PartyPOV = isClientPov ? 'KLIEN' : 'KONTRAKTOR';
  const includeFinancials = !isClientPov;

  const boqCtx = resolveEvalContext(activeRole, false, { contractorName, clientName }, partyPov);
  const cashCtx = resolveCashEvalContext(
    activeRole,
    { canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: false },
    { contractorName, clientName },
    includeFinancials
  );

  // 1. Statistik Kontrak & Progres Fisik BOQ
  let paguMaterialRp = 0;
  let paguUpahJasaRp = 0;
  let nilaiJatahKlienRp = 0;

  let tuntasCount = 0;
  let prosesCount = 0;
  let siapPakaiCount = 0;
  let habisKritisCount = 0;
  let belumMasukAtauSerahCount = 0;
  let jatahKlienBelumSerahCount = 0;
  let sumProgressPct = 0;

  const divMap = new Map<
    string,
    { totalPos: number; tuntasPos: number; paguRp: number; progressSum: number }
  >();

  for (const it of items || []) {
    const val = (Number(it.qty_boq) || 0) * (Number(it.harga_satuan) || 0);
    const isClientItem = isClientProvidedRemark(it.keterangan, clientName);

    if (isClientItem) {
      nilaiJatahKlienRp += val;
    } else {
      const catUpper = (it.kategori || '').toUpperCase();
      const isManpower =
        !it.is_stock_item ||
        catUpper.startsWith('IV') ||
        catUpper.includes('JASA') ||
        catUpper.includes('UPAH') ||
        catUpper.includes('MANPOWER');
      if (isManpower) paguUpahJasaRp += val;
      else paguMaterialRp += val;
    }

    const pm = (physicalMaterials || []).find(
      (p) =>
        p.id === it.id ||
        (p.budget_lines && p.budget_lines.some((bl) => bl.id === it.id)) ||
        p.nama_barang === it.nama_barang
    );
    const ev = evaluateBoqPos(it, pm, stockMutations || [], boqCtx);

    if (ev.statusKey === 'TUNTAS' || ev.statusKey === 'LEBIH') {
      tuntasCount += 1;
    } else if (ev.statusKey === 'PROSES') {
      prosesCount += 1;
    } else if (ev.statusKey === 'SIAP_PAKAI') {
      siapPakaiCount += 1;
    } else if (ev.isCriticalShortage || ev.statusKey === 'HABIS') {
      habisKritisCount += 1;
    } else {
      belumMasukAtauSerahCount += 1;
    }

    if (isClientItem && (ev.statusKey === 'BELUM_SERAH' || ev.statusKey === 'BELUM_MASUK' || ev.stateCode === 'S-1' || ev.stateCode === 'S-4')) {
      jatahKlienBelumSerahCount += 1;
    }

    const itemPct =
      (Number(it.qty_boq) || 0) > 0
        ? Math.min(100, ((Number(it.qty_keluar_total) || 0) / Number(it.qty_boq)) * 100)
        : 0;
    sumProgressPct += itemPct;

    const divName = (it.kategori || 'Umum').trim() || 'Umum';
    const curDiv = divMap.get(divName) || {
      totalPos: 0,
      tuntasPos: 0,
      paguRp: 0,
      progressSum: 0,
    };
    curDiv.totalPos += 1;
    if (ev.statusKey === 'TUNTAS' || ev.statusKey === 'LEBIH') {
      curDiv.tuntasPos += 1;
    }
    curDiv.paguRp += includeFinancials ? val : 0;
    curDiv.progressSum += itemPct;
    divMap.set(divName, curDiv);
  }

  const totalPosCount = (items || []).length;
  const serapanFisikPct =
    totalPosCount > 0 ? Math.round((sumProgressPct / totalPosCount) * 10) / 10 : 0;

  const paguKontraktorRp = paguMaterialRp + paguUpahJasaRp;
  const brutoKontrakRp = paguKontraktorRp + nilaiJatahKlienRp;

  const divisionSummaries = Array.from(divMap.entries()).map(([divisionName, d]) => ({
    divisionName,
    totalPos: d.totalPos,
    tuntasPos: d.tuntasPos,
    paguRp: d.paguRp,
    realisasiFisikPct:
      d.totalPos > 0 ? Math.round((d.progressSum / d.totalPos) * 10) / 10 : 0,
  }));

  // 2. Arus Kas, Anggaran & Rekonsiliasi Lintas Modul (Disterilkan untuk POV KLIEN)
  let cashMetrics: CashSummaryMetrics | null = null;
  let budgetCategories: BudgetCategoryEvaluation[] = [];
  let reconciliation: CrossModuleReconciliation | null = null;
  const clientAdvanceSummary = summarizeClientAdvanceReceivables(cashMutations || []);

  if (includeFinancials) {
    cashMetrics = computeCashSummaryMetrics(
      cashMutations || [],
      stockMutations || [],
      projectReceipts || [],
      cashCtx
    );
    budgetCategories = evaluateBudgetCategories(cashMutations || [], items || [], cashCtx);

    // Hitung belanja riil nota gudang (Kontraktor aktif — kecualikan Jatah Klien IMK/KLIEN)
    const materialNotaGudangRp = (stockMutations || [])
      .filter((m) => {
        if (m.jenis !== 'MASUK') return false;
        if (m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') {
          return false;
        }
        if (isClientSuppliedStockMutation(m, clientName)) {
          return false;
        }
        return (Number(m.harga_satuan_beli) || 0) > 0;
      })
      .reduce((sum, m) => sum + (Number(m.harga_satuan_beli) || 0) * (Number(m.jumlah) || 0), 0);

    const unreconciledReceipts = findUnreconciledStockReceipts(
      stockMutations || [],
      projectReceipts || [],
      cashMutations || [],
      clientName
    );
    const selisihNotaBelumDibayarRp = unreconciledReceipts.reduce(
      (sum, r) => sum + r.totalAmountRp,
      0
    );

    const openKasbonList = summarizeOpenKasbon(cashMutations || []);

    const valuasiStokGudangRp = (physicalMaterials || [])
      .filter((pm) => pm.is_stock_item)
      .reduce((sum, pm) => {
        const price =
          pm.harga_beli_rata_rata ||
          pm.harga_beli_terakhir ||
          (pm.total_qty_masuk > 0 && pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0
            ? Math.round(pm.total_nilai_belanja_riil / pm.total_qty_masuk)
            : 0);
        return sum + Math.max(0, pm.stok_fisik || 0) * price;
      }, 0);

    const totalAsetKerjaProyekRp = cashMetrics.saldoSaatIni + valuasiStokGudangRp;

    // Ringkasan kontribusi per modul ekosistem (Unified Module Link)
    const activeCash = (cashMutations || []).filter((c) => !isCashRowExcluded(c));
    const allModules: Array<{ code: ProjectModuleCode; status: 'AKTIF' | 'TAHAP_LANJUT' }> = [
      { code: 'KAS_LANGSUNG', status: 'AKTIF' },
      { code: 'MUTASI_BARANG', status: 'AKTIF' },
      { code: 'PO_PENGADAAN', status: 'TAHAP_LANJUT' },
      { code: 'UPAH_MANDOR', status: 'TAHAP_LANJUT' },
      { code: 'TERMIN_BAP', status: 'TAHAP_LANJUT' },
      { code: 'SUBKON_ALAT', status: 'TAHAP_LANJUT' },
    ];

    const extByCode = new Map(externalContributions.map((ec) => [ec.moduleCode, ec]));

    const moduleContributions: ProjectModuleContribution[] = allModules.map(({ code, status }) => {
      const ext = extByCode.get(code);
      if (ext) return ext;

      const modCash = activeCash.filter((c) => (c.source_module || 'KAS_LANGSUNG') === code);
      const totalInRp = modCash
        .filter((c) => c.jenis === 'MASUK')
        .reduce((s, c) => s + (Number(c.jumlah_rp) || 0), 0);
      const totalOutRp = modCash
        .filter((c) => c.jenis === 'KELUAR')
        .reduce((s, c) => s + (Number(c.jumlah_rp) || 0), 0);
      const pendingCount =
        code === 'MUTASI_BARANG'
          ? unreconciledReceipts.length
          : code === 'KAS_LANGSUNG'
          ? cashMetrics!.openKasbonCount + cashMetrics!.pendingReceiptCount
          : 0;

      return {
        moduleCode: code,
        moduleLabel: SOURCE_MODULE_LABELS[code],
        status,
        transactionCount: modCash.length,
        totalInRp,
        totalOutRp,
        pendingCount,
      };
    });

    reconciliation = {
      materialNotaGudangRp,
      materialKasKeluarRp: cashMetrics.totalKeluarMaterial,
      selisihNotaBelumDibayarRp,
      unreconciledReceipts,
      openKasbonList,
      clientAdvanceSummary,
      valuasiStokGudangRp,
      totalAsetKerjaProyekRp,
      moduleContributions,
    };
  }

  // 3. Indeks Bukti Nota Aktif (disaring aman dari KAS_OPERASIONAL saat POV KLIEN)
  const receiptIndex = (projectReceipts || []).filter((rc) => {
    if (rc.is_batal || rc.is_ganti || rc.status_verifikasi === 'BATAL' || rc.status_verifikasi === 'DIGANTI') {
      return false;
    }
    if (partyPov === 'KLIEN') {
      return false; // Nota belanja toko & kuitansi kas internal tidak dibuka ke Klien
    }
    return true;
  });

  // 4. Ringkasan Dokumen Resmi (tersaring ketat lewat filterDocumentsForPov)
  const visibleDocs = filterDocumentsForPov(documents || [], partyPov).filter(
    (d) => !d.is_batal && !d.is_ganti && d.status_dokumen !== 'BATAL' && d.status_dokumen !== 'DIGANTI'
  );
  const sahDocs = visibleDocs.filter((d) => d.status_dokumen === 'MENGETAHUI' || d.status === 'SIGNED');
  const pendingDocs = visibleDocs.filter(
    (d) => d.status_dokumen !== 'MENGETAHUI' && d.status !== 'SIGNED'
  );

  // Sanitasi ringkasan tagihan talangan klien untuk POV KLIEN agar saldo kas internal kontraktor (saldo_setelah) & metadata toko tidak pernah bocor
  const safeClientClaimSummary: ClientAdvanceReceivableSummary | null =
    clientAdvanceSummary.totalTalanganRp > 0
      ? includeFinancials
        ? clientAdvanceSummary
        : {
            ...clientAdvanceSummary,
            transactions: clientAdvanceSummary.transactions.map((t) => ({
              ...t,
              saldo_setelah: 0,
              nama_toko: undefined,
              toko_kontak: undefined,
              catatan: undefined,
              lampiran_nota_urls: [],
            })),
          }
      : null;

  return {
    generatedAt: new Date().toISOString(),
    partyPov,
    includeFinancials,
    projectName,
    contractorName,
    clientName,
    contractStats: {
      paguKontraktorRp: includeFinancials ? paguKontraktorRp : 0,
      paguMaterialRp: includeFinancials ? paguMaterialRp : 0,
      paguUpahJasaRp: includeFinancials ? paguUpahJasaRp : 0,
      nilaiJatahKlienRp: includeFinancials ? nilaiJatahKlienRp : 0,
      brutoKontrakRp: includeFinancials ? brutoKontrakRp : 0,
    },
    physicalProgress: {
      totalPosCount,
      tuntasCount,
      prosesCount,
      siapPakaiCount,
      habisKritisCount,
      belumMasukAtauSerahCount,
      serapanFisikPct,
      jatahKlienBelumSerahCount,
    },
    cashMetrics,
    budgetCategories,
    reconciliation,
    clientClaimSummary: safeClientClaimSummary,
    divisionSummaries,
    receiptIndex,
    officialDocumentsSummary: {
      totalDocs: visibleDocs.length,
      sahTteCount: sahDocs.length,
      pendingApprovalCount: pendingDocs.length,
      latestApprovedDoc: sahDocs[0],
    },
  };
}
