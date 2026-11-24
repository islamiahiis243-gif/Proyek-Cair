import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  AlertTriangle,
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  Link2,
  Paperclip,
  PlusCircle,
  Receipt,
  Repeat,
  Sparkles,
  Trash2,
  User,
  WalletCards,
  XCircle,
} from 'lucide-react';
import { CurrencyInput } from './CurrencyInput';
import { useApp } from '../context/AppContext';
import {
  BebanBiaya,
  ItemBarang,
  JenisMutasiKas,
  KategoriMutasiKas,
  MetodePembayaran,
  MutasiKas,
  SupplierStore,
} from '../types';
import {
  BEBAN_BIAYA_LABELS,
  buildCashMutationPayloadFromWizard,
  CASH_IN_CATEGORIES,
  CASH_OUT_CATEGORIES,
  CashWizardAnswers,
  CashWizardStepId,
  createInitialCashWizardAnswers,
  deriveBebanBiayaFromCategory,
  OpenKasbonItem,
  PAYMENT_METHOD_LABELS,
  UnreconciledStockReceiptItem,
  validateCashWizardStep,
} from '../lib/cashflowEngine';
import { buildOccurredAtIso, formatIndonesianDate } from '../lib/stockMutationEngine';
import { formatRupiah } from '../lib/pdfGenerator';
import { fetchSupplierStores, saveSupplierStore, uploadReceiptFile } from '../lib/receiptStorage';

interface CashMutationWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultType: JenisMutasiKas;
  preselectedCategory?: KategoriMutasiKas;
  preselectedReceipt?: UnreconciledStockReceiptItem | null;
  preselectedAmount?: number;
  preselectedPurpose?: string;
  unreconciledReceipts: UnreconciledStockReceiptItem[];
  openKasbonList: OpenKasbonItem[];
  remainingClientAdvanceRp: number;
  onSubmitCash: (
    payload: Omit<MutasiKas, 'id' | 'saldo_setelah'>
  ) => Promise<{ success: boolean; message: string }>;
  onSuccessNotice: (msg: string) => void;
}

const STEP_ORDER: CashWizardStepId[] = ['PURPOSE_AMOUNT', 'PARTY_EVIDENCE', 'REVIEW'];

const STEP_META: Record<Exclude<CashWizardStepId, 'DONE_NEXT'>, { num: number; title: string; subtitle: string }> = {
  PURPOSE_AMOUNT: {
    num: 1,
    title: 'Keperluan & Nominal',
    subtitle: 'Pilih kategori, nominal, tanggal, dan metode pembayaran',
  },
  PARTY_EVIDENCE: {
    num: 2,
    title: 'Penanggung Jawab & Bukti',
    subtitle: 'Tentukan PIC, toko/pihak lawan, dan foto kuitansi',
  },
  REVIEW: {
    num: 3,
    title: 'Konfirmasi & Simpan',
    subtitle: 'Periksa ringkasan transaksi sebelum masuk buku kas',
  },
};

export const CashMutationWizardModal: React.FC<CashMutationWizardModalProps> = ({
  isOpen,
  onClose,
  defaultType,
  preselectedCategory,
  preselectedReceipt = null,
  preselectedAmount,
  preselectedPurpose,
  unreconciledReceipts,
  openKasbonList,
  remainingClientAdvanceRp,
  onSubmitCash,
  onSuccessNotice,
}) => {
  const {
    user,
    currentCashBalance,
    cashMutations,
    stockMutations,
    items,
    tenantBranding,
    activeProjectId,
  } = useApp();

  const [answers, setAnswers] = useState<CashWizardAnswers>(() =>
    createInitialCashWizardAnswers({
      jenis: preselectedReceipt ? 'KELUAR' : defaultType,
      defaultPic: user.name || '',
      preselectedCategory,
      preselectedReceipt,
      preselectedAmount,
      preselectedPurpose,
    })
  );
  const [stepId, setStepId] = useState<CashWizardStepId>(
    preselectedReceipt ? 'REVIEW' : 'PURPOSE_AMOUNT'
  );
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [sessionSavedCount, setSessionSavedCount] = useState(0);
  const [lastSavedSummary, setLastSavedSummary] = useState('');
  const [stores, setStores] = useState<SupplierStore[]>([]);

  // Reset saat modal dibuka atau preselected berubah
  useEffect(() => {
    if (!isOpen) return;
    const init = createInitialCashWizardAnswers({
      jenis: preselectedReceipt ? 'KELUAR' : defaultType,
      defaultPic: user.name || '',
      preselectedCategory,
      preselectedReceipt,
      preselectedAmount,
      preselectedPurpose,
    });
    setAnswers(init);
    setStepId(preselectedReceipt ? 'REVIEW' : 'PURPOSE_AMOUNT');
    setStepError(null);
    setSubmitting(false);
    setUploadingFiles(false);
    setSessionSavedCount(0);
    setLastSavedSummary('');
  }, [isOpen, defaultType, preselectedCategory, preselectedReceipt, preselectedAmount, preselectedPurpose, user.name]);

  // Muat daftar toko langganan untuk autocomplete
  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    fetchSupplierStores(activeProjectId || tenantBranding.projectId).then((list) => {
      if (active) setStores(list);
    });
    return () => {
      active = false;
    };
  }, [isOpen, activeProjectId, tenantBranding.projectId]);

  // Tutup dengan Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, submitting, onClose]);

  // Saran PIC dari riwayat proyek
  const picSuggestions = useMemo(() => {
    const set = new Set<string>();
    if (user.name?.trim()) set.add(user.name.trim());
    for (const c of cashMutations || []) {
      if (c.pic && c.pic !== '-' && c.pic.trim().length > 1) set.add(c.pic.trim());
    }
    for (const m of stockMutations || []) {
      if (m.pic_penerima_penyerah && m.pic_penerima_penyerah !== '-' && m.pic_penerima_penyerah.trim().length > 1) {
        set.add(m.pic_penerima_penyerah.trim());
      }
    }
    return Array.from(set).slice(0, 8);
  }, [user.name, cashMutations, stockMutations]);

  // Pos Jasa / Upah BOQ untuk chip kontekstual
  const boqServiceItems = useMemo<ItemBarang[]>(() => {
    return (items || []).filter((it) => !it.is_stock_item).slice(0, 6);
  }, [items]);

  if (!isOpen) return null;

  const isIn = answers.jenis === 'MASUK';
  const projectedBalance = isIn
    ? currentCashBalance + (Number(answers.jumlah_rp) || 0)
    : currentCashBalance - (Number(answers.jumlah_rp) || 0);
  const isInsufficientCash = !isIn && (Number(answers.jumlah_rp) || 0) > currentCashBalance;

  const categories = isIn ? CASH_IN_CATEGORIES : CASH_OUT_CATEGORIES;

  const handleSwitchJenis = (nextJenis: JenisMutasiKas) => {
    const nextCat: KategoriMutasiKas = nextJenis === 'MASUK' ? 'Dana Termin Proyek' : 'Material';
    setAnswers((prev) => ({
      ...prev,
      jenis: nextJenis,
      kategori_keperluan: nextCat,
      beban_biaya: deriveBebanBiayaFromCategory(nextJenis, nextCat),
      linked_stock_receipt: null,
      receipt_id: undefined,
      source_module: 'KAS_LANGSUNG',
      source_entity_id: undefined,
      source_entity_no: undefined,
      payment_method: nextJenis === 'MASUK' ? 'TRANSFER' : 'TUNAI',
    }));
    setStepError(null);
  };

  const handleSelectCategory = (cat: KategoriMutasiKas) => {
    setAnswers((prev) => ({
      ...prev,
      kategori_keperluan: cat,
      beban_biaya: deriveBebanBiayaFromCategory(prev.jenis, cat),
    }));
    setStepError(null);
  };

  const handleLinkStockReceipt = (rc: UnreconciledStockReceiptItem) => {
    const cat: KategoriMutasiKas = rc.isTalangan ? 'Talangan Klien' : 'Material';
    setAnswers((prev) => ({
      ...prev,
      jenis: 'KELUAR',
      kategori_keperluan: cat,
      beban_biaya: rc.isTalangan ? 'KLIEN' : 'PROYEK_BOQ',
      untuk_apa: `Pelunasan Nota ${rc.receiptNo} (${rc.storeName}) — ${rc.itemSummary}`,
      jumlah_rp: rc.totalAmountRp,
      nama_toko: rc.storeName,
      toko_kontak: rc.storeContact || '',
      nomor_kuitansi: rc.receiptNo,
      receipt_id: rc.receiptId,
      linked_stock_receipt: rc,
      source_module: 'MUTASI_BARANG',
      source_entity_id: rc.receiptId,
      source_entity_no: rc.receiptNo,
      status_bukti: rc.attachmentUrls.length > 0 ? 'REKONSILIASI_NOTA' : 'BUKTI_MENYUSUL',
      lampiran_nota_urls: [...rc.attachmentUrls],
      catatan: `Rekonsiliasi pembayaran nota belanja gudang (${rc.itemCount} item).`,
    }));
    setStepError(null);
  };

  const handleSwitchToCashInFirst = () => {
    const shortfall = Math.max(0, (Number(answers.jumlah_rp) || 0) - currentCashBalance);
    setAnswers(
      createInitialCashWizardAnswers({
        jenis: 'MASUK',
        defaultPic: user.name || '',
        preselectedCategory: 'Modal Kerja Kontraktor',
        preselectedAmount: shortfall > 0 ? shortfall : 0,
        preselectedPurpose:
          shortfall > 0
            ? `Pengisian kas operasional (menutup kebutuhan Rp ${answers.jumlah_rp.toLocaleString('id-ID')})`
            : 'Pengisian kas operasional proyek',
      })
    );
    setStepId('PURPOSE_AMOUNT');
    setStepError(null);
  };

  const handleUploadProofFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (files.length === 0) return;

    const remainingSlots = Math.max(0, 5 - answers.lampiran_nota_urls.length);
    const toUpload = files.slice(0, remainingSlots);
    if (toUpload.length === 0) return;

    setUploadingFiles(true);
    setStepError(null);
    try {
      const uploaded: string[] = [];
      for (const file of toUpload) {
        const url = await uploadReceiptFile(
          file,
          activeProjectId || tenantBranding.projectId || '',
          answers.nomor_kuitansi || 'kuitansi_kas'
        );
        uploaded.push(url);
      }
      setAnswers((prev) => ({
        ...prev,
        lampiran_nota_urls: [...prev.lampiran_nota_urls, ...uploaded].slice(0, 5),
        status_bukti: prev.linked_stock_receipt ? 'REKONSILIASI_NOTA' : 'TERLAMPIR',
      }));
    } catch (err: any) {
      setStepError(err?.message || 'Gagal mengunggah foto kuitansi.');
    } finally {
      setUploadingFiles(false);
      e.target.value = '';
    }
  };

  const handleNextStep = () => {
    const err = validateCashWizardStep(stepId, answers, currentCashBalance);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    const idx = STEP_ORDER.indexOf(stepId);
    if (idx >= 0 && idx < STEP_ORDER.length - 1) {
      setStepId(STEP_ORDER[idx + 1]);
    }
  };

  const handlePrevStep = () => {
    setStepError(null);
    const idx = STEP_ORDER.indexOf(stepId);
    if (idx > 0) {
      setStepId(STEP_ORDER[idx - 1]);
    }
  };

  const handleConfirmSave = async () => {
    if (submitting || uploadingFiles) return;
    const err = validateCashWizardStep('REVIEW', answers, currentCashBalance);
    if (err) {
      setStepError(err);
      return;
    }

    setSubmitting(true);
    setStepError(null);
    try {
      const occurredAtIso = buildOccurredAtIso(answers.tanggal);
      const payload = buildCashMutationPayloadFromWizard(answers, occurredAtIso);

      // Simpan toko baru ke daftar langganan jika diisi
      if (answers.nama_toko.trim()) {
        void saveSupplierStore({
          nama_toko: answers.nama_toko.trim(),
          telepon: answers.toko_kontak.trim() || undefined,
          project_id: activeProjectId || tenantBranding.projectId,
        });
      }

      const res = await onSubmitCash(payload);
      if (!res.success) {
        setStepError(res.message);
        return;
      }

      setSessionSavedCount((c) => c + 1);
      setLastSavedSummary(
        `${payload.jenis === 'MASUK' ? 'Kas Masuk' : 'Kas Keluar'} ${formatRupiah(payload.jumlah_rp)} — ${payload.untuk_apa}`
      );
      onSuccessNotice(res.message);
      setStepId('DONE_NEXT');
    } catch (e: any) {
      setStepError(e?.message || 'Gagal menyimpan transaksi kas.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRecordAnother = () => {
    setAnswers(
      createInitialCashWizardAnswers({
        jenis: answers.jenis,
        defaultPic: answers.pic || user.name || '',
      })
    );
    setStepId('PURPOSE_AMOUNT');
    setStepError(null);
  };

  const currentStepIdx = STEP_ORDER.indexOf(stepId);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cash-wizard-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-950/75 backdrop-blur-xs overflow-y-auto"
    >
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden my-auto flex flex-col max-h-[92vh] animate-in fade-in zoom-in-95 duration-150">
        {/* Header Wizard Dinamis */}
        <div
          className={`px-5 py-4 border-b flex items-center justify-between gap-3 ${
            isIn
              ? 'bg-emerald-950 text-white border-emerald-900'
              : 'bg-slate-900 text-white border-slate-800'
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                isIn ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
              }`}
            >
              {isIn ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 id="cash-wizard-title" className="text-sm sm:text-base font-extrabold truncate">
                  {answers.linked_stock_receipt
                    ? 'Bayar Nota Belanja Gudang (Ekspres)'
                    : isIn
                    ? 'Catat Dana Kas Masuk'
                    : 'Catat Pengeluaran Kas'}
                </h2>
                {stepId !== 'DONE_NEXT' && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/15 text-white">
                    Langkah {STEP_META[stepId].num} dari 3
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-300 truncate mt-0.5">
                {stepId === 'DONE_NEXT'
                  ? 'Transaksi telah dibukukan ke jurnal kas proyek'
                  : STEP_META[stepId].subtitle}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Tutup panduan transaksi kas"
            className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <XCircle className="w-5 h-5" />
          </button>
        </div>

        {/* Bilah Progres 3 Langkah */}
        {stepId !== 'DONE_NEXT' && (
          <div className="px-5 py-2.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
            {STEP_ORDER.map((sId, idx) => {
              const meta = STEP_META[sId as Exclude<CashWizardStepId, 'DONE_NEXT'>];
              const isActive = sId === stepId;
              const isDone = idx < currentStepIdx;
              return (
                <button
                  key={sId}
                  type="button"
                  onClick={() => {
                    if (idx < currentStepIdx || answers.linked_stock_receipt) {
                      setStepError(null);
                      setStepId(sId);
                    }
                  }}
                  className={`flex-1 flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-left transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs font-bold'
                      : isDone
                      ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 font-semibold cursor-pointer'
                      : 'text-slate-500 dark:text-slate-400 font-medium'
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full text-[10px] font-extrabold flex items-center justify-center shrink-0 ${
                      isActive
                        ? 'bg-white text-blue-700'
                        : isDone
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {isDone ? '✓' : meta.num}
                  </span>
                  <span className="text-[11px] truncate">{meta.title}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Isi Form */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4 text-xs">
          {/* Pesan Galat */}
          {stepError && (
            <div
              role="alert"
              className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200 flex items-start gap-2.5"
            >
              <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
              <div className="flex-1 space-y-2">
                <p className="font-semibold">{stepError}</p>
                {isInsufficientCash && (
                  <button
                    type="button"
                    onClick={handleSwitchToCashInFirst}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-xs cursor-pointer"
                  >
                    <ArrowDownLeft className="w-3.5 h-3.5" />
                    <span>+ Catat Kas Masuk Dulu</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* LANGKAH 1: KEPERLUAN, NOMINAL & METODE */}
          {stepId === 'PURPOSE_AMOUNT' && (
            <div className="space-y-4">
              {/* Pemilih Arah Dana */}
              <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                <button
                  type="button"
                  onClick={() => handleSwitchJenis('MASUK')}
                  className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    isIn
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700'
                  }`}
                >
                  <ArrowDownLeft className="w-4 h-4" />
                  <span>Dana Kas Masuk</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchJenis('KELUAR')}
                  className={`py-2 px-3 rounded-lg font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                    !isIn
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-700'
                  }`}
                >
                  <ArrowUpRight className="w-4 h-4" />
                  <span>Pengeluaran Kas</span>
                </button>
              </div>

              {/* Kartu Pilihan Kategori */}
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-800 dark:text-slate-200">
                  {isIn ? 'Sumber Dana Masuk' : 'Pos Biaya / Kategori Pengeluaran'}{' '}
                  <span className="text-rose-500">*</span>
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {categories.map((cat) => {
                    const active = answers.kategori_keperluan === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => handleSelectCategory(cat)}
                        className={`px-3 py-2 rounded-xl border text-left font-semibold transition-all cursor-pointer ${
                          active
                            ? isIn
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-900 dark:text-emerald-200 ring-1 ring-emerald-500'
                              : 'border-rose-500 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 ring-1 ring-rose-500'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                        }`}
                      >
                        <div className="truncate text-[11px] font-bold">{cat}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Sakelar Ringkas Beban Khusus Klien (untuk KELUAR) */}
              {!isIn && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-[11px]">
                      Alokasi Beban Biaya (Otomatis:{' '}
                      <span className="text-blue-600 dark:text-blue-400">
                        {BEBAN_BIAYA_LABELS[answers.beban_biaya]}
                      </span>
                      )
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Ubah hanya jika pengeluaran ini ditagihkan balik ke {tenantBranding.clientName} atau berupa bonus.
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {(
                      [
                        { id: deriveBebanBiayaFromCategory('KELUAR', answers.kategori_keperluan), label: 'Bawaan' },
                        { id: 'KLIEN' as BebanBiaya, label: 'Tagih Klien' },
                        { id: 'BONUS_KLIEN' as BebanBiaya, label: 'Bonus Klien' },
                      ] as const
                    ).map((opt) => {
                      const isSel = answers.beban_biaya === opt.id;
                      return (
                        <button
                          key={opt.label}
                          type="button"
                          onClick={() => setAnswers((p) => ({ ...p, beban_biaya: opt.id }))}
                          className={`px-2.5 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer ${
                            isSel
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Chip Kontekstual 1-Klik: Nota Gudang Belum Dibayar (saat Material) */}
              {!isIn && answers.kategori_keperluan === 'Material' && unreconciledReceipts.length > 0 && (
                <div className="p-3 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 space-y-2">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-900 dark:text-blue-200">
                    <Link2 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Isi Otomatis 1-Klik dari Nota Belanja Gudang Belum Dibayar:</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {unreconciledReceipts.slice(0, 5).map((rc) => {
                      const active = answers.linked_stock_receipt?.key === rc.key;
                      return (
                        <button
                          key={rc.key}
                          type="button"
                          onClick={() => handleLinkStockReceipt(rc)}
                          className={`px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold transition-all cursor-pointer flex items-center gap-1.5 ${
                            active
                              ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                              : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-blue-200 dark:border-blue-800 hover:bg-blue-100 dark:hover:bg-blue-900/50'
                          }`}
                        >
                          <Receipt className="w-3 h-3 shrink-0" />
                          <span>{rc.storeName}</span>
                          <span className="font-mono font-bold">{formatRupiah(rc.totalAmountRp)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Chip Kontekstual 1-Klik: Pos Jasa BOQ (saat Upah & Konsumsi) */}
              {!isIn && answers.kategori_keperluan === 'Upah & Konsumsi' && boqServiceItems.length > 0 && (
                <div className="p-3 rounded-xl bg-indigo-50/60 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800 space-y-1.5">
                  <div className="text-[11px] font-bold text-indigo-900 dark:text-indigo-200">
                    Tautkan Pos Jasa / Upah BOQ (Opsional):
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {boqServiceItems.map((it) => {
                      const active = answers.boq_item_id === it.id;
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() =>
                            setAnswers((p) => ({
                              ...p,
                              boq_item_id: active ? undefined : it.id,
                              untuk_apa: active
                                ? p.untuk_apa
                                : p.untuk_apa || `Pembayaran Upah: ${it.nama_barang}`,
                            }))
                          }
                          className={`px-2.5 py-1 rounded-lg border text-[10px] font-semibold cursor-pointer transition-colors ${
                            active
                              ? 'bg-indigo-600 text-white border-indigo-600'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-100'
                          }`}
                        >
                          {it.kode_boq} · {it.nama_barang.slice(0, 32)}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Chip Kontekstual 1-Klik: Pengembalian Panjar Terbuka */}
              {isIn && answers.kategori_keperluan === 'Pengembalian Panjar' && openKasbonList.some((k) => k.statusKasbon !== 'LUNAS') && (
                <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-1.5">
                  <div className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200">
                    Pilih Panjar Terbuka Terkait:
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {openKasbonList
                      .filter((k) => k.statusKasbon !== 'LUNAS')
                      .slice(0, 5)
                      .map((k) => (
                        <button
                          key={k.kasbonTx.id}
                          type="button"
                          onClick={() =>
                            setAnswers((p) => ({
                              ...p,
                              kasbon_induk_id: k.kasbonTx.id,
                              pic: k.picName,
                              jumlah_rp: k.sisaTerbukaRp,
                              untuk_apa: `Pengembalian Sisa Panjar — ${k.kasbonTx.untuk_apa}`,
                            }))
                          }
                          className="px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-800 bg-white dark:bg-slate-900 text-emerald-900 dark:text-emerald-200 text-[11px] font-semibold hover:bg-emerald-100 cursor-pointer"
                        >
                          {k.picName} · Sisa {formatRupiah(k.sisaTerbukaRp)}
                        </button>
                      ))}
                  </div>
                </div>
              )}

              {/* Chip Kontekstual 1-Klik: Penggantian Talangan Klien */}
              {isIn && answers.kategori_keperluan === 'Penggantian Talangan Klien' && remainingClientAdvanceRp > 0 && (
                <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 flex items-center justify-between gap-2">
                  <div className="text-[11px] text-emerald-900 dark:text-emerald-200 font-semibold">
                    Sisa Piutang Talangan {tenantBranding.clientName}:{' '}
                    <span className="font-mono font-extrabold">{formatRupiah(remainingClientAdvanceRp)}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setAnswers((p) => ({
                        ...p,
                        jumlah_rp: remainingClientAdvanceRp,
                        untuk_apa: `Penggantian Biaya Talangan dari ${tenantBranding.clientName}`,
                        nama_toko: tenantBranding.clientName,
                      }))
                    }
                    className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold cursor-pointer shrink-0"
                  >
                    Isi Penuh
                  </button>
                </div>
              )}

              {/* Tanggal & Nominal */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Tanggal Transaksi <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="date"
                      value={answers.tanggal}
                      onChange={(e) => setAnswers((p) => ({ ...p, tanggal: e.target.value }))}
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-medium"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Nominal Transaksi (Rp) <span className="text-rose-500">*</span>
                  </label>
                  <CurrencyInput
                    value={answers.jumlah_rp}
                    onChange={(val) => setAnswers((p) => ({ ...p, jumlah_rp: val || 0 }))}
                    placeholder="Contoh: 1.500.000"
                    required
                    inputClassName="px-3 py-2 text-sm font-bold"
                  />
                </div>
              </div>

              {/* Proyeksi Saldo Kas Akhir */}
              <div
                className={`p-3 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${
                  isInsufficientCash
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
                    : 'bg-slate-50 dark:bg-slate-800/70 border-slate-200 dark:border-slate-700'
                }`}
              >
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">
                    Proyeksi Saldo Kas Setelah Transaksi
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">
                    Saldo saat ini: <span className="font-mono font-bold">{formatRupiah(currentCashBalance)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`text-sm font-extrabold font-mono ${
                      projectedBalance < 0
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-emerald-700 dark:text-emerald-300'
                    }`}
                  >
                    {formatRupiah(projectedBalance)}
                  </span>
                  {isInsufficientCash && (
                    <button
                      type="button"
                      onClick={handleSwitchToCashInFirst}
                      className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold cursor-pointer"
                    >
                      + Isi Kas Dulu
                    </button>
                  )}
                </div>
              </div>

              {/* Uraian Peruntukan */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Uraian Keperluan / Keterangan <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={answers.untuk_apa}
                  onChange={(e) => setAnswers((p) => ({ ...p, untuk_apa: e.target.value }))}
                  placeholder={
                    isIn
                      ? 'Contoh: Pencairan Termin 1 proyek atau setoran modal kerja'
                      : 'Contoh: Pembayaran semen 50 sak TB Sinar Jaya / Upah tukang minggu ke-2'
                  }
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>

              {/* Metode Pembayaran */}
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-300">
                  Metode Pembayaran
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['TUNAI', 'TRANSFER', 'GIRO_CEK', 'DOMPET_DIGITAL'] as MetodePembayaran[]).map((pm) => {
                    const active = answers.payment_method === pm;
                    return (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => setAnswers((p) => ({ ...p, payment_method: pm }))}
                        className={`px-2.5 py-2 rounded-xl border text-[11px] font-bold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                          active
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 ring-1 ring-blue-500'
                            : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 text-slate-700 dark:text-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <CreditCard className="w-3.5 h-3.5 shrink-0" />
                        <span>{PAYMENT_METHOD_LABELS[pm]}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* LANGKAH 2: PENANGGUNG JAWAB, TOKO & BUKTI */}
          {stepId === 'PARTY_EVIDENCE' && (
            <div className="space-y-4">
              {/* PIC Wajib + Chip Saran */}
              <div className="space-y-1.5">
                <label className="block font-bold text-slate-700 dark:text-slate-300">
                  Penanggung Jawab / Penerima-Penyerah Dana (PIC) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                  <input
                    type="text"
                    value={answers.pic}
                    onChange={(e) => setAnswers((p) => ({ ...p, pic: e.target.value }))}
                    placeholder="Nama staf, mandor, atau kasir yang menyerahkan/menerima dana"
                    className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>
                {picSuggestions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {picSuggestions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => setAnswers((p) => ({ ...p, pic: name }))}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border transition-colors cursor-pointer ${
                          answers.pic === name
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Nama Toko / Pihak Lawan + Nomor Kuitansi */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Nama Toko / Pihak Lawan
                  </label>
                  <div className="relative">
                    <Building2 className="w-4 h-4 text-slate-400 absolute left-3 top-2.5 pointer-events-none" />
                    <input
                      type="text"
                      list="cash-wizard-stores"
                      value={answers.nama_toko}
                      onChange={(e) => setAnswers((p) => ({ ...p, nama_toko: e.target.value }))}
                      placeholder="Contoh: TB Sinar Bangunan / Nama Pihak Lawan"
                      className="w-full pl-9 pr-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                    />
                    <datalist id="cash-wizard-stores">
                      {stores.map((s) => (
                        <option key={s.id} value={s.nama_toko} />
                      ))}
                    </datalist>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    No. Kuitansi / Referensi Transfer
                  </label>
                  <input
                    type="text"
                    value={answers.nomor_kuitansi}
                    onChange={(e) => setAnswers((p) => ({ ...p, nomor_kuitansi: e.target.value }))}
                    placeholder="Contoh: KWT-001 atau TRF-20261124"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono"
                  />
                </div>
              </div>

              {/* Status & Unggah Bukti Kuitansi */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <div className="font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Paperclip className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                      <span>Lampiran Foto Kuitansi / Bukti Transfer</span>
                    </div>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400">
                      Foto otomatis dikompresi agar hemat kuota lapangan (maks. 5 berkas gambar/PDF).
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-bold cursor-pointer shadow-xs">
                      <Camera className="w-3.5 h-3.5" />
                      <span>{uploadingFiles ? 'Mengunggah...' : 'Unggah Bukti'}</span>
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        disabled={uploadingFiles || answers.lampiran_nota_urls.length >= 5}
                        onChange={handleUploadProofFiles}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setAnswers((p) => ({
                          ...p,
                          status_bukti:
                            p.status_bukti === 'BUKTI_MENYUSUL' ? 'TANPA_BUKTI' : 'BUKTI_MENYUSUL',
                        }))
                      }
                      className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-colors cursor-pointer ${
                        answers.status_bukti === 'BUKTI_MENYUSUL'
                          ? 'bg-sky-600 text-white border-sky-600 shadow-xs'
                          : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      <Clock className="w-3.5 h-3.5" />
                      <span>Bukti Menyusul</span>
                    </button>
                  </div>
                </div>

                {answers.lampiran_nota_urls.length > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                    {answers.lampiran_nota_urls.map((url, idx) => {
                      const isPdf = url.toLowerCase().includes('.pdf') || url.startsWith('data:application/pdf');
                      return (
                        <div
                          key={`${url}-${idx}`}
                          className="relative group h-20 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-white dark:bg-slate-900 flex items-center justify-center"
                        >
                          {isPdf ? (
                            <div className="flex flex-col items-center text-rose-600 dark:text-rose-400">
                              <FileText className="w-6 h-6" />
                              <span className="text-[9px] font-bold">PDF #{idx + 1}</span>
                            </div>
                          ) : (
                            <img
                              src={url}
                              alt={`Bukti ${idx + 1}`}
                              className="w-full h-full object-cover"
                            />
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              setAnswers((p) => {
                                const nextUrls = p.lampiran_nota_urls.filter((_, i) => i !== idx);
                                return {
                                  ...p,
                                  lampiran_nota_urls: nextUrls,
                                  status_bukti: nextUrls.length > 0 ? p.status_bukti : 'TANPA_BUKTI',
                                };
                              })
                            }
                            aria-label="Hapus lampiran"
                            className="absolute top-1 right-1 p-1 rounded-full bg-rose-600 text-white opacity-90 hover:opacity-100 cursor-pointer"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}

                {answers.status_bukti === 'BUKTI_MENYUSUL' && (
                  <div className="p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-[11px] text-sky-900 dark:text-sky-200 font-medium">
                    Transaksi akan ditandai <b>Bukti Menyusul</b> sehingga muncul di antrean pengawasan bukti dan bisa dilengkapi 1 klik nanti.
                  </div>
                )}
              </div>

              {/* Catatan Tambahan */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Catatan Tambahan (Opsional)
                </label>
                <textarea
                  rows={2}
                  value={answers.catatan}
                  onChange={(e) => setAnswers((p) => ({ ...p, catatan: e.target.value }))}
                  placeholder="Keterangan tambahan untuk audit atau referensi bank..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* LANGKAH 3: KONFIRMASI & JALUR EKSPRES 2-KLIK */}
          {stepId === 'REVIEW' && (
            <div className="space-y-4">
              {answers.linked_stock_receipt && (
                <div className="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] text-indigo-900 dark:text-indigo-200">
                    <b>Jalur Ekspres Rekonsiliasi Nota Gudang:</b> Data toko, nominal, nomor nota, dan foto bukti dari Mutasi Barang sudah terisi 100% otomatis. Cukup konfirmasi metode bayar lalu simpan.
                  </div>
                </div>
              )}

              {/* Ringkasan Utama */}
              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 p-4 space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-700">
                  <div>
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                        isIn
                          ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
                          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                      }`}
                    >
                      {isIn ? 'KAS MASUK' : 'KAS KELUAR'} · {answers.kategori_keperluan}
                    </span>
                    <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mt-1.5">
                      {answers.untuk_apa}
                    </h3>
                  </div>
                  <div
                    className={`text-lg font-extrabold font-mono text-right shrink-0 ${
                      isIn ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    }`}
                  >
                    {isIn ? '+' : '-'} {formatRupiah(answers.jumlah_rp)}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Tanggal Transaksi</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {formatIndonesianDate(answers.tanggal)}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Penanggung Jawab (PIC)</span>
                    <span className="font-bold text-slate-900 dark:text-white">{answers.pic || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Toko / Pihak Lawan</span>
                    <span className="font-bold text-slate-900 dark:text-white">{answers.nama_toko || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">No. Kuitansi / Nota</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-white">
                      {answers.nomor_kuitansi || 'Otomatis / Tanpa Nomor'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Beban Biaya</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {BEBAN_BIAYA_LABELS[answers.beban_biaya]}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 dark:text-slate-400 block">Status Bukti</span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {answers.lampiran_nota_urls.length > 0
                        ? `${answers.lampiran_nota_urls.length} Lampiran Siap`
                        : answers.status_bukti === 'BUKTI_MENYUSUL'
                        ? 'Bukti Menyusul'
                        : 'Tanpa Bukti'}
                    </span>
                  </div>
                </div>

                {/* Pilihan Cepat Metode Bayar di Langkah Konfirmasi (sangat berguna untuk 2-klik ekspres) */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 space-y-1.5">
                  <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300">
                    Konfirmasi Metode Pembayaran:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    {(['TUNAI', 'TRANSFER', 'GIRO_CEK', 'DOMPET_DIGITAL'] as MetodePembayaran[]).map((pm) => (
                      <button
                        key={pm}
                        type="button"
                        onClick={() => setAnswers((p) => ({ ...p, payment_method: pm }))}
                        className={`px-2 py-1.5 rounded-lg border text-[11px] font-bold cursor-pointer transition-colors ${
                          answers.payment_method === pm
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {PAYMENT_METHOD_LABELS[pm]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Proyeksi Saldo */}
                <div className="pt-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    Saldo Kas Setelah Simpan:
                  </span>
                  <span
                    className={`font-mono text-sm font-extrabold ${
                      projectedBalance < 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-emerald-600 dark:text-emerald-400'
                    }`}
                  >
                    {formatRupiah(projectedBalance)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* LAYAR SUKSES: DONE_NEXT */}
          {stepId === 'DONE_NEXT' && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shadow-inner">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Transaksi Kas Berhasil Dibukukan!
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-md mx-auto">
                  {lastSavedSummary}
                </p>
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 pt-1">
                  Total tercatat di sesi ini: {sessionSavedCount} transaksi · Saldo kas terkini:{' '}
                  <span className="font-mono font-extrabold">{formatRupiah(currentCashBalance)}</span>
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handleRecordAnother}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs shadow-sm cursor-pointer"
                >
                  <Repeat className="w-4 h-4" />
                  <span>Simpan &amp; Catat Lagi</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold text-xs cursor-pointer"
                >
                  <span>Selesai &amp; Tutup</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigasi Langkah */}
        {stepId !== 'DONE_NEXT' && (
          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/50 flex items-center justify-between gap-2">
            <div>
              {currentStepIdx > 0 ? (
                <button
                  type="button"
                  onClick={handlePrevStep}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Ubah Isian</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={submitting}
                  className="px-3.5 py-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  Batal
                </button>
              )}
            </div>

            <div>
              {stepId === 'REVIEW' ? (
                <button
                  type="button"
                  onClick={handleConfirmSave}
                  disabled={submitting || uploadingFiles || isInsufficientCash}
                  className={`inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-white text-xs font-extrabold shadow-md transition-all cursor-pointer disabled:opacity-45 ${
                    isIn
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  <WalletCards className="w-4 h-4" />
                  <span>{submitting ? 'Menyimpan...' : 'Simpan Transaksi Kas'}</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleNextStep}
                  disabled={uploadingFiles}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-extrabold shadow-sm cursor-pointer disabled:opacity-45"
                >
                  <span>Lanjut</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
