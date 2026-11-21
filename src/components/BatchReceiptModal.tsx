import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  Camera,
  Upload,
  Receipt,
  Building2,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Plus,
  Trash2,
  Layers,
  Sparkles,
  HelpCircle,
  FileText
} from 'lucide-react';
import { MutasiBarang, SupplierStore, UserProfile } from '../types';
import { uploadReceiptFile, fetchSupplierStores, saveSupplierStore } from '../lib/receiptStorage';
import { getSupabaseClient } from '../lib/supabase';

interface EditableItemRow {
  mutationId: string;
  originalName: string;
  actualName: string;
  qty: number;
  uom: string;
  unitPrice: number;
}

interface BatchReceiptModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetMutations: MutasiBarang[];
  availablePendingMutations?: MutasiBarang[];
  currentUser: UserProfile;
  projectId?: string;
  onSuccess: (updatedCount: number, receiptNo: string) => Promise<void> | void;
}

export const BatchReceiptModal: React.FC<BatchReceiptModalProps> = ({
  isOpen,
  onClose,
  targetMutations,
  availablePendingMutations = [],
  currentUser,
  projectId,
  onSuccess
}) => {
  // State Data Nota Header
  const [storeName, setStoreName] = useState<string>('');
  const [storeContact, setStoreContact] = useState<string>('');
  const [receiptNo, setReceiptNo] = useState<string>('');
  const [receiptDate, setReceiptDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [physicalTotal, setPhysicalTotal] = useState<string>('');

  // Daftar Toko Langganan untuk Autocomplete
  const [knownStores, setKnownStores] = useState<SupplierStore[]>([]);

  // State Berkas Foto Nota (Multi-Upload)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [filePreviews, setFilePreviews] = useState<string[]>([]);

  // State Daftar Item yang Terpilih untuk Nota Ini
  const [includedMutationIds, setIncludedMutationIds] = useState<string[]>([]);
  const [itemRows, setItemRows] = useState<EditableItemRow[]>([]);

  // State Pemuatan & Error
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitProgress, setSubmitProgress] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Inisialisasi data saat modal dibuka
  useEffect(() => {
    if (isOpen && targetMutations.length > 0) {
      // Ambil data default dari mutasi pertama
      const first = targetMutations[0];
      setStoreName(first.nama_toko || first.source_name || '');
      setStoreContact(first.toko_kontak || '');
      setReceiptNo(first.nomor_nota || first.nomor_surat_jalan || '');
      setReceiptDate(first.tanggal_nota ? first.tanggal_nota.slice(0, 10) : new Date().toISOString().slice(0, 10));

      const initialIds = targetMutations.map((m) => m.id);
      setIncludedMutationIds(initialIds);

      const rows: EditableItemRow[] = targetMutations.map((m) => ({
        mutationId: m.id,
        originalName: m.nama_barang,
        actualName: m.nama_item_aktual || m.nama_barang,
        qty: m.jumlah,
        uom: m.satuan,
        unitPrice: m.harga_satuan_beli || 0
      }));
      setItemRows(rows);

      // Hitung default physical total jika ada harga
      const initialTotal = rows.reduce((sum, r) => sum + r.qty * r.unitPrice, 0);
      if (initialTotal > 0) {
        setPhysicalTotal(String(initialTotal));
      } else {
        setPhysicalTotal('');
      }

      // Load toko langganan
      fetchSupplierStores(projectId).then(setKnownStores);

      // Bersihkan berkas
      setSelectedFiles([]);
      setFilePreviews([]);
      setErrorMessage('');
      setSubmitProgress('');
    }
  }, [isOpen, targetMutations, projectId]);

  // Handle Pilih / Jepret Berkas Foto Nota
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const newFiles = Array.from(e.target.files);
      const combined = [...selectedFiles, ...newFiles].slice(0, 5); // Maksimal 5 lembar
      setSelectedFiles(combined);

      // Buat preview thumbnail
      const previews = combined.map((file) => URL.createObjectURL(file));
      setFilePreviews(previews);
    }
  };

  const handleRemoveFile = (index: number) => {
    const updatedFiles = selectedFiles.filter((_, idx) => idx !== index);
    setSelectedFiles(updatedFiles);
    const updatedPreviews = filePreviews.filter((_, idx) => idx !== index);
    setFilePreviews(updatedPreviews);
  };

  // Toggle Tambah/Hapus Item Mutasi Lain ke Nota Ini
  const handleToggleIncludeItem = (mutation: MutasiBarang) => {
    if (includedMutationIds.includes(mutation.id)) {
      if (includedMutationIds.length <= 1) return; // Minimal 1 item harus terpilih
      setIncludedMutationIds((prev) => prev.filter((id) => id !== mutation.id));
      setItemRows((prev) => prev.filter((r) => r.mutationId !== mutation.id));
    } else {
      setIncludedMutationIds((prev) => [...prev, mutation.id]);
      setItemRows((prev) => [
        ...prev,
        {
          mutationId: mutation.id,
          originalName: mutation.nama_barang,
          actualName: mutation.nama_item_aktual || mutation.nama_barang,
          qty: mutation.jumlah,
          uom: mutation.satuan,
          unitPrice: mutation.harga_satuan_beli || 0
        }
      ]);
    }
  };

  // Update Nilai per Baris
  const handleUpdateRowPrice = (mutationId: string, val: number) => {
    setItemRows((prev) =>
      prev.map((row) => (row.mutationId === mutationId ? { ...row, unitPrice: val } : row))
    );
  };

  const handleUpdateRowQty = (mutationId: string, val: number) => {
    setItemRows((prev) =>
      prev.map((row) => (row.mutationId === mutationId ? { ...row, qty: val } : row))
    );
  };

  const handleUpdateRowActualName = (mutationId: string, val: string) => {
    setItemRows((prev) =>
      prev.map((row) => (row.mutationId === mutationId ? { ...row, actualName: val } : row))
    );
  };

  // Kalkulasi Otomatis
  const calculatedAccumulatedTotal = useMemo(() => {
    return itemRows.reduce((sum, r) => sum + r.qty * r.unitPrice, 0);
  }, [itemRows]);

  const parsedPhysicalTotal = parseFloat(physicalTotal.replace(/\D/g, '')) || 0;
  const discrepancy = calculatedAccumulatedTotal - parsedPhysicalTotal;
  const isMatch = parsedPhysicalTotal > 0 && Math.abs(discrepancy) < 1;

  // Rekomendasi item lain yang belum punya nota pada tanggal/pos yang sama
  const additionalCandidates = useMemo(() => {
    return availablePendingMutations.filter(
      (m) =>
        !includedMutationIds.includes(m.id) &&
        !m.is_batal &&
        !m.is_ganti &&
        m.jenis === 'MASUK'
    );
  }, [availablePendingMutations, includedMutationIds]);

  // Submit Penyelarasan Nota (Metode DIGANTI)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const cleanReceiptNo = receiptNo.trim();
    const cleanStoreName = storeName.trim();

    if (!cleanReceiptNo) {
      setErrorMessage('Nomor Nota / Bon Toko wajib diisi.');
      return;
    }
    if (!cleanStoreName) {
      setErrorMessage('Nama Toko / Suplier wajib diisi.');
      return;
    }
    if (itemRows.length === 0) {
      setErrorMessage('Minimal satu item mutasi harus dicakup.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setSubmitProgress('Mengunggah & mengompresi bukti foto nota...');

    try {
      // 1. Unggah berkas foto nota jika ada
      const uploadedUrls: string[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        setSubmitProgress(`Mengunggah lembar foto nota (${i + 1} dari ${selectedFiles.length})...`);
        const url = await uploadReceiptFile(selectedFiles[i], projectId, cleanReceiptNo);
        if (url) uploadedUrls.push(url);
      }

      // Pertahankan url lama jika tidak ada file baru yang diunggah
      const finalAttachmentUrls =
        uploadedUrls.length > 0
          ? uploadedUrls
          : targetMutations[0]?.lampiran_nota_urls || [];

      setSubmitProgress('Menerapkan penggantian baris mutasi ke sistem audit...');

      const nowIso = new Date().toISOString();
      const allSourceMutations = [...targetMutations, ...availablePendingMutations];
      const client = getSupabaseClient();

      // 2. Proses tiap item: Nonaktifkan Baris Lama (is_ganti = true) dan Terbitkan Baris Baru
      for (const row of itemRows) {
        const oldMutation = allSourceMutations.find((m) => m.id === row.mutationId);
        if (!oldMutation) continue;

        // A. Generate UUID untuk Baris Baru
        const newRowId = crypto.randomUUID();

        // B. Tandai Baris Lama sebagai DIGANTI
        if (client) {
          await client
            .from('inventory_transactions')
            .update({
              is_ganti: true,
              status_dokumen: 'DIGANTI',
              referensi_ganti_id: newRowId,
              alasan_batal_ganti: `Penyelarasan nota resmi ${cleanStoreName} No. ${cleanReceiptNo}`
            })
            .eq('id', oldMutation.id);

          // C. Insert Baris Baru yang Sah
          await client.from('inventory_transactions').insert({
            id: newRowId,
            project_id: projectId || oldMutation.barang_id, // Gunakan project ID jika ada
            item_id: oldMutation.barang_id,
            transaction_type: 'MASUK',
            quantity: row.qty,
            uom: row.uom,
            occurred_at: oldMutation.tanggal || nowIso,
            reference_no: cleanReceiptNo,
            source_name: cleanStoreName,
            counterparty: cleanStoreName,
            nama_toko: cleanStoreName,
            toko_kontak: storeContact.trim() || null,
            tanggal_nota: receiptDate ? new Date(receiptDate).toISOString() : nowIso,
            total_nota_fisik: parsedPhysicalTotal > 0 ? parsedPhysicalTotal : calculatedAccumulatedTotal,
            lampiran_nota_urls: finalAttachmentUrls,
            harga_satuan_beli: row.unitPrice,
            status_harga: row.unitPrice > 0 ? 'TERCATAT' : 'NOTA_MENYUSUL',
            nama_item_aktual: row.actualName,
            nama_barang: oldMutation.nama_barang,
            purpose: oldMutation.tujuan_keperluan || oldMutation.purpose,
            owner_type: oldMutation.owner_type || 'KONTRAKTOR',
            beban_biaya: oldMutation.beban_biaya || 'PROYEK_BOQ',
            created_by_name: currentUser.name || 'Clerk',
            status_dokumen: 'DITERBITKAN',
            is_batal: false,
            is_ganti: false,
            referensi_ganti_id: oldMutation.id
          });
        }
      }

      // 3. Simpan nama toko ke daftar cepat
      await saveSupplierStore({
        nama_toko: cleanStoreName,
        telepon: storeContact.trim() || undefined,
        project_id: projectId
      });

      setSubmitProgress('Selesai!');
      await onSuccess(itemRows.length, cleanReceiptNo);
      onClose();
    } catch (err: any) {
      console.error('Gagal menerapkan nota resmi:', err);
      setErrorMessage(err?.message || 'Terjadi kesalahan sistem saat menyimpan nota.');
    } finally {
      setIsSubmitting(false);
      setSubmitProgress('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span>Penyelarasan Nota Resmi Toko</span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200">
                  {itemRows.length} Item Mutasi
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Menerapkan nomor nota, harga riil, dan foto fisik nota toko melalui metode penggantian (*DIGANTI*) tanpa hapus data.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Isi Nota */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* BAGIAN 1: IDENTITAS TOKO & LEMBAR NOTA FISIK */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 p-4 space-y-3.5">
            <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 inline-flex items-center justify-center text-[10px] font-black">
                1
              </span>
              <span>Data Toko / Suplier & Lembar Nota:</span>
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Nama Toko */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nama Toko / Suplier *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    list="store-suggestions"
                    value={storeName}
                    onChange={(e) => setStoreName(e.target.value)}
                    placeholder="Contoh: TB. Maju Jaya / CV Baja Perkasa"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <datalist id="store-suggestions">
                    {knownStores.map((s) => (
                      <option key={s.id} value={s.nama_toko} />
                    ))}
                  </datalist>
                </div>
              </div>

              {/* Nomor Kontak Toko */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Kontak / Telepon (Opsional)
                </label>
                <input
                  type="text"
                  value={storeContact}
                  onChange={(e) => setStoreContact(e.target.value)}
                  placeholder="0812-xxxx-xxxx"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              {/* Tanggal Nota */}
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Tanggal Tercetak di Nota *
                </label>
                <input
                  type="date"
                  required
                  value={receiptDate}
                  onChange={(e) => setReceiptDate(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                />
              </div>

              {/* Nomor Bon / Nota Toko */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Nomor Seri Nota / Faktur Toko *
                </label>
                <input
                  type="text"
                  required
                  value={receiptNo}
                  onChange={(e) => setReceiptNo(e.target.value)}
                  placeholder="Contoh: MJ-7712 / INV/2026/11/04"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>

              {/* Total Tertera di Bon Fisik (Untuk Rekonsiliasi) */}
              <div className="space-y-1 sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                  <span>Grand Total di Bawah Nota Fisik (Rp)</span>
                  <span className="text-[10px] text-blue-600 dark:text-blue-400 font-normal">
                    Pencocokan Otomatis
                  </span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2 text-xs text-slate-400 font-bold">Rp</span>
                  <input
                    type="text"
                    value={physicalTotal}
                    onChange={(e) => {
                      const numOnly = e.target.value.replace(/\D/g, '');
                      setPhysicalTotal(numOnly ? Number(numOnly).toLocaleString('id-ID') : '');
                    }}
                    placeholder="0"
                    className="w-full pl-9 pr-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* UNGGAH BUKTI FOTO / PDF NOTA (MULTI-LEMBAR) */}
            <div className="border-t border-slate-200 dark:border-slate-700/60 pt-3">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5 flex items-center justify-between">
                <span>Foto Lembar Nota / Scan PDF (Hingga 5 Lembar):</span>
                <span className="text-[10px] text-slate-400">
                  Dikompresi otomatis agar hemat kuota lapangan
                </span>
              </label>

              <div className="flex flex-wrap items-center gap-2.5">
                {/* Tombol Input File / Kamera */}
                <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border-2 border-dashed border-blue-400/80 hover:border-blue-500 bg-blue-50/40 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 text-xs font-bold cursor-pointer transition-all">
                  <Camera className="w-4 h-4" />
                  <span>Ambil Foto / Pilih Berkas</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    multiple
                    capture="environment"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </label>

                {/* Thumbnail Pratinjau Foto / Dokumen PDF Terpilih */}
                {filePreviews.map((previewUrl, idx) => {
                  const file = selectedFiles[idx];
                  const isPdf = file?.type === 'application/pdf' || file?.name?.toLowerCase().endsWith('.pdf');

                  return (
                    <div key={idx} className="relative group w-14 h-14 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                      {isPdf ? (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 p-1">
                          <FileText className="w-5 h-5 mb-0.5" />
                          <span className="text-[8px] font-bold uppercase tracking-tight">PDF</span>
                        </div>
                      ) : (
                        <img
                          src={previewUrl}
                          alt={`Lembar ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(idx)}
                        className="absolute inset-0 bg-rose-950/80 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity cursor-pointer"
                        title="Hapus berkas ini"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                      <span className="absolute bottom-0 right-0 px-1 text-[8px] bg-slate-900/80 text-white font-bold rounded-tl">
                        #{idx + 1}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* BAGIAN 2: RINCIAN ITEM MATERIAL YANG TERCAKUP */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 p-4 space-y-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <span className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 inline-flex items-center justify-center text-[10px] font-black">
                  2
                </span>
                <span>Rincian Item Material ({itemRows.length} Pos Terpilih):</span>
              </span>
            </div>

            {/* Tabel Pengisian Item */}
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700/80 bg-white dark:bg-slate-900">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-bold">
                    <th className="py-2.5 px-3 text-left">Nama Material & Item Aktual Toko</th>
                    <th className="py-2.5 px-3 text-center w-28">Volume (QTY)</th>
                    <th className="py-2.5 px-3 text-right w-36">Harga Satuan (Rp) *</th>
                    <th className="py-2.5 px-3 text-right w-36">Subtotal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {itemRows.map((row) => (
                    <tr key={row.mutationId} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="p-3">
                        <div className="font-bold text-slate-900 dark:text-white">
                          {row.originalName}
                        </div>
                        <div className="mt-1 flex items-center gap-1.5">
                          <span className="text-[10px] text-slate-400 shrink-0">Nama Aktual Toko:</span>
                          <input
                            type="text"
                            value={row.actualName}
                            onChange={(e) => handleUpdateRowActualName(row.mutationId, e.target.value)}
                            placeholder="Contoh: Steel Hollow 75x75x2.3"
                            className="px-2 py-0.5 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white flex-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                      </td>

                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            min="0.001"
                            step="any"
                            value={row.qty}
                            onChange={(e) => handleUpdateRowQty(row.mutationId, parseFloat(e.target.value) || 0)}
                            className="w-16 px-1.5 py-1 text-xs text-center font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                          />
                          <span className="text-[11px] text-slate-400 font-semibold">{row.uom}</span>
                        </div>
                      </td>

                      <td className="p-3 text-right">
                        <input
                          type="text"
                          value={row.unitPrice ? row.unitPrice.toLocaleString('id-ID') : ''}
                          onChange={(e) => {
                            const raw = parseFloat(e.target.value.replace(/\D/g, '')) || 0;
                            handleUpdateRowPrice(row.mutationId, raw);
                          }}
                          placeholder="0"
                          className="w-full px-2 py-1 text-xs text-right font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </td>

                      <td className="p-3 text-right font-extrabold text-slate-900 dark:text-white">
                        Rp {(row.qty * row.unitPrice).toLocaleString('id-ID')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* PILIHAN KAITKAN ITEM LAIN KE NOTA INI (OPSIONAL JIKA ADA ITEM PENDING LAIN) */}
            {additionalCandidates.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700/60">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  <span>Kaitkan Item Lain yang Berada di Lembar Nota yang Sama:</span>
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {additionalCandidates.slice(0, 6).map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => handleToggleIncludeItem(c)}
                      className="px-2.5 py-1 text-[11px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Plus className="w-3 h-3 text-emerald-600" />
                      <span className="truncate max-w-[180px]">{c.nama_barang} ({c.jumlah} {c.satuan})</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* BAGIAN 3: KALKULATOR REKONSILIASI LIVE */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">Total Akumulasi {itemRows.length} Item:</div>
              <div className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400">
                Rp {calculatedAccumulatedTotal.toLocaleString('id-ID')}
              </div>
            </div>

            {parsedPhysicalTotal > 0 && (
              <div
                className={`p-2.5 rounded-xl border text-xs font-bold flex items-center gap-2 ${
                  isMatch
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                }`}
              >
                {isMatch ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>✓ Klop 100% Sesuai Total Bon Toko</span>
                  </>
                ) : (
                  <>
                    <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>
                      Selisih Rp {Math.abs(discrepancy).toLocaleString('id-ID')} ({discrepancy > 0 ? 'Item Melebihi Bon' : 'Item Kurang dari Bon'})
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {submitProgress && (
            <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-900 text-xs text-blue-800 dark:text-blue-200 font-semibold flex items-center gap-2">
              <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin shrink-0" />
              <span>{submitProgress}</span>
            </div>
          )}
        </form>

        {/* Footer Tombol Aksi */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
            Baris lama otomatis dinonaktifkan (*DIGANTI*) dan baris baru tercatat sah.
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
            >
              Batal
            </button>

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting || itemRows.length === 0}
              className="px-5 py-2 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white shadow-xs transition-colors flex items-center gap-2 cursor-pointer"
            >
              <Receipt className="w-4 h-4" />
              <span>{isSubmitting ? 'Menyimpan...' : `Simpan & Terapkan Nota (${itemRows.length} Item)`}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
