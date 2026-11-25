import { CurrencyInput } from './CurrencyInput';
import React, { useState, useMemo, useCallback } from 'react';
import {
  X,
  Images,
  Search,
  Building2,
  Calendar,
  Receipt,
  FileText,
  ExternalLink,
  PackageCheck,
  Eye,
  CheckCircle2,
  Paperclip,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  FileEdit,
  Ban,
  ArrowRight,
  Camera,
  Upload,
  Sparkles
} from 'lucide-react';
import { useSmartGesture } from '../hooks/useSmartGesture';
import { ProjectReceiptAlbumItem, MutasiBarang, MutasiKas, UserProfile, ReceiptScope } from '../types';
import { formatDateTime } from '../lib/pdfGenerator';
import { supersedeProjectReceipt, voidProjectReceipt, uploadReceiptFile } from '../lib/receiptStorage';

interface ProjectReceiptAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  albumItems: ProjectReceiptAlbumItem[];
  currentUser: UserProfile;
  projectId?: string;
  onOpenReceiptViewer?: (mutation: MutasiBarang, related: MutasiBarang[]) => void;
  onOpenCashReceiptViewer?: (
    cash: MutasiKas,
    relatedCash: MutasiKas[],
    relatedStock: MutasiBarang[],
    scope?: ReceiptScope
  ) => void;
  onSelectForLinking?: (receipt: ProjectReceiptAlbumItem) => void;
  onDataChanged?: () => Promise<void> | void;
  hideCashDetails?: boolean;
}

export const ProjectReceiptAlbumModal: React.FC<ProjectReceiptAlbumModalProps> = ({
  isOpen,
  onClose,
  albumItems,
  currentUser,
  projectId = '',
  onOpenReceiptViewer,
  onOpenCashReceiptViewer,
  onSelectForLinking,
  onDataChanged,
  hideCashDetails = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'HAS_FILE' | 'HISTORY'>('ALL');
  const [scopeFilter, setScopeFilter] = useState<'ALL' | ReceiptScope>('ALL');

  // State Pratinjau Membesar (HD Zoomable Inspect ala Mobile)
  const [inspectingItem, setInspectingItem] = useState<ProjectReceiptAlbumItem | null>(null);
  const [inspectingPageIndex, setInspectingPageIndex] = useState<number>(0);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);

  // State Carousel Thumbnail per Kartu
  const [cardPageIndices, setCardPageIndices] = useState<Record<string, number>>({});

  // State Dialog Aksi GANTI NOTA (Supersede)
  const [replacingReceipt, setReplacingReceipt] = useState<ProjectReceiptAlbumItem | null>(null);
  const [replaceReason, setReplaceReason] = useState<string>('');
  const [replaceReceiptNo, setReplaceReceiptNo] = useState<string>('');
  const [replaceStoreName, setReplaceStoreName] = useState<string>('');
  const [replaceStoreContact, setReplaceStoreContact] = useState<string>('');
  const [replaceReceiptDate, setReplaceReceiptDate] = useState<string>('');
  const [replacePhysicalTotal, setReplacePhysicalTotal] = useState<string>('');
  const [replaceFiles, setReplaceFiles] = useState<File[]>([]);
  const [replaceFilePreviews, setReplaceFilePreviews] = useState<string[]>([]);
  const [isSubmittingReplace, setIsSubmittingReplace] = useState<boolean>(false);

  // State Dialog Aksi BATAL NOTA (Void)
  const [voidingReceipt, setVoidingReceipt] = useState<ProjectReceiptAlbumItem | null>(null);
  const [voidReason, setVoidReason] = useState<string>('');
  const [isSubmittingVoid, setIsSubmittingVoid] = useState<boolean>(false);

  // State Feedback Notifikasi
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const visibleAlbumItems = useMemo(() => {
    if (!hideCashDetails) return albumItems;
    return albumItems
      .filter((item) => item.receiptScope !== 'KAS_OPERASIONAL')
      .map((item) => ({
        ...item,
        storeName: 'Pemasok Rekanan Proyek',
        storeContact: undefined
      }));
  }, [albumItems, hideCashDetails]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return visibleAlbumItems.filter((item) => {
      const itemScope: ReceiptScope = item.receiptScope || 'BELANJA_BARANG';
      if (!hideCashDetails && scopeFilter !== 'ALL' && itemScope !== scopeFilter) return false;

      const matchSearch =
        !q ||
        item.storeName.toLowerCase().includes(q) ||
        item.receiptNo.toLowerCase().includes(q) ||
        (item.receiptDate && item.receiptDate.toLowerCase().includes(q)) ||
        item.sampleItemNames.some((n) => n.toLowerCase().includes(q));

      const hasFile = item.attachmentUrls && item.attachmentUrls.length > 0;
      const isArchived = Boolean(item.is_batal || item.is_ganti || item.status_verifikasi === 'BATAL' || item.status_verifikasi === 'DIGANTI');

      if (activeTab === 'ACTIVE' && isArchived) return false;
      if (activeTab === 'HAS_FILE' && (!hasFile || isArchived)) return false;
      if (activeTab === 'HISTORY' && !isArchived) return false;

      return matchSearch;
    });
  }, [visibleAlbumItems, searchQuery, activeTab, scopeFilter, hideCashDetails]);

  // Navigasi lembar foto thumbnail di kartu
  const handleCardPageChange = (itemId: string, direction: 'prev' | 'next', totalPages: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setCardPageIndices((prev) => {
      const current = prev[itemId] || 0;
      const next = direction === 'next' ? (current + 1) % totalPages : (current - 1 + totalPages) % totalPages;
      return { ...prev, [itemId]: next };
    });
  };

  // Buka inspeksi foto membesar
  const handleOpenInspect = (item: ProjectReceiptAlbumItem, initialPage = 0) => {
    setInspectingItem(item);
    setInspectingPageIndex(initialPage);
    setZoomLevel(1);
    setRotation(0);
  };

  // Smart-Gesture: Usap lembar nota pada inspeksi foto
  const handleInspectPrev = useCallback(() => {
    if (!inspectingItem || inspectingItem.attachmentUrls.length <= 1) return;
    setInspectingPageIndex((prev) =>
      prev > 0 ? prev - 1 : inspectingItem.attachmentUrls.length - 1
    );
    setZoomLevel(1);
    setRotation(0);
  }, [inspectingItem]);

  const handleInspectNext = useCallback(() => {
    if (!inspectingItem || inspectingItem.attachmentUrls.length <= 1) return;
    setInspectingPageIndex((prev) =>
      prev < inspectingItem.attachmentUrls.length - 1 ? prev + 1 : 0
    );
    setZoomLevel(1);
    setRotation(0);
  }, [inspectingItem]);

  const { gestureProps: inspectGestureProps } = useSmartGesture({
    threshold: 40,
    enableMouseDrag: false,
    onSwipeLeft: handleInspectNext,
    onSwipeRight: handleInspectPrev
  });

  // Buka form Ganti Nota
  const handleOpenReplaceModal = (item: ProjectReceiptAlbumItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setReplacingReceipt(item);
    setReplaceReason('');
    setReplaceReceiptNo(item.receiptNo !== 'Tanpa No. Seri' ? item.receiptNo : '');
    setReplaceStoreName(item.storeName);
    setReplaceStoreContact(item.storeContact || '');
    setReplaceReceiptDate(item.receiptDate ? item.receiptDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
    setReplacePhysicalTotal(item.totalPhysicalAmount > 0 ? item.totalPhysicalAmount.toString() : '');
    setReplaceFiles([]);
    setReplaceFilePreviews([]);
    setFeedbackError(null);
  };

  // Buka dialog Batal Nota
  const handleOpenVoidModal = (item: ProjectReceiptAlbumItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setVoidingReceipt(item);
    setVoidReason('');
    setFeedbackError(null);
  };

  // Handle pilih berkas pengganti
  const handleSelectReplaceFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files);
    setReplaceFiles((prev) => [...prev, ...files].slice(0, 5));

    files.forEach((file) => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onloadend = () => {
          setReplaceFilePreviews((prev) => [...prev, reader.result as string].slice(0, 5));
        };
        reader.readAsDataURL(file);
      } else if (file.type === 'application/pdf') {
        setReplaceFilePreviews((prev) => [...prev, 'PDF_PREVIEW'].slice(0, 5));
      }
    });
  };

  // Eksekusi GANTI NOTA (Supersede)
  const handleSubmitReplace = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replacingReceipt) return;

    if (!replaceReason.trim()) {
      setFeedbackError('Alasan penggantian nota wajib diisi untuk jejak audit sah.');
      return;
    }
    if (!replaceStoreName.trim()) {
      setFeedbackError('Nama toko suplier wajib diisi.');
      return;
    }

    try {
      setIsSubmittingReplace(true);
      setFeedbackError(null);

      // Upload berkas baru jika ada yang dipilih
      let uploadedUrls: string[] = [];
      if (replaceFiles.length > 0) {
        for (const file of replaceFiles) {
          const url = await uploadReceiptFile(file, projectId, replaceReceiptNo || 'nota');
          uploadedUrls.push(url);
        }
      } else {
        // Pertahankan berkas lama jika hanya mengoreksi data teks
        uploadedUrls = replacingReceipt.attachmentUrls || [];
      }

      const oldId = replacingReceipt.receiptId || replacingReceipt.id;
      const targetMutationIds = (replacingReceipt.rawMutations || []).map((m) => m.id);
      const targetCashIds = (replacingReceipt.rawCashMutations || []).map((c) => c.id);
      const result = await supersedeProjectReceipt(
        oldId,
        {
          project_id: projectId,
          reference_no: replaceReceiptNo.trim() || 'Tanpa No. Seri',
          nama_toko: replaceStoreName.trim(),
          toko_kontak: replaceStoreContact.trim() || undefined,
          tanggal_nota: replaceReceiptDate || new Date().toISOString().slice(0, 10),
          total_nota_fisik: Number(replacePhysicalTotal) || replacingReceipt.totalPhysicalAmount,
          lampiran_nota_urls: uploadedUrls,
          receipt_scope: replacingReceipt.receiptScope || 'BELANJA_BARANG',
          status_verifikasi: 'TERCATAT'
        },
        replaceReason.trim(),
        currentUser,
        targetMutationIds,
        targetCashIds
      );

      if (result) {
        setFeedbackNotice(`Nota berhasil diganti dengan No. ${result.reference_no}. Seluruh item mutasi telah otomatis dialihkan ke nota baru.`);
        setReplacingReceipt(null);
        if (onDataChanged) await onDataChanged();
      } else {
        setFeedbackError('Gagal memproses penggantian nota di database.');
      }
    } catch (err: any) {
      console.error('Error saat mengganti nota:', err);
      setFeedbackError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsSubmittingReplace(false);
    }
  };

  // Eksekusi BATAL NOTA (Void)
  const handleSubmitVoid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voidingReceipt) return;

    if (!voidReason.trim()) {
      setFeedbackError('Alasan pembatalan nota wajib diisi untuk kepatuhan audit.');
      return;
    }

    try {
      setIsSubmittingVoid(true);
      setFeedbackError(null);

      const targetId = voidingReceipt.receiptId || voidingReceipt.id;
      const targetMutationIds = (voidingReceipt.rawMutations || []).map((m) => m.id);
      const targetCashIds = (voidingReceipt.rawCashMutations || []).map((c) => c.id);
      const success = await voidProjectReceipt(
        targetId,
        voidReason.trim(),
        currentUser,
        targetMutationIds,
        targetCashIds
      );

      if (success) {
        setFeedbackNotice(`Nota No. ${voidingReceipt.receiptNo} berhasil dibatalkan. Tautan mutasi barang terkait telah dikembalikan ke status NOTA MENYUSUL.`);
        setVoidingReceipt(null);
        if (onDataChanged) await onDataChanged();
      } else {
        setFeedbackError('Gagal membatalkan nota di database.');
      }
    } catch (err: any) {
      console.error('Error saat membatalkan nota:', err);
      setFeedbackError(err.message || 'Terjadi kesalahan sistem.');
    } finally {
      setIsSubmittingVoid(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-6xl max-h-[94vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0 shadow-inner">
              <Images className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white">
                  Album Galeri Berkas Nota Resmi Proyek
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-200 border border-indigo-200 dark:border-indigo-800">
                  {visibleAlbumItems.length} Nota Terdaftar
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Koleksi master bukti fisik nota toko: geser lembar berkas, periksa resolusi tajam, atau kelola koreksi (Ganti / Batal sah).
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Notifikasi Umpan Balik */}
        {feedbackNotice && (
          <div className="px-5 py-2.5 bg-emerald-50 dark:bg-emerald-950/60 border-b border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>{feedbackNotice}</span>
            </div>
            <button type="button" onClick={() => setFeedbackNotice(null)} className="text-emerald-600 hover:text-emerald-800 cursor-pointer">✕</button>
          </div>
        )}

        {/* Toolbar Pencarian, Filter Cakupan & Tab */}
        <div className="p-3.5 sm:p-4 border-b border-slate-200/80 dark:border-slate-800 space-y-2.5 bg-white dark:bg-slate-900">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari nama toko, nomor faktur/kuitansi, atau uraian transaksi..."
                className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 shrink-0">
              {[
                { id: 'ALL', label: `Semua (${visibleAlbumItems.length})` },
                { id: 'ACTIVE', label: `Aktif (${visibleAlbumItems.filter((i) => !i.is_batal && !i.is_ganti).length})` },
                { id: 'HAS_FILE', label: `Ada Berkas (${visibleAlbumItems.filter((i) => i.attachmentUrls.length > 0 && !i.is_batal && !i.is_ganti).length})` },
                { id: 'HISTORY', label: `Riwayat Batal/Ganti (${visibleAlbumItems.filter((i) => i.is_batal || i.is_ganti).length})` }
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all cursor-pointer ${
                    activeTab === tab.id
                      ? 'bg-indigo-600 text-white shadow-xs'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {!hideCashDetails && (
            <div className="flex items-center gap-1.5 flex-wrap text-[11px]">
              <span className="text-slate-500 dark:text-slate-400 font-semibold mr-1">Sumber Berkas:</span>
              {(
                [
                  { id: 'ALL', label: 'Semua Sumber' },
                  { id: 'BELANJA_BARANG', label: 'Nota Belanja' },
                  { id: 'KAS_OPERASIONAL', label: 'Kuitansi Kas' },
                  { id: 'TERPADU', label: 'Terpadu (Barang & Kas)' },
                ] as const
              ).map((sc) => (
                <button
                  key={sc.id}
                  type="button"
                  onClick={() => setScopeFilter(sc.id)}
                  className={`px-2.5 py-1 rounded-full font-bold border transition-colors cursor-pointer ${
                    scopeFilter === sc.id
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-2xs'
                      : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {sc.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Isi Galeri Album Nota (Responsive Grid & Mobile Touch Friendly) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {filteredItems.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center">
                <Images className="w-7 h-7" />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Belum ada nota yang sesuai dengan kriteria penyaringan ini.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredItems.map((item) => {
                const urls = item.attachmentUrls || [];
                const pageCount = urls.length;
                const activeCardPage = cardPageIndices[item.id] || 0;
                const currentUrl = pageCount > 0 ? (urls[activeCardPage] || urls[0]) : '';
                const isPdf = currentUrl.toLowerCase().includes('.pdf') || currentUrl.startsWith('data:application/pdf');
                const isVoid = Boolean(item.is_batal || item.status_verifikasi === 'BATAL');
                const isReplaced = Boolean(item.is_ganti || item.status_verifikasi === 'DIGANTI');

                return (
                  <div
                    key={item.id}
                    className={`group rounded-2xl border transition-all duration-200 p-4 flex flex-col justify-between space-y-3.5 relative overflow-hidden ${
                      isVoid
                        ? 'bg-rose-50/20 dark:bg-rose-950/15 border-rose-200 dark:border-rose-900/60 opacity-80'
                        : isReplaced
                        ? 'bg-amber-50/20 dark:bg-amber-950/15 border-amber-200 dark:border-amber-900/60 opacity-80'
                        : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-500/80 hover:shadow-xl'
                    }`}
                  >
                    {/* Badge Status Audit */}
                    {isVoid && (
                      <div className="absolute top-0 right-0 bg-rose-600 text-white text-[9px] font-black uppercase px-3 py-1 rounded-bl-xl shadow-xs flex items-center gap-1 z-10">
                        <Ban className="w-3 h-3" />
                        <span>BATAL</span>
                      </div>
                    )}
                    {isReplaced && (
                      <div className="absolute top-0 right-0 bg-amber-600 text-white text-[9px] font-black uppercase px-3 py-1 rounded-bl-xl shadow-xs flex items-center gap-1 z-10">
                        <FileEdit className="w-3 h-3" />
                        <span>DIGANTI</span>
                      </div>
                    )}

                    <div className="space-y-3">
                      {/* Header Toko & Nomor Faktur */}
                      <div className="flex items-start justify-between gap-2 pr-12">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                            <Building2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="text-xs font-black truncate">{item.storeName}</span>
                          </div>
                          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5 truncate" title={item.receiptNo}>
                            {item.receiptNo}
                          </h3>
                          {!hideCashDetails && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                              {item.receiptScope === 'TERPADU' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800">
                                  ✓ Terbayar Kas
                                </span>
                              ) : item.receiptScope === 'KAS_OPERASIONAL' ? (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/50 dark:text-blue-200 dark:border-blue-800">
                                  Kuitansi Kas
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700">
                                  Nota Belanja
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Frame Thumbnail Berkas dengan Gesture Carousel Lembar */}
                      <div
                        onClick={() => pageCount > 0 && handleOpenInspect(item, activeCardPage)}
                        className={`h-40 rounded-xl border overflow-hidden relative flex items-center justify-center transition-all select-none ${
                          pageCount > 0
                            ? 'cursor-pointer border-slate-200 dark:border-slate-700 bg-slate-950/5 dark:bg-black/40 group-hover:ring-2 group-hover:ring-indigo-500/40'
                            : 'border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40'
                        }`}
                      >
                        {pageCount > 0 ? (
                          isPdf ? (
                            <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-rose-600 dark:text-rose-400 w-full h-full">
                              <FileText className="w-10 h-10" />
                              <span className="text-[10px] font-black px-2 py-0.5 rounded bg-rose-100 dark:bg-rose-950 text-rose-900 dark:text-rose-100 border border-rose-200 dark:border-rose-800">
                                Berkas PDF
                              </span>
                              <span className="text-[9px] text-slate-400">Klik untuk melihat</span>
                            </div>
                          ) : (
                            <img
                              src={currentUrl}
                              alt={item.receiptNo}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          )
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-slate-400">
                            <Receipt className="w-10 h-10 stroke-[1.5]" />
                            <span className="text-[10px] font-semibold">Belum Ada Foto Nota</span>
                          </div>
                        )}

                        {/* Navigasi Swipe / Tombol Carousel Halaman */}
                        {pageCount > 1 && (
                          <div className="absolute inset-x-1.5 inset-y-0 flex items-center justify-between pointer-events-none">
                            <button
                              type="button"
                              onClick={(e) => handleCardPageChange(item.id, 'prev', pageCount, e)}
                              className="w-6 h-6 rounded-full bg-slate-900/75 hover:bg-slate-900 text-white flex items-center justify-center pointer-events-auto backdrop-blur-xs transition-transform active:scale-95 cursor-pointer shadow-md"
                              title="Lembar Sebelumnya"
                            >
                              <ChevronLeft className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleCardPageChange(item.id, 'next', pageCount, e)}
                              className="w-6 h-6 rounded-full bg-slate-900/75 hover:bg-slate-900 text-white flex items-center justify-center pointer-events-auto backdrop-blur-xs transition-transform active:scale-95 cursor-pointer shadow-md"
                              title="Lembar Selanjutnya"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        )}

                        {/* Indikator Halaman (Mobile Style Dots & Pill) */}
                        {pageCount > 0 && (
                          <span className="absolute bottom-2 right-2 text-[9px] font-black px-2 py-0.5 rounded-lg bg-slate-950/80 text-white backdrop-blur-xs flex items-center gap-1 shadow-md">
                            <Paperclip className="w-2.5 h-2.5" />
                            <span>{activeCardPage + 1} / {pageCount} Lembar</span>
                          </span>
                        )}

                        {/* Overlay Hover: Klik Memperbesar */}
                        {pageCount > 0 && (
                          <div className="absolute inset-0 bg-indigo-950/0 group-hover:bg-indigo-950/25 transition-colors flex items-center justify-center pointer-events-none">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity px-2.5 py-1 rounded-lg bg-slate-900/85 text-white text-[10px] font-bold backdrop-blur-xs flex items-center gap-1 shadow-md">
                              <Eye className="w-3 h-3" />
                              <span>Klik Memperbesar</span>
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Rincian Nominal & Tanggal */}
                      <div className="space-y-1.5 pt-1 text-xs">
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 font-mono">
                          <span className="text-[11px] text-slate-500 flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{item.receiptDate ? formatDateTime(item.receiptDate).split(',')[0] : '-'}</span>
                          </span>
                          {!hideCashDetails && (
                            <span className="font-extrabold text-slate-900 dark:text-white">
                              Rp {item.totalPhysicalAmount.toLocaleString('id-ID')}
                            </span>
                          )}
                        </div>

                        {item.sampleItemNames.length > 0 && (
                          <div className="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-300 line-clamp-2">
                            <b>Item Terhubung ({item.linkedMutationsCount}):</b> {item.sampleItemNames.join(', ')}
                          </div>
                        )}

                        {item.alasan_batal_ganti && (
                          <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-[10px] text-amber-800 dark:text-amber-200">
                            <b>Jejak Audit:</b> {item.alasan_batal_ganti}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Tombol Aksi Lengkap (Tautkan / Ganti / Batal) */}
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="flex items-center gap-2">
                        {onSelectForLinking && !isVoid && !isReplaced && (
                          <button
                            type="button"
                            onClick={() => onSelectForLinking(item)}
                            className="flex-1 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                          >
                            <PackageCheck className="w-3.5 h-3.5" />
                            <span>Pilih Nota Ini</span>
                          </button>
                        )}

                        {pageCount > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              if (!hideCashDetails && onOpenCashReceiptViewer && (item.rawCashMutations?.length || 0) > 0) {
                                onOpenCashReceiptViewer(
                                  item.rawCashMutations![0],
                                  item.rawCashMutations!,
                                  item.rawMutations || [],
                                  item.receiptScope
                                );
                              } else if (onOpenReceiptViewer && item.rawMutations.length > 0) {
                                onOpenReceiptViewer(item.rawMutations[0], item.rawMutations);
                              } else {
                                handleOpenInspect(item, activeCardPage);
                              }
                            }}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold transition-colors cursor-pointer flex items-center justify-center gap-1"
                            title="Inspeksi Foto Besar"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Periksa</span>
                          </button>
                        )}
                      </div>

                      {/* Tombol Koreksi CRU: Ganti & Batal (Hanya untuk nota aktif & non-Pengamat) */}
                      {!hideCashDetails && !isVoid && !isReplaced && (
                        <div className="flex items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800/60 text-[11px]">
                          <button
                            type="button"
                            onClick={(e) => handleOpenReplaceModal(item, e)}
                            className="flex-1 py-1 px-2 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 border border-amber-200 dark:border-amber-800"
                            title="Ganti berkas foto buram atau koreksi no faktur nota ini"
                          >
                            <FileEdit className="w-3 h-3" />
                            <span>Ganti Nota</span>
                          </button>

                          <button
                            type="button"
                            onClick={(e) => handleOpenVoidModal(item, e)}
                            className="py-1 px-2.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/60 text-rose-800 dark:text-rose-300 font-bold transition-colors cursor-pointer flex items-center justify-center gap-1 border border-rose-200 dark:border-rose-800"
                            title="Batalkan nota sah jika transaksi batal"
                          >
                            <Ban className="w-3 h-3" />
                            <span>Batal</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer Modal */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60 flex items-center justify-between text-xs">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">
            💡 Seluruh foto bon tersimpan di entitas master proyek tanpa duplikasi berkas.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold transition-colors cursor-pointer"
          >
            Tutup Album
          </button>
        </div>
      </div>

      {/* =========================================================================
          MODAL INSPEKSI RESOLUSI BESAR (Zoom, Pan, Swipe Antar Lembar)
      ========================================================================= */}
      {inspectingItem && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-800/60">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold">
                  <Eye className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                      {inspectingItem.storeName}
                    </h3>
                    <span className="font-mono text-xs px-2 py-0.5 rounded bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-extrabold">
                      No. {inspectingItem.receiptNo}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    {!hideCashDetails ? `Total Nota: Rp ${inspectingItem.totalPhysicalAmount.toLocaleString('id-ID')} · ` : ''}
                    Lembar {inspectingPageIndex + 1} dari {inspectingItem.attachmentUrls.length}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setInspectingItem(null)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Body Inspeksi */}
            <div className="flex-1 overflow-hidden flex flex-col bg-slate-950">
              {/* Toolbar Zoom */}
              <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs text-white">
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setZoomLevel((z) => Math.min(3, +(z + 0.25).toFixed(2)))}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <ZoomIn className="w-3.5 h-3.5" />
                    <span>Perbesar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setZoomLevel((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <ZoomOut className="w-3.5 h-3.5" />
                    <span>Perkecil</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 font-bold flex items-center gap-1 cursor-pointer"
                  >
                    <RotateCw className="w-3.5 h-3.5" />
                    <span>Putar</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setZoomLevel(1);
                      setRotation(0);
                    }}
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 cursor-pointer"
                    title="Atur Ulang Ukuran"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-mono text-xs text-slate-400 ml-1">{Math.round(zoomLevel * 100)}%</span>
                </div>

                {inspectingItem.attachmentUrls[inspectingPageIndex] && (
                  <a
                    href={inspectingItem.attachmentUrls[inspectingPageIndex]}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-indigo-400 hover:underline flex items-center gap-1"
                  >
                    <span>Buka Resolusi Asli</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>

              {/* Viewport Gambar dengan Smart-Gesture Touch Swipe */}
              <div
                {...inspectGestureProps}
                className="flex-1 overflow-auto flex items-center justify-center p-4 touch-pan-y relative select-none"
              >
                {(() => {
                  const url = inspectingItem.attachmentUrls[inspectingPageIndex];
                  const isPdf = url?.toLowerCase().includes('.pdf') || url?.startsWith('data:application/pdf');

                  if (!url) {
                    return <div className="text-slate-400 text-xs">Belum ada foto nota.</div>;
                  }

                  if (isPdf) {
                    return (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-white dark:bg-slate-900 rounded-xl p-6">
                        <FileText className="w-16 h-16 text-rose-500" />
                        <span className="text-sm font-bold text-slate-800 dark:text-white">Dokumen Nota Resmi (PDF)</span>
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold transition-colors inline-flex items-center gap-1.5"
                        >
                          <ExternalLink className="w-4 h-4" />
                          <span>Buka Berkas PDF Lengkap</span>
                        </a>
                      </div>
                    );
                  }

                  return (
                    <div className="transition-transform duration-150 ease-out origin-center flex items-center justify-center">
                      <img
                        src={url}
                        alt="Nota Fisik"
                        style={{
                          transform: `scale(${zoomLevel}) rotate(${rotation}deg)`,
                          maxHeight: '68vh',
                          maxWidth: '100%',
                          objectFit: 'contain'
                        }}
                        className="rounded shadow-2xl select-none"
                      />
                    </div>
                  );
                })()}
              </div>

              {/* Pagination Lembar Jika Multi Halaman */}
              {inspectingItem.attachmentUrls.length > 1 && (
                <div className="p-3 bg-slate-900/90 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 px-4">
                  <span className="text-[10px] text-slate-400 inline-flex items-center gap-1">
                    <Sparkles className="w-3 h-3 text-cyan-400" />
                    <span>Smart-Gesture: Usap layar ‹ › untuk membalik lembar nota</span>
                  </span>
                  <div className="flex items-center gap-1.5">
                    {inspectingItem.attachmentUrls.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setInspectingPageIndex(idx);
                          setZoomLevel(1);
                          setRotation(0);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                          inspectingPageIndex === idx
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                        }`}
                      >
                        Lembar #{idx + 1}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL GANTI NOTA (Metode GANTI: Terbitkan Nota Baru & Alihkan Transaksi)
      ========================================================================= */}
      {replacingReceipt && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-3 sm:p-5 bg-slate-950/85 backdrop-blur-sm animate-in zoom-in-95 duration-150">
          <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-amber-50/80 dark:bg-amber-950/40">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-800 dark:text-amber-200 flex items-center justify-center">
                  <FileEdit className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                    Ganti Berkas / Identitas Nota Resmi
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Nota lama digantikan sah; seluruh {replacingReceipt.linkedMutationsCount} mutasi terkait otomatis dialihkan ke nota baru.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReplacingReceipt(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitReplace} className="p-5 space-y-3.5 overflow-y-auto max-h-[75vh]">
              {feedbackError && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>{feedbackError}</span>
                </div>
              )}

              {/* Alasan Penggantian (Wajib Jejak Audit) */}
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  Alasan Penggantian Nota * (Wajib Audit)
                </label>
                <input
                  type="text"
                  required
                  value={replaceReason}
                  onChange={(e) => setReplaceReason(e.target.value)}
                  placeholder="Contoh: Foto bon sebelumnya buram / Revisi nomor faktur dari kasir toko"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-amber-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nama Toko / Suplier *
                  </label>
                  <input
                    type="text"
                    required
                    value={replaceStoreName}
                    onChange={(e) => setReplaceStoreName(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Nomor Nota / Faktur *
                  </label>
                  <input
                    type="text"
                    required
                    value={replaceReceiptNo}
                    onChange={(e) => setReplaceReceiptNo(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white font-mono font-bold"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Tanggal Nota
                  </label>
                  <input
                    type="date"
                    value={replaceReceiptDate}
                    onChange={(e) => setReplaceReceiptDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
                  />
                </div>

                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Total Fisik Bon (Rp)
                  </label>
                  <CurrencyInput
                    value={replacePhysicalTotal ? Number(replacePhysicalTotal) : null}
                    onChange={(val) => setReplacePhysicalTotal(val ? String(val) : '')}
                    placeholder="Contoh: 280.000"
                    inputClassName="px-3 py-2 text-xs"
                  />
                </div>
              </div>

              {/* Unggah Foto Bon Baru Pengganti */}
              <div className="space-y-1.5 pt-1">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between">
                  <span>Foto Bon / Scan PDF Pengganti (Opsional jika hanya revisi teks):</span>
                  <span className="text-[10px] text-slate-500 font-normal">Hingga 5 lembar</span>
                </label>

                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 text-xs font-bold cursor-pointer hover:bg-amber-100">
                    <Camera className="w-4 h-4" />
                    <span>Pilih Foto Baru</span>
                    <input
                      type="file"
                      accept="image/*,application/pdf"
                      multiple
                      onChange={handleSelectReplaceFiles}
                      className="hidden"
                    />
                  </label>
                  <span className="text-[11px] text-slate-500">
                    {replaceFiles.length > 0 ? `${replaceFiles.length} berkas baru dipilih` : 'Mempertahankan foto sebelumnya jika tidak diisi'}
                  </span>
                </div>
              </div>

              {/* Tombol Aksi Simpan */}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReplacingReceipt(null)}
                  disabled={isSubmittingReplace}
                  className="px-4 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 cursor-pointer"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingReplace}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-amber-600 hover:bg-amber-700 text-white shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingReplace ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Menyimpan Penggantian...</span>
                    </>
                  ) : (
                    <>
                      <FileEdit className="w-3.5 h-3.5" />
                      <span>Terapkan Penggantian Nota Sah</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL BATAL NOTA (Metode BATAL: Batalkan Permanen & Lepaskan Tautan Item)
      ========================================================================= */}
      {voidingReceipt && (
        <div className="fixed inset-0 z-70 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-sm animate-in zoom-in-95 duration-150">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-5 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/80 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto shadow-inner">
              <Ban className="w-6 h-6" />
            </div>

            <div className="text-center space-y-1.5">
              <h3 className="text-base font-extrabold text-slate-900 dark:text-white">
                Batalkan Nota Resmi Toko
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300">
                Apakah Anda yakin ingin membatalkan nota <b>No. {voidingReceipt.receiptNo}</b> dari <b>{voidingReceipt.storeName}</b>?
              </p>
            </div>

            <div className="p-3 rounded-xl bg-rose-50/80 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-900 dark:text-rose-200 space-y-1.5">
              <div className="font-bold flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                <span>Konsekuensi Pembatalan Nota:</span>
              </div>
              <ul className="list-disc pl-4 space-y-1 text-[11px] text-rose-800 dark:text-rose-300">
                <li>Nota akan ditandai berstatus <b>BATAL</b> permanen (tidak dapat dipulihkan).</li>
                <li>Tautan ke <b>{voidingReceipt.linkedMutationsCount} item mutasi barang</b> akan dilepaskan (kembali menjadi <i>NOTA MENYUSUL</i>).</li>
                <li>Nilai belanja riil nota ini dinolkan dari laporan keuangan.</li>
              </ul>
            </div>

            {/* Kotak Error Inline Jika Terjadi Masalah */}
            {feedbackError && (
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800 text-rose-800 dark:text-rose-200 text-xs font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>{feedbackError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitVoid} className="space-y-3">
              <div className="space-y-1">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  Alasan Pembatalan * (Wajib Jejak Audit)
                </label>
                <input
                  type="text"
                  required
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  placeholder="Contoh: Pesanan dibatalkan supplier / Transaksi retur barang total"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setVoidingReceipt(null)}
                  disabled={isSubmittingVoid}
                  className="flex-1 py-2.5 px-4 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 text-slate-700 dark:text-slate-300 font-bold text-xs transition-colors cursor-pointer"
                >
                  Kembali
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingVoid}
                  className="flex-1 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs transition-colors shadow-md flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingVoid ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Membatalkan...</span>
                    </>
                  ) : (
                    <>
                      <Ban className="w-3.5 h-3.5" />
                      <span>Ya, Batalkan Nota</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
