import React, { useState, useMemo, useEffect, useDeferredValue, startTransition } from 'react';
import { useApp, CashflowTabKey } from '../context/AppContext';
import {
  CashOutCategory,
  DokumenLaporan,
  ImpersonateRole,
  JenisMutasiKas,
  KategoriMutasiKas,
  MetodePembayaran,
  MutasiBarang,
  MutasiKas,
  ReceiptScope,
  StatusDokumenWorkflow,
} from '../types';
import {
  WalletCards,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  FileCheck2,
  Ban,
  FileEdit,
  Clock,
  ShieldCheck,
  Eye,
  History,
  FileText,
  ArrowUpDown,
  ArrowLeft,
  Link2,
  Paperclip,
  Images,
  ClipboardCheck,
  Sparkles,
  BookOpen,
  ChevronDown,
  ChevronUp,
  RotateCcw,
  Bell,
  Camera,
  X,
  Building2,
  CreditCard,
  Coins,
  Briefcase,
} from 'lucide-react';
import { CurrencyInput } from './CurrencyInput';
import { formatRupiah, formatDateTime, generateCashflowPDF } from '../lib/pdfGenerator';
import {
  ExportSettingsModal,
  ExportSettingsConfig,
  CashExportPresetKey,
} from './ExportSettingsModal';
import { CashMutationWizardModal } from './CashMutationWizardModal';
import { ReceiptViewerModal } from './ReceiptViewerModal';
import { ProjectReceiptAlbumModal } from './ProjectReceiptAlbumModal';
import {
  BEBAN_BIAYA_LABELS,
  CASH_IN_CATEGORIES,
  CASH_OUT_CATEGORIES,
  computeRunningCashBalances,
  evaluateBudgetCategories,
  evaluateCashRow,
  findUnreconciledStockReceipts,
  getCashActionVariantClass,
  getPendingApprovalForRole,
  isCashRowExcluded,
  OpenKasbonItem,
  PAYMENT_METHOD_LABELS,
  planKasbonSettlement,
  resolveCashEvalContext,
  SOURCE_MODULE_LABELS,
  summarizeClientAdvanceReceivables,
  summarizeOpenKasbon,
  UnreconciledStockReceiptItem,
} from '../lib/cashflowEngine';
import {
  buildOccurredAtIso,
  getTodayLocalDate,
  isClientProvidedRemark,
  toLocalDateInput,
} from '../lib/stockMutationEngine';
import { buildProjectReceiptAlbum, createProjectReceipt, uploadReceiptFile } from '../lib/receiptStorage';

interface CashflowViewProps {
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  defaultType?: JenisMutasiKas;
  modalOnly?: boolean;
}

type PeriodFilter = 'ALL' | 'TODAY' | '7D' | '30D' | 'THIS_MONTH';

export const CashflowView: React.FC<CashflowViewProps> = ({
  isModalOpen,
  setIsModalOpen,
  defaultType = 'KELUAR',
  modalOnly = false,
}) => {
  const {
    items,
    stockMutations,
    cashMutations,
    documents,
    projectReceipts,
    refreshData,
    refreshProjectReceipts,
    addCashMutation,
    batalCashMutation,
    gantiCashMutation,
    advanceCashWorkflow,
    lengkapiBuktiCashMutation,
    selesaikanKasbonMutation,
    issueOfficialDocument,
    advanceDocumentWorkflow,
    batalOfficialDocument,
    gantiOfficialDocument,
    currentCashBalance,
    cashSummaryMetrics,
    user,
    cashAccess,
    rolePermissions,
    activeRole,
    setActiveRole,
    activeContext,
    activeProjectId,
    canViewFinancials,
    dataReady,
    tenantBranding,
    setCurrentView,
    goBack,
    cashTargetTab,
    setCashTargetTab,
    setProcurementTargetTab,
  } = useApp();

  // Proteksi Privasi Multi-POV: Pengamat (Klien) tidak boleh mengakses buku besar kas internal
  const isViewer = activeRole === 'Viewer/Pengamat';

  const [activeTab, setActiveTab] = useState<CashflowTabKey>('SUMMARY');

  // Deep-link tab dari Dasbor / Lonceng Header
  useEffect(() => {
    if (cashTargetTab) {
      setActiveTab(cashTargetTab);
      setCashTargetTab(null);
    }
  }, [cashTargetTab, setCashTargetTab]);

  // State Wizard Kontekstual
  const [wizardType, setWizardType] = useState<JenisMutasiKas>(defaultType);
  const [wizardPreselectedCategory, setWizardPreselectedCategory] = useState<KategoriMutasiKas | undefined>(undefined);
  const [wizardPreselectedReceipt, setWizardPreselectedReceipt] = useState<UnreconciledStockReceiptItem | null>(null);
  const [wizardPreselectedAmount, setWizardPreselectedAmount] = useState<number | undefined>(undefined);
  const [wizardPreselectedPurpose, setWizardPreselectedPurpose] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (defaultType && !wizardPreselectedReceipt) {
      setWizardType(defaultType);
    }
  }, [defaultType]);

  // Filter & Pencarian Tab 3 (Jurnal Transaksi Kas)
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearch = useDeferredValue(searchQuery);
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');
  const [filterMethod, setFilterMethod] = useState<'ALL' | MetodePembayaran>('ALL');
  const [filterPeriod, setFilterPeriod] = useState<PeriodFilter>('ALL');
  const [filterSpecial, setFilterSpecial] = useState<'NONE' | 'PENDING_RECEIPT' | 'PENDING_APPROVAL'>('NONE');
  const [sortField, setSortField] = useState<'tanggal' | 'nominal' | 'untuk_apa'>('tanggal');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showGovernanceGuide, setShowGovernanceGuide] = useState(false);

  // Seleksi Kolektif & Sorot Baris Navigasi Pengganti
  const [selectedRowIds, setSelectedRowIds] = useState<string[]>([]);
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

  // State Notifikasi & Galat
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Modal Rincian / Riwayat / Koreksi
  const [detailTarget, setDetailTarget] = useState<MutasiKas | null>(null);

  // Modal Konfirmasi Pengaman TTE atas Bukti Menyusul
  const [tteConfirmTarget, setTteConfirmTarget] = useState<MutasiKas | null>(null);

  // Modal Batal & Ganti Kas (mempertahankan tanggal asli!)
  const [batalTarget, setBatalTarget] = useState<MutasiKas | null>(null);
  const [batalReason, setBatalReason] = useState('');
  const [gantiTarget, setGantiTarget] = useState<MutasiKas | null>(null);
  const [gantiReason, setGantiReason] = useState('');
  const [gantiJenis, setGantiJenis] = useState<JenisMutasiKas>('KELUAR');
  const [gantiAmount, setGantiAmount] = useState<number>(0);
  const [gantiDate, setGantiDate] = useState<string>(getTodayLocalDate());
  const [gantiPurpose, setGantiPurpose] = useState('');
  const [gantiCategory, setGantiCategory] = useState<KategoriMutasiKas>('Material');
  const [gantiPic, setGantiPic] = useState('');
  const [gantiStore, setGantiStore] = useState('');
  const [gantiMethod, setGantiMethod] = useState<MetodePembayaran>('TUNAI');
  const [gantiReceiptNo, setGantiReceiptNo] = useState('');
  const [gantiNotes, setGantiNotes] = useState('');

  // Modal Lengkapi Bukti (tunggal maupun kolektif)
  const [proofTargets, setProofTargets] = useState<MutasiKas[]>([]);
  const [proofReceiptNo, setProofReceiptNo] = useState('');
  const [proofStoreName, setProofStoreName] = useState('');
  const [proofDate, setProofDate] = useState(getTodayLocalDate());
  const [proofUrls, setProofUrls] = useState<string[]>([]);
  const [proofNotes, setProofNotes] = useState('');
  const [proofUploading, setProofUploading] = useState(false);

  // Modal Pertanggungjawaban (LPJ) Panjar 3 Skenario
  const [lpjTarget, setLpjTarget] = useState<OpenKasbonItem | null>(null);
  const [lpjSpentRp, setLpjSpentRp] = useState<number>(0);
  const [lpjCategory, setLpjCategory] = useState<CashOutCategory>('Upah & Konsumsi');
  const [lpjIsPartial, setLpjIsPartial] = useState<boolean>(false);
  const [lpjPartialReturnRp, setLpjPartialReturnRp] = useState<number>(0);
  const [lpjDate, setLpjDate] = useState<string>(getTodayLocalDate());
  const [lpjMethod, setLpjMethod] = useState<MetodePembayaran>('TUNAI');
  const [lpjReceiptNo, setLpjReceiptNo] = useState('');
  const [lpjNotes, setLpjNotes] = useState('');
  const [lpjUrls, setLpjUrls] = useState<string[]>([]);
  const [lpjUploading, setLpjUploading] = useState(false);

  // Modal Viewer HD & Album Kuitansi Proyek
  const [isAlbumOpen, setIsAlbumOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPrimaryStock, setViewerPrimaryStock] = useState<MutasiBarang | null>(null);
  const [viewerRelatedStock, setViewerRelatedStock] = useState<MutasiBarang[]>([]);
  const [viewerPrimaryCash, setViewerPrimaryCash] = useState<MutasiKas | null>(null);
  const [viewerRelatedCash, setViewerRelatedCash] = useState<MutasiKas[]>([]);
  const [viewerScope, setViewerScope] = useState<ReceiptScope | undefined>(undefined);

  // Modal Ekspor PDF Kas
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [exportInitialPreset, setExportInitialPreset] = useState<CashExportPresetKey | undefined>(undefined);
  const [isExportingCash, setIsExportingCash] = useState(false);

  // State Tab 4: Dokumen Resmi Kas (TTE/QR)
  const [docTitle, setDocTitle] = useState('Berita Acara Rekapitulasi Arus Kas & Mutasi Dana');
  const [docPeriode, setDocPeriode] = useState(() =>
    new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
  );
  const [docSortDir, setDocSortDir] = useState<'desc' | 'asc'>('desc');
  const [batalDocTargetId, setBatalDocTargetId] = useState<string | null>(null);
  const [batalDocReason, setBatalDocReason] = useState('');
  const [gantiDocTargetId, setGantiDocTargetId] = useState<string | null>(null);
  const [gantiDocTitle, setGantiDocTitle] = useState('');
  const [gantiDocReason, setGantiDocReason] = useState('');

  // Konteks Evaluasi Engine Tunggal
  const cashEvalContext = useMemo(
    () =>
      resolveCashEvalContext(
        activeRole,
        rolePermissions,
        { contractorName: tenantBranding.contractorName, clientName: tenantBranding.clientName },
        canViewFinancials
      ),
    [activeRole, rolePermissions, tenantBranding.contractorName, tenantBranding.clientName, canViewFinancials]
  );

  // Running balances (single source of truth)
  const runningBalances = useMemo(() => computeRunningCashBalances(cashMutations), [cashMutations]);

  // 8 Pos Anggaran (Tab 1)
  const budgetCategories = useMemo(
    () => evaluateBudgetCategories(cashMutations, items, cashEvalContext),
    [cashMutations, items, cashEvalContext]
  );

  // Total Pagu Kontrak BOQ Kontraktor & Belanja Nota Gudang untuk Kartu KPI 3
  const contractAndWarehouseTotals = useMemo(() => {
    const paguBoqKontraktor = budgetCategories.reduce((s, b) => s + b.paguAcuanRp, 0);
    const belanjaNotaGudang = (stockMutations || [])
      .filter(
        (m) =>
          m.jenis === 'MASUK' &&
          !m.is_batal &&
          !m.is_ganti &&
          m.status_dokumen !== 'BATAL' &&
          m.status_dokumen !== 'DIGANTI' &&
          m.owner_type !== 'KLIEN' &&
          m.owner_type !== 'IMK' &&
          m.status_harga !== 'JATAH_KLIEN' &&
          !isClientProvidedRemark(m.source_name, tenantBranding.clientName) &&
          (Number(m.harga_satuan_beli) || 0) > 0
      )
      .reduce((s, m) => s + (Number(m.harga_satuan_beli) || 0) * (Number(m.jumlah) || 0), 0);
    const serapanKontrakPct =
      paguBoqKontraktor > 0
        ? Math.round((cashSummaryMetrics.totalKeluarAktif / paguBoqKontraktor) * 1000) / 10
        : 0;
    return { paguBoqKontraktor, belanjaNotaGudang, serapanKontrakPct };
  }, [budgetCategories, stockMutations, cashSummaryMetrics.totalKeluarAktif, tenantBranding.clientName]);

  // Tab 2: Antrean Nota Gudang Belum Dibayar, Panjar Terbuka, Piutang Talangan Klien
  const unreconciledReceipts = useMemo(
    () =>
      findUnreconciledStockReceipts(
        stockMutations,
        projectReceipts,
        cashMutations,
        tenantBranding.clientName
      ),
    [stockMutations, projectReceipts, cashMutations, tenantBranding.clientName]
  );

  const openKasbonList = useMemo(() => summarizeOpenKasbon(cashMutations), [cashMutations]);
  const clientAdvanceSummary = useMemo(
    () => summarizeClientAdvanceReceivables(cashMutations),
    [cashMutations]
  );

  // Album Kuitansi & Nota Proyek Terpadu
  const projectAlbumItems = useMemo(
    () => buildProjectReceiptAlbum(stockMutations, projectReceipts, cashMutations, tenantBranding.clientName),
    [stockMutations, projectReceipts, cashMutations, tenantBranding.clientName]
  );

  // Pratinjau Real-time LPJ Panjar (termasuk pengembalian tunai sebelumnya agar bebas double-return)
  const lpjPreviewPlan = useMemo(() => {
    if (!lpjTarget) return null;
    return planKasbonSettlement({
      kasbonTx: lpjTarget.kasbonTx,
      realSpentRp: lpjSpentRp,
      lpjCategory,
      isPartial: lpjIsPartial,
      returnedCashRp: lpjPartialReturnRp,
      previousReturnedRp: lpjTarget.nominalKembaliRp,
      settlementDate: buildOccurredAtIso(lpjDate),
      paymentMethod: lpjMethod,
      notes: lpjNotes,
      receiptNo: lpjReceiptNo,
      attachmentUrls: lpjUrls,
    });
  }, [lpjTarget, lpjSpentRp, lpjCategory, lpjIsPartial, lpjPartialReturnRp, lpjDate, lpjMethod, lpjNotes, lpjReceiptNo, lpjUrls]);

  // Penugasan jabatan user di proyek aktif (untuk Ganti Jabatan Cepat hanya jika > 1)
  const userAssignments = useMemo(() => {
    const all = activeContext?.projects || [];
    const curId = activeProjectId || tenantBranding.projectId;
    return curId ? all.filter((p) => p.id === curId) : all;
  }, [activeContext?.projects, activeProjectId, tenantBranding.projectId]);

  const mapRoleCode = (code?: string): ImpersonateRole => {
    const u = (code || '').toUpperCase();
    if (u === 'CLERK') return 'Clerk';
    if (u === 'FOREMAN') return 'Foreman';
    if (u === 'SUPERVISOR' || u === 'SPV') return 'Spv.';
    if (u === 'DEPT_MANAGER' || u === 'MANAGER') return 'Dept. Manager';
    if (u === 'KTT_PM' || u === 'PM') return 'KTT/Proj. Manager';
    if (u === 'CEO' || u === 'DIRECTOR' || u === 'DIREKTUR') return 'CEO/Direktur';
    if (u === 'VIEWER' || u === 'PENGAMAT') return 'Viewer/Pengamat';
    return 'Clerk';
  };

  // Filter & Sortir Tab 3 Jurnal Kas
  const filteredCashList = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const now = new Date();
    const todayIso = getTodayLocalDate();

    return cashMutations.filter((c) => {
      if (filterType !== 'ALL' && c.jenis !== filterType) return false;
      if (filterCategory !== 'ALL' && c.kategori_keperluan !== filterCategory) return false;
      if (filterMethod !== 'ALL' && (c.payment_method || 'TUNAI') !== filterMethod) return false;

      if (filterPeriod !== 'ALL' && c.tanggal) {
        const txDate = new Date(c.tanggal);
        const txLocal = toLocalDateInput(c.tanggal);
        if (filterPeriod === 'TODAY' && txLocal !== todayIso) return false;
        if (filterPeriod === '7D' && now.getTime() - txDate.getTime() > 7 * 86_400_000) return false;
        if (filterPeriod === '30D' && now.getTime() - txDate.getTime() > 30 * 86_400_000) return false;
        if (
          filterPeriod === 'THIS_MONTH' &&
          (txDate.getFullYear() !== now.getFullYear() || txDate.getMonth() !== now.getMonth())
        ) {
          return false;
        }
      }

      if (filterSpecial === 'PENDING_RECEIPT') {
        if (isCashRowExcluded(c) || c.status_bukti !== 'BUKTI_MENYUSUL') return false;
      } else if (filterSpecial === 'PENDING_APPROVAL') {
        if (isCashRowExcluded(c)) return false;
        if (cashEvalContext.authority === 'PENGAWAS_INTERNAL') {
          if (!getPendingApprovalForRole(c.status_dokumen, activeRole)) return false;
        } else {
          if (c.status_dokumen === 'MENGETAHUI') return false;
        }
      }

      if (q) {
        const hay = [
          c.untuk_apa,
          c.pic,
          c.nama_toko,
          c.nomor_kuitansi,
          c.catatan,
          c.kategori_keperluan,
          c.source_entity_no,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [
    cashMutations,
    deferredSearch,
    filterType,
    filterCategory,
    filterMethod,
    filterPeriod,
    filterSpecial,
    cashEvalContext.authority,
    activeRole,
  ]);

  const sortedCashList = useMemo(() => {
    const list = [...filteredCashList];
    list.sort((a, b) => {
      if (sortField === 'tanggal') {
        const tA = new Date(a.tanggal).getTime();
        const tB = new Date(b.tanggal).getTime();
        return sortDir === 'asc' ? tA - tB : tB - tA;
      }
      if (sortField === 'nominal') {
        return sortDir === 'asc' ? a.jumlah_rp - b.jumlah_rp : b.jumlah_rp - a.jumlah_rp;
      }
      return sortDir === 'asc'
        ? (a.untuk_apa || '').localeCompare(b.untuk_apa || '')
        : (b.untuk_apa || '').localeCompare(a.untuk_apa || '');
    });
    return list;
  }, [filteredCashList, sortField, sortDir]);

  // Tab 4: Dokumen Resmi Kas
  const cashDocuments = useMemo(() => {
    const list = (documents || []).filter((d) => d.jenis === 'MUTASI_KAS');
    return [...list].sort((a, b) => {
      const tA = new Date(a.dibuat_pada).getTime();
      const tB = new Date(b.dibuat_pada).getTime();
      return docSortDir === 'desc' ? tB - tA : tA - tB;
    });
  }, [documents, docSortDir]);

  // Handler Pembuka Wizard
  const openWizard = (opts: {
    jenis: JenisMutasiKas;
    category?: KategoriMutasiKas;
    receipt?: UnreconciledStockReceiptItem | null;
    amount?: number;
    purpose?: string;
  }) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan ${activeRole} tidak berwenang mencatat transaksi baru. Penerbitan transaksi dilakukan oleh Clerk.`);
      return;
    }
    setWizardType(opts.jenis);
    setWizardPreselectedCategory(opts.category);
    setWizardPreselectedReceipt(opts.receipt || null);
    setWizardPreselectedAmount(opts.amount);
    setWizardPreselectedPurpose(opts.purpose);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  // Lompat ke Baris Pengganti (2-arah)
  const jumpToRow = (targetId: string) => {
    setActiveTab('JOURNAL');
    setSearchQuery('');
    setFilterType('ALL');
    setFilterCategory('ALL');
    setFilterMethod('ALL');
    setFilterPeriod('ALL');
    setFilterSpecial('NONE');
    setHighlightedRowId(targetId);
    setTimeout(() => {
      const el = document.getElementById(`cash-row-${targetId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    setTimeout(() => setHighlightedRowId(null), 4000);
  };

  // Cari baris pengganti dari baris DIGANTI
  const findReplacementRow = (replacedRow: MutasiKas): MutasiKas | undefined => {
    if (replacedRow.referensi_ganti_id) {
      const direct = cashMutations.find((c) => c.id === replacedRow.referensi_ganti_id);
      if (direct) return direct;
    }
    return cashMutations.find((c) => c.referensi_ganti_id === replacedRow.id);
  };

  // Buka Viewer HD untuk baris kas atau nota gudang
  const openReceiptViewerForCash = (tx: MutasiKas) => {
    const relatedCash = tx.receipt_id
      ? cashMutations.filter((c) => c.receipt_id === tx.receipt_id && !isCashRowExcluded(c))
      : [tx];
    const relatedStock = tx.receipt_id
      ? stockMutations.filter((m) => m.receipt_id === tx.receipt_id && !m.is_batal && !m.is_ganti)
      : [];
    const rc = tx.receipt_id ? projectReceipts.find((r) => r.id === tx.receipt_id) : undefined;
    setViewerPrimaryCash(tx);
    setViewerRelatedCash(relatedCash.length > 0 ? relatedCash : [tx]);
    setViewerPrimaryStock(relatedStock[0] || null);
    setViewerRelatedStock(relatedStock);
    setViewerScope(rc?.receipt_scope || (relatedStock.length > 0 ? 'TERPADU' : 'KAS_OPERASIONAL'));
    setViewerOpen(true);
  };

  const openReceiptViewerForStockQueue = (item: UnreconciledStockReceiptItem) => {
    const relatedStock = stockMutations.filter(
      (m) =>
        !m.is_batal &&
        !m.is_ganti &&
        ((item.receiptId && m.receipt_id === item.receiptId) ||
          (m.nomor_nota && m.nomor_nota.toLowerCase() === item.receiptNo.toLowerCase()))
    );
    const primaryStock: MutasiBarang = relatedStock[0] || {
      id: item.key,
      barang_id: '',
      nama_barang: item.itemSummary,
      jenis: 'MASUK',
      jumlah: item.itemCount,
      satuan: 'item',
      tujuan_keperluan: 'Nota Belanja Gudang',
      pic_penerima_penyerah: '-',
      tanggal: item.receiptDate,
      stok_sebelum: 0,
      stok_sesudah: 0,
      nomor_nota: item.receiptNo,
      nama_toko: item.storeName,
      total_nota_fisik: item.totalAmountRp,
      lampiran_nota_urls: item.attachmentUrls,
      receipt_id: item.receiptId,
    };
    setViewerPrimaryStock(primaryStock);
    setViewerRelatedStock(relatedStock.length > 0 ? relatedStock : [primaryStock]);
    setViewerPrimaryCash(null);
    setViewerRelatedCash([]);
    setViewerScope('BELANJA_BARANG');
    setViewerOpen(true);
  };

  // Eksekusi Persetujuan Serial Baris Kas (dengan pengaman TTE atas Bukti Menyusul)
  const handleRowApproval = async (tx: MutasiKas, nextStatus: 'DIPERIKSA' | 'DISETUJUI' | 'MENGETAHUI') => {
    if (nextStatus === 'MENGETAHUI' && tx.status_bukti === 'BUKTI_MENYUSUL') {
      setTteConfirmTarget(tx);
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceCashWorkflow(tx.id, nextStatus);
      if (res.success) setNoticeMessage(res.message);
      else setErrorMessage(res.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmTteWithoutProof = async () => {
    if (!tteConfirmTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceCashWorkflow(tteConfirmTarget.id, 'MENGETAHUI');
      if (res.success) {
        setNoticeMessage(res.message);
        setTteConfirmTarget(null);
      } else {
        setErrorMessage(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Buka Modal Ganti Kas (wajib mempertahankan tanggal asli!)
  const handleOpenGanti = (tx: MutasiKas) => {
    setDetailTarget(null);
    setGantiTarget(tx);
    setGantiReason('');
    setGantiJenis(tx.jenis);
    setGantiAmount(tx.jumlah_rp);
    setGantiDate(toLocalDateInput(tx.tanggal));
    setGantiPurpose(tx.untuk_apa || '');
    setGantiCategory(tx.kategori_keperluan);
    setGantiPic(tx.pic || user.name);
    setGantiStore(tx.nama_toko || '');
    setGantiMethod(tx.payment_method || 'TUNAI');
    setGantiReceiptNo(tx.nomor_kuitansi || '');
    setGantiNotes(tx.catatan || '');
  };

  const handleConfirmGanti = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const originalDateInput = toLocalDateInput(gantiTarget.tanggal);
      const preservedIso =
        gantiDate === originalDateInput ? gantiTarget.tanggal : buildOccurredAtIso(gantiDate);

      const res = await gantiCashMutation(
        gantiTarget.id,
        {
          jenis: gantiJenis,
          jumlah_rp: gantiAmount,
          untuk_apa: gantiPurpose,
          kategori_keperluan: gantiCategory,
          pic: gantiPic,
          nama_toko: gantiStore.trim() || undefined,
          payment_method: gantiMethod,
          nomor_kuitansi: gantiReceiptNo.trim() || undefined,
          tanggal: preservedIso,
          catatan: gantiNotes.trim() || undefined,
        },
        gantiReason
      );
      if (res.success) {
        setNoticeMessage(res.message);
        setGantiTarget(null);
        setGantiReason('');
      } else {
        setErrorMessage(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmBatal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalCashMutation(batalTarget.id, batalReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalTarget(null);
        setBatalReason('');
      } else {
        setErrorMessage(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Buka Modal Lengkapi Bukti (1 baris atau seleksi kolektif)
  const openProofModal = (targets: MutasiKas[]) => {
    if (targets.length === 0) return;
    const first = targets[0];
    setProofTargets(targets);
    setProofReceiptNo(first.nomor_kuitansi || '');
    setProofStoreName(first.nama_toko || '');
    setProofDate(toLocalDateInput(first.tanggal));
    setProofUrls(first.lampiran_nota_urls ? [...first.lampiran_nota_urls] : []);
    setProofNotes(first.catatan || '');
  };

  const handleUploadBatchProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    setProofUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files.slice(0, Math.max(0, 5 - proofUrls.length))) {
        const url = await uploadReceiptFile(
          file,
          activeProjectId || tenantBranding.projectId || '',
          proofReceiptNo || 'bukti_kas'
        );
        uploaded.push(url);
      }
      setProofUrls((prev) => [...prev, ...uploaded].slice(0, 5));
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengunggah berkas bukti.');
    } finally {
      setProofUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmitProofCompletion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (proofTargets.length === 0 || submitting) return;
    if (proofUrls.length === 0 && !proofReceiptNo.trim()) {
      setErrorMessage('Unggah minimal 1 foto/PDF kuitansi atau isi nomor kuitansi sah.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const prId = activeProjectId || tenantBranding.projectId;
      let sharedReceiptId: string | undefined;
      if (proofUrls.length > 0 && prId) {
        const totalPhysical = proofTargets.reduce((s, t) => s + (Number(t.jumlah_rp) || 0), 0);
        const created = await createProjectReceipt(
          {
            project_id: prId,
            reference_no: proofReceiptNo.trim(),
            nama_toko: proofStoreName.trim(),
            tanggal_nota: proofDate,
            total_nota_fisik: totalPhysical,
            lampiran_nota_urls: proofUrls,
            notes: proofNotes.trim() || `Bukti kuitansi ${proofTargets.length} transaksi kas`,
            receipt_scope: 'KAS_OPERASIONAL',
            created_by: user.id || undefined,
            created_by_name: `${user.name} (${activeRole})`,
          },
          proofTargets[0]?.pic || user.name
        );
        sharedReceiptId = created?.id;
      }

      for (const target of proofTargets) {
        const res = await lengkapiBuktiCashMutation(target, {
          nomor_kuitansi: proofReceiptNo.trim() || target.nomor_kuitansi,
          nama_toko: proofStoreName.trim() || target.nama_toko,
          tanggal_nota: proofDate,
          lampiran_nota_urls: proofUrls,
          receipt_id: sharedReceiptId,
          catatan: proofNotes.trim() || target.catatan,
          reason: 'Melengkapi foto bukti kuitansi transaksi kas',
        });
        if (!res.success) {
          setErrorMessage(res.message);
          return;
        }
      }

      setNoticeMessage(`Bukti kuitansi untuk ${proofTargets.length} transaksi kas berhasil dilengkapi!`);
      setProofTargets([]);
      setSelectedRowIds([]);
    } finally {
      setSubmitting(false);
    }
  };

  // Buka Modal LPJ Panjar
  const openLpjModal = (item: OpenKasbonItem) => {
    setLpjTarget(item);
    setLpjSpentRp(item.sisaTerbukaRp);
    setLpjCategory('Upah & Konsumsi');
    setLpjIsPartial(false);
    setLpjPartialReturnRp(0);
    setLpjDate(getTodayLocalDate());
    setLpjMethod('TUNAI');
    setLpjReceiptNo('');
    setLpjNotes('');
    setLpjUrls([]);
  };

  const handleUploadLpjFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;
    setLpjUploading(true);
    try {
      const uploaded: string[] = [];
      for (const file of files.slice(0, Math.max(0, 5 - lpjUrls.length))) {
        const url = await uploadReceiptFile(
          file,
          activeProjectId || tenantBranding.projectId || '',
          lpjReceiptNo || 'lpj_panjar'
        );
        uploaded.push(url);
      }
      setLpjUrls((prev) => [...prev, ...uploaded].slice(0, 5));
    } finally {
      setLpjUploading(false);
      e.target.value = '';
    }
  };

  const handleConfirmLpj = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lpjTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await selesaikanKasbonMutation({
        kasbonTx: lpjTarget.kasbonTx,
        realSpentRp: lpjSpentRp,
        lpjCategory,
        isPartial: lpjIsPartial,
        returnedCashRp: lpjPartialReturnRp,
        previousReturnedRp: lpjTarget.nominalKembaliRp,
        settlementDate: buildOccurredAtIso(lpjDate),
        paymentMethod: lpjMethod,
        notes: lpjNotes,
        receiptNo: lpjReceiptNo,
        attachmentUrls: lpjUrls,
      });
      if (res.success) {
        setNoticeMessage(res.message);
        setLpjTarget(null);
      } else {
        setErrorMessage(res.message);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Ekspor PDF Kas
  const handleConfirmExportCash = async (config: ExportSettingsConfig) => {
    await new Promise((resolve) => setTimeout(resolve, 40));
    try {
      setIsExportingCash(true);
      const docId = `KAS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

      let cashToExport = [...cashMutations];
      if (config.filterScope.onlyActive) {
        cashToExport = cashToExport.filter((c) => !isCashRowExcluded(c));
      }
      if (config.filterScope.transactionType === 'MASUK') {
        cashToExport = cashToExport.filter((c) => c.jenis === 'MASUK');
      } else if (config.filterScope.transactionType === 'KELUAR') {
        cashToExport = cashToExport.filter((c) => c.jenis === 'KELUAR');
      }
      if (config.filterScope.onlyKasbon) {
        cashToExport = cashToExport.filter(
          (c) => c.is_kasbon || c.kategori_keperluan === 'Panjar / Kasbon' || Boolean(c.kasbon_induk_id)
        );
      }
      if (config.filterScope.onlyClientClaim) {
        cashToExport = cashToExport.filter(
          (c) =>
            c.beban_biaya === 'KLIEN' ||
            c.kategori_keperluan === 'Talangan Klien' ||
            c.kategori_keperluan === 'Penggantian Talangan Klien'
        );
      }
      if (config.filterScope.onlyPendingReceipt) {
        cashToExport = cashToExport.filter((c) => c.status_bukti === 'BUKTI_MENYUSUL');
      }

      if (config.sortConfig.key !== 'default') {
        const dirMul = config.sortConfig.dir === 'desc' ? -1 : 1;
        cashToExport.sort((a, b) => {
          if (config.sortConfig.key === 'tanggal')
            return (new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime()) * dirMul;
          if (config.sortConfig.key === 'jumlah_rp') return (a.jumlah_rp - b.jumlah_rp) * dirMul;
          if (config.sortConfig.key === 'kategori_keperluan')
            return (a.kategori_keperluan || '').localeCompare(b.kategori_keperluan || '') * dirMul;
          return 0;
        });
      }

      const dates = cashToExport
        .map((c) => (c.tanggal ? new Date(c.tanggal).getTime() : NaN))
        .filter((t) => !Number.isNaN(t));
      const today = getTodayLocalDate();
      const startDate = dates.length > 0 ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : today;
      const endDate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : today;

      await generateCashflowPDF({
        docId,
        startDate,
        endDate,
        cashMutations: cashToExport,
        signer: user,
        projectName: tenantBranding.projectName,
        branding: tenantBranding,
        filterSummary: `${cashToExport.length} transaksi terpilih`,
        customTitle: config.customTitle,
        customNotes: config.customNotes,
        selectedColumns: config.selectedColumns,
        orientation: config.orientation,
        hideRunningBalance: Boolean(config.filterScope.hideRunningBalance || config.filterScope.onlyClientClaim),
      });
      setNoticeMessage(`PDF Buku Kas (${cashToExport.length} baris · ${config.selectedColumns.length} kolom) berhasil diunduh.`);
    } catch (err: any) {
      setErrorMessage('Gagal mengunduh PDF Kas: ' + (err?.message || 'Kesalahan sistem'));
    } finally {
      setIsExportingCash(false);
    }
  };

  // Tab 4: Dokumen Resmi Kas
  const handleIssueCashDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!docTitle.trim()) {
      setErrorMessage('Judul Berita Acara Arus Kas wajib diisi.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await issueOfficialDocument({
        jenis: 'MUTASI_KAS',
        judul: docTitle.trim(),
        periode: docPeriode.trim() || 'Periode Berjalan',
        ringkasan: `Masuk: ${formatRupiah(cashSummaryMetrics.totalMasukAktif)} | Keluar: ${formatRupiah(cashSummaryMetrics.totalKeluarAktif)} | Saldo Akhir: ${formatRupiah(cashSummaryMetrics.saldoSaatIni)} (${cashSummaryMetrics.activeCount} transaksi aktif)`,
        total_nilai_atau_item: formatRupiah(cashSummaryMetrics.saldoSaatIni),
        audience_pov: 'KONTRAKTOR',
        extraSnapshot: {
          active_count: cashSummaryMetrics.activeCount,
          excluded_count: cashSummaryMetrics.excludedCount,
          total_masuk_aktif: cashSummaryMetrics.totalMasukAktif,
          total_keluar_aktif: cashSummaryMetrics.totalKeluarAktif,
          saldo_akhir: cashSummaryMetrics.saldoSaatIni,
        },
      });
      if (res.success) setNoticeMessage(res.message);
      else setErrorMessage(res.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvanceCashDocument = async (
    docDbId: string,
    nextStatus: StatusDokumenWorkflow
  ) => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceDocumentWorkflow(docDbId, nextStatus);
      if (res.success) setNoticeMessage(res.message);
      else setErrorMessage(res.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmBatalDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalDocTargetId || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalOfficialDocument(batalDocTargetId, batalDocReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalDocTargetId(null);
        setBatalDocReason('');
      } else setErrorMessage(res.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmGantiDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiDocTargetId || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await gantiOfficialDocument(
        gantiDocTargetId,
        {
          jenis: 'MUTASI_KAS',
          judul: gantiDocTitle.trim() || 'Berita Acara Rekapitulasi Arus Kas (Revisi)',
          periode: docPeriode.trim() || 'Periode Berjalan',
          ringkasan: `Revisi Masuk: ${formatRupiah(cashSummaryMetrics.totalMasukAktif)} | Keluar: ${formatRupiah(cashSummaryMetrics.totalKeluarAktif)} | Saldo: ${formatRupiah(cashSummaryMetrics.saldoSaatIni)}`,
          total_nilai_atau_item: formatRupiah(cashSummaryMetrics.saldoSaatIni),
          audience_pov: 'KONTRAKTOR',
        },
        gantiDocReason
      );
      if (res.success) {
        setNoticeMessage(res.message);
        setGantiDocTargetId(null);
        setGantiDocReason('');
      } else setErrorMessage(res.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadCashDocPDF = async (doc: DokumenLaporan) => {
    try {
      const activeCash = cashMutations.filter((c) => !isCashRowExcluded(c));
      const today = getTodayLocalDate();
      await generateCashflowPDF({
        docId: doc.id,
        startDate: doc.periode_awal?.slice(0, 10) || '2026-01-01',
        endDate: doc.periode_akhir?.slice(0, 10) || today,
        cashMutations: activeCash,
        signer: user,
        projectName: tenantBranding.projectName,
        branding: tenantBranding,
        customTitle: doc.judul,
        approvers: {
          issuerName: doc.penandatangan_nama,
          checkerName: doc.diperiksa_oleh,
          approverName: doc.disetujui_oleh,
          directorName: doc.mengetahui_oleh || tenantBranding.directorName,
        },
      });
      setNoticeMessage(`Dokumen PDF Resmi Kas (${doc.id}) dengan QR Code Verifikasi berhasil diunduh.`);
    } catch (err: any) {
      setErrorMessage('Gagal mengunduh PDF dokumen kas: ' + (err?.message || 'Kesalahan sistem'));
    }
  };

  // Penjaga ketat POV Klien
  if (isViewer) return null;
  if (modalOnly && !isModalOpen) return null;
  if (!dataReady) {
    return (
      <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
        Memuat data mutasi dana &amp; rekonsiliasi...
      </div>
    );
  }

  // Hitung label antrean pengawas untuk Smart-Header
  const supervisorActionWord =
    activeRole === 'Foreman' ? 'Periksa' : activeRole === 'Spv.' ? 'Setuju' : 'Sahkan';
  const supervisorHeaderTone =
    activeRole === 'Foreman'
      ? 'bg-sky-600 hover:bg-sky-700 text-white'
      : activeRole === 'Spv.'
      ? 'bg-amber-600 hover:bg-amber-700 text-white'
      : 'bg-teal-600 hover:bg-teal-700 text-white';

  const isCashEmptyForHighlight =
    cashSummaryMetrics.healthCode === 'K-1' || cashSummaryMetrics.healthCode === 'K-4';

  const hasActiveJournalFilter =
    searchQuery.trim() !== '' ||
    filterType !== 'ALL' ||
    filterCategory !== 'ALL' ||
    filterMethod !== 'ALL' ||
    filterPeriod !== 'ALL' ||
    filterSpecial !== 'NONE';

  const resetJournalFilters = () => {
    setSearchQuery('');
    setFilterType('ALL');
    setFilterCategory('ALL');
    setFilterMethod('ALL');
    setFilterPeriod('ALL');
    setFilterSpecial('NONE');
  };

  const toggleSort = (field: 'tanggal' | 'nominal' | 'untuk_apa') => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  return (
    <div className={modalOnly ? '' : 'space-y-5'}>
      {/* Pesan Notifikasi & Galat */}
      {noticeMessage && (
        <div
          role="status"
          className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span className="font-medium">{noticeMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setNoticeMessage(null)}
            aria-label="Tutup pemberitahuan"
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 font-bold cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span className="font-medium">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            aria-label="Tutup pesan galat"
            className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 font-bold cursor-pointer"
          >
            ×
          </button>
        </div>
      )}

      {!modalOnly && (
        <>
          {/* SMART-HEADER ADAPTIF PERAN & KONDISI KAS (BEBAS TOMBOL MATI) */}
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => (goBack ? goBack() : setCurrentView('dashboard'))}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer mr-1"
                  title="Kembali ke halaman sebelumnya"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Dasbor</span>
                </button>
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <span className="text-xs font-extrabold text-emerald-600 dark:text-emerald-400">
                  Mutasi Dana &amp; Rekonsiliasi
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${cashSummaryMetrics.healthBadgeClass}`}
                >
                  {cashSummaryMetrics.healthLabel}
                </span>
              </div>

              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Mutasi Dana Proyek
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Kontrol anggaran kas, pelunasan nota gudang, panjar lapangan, dan persetujuan berjenjang {tenantBranding.projectName}.
              </p>
            </div>

            {/* Aksi Smart-Header Bebas Tombol Mati + Banner */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 shrink-0">
              <div className="flex flex-wrap items-center gap-2">
                {cashEvalContext.authority === 'EKSEKUTOR' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => openWizard({ jenis: 'MASUK' })}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition-all shadow-sm cursor-pointer active:scale-95 ${
                        isCashEmptyForHighlight ? 'ring-2 ring-emerald-400/70 ring-offset-2 dark:ring-offset-slate-900' : ''
                      }`}
                    >
                      <ArrowDownLeft className="w-4 h-4" />
                      <span>+ Kas Masuk</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openWizard({ jenis: 'KELUAR' })}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-xl transition-all shadow-sm cursor-pointer active:scale-95"
                    >
                      <ArrowUpRight className="w-4 h-4" />
                      <span>- Kas Keluar</span>
                    </button>
                    {unreconciledReceipts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setActiveTab('RECONCILIATION')}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-all cursor-pointer active:scale-95"
                      >
                        <Link2 className="w-3.5 h-3.5" />
                        <span>{unreconciledReceipts.length} Nota Siap Bayar →</span>
                      </button>
                    )}
                  </>
                ) : cashSummaryMetrics.pendingWorkflowCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('JOURNAL');
                      setFilterSpecial('PENDING_APPROVAL');
                    }}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl shadow-sm transition-all cursor-pointer active:scale-95 ${supervisorHeaderTone}`}
                  >
                    <Bell className="w-4 h-4" />
                    <span>
                      {cashSummaryMetrics.pendingWorkflowCount} Kas Menunggu {supervisorActionWord} →
                    </span>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Semua Kas Terverifikasi</span>
                  </span>
                )}
              </div>

              <div className="flex items-center justify-end self-center shrink-0">
                <img
                  src="/words_PNG2.png"
                  alt="Proyek Cair"
                  className="h-10 sm:h-12 w-auto max-w-[170px] object-contain drop-shadow-md dark:block hidden"
                />
                <img
                  src="/words_light.png"
                  alt="Proyek Cair"
                  className="h-10 sm:h-12 w-auto max-w-[170px] object-contain drop-shadow-md dark:hidden block"
                />
              </div>
            </div>
          </div>

          {/* NAVIGASI 4 TAB TERPADU MUTASI DANA */}
          <div className="flex overflow-x-auto no-scrollbar touch-scroll whitespace-nowrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-1">
            {[
              {
                id: 'SUMMARY' as CashflowTabKey,
                label: 'Ringkasan & Anggaran',
                icon: Coins,
                badge: '8 Pos',
                activeCls: 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/25',
                badgeCls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200',
              },
              {
                id: 'RECONCILIATION' as CashflowTabKey,
                label: 'Rekonsiliasi & Panjar',
                icon: Link2,
                badge:
                  unreconciledReceipts.length + cashSummaryMetrics.openKasbonCount > 0
                    ? `${unreconciledReceipts.length + cashSummaryMetrics.openKasbonCount} Aktif`
                    : 'Beres',
                activeCls: 'border-indigo-600 text-indigo-700 dark:text-indigo-400 bg-indigo-50/60 dark:bg-indigo-950/25',
                badgeCls:
                  unreconciledReceipts.length + cashSummaryMetrics.openKasbonCount > 0
                    ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200'
                    : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
              },
              {
                id: 'JOURNAL' as CashflowTabKey,
                label: 'Jurnal Transaksi Kas',
                icon: History,
                badge: `${cashMutations.length} Baris`,
                activeCls: 'border-blue-600 text-blue-700 dark:text-blue-400 bg-blue-50/60 dark:bg-blue-950/25',
                badgeCls: 'bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200',
              },
              {
                id: 'DOCUMENTS' as CashflowTabKey,
                label: 'Dokumen Resmi (TTE/QR)',
                icon: FileCheck2,
                badge: `${cashDocuments.length} Dokumen`,
                activeCls: 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/25',
                badgeCls: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200',
              },
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex items-center gap-2 py-2.5 px-3.5 text-xs font-bold border-b-2 transition-all cursor-pointer rounded-t-xl ${
                    isActive
                      ? tab.activeCls
                      : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span>{tab.label}</span>
                  <span className={`text-[10px] py-0.5 px-2 rounded-full font-bold ${tab.badgeCls}`}>
                    {tab.badge}
                  </span>
                </button>
              );
            })}
          </div>

          {/* =================================================================
              TAB 1 — RINGKASAN & ANGGARAN (4 SMART-KPI + 8 POS BIAYA)
          ================================================================= */}
          {activeTab === 'SUMMARY' && (
            <div className="space-y-5">
              {/* 4 Smart-KPI Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* KPI 1: Saldo Kas Operasional */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Saldo Kas Operasional
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${cashSummaryMetrics.healthBadgeClass}`}
                    >
                      {cashSummaryMetrics.healthLabel}
                    </span>
                  </div>
                  <div
                    className={`text-2xl font-extrabold font-mono tabular-nums ${
                      cashSummaryMetrics.isCashCritical
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {cashAccess ? formatRupiah(cashSummaryMetrics.saldoSaatIni) : 'Akses Terbatas'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span>{cashSummaryMetrics.activeCount} transaksi aktif</span>
                    <span>{cashSummaryMetrics.excludedCount} batal/diganti</span>
                  </div>
                </div>

                {/* KPI 2: Total Dana Masuk */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Total Dana Masuk
                    </span>
                    <ArrowDownLeft className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="text-2xl font-extrabold font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatRupiah(cashSummaryMetrics.totalMasukAktif)}
                  </div>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-100 dark:border-slate-800 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Termin Proyek:</span>
                      <span className="font-mono font-bold">{formatRupiah(cashSummaryMetrics.totalMasukTermin)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Modal &amp; Pengembalian:</span>
                      <span className="font-mono font-bold">
                        {formatRupiah(cashSummaryMetrics.totalMasukModal + cashSummaryMetrics.totalMasukPengembalian)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* KPI 3: Total Dana Keluar & Serapan Pagu */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Dana Keluar &amp; Serapan
                    </span>
                    <ArrowUpRight className="w-4 h-4 text-rose-500" />
                  </div>
                  <div className="text-2xl font-extrabold font-mono tabular-nums text-rose-600 dark:text-rose-400">
                    {formatRupiah(cashSummaryMetrics.totalKeluarAktif)}
                  </div>
                  <div className="text-[10px] text-slate-600 dark:text-slate-300 pt-1 border-t border-slate-100 dark:border-slate-800 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Serapan Pagu BOQ:</span>
                      <span className="font-mono font-bold">{contractAndWarehouseTotals.serapanKontrakPct}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Belanja Nota Gudang:</span>
                      <span className="font-mono font-bold">
                        {formatRupiah(contractAndWarehouseTotals.belanjaNotaGudang)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* KPI 4: Kewajiban & Tindak Lanjut */}
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                      Kewajiban &amp; Tindak Lanjut
                    </span>
                    <Sparkles className="w-4 h-4 text-indigo-500" />
                  </div>
                  <div className="space-y-1.5 pt-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setActiveTab('RECONCILIATION')}
                      className="w-full flex items-center justify-between px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 hover:bg-blue-100 transition-colors cursor-pointer font-semibold"
                    >
                      <span>Nota Gudang Belum Bayar</span>
                      <span className="font-mono font-extrabold">{cashSummaryMetrics.unreconciledStockReceiptsCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('JOURNAL');
                        setFilterSpecial('PENDING_RECEIPT');
                      }}
                      className="w-full flex items-center justify-between px-2.5 py-1 rounded-lg bg-sky-50 dark:bg-sky-950/40 text-sky-900 dark:text-sky-200 hover:bg-sky-100 transition-colors cursor-pointer font-semibold"
                    >
                      <span>Bukti Menyusul</span>
                      <span className="font-mono font-extrabold">{cashSummaryMetrics.pendingReceiptCount}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveTab('RECONCILIATION')}
                      className="w-full flex items-center justify-between px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 hover:bg-indigo-100 transition-colors cursor-pointer font-semibold"
                    >
                      <span>Panjar Terbuka / Talangan</span>
                      <span className="font-mono font-extrabold">
                        {cashSummaryMetrics.openKasbonCount} / {formatRupiah(cashSummaryMetrics.totalPiutangTalanganKlien)}
                      </span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabel Kontrol Anggaran per Pos Biaya (8 Baris Tetap) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                      Kontrol Anggaran per Pos Biaya Proyek
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Pagu Material &amp; Upah ditarik otomatis dari Master BOQ; LPJ Panjar otomatis direklasifikasi tanpa hitung ganda.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setExportInitialPreset('CASH_FULL');
                      setIsExportModalOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-xs cursor-pointer self-start sm:self-auto"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Ekspor PDF Kas</span>
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-4">Pos Biaya / Kategori</th>
                        <th className="py-3 px-3.5 text-right">Pagu Kontrak / Acuan</th>
                        <th className="py-3 px-3.5 text-right">Realisasi Kas Keluar</th>
                        <th className="py-3 px-3.5 text-right">Sisa Pagu / Serapan</th>
                        <th className="py-3 px-3 text-center">Transaksi</th>
                        <th className="py-3 px-3 text-center">Status Pos</th>
                        <th className="py-3 px-4 text-right">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {budgetCategories.map((cat) => (
                        <tr key={cat.categoryKey} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors">
                          <td className="py-3 px-4">
                            <div className="font-bold text-slate-900 dark:text-white">{cat.label}</div>
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">{cat.description}</div>
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono text-slate-700 dark:text-slate-300 whitespace-nowrap">
                            {cat.paguAcuanRp > 0 ? formatRupiah(cat.paguAcuanRp) : <span className="text-slate-400">Non-BOQ</span>}
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                            {formatRupiah(cat.realisasiKasRp)}
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono whitespace-nowrap">
                            {cat.paguAcuanRp > 0 ? (
                              <div>
                                <div className="font-bold text-slate-800 dark:text-slate-200">
                                  {formatRupiah(cat.sisaPaguRp)}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                  {cat.serapanPct}% terserap
                                </div>
                              </div>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center font-mono font-bold text-slate-700 dark:text-slate-300">
                            {cat.txCount}
                          </td>
                          <td className="py-3 px-3 text-center whitespace-nowrap">
                            <span
                              className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${cat.statusBadgeClass}`}
                            >
                              {cat.statusLabel}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right whitespace-nowrap">
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {cat.showSecondaryHistoryIcon ? (
                                <>
                                  <button
                                    type="button"
                                    title={cat.actionTooltip}
                                    onClick={() => {
                                      if (cat.actionType === 'ISI_KAS') {
                                        openWizard({ jenis: 'MASUK', category: 'Dana Termin Proyek' });
                                      } else {
                                        openWizard({ jenis: 'KELUAR', category: cat.categoryKey });
                                      }
                                    }}
                                    className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[34px] sm:min-h-0 px-2.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${getCashActionVariantClass(cat.actionVariant)}`}
                                  >
                                    {cat.actionType === 'ISI_KAS' ? (
                                      <ArrowDownLeft className="w-3 h-3 shrink-0" />
                                    ) : (
                                      <ArrowUpRight className="w-3 h-3 shrink-0" />
                                    )}
                                    <span>{cat.actionLabel}</span>
                                  </button>
                                  <button
                                    type="button"
                                    title={`Filter jurnal untuk pos ${cat.label}`}
                                    aria-label={`Lihat riwayat ${cat.label}`}
                                    onClick={() => {
                                      setFilterCategory(cat.categoryKey);
                                      setFilterType('KELUAR');
                                      setActiveTab('JOURNAL');
                                    }}
                                    className="w-7 h-7 min-h-[34px] sm:min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
                                  >
                                    <Clock className="w-3.5 h-3.5" />
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  title={cat.actionTooltip}
                                  onClick={() => {
                                    setFilterCategory(cat.categoryKey);
                                    setFilterType('KELUAR');
                                    setActiveTab('JOURNAL');
                                  }}
                                  className={`inline-flex items-center justify-center gap-1 min-w-[114px] h-7 sm:h-7 min-h-[34px] sm:min-h-0 px-3 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${getCashActionVariantClass('neutral')}`}
                                >
                                  <Clock className="w-3 h-3 shrink-0" />
                                  <span>Riwayat</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              TAB 2 — REKONSILIASI & PANJAR (NOTA GUDANG + KASBON + TALANGAN)
          ================================================================= */}
          {activeTab === 'RECONCILIATION' && (
            <div className="space-y-5">
              {/* TABEL A: ANTREAN TAGIHAN NOTA BELANJA GUDANG */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <Link2 className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      <span>Antrean Tagihan Nota Belanja Gudang (Belum Dibayar Kas)</span>
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Otomatis menarik nota material belanja Kontraktor dari Mutasi Barang (mengecualikan Jatah Klien Rp 0). Klik <b>Bayar</b> untuk pelunasan 2-klik terpadu.
                    </p>
                  </div>
                  <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800 self-start sm:self-auto">
                    {unreconciledReceipts.length} Nota ·{' '}
                    {formatRupiah(unreconciledReceipts.reduce((s, r) => s + r.totalAmountRp, 0))}
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 text-center w-10">No</th>
                        <th className="py-3 px-3.5">Tanggal Nota</th>
                        <th className="py-3 px-3.5">Nama Toko &amp; No. Nota</th>
                        <th className="py-3 px-3.5">Daftar Material Tiba</th>
                        <th className="py-3 px-3.5 text-right">Total Tagihan (Rp)</th>
                        <th className="py-3 px-3 text-center">Status Bukti</th>
                        <th className="py-3 px-4 text-right">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {unreconciledReceipts.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-10 text-center text-slate-500 dark:text-slate-400 font-medium">
                            Semua nota belanja gudang Kontraktor telah direkonsiliasi dan terbayar di buku kas.
                          </td>
                        </tr>
                      ) : (
                        unreconciledReceipts.map((rc, idx) => (
                          <tr key={rc.key} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                            <td className="py-3 px-3.5 text-center font-mono text-slate-500">{idx + 1}</td>
                            <td className="py-3 px-3.5 font-mono text-[11px] whitespace-nowrap text-slate-700 dark:text-slate-300">
                              {formatDateTime(rc.receiptDate).split(',')[0]}
                            </td>
                            <td className="py-3 px-3.5">
                              <div className="font-bold text-slate-900 dark:text-white">{rc.storeName}</div>
                              <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                No. {rc.receiptNo}
                                {rc.isTalangan && (
                                  <span className="ml-1.5 px-1.5 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-200 font-sans font-bold">
                                    Talangan Klien
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-3 px-3.5 max-w-xs">
                              <div className="text-slate-800 dark:text-slate-200 font-medium truncate" title={rc.itemSummary}>
                                {rc.itemSummary}
                              </div>
                              <div className="text-[10px] text-slate-500">{rc.itemCount} baris kedatangan</div>
                            </td>
                            <td className="py-3 px-3.5 text-right font-mono font-extrabold text-rose-700 dark:text-rose-300 whitespace-nowrap">
                              {formatRupiah(rc.totalAmountRp)}
                            </td>
                            <td className="py-3 px-3 text-center whitespace-nowrap">
                              {rc.attachmentUrls.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => openReceiptViewerForStockQueue(rc)}
                                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800 cursor-pointer hover:bg-emerald-100"
                                >
                                  <Paperclip className="w-3 h-3" />
                                  <span>{rc.attachmentUrls.length} Lampiran</span>
                                </button>
                              ) : (
                                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-sky-50 text-sky-800 border border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800">
                                  Bukti Menyusul
                                </span>
                              )}
                            </td>
                            <td className="py-3 px-4 text-right whitespace-nowrap">
                              {cashEvalContext.authority === 'EKSEKUTOR' ? (
                                <div className="inline-flex items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => openWizard({ jenis: 'KELUAR', receipt: rc })}
                                    className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 min-h-[34px] sm:min-h-0 px-2.5 rounded-lg text-[11px] font-bold cursor-pointer ${getCashActionVariantClass('rose')}`}
                                  >
                                    <ArrowUpRight className="w-3 h-3" />
                                    <span>Bayar</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openReceiptViewerForStockQueue(rc)}
                                    title="Periksa rincian & foto nota"
                                    className="w-7 h-7 min-h-[34px] sm:min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
                                  >
                                    <Eye className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => openReceiptViewerForStockQueue(rc)}
                                  className={`inline-flex items-center justify-center gap-1 min-w-[114px] h-7 min-h-[34px] sm:min-h-0 px-3 rounded-lg text-[11px] font-bold cursor-pointer ${getCashActionVariantClass('neutral')}`}
                                >
                                  <Eye className="w-3 h-3" />
                                  <span>Lihat Nota</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* TABEL B1: KONTROL PANJAR / KASBON LAPANGAN */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <Briefcase className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>Kontrol Panjar / Kasbon Lapangan &amp; Pertanggungjawaban (LPJ)</span>
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Uang muka mandor/staf dipantau hingga lunas LPJ (bebas hitung ganda untuk belanja kurang, pas, maupun lebih).
                    </p>
                  </div>
                  {cashEvalContext.authority === 'EKSEKUTOR' && (
                    <button
                      type="button"
                      onClick={() => openWizard({ jenis: 'KELUAR', category: 'Panjar / Kasbon' })}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer self-start sm:self-auto"
                    >
                      <ArrowUpRight className="w-3.5 h-3.5" />
                      <span>+ Catat Panjar Baru</span>
                    </button>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-4">Penanggung Jawab</th>
                        <th className="py-3 px-3.5">Tanggal</th>
                        <th className="py-3 px-3.5">Uraian Keperluan</th>
                        <th className="py-3 px-3.5 text-right">Panjar Awal</th>
                        <th className="py-3 px-3.5 text-right">LPJ &amp; Kembali</th>
                        <th className="py-3 px-3.5 text-right">Sisa Terbuka</th>
                        <th className="py-3 px-3 text-center">Status</th>
                        <th className="py-3 px-4 text-right">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {openKasbonList.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-10 text-center text-slate-500 dark:text-slate-400 font-medium">
                            Belum ada catatan panjar / kasbon lapangan pada proyek ini.
                          </td>
                        </tr>
                      ) : (
                        openKasbonList.map((k) => {
                          const isOpen = k.statusKasbon !== 'LUNAS';
                          return (
                            <tr key={k.kasbonTx.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                              <td className="py-3 px-4 font-bold text-slate-900 dark:text-white">{k.picName}</td>
                              <td className="py-3 px-3.5 font-mono text-[11px] whitespace-nowrap text-slate-600 dark:text-slate-300">
                                {formatDateTime(k.kasbonTx.tanggal).split(',')[0]}
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="font-semibold text-slate-900 dark:text-white">{k.kasbonTx.untuk_apa}</div>
                                {k.kasbonTx.lpj_kategori_riil && (
                                  <div className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium">
                                    Pos LPJ: {k.kasbonTx.lpj_kategori_riil}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-right font-mono font-bold text-slate-900 dark:text-white whitespace-nowrap">
                                {formatRupiah(k.nominalAwalRp)}
                              </td>
                              <td className="py-3 px-3.5 text-right font-mono text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                                {formatRupiah(k.nominalLpjDanKembaliRp)}
                              </td>
                              <td className="py-3 px-3.5 text-right font-mono font-extrabold text-indigo-700 dark:text-indigo-300 whitespace-nowrap">
                                {formatRupiah(k.sisaTerbukaRp)}
                              </td>
                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                <span
                                  className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                    k.statusKasbon === 'LUNAS'
                                      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800'
                                      : k.statusKasbon === 'SEBAGIAN'
                                      ? 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800'
                                      : 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800'
                                  }`}
                                >
                                  {k.statusKasbon === 'LUNAS'
                                    ? 'Lunas'
                                    : k.statusKasbon === 'SEBAGIAN'
                                    ? 'Sebagian'
                                    : 'Terbuka'}
                                </span>
                              </td>
                              <td className="py-3 px-4 text-right whitespace-nowrap">
                                {isOpen && cashEvalContext.authority === 'EKSEKUTOR' ? (
                                  <div className="inline-flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => openLpjModal(k)}
                                      className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 min-h-[34px] sm:min-h-0 px-2.5 rounded-lg text-[11px] font-bold cursor-pointer ${getCashActionVariantClass('indigo')}`}
                                    >
                                      <ClipboardCheck className="w-3 h-3" />
                                      <span>Lunasi</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setDetailTarget(k.kasbonTx)}
                                      title="Lihat riwayat panjar"
                                      className="w-7 h-7 min-h-[34px] sm:min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
                                    >
                                      <Clock className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setDetailTarget(k.kasbonTx)}
                                    className={`inline-flex items-center justify-center gap-1 min-w-[114px] h-7 min-h-[34px] sm:min-h-0 px-3 rounded-lg text-[11px] font-bold cursor-pointer ${getCashActionVariantClass('neutral')}`}
                                  >
                                    <Clock className="w-3 h-3" />
                                    <span>Riwayat</span>
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* TABEL B2: PIUTANG TALANGAN KLIEN */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <Building2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Piutang Talangan Klien ({tenantBranding.clientName})</span>
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Pengeluaran di luar kontrak atas permintaan Klien yang dapat ditagih balik tanpa membocorkan saldo brankas internal.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {cashEvalContext.authority === 'EKSEKUTOR' && clientAdvanceSummary.sisaPiutangRp > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          openWizard({
                            jenis: 'MASUK',
                            category: 'Penggantian Talangan Klien',
                            amount: clientAdvanceSummary.sisaPiutangRp,
                            purpose: `Penggantian Biaya Talangan dari ${tenantBranding.clientName}`,
                          })
                        }
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${getCashActionVariantClass('emerald')}`}
                      >
                        <ArrowDownLeft className="w-3.5 h-3.5" />
                        <span>Terima Penggantian</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setExportInitialPreset('CASH_CLIENT_CLAIM');
                        setIsExportModalOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-xs cursor-pointer"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Tagihan Penggantian Klien (PDF)</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                    <div className="text-[10px] font-bold uppercase text-amber-800 dark:text-amber-300">
                      Total Ditalangi Kontraktor
                    </div>
                    <div className="text-base font-extrabold font-mono text-amber-900 dark:text-amber-100 mt-0.5">
                      {formatRupiah(clientAdvanceSummary.totalTalanganRp)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                    <div className="text-[10px] font-bold uppercase text-emerald-800 dark:text-emerald-300">
                      Sudah Diganti Klien
                    </div>
                    <div className="text-base font-extrabold font-mono text-emerald-900 dark:text-emerald-100 mt-0.5">
                      {formatRupiah(clientAdvanceSummary.totalDigantiRp)}
                    </div>
                  </div>
                  <div className="p-3 rounded-xl bg-rose-50/70 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
                    <div className="text-[10px] font-bold uppercase text-rose-800 dark:text-rose-300">
                      Sisa Piutang Belum Diganti
                    </div>
                    <div className="text-base font-extrabold font-mono text-rose-900 dark:text-rose-100 mt-0.5">
                      {formatRupiah(clientAdvanceSummary.sisaPiutangRp)}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              TAB 3 — JURNAL TRANSAKSI KAS (8 KOLOM + FILTER + SALDO BERJALAN)
          ================================================================= */}
          {activeTab === 'JOURNAL' && (
            <div className="space-y-4">
              {/* Panel Panduan Tata Kelola Kas (Dapat Dilipat) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowGovernanceGuide((v) => !v)}
                  className="w-full px-4 py-3 flex items-center justify-between text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
                >
                  <span className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>Panduan Tata Kelola Audit Kas (CRU Tanpa Hapus · Batal vs Ganti · Lengkapi Bukti)</span>
                  </span>
                  {showGovernanceGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                {showGovernanceGuide && (
                  <div className="px-4 pb-4 pt-1 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px] text-slate-600 dark:text-slate-300">
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                      <div className="font-bold text-slate-900 dark:text-white mb-1">1. Jejak Audit Abadi</div>
                      Transaksi kas tidak pernah dihapus permanen. Gunakan <b>Batal</b> (nominal jadi Rp 0) atau <b>Ganti</b> (terbit baris revisi baru tertaut ke baris lama).
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                      <div className="font-bold text-slate-900 dark:text-white mb-1">2. Lengkapi Bukti Menyusul</div>
                      Transaksi berstatus <b>Bukti Menyusul</b> dapat dilengkapi fotonya 1 klik lewat tombol <b>Bukti</b> atau seleksi beberapa baris sekaligus.
                    </div>
                    <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                      <div className="font-bold text-slate-900 dark:text-white mb-1">3. Persetujuan Serial Berjenjang</div>
                      Urutan wajib: <b>Terbit (Clerk) → Periksa (Foreman) → Setuju (Spv.) → Sahkan TTE (Dept. Mgr / KTT-PM / CEO)</b>.
                    </div>
                  </div>
                )}
              </div>

              {/* 3 Kartu Filter Interaktif */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                {/* Kartu 1: Arus Dana Kas */}
                <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Arus Dana Kas
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { id: 'ALL', label: `Semua (${cashMutations.length})` },
                      { id: 'MASUK', label: `Masuk (${cashMutations.filter((m) => m.jenis === 'MASUK').length})` },
                      { id: 'KELUAR', label: `Keluar (${cashMutations.filter((m) => m.jenis === 'KELUAR').length})` },
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setFilterType(t.id as any)}
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition-colors cursor-pointer ${
                          filterType === t.id
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kartu 2: Kategori & Beban Biaya */}
                <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Filter Kategori Biaya
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {['ALL', 'Material', 'Upah & Konsumsi', 'Operasional', 'Sewa Alat & Angkut', 'Panjar / Kasbon', 'Talangan Klien', 'Bonus Klien', 'Dana Termin Proyek'].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setFilterCategory(cat)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors cursor-pointer ${
                          filterCategory === cat
                            ? 'bg-emerald-600 text-white border-emerald-600'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {cat === 'ALL' ? 'Semua' : cat}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Kartu 3: Pengawasan Bukti & Album */}
                <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Pengawasan Bukti &amp; Antrean
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setFilterSpecial((s) => (s === 'PENDING_RECEIPT' ? 'NONE' : 'PENDING_RECEIPT'))
                      }
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                        filterSpecial === 'PENDING_RECEIPT'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-sky-50 dark:bg-sky-950/40 text-sky-800 dark:text-sky-200 border-sky-200 dark:border-sky-800'
                      }`}
                    >
                      Bukti Menyusul ({cashSummaryMetrics.pendingReceiptCount})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setFilterSpecial((s) => (s === 'PENDING_APPROVAL' ? 'NONE' : 'PENDING_APPROVAL'))
                      }
                      className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                        filterSpecial === 'PENDING_APPROVAL'
                          ? 'bg-amber-600 text-white border-amber-600'
                          : 'bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800'
                      }`}
                    >
                      Menunggu Persetujuan (
                      {cashEvalContext.authority === 'PENGAWAS_INTERNAL'
                        ? cashSummaryMetrics.pendingWorkflowCount
                        : cashMutations.filter((c) => !isCashRowExcluded(c) && c.status_dokumen !== 'MENGETAHUI').length}
                      )
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsAlbumOpen(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-[11px] font-bold bg-indigo-50 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100 cursor-pointer"
                    >
                      <Images className="w-3.5 h-3.5" />
                      <span>Album Kuitansi ({projectAlbumItems.length})</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Toolbar Pencarian, Periode Cepat, Metode & Ekspor */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Cari uraian kas, PIC, toko, nomor kuitansi, atau catatan"
                    placeholder="Cari uraian, PIC, toko, nomor kuitansi, atau catatan..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { id: 'TODAY', label: 'Hari Ini' },
                      { id: '7D', label: '7 Hari' },
                      { id: '30D', label: '30 Hari' },
                      { id: 'THIS_MONTH', label: 'Bulan Ini' },
                      { id: 'ALL', label: 'Semua' },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setFilterPeriod(p.id)}
                      className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold transition-colors cursor-pointer ${
                        filterPeriod === p.id
                          ? 'bg-slate-900 dark:bg-blue-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}

                  <select
                    aria-label="Filter metode pembayaran"
                    value={filterMethod}
                    onChange={(e) => setFilterMethod(e.target.value as any)}
                    className="px-2.5 py-1.5 rounded-xl text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 cursor-pointer"
                  >
                    <option value="ALL">Semua Metode</option>
                    <option value="TUNAI">Tunai</option>
                    <option value="TRANSFER">Transfer Bank</option>
                    <option value="GIRO_CEK">Giro / Cek</option>
                    <option value="DOMPET_DIGITAL">Dompet Digital</option>
                  </select>

                  {hasActiveJournalFilter && (
                    <button
                      type="button"
                      onClick={resetJournalFilters}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100 cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Atur Ulang Filter</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setExportInitialPreset('CASH_FULL');
                      startTransition(() => setIsExportModalOpen(true));
                    }}
                    disabled={isExportingCash || cashMutations.length === 0}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-xs cursor-pointer disabled:opacity-45"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{isExportingCash ? 'Menyiapkan...' : 'Ekspor PDF'}</span>
                  </button>
                </div>
              </div>

              {/* Bilah Seleksi Kolektif Lengkapi Bukti Bersama */}
              {selectedRowIds.length > 0 && cashEvalContext.authority === 'EKSEKUTOR' && (
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-bold text-blue-900 dark:text-blue-200">
                    {selectedRowIds.length} transaksi kas dipilih
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const targets = cashMutations.filter(
                          (c) => selectedRowIds.includes(c.id) && !isCashRowExcluded(c)
                        );
                        openProofModal(targets);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold cursor-pointer shadow-xs"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>Lengkapi / Tautkan Kuitansi Bersama ({selectedRowIds.length} Transaksi)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedRowIds([])}
                      className="px-2.5 py-1.5 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 font-semibold cursor-pointer"
                    >
                      Batal Pilih
                    </button>
                  </div>
                </div>
              )}

              {/* TABEL JURNAL TRANSAKSI KAS (8 KOLOM BERSIH & ERGONOMIS) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3 text-center w-9">
                          <input
                            type="checkbox"
                            aria-label="Pilih semua transaksi aktif"
                            checked={
                              sortedCashList.filter((c) => !isCashRowExcluded(c)).length > 0 &&
                              sortedCashList
                                .filter((c) => !isCashRowExcluded(c))
                                .every((c) => selectedRowIds.includes(c.id))
                            }
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedRowIds(
                                  sortedCashList.filter((c) => !isCashRowExcluded(c)).map((c) => c.id)
                                );
                              } else {
                                setSelectedRowIds([]);
                              }
                            }}
                            className="rounded border-slate-300 text-blue-600"
                          />
                        </th>
                        <th
                          onClick={() => toggleSort('tanggal')}
                          className="py-3 px-3 cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                        >
                          <div className="inline-flex items-center gap-1">
                            <span>Tanggal &amp; Arus</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                          </div>
                        </th>
                        <th
                          onClick={() => toggleSort('untuk_apa')}
                          className="py-3 px-3 cursor-pointer hover:text-blue-600 select-none"
                        >
                          <div className="inline-flex items-center gap-1">
                            <span>Uraian, Pihak/Toko, Metode &amp; Bukti</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                          </div>
                        </th>
                        <th
                          onClick={() => toggleSort('nominal')}
                          className="py-3 px-3 text-right cursor-pointer hover:text-blue-600 select-none whitespace-nowrap"
                        >
                          <div className="inline-flex items-center gap-1 justify-end w-full">
                            <span>Nominal (Rp)</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                          </div>
                        </th>
                        <th className="py-3 px-3 text-right whitespace-nowrap">Saldo Berjalan (Rp)</th>
                        <th className="py-3 px-3">PIC &amp; No. Bukti</th>
                        <th className="py-3 px-3 text-center">Status &amp; Alur</th>
                        <th className="py-3 px-3.5 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {sortedCashList.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-500 dark:text-slate-400 font-medium">
                            Tidak ada transaksi kas yang sesuai dengan kriteria saringan saat ini.
                          </td>
                        </tr>
                      ) : (
                        sortedCashList.map((c) => {
                          const ev = evaluateCashRow(c, cashEvalContext);
                          const runningBal = runningBalances.get(c.id);
                          const isSelected = selectedRowIds.includes(c.id);
                          const isHighlighted = highlightedRowId === c.id;
                          const hasProofFiles = (c.lampiran_nota_urls?.length || 0) > 0;
                          const replacementRow = ev.stateCode === 'T-7' ? findReplacementRow(c) : undefined;
                          const kasbonItem =
                            ev.stateCode === 'T-2'
                              ? openKasbonList.find((k) => k.kasbonTx.id === c.id)
                              : undefined;

                          return (
                            <tr
                              key={c.id}
                              id={`cash-row-${c.id}`}
                              className={`transition-colors ${
                                isHighlighted
                                  ? 'bg-blue-100/80 dark:bg-blue-950/60 ring-2 ring-inset ring-blue-500'
                                  : ev.stateCode === 'T-6'
                                  ? 'opacity-55 bg-rose-50/20 dark:bg-rose-950/15'
                                  : ev.stateCode === 'T-7'
                                  ? 'opacity-65 bg-amber-50/20 dark:bg-amber-950/15'
                                  : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/40'
                              }`}
                            >
                              {/* 1. Checkbox */}
                              <td className="py-3 px-3 text-center">
                                {!ev.isExcluded && (
                                  <input
                                    type="checkbox"
                                    aria-label={`Pilih transaksi ${c.untuk_apa}`}
                                    checked={isSelected}
                                    onChange={(e) => {
                                      setSelectedRowIds((prev) =>
                                        e.target.checked
                                          ? [...prev, c.id]
                                          : prev.filter((id) => id !== c.id)
                                      );
                                    }}
                                    className="rounded border-slate-300 text-blue-600"
                                  />
                                )}
                              </td>

                              {/* 2. Tanggal & Arus */}
                              <td className="py-3 px-3 whitespace-nowrap">
                                <div className="font-mono text-[11px] text-slate-800 dark:text-slate-200 font-semibold">
                                  {formatDateTime(c.tanggal)}
                                </div>
                                <span
                                  className={`mt-1 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    c.jenis === 'MASUK'
                                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                      : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                                  }`}
                                >
                                  {c.jenis === 'MASUK' ? (
                                    <ArrowDownLeft className="w-3 h-3" />
                                  ) : (
                                    <ArrowUpRight className="w-3 h-3" />
                                  )}
                                  {c.jenis === 'MASUK' ? 'Masuk' : 'Keluar'}
                                </span>
                              </td>

                              {/* 3. Uraian, Toko, Metode & Bukti */}
                              <td className="py-3 px-3 max-w-sm">
                                <div
                                  className={`font-bold text-slate-900 dark:text-white ${
                                    ev.isExcluded ? 'line-through' : ''
                                  }`}
                                >
                                  {c.untuk_apa}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold">
                                    {c.kategori_keperluan}
                                  </span>
                                  <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium inline-flex items-center gap-1">
                                    <CreditCard className="w-2.5 h-2.5" />
                                    {PAYMENT_METHOD_LABELS[c.payment_method || 'TUNAI']}
                                  </span>
                                  {c.nama_toko && (
                                    <span className="text-slate-600 dark:text-slate-300 font-semibold">
                                      · {c.nama_toko}
                                    </span>
                                  )}
                                  {c.source_module === 'MUTASI_BARANG' && (
                                    <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 font-bold">
                                      ✓ Nota Gudang Terpadu
                                    </span>
                                  )}
                                  {c.source_module === 'PO_PENGADAAN' && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setProcurementTargetTab('PO_LIST');
                                        setCurrentView('procurement');
                                      }}
                                      className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-950/50 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800 font-bold transition-colors cursor-pointer"
                                      title="Pembayaran tertaut Surat Pesanan (PO) — klik untuk membuka modul Pengadaan & PO"
                                    >
                                      PO: {c.source_entity_no || 'PO Toko'}
                                    </button>
                                  )}
                                  {hasProofFiles && (
                                    <button
                                      type="button"
                                      onClick={() => openReceiptViewerForCash(c)}
                                      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 font-bold hover:bg-indigo-100 cursor-pointer"
                                    >
                                      <Paperclip className="w-2.5 h-2.5" />
                                      <span>Bukti ({c.lampiran_nota_urls!.length})</span>
                                    </button>
                                  )}
                                </div>
                                {c.catatan && (
                                  <div className="text-[10px] text-slate-500 dark:text-slate-400 italic mt-0.5 line-clamp-1">
                                    {c.catatan}
                                  </div>
                                )}
                                {c.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-md">
                                    {c.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>

                              {/* 4. Nominal */}
                              <td className="py-3 px-3 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                                <span
                                  className={`${ev.isExcluded ? 'line-through text-slate-400' : c.jenis === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}
                                >
                                  {c.jenis === 'MASUK' ? '+' : '-'} {formatRupiah(c.jumlah_rp)}
                                </span>
                                {ev.isExcluded && (
                                  <div className="text-[9px] font-bold text-rose-600 dark:text-rose-400">
                                    Dinolkan (Rp 0)
                                  </div>
                                )}
                              </td>

                              {/* 5. Saldo Berjalan (computeRunningCashBalances) */}
                              <td className="py-3 px-3 text-right font-mono font-bold tabular-nums whitespace-nowrap text-slate-900 dark:text-slate-100">
                                {runningBal == null ? (
                                  <span className="text-slate-400">—</span>
                                ) : (
                                  formatRupiah(runningBal)
                                )}
                              </td>

                              {/* 6. PIC & No. Bukti */}
                              <td className="py-3 px-3 text-slate-700 dark:text-slate-300">
                                <div className="font-semibold">{c.pic}</div>
                                {c.nomor_kuitansi && (
                                  <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                    No. {c.nomor_kuitansi}
                                  </div>
                                )}
                              </td>

                              {/* 7. Status & Alur (Pil bulat penuh khusus status!) */}
                              <td className="py-3 px-3 text-center whitespace-nowrap">
                                <div className="flex flex-col items-center gap-1">
                                  <span
                                    className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${ev.statusBadgeClass}`}
                                  >
                                    {ev.statusLabel}
                                  </span>
                                  {ev.stateCode === 'T-7' && replacementRow && (
                                    <button
                                      type="button"
                                      onClick={() => jumpToRow(replacementRow.id)}
                                      className="text-[10px] font-bold text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
                                    >
                                      Lihat Pengganti ↗
                                    </button>
                                  )}
                                  {c.referensi_ganti_id && !ev.isExcluded && (
                                    <button
                                      type="button"
                                      onClick={() => jumpToRow(c.referensi_ganti_id!)}
                                      className="text-[10px] font-medium text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                                    >
                                      Revisi dari #{c.referensi_ganti_id.slice(0, 6)}
                                    </button>
                                  )}
                                </div>
                              </td>

                              {/* 8. Aksi — 1 Smart-Button Fixed-Slot WCAG AA */}
                              <td className="py-3 px-3.5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center justify-end gap-1.5">
                                  {ev.showSecondaryHistoryIcon ? (
                                    <>
                                      <button
                                        type="button"
                                        title={ev.actionTooltip}
                                        disabled={submitting}
                                        onClick={() => {
                                          if (ev.actionType === 'APPROVE' && ev.nextWorkflowTarget) {
                                            void handleRowApproval(c, ev.nextWorkflowTarget);
                                          } else if (ev.actionType === 'LUNASI_PANJAR' && kasbonItem) {
                                            openLpjModal(kasbonItem);
                                          } else if (ev.actionType === 'UNGGAH_BUKTI') {
                                            openProofModal([c]);
                                          } else {
                                            setDetailTarget(c);
                                          }
                                        }}
                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 min-h-[34px] sm:min-h-0 px-2.5 rounded-lg text-[11px] font-bold transition-all cursor-pointer disabled:opacity-50 ${getCashActionVariantClass(ev.actionVariant)}`}
                                      >
                                        {ev.actionType === 'APPROVE' && <CheckCircle2 className="w-3 h-3 shrink-0" />}
                                        {ev.actionType === 'LUNASI_PANJAR' && <ClipboardCheck className="w-3 h-3 shrink-0" />}
                                        {ev.actionType === 'UNGGAH_BUKTI' && <Paperclip className="w-3 h-3 shrink-0" />}
                                        {ev.actionType === 'KOREKSI' && <FileEdit className="w-3 h-3 shrink-0" />}
                                        <span>{ev.actionLabel}</span>
                                      </button>
                                      <button
                                        type="button"
                                        title="Lihat rincian & jejak audit"
                                        aria-label="Lihat riwayat transaksi"
                                        onClick={() => setDetailTarget(c)}
                                        className="w-7 h-7 min-h-[34px] sm:min-h-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 flex items-center justify-center cursor-pointer"
                                      >
                                        <Clock className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      title={ev.actionTooltip}
                                      onClick={() => {
                                        if (ev.actionType === 'LIHAT_PENGGANTI' && replacementRow) {
                                          jumpToRow(replacementRow.id);
                                        } else {
                                          setDetailTarget(c);
                                        }
                                      }}
                                      className={`inline-flex items-center justify-center gap-1 min-w-[114px] h-7 min-h-[34px] sm:min-h-0 px-3 rounded-lg text-[11px] font-bold transition-all cursor-pointer ${getCashActionVariantClass(ev.actionVariant)}`}
                                    >
                                      {ev.actionType === 'LIHAT_PENGGANTI' ? (
                                        <ArrowUpRight className="w-3 h-3 shrink-0" />
                                      ) : (
                                        <Clock className="w-3 h-3 shrink-0" />
                                      )}
                                      <span>{ev.actionLabel}</span>
                                    </button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =================================================================
              TAB 4 — DOKUMEN RESMI ARUS KAS (TTE/QR + GANTI JABATAN CEPAT)
          ================================================================= */}
          {activeTab === 'DOCUMENTS' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Berita Acara Resmi Arus Kas (Persetujuan Berantai TTE/QR)</span>
                    </h2>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                      Alur wajib: <b>1. Terbit (Clerk)</b> → <b>2. Diperiksa (Foreman)</b> → <b>3. Disetujui (Spv.)</b> → <b>4. Disahkan TTE/QR (Dept. Mgr / KTT-PM / CEO)</b>.
                    </p>
                  </div>

                  {/* Ganti Jabatan Cepat: HANYA muncul jika pengguna sah memegang > 1 penugasan jabatan proyek */}
                  {userAssignments.length > 1 && (
                    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 rounded-xl border border-amber-200 dark:border-amber-800 shrink-0">
                      <span className="text-[11px] font-bold text-amber-900 dark:text-amber-200">
                        Ganti Jabatan Cepat:
                      </span>
                      <select
                        value={activeRole}
                        onChange={(e) => setActiveRole(e.target.value as ImpersonateRole)}
                        className="text-xs font-bold bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-lg px-2 py-1 text-slate-900 dark:text-white cursor-pointer"
                      >
                        {userAssignments
                          .map((a) => mapRoleCode(a.role_code))
                          .filter((r, i, arr) => r !== 'Viewer/Pengamat' && arr.indexOf(r) === i)
                          .map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                      </select>
                    </div>
                  )}
                </div>

                {rolePermissions.canIssue ? (
                  <form onSubmit={handleIssueCashDocument} className="space-y-3 text-xs">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[11px] font-semibold text-slate-500">Preset Periode:</span>
                      {[
                        {
                          label: 'Bulan Ini',
                          val: new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }),
                        },
                        {
                          label: 'Minggu Ini',
                          val: `Pekan ${Math.ceil(new Date().getDate() / 7)} ${new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}`,
                        },
                        { label: 'Semua Periode', val: 'Kumulatif Seluruh Periode Proyek' },
                      ].map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => setDocPeriode(p.val)}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-[11px] font-semibold cursor-pointer"
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="md:col-span-2">
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Judul Berita Acara Kas <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={docTitle}
                          onChange={(e) => setDocTitle(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                          Periode Laporan <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={docPeriode}
                          onChange={(e) => setDocPeriode(e.target.value)}
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="w-full py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-45"
                        >
                          {submitting ? 'Menerbitkan...' : '+ Terbitkan Berita Acara Kas'}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 font-medium">
                    Penerbitan Berita Acara baru dilakukan oleh <b>Clerk</b>. Jabatan Anda saat ini (<b>{activeRole}</b>) memproses pemeriksaan atau pengesahan pada baris yang menunggu giliran di bawah.
                  </div>
                )}
              </div>

              {/* Tabel Berita Acara Kas (Bebas Tombol Mati Disabled!) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th
                          onClick={() => setDocSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))}
                          className="py-3 px-3.5 cursor-pointer hover:text-blue-600 select-none"
                        >
                          <div className="inline-flex items-center gap-1">
                            <span>Kode &amp; Tanggal</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                          </div>
                        </th>
                        <th className="py-3 px-3.5">Judul Dokumen</th>
                        <th className="py-3 px-3.5">Jejak Persetujuan Serial</th>
                        <th className="py-3 px-3.5 text-center">Status</th>
                        <th className="py-3 px-3.5 text-right">Aksi Persetujuan &amp; PDF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {cashDocuments.length === 0 ? (
                        <tr>
                          <td colSpan={5} className="py-12 text-center text-slate-500 dark:text-slate-400 font-medium">
                            Belum ada Dokumen Resmi Mutasi Kas yang diterbitkan.
                          </td>
                        </tr>
                      ) : (
                        cashDocuments.map((doc) => {
                          const docDbId = doc.db_id || doc.id;
                          const wfStatus = doc.status_dokumen || 'DITERBITKAN';
                          const isDocVoid = Boolean(doc.is_batal) || wfStatus === 'BATAL';
                          const isDocReplaced = Boolean(doc.is_ganti) || wfStatus === 'DIGANTI';
                          const canCorrectDoc =
                            rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti;
                          const pendingDocAction =
                            !isDocVoid && !isDocReplaced
                              ? getPendingApprovalForRole(wfStatus, activeRole)
                              : null;

                          return (
                            <tr key={docDbId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                              <td className="py-3 px-3.5 whitespace-nowrap">
                                <div className="font-mono font-bold text-slate-900 dark:text-white">{doc.id}</div>
                                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400">
                                  {formatDateTime(doc.dibuat_pada)}
                                </div>
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="font-bold text-slate-900 dark:text-white">{doc.judul}</div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                  Penerbit: {doc.penandatangan_nama} ({doc.penandatangan_jabatan})
                                </div>
                                {doc.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-md">
                                    {doc.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-[11px] space-y-0.5">
                                <div>
                                  <span className="font-semibold">1. Terbit:</span> {doc.penandatangan_nama}
                                </div>
                                <div className={doc.diperiksa_oleh ? 'text-sky-700 dark:text-sky-300 font-medium' : 'text-slate-400'}>
                                  <span className="font-semibold">2. Diperiksa:</span> {doc.diperiksa_oleh || 'Menunggu Foreman'}
                                </div>
                                <div className={doc.disetujui_oleh ? 'text-amber-700 dark:text-amber-300 font-medium' : 'text-slate-400'}>
                                  <span className="font-semibold">3. Disetujui:</span> {doc.disetujui_oleh || 'Menunggu Spv.'}
                                </div>
                                <div className={doc.mengetahui_oleh ? 'text-teal-700 dark:text-teal-300 font-bold' : 'text-slate-400'}>
                                  <span className="font-semibold">4. Disahkan (TTE):</span> {doc.mengetahui_oleh || 'Menunggu Pimpinan'}
                                </div>
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {isDocVoid ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-200 border border-rose-300 dark:border-rose-700">
                                    <Ban className="h-3 w-3" /> Batal
                                  </span>
                                ) : isDocReplaced ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200 border border-amber-300 dark:border-amber-700">
                                    <FileEdit className="h-3 w-3" /> Diganti
                                  </span>
                                ) : wfStatus === 'MENGETAHUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-0.5 text-[10px] font-bold text-teal-800 dark:bg-teal-950/60 dark:text-teal-200 border border-teal-200 dark:border-teal-800">
                                    <QrCode className="h-3 w-3" /> Sah (TTE)
                                  </span>
                                ) : wfStatus === 'DISETUJUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                                    Disetujui
                                  </span>
                                ) : wfStatus === 'DIPERIKSA' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-[10px] font-bold text-sky-800 dark:bg-sky-950/60 dark:text-sky-200 border border-sky-200 dark:border-sky-800">
                                    <ShieldCheck className="h-3 w-3" /> Diperiksa
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                                    <Clock className="h-3 w-3" /> Diterbitkan
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center justify-end gap-1.5">
                                  {pendingDocAction && (
                                    <button
                                      type="button"
                                      disabled={submitting}
                                      onClick={() =>
                                        void handleAdvanceCashDocument(docDbId, pendingDocAction.nextTarget)
                                      }
                                      className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 min-h-[34px] sm:min-h-0 px-2.5 rounded-lg text-[11px] font-bold cursor-pointer ${getCashActionVariantClass(
                                        pendingDocAction.action === 'PERIKSA'
                                          ? 'sky'
                                          : pendingDocAction.action === 'SETUJU'
                                          ? 'amber'
                                          : 'teal'
                                      )}`}
                                    >
                                      <CheckCircle2 className="w-3 h-3" />
                                      <span>
                                        {pendingDocAction.action === 'PERIKSA'
                                          ? 'Periksa'
                                          : pendingDocAction.action === 'SETUJU'
                                          ? 'Setuju'
                                          : 'Sahkan'}
                                      </span>
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => void handleDownloadCashDocPDF(doc)}
                                    className="inline-flex items-center gap-1 h-7 min-h-[34px] sm:min-h-0 px-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer"
                                  >
                                    <QrCode className="w-3 h-3" />
                                    <span>PDF QR</span>
                                  </button>
                                  {!isDocVoid && !isDocReplaced && canCorrectDoc && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setGantiDocTargetId(docDbId);
                                          setGantiDocTitle(`${doc.judul} (Revisi)`);
                                          setGantiDocReason('');
                                        }}
                                        className="h-7 px-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-200 text-[10px] font-bold cursor-pointer"
                                      >
                                        Ganti
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setBatalDocTargetId(docDbId);
                                          setBatalDocReason('');
                                        }}
                                        className="h-7 px-2 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 text-[10px] font-bold cursor-pointer"
                                      >
                                        Batal
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* =====================================================================
          MODAL WIZARD 3 LANGKAH (DAN JALUR EKSPRES 2-KLIK)
      ===================================================================== */}
      <CashMutationWizardModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setWizardPreselectedReceipt(null);
          setWizardPreselectedCategory(undefined);
          setWizardPreselectedAmount(undefined);
          setWizardPreselectedPurpose(undefined);
        }}
        defaultType={wizardType}
        preselectedCategory={wizardPreselectedCategory}
        preselectedReceipt={wizardPreselectedReceipt}
        preselectedAmount={wizardPreselectedAmount}
        preselectedPurpose={wizardPreselectedPurpose}
        unreconciledReceipts={unreconciledReceipts}
        openKasbonList={openKasbonList}
        remainingClientAdvanceRp={clientAdvanceSummary.sisaPiutangRp}
        onSubmitCash={addCashMutation}
        onSuccessNotice={(msg) => setNoticeMessage(msg)}
      />

      {/* =====================================================================
          MODAL RINCIAN, RIWAYAT AUDIT & KOREKSI (TERMASUK INSTRUKSI PENGAWAS)
      ===================================================================== */}
      {detailTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden text-xs">
            <div className="px-5 py-3.5 bg-slate-900 text-white flex items-center justify-between">
              <div className="font-bold text-sm flex items-center gap-2">
                <History className="w-4 h-4 text-blue-400" />
                <span>Rincian &amp; Jejak Audit Transaksi Kas</span>
              </div>
              <button
                type="button"
                onClick={() => setDetailTarget(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
              <div className="flex items-start justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                <div>
                  <div className="font-bold text-sm text-slate-900 dark:text-white">
                    {detailTarget.untuk_apa}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    {formatDateTime(detailTarget.tanggal)} · {detailTarget.kategori_keperluan} ·{' '}
                    {PAYMENT_METHOD_LABELS[detailTarget.payment_method || 'TUNAI']}
                  </div>
                </div>
                <div
                  className={`font-mono font-extrabold text-sm shrink-0 ${
                    detailTarget.jenis === 'MASUK'
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {detailTarget.jenis === 'MASUK' ? '+' : '-'} {formatRupiah(detailTarget.jumlah_rp)}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px]">
                <div>
                  <span className="text-slate-500 block">Penanggung Jawab (PIC)</span>
                  <span className="font-bold text-slate-900 dark:text-white">{detailTarget.pic}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Toko / Pihak Lawan</span>
                  <span className="font-bold text-slate-900 dark:text-white">{detailTarget.nama_toko || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">No. Kuitansi / Referensi</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-white">
                    {detailTarget.nomor_kuitansi || '-'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Beban &amp; Sumber</span>
                  <span className="font-bold text-slate-900 dark:text-white">
                    {BEBAN_BIAYA_LABELS[detailTarget.beban_biaya || 'KONTRAKTOR']} ·{' '}
                    {SOURCE_MODULE_LABELS[detailTarget.source_module || 'KAS_LANGSUNG']}
                  </span>
                </div>
              </div>

              {detailTarget.catatan && (
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-700 dark:text-slate-300">
                  <b>Catatan:</b> {detailTarget.catatan}
                </div>
              )}

              {/* Jejak Persetujuan Berjenjang */}
              <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1 text-[11px]">
                <div className="font-bold text-slate-800 dark:text-slate-200 mb-1">
                  Jejak Persetujuan Berjenjang:
                </div>
                <div>1. Diterbitkan: {detailTarget.created_by_name || detailTarget.pic}</div>
                <div>2. Diperiksa: {detailTarget.diperiksa_oleh || 'Belum diperiksa'}</div>
                <div>3. Disetujui: {detailTarget.disetujui_oleh || 'Belum disetujui'}</div>
                <div>4. Disahkan (TTE): {detailTarget.mengetahui_oleh || 'Belum disahkan'}</div>
              </div>

              {detailTarget.alasan_batal_ganti && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-[11px]">
                  <b>Catatan Koreksi Audit:</b> {detailTarget.alasan_batal_ganti}
                </div>
              )}

              {/* Aksi Kontekstual di Dalam Modal Riwayat */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  {(detailTarget.lampiran_nota_urls?.length || 0) > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const t = detailTarget;
                        setDetailTarget(null);
                        openReceiptViewerForCash(t);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>Lihat Bukti HD</span>
                    </button>
                  )}

                  {!isCashRowExcluded(detailTarget) &&
                    (rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti) && (
                      <>
                        <button
                          type="button"
                          onClick={() => handleOpenGanti(detailTarget)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold cursor-pointer"
                        >
                          <FileEdit className="w-3.5 h-3.5" />
                          <span>
                            {rolePermissions.canInstructBatalGanti
                              ? 'Instruksikan Ganti'
                              : 'Ganti Transaksi'}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const t = detailTarget;
                            setDetailTarget(null);
                            setBatalTarget(t);
                            setBatalReason('');
                          }}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>
                            {rolePermissions.canInstructBatalGanti
                              ? 'Instruksikan Batal'
                              : 'Batalkan'}
                          </span>
                        </button>
                      </>
                    )}
                </div>

                <button
                  type="button"
                  onClick={() => setDetailTarget(null)}
                  className="px-4 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL PENGAMAN PENGESAHAN TTE ATAS TRANSAKSI BUKTI MENYUSUL
      ===================================================================== */}
      {tteConfirmTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <div className="w-full max-w-md rounded-2xl border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-extrabold text-slate-900 dark:text-white">
                  Peringatan Pengesahan TTE Tanpa Bukti Lengkap
                </h2>
                <p className="text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                  Transaksi <b>"{tteConfirmTarget.untuk_apa}"</b> senilai{' '}
                  <b>{formatRupiah(tteConfirmTarget.jumlah_rp)}</b> masih berstatus{' '}
                  <b>Bukti Menyusul</b>. Apakah Anda yakin tetap ingin mengesahkan dengan TTE/QR sekarang?
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setTteConfirmTarget(null)}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-bold cursor-pointer"
              >
                Tunda Dulu
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleConfirmTteWithoutProof()}
                className="px-4 py-2 rounded-xl bg-teal-600 hover:bg-teal-700 text-white font-bold cursor-pointer disabled:opacity-45"
              >
                {submitting ? 'Mengesahkan...' : 'Ya, Tetap Sahkan TTE'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =====================================================================
          MODAL PERTANGGUNGJAWABAN (LPJ) PANJAR — 3 SKENARIO BEBAS DOUBLE-COUNTING
      ===================================================================== */}
      {lpjTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={handleConfirmLpj}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden text-xs my-auto"
          >
            <div className="px-5 py-3.5 bg-indigo-950 text-white flex items-center justify-between">
              <div className="font-bold text-sm flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-indigo-300" />
                <span>Pertanggungjawaban (LPJ) &amp; Pelunasan Panjar</span>
              </div>
              <button
                type="button"
                onClick={() => setLpjTarget(null)}
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[76vh] overflow-y-auto">
              <div className="p-3 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 grid grid-cols-3 gap-2 text-center">
                <div>
                  <div className="text-[10px] text-slate-500">Panjar Awal</div>
                  <div className="font-mono font-extrabold text-slate-900 dark:text-white">
                    {formatRupiah(lpjTarget.nominalAwalRp)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Sudah LPJ/Kembali</div>
                  <div className="font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
                    {formatRupiah(lpjTarget.nominalLpjDanKembaliRp)}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-500">Sisa Terbuka</div>
                  <div className="font-mono font-extrabold text-indigo-700 dark:text-indigo-300">
                    {formatRupiah(lpjTarget.sisaTerbukaRp)}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Total Belanja Riil Sesuai Kuitansi (Rp) <span className="text-rose-500">*</span>
                  </label>
                  <CurrencyInput
                    value={lpjSpentRp}
                    onChange={(v) => setLpjSpentRp(v || 0)}
                    placeholder="Contoh: 4.350.000"
                    required
                    inputClassName="px-3 py-2 text-sm font-bold"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Kategori Biaya Riil (Reklasifikasi) <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={lpjCategory}
                    onChange={(e) => setLpjCategory(e.target.value as CashOutCategory)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-semibold"
                  >
                    {CASH_OUT_CATEGORIES.filter((c) => c !== 'Panjar / Kasbon').map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tanggal LPJ
                  </label>
                  <input
                    type="date"
                    value={lpjDate}
                    onChange={(e) => setLpjDate(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Metode Pengembalian / Kekurangan
                  </label>
                  <select
                    value={lpjMethod}
                    onChange={(e) => setLpjMethod(e.target.value as MetodePembayaran)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  >
                    {(['TUNAI', 'TRANSFER', 'GIRO_CEK', 'DOMPET_DIGITAL'] as MetodePembayaran[]).map((pm) => (
                      <option key={pm} value={pm}>
                        {PAYMENT_METHOD_LABELS[pm]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lpjIsPartial}
                  onChange={(e) => setLpjIsPartial(e.target.checked)}
                  className="rounded border-slate-300 text-indigo-600"
                />
                <span className="font-semibold">
                  Pelunasan bertahap (mandor masih memegang sisa uang muka untuk pekerjaan berjalan)
                </span>
              </label>

              {lpjIsPartial && (
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Uang Sisa yang Disetor Sekarang (Opsional, Rp)
                  </label>
                  <CurrencyInput
                    value={lpjPartialReturnRp}
                    onChange={(v) => setLpjPartialReturnRp(v || 0)}
                    placeholder="0"
                    inputClassName="px-3 py-2 text-xs"
                  />
                </div>
              )}

              {/* Unggah Foto Bukti LPJ */}
              <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                <div>
                  <div className="font-bold text-slate-800 dark:text-slate-200">
                    Foto Kuitansi LPJ ({lpjUrls.length} berkas)
                  </div>
                  <div className="text-[10px] text-slate-500">Opsional · dikompresi otomatis</div>
                </div>
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold cursor-pointer">
                  <Camera className="w-3.5 h-3.5" />
                  <span>{lpjUploading ? 'Mengunggah...' : 'Unggah Kuitansi'}</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    disabled={lpjUploading}
                    onChange={handleUploadLpjFiles}
                    className="hidden"
                  />
                </label>
              </div>

              {/* Pratinjau Dampak Otomatis Engine (Anti Double-Counting) */}
              {lpjPreviewPlan && (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-[11px] text-emerald-900 dark:text-emerald-200 space-y-1">
                  <div className="font-extrabold">Ringkasan Perhitungan Otomatis (Bebas Hitung Ganda):</div>
                  <p>{lpjPreviewPlan.summaryText}</p>
                </div>
              )}

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setLpjTarget(null)}
                  className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting || lpjUploading}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold cursor-pointer disabled:opacity-45"
                >
                  {submitting ? 'Memproses...' : 'Simpan Pelunasan LPJ'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL LENGKAPI BUKTI KUITANSI (TUNGGAL & KOLEKTIF)
      ===================================================================== */}
      {proofTargets.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <form
            onSubmit={handleSubmitProofCompletion}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-blue-600" />
                <span>Lengkapi Bukti Kuitansi ({proofTargets.length} Transaksi)</span>
              </h2>
              <button
                type="button"
                onClick={() => setProofTargets([])}
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nomor Kuitansi / Referensi
                </label>
                <input
                  type="text"
                  value={proofReceiptNo}
                  onChange={(e) => setProofReceiptNo(e.target.value)}
                  placeholder="Contoh: KWT-2026-088"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Toko / Pihak Lawan
                </label>
                <input
                  type="text"
                  value={proofStoreName}
                  onChange={(e) => setProofStoreName(e.target.value)}
                  placeholder="Nama toko / penyedia"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800">
              <div>
                <div className="font-bold text-blue-900 dark:text-blue-200">
                  Berkas Terunggah: {proofUrls.length} / 5 Lembar
                </div>
                <div className="text-[10px] text-blue-700 dark:text-blue-300">
                  Foto otomatis dikompresi &amp; masuk ke Album Kuitansi Proyek
                </div>
              </div>
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer">
                <Camera className="w-3.5 h-3.5" />
                <span>{proofUploading ? 'Mengunggah...' : 'Pilih Foto / PDF'}</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  disabled={proofUploading}
                  onChange={handleUploadBatchProof}
                  className="hidden"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setProofTargets([])}
                className="px-4 py-2 rounded-xl border border-slate-300 dark:border-slate-700 font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || proofUploading}
                className="px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold cursor-pointer disabled:opacity-45"
              >
                {submitting ? 'Menyimpan...' : 'Simpan Kelengkapan Bukti'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL KONFIRMASI BATAL KAS
      ===================================================================== */}
      {batalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmBatal}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Transaksi Kas
            </h2>
            <p className="text-slate-600 dark:text-slate-300 font-medium">
              Baris kas ini akan ditandai <b>BATAL</b> secara permanen. Riwayat audit tetap terjaga, dan nominal{' '}
              <b>{formatRupiah(batalTarget.jumlah_rp)}</b> dikeluarkan dari saldo kas.
            </p>
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Pembatalan (minimal 5 karakter) <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={batalReason}
                onChange={(e) => setBatalReason(e.target.value)}
                placeholder="Contoh: Kesalahan input ganda, dibatalkan atas verifikasi pengawas..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatalTarget(null)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 font-bold cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || batalReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 font-bold text-white hover:bg-rose-700 disabled:opacity-45 cursor-pointer"
              >
                {submitting ? 'Memproses...' : 'Ya, Batalkan Transaksi'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =====================================================================
          MODAL GANTI / REVISI KAS (MEMPERTAHANKAN TANGGAL ASLI!)
      ===================================================================== */}
      {gantiTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={handleConfirmGanti}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-3.5 text-xs my-auto"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Revisi Transaksi Kas
            </h2>
            <p className="text-slate-600 dark:text-slate-300">
              Baris lama ditandai <b>DIGANTI</b> (dinolkan) dan baris revisi baru terbit dengan tetap mempertahankan kronologi tanggal asli kecuali Anda ubah secara sadar.
            </p>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian (minimal 5 karakter) <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={gantiReason}
                onChange={(e) => setGantiReason(e.target.value)}
                placeholder="Contoh: Koreksi nominal sesuai kuitansi fisik terbaru..."
                className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Transaksi (Asli Dipertahankan)
                </label>
                <input
                  type="date"
                  required
                  value={gantiDate}
                  onChange={(e) => setGantiDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Nominal Baru (Rp)
                </label>
                <CurrencyInput
                  value={gantiAmount}
                  onChange={(val) => setGantiAmount(val || 0)}
                  required
                  inputClassName="px-3 py-2 text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Kategori</label>
                <select
                  value={gantiCategory}
                  onChange={(e) => setGantiCategory(e.target.value as KategoriMutasiKas)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {(gantiJenis === 'MASUK' ? CASH_IN_CATEGORIES : CASH_OUT_CATEGORIES).map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Metode Bayar</label>
                <select
                  value={gantiMethod}
                  onChange={(e) => setGantiMethod(e.target.value as MetodePembayaran)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                >
                  {(['TUNAI', 'TRANSFER', 'GIRO_CEK', 'DOMPET_DIGITAL'] as MetodePembayaran[]).map((pm) => (
                    <option key={pm} value={pm}>
                      {PAYMENT_METHOD_LABELS[pm]}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Penanggung Jawab (PIC)</label>
                <input
                  type="text"
                  required
                  value={gantiPic}
                  onChange={(e) => setGantiPic(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Toko / No. Kuitansi</label>
                <input
                  type="text"
                  value={gantiReceiptNo}
                  onChange={(e) => setGantiReceiptNo(e.target.value)}
                  placeholder="No. Kuitansi"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Uraian Baru</label>
              <input
                type="text"
                required
                value={gantiPurpose}
                onChange={(e) => setGantiPurpose(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">Catatan</label>
              <input
                type="text"
                value={gantiNotes}
                onChange={(e) => setGantiNotes(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGantiTarget(null)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 font-bold cursor-pointer"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || gantiReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-45 cursor-pointer"
              >
                {submitting ? 'Memproses...' : 'Simpan Transaksi Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Batal & Ganti Dokumen Resmi Kas */}
      {batalDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmBatalDoc}
            className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Dokumen Resmi Kas
            </h2>
            <textarea
              required
              rows={3}
              value={batalDocReason}
              onChange={(e) => setBatalDocReason(e.target.value)}
              placeholder="Tuliskan alasan pembatalan dokumen (minimal 5 karakter)..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-slate-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setBatalDocTargetId(null)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 font-bold cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || batalDocReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 font-bold text-white hover:bg-rose-700 disabled:opacity-45 cursor-pointer"
              >
                Ya, Batalkan Dokumen
              </button>
            </div>
          </form>
        </div>
      )}

      {gantiDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs">
          <form
            onSubmit={handleConfirmGantiDoc}
            className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-2xl space-y-4 text-xs"
          >
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Terbitkan Revisi Dokumen Kas
            </h2>
            <input
              type="text"
              required
              value={gantiDocReason}
              onChange={(e) => setGantiDocReason(e.target.value)}
              placeholder="Alasan penggantian dokumen (minimal 5 karakter)..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-slate-900 dark:text-white"
            />
            <input
              type="text"
              required
              value={gantiDocTitle}
              onChange={(e) => setGantiDocTitle(e.target.value)}
              placeholder="Judul dokumen revisi baru..."
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-2.5 text-slate-900 dark:text-white"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setGantiDocTargetId(null)}
                className="rounded-xl border border-slate-300 dark:border-slate-700 px-4 py-2 font-bold cursor-pointer"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || gantiDocReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 font-bold text-white hover:bg-amber-700 disabled:opacity-45 cursor-pointer"
              >
                Terbitkan Dokumen Pengganti
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Album Kuitansi & Nota Proyek Terpadu */}
      <ProjectReceiptAlbumModal
        isOpen={isAlbumOpen}
        onClose={() => setIsAlbumOpen(false)}
        albumItems={projectAlbumItems}
        currentUser={user}
        projectId={activeProjectId || tenantBranding.projectId}
        onOpenReceiptViewer={(primary, related) => {
          setViewerPrimaryStock(primary);
          setViewerRelatedStock(related);
          setViewerPrimaryCash(null);
          setViewerRelatedCash([]);
          setViewerScope('BELANJA_BARANG');
          setViewerOpen(true);
        }}
        onOpenCashReceiptViewer={(cash, relatedCash, relatedStock, scope) => {
          setViewerPrimaryCash(cash);
          setViewerRelatedCash(relatedCash);
          setViewerPrimaryStock(relatedStock[0] || null);
          setViewerRelatedStock(relatedStock);
          setViewerScope(scope);
          setViewerOpen(true);
        }}
        onDataChanged={async () => {
          await refreshData();
          await refreshProjectReceipts();
        }}
      />

      {/* Viewer HD Foto / PDF Bukti */}
      <ReceiptViewerModal
        isOpen={viewerOpen}
        onClose={() => setViewerOpen(false)}
        primaryMutation={viewerPrimaryStock}
        allMutationsInReceipt={viewerRelatedStock}
        primaryCashMutation={viewerPrimaryCash}
        allCashMutationsInReceipt={viewerRelatedCash}
        receiptScope={viewerScope}
      />

      {/* Modal Pengaturan Ekspor PDF Kas (4 Preset 1-Klik) */}
      <ExportSettingsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        targetType="CASH"
        title="Buku Mutasi Kas & Rekonsiliasi Dana Proyek"
        totalOriginalCount={cashMutations.length}
        initialIncludeFinancials={true}
        initialCashPreset={exportInitialPreset}
        onConfirmExport={handleConfirmExportCash}
      />
    </div>
  );
};
