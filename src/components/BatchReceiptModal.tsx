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
  FileText,
  Images,
  ArrowRight,
  ArrowLeft,
  Search,
  Link2,
  Eye,
  Paperclip,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RefreshCw,
  ExternalLink
} from 'lucide-react';
import { MutasiBarang, SupplierStore, UserProfile, ProjectReceiptAlbumItem } from '../types';
import { uploadReceiptFile, fetchSupplierStores, saveSupplierStore, buildProjectReceiptAlbum } from '../lib/receiptStorage';
import { getSupabaseClient } from '../lib/supabase';
import { formatDateTime } from '../lib/pdfGenerator';

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
  allStockMutations?: MutasiBarang[];
  currentUser: UserProfile;
  projectId?: string;
  onSuccess: (updatedCount: number, receiptNo: string) => Promise<void> | void;
}

type ReceiptFlowStep = 'QUESTION' | 'ALBUM_PICK' | 'FORM_NEW' | 'FORM_LINKED';

export const BatchReceiptModal: React.FC<BatchReceiptModalProps> = ({
  isOpen,
  onClose,
  targetMutations,
  availablePendingMutations = [],
  allStockMutations = [],
  currentUser,
  projectId,
  onSuccess
}) => {
  // State Langkah Alur (Pertanyaan -> Pilih Album / Form Baru)
  const [flowStep, setFlowStep] = useState<ReceiptFlowStep>('QUESTION');
  const [selectedAlbumReceipt, setSelectedAlbumReceipt] = useState<ProjectReceiptAlbumItem | null>(null);
  const [albumSearchQuery, setAlbumSearchQuery] = useState<string>('');

  // State Pratinjau Pembesaran Nota & Konfirmasi Penautan
  const [inspectingReceipt, setInspectingReceipt] = useState<ProjectReceiptAlbumItem | null>(null);
  const [inspectingFileIndex, setInspectingFileIndex] = useState<number>(0);
  const [inspectingImgZoom, setInspectingImgZoom] = useState<number>(1);
  const [inspectingImgRotate, setInspectingImgRotate] = useState<number>(0);
  const [isConfirmingLink, setIsConfirmingLink] = useState<boolean>(false);

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

  // Bangun Album Nota Proyek dari seluruh mutasi yang ada
  const albumItems = useMemo(() => {
    const pool = allStockMutations && allStockMutations.length > 0
      ? allStockMutations
      : [...targetMutations, ...availablePendingMutations];
    return buildProjectReceiptAlbum(pool);
  }, [allStockMutations, targetMutations, availablePendingMutations]);

  // Filter Album Nota berdasarkan pencarian
  const filteredAlbumItems = useMemo(() => {
    const q = albumSearchQuery.toLowerCase().trim();
    if (!q) return albumItems;
    return albumItems.filter(
      (item) =>
        item.storeName.toLowerCase().includes(q) ||
        item.receiptNo.toLowerCase().includes(q) ||
        (item.receiptDate && item.receiptDate.toLowerCase().includes(q)) ||
        item.sampleItemNames.some((n) => n.toLowerCase().includes(q))
    );
  }, [albumItems, albumSearchQuery]);

  // Inisialisasi data saat modal dibuka
  useEffect(() => {
    if (isOpen && targetMutations.length > 0) {
      // Jika ada nota yang sudah tersimpan di album proyek, mulai dari kartu pertanyaan
      if (albumItems.length > 0) {
        setFlowStep('QUESTION');
      } else {
        // Jika belum ada nota apapun di album proyek, langsung ke form unggah baru
        setFlowStep('FORM_NEW');
      }
      setSelectedAlbumReceipt(null);
      setAlbumSearchQuery('');

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
  }, [isOpen, targetMutations, projectId, albumItems.length]);

  // Buka Pratinjau Membesar Nota dari Album ("Klik langsung membesar")
  const handleOpenInspectReceipt = (nota: ProjectReceiptAlbumItem) => {
    setInspectingReceipt(nota);
    setInspectingFileIndex(0);
    setInspectingImgZoom(1);
    setInspectingImgRotate(0);
    setIsConfirmingLink(false);
  };

  // Konfirmasi & Tautkan Nota ke Form ("Keluar konfirmasi terlebih dahulu")
  const handleConfirmLinkReceipt = (nota: ProjectReceiptAlbumItem) => {
    setSelectedAlbumReceipt(nota);
    setStoreName(nota.storeName);
    setStoreContact(nota.storeContact || '');
    setReceiptNo(nota.receiptNo && nota.receiptNo !== 'Tanpa No. Seri' ? nota.receiptNo : '');
    setReceiptDate(nota.receiptDate ? nota.receiptDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setPhysicalTotal(nota.totalPhysicalAmount > 0 ? Number(nota.totalPhysicalAmount).toLocaleString('id-ID') : '');
    setSelectedFiles([]); // Nol upload baru
    setFilePreviews([]);
    setErrorMessage('');
    setIsConfirmingLink(false);
    setInspectingReceipt(null);
    setFlowStep('FORM_LINKED');
  };

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

    const cleanStoreName = storeName.trim();
    const cleanReceiptNo = receiptNo.trim();

    if (!cleanStoreName) {
      setErrorMessage('Nama toko / suplier wajib diisi.');
      return;
    }
    if (!cleanReceiptNo) {
      setErrorMessage('Nomor nota / seri faktur toko wajib diisi.');
      return;
    }
    if (itemRows.length === 0) {
      setErrorMessage('Minimal 1 item barang harus disertakan dalam nota.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage('');
    setSubmitProgress('Menyiapkan berkas & data nota...');

    try {
      const allSourceMutations = [...targetMutations, ...availablePendingMutations];
      const client = getSupabaseClient();
      const isValidUuid = (val?: string) =>
        typeof val === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

      // Tentukan target Project ID yang valid
      const targetProjectId = isValidUuid(projectId)
        ? projectId
        : isValidUuid((targetMutations[0] as any)?.project_id)
        ? (targetMutations[0] as any).project_id
        : '2506245e-ff3f-4313-b821-920ab368a5df';

      // 1. Tentukan berkas lampiran (Jika memilih dari album dan tidak ada file baru, pakai file yang ada di album!)
      let finalAttachmentUrls: string[] = [];

      if (selectedFiles.length > 0) {
        setSubmitProgress('Mengunggah & mengompresi bukti foto nota baru...');
        const uploadedUrls: string[] = [];
        for (let i = 0; i < selectedFiles.length; i++) {
          setSubmitProgress(`Mengunggah lembar foto nota (${i + 1} dari ${selectedFiles.length})...`);
          const url = await uploadReceiptFile(selectedFiles[i], targetProjectId, cleanReceiptNo);
          if (url) uploadedUrls.push(url);
        }
        finalAttachmentUrls = uploadedUrls;
      } else if (flowStep === 'FORM_LINKED' && selectedAlbumReceipt) {
        // TAUTKAN BERKAS YANG SUDAH ADA DARI ALBUM (Nol upload ulang!)
        finalAttachmentUrls = selectedAlbumReceipt.attachmentUrls || [];
      } else {
        finalAttachmentUrls = targetMutations[0]?.lampiran_nota_urls || [];
      }

      setSubmitProgress('Menerapkan penggantian baris mutasi ke sistem audit...');

      const nowIso = new Date().toISOString();

      // 2. Proses tiap item: Terbitkan Baris Baru DULU, lalu Nonaktifkan Baris Lama (is_ganti = true)
      for (const row of itemRows) {
        const oldMutation = allSourceMutations.find((m) => m.id === row.mutationId);
        if (!oldMutation) continue;

        // A. Generate UUID untuk Baris Baru
        const newRowId = crypto.randomUUID();

        const targetWorkspaceId = isValidUuid((oldMutation as any)?.workspace_id)
          ? (oldMutation as any).workspace_id
          : '50e273d9-735a-4f75-8204-badab2929f3a';

        if (client) {
          // B. Insert Baris Baru yang Sah Terlebih Dahulu
          const { error: insertError } = await client.from('inventory_transactions').insert({
            id: newRowId,
            project_id: targetProjectId,
            workspace_id: targetWorkspaceId,
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

          if (insertError) {
            console.error('Gagal insert transaksi baru:', insertError);
            throw new Error(`Gagal menyimpan baris transaksi pengganti (${oldMutation.nama_barang}): ${insertError.message}`);
          }

          // C. Tandai Baris Lama sebagai DIGANTI HANYA SETELAH baris baru berhasil
          const { error: updateError } = await client
            .from('inventory_transactions')
            .update({
              is_ganti: true,
              status_dokumen: 'DIGANTI',
              referensi_ganti_id: newRowId,
              alasan_batal_ganti: `Penyelarasan nota resmi ${cleanStoreName} No. ${cleanReceiptNo}`
            })
            .eq('id', oldMutation.id);

          if (updateError) {
            console.error('Gagal update baris lama:', updateError);
          }
        }
      }

      // 3. Simpan nama toko ke daftar cepat
      await saveSupplierStore({
        nama_toko: cleanStoreName,
        telepon: storeContact.trim() || undefined,
        project_id: isValidUuid(projectId) ? projectId : '2506245e-ff3f-4313-b821-920ab368a5df'
      });

      // 4. Sukses
      await onSuccess(itemRows.length, cleanReceiptNo);
      onClose();
    } catch (err: any) {
      console.error('Gagal memproses nota:', err);
      setErrorMessage(err.message || 'Terjadi kesalahan saat menyelaraskan nota. Silakan coba kembali.');
    } finally {
      setIsSubmitting(false);
      setSubmitProgress('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Penyelarasan Nota Resmi Toko
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200">
                  {itemRows.length} Item Mutasi
                </span>
                {flowStep === 'QUESTION' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800">
                    Langkah 1: Asal Usul Nota
                  </span>
                )}
                {flowStep === 'ALBUM_PICK' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800">
                    Pilih dari Album Nota
                  </span>
                )}
                {flowStep === 'FORM_LINKED' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800">
                    Tertaut ke Album: {storeName || 'Nota'}
                  </span>
                )}
              </div>
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

        {/* =========================================================================
            TAHAP 1: KARTU PERTANYAAN (Apakah Nota Sudah Pernah Diunggah Sebelumnya?)
        ========================================================================= */}
        {flowStep === 'QUESTION' && (
          <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center space-y-6">
            <div className="w-16 h-16 rounded-3xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/80 dark:border-blue-800 flex items-center justify-center shadow-inner">
              <HelpCircle className="w-8 h-8" />
            </div>

            <div className="space-y-2 max-w-lg">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                Apakah berkas nota fisik ini sudah pernah diunggah sebelumnya?
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Pilih salah satu agar berkas tidak terunggah ganda, kuota database tetap hemat, dan seluruh item dapat saling terhubung ke nota yang sama.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-xl text-left">
              {/* Opsi 1: Ya, Sudah Pernah Diunggah (Pilih dari Album) */}
              <button
                type="button"
                onClick={() => setFlowStep('ALBUM_PICK')}
                className="p-4 rounded-2xl border-2 border-indigo-200 dark:border-indigo-800/80 bg-gradient-to-b from-indigo-50/70 to-indigo-50/30 dark:from-indigo-950/40 dark:to-indigo-950/10 hover:border-indigo-600 dark:hover:border-indigo-400 hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div className="space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
                    <Images className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span>Ya, Sudah Pernah Diunggah</span>
                    </h4>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 leading-snug">
                      Pilih dari <b>Album Nota</b> yang sudah ada. Nomor nota, nama toko, dan foto langsung tertaut tanpa upload ulang.
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-2.5 border-t border-indigo-100 dark:border-indigo-900/60 flex items-center justify-between text-xs font-bold text-indigo-600 dark:text-indigo-400">
                  <span>{albumItems.length} Nota di Album</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* Opsi 2: Belum, Unggah Berkas Nota Baru */}
              <button
                type="button"
                onClick={() => setFlowStep('FORM_NEW')}
                className="p-4 rounded-2xl border-2 border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 hover:border-blue-600 dark:hover:border-blue-400 hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between group"
              >
                <div className="space-y-2.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center group-hover:scale-110 transition-transform shadow-xs">
                    <Upload className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <span>Belum, Unggah Nota Baru</span>
                    </h4>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 leading-snug">
                      Unggah foto kamera atau scan PDF bon baru dari toko. Nota ini otomatis masuk ke Album Proyek untuk item berikutnya.
                    </p>
                  </div>
                </div>

                <div className="mt-4 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs font-bold text-blue-600 dark:text-blue-400">
                  <span>Unggah Berkas Baru</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAHAP 2: ALBUM NOTA PROYEK (Pilih Nota yang Akan Dilink-kan)
        ========================================================================= */}
        {flowStep === 'ALBUM_PICK' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Images className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <span>Album Berkas Nota Fisik Proyek</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Klik salah satu kartu nota di bawah untuk menghubungkan {itemRows.length} item mutasi ini tanpa upload ulang.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFlowStep('QUESTION')}
                  className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Kembali</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAlbumReceipt(null);
                    setFlowStep('FORM_NEW');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer flex items-center gap-1.5 shadow-2xs"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Unggah Nota Baru Saja</span>
                </button>
              </div>
            </div>

            {/* Kotak Pencarian Album */}
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={albumSearchQuery}
                onChange={(e) => setAlbumSearchQuery(e.target.value)}
                placeholder="Cari nomor nota (misal: 1-07), nama toko (misal: SIAGA MUDA), atau nama barang..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            {/* Grid Kartu Album Nota */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 max-h-[52vh] overflow-y-auto pr-1">
              {filteredAlbumItems.length === 0 ? (
                <div className="col-span-full py-12 text-center text-slate-400 text-xs">
                  Tidak ditemukan nota di album yang sesuai kata kunci pencarian.
                </div>
              ) : (
                filteredAlbumItems.map((nota) => {
                  const hasUrls = nota.attachmentUrls && nota.attachmentUrls.length > 0;
                  const firstUrl = hasUrls ? nota.attachmentUrls[0] : '';
                  const isPdf = firstUrl.toLowerCase().includes('.pdf') || firstUrl.startsWith('data:application/pdf');

                  return (
                    <div
                      key={nota.id}
                      onClick={() => handleOpenInspectReceipt(nota)}
                      className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-xl transition-all p-3.5 flex flex-col justify-between cursor-pointer space-y-3"
                      title="Klik untuk memperbesar & memeriksa berkas fisik nota sebelum menautkan"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 truncate block">
                              {nota.storeName}
                            </span>
                            <h4 className="text-xs font-black text-slate-900 dark:text-white truncate" title={nota.receiptNo}>
                              No. {nota.receiptNo}
                            </h4>
                          </div>
                          <span className="shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            {nota.linkedMutationsCount} Item
                          </span>
                        </div>

                        {/* Thumbnail File */}
                        <div className="h-28 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 overflow-hidden flex items-center justify-center relative">
                          {hasUrls ? (
                            isPdf ? (
                              <div className="flex flex-col items-center justify-center gap-1 text-rose-600 dark:text-rose-400 p-2">
                                <FileText className="w-8 h-8" />
                                <span className="text-[9px] font-black px-1.5 py-0.2 rounded bg-rose-100 dark:bg-rose-950/80 border border-rose-200 dark:border-rose-800">
                                  Dokumen PDF
                                </span>
                              </div>
                            ) : (
                              <img
                                src={firstUrl}
                                alt={nota.receiptNo}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                            )
                          ) : (
                            <div className="flex flex-col items-center justify-center gap-1 text-slate-400">
                              <Receipt className="w-8 h-8 stroke-[1.5]" />
                              <span className="text-[9px] font-medium">Bon Belum Berfoto</span>
                            </div>
                          )}

                          {nota.attachmentUrls.length > 1 && (
                            <span className="absolute bottom-1.5 right-1.5 text-[9px] font-black px-1.5 py-0.5 rounded-md bg-slate-950/80 text-white backdrop-blur-xs flex items-center gap-0.5">
                              <Paperclip className="w-2.5 h-2.5" />
                              <span>{nota.attachmentUrls.length} Lembar</span>
                            </span>
                          )}

                          <div className="absolute inset-0 bg-indigo-950/0 group-hover:bg-indigo-950/30 transition-colors flex items-center justify-center">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1 rounded-lg bg-slate-900/85 text-white text-[10px] font-bold backdrop-blur-xs flex items-center gap-1 shadow-md">
                              <Eye className="w-3 h-3" />
                              <span>Klik Memperbesar</span>
                            </span>
                          </div>
                        </div>

                        {/* Ringkasan Tanggal & Nominal */}
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center justify-between text-slate-500 font-mono">
                            <span className="text-[11px] flex items-center gap-1">
                              <Calendar className="w-3 h-3" />
                              <span>{nota.receiptDate ? formatDateTime(nota.receiptDate).split(',')[0] : '-'}</span>
                            </span>
                            <span className="font-extrabold text-slate-900 dark:text-white">
                              Rp {nota.totalPhysicalAmount.toLocaleString('id-ID')}
                            </span>
                          </div>
                          {nota.sampleItemNames.length > 0 && (
                            <div className="text-[10px] text-slate-500 truncate" title={nota.sampleItemNames.join(', ')}>
                              Item: {nota.sampleItemNames.slice(0, 3).join(', ')}
                            </div>
                          )}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleOpenInspectReceipt(nota);
                        }}
                        className="w-full py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 hover:bg-indigo-600 hover:text-white text-indigo-700 dark:text-indigo-300 font-bold text-xs transition-colors flex items-center justify-center gap-1.5 shadow-2xs cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Periksa & Tautkan Nota</span>
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* =========================================================================
            TAHAP 3: FORMULIR RINCIAN ITEM & VERIFIKASI HARGA (FORM_NEW / FORM_LINKED)
        ========================================================================= */}
        {(flowStep === 'FORM_NEW' || flowStep === 'FORM_LINKED') && (
          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {errorMessage && (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* BANNER STATUS KETERHUBUNGAN KE ALBUM */}
            {flowStep === 'FORM_LINKED' && selectedAlbumReceipt && (
              <div className="p-3.5 rounded-2xl bg-indigo-50/90 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 flex items-center justify-between gap-3 shadow-2xs">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0">
                    <Images className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5 flex-wrap">
                      <span>Tertaut ke Album: <b>{storeName}</b> (No. {receiptNo})</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-200 dark:bg-indigo-800 text-indigo-900 dark:text-indigo-100 font-extrabold">
                        {selectedAlbumReceipt.attachmentUrls.length > 0 ? `${selectedAlbumReceipt.attachmentUrls.length} Lembar Berkas` : 'Data Tersedia'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Berkas foto nota tidak diunggah ulang (bebas duplikasi & hemat kapasitas penyimpanan).
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setFlowStep('ALBUM_PICK')}
                  className="px-3 py-1 rounded-xl bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-700 text-xs font-bold text-indigo-600 dark:text-indigo-300 hover:bg-indigo-50 transition-colors cursor-pointer shrink-0"
                >
                  Ganti Nota
                </button>
              </div>
            )}

            {flowStep === 'FORM_NEW' && albumItems.length > 0 && (
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 dark:text-slate-300">
                  Ingin menghubungkan ke nota yang sudah ada?
                </span>
                <button
                  type="button"
                  onClick={() => setFlowStep('ALBUM_PICK')}
                  className="px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 font-bold hover:bg-indigo-100 transition-colors cursor-pointer flex items-center gap-1"
                >
                  <Images className="w-3.5 h-3.5" />
                  <span>Pilih dari Album ({albumItems.length})</span>
                </button>
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
                      placeholder="Contoh: CV. SIAGA MUDA / TB Sumber Rezeki"
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
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

                {/* Nomor Seri Nota Toko */}
                <div className="space-y-1 sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nomor Seri Nota / Faktur Toko *
                  </label>
                  <input
                    type="text"
                    required
                    value={receiptNo}
                    onChange={(e) => setReceiptNo(e.target.value)}
                    placeholder="Contoh: 1-07-11-2026 / INV-882"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono font-bold"
                  />
                </div>

                {/* Total Tertera di Bon Fisik */}
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

              {/* UNGGAH ATAU TAMPILAN BERKAS FOTO/PDF NOTA */}
              <div className="border-t border-slate-200 dark:border-slate-700/60 pt-3">
                {flowStep === 'FORM_LINKED' && selectedAlbumReceipt && selectedFiles.length === 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                        <span>Berkas Fisik Nota dari Album ({selectedAlbumReceipt.attachmentUrls.length} Lembar):</span>
                      </label>
                      <label className="text-[11px] font-bold text-blue-600 hover:underline cursor-pointer">
                        + Tambah Foto Lain
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          multiple
                          onChange={handleFileChange}
                          className="hidden"
                        />
                      </label>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      {selectedAlbumReceipt.attachmentUrls.length === 0 ? (
                        <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200">
                          Nota di album belum memiliki lampiran foto. Klik <b>"+ Tambah Foto Lain"</b> untuk melampirkan berkas fisik.
                        </div>
                      ) : (
                        selectedAlbumReceipt.attachmentUrls.map((url, idx) => {
                          const isPdf = url.toLowerCase().includes('.pdf');
                          return (
                            <div key={idx} className="relative group w-16 h-16 rounded-xl border border-indigo-200 dark:border-indigo-800 overflow-hidden bg-slate-100 dark:bg-slate-800 shrink-0">
                              {isPdf ? (
                                <div className="w-full h-full flex flex-col items-center justify-center bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 p-1">
                                  <FileText className="w-6 h-6 mb-0.5" />
                                  <span className="text-[8px] font-bold">PDF</span>
                                </div>
                              ) : (
                                <img src={url} alt={`Lembar ${idx + 1}`} className="w-full h-full object-cover" />
                              )}
                              <span className="absolute bottom-0 inset-x-0 bg-slate-900/75 text-white text-[8px] text-center font-bold">
                                #{idx + 1}
                              </span>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
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

                      {/* Thumbnail Pratinjau Foto Terpilih */}
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
                              className="absolute top-1 right-1 p-1 rounded-full bg-rose-600 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Hapus lembar ini"
                            >
                              <X className="w-3 h-3" />
                            </button>
                            <span className="absolute bottom-0 inset-x-0 bg-slate-900/60 text-white text-[8px] text-center font-bold">
                              #{idx + 1}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* BAGIAN 2: RINCIAN ITEM MATERIAL */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <span className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 inline-flex items-center justify-center text-[10px] font-black">
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
                            className="w-full px-2 py-1 text-xs text-right font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-blue-500 font-mono"
                          />
                        </td>

                        <td className="p-3 text-right font-extrabold text-slate-900 dark:text-white font-mono">
                          Rp {(row.qty * row.unitPrice).toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Rekomendasi item lain yang se-nota */}
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
                <div className="text-base sm:text-lg font-black text-blue-600 dark:text-blue-400 font-mono">
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
        )}

        {/* Footer Tombol Aksi */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex items-center justify-between gap-3">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
            {flowStep === 'FORM_LINKED'
              ? 'Tautan nota resmi album diterapkan ke transaksi tanpa menduplikasi berkas.'
              : 'Baris lama otomatis dinonaktifkan (*DIGANTI*) dan baris baru tercatat sah.'}
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

            {(flowStep === 'FORM_NEW' || flowStep === 'FORM_LINKED') && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting || itemRows.length === 0}
                className={`px-5 py-2 text-xs font-bold rounded-xl text-white shadow-xs transition-colors flex items-center gap-2 cursor-pointer ${
                  flowStep === 'FORM_LINKED'
                    ? 'bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50'
                    : 'bg-blue-600 hover:bg-blue-700 disabled:opacity-50'
                }`}
              >
                {flowStep === 'FORM_LINKED' ? <Link2 className="w-4 h-4" /> : <Receipt className="w-4 h-4" />}
                <span>
                  {isSubmitting
                    ? 'Menyimpan...'
                    : flowStep === 'FORM_LINKED'
                    ? `Simpan & Tautkan ke Nota Ini (${itemRows.length} Item)`
                    : `Simpan & Terapkan Nota (${itemRows.length} Item)`}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* MODAL PRATINJAU MEMBESAR NOTA (Zoomable Preview & Inspect) */}
      {inspectingReceipt && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            {/* Header Modal Inspeksi */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0 shadow-inner">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                      Inspeksi Berkas Nota: {inspectingReceipt.storeName}
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                      No. {inspectingReceipt.receiptNo}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Periksa kejelasan foto nota fisik sebelum memutuskan menghubungkan item mutasi ke nota ini.
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setInspectingReceipt(null);
                  setIsConfirmingLink(false);
                }}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Konten Utama: Preview Foto & Panel Informasi */}
            <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12 gap-0 divide-y lg:divide-y-0 lg:divide-x divide-slate-200 dark:divide-slate-800">
              {/* Kolom Kiri: Penampil Gambar / PDF dengan Kontrol Zoom */}
              <div className="lg:col-span-8 p-4 flex flex-col bg-slate-950/5 dark:bg-slate-950/60 min-h-[350px] lg:min-h-[500px]">
                {/* Toolbar Zoom & Rotasi */}
                <div className="flex items-center justify-between gap-2 pb-3 mb-2 border-b border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setInspectingImgZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                      title="Perbesar Tampilan (+)"
                    >
                      <ZoomIn className="w-3.5 h-3.5" />
                      <span>Perbesar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectingImgZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                      title="Perkecil Tampilan (-)"
                    >
                      <ZoomOut className="w-3.5 h-3.5" />
                      <span>Perkecil</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setInspectingImgRotate((r) => (r + 90) % 360)}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold hover:bg-slate-50 flex items-center gap-1 cursor-pointer"
                      title="Putar 90 Derajat"
                    >
                      <RotateCw className="w-3.5 h-3.5" />
                      <span>Putar</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setInspectingImgZoom(1);
                        setInspectingImgRotate(0);
                      }}
                      className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-xs cursor-pointer"
                      title="Reset Tampilan"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                    <span className="text-[11px] font-mono font-semibold text-slate-500 ml-1">
                      {Math.round(inspectingImgZoom * 100)}%
                    </span>
                  </div>

                  {inspectingReceipt.attachmentUrls.length > 0 && (
                    <a
                      href={inspectingReceipt.attachmentUrls[inspectingFileIndex] || inspectingReceipt.attachmentUrls[0]}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1"
                    >
                      <span>Buka Tab Baru</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>

                {/* Lembar Berkas Preview */}
                {(() => {
                  const urls = inspectingReceipt.attachmentUrls || [];
                  const hasFiles = urls.length > 0;
                  const activeUrl = hasFiles ? (urls[inspectingFileIndex] || urls[0]) : '';
                  const isPdf = activeUrl.toLowerCase().includes('.pdf') || activeUrl.startsWith('data:application/pdf');

                  return (
                    <div className="flex-1 flex flex-col justify-between">
                      <div className="flex-1 flex items-center justify-center p-3 rounded-xl bg-slate-900/90 dark:bg-black/80 overflow-auto max-h-[58vh]">
                        {hasFiles ? (
                          isPdf ? (
                            <div className="w-full h-[52vh] flex flex-col items-center justify-center gap-3 bg-white dark:bg-slate-850 rounded-lg p-4">
                              <FileText className="w-16 h-16 text-rose-500" />
                              <div className="text-center">
                                <div className="text-sm font-bold text-slate-800 dark:text-white">
                                  Berkas PDF Nota Resmi
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                  Dokumen lampiran tersimpan dalam format PDF.
                                </div>
                              </div>
                              <a
                                href={activeUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors inline-flex items-center gap-1.5 shadow-md"
                              >
                                <ExternalLink className="w-4 h-4" />
                                <span>Buka & Lihat Berkas PDF Lengkap</span>
                              </a>
                            </div>
                          ) : (
                            <div className="transition-transform duration-150 ease-out origin-center flex items-center justify-center">
                              <img
                                src={activeUrl}
                                alt={`Nota ${inspectingReceipt.receiptNo}`}
                                style={{
                                  transform: `scale(${inspectingImgZoom}) rotate(${inspectingImgRotate}deg)`,
                                  maxHeight: '52vh',
                                  maxWidth: '100%',
                                  objectFit: 'contain'
                                }}
                                className="rounded shadow-xl select-none"
                              />
                            </div>
                          )
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-2 p-6 text-slate-400 text-center">
                            <Receipt className="w-16 h-16 stroke-[1.2]" />
                            <div className="text-sm font-bold text-slate-300">
                              Berkas Nota Fisik Belum Diunggah
                            </div>
                            <p className="text-xs max-w-sm text-slate-400">
                              Nota ini memiliki rekaman data toko dan nomor faktur, namun belum memiliki pindaian foto berkas fisik.
                            </p>
                          </div>
                        )}
                      </div>

                      {/* Pagination Jika Multi Lembar */}
                      {urls.length > 1 && (
                        <div className="flex items-center justify-center gap-2 pt-3">
                          {urls.map((url, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => {
                                setInspectingFileIndex(idx);
                                setInspectingImgZoom(1);
                                setInspectingImgRotate(0);
                              }}
                              className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                inspectingFileIndex === idx
                                  ? 'bg-indigo-600 text-white shadow-xs'
                                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              Lembar #{idx + 1}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Kolom Kanan: Rincian Nota & Tombol Hubungkan */}
              <div className="lg:col-span-4 p-5 flex flex-col justify-between space-y-4 bg-white dark:bg-slate-900">
                <div className="space-y-4">
                  {/* Ringkasan Data Nota Toko */}
                  <div className="space-y-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Rincian Nota Toko Terpilih:
                    </span>
                    <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 space-y-2">
                      <div>
                        <div className="text-[10px] text-slate-500">Nama Toko / Suplier</div>
                        <div className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-1.5">
                          <Building2 className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0" />
                          <span>{inspectingReceipt.storeName}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                        <div>
                          <div className="text-[10px] text-slate-500">No. Seri Faktur</div>
                          <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                            {inspectingReceipt.receiptNo}
                          </div>
                        </div>
                        <div>
                          <div className="text-[10px] text-slate-500">Tanggal Nota</div>
                          <div className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                            {inspectingReceipt.receiptDate ? formatDateTime(inspectingReceipt.receiptDate).split(',')[0] : '-'}
                          </div>
                        </div>
                      </div>

                      <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700/60">
                        <div className="text-[10px] text-slate-500">Grand Total di Nota Fisik</div>
                        <div className="text-base font-black text-emerald-600 dark:text-emerald-400">
                          Rp {inspectingReceipt.totalPhysicalAmount.toLocaleString('id-ID')}
                        </div>
                      </div>

                      {inspectingReceipt.sampleItemNames.length > 0 && (
                        <div className="pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px] text-slate-500">
                          <b>Contoh item pada nota ini:</b> {inspectingReceipt.sampleItemNames.join(', ')}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Informasi Item yang Akan Dihubungkan */}
                  <div className="space-y-1.5">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                      Item yang Akan Ditautkan:
                    </span>
                    <div className="p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-800/80 space-y-1.5">
                      <div className="text-xs font-bold text-indigo-950 dark:text-indigo-200 flex items-center justify-between">
                        <span>{itemRows.length} Pos Material Terpilih</span>
                        <span className="text-[10px] px-2 py-0.2 rounded-full bg-indigo-200/80 dark:bg-indigo-900 text-indigo-800 dark:text-indigo-200 font-extrabold">
                          Siap Terhubung
                        </span>
                      </div>
                      <div className="text-[11px] text-indigo-800 dark:text-indigo-300 line-clamp-3">
                        {itemRows.map((r) => r.originalName || r.actualName).join(', ')}
                      </div>
                      <div className="text-[10px] text-indigo-600 dark:text-indigo-400 pt-1 border-t border-indigo-200/60 dark:border-indigo-800/60">
                        💡 Nol duplikasi upload — berkas foto dari album ini akan langsung diasosiasikan secara resmi.
                      </div>
                    </div>
                  </div>
                </div>

                {/* Tombol Aksi */}
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setIsConfirmingLink(true)}
                    className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-all shadow-md hover:shadow-indigo-500/25 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Link2 className="w-4 h-4" />
                    <span>Hubungkan {itemRows.length} Item ke Nota Ini</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setInspectingReceipt(null);
                      setIsConfirmingLink(false);
                    }}
                    className="w-full py-2 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors cursor-pointer"
                  >
                    Kembali ke Album Nota
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DIALOG KONFIRMASI PENAUTAN (Muncul Sebelum Form Terapkan) */}
      {isConfirmingLink && inspectingReceipt && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in zoom-in-95 duration-150">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-600 dark:text-indigo-400 flex items-center justify-center mx-auto shadow-inner">
              <Link2 className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Konfirmasi Penautan Nota Toko
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Apakah Anda yakin ingin menautkan <b>{itemRows.length} item mutasi</b> ini ke nota toko resmi berikut?
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Toko / Suplier:</span>
                <span className="font-bold text-slate-900 dark:text-white">{inspectingReceipt.storeName}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Nomor Faktur:</span>
                <span className="font-mono font-bold text-slate-900 dark:text-white">{inspectingReceipt.receiptNo}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Total Nilai Bon:</span>
                <span className="font-bold text-emerald-600 dark:text-emerald-400">
                  Rp {inspectingReceipt.totalPhysicalAmount.toLocaleString('id-ID')}
                </span>
              </div>
              <div className="pt-2 border-t border-slate-200 dark:border-slate-700 text-[11px] text-slate-500">
                <b>Material Terpilih:</b> {itemRows.map((r) => r.originalName || r.actualName).join(', ')}
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsConfirmingLink(false)}
                className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors cursor-pointer"
              >
                Batal / Periksa Lagi
              </button>
              <button
                type="button"
                onClick={() => handleConfirmLinkReceipt(inspectingReceipt)}
                className="flex-1 py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition-colors shadow-md flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Ya, Tautkan Sekarang</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
