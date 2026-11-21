import React, { useState } from 'react';
import {
  FileText,
  Lock,
  CheckCircle2,
  X,
  Download,
  ShieldAlert,
  Building2,
  Boxes,
  WalletCards,
  ArrowUpDown,
  Filter,
  Eye
} from 'lucide-react';
import { useApp } from '../context/AppContext';

export type ExportTargetType = 'BOQ' | 'WAREHOUSE' | 'STOCK_JOURNAL' | 'CASH';

export interface ExportSettingsConfig {
  includeFinancials: boolean;
  providerScope?: 'ALL' | 'KONTRAKTOR' | 'IMK';
  statusScope?: string;
  sortOption?: string;
  customNotes?: string;
  filterType?: 'ALL' | 'MASUK' | 'KELUAR';
}

export interface ExportSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  targetType: ExportTargetType;
  title: string;
  itemCount: number;
  initialIncludeFinancials?: boolean;
  onConfirmExport: (config: ExportSettingsConfig) => Promise<void>;
  currentFilterLabel?: string;
  currentSortLabel?: string;
}

export const ExportSettingsModal: React.FC<ExportSettingsModalProps> = ({
  isOpen,
  onClose,
  targetType,
  title,
  itemCount,
  initialIncludeFinancials = true,
  onConfirmExport,
  currentFilterLabel,
  currentSortLabel
}) => {
  const { activeRole, tenantBranding, user } = useApp();
  const isViewer = activeRole === 'Viewer/Pengamat';

  // State Pengaturan Ekspor
  // Khusus Pengamat: Wajib false dan tidak bisa diubah (locked)
  const [includeFinancials, setIncludeFinancials] = useState<boolean>(() => {
    if (isViewer) return false;
    return initialIncludeFinancials;
  });

  const [providerScope, setProviderScope] = useState<'ALL' | 'KONTRAKTOR' | 'IMK'>('ALL');
  const [statusScope, setStatusScope] = useState<string>('ALL');
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [useCurrentScreenSort, setUseCurrentScreenSort] = useState<boolean>(true);
  const [customNotes, setCustomNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onConfirmExport({
        includeFinancials: isViewer ? false : includeFinancials,
        providerScope: targetType === 'BOQ' ? providerScope : undefined,
        statusScope: targetType === 'BOQ' ? statusScope : undefined,
        filterType: targetType === 'STOCK_JOURNAL' || targetType === 'CASH' ? filterType : undefined,
        sortOption: useCurrentScreenSort ? 'SCREEN_ACTIVE' : 'DEFAULT',
        customNotes: customNotes.trim() || undefined
      });
      onClose();
    } catch {
      // Error ditangani oleh pemanggil
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-150 overflow-y-auto"
    >
      <div className="w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col my-auto transition-colors">
        {/* Header Modal */}
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800/60 shrink-0">
              {getTargetIcon()}
            </div>
            <div>
              <h2 id="export-modal-title" className="text-sm font-bold text-slate-900 dark:text-white">
                Pengaturan Ekspor Dokumen PDF
              </h2>
              <p className="text-[11px] text-slate-600 dark:text-slate-400 font-medium mt-0.5">
                {title} · {itemCount} baris data di layar
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

        {/* Form Isi Pengaturan */}
        <form onSubmit={handleSubmit} className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto max-h-[75vh]">
          {/* 1. KONTROL UTAMA: SAKELAR NOMINAL FINANSIAL (RUPIAH) */}
          <div className="rounded-xl p-3.5 sm:p-4 border transition-all bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-900 dark:text-white">
                    Sertakan Informasi Nominal Rupiah
                  </span>
                  {isViewer ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                      <Lock className="w-3 h-3" /> Terkunci
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-slate-400">
                      (Harga Satuan & Anggaran Kontrak)
                    </span>
                  )}
                </div>

                <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium mt-1 leading-relaxed">
                  {isViewer
                    ? 'Wewenang Pengamat Lapangan dibatasi khusus untuk data fisik (QTY). Kolom harga satuan dan total nilai rupiah dinonaktifkan secara otomatis.'
                    : includeFinancials
                    ? 'Dokumen akan memuat kolom harga satuan, subtotal anggaran pos, dan total nilai kontrak (format resmi untuk manajemen/klien).'
                    : 'Dokumen akan dicetak murni data fisik (tanpa kolom harga/rupiah) yang aman dibagikan langsung ke mandor dan pekerja lapangan.'}
                </p>
              </div>

              {/* Toggle Switch */}
              <div className="shrink-0 pt-0.5">
                {isViewer ? (
                  <div
                    className="w-11 h-6 rounded-full bg-slate-200 dark:bg-slate-700 opacity-60 flex items-center px-1 cursor-not-allowed"
                    title="Hak akses pengamat dibatasi: tidak dapat mengaktifkan nominal rupiah"
                  >
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

            {/* Banner Khusus Pengamat */}
            {isViewer && (
              <div className="mt-3 p-2.5 rounded-lg bg-cyan-950/30 border border-cyan-500/30 text-cyan-200 text-[11px] flex items-center gap-2">
                <Eye className="w-4 h-4 text-cyan-400 shrink-0" />
                <span>PDF yang diekspor berformat <strong>Laporan Inspeksi & QTY Fisik</strong>.</span>
              </div>
            )}
          </div>

          {/* 2. OPSI URUTAN SORTIR & KONSISTENSI LAYAR */}
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
              Urutan Penyusunan Baris (Sortir)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setUseCurrentScreenSort(true)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  useCurrentScreenSort
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <ArrowUpDown className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold">Sesuai Sortir Layar Saat Ini</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    {currentSortLabel || 'Urutan kolom aktif di tabel'}
                  </div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setUseCurrentScreenSort(false)}
                className={`p-3 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-2.5 ${
                  !useCurrentScreenSort
                    ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 ring-1 ring-blue-500/30'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300'
                }`}
              >
                <Filter className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-xs font-bold">Urutan Standar Dokumen</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    Hierarki nomor pos & kronologis
                  </div>
                </div>
              </button>
            </div>
          </div>

          {/* 3. INFORMASI PENYUSUN & PROYEK */}
          <div className="space-y-1.5 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/60 text-xs">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Proyek Aktif:</span>
              <span className="font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">
                {tenantBranding.projectName}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Kontraktor:</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {tenantBranding.contractorName}
              </span>
            </div>
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
              <span>Penyusun Laporan:</span>
              <span className="font-semibold text-slate-900 dark:text-white">
                {user.name || 'Pengguna'} ({activeRole})
              </span>
            </div>
          </div>

          {/* 4. CATATAN TAMBAHAN (OPSIONAL) */}
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

          {/* 5. PREVIEW FORMAT YANG AKAN DICETAK */}
          <div className="p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 flex items-center justify-between text-xs text-blue-950 dark:text-blue-100">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
              <span className="font-semibold">
                Format: {isViewer || !includeFinancials ? 'Laporan Fisik Lapangan (Tanpa Rupiah)' : 'Laporan Lengkap (Dengan Nominal Rupiah)'}
              </span>
            </div>
            <span className="font-mono text-xs font-bold text-blue-700 dark:text-blue-300">
              {itemCount} Baris Data
            </span>
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
              disabled={isSubmitting || itemCount === 0}
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
};
