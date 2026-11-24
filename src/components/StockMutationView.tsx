import { CurrencyInput } from './CurrencyInput';
import { QuantityInput } from './QuantityInput';
import React, { useState, useMemo, useRef, useEffect, useDeferredValue, startTransition } from 'react';
import { useApp } from '../context/AppContext';
import {
  ImpersonateRole,
  ItemBarang,
  PhysicalMaterialItem,
  JenisMutasiBarang,
  MutasiBarang,
  MutasiKas,
  ReceiptScope,
  StatusDokumenWorkflow,
  BebanBiaya
} from '../types';
import {
  buildTerpaduReceiptIndex,
  countPendingDocumentApprovals,
  findLinkedCashMutationsForStockMutation,
  findRelatedStockMutationsForReceipt,
  getCashActionVariantClass,
  getPendingApprovalForRole,
  isStockMutationPaidViaCash,
} from '../lib/cashflowEngine';
import { filterDocumentsForPov } from '../lib/projectReportEngine';
import {
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
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  History,
  Eye,
  Building2,
  TrendingUp,
  Filter,
  FileText,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  PackageCheck,
  Receipt,
  Paperclip,
  CheckSquare,
  Square,
  ExternalLink,
  Images,
  RotateCcw,
  RefreshCw,
  Info,
  ChevronUp,
  ArrowLeft,
  ClipboardCheck,
  Bell,
  Package
} from 'lucide-react';
import { formatDateTime, formatRupiah, generateBOQReportPDF, generateStockMutationPDF, generateWarehouseSummaryPDF } from '../lib/pdfGenerator';
import {
  analyzeIncomingProviderDiscrepancy,
  buildOccurredAtIso,
  getTodayLocalDate,
  isClientProvidedRemark,
  summarizeMaterialIncomingDiscrepancy,
  toLocalDateInput
} from '../lib/stockMutationEngine';
import {
  evaluateBoqPos,
  evaluateWarehouseMaterial,
  resolveEvalContext,
  getActionVariantClass,
  getResidualChipClass,
  BoqPosEvaluation,
  WarehouseRowEvaluation,
  BoqPosStatusKey
} from '../lib/boqExecutionEngine';
import { StockMutationWizardModal } from './StockMutationWizardModal';
import { ExportSettingsModal, ExportTargetType, ExportSettingsConfig } from './ExportSettingsModal';
import { BatchReceiptModal } from './BatchReceiptModal';
import { ReceiptViewerModal } from './ReceiptViewerModal';
import { ProjectReceiptAlbumModal } from './ProjectReceiptAlbumModal';
import { buildProjectReceiptAlbum } from '../lib/receiptStorage';

interface StockMutationViewProps {
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  preselectedItem: ItemBarang | null;
  preselectedType: JenisMutasiBarang;
  modalOnly?: boolean;
}

export const StockMutationView: React.FC<StockMutationViewProps> = ({
  isModalOpen,
  setIsModalOpen,
  preselectedItem,
  preselectedType,
  modalOnly = false,
}) => {
  const {
    items,
    physicalMaterials,
    stockMutations,
    cashMutations,
    purchaseOrders,
    documents,
    projectReceipts,
    refreshProjectReceipts,
    addStockMutation,
    batalStockMutation,
    gantiStockMutation,
    issueOfficialDocument,
    advanceDocumentWorkflow,
    batalOfficialDocument,
    gantiOfficialDocument,
    user,
    rolePermissions,
    activeRole,
    setActiveRole,
    setCurrentView,
    goBack,
    setVerifyingDocId,
    dataReady,
    activeContext,
    activeProjectId,
    tenantBranding,
    canViewFinancials,
    refreshData,
    stockTargetTab,
    setStockTargetTab,
    setProcurementTargetTab,
  } = useApp();

  // State Penyelarasan Nota Toko (Batch & Viewer Modal)
  const [selectedMutationIds, setSelectedMutationIds] = useState<string[]>([]);
  const [isBatchReceiptModalOpen, setIsBatchReceiptModalOpen] = useState<boolean>(false);
  const [batchReceiptTargets, setBatchReceiptTargets] = useState<MutasiBarang[]>([]);
  const [isReceiptViewerOpen, setIsReceiptViewerOpen] = useState<boolean>(false);
  const [viewerPrimaryMutation, setViewerPrimaryMutation] = useState<MutasiBarang | null>(null);
  const [viewerRelatedMutations, setViewerRelatedMutations] = useState<MutasiBarang[]>([]);
  const [viewerPrimaryCash, setViewerPrimaryCash] = useState<MutasiKas | null>(null);
  const [viewerRelatedCash, setViewerRelatedCash] = useState<MutasiKas[]>([]);
  const [viewerReceiptScope, setViewerReceiptScope] = useState<ReceiptScope | undefined>(undefined);

  // State Navigasi Audit Trail & Sorot Baris
  const [highlightedMutationId, setHighlightedMutationId] = useState<string | null>(null);
  const [auditDetailMutation, setAuditDetailMutation] = useState<MutasiBarang | null>(null);

  const isFinancialHidden = activeRole === 'Viewer/Pengamat' || !canViewFinancials;

  // State Album Berkas Nota Proyek (Terpadu Barang + Kuitansi Kas; Pengamat tidak melihat data kas)
  const [isProjectAlbumOpen, setIsProjectAlbumOpen] = useState<boolean>(false);
  const projectAlbumItems = useMemo(() => {
    const visibleReceipts = isFinancialHidden
      ? projectReceipts.filter((pr) => pr.receipt_scope !== 'KAS_OPERASIONAL')
      : projectReceipts;
    return buildProjectReceiptAlbum(
      stockMutations,
      visibleReceipts,
      isFinancialHidden ? [] : cashMutations,
      tenantBranding.clientName
    );
  }, [stockMutations, projectReceipts, cashMutations, isFinancialHidden, tenantBranding.clientName]);

  // Indeks Nota Gudang terbayar kas berbasis receipt_id + (no. nota & nama toko), aman dari tabrakan lintas toko
  const terpaduReceiptIndex = useMemo(() => {
    if (isFinancialHidden) return buildTerpaduReceiptIndex([], []);
    return buildTerpaduReceiptIndex(projectReceipts, cashMutations);
  }, [projectReceipts, cashMutations, isFinancialHidden]);

  const providerLabels = useMemo(
    () => ({
      contractorName: tenantBranding.contractorName,
      clientName: tenantBranding.clientName
    }),
    [tenantBranding.contractorName, tenantBranding.clientName]
  );

  const evalContext = useMemo(() => {
    return resolveEvalContext(activeRole, rolePermissions.canIssue, tenantBranding);
  }, [activeRole, rolePermissions.canIssue, tenantBranding]);

  // Antrean persetujuan mutasi yang menunggu giliran peran aktif (Foreman / Spv / Pengesah)
  const pendingWorkflowCount = useMemo(() => {
    return stockMutations.filter((m) => {
      if (m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') {
        return false;
      }
      if (activeRole === 'Foreman') return m.status_dokumen === 'DITERBITKAN';
      if (activeRole === 'Spv.') return m.status_dokumen === 'DIPERIKSA';
      if (
        activeRole === 'Dept. Manager' ||
        activeRole === 'KTT/Proj. Manager' ||
        activeRole === 'CEO/Direktur'
      ) {
        return m.status_dokumen === 'DISETUJUI';
      }
      return false;
    }).length;
  }, [stockMutations, activeRole]);

  // Antrean dokumen resmi MUTASI_STOK menunggu giliran peran aktif
  const pendingStockDocCount = useMemo(
    () => countPendingDocumentApprovals(documents || [], activeRole, 'MUTASI_STOK'),
    [documents, activeRole]
  );

  // Penugasan jabatan sah milik pengguna di proyek aktif (Ganti Jabatan Cepat hanya tampil jika > 1)
  const userProjectRoles = useMemo<ImpersonateRole[]>(() => {
    const all = activeContext?.projects || [];
    const curId = activeProjectId || tenantBranding.projectId;
    const matched = curId ? all.filter((p) => p.id === curId) : all;
    const mapRoleCode = (code?: string): ImpersonateRole | null => {
      const u = (code || '').toUpperCase();
      if (u === 'CLERK') return 'Clerk';
      if (u === 'FOREMAN') return 'Foreman';
      if (u === 'SUPERVISOR' || u === 'SPV') return 'Spv.';
      if (u === 'DEPT_MANAGER' || u === 'MANAGER') return 'Dept. Manager';
      if (u === 'KTT_PM' || u === 'PM') return 'KTT/Proj. Manager';
      if (u === 'CEO' || u === 'DIRECTOR' || u === 'DIREKTUR') return 'CEO/Direktur';
      if (u === 'VIEWER' || u === 'PENGAMAT' || u === 'OBSERVER') return 'Viewer/Pengamat';
      return null;
    };
    const roles: ImpersonateRole[] = [];
    for (const a of matched) {
      const mapped = mapRoleCode(a.role_code);
      if (mapped && !roles.includes(mapped)) {
        roles.push(mapped);
      }
    }
    return roles;
  }, [activeContext?.projects, activeProjectId, tenantBranding.projectId]);

  // Pos Jatah Klien yang belum diserahkan ke proyek (S-1 / S-4 jatah klien untuk POV Klien)
  const pendingClientDeliveriesCount = useMemo(() => {
    return items.filter((it) => {
      if (!isClientProvidedRemark(it.keterangan, tenantBranding.clientName)) return false;
      const pm = physicalMaterials.find(
        (p) => p.id === it.id || p.budget_lines.some((bl) => bl.id === it.id)
      );
      const evalPos = evaluateBoqPos(it, pm, stockMutations, evalContext);
      return evalPos.statusKey === 'BELUM_SERAH';
    }).length;
  }, [items, physicalMaterials, stockMutations, evalContext, tenantBranding.clientName]);

  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR' | 'BEDA_PENYEDIA' | 'PROYEK_BOQ' | 'PERMINTAAN_KLIEN' | 'BONUS_KLIEN' | 'OPERASIONAL'>('ALL');
  const deferredFilterType = useDeferredValue(filterType);
  const [isGuideOpen, setIsGuideOpen] = useState(false);

  // Rekapitulasi metrik transaksi mutasi untuk kartu filter interaktif
  const mutationStats = useMemo(() => {
    let masuk = 0;
    let keluar = 0;
    let boq = 0;
    let klien = 0;
    let bonus = 0;
    let ops = 0;

    stockMutations.forEach((m) => {
      if (m.jenis === 'MASUK') masuk++;
      else if (m.jenis === 'KELUAR') keluar++;

      if (m.beban_biaya === 'PROYEK_BOQ' || m.beban_biaya === 'KONTRAKTOR') boq++;
      else if (m.beban_biaya === 'KLIEN' || (m.beban_biaya as string) === 'PERMINTAAN_KLIEN') klien++;
      else if (m.beban_biaya === 'BONUS_KLIEN') bonus++;
      else if (m.beban_biaya === 'OPERASIONAL') ops++;
    });

    return { masuk, keluar, boq, klien, bonus, ops };
  }, [stockMutations]);

  const activeFilterLabel = useMemo(() => {
    switch (filterType) {
      case 'MASUK': return 'Material Masuk';
      case 'KELUAR': return 'Material Keluar';
      case 'BEDA_PENYEDIA': return 'Beda Penyedia / Talangan';
      case 'PROYEK_BOQ': return 'Proyek BOQ';
      case 'PERMINTAAN_KLIEN': return 'Minta Klien';
      case 'BONUS_KLIEN': return 'Bonus Klien';
      case 'OPERASIONAL': return 'Operasional';
      default: return 'Semua Mutasi';
    }
  }, [filterType]);

  // 4 POV Terpisah Sesuai Kesepakatan:
  // 1) WAREHOUSE_SUMMARY ("Satukan Masuk" - 1 baris per nama material fisik)
  // 2) BOQ_MONITOR ("Bedakan Keluar" - 274 pos pekerjaan BOQ tanpa duplikasi kolom masuk)
  // 3) MUTATION_HISTORY ("Jurnal Transaksi & Barang Kustom" + Matriks Panduan, koreksi langsung tanpa birokrasi per baris)
  // 4) OFFICIAL_DOCUMENTS ("Dokumen & Persetujuan Berantai TTE/QR")
  const [activeTab, setActiveTab] = useState<'WAREHOUSE_SUMMARY' | 'BOQ_MONITOR' | 'MUTATION_HISTORY' | 'OFFICIAL_DOCUMENTS'>('WAREHOUSE_SUMMARY');

  useEffect(() => {
    if (
      stockTargetTab === 'WAREHOUSE_SUMMARY' ||
      stockTargetTab === 'BOQ_MONITOR' ||
      stockTargetTab === 'MUTATION_HISTORY' ||
      stockTargetTab === 'OFFICIAL_DOCUMENTS'
    ) {
      setActiveTab(stockTargetTab);
      setStockTargetTab(null);
    }
  }, [stockTargetTab, setStockTargetTab]);

  // State untuk Tab 1: Rekap Gudang ("Satukan Masuk")
  const [warehouseSearchQuery, setWarehouseSearchQuery] = useState('');
  const deferredWarehouseSearchQuery = useDeferredValue(warehouseSearchQuery);
  const [warehouseFilter, setWarehouseFilter] = useState<'ALL' | 'HAS_ARRIVED' | 'IN_STOCK' | 'NOT_ARRIVED'>('ALL');
  const deferredWarehouseFilter = useDeferredValue(warehouseFilter);

  // State Sortir untuk Ke-4 Tabel (Rekap Gudang, Pos BOQ, Jurnal Transaksi, Dokumen Resmi)
  type SortDir = 'asc' | 'desc';
  const [warehouseSort, setWarehouseSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const deferredWarehouseSort = useDeferredValue(warehouseSort);
  const [boqSort, setBoqSort] = useState<{ key: string; dir: SortDir } | null>(null);
  const deferredBoqSort = useDeferredValue(boqSort);
  const [journalSort, setJournalSort] = useState<{ key: string; dir: SortDir }>({ key: 'tanggal', dir: 'desc' });
  const deferredJournalSort = useDeferredValue(journalSort);
  const [docSort, setDocSort] = useState<{ key: string; dir: SortDir }>({ key: 'tanggal', dir: 'desc' });
  const deferredDocSort = useDeferredValue(docSort);

  const toggleSort = (
    current: { key: string; dir: SortDir } | null,
    key: string,
    defaultDir: SortDir = 'asc'
  ): { key: string; dir: SortDir } => {
    if (current && current.key === key) {
      return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
    }
    return { key, dir: defaultDir };
  };

  const renderSortBtn = (
    label: string,
    colKey: string,
    activeSort: { key: string; dir: SortDir } | null,
    onToggle: () => void,
    align: 'left' | 'center' | 'right' = 'left'
  ) => {
    const isActive = activeSort?.key === colKey;
    const alignCls =
      align === 'right'
        ? 'justify-end ml-auto'
        : align === 'center'
        ? 'justify-center mx-auto'
        : 'justify-start';
    return (
      <button
        type="button"
        onClick={onToggle}
        title={`Urutkan berdasarkan ${label}`}
        className={`inline-flex items-center gap-1 uppercase tracking-wider font-bold hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer ${alignCls} ${
          isActive ? 'text-blue-700 dark:text-blue-300' : ''
        }`}
      >
        <span>{label}</span>
        {isActive ? (
          activeSort!.dir === 'asc' ? (
            <ArrowUp className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />
          ) : (
            <ArrowDown className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />
          )
        ) : (
          <ArrowUpDown className="w-3 h-3 shrink-0 opacity-60" />
        )}
      </button>
    );
  };

  // State untuk Tab 4: Dokumen Resmi & Persetujuan Berantai
  const [docTitle, setDocTitle] = useState('Berita Acara Rekapitulasi Mutasi Barang & Gudang');
  const [docPeriode, setDocPeriode] = useState(() => new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }));
  const [docRingkasan, setDocRingkasan] = useState('');
  const [batalDocTargetId, setBatalDocTargetId] = useState<string | null>(null);
  const [batalDocReason, setBatalDocReason] = useState('');
  const [gantiDocTargetId, setGantiDocTargetId] = useState<string | null>(null);
  const [gantiDocTitle, setGantiDocTitle] = useState('');
  const [gantiDocPeriode, setGantiDocPeriode] = useState('');
  const [gantiDocRingkasan, setGantiDocRingkasan] = useState('');
  const [gantiDocReason, setGantiDocReason] = useState('');

  // State untuk Tab 1: Pantau Pemenuhan BOQ
  const [boqSearchQuery, setBoqSearchQuery] = useState('');
  const deferredBoqSearchQuery = useDeferredValue(boqSearchQuery);
  const [boqProviderFilter, setBoqProviderFilter] = useState<'ALL' | 'KONTRAKTOR' | 'IMK'>('ALL');
  const deferredBoqProviderFilter = useDeferredValue(boqProviderFilter);
  const [boqStatusFilter, setBoqStatusFilter] = useState<'ALL' | BoqPosStatusKey | 'Belum dipenuhi' | 'Dalam pemenuhan' | 'Terpenuhi' | 'Melebihi BOQ'>('ALL');
  const deferredBoqStatusFilter = useDeferredValue(boqStatusFilter);
  const [collapsedDivisions, setCollapsedDivisions] = useState<Set<string>>(new Set());
  const [collapsedSubSections, setCollapsedSubSections] = useState<Set<string>>(new Set());
  const [isExportingWarehouse, setIsExportingWarehouse] = useState(false);
  const [isExportingBoq, setIsExportingBoq] = useState(false);
  const [isExportingJournal, setIsExportingJournal] = useState(false);

  // State Peluncur Wizard Tanya-Jawab Cerdas (StockMutationWizardModal)
  const [wizardType, setWizardType] = useState<JenisMutasiBarang>(preselectedType || 'MASUK');
  const [wizardPreselectedMaterial, setWizardPreselectedMaterial] = useState<PhysicalMaterialItem | null>(null);
  const [wizardPreselectedLineId, setWizardPreselectedLineId] = useState<string | undefined>(undefined);
  const openedInternallyRef = useRef(false);
  const wasModalOpenRef = useRef(false);

  // State khusus Modal GANTI Baris Transaksi (CRU Tanpa Hapus)
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [customItemName, setCustomItemName] = useState<string>('');
  const [customItemUom, setCustomItemUom] = useState<string>('Unit');
  const [bebanBiaya, setBebanBiaya] = useState<BebanBiaya>('KONTRAKTOR');
  const [selectedItemId, setSelectedItemId] = useState<string>('');
  const [mutationType, setMutationType] = useState<JenisMutasiBarang>(preselectedType || 'MASUK');
  const [mutationDate, setMutationDate] = useState<string>(() => getTodayLocalDate());
  const [qty, setQty] = useState<number>(1);
  const [purpose, setPurpose] = useState('');
  const [pic, setPic] = useState(user.name);
  const [suratJalan, setSuratJalan] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [ownerType] = useState<'KONTRAKTOR' | 'IMK'>('KONTRAKTOR');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingDocId, setDownloadingDocId] = useState<string | null>(null);

  // Modal Batal & Ganti States
  const [batalTarget, setBatalTarget] = useState<MutasiBarang | null>(null);
  const [batalReason, setBatalReason] = useState('');
  const [gantiTarget, setGantiTarget] = useState<MutasiBarang | null>(null);
  const [gantiReason, setGantiReason] = useState('');
  const [gantiHargaSatuan, setGantiHargaSatuan] = useState<number | ''>('');
  const [gantiIsHargaBelumDiketahui, setGantiIsHargaBelumDiketahui] = useState(false);
  const [gantiIsNotaMenyusul, setGantiIsNotaMenyusul] = useState(false);
  const [gantiNamaItemAktual, setGantiNamaItemAktual] = useState('');

  // Sinkronisasi saat modal dibuka dari luar (Dashboard / Inventaris via App.tsx)
  useEffect(() => {
    const wasOpen = wasModalOpenRef.current;
    wasModalOpenRef.current = isModalOpen;
    if (!isModalOpen || wasOpen) return;

    if (openedInternallyRef.current) {
      openedInternallyRef.current = false;
      return;
    }

    setWizardType(preselectedType || 'MASUK');
    if (preselectedItem) {
      const matchedPm =
        physicalMaterials.find(
          (pm) => pm.id === preselectedItem.id || pm.budget_lines.some((bl) => bl.id === preselectedItem.id)
        ) || null;
      setWizardPreselectedMaterial(matchedPm);
      setWizardPreselectedLineId(preselectedItem.id);
    } else {
      setWizardPreselectedMaterial(null);
      setWizardPreselectedLineId(undefined);
    }
  }, [isModalOpen, preselectedItem, preselectedType, physicalMaterials]);

  // Material Fisik Terpadu untuk referensi Ganti baris
  const currentPhysicalMaterial = useMemo(() => {
    if (!physicalMaterials || physicalMaterials.length === 0 || !selectedItemId) return null;
    return (
      physicalMaterials.find(
        (pm) => pm.id === selectedItemId || pm.budget_lines.some((bl) => bl.id === selectedItemId)
      ) || null
    );
  }, [physicalMaterials, selectedItemId]);

  const existingCustomItems = useMemo(() => {
    const map = new Map<string, { nama_barang: string; satuan: string; stok: number; lastPurposeIn: string }>();
    [...stockMutations].reverse().forEach((m) => {
      if (!m.is_custom_item || m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') return;
      const k = `${(m.nama_barang || '').trim().toLowerCase()}|${(m.satuan || '').trim().toLowerCase()}`;
      if (!map.has(k)) {
        map.set(k, { nama_barang: m.nama_barang, satuan: m.satuan, stok: 0, lastPurposeIn: '' });
      }
      const entry = map.get(k)!;
      entry.stok += m.jenis === 'MASUK' ? m.jumlah : -m.jumlah;
      if (m.jenis === 'MASUK' && m.tujuan_keperluan) {
        entry.lastPurposeIn = m.tujuan_keperluan;
      }
    });
    return Array.from(map.values());
  }, [stockMutations]);

  const filteredMutations = useMemo(() => {
    const q = deferredSearchQuery.toLowerCase();
    const list = stockMutations.filter((m) => {
      const matchSearch =
        (m.nama_barang || '').toLowerCase().includes(q) ||
        (m.nama_item_aktual || '').toLowerCase().includes(q) ||
        (m.tujuan_keperluan || '').toLowerCase().includes(q) ||
        (m.pic_penerima_penyerah || '').toLowerCase().includes(q) ||
        (m.source_name || '').toLowerCase().includes(q) ||
        (m.nama_toko || '').toLowerCase().includes(q) ||
        (m.nomor_nota || '').toLowerCase().includes(q) ||
        (m.nomor_surat_jalan && m.nomor_surat_jalan.toLowerCase().includes(q)) ||
        (m.id || '').toLowerCase().includes(q) ||
        (m.referensi_ganti_id || '').toLowerCase().includes(q);

      let matchFilter = true;
      if (deferredFilterType === 'MASUK') matchFilter = m.jenis === 'MASUK';
      else if (deferredFilterType === 'KELUAR') matchFilter = m.jenis === 'KELUAR';
      else if (deferredFilterType === 'BEDA_PENYEDIA') {
        matchFilter = !m.is_batal && !m.is_ganti && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI' &&
          analyzeIncomingProviderDiscrepancy(m, physicalMaterials, stockMutations, providerLabels).isMismatch;
      }
      else if (deferredFilterType === 'PROYEK_BOQ') matchFilter = m.beban_biaya === 'PROYEK_BOQ' || m.beban_biaya === 'KONTRAKTOR';
      else if (deferredFilterType === 'PERMINTAAN_KLIEN') matchFilter = m.beban_biaya === 'KLIEN' || (m.beban_biaya as string) === 'PERMINTAAN_KLIEN';
      else if (deferredFilterType === 'BONUS_KLIEN') matchFilter = m.beban_biaya === 'BONUS_KLIEN';
      else if (deferredFilterType === 'OPERASIONAL') matchFilter = m.beban_biaya === 'OPERASIONAL';

      return matchSearch && matchFilter;
    });

    const mult = deferredJournalSort.dir === 'asc' ? 1 : -1;
    const statusRank = (m: MutasiBarang) =>
      m.is_batal || m.status_dokumen === 'BATAL'
        ? 0
        : m.is_ganti || m.status_dokumen === 'DIGANTI'
        ? 1
        : 2;

    return [...list].sort((a, b) => {
      switch (deferredJournalSort.key) {
        case 'tanggal':
          return (new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime()) * mult;
        case 'jenis':
          return (a.jenis || '').localeCompare(b.jenis || '') * mult;
        case 'nama_barang':
          return (a.nama_barang || '').localeCompare(b.nama_barang || '') * mult;
        case 'jumlah':
          return ((a.jumlah || 0) - (b.jumlah || 0)) * mult;
        case 'status':
          return (statusRank(a) - statusRank(b)) * mult;
        default:
          return 0;
      }
    });
  }, [stockMutations, deferredSearchQuery, deferredFilterType, deferredJournalSort, physicalMaterials, providerLabels]);

  const providerMismatchCount = useMemo(
    () =>
      stockMutations.filter(
        (m) =>
          !m.is_batal &&
          !m.is_ganti &&
          m.status_dokumen !== 'BATAL' &&
          m.status_dokumen !== 'DIGANTI' &&
          analyzeIncomingProviderDiscrepancy(m, physicalMaterials, stockMutations, providerLabels).isMismatch
      ).length,
    [stockMutations, physicalMaterials, providerLabels]
  );

  // Helper resolusi harga satuan efektif transaksi mutasi (baik MASUK maupun KELUAR)
  const getMutationEffectivePrice = (mut: MutasiBarang): number | null => {
    if (mut.harga_satuan_beli != null && Number(mut.harga_satuan_beli) > 0) {
      return Number(mut.harga_satuan_beli);
    }
    const pm = (physicalMaterials || []).find(
      (p) => p.id === mut.barang_id || p.nama_barang.trim().toLowerCase() === (mut.nama_barang || '').trim().toLowerCase()
    );
    if (pm) {
      const p =
        pm.harga_beli_rata_rata ||
        pm.harga_beli_terakhir ||
        (pm.total_qty_masuk > 0 && pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0
          ? Math.round(pm.total_nilai_belanja_riil / pm.total_qty_masuk)
          : 0);
      if (p > 0) return p;
    }
    const boq = items.find(
      (it) => it.id === mut.barang_id || it.nama_barang.trim().toLowerCase() === (mut.nama_barang || '').trim().toLowerCase()
    );
    if (boq && boq.harga_satuan > 0) {
      return boq.harga_satuan;
    }
    return null;
  };

  // Helper Pengelompokan Kategori BOQ dengan cache instan
  const categoryCacheRef = useRef<Map<string, { division: string; subSection: string }>>(new Map());
  const parseCategory = (cat: string) => {
    let hit = categoryCacheRef.current.get(cat);
    if (hit) return hit;
    if (cat.includes(' / ')) {
      const parts = cat.split(' / ');
      hit = {
        division: parts[0].trim(),
        subSection: parts.slice(1).join(' / ').trim()
      };
    } else if (cat.startsWith('IV.')) {
      hit = {
        division: 'IV - BIAYA JASA & PEKERJAAN',
        subSection: cat.trim()
      };
    } else {
      hit = {
        division: cat || 'Kategori Umum',
        subSection: cat || 'Umum'
      };
    }
    categoryCacheRef.current.set(cat, hit);
    return hit;
  };

  const toggleDivision = (divName: string) => {
    startTransition(() => {
      setCollapsedDivisions((prev) => {
        const next = new Set(prev);
        if (next.has(divName)) next.delete(divName);
        else next.add(divName);
        return next;
      });
    });
  };

  const toggleSubSection = (subKey: string) => {
    startTransition(() => {
      setCollapsedSubSections((prev) => {
        const next = new Set(prev);
        if (next.has(subKey)) next.delete(subKey);
        else next.add(subKey);
        return next;
      });
    });
  };

  const handleExpandAll = () => {
    startTransition(() => {
      setCollapsedDivisions(new Set());
      setCollapsedSubSections(new Set());
    });
  };

  // Grouped BOQ Data untuk Tab 1 (Dioptimasi dengan useDeferredValue)
  const groupedBoqData = useMemo(() => {
    const q = deferredBoqSearchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const isClientItem = isClientProvidedRemark(item.keterangan, tenantBranding.clientName);
      if (deferredBoqProviderFilter === 'IMK' && !isClientItem) return false;
      if (deferredBoqProviderFilter === 'KONTRAKTOR' && isClientItem) return false;
      if (deferredBoqStatusFilter !== 'ALL') {
        const pm = physicalMaterials.find(
          (p) => p.id === item.id || p.budget_lines.some((bl) => bl.id === item.id)
        );
        const evalPos = evaluateBoqPos(item, pm, stockMutations, evalContext);
        if (evalPos.statusKey !== deferredBoqStatusFilter && item.status_pemenuhan !== deferredBoqStatusFilter) {
          return false;
        }
      }
      if (q) {
        const matchName = item.nama_barang.toLowerCase().includes(q);
        const matchCode = (item.kode_boq || '').toLowerCase().includes(q);
        const matchCat = (item.kategori || '').toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchCat) return false;
      }
      return true;
    });

    const divisionMap = new Map<string, Map<string, ItemBarang[]>>();

    filtered.forEach((item) => {
      const { division, subSection } = parseCategory(item.kategori || '');
      if (!divisionMap.has(division)) {
        divisionMap.set(division, new Map());
      }
      const subMap = divisionMap.get(division)!;
      if (!subMap.has(subSection)) {
        subMap.set(subSection, []);
      }
      subMap.get(subSection)!.push(item);
    });

    const divisions: {
      name: string;
      subSections: {
        name: string;
        items: ItemBarang[];
        totalQtyBoq: number;
        totalMasuk: number;
        totalKeluar: number;
        totalSisa: number;
        imkCount: number;
        kontraktorCount: number;
      }[];
      totalItems: number;
      totalMasuk: number;
      totalKeluar: number;
    }[] = [];

    divisionMap.forEach((subMap, divName) => {
      const subSections: {
        name: string;
        items: ItemBarang[];
        totalQtyBoq: number;
        totalMasuk: number;
        totalKeluar: number;
        totalSisa: number;
        imkCount: number;
        kontraktorCount: number;
      }[] = [];

      let divItemsCount = 0;
      let divMasuk = 0;
      let divKeluar = 0;

      subMap.forEach((subItems, subName) => {
        const boqStatusRank = (it: ItemBarang) =>
          it.status_pemenuhan === 'Melebihi BOQ'
            ? 3
            : it.status_pemenuhan === 'Terpenuhi'
            ? 2
            : it.status_pemenuhan === 'Dalam pemenuhan'
            ? 1
            : 0;

        if (!deferredBoqSort) {
          subItems.sort((a, b) => (a.source_excel_row || 0) - (b.source_excel_row || 0));
        } else {
          const mult = deferredBoqSort.dir === 'asc' ? 1 : -1;
          subItems.sort((a, b) => {
            switch (deferredBoqSort.key) {
              case 'kode_boq':
                return (a.kode_boq || '').localeCompare(b.kode_boq || '', 'id', { numeric: true }) * mult;
              case 'nama_barang':
                return (a.nama_barang || '').localeCompare(b.nama_barang || '') * mult;
              case 'penyedia': {
                const aImk = isClientProvidedRemark(a.keterangan, tenantBranding.clientName) ? 1 : 0;
                const bImk = isClientProvidedRemark(b.keterangan, tenantBranding.clientName) ? 1 : 0;
                return (aImk - bImk) * mult;
              }
              case 'qty_boq':
                return ((a.qty_boq || 0) - (b.qty_boq || 0)) * mult;
              case 'qty_keluar_total':
                return ((a.qty_keluar_total || 0) - (b.qty_keluar_total || 0)) * mult;
              case 'qty_pemenuhan_sisa':
                return ((a.qty_pemenuhan_sisa || 0) - (b.qty_pemenuhan_sisa || 0)) * mult;
              case 'stok_saat_ini':
                return ((a.stok_saat_ini || 0) - (b.stok_saat_ini || 0)) * mult;
              case 'status_pemenuhan':
                return (boqStatusRank(a) - boqStatusRank(b)) * mult;
              default:
                return 0;
            }
          });
        }

        let subQtyBoq = 0;
        let subMasuk = 0;
        let subKeluar = 0;
        let subSisa = 0;
        let imkCount = 0;
        let kontraktorCount = 0;

        subItems.forEach((it) => {
          subQtyBoq += it.qty_boq;
          subMasuk += it.qty_masuk_total;
          subKeluar += it.qty_keluar_total;
          subSisa += it.qty_pemenuhan_sisa;
          if (isClientProvidedRemark(it.keterangan, tenantBranding.clientName)) {
            imkCount++;
          } else {
            kontraktorCount++;
          }
        });

        divItemsCount += subItems.length;
        divMasuk += subMasuk;
        divKeluar += subKeluar;

        subSections.push({
          name: subName,
          items: subItems,
          totalQtyBoq: subQtyBoq,
          totalMasuk: subMasuk,
          totalKeluar: subKeluar,
          totalSisa: subSisa,
          imkCount,
          kontraktorCount
        });
      });

      divisions.push({
        name: divName,
        subSections,
        totalItems: divItemsCount,
        totalMasuk: divMasuk,
        totalKeluar: divKeluar
      });
    });

    return divisions;
  }, [items, physicalMaterials, stockMutations, evalContext, deferredBoqSearchQuery, deferredBoqProviderFilter, deferredBoqStatusFilter, deferredBoqSort, tenantBranding.clientName]);

  // Memoized daftar item BOQ yang lolos filter layar untuk mencegah kalkulasi berat berulang
  const visibleBoqItems = useMemo(() => {
    return groupedBoqData.flatMap((d) => d.subSections.flatMap((s) => s.items));
  }, [groupedBoqData]);

  const handleCollapseAll = () => {
    startTransition(() => {
      const allDivs = new Set(groupedBoqData.map((d) => d.name));
      const allSubs = new Set<string>();
      groupedBoqData.forEach((d) => {
        d.subSections.forEach((s) => allSubs.add(`${d.name}__${s.name}`));
      });
      setCollapsedDivisions(allDivs);
      setCollapsedSubSections(allSubs);
    });
  };

  // Metrik Progres Kontrak BOQ Keseluruhan (Satukan Masuk di Gudang, Bedakan Keluar per Pos BOQ)
  const boqMetrics = useMemo(() => {
    const totalItems = items.length;
    let fulfilledCount = 0;
    let inProgressCount = 0;
    let notStartedCount = 0;
    let overQuotaCount = 0;
    let totalImkItems = 0;
    let totalKontraktorItems = 0;
    let arrivedPosCoverageCount = 0;
    let contractMaterialTotal = 0;
    let contractManpowerTotal = 0;
    let clientFreeIssueTotal = 0;

    items.forEach((it) => {
      const isClientItem = isClientProvidedRemark(it.keterangan, tenantBranding.clientName);
      const lineVal = (Number(it.harga_satuan) || 0) * (Number(it.qty_boq) || 0);
      if (isClientItem) {
        totalImkItems++;
        clientFreeIssueTotal += lineVal;
      } else {
        totalKontraktorItems++;
        const catUpper = (it.kategori || '').toUpperCase();
        const isManpower = !it.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH');
        if (isManpower) contractManpowerTotal += lineVal;
        else contractMaterialTotal += lineVal;
      }

      if (it.qty_masuk_total > 0) arrivedPosCoverageCount++;

      if (it.status_pemenuhan === 'Terpenuhi') fulfilledCount++;
      else if (it.status_pemenuhan === 'Dalam pemenuhan') inProgressCount++;
      else if (it.status_pemenuhan === 'Melebihi BOQ') overQuotaCount++;
      else notStartedCount++;
    });

    const arrivedMaterialTypesCount = (physicalMaterials || []).filter((pm) => pm.total_qty_masuk > 0).length;
    const totalMaterialTypesCount = (physicalMaterials || []).filter((pm) => pm.is_stock_item).length;
    const progressPct = totalItems > 0 ? Math.round(((fulfilledCount + overQuotaCount + inProgressCount * 0.5) / totalItems) * 100) : 0;
    const contractGrandTotal = contractMaterialTotal + contractManpowerTotal;

    return {
      totalItems,
      fulfilledCount,
      inProgressCount,
      notStartedCount,
      overQuotaCount,
      totalImkItems,
      totalKontraktorItems,
      arrivedPosCoverageCount,
      arrivedMaterialTypesCount,
      totalMaterialTypesCount,
      progressPct,
      contractMaterialTotal,
      contractManpowerTotal,
      contractGrandTotal,
      clientFreeIssueTotal
    };
  }, [items, physicalMaterials, tenantBranding.clientName]);

  // Metrik Finansial Riil Proyek (Masuk Dibeli, Keluar Terpasang & Estimasi Efisiensi Profit)
  const financialExecutionMetrics = useMemo(() => {
    let totalInValue = 0;
    let materialInValue = 0;
    let manpowerInValue = 0;

    let totalOutValue = 0;
    let materialOutValue = 0;
    let manpowerOutValue = 0;

    let boqValueOfImplemented = 0;

    // Lookup harga riil
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

    const boqPriceMap = new Map<string, number>();
    items.forEach((it) => {
      if (it.harga_satuan > 0) {
        boqPriceMap.set(it.id, it.harga_satuan);
        boqPriceMap.set(it.nama_barang.trim().toLowerCase(), it.harga_satuan);
      }
    });

    stockMutations.forEach((m) => {
      if (m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') return;

      const qty = Number(m.jumlah || 0);
      const explicitPrice =
        m.harga_satuan_beli != null && Number(m.harga_satuan_beli) > 0 ? Number(m.harga_satuan_beli) : null;
      const fallbackPrice =
        materialPriceMap.get(m.barang_id) ||
        materialPriceMap.get((m.nama_barang || '').trim().toLowerCase()) ||
        boqPriceMap.get(m.barang_id) ||
        boqPriceMap.get((m.nama_barang || '').trim().toLowerCase()) ||
        0;

      const effPrice = explicitPrice ?? fallbackPrice;
      const lineTotal = qty * effPrice;

      const targetBoq = items.find(
        (it) => it.id === m.barang_id || it.nama_barang.trim().toLowerCase() === (m.nama_barang || '').trim().toLowerCase()
      );
      const catUpper = (targetBoq?.kategori || '').toUpperCase();
      const isManpower = targetBoq
        ? (!targetBoq.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH'))
        : false;

      if (m.jenis === 'MASUK') {
        totalInValue += lineTotal;
        if (isManpower) manpowerInValue += lineTotal;
        else materialInValue += lineTotal;
      } else if (m.jenis === 'KELUAR') {
        totalOutValue += lineTotal;
        if (isManpower) manpowerOutValue += lineTotal;
        else materialOutValue += lineTotal;

        if (targetBoq && targetBoq.harga_satuan > 0) {
          boqValueOfImplemented += qty * targetBoq.harga_satuan;
        }
      }
    });

    const contractGrandTotal = boqMetrics.contractGrandTotal || 0;
    const sisaPaguKontrak = Math.max(0, contractGrandTotal - totalInValue);
    const penyerapanPct = contractGrandTotal > 0 ? (totalInValue / contractGrandTotal) * 100 : 0;
    const serapanLapanganPct = contractGrandTotal > 0 ? (totalOutValue / contractGrandTotal) * 100 : 0;

    // Selisih efisiensi belanja (Pagu BOQ vs Biaya Beli Riil)
    const hematBelanja = Math.max(0, boqValueOfImplemented - totalOutValue);

    return {
      totalInValue,
      materialInValue,
      manpowerInValue,
      totalOutValue,
      materialOutValue,
      manpowerOutValue,
      sisaPaguKontrak,
      penyerapanPct,
      serapanLapanganPct,
      hematBelanja
    };
  }, [stockMutations, physicalMaterials, items, boqMetrics.contractGrandTotal]);

  // Metrik Kewajiban Free-Issue Klien (IN / OUT / SISA & Item / Nominal)
  const clientObligationStats = useMemo(() => {
    const clientItems = items.filter((it) =>
      isClientProvidedRemark(it.keterangan, tenantBranding.clientName)
    );
    const totalItems = clientItems.length;
    let totalNominal = 0;
    let arrivedItemsCount = 0;
    let fullyArrivedCount = 0;
    let consumedItemsCount = 0;
    let pendingItemsCount = 0;

    let totalQtyBoq = 0;
    let totalQtyMasuk = 0;
    let totalQtyKeluar = 0;

    clientItems.forEach((it) => {
      const lineVal = (Number(it.harga_satuan) || 0) * (Number(it.qty_boq) || 0);
      totalNominal += lineVal;

      const qtyBoq = Number(it.qty_boq) || 0;
      const qtyMasuk = Number(it.qty_masuk_total) || 0;
      const qtyKeluar = Number(it.qty_keluar_total) || 0;

      totalQtyBoq += qtyBoq;
      totalQtyMasuk += qtyMasuk;
      totalQtyKeluar += qtyKeluar;

      if (qtyMasuk > 0) arrivedItemsCount++;
      if (qtyMasuk >= qtyBoq && qtyBoq > 0) fullyArrivedCount++;
      if (qtyKeluar > 0) consumedItemsCount++;
      if (qtyMasuk === 0) pendingItemsCount++;
    });

    const totalQtySisa = Math.max(0, totalQtyBoq - totalQtyMasuk);

    return {
      totalItems,
      totalNominal,
      arrivedItemsCount,
      fullyArrivedCount,
      consumedItemsCount,
      pendingItemsCount,
      totalQtyBoq,
      totalQtyMasuk,
      totalQtyKeluar,
      totalQtySisa
    };
  }, [items, tenantBranding.clientName]);

  // Aksi Cepat Catat Masuk langsung dari 1 Baris Material Gudang ("Satukan Masuk")
  const handleOpenWarehouseMaterialIn = (pm: PhysicalMaterialItem) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    openedInternallyRef.current = true;
    setWizardType('MASUK');
    setWizardPreselectedMaterial(pm);
    setWizardPreselectedLineId(pm.budget_lines[0]?.id);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  // Aksi Cepat Catat Pakai / Keluar langsung dari 1 Baris Material Gudang
  const handleOpenWarehouseMaterialOut = (pm: PhysicalMaterialItem) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    if (pm.stok_fisik <= 0) {
      setErrorMessage(`Stok fisik ${pm.nama_barang} di gudang saat ini kosong (0 ${pm.satuan}). Tidak ada saldo fisik untuk dipakai.`);
      return;
    }
    openedInternallyRef.current = true;
    setWizardType('KELUAR');
    setWizardPreselectedMaterial(pm);
    // Prioritaskan pos BOQ yang masih memiliki sisa alokasi pemenuhan
    const targetLine = pm.budget_lines.find((bl) => bl.sisa_anggaran > 0) || pm.budget_lines[0];
    setWizardPreselectedLineId(targetLine?.id);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  // Filter Material Gudang untuk Tab 1 ("Satukan Masuk" - 1 Baris per Nama Material)
  const filteredWarehouseMaterials = useMemo(() => {
    const q = deferredWarehouseSearchQuery.trim().toLowerCase();
    const list = (physicalMaterials || [])
      .filter((pm) => pm.is_stock_item)
      .filter((pm) => {
        if (deferredWarehouseFilter === 'HAS_ARRIVED' && pm.total_qty_masuk <= 0) return false;
        if (deferredWarehouseFilter === 'IN_STOCK' && pm.stok_fisik <= 0) return false;
        if (deferredWarehouseFilter === 'NOT_ARRIVED' && pm.total_qty_masuk > 0) return false;
        if (q) {
          const matchName = pm.nama_barang.toLowerCase().includes(q);
          const matchUom = pm.satuan.toLowerCase().includes(q);
          const matchBoq = pm.budget_lines.some(
            (bl) => bl.kode_boq.toLowerCase().includes(q) || bl.kategori.toLowerCase().includes(q)
          );
          if (!matchName && !matchUom && !matchBoq) return false;
        }
        return true;
      });

    const whStatusRank = (pm: PhysicalMaterialItem) =>
      pm.stok_fisik > 0 ? 2 : pm.total_qty_masuk > 0 ? 1 : 0;

    return [...list].sort((a, b) => {
      if (!deferredWarehouseSort) {
        if (a.total_qty_masuk > 0 && b.total_qty_masuk === 0) return -1;
        if (a.total_qty_masuk === 0 && b.total_qty_masuk > 0) return 1;
        return a.nama_barang.localeCompare(b.nama_barang);
      }
      const mult = deferredWarehouseSort.dir === 'asc' ? 1 : -1;
      switch (deferredWarehouseSort.key) {
        case 'nama_barang':
          return a.nama_barang.localeCompare(b.nama_barang) * mult;
        case 'satuan':
          return (a.satuan || '').localeCompare(b.satuan || '') * mult;
        case 'total_qty_boq':
          return ((a.total_qty_boq || 0) - (b.total_qty_boq || 0)) * mult;
        case 'total_qty_masuk':
          return ((a.total_qty_masuk || 0) - (b.total_qty_masuk || 0)) * mult;
        case 'sisa_belum_tiba': {
          const aSisa = Math.max(0, (a.total_qty_boq || 0) - (a.total_qty_masuk || 0));
          const bSisa = Math.max(0, (b.total_qty_boq || 0) - (b.total_qty_masuk || 0));
          return (aSisa - bSisa) * mult;
        }
        case 'total_qty_keluar':
          return ((a.total_qty_keluar || 0) - (b.total_qty_keluar || 0)) * mult;
        case 'stok_fisik':
          return ((a.stok_fisik || 0) - (b.stok_fisik || 0)) * mult;
        case 'harga_beli_rata_rata':
          return ((a.harga_beli_rata_rata || 0) - (b.harga_beli_rata_rata || 0)) * mult;
        case 'total_nilai_belanja_riil':
          return ((a.total_nilai_belanja_riil || 0) - (b.total_nilai_belanja_riil || 0)) * mult;
        case 'status':
          return (whStatusRank(a) - whStatusRank(b)) * mult;
        default:
          return 0;
      }
    });
  }, [physicalMaterials, deferredWarehouseSearchQuery, deferredWarehouseFilter, deferredWarehouseSort]);

  // Daftar Dokumen Resmi Mutasi Barang (Tab 4 — tersaring ketat sesuai privasi POV)
  const stockDocuments = useMemo(() => {
    const povDocuments = filterDocumentsForPov(
      documents || [],
      isFinancialHidden ? 'KLIEN' : 'KONTRAKTOR'
    );
    const list = povDocuments.filter(
      (d) => d.jenis === 'MUTASI_STOK' || d.jenis === 'GABUNGAN_PROYEK'
    );
    const mult = deferredDocSort.dir === 'asc' ? 1 : -1;
    const wfRank = (s?: string) => {
      if (s === 'MENGETAHUI') return 4;
      if (s === 'DISETUJUI') return 3;
      if (s === 'DIPERIKSA') return 2;
      if (s === 'DITERBITKAN') return 1;
      return 0;
    };
    return [...list].sort((a, b) => {
      switch (deferredDocSort.key) {
        case 'tanggal':
          return (new Date(a.dibuat_pada).getTime() - new Date(b.dibuat_pada).getTime()) * mult;
        case 'judul':
          return (a.judul || '').localeCompare(b.judul || '') * mult;
        case 'status':
          return (wfRank(a.status_dokumen) - wfRank(b.status_dokumen)) * mult;
        default:
          return 0;
      }
    });
  }, [documents, isFinancialHidden, deferredDocSort]);

  // Aksi Cepat Mutasi dari Baris Material BOQ (Khusus Pemakaian / Keluar per Pos di Tab 2)
  const handleOpenItemMutation = (item: ItemBarang, type: JenisMutasiBarang) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    openedInternallyRef.current = true;
    const matchedPm: PhysicalMaterialItem = physicalMaterials.find(
      (pm) => pm.id === item.id || pm.budget_lines.some((bl) => bl.id === item.id)
    ) || {
      id: item.id,
      nama_barang: item.nama_barang,
      satuan: item.satuan,
      stok_fisik: item.stok_saat_ini,
      total_qty_boq: item.qty_boq,
      total_qty_masuk: item.qty_masuk_total,
      total_qty_keluar: item.qty_keluar_total,
      is_stock_item: item.is_stock_item,
      budget_lines: [
        {
          id: item.id,
          kode_boq: item.kode_boq,
          kategori: item.kategori,
          qty_boq: item.qty_boq,
          qty_keluar_total: item.qty_keluar_total,
          sisa_anggaran: item.qty_pemenuhan_sisa,
          keterangan: item.keterangan
        }
      ]
    };

    setWizardType(type);
    setWizardPreselectedMaterial(matchedPm);
    setWizardPreselectedLineId(item.id);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  // Navigasi ke Tab 3 (Jurnal Mutasi) khusus untuk item ini (transisi halus)
  const handleViewItemHistory = (itemName: string) => {
    startTransition(() => {
      setActiveTab('MUTATION_HISTORY');
      setSearchQuery(itemName);
      setFilterType('ALL');
    });
  };

  // Navigasi Interaktif Jejak Audit: Melompat langsung ke Baris Pengganti atau Baris Asal
  const handleNavigateToMutation = (targetId: string) => {
    const target = stockMutations.find((m) => m.id === targetId);
    if (!target) {
      setErrorMessage(`Transaksi mutasi dengan ID #${targetId.slice(0, 8)} tidak ditemukan.`);
      return;
    }

    startTransition(() => {
      setActiveTab('MUTATION_HISTORY');
      if (filterType !== 'ALL' && filterType !== target.jenis) {
        setFilterType('ALL');
      }
      // Jika kata kunci pencarian menyembunyikan target, bersihkan agar baris target terlihat
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTarget =
          (target.nama_barang || '').toLowerCase().includes(q) ||
          (target.nama_item_aktual || '').toLowerCase().includes(q) ||
          (target.nomor_nota || '').toLowerCase().includes(q) ||
          target.id.toLowerCase().includes(q);
        if (!matchesTarget) {
          setSearchQuery('');
        }
      }
    });

    setHighlightedMutationId(targetId);

    const isTargetActive = !target.is_batal && !target.is_ganti;
    if (isTargetActive) {
      setNoticeMessage(
        `Menyorot baris transaksi sah pengganti #${target.id.slice(0, 6).toUpperCase()} (${target.nama_barang}) · Jumlah: ${target.jumlah} ${target.satuan}`
      );
    } else {
      setNoticeMessage(
        `Menyorot riwayat data asal #${target.id.slice(0, 6).toUpperCase()} (${target.nama_barang}) yang telah dinolkan/digantikan.`
      );
    }

    setTimeout(() => {
      const el = document.getElementById(`mutation-row-${targetId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 120);

    setTimeout(() => {
      setHighlightedMutationId((curr) => (curr === targetId ? null : curr));
    }, 4500);
  };

  // Navigasi dari Badge BOQ ke Tab Realisasi BOQ
  const handleNavigateToBoq = (barangId?: string, namaBarang?: string) => {
    startTransition(() => {
      setActiveTab('BOQ_MONITOR');
      if (namaBarang) {
        setBoqSearchQuery(namaBarang);
      }
      setBoqStatusFilter('ALL');
      setBoqProviderFilter('ALL');
    });

    setNoticeMessage(`Beralih ke tab Realisasi BOQ untuk memantau pos: ${namaBarang || 'Material Terpilih'}`);

    if (barangId) {
      setTimeout(() => {
        const el = document.getElementById(`boq-item-${barangId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);
    }
  };

  // Badge Status Pos Pekerjaan BOQ (Multi-POV Engine Dinamis)
  const renderBoqStatusBadge = (item: ItemBarang, evalPos?: BoqPosEvaluation) => {
    if (evalPos) {
      return (
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${evalPos.statusBadgeClass}`}
          title={evalPos.statusDescription}
        >
          {evalPos.statusKey === 'TUNTAS' ? (
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          ) : evalPos.statusKey === 'PROSES' ? (
            <TrendingUp className="w-3 h-3 text-amber-600 dark:text-amber-400" />
          ) : evalPos.statusKey === 'HABIS' ? (
            <AlertTriangle className="w-3 h-3 text-orange-600 dark:text-orange-400" />
          ) : evalPos.statusKey === 'LEBIH' ? (
            <AlertTriangle className="w-3 h-3 text-purple-600 dark:text-purple-400" />
          ) : evalPos.statusKey === 'SIAP_PAKAI' ? (
            <CheckCircle2 className="w-3 h-3 text-cyan-600 dark:text-cyan-400" />
          ) : evalPos.statusKey === 'BELUM_SERAH' ? (
            <Package className="w-3 h-3 text-purple-600 dark:text-purple-400" />
          ) : (
            <Clock className="w-3 h-3 text-slate-500 dark:text-slate-300" />
          )}
          <span>{evalPos.statusLabel}</span>
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700">
        <Clock className="w-3 h-3 text-slate-500 dark:text-slate-300" />
        <span>{item.status_pemenuhan}</span>
      </span>
    );
  };

  const handleOpenNewModal = (type: JenisMutasiBarang = 'MASUK') => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    openedInternallyRef.current = true;
    setWizardType(type);
    setWizardPreselectedMaterial(null);
    setWizardPreselectedLineId(undefined);
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  // Konfirmasi BATAL Mutasi
  const handleConfirmBatal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalStockMutation(batalTarget.id, batalReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalTarget(null);
        setBatalReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membatalkan transaksi.');
    } finally {
      setSubmitting(false);
    }
  };

  // Buka Modal GANTI Mutasi
  const handleOpenGanti = (item: MutasiBarang) => {
    setGantiTarget(item);
    setGantiReason('');
    setIsCustomMode(Boolean(item.is_custom_item));
    setCustomItemName(item.nama_barang || '');
    setCustomItemUom(item.satuan || 'Unit');
    setBebanBiaya(item.beban_biaya || 'KONTRAKTOR');
    setSelectedItemId(item.barang_id);
    setMutationType(item.jenis);
    setQty(item.jumlah);
    setPurpose(item.tujuan_keperluan || '');
    setPic(item.pic_penerima_penyerah || user.name);
    setSuratJalan(item.nomor_surat_jalan || '');
    setNotes(item.catatan || '');
    setMutationDate(toLocalDateInput(item.tanggal));
    setSourceName(item.source_name || '');
    setDestinationName(item.destination_name || '');
    setGantiHargaSatuan(item.harga_satuan_beli != null ? item.harga_satuan_beli : '');
    setGantiIsHargaBelumDiketahui(item.status_harga === 'BELUM_DIKETAHUI');
    setGantiIsNotaMenyusul(item.status_harga === 'NOTA_MENYUSUL');
    setGantiNamaItemAktual(item.nama_item_aktual || '');
  };

  // Konfirmasi GANTI Mutasi
  const handleConfirmGanti = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);

    const itemName = isCustomMode ? customItemName.trim() : (currentPhysicalMaterial?.nama_barang || gantiTarget.nama_barang || 'Material');
    const itemSatuan = isCustomMode ? customItemUom.trim() : (currentPhysicalMaterial?.satuan || gantiTarget.satuan || 'Unit');

    let computedStatusHarga: 'NOTA_MENYUSUL' | 'BELUM_DIKETAHUI' | undefined = undefined;
    if (gantiIsHargaBelumDiketahui) {
      computedStatusHarga = 'BELUM_DIKETAHUI';
    } else if (gantiIsNotaMenyusul) {
      computedStatusHarga = 'NOTA_MENYUSUL';
    }
    const computedHargaBeli = (gantiIsHargaBelumDiketahui || gantiIsNotaMenyusul || gantiHargaSatuan === '')
      ? undefined
      : Number(gantiHargaSatuan);

    try {
      const res = await gantiStockMutation(
        gantiTarget.id,
        {
          barang_id: isCustomMode ? '' : selectedItemId,
          nama_barang: itemName,
          jenis: mutationType,
          jumlah: qty,
          satuan: itemSatuan,
          tujuan_keperluan: purpose,
          pic_penerima_penyerah: pic,
          nomor_surat_jalan: suratJalan || undefined,
          tanggal: buildOccurredAtIso(mutationDate),
          catatan: notes || undefined,
          source_name: sourceName || undefined,
          destination_name: destinationName || undefined,
          recipient_name: pic || undefined,
          owner_type: ownerType,
          purpose: purpose,
          beban_biaya: bebanBiaya,
          is_custom_item: isCustomMode,
          harga_satuan_beli: computedHargaBeli,
          status_harga: computedStatusHarga,
          nama_item_aktual: gantiNamaItemAktual.trim() || undefined
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
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengganti dokumen transaksi.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // HANDLER DOKUMEN RESMI & PERSETUJUAN BERANTAI (KHUSUS DOKUMEN)
  // ============================================================================
  const handleIssueStockDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang menerbitkan dokumen resmi baru. Wewenang ini milik Clerk.`);
      return;
    }
    if (!docTitle.trim()) {
      setErrorMessage('Judul dokumen resmi wajib diisi.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const validTrx = stockMutations.filter((m) => !m.is_batal && !m.is_ganti);
      const inCount = validTrx.filter((m) => m.jenis === 'MASUK').length;
      const outCount = validTrx.filter((m) => m.jenis === 'KELUAR').length;
      const res = await issueOfficialDocument({
        jenis: 'MUTASI_STOK',
        judul: docTitle.trim(),
        periode: docPeriode.trim() || 'November 2026',
        ringkasan: docRingkasan.trim() || `Rekapitulasi ${validTrx.length} transaksi mutasi barang (${inCount} Masuk, ${outCount} Keluar)`,
        total_nilai_atau_item: `${validTrx.length} Transaksi (${boqMetrics.arrivedMaterialTypesCount} Jenis Material Tiba)`
      });
      if (res.success) {
        setNoticeMessage(res.message);
        setDocTitle('Berita Acara Rekapitulasi Mutasi Barang & Gudang');
        setDocRingkasan('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal menerbitkan dokumen resmi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvanceStockDocument = async (
    docDbId: string,
    currentStatus: StatusDokumenWorkflow,
    nextStatus: StatusDokumenWorkflow
  ) => {
    const pendingTurn = getPendingApprovalForRole(currentStatus, activeRole);
    if (!pendingTurn || pendingTurn.nextTarget !== nextStatus) {
      setErrorMessage(`Jabatan Anda (${activeRole}) belum/tidak berwenang memproses tahap ${nextStatus} pada dokumen ini.`);
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceDocumentWorkflow(docDbId, nextStatus);
      if (res.success) {
        setNoticeMessage(`Persetujuan berhasil (${activeRole}): ${res.message}`);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal memproses persetujuan dokumen.');
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
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membatalkan dokumen.');
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
      const validTrx = stockMutations.filter((m) => !m.is_batal && !m.is_ganti);
      const res = await gantiOfficialDocument(
        gantiDocTargetId,
        {
          jenis: 'MUTASI_STOK',
          judul: gantiDocTitle.trim() || 'Berita Acara Rekapitulasi Mutasi Barang (Revisi)',
          periode: gantiDocPeriode.trim() || 'Periode Berjalan',
          ringkasan: gantiDocRingkasan.trim() || `Revisi Rekapitulasi ${validTrx.length} transaksi mutasi barang`,
          total_nilai_atau_item: `${validTrx.length} Transaksi`
        },
        gantiDocReason
      );
      if (res.success) {
        setNoticeMessage(res.message);
        setGantiDocTargetId(null);
        setGantiDocReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengganti dokumen.');
    } finally {
      setSubmitting(false);
    }
  };

  // Modal Pengaturan Ekspor PDF (Tokopedia/ERP Style)
  const [exportModalState, setExportModalState] = useState<{
    isOpen: boolean;
    targetType: ExportTargetType;
    title: string;
    itemCount: number;
    initialIncludeFinancials?: boolean;
    currentFilterLabel?: string;
    currentSortLabel?: string;
  }>({
    isOpen: false,
    targetType: 'BOQ',
    title: '',
    itemCount: 0,
  });

  const openExportModal = (targetType: ExportTargetType) => {
    startTransition(() => {
      if (targetType === 'WAREHOUSE') {
        if (filteredWarehouseMaterials.length === 0) {
          setErrorMessage('Tidak ada data material di layar untuk diekspor ke PDF.');
          return;
        }
        const filterLabelMap: Record<typeof warehouseFilter, string> = {
          ALL: 'Semua Material',
          HAS_ARRIVED: 'Sudah Masuk',
          IN_STOCK: 'Ada di Gudang',
          NOT_ARRIVED: 'Belum Masuk'
        };
        const sortLabel = warehouseSort
          ? `Urut: ${warehouseSort.key} (${warehouseSort.dir === 'asc' ? 'Naik' : 'Turun'})`
          : 'Urut: Default';
        const searchPart = warehouseSearchQuery.trim() ? ` · Cari: "${warehouseSearchQuery.trim()}"` : '';

        setExportModalState({
          isOpen: true,
          targetType: 'WAREHOUSE',
          title: 'Rekapitulasi Stok Gudang Material',
          itemCount: filteredWarehouseMaterials.length,
          initialIncludeFinancials: false,
          currentFilterLabel: `${filterLabelMap[warehouseFilter]}${searchPart}`,
          currentSortLabel: sortLabel
        });
      } else if (targetType === 'BOQ') {
        if (visibleBoqItems.length === 0) {
          setErrorMessage('Tidak ada pos BOQ di layar untuk diekspor ke PDF.');
          return;
        }
        const providerLabel =
          boqProviderFilter === 'KONTRAKTOR'
            ? tenantBranding.contractorName
            : boqProviderFilter === 'IMK'
            ? tenantBranding.clientName
            : 'Semua Penyedia';
        const statusLabel = boqStatusFilter === 'ALL' ? 'Semua Status' : boqStatusFilter;
        const sortLabel = boqSort
          ? `Urut: ${boqSort.key} (${boqSort.dir === 'asc' ? 'Naik' : 'Turun'})`
          : 'Urut: Default';
        const searchPart = boqSearchQuery.trim() ? ` · Cari: "${boqSearchQuery.trim()}"` : '';

        setExportModalState({
          isOpen: true,
          targetType: 'BOQ',
          title: 'Laporan Realisasi & Kontrol Pemenuhan BOQ',
          itemCount: visibleBoqItems.length,
          initialIncludeFinancials: !isFinancialHidden,
          currentFilterLabel: `${providerLabel} · ${statusLabel}${searchPart}`,
          currentSortLabel: sortLabel
        });
      } else if (targetType === 'STOCK_JOURNAL') {
        if (filteredMutations.length === 0) {
          setErrorMessage('Tidak ada baris transaksi di layar untuk diekspor ke PDF.');
          return;
        }
        const typeLabel = deferredFilterType === 'ALL' ? 'Semua Jenis' : deferredFilterType;
        const searchPart = deferredSearchQuery.trim() ? ` · Cari: "${deferredSearchQuery.trim()}"` : '';
        const sortLabel = `Urut: ${deferredJournalSort.key} (${deferredJournalSort.dir === 'asc' ? 'Naik' : 'Turun'})`;

        setExportModalState({
          isOpen: true,
          targetType: 'STOCK_JOURNAL',
          title: 'Buku Jurnal Mutasi Barang Proyek',
          itemCount: filteredMutations.length,
          initialIncludeFinancials: false,
          currentFilterLabel: `${typeLabel}${searchPart}`,
          currentSortLabel: sortLabel
        });
      }
    });
  };

  const handleConfirmExport = async (config: ExportSettingsConfig) => {
    // Jeda sejenak untuk memastikan render UI dan status transisi browser tidak terblokir
    await new Promise((resolve) => setTimeout(resolve, 40));

    if (exportModalState.targetType === 'WAREHOUSE') {
      try {
        setIsExportingWarehouse(true);
        const docId = `GDG-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

        let materialsToExport = [...filteredWarehouseMaterials];
        if (config.filterScope.providerScope === 'KONTRAKTOR') {
          materialsToExport = materialsToExport.filter(pm => {
            const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);
            return (disc.kontraktorTargetQty || 0) > 0;
          });
        } else if (config.filterScope.providerScope === 'IMK') {
          materialsToExport = materialsToExport.filter(pm => {
            const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);
            return (disc.imkTargetQty || 0) > 0;
          });
        }

        if (config.filterScope.onlyRemaining) {
          materialsToExport = materialsToExport.filter(pm => {
            const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);
            if (config.filterScope.providerScope === 'KONTRAKTOR') {
              return (disc.kontraktorSisaQty || 0) > 0;
            } else if (config.filterScope.providerScope === 'IMK') {
              return (disc.imkSisaQty || 0) > 0;
            } else {
              return Math.max(0, (pm.total_qty_boq || 0) - (pm.total_qty_masuk || 0)) > 0;
            }
          });
        }

        if (config.filterScope.statusScope === 'HAS_STOCK') {
          materialsToExport = materialsToExport.filter(pm => pm.stok_fisik > 0);
        } else if (config.filterScope.statusScope === 'HAS_ARRIVED') {
          materialsToExport = materialsToExport.filter(pm => {
            if (config.filterScope.providerScope === 'KONTRAKTOR') {
              const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);
              return (disc.masukKontraktor || 0) > 0;
            } else if (config.filterScope.providerScope === 'IMK') {
              const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);
              return (disc.masukKlien || 0) > 0;
            }
            return (pm.total_qty_masuk || 0) > 0;
          });
        } else if (config.filterScope.statusScope === 'NOT_ARRIVED') {
          materialsToExport = materialsToExport.filter(pm => {
            if (config.filterScope.providerScope === 'KONTRAKTOR') {
              const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);
              return (disc.masukKontraktor || 0) === 0;
            } else if (config.filterScope.providerScope === 'IMK') {
              const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);
              return (disc.masukKlien || 0) === 0;
            }
            return (pm.total_qty_masuk || 0) === 0;
          });
        }

        if (config.sortConfig.key !== 'default') {
          const dirMul = config.sortConfig.dir === 'desc' ? -1 : 1;
          materialsToExport.sort((a, b) => {
            if (config.sortConfig.key === 'nama_barang') return a.nama_barang.localeCompare(b.nama_barang) * dirMul;
            if (config.sortConfig.key === 'target_kebutuhan') {
              const discA = summarizeMaterialIncomingDiscrepancy(a, stockMutations, providerLabels);
              const discB = summarizeMaterialIncomingDiscrepancy(b, stockMutations, providerLabels);
              const qA = config.filterScope.providerScope === 'KONTRAKTOR' ? discA.kontraktorTargetQty : config.filterScope.providerScope === 'IMK' ? discA.imkTargetQty : (a.total_qty_boq || 0);
              const qB = config.filterScope.providerScope === 'KONTRAKTOR' ? discB.kontraktorTargetQty : config.filterScope.providerScope === 'IMK' ? discB.imkTargetQty : (b.total_qty_boq || 0);
              return (qA - qB) * dirMul;
            }
            if (config.sortConfig.key === 'sudah_masuk') {
              const discA = summarizeMaterialIncomingDiscrepancy(a, stockMutations, providerLabels);
              const discB = summarizeMaterialIncomingDiscrepancy(b, stockMutations, providerLabels);
              const mA = config.filterScope.providerScope === 'KONTRAKTOR' ? discA.masukKontraktor : config.filterScope.providerScope === 'IMK' ? discA.masukKlien : (a.total_qty_masuk || 0);
              const mB = config.filterScope.providerScope === 'KONTRAKTOR' ? discB.masukKontraktor : config.filterScope.providerScope === 'IMK' ? discB.masukKlien : (b.total_qty_masuk || 0);
              return (mA - mB) * dirMul;
            }
            if (config.sortConfig.key === 'saldo_gudang') return (a.stok_fisik - b.stok_fisik) * dirMul;
            if (config.sortConfig.key === 'sisa_belum_tiba') {
              const discA = summarizeMaterialIncomingDiscrepancy(a, stockMutations, providerLabels);
              const discB = summarizeMaterialIncomingDiscrepancy(b, stockMutations, providerLabels);
              const sisaA = config.filterScope.providerScope === 'KONTRAKTOR' ? discA.kontraktorSisaQty : config.filterScope.providerScope === 'IMK' ? discA.imkSisaQty : Math.max(0, (a.total_qty_boq || 0) - (a.total_qty_masuk || 0));
              const sisaB = config.filterScope.providerScope === 'KONTRAKTOR' ? discB.kontraktorSisaQty : config.filterScope.providerScope === 'IMK' ? discB.imkSisaQty : Math.max(0, (b.total_qty_boq || 0) - (b.total_qty_masuk || 0));
              return (sisaA - sisaB) * dirMul;
            }
            return 0;
          });
        }

        await generateWarehouseSummaryPDF({
          docId,
          materials: materialsToExport,
          projectName: tenantBranding.projectName,
          filterSummary: `${exportModalState.currentFilterLabel} · ${exportModalState.currentSortLabel}`,
          customTitle: config.customTitle,
          customNotes: config.customNotes,
          signer: user || undefined,
          stockMutations,
          branding: tenantBranding,
          selectedColumns: config.selectedColumns,
          providerScope: config.filterScope.providerScope,
          role: activeRole
        });
        setNoticeMessage(`PDF Rekap Gudang (${materialsToExport.length} material · ${config.selectedColumns.length} kolom) berhasil diunduh.`);
      } catch (err: any) {
        console.error('Error exporting Warehouse PDF:', err);
        setErrorMessage('Gagal mengunduh PDF Rekap Gudang: ' + (err?.message || 'Kesalahan sistem'));
      } finally {
        setIsExportingWarehouse(false);
      }
    } else if (exportModalState.targetType === 'BOQ') {
      try {
        setIsExportingBoq(true);
        const docId = `BOQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

        // Gunakan seluruh basis pos BOQ proyek (280 pos), lalu filter sesuai konfigurasi modal ekspor
        let itemsToExport = [...items];
        if (config.filterScope.providerScope === 'KONTRAKTOR') {
          itemsToExport = itemsToExport.filter(it => !isClientProvidedRemark(it.keterangan, tenantBranding.clientName));
        } else if (config.filterScope.providerScope === 'IMK') {
          itemsToExport = itemsToExport.filter(it => isClientProvidedRemark(it.keterangan, tenantBranding.clientName));
        }

        if (config.filterScope.statusScope === 'LENGKAP') {
          itemsToExport = itemsToExport.filter(it => it.status_pemenuhan === 'Terpenuhi' || it.status_pemenuhan === 'Melebihi BOQ');
        } else if (config.filterScope.statusScope === 'BELUM_LENGKAP') {
          itemsToExport = itemsToExport.filter(it => it.status_pemenuhan === 'Dalam pemenuhan');
        } else if (config.filterScope.statusScope === 'BELUM_TIBA') {
          itemsToExport = itemsToExport.filter(it => it.status_pemenuhan === 'Belum dipenuhi');
        } else if (config.filterScope.statusScope === 'HAS_ARRIVED') {
          itemsToExport = itemsToExport.filter(it => it.qty_masuk_total > 0);
        }

        if (config.filterScope.onlyRemaining) {
          itemsToExport = itemsToExport.filter(it => it.qty_pemenuhan_sisa > 0);
        }

        if (config.sortConfig.key !== 'default') {
          const dirMul = config.sortConfig.dir === 'desc' ? -1 : 1;
          itemsToExport.sort((a, b) => {
            if (config.sortConfig.key === 'nama_barang') return a.nama_barang.localeCompare(b.nama_barang) * dirMul;
            if (config.sortConfig.key === 'kode_boq') return (a.kode_boq || '').localeCompare(b.kode_boq || '') * dirMul;
            if (config.sortConfig.key === 'qty_boq') return (a.qty_boq - b.qty_boq) * dirMul;
            if (config.sortConfig.key === 'qty_masuk') return (((a.is_stock_item ? a.qty_masuk_total : Math.max(a.qty_masuk_total, a.qty_keluar_total))) - ((b.is_stock_item ? b.qty_masuk_total : Math.max(b.qty_masuk_total, b.qty_keluar_total)))) * dirMul;
            if (config.sortConfig.key === 'qty_sisa') return (a.qty_pemenuhan_sisa - b.qty_pemenuhan_sisa) * dirMul;
            if (config.sortConfig.key === 'total_kontrak') return ((a.harga_satuan * a.qty_boq) - (b.harga_satuan * b.qty_boq)) * dirMul;
            return 0;
          });
        }

        await generateBOQReportPDF({
          docId,
          items: itemsToExport,
          projectName: tenantBranding.projectName,
          signer: user || undefined,
          preserveOrder: config.sortConfig.key === 'default',
          filterSummary: `${exportModalState.currentFilterLabel} · ${exportModalState.currentSortLabel}`,
          branding: tenantBranding,
          hideFinancials: isFinancialHidden ? true : !config.includeFinancials,
          customTitle: config.customTitle,
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape',
          mutations: stockMutations,
          physicalMaterials,
          role: activeRole
        });
        setNoticeMessage(`PDF Realisasi BOQ (${itemsToExport.length} pos · ${config.selectedColumns.length} kolom) berhasil diunduh.`);
      } catch (err: any) {
        console.error('Error exporting BOQ PDF:', err);
        setErrorMessage('Gagal mengunduh PDF BOQ: ' + (err?.message || 'Kesalahan sistem'));
      } finally {
        setIsExportingBoq(false);
      }
    } else if (exportModalState.targetType === 'STOCK_JOURNAL') {
      try {
        setIsExportingJournal(true);
        const docId = `JRN-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;

        let mutationsToExport = [...filteredMutations];
        if (config.filterScope.providerScope === 'KONTRAKTOR') {
          mutationsToExport = mutationsToExport.filter(m => m.owner_type === 'KONTRAKTOR' || !isClientProvidedRemark(m.source_name, tenantBranding.clientName));
        } else if (config.filterScope.providerScope === 'IMK') {
          mutationsToExport = mutationsToExport.filter(m => m.owner_type === 'IMK' || m.owner_type === 'KLIEN' || isClientProvidedRemark(m.source_name, tenantBranding.clientName));
        }

        if (config.filterScope.transactionType === 'MASUK') {
          mutationsToExport = mutationsToExport.filter(m => m.jenis === 'MASUK');
        } else if (config.filterScope.transactionType === 'KELUAR') {
          mutationsToExport = mutationsToExport.filter(m => m.jenis === 'KELUAR');
        }

        if (config.filterScope.onlyActive) {
          mutationsToExport = mutationsToExport.filter(m => !m.is_batal && !m.is_ganti && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI');
        }

        if (config.filterScope.onlyPendingInvoice) {
          mutationsToExport = mutationsToExport.filter(m =>
            m.status_harga === 'NOTA_MENYUSUL' || m.status_harga === 'BELUM_DIKETAHUI' || (m.jenis === 'MASUK' && m.harga_satuan_beli == null)
          );
        }

        if (config.sortConfig.key !== 'default') {
          const dirMul = config.sortConfig.dir === 'desc' ? -1 : 1;
          mutationsToExport.sort((a, b) => {
            if (config.sortConfig.key === 'tanggal') return (new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime()) * dirMul;
            if (config.sortConfig.key === 'nama_barang') return a.nama_barang.localeCompare(b.nama_barang) * dirMul;
            if (config.sortConfig.key === 'jumlah') return (a.jumlah - b.jumlah) * dirMul;
            if (config.sortConfig.key === 'nomor_surat_jalan') return (a.nomor_surat_jalan || '').localeCompare(b.nomor_surat_jalan || '') * dirMul;
            return 0;
          });
        }

        const dates = mutationsToExport
          .map((m) => (m.tanggal ? new Date(m.tanggal).getTime() : NaN))
          .filter((t) => !Number.isNaN(t));
        const today = new Date().toISOString().slice(0, 10);
        const startDate = dates.length > 0 ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : today;
        const endDate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : today;

        await generateStockMutationPDF({
          docId,
          startDate,
          endDate,
          mutations: mutationsToExport,
          signer: user,
          projectName: tenantBranding.projectName,
          physicalMaterials,
          branding: tenantBranding,
          filterSummary: `${exportModalState.currentFilterLabel} · ${exportModalState.currentSortLabel}`,
          customTitle: config.customTitle,
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape'
        });
        setNoticeMessage(`PDF Jurnal Mutasi (${mutationsToExport.length} baris · ${config.selectedColumns.length} kolom) berhasil diunduh.`);
      } catch (err: any) {
        console.error('Error exporting Journal PDF:', err);
        setErrorMessage('Gagal mengunduh PDF Jurnal Transaksi: ' + (err?.message || 'Kesalahan sistem'));
      } finally {
        setIsExportingJournal(false);
      }
    }
  };

  const handleDownloadStockDocPDF = async (docCode: string, docTitleStr?: string) => {
    try {
      setDownloadingDocId(docCode);
      const validMutations = stockMutations.filter((m) => !m.is_batal && !m.is_ganti);
      const today = new Date().toISOString().slice(0, 10);
      await generateStockMutationPDF({
        docId: docCode,
        startDate: '2026-01-01',
        endDate: today,
        mutations: validMutations,
        signer: user,
        projectName: tenantBranding.projectName || tenantBranding.contractorName,
        physicalMaterials,
        branding: tenantBranding,
        customTitle: docTitleStr || 'BERITA ACARA REKAPITULASI MUTASI BARANG & GUDANG',
        orientation: 'landscape'
      });
      setNoticeMessage(`Dokumen PDF Resmi (${docCode}) dengan QR Code Verifikasi berhasil diunduh.`);
    } catch (err: any) {
      setErrorMessage('Gagal mengunduh PDF dokumen: ' + (err?.message || 'Kesalahan sistem'));
    } finally {
      setDownloadingDocId(null);
    }
  };

  if (modalOnly && !isModalOpen) return null;
  if (!dataReady) return <div className="p-8 text-center text-xs text-slate-500">Memuat data mutasi barang...</div>;

  return (
    <div className={modalOnly ? '' : 'space-y-5'}>
      {/* Notifikasi & Pesan */}
      {noticeMessage && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{noticeMessage}</span>
          </div>
          <div className="flex items-center gap-2">
            {!modalOnly && activeTab !== 'MUTATION_HISTORY' && (
              <button
                type="button"
                onClick={() => startTransition(() => setActiveTab('MUTATION_HISTORY'))}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors cursor-pointer"
              >
                Lihat di Jurnal Transaksi →
              </button>
            )}
            <button onClick={() => setNoticeMessage(null)} aria-label="Tutup pemberitahuan" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-base font-bold">×</button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} aria-label="Tutup pesan galat" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-base font-bold">×</button>
        </div>
      )}

      {!modalOnly && (
        <>
          {/* Banner Pengamat (Klien) */}
          {activeRole === 'Viewer/Pengamat' && (
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-xs">
              <Eye className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="flex-1 leading-relaxed">
                <span className="font-bold text-cyan-300">Mode Pengamat (Klien) Aktif:</span> Anda memiliki akses transparansi penuh untuk mengamati progres realisasi BOQ, mutasi fisik, riwayat transaksi, dan ekspor laporan PDF fisik. Fitur entri, rincian kas internal, dan persetujuan dinonaktifkan untuk menjaga integritas serta privasi data.
              </div>
            </div>
          )}

          {/* Header Panel */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => goBack ? goBack() : setCurrentView('dashboard')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer mr-1"
                  title="Kembali ke satu langkah/halaman sebelumnya"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Dasbor</span>
                </button>
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
                  Mutasi Barang & Pemantauan BOQ
                </span>
              </div>

              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Mutasi Barang
              </h1>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Pencatatan mutasi fisik gudang dan pemantauan realisasi pos BOQ.
              </p>
            </div>

            {/* Smart-Header Adaptif Multi-POV (Anti Tombol Mati di Header) */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 shrink-0">
              {evalContext.authority === 'EKSEKUTOR' ? (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleOpenNewModal('MASUK')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 active:scale-95 transition-colors shadow-xs cursor-pointer"
                    title="Catat Penerimaan Barang Masuk ke Gudang"
                  >
                    <ArrowDownLeft className="w-4 h-4" />
                    <span>+ Catat Masuk</span>
                  </button>
                  <button
                    onClick={() => handleOpenNewModal('KELUAR')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 rounded-xl hover:bg-rose-700 active:scale-95 transition-colors shadow-xs cursor-pointer"
                    title="Catat Pengeluaran Barang ke Area Proyek"
                  >
                    <ArrowUpRight className="w-4 h-4" />
                    <span>- Catat Keluar</span>
                  </button>
                </div>
              ) : evalContext.authority === 'PENGAWAS_INTERNAL' ? (
                <div className="flex items-center gap-2">
                  {pendingWorkflowCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        startTransition(() => {
                          setActiveTab('MUTATION_HISTORY');
                          setSearchQuery('');
                        });
                      }}
                      className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl active:scale-95 transition-all shadow-xs cursor-pointer ${
                        activeRole === 'Foreman'
                          ? 'bg-sky-600 hover:bg-sky-700 text-white'
                          : activeRole === 'Spv.'
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-teal-600 hover:bg-teal-700 text-white'
                      }`}
                      title="Buka tab riwayat mutasi untuk memeriksa / menyetujui transaksi yang menunggu giliran Anda"
                    >
                      <Bell className="w-4 h-4 animate-bounce" />
                      <span>
                        {pendingWorkflowCount} Mutasi Menunggu{' '}
                        {activeRole === 'Foreman' ? 'Periksa' : activeRole === 'Spv.' ? 'Setuju' : 'Sahkan'} →
                      </span>
                    </button>
                  ) : pendingStockDocCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        startTransition(() => {
                          setActiveTab('OFFICIAL_DOCUMENTS');
                        });
                      }}
                      className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-xl active:scale-95 transition-all shadow-xs cursor-pointer ${
                        activeRole === 'Foreman'
                          ? 'bg-sky-600 hover:bg-sky-700 text-white'
                          : activeRole === 'Spv.'
                          ? 'bg-amber-600 hover:bg-amber-700 text-white'
                          : 'bg-teal-600 hover:bg-teal-700 text-white'
                      }`}
                      title="Buka tab Dokumen Resmi untuk memproses pengesahan berita acara yang menunggu giliran Anda"
                    >
                      <Bell className="w-4 h-4 animate-bounce" />
                      <span>
                        {pendingStockDocCount} Dokumen Menunggu{' '}
                        {activeRole === 'Foreman' ? 'Periksa' : activeRole === 'Spv.' ? 'Setuju' : 'Sahkan'} →
                      </span>
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Semua Mutasi Terverifikasi</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {pendingClientDeliveriesCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        startTransition(() => {
                          setActiveTab('BOQ_MONITOR');
                          setBoqProviderFilter('IMK');
                          setBoqStatusFilter('BELUM_SERAH');
                        });
                      }}
                      className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white rounded-xl active:scale-95 transition-all shadow-xs cursor-pointer"
                      title="Lihat pos material Jatah Klien yang belum diserahkan ke proyek"
                    >
                      <Package className="w-4 h-4" />
                      <span>{pendingClientDeliveriesCount} Jatah Klien Belum Serah →</span>
                    </button>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800 text-xs font-bold">
                      <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                      <span>Seluruh Jatah Klien Telah Diserahkan</span>
                    </div>
                  )}
                </div>
              )}

              {/* Banner Rata Kanan: words_PNG2 */}
              <div className="flex items-center justify-end self-center shrink-0">
                <img
                  src="/words_PNG2.png"
                  alt="Proyek Cair"
                  className="h-10 sm:h-12 lg:h-14 w-auto max-w-[150px] sm:max-w-[200px] lg:max-w-[240px] object-contain drop-shadow-md dark:block hidden"
                />
                <img
                  src="/words_light.png"
                  alt="Proyek Cair"
                  className="h-10 sm:h-12 lg:h-14 w-auto max-w-[150px] sm:max-w-[200px] lg:max-w-[240px] object-contain drop-shadow-md dark:hidden block"
                />
              </div>
            </div>
          </div>

          {/* Navigasi Menu Tab (Ringkas, Intuitif & Bebas Ambigu) */}
          <div className="flex overflow-x-auto no-scrollbar touch-scroll whitespace-nowrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-1">
            <button
              onClick={() => startTransition(() => setActiveTab('WAREHOUSE_SUMMARY'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'WAREHOUSE_SUMMARY'
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/25 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>📦 Stok Gudang</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 font-bold">
                {boqMetrics.totalMaterialTypesCount} Material
              </span>
            </button>

            <button
              onClick={() => startTransition(() => setActiveTab('BOQ_MONITOR'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'BOQ_MONITOR'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>🏗️ Realisasi BOQ</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 font-bold">
                {items.length} Pos
              </span>
            </button>

            <button
              onClick={() => startTransition(() => setActiveTab('MUTATION_HISTORY'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'MUTATION_HISTORY'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              <span>📋 Riwayat Mutasi</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-bold">
                {stockMutations.length} Transaksi
              </span>
            </button>

            <button
              onClick={() => startTransition(() => setActiveTab('OFFICIAL_DOCUMENTS'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'OFFICIAL_DOCUMENTS'
                  ? 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/25 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <FileCheck2 className="w-4 h-4" />
              <span>📄 Dokumen Resmi</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 font-bold">
                {stockDocuments.length} Dokumen
              </span>
            </button>
          </div>

          {/* =====================================================================
              POV 1: REKAP GUDANG MATERIAL — "SATUKAN MASUK" (1 BARIS PER MATERIAL)
          ===================================================================== */}
          {activeTab === 'WAREHOUSE_SUMMARY' && (
            <div className="space-y-4">
              {/* Penjelasan Singkat Rekap Stok Gudang */}
              <div className="bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                    <Boxes className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>Rekap Stok Material Gudang — 1 Baris per Jenis Material Fisik</span>
                  </div>
                  <p className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                    Menampilkan total penerimaan dan saldo stok fisik di proyek tanpa duplikasi. Untuk melihat rincian pemakaian per pos pekerjaan, buka tab <b>Realisasi BOQ</b>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => startTransition(() => setActiveTab('BOQ_MONITOR'))}
                  className="shrink-0 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Lihat Pemakaian Pos BOQ →
                </button>
              </div>

              {/* Filter & Pencarian Gudang Material */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      aria-label="Cari nama material di gudang"
                      placeholder="Cari nama material fisik (contoh: Pasir, Semen, Kayu, Besi)..."
                      value={warehouseSearchQuery}
                      onChange={(e) => setWarehouseSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-emerald-500/20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => openExportModal('WAREHOUSE')}
                    disabled={isExportingWarehouse || filteredWarehouseMaterials.length === 0}
                    title="Ekspor PDF sesuai filter & urutan sortir di layar"
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{isExportingWarehouse ? 'Menyiapkan...' : 'Ekspor PDF'}</span>
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'ALL', label: `Semua Material (${boqMetrics.totalMaterialTypesCount})` },
                    { id: 'HAS_ARRIVED', label: `Sudah Masuk (${boqMetrics.arrivedMaterialTypesCount})` },
                    { id: 'IN_STOCK', label: `Ada di Gudang (${(physicalMaterials || []).filter((pm) => pm.is_stock_item && pm.stok_fisik > 0).length})` },
                    { id: 'NOT_ARRIVED', label: `Belum Masuk (${boqMetrics.totalMaterialTypesCount - boqMetrics.arrivedMaterialTypesCount})` }
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => startTransition(() => setWarehouseFilter(f.id as any))}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                        warehouseFilter === f.id
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tabel 1 Baris per Nama Material ("Satukan Masuk") */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 w-10 text-center">No</th>
                        <th className="py-3 px-3.5">
                          {renderSortBtn('Nama Material & Cakupan Pos BOQ', 'nama_barang', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'nama_barang', 'asc')))
                          )}
                        </th>
                        <th className="py-3 px-3 text-center">
                          {renderSortBtn('Satuan', 'satuan', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'satuan', 'asc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Total Kebutuhan Proyek', 'total_qty_boq', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'total_qty_boq', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Total Sudah Masuk Gudang', 'total_qty_masuk', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'total_qty_masuk', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Sisa Belum Tiba', 'sisa_belum_tiba', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'sisa_belum_tiba', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Total Sudah Dipakai (Keluar)', 'total_qty_keluar', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'total_qty_keluar', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Saldo Fisik Gudang', 'stok_fisik', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'stok_fisik', 'desc'))),
                            'right'
                          )}
                        </th>
                        {canViewFinancials && (
                          <>
                            <th className="py-3 px-3 text-right">
                              {renderSortBtn('Harga Rata-Rata', 'harga_beli_rata_rata', warehouseSort, () =>
                                startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'harga_beli_rata_rata', 'desc'))),
                                'right'
                              )}
                            </th>
                            <th className="py-3 px-3 text-right">
                              {renderSortBtn('Total Belanja Riil', 'total_nilai_belanja_riil', warehouseSort, () =>
                                startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'total_nilai_belanja_riil', 'desc'))),
                                'right'
                              )}
                            </th>
                          </>
                        )}
                        <th className="py-3 px-3 text-center">
                          {renderSortBtn('Status Gudang', 'status', warehouseSort, () =>
                            startTransition(() => setWarehouseSort((prev) => toggleSort(prev, 'status', 'desc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3.5 text-center">{evalContext.partyPov === 'KLIEN' ? 'Riwayat' : 'Aksi Cepat'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredWarehouseMaterials.length === 0 ? (
                        <tr>
                          <td colSpan={canViewFinancials ? 12 : 10} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Tidak ada material fisik yang cocok dengan filter pencarian.
                          </td>
                        </tr>
                      ) : (
                        filteredWarehouseMaterials.map((pm, idx) => {
                          const evalRow = evaluateWarehouseMaterial(pm, stockMutations, evalContext);
                          const totalTarget = pm.total_qty_boq || 0;
                          const totalMasuk = pm.total_qty_masuk || 0;
                          const totalKeluar = pm.total_qty_keluar || 0;
                          const sisaBelumTiba = evalRow.sisaBelumTiba;
                          const pctTiba = totalTarget > 0 ? Math.round((totalMasuk / totalTarget) * 100) : 0;
                          const posCount = pm.budget_lines.length;
                          const matDiscrepancy = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, providerLabels);

                          return (
                            <tr
                              key={pm.id}
                              className={`hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors ${
                                matDiscrepancy.hasMismatch
                                    ? 'bg-amber-50/50 dark:bg-amber-950/20'
                                    : totalMasuk > 0
                                    ? 'bg-emerald-50/20 dark:bg-emerald-950/10'
                                    : ''
                              }`}
                            >
                              <td className="py-3 px-3.5 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                                {idx + 1}
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                                  <span>{pm.nama_barang}</span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300">
                                    {posCount} Pos BOQ
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                                  Kode BOQ{' '}
                                  <span className="font-mono">
                                    {pm.budget_lines.slice(0, 5).map((bl) => bl.kode_boq).join(', ')}
                                    {posCount > 5 ? ` (+${posCount - 5} pos lainnya)` : ''}
                                  </span>
                                </div>
                                {matDiscrepancy.mixedBreakdownText && (
                                  <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-indigo-50 text-indigo-800 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-800/70 mr-1.5">
                                    <span>{matDiscrepancy.mixedBreakdownText}</span>
                                  </div>
                                )}
                                {matDiscrepancy.hasMismatch && (
                                  <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/70 dark:text-amber-200 dark:border-amber-700/70">
                                    <AlertTriangle className="w-3 h-3 shrink-0 text-amber-600 dark:text-amber-400" />
                                    <span>{matDiscrepancy.summaryText}</span>
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3 text-center font-mono font-semibold text-slate-700 dark:text-slate-200">
                                {pm.satuan}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                                {totalTarget.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                <div>{totalMasuk.toLocaleString('id-ID', { maximumFractionDigits: 3 })}</div>
                                <div className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
                                  {pctTiba}% Tiba
                                </div>
                              </td>
                              <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300 font-medium">
                                {evalRow.canQuickAddResidual ? (
                                  <button
                                    type="button"
                                    onClick={() => handleOpenWarehouseMaterialIn(pm)}
                                    title={`Pintasan 1-klik: Catat kedatangan sisa ${sisaBelumTiba.toLocaleString('id-ID')} ${pm.satuan}`}
                                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-xs font-bold ${getResidualChipClass(
                                      evalRow.residualChipVariant || 'emerald'
                                    )}`}
                                  >
                                    <span>{sisaBelumTiba.toLocaleString('id-ID', { maximumFractionDigits: 3 })}</span>
                                    <span className="text-[10px]">+</span>
                                  </button>
                                ) : (
                                  sisaBelumTiba.toLocaleString('id-ID', { maximumFractionDigits: 3 })
                                )}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                                {totalKeluar.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-black">
                                <span
                                  className={
                                    pm.stok_fisik > 0
                                      ? 'text-emerald-600 dark:text-emerald-400 text-sm'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }
                                >
                                  {pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                </span>
                              </td>
                              {canViewFinancials && (
                                <>
                                  <td className="py-3 px-3 text-right font-mono text-slate-800 dark:text-slate-200">
                                    {pm.harga_beli_rata_rata != null && pm.harga_beli_rata_rata > 0 ? (
                                      <div>
                                        <div className="font-bold text-slate-900 dark:text-white">
                                          Rp {pm.harga_beli_rata_rata.toLocaleString('id-ID')}
                                        </div>
                                        {pm.count_nota_menyusul != null && pm.count_nota_menyusul > 0 && (
                                          <div className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                                            {pm.count_nota_menyusul} nota menyusul
                                          </div>
                                        )}
                                      </div>
                                    ) : pm.count_nota_menyusul != null && pm.count_nota_menyusul > 0 ? (
                                      <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                                        {pm.count_nota_menyusul} nota menyusul
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">-</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-3 text-right font-mono font-bold text-emerald-700 dark:text-emerald-300">
                                    {pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0 ? (
                                      `Rp ${pm.total_nilai_belanja_riil.toLocaleString('id-ID')}`
                                    ) : (
                                      <span className="text-slate-400 font-normal">-</span>
                                    )}
                                  </td>
                                </>
                              )}
                              <td className="py-3 px-3 text-center">
                                <span
                                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                    evalRow.statusKey === 'TERSEDIA'
                                      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                      : evalRow.statusKey === 'BELUM_SERAH'
                                      ? 'bg-purple-100 text-purple-800 border border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700'
                                      : evalRow.statusKey === 'TUNTAS'
                                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800'
                                      : evalRow.statusKey === 'HABIS'
                                      ? 'bg-orange-100 text-orange-800 border border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700'
                                      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                                  }`}
                                >
                                  {evalRow.statusKey === 'TERSEDIA' && <CheckCircle2 className="w-3 h-3" />}
                                  <span>
                                    {evalRow.statusKey === 'TERSEDIA'
                                      ? `Tersedia (${pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${pm.satuan})`
                                      : evalRow.statusLabel}
                                  </span>
                                </span>
                              </td>
                              <td className="py-3 px-3.5 text-center">
                                <div className="flex items-center justify-center gap-1.5 flex-nowrap">
                                  {evalRow.actionType === 'RIWAYAT' ? (
                                    <button
                                      type="button"
                                      onClick={() => handleViewItemHistory(pm.nama_barang)}
                                      title={evalRow.actionTooltip}
                                      className="inline-flex items-center justify-center gap-1.5 min-w-[114px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer active:scale-95 border border-slate-200/60 dark:border-slate-700/60"
                                    >
                                      <History className="w-3 h-3" />
                                      <span>Riwayat</span>
                                    </button>
                                  ) : evalRow.actionType === 'APPROVE' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (evalRow.pendingApprovalMutationId) {
                                            startTransition(() => {
                                              setActiveTab('MUTATION_HISTORY');
                                              setSearchQuery(pm.nama_barang);
                                            });
                                          }
                                        }}
                                        title={evalRow.actionTooltip}
                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${getActionVariantClass(
                                          evalRow.actionVariant
                                        )}`}
                                      >
                                        <CheckCircle2 className="w-3 h-3" />
                                        <span>{evalRow.actionLabel}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleViewItemHistory(pm.nama_barang)}
                                        title="Lihat riwayat transaksi material ini"
                                        className="w-7 h-7 sm:w-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center active:scale-95"
                                      >
                                        <History className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : evalRow.actionType === 'PAKAI' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenWarehouseMaterialOut(pm)}
                                        title={evalRow.actionTooltip}
                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${getActionVariantClass(
                                          'rose'
                                        )}`}
                                      >
                                        <ArrowUpRight className="w-3 h-3" />
                                        <span>Pakai</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleViewItemHistory(pm.nama_barang)}
                                        title="Lihat riwayat transaksi material ini"
                                        className="w-7 h-7 sm:w-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center active:scale-95"
                                      >
                                        <History className="w-3.5 h-3.5" />
                                      </button>
                                    </>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleOpenWarehouseMaterialIn(pm)}
                                        title={evalRow.actionTooltip}
                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${getActionVariantClass(
                                          evalRow.actionVariant
                                        )}`}
                                      >
                                        <ArrowDownLeft className="w-3 h-3" />
                                        <span>Masuk</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => handleViewItemHistory(pm.nama_barang)}
                                        title="Lihat riwayat transaksi material ini"
                                        className="w-7 h-7 sm:w-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center active:scale-95"
                                      >
                                        <History className="w-3.5 h-3.5" />
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

          {/* =====================================================================
              POV 2: REALISASI PER POS PEKERJAAN BOQ — "BEDAKAN KELUAR" (274 POS)
          ===================================================================== */}
          {activeTab === 'BOQ_MONITOR' && (
            <div className="space-y-4">
              {/* Ringkasan Nilai Kontrak Dinamis (Multi-Tenant: Kontraktor & Klien Proyek Aktif) */}
              <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 dark:from-slate-950 dark:via-blue-950/70 dark:to-slate-950 text-white p-4 sm:p-5 rounded-2xl border border-blue-900/40 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-blue-800/40">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-600/30 rounded-xl border border-blue-500/40">
                      <FileCheck2 className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300">
                        Realisasi Pemakaian per Pos Pekerjaan BOQ
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        {tenantBranding.contractorName} · {tenantBranding.projectName} (Klien: {tenantBranding.clientName}) — Kontrol Kebutuhan & Serapan per Pos Kontrak
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => openExportModal('BOQ')}
                      disabled={isExportingBoq}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{isExportingBoq ? 'Menyiapkan PDF...' : 'Ekspor PDF BOQ'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3.5 pt-3.5">
                  {activeRole === 'Viewer/Pengamat' ? (
                    <>
                      {/* KONTAINER 1 (VIEWER): RUANG LINGKUP KONTRAK */}
                      <div className="bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent p-4 rounded-xl border border-amber-500/30 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-amber-300 tracking-wider">
                            <span>1. Ruang Lingkup Kontrak</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[9px] font-bold">
                              Total Pos
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-amber-300 font-mono tracking-tight">
                            {boqMetrics.totalKontraktorItems} Pos Kontraktor
                          </div>
                          <div className="mt-2 pt-2 border-t border-amber-500/20 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Material Kontrak:</span>
                              <span className="font-mono font-bold text-blue-400">
                                {items.filter(it => !isClientProvidedRemark(it.keterangan, tenantBranding.clientName) && it.satuan !== 'ls').length} Pos
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Upah & Jasa:</span>
                              <span className="font-mono font-bold text-emerald-400">
                                {items.filter(it => (it.kategori || '').toLowerCase().includes('manpower') || (it.kategori || '').toLowerCase().includes('upah') || it.satuan === 'ls').length} Pos
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-amber-500/10 text-[10px] text-amber-200/80 font-medium">
                          Pelaksanaan {tenantBranding.contractorName}
                        </div>
                      </div>

                      {/* KONTAINER 2 (VIEWER): KEDATANGAN MATERIAL */}
                      <div className="bg-white/5 dark:bg-white/[0.03] p-4 rounded-xl border border-blue-500/30 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-blue-300 tracking-wider">
                            <span>2. Material Tiba</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-blue-400/20 text-blue-200 text-[9px] font-bold">
                              Gudang
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-blue-400 font-mono tracking-tight">
                            {boqMetrics.arrivedPosCoverageCount} Pos Tiba
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/10 space-y-1 text-xs text-slate-300">
                            <p className="text-[11px] text-slate-400">
                              {boqMetrics.arrivedMaterialTypesCount} jenis material fisik telah diterima di gudang proyek.
                            </p>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-white/10 text-[10px] text-slate-300 font-medium">
                          Status Penerimaan Fisik
                        </div>
                      </div>

                      {/* KONTAINER 3 (VIEWER): IMPLEMENTASI LAPANGAN */}
                      <div className="bg-white/5 dark:bg-white/[0.03] p-4 rounded-xl border border-indigo-500/30 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                            <span>3. Realisasi Lapangan</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-indigo-400/20 text-indigo-200 text-[9px] font-bold">
                              Progres
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-indigo-300 font-mono tracking-tight">
                            {boqMetrics.fulfilledCount} Pos Terpenuhi
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/10 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Dalam Pengerjaan:</span>
                              <span className="font-mono font-bold text-amber-400">
                                {boqMetrics.inProgressCount} Pos
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Belum Mulai:</span>
                              <span className="font-mono font-bold text-slate-400">
                                {boqMetrics.notStartedCount} Pos
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-white/10 text-[10px] text-slate-300 font-medium">
                          Tingkat Penyelesaian Fisik
                        </div>
                      </div>

                      {/* KONTAINER 4 (VIEWER): KEWAJIBAN FREE-ISSUE KLIEN */}
                      <div className="bg-purple-950/40 p-4 rounded-xl border border-purple-800/40 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-purple-300 tracking-wider">
                            <span>4. Kewajiban Klien</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-purple-900/60 text-purple-200 text-[9px] font-bold">
                              {clientObligationStats.totalItems} Pos
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-purple-300 font-mono tracking-tight">
                            Jatah Klien
                          </div>
                          <div className="mt-2 pt-2 border-t border-purple-800/30 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-purple-300/80">IN (Tiba):</span>
                              <span className="font-mono font-bold text-emerald-300">
                                {clientObligationStats.totalQtyMasuk.toLocaleString('id-ID')} unit ({clientObligationStats.arrivedItemsCount} pos)
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-purple-300/80">OUT (Terpasang):</span>
                              <span className="font-mono font-bold text-indigo-300">
                                {clientObligationStats.totalQtyKeluar.toLocaleString('id-ID')} unit
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-purple-800/30 text-[10px] font-medium flex items-center justify-between">
                          <span className="text-purple-200/80">SISA Belum Tiba</span>
                          <span className="font-mono font-bold text-amber-300">
                            {clientObligationStats.totalQtySisa.toLocaleString('id-ID')} unit ({clientObligationStats.pendingItemsCount} pos)
                          </span>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* KONTAINER 1: HERO KONTRAK PELAKSANAAN (Disatukan: Grand Total, Material, Upah & Jasa) */}
                      <div className="bg-gradient-to-br from-amber-500/15 via-amber-500/5 to-transparent p-4 rounded-xl border border-amber-500/30 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-amber-300 tracking-wider">
                            <span>1. Nilai Kontrak Pelaksanaan</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-amber-400/20 text-amber-200 text-[9px] font-bold">
                              Total Keseluruhan
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-amber-300 font-mono tracking-tight">
                            {formatRupiah(boqMetrics.contractGrandTotal)}
                          </div>
                          <div className="mt-2 pt-2 border-t border-amber-500/20 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Material Kontrak:</span>
                              <span className="font-mono font-bold text-blue-400">
                                {formatRupiah(boqMetrics.contractMaterialTotal)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Upah & Jasa:</span>
                              <span className="font-mono font-bold text-emerald-400">
                                {formatRupiah(boqMetrics.contractManpowerTotal)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-amber-500/10 text-[10px] text-amber-200/80 font-medium flex items-center justify-between">
                          <span>Pagu {tenantBranding.contractorName}</span>
                          <span>{boqMetrics.totalKontraktorItems} Pos Kontrak</span>
                        </div>
                      </div>

                      {/* KONTAINER 2: TOTAL SUDAH MASUK / DIBELI RIIL */}
                      <div className="bg-white/5 dark:bg-white/[0.03] p-4 rounded-xl border border-blue-500/30 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-blue-300 tracking-wider">
                            <span>2. Belanja Masuk / Dibeli Riil</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-blue-400/20 text-blue-200 text-[9px] font-bold">
                              {financialExecutionMetrics.penyerapanPct.toFixed(1)}% Terserap
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-blue-400 font-mono tracking-tight">
                            {formatRupiah(financialExecutionMetrics.totalInValue)}
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/10 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Material Masuk:</span>
                              <span className="font-mono font-semibold text-slate-200">
                                {formatRupiah(financialExecutionMetrics.materialInValue)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Jasa/Upah Masuk:</span>
                              <span className="font-mono font-semibold text-slate-200">
                                {formatRupiah(financialExecutionMetrics.manpowerInValue)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-white/10 text-[10px] text-slate-300 font-medium flex items-center justify-between">
                          <span>Sisa Pagu Aman</span>
                          <span className="font-mono font-bold text-emerald-400">
                            {formatRupiah(financialExecutionMetrics.sisaPaguKontrak)}
                          </span>
                        </div>
                      </div>

                      {/* KONTAINER 3: TOTAL SUDAH DIIMPLEMENTASIKAN / KELUAR & PROFIT */}
                      <div className="bg-white/5 dark:bg-white/[0.03] p-4 rounded-xl border border-indigo-500/30 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-indigo-300 tracking-wider">
                            <span>3. Terimplementasi & Profit</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-indigo-400/20 text-indigo-200 text-[9px] font-bold">
                              Lapangan
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-indigo-300 font-mono tracking-tight">
                            {formatRupiah(financialExecutionMetrics.totalOutValue)}
                          </div>
                          <div className="mt-2 pt-2 border-t border-white/10 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Material Terpasang:</span>
                              <span className="font-mono font-semibold text-slate-200">
                                {formatRupiah(financialExecutionMetrics.materialOutValue)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-slate-400">Upah/Jasa Terlaksana:</span>
                              <span className="font-mono font-semibold text-slate-200">
                                {formatRupiah(financialExecutionMetrics.manpowerOutValue)}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-white/10 text-[10px] font-medium flex items-center justify-between">
                          <span className="text-slate-300">Margin Efisiensi Kontrak</span>
                          <span className="font-mono font-bold text-emerald-400">
                            +{formatRupiah(financialExecutionMetrics.sisaPaguKontrak)}
                          </span>
                        </div>
                      </div>

                      {/* KONTAINER 4: SEGALA HAL TENTANG KEWAJIBAN KLIEN (Item, Nominal, IN/OUT/SISA) */}
                      <div className="bg-purple-950/40 p-4 rounded-xl border border-purple-800/40 flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between gap-1 text-[10px] uppercase font-bold text-purple-300 tracking-wider">
                            <span>4. Kewajiban Klien</span>
                            <span className="px-1.5 py-0.5 rounded-full bg-purple-900/60 text-purple-200 text-[9px] font-bold">
                              {clientObligationStats.totalItems} Pos
                            </span>
                          </div>
                          <div className="mt-1.5 text-xl sm:text-2xl font-black text-purple-300 font-mono tracking-tight">
                            {clientObligationStats.totalNominal > 0 ? formatRupiah(clientObligationStats.totalNominal) : 'Jatah Klien'}
                          </div>
                          <div className="mt-2 pt-2 border-t border-purple-800/30 space-y-1 text-xs">
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-purple-300/80">IN (Masuk Tiba):</span>
                              <span className="font-mono font-bold text-emerald-300">
                                {clientObligationStats.totalQtyMasuk.toLocaleString('id-ID')} unit ({clientObligationStats.arrivedItemsCount} pos)
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-slate-300">
                              <span className="text-[11px] text-purple-300/80">OUT (Terpasang):</span>
                              <span className="font-mono font-bold text-indigo-300">
                                {clientObligationStats.totalQtyKeluar.toLocaleString('id-ID')} unit ({clientObligationStats.consumedItemsCount} pos)
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="mt-2.5 pt-1.5 border-t border-purple-800/30 text-[10px] font-medium flex items-center justify-between">
                          <span className="text-purple-200/80">SISA Belum Tiba</span>
                          <span className="font-mono font-bold text-amber-300">
                            {clientObligationStats.totalQtySisa.toLocaleString('id-ID')} unit ({clientObligationStats.pendingItemsCount} pos)
                          </span>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Filter & Kontrol Pencarian BOQ */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div className="relative flex-1 min-w-0">
                    <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      aria-label="Cari kode BOQ, nama material, atau uraian pekerjaan"
                      placeholder="Cari kode BOQ (I/A/1), nama material (Kayu, Pasir, Semen), atau uraian pekerjaan..."
                      value={boqSearchQuery}
                      onChange={(e) => setBoqSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => openExportModal('BOQ')}
                    disabled={isExportingBoq || groupedBoqData.length === 0}
                    title="Ekspor PDF sesuai filter & urutan sortir di layar"
                    className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{isExportingBoq ? 'Menyiapkan...' : 'Ekspor PDF'}</span>
                  </button>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      onClick={() => startTransition(() => setBoqProviderFilter('ALL'))}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                        boqProviderFilter === 'ALL'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      Semua Penyedia
                    </button>
                    <button
                      onClick={() => startTransition(() => setBoqProviderFilter('KONTRAKTOR'))}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                        boqProviderFilter === 'KONTRAKTOR'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      🏢 {tenantBranding.contractorName}
                    </button>
                    <button
                      onClick={() => startTransition(() => setBoqProviderFilter('IMK'))}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                        boqProviderFilter === 'IMK'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      👤 Jatah Klien ({tenantBranding.clientName})
                    </button>
                  </div>

                  <select
                    value={boqStatusFilter}
                    onChange={(e) => {
                      const val = e.target.value as any;
                      startTransition(() => setBoqStatusFilter(val));
                    }}
                    aria-label="Filter status pemakaian pos BOQ"
                    className="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden"
                  >
                    <option value="ALL">Semua Status Pos</option>
                    {evalContext.partyPov === 'KLIEN' ? (
                      <>
                        <option value="BELUM_SERAH">Belum Serah</option>
                        <option value="SIAP_PAKAI">Siap Pakai</option>
                        <option value="PROSES">Proses</option>
                        <option value="HABIS">Habis</option>
                        <option value="TUNTAS">Tuntas</option>
                        <option value="LEBIH">Lebih</option>
                      </>
                    ) : (
                      <>
                        <option value="BELUM_MASUK">Belum Masuk</option>
                        <option value="BELUM_JALAN">Belum Jalan</option>
                        <option value="SIAP_PAKAI">Siap Pakai</option>
                        <option value="PROSES">Proses</option>
                        <option value="HABIS">Habis</option>
                        <option value="TUNTAS">Tuntas</option>
                        <option value="LEBIH">Lebih</option>
                      </>
                    )}
                  </select>

                  <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-2">
                    <button
                      onClick={() => startTransition(handleExpandAll)}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Buka Semua
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      onClick={() => startTransition(handleCollapseAll)}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Tutup Semua
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabel Hierarki 274 Pos Pekerjaan BOQ — "Bedakan Keluar" (Tanpa Duplikasi Kolom Masuk) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 w-24">
                          {renderSortBtn('Kode BOQ', 'kode_boq', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'kode_boq', 'asc')))
                          )}
                        </th>
                        <th className="py-3 px-3.5">
                          {renderSortBtn('Uraian Material & Pekerjaan', 'nama_barang', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'nama_barang', 'asc')))
                          )}
                        </th>
                        <th className="py-3 px-3 text-center">
                          {renderSortBtn('Penyedia', 'penyedia', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'penyedia', 'asc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Target Pos BOQ', 'qty_boq', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'qty_boq', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Terpakai di Pos Ini (Keluar)', 'qty_keluar_total', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'qty_keluar_total', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3 text-right">
                          {renderSortBtn('Sisa Kebutuhan Pos', 'qty_pemenuhan_sisa', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'qty_pemenuhan_sisa', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3 text-center">
                          {renderSortBtn('Ketersediaan Gudang', 'stok_saat_ini', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'stok_saat_ini', 'desc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3 text-center">
                          {renderSortBtn('Status Pos', 'status_pemenuhan', boqSort, () =>
                            startTransition(() => setBoqSort((prev) => toggleSort(prev, 'status_pemenuhan', 'desc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3.5 text-center w-28">{evalContext.partyPov === 'KLIEN' ? 'Riwayat' : 'Aksi Cepat'}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {groupedBoqData.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Tidak ada pos pekerjaan BOQ yang cocok dengan filter pencarian.
                          </td>
                        </tr>
                      ) : (
                        groupedBoqData.map((div) => {
                          const isDivCollapsed = collapsedDivisions.has(div.name);

                          return (
                            <React.Fragment key={div.name}>
                              <tr className="bg-[#FFF9C4] dark:bg-[#713F12]/60 border-y border-amber-300 dark:border-amber-900/60 text-amber-950 dark:text-amber-200 font-bold transition-colors">
                                <td colSpan={9} className="py-2.5 px-3.5">
                                  <button
                                    onClick={() => toggleDivision(div.name)}
                                    className="flex items-center gap-2 w-full text-left text-xs uppercase tracking-wide cursor-pointer focus:outline-hidden"
                                  >
                                    {isDivCollapsed ? (
                                      <ChevronRight className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                                    )}
                                    <span>{div.name}</span>
                                    <span className="ml-auto text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-200/90 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200">
                                      {div.totalItems} Pos
                                    </span>
                                  </button>
                                </td>
                              </tr>

                              {!isDivCollapsed &&
                                div.subSections.map((sub) => {
                                  const subKey = `${div.name}__${sub.name}`;
                                  const isSubCollapsed = collapsedSubSections.has(subKey);

                                  return (
                                    <React.Fragment key={subKey}>
                                      <tr className="bg-[#DCFCE7] dark:bg-[#064E3B]/60 border-y border-emerald-300 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-200 font-semibold transition-colors">
                                        <td colSpan={9} className="py-2 px-4">
                                          <button
                                            onClick={() => toggleSubSection(subKey)}
                                            className="flex items-center gap-2 w-full text-left text-xs cursor-pointer focus:outline-hidden"
                                          >
                                            {isSubCollapsed ? (
                                              <ChevronRight className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400 shrink-0" />
                                            ) : (
                                              <ChevronDown className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400 shrink-0" />
                                            )}
                                            <span>{sub.name}</span>
                                            <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-200/90 dark:bg-emerald-900/70 text-emerald-900 dark:text-emerald-200">
                                              {sub.items.length} Pos · {sub.imkCount > 0 ? `${sub.imkCount} Klien · ` : ''}{sub.kontraktorCount} {tenantBranding.contractorName}
                                            </span>
                                          </button>
                                        </td>
                                      </tr>

                                      {!isSubCollapsed &&
                                        sub.items.map((item) => {
                                          const isImk = isClientProvidedRemark(item.keterangan, tenantBranding.clientName);
                                          const keluarPosPct = item.qty_boq > 0 ? Math.round((item.qty_keluar_total / item.qty_boq) * 100) : 0;
                                          const pm = physicalMaterials.find(
                                            (p) => p.id === item.id || p.budget_lines.some((bl) => bl.id === item.id)
                                          );
                                          const evalPos = evaluateBoqPos(item, pm, stockMutations, evalContext);

                                          return (
                                            <tr
                                              key={item.id}
                                              id={`boq-item-${item.id}`}
                                              className="hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors bg-white dark:bg-slate-900"
                                            >
                                              <td className="py-2.5 px-3.5 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                                {item.kode_boq}
                                              </td>

                                              <td className="py-2.5 px-3.5">
                                                <div className="font-semibold text-slate-900 dark:text-white">
                                                  {item.nama_barang}
                                                </div>
                                                {isImk ? (
                                                  <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                                                    {activeRole === 'Viewer/Pengamat'
                                                      ? `Material Jatah Klien (${tenantBranding.clientName})`
                                                      : `Beban Kontraktor: Rp 0 (Jatah Klien ${tenantBranding.clientName})`}
                                                  </div>
                                                ) : activeRole === 'Viewer/Pengamat' ? null : (
                                                  <div className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                                    {formatRupiah(item.harga_satuan)} / {item.satuan}
                                                    <span className="ml-1 font-semibold text-slate-700 dark:text-slate-200">
                                                      (Anggaran Pos: {formatRupiah(item.harga_satuan * item.qty_boq)})
                                                    </span>
                                                  </div>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-center">
                                                {isImk ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
                                                    👤 {tenantBranding.clientName}
                                                  </span>
                                                ) : (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                                                    🏢 {tenantBranding.contractorName}
                                                  </span>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                {item.qty_boq.toLocaleString('id-ID', { maximumFractionDigits: 3 })}{' '}
                                                <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">{item.satuan}</span>
                                              </td>

                                              <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                                                <div>
                                                  {item.qty_keluar_total.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                                </div>
                                                {item.qty_keluar_total > 0 && (
                                                  <div className="text-[9px] font-medium text-slate-600 dark:text-slate-300">
                                                    {keluarPosPct}% terpakai
                                                  </div>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300 font-medium">
                                                {item.qty_pemenuhan_sisa.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                              </td>

                                              <td className="py-2.5 px-3 text-center">
                                                {!item.is_stock_item ? (
                                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">
                                                    — (Pos Jasa / Langsung)
                                                  </span>
                                                ) : evalPos.providerStockLabel ? (
                                                  <div>
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-cyan-50 text-cyan-800 dark:bg-cyan-950/50 dark:text-cyan-300 border border-cyan-200 dark:border-cyan-800/70">
                                                      {evalPos.providerStockLabel}
                                                    </span>
                                                    {evalPos.providerStockSubLabel && (
                                                      <div className="text-[9px] text-slate-500 dark:text-slate-400 mt-0.5">
                                                        {evalPos.providerStockSubLabel}
                                                      </div>
                                                    )}
                                                  </div>
                                                ) : item.stok_saat_ini > 0 ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70">
                                                    Ada: {item.stok_saat_ini.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {item.satuan} siap pakai
                                                  </span>
                                                ) : (
                                                  <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                                    Ada: 0 {item.satuan}
                                                  </span>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-center">
                                                {renderBoqStatusBadge(item, evalPos)}
                                              </td>

                                              <td className="py-2.5 px-3.5 text-center">
                                                <div className="flex items-center justify-center gap-1.5 flex-nowrap">
                                                  {evalPos.actionType === 'RIWAYAT' ? (
                                                    <button
                                                      type="button"
                                                      onClick={() => handleViewItemHistory(item.nama_barang)}
                                                      title={evalPos.actionTooltip}
                                                      className="inline-flex items-center justify-center gap-1.5 min-w-[114px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer active:scale-95 border border-slate-200/60 dark:border-slate-700/60"
                                                    >
                                                      <History className="w-3 h-3" />
                                                      <span>Riwayat</span>
                                                    </button>
                                                  ) : evalPos.actionType === 'APPROVE' ? (
                                                    <>
                                                      <button
                                                        type="button"
                                                        onClick={() => {
                                                          if (evalPos.pendingApprovalMutationId) {
                                                            startTransition(() => {
                                                              setActiveTab('MUTATION_HISTORY');
                                                              setSearchQuery(item.nama_barang);
                                                            });
                                                          }
                                                        }}
                                                        title={evalPos.actionTooltip}
                                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${getActionVariantClass(
                                                          evalPos.actionVariant
                                                        )}`}
                                                      >
                                                        <CheckCircle2 className="w-3 h-3" />
                                                        <span>{evalPos.actionLabel}</span>
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleViewItemHistory(item.nama_barang)}
                                                        title="Lihat riwayat transaksi item ini"
                                                        className="w-7 h-7 sm:w-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center active:scale-95"
                                                      >
                                                        <History className="w-3.5 h-3.5" />
                                                      </button>
                                                    </>
                                                  ) : evalPos.actionType === 'CATAT_JASA' ? (
                                                    <>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleOpenItemMutation(item, 'KELUAR')}
                                                        title={evalPos.actionTooltip}
                                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${getActionVariantClass(
                                                          'indigo'
                                                        )}`}
                                                      >
                                                        <ClipboardCheck className="w-3 h-3" />
                                                        <span>Catat</span>
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleViewItemHistory(item.nama_barang)}
                                                        title="Lihat riwayat transaksi item ini"
                                                        className="w-7 h-7 sm:w-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center active:scale-95"
                                                      >
                                                        <History className="w-3.5 h-3.5" />
                                                      </button>
                                                    </>
                                                  ) : evalPos.actionType === 'PAKAI' ? (
                                                    <>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleOpenItemMutation(item, 'KELUAR')}
                                                        title={evalPos.actionTooltip}
                                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${getActionVariantClass(
                                                          'rose'
                                                        )}`}
                                                      >
                                                        <ArrowUpRight className="w-3 h-3" />
                                                        <span>Pakai</span>
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleViewItemHistory(item.nama_barang)}
                                                        title="Lihat riwayat transaksi item ini"
                                                        className="w-7 h-7 sm:w-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center active:scale-95"
                                                      >
                                                        <History className="w-3.5 h-3.5" />
                                                      </button>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleOpenItemMutation(item, 'MASUK')}
                                                        title={evalPos.actionTooltip}
                                                        className={`inline-flex items-center justify-center gap-1 min-w-[82px] h-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] px-2.5 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${getActionVariantClass(
                                                          evalPos.actionVariant
                                                        )}`}
                                                      >
                                                        <ArrowDownLeft className="w-3 h-3" />
                                                        <span>Masuk</span>
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() => handleViewItemHistory(item.nama_barang)}
                                                        title="Lihat riwayat transaksi item ini"
                                                        className="w-7 h-7 sm:w-7 sm:h-7 min-h-[28px] max-sm:min-h-[34px] p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer inline-flex items-center justify-center active:scale-95"
                                                      >
                                                        <History className="w-3.5 h-3.5" />
                                                      </button>
                                                    </>
                                                  )}
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                    </React.Fragment>
                                  );
                                })}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              POV 3: JURNAL TRANSAKSI & MATRIKS PANDUAN TATA KELOLA BARANG
          ===================================================================== */}
          {activeTab === 'MUTATION_HISTORY' && (
            <div className="space-y-4">
              {/* KARTU METRIK & FILTER INTERAKTIF (Menggantikan Teks Statis Sebelumnya) */}
              <div className="space-y-3">
                {/* Bar Info & Toggle Panduan Tata Kelola */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                    <span className="text-xs font-extrabold text-slate-850 dark:text-slate-100">
                      Filter & Metrik Mutasi Barang
                    </span>
                    {filterType !== 'ALL' && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800 flex items-center gap-1">
                        <span>Aktif: {activeFilterLabel}</span>
                        <button
                          type="button"
                          onClick={() => startTransition(() => setFilterType('ALL'))}
                          className="hover:text-rose-600 transition-colors cursor-pointer"
                          title="Hapus filter"
                        >
                          ✕
                        </button>
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsGuideOpen(!isGuideOpen)}
                    className="text-[11px] font-semibold text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400 flex items-center gap-1.5 transition-colors cursor-pointer self-start sm:self-auto"
                  >
                    <Info className="w-3.5 h-3.5" />
                    <span>{isGuideOpen ? 'Tutup Panduan Tata Kelola' : 'Panduan Tata Kelola (CRU Tanpa Hapus)'}</span>
                    {isGuideOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                  </button>
                </div>

                {/* Panel Panduan (Collapsible) */}
                {isGuideOpen && (
                  <div className="p-3.5 rounded-2xl bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 text-[11px] space-y-2 animate-in fade-in duration-150">
                    <div className="font-bold text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      <span>Prinsip Tata Kelola Barang & Koreksi Transaksi (CRU Tanpa Hapus):</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 text-slate-700 dark:text-slate-300">
                      <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-indigo-100 dark:border-slate-800">
                        <b>1. Material Kontrak BOQ:</b> Saat Masuk dicatat ke stok gudang, saat Keluar dialokasikan ke pos pekerjaan BOQ.
                      </div>
                      <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-indigo-100 dark:border-slate-800">
                        <b>2. Material Non-BOQ (Kustom):</b> Dicatat fleksibel saat tiba, tujuan penggunaan disesuaikan instruksi lapangan saat keluar.
                      </div>
                      <div className="p-2.5 rounded-xl bg-white/80 dark:bg-slate-900/80 border border-indigo-100 dark:border-slate-800">
                        <b>3. Koreksi Batal vs Ganti:</b> Tidak ada hapus fisik. Jika salah input, klik Batal atau Ganti (nominal lama dinolkan sah).
                      </div>
                    </div>
                  </div>
                )}

                {/* Grid 3 Kartu Filter Interaktif */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {/* KARTU 1: ARUS MUTASI FISIK */}
                  <div
                    className={`rounded-2xl border p-4 transition-all duration-200 flex flex-col justify-between space-y-3.5 ${
                      ['ALL', 'MASUK', 'KELUAR'].includes(filterType)
                        ? 'bg-gradient-to-br from-blue-50/70 to-indigo-50/40 dark:from-blue-950/30 dark:to-slate-900 border-blue-300 dark:border-blue-700 shadow-xs ring-1 ring-blue-500/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                          <ArrowUpDown className="w-3.5 h-3.5" />
                          <span>Arus Mutasi Fisik</span>
                        </div>
                        <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                          {stockMutations.length} <span className="text-xs font-normal text-slate-500">Transaksi</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/60 dark:text-blue-200">
                        Gudang & Pos
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('ALL'))}
                        className={`px-2 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'ALL'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <span className="text-[10px] font-medium opacity-80">Semua</span>
                        <span className="font-extrabold">{stockMutations.length}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('MASUK'))}
                        className={`px-2 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'MASUK'
                            ? 'bg-emerald-600 text-white shadow-xs'
                            : 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 border border-emerald-200 dark:border-emerald-800/60'
                        }`}
                      >
                        <span className="text-[10px] font-medium opacity-80 flex items-center gap-0.5">
                          <ArrowDownLeft className="w-2.5 h-2.5" /> Masuk
                        </span>
                        <span className="font-extrabold">{mutationStats.masuk}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('KELUAR'))}
                        className={`px-2 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'KELUAR'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 hover:bg-amber-100 border border-amber-200 dark:border-amber-800/60'
                        }`}
                      >
                        <span className="text-[10px] font-medium opacity-80 flex items-center gap-0.5">
                          <ArrowUpRight className="w-2.5 h-2.5" /> Keluar
                        </span>
                        <span className="font-extrabold">{mutationStats.keluar}</span>
                      </button>
                    </div>
                  </div>

                  {/* KARTU 2: PERUNTUKAN & BEBAN BIAYA */}
                  <div
                    className={`rounded-2xl border p-4 transition-all duration-200 flex flex-col justify-between space-y-3.5 ${
                      ['PROYEK_BOQ', 'PERMINTAAN_KLIEN', 'BONUS_KLIEN', 'OPERASIONAL'].includes(filterType)
                        ? 'bg-gradient-to-br from-purple-50/70 to-indigo-50/40 dark:from-purple-950/30 dark:to-slate-900 border-purple-300 dark:border-purple-700 shadow-xs ring-1 ring-purple-500/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400 flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5" />
                          <span>Peruntukan & Beban Biaya</span>
                        </div>
                        <div className="text-xl font-black text-slate-900 dark:text-white mt-1">
                          {mutationStats.boq} <span className="text-xs font-normal text-slate-500">BOQ Kontraktor</span>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200">
                        Alokasi Hak
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('PROYEK_BOQ'))}
                        className={`px-1.5 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'PROYEK_BOQ'
                            ? 'bg-purple-600 text-white shadow-xs'
                            : 'bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                        }`}
                        title="Pengadaan Kontraktor (CV Menara Megah)"
                      >
                        <span className="text-[9px] font-medium opacity-80 truncate max-w-full">BOQ Kontrak</span>
                        <span className="font-extrabold">{mutationStats.boq}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('PERMINTAAN_KLIEN'))}
                        className={`px-1.5 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'PERMINTAAN_KLIEN'
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                        }`}
                        title="Permintaan Khusus Klien"
                      >
                        <span className="text-[9px] font-medium opacity-80 truncate max-w-full">Minta Klien</span>
                        <span className="font-extrabold">{mutationStats.klien}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('BONUS_KLIEN'))}
                        className={`px-1.5 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'BONUS_KLIEN'
                            ? 'bg-teal-600 text-white shadow-xs'
                            : 'bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                        }`}
                        title="Bonus / Complimentary Klien"
                      >
                        <span className="text-[9px] font-medium opacity-80 truncate max-w-full">Bonus Klien</span>
                        <span className="font-extrabold">{mutationStats.bonus}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('OPERASIONAL'))}
                        className={`px-1.5 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'OPERASIONAL'
                            ? 'bg-slate-700 text-white shadow-xs'
                            : 'bg-white/80 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700'
                        }`}
                        title="Operasional Proyek"
                      >
                        <span className="text-[9px] font-medium opacity-80 truncate max-w-full">Operasional</span>
                        <span className="font-extrabold">{mutationStats.ops}</span>
                      </button>
                    </div>
                  </div>

                  {/* KARTU 3: PENGAWASAN AUDIT & ALBUM NOTA */}
                  <div
                    className={`rounded-2xl border p-4 transition-all duration-200 flex flex-col justify-between space-y-3.5 ${
                      filterType === 'BEDA_PENYEDIA'
                        ? 'bg-gradient-to-br from-amber-50/70 to-rose-50/40 dark:from-amber-950/30 dark:to-slate-900 border-amber-300 dark:border-amber-700 shadow-xs ring-1 ring-amber-500/20'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                          <ShieldCheck className="w-3.5 h-3.5" />
                          <span>Pengawasan & Bukti Nota</span>
                        </div>
                        <div className="text-xl font-black text-slate-900 dark:text-white mt-1 flex items-center gap-2">
                          {providerMismatchCount > 0 ? (
                            <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                              <AlertTriangle className="w-4 h-4" />
                              {providerMismatchCount} Talangan
                            </span>
                          ) : (
                            <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-base font-bold">
                              <CheckCircle2 className="w-4 h-4" />
                              Tertib Penyedia
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Audit & Nota
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => startTransition(() => setFilterType('BEDA_PENYEDIA'))}
                        className={`px-2 py-1.5 rounded-xl text-xs font-bold transition-all flex flex-col items-center justify-center cursor-pointer ${
                          filterType === 'BEDA_PENYEDIA'
                            ? 'bg-amber-600 text-white shadow-xs'
                            : providerMismatchCount > 0
                            ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 hover:bg-amber-100 border border-amber-200 dark:border-amber-800'
                            : 'bg-white/80 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 border border-slate-200 dark:border-slate-700'
                        }`}
                        title="Filter item mutasi dengan indikasi beda penyedia / talangan sepihak"
                      >
                        <span className="text-[9px] font-medium opacity-80 flex items-center gap-1">
                          <AlertTriangle className="w-2.5 h-2.5" /> Beda Penyedia
                        </span>
                        <span className="font-extrabold">{providerMismatchCount} Item</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsProjectAlbumOpen(true)}
                        className="px-2 py-1.5 rounded-xl text-xs font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 transition-all flex flex-col items-center justify-center cursor-pointer shadow-2xs"
                        title="Buka galeri album berkas nota fisik resmi proyek"
                      >
                        <span className="text-[9px] font-medium opacity-80 flex items-center gap-1">
                          <Images className="w-2.5 h-2.5" /> Album Nota
                        </span>
                        <span className="font-extrabold">{projectAlbumItems.length} Nota</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {searchQuery && (
                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-900 dark:text-blue-200">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>Menampilkan mutasi khusus untuk: <strong>{searchQuery}</strong></span>
                  </div>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-xs font-semibold underline hover:text-blue-700 dark:hover:text-blue-100 cursor-pointer"
                  >
                    Hapus Filter & Tampilkan Semua
                  </button>
                </div>
              )}

              {/* Toolbar Pencarian & Aksi Dokumen (Lega & Tidak Berdesakan) */}
              <div className="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors">
                <div className="relative flex-1 min-w-0">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Cari transaksi mutasi barang"
                    placeholder="Cari transaksi, material, keperluan, PIC, toko, atau no surat jalan..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {filterType !== 'ALL' && (
                    <button
                      type="button"
                      onClick={() => startTransition(() => setFilterType('ALL'))}
                      className="px-3 py-2 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                      title="Kembalikan ke semua transaksi"
                    >
                      <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                      <span>Atur Ulang Filter</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => openExportModal('STOCK_JOURNAL')}
                    disabled={isExportingJournal || filteredMutations.length === 0}
                    title="Ekspor PDF sesuai filter & urutan sortir di layar"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{isExportingJournal ? 'Menyiapkan...' : 'Ekspor PDF'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsProjectAlbumOpen(true)}
                    title="Buka Album Galeri Seluruh Berkas Nota Resmi Proyek"
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs transition-colors cursor-pointer"
                  >
                    <Images className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400" />
                    <span>Album Nota</span>
                    {projectAlbumItems.length > 0 && (
                      <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-extrabold">
                        {projectAlbumItems.length}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Bar Tindakan Seleksi Kolektif Nota (Batch Link 1 Nota -> Banyak Item) */}
              {selectedMutationIds.length > 0 && (
                <div className="bg-blue-50/90 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-900/80 p-3.5 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs animate-in fade-in">
                  <div className="flex items-center gap-2.5 text-xs text-blue-900 dark:text-blue-100 font-semibold">
                    <div className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4" />
                    </div>
                    <span>
                      <b>{selectedMutationIds.length} item mutasi</b> dipilih untuk dikelompokkan ke dalam <b>1 lembar nota fisik toko</b> yang sama.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedMutationIds([])}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                    >
                      Batal Pilih
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const targets = stockMutations.filter((m) => selectedMutationIds.includes(m.id));
                        setBatchReceiptTargets(targets);
                        setIsBatchReceiptModalOpen(true);
                      }}
                      className="px-4 py-1.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Receipt className="w-3.5 h-3.5" />
                      <span>🧾 Lengkapi Nota Bersama ({selectedMutationIds.length} Item)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Tabel Riwayat Baris Transaksi (Tanpa Kolom Persetujuan per Baris!) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3 w-8 text-center">
                          <input
                            type="checkbox"
                            aria-label="Pilih semua mutasi masuk aktif"
                            title="Pilih semua mutasi masuk aktif untuk disatukan notanya"
                            checked={
                              selectedMutationIds.length > 0 &&
                              selectedMutationIds.length === filteredMutations.filter((m) => m.jenis === 'MASUK' && !m.is_batal && !m.is_ganti).length
                            }
                            onChange={() => {
                              const activeIn = filteredMutations
                                .filter((m) => m.jenis === 'MASUK' && !m.is_batal && !m.is_ganti)
                                .map((m) => m.id);
                              if (selectedMutationIds.length === activeIn.length) {
                                setSelectedMutationIds([]);
                              } else {
                                setSelectedMutationIds(activeIn);
                              }
                            }}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        </th>
                        <th className="py-3 px-3.5 w-10 text-center">No</th>
                        <th className="py-3 px-3.5">
                          {renderSortBtn('Tanggal', 'tanggal', journalSort, () =>
                            startTransition(() => setJournalSort((prev) => toggleSort(prev, 'tanggal', 'desc')))
                          )}
                        </th>
                        <th className="py-3 px-3.5 text-center">
                          {renderSortBtn('Jenis', 'jenis', journalSort, () =>
                            startTransition(() => setJournalSort((prev) => toggleSort(prev, 'jenis', 'asc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3.5">
                          {renderSortBtn('Material', 'nama_barang', journalSort, () =>
                            startTransition(() => setJournalSort((prev) => toggleSort(prev, 'nama_barang', 'asc')))
                          )}
                        </th>
                        <th className="py-3 px-3.5 text-right">
                          {renderSortBtn('Jumlah', 'jumlah', journalSort, () =>
                            startTransition(() => setJournalSort((prev) => toggleSort(prev, 'jumlah', 'desc'))),
                            'right'
                          )}
                        </th>
                        <th className="py-3 px-3.5">Asal / Peruntukan & Jejak Audit</th>
                        <th className="py-3 px-3.5 text-center">
                          {renderSortBtn('Status Baris Data', 'status', journalSort, () =>
                            startTransition(() => setJournalSort((prev) => toggleSort(prev, 'status', 'desc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3.5 text-center">Koreksi Langsung (Batal / Ganti)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredMutations.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Belum ada riwayat transaksi mutasi barang.
                          </td>
                        </tr>
                      ) : (
                        filteredMutations.map((mut, idx) => {
                          const isVoid = mut.is_batal || mut.status_dokumen === 'BATAL';
                          const isReplaced = mut.is_ganti || mut.status_dokumen === 'DIGANTI';
                          const canCorrectRow = rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti;
                          const rowDiscrepancy = analyzeIncomingProviderDiscrepancy(mut, physicalMaterials, stockMutations, providerLabels);
                          const isSelected = selectedMutationIds.includes(mut.id);
                          const isHighlighted = highlightedMutationId === mut.id;
                          const canSelectForReceipt = mut.jenis === 'MASUK' && !isVoid && !isReplaced;
                          const hasReceiptAttachment = mut.lampiran_nota_urls && mut.lampiran_nota_urls.length > 0;
                          const replacementMutation = mut.referensi_ganti_id
                            ? stockMutations.find((m) => m.id === mut.referensi_ganti_id)
                            : undefined;

                          return (
                            <tr
                              key={mut.id}
                              id={`mutation-row-${mut.id}`}
                              className={`transition-all duration-300 ${
                                isHighlighted
                                  ? 'bg-amber-100/90 dark:bg-amber-950/80 ring-2 ring-amber-500 shadow-md animate-pulse'
                                  : isSelected
                                  ? 'bg-blue-50/70 dark:bg-blue-950/40 ring-1 ring-blue-500/50'
                                  : isVoid
                                  ? 'opacity-65 bg-rose-50/30 dark:bg-rose-950/20'
                                  : isReplaced
                                  ? 'opacity-75 bg-amber-50/30 dark:bg-amber-950/20'
                                  : rowDiscrepancy.isMismatch
                                  ? 'bg-amber-50/50 dark:bg-amber-950/20'
                                  : 'hover:bg-slate-50/80 dark:hover:bg-slate-800/50'
                              }`}
                            >
                              <td className="py-3 px-3 text-center">
                                {canSelectForReceipt ? (
                                  <input
                                    type="checkbox"
                                    checked={isSelected}
                                    onChange={() => {
                                      setSelectedMutationIds((prev) =>
                                        prev.includes(mut.id) ? prev.filter((id) => id !== mut.id) : [...prev, mut.id]
                                      );
                                    }}
                                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                    title="Pilih item ini untuk disatukan ke dalam 1 nota toko"
                                  />
                                ) : (
                                  <span className="text-slate-300 dark:text-slate-700">·</span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center text-slate-600 dark:text-slate-300 font-mono text-[11px] font-medium">
                                <div>{idx + 1}</div>
                                <div className="text-[9px] text-slate-400 dark:text-slate-500 font-bold" title={`ID Transaksi: ${mut.id}`}>
                                  #{mut.jenis === 'MASUK' ? 'MSK' : 'KLR'}-{mut.id.slice(0, 6).toUpperCase()}
                                </div>
                              </td>
                              <td className="py-3 px-3.5 text-slate-700 dark:text-slate-200 font-mono text-[11px] whitespace-nowrap">
                                {formatDateTime(mut.tanggal)}
                              </td>
                              <td className="py-3 px-3.5 text-center">
                                <span
                                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    mut.jenis === 'MASUK'
                                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                      : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                                  }`}
                                >
                                  {mut.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                  {mut.jenis}
                                </span>
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-slate-900 dark:text-white">{mut.nama_barang}</span>

                                  {/* Badge 1: Pembatalan (Interaktif: Klik untuk buka detail audit pembatalan) */}
                                  {isVoid && (
                                    <button
                                      type="button"
                                      onClick={() => setAuditDetailMutation(mut)}
                                      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-2 py-0.5 rounded-full bg-rose-100 hover:bg-rose-200 text-rose-800 dark:bg-rose-950/70 dark:hover:bg-rose-900/80 dark:text-rose-300 border border-rose-200 dark:border-rose-900 cursor-pointer transition-all shadow-2xs active:scale-95"
                                      title="Klik untuk melihat detail & alasan pembatalan dokumen ini"
                                    >
                                      ❌ BATAL · Dinolkan
                                    </button>
                                  )}

                                  {/* Badge 2: Penggantian (Interaktif: Klik untuk melompat ke baris baru) */}
                                  {isReplaced && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (mut.referensi_ganti_id) {
                                          handleNavigateToMutation(mut.referensi_ganti_id);
                                        } else {
                                          setAuditDetailMutation(mut);
                                        }
                                      }}
                                      className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-900 dark:bg-amber-950/70 dark:hover:bg-amber-900/80 dark:text-amber-200 border border-amber-200 dark:border-amber-900 cursor-pointer transition-all shadow-2xs active:scale-95"
                                      title={mut.referensi_ganti_id ? `Klik untuk melompat & melihat baris transaksi pengganti (#${mut.referensi_ganti_id.slice(0, 6).toUpperCase()})` : (mut.alasan_batal_ganti || 'Baris ini digantikan')}
                                    >
                                      <span>🔄 DIGANTI · Dinolkan</span>
                                      {mut.referensi_ganti_id && <ArrowUpRight className="w-2.5 h-2.5 ml-0.5" />}
                                    </button>
                                  )}

                                  {/* Badge 3: Tautan Baris Pengganti vs Baris Asal (Interaktif: Navigasi Dua Arah) */}
                                  {mut.referensi_ganti_id && isReplaced && (
                                    <button
                                      type="button"
                                      onClick={() => handleNavigateToMutation(mut.referensi_ganti_id!)}
                                      className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 cursor-pointer transition-all shadow-2xs hover:scale-105 active:scale-95"
                                      title={`Klik untuk melompat & menyorot baris transaksi pengganti #${mut.referensi_ganti_id.slice(0, 6).toUpperCase()}`}
                                    >
                                      <span>↳ Diganti ke #{mut.referensi_ganti_id.slice(0, 6).toUpperCase()}</span>
                                      <ArrowUpRight className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                  {mut.referensi_ganti_id && !isReplaced && (
                                    <button
                                      type="button"
                                      onClick={() => handleNavigateToMutation(mut.referensi_ganti_id!)}
                                      className="inline-flex items-center gap-1 text-[9px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 dark:hover:bg-emerald-900/80 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 cursor-pointer transition-all shadow-2xs hover:scale-105 active:scale-95"
                                      title={`Klik untuk melihat riwayat baris asal #${mut.referensi_ganti_id.slice(0, 6).toUpperCase()} yang digantikan oleh data ini`}
                                    >
                                      <span>↩️ Menggantikan #{mut.referensi_ganti_id.slice(0, 6).toUpperCase()}</span>
                                      <ArrowDownLeft className="w-2.5 h-2.5" />
                                    </button>
                                  )}

                                  {/* Badge 4: Pos BOQ vs Kustom (Interaktif: Klik BOQ langsung beralih ke tab Realisasi BOQ) */}
                                  {mut.is_custom_item ? (
                                    <span
                                      className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300"
                                      title="Belanja barang kustom non-BOQ di luar pos kontrak proyek"
                                    >
                                      ✍️ Kustom Non-BOQ
                                    </span>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => handleNavigateToBoq(mut.barang_id, mut.nama_barang)}
                                      className="inline-flex items-center gap-1 text-[9px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 dark:hover:bg-blue-900/70 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 cursor-pointer transition-all shadow-2xs active:scale-95"
                                      title={`Klik untuk melompat ke tab Realisasi BOQ dan memantau pemenuhan pos "${mut.nama_barang}"`}
                                    >
                                      <span>📦 BOQ</span>
                                      <ExternalLink className="w-2.5 h-2.5" />
                                    </button>
                                  )}
                                </div>
                                {mut.nama_item_aktual && (
                                  <div className="mt-1 inline-flex items-center gap-1.5 text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-800">
                                    <PackageCheck className="w-3 h-3 shrink-0 text-blue-600 dark:text-blue-400" />
                                    <span>Aktual tiba: <b>{mut.nama_item_aktual}</b></span>
                                  </div>
                                )}

                                {/* Akses Cepat Bukti Nota Fisik + Umpan Balik 2 Arah Mutasi Dana */}
                                {(() => {
                                  const isPaidViaCash =
                                    !isFinancialHidden &&
                                    isStockMutationPaidViaCash(
                                      mut,
                                      terpaduReceiptIndex,
                                      tenantBranding.clientName
                                    );
                                  if (!hasReceiptAttachment && !isPaidViaCash) return null;
                                  return (
                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                      {hasReceiptAttachment && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setViewerPrimaryMutation(mut);
                                            const related = findRelatedStockMutationsForReceipt(
                                              mut,
                                              stockMutations,
                                              tenantBranding.clientName
                                            );
                                            setViewerRelatedMutations(related);
                                            const linkedCash = isFinancialHidden
                                              ? []
                                              : findLinkedCashMutationsForStockMutation(
                                                  mut,
                                                  cashMutations,
                                                  tenantBranding.clientName
                                                );
                                            setViewerPrimaryCash(linkedCash[0] || null);
                                            setViewerRelatedCash(linkedCash);
                                            setViewerReceiptScope(
                                              isPaidViaCash || linkedCash.length > 0 ? 'TERPADU' : 'BELANJA_BARANG'
                                            );
                                            setIsReceiptViewerOpen(true);
                                          }}
                                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/80 dark:bg-indigo-950/50 hover:bg-indigo-100 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold transition-colors cursor-pointer shadow-2xs"
                                          title="Klik untuk membuka & memeriksa foto nota asli dari toko"
                                        >
                                          <Paperclip className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                          <span>Bukti Nota: {mut.nomor_nota || mut.nomor_surat_jalan}</span>
                                          {mut.lampiran_nota_urls && mut.lampiran_nota_urls.length > 1 && (
                                            <span className="text-[9px] px-1 rounded bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-indigo-100 font-extrabold">
                                              {mut.lampiran_nota_urls.length} lbr
                                            </span>
                                          )}
                                        </button>
                                      )}
                                      {isPaidViaCash && (
                                        <span
                                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 text-[10px] font-bold"
                                          title="Nota belanja ini sudah direkonsiliasi dan dibayar melalui modul Mutasi Dana"
                                        >
                                          ✓ Terbayar Kas
                                        </span>
                                      )}
                                      {mut.po_id && activeRole !== 'Viewer/Pengamat' && (() => {
                                        const linkedPo = purchaseOrders.find((p) => p.id === mut.po_id);
                                        return (
                                          <button
                                            type="button"
                                            onClick={() => {
                                              setProcurementTargetTab('PO_LIST');
                                              setCurrentView('procurement');
                                            }}
                                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/50 hover:bg-purple-100 dark:hover:bg-purple-900/60 text-purple-800 dark:text-purple-200 text-[10px] font-bold transition-colors cursor-pointer"
                                            title="Penerimaan barang dari Surat Pesanan (PO) — klik untuk membuka modul Pengadaan & PO"
                                          >
                                            PO: {linkedPo?.po_no || mut.nomor_surat_jalan || 'PO Toko'}
                                          </button>
                                        );
                                      })()}
                                    </div>
                                  );
                                })()}

                                {/* Navigasi Cepat dari Baris Diganti ke Baris Baru & Notanya */}
                                {isReplaced && replacementMutation && (
                                  <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                    <button
                                      type="button"
                                      onClick={() => handleNavigateToMutation(replacementMutation.id)}
                                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-900 dark:text-amber-200 text-[10px] font-bold transition-colors cursor-pointer shadow-2xs"
                                      title="Buka dan sorot data transaksi pengganti sah"
                                    >
                                      <ArrowUpRight className="w-3 h-3 text-amber-600 dark:text-amber-400" />
                                      <span>Lihat Baris Pengganti #{replacementMutation.id.slice(0, 6).toUpperCase()}</span>
                                    </button>
                                    {((replacementMutation.lampiran_nota_urls?.length || 0) > 0 || replacementMutation.nomor_nota) && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setViewerPrimaryMutation(replacementMutation);
                                          const related = findRelatedStockMutationsForReceipt(
                                            replacementMutation,
                                            stockMutations,
                                            tenantBranding.clientName
                                          );
                                          setViewerRelatedMutations(related);
                                          const linkedCash = isFinancialHidden
                                            ? []
                                            : findLinkedCashMutationsForStockMutation(
                                                replacementMutation,
                                                cashMutations,
                                                tenantBranding.clientName
                                              );
                                          const replacementPaid =
                                            !isFinancialHidden &&
                                            isStockMutationPaidViaCash(
                                              replacementMutation,
                                              terpaduReceiptIndex,
                                              tenantBranding.clientName
                                            );
                                          setViewerPrimaryCash(linkedCash[0] || null);
                                          setViewerRelatedCash(linkedCash);
                                          setViewerReceiptScope(
                                            replacementPaid || linkedCash.length > 0 ? 'TERPADU' : 'BELANJA_BARANG'
                                          );
                                          setIsReceiptViewerOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/90 dark:bg-indigo-950/60 hover:bg-indigo-100 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold transition-colors cursor-pointer shadow-2xs"
                                        title="Buka berkas nota resmi toko dari transaksi pengganti"
                                      >
                                        <Paperclip className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                                        <span>Buka Nota: {replacementMutation.nomor_nota || 'Toko'}</span>
                                      </button>
                                    )}
                                  </div>
                                )}
                                {mut.catatan && <div className="text-[11px] text-slate-600 dark:text-slate-300 italic mt-0.5">{mut.catatan}</div>}
                              </td>
                              <td className="py-3 px-3.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                                {(isVoid || isReplaced) ? (
                                  <div>
                                    <span className="text-slate-400 dark:text-slate-500 font-mono font-bold">
                                      0 <span className="text-[11px] font-normal">{mut.satuan}</span>
                                    </span>
                                    <div className="text-[9px] font-bold text-rose-600 dark:text-rose-400">
                                      Ditolak / Dinolkan
                                    </div>
                                  </div>
                                ) : (
                                  <span className={mut.jenis === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                    {mut.jenis === 'MASUK' ? '+' : '-'} {mut.jumlah.toLocaleString('id-ID')}{' '}
                                    <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">{mut.satuan}</span>
                                  </span>
                                )}
                                {canViewFinancials && (() => {
                                  const effPrice = getMutationEffectivePrice(mut);
                                  if (effPrice != null && effPrice > 0) {
                                    return (
                                      <div
                                        className={`text-[10px] font-mono font-semibold ${
                                          mut.jenis === 'MASUK'
                                            ? 'text-emerald-700 dark:text-emerald-300'
                                            : 'text-slate-600 dark:text-slate-400'
                                        }`}
                                      >
                                        @ Rp {effPrice.toLocaleString('id-ID')}
                                        {mut.jenis === 'KELUAR' && (
                                          <span className="text-[9px] text-slate-500 dark:text-slate-400 font-normal block">
                                            (Total: Rp {(effPrice * mut.jumlah).toLocaleString('id-ID')})
                                          </span>
                                        )}
                                      </div>
                                    );
                                  }
                                  if (
                                    mut.jenis === 'MASUK' &&
                                    (mut.status_harga === 'NOTA_MENYUSUL' || mut.status_harga === 'BELUM_DIKETAHUI')
                                  ) {
                                    return (
                                      <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400">
                                        Nota Menyusul
                                      </span>
                                    );
                                  }
                                  return null;
                                })()}
                              </td>
                              <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300 max-w-xs">
                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                  {mut.jenis === 'MASUK' ? (
                                    <>
                                      <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                        mut.source_name?.includes('Klien')
                                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                                          : mut.source_name?.includes('Toko')
                                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300'
                                          : 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300'
                                      }`}>
                                        {mut.source_name || `🏢 ${tenantBranding.contractorName}`}
                                      </span>
                                      {rowDiscrepancy.isMismatch && (
                                        <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-950/80 dark:text-amber-200 dark:border-amber-700">
                                          <AlertTriangle className="w-2.5 h-2.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                          {rowDiscrepancy.shortBadge}
                                        </span>
                                      )}
                                    </>
                                  ) : (
                                    mut.beban_biaya === 'KLIEN' || (mut.beban_biaya as string) === 'PERMINTAAN_KLIEN' ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                                        💰 Permintaan Klien (Kena Invoice)
                                      </span>
                                    ) : mut.beban_biaya === 'BONUS_KLIEN' ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300">
                                        🎁 Bonus Klien (Gratis)
                                      </span>
                                    ) : mut.beban_biaya === 'OPERASIONAL' ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300">
                                        🧑‍🍳 Operasional
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                        🏗️ Proyek BOQ
                                      </span>
                                    )
                                  )}
                                </div>
                                <div className="truncate font-medium">
                                  {mut.is_custom_item
                                    ? `${mut.jenis === 'MASUK' ? 'Peruntukan Masuk: ' : 'Peruntukan Keluar: '}${mut.tujuan_keperluan || '-'}`
                                    : mut.tujuan_keperluan || '-'}
                                </div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 font-mono mt-0.5">
                                  PIC: {mut.pic_penerima_penyerah}
                                  {mut.referensi_ganti_id && (
                                    <span>
                                      {' · '}
                                      <button
                                        type="button"
                                        onClick={() => handleNavigateToMutation(mut.referensi_ganti_id!)}
                                        className="text-indigo-600 dark:text-indigo-400 hover:underline font-bold cursor-pointer inline-flex items-center gap-0.5"
                                        title="Klik untuk melompat ke baris transaksi terkait"
                                      >
                                        <span>{isReplaced ? 'Revisi ke #' : 'Revisi dari #'}{mut.referensi_ganti_id.slice(0, 8).toUpperCase()}</span>
                                        <ArrowUpRight className="w-2.5 h-2.5" />
                                      </button>
                                    </span>
                                  )}
                                </div>
                                {mut.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-md">
                                    {mut.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {isReplaced ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (mut.referensi_ganti_id) {
                                        handleNavigateToMutation(mut.referensi_ganti_id);
                                      } else {
                                        setAuditDetailMutation(mut);
                                      }
                                    }}
                                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 hover:bg-amber-200 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900 dark:text-amber-300 cursor-pointer transition-all shadow-2xs active:scale-95"
                                    title="Klik untuk melompat ke baris transaksi pengganti"
                                  >
                                    <FileEdit className="h-3 w-3" /> DIGANTI (Dinolkan) ↗
                                  </button>
                                ) : isVoid ? (
                                  <button
                                    type="button"
                                    onClick={() => setAuditDetailMutation(mut)}
                                    className="inline-flex items-center gap-1 rounded-full bg-rose-100 hover:bg-rose-200 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:hover:bg-rose-900 dark:text-rose-300 cursor-pointer transition-all shadow-2xs active:scale-95"
                                    title="Klik untuk melihat alasan & rincian pembatalan"
                                  >
                                    <Ban className="h-3 w-3" /> BATAL (Dinolkan)
                                  </button>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    <CheckCircle2 className="h-3 w-3" /> TERCATAT AKTIF
                                  </span>
                                )}
                              </td>

                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {!isVoid && !isReplaced ? (
                                  canCorrectRow ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      {mut.jenis === 'MASUK' && (
                                        <button
                                          type="button"
                                          onClick={() => {
                                            setBatchReceiptTargets([mut]);
                                            setIsBatchReceiptModalOpen(true);
                                          }}
                                          className="px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-[10px] font-bold text-blue-700 hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300 cursor-pointer flex items-center gap-1 shadow-2xs"
                                          title="Lengkapi nota resmi toko, harga riil, dan lampirkan foto fisik nota (metode DIGANTI)"
                                        >
                                          <Receipt className="w-3 h-3 text-blue-600 dark:text-blue-400" />
                                          <span>Lengkapi Nota</span>
                                        </button>
                                      )}
                                      <button
                                        onClick={() => {
                                          setBatalTarget(mut);
                                          setBatalReason('');
                                        }}
                                        className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                                        title="Batalkan baris ini secara langsung (nominal dinolkan)"
                                      >
                                        Batal
                                      </button>
                                      <button
                                        onClick={() => handleOpenGanti(mut)}
                                        className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer"
                                        title="Ganti baris yang salah input ini dengan baris revisi baru"
                                      >
                                        Ganti
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                      🔒 Hanya Baca
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">Selesai Dikoreksi</span>
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
            </div>
          )}

          {/* =====================================================================
              POV 4: DOKUMEN RESMI & PERSETUJUAN BERANTAI (TTE / QR CODE)
          ===================================================================== */}
          {activeTab === 'OFFICIAL_DOCUMENTS' && (
            <div className="space-y-4">
              {/* Penjelasan & Form Penerbitan Dokumen Resmi oleh Clerk */}
              <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div className="space-y-0.5">
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Penerbitan & Persetujuan Berantai Dokumen Resmi Mutasi Barang</span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                      Alur persetujuan berjenjang: <b>1. Diterbitkan (Clerk)</b> ➔ <b>2. Diperiksa (Foreman / Spv.)</b> ➔ <b>3. Disetujui (Spv. / Dept. Manager)</b> ➔ <b>4. Mengetahui & Sah TTE/QR (Dept. Manager / KTT-PM / CEO-Direktur)</b>.
                    </p>
                  </div>

                  {/* Ganti Jabatan Cepat: HANYA tampil jika pengguna sah memegang > 1 penugasan jabatan proyek */}
                  {userProjectRoles.length > 1 && (
                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto bg-amber-50/70 dark:bg-amber-950/30 p-1.5 px-3 rounded-xl border border-amber-200 dark:border-amber-800/60">
                      <span className="text-[11px] font-bold text-amber-900 dark:text-amber-200">Ganti Jabatan Cepat:</span>
                      <select
                        value={activeRole}
                        onChange={(e) => setActiveRole(e.target.value as ImpersonateRole)}
                        className="px-2 py-1 text-xs font-extrabold rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-800 text-amber-900 dark:text-amber-200 cursor-pointer shadow-2xs"
                      >
                        {userProjectRoles.map((roleOpt) => (
                          <option key={roleOpt} value={roleOpt}>
                            {roleOpt === 'Viewer/Pengamat' ? 'Pengamat (Klien)' : roleOpt}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                {rolePermissions.canIssue ? (
                  <form onSubmit={handleIssueStockDocument} className="space-y-3 text-xs">
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                      <div className="md:col-span-2 space-y-1">
                        <label className="block font-bold text-slate-700 dark:text-slate-300">
                          Judul Dokumen Berita Acara / Laporan <span className="text-rose-500">*</span>
                        </label>
                        <input
                          type="text"
                          required
                          value={docTitle}
                          onChange={(e) => setDocTitle(e.target.value)}
                          placeholder="Contoh: Berita Acara Rekapitulasi Mutasi Barang & Gudang"
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-amber-500/20"
                        />
                      </div>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="block font-bold text-slate-700 dark:text-slate-300">
                            Periode Laporan <span className="text-rose-500">*</span>
                          </label>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => setDocPeriode('November 2026')}
                              className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
                            >
                              Nov 2026
                            </button>
                            <span className="text-slate-300">·</span>
                            <button
                              type="button"
                              onClick={() => setDocPeriode('Minggu Ini')}
                              className="text-[10px] text-amber-600 dark:text-amber-400 font-semibold hover:underline cursor-pointer"
                            >
                              Minggu Ini
                            </button>
                          </div>
                        </div>
                        <input
                          type="text"
                          required
                          value={docPeriode}
                          onChange={(e) => setDocPeriode(e.target.value)}
                          placeholder="Contoh: November 2026"
                          className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium focus:ring-2 focus:ring-amber-500/20"
                        />
                      </div>

                      <div className="flex items-end">
                        <button
                          type="submit"
                          disabled={submitting}
                          className="w-full py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-md hover:shadow-amber-500/25 transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                          {submitting ? (
                            <>
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              <span>Menerbitkan...</span>
                            </>
                          ) : (
                            <span>+ Terbitkan Dokumen Resmi</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </form>
                ) : (
                  <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300">
                    {activeRole === 'Viewer/Pengamat' ? (
                      <p className="font-medium">
                        Jabatan Anda saat ini (<b>Pengamat</b>) memiliki akses baca, unduh PDF fisik, dan verifikasi kode QR atas dokumen resmi yang dibagikan untuk Klien.
                      </p>
                    ) : (
                      <p className="font-medium">
                        Penerbitan Berita Acara resmi baru dilakukan oleh <b>Clerk</b>. Jabatan Anda saat ini (<b>{activeRole}</b>) memproses pemeriksaan atau pengesahan pada dokumen yang menunggu giliran di bawah.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Daftar Dokumen Resmi Mutasi Barang */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5">
                          {renderSortBtn('Kode & Tanggal', 'tanggal', docSort, () =>
                            startTransition(() => setDocSort((prev) => toggleSort(prev, 'tanggal', 'desc')))
                          )}
                        </th>
                        <th className="py-3 px-3.5">
                          {renderSortBtn('Judul Dokumen & Ringkasan', 'judul', docSort, () =>
                            startTransition(() => setDocSort((prev) => toggleSort(prev, 'judul', 'asc')))
                          )}
                        </th>
                        <th className="py-3 px-3.5">Jejak Persetujuan Berantai</th>
                        <th className="py-3 px-3.5 text-center">
                          {renderSortBtn('Status Dokumen', 'status', docSort, () =>
                            startTransition(() => setDocSort((prev) => toggleSort(prev, 'status', 'desc'))),
                            'center'
                          )}
                        </th>
                        <th className="py-3 px-3.5 text-center">Aksi Persetujuan</th>
                        <th className="py-3 px-3.5 text-center">Koreksi & PDF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {stockDocuments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Belum ada Dokumen Resmi Mutasi Barang yang diterbitkan. Clerk dapat menerbitkan dokumen di atas untuk memulai persetujuan berantai.
                          </td>
                        </tr>
                      ) : (
                        stockDocuments.map((doc) => {
                          const docDbId = doc.db_id || doc.id;
                          const wfStatus = doc.status_dokumen || 'DITERBITKAN';
                          const isDocVoid = Boolean(doc.is_batal) || wfStatus === 'BATAL';
                          const isDocReplaced = Boolean(doc.is_ganti) || wfStatus === 'DIGANTI';
                          const canCorrectDoc = rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti;

                          return (
                            <tr
                              key={docDbId}
                              className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                                isDocVoid || isDocReplaced ? 'opacity-60 bg-rose-50/10' : ''
                              }`}
                            >
                              <td className="py-3 px-3.5 whitespace-nowrap">
                                <div className="font-mono font-bold text-slate-900 dark:text-white">{doc.id}</div>
                                <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                  {formatDateTime(doc.dibuat_pada)}
                                </div>
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="font-bold text-slate-900 dark:text-white">{doc.judul}</div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                                  Diterbitkan oleh: {doc.penandatangan_nama} ({doc.penandatangan_jabatan})
                                </div>
                                {doc.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-md">
                                    {doc.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-[11px] space-y-1">
                                <div className="text-slate-700 dark:text-slate-200">
                                  <span className="font-semibold">1. Terbit:</span> {doc.penandatangan_nama}
                                </div>
                                <div className={doc.diperiksa_oleh ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">2. Diperiksa:</span> {doc.diperiksa_oleh || 'Menunggu Foreman / Spv.'}
                                </div>
                                <div className={doc.disetujui_oleh ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">3. Disetujui:</span> {doc.disetujui_oleh || 'Menunggu Spv. / Dept. Mgr'}
                                </div>
                                <div className={doc.mengetahui_oleh ? 'text-blue-700 dark:text-blue-300 font-bold' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">4. Disahkan (TTE):</span> {doc.mengetahui_oleh || 'Menunggu Dept. Mgr / KTT-PM / CEO'}
                                </div>
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {isDocVoid ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                    <Ban className="h-3 w-3" /> BATAL
                                  </span>
                                ) : isDocReplaced ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    <FileEdit className="h-3 w-3" /> DIGANTI
                                  </span>
                                ) : wfStatus === 'MENGETAHUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                    <QrCode className="h-3 w-3" /> SAH (TTE/QR)
                                  </span>
                                ) : wfStatus === 'DISETUJUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    <FileCheck2 className="h-3 w-3" /> DISETUJUI
                                  </span>
                                ) : wfStatus === 'DIPERIKSA' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                                    <ShieldCheck className="h-3 w-3" /> DIPERIKSA
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    <Clock className="h-3 w-3" /> DITERBITKAN
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {!isDocVoid && !isDocReplaced && (() => {
                                  if (wfStatus === 'MENGETAHUI') {
                                    return (
                                      <div className="inline-flex items-center gap-1 text-teal-800 dark:text-teal-200 text-xs font-extrabold bg-teal-50 dark:bg-teal-950/50 px-2.5 py-1 rounded-full border border-teal-200 dark:border-teal-800">
                                        <CheckCircle2 className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                                        <span>Sah (TTE)</span>
                                      </div>
                                    );
                                  }
                                  const pendingDocAction = getPendingApprovalForRole(wfStatus, activeRole);
                                  if (pendingDocAction) {
                                    const approvalVariant =
                                      pendingDocAction.action === 'PERIKSA'
                                        ? 'sky'
                                        : pendingDocAction.action === 'SETUJU'
                                        ? 'amber'
                                        : 'teal';
                                    const approvalLabel =
                                      pendingDocAction.action === 'PERIKSA'
                                        ? 'Periksa'
                                        : pendingDocAction.action === 'SETUJU'
                                        ? 'Setuju'
                                        : 'Sahkan';
                                    return (
                                      <button
                                        type="button"
                                        onClick={() => handleAdvanceStockDocument(docDbId, wfStatus, pendingDocAction.nextTarget)}
                                        disabled={submitting}
                                        className={`inline-flex items-center justify-center gap-1.5 min-w-[82px] h-7 min-h-[34px] sm:min-h-0 px-3 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50 ${getCashActionVariantClass(approvalVariant)}`}
                                        title={`${approvalLabel} dokumen resmi sesuai wewenang jabatan ${activeRole}`}
                                      >
                                        <CheckCircle2 className="w-3.5 h-3.5" />
                                        <span>{approvalLabel}</span>
                                      </button>
                                    );
                                  }
                                  return (
                                    <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                      {wfStatus === 'DITERBITKAN'
                                        ? 'Menunggu Foreman'
                                        : wfStatus === 'DIPERIKSA'
                                        ? 'Menunggu Spv.'
                                        : 'Menunggu Pimpinan'}
                                    </span>
                                  );
                                })()}
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadStockDocPDF(doc.id, doc.judul)}
                                    disabled={downloadingDocId === doc.id}
                                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-all shadow-2xs cursor-pointer flex items-center gap-1"
                                    title="Unduh Dokumen PDF Resmi ber-QR Code"
                                  >
                                    {downloadingDocId === doc.id ? (
                                      <>
                                        <RefreshCw className="w-3 h-3 animate-spin" />
                                        <span>PDF...</span>
                                      </>
                                    ) : (
                                      <>
                                        <QrCode className="w-3 h-3" />
                                        <span>PDF QR</span>
                                      </>
                                    )}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => {
                                      setVerifyingDocId(doc.id);
                                      setCurrentView('verification');
                                    }}
                                    className="px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-semibold transition-colors cursor-pointer"
                                    title="Verifikasi QR Code Dokumen"
                                  >
                                    <ShieldCheck className="w-3 h-3 text-emerald-500" />
                                  </button>

                                  {!isDocVoid && !isDocReplaced && canCorrectDoc && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setBatalDocTargetId(docDbId);
                                          setBatalDocReason('');
                                        }}
                                        className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                                      >
                                        Batal
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setGantiDocTargetId(docDbId);
                                          setGantiDocTitle(`${doc.judul} (Revisi)`);
                                          setGantiDocPeriode(docPeriode);
                                          setGantiDocRingkasan('');
                                          setGantiDocReason('');
                                        }}
                                        className="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer"
                                      >
                                        Ganti
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

      {/* Modal Konfirmasi BATAL Dokumen Resmi */}
      {batalDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmBatalDoc} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Dokumen Resmi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen ini akan ditandai <b>BATAL</b> dan tetap tersimpan di dalam riwayat audit tanpa dihapus.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Pembatalan Dokumen <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={batalDocReason}
                onChange={(e) => setBatalDocReason(e.target.value)}
                placeholder="Contoh: Terdapat koreksi baris transaksi yang baru diselesaikan..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatalDocTargetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || batalDocReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Ya, Batalkan Dokumen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Form GANTI Dokumen Resmi */}
      {gantiDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmGantiDoc} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Terbitkan Revisi Dokumen Resmi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen lama akan ditandai <b>DIGANTI</b> dan dokumen revisi baru akan diterbitkan mulai dari tahap awal persetujuan.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian Dokumen <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={gantiDocReason}
                onChange={(e) => setGantiDocReason(e.target.value)}
                placeholder="Contoh: Pembaruan rekapitulasi setelah penyesuaian kuantitas..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Judul Dokumen Revisi Baru <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={gantiDocTitle}
                onChange={(e) => setGantiDocTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGantiDocTargetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || gantiDocReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Terbitkan Dokumen Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Wizard Tanya-Jawab Cerdas (1 Pertanyaan per Kartu + Warna Kognitif + Engine) */}
      <StockMutationWizardModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        mutationType={wizardType}
        physicalMaterials={physicalMaterials}
        existingCustomItems={existingCustomItems}
        defaultPicName={user.name}
        preselectedMaterial={wizardPreselectedMaterial}
        preselectedLineId={wizardPreselectedLineId}
        onSubmitPayload={addStockMutation}
        onSuccessNotice={(msg) => setNoticeMessage(msg)}
      />

      {/* Modal Pengaturan Ekspor PDF (Tokopedia/ERP Style) */}
      <ExportSettingsModal
        isOpen={exportModalState.isOpen}
        onClose={() => setExportModalState(prev => ({ ...prev, isOpen: false }))}
        targetType={exportModalState.targetType}
        title={exportModalState.title}
        totalOriginalCount={exportModalState.itemCount}
        initialIncludeFinancials={exportModalState.initialIncludeFinancials}
        onConfirmExport={handleConfirmExport}
        currentFilterLabel={exportModalState.currentFilterLabel}
        currentSortLabel={exportModalState.currentSortLabel}
      />

      {/* Modal Penyelarasan Nota Toko Resmi (Single & Multi-Item Batch) */}
      <BatchReceiptModal
        isOpen={isBatchReceiptModalOpen}
        onClose={() => setIsBatchReceiptModalOpen(false)}
        targetMutations={batchReceiptTargets}
        availablePendingMutations={stockMutations.filter((m) => m.jenis === 'MASUK' && !m.is_batal && !m.is_ganti)}
        allStockMutations={stockMutations}
        currentUser={user}
        projectId={activeProjectId || tenantBranding.projectId || '2506245e-ff3f-4313-b821-920ab368a5df'}
        onSuccess={async (count, receiptNo) => {
          await refreshData();
          setSelectedMutationIds([]);
          setNoticeMessage(`Berhasil menyelaraskan ${count} item dengan Nota Toko No. ${receiptNo} melalui metode penggantian sah tanpa hapus data.`);
        }}
      />

      {/* Modal Album Galeri Berkas Nota Resmi Proyek */}
      <ProjectReceiptAlbumModal
        isOpen={isProjectAlbumOpen}
        onClose={() => setIsProjectAlbumOpen(false)}
        albumItems={projectAlbumItems}
        currentUser={user}
        projectId={activeProjectId || tenantBranding.projectId || '2506245e-ff3f-4313-b821-920ab368a5df'}
        hideCashDetails={isFinancialHidden}
        onOpenReceiptViewer={(primary, related) => {
          setViewerPrimaryMutation(primary);
          setViewerRelatedMutations(related);
          const linkedCash = isFinancialHidden
            ? []
            : findLinkedCashMutationsForStockMutation(
                primary,
                cashMutations,
                tenantBranding.clientName
              );
          const isPaid =
            !isFinancialHidden &&
            isStockMutationPaidViaCash(primary, terpaduReceiptIndex, tenantBranding.clientName);
          setViewerPrimaryCash(linkedCash[0] || null);
          setViewerRelatedCash(linkedCash);
          setViewerReceiptScope(
            !isFinancialHidden && (isPaid || linkedCash.length > 0) ? 'TERPADU' : 'BELANJA_BARANG'
          );
          setIsReceiptViewerOpen(true);
        }}
        onOpenCashReceiptViewer={(cash, relatedCash, relatedStock, scope) => {
          setViewerPrimaryMutation(relatedStock[0] || null);
          setViewerRelatedMutations(relatedStock);
          setViewerPrimaryCash(isFinancialHidden ? null : cash);
          setViewerRelatedCash(isFinancialHidden ? [] : relatedCash);
          setViewerReceiptScope(isFinancialHidden ? 'BELANJA_BARANG' : scope || 'KAS_OPERASIONAL');
          setIsReceiptViewerOpen(true);
        }}
        onSelectForLinking={
          rolePermissions.canIssue && !isFinancialHidden
            ? (_nota) => {
                setIsProjectAlbumOpen(false);
                // Jika ada item mutasi masuk yang aktif, buka BatchReceiptModal langsung ke nota ini
                const pendingIn = stockMutations.filter((m) => m.jenis === 'MASUK' && !m.is_batal && !m.is_ganti);
                if (pendingIn.length > 0) {
                  setBatchReceiptTargets([pendingIn[0]]);
                  setIsBatchReceiptModalOpen(true);
                }
              }
            : undefined
        }
        onDataChanged={async () => {
          await refreshData();
          await refreshProjectReceipts();
        }}
      />

      {/* Modal Pratinjau Foto/PDF Nota Resmi */}
      <ReceiptViewerModal
        isOpen={isReceiptViewerOpen}
        onClose={() => setIsReceiptViewerOpen(false)}
        primaryMutation={viewerPrimaryMutation}
        allMutationsInReceipt={viewerRelatedMutations}
        primaryCashMutation={isFinancialHidden ? null : viewerPrimaryCash}
        allCashMutationsInReceipt={isFinancialHidden ? [] : viewerRelatedCash}
        receiptScope={isFinancialHidden ? 'BELANJA_BARANG' : viewerReceiptScope}
        hideFinancialDetails={activeRole === 'Viewer/Pengamat' || !canViewFinancials}
      />

      {/* Modal Pop-up Rincian Jejak Audit (Pembatalan / Penggantian) */}
      {auditDetailMutation && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                {auditDetailMutation.is_batal ? (
                  <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                    <Ban className="w-4 h-4" /> Informasi Pembatalan Mutasi
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                    <FileEdit className="w-4 h-4" /> Informasi Penggantian Mutasi
                  </span>
                )}
              </h2>
              <button
                type="button"
                onClick={() => setAuditDetailMutation(null)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs px-2 py-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-500">ID Mutasi:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    #{auditDetailMutation.jenis === 'MASUK' ? 'MSK' : 'KLR'}-{auditDetailMutation.id.slice(0, 8).toUpperCase()}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Nama Material:</span>
                  <span className="font-semibold text-slate-900 dark:text-white text-right max-w-[220px] truncate">
                    {auditDetailMutation.nama_barang}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Kuantitas:</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                    {auditDetailMutation.jumlah.toLocaleString('id-ID')} {auditDetailMutation.satuan}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Waktu Tercatat:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">
                    {formatDateTime(auditDetailMutation.tanggal)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Pencatat / PIC:</span>
                  <span className="text-slate-700 dark:text-slate-300 font-medium">
                    {auditDetailMutation.pic_penerima_penyerah || auditDetailMutation.created_by_name || '-'}
                  </span>
                </div>
                {canViewFinancials && (() => {
                  const effPrice = getMutationEffectivePrice(auditDetailMutation);
                  if (effPrice != null && effPrice > 0) {
                    return (
                      <>
                        <div className="flex justify-between pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                          <span className="text-slate-500">
                            Harga Satuan {auditDetailMutation.jenis === 'MASUK' ? 'Beli / Nota' : 'Riil Material'}:
                          </span>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            Rp {effPrice.toLocaleString('id-ID')} / {auditDetailMutation.satuan}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-500">Total Nilai Finansial:</span>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                            Rp {(effPrice * auditDetailMutation.jumlah).toLocaleString('id-ID')}
                          </span>
                        </div>
                      </>
                    );
                  }
                  return null;
                })()}
              </div>

              <div>
                <label className="font-bold text-slate-700 dark:text-slate-300 mb-1 block">
                  Catatan / Alasan {auditDetailMutation.is_batal ? 'Pembatalan' : 'Penggantian'}:
                </label>
                <div className="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/40 border border-amber-200/70 dark:border-amber-800/70 text-amber-900 dark:text-amber-200 font-medium leading-relaxed">
                  {auditDetailMutation.alasan_batal_ganti || 'Tidak ada catatan alasan khusus yang dicantumkan.'}
                </div>
              </div>

              <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-200/50 dark:border-slate-800">
                💡 <b>Integritas Jejak Audit:</b> Nilai kuantitas baris ini telah dinolkan aman dari total stok gudang & neraca pagu material. Data lama tidak dihapus demi kepatuhan hukum proyek.
              </div>

              {auditDetailMutation.referensi_ganti_id && (
                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      const targetId = auditDetailMutation.referensi_ganti_id!;
                      setAuditDetailMutation(null);
                      handleNavigateToMutation(targetId);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-colors cursor-pointer shadow-xs"
                  >
                    <span>Buka Baris Transaksi Terkait #{auditDetailMutation.referensi_ganti_id.slice(0, 6).toUpperCase()}</span>
                    <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setAuditDetailMutation(null)}
                className="px-4 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi BATAL */}
      {batalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmBatal} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Dokumen Mutasi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen ini akan ditandai <b>BATAL</b>. Riwayat audit tetap tersimpan, namun nominal kuantitas (<b>{batalTarget.jumlah} {batalTarget.satuan}</b>) tidak akan diperhitungkan dalam stok fisik.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Pembatalan <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={batalReason}
                onChange={(e) => setBatalReason(e.target.value)}
                placeholder="Contoh: Kesalahan input kuantitas, dibatalkan atas instruksi Spv..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatalTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || batalReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Ya, Batalkan Dokumen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Form GANTI Mutasi */}
      {gantiTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmGanti} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Revisi Dokumen Mutasi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen lama akan ditandai <b>DIGANTI</b> dan dokumen baru akan diterbitkan dengan nomor rujukan ke dokumen ini.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian / Koreksi <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={gantiReason}
                onChange={(e) => setGantiReason(e.target.value)}
                placeholder="Contoh: Koreksi nomor surat jalan dan penyesuaian kuantitas nyata..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Jumlah Baru</label>
                <QuantityInput
                  value={qty}
                  onChange={(val) => setQty(val)}
                  placeholder="0"
                  inputClassName="px-3 py-2 text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">Tanggal Transaksi</label>
                <input
                  type="date"
                  required
                  value={mutationDate}
                  onChange={(e) => setMutationDate(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Surat Jalan Baru</label>
                <input
                  type="text"
                  value={suratJalan}
                  onChange={(e) => setSuratJalan(e.target.value)}
                  placeholder="Opsional..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-xs"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">PIC Petugas</label>
                <input
                  type="text"
                  value={pic}
                  onChange={(e) => setPic(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
                />
              </div>
            </div>

            {/* Input Finansial & Pengganti Khusus MASUK */}
            {gantiTarget.jenis === 'MASUK' && (
              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                    Harga Nota / Satuan Riil
                  </label>
                  <span className="text-[10px] text-slate-500">Harga beli riil di toko</span>
                </div>

                <CurrencyInput
                  value={gantiIsHargaBelumDiketahui || gantiIsNotaMenyusul ? null : Number(gantiHargaSatuan) || null}
                  onChange={(val) => setGantiHargaSatuan(val || '')}
                  disabled={gantiIsHargaBelumDiketahui || gantiIsNotaMenyusul}
                  placeholder={gantiIsHargaBelumDiketahui ? 'Harga belum diketahui' : gantiIsNotaMenyusul ? 'Nota menyusul' : 'Contoh: 280.000'}
                  inputClassName="py-2 text-xs"
                />

                <div className="flex flex-wrap items-center gap-4 text-xs text-slate-700 dark:text-slate-300">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={gantiIsHargaBelumDiketahui}
                      onChange={(e) => {
                        setGantiIsHargaBelumDiketahui(e.target.checked);
                        if (e.target.checked) setGantiIsNotaMenyusul(false);
                      }}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Harga belum diketahui</span>
                  </label>

                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={gantiIsNotaMenyusul}
                      onChange={(e) => {
                        setGantiIsNotaMenyusul(e.target.checked);
                        if (e.target.checked) setGantiIsHargaBelumDiketahui(false);
                      }}
                      className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <span>Nota menyusul</span>
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nama / Merek Aktual yang Tiba (Barang Pengganti)
                  </label>
                  <input
                    type="text"
                    value={gantiNamaItemAktual}
                    onChange={(e) => setGantiNamaItemAktual(e.target.value)}
                    placeholder="Contoh: Semen Gresik 50kg (Pengganti Tiga Roda karena toko kosong)..."
                    className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Uraian Keperluan Baru</label>
              <input
                type="text"
                required
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGantiTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || gantiReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Simpan Dokumen Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
