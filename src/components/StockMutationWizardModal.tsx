import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  PlusCircle,
  Repeat,
  Search,
  Sparkles,
  XCircle,
  AlertTriangle
} from 'lucide-react';
import {
  JenisMutasiBarang,
  MutasiBarang,
  PhysicalMaterialItem
} from '../types';
import {
  buildStockMutationPayload,
  computeWizardSteps,
  createInitialWizardAnswers,
  CustomStockOption,
  formatIndonesianDate,
  getProviderMetaForMaterial,
  getStepTheme,
  scoreFuzzyMatch,
  StockWizardAnswers,
  validateWizardStep,
  WizardStepId
} from '../lib/stockMutationEngine';

interface StockMutationWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  mutationType: JenisMutasiBarang;
  physicalMaterials: PhysicalMaterialItem[];
  existingCustomItems: CustomStockOption[];
  defaultPicName: string;
  preselectedMaterial?: PhysicalMaterialItem | null;
  preselectedLineId?: string;
  onSubmitPayload: (
    payload: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>
  ) => Promise<{ success: boolean; message: string }>;
  onSuccessNotice: (msg: string) => void;
}

export const StockMutationWizardModal: React.FC<StockMutationWizardModalProps> = ({
  isOpen,
  onClose,
  mutationType,
  physicalMaterials,
  existingCustomItems,
  defaultPicName,
  preselectedMaterial = null,
  preselectedLineId,
  onSubmitPayload,
  onSuccessNotice
}) => {
  const [answers, setAnswers] = useState<StockWizardAnswers>(() =>
    createInitialWizardAnswers(mutationType, defaultPicName, preselectedMaterial, preselectedLineId)
  );
  const [stepIndex, setStepIndex] = useState<number>(preselectedMaterial ? 1 : 0);
  const [isDoneNext, setIsDoneNext] = useState<boolean>(false);
  const [lastSavedText, setLastSavedText] = useState<string>('');
  const [sessionSavedCount, setSessionSavedCount] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  // Reset setiap kali modal dibuka
  useEffect(() => {
    if (!isOpen) return;
    const init = createInitialWizardAnswers(
      mutationType,
      defaultPicName,
      preselectedMaterial,
      preselectedLineId
    );
    setAnswers(init);
    setStepIndex(preselectedMaterial ? 1 : 0);
    setIsDoneNext(false);
    setLastSavedText('');
    setSessionSavedCount(0);
    setSearchQuery('');
    setStepError(null);
    setSubmitting(false);
  }, [isOpen, mutationType, defaultPicName, preselectedMaterial, preselectedLineId]);

  // Tutup dengan tombol Escape
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, submitting, onClose]);

  const steps = useMemo(() => computeWizardSteps(answers), [answers]);
  const safeStepIndex = Math.min(stepIndex, Math.max(0, steps.length - 1));
  const currentStepId: WizardStepId = isDoneNext ? 'DONE_NEXT' : (steps[safeStepIndex] || 'PICK_ITEM');
  const theme = useMemo(
    () => getStepTheme(currentStepId, answers.mutationType),
    [currentStepId, answers.mutationType]
  );

  // Pencarian Cerdas Toleran Typo & Multi-Kata — HANYA muncul saat Clerk mulai mengetik
  const trimmedQuery = searchQuery.trim();
  const hasTypedSearch = trimmedQuery.length > 0;

  const filteredBoqMatches = useMemo(() => {
    if (!hasTypedSearch) return [];
    const scored = physicalMaterials
      .filter((pm) => pm.is_stock_item)
      .map((pm) => {
        const boqInfo = pm.budget_lines.map((bl) => `${bl.kode_boq} ${bl.kategori}`).join(' ');
        const score = scoreFuzzyMatch(trimmedQuery, pm.nama_barang, pm.satuan, boqInfo);
        return { pm, score };
      })
      .filter((x) => x.score > 0);

    scored.sort((a, b) => {
      if (answers.mutationType === 'KELUAR') {
        const aHas = a.pm.stok_fisik > 0 ? 1 : 0;
        const bHas = b.pm.stok_fisik > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
      }
      if (b.score !== a.score) return b.score - a.score;
      return a.pm.nama_barang.localeCompare(b.pm.nama_barang);
    });

    return scored.slice(0, 12).map((x) => x.pm);
  }, [hasTypedSearch, trimmedQuery, physicalMaterials, answers.mutationType]);

  const filteredCustomMatches = useMemo(() => {
    if (!hasTypedSearch) return [];
    const scored = existingCustomItems
      .map((ci) => ({
        ci,
        score: scoreFuzzyMatch(trimmedQuery, ci.nama_barang, ci.satuan, ci.lastPurposeIn)
      }))
      .filter((x) => x.score > 0);

    scored.sort((a, b) => {
      if (answers.mutationType === 'KELUAR') {
        const aHas = a.ci.stok > 0 ? 1 : 0;
        const bHas = b.ci.stok > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
      }
      if (b.score !== a.score) return b.score - a.score;
      return a.ci.nama_barang.localeCompare(b.ci.nama_barang);
    });

    return scored.slice(0, 6).map((x) => x.ci);
  }, [hasTypedSearch, trimmedQuery, existingCustomItems, answers.mutationType]);

  const processed = useMemo(() => buildStockMutationPayload(answers), [answers]);

  if (!isOpen) return null;

  const progressPct = isDoneNext ? 100 : Math.round(((safeStepIndex + 1) / steps.length) * 100);
  const activeUom =
    answers.itemSource === 'BOQ'
      ? answers.physicalMaterial?.satuan || 'Unit'
      : answers.customItemUom.trim() || 'Unit';
  const activeName =
    answers.itemSource === 'BOQ'
      ? answers.physicalMaterial?.nama_barang || ''
      : answers.customItemName.trim();

  const handleSelectBoqItem = (pm: PhysicalMaterialItem) => {
    const prov = getProviderMetaForMaterial(pm);
    const nextAnswers: StockWizardAnswers = {
      ...answers,
      itemSource: 'BOQ',
      physicalMaterial: pm,
      customItemName: '',
      customItemUom: pm.satuan,
      customExistingStock: 0,
      customLastPurposeIn: '',
      asalBarang: answers.mutationType === 'MASUK' ? prov.defaultAsal : 'KONTRAKTOR',
      tokoBebasName: '',
      tujuanPengeluaran: 'PROYEK_BOQ',
      selectedBudgetLineId: pm.budget_lines[0]?.id || ''
    };
    setAnswers(nextAnswers);
    setStepError(null);
    const nextSteps = computeWizardSteps(nextAnswers);
    const qtyIdx = nextSteps.indexOf('QTY_DATE');
    setStepIndex(qtyIdx >= 0 ? qtyIdx : 1);
  };

  const handleSelectExistingCustomItem = (ci: CustomStockOption) => {
    const nextAnswers: StockWizardAnswers = {
      ...answers,
      itemSource: 'CUSTOM_EXISTING',
      physicalMaterial: null,
      customItemName: ci.nama_barang,
      customItemUom: ci.satuan,
      customExistingStock: ci.stok,
      customLastPurposeIn: ci.lastPurposeIn || '',
      asalBarang: 'KONTRAKTOR',
      tokoBebasName: '',
      tujuanPengeluaran: answers.mutationType === 'KELUAR' ? 'OPERASIONAL' : 'PROYEK_BOQ',
      selectedBudgetLineId: ''
    };
    setAnswers(nextAnswers);
    setStepError(null);
    const nextSteps = computeWizardSteps(nextAnswers);
    const qtyIdx = nextSteps.indexOf('QTY_DATE');
    setStepIndex(qtyIdx >= 0 ? qtyIdx : 1);
  };

  const handleChooseOtherNewItem = () => {
    const nextAnswers: StockWizardAnswers = {
      ...answers,
      itemSource: 'CUSTOM_NEW',
      physicalMaterial: null,
      customItemName: trimmedQuery,
      customItemUom: '',
      customExistingStock: 0,
      customLastPurposeIn: '',
      asalBarang: 'KONTRAKTOR',
      tokoBebasName: '',
      tujuanPengeluaran: answers.mutationType === 'KELUAR' ? 'OPERASIONAL' : 'PROYEK_BOQ',
      selectedBudgetLineId: ''
    };
    setAnswers(nextAnswers);
    setStepError(null);
    const nextSteps = computeWizardSteps(nextAnswers);
    const customIdx = nextSteps.indexOf('CUSTOM_IDENTITY');
    setStepIndex(customIdx >= 0 ? customIdx : 1);
  };

  const handleStartAnotherItem = (nextType: JenisMutasiBarang) => {
    const preservedDate = answers.mutationDate;
    const preservedPic = answers.pic || defaultPicName;
    const preservedSuratJalan = answers.suratJalan;
    const fresh = createInitialWizardAnswers(nextType, preservedPic, null, undefined);
    setAnswers({
      ...fresh,
      mutationDate: preservedDate,
      pic: preservedPic,
      suratJalan: nextType === answers.mutationType ? preservedSuratJalan : ''
    });
    setIsDoneNext(false);
    setStepIndex(0);
    setSearchQuery('');
    setStepError(null);
  };

  const handleNext = () => {
    const err = validateWizardStep(currentStepId, answers);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    if (safeStepIndex < steps.length - 1) {
      setStepIndex(safeStepIndex + 1);
    }
  };

  const handleBack = () => {
    setStepError(null);
    if (safeStepIndex > 0) {
      setStepIndex(safeStepIndex - 1);
    }
  };

  const handleSubmitFinal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting || isDoneNext) return;

    if (currentStepId !== 'SUMMARY') {
      handleNext();
      return;
    }

    setSubmitting(true);
    setStepError(null);
    try {
      const finalData = buildStockMutationPayload(answers);
      const res = await onSubmitPayload(finalData.payload);
      if (!res.success) {
        setStepError(res.message);
        return;
      }
      const savedSummary = `${answers.mutationType === 'MASUK' ? '+' : '-'}${answers.qty.toLocaleString('id-ID', {
        maximumFractionDigits: 3
      })} ${finalData.summary.uom} ${finalData.summary.itemName}`;
      setLastSavedText(savedSummary);
      setSessionSavedCount((c) => c + 1);
      onSuccessNotice(
        `${answers.mutationType === 'MASUK' ? 'Barang masuk' : 'Barang keluar'} ${finalData.summary.itemName} (${answers.qty} ${finalData.summary.uom}) berhasil disimpan.`
      );
      // Tidak langsung tutup! Tampilkan kartu pilihan apakah ingin mencatat item lagi
      setIsDoneNext(true);
    } catch (err: any) {
      setStepError(err?.message || 'Gagal menyimpan catatan barang.');
    } finally {
      setSubmitting(false);
    }
  };

  // Chip jejak jawaban ringkas di atas pertanyaan
  const contextChips: string[] = [];
  if (!isDoneNext && safeStepIndex > 0 && activeName) {
    contextChips.push(activeName);
  }
  if (!isDoneNext && safeStepIndex > steps.indexOf('QTY_DATE') && answers.qty > 0) {
    contextChips.push(`${answers.qty.toLocaleString('id-ID', { maximumFractionDigits: 3 })} ${activeUom}`);
  }
  if (
    !isDoneNext &&
    answers.mutationType === 'MASUK' &&
    safeStepIndex > steps.indexOf('ORIGIN') &&
    steps.includes('ORIGIN')
  ) {
    contextChips.push(
      answers.asalBarang === 'KLIEN'
        ? 'Klien (PT IMK)'
        : answers.asalBarang === 'TOKO_BEBAS'
        ? answers.tokoBebasName.trim() || 'Lainnya'
        : 'Kontraktor'
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/75 backdrop-blur-xs">
      <div
        className={`bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border-2 ${theme.cardRing} max-w-3xl w-full max-h-[92vh] flex flex-col overflow-hidden transition-all duration-200`}
      >
        {/* Header Berwarna Sesuai Kartu Aktif */}
        <div
          className={`shrink-0 ${theme.headerBg} text-white px-6 sm:px-8 py-5 border-b ${theme.headerBorder} transition-colors duration-200`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-2xl bg-white/15">
                {isDoneNext ? (
                  <CheckCircle2 className="w-5 h-5 text-white" />
                ) : answers.mutationType === 'MASUK' ? (
                  <ArrowDownLeft className="w-5 h-5 text-white" />
                ) : (
                  <ArrowUpRight className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <div className="text-base sm:text-lg font-extrabold leading-tight">
                  {isDoneNext
                    ? 'Catatan Berhasil Disimpan!'
                    : answers.mutationType === 'MASUK'
                    ? 'Catat Barang Masuk'
                    : 'Catat Barang Keluar'}
                </div>
                <div className="text-xs sm:text-sm text-white/90 font-medium mt-0.5">
                  {isDoneNext
                    ? `Total ${sessionSavedCount} item telah dicatat pada sesi ini`
                    : `Langkah ${safeStepIndex + 1} dari ${steps.length} · ${theme.badgeLabel}`}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              aria-label="Tutup jendela"
              className="text-white/85 hover:text-white transition-colors cursor-pointer"
            >
              <XCircle className="w-6 h-6" />
            </button>
          </div>

          {/* Progress Bar Halus */}
          <div className="mt-4 h-2 w-full rounded-full bg-white/20 overflow-hidden">
            <div
              className="h-full bg-white rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* Badan Pertanyaan — 1 Pertanyaan Besar & Lega per Layar */}
        <form onSubmit={handleSubmitFinal} className="p-6 sm:p-8 space-y-6 overflow-y-auto flex-1">
          {/* Jejak Jawaban Singkat */}
          {contextChips.length > 0 && currentStepId !== 'SUMMARY' && !isDoneNext && (
            <div className="flex flex-wrap items-center gap-2">
              {contextChips.map((chip, i) => (
                <span
                  key={`${chip}-${i}`}
                  className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold ${theme.badgeClass}`}
                >
                  {chip}
                </span>
              ))}
            </div>
          )}

          {/* Pesan Galat Langkah */}
          {stepError && (
            <div
              role="alert"
              className="flex items-center gap-2.5 rounded-2xl border border-rose-300 bg-rose-50 dark:border-rose-800 dark:bg-rose-950/50 px-4 py-3 text-sm font-semibold text-rose-800 dark:text-rose-200"
            >
              <AlertTriangle className="w-5 h-5 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{stepError}</span>
            </div>
          )}

          {/* ================================================================
              KARTU 1: PICK_ITEM ("Barang apa yang masuk / keluar?")
              Daftar barang TERSEMBUNYI sampai Clerk mengetik (pencarian fuzzy)
          ================================================================ */}
          {currentStepId === 'PICK_ITEM' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  {answers.mutationType === 'MASUK'
                    ? 'Barang apa yang masuk?'
                    : 'Barang apa yang mau dikeluarkan?'}
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Ketik sebagian nama barang (toleran salah ketik/singkatan), atau klik <b>Lainnya</b> untuk barang baru.
                </p>
              </div>

              <div className="relative">
                <Search className="w-5 h-5 text-slate-500 dark:text-slate-300 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  autoFocus
                  placeholder={
                    answers.mutationType === 'MASUK'
                      ? 'Ketik nama barang (cth: pasir, holow gipsum, baut baja, beras)...'
                      : 'Ketik nama barang yang ingin dikeluarkan...'
                  }
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setStepError(null);
                  }}
                  className="w-full pl-12 pr-10 py-4 bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 focus:border-blue-500 dark:focus:border-blue-400 text-slate-900 dark:text-white rounded-2xl text-base font-semibold focus:outline-hidden transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Hapus pencarian"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white text-sm font-bold cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* HASIL PENCARIAN HANYA MUNCUL SAAT USER MENGETIK */}
              {hasTypedSearch && (
                <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-800/70 max-h-72 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-700/60">
                  {filteredBoqMatches.map((pm) => {
                    const prov = getProviderMetaForMaterial(pm);
                    const totalTgt = pm.total_qty_boq || 0;
                    const totalIn = pm.total_qty_masuk || 0;
                    const kurang = Math.max(0, totalTgt - totalIn);

                    return (
                      <button
                        key={pm.id}
                        type="button"
                        onClick={() => handleSelectBoqItem(pm)}
                        className="w-full text-left px-4 py-3.5 hover:bg-blue-50 dark:hover:bg-slate-700/80 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                            {pm.nama_barang}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span
                              className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                prov.defaultAsal === 'KLIEN' && !prov.isMixed
                                  ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-200'
                                  : 'bg-blue-100 text-blue-800 dark:bg-blue-950/80 dark:text-blue-200'
                              }`}
                            >
                              {prov.defaultAsal === 'KLIEN' && !prov.isMixed
                                ? '👤 Klien (PT IMK)'
                                : prov.isMixed
                                ? '🏢 Kontraktor & PT IMK'
                                : '🏢 Kontraktor'}
                            </span>
                            <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                              Barang BOQ
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0 font-mono">
                          {answers.mutationType === 'MASUK' ? (
                            <>
                              <div className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100">
                                {totalIn.toLocaleString('id-ID', { maximumFractionDigits: 2 })} /{' '}
                                {totalTgt.toLocaleString('id-ID', { maximumFractionDigits: 2 })} {pm.satuan}
                              </div>
                              <div className="text-[11px] text-slate-600 dark:text-slate-300">
                                {kurang > 0
                                  ? `Kurang ${kurang.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`
                                  : 'Target terpenuhi'}
                              </div>
                            </>
                          ) : (
                            <div
                              className={`text-sm font-bold ${
                                pm.stok_fisik > 0
                                  ? 'text-emerald-700 dark:text-emerald-300'
                                  : 'text-slate-600 dark:text-slate-300'
                              }`}
                            >
                              Stok: {pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {pm.satuan}
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}

                  {filteredCustomMatches.map((ci) => (
                    <button
                      key={`${ci.nama_barang}|${ci.satuan}`}
                      type="button"
                      onClick={() => handleSelectExistingCustomItem(ci)}
                      className="w-full text-left px-4 py-3.5 hover:bg-purple-50 dark:hover:bg-purple-950/40 transition-colors flex items-center justify-between gap-3 cursor-pointer"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                          {ci.nama_barang}
                        </div>
                        <span className="inline-block mt-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/80 dark:text-purple-200">
                          ✍️ Barang Kustom
                        </span>
                      </div>
                      <div className="text-right shrink-0 font-mono text-sm font-bold text-slate-700 dark:text-slate-200">
                        Stok: {ci.stok.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {ci.satuan}
                      </div>
                    </button>
                  ))}

                  {filteredBoqMatches.length === 0 && filteredCustomMatches.length === 0 && (
                    <div className="p-5 text-center text-sm text-slate-600 dark:text-slate-300 font-medium">
                      "{trimmedQuery}" tidak ditemukan di daftar. Klik <b>Lainnya</b> di bawah untuk mencatatnya.
                    </div>
                  )}
                </div>
              )}

              {/* Tombol Lainnya */}
              <button
                type="button"
                onClick={handleChooseOtherNewItem}
                className="w-full flex items-center justify-between gap-3 px-5 py-4 rounded-2xl border-2 border-dashed border-purple-400 dark:border-purple-600 bg-purple-50/70 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200 hover:bg-purple-100 dark:hover:bg-purple-950/50 transition-colors text-sm font-bold cursor-pointer"
              >
                <span className="flex items-center gap-2.5 text-left">
                  <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-300 shrink-0" />
                  <span>
                    {hasTypedSearch
                      ? `Lainnya — Catat "${trimmedQuery}" sebagai barang baru`
                      : 'Lainnya (Barang baru di luar daftar)'}
                  </span>
                </span>
                <ArrowRight className="w-5 h-5 shrink-0" />
              </button>
            </div>
          )}

          {/* ================================================================
              KARTU 1b (UNGU): CUSTOM_IDENTITY
          ================================================================ */}
          {currentStepId === 'CUSTOM_IDENTITY' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Apa nama barangnya & satuannya?
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Sistem otomatis mencatat ini sebagai <b>Barang Kustom (Non-BOQ)</b>.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                    Nama Barang <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Contoh: Beras 50kg, Balok Camp, Solar Genset..."
                    value={answers.customItemName}
                    onChange={(e) => {
                      setAnswers({ ...answers, customItemName: e.target.value });
                      setStepError(null);
                    }}
                    className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800 border-2 border-purple-300 dark:border-purple-700 focus:border-purple-500 text-slate-900 dark:text-white rounded-2xl text-base font-semibold focus:outline-hidden"
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                    Satuan <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    placeholder="Sak, Kg, Unit..."
                    value={answers.customItemUom}
                    onChange={(e) => {
                      setAnswers({ ...answers, customItemUom: e.target.value });
                      setStepError(null);
                    }}
                    className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800 border-2 border-purple-300 dark:border-purple-700 focus:border-purple-500 text-slate-900 dark:text-white rounded-2xl text-base font-semibold focus:outline-hidden"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              KARTU 2 (BIRU): QTY_DATE
          ================================================================ */}
          {currentStepId === 'QTY_DATE' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  {answers.mutationType === 'MASUK'
                    ? `Berapa banyak ${activeName} yang masuk & kapan?`
                    : `Berapa banyak ${activeName} yang keluar & kapan?`}
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Tanggal otomatis hari ini, namun boleh memilih tanggal mundur jika baru sempat dicatat.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                    Jumlah ({activeUom}) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    autoFocus
                    min="0.0001"
                    step="any"
                    placeholder="Contoh: 5"
                    value={answers.qty === 0 ? '' : answers.qty}
                    onFocus={(e) => e.target.select()}
                    onWheel={(e) => (e.target as HTMLElement).blur()}
                    onChange={(e) => {
                      setAnswers({
                        ...answers,
                        qty: e.target.value === '' ? 0 : Number(e.target.value)
                      });
                      setStepError(null);
                    }}
                    className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800 border-2 border-blue-300 dark:border-blue-700 focus:border-blue-500 text-slate-900 dark:text-white rounded-2xl font-mono text-xl font-extrabold focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="flex items-center gap-1.5 text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                    <Calendar className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>{answers.mutationType === 'MASUK' ? 'Tanggal Masuk' : 'Tanggal Keluar'}</span>
                    <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    value={answers.mutationDate}
                    onChange={(e) => {
                      setAnswers({ ...answers, mutationDate: e.target.value });
                      setStepError(null);
                    }}
                    className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800 border-2 border-slate-300 dark:border-slate-600 focus:border-blue-500 text-slate-900 dark:text-white rounded-2xl text-base font-semibold focus:outline-hidden"
                  />
                  <p className="mt-1.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
                    Default hari ini · Boleh pilih tanggal mundur
                  </p>
                </div>
              </div>

              {answers.itemSource === 'BOQ' && answers.physicalMaterial && (
                <div className="px-4 py-3 rounded-2xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-sm font-semibold text-blue-900 dark:text-blue-200">
                  {answers.mutationType === 'MASUK' ? (
                    <>
                      Stok gudang akan menjadi{' '}
                      <b className="font-mono">
                        {(answers.physicalMaterial.stok_fisik + Number(answers.qty || 0)).toLocaleString('id-ID', {
                          maximumFractionDigits: 3
                        })}{' '}
                        {activeUom}
                      </b>{' '}
                      · Sisa belum tiba:{' '}
                      <b className="font-mono">
                        {Math.max(
                          0,
                          (answers.physicalMaterial.total_qty_boq || 0) -
                            ((answers.physicalMaterial.total_qty_masuk || 0) + Number(answers.qty || 0))
                        ).toLocaleString('id-ID', { maximumFractionDigits: 2 })}{' '}
                        {activeUom}
                      </b>
                    </>
                  ) : (
                    <>
                      Stok tersedia di gudang:{' '}
                      <b className="font-mono">
                        {answers.physicalMaterial.stok_fisik.toLocaleString('id-ID', {
                          maximumFractionDigits: 3
                        })}{' '}
                        {activeUom}
                      </b>{' '}
                      · Sisa setelah keluar:{' '}
                      <b className="font-mono">
                        {Math.max(
                          0,
                          answers.physicalMaterial.stok_fisik - Number(answers.qty || 0)
                        ).toLocaleString('id-ID', { maximumFractionDigits: 3 })}{' '}
                        {activeUom}
                      </b>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              KARTU 3 MASUK (TOSKA): ORIGIN
          ================================================================ */}
          {currentStepId === 'ORIGIN' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Dari mana asal barang ini?
                </h2>
                {answers.itemSource === 'BOQ' && answers.physicalMaterial && (
                  <p className="mt-1.5 text-sm text-teal-800 dark:text-teal-200 font-semibold">
                    {(() => {
                      const meta = getProviderMetaForMaterial(answers.physicalMaterial);
                      return answers.asalBarang === meta.defaultAsal
                        ? `✓ Otomatis sesuai kontrak BOQ (${meta.label}). Ubah hanya jika kondisi lapangan berbeda.`
                        : `ℹ️ Berbeda dari penyedia standar BOQ (${meta.label}) — dicatat sesuai kenyataan lapangan.`;
                    })()}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                {[
                  { id: 'KONTRAKTOR' as const, icon: '🏢', title: 'Kontraktor', sub: 'CV Menara Megah' },
                  { id: 'KLIEN' as const, icon: '👤', title: 'Klien', sub: 'PT IMK' },
                  { id: 'TOKO_BEBAS' as const, icon: '🏪', title: 'Lainnya', sub: 'Toko / Pihak Ketiga' }
                ].map((opt) => {
                  const selected = answers.asalBarang === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAnswers({ ...answers, asalBarang: opt.id })}
                      className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                        selected
                          ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/60 ring-2 ring-teal-500/30'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="text-2xl">{opt.icon}</div>
                      <div className="mt-2 text-base font-bold text-slate-900 dark:text-white">
                        {opt.title}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                        {opt.sub}
                      </div>
                    </button>
                  );
                })}
              </div>

              {answers.asalBarang === 'TOKO_BEBAS' && (
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-200 mb-2">
                    Nama toko / sumber barang (opsional)
                  </label>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Contoh: TB Makmur, Toko Berkah..."
                    value={answers.tokoBebasName}
                    onChange={(e) => setAnswers({ ...answers, tokoBebasName: e.target.value })}
                    className="w-full px-4 py-3.5 bg-slate-50 dark:bg-slate-800 border-2 border-teal-300 dark:border-teal-700 text-slate-900 dark:text-white rounded-2xl text-base font-medium focus:outline-hidden"
                  />
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              KARTU 4 MASUK KUSTOM (EMAS): CUSTOM_IN_PURPOSE
          ================================================================ */}
          {currentStepId === 'CUSTOM_IN_PURPOSE' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Rencana barang ini untuk keperluan apa?
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Untuk barang kustom, rencana saat masuk dicatat terpisah dari pemakaian aktual saat keluar.
                </p>
              </div>

              <input
                type="text"
                autoFocus
                placeholder="Contoh: Stok logistik dapur camp, cadangan bedeng, kebutuhan darurat..."
                value={answers.customInPurpose}
                onChange={(e) => {
                  setAnswers({ ...answers, customInPurpose: e.target.value });
                  setStepError(null);
                }}
                className="w-full px-4 py-4 bg-slate-50 dark:bg-slate-800 border-2 border-amber-300 dark:border-amber-700 focus:border-amber-500 text-slate-900 dark:text-white rounded-2xl text-base font-semibold focus:outline-hidden"
              />

              {answers.customLastPurposeIn && (
                <button
                  type="button"
                  onClick={() =>
                    setAnswers({ ...answers, customInPurpose: answers.customLastPurposeIn })
                  }
                  className="text-sm font-semibold text-amber-800 dark:text-amber-300 hover:underline cursor-pointer"
                >
                  Pakai rencana sebelumnya: "{answers.customLastPurposeIn}"
                </button>
              )}
            </div>
          )}

          {/* ================================================================
              KARTU 3 KELUAR (ORANYE): EXIT_CATEGORY
          ================================================================ */}
          {currentStepId === 'EXIT_CATEGORY' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Dipakai untuk keperluan apa?
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Pilih salah satu — sistem otomatis mengarahkan beban biaya dan pencatatannya.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {[
                  {
                    id: 'PROYEK_BOQ' as const,
                    icon: '🏗️',
                    title: 'Pekerjaan Proyek (BOQ)',
                    sub: 'Pemakaian langsung di pos pekerjaan'
                  },
                  {
                    id: 'OPERASIONAL' as const,
                    icon: '🧑‍🍳',
                    title: 'Operasional Lapangan',
                    sub: 'Konsumsi, genset, kebutuhan camp'
                  },
                  {
                    id: 'PERMINTAAN_KLIEN' as const,
                    icon: '💰',
                    title: 'Permintaan Klien',
                    sub: 'Pekerjaan tambah (kena invoice)'
                  },
                  {
                    id: 'BONUS_KLIEN' as const,
                    icon: '🎁',
                    title: 'Bonus Klien',
                    sub: 'Gratis (beban CV Menara Megah)'
                  }
                ].map((opt) => {
                  const selected = answers.tujuanPengeluaran === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAnswers({ ...answers, tujuanPengeluaran: opt.id })}
                      className={`p-5 rounded-2xl border-2 text-left transition-all cursor-pointer ${
                        selected
                          ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/60 ring-2 ring-orange-500/30'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="text-2xl">{opt.icon}</div>
                      <div className="mt-2 text-base font-bold text-slate-900 dark:text-white">
                        {opt.title}
                      </div>
                      <div className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                        {opt.sub}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================================================================
              KARTU 4a KELUAR BOQ (NILA): EXIT_BOQ_POS
          ================================================================ */}
          {currentStepId === 'EXIT_BOQ_POS' && answers.physicalMaterial && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Untuk Pos Pekerjaan yang mana?
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Prinsip <b>Bedakan Keluar</b>: pilih pos pekerjaan BOQ tempat {activeName} ini dipakai.
                </p>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
                {answers.physicalMaterial.budget_lines.map((line) => {
                  const selected = answers.selectedBudgetLineId === line.id;
                  return (
                    <button
                      key={line.id}
                      type="button"
                      onClick={() => {
                        setAnswers({ ...answers, selectedBudgetLineId: line.id });
                        setStepError(null);
                      }}
                      className={`w-full text-left p-4 rounded-2xl border-2 transition-all flex items-center justify-between gap-3 cursor-pointer ${
                        selected
                          ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 ring-1 ring-indigo-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm font-extrabold text-indigo-700 dark:text-indigo-300">
                          {line.kode_boq}
                        </div>
                        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                          {line.kategori}
                        </div>
                      </div>
                      <div className="text-right shrink-0 font-mono text-xs">
                        <div className="font-bold text-slate-900 dark:text-white">
                          Sisa: {line.sisa_anggaran.toLocaleString('id-ID', { maximumFractionDigits: 3 })}{' '}
                          {activeUom}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300">
                          Target: {line.qty_boq.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ================================================================
              KARTU 4b KELUAR KETERANGAN (BIRU LANGIT): EXIT_NOTE
          ================================================================ */}
          {currentStepId === 'EXIT_NOTE' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Bisa jelaskan singkat pemakaiannya?
                </h2>
                {answers.customLastPurposeIn ? (
                  <p className="mt-1.5 text-sm text-sky-800 dark:text-sky-200 font-semibold">
                    ℹ️ Rencana saat masuk: "{answers.customLastPurposeIn}" — pemakaian aktual saat keluar boleh berbeda.
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                    Tuliskan 1 kalimat singkat agar jejak audit lapangan jelas dan mudah dibaca pimpinan.
                  </p>
                )}
              </div>

              <input
                type="text"
                autoFocus
                placeholder={
                  answers.tujuanPengeluaran === 'OPERASIONAL'
                    ? 'Contoh: Konsumsi dapur tukang minggu ke-3, BBM genset...'
                    : answers.tujuanPengeluaran === 'PERMINTAAN_KLIEN'
                    ? 'Contoh: Tambahan stop kontak ruang kantor atas permintaan klien...'
                    : answers.tujuanPengeluaran === 'BONUS_KLIEN'
                    ? 'Contoh: Bonus perkuatan bekisting kolom struktur...'
                    : 'Contoh: Dipakai darurat untuk perancah / penutup area cor...'
                }
                value={answers.exitNote}
                onChange={(e) => {
                  setAnswers({ ...answers, exitNote: e.target.value });
                  setStepError(null);
                }}
                className="w-full px-4 py-4 bg-slate-50 dark:bg-slate-800 border-2 border-sky-300 dark:border-sky-700 focus:border-sky-500 text-slate-900 dark:text-white rounded-2xl text-base font-semibold focus:outline-hidden"
              />
            </div>
          )}

          {/* ================================================================
              KARTU KONFIRMASI (HIJAU / MERAH PEKAT): SUMMARY
          ================================================================ */}
          {currentStepId === 'SUMMARY' && (
            <div className="space-y-5">
              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Sudah sesuai? Siap disimpan
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Ringkasan hasil olahan sistem sebelum dicatat ke jurnal proyek.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 p-5 space-y-3 text-sm">
                <div className="flex items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-700 flex-wrap">
                  <span className="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white">
                    {processed.summary.itemName}
                  </span>
                  <span className={`px-3 py-1 rounded-full text-xs font-bold ${theme.badgeClass}`}>
                    {processed.summary.ruleBadge}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-3 gap-x-6">
                  <div>
                    <div className="text-[11px] uppercase font-bold text-slate-600 dark:text-slate-300">
                      Jumlah {answers.mutationType === 'MASUK' ? 'Masuk' : 'Keluar'}
                    </div>
                    <div
                      className={`font-mono text-lg font-extrabold ${
                        answers.mutationType === 'MASUK'
                          ? 'text-emerald-700 dark:text-emerald-300'
                          : 'text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      {answers.mutationType === 'MASUK' ? '+' : '-'}
                      {answers.qty.toLocaleString('id-ID', { maximumFractionDigits: 3 })}{' '}
                      {processed.summary.uom}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase font-bold text-slate-600 dark:text-slate-300">
                      Tanggal
                    </div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {processed.summary.dateLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase font-bold text-slate-600 dark:text-slate-300">
                      {processed.summary.detailLabel}
                    </div>
                    <div className="font-bold text-slate-900 dark:text-white">
                      {processed.summary.detailValue}
                    </div>
                  </div>
                  {processed.summary.extraLabel && (
                    <div>
                      <div className="text-[11px] uppercase font-bold text-slate-600 dark:text-slate-300">
                        {processed.summary.extraLabel}
                      </div>
                      <div className="font-bold text-slate-900 dark:text-white">
                        {processed.summary.extraValue}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                    {answers.mutationType === 'MASUK' ? 'Diterima oleh (PIC)' : 'Diserahkan oleh (PIC)'}
                  </label>
                  <input
                    type="text"
                    value={answers.pic}
                    onChange={(e) => setAnswers({ ...answers, pic: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl text-sm font-medium"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-200 mb-1.5">
                    No. Surat Jalan / Nota (opsional)
                  </label>
                  <input
                    type="text"
                    placeholder="SJ-001 / BON-12"
                    value={answers.suratJalan}
                    onChange={(e) => setAnswers({ ...answers, suratJalan: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-900 dark:text-white rounded-xl font-mono text-sm"
                  />
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              KARTU LANJUTAN (CYAN): DONE_NEXT ("Masih ingin mencatat lagi?")
          ================================================================ */}
          {currentStepId === 'DONE_NEXT' && (
            <div className="space-y-6 py-2">
              <div className="flex items-start gap-4 p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800">
                <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                    Data berhasil tercatat di jurnal proyek:
                  </div>
                  <div className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white mt-0.5">
                    {lastSavedText}
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-1">
                    Tanggal aktif: <b>{formatIndonesianDate(answers.mutationDate)}</b> · PIC: <b>{answers.pic || defaultPicName}</b>
                  </div>
                </div>
              </div>

              <div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight leading-snug">
                  Masih ingin menambahkan catatan item lagi?
                </h2>
                <p className="mt-1.5 text-sm text-slate-600 dark:text-slate-300 font-medium">
                  Tanggal dan nama PIC akan dipertahankan agar Anda lebih cepat mencatat beberapa item sekaligus.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <button
                  type="button"
                  autoFocus
                  onClick={() => handleStartAnotherItem(answers.mutationType)}
                  className={`flex items-center justify-center gap-2.5 px-5 py-4 rounded-2xl text-sm sm:text-base font-extrabold text-white shadow-md transition-colors cursor-pointer ${
                    answers.mutationType === 'MASUK'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  <PlusCircle className="w-5 h-5" />
                  <span>
                    {answers.mutationType === 'MASUK'
                      ? 'Ya, Catat Barang Masuk Lagi'
                      : 'Ya, Catat Barang Keluar Lagi'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() =>
                    handleStartAnotherItem(answers.mutationType === 'MASUK' ? 'KELUAR' : 'MASUK')
                  }
                  className="flex items-center justify-center gap-2.5 px-5 py-4 rounded-2xl text-sm sm:text-base font-bold border-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  <Repeat className="w-5 h-5" />
                  <span>
                    {answers.mutationType === 'MASUK'
                      ? 'Pindah ke Catat Barang Keluar'
                      : 'Pindah ke Catat Barang Masuk'}
                  </span>
                </button>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-6 py-3 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                  Selesai & Tutup
                </button>
              </div>
            </div>
          )}

          {/* NAVIGASI BAWAH KONSISTEN (Disembunyikan pada kartu DONE_NEXT) */}
          {!isDoneNext && (
            <div className="flex items-center justify-between gap-3 pt-5 border-t border-slate-200 dark:border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-5 py-3 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              >
                Batal
              </button>

              <div className="flex items-center gap-2.5">
                {safeStepIndex > 0 && (
                  <button
                    type="button"
                    onClick={handleBack}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 px-5 py-3 text-sm font-bold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Kembali</span>
                  </button>
                )}

                {currentStepId === 'SUMMARY' ? (
                  <button
                    type="submit"
                    disabled={submitting}
                    className={`inline-flex items-center gap-2 px-6 py-3 text-sm font-extrabold text-white rounded-xl shadow-md transition-colors disabled:opacity-40 cursor-pointer ${theme.primaryBtn}`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    <span>
                      {submitting
                        ? 'Menyimpan...'
                        : answers.mutationType === 'MASUK'
                        ? 'Simpan Barang Masuk'
                        : 'Simpan Barang Keluar'}
                    </span>
                  </button>
                ) : (
                  currentStepId !== 'PICK_ITEM' && (
                    <button
                      type="button"
                      onClick={handleNext}
                      className={`inline-flex items-center gap-2 px-6 py-3 text-sm font-extrabold text-white rounded-xl shadow-md transition-colors cursor-pointer ${theme.primaryBtn}`}
                    >
                      <span>Selanjutnya</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  )
                )}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
};
