import React, { useMemo, useState } from 'react';
import {
  X,
  Store,
  Package,
  ClipboardCheck,
  CheckCircle2,
  Plus,
  Trash2,
  ArrowLeft,
  ArrowRight,
  FileText,
  TrendingDown,
  TrendingUp,
  Sparkles,
  AlertCircle,
} from 'lucide-react';
import {
  ItemBarang,
  PoPaymentTerms,
  PurchaseOrder,
  SupplierStore,
} from '../types';
import { CreatePurchaseOrderInput, useApp } from '../context/AppContext';
import {
  computeDueDateFromTerms,
  PO_PAYMENT_TERMS_LABELS,
  ProcurementNeedItem,
} from '../lib/procurementEngine';
import { formatRupiah, generatePurchaseOrderPDF } from '../lib/pdfGenerator';
import { getTodayLocalDate } from '../lib/stockMutationEngine';

type WizardStep = 'STORE_TERMS' | 'ITEMS_PRICE' | 'REVIEW' | 'DONE_NEXT';

interface DraftLineItem {
  key: string;
  boq_item_id: string | null;
  nama_barang: string;
  satuan: string;
  qty_pesan: number;
  harga_satuan_po: number;
  harga_pagu_boq: number;
  catatan: string;
}

interface PurchaseOrderWizardModalProps {
  onClose: () => void;
  prefillNeeds?: ProcurementNeedItem[];
  prefillStore?: SupplierStore | null;
  replacePo?: PurchaseOrder | null;
  availableNeeds: ProcurementNeedItem[];
  allStockItems: ItemBarang[];
}

function buildInitialLines(
  prefillNeeds?: ProcurementNeedItem[],
  replacePo?: PurchaseOrder | null
): DraftLineItem[] {
  if (replacePo && replacePo.items && replacePo.items.length > 0) {
    return replacePo.items.map((it, idx) => ({
      key: `rev-${idx}-${it.id}`,
      boq_item_id: it.boq_item_id || null,
      nama_barang: it.nama_barang,
      satuan: it.satuan || 'Unit',
      qty_pesan: Number(it.qty_pesan) || 1,
      harga_satuan_po: Number(it.harga_satuan_po) || 0,
      harga_pagu_boq: Number(it.harga_pagu_boq) || 0,
      catatan: it.catatan || '',
    }));
  }
  if (prefillNeeds && prefillNeeds.length > 0) {
    return prefillNeeds.map((n, idx) => ({
      key: `need-${idx}-${n.boqItemId}`,
      boq_item_id: n.boqItemId,
      nama_barang: n.namaBarang,
      satuan: n.satuan || 'Unit',
      qty_pesan: n.sisaPerluDipesan > 0 ? n.sisaPerluDipesan : 1,
      harga_satuan_po: n.hargaPaguBoq,
      harga_pagu_boq: n.hargaPaguBoq,
      catatan: '',
    }));
  }
  return [];
}

export const PurchaseOrderWizardModal: React.FC<PurchaseOrderWizardModalProps> = ({
  onClose,
  prefillNeeds,
  prefillStore,
  replacePo,
  availableNeeds,
  allStockItems,
}) => {
  const {
    supplierStores,
    createPurchaseOrder,
    gantiPurchaseOrder,
    saveProjectStore,
    user,
    tenantBranding,
  } = useApp();

  const todayYmd = getTodayLocalDate();
  const isReplaceMode = Boolean(replacePo);

  const [step, setStep] = useState<WizardStep>('STORE_TERMS');
  const [selectedStoreId, setSelectedStoreId] = useState<string>(
    replacePo?.store_id || prefillStore?.id || ''
  );
  const [namaToko, setNamaToko] = useState<string>(
    replacePo?.nama_toko || prefillStore?.nama_toko || ''
  );
  const [tokoKontak, setTokoKontak] = useState<string>(
    replacePo?.toko_kontak || prefillStore?.telepon || ''
  );
  const [showQuickAddStore, setShowQuickAddStore] = useState<boolean>(false);
  const [newStorePic, setNewStorePic] = useState<string>('');
  const [newStoreAddress, setNewStoreAddress] = useState<string>('');

  const [paymentTerms, setPaymentTerms] = useState<PoPaymentTerms>(
    replacePo?.payment_terms || prefillStore?.syarat_bayar_default || 'TUNAI_SAAT_TIBA'
  );
  const [dpAmountRp, setDpAmountRp] = useState<number>(replacePo?.dp_amount_rp || 0);
  const [tanggalPo, setTanggalPo] = useState<string>(
    replacePo?.tanggal_po ? replacePo.tanggal_po.slice(0, 10) : todayYmd
  );
  const [estimasiTiba, setEstimasiTiba] = useState<string>(
    replacePo?.estimasi_tiba || todayYmd
  );
  const [jatuhTempoManual, setJatuhTempoManual] = useState<string>(
    replacePo?.jatuh_tempo_bayar || ''
  );
  const [catatanToko, setCatatanToko] = useState<string>(replacePo?.catatan_toko || '');
  const [replaceReason, setReplaceReason] = useState<string>('');

  const [lines, setLines] = useState<DraftLineItem[]>(() =>
    buildInitialLines(prefillNeeds, replacePo)
  );
  const [pickerBoqId, setPickerBoqId] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [createdPo, setCreatedPo] = useState<PurchaseOrder | null>(null);
  const [printingPdf, setPrintingPdf] = useState<boolean>(false);

  const computedDueDate = useMemo(() => {
    if (jatuhTempoManual) return jatuhTempoManual;
    return computeDueDateFromTerms(tanggalPo, paymentTerms) || '';
  }, [jatuhTempoManual, tanggalPo, paymentTerms]);

  const totals = useMemo(() => {
    let totalPoRp = 0;
    let totalPaguBoqRp = 0;
    for (const l of lines) {
      const q = Math.max(0, Number(l.qty_pesan) || 0);
      totalPoRp += q * Math.max(0, Number(l.harga_satuan_po) || 0);
      totalPaguBoqRp += q * Math.max(0, Number(l.harga_pagu_boq) || 0);
    }
    const selisihBoqRp = totalPaguBoqRp > 0 ? Math.round(totalPaguBoqRp - totalPoRp) : 0;
    return {
      totalPoRp: Math.round(totalPoRp),
      totalPaguBoqRp: Math.round(totalPaguBoqRp),
      selisihBoqRp,
    };
  }, [lines]);

  const handleSelectStore = (storeId: string) => {
    setSelectedStoreId(storeId);
    const found = supplierStores.find((s) => s.id === storeId);
    if (found) {
      setNamaToko(found.nama_toko);
      setTokoKontak(found.telepon || '');
      if (found.syarat_bayar_default) {
        setPaymentTerms(found.syarat_bayar_default);
        setJatuhTempoManual('');
      }
      setShowQuickAddStore(false);
    }
  };

  const handleQuickSaveStore = async () => {
    if (!namaToko.trim()) {
      setErrorMsg('Isi nama toko terlebih dahulu untuk menyimpannya ke direktori rekanan.');
      return;
    }
    setErrorMsg('');
    const res = await saveProjectStore({
      nama_toko: namaToko.trim(),
      telepon: tokoKontak.trim(),
      pic_toko: newStorePic.trim(),
      alamat: newStoreAddress.trim(),
      syarat_bayar_default: paymentTerms,
    });
    if (!res.success) {
      setErrorMsg(res.message);
      return;
    }
    if (res.store?.id) {
      setSelectedStoreId(res.store.id);
    }
    setShowQuickAddStore(false);
  };

  const handleAddFromBoqPicker = () => {
    if (!pickerBoqId) return;
    const need = availableNeeds.find((n) => n.boqItemId === pickerBoqId);
    if (need) {
      setLines((prev) => [
        ...prev,
        {
          key: `pick-${Date.now()}-${need.boqItemId}`,
          boq_item_id: need.boqItemId,
          nama_barang: need.namaBarang,
          satuan: need.satuan || 'Unit',
          qty_pesan: need.sisaPerluDipesan > 0 ? need.sisaPerluDipesan : 1,
          harga_satuan_po: need.hargaPaguBoq,
          harga_pagu_boq: need.hargaPaguBoq,
          catatan: '',
        },
      ]);
      setPickerBoqId('');
      return;
    }
    const item = allStockItems.find((it) => it.id === pickerBoqId);
    if (item) {
      setLines((prev) => [
        ...prev,
        {
          key: `item-${Date.now()}-${item.id}`,
          boq_item_id: item.id,
          nama_barang: item.nama_barang,
          satuan: item.satuan || 'Unit',
          qty_pesan: Math.max(1, item.qty_pemenuhan_sisa || 1),
          harga_satuan_po: Number(item.harga_satuan) || 0,
          harga_pagu_boq: Number(item.harga_satuan) || 0,
          catatan: '',
        },
      ]);
      setPickerBoqId('');
    }
  };

  const handleAddCustomLine = () => {
    setLines((prev) => [
      ...prev,
      {
        key: `custom-${Date.now()}`,
        boq_item_id: null,
        nama_barang: '',
        satuan: 'Unit',
        qty_pesan: 1,
        harga_satuan_po: 0,
        harga_pagu_boq: 0,
        catatan: '',
      },
    ]);
  };

  const updateLine = (key: string, patch: Partial<DraftLineItem>) => {
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  };

  const removeLine = (key: string) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  const validateStep1 = (): string | null => {
    if (!namaToko.trim()) return 'Nama toko rekanan wajib diisi atau dipilih.';
    if (!tanggalPo) return 'Tanggal Surat Pesanan wajib diisi.';
    if (paymentTerms === 'DP_PELUNASAN' && dpAmountRp < 0) {
      return 'Nominal Uang Muka (DP) tidak boleh negatif.';
    }
    return null;
  };

  const validateStep2 = (): string | null => {
    if (lines.length === 0) return 'Tambahkan minimal 1 material yang akan dipesan.';
    for (const l of lines) {
      if (!l.nama_barang.trim()) return 'Nama material pada semua baris wajib diisi.';
      if (!(Number(l.qty_pesan) > 0)) return `Kuantitas "${l.nama_barang}" harus lebih dari 0.`;
      if (Number(l.harga_satuan_po) < 0) return `Harga satuan PO "${l.nama_barang}" tidak boleh negatif.`;
    }
    return null;
  };

  const handleNext = () => {
    setErrorMsg('');
    if (step === 'STORE_TERMS') {
      const err = validateStep1();
      if (err) {
        setErrorMsg(err);
        return;
      }
      setStep('ITEMS_PRICE');
      return;
    }
    if (step === 'ITEMS_PRICE') {
      const err = validateStep2();
      if (err) {
        setErrorMsg(err);
        return;
      }
      setStep('REVIEW');
    }
  };

  const handleSubmit = async () => {
    setErrorMsg('');
    const err1 = validateStep1();
    if (err1) {
      setErrorMsg(err1);
      setStep('STORE_TERMS');
      return;
    }
    const err2 = validateStep2();
    if (err2) {
      setErrorMsg(err2);
      setStep('ITEMS_PRICE');
      return;
    }
    if (isReplaceMode && replaceReason.trim().length < 5) {
      setErrorMsg('Alasan penggantian/revisi PO wajib diisi minimal 5 karakter.');
      return;
    }

    const payload: CreatePurchaseOrderInput = {
      store_id: selectedStoreId || null,
      nama_toko: namaToko.trim(),
      toko_kontak: tokoKontak.trim() || undefined,
      tanggal_po: `${tanggalPo}T09:00:00`,
      estimasi_tiba: estimasiTiba || null,
      payment_terms: paymentTerms,
      jatuh_tempo_bayar: computedDueDate || null,
      dp_amount_rp: paymentTerms === 'DP_PELUNASAN' ? dpAmountRp : 0,
      catatan_toko: catatanToko.trim() || undefined,
      items: lines.map((l) => ({
        boq_item_id: l.boq_item_id,
        nama_barang: l.nama_barang.trim(),
        satuan: l.satuan.trim() || 'Unit',
        qty_pesan: Number(l.qty_pesan),
        harga_satuan_po: Number(l.harga_satuan_po) || 0,
        harga_pagu_boq: Number(l.harga_pagu_boq) || 0,
        catatan: l.catatan.trim() || undefined,
      })),
    };

    setSubmitting(true);
    try {
      if (isReplaceMode && replacePo) {
        const res = await gantiPurchaseOrder(replacePo.id, payload, replaceReason.trim());
        if (!res.success) {
          setErrorMsg(res.message);
          return;
        }
        onClose();
        return;
      }

      const res = await createPurchaseOrder(payload);
      if (!res.success) {
        setErrorMsg(res.message);
        return;
      }
      setCreatedPo(res.po || null);
      setStep('DONE_NEXT');
    } finally {
      setSubmitting(false);
    }
  };

  const handlePrintCreatedPdf = async () => {
    if (!createdPo) return;
    setPrintingPdf(true);
    try {
      const matchedStore = supplierStores.find((s) => s.id === createdPo.store_id);
      await generatePurchaseOrderPDF({
        po: createdPo,
        signer: user,
        projectName: tenantBranding.projectName,
        branding: tenantBranding,
        storeAddress: matchedStore?.alamat,
        storePic: matchedStore?.pic_toko,
      });
    } finally {
      setPrintingPdf(false);
    }
  };

  const handleResetForAnother = () => {
    setCreatedPo(null);
    setLines([]);
    setCatatanToko('');
    setDpAmountRp(0);
    setErrorMsg('');
    setStep('STORE_TERMS');
  };

  const stepMeta: Array<{ id: WizardStep; label: string; icon: React.ReactNode }> = [
    { id: 'STORE_TERMS', label: '1. Toko & Syarat', icon: <Store className="w-3.5 h-3.5" /> },
    { id: 'ITEMS_PRICE', label: '2. Material & Harga', icon: <Package className="w-3.5 h-3.5" /> },
    { id: 'REVIEW', label: '3. Konfirmasi', icon: <ClipboardCheck className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
      <div className="w-full max-w-4xl max-h-[92vh] flex flex-col rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50/80 dark:bg-slate-900/90">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 dark:text-white truncate">
              {isReplaceMode
                ? `Revisi & Ganti Surat Pesanan (${replacePo?.po_no})`
                : 'Buat Surat Pesanan Material (PO Toko)'}
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Harga grosir toko dikunci otomatis ke penerimaan gudang & tautan pembayaran kas.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Tutup"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Stepper */}
        {step !== 'DONE_NEXT' && (
          <div className="px-5 py-3 border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900 flex items-center gap-2 overflow-x-auto">
            {stepMeta.map((s, idx) => {
              const currentIdx = stepMeta.findIndex((x) => x.id === step);
              const isActive = s.id === step;
              const isDone = idx < currentIdx;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    if (idx < currentIdx) {
                      setErrorMsg('');
                      setStep(s.id);
                    }
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-sm'
                      : isDone
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {isDone ? <CheckCircle2 className="w-3.5 h-3.5" /> : s.icon}
                  <span>{s.label}</span>
                </button>
              );
            })}
            <div className="ml-auto hidden sm:flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span>{lines.length} item</span>
              <span>·</span>
              <span className="font-bold text-slate-900 dark:text-white">
                {formatRupiah(totals.totalPoRp)}
              </span>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* LANGKAH 1: TOKO & SYARAT PEMBAYARAN */}
          {step === 'STORE_TERMS' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Pilih Toko Rekanan
                    </label>
                    <button
                      type="button"
                      onClick={() => setShowQuickAddStore((v) => !v)}
                      className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {showQuickAddStore ? 'Tutup Form Toko Baru' : '+ Tambah Toko Baru'}
                    </button>
                  </div>
                  <select
                    value={selectedStoreId}
                    onChange={(e) => handleSelectStore(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    <option value="">-- Ketik Nama Toko Manual / Pilih dari Direktori --</option>
                    {supplierStores.map((st) => (
                      <option key={st.id} value={st.id}>
                        {st.nama_toko}
                        {st.telepon ? ` (${st.telepon})` : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nama Toko / Suplier <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={namaToko}
                    onChange={(e) => setNamaToko(e.target.value)}
                    placeholder="Contoh: TB Sinar Bangunan Jaya"
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Kontak / WhatsApp Toko
                  </label>
                  <input
                    type="text"
                    value={tokoKontak}
                    onChange={(e) => setTokoKontak(e.target.value)}
                    placeholder="Contoh: 0812-3456-7890"
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Syarat Pembayaran
                  </label>
                  <select
                    value={paymentTerms}
                    onChange={(e) => {
                      setPaymentTerms(e.target.value as PoPaymentTerms);
                      setJatuhTempoManual('');
                    }}
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500 outline-none"
                  >
                    {(Object.keys(PO_PAYMENT_TERMS_LABELS) as PoPaymentTerms[]).map((k) => (
                      <option key={k} value={k}>
                        {PO_PAYMENT_TERMS_LABELS[k]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {showQuickAddStore && (
                <div className="p-3.5 rounded-xl bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/60 space-y-3">
                  <div className="text-xs font-semibold text-blue-800 dark:text-blue-300">
                    Simpan ke Direktori Toko Rekanan Proyek
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <input
                      type="text"
                      value={newStorePic}
                      onChange={(e) => setNewStorePic(e.target.value)}
                      placeholder="Nama PIC / Pemilik Toko (opsional)"
                      className="px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={newStoreAddress}
                      onChange={(e) => setNewStoreAddress(e.target.value)}
                      placeholder="Alamat Toko (opsional)"
                      className="px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleQuickSaveStore}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors"
                  >
                    Simpan Toko Rekanan Sekarang
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tanggal Surat Pesanan
                  </label>
                  <input
                    type="date"
                    value={tanggalPo}
                    onChange={(e) => setTanggalPo(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Estimasi Barang Tiba
                  </label>
                  <input
                    type="date"
                    value={estimasiTiba}
                    onChange={(e) => setEstimasiTiba(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                  />
                </div>
                {paymentTerms === 'DP_PELUNASAN' ? (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Nominal Uang Muka / DP (Rp)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={dpAmountRp || ''}
                      onChange={(e) => setDpAmountRp(Math.max(0, Number(e.target.value) || 0))}
                      placeholder="Contoh: 1500000"
                      className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Jatuh Tempo Pembayaran
                    </label>
                    <input
                      type="date"
                      value={computedDueDate}
                      onChange={(e) => setJatuhTempoManual(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Catatan Kirim ke Toko (Tercetak di PDF PO)
                </label>
                <textarea
                  rows={2}
                  value={catatanToko}
                  onChange={(e) => setCatatanToko(e.target.value)}
                  placeholder="Contoh: Kirim ke gerbang proyek pukul 08.00–15.00 WITA, sertakan nota cap toko."
                  className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                />
              </div>
            </div>
          )}

          {/* LANGKAH 2: DAFTAR MATERIAL & HARGA TERKUNCI */}
          {step === 'ITEMS_PRICE' && (
            <div className="space-y-4">
              {/* Bar Tambah Item */}
              <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center p-3 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700">
                <select
                  value={pickerBoqId}
                  onChange={(e) => setPickerBoqId(e.target.value)}
                  className="flex-1 px-3 py-2 rounded-lg text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                >
                  <option value="">-- Tambah Material dari Kebutuhan BOQ --</option>
                  {availableNeeds.map((n) => (
                    <option key={n.boqItemId} value={n.boqItemId}>
                      [{n.kodeBoq}] {n.namaBarang} · Perlu: {n.sisaPerluDipesan} {n.satuan} (Pagu{' '}
                      {formatRupiah(n.hargaPaguBoq)})
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={handleAddFromBoqPicker}
                  disabled={!pickerBoqId}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Tambah dari BOQ
                </button>
                <button
                  type="button"
                  onClick={handleAddCustomLine}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Item Khusus
                </button>
              </div>

              {/* Daftar Baris Item */}
              {lines.length === 0 ? (
                <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-slate-500 dark:text-slate-400 text-sm">
                  Belum ada material dalam daftar PO ini. Pilih material BOQ di atas atau klik <strong>Item Khusus</strong>.
                </div>
              ) : (
                <div className="space-y-3">
                  {lines.map((line, index) => {
                    const lineSub = Math.round(
                      Math.max(0, Number(line.qty_pesan) || 0) *
                        Math.max(0, Number(line.harga_satuan_po) || 0)
                    );
                    const lineBoq = Math.round(
                      Math.max(0, Number(line.qty_pesan) || 0) *
                        Math.max(0, Number(line.harga_pagu_boq) || 0)
                    );
                    const diff = lineBoq > 0 ? lineBoq - lineSub : 0;

                    return (
                      <div
                        key={line.key}
                        className="p-3.5 rounded-xl bg-white dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2.5"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2.5">
                            <div className="sm:col-span-5">
                              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                {index + 1}. Nama Material
                              </label>
                              <input
                                type="text"
                                value={line.nama_barang}
                                onChange={(e) => updateLine(line.key, { nama_barang: e.target.value })}
                                placeholder="Nama material..."
                                className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                Qty Pesan
                              </label>
                              <input
                                type="number"
                                step="any"
                                min={0.01}
                                value={line.qty_pesan}
                                onChange={(e) =>
                                  updateLine(line.key, { qty_pesan: Number(e.target.value) || 0 })
                                }
                                className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-2">
                              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                Satuan
                              </label>
                              <input
                                type="text"
                                value={line.satuan}
                                onChange={(e) => updateLine(line.key, { satuan: e.target.value })}
                                className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg text-xs bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                                Harga Satuan PO (Rp)
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={line.harga_satuan_po}
                                onChange={(e) =>
                                  updateLine(line.key, {
                                    harga_satuan_po: Math.max(0, Number(e.target.value) || 0),
                                  })
                                }
                                className="w-full mt-0.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white"
                              />
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeLine(line.key)}
                            className="p-1.5 mt-4 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
                            title="Hapus baris"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-700/70 text-[11px]">
                          <div className="flex items-center gap-2 flex-wrap">
                            {line.harga_pagu_boq > 0 && (
                              <span className="text-slate-500 dark:text-slate-400">
                                Pagu BOQ: <strong>{formatRupiah(line.harga_pagu_boq)}</strong>/{line.satuan}
                              </span>
                            )}
                            {lineBoq > 0 && diff !== 0 && (
                              <span
                                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${
                                  diff > 0
                                    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                }`}
                              >
                                {diff > 0 ? (
                                  <>
                                    <TrendingDown className="w-3 h-3" /> Hemat {formatRupiah(diff)}
                                  </>
                                ) : (
                                  <>
                                    <TrendingUp className="w-3 h-3" /> Lebih {formatRupiah(Math.abs(diff))}
                                  </>
                                )}
                              </span>
                            )}
                          </div>
                          <div className="font-bold text-slate-900 dark:text-white">
                            Subtotal: {formatRupiah(lineSub)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Ringkasan Komparasi Total */}
              <div className="p-3.5 rounded-xl bg-slate-900 dark:bg-slate-950 text-white flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] text-slate-300">Total Nilai Surat Pesanan (PO)</div>
                  <div className="text-lg font-bold">{formatRupiah(totals.totalPoRp)}</div>
                </div>
                {totals.totalPaguBoqRp > 0 && (
                  <div className="text-right">
                    <div className="text-[11px] text-slate-300">
                      Pagu BOQ Acuan: {formatRupiah(totals.totalPaguBoqRp)}
                    </div>
                    <div
                      className={`text-xs font-bold ${
                        totals.selisihBoqRp >= 0 ? 'text-emerald-400' : 'text-amber-400'
                      }`}
                    >
                      {totals.selisihBoqRp >= 0
                        ? `Hemat ${formatRupiah(totals.selisihBoqRp)} di bawah pagu BOQ`
                        : `Lebih ${formatRupiah(Math.abs(totals.selisihBoqRp))} dari pagu BOQ`}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* LANGKAH 3: KONFIRMASI */}
          {step === 'REVIEW' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 p-4 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
                <div className="space-y-1">
                  <div className="text-slate-500 dark:text-slate-400">Toko Rekanan</div>
                  <div className="font-bold text-sm text-slate-900 dark:text-white">{namaToko}</div>
                  {tokoKontak && (
                    <div className="text-slate-600 dark:text-slate-300">Kontak: {tokoKontak}</div>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-slate-500 dark:text-slate-400">Syarat Pembayaran & Jadwal</div>
                  <div className="font-semibold text-slate-900 dark:text-white">
                    {PO_PAYMENT_TERMS_LABELS[paymentTerms]}
                  </div>
                  <div className="text-slate-600 dark:text-slate-300">
                    Tanggal PO: {tanggalPo} · Estimasi Tiba: {estimasiTiba || '-'}
                    {computedDueDate ? ` · Jatuh Tempo: ${computedDueDate}` : ''}
                  </div>
                  {paymentTerms === 'DP_PELUNASAN' && dpAmountRp > 0 && (
                    <div className="font-semibold text-amber-700 dark:text-amber-300">
                      Uang Muka (DP): {formatRupiah(dpAmountRp)}
                    </div>
                  )}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="px-3 py-2 font-semibold">Material</th>
                      <th className="px-3 py-2 font-semibold text-right">Qty</th>
                      <th className="px-3 py-2 font-semibold text-right">Harga PO</th>
                      <th className="px-3 py-2 font-semibold text-right">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700/80">
                    {lines.map((l) => (
                      <tr key={l.key}>
                        <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">
                          {l.nama_barang}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                          {l.qty_pesan} {l.satuan}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700 dark:text-slate-300">
                          {formatRupiah(l.harga_satuan_po)}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">
                          {formatRupiah(Math.round(l.qty_pesan * l.harga_satuan_po))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-slate-50 dark:bg-slate-800/80 font-bold">
                    <tr>
                      <td colSpan={3} className="px-3 py-2.5 text-right text-slate-700 dark:text-slate-200">
                        Total Nilai Surat Pesanan
                      </td>
                      <td className="px-3 py-2.5 text-right text-sm text-blue-700 dark:text-blue-400">
                        {formatRupiah(totals.totalPoRp)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {isReplaceMode && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                    Alasan Revisi / Penggantian PO <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={replaceReason}
                    onChange={(e) => setReplaceReason(e.target.value)}
                    placeholder="Contoh: Perubahan negosiasi harga grosir toko & penyesuaian kuantitas"
                    className="w-full px-3 py-2.5 rounded-xl text-sm bg-amber-50/50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 text-slate-900 dark:text-white"
                  />
                </div>
              )}
            </div>
          )}

          {/* LAYAR SELESAI & LANJUT */}
          {step === 'DONE_NEXT' && createdPo && (
            <div className="py-6 text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Sparkles className="w-7 h-7" />
              </div>
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                  Surat Pesanan {createdPo.po_no} Berhasil Diterbitkan!
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
                  PO ke <strong>{createdPo.nama_toko}</strong> senilai{' '}
                  <strong>{formatRupiah(createdPo.total_amount_rp)}</strong> telah masuk antrean
                  pengesahan berantai (Foreman → Spv. → Dept. Mgr / KTT / Direktur).
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={handlePrintCreatedPdf}
                  disabled={printingPdf}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  {printingPdf ? 'Menyiapkan PDF...' : 'Cetak PDF PO'}
                </button>
                <button
                  type="button"
                  onClick={handleResetForAnother}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Buat PO Lagi
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors"
                >
                  Selesai & Tutup
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigasi */}
        {step !== 'DONE_NEXT' && (
          <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900 flex items-center justify-between gap-3">
            <div>
              {step !== 'STORE_TERMS' ? (
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg('');
                    setStep(step === 'REVIEW' ? 'ITEMS_PRICE' : 'STORE_TERMS');
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  Kembali
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Batal
                </button>
              )}
            </div>

            <div>
              {step !== 'REVIEW' ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
                >
                  Lanjut
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white shadow-sm transition-colors"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  {submitting
                    ? 'Menyimpan...'
                    : isReplaceMode
                      ? 'Terbitkan PO Revisi Pengganti'
                      : 'Terbitkan Surat Pesanan (PO)'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
