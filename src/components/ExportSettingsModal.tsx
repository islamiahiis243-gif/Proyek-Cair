import React, { useState, useMemo } from 'react';
import {
  FileText,
  Lock,
  CheckCircle2,
  X,
  Download,
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
  ArrowUp,
  ArrowDown
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
  customNotes?: string;
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
  const { activeRole, tenantBranding, user } = useApp();
  const isViewer = activeRole === 'Viewer/Pengamat';

  // Daftar Definisi Kolom berdasarkan Target
  const availableColumns = useMemo<ExportColumnDef[]>(() => {
    switch (targetType) {
      case 'BOQ':
        return [
          { key: 'kode_boq', label: 'Kode Pos BOQ', defaultSelected: true },
          { key: 'nama_barang', label: 'Uraian Material / Pekerjaan', defaultSelected: true },
          { key: 'penyedia', label: 'Pihak Penyedia (Kontraktor / Klien)', defaultSelected: true },
          { key: 'qty_boq', label: 'Target Volume BOQ', defaultSelected: true },
          { key: 'harga_satuan', label: 'Harga Satuan (Rp)', isFinancial: true, defaultSelected: !isViewer },
          { key: 'total_kontrak', label: 'Total Nilai Kontrak (Rp)', isFinancial: true, defaultSelected: !isViewer },
          { key: 'qty_masuk', label: 'Realisasi Masuk Gudang', defaultSelected: true },
          { key: 'qty_sisa', label: 'Sisa Belum Tiba', defaultSelected: true },
          { key: 'status', label: 'Status Pemenuhan', defaultSelected: true }
        ];
      case 'WAREHOUSE':
        return [
          { key: 'no', label: 'Nomor Urut (No)', defaultSelected: true },
          { key: 'nama_barang', label: 'Nama Material & Cakupan Pos BOQ', defaultSelected: true },
          { key: 'satuan', label: 'Satuan', defaultSelected: true },
          { key: 'target_kebutuhan', label: 'Kebutuhan Proyek (BOQ)', defaultSelected: true },
          { key: 'sudah_masuk', label: 'Realisasi Masuk Gudang', defaultSelected: true },
          { key: 'sisa_belum_tiba', label: 'Sisa Belum Tiba', defaultSelected: true },
          { key: 'sudah_dipakai', label: 'Sudah Dipakai / Keluar', defaultSelected: true },
          { key: 'saldo_gudang', label: 'Saldo Fisik di Gudang', defaultSelected: true },
          { key: 'status_gudang', label: 'Status Ketersediaan Gudang', defaultSelected: true }
        ];
      case 'STOCK_JOURNAL':
        return [
          { key: 'no', label: 'Nomor Urut (No)', defaultSelected: true },
          { key: 'tanggal', label: 'Waktu Transaksi', defaultSelected: true },
          { key: 'nomor_surat_jalan', label: 'Nomor Surat Jalan / Ref', defaultSelected: true },
          { key: 'nama_barang', label: 'Nama Material & Spesifikasi', defaultSelected: true },
          { key: 'jenis', label: 'Jenis Mutasi (Masuk / Keluar)', defaultSelected: true },
          { key: 'jumlah', label: 'Volume Kuantitas (QTY)', defaultSelected: true },
          { key: 'satuan', label: 'Satuan', defaultSelected: false },
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
          { key: 'jumlah_rp', label: 'Nominal Dana (Rp)', isFinancial: true, defaultSelected: true },
          { key: 'saldo_setelah', label: 'Saldo Kas Setelahnya (Rp)', isFinancial: true, defaultSelected: true },
          { key: 'pic', label: 'PIC Penanggung Jawab', defaultSelected: true },
          { key: 'status_dokumen', label: 'Status Alur Dokumen', defaultSelected: true }
        ];
    }
  }, [targetType, isViewer]);

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
          { key: 'qty_sisa', label: 'Sisa Belum Tiba' },
          ...(!isViewer ? [{ key: 'total_kontrak', label: 'Total Nilai Kontrak (Rp)' }] : [])
        ];
      case 'WAREHOUSE':
        return [
          { key: 'default', label: 'Sesuai Sortir Layar Saat Ini' },
          { key: 'nama_barang', label: 'Nama Material' },
          { key: 'target_kebutuhan', label: 'Kebutuhan Proyek (BOQ)' },
          { key: 'sudah_masuk', label: 'Realisasi Masuk Gudang' },
          { key: 'saldo_gudang', label: 'Saldo Tersedia di Gudang' },
          { key: 'sisa_belum_tiba', label: 'Sisa Belum Tiba' }
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

  // State 3: Filter Scope
  const [providerScope, setProviderScope] = useState<'ALL' | 'KONTRAKTOR' | 'IMK'>('ALL');
  const [statusScope, setStatusScope] = useState<string>('ALL');
  const [transactionType, setTransactionType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [onlyRemaining, setOnlyRemaining] = useState<boolean>(false);
  const [onlyMismatch, setOnlyMismatch] = useState<boolean>(false);
  const [onlyActive, setOnlyActive] = useState<boolean>(true);

  // State 4: Sortir Kolom & Arah
  const [sortKey, setSortKey] = useState<string>('default');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // State 5: Catatan Kaki Dokumen
  const [customNotes, setCustomNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Tab Menu Aktif dalam Modal
  const [activeTab, setActiveTab] = useState<'COLUMNS' | 'FILTERS' | 'SORT'>('COLUMNS');

  if (!isOpen) return null;

  // Toggle Pilihan Kolom
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
    await new Promise((resolve) => setTimeout(resolve, 50));

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
          onlyActive
        },
        sortConfig: {
          key: sortKey,
          dir: sortDir
        },
        customNotes: customNotes.trim() || undefined
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
      <div className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col my-auto transition-colors">
        {/* Header Modal */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 shrink-0">
              {getTargetIcon()}
            </div>
            <div className="min-w-0">
              <h2 id="export-modal-title" className="text-sm font-bold text-slate-900 dark:text-white truncate">
                Pengaturan Ekspor Dokumen PDF
              </h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium mt-0.5 truncate">
                {title} · {totalOriginalCount} baris data awal
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup dialog"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigasi Pengaturan (Kolom / Filter / Sortir) */}
        <div className="flex items-center border-b border-slate-100 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-800/30 px-3 sm:px-5 gap-1.5 sm:gap-2 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('COLUMNS')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all cursor-pointer ${
              activeTab === 'COLUMNS'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Columns3 className="w-3.5 h-3.5" />
            <span>Pilih Kolom ({selectedColumns.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('FILTERS')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all cursor-pointer ${
              activeTab === 'FILTERS'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Filter Data</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('SORT')}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-bold rounded-t-xl border-b-2 transition-all cursor-pointer ${
              activeTab === 'SORT'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-white dark:bg-slate-900 shadow-xs'
                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ArrowUpDown className="w-3.5 h-3.5" />
            <span>Sortir Laporan</span>
          </button>
        </div>

        {/* Konten Form */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-5 space-y-4 overflow-y-auto max-h-[65vh]">
          {/* TAB 1: PILIH KOLOM DOKUMEN */}
          {activeTab === 'COLUMNS' && (
            <div className="space-y-3 animate-in fade-in duration-100">
              <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs font-bold text-slate-900 dark:text-white">
                  Centang kolom yang ingin dimasukkan ke dalam dokumen PDF:
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
              <div className="rounded-xl p-3 border transition-all bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700/80">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">
                        Sertakan Kolom & Nilai Finansial (Rp)
                      </span>
                      {isViewer ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                          <Lock className="w-3 h-3" /> Terkunci
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 font-medium">
                          (Harga Satuan & Anggaran Kontrak)
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">
                      {isViewer
                        ? 'Wewenang Pengamat Lapangan dibatasi murni data fisik (QTY). Kolom harga satuan dan total nilai rupiah terkunci nonaktif.'
                        : includeFinancials
                        ? 'Dokumen memuat kolom harga satuan, subtotal anggaran pos, dan total nilai kontrak (format resmi komersial/manajemen).'
                        : 'Dokumen dicetak murni data fisik (tanpa kolom harga satuan & rupiah) yang aman dibagikan langsung ke mandor dan pekerja lapangan.'}
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
                        onClick={() => setIncludeFinancials(v => !v)}
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
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                {availableColumns.map(col => {
                  const isChecked = selectedColumns.includes(col.key);
                  const isFinancialLocked = isViewer && col.isFinancial;

                  return (
                    <div
                      key={col.key}
                      onClick={() => !isFinancialLocked && handleToggleColumn(col.key, col.isFinancial)}
                      className={`p-2.5 rounded-xl border flex items-center justify-between gap-2.5 transition-all select-none ${
                        isFinancialLocked
                          ? 'border-slate-200 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-800/20 opacity-50 cursor-not-allowed'
                          : isChecked
                          ? 'border-blue-500/60 bg-blue-50/40 dark:bg-blue-950/30 text-blue-950 dark:text-blue-100 cursor-pointer shadow-xs'
                          : 'border-slate-200 dark:border-slate-700/70 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-slate-700 dark:text-slate-300 cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {isFinancialLocked ? (
                          <Lock className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : isChecked ? (
                          <CheckSquare className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                        ) : (
                          <Square className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                        <span className="text-xs font-semibold truncate">
                          {col.label}
                        </span>
                      </div>
                      {col.isFinancial && (
                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 shrink-0 px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-900/60">
                          Rp
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: FILTER & SARINGAN DATA */}
          {activeTab === 'FILTERS' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              {/* Filter Khusus BOQ */}
              {targetType === 'BOQ' && (
                <>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Saring Pihak Penyedia Material:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'ALL', label: 'Semua Penyedia' },
                        { id: 'KONTRAKTOR', label: `Kontraktor (${tenantBranding.contractorName})` },
                        { id: 'IMK', label: `Klien (${tenantBranding.clientName})` }
                      ].map(p => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setProviderScope(p.id as any)}
                          className={`p-2.5 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer truncate ${
                            providerScope === p.id
                              ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 shadow-xs ring-1 ring-blue-500/20'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Saring Status Pemenuhan Material:
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'ALL', label: 'Semua Status' },
                        { id: 'LENGKAP', label: 'Lengkap (100%)' },
                        { id: 'BELUM_LENGKAP', label: 'Belum Lengkap' },
                        { id: 'BELUM_TIBA', label: 'Belum Tiba (0%)' }
                      ].map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStatusScope(s.id)}
                          className={`p-2 rounded-xl border text-xs font-medium text-center transition-all cursor-pointer truncate ${
                            statusScope === s.id
                              ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 shadow-xs ring-1 ring-blue-500/20 font-bold'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={onlyRemaining}
                        onChange={(e) => setOnlyRemaining(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        Hanya tampilkan material yang masih ada sisa / kekurangan belum tiba (Sisa &gt; 0)
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* Filter Khusus Rekap Gudang */}
              {targetType === 'WAREHOUSE' && (
                <>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Saring Status Ketersediaan Stok Gudang:
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'ALL', label: 'Semua Material' },
                        { id: 'HAS_STOCK', label: 'Tersedia di Gudang (>0)' },
                        { id: 'HAS_ARRIVED', label: 'Sudah Ada Masuk' },
                        { id: 'NOT_ARRIVED', label: 'Belum Pernah Masuk (0)' }
                      ].map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setStatusScope(s.id)}
                          className={`p-2.5 rounded-xl border text-xs font-medium text-center transition-all cursor-pointer truncate ${
                            statusScope === s.id
                              ? 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-100 shadow-xs ring-1 ring-emerald-500/20 font-bold'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={onlyMismatch}
                        onChange={(e) => setOnlyMismatch(e.target.checked)}
                        className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                      />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        Hanya tampilkan material dengan catatan selisih penyedia / talangan kontraktor
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* Filter Khusus Mutasi Stok & Kas */}
              {(targetType === 'STOCK_JOURNAL' || targetType === 'CASH') && (
                <>
                  <div className="space-y-2">
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Saring Arah Jenis Transaksi:
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: 'ALL', label: 'Semua Transaksi' },
                        { id: 'MASUK', label: 'Masuk Saja (IN)' },
                        { id: 'KELUAR', label: 'Keluar Saja (OUT)' }
                      ].map(t => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setTransactionType(t.id as any)}
                          className={`p-2.5 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer truncate ${
                            transactionType === t.id
                              ? 'border-indigo-500 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-100 shadow-xs ring-1 ring-indigo-500/20'
                              : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/30">
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={onlyActive}
                        onChange={(e) => setOnlyActive(e.target.checked)}
                        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <span className="text-xs font-semibold text-slate-900 dark:text-white">
                        Abaikan transaksi yang berstatus BATAL atau DIGANTI (Hanya transaksi valid)
                      </span>
                    </label>
                  </div>
                </>
              )}

              {/* Status Filter Aktif di Layar */}
              {currentFilterLabel && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200/60 dark:border-slate-700/50">
                  Filter aktif di layar utama: <strong>{currentFilterLabel}</strong>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SORTIR LAPORAN (KOLOM & ARAH) */}
          {activeTab === 'SORT' && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  Pilih Kolom Acuan Sortir (Urutkan Berdasarkan):
                </label>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white font-medium focus:ring-2 focus:ring-blue-500/20"
                >
                  {sortOptions.map(opt => (
                    <option key={opt.key} value={opt.key}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  Arah Urutan Penyusunan:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setSortDir('asc')}
                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                      sortDir === 'asc'
                        ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500/20 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ArrowUp className="w-4 h-4 text-blue-500" />
                    <span>Naik (A-Z / Terkecil / Terlama)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setSortDir('desc')}
                    className={`p-3 rounded-xl border flex items-center justify-center gap-2 text-xs font-bold transition-all cursor-pointer ${
                      sortDir === 'desc'
                        ? 'border-blue-500 bg-blue-50/60 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500/20 shadow-xs'
                        : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <ArrowDown className="w-4 h-4 text-blue-500" />
                    <span>Turun (Z-A / Terbesar / Terbaru)</span>
                  </button>
                </div>
              </div>

              {currentSortLabel && (
                <div className="text-[11px] text-slate-500 dark:text-slate-400 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200/60 dark:border-slate-700/50">
                  Urutan aktif di layar: <strong>{currentSortLabel}</strong>
                </div>
              )}
            </div>
          )}

          {/* INFORMASI METADATA & CATATAN KAKI (SELALU MUNCUL DI BAWAH) */}
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
            <div>
              <label className="block text-xs font-bold text-slate-800 dark:text-slate-200 mb-1">
                Catatan Kaki Dokumen (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: Dokumen inspeksi fisik lapangan per 21 November 2026"
                value={customNotes}
                onChange={(e) => setCustomNotes(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            {/* Live Indicator Summary */}
            <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-between text-xs text-blue-950 dark:text-blue-100">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="font-semibold">
                  {selectedColumns.length} Kolom Terpilih · Format: {isViewer || !includeFinancials ? 'Fisik Lapangan (Tanpa Rp)' : 'Lengkap (Dengan Rp)'}
                </span>
              </div>
              <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300">
                {totalOriginalCount} Baris
              </span>
            </div>
          </div>

          {/* Tombol Aksi */}
          <div className="pt-2 flex items-center justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-semibold rounded-xl text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSubmitting || selectedColumns.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isSubmitting ? 'Memproses PDF...' : 'Unduh Dokumen PDF'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
});
