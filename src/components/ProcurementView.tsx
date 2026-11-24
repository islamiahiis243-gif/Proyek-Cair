import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import {
  ShoppingBag,
  Store,
  Truck,
  FileText,
  Plus,
  Search,
  RotateCcw,
  CheckCircle2,
  Clock,
  Send,
  ArrowDownToLine,
  ArrowUpFromLine,
  Edit3,
  ExternalLink,
  AlertTriangle,
  Bell,
  History,
  X,
  Upload,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
  ArrowUpDown,
  Ban,
  RefreshCw,
  Building2,
  Phone,
  MapPin,
  Package,
} from 'lucide-react';
import {
  ImpersonateRole,
  MetodePembayaran,
  PoPaymentTerms,
  PurchaseOrder,
  SupplierStore,
} from '../types';
import { ProcurementTabKey, useApp } from '../context/AppContext';
import {
  PAYMENT_METHOD_LABELS,
  resolveCashEvalContext,
} from '../lib/cashflowEngine';
import {
  computeCalendarDaysPast,
  computeProcurementNeeds,
  evaluatePurchaseOrder,
  getPoActionVariantClass,
  PO_PAYMENT_TERMS_LABELS,
  PO_PAYMENT_TERMS_SHORT_LABELS,
  PoEvaluation,
  ProcurementNeedItem,
} from '../lib/procurementEngine';
import {
  formatDateOnly,
  formatDateTime,
  formatRupiah,
  generatePurchaseOrderPDF,
} from '../lib/pdfGenerator';
import { getTodayLocalDate } from '../lib/stockMutationEngine';
import { uploadReceiptFile } from '../lib/receiptStorage';
import { PurchaseOrderWizardModal } from './PurchaseOrderWizardModal';

type PoStatusFilter =
  | 'ALL'
  | 'PENDING_APPROVAL'
  | 'READY_SEND'
  | 'WAITING_DELIVERY'
  | 'WAITING_PAYMENT'
  | 'COMPLETED'
  | 'VOID_REPLACED';

type NeedStatusFilter = 'ALL' | 'PERLU_DIPESAN' | 'SEDANG_DIPESAN' | 'TERPENUHI';

export const ProcurementView: React.FC = () => {
  const {
    items,
    stockMutations,
    cashMutations,
    purchaseOrders,
    supplierStores,
    procurementSummary,
    currentCashBalance,
    activeRole,
    setActiveRole,
    activeContext,
    activeProjectId,
    rolePermissions,
    canViewFinancials,
    tenantBranding,
    user,
    setCurrentView,
    setCashTargetTab,
    procurementTargetTab,
    setProcurementTargetTab,
    advancePurchaseOrderWorkflow,
    markPurchaseOrderSent,
    receivePurchaseOrderItems,
    payPurchaseOrder,
    batalPurchaseOrder,
    saveProjectStore,
  } = useApp();

  const todayYmd = getTodayLocalDate();
  const [activeTab, setActiveTab] = useState<ProcurementTabKey>('NEEDS_STORES');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Sync deep-link tab (misalnya dari Lonceng Header atau Dasbor)
  useEffect(() => {
    if (procurementTargetTab) {
      setActiveTab(procurementTargetTab);
      setProcurementTargetTab(null);
    }
  }, [procurementTargetTab, setProcurementTargetTab]);

  // Multi-penugasan untuk Ganti Jabatan Cepat (hanya tampil bila > 1 jabatan pada proyek ini)
  const userAssignments = useMemo(() => {
    const proj = activeContext?.projects?.find((p) => p.id === activeProjectId);
    const roles = ((proj as any)?.assigned_roles || []) as ImpersonateRole[];
    return Array.from(new Set(roles));
  }, [activeContext, activeProjectId]);

  const evalCtx = useMemo(
    () =>
      resolveCashEvalContext(
        activeRole,
        rolePermissions,
        {
          contractorName: tenantBranding.contractorName,
          clientName: tenantBranding.clientName,
        },
        canViewFinancials
      ),
    [activeRole, rolePermissions, tenantBranding, canViewFinancials]
  );

  // Tab 1: Kebutuhan Material BOQ (Anti Beli Ganda)
  const procurementNeeds = useMemo(
    () => computeProcurementNeeds(items, purchaseOrders, stockMutations),
    [items, purchaseOrders, stockMutations]
  );
  const [needFilter, setNeedFilter] = useState<NeedStatusFilter>('PERLU_DIPESAN');
  const [needSearch, setNeedSearch] = useState('');
  const deferredNeedSearch = useDeferredValue(needSearch);
  const [selectedNeedIds, setSelectedNeedIds] = useState<string[]>([]);

  const filteredNeeds = useMemo(() => {
    const q = deferredNeedSearch.trim().toLowerCase();
    return procurementNeeds.filter((n) => {
      if (needFilter !== 'ALL' && n.status !== needFilter) return false;
      if (!q) return true;
      return (
        n.namaBarang.toLowerCase().includes(q) ||
        n.kodeBoq.toLowerCase().includes(q) ||
        n.kategori.toLowerCase().includes(q)
      );
    });
  }, [procurementNeeds, needFilter, deferredNeedSearch]);

  // Evaluasi seluruh PO
  const evaluatedPos = useMemo(() => {
    return purchaseOrders.map((po) => ({
      po,
      ev: evaluatePurchaseOrder(
        po,
        stockMutations,
        cashMutations,
        evalCtx,
        currentCashBalance,
        todayYmd
      ),
    }));
  }, [purchaseOrders, stockMutations, cashMutations, evalCtx, currentCashBalance, todayYmd]);

  const evaluatedById = useMemo(
    () => new Map(evaluatedPos.map((x) => [x.po.id, x])),
    [evaluatedPos]
  );

  // Tab 2: Filter & Sort Daftar PO
  const [poStatusFilter, setPoStatusFilter] = useState<PoStatusFilter>('ALL');
  const [poStoreFilter, setPoStoreFilter] = useState<string>('ALL');
  const [poSearch, setPoSearch] = useState('');
  const deferredPoSearch = useDeferredValue(poSearch);
  const [poSortBy, setPoSortBy] = useState<'date' | 'amount'>('date');
  const [poSortDir, setPoSortDir] = useState<'desc' | 'asc'>('desc');
  const [highlightedPoId, setHighlightedPoId] = useState<string | null>(null);

  const filteredPos = useMemo(() => {
    const q = deferredPoSearch.trim().toLowerCase();
    const list = evaluatedPos.filter(({ po, ev }) => {
      if (poStatusFilter === 'PENDING_APPROVAL' && ev.stateCode !== 'PO-1') return false;
      if (poStatusFilter === 'READY_SEND' && ev.stateCode !== 'PO-2') return false;
      if (poStatusFilter === 'WAITING_DELIVERY' && ev.stateCode !== 'PO-3') return false;
      if (poStatusFilter === 'WAITING_PAYMENT' && ev.stateCode !== 'PO-4') return false;
      if (poStatusFilter === 'COMPLETED' && ev.stateCode !== 'PO-5') return false;
      if (
        poStatusFilter === 'VOID_REPLACED' &&
        ev.stateCode !== 'PO-6' &&
        ev.stateCode !== 'PO-7'
      ) {
        return false;
      }
      if (poStoreFilter !== 'ALL' && po.nama_toko !== poStoreFilter) return false;
      if (!q) return true;
      const inItems = (po.items || []).some((it) =>
        it.nama_barang.toLowerCase().includes(q)
      );
      return (
        po.po_no.toLowerCase().includes(q) ||
        po.nama_toko.toLowerCase().includes(q) ||
        inItems
      );
    });

    return [...list].sort((a, b) => {
      const mul = poSortDir === 'asc' ? 1 : -1;
      if (poSortBy === 'amount') {
        return ((a.po.total_amount_rp || 0) - (b.po.total_amount_rp || 0)) * mul;
      }
      return (
        (new Date(a.po.tanggal_po || 0).getTime() -
          new Date(b.po.tanggal_po || 0).getTime()) *
        mul
      );
    });
  }, [evaluatedPos, poStatusFilter, poStoreFilter, deferredPoSearch, poSortBy, poSortDir]);

  const distinctStoreNames = useMemo(
    () => Array.from(new Set(purchaseOrders.map((p) => p.nama_toko).filter(Boolean))).sort(),
    [purchaseOrders]
  );

  // Tab 3: Daftar PO Menunggu Penerimaan Barang (DO)
  const pendingDeliveryPos = useMemo(
    () =>
      evaluatedPos.filter(
        ({ po, ev }) =>
          !ev.isExcluded &&
          po.status_dokumen === 'MENGETAHUI' &&
          ev.totalQtySisaTerima > 0
      ),
    [evaluatedPos]
  );

  // Statistik per Toko Rekanan untuk Tabel B Tab 1
  const storeStatsMap = useMemo(() => {
    const map = new Map<string, { activePoCount: number; totalValueRp: number }>();
    for (const { po, ev } of evaluatedPos) {
      if (ev.isExcluded) continue;
      const key = (po.nama_toko || '').trim().toLowerCase();
      const cur = map.get(key) || { activePoCount: 0, totalValueRp: 0 };
      cur.activePoCount += 1;
      cur.totalValueRp += Number(po.total_amount_rp) || 0;
      map.set(key, cur);
    }
    return map;
  }, [evaluatedPos]);

  // Modals State
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardPrefillNeeds, setWizardPrefillNeeds] = useState<ProcurementNeedItem[] | undefined>();
  const [wizardPrefillStore, setWizardPrefillStore] = useState<SupplierStore | null>(null);
  const [wizardReplacePo, setWizardReplacePo] = useState<PurchaseOrder | null>(null);

  const [receiveTargetPo, setReceiveTargetPo] = useState<PurchaseOrder | null>(null);
  const [receiveQtyMap, setReceiveQtyMap] = useState<Record<string, number>>({});
  const [receiveDate, setReceiveDate] = useState<string>(todayYmd);
  const [receiveSjNo, setReceiveSjNo] = useState<string>('');
  const [receivePic, setReceivePic] = useState<string>(user?.name || '');
  const [receiveNotes, setReceiveNotes] = useState<string>('');
  const [receiveFiles, setReceiveFiles] = useState<string[]>([]);
  const [receiveUploading, setReceiveUploading] = useState<boolean>(false);
  const [receiveSubmitting, setReceiveSubmitting] = useState<boolean>(false);

  const [payTargetPo, setPayTargetPo] = useState<PurchaseOrder | null>(null);
  const [payAmountRp, setPayAmountRp] = useState<number>(0);
  const [payJenis, setPayJenis] = useState<'DP' | 'PELUNASAN' | 'SEBAGIAN'>('PELUNASAN');
  const [payMethod, setPayMethod] = useState<MetodePembayaran>('TRANSFER');
  const [payDate, setPayDate] = useState<string>(todayYmd);
  const [payRefNo, setPayRefNo] = useState<string>('');
  const [payPic, setPayPic] = useState<string>(user?.name || '');
  const [payNotes, setPayNotes] = useState<string>('');
  const [payFiles, setPayFiles] = useState<string[]>([]);
  const [payUploading, setPayUploading] = useState<boolean>(false);
  const [paySubmitting, setPaySubmitting] = useState<boolean>(false);

  const [historyPoId, setHistoryPoId] = useState<string | null>(null);
  const [batalReason, setBatalReason] = useState<string>('');
  const [showBatalForm, setShowBatalForm] = useState<boolean>(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  // Store Directory Modal
  const [storeModalOpen, setStoreModalOpen] = useState(false);
  const [editingStore, setEditingStore] = useState<SupplierStore | null>(null);
  const [storeFormName, setStoreFormName] = useState('');
  const [storeFormPhone, setStoreFormPhone] = useState('');
  const [storeFormPic, setStoreFormPic] = useState('');
  const [storeFormAddress, setStoreFormAddress] = useState('');
  const [storeFormTerms, setStoreFormTerms] = useState<PoPaymentTerms>('TUNAI_SAAT_TIBA');
  const [storeFormNotes, setStoreFormNotes] = useState('');
  const [storeSaving, setStoreSaving] = useState(false);

  const notify = (type: 'success' | 'error', text: string) => {
    setFeedback({ type, text });
  };

  const openNewPoWizard = (opts?: {
    needs?: ProcurementNeedItem[];
    store?: SupplierStore | null;
    replacePo?: PurchaseOrder | null;
  }) => {
    setWizardPrefillNeeds(opts?.needs);
    setWizardPrefillStore(opts?.store || null);
    setWizardReplacePo(opts?.replacePo || null);
    setWizardOpen(true);
  };

  const openStoreModal = (store?: SupplierStore | null) => {
    setEditingStore(store || null);
    setStoreFormName(store?.nama_toko || '');
    setStoreFormPhone(store?.telepon || '');
    setStoreFormPic(store?.pic_toko || '');
    setStoreFormAddress(store?.alamat || '');
    setStoreFormTerms(store?.syarat_bayar_default || 'TUNAI_SAAT_TIBA');
    setStoreFormNotes(store?.catatan || '');
    setStoreModalOpen(true);
  };

  const handleSaveStoreModal = async () => {
    if (!storeFormName.trim()) {
      notify('error', 'Nama toko rekanan wajib diisi.');
      return;
    }
    setStoreSaving(true);
    try {
      const res = await saveProjectStore({
        id: editingStore?.id,
        nama_toko: storeFormName.trim(),
        telepon: storeFormPhone.trim(),
        pic_toko: storeFormPic.trim(),
        alamat: storeFormAddress.trim(),
        syarat_bayar_default: storeFormTerms,
        catatan: storeFormNotes.trim(),
      });
      notify(res.success ? 'success' : 'error', res.message);
      if (res.success) setStoreModalOpen(false);
    } finally {
      setStoreSaving(false);
    }
  };

  const openReceiveModal = (po: PurchaseOrder) => {
    const entry = evaluatedById.get(po.id);
    const initialMap: Record<string, number> = {};
    for (const row of entry?.ev.itemProgress || []) {
      initialMap[row.item.id] = row.qtySisaTerima > 0 ? row.qtySisaTerima : 0;
    }
    setReceiveQtyMap(initialMap);
    setReceiveDate(todayYmd);
    setReceiveSjNo('');
    setReceivePic(user?.name || '');
    setReceiveNotes('');
    setReceiveFiles([]);
    setReceiveTargetPo(po);
  };

  const handleUploadReceivePhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setReceiveUploading(true);
    try {
      const uploaded: string[] = [];
      for (const f of files) {
        const url = await uploadReceiptFile(f, activeProjectId || tenantBranding.projectId || '', receiveSjNo || 'SJ_PO');
        if (url) uploaded.push(url);
      }
      setReceiveFiles((prev) => [...prev, ...uploaded]);
    } finally {
      setReceiveUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmitReceive = async () => {
    if (!receiveTargetPo) return;
    const itemsPayload = Object.entries(receiveQtyMap)
      .filter(([, qty]) => Number(qty) > 0)
      .map(([po_item_id, qty_terima]) => ({ po_item_id, qty_terima: Number(qty_terima) }));
    if (itemsPayload.length === 0) {
      notify('error', 'Masukkan kuantitas barang tiba pada minimal 1 material.');
      return;
    }
    setReceiveSubmitting(true);
    try {
      const res = await receivePurchaseOrderItems({
        poId: receiveTargetPo.id,
        tanggal: `${receiveDate}T10:00:00`,
        nomor_surat_jalan: receiveSjNo.trim() || undefined,
        pic_penerima: receivePic.trim() || user?.name || 'Gudang',
        catatan: receiveNotes.trim() || undefined,
        lampiran_nota_urls: receiveFiles,
        items: itemsPayload,
      });
      notify(res.success ? 'success' : 'error', res.message);
      if (res.success) setReceiveTargetPo(null);
    } finally {
      setReceiveSubmitting(false);
    }
  };

  const openPayModal = (po: PurchaseOrder, ev: PoEvaluation) => {
    const recAmt = ev.recommendedPayAmountRp > 0 ? ev.recommendedPayAmountRp : ev.sisaBayarRp;
    setPayAmountRp(recAmt);
    setPayJenis(ev.isDpPending ? 'DP' : recAmt >= ev.sisaBayarRp ? 'PELUNASAN' : 'SEBAGIAN');
    setPayMethod('TRANSFER');
    setPayDate(todayYmd);
    setPayRefNo('');
    setPayPic(user?.name || '');
    setPayNotes('');
    setPayFiles([]);
    setPayTargetPo(po);
  };

  const handleUploadPayProof = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setPayUploading(true);
    try {
      const uploaded: string[] = [];
      for (const f of files) {
        const url = await uploadReceiptFile(f, activeProjectId || tenantBranding.projectId || '', payRefNo || 'BAYAR_PO');
        if (url) uploaded.push(url);
      }
      setPayFiles((prev) => [...prev, ...uploaded]);
    } finally {
      setPayUploading(false);
      e.target.value = '';
    }
  };

  const handleSubmitPay = async () => {
    if (!payTargetPo) return;
    setPaySubmitting(true);
    try {
      const res = await payPurchaseOrder({
        poId: payTargetPo.id,
        jumlah_rp: payAmountRp,
        tanggal: `${payDate}T11:00:00`,
        payment_method: payMethod,
        pic: payPic.trim() || user?.name || 'Clerk',
        nomor_kuitansi: payRefNo.trim() || undefined,
        lampiran_nota_urls: payFiles,
        catatan: payNotes.trim() || undefined,
        jenis_bayar: payJenis,
      });
      notify(res.success ? 'success' : 'error', res.message);
      if (res.success) setPayTargetPo(null);
    } finally {
      setPaySubmitting(false);
    }
  };

  const handlePrintPoPdf = async (po: PurchaseOrder) => {
    setBusyActionId(po.id);
    try {
      const matchedStore = supplierStores.find((s) => s.id === po.store_id);
      await generatePurchaseOrderPDF({
        po,
        signer: user,
        projectName: tenantBranding.projectName,
        branding: tenantBranding,
        storeAddress: matchedStore?.alamat,
        storePic: matchedStore?.pic_toko,
      });
      notify('success', `PDF Surat Pesanan ${po.po_no} berhasil diunduh.`);
    } catch (err: any) {
      notify('error', err?.message || 'Gagal membuat PDF Surat Pesanan.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRowSmartAction = async (po: PurchaseOrder, ev: PoEvaluation) => {
    if (ev.actionType === 'APPROVE' && ev.nextWorkflowTarget) {
      setBusyActionId(po.id);
      try {
        const res = await advancePurchaseOrderWorkflow(po.id, ev.nextWorkflowTarget);
        notify(res.success ? 'success' : 'error', res.message);
      } finally {
        setBusyActionId(null);
      }
      return;
    }

    if (ev.actionType === 'KIRIM_PO') {
      setBusyActionId(po.id);
      try {
        await handlePrintPoPdf(po);
        const res = await markPurchaseOrderSent(po.id);
        notify(res.success ? 'success' : 'error', res.message);
      } finally {
        setBusyActionId(null);
      }
      return;
    }

    if (ev.actionType === 'TERIMA_BARANG') {
      openReceiveModal(po);
      return;
    }

    if (ev.actionType === 'BAYAR_PO') {
      openPayModal(po, ev);
      return;
    }

    if (ev.actionType === 'ISI_KAS') {
      setCashTargetTab('SUMMARY');
      setCurrentView('cashflow');
      return;
    }

    if (ev.actionType === 'LIHAT_PENGGANTI' && po.referensi_ganti_id) {
      setPoStatusFilter('ALL');
      setHighlightedPoId(po.referensi_ganti_id);
      setTimeout(() => setHighlightedPoId(null), 3500);
      return;
    }

    // KOREKSI atau RIWAYAT -> buka modal detail/riwayat
    setShowBatalForm(false);
    setBatalReason('');
    setHistoryPoId(po.id);
  };

  const handleExecuteBatalPo = async (po: PurchaseOrder) => {
    setBusyActionId(po.id);
    try {
      const res = await batalPurchaseOrder(po.id, batalReason);
      notify(res.success ? 'success' : 'error', res.message);
      if (res.success) {
        setShowBatalForm(false);
        setBatalReason('');
        setHistoryPoId(null);
      }
    } finally {
      setBusyActionId(null);
    }
  };

  const toggleSelectNeed = (boqItemId: string) => {
    setSelectedNeedIds((prev) =>
      prev.includes(boqItemId) ? prev.filter((id) => id !== boqItemId) : [...prev, boqItemId]
    );
  };

  const handleBulkOrderSelected = () => {
    const picked = procurementNeeds.filter(
      (n) => selectedNeedIds.includes(n.boqItemId) && n.sisaPerluDipesan > 0
    );
    if (picked.length === 0) return;
    openNewPoWizard({ needs: picked });
    setSelectedNeedIds([]);
  };

  const historyEntry = historyPoId ? evaluatedById.get(historyPoId) || null : null;

  const supervisorQueueLabel =
    activeRole === 'Foreman'
      ? 'Periksa'
      : activeRole === 'Spv.'
        ? 'Setuju'
        : 'Sahkan';
  const supervisorQueueColor =
    activeRole === 'Foreman'
      ? 'bg-sky-600 hover:bg-sky-700 text-white'
      : activeRole === 'Spv.'
        ? 'bg-amber-600 hover:bg-amber-700 text-white'
        : 'bg-teal-600 hover:bg-teal-700 text-white';

  const tabs: Array<{ id: ProcurementTabKey; label: string; icon: React.ReactNode; badge?: number }> = [
    {
      id: 'NEEDS_STORES',
      label: 'Kebutuhan & Rekanan',
      icon: <ShoppingBag className="w-4 h-4" />,
      badge: procurementSummary.needOrderItemsCount || undefined,
    },
    {
      id: 'PO_LIST',
      label: 'Daftar Surat Pesanan (PO)',
      icon: <ClipboardCheckIcon />,
      badge:
        procurementSummary.pendingMyApprovalCount > 0
          ? procurementSummary.pendingMyApprovalCount
          : procurementSummary.activePoCount || undefined,
    },
    {
      id: 'DELIVERIES',
      label: 'Penerimaan Barang (Surat Jalan)',
      icon: <Truck className="w-4 h-4" />,
      badge: pendingDeliveryPos.length || undefined,
    },
    {
      id: 'DOCUMENTS',
      label: 'Dokumen PO & PDF',
      icon: <FileText className="w-4 h-4" />,
    },
  ];

  return (
    <div className="space-y-5">
      {/* SMART-HEADER ADAPTIF PERAN */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70">
                <ShoppingBag className="w-3.5 h-3.5" />
                Pengadaan & PO Toko · POV Kontraktor
              </span>
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${procurementSummary.healthBadgeClass}`}
              >
                {procurementSummary.isPoCritical && <AlertTriangle className="w-3 h-3" />}
                {procurementSummary.healthLabel}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
              Pengadaan Material & Surat Pesanan (PO)
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
              Kendali terpadu 3 arah: <strong>Kebutuhan BOQ</strong> ↔ <strong>Surat Pesanan Toko</strong> ↔{' '}
              <strong>Stok Gudang & Kas Proyek</strong>.
            </p>
          </div>

          {/* Aksi Cepat Smart-Header & Banner Branding Resmi */}
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <div className="flex flex-wrap items-center gap-2">
              {evalCtx.canIssue ? (
                <>
                  {procurementSummary.needOrderItemsCount > 0 && activeTab !== 'NEEDS_STORES' && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('NEEDS_STORES');
                        setNeedFilter('PERLU_DIPESAN');
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:hover:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800 transition-colors cursor-pointer"
                    >
                      <ShoppingBag className="w-3.5 h-3.5" />
                      {procurementSummary.needOrderItemsCount} Material Perlu Dipesan →
                    </button>
                  )}
                  {pendingDeliveryPos.length > 0 && activeTab !== 'DELIVERIES' && (
                    <button
                      type="button"
                      onClick={() => setActiveTab('DELIVERIES')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-indigo-50 hover:bg-indigo-100 text-indigo-800 border border-indigo-200 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-800 transition-colors cursor-pointer"
                    >
                      <Truck className="w-3.5 h-3.5" />
                      {pendingDeliveryPos.length} PO Menunggu Tiba →
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openNewPoWizard()}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors cursor-pointer"
                  >
                    <Plus className="w-4 h-4" />
                    Buat Surat Pesanan (PO)
                  </button>
                </>
              ) : (
                procurementSummary.pendingMyApprovalCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('PO_LIST');
                      setPoStatusFilter('PENDING_APPROVAL');
                    }}
                    className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold shadow-sm transition-colors cursor-pointer ${supervisorQueueColor}`}
                  >
                    <Bell className="w-4 h-4" />
                    {procurementSummary.pendingMyApprovalCount} PO Menunggu {supervisorQueueLabel} →
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                    <CheckCircle2 className="w-4 h-4" />
                    Semua PO Terverifikasi
                  </span>
                )
              )}
            </div>

            {/* Banner Rata Kanan: words_PNG2 (Dark) & words_light (Light) */}
            <div className="flex items-center justify-end self-center shrink-0">
              <img
                src="/words_PNG2.png"
                alt="Proyek Cair"
                className="h-12 sm:h-14 lg:h-16 w-auto max-w-[180px] sm:max-w-[240px] lg:max-w-[280px] object-contain drop-shadow-md dark:block hidden transition-transform hover:scale-105"
              />
              <img
                src="/words_light.png"
                alt="Proyek Cair"
                className="h-12 sm:h-14 lg:h-16 w-auto max-w-[180px] sm:max-w-[240px] lg:max-w-[280px] object-contain drop-shadow-md dark:hidden block transition-transform hover:scale-105"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Feedback Banner */}
      {feedback && (
        <div
          className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-xs font-medium border ${
            feedback.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/50 dark:text-rose-200 dark:border-rose-800'
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            className="p-1 rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* NAVIGASI 4 TAB TERPADU */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition-all ${
                active
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
              {t.badge != null && t.badge > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${
                    active
                      ? 'bg-white/20 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  {t.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: KEBUTUHAN BOQ & REKANAN TOKO                                   */}
      {/* ===================================================================== */}
      {activeTab === 'NEEDS_STORES' && (
        <div className="space-y-5">
          {/* 4 Smart-KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Material Perlu Dipesan
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {procurementSummary.needOrderItemsCount}
                </div>
                <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                  pos fisik BOQ
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Estimasi pagu sisa: <strong>{formatRupiah(procurementSummary.needOrderEstimatedBoqRp)}</strong>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Menunggu Pengesahan PO
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <div className="text-2xl font-bold text-sky-600 dark:text-sky-400">
                  {procurementSummary.pendingApprovalAllCount}
                </div>
                {procurementSummary.pendingMyApprovalCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300">
                    {procurementSummary.pendingMyApprovalCount} giliran Anda
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                Siap kirim ke toko: <strong>{procurementSummary.readyToSendCount} PO</strong>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Menunggu Barang Tiba
              </div>
              <div className="mt-1.5 flex items-baseline justify-between">
                <div className="text-2xl font-bold text-indigo-600 dark:text-indigo-400">
                  {procurementSummary.waitingDeliveryCount}
                </div>
                {procurementSummary.overdueDeliveryCount > 0 && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                    {procurementSummary.overdueDeliveryCount} terlambat
                  </span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                PO selesai 100%: <strong>{procurementSummary.completedPoCount} PO</strong>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Komitmen & Sisa Tagihan PO
              </div>
              <div className="mt-1.5 text-lg font-bold text-slate-900 dark:text-white">
                {formatRupiah(procurementSummary.totalPoCommitmentRp)}
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                <span>
                  Sisa bayar:{' '}
                  <strong className={procurementSummary.overduePaymentCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200'}>
                    {formatRupiah(procurementSummary.totalPoOutstandingRp)}
                  </strong>
                </span>
                {procurementSummary.totalBoqSavingsRp !== 0 && (
                  <span
                    className={`font-semibold ${
                      procurementSummary.totalBoqSavingsRp > 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {procurementSummary.totalBoqSavingsRp > 0
                      ? `Hemat ${formatRupiah(procurementSummary.totalBoqSavingsRp)}`
                      : `+${formatRupiah(Math.abs(procurementSummary.totalBoqSavingsRp))} BOQ`}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Tabel A — Saran Pengadaan Otomatis dari BOQ */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  Saran Pengadaan Otomatis dari BOQ (Anti Beli Ganda)
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Otomatis mengurangi volume yang sudah tiba di gudang maupun sedang dipesan pada PO aktif. Pos jasa & Jatah Klien dikecualikan.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={needSearch}
                    onChange={(e) => setNeedSearch(e.target.value)}
                    placeholder="Cari material / kode BOQ..."
                    className="pl-8 pr-3 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                {(
                  [
                    { id: 'PERLU_DIPESAN', label: 'Perlu Dipesan' },
                    { id: 'SEDANG_DIPESAN', label: 'Sudah di PO' },
                    { id: 'TERPENUHI', label: 'Terpenuhi' },
                    { id: 'ALL', label: 'Semua' },
                  ] as const
                ).map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setNeedFilter(f.id)}
                    className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                      needFilter === f.id
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            {evalCtx.canIssue && selectedNeedIds.length > 0 && (
              <div className="px-4 py-2.5 bg-blue-50 dark:bg-blue-950/50 border-b border-blue-200 dark:border-blue-800 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-blue-800 dark:text-blue-200">
                  {selectedNeedIds.length} material dipilih untuk dipesan kolektif dalam 1 PO
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedNeedIds([])}
                    className="px-2.5 py-1 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-black/5 dark:hover:bg-white/10"
                  >
                    Batal Pilih
                  </button>
                  <button
                    type="button"
                    onClick={handleBulkOrderSelected}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Buat 1 PO Kolektif ({selectedNeedIds.length} Material)
                  </button>
                </div>
              </div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    {evalCtx.canIssue && <th className="px-3 py-2.5 w-8"></th>}
                    <th className="px-3 py-2.5 font-semibold">Material & Divisi BOQ</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Pagu BOQ</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Tiba di Gudang</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Di PO Aktif</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Perlu Dipesan</th>
                    <th className="px-3 py-2.5 font-semibold">Status</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredNeeds.length === 0 ? (
                    <tr>
                      <td
                        colSpan={evalCtx.canIssue ? 8 : 7}
                        className="px-4 py-8 text-center text-slate-500 dark:text-slate-400"
                      >
                        Tidak ada material pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    filteredNeeds.slice(0, 60).map((n) => {
                      const checked = selectedNeedIds.includes(n.boqItemId);
                      return (
                        <tr
                          key={n.boqItemId}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          {evalCtx.canIssue && (
                            <td className="px-3 py-2.5">
                              {n.sisaPerluDipesan > 0 && (
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleSelectNeed(n.boqItemId)}
                                  className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
                                />
                              )}
                            </td>
                          )}
                          <td className="px-3 py-2.5">
                            <div className="font-semibold text-slate-900 dark:text-white">
                              {n.namaBarang}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {n.kodeBoq} · {n.kategori}
                              {n.hargaPaguBoq > 0 && ` · Pagu ${formatRupiah(n.hargaPaguBoq)}/${n.satuan}`}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">
                            {n.qtyBoq} {n.satuan}
                          </td>
                          <td className="px-3 py-2.5 text-right text-slate-600 dark:text-slate-400">
                            {n.qtyMasukGudang} {n.satuan}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {n.qtySedangDipesanPo > 0 ? (
                              <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                                {n.qtySedangDipesanPo} {n.satuan}
                              </span>
                            ) : (
                              <span className="text-slate-400">0</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <span
                              className={`font-bold ${
                                n.sisaPerluDipesan > 0
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {n.sisaPerluDipesan} {n.satuan}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <span
                              className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold border ${n.statusBadgeClass}`}
                            >
                              {n.statusLabel}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            {n.actionType === 'PESAN' && evalCtx.canIssue ? (
                              <button
                                type="button"
                                onClick={() => openNewPoWizard({ needs: [n] })}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-semibold transition-colors"
                              >
                                <Plus className="w-3 h-3" />
                                Pesan
                              </button>
                            ) : n.actionType === 'PANTAU' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setPoSearch(n.activePoNos[0] || n.namaBarang);
                                  setActiveTab('PO_LIST');
                                }}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800 text-[11px] font-semibold transition-colors"
                              >
                                <Truck className="w-3 h-3" />
                                Pantau
                              </button>
                            ) : (
                              <span className="text-[11px] font-medium text-teal-600 dark:text-teal-400">
                                ✓ Terpenuhi
                              </span>
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

          {/* Tabel B — Direktori Toko Rekanan */}
          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Store className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  Direktori Toko Rekanan ({supplierStores.length})
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Simpan kontak, PIC toko, dan syarat bayar bawaan untuk percepatan pembuatan PO.
                </p>
              </div>
              {evalCtx.canIssue && (
                <button
                  type="button"
                  onClick={() => openStoreModal(null)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah Toko
                </button>
              )}
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {supplierStores.length === 0 ? (
                <div className="col-span-full py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                  Belum ada toko rekanan tersimpan. Tambahkan toko rekanan atau buat PO pertama Anda.
                </div>
              ) : (
                supplierStores.map((st) => {
                  const stat = storeStatsMap.get(st.nama_toko.trim().toLowerCase()) || {
                    activePoCount: 0,
                    totalValueRp: 0,
                  };
                  return (
                    <div
                      key={st.id}
                      className="p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/80 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-bold text-sm text-slate-900 dark:text-white flex items-center gap-1.5">
                            <Building2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                            <span>{st.nama_toko}</span>
                          </div>
                          {st.syarat_bayar_default && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 whitespace-nowrap">
                              {PO_PAYMENT_TERMS_SHORT_LABELS[st.syarat_bayar_default] || st.syarat_bayar_default}
                            </span>
                          )}
                        </div>
                        {st.pic_toko && (
                          <div className="text-[11px] text-slate-600 dark:text-slate-300">
                            PIC: {st.pic_toko}
                          </div>
                        )}
                        {st.telepon && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {st.telepon}
                          </div>
                        )}
                        {st.alamat && (
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                            <MapPin className="w-3 h-3 shrink-0" /> <span className="truncate">{st.alamat}</span>
                          </div>
                        )}
                      </div>

                      <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-700 flex items-center justify-between gap-2 text-[11px]">
                        <div className="text-slate-500 dark:text-slate-400">
                          <strong>{stat.activePoCount} PO</strong> · {formatRupiah(stat.totalValueRp)}
                        </div>
                        {evalCtx.canIssue && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openStoreModal(st)}
                              className="px-2 py-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 font-medium"
                            >
                              Ubah
                            </button>
                            <button
                              type="button"
                              onClick={() => openNewPoWizard({ store: st })}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                            >
                              <Plus className="w-3 h-3" />
                              Buat PO
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: DAFTAR SURAT PESANAN (PO) — 8 KOLOM BERSIH + SMART-BUTTON      */}
      {/* ===================================================================== */}
      {activeTab === 'PO_LIST' && (
        <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'ALL', label: 'Semua' },
                  { id: 'PENDING_APPROVAL', label: 'Menunggu Sah' },
                  { id: 'READY_SEND', label: 'Siap Kirim' },
                  { id: 'WAITING_DELIVERY', label: 'Menunggu Barang' },
                  { id: 'WAITING_PAYMENT', label: 'Siap Bayar' },
                  { id: 'COMPLETED', label: 'Tuntas' },
                  { id: 'VOID_REPLACED', label: 'Batal / Diganti' },
                ] as const
              ).map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setPoStatusFilter(pill.id)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                    poStatusFilter === pill.id
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {pill.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={poSearch}
                  onChange={(e) => setPoSearch(e.target.value)}
                  placeholder="Cari nomor PO, nama toko, atau nama material..."
                  className="w-full pl-8 pr-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
              <select
                value={poStoreFilter}
                onChange={(e) => setPoStoreFilter(e.target.value)}
                className="px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white"
              >
                <option value="ALL">Semua Toko Rekanan</option>
                {distinctStoreNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {(poStatusFilter !== 'ALL' || poStoreFilter !== 'ALL' || poSearch) && (
                <button
                  type="button"
                  onClick={() => {
                    setPoStatusFilter('ALL');
                    setPoStoreFilter('ALL');
                    setPoSearch('');
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Atur Ulang Filter
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">
                    <button
                      type="button"
                      onClick={() => {
                        if (poSortBy === 'date') {
                          setPoSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                        } else {
                          setPoSortBy('date');
                          setPoSortDir('desc');
                        }
                      }}
                      className="inline-flex items-center gap-1 hover:text-blue-600"
                    >
                      No. PO & Tanggal <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Toko Rekanan & Syarat</th>
                  <th className="px-3 py-2.5 font-semibold">Rincian Item & vs BOQ</th>
                  <th className="px-3 py-2.5 font-semibold text-right">
                    <button
                      type="button"
                      onClick={() => {
                        if (poSortBy === 'amount') {
                          setPoSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                        } else {
                          setPoSortBy('amount');
                          setPoSortDir('desc');
                        }
                      }}
                      className="inline-flex items-center gap-1 hover:text-blue-600"
                    >
                      Total Nilai PO <ArrowUpDown className="w-3 h-3" />
                    </button>
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Progres Barang</th>
                  <th className="px-3 py-2.5 font-semibold">Progres Bayar</th>
                  <th className="px-3 py-2.5 font-semibold">Status & Alur</th>
                  <th className="px-3 py-2.5 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredPos.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-slate-500 dark:text-slate-400">
                      Belum ada Surat Pesanan (PO) yang sesuai filter.
                    </td>
                  </tr>
                ) : (
                  filteredPos.map(({ po, ev }) => {
                    const isBusy = busyActionId === po.id;
                    const isHighlighted = highlightedPoId === po.id;
                    const firstItem = po.items?.[0]?.nama_barang || '-';
                    const extraItemsCount = Math.max(0, (po.items?.length || 0) - 1);

                    return (
                      <tr
                        key={po.id}
                        className={`transition-colors ${
                          isHighlighted
                            ? 'bg-blue-50 dark:bg-blue-950/50'
                            : ev.isExcluded
                              ? 'bg-slate-50/50 dark:bg-slate-900/40 opacity-75'
                              : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        {/* 1. No PO & Tanggal */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className={`font-bold text-slate-900 dark:text-white ${ev.isExcluded ? 'line-through' : ''}`}>
                            {po.po_no}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {formatDateOnly(po.tanggal_po)}
                          </div>
                        </td>

                        {/* 2. Toko Rekanan & Syarat */}
                        <td className="px-3 py-3">
                          <div className="font-semibold text-slate-900 dark:text-white">
                            {po.nama_toko}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400">
                            {PO_PAYMENT_TERMS_SHORT_LABELS[po.payment_terms] || po.payment_terms}
                            {po.jatuh_tempo_bayar ? ` · JT ${po.jatuh_tempo_bayar}` : ''}
                          </div>
                        </td>

                        {/* 3. Rincian Item & Selisih BOQ */}
                        <td className="px-3 py-3 max-w-[220px]">
                          <div className="font-medium text-slate-800 dark:text-slate-200 truncate">
                            {firstItem}
                            {extraItemsCount > 0 && (
                              <span className="text-slate-500 dark:text-slate-400">
                                {' '}
                                (+{extraItemsCount} item)
                              </span>
                            )}
                          </div>
                          {ev.selisihBoqRp !== 0 && !ev.isExcluded && (
                            <div
                              className={`inline-flex items-center gap-0.5 text-[10px] font-semibold mt-0.5 ${
                                ev.selisihBoqRp > 0
                                  ? 'text-emerald-600 dark:text-emerald-400'
                                  : 'text-amber-600 dark:text-amber-400'
                              }`}
                            >
                              {ev.selisihBoqRp > 0 ? (
                                <>
                                  <TrendingDown className="w-3 h-3" /> Hemat {formatRupiah(ev.selisihBoqRp)}
                                </>
                              ) : (
                                <>
                                  <TrendingUp className="w-3 h-3" /> +{formatRupiah(Math.abs(ev.selisihBoqRp))} vs BOQ
                                </>
                              )}
                            </div>
                          )}
                        </td>

                        {/* 4. Total Nilai PO */}
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <div className={`font-bold text-slate-900 dark:text-white ${ev.isExcluded ? 'line-through' : ''}`}>
                            {formatRupiah(po.total_amount_rp)}
                          </div>
                          {po.payment_terms === 'DP_PELUNASAN' && po.dp_amount_rp > 0 && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                              DP {formatRupiah(po.dp_amount_rp)}
                            </div>
                          )}
                        </td>

                        {/* 5. Progres Barang */}
                        <td className="px-3 py-3 min-w-[120px]">
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {ev.receivePct}%
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {ev.totalQtyDiterima}/{ev.totalQtyPesan}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-500 transition-all"
                              style={{ width: `${ev.receivePct}%` }}
                            />
                          </div>
                        </td>

                        {/* 6. Progres Bayar */}
                        <td className="px-3 py-3 min-w-[130px]">
                          <div className="flex items-center justify-between text-[11px] mb-1">
                            <span className="font-semibold text-slate-700 dark:text-slate-200">
                              {ev.payPct}%
                            </span>
                            <span className="text-slate-500 dark:text-slate-400">
                              {ev.sisaBayarRp > 0 ? `Sisa ${formatRupiah(ev.sisaBayarRp)}` : 'Lunas'}
                            </span>
                          </div>
                          <div className="h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-blue-500 transition-all"
                              style={{ width: `${ev.payPct}%` }}
                            />
                          </div>
                        </td>

                        {/* 7. Status & Alur */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span
                            className={`inline-flex px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${ev.statusBadgeClass}`}
                          >
                            {ev.statusLabel}
                          </span>
                          {ev.stateCode === 'PO-6' && po.referensi_ganti_id && (
                            <button
                              type="button"
                              onClick={() => handleRowSmartAction(po, ev)}
                              className="block mt-1 text-[10px] font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                            >
                              Lihat Pengganti ↗
                            </button>
                          )}
                        </td>

                        {/* 8. Aksi — 1 Smart-Button Fixed-Slot + Secondary History Icon */}
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              disabled={isBusy}
                              title={ev.actionTooltip}
                              onClick={() => handleRowSmartAction(po, ev)}
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${getPoActionVariantClass(
                                ev.actionVariant
                              )}`}
                            >
                              {renderActionIcon(ev.actionType)}
                              <span>{isBusy ? '...' : ev.actionLabel}</span>
                            </button>
                            {ev.showSecondaryHistoryIcon && (
                              <button
                                type="button"
                                title="Riwayat, Rincian & Audit PO"
                                onClick={() => {
                                  setShowBatalForm(false);
                                  setBatalReason('');
                                  setHistoryPoId(po.id);
                                }}
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
                              >
                                <History className="w-3.5 h-3.5" />
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
      )}

      {/* ===================================================================== */}
      {/* TAB 3: PENERIMAAN BARANG (SURAT JALAN / DO)                           */}
      {/* ===================================================================== */}
      {activeTab === 'DELIVERIES' && (
        <div className="space-y-3">
          {pendingDeliveryPos.length === 0 ? (
            <div className="p-10 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-center space-y-2">
              <Truck className="w-10 h-10 mx-auto text-emerald-500" />
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                Tidak Ada Pengiriman PO yang Tertunda
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Seluruh Surat Pesanan yang sudah disahkan telah diterima 100% di gudang proyek.
              </p>
            </div>
          ) : (
            pendingDeliveryPos.map(({ po, ev }) => {
              const daysPast = po.estimasi_tiba
                ? computeCalendarDaysPast(po.estimasi_tiba, todayYmd)
                : 0;
              const schedBadge =
                daysPast > 0
                  ? {
                      text: `Terlambat ${daysPast} Hari`,
                      cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
                    }
                  : po.estimasi_tiba === todayYmd
                    ? {
                        text: 'Jadwal Hari Ini',
                        cls: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
                      }
                    : {
                        text: 'Sesuai Jadwal',
                        cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
                      };

              return (
                <div
                  key={po.id}
                  className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {po.po_no}
                        </span>
                        <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                          · {po.nama_toko}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${schedBadge.cls}`}
                        >
                          {schedBadge.text}
                        </span>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Estimasi Tiba: {po.estimasi_tiba ? formatDateOnly(po.estimasi_tiba) : 'Belum ditentukan'} ·
                        Tiba {ev.receivePct}% ({ev.totalQtyDiterima} dari {ev.totalQtyPesan})
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {evalCtx.canIssue ? (
                        <button
                          type="button"
                          onClick={() => openReceiveModal(po)}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors"
                        >
                          <ArrowDownToLine className="w-3.5 h-3.5" />
                          Catat Terima Barang
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setHistoryPoId(po.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                        >
                          <History className="w-3.5 h-3.5" />
                          Riwayat PO
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {ev.itemProgress
                      .filter((it) => it.qtySisaTerima > 0)
                      .map((it) => (
                        <div
                          key={it.item.id}
                          className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700 text-xs flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-slate-900 dark:text-white truncate">
                              {it.item.nama_barang}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              Harga terkunci: {formatRupiah(it.item.harga_satuan_po)}/{it.item.satuan}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-bold text-indigo-600 dark:text-indigo-400">
                              Sisa {it.qtySisaTerima} {it.item.satuan}
                            </div>
                            <div className="text-[10px] text-slate-400">
                              Tiba {it.qtyDiterima}/{it.qtyPesan}
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: DOKUMEN PO & ARSIP PDF                                         */}
      {/* ===================================================================== */}
      {activeTab === 'DOCUMENTS' && (
        <div className="space-y-4">
          {/* Ganti Jabatan Cepat — KHUSUS akun dengan multi-penugasan (> 1 jabatan) */}
          {userAssignments.length > 1 && (
            <div className="p-3.5 rounded-2xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/70 flex flex-wrap items-center justify-between gap-3">
              <div className="text-xs text-blue-900 dark:text-blue-200">
                <strong>Ganti Jabatan Cepat:</strong> Anda memiliki {userAssignments.length} penugasan jabatan pada proyek ini.
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {userAssignments.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setActiveRole(r)}
                    className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors ${
                      activeRole === r
                        ? 'bg-blue-600 text-white'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 hover:bg-blue-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="p-4 border-b border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Arsip Dokumen Surat Pesanan (PO) & Cetak PDF Siap Kirim
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Setiap Surat Pesanan yang telah disahkan memuat kop resmi perusahaan, rincian harga terkunci, blok tanda tangan aktual, dan QR Code TTE.
              </p>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {evaluatedPos.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
                  Belum ada arsip Surat Pesanan (PO).
                </div>
              ) : (
                evaluatedPos.map(({ po, ev }) => (
                  <div
                    key={po.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {po.po_no}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ev.statusBadgeClass}`}
                        >
                          {ev.statusLabel}
                        </span>
                        {po.status_dokumen === 'MENGETAHUI' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-teal-50 text-teal-700 border border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800">
                            <ShieldCheck className="w-3 h-3" /> Sah TTE/QR
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300">
                        {po.nama_toko} · {po.items?.length || 0} item ·{' '}
                        <strong>{formatRupiah(po.total_amount_rp)}</strong>
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400">
                        Terbit: {po.created_by_name || '-'}
                        {po.diperiksa_oleh ? ` · Diperiksa: ${po.diperiksa_oleh.split('·')[0]}` : ''}
                        {po.disetujui_oleh ? ` · Disetujui: ${po.disetujui_oleh.split('·')[0]}` : ''}
                        {po.mengetahui_oleh ? ` · Sah: ${po.mengetahui_oleh.split('·')[0]}` : ''}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        disabled={busyActionId === po.id}
                        onClick={() => handlePrintPoPdf(po)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        PDF PO Toko
                      </button>
                      <button
                        type="button"
                        onClick={() => setHistoryPoId(po.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                      >
                        <History className="w-3.5 h-3.5" />
                        Rincian
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: WIZARD PO 3 LANGKAH                                          */}
      {/* ===================================================================== */}
      {wizardOpen && (
        <PurchaseOrderWizardModal
          onClose={() => setWizardOpen(false)}
          prefillNeeds={wizardPrefillNeeds}
          prefillStore={wizardPrefillStore}
          replacePo={wizardReplacePo}
          availableNeeds={procurementNeeds}
          allStockItems={items.filter((it) => it.is_stock_item)}
        />
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: TERIMA BARANG PO (PARSIAL / PENUH)                           */}
      {/* ===================================================================== */}
      {receiveTargetPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Terima Barang Gudang — {receiveTargetPo.po_no}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {receiveTargetPo.nama_toko} · Harga satuan PO otomatis dikunci ke mutasi stok masuk.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReceiveTargetPo(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Daftar Material Sisa Pengiriman
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const entry = evaluatedById.get(receiveTargetPo.id);
                    const fullMap: Record<string, number> = {};
                    for (const r of entry?.ev.itemProgress || []) {
                      fullMap[r.item.id] = r.qtySisaTerima;
                    }
                    setReceiveQtyMap(fullMap);
                  }}
                  className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline"
                >
                  Isi Terima Semua Sisa
                </button>
              </div>

              <div className="space-y-2.5">
                {(evaluatedById.get(receiveTargetPo.id)?.ev.itemProgress || [])
                  .filter((r) => r.qtySisaTerima > 0)
                  .map((r) => (
                    <div
                      key={r.item.id}
                      className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div>
                        <div className="text-xs font-bold text-slate-900 dark:text-white">
                          {r.item.nama_barang}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Sisa belum tiba: <strong>{r.qtySisaTerima} {r.item.satuan}</strong> · Harga terkunci{' '}
                          {formatRupiah(r.item.harga_satuan_po)}/{r.item.satuan}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <label className="text-[11px] text-slate-500">Qty Tiba:</label>
                        <input
                          type="number"
                          step="any"
                          min={0}
                          max={r.qtySisaTerima}
                          value={receiveQtyMap[r.item.id] ?? 0}
                          onChange={(e) =>
                            setReceiveQtyMap((prev) => ({
                              ...prev,
                              [r.item.id]: Math.min(
                                r.qtySisaTerima,
                                Math.max(0, Number(e.target.value) || 0)
                              ),
                            }))
                          }
                          className="w-24 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white text-right"
                        />
                        <span className="text-xs text-slate-500">{r.item.satuan}</span>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tanggal Tiba
                  </label>
                  <input
                    type="date"
                    value={receiveDate}
                    onChange={(e) => setReceiveDate(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    No. Surat Jalan / Nota Toko
                  </label>
                  <input
                    type="text"
                    value={receiveSjNo}
                    onChange={(e) => setReceiveSjNo(e.target.value)}
                    placeholder="Contoh: SJ-2026-088"
                    className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    PIC Penerima Gudang
                  </label>
                  <input
                    type="text"
                    value={receivePic}
                    onChange={(e) => setReceivePic(e.target.value)}
                    className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Foto Surat Jalan / Nota Toko (Opsional)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                    <Upload className="w-3.5 h-3.5" />
                    {receiveUploading ? 'Mengunggah...' : 'Unggah Foto / PDF'}
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleUploadReceivePhoto}
                      className="hidden"
                    />
                  </label>
                  {receiveFiles.length > 0 && (
                    <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                      ✓ {receiveFiles.length} berkas terlampir
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Catatan Penerimaan
                </label>
                <input
                  type="text"
                  value={receiveNotes}
                  onChange={(e) => setReceiveNotes(e.target.value)}
                  placeholder="Contoh: Kondisi fisik baik, bongkar di gudang utama"
                  className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/70 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setReceiveTargetPo(null)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={receiveSubmitting || receiveUploading}
                onClick={handleSubmitReceive}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm"
              >
                <ArrowDownToLine className="w-3.5 h-3.5" />
                {receiveSubmitting ? 'Menyimpan...' : 'Simpan Penerimaan ke Gudang'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: BAYAR PO 1-KLIK (TERTAUT MUTASI DANA PO_PENGADAAN)           */}
      {/* ===================================================================== */}
      {payTargetPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="w-full max-w-xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Bayar Surat Pesanan — {payTargetPo.po_no}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {payTargetPo.nama_toko} · Otomatis tercatat ke Mutasi Dana tanpa penagihan ganda.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPayTargetPo(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {(() => {
              const ev = evaluatedById.get(payTargetPo.id)?.ev;
              const sisaTagihan = ev?.sisaBayarRp || 0;
              const projectedCash = currentCashBalance - payAmountRp;
              const overCash = payAmountRp > currentCashBalance;
              return (
                <>
                  <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
                      <div>
                        <div className="text-slate-500 dark:text-slate-400">Sisa Tagihan PO</div>
                        <div className="text-base font-bold text-slate-900 dark:text-white">
                          {formatRupiah(sisaTagihan)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-slate-500 dark:text-slate-400">Saldo Kas Proyek</div>
                        <div
                          className={`text-base font-bold ${
                            overCash
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }`}
                        >
                          {formatRupiah(currentCashBalance)}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400">
                          Setelah bayar: <strong>{formatRupiah(projectedCash)}</strong>
                        </div>
                      </div>
                    </div>

                    {/* Pilihan Cepat Jenis Bayar */}
                    <div className="flex flex-wrap gap-2">
                      {ev?.isDpPending && (
                        <button
                          type="button"
                          onClick={() => {
                            setPayJenis('DP');
                            setPayAmountRp(ev.recommendedPayAmountRp);
                          }}
                          className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                            payJenis === 'DP'
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          Bayar DP ({formatRupiah(ev.recommendedPayAmountRp)})
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setPayJenis('PELUNASAN');
                          setPayAmountRp(sisaTagihan);
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                          payJenis === 'PELUNASAN'
                            ? 'bg-rose-600 text-white border-rose-600'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Lunasi Penuh ({formatRupiah(sisaTagihan)})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPayJenis('SEBAGIAN')}
                        className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${
                          payJenis === 'SEBAGIAN'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Bayar Sebagian
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Nominal Pembayaran (Rp)
                        </label>
                        <input
                          type="number"
                          min={1}
                          max={sisaTagihan}
                          value={payAmountRp || ''}
                          onChange={(e) => setPayAmountRp(Math.max(0, Number(e.target.value) || 0))}
                          className="w-full mt-1 px-3 py-2 rounded-xl text-sm font-bold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Metode Pembayaran
                        </label>
                        <select
                          value={payMethod}
                          onChange={(e) => setPayMethod(e.target.value as MetodePembayaran)}
                          className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                        >
                          {(Object.keys(PAYMENT_METHOD_LABELS) as MetodePembayaran[]).map((m) => (
                            <option key={m} value={m}>
                              {PAYMENT_METHOD_LABELS[m]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Tanggal Bayar
                        </label>
                        <input
                          type="date"
                          value={payDate}
                          onChange={(e) => setPayDate(e.target.value)}
                          className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          No. Bukti Transfer / Kuitansi
                        </label>
                        <input
                          type="text"
                          value={payRefNo}
                          onChange={(e) => setPayRefNo(e.target.value)}
                          placeholder="Opsional"
                          className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          PIC Pembayar
                        </label>
                        <input
                          type="text"
                          value={payPic}
                          onChange={(e) => setPayPic(e.target.value)}
                          className="w-full mt-1 px-3 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
                        <Upload className="w-3.5 h-3.5" />
                        {payUploading ? 'Mengunggah...' : 'Unggah Bukti Transfer / Kuitansi'}
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          onChange={handleUploadPayProof}
                          className="hidden"
                        />
                      </label>
                      {payFiles.length > 0 && (
                        <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                          ✓ {payFiles.length} berkas terlampir
                        </span>
                      )}
                    </div>

                    {overCash && (
                      <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
                        <span>Saldo kas proyek tidak mencukupi untuk nominal ini.</span>
                        <button
                          type="button"
                          onClick={() => {
                            setPayTargetPo(null);
                            setCashTargetTab('SUMMARY');
                            setCurrentView('cashflow');
                          }}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold whitespace-nowrap"
                        >
                          Isi Kas →
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/70 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => setPayTargetPo(null)}
                      className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      disabled={paySubmitting || payUploading || overCash || payAmountRp <= 0}
                      onClick={handleSubmitPay}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm"
                    >
                      <ArrowUpFromLine className="w-3.5 h-3.5" />
                      {paySubmitting ? 'Memproses...' : `Bayar ${formatRupiah(payAmountRp)}`}
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 4: RIWAYAT, AUDIT 3-WAY & KOREKSI BATAL/GANTI PO                */}
      {/* ===================================================================== */}
      {historyEntry && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900 dark:text-white">
                    Rincian & Jejak Audit — {historyEntry.po.po_no}
                  </h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border ${historyEntry.ev.statusBadgeClass}`}
                  >
                    {historyEntry.ev.statusLabel}
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {historyEntry.po.nama_toko} · {PO_PAYMENT_TERMS_LABELS[historyEntry.po.payment_terms]}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setHistoryPoId(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
              {historyEntry.po.alasan_batal_ganti && (
                <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200">
                  <strong>Catatan Status:</strong> {historyEntry.po.alasan_batal_ganti}
                </div>
              )}

              {/* Rantai Pengesahan 4 Tingkat */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { title: '1. Terbit (Clerk)', val: historyEntry.po.created_by_name || '-' },
                  { title: '2. Diperiksa (Foreman)', val: historyEntry.po.diperiksa_oleh || 'Menunggu' },
                  { title: '3. Disetujui (Spv.)', val: historyEntry.po.disetujui_oleh || 'Menunggu' },
                  { title: '4. Sah TTE/QR', val: historyEntry.po.mengetahui_oleh || 'Menunggu' },
                ].map((st) => (
                  <div
                    key={st.title}
                    className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700"
                  >
                    <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      {st.title}
                    </div>
                    <div className="mt-1 font-medium text-slate-800 dark:text-slate-200 break-words">
                      {st.val}
                    </div>
                  </div>
                ))}
              </div>

              {/* Tabel Item PO */}
              <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2">Material</th>
                      <th className="px-3 py-2 text-right">Pesan</th>
                      <th className="px-3 py-2 text-right">Tiba</th>
                      <th className="px-3 py-2 text-right">Harga PO</th>
                      <th className="px-3 py-2 text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {historyEntry.ev.itemProgress.map((r) => (
                      <tr key={r.item.id}>
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                          {r.item.nama_barang}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {r.qtyPesan} {r.item.satuan}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                          {r.qtyDiterima} {r.item.satuan}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {formatRupiah(r.item.harga_satuan_po)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                          {formatRupiah(r.item.subtotal_rp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Jejak 3-Way: Gudang & Kas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5">
                  <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Package className="w-3.5 h-3.5 text-emerald-600" />
                    Penerimaan Gudang ({historyEntry.ev.linkedStockMutations.length})
                  </div>
                  {historyEntry.ev.linkedStockMutations.length === 0 ? (
                    <div className="text-slate-500">Belum ada penerimaan barang.</div>
                  ) : (
                    historyEntry.ev.linkedStockMutations.map((m) => (
                      <div key={m.id} className="text-[11px] text-slate-600 dark:text-slate-300">
                        • {formatDateTime(m.tanggal)} — {m.nama_barang}:{' '}
                        <strong>
                          +{m.jumlah} {m.satuan}
                        </strong>
                      </div>
                    ))
                  )}
                </div>

                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5">
                  <div className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <ArrowUpFromLine className="w-3.5 h-3.5 text-rose-600" />
                    Pembayaran Kas ({historyEntry.ev.linkedCashMutations.length})
                  </div>
                  {historyEntry.ev.linkedCashMutations.length === 0 ? (
                    <div className="text-slate-500">Belum ada pembayaran kas.</div>
                  ) : (
                    historyEntry.ev.linkedCashMutations.map((c) => (
                      <div key={c.id} className="text-[11px] text-slate-600 dark:text-slate-300">
                        • {formatDateOnly(c.tanggal)} — <strong>{formatRupiah(c.jumlah_rp)}</strong> (
                        {PAYMENT_METHOD_LABELS[c.payment_method || 'TUNAI']})
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Koreksi / Instruksi Batal atau Ganti PO */}
              {!historyEntry.ev.isExcluded &&
                (rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti) && (
                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                    <div className="font-bold text-slate-800 dark:text-slate-200">
                      {rolePermissions.canInstructBatalGanti
                        ? 'Instruksi Pengawas: Batalkan / Ganti PO'
                        : 'Koreksi Surat Pesanan (Tanpa Hapus Permanen)'}
                    </div>
                    {!historyEntry.ev.canBatal ? (
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">
                        {historyEntry.ev.batalBlockReason}
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setShowBatalForm((v) => !v)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-800 font-semibold"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            Batalkan PO
                          </button>
                          {evalCtx.canIssue && (
                            <button
                              type="button"
                              onClick={() => {
                                const target = historyEntry.po;
                                setHistoryPoId(null);
                                openNewPoWizard({ replacePo: target });
                              }}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800 font-semibold"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              Ganti / Revisi PO
                            </button>
                          )}
                        </div>

                        {showBatalForm && (
                          <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                            <input
                              type="text"
                              value={batalReason}
                              onChange={(e) => setBatalReason(e.target.value)}
                              placeholder="Tuliskan alasan pembatalan (min. 5 karakter)..."
                              className="w-full px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-800 border border-rose-300 dark:border-rose-700 text-slate-900 dark:text-white"
                            />
                            <button
                              type="button"
                              disabled={busyActionId === historyEntry.po.id}
                              onClick={() => handleExecuteBatalPo(historyEntry.po)}
                              className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                            >
                              Konfirmasi Batalkan PO
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => handlePrintPoPdf(historyEntry.po)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm"
              >
                <FileText className="w-3.5 h-3.5" />
                Cetak PDF PO
              </button>
              <button
                type="button"
                onClick={() => setHistoryPoId(null)}
                className="px-3.5 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 5: TAMBAH / UBAH TOKO REKANAN                                   */}
      {/* ===================================================================== */}
      {storeModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {editingStore ? 'Ubah Data Toko Rekanan' : 'Tambah Toko Rekanan Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setStoreModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-xs">
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Nama Toko <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={storeFormName}
                  onChange={(e) => setStoreFormName(e.target.value)}
                  placeholder="Contoh: TB Sinar Bangunan"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Telepon / WA
                  </label>
                  <input
                    type="text"
                    value={storeFormPhone}
                    onChange={(e) => setStoreFormPhone(e.target.value)}
                    placeholder="0812-..."
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div>
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    PIC / Pemilik Toko
                  </label>
                  <input
                    type="text"
                    value={storeFormPic}
                    onChange={(e) => setStoreFormPic(e.target.value)}
                    placeholder="Nama kontak"
                    className="w-full mt-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
              </div>
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">
                  Syarat Bayar Bawaan
                </label>
                <select
                  value={storeFormTerms}
                  onChange={(e) => setStoreFormTerms(e.target.value as PoPaymentTerms)}
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  {(Object.keys(PO_PAYMENT_TERMS_LABELS) as PoPaymentTerms[]).map((k) => (
                    <option key={k} value={k}>
                      {PO_PAYMENT_TERMS_LABELS[k]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">Alamat</label>
                <input
                  type="text"
                  value={storeFormAddress}
                  onChange={(e) => setStoreFormAddress(e.target.value)}
                  placeholder="Alamat toko rekanan..."
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="font-semibold text-slate-700 dark:text-slate-300">Catatan</label>
                <input
                  type="text"
                  value={storeFormNotes}
                  onChange={(e) => setStoreFormNotes(e.target.value)}
                  placeholder="Contoh: Spesialis besi beton & semen"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>
            <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/70 dark:bg-slate-900">
              <button
                type="button"
                onClick={() => setStoreModalOpen(false)}
                className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={storeSaving}
                onClick={handleSaveStoreModal}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold"
              >
                {storeSaving ? 'Menyimpan...' : 'Simpan Toko'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

function ClipboardCheckIcon() {
  return <FileText className="w-4 h-4" />;
}

function renderActionIcon(actionType: PoEvaluation['actionType']) {
  switch (actionType) {
    case 'APPROVE':
      return <CheckCircle2 className="w-3.5 h-3.5" />;
    case 'KOREKSI':
      return <Edit3 className="w-3.5 h-3.5" />;
    case 'KIRIM_PO':
      return <Send className="w-3.5 h-3.5" />;
    case 'TERIMA_BARANG':
      return <ArrowDownToLine className="w-3.5 h-3.5" />;
    case 'BAYAR_PO':
      return <ArrowUpFromLine className="w-3.5 h-3.5" />;
    case 'ISI_KAS':
      return <ArrowDownToLine className="w-3.5 h-3.5" />;
    case 'LIHAT_PENGGANTI':
      return <ExternalLink className="w-3.5 h-3.5" />;
    case 'RIWAYAT':
    default:
      return <Clock className="w-3.5 h-3.5" />;
  }
}
