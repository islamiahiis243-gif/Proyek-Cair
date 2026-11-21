import React, { useState, useMemo } from 'react';
import {
  FileText,
  Lock,
  CheckCircle2,
  X,
  Building2,
  Boxes,
  WalletCards,
  ArrowUpDown,
  Filter,
  Eye,
  SlidersHorizontal,
  Columns3,
  RotateCcw,
  CheckSquare,
  Square,
  ShoppingCart,
  ClipboardCheck,
  AlertTriangle,
  FileSpreadsheet,
  HelpCircle,
  Sparkles
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export type ExportTargetType = 'BOQ' | 'WAREHOUSE' | 'STOCK_JOURNAL' | 'CASH';

export interface ExportColumnDef {
  key: string;
  label: string;
  description?: string;
  isFinancial?: boolean;
  defaultSelected: boolean;
}

export interface ExportFilterScope {
  providerScope: 'ALL' | 'KONTRAKTOR' | 'IMK';
  statusScope: string;
  transactionType: 'ALL' | 'MASUK' | 'KELUAR';
  onlyRemaining: boolean;
  onlyMismatch: boolean;
  onlyActive: boolean;
  onlyPendingInvoice?: boolean;
}

export interface ExportSortConfig {
  key: string;
  dir: 'asc' | 'desc';
}

export interface ExportSettingsConfig {
  includeFinancials: boolean;
  selectedColumns: string[];
  filterScope: ExportFilterScope;
  sortConfig: ExportSortConfig;
  customTitle?: string;
  customNotes?: string;
  orientation?: 'portrait' | 'landscape';
}

export interface ExportSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: ExportTargetType;
  title: string;
  totalOriginalCount: number;
  initialIncludeFinancials?: boolean;
  currentFilterLabel?: string;
  currentSortLabel?: string;
  onConfirmExport: (config: ExportSettingsConfig) => Promise<void>;
}

export const ExportSettingsModal: React.FC<ExportSettingsModalProps> = React.memo(({
  isOpen,
  onClose,
  targetType,
  title,
  totalOriginalCount,
  initialIncludeFinancials = true,
  currentFilterLabel,
  currentSortLabel,
  onConfirmExport
}) => {
  const { activeRole, tenantBranding, user, canViewFinancials } = useApp();
  const isViewer = !canViewFinancials;
  const isFinancialLocked = !canViewFinancials;

  // Daftar Definisi Kolom berdasarkan Target
  const availableColumns = useMemo<ExportColumnDef[]>(() => {
    switch (targetType) {
      case 'BOQ':
        return [
          { key: 'kode_boq', label: 'Kode Pos BOQ', defaultSelected: true },
          { key: 'nama_barang', label: 'Uraian Material / Pekerjaan', defaultSelected: true },
          { key: 'penyedia', label: 'Pihak Penyedia (Kontraktor / Klien)', defaultSelected: true },
          { key: 'qty_boq', label: 'Target Volume BOQ', defaultSelected: true },
          { key: 'harga_satuan', label: 'Harga Satuan (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'total_kontrak', label: 'Total Nilai Kontrak (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'qty_masuk', label: 'Realisasi Masuk Gudang', defaultSelected: true },
          { key: 'qty_sisa', label: 'Sisa Belum Tiba', defaultSelected: true },
          { key: 'status', label: 'Status Pemenuhan', defaultSelected: true }
        ];
      case 'WAREHOUSE':
        return [
          { key: 'no', label: 'Nomor Urut (No)', defaultSelected: true },
          { key: 'nama_barang', label: 'Nama Material & Cakupan Pos BOQ', defaultSelected: true },
          { key: 'satuan', label: 'Satuan (UoM)', defaultSelected: true },
          { key: 'target_kebutuhan', label: 'Target Kebutuhan (BOQ)', defaultSelected: true },
          { key: 'sudah_masuk', label: 'Total Pernah Diterima (Masuk)', defaultSelected: true },
          { key: 'sisa_belum_tiba', label: 'Sisa Belum Tiba (Kekurangan)', defaultSelected: true },
          { key: 'sudah_dipakai', label: 'Sudah Dipakai / Terpasang', defaultSelected: true },
          { key: 'saldo_gudang', label: 'Sisa Stok di Gudang (Saat Ini)', defaultSelected: true },
          { key: 'harga_beli_rata_rata', label: 'Harga Beli Rata-Rata Riil (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'total_nilai_belanja_riil', label: 'Total Nilai Belanja Riil (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'status_gudang', label: 'Label Status Stok (Tersedia/Habis)', defaultSelected: false }
        ];
      case 'STOCK_JOURNAL':
        return [
          { key: 'no', label: 'Nomor Urut (No)', defaultSelected: true },
          { key: 'tanggal', label: 'Waktu Transaksi', defaultSelected: true },
          { key: 'nomor_surat_jalan', label: 'Nomor Surat Jalan / Bukti', defaultSelected: true },
          { key: 'nama_barang', label: 'Nama Material & Spesifikasi', defaultSelected: true },
          { key: 'nama_item_aktual', label: 'Item Aktual / Pengganti', defaultSelected: true },
          { key: 'jenis', label: 'Jenis Mutasi (Masuk / Keluar)', defaultSelected: true },
          { key: 'jumlah', label: 'Volume Kuantitas (QTY)', defaultSelected: true },
          { key: 'satuan', label: 'Satuan', defaultSelected: false },
          { key: 'harga_satuan_beli', label: 'Harga Nota / Satuan (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'total_harga_nota', label: 'Total Belanja Riil (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'status_harga', label: 'Status Nota (Menyusul/Belum Tahu)', defaultSelected: true },
          { key: 'tujuan_keperluan', label: 'Asal / Peruntukan / Pos BOQ', defaultSelected: true },
          { key: 'pic', label: 'PIC Petugas', defaultSelected: true },
          { key: 'status_dokumen', label: 'Status Alur Dokumen', defaultSelected: true }
        ];
      case 'CASH':
        return [
          { key: 'no', label: 'Nomor Urut (No)', defaultSelected: true },
          { key: 'tanggal', label: 'Waktu Transaksi', defaultSelected: true },
          { key: 'nomor_kuitansi', label: 'Nomor Kuitansi / Bukti', defaultSelected: true },
          { key: 'untuk_apa', label: 'Peruntukan / Keperluan Kas', defaultSelected: true },
          { key: 'kategori_keperluan', label: 'Kategori Keperluan', defaultSelected: true },
          { key: 'jenis', label: 'Jenis Kas (Masuk / Keluar)', defaultSelected: true },
          { key: 'jumlah_rp', label: 'Nominal Dana (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'saldo_setelah', label: 'Saldo Kas Setelahnya (Rp)', isFinancial: true, defaultSelected: canViewFinancials },
          { key: 'pic', label: 'PIC Penanggung Jawab', defaultSelected: true },
          { key: 'status_dokumen', label: 'Status Alur Dokumen', defaultSelected: true }
        ];
    }
  }, [targetType, canViewFinancials]);

  // Pilihan Kolom Sortir Berdasarkan Target
  const sortOptions = useMemo(() => {
    switch (targetType) {
      case 'BOQ':
        return [
          { key: 'default', label: 'Hierarki Dokumen Asli (Sesuai Urutan BOQ)' },
          { key: 'nama_barang', label: 'Nama Material / Pekerjaan' },
          { key: 'kode_boq', label: 'Kode Pos BOQ' },
          { key: 'qty_boq', label: 'Volume Target BOQ' },
          { key: 'qty_masuk', label: 'Realisasi Masuk' },
          { key: 'qty_sisa', label: 'Sisa Belum Tiba (Kekurangan)' },
          ...(!isViewer ? [{ key: 'total_kontrak', label: 'Total Nilai Kontrak (Rp)' }] : [])
        ];
      case 'WAREHOUSE':
        return [
          { key: 'default', label: 'Sesuai Sortir Layar Saat Ini' },
          { key: 'nama_barang', label: 'Nama Material' },
          { key: 'target_kebutuhan', label: 'Target Kebutuhan (BOQ)' },
          { key: 'sudah_masuk', label: 'Total Pernah Diterima (Masuk)' },
          { key: 'saldo_gudang', label: 'Sisa Stok di Gudang (Saat Ini)' },
          { key: 'sisa_belum_tiba', label: 'Sisa Belum Tiba (Kekurangan)' },
          ...(!isViewer ? [
            { key: 'harga_beli_rata_rata', label: 'Harga Beli Rata-Rata (Rp)' },
            { key: 'total_nilai_belanja_riil', label: 'Total Nilai Belanja Riil (Rp)' }
          ] : [])
        ];
      case 'STOCK_JOURNAL':
        return [
          { key: 'default', label: 'Sesuai Sortir Layar Saat Ini' },
          { key: 'tanggal', label: 'Waktu Transaksi' },
          { key: 'nama_barang', label: 'Nama Material' },
          { key: 'jumlah', label: 'Volume (QTY)' },
          { key: 'nomor_surat_jalan', label: 'Nomor Surat Jalan' }
        ];
      case 'CASH':
        return [
          { key: 'default', label: 'Sesuai Sortir Layar Saat Ini' },
          { key: 'tanggal', label: 'Waktu Transaksi' },
          { key: 'jumlah_rp', label: 'Nominal Dana (Rp)' },
          { key: 'kategori_keperluan', label: 'Kategori Keperluan' }
        ];
    }
  }, [targetType, isViewer]);

  // State 1: Kolom yang Dipilih
  const [selectedColumns, setSelectedColumns] = useState<string[]>(() => {
    return availableColumns.filter(c => c.defaultSelected).map(c => c.key);
  });

  // State 2: Finansial Nominal Toggle (Locked if isViewer)
  const [includeFinancials, setIncludeFinancials] = useState<boolean>(() => {
    if (isViewer) return false;
    return initialIncludeFinancials;
  });

  // State 3: Filter Scope (FROM, WHERE)
  const [providerScope, setProviderScope] = useState<'ALL' | 'KONTRAKTOR' | 'IMK'>('ALL');
  const [statusScope, setStatusScope] = useState<string>('ALL');
  const [transactionType, setTransactionType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [onlyRemaining, setOnlyRemaining] = useState<boolean>(false);
  const [onlyMismatch, setOnlyMismatch] = useState<boolean>(false);
  const [onlyActive, setOnlyActive] = useState<boolean>(true);
  const [onlyPendingInvoice, setOnlyPendingInvoice] = useState<boolean>(false);

  // State 4: Sortir Kolom & Arah
  const [sortKey, setSortKey] = useState<string>('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // State 5: Kop Dokumen, Orientasi & Catatan Kaki
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('landscape');
  const [customTitle, setCustomTitle] = useState<string>('');
  const [customNotes, setCustomNotes] = useState<string>('');
  const [activeProfile, setActiveProfile] = useState<string>('MANAJEMEN_FULL');
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  if (!isOpen) return null;

  // 1-KLIK PRESET PROFIL DOKUMEN CEPAT
  const applyPresetProfile = (profileKey: 'TOKO_PO' | 'KONSULTAN_PROGRES' | 'KLIEN_KENDALA' | 'MANAJEMEN_FULL') => {
    setActiveProfile(profileKey);

    if (profileKey === 'TOKO_PO') {
      // PROFIL: ORDER TOKO / SUPPLIER (Anti Over-Budget)
      setProviderScope('KONTRAKTOR');
      setOnlyRemaining(true);
      setStatusScope('ALL');
      setIncludeFinancials(false);
      setCustomTitle('SURAT PESANAN MATERIAL (PURCHASE ORDER)');
      setCustomNotes('Mohon siapkan hanya volume kekurangan yang tertera ke alamat proyek.');

      if (targetType === 'BOQ') {
        setSelectedColumns(['kode_boq', 'nama_barang', 'qty_sisa', 'status']);
      } else if (targetType === 'WAREHOUSE') {
        setSelectedColumns(['no', 'nama_barang', 'satuan', 'sisa_belum_tiba']);
      }
    } else if (profileKey === 'KONSULTAN_PROGRES') {
      // PROFIL: PROGRES FISIK KONSULTAN
      setProviderScope('KONTRAKTOR');
      setOnlyRemaining(false);
      setStatusScope('HAS_ARRIVED');
      setIncludeFinancials(false);
      setCustomTitle('LAPORAN REALISASI FISIK MATERIAL KONTRAKTOR');
      setCustomNotes('Laporan capaian pengadaan dan realisasi material fisik di lapangan.');

      if (targetType === 'BOQ') {
        setSelectedColumns(['kode_boq', 'nama_barang', 'qty_boq', 'qty_masuk', 'qty_sisa', 'status']);
      } else if (targetType === 'WAREHOUSE') {
        setSelectedColumns(['no', 'nama_barang', 'satuan', 'target_kebutuhan', 'sudah_masuk', 'sisa_belum_tiba']);
      }
    } else if (profileKey === 'KLIEN_KENDALA') {
      // PROFIL: PEMBELAAN KONTRAKTOR / KENDALA MATERIAL KLIEN
      setProviderScope('IMK');
      setOnlyRemaining(true);
      setStatusScope('ALL');
      setIncludeFinancials(false);
      setCustomTitle('LAPORAN KENDALA PENYEDIAAN MATERIAL OLEH KLIEN');
      setCustomNotes('Material berikut merupakan jatah penyediaan klien yang belum tiba di lapangan dan berpotensi menghambat target penyelesaian.');

      if (targetType === 'BOQ') {
        setSelectedColumns(['kode_boq', 'nama_barang', 'penyedia', 'qty_boq', 'qty_masuk', 'qty_sisa', 'status']);
      } else if (targetType === 'WAREHOUSE') {
        setSelectedColumns(['no', 'nama_barang', 'satuan', 'target_kebutuhan', 'sudah_masuk', 'sisa_belum_tiba']);
      }
    } else {
      // PROFIL: REKAPITULASI LENGKAP MANAJEMEN
      setProviderScope('ALL');
      setOnlyRemaining(false);
      setStatusScope('ALL');
      setIncludeFinancials(!isViewer);
      setCustomTitle('');
      setCustomNotes('');
      setSelectedColumns(availableColumns.filter(c => c.defaultSelected && !(isViewer && c.isFinancial)).map(c => c.key));
    }
  };

  // Toggle Pilihan Kolom Mandiri
  const handleToggleColumn = (colKey: string, isFinancial?: boolean) => {
    if (isViewer && isFinancial) return; // Locked for viewer
    setSelectedColumns(prev => {
      if (prev.includes(colKey)) {
        if (prev.length <= 1) return prev; // Minimal 1 kolom harus dipilih
        return prev.filter(k => k !== colKey);
      } else {
        return [...prev, colKey];
      }
    });
  };

  const handleSelectAllColumns = () => {
    const all = availableColumns
      .filter(c => !(isViewer && c.isFinancial))
      .map(c => c.key);
    setSelectedColumns(all);
  };

  const handleResetColumns = () => {
    const def = availableColumns
      .filter(c => c.defaultSelected && !(isViewer && c.isFinancial))
      .map(c => c.key);
    setSelectedColumns(def);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    // Berikan jeda sejenak agar browser sempat merender status tombol "Memproses PDF..."
    await new Promise((resolve) => setTimeout(resolve, 40));

    try {
      const safeIncludeFinancials = isViewer ? false : includeFinancials;
      const finalColumns = selectedColumns.filter(c => {
        if (!safeIncludeFinancials) {
          const colDef = availableColumns.find(def => def.key === c);
          if (colDef?.isFinancial) return false;
        }
        return true;
      });

      await onConfirmExport({
        includeFinancials: safeIncludeFinancials,
        selectedColumns: finalColumns,
        filterScope: {
          providerScope,
          statusScope,
          transactionType,
          onlyRemaining,
          onlyMismatch,
          onlyActive,
          onlyPendingInvoice
        },
        sortConfig: {
          key: sortKey,
          dir: sortDir
        },
        customTitle: customTitle.trim() || undefined,
        customNotes: customNotes.trim() || undefined,
        orientation
      });
      onClose();
    } catch (err) {
      console.error('Error confirming export:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getTargetIcon = () => {
    switch (targetType) {
      case 'BOQ':
        return <Building2 className="w-5 h-5 text-blue-500" />;
      case 'WAREHOUSE':
        return <Boxes className="w-5 h-5 text-emerald-500" />;
      case 'STOCK_JOURNAL':
        return <FileText className="w-5 h-5 text-indigo-500" />;
      case 'CASH':
        return <WalletCards className="w-5 h-5 text-emerald-500" />;
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto"
    >
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col my-auto transition-colors">
        {/* Header Modal */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 shrink-0">
              {getTargetIcon()}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h2 id="export-modal-title" className="text-base font-bold text-slate-900 dark:text-white truncate">
                  Studio Ekspor Dokumen PDF
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                  <Sparkles className="w-2.5 h-2.5" /> Sistem Terpadu
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-0.5 truncate">
                {title} · {totalOriginalCount} data aktif
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Konten Form Studio */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto max-h-[70vh]">
          {/* BAGIAN 1: PROFIL CEPAT DOKUMEN (1-KLIK SHORTCUT) */}
          {(targetType === 'BOQ' || targetType === 'WAREHOUSE') && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Pilih Profil Cepat Dokumen:</span>
                </label>
                <span className="text-[11px] text-slate-600 dark:text-slate-300">
                  1-klik otomatis mengatur pihak, kondisi & kolom
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <button
                  type="button"
                  onClick={() => applyPresetProfile('TOKO_PO')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    activeProfile === 'TOKO_PO'
                      ? 'border-blue-500 bg-blue-50/80 dark:bg-blue-950/60 shadow-xs ring-1 ring-blue-500'
                      : 'border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <ShoppingCart className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">Order Toko</span>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-tight line-clamp-2">
                    Kontraktor Saja · Sisa Kurang · 0 Rp
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => applyPresetProfile('KONSULTAN_PROGRES')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    activeProfile === 'KONSULTAN_PROGRES'
                      ? 'border-emerald-500 bg-emerald-50/80 dark:bg-emerald-950/60 shadow-xs ring-1 ring-emerald-500'
                      : 'border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">Progres Konsultan</span>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-tight line-clamp-2">
                    Kontraktor Saja · Realisasi Masuk
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => applyPresetProfile('KLIEN_KENDALA')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    activeProfile === 'KLIEN_KENDALA'
                      ? 'border-amber-500 bg-amber-50/80 dark:bg-amber-950/60 shadow-xs ring-1 ring-amber-500'
                      : 'border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">Kendala Klien</span>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-tight line-clamp-2">
                    Jatah Klien · Sisa Belum Tiba
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => applyPresetProfile('MANAJEMEN_FULL')}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
                    activeProfile === 'MANAJEMEN_FULL'
                      ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/60 shadow-xs ring-1 ring-indigo-500'
                      : 'border-slate-200 dark:border-slate-700/80 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                    <span className="text-xs font-bold text-slate-900 dark:text-white truncate">Lengkap</span>
                  </div>
                  <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 leading-tight line-clamp-2">
                    Semua Pihak & Status Dokumen
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* BAGIAN 2: KUERI DATA VISUAL (FROM, WHERE) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 pt-1">
            {/* BLOK A: PIHAK PENANGGUNG JAWAB (FROM) */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 inline-flex items-center justify-center text-[10px] font-black">1</span>
                  Pihak Penyedia / Penanggung Jawab:
                </span>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  { id: 'KONTRAKTOR', label: 'Kontraktor Saja', sub: tenantBranding.contractorName },
                  { id: 'IMK', label: 'Jatah Klien', sub: tenantBranding.clientName },
                  { id: 'ALL', label: 'Semua Pihak', sub: 'Gabungan' }
                ].map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setProviderScope(p.id as any);
                      setActiveProfile('CUSTOM');
                    }}
                    className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      providerScope === p.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-900 dark:text-blue-100 shadow-xs ring-1 ring-blue-500 font-bold'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                    }`}
                  >
                    <div className="text-xs truncate">{p.label}</div>
                    <div className="text-[10px] text-slate-400 font-normal truncate mt-0.5">{p.sub}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* BLOK B: KONDISI & STATUS BARANG (WHERE) */}
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <span className="w-5 h-5 rounded-md bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 inline-flex items-center justify-center text-[10px] font-black">2</span>
                  Kondisi Kuantitas & Pemenuhan:
                </span>
              </div>

              {(targetType === 'BOQ' || targetType === 'WAREHOUSE') ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'ALL', label: 'Semua Kondisi', sub: 'Semua item' },
                      { id: 'REMAINING', label: 'Hanya Sisa Kurang', sub: 'Sisa > 0' },
                      { id: 'ARRIVED', label: 'Sudah Masuk', sub: 'Realisasi > 0' }
                    ].map(c => {
                      const isSelected =
                        c.id === 'ALL'
                          ? !onlyRemaining && statusScope === 'ALL'
                          : c.id === 'REMAINING'
                          ? onlyRemaining
                          : statusScope === 'HAS_ARRIVED';

                      return (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => {
                            if (c.id === 'REMAINING') {
                              setOnlyRemaining(true);
                              setStatusScope('ALL');
                            } else if (c.id === 'ARRIVED') {
                              setOnlyRemaining(false);
                              setStatusScope('HAS_ARRIVED');
                            } else {
                              setOnlyRemaining(false);
                              setStatusScope('ALL');
                            }
                            setActiveProfile('CUSTOM');
                          }}
                          className={`p-2 rounded-lg border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 shadow-xs ring-1 ring-emerald-500 font-bold'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                          }`}
                        >
                          <div className="text-xs truncate">{c.label}</div>
                          <div className="text-[10px] text-slate-400 font-normal truncate mt-0.5">{c.sub}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-3 gap-1.5">
                    {[
                      { id: 'ALL', label: 'Semua Arah' },
                      { id: 'MASUK', label: 'Masuk Saja (IN)' },
                      { id: 'KELUAR', label: 'Keluar Saja (OUT)' }
                    ].map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTransactionType(t.id as any)}
                        className={`p-2 rounded-lg border text-xs font-semibold text-center transition-all cursor-pointer truncate ${
                          transactionType === t.id
                            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-100 shadow-xs ring-1 ring-emerald-500'
                            : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-800'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {targetType === 'STOCK_JOURNAL' && (
                    <label className="flex items-center gap-2 pt-1 text-xs text-slate-700 dark:text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={onlyPendingInvoice}
                        onChange={(e) => setOnlyPendingInvoice(e.target.checked)}
                        className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                      />
                      <span className="font-semibold text-amber-900 dark:text-amber-200">
                        Hanya Tampilkan Nota Menyusul / Belum Ada Harga
                      </span>
                    </label>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* BAGIAN 3: PILIHAN KOLOM YANG DICETAK (SELECT) */}
          <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-md bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 inline-flex items-center justify-center text-[10px] font-black">3</span>
                Pilihan Kolom Dokumen ({selectedColumns.length} Kolom Aktif):
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSelectAllColumns}
                  className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                >
                  Pilih Semua
                </button>
                <span className="text-slate-300 dark:text-slate-700">·</span>
                <button
                  type="button"
                  onClick={handleResetColumns}
                  className="text-[11px] font-semibold text-slate-500 hover:underline cursor-pointer"
                >
                  Standar
                </button>
              </div>
            </div>

            {/* Sakelar Nominal Finansial Khusus */}
            <div className="rounded-xl p-3 border transition-all bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 dark:text-white">
                      Sertakan Kolom & Nilai Finansial (Rp)
                    </span>
                    {isViewer ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                        <Lock className="w-3 h-3" /> Terkunci (Wewenang Terbatas)
                      </span>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-medium">
                        (Harga Satuan & Anggaran Kontrak)
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                    {isViewer
                      ? 'Wewenang Pengamat murni data fisik kuantitas (UoM). Kolom harga satuan dan total nilai rupiah terkunci aman nonaktif.'
                      : includeFinancials
                      ? 'Dokumen memuat harga satuan dan total nilai rupiah (format resmi komersial/manajemen).'
                      : 'Dokumen dicetak murni data fisik (tanpa kolom harga satuan & rupiah) yang aman dibagikan langsung ke toko, mandor, dan staf lapangan.'}
                  </p>
                </div>

                <div className="shrink-0 pt-0.5">
                  {isViewer ? (
                    <div className="w-10 h-6 rounded-full bg-slate-200 dark:bg-slate-700 opacity-60 flex items-center px-1 cursor-not-allowed">
                      <div className="w-4 h-4 rounded-full bg-white shadow-xs flex items-center justify-center">
                        <Lock className="w-2.5 h-2.5 text-slate-500" />
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={includeFinancials}
                      onClick={() => {
                        setIncludeFinancials(v => !v);
                        setActiveProfile('CUSTOM');
                      }}
                      className={`w-11 h-6 rounded-full transition-colors relative focus:outline-none focus:ring-2 focus:ring-blue-500/40 cursor-pointer ${
                        includeFinancials ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'
                      }`}
                    >
                      <span
                        className={`block w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${
                          includeFinancials ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Grid Checkbox Kolom */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {availableColumns.map(col => {
                const isChecked = selectedColumns.includes(col.key);
                const isFinancialLocked = isViewer && col.isFinancial;

                return (
                  <div
                    key={col.key}
                    onClick={() => {
                      if (!isFinancialLocked) {
                        handleToggleColumn(col.key, col.isFinancial);
                        setActiveProfile('CUSTOM');
                      }
                    }}
                    className={`p-2 rounded-xl border flex items-center justify-between gap-2 transition-all select-none ${
                      isFinancialLocked
                        ? 'border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-800/20 opacity-50 cursor-not-allowed'
                        : isChecked
                        ? 'border-indigo-500/60 bg-indigo-50/40 dark:bg-indigo-950/30 text-indigo-950 dark:text-indigo-100 cursor-pointer shadow-xs font-semibold'
                        : 'border-slate-200 dark:border-slate-700/70 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {isFinancialLocked ? (
                        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      ) : isChecked ? (
                        <CheckSquare className="w-3.5 h-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                      ) : (
                        <Square className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      <span className="text-xs truncate">
                        {col.label}
                      </span>
                    </div>
                    {col.isFinancial && (
                      <span className="text-[9px] font-bold text-amber-600 dark:text-amber-400 shrink-0 px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60">
                        Rp
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Pilihan Orientasi Kertas PDF */}
            <div className="rounded-xl p-3 border bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 mt-2">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                  <Columns3 className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Orientasi Halaman PDF:</span>
                </span>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {orientation === 'landscape'
                    ? 'Lanskap (Mendatar · 297mm) — Tabel sangat lega, bebas terpotong, dan rapi untuk multi-kolom.'
                    : 'Potret (Tegak · 210mm) — Format standar dokumen vertikal.'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setOrientation('landscape')}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    orientation === 'landscape'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>⬌ Lanskap</span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 font-bold">Rekomendasi</span>
                </button>
                <button
                  type="button"
                  onClick={() => setOrientation('portrait')}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer ${
                    orientation === 'portrait'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 ring-1 ring-blue-500 shadow-xs'
                      : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>⬍ Potret</span>
                </button>
              </div>
            </div>
          </div>

          {/* BAGIAN 4: KOP JUDUL DOKUMEN & PENGATURAN TAMBAHAN (ACCORDION) */}
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="w-full flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/30 text-xs font-bold text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/60 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-2">
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-500" />
                <span>Pengaturan Kop Judul, Sortir & Catatan Kaki</span>
              </span>
              <span className="text-[11px] text-blue-600 dark:text-blue-400 font-semibold">
                {showAdvanced ? 'Tutup ▲' : 'Buka Pengaturan ▼'}
              </span>
            </button>

            {showAdvanced && (
              <div className="p-3.5 space-y-3 bg-white dark:bg-slate-900 animate-in fade-in duration-100">
                {/* Judul Dokumen Kustom */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Judul Utama Dokumen PDF:
                  </label>
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="Contoh: SURAT PESANAN MATERIAL (PURCHASE ORDER)"
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <p className="text-[10px] text-slate-600 dark:text-slate-300">
                    Kosongkan jika ingin menggunakan judul resmi bawaan sistem.
                  </p>
                </div>

                {/* Urutan Baris (Sortir) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Urutkan Berdasarkan:
                    </label>
                    <select
                      value={sortKey}
                      onChange={(e) => setSortKey(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    >
                      {sortOptions.map(opt => (
                        <option key={opt.key} value={opt.key}>{opt.label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                      Arah Urutan:
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => setSortDir('asc')}
                        className={`px-3 py-2 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                          sortDir === 'asc'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Naik (A-Z / Kecil)
                      </button>
                      <button
                        type="button"
                        onClick={() => setSortDir('desc')}
                        className={`px-3 py-2 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                          sortDir === 'desc'
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Turun (Z-A / Besar)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Catatan Kaki Dokumen */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Catatan Kaki Dokumen (Instruksi Khusus untuk Penerima):
                  </label>
                  <input
                    type="text"
                    value={customNotes}
                    onChange={(e) => setCustomNotes(e.target.value)}
                    placeholder="Contoh: Mohon barang dikirim ke alamat Jl. Melati No. 12 paling lambat Senin pagi."
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* BAGIAN 5: LIVE STATUS BAR & SUMMARY STRIP */}
          <div className="rounded-xl p-3 border border-blue-200/80 dark:border-blue-800/60 bg-blue-50/60 dark:bg-blue-950/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 text-xs text-blue-900 dark:text-blue-200">
              <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <div className="font-medium">
                <span className="font-bold">Format Siap: </span>
                <span>
                  {providerScope === 'KONTRAKTOR' ? 'Tanggungan Kontraktor' : providerScope === 'IMK' ? 'Jatah Klien' : 'Semua Pihak'}
                </span>
                <span> · </span>
                <span>{onlyRemaining ? 'Hanya Sisa Kurang (>0)' : statusScope === 'HAS_ARRIVED' ? 'Hanya yang Masuk' : 'Semua Status'}</span>
                <span> · </span>
                <span className="font-bold">{selectedColumns.length} Kolom</span>
                <span> · </span>
                <span className={includeFinancials && !isViewer ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'font-bold text-blue-700 dark:text-blue-300'}>
                  {includeFinancials && !isViewer ? 'Dengan Nominal Rp' : 'Format Murni Fisik (Tanpa Rp)'}
                </span>
              </div>
            </div>

            <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400 shrink-0">
              Dokumen Resmi Ber-QR
            </div>
          </div>

          {/* Tombol Aksi */}
          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || selectedColumns.length === 0}
              className="px-5 py-2.5 text-xs font-bold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-md shadow-blue-500/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Memproses PDF...</span>
                </>
              ) : (
                <>
                  <FileText className="w-4 h-4" />
                  <span>Unduh Dokumen PDF</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});

ExportSettingsModal.displayName = 'ExportSettingsModal';
