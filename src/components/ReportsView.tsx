import React, { useState, useMemo, startTransition } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText,
  Download,
  QrCode,
  ShieldCheck,
  Calendar,
  CheckCircle2,
  Clock,
  ArrowLeft,
  Printer,
  Boxes,
  WalletCards,
  ClipboardCheck,
  Building2,
  Search,
  ArrowUpDown,
  Filter,
  Check,
  BadgeCheck,
  Package,
  Layers
} from 'lucide-react';
import {
  generateStockMutationPDF,
  generateCashflowPDF,
  generateBOQReportPDF,
  generateWarehouseSummaryPDF,
  formatDateTime,
  formatDateOnly,
  formatRupiah,
} from '../lib/pdfGenerator';
import { ExportSettingsModal, ExportSettingsConfig } from './ExportSettingsModal';

export const ReportsView: React.FC = () => {
  const {
    stockMutations,
    physicalMaterials,
    items,
    cashMutations,
    documents,
    activeProject,
    activeWorkspaceId,
    user,
    setVerifyingDocId,
    setCurrentView,
    dataReady,
    dataError,
    refreshData,
    tenantBranding,
    activeRole,
    canViewFinancials
  } = useApp();

  const isViewer = activeRole === 'Viewer/Pengamat';
  const canReadStock = Boolean(activeProject?.permissions.includes('inventory.read') ?? true);
  const canReadCash = !isViewer && Boolean(activeProject?.permissions.includes('cash.read') ?? true);
  const canReadDocuments = Boolean(activeProject?.permissions.includes('document.read') ?? true);
  const canVerifyPrivateDocument = Boolean(
    (activeProject?.permissions.includes('document.qr.scan') ?? true) &&
    (activeProject?.permissions.includes('document.qr.verify') ?? true)
  );

  // 4 Jenis Laporan yang Didukung
  const [reportType, setReportType] = useState<'stock' | 'cash' | 'boq' | 'warehouse'>('stock');

  // Rentang Tanggal
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  // Filter & Pencarian
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'DATE_DESC' | 'DATE_ASC' | 'AMOUNT_DESC' | 'AMOUNT_ASC'>('DATE_DESC');

  // State Modal Ekspor & Notifikasi
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Shortcut Tanggal Cepat (Presets)
  const applyDatePreset = (preset: 'today' | '7days' | '30days' | 'thisMonth' | 'all') => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === '30days') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === 'thisMonth') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === 'all') {
      setStartDate('2020-01-01');
      setEndDate(todayStr);
    }
  };

  // Hitung jumlah baris data dan ringkasan metrik yang cocok secara reaktif
  const matchingData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    if (reportType === 'stock') {
      const filtered = stockMutations.filter((m) => {
        const dateOnly = m.tanggal.split('T')[0];
        const matchDate = dateOnly >= startDate && dateOnly <= endDate;
        const matchType = filterType === 'ALL' || m.jenis === filterType;
        const matchSearch =
          !q ||
          (m.nama_barang || '').toLowerCase().includes(q) ||
          (m.tujuan_keperluan || '').toLowerCase().includes(q) ||
          (m.pic_penerima_penyerah || '').toLowerCase().includes(q) ||
          (m.nomor_surat_jalan || '').toLowerCase().includes(q) ||
          (m.nomor_nota || '').toLowerCase().includes(q) ||
          (m.nama_toko || '').toLowerCase().includes(q);
        return matchDate && matchType && matchSearch;
      });

      const totalVolume = filtered.reduce((acc, m) => acc + (Number(m.jumlah) || 0), 0);
      const totalNilai = filtered.reduce((acc, m) => {
        if (m.total_nota_fisik) return acc + Number(m.total_nota_fisik);
        if (m.harga_satuan_beli) return acc + (Number(m.harga_satuan_beli) * Number(m.jumlah));
        return acc;
      }, 0);

      return { count: filtered.length, totalVolume, totalNilai, items: filtered };
    }

    if (reportType === 'cash') {
      const filtered = cashMutations.filter((c) => {
        const dateOnly = c.tanggal.split('T')[0];
        const matchDate = dateOnly >= startDate && dateOnly <= endDate;
        const matchType = filterType === 'ALL' || c.jenis === filterType;
        const matchSearch =
          !q ||
          (c.untuk_apa || '').toLowerCase().includes(q) ||
          (c.pic || '').toLowerCase().includes(q) ||
          (c.nomor_kuitansi || '').toLowerCase().includes(q) ||
          (c.kategori_keperluan || '').toLowerCase().includes(q);
        return matchDate && matchType && matchSearch;
      });

      const totalNilai = filtered.reduce((acc, c) => acc + (Number(c.jumlah_rp) || 0), 0);
      return { count: filtered.length, totalVolume: 0, totalNilai, items: filtered };
    }

    if (reportType === 'boq') {
      const filtered = (items || []).filter((b) => {
        return !q || (b.nama_barang || '').toLowerCase().includes(q) || (b.kategori || '').toLowerCase().includes(q);
      });
      const totalNilai = filtered.reduce((acc, b) => acc + (Number(b.harga_satuan || 0) * Number(b.qty_boq || 0)), 0);
      return { count: filtered.length, totalVolume: filtered.length, totalNilai, items: filtered };
    }

    if (reportType === 'warehouse') {
      const filtered = (physicalMaterials || []).filter((p) => {
        return !q || (p.nama_barang || '').toLowerCase().includes(q);
      });
      const totalVolume = filtered.reduce((acc, p) => acc + (Number(p.stok_fisik) || 0), 0);
      return { count: filtered.length, totalVolume, totalNilai: 0, items: filtered };
    }

    return { count: 0, totalVolume: 0, totalNilai: 0, items: [] };
  }, [reportType, stockMutations, cashMutations, items, physicalMaterials, startDate, endDate, filterType, searchQuery]);

  // Buka Modal Konfigurasi Ekspor
  const handleOpenExportModal = (e: React.FormEvent) => {
    e.preventDefault();
    setGenerationSuccess(null);
    setGenerationError(null);

    if (reportType === 'cash' && !canReadCash) {
      setGenerationError('Peran Anda tidak memiliki izin untuk mengekspor Laporan Keuangan Kas.');
      return;
    }
    if ((reportType === 'stock' || reportType === 'cash') && (!startDate || !endDate || startDate > endDate)) {
      setGenerationError('Rentang tanggal tidak valid. Tanggal awal harus sebelum atau sama dengan tanggal akhir.');
      return;
    }
    if (matchingData.count === 0) {
      setGenerationError('Tidak ada baris data yang cocok dengan kriteria filter saat ini.');
      return;
    }

    startTransition(() => {
      setIsExportModalOpen(true);
    });
  };

  // Eksekusi Pembuatan Dokumen PDF
  const handleConfirmExport = async (config: ExportSettingsConfig) => {
    setIsGenerating(true);
    setGenerationSuccess(null);
    setGenerationError(null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const docId = `RPT-${reportType.toUpperCase()}-${dateTag}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const projectName = activeProject?.name || tenantBranding.contractorName || 'Proyek Aktif';

      if (reportType === 'stock') {
        const sortedList = [...(matchingData.items as any[])].sort((a, b) => {
          if (sortOrder === 'DATE_DESC') return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime();
          if (sortOrder === 'DATE_ASC') return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
          if (sortOrder === 'AMOUNT_DESC') return b.jumlah - a.jumlah;
          if (sortOrder === 'AMOUNT_ASC') return a.jumlah - b.jumlah;
          return 0;
        });

        const sortLabel = sortOrder === 'DATE_DESC' ? 'Terbaru' : sortOrder === 'DATE_ASC' ? 'Terlama' : sortOrder === 'AMOUNT_DESC' ? 'Volume Terbesar' : 'Volume Terkecil';
        const typeLabel = filterType === 'ALL' ? 'Semua Arus' : filterType === 'MASUK' ? 'Masuk (IN)' : 'Keluar (OUT)';
        const searchPart = searchQuery.trim() ? ` · Cari: "${searchQuery.trim()}"` : '';

        await generateStockMutationPDF({
          docId,
          startDate,
          endDate,
          mutations: sortedList,
          signer: user,
          projectName,
          physicalMaterials,
          branding: tenantBranding,
          filterSummary: `${typeLabel}${searchPart} · Urut: ${sortLabel}`,
          customTitle: config.customTitle || 'LAPORAN REKAPITULASI MUTASI BARANG & MATERIAL',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape'
        });

        setGenerationSuccess(`Dokumen Laporan Mutasi Barang ${docId} (${sortedList.length} transaksi) berhasil dicetak dan diunduh.`);
      } else if (reportType === 'cash') {
        const sortedList = [...(matchingData.items as any[])].sort((a, b) => {
          if (sortOrder === 'DATE_DESC') return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime();
          if (sortOrder === 'DATE_ASC') return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
          if (sortOrder === 'AMOUNT_DESC') return b.jumlah_rp - a.jumlah_rp;
          if (sortOrder === 'AMOUNT_ASC') return a.jumlah_rp - b.jumlah_rp;
          return 0;
        });

        const sortLabel = sortOrder === 'DATE_DESC' ? 'Terbaru' : sortOrder === 'DATE_ASC' ? 'Terlama' : sortOrder === 'AMOUNT_DESC' ? 'Nominal Terbesar' : 'Nominal Terkecil';
        const typeLabel = filterType === 'ALL' ? 'Semua Arus Kas' : filterType === 'MASUK' ? 'Kas Masuk (IN)' : 'Kas Keluar (OUT)';
        const searchPart = searchQuery.trim() ? ` · Cari: "${searchQuery.trim()}"` : '';

        await generateCashflowPDF({
          docId,
          startDate,
          endDate,
          cashMutations: sortedList,
          signer: user,
          projectName,
          branding: tenantBranding,
          filterSummary: `${typeLabel}${searchPart} · Urut: ${sortLabel}`,
          customTitle: config.customTitle || 'BUKU LAPORAN KAS & KEUANGAN PROYEK',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape'
        });

        setGenerationSuccess(`Dokumen Laporan Kas Keuangan ${docId} (${sortedList.length} transaksi) berhasil dicetak dan diunduh.`);
      } else if (reportType === 'boq') {
        await generateBOQReportPDF({
          docId,
          items: items || [],
          projectName,
          signer: user,
          branding: tenantBranding,
          filterSummary: `Kontrol Pemenuhan Material BOQ (${items.length} Pos Pekerjaan)`,
          customTitle: config.customTitle || 'LAPORAN KONTROL PEMENUHAN MATERIAL KONTRAK BOQ',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape'
        });

        setGenerationSuccess(`Dokumen Laporan Pemenuhan BOQ ${docId} berhasil dicetak dan diunduh.`);
      } else if (reportType === 'warehouse') {
        await generateWarehouseSummaryPDF({
          docId,
          materials: physicalMaterials || [],
          projectName,
          signer: user,
          stockMutations,
          branding: tenantBranding,
          filterSummary: `Posisi Stok Fisik Gudang Lapangan (${physicalMaterials.length} Jenis Material)`,
          customTitle: config.customTitle || 'LAPORAN REKAPITULASI STOK FISIK GUDANG PROYEK',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape'
        });

        setGenerationSuccess(`Dokumen Laporan Stok Gudang ${docId} berhasil dicetak dan diunduh.`);
      }
    } catch (err: any) {
      console.error('Error saat mencetak PDF:', err);
      setGenerationError(err?.message || 'Gagal menghasilkan dokumen PDF. Periksa kriteria data dan coba lagi.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVerifyDoc = (docId: string) => {
    setVerifyingDocId(docId);
    setCurrentView('verification');
  };

  if (!dataReady) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-sm font-medium text-slate-600 dark:text-slate-300 shadow-sm animate-pulse">
        Memuat data laporan dan arsip proyek...
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Utama & Breadcrumb */}
      <div className="bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4 transition-colors">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentView('dashboard')}
              className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer mr-1"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Dasbor</span>
            </button>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
              Studio Laporan PDF
            </span>
          </div>

          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <Printer className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>Studio Laporan & Ekspor PDF Otomatis</span>
          </h1>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
            Hasilkan berkas laporan siap cetak dari rekaman data transaksi riil proyek, lengkap dengan kode QR validasi registrasi data, peruntukan audit, dan kop resmi perusahaan.
          </p>
        </div>

        {/* Profil & Badget Pengguna + Banner Rata Kanan */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 shrink-0 self-start md:self-auto">
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <BadgeCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="font-bold">{user.name}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-extrabold">
                {activeRole}
              </span>
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 text-xs font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{tenantBranding.contractorName}</span>
            </div>
          </div>

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

      {/* Alert Notifikasi Sukses / Gagal */}
      {generationSuccess && (
        <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200 shadow-xs animate-in zoom-in-95 duration-150">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{generationSuccess}</span>
          </div>
          <button
            onClick={() => setGenerationSuccess(null)}
            className="text-emerald-700 dark:text-emerald-300 font-bold hover:underline cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {generationError && (
        <div className="bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 flex items-center justify-between text-xs text-rose-900 dark:text-rose-200 shadow-xs animate-in zoom-in-95 duration-150">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span className="font-semibold">{generationError}</span>
          </div>
          <button
            onClick={() => setGenerationError(null)}
            className="text-rose-700 dark:text-rose-300 font-bold hover:underline cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Formulir Konfigurasi & Pembuat Laporan */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-6 space-y-6 transition-colors">
        <form onSubmit={handleOpenExportModal} className="space-y-6">
          {/* 1. Pemilihan Jenis Laporan (4 Kartu Interaktif) */}
          <div className="space-y-2">
            <label className="block text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              1. Pilih Jenis Dokumen Laporan:
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Laporan 1: Mutasi Stok Barang */}
              <button
                type="button"
                onClick={() => setReportType('stock')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  reportType === 'stock'
                    ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 dark:border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    reportType === 'stock' ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}>
                    <Boxes className="w-5 h-5" />
                  </div>
                  {reportType === 'stock' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Mutasi Keluar / Masuk Barang
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    Rekapitulasi fisik keluar-masuk stok material, tujuan pos kerja, PIC, dan jejak nota toko.
                  </p>
                </div>
              </button>

              {/* Laporan 2: Mutasi Kas Keuangan Proyek */}
              {!isViewer && (
                <button
                  type="button"
                  disabled={!canReadCash}
                  onClick={() => setReportType('cash')}
                  className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                    reportType === 'cash'
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 dark:border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      reportType === 'cash' ? 'bg-emerald-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}>
                      <WalletCards className="w-5 h-5" />
                    </div>
                    {reportType === 'cash' && <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                      Buku Kas Keuangan Proyek
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                      Buku kas mutasi: Kas masuk (IN), Kas keluar (OUT), peruntukan beban, dan saldo kas berjalan.
                    </p>
                  </div>
                </button>
              )}

              {/* Laporan 3: Kontrol Pemenuhan BOQ */}
              <button
                type="button"
                onClick={() => setReportType('boq')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  reportType === 'boq'
                    ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 dark:border-amber-500 ring-2 ring-amber-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    reportType === 'boq' ? 'bg-amber-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}>
                    <ClipboardCheck className="w-5 h-5" />
                  </div>
                  {reportType === 'boq' && <Check className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Kontrol Pemenuhan BOQ
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    Pemenuhan material kontrak BOQ, realisasi tiba, sisa belum tiba, dan capaian nominal.
                  </p>
                </div>
              </button>

              {/* Laporan 4: Stok Fisik Gudang */}
              <button
                type="button"
                onClick={() => setReportType('warehouse')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  reportType === 'warehouse'
                    ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 dark:border-purple-500 ring-2 ring-purple-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                    reportType === 'warehouse' ? 'bg-purple-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                  }`}>
                    <Package className="w-5 h-5" />
                  </div>
                  {reportType === 'warehouse' && <Check className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Stok Fisik Gudang Proyek
                  </h2>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-2">
                    Posisi stok fisik material yang tersedia di gudang lapangan saat ini beserta statusnya.
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* 2. Rentang Periode & Shortcut Cepat (Khusus Laporan Berbasis Tanggal) */}
          {(reportType === 'stock' || reportType === 'cash') && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  2. Tentukan Periode Tanggal Laporan:
                </label>
                {/* Tombol Shortcut Preset */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => applyDatePreset('today')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Hari Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('7days')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    7 Hari
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('30days')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    30 Hari
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('thisMonth')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Bulan Ini
                  </button>
                  <button
                    type="button"
                    onClick={() => applyDatePreset('all')}
                    className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Semua Periode
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Dari Tanggal:</span>
                  <div className="relative">
                    <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Sampai Tanggal:</span>
                  <div className="relative">
                    <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      required
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Filter Arus & Pencarian Real-Time */}
          <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <label className="block text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              3. Filter & Kata Kunci Pencarian:
            </label>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Filter Jenis Arus (hanya untuk mutasi barang / kas) */}
              {(reportType === 'stock' || reportType === 'cash') ? (
                <div>
                  <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Arus Transaksi:
                  </span>
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                    {[
                      { id: 'ALL', label: 'Semua Arus' },
                      { id: 'MASUK', label: 'Masuk (IN)' },
                      { id: 'KELUAR', label: 'Keluar (OUT)' }
                    ].map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setFilterType(t.id as any)}
                        className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                          filterType === t.id
                            ? 'bg-blue-600 text-white shadow-xs'
                            : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <div>
                  <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Cakupan Data:
                  </span>
                  <div className="p-2 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-500" />
                    <span>Seluruh Item Terdaftar</span>
                  </div>
                </div>
              )}

              {/* Input Pencarian */}
              <div>
                <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Cari Nama Barang / PIC / Dokumen:
                </span>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Contoh: Baut, Jayaboard, Siaga Muda..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {/* Urutan Sortir */}
              <div>
                <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                  Urutan Sortir Baris Dokumen:
                </span>
                <div className="relative">
                  <ArrowUpDown className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                  <select
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as any)}
                    className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
                  >
                    <option value="DATE_DESC">Tanggal: Terbaru ke Terlama</option>
                    <option value="DATE_ASC">Tanggal: Terlama ke Terbaru</option>
                    <option value="AMOUNT_DESC">
                      {reportType === 'stock' || reportType === 'warehouse' ? 'Volume: Terbanyak ke Sedikit' : 'Nominal: Terbesar ke Terkecil'}
                    </option>
                    <option value="AMOUNT_ASC">
                      {reportType === 'stock' || reportType === 'warehouse' ? 'Volume: Sedikit ke Terbanyak' : 'Nominal: Terkecil ke Terbesar'}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Live Counter & Ringkasan Metrik Sebelum Ekspor */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Pratinjau Data Dokumen:
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-extrabold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
                  {matchingData.count} Baris Data Terpilih
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                {matchingData.totalNilai > 0 && `Total Terhitung: ${formatRupiah(matchingData.totalNilai)} · `}
                PDF akan dicetak rapi dengan kop {tenantBranding.contractorName} dan QR code keaslian.
              </p>
            </div>

            <button
              type="submit"
              disabled={isGenerating || matchingData.count === 0}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 active:scale-98 rounded-xl shadow-md hover:shadow-blue-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>{isGenerating ? 'Menyusun Dokumen PDF...' : 'Konfigurasi & Cetak PDF ➔'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Arsip Dokumen Resmi & Validasi QR Code */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Arsip Dokumen Resmi & Validasi Kode QR</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Daftar dokumen resmi proyek yang telah diterbitkan dan dapat diverifikasi integritas snapshot datanya secara instan.
            </p>
          </div>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 self-start sm:self-auto">
            {canReadDocuments ? documents.length : 0} Dokumen Terbit
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {!canReadDocuments ? (
            <div className="p-6 text-center text-xs text-amber-700 dark:text-amber-400 font-medium">
              Izin pembacaan dokumen diperlukan untuk melihat arsip ini.
            </div>
          ) : documents.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
              Belum ada dokumen resmi yang disimpan ke arsip proyek. Dokumen baru yang diterbitkan akan tercatat di sini.
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{doc.judul}</span>
                      <span className="text-[10px] font-mono font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/70 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-900">
                        {doc.id}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                        {doc.status || 'DITERBITKAN'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2">
                      <span>Periode: {formatDateOnly(doc.periode_awal)} s/d {formatDateOnly(doc.periode_akhir)}</span>
                      <span>·</span>
                      <span>Penyusun: {doc.penandatangan_nama}</span>
                      <span>·</span>
                      <span>{formatDateTime(doc.dibuat_pada)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleVerifyDoc(doc.id)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-xl transition-colors border border-blue-200 dark:border-blue-800/80 cursor-pointer"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>Verifikasi QR Code</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal Pengaturan Kustomisasi PDF (ExportSettingsModal) */}
      <ExportSettingsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        targetType={
          reportType === 'stock'
            ? 'STOCK_JOURNAL'
            : reportType === 'cash'
            ? 'CASH'
            : reportType === 'boq'
            ? 'BOQ'
            : 'WAREHOUSE'
        }
        title={`Pengaturan Cetak: ${
          reportType === 'stock'
            ? 'Laporan Mutasi Barang'
            : reportType === 'cash'
            ? 'Buku Kas Proyek'
            : reportType === 'boq'
            ? 'Kontrol Pemenuhan BOQ'
            : 'Stok Fisik Gudang'
        }`}
        totalOriginalCount={matchingData.count}
        initialIncludeFinancials={canViewFinancials}
        onConfirmExport={handleConfirmExport}
        currentFilterLabel={`${startDate} s/d ${endDate} · ${filterType}${searchQuery.trim() ? ` · "${searchQuery.trim()}"` : ''}`}
        currentSortLabel={`Urut: ${sortOrder}`}
      />
    </div>
  );
};
