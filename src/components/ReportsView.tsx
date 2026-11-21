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
  ExternalLink,
  Printer,
  Boxes,
  WalletCards,
} from 'lucide-react';
import {
  generateStockMutationPDF,
  generateCashflowPDF,
  formatDateTime,
  formatDateOnly,
  formatRupiah,
} from '../lib/pdfGenerator';
import { ExportSettingsModal, ExportSettingsConfig } from './ExportSettingsModal';

export const ReportsView: React.FC = () => {
  const { stockMutations, physicalMaterials, cashMutations, documents, activeProject, activeWorkspaceId, user, setVerifyingDocId, setCurrentView, dataReady, dataError, refreshData, tenantBranding, activeRole } = useApp();
  const isViewer = activeRole === 'Viewer/Pengamat';
  const canReadStock = Boolean(activeProject?.permissions.includes('inventory.read'));
  const canReadCash = !isViewer && Boolean(activeProject?.permissions.includes('cash.read'));
  const canReadDocuments=Boolean(activeProject?.permissions.includes('document.read'));
  const canVerifyPrivateDocument=Boolean(activeProject?.permissions.includes('document.qr.scan')&&activeProject?.permissions.includes('document.qr.verify'));

  const [reportType, setReportType] = useState<'stock' | 'cash'>('stock');
  const canGenerateCurrentReport=reportType==='stock'?canReadStock:canReadCash;
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'DATE_DESC' | 'DATE_ASC' | 'AMOUNT_DESC' | 'AMOUNT_ASC'>('DATE_DESC');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Hitung jumlah baris yang cocok secara reaktif untuk preview pengguna
  const matchingCount = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (reportType === 'stock') {
      return stockMutations.filter((m) => {
        const dateOnly = m.tanggal.split('T')[0];
        const matchDate = dateOnly >= startDate && dateOnly <= endDate;
        const matchType = filterType === 'ALL' || m.jenis === filterType;
        const matchSearch =
          !q ||
          (m.nama_barang || '').toLowerCase().includes(q) ||
          (m.tujuan_keperluan || '').toLowerCase().includes(q) ||
          (m.pic_penerima_penyerah || '').toLowerCase().includes(q) ||
          (m.nomor_surat_jalan || '').toLowerCase().includes(q);
        return matchDate && matchType && matchSearch;
      }).length;
    } else {
      return cashMutations.filter((c) => {
        const dateOnly = c.tanggal.split('T')[0];
        const matchDate = dateOnly >= startDate && dateOnly <= endDate;
        const matchType = filterType === 'ALL' || c.jenis === filterType;
        const matchSearch =
          !q ||
          (c.untuk_apa || '').toLowerCase().includes(q) ||
          (c.pic || '').toLowerCase().includes(q) ||
          (c.nomor_kuitansi || '').toLowerCase().includes(q);
        return matchDate && matchType && matchSearch;
      }).length;
    }
  }, [reportType, stockMutations, cashMutations, startDate, endDate, filterType, searchQuery]);

  const [isExportModalOpen, setIsExportModalOpen] = useState(false);

  const handleOpenExportModal = (e: React.FormEvent) => {
    e.preventDefault();
    setGenerationSuccess(null);
    setGenerationError(null);
    if (!activeProject || activeProject.workspace_id !== activeWorkspaceId) {
      setGenerationError('Pilih Project aktif sebelum membuat ekspor laporan.');
      return;
    }
    if (reportType === 'stock' && !canReadStock) {
      setGenerationError('Permission inventory.read pada Project aktif diperlukan untuk ekspor laporan stok.');
      return;
    }
    if (reportType === 'cash' && !canReadCash) {
      setGenerationError('Permission cash.read pada Project aktif diperlukan untuk ekspor laporan kas.');
      return;
    }
    if (!startDate || !endDate || startDate > endDate) {
      setGenerationError('Rentang tanggal tidak valid. Tanggal awal harus sama dengan atau lebih awal dari tanggal akhir.');
      return;
    }
    if (matchingCount === 0) {
      setGenerationError('Tidak ada baris data yang cocok dengan kriteria filter saat ini.');
      return;
    }
    startTransition(() => {
      setIsExportModalOpen(true);
    });
  };

  const handleConfirmExport = async (config: ExportSettingsConfig) => {
    setIsGenerating(true);
    setGenerationSuccess(null);
    setGenerationError(null);
    await new Promise((resolve) => setTimeout(resolve, 40));

    try {
      const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const docId = `RPT-EXPORT-${dateTag}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      const projectName = activeProject?.name || activeProject?.project_code || 'Proyek aktif';

      if (reportType === 'cash' && !canReadCash) throw new Error('Permission cash.read pada Project aktif diperlukan.');
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
            (m.nomor_surat_jalan || '').toLowerCase().includes(q);
          return matchDate && matchType && matchSearch;
        });

        if (filtered.length === 0) throw new Error('Tidak ada transaksi stok yang cocok dengan kriteria filter dan rentang tanggal. Laporan tidak dibuat.');

        filtered.sort((a, b) => {
          if (sortOrder === 'DATE_DESC') return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime();
          if (sortOrder === 'DATE_ASC') return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
          if (sortOrder === 'AMOUNT_DESC') return b.jumlah - a.jumlah;
          if (sortOrder === 'AMOUNT_ASC') return a.jumlah - b.jumlah;
          return 0;
        });

        const sortLabel =
          sortOrder === 'DATE_DESC' ? 'Terbaru' : sortOrder === 'DATE_ASC' ? 'Terlama' : sortOrder === 'AMOUNT_DESC' ? 'Volume Terbesar' : 'Volume Terkecil';
        const typeLabel = filterType === 'ALL' ? 'Semua Jenis' : filterType === 'MASUK' ? 'Masuk (IN)' : 'Keluar (OUT)';
        const searchPart = searchQuery.trim() ? ` · Cari: "${searchQuery.trim()}"` : '';

        await generateStockMutationPDF({
          docId,
          startDate,
          endDate,
          mutations: filtered,
          signer: user,
          projectName,
          physicalMaterials,
          branding: tenantBranding,
          filterSummary: `${typeLabel}${searchPart} · Urut: ${sortLabel}`,
          customTitle: config.customTitle,
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape'
        });

        setGenerationSuccess(`Ekspor PDF internal ${docId} (${filtered.length} transaksi sesuai filter & konfigurasi) berhasil diunduh.`);
      } else {
        const filtered = cashMutations.filter((c) => {
          const dateOnly = c.tanggal.split('T')[0];
          const matchDate = dateOnly >= startDate && dateOnly <= endDate;
          const matchType = filterType === 'ALL' || c.jenis === filterType;
          const matchSearch =
            !q ||
            (c.untuk_apa || '').toLowerCase().includes(q) ||
            (c.pic || '').toLowerCase().includes(q) ||
            (c.nomor_kuitansi || '').toLowerCase().includes(q);
          return matchDate && matchType && matchSearch;
        });

        if (filtered.length === 0) throw new Error('Tidak ada transaksi kas yang cocok dengan kriteria filter dan rentang tanggal. Laporan tidak dibuat.');

        filtered.sort((a, b) => {
          if (sortOrder === 'DATE_DESC') return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime();
          if (sortOrder === 'DATE_ASC') return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
          if (sortOrder === 'AMOUNT_DESC') return b.jumlah_rp - a.jumlah_rp;
          if (sortOrder === 'AMOUNT_ASC') return a.jumlah_rp - b.jumlah_rp;
          return 0;
        });

        const sortLabel =
          sortOrder === 'DATE_DESC' ? 'Terbaru' : sortOrder === 'DATE_ASC' ? 'Terlama' : sortOrder === 'AMOUNT_DESC' ? 'Nominal Terbesar' : 'Nominal Terkecil';
        const typeLabel = filterType === 'ALL' ? 'Semua Jenis' : filterType === 'MASUK' ? 'Kas Masuk (IN)' : 'Kas Keluar (OUT)';
        const searchPart = searchQuery.trim() ? ` · Cari: "${searchQuery.trim()}"` : '';

        await generateCashflowPDF({
          docId,
          startDate,
          endDate,
          cashMutations: filtered,
          signer: user,
          projectName,
          branding: tenantBranding,
          filterSummary: `${typeLabel}${searchPart} · Urut: ${sortLabel}`,
          customTitle: config.customTitle,
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape'
        });

        setGenerationSuccess(`Ekspor PDF internal ${docId} (${filtered.length} transaksi sesuai filter & konfigurasi) berhasil diunduh.`);
      }
    } catch (err: any) {
      console.error('Error generating PDF:', err);
      setGenerationError(err?.message || 'Gagal menghasilkan PDF. Periksa data dan rentang tanggal, lalu coba kembali.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVerifyDoc = (docId: string) => {
    const doc = documents.find(item => item.id === docId);
    const privateQrReady=Boolean(doc?.verification_token&&['ISSUED','SIGNED'].includes(doc.status)&&doc.lifecycle_status==='ACTIVE'&&!doc.revoked_at);
    if(privateQrReady&&!canVerifyPrivateDocument){setGenerationError('Permission document.qr.scan dan document.qr.verify pada Project aktif diperlukan untuk verifikasi privat.');return;}
    if(privateQrReady){
      window.open(`/verify?doc=${encodeURIComponent(doc!.verification_token!)}`, '_blank', 'noopener,noreferrer');
      return;
    }
    setVerifyingDocId(docId);
    setCurrentView('verification');
  };

  if(!dataReady)return <div role="status" aria-live="polite" className="rounded-xl border bg-white p-8 text-center text-sm text-slate-600 dark:text-slate-300 font-medium dark:border-slate-800 dark:bg-slate-900">Memuat data laporan dan arsip Project aktif…</div>;
  if(!activeProject||activeProject.workspace_id!==activeWorkspaceId)return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Pilih Project aktif untuk membuka Studio Laporan.</div>;
  if(dataError)return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800"><p>Data laporan gagal dimuat: {dataError}</p><button onClick={()=>void refreshData()} className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white">Coba lagi</button></div>;
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 transition-colors">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
            Studio Laporan & Ekspor PDF
          </h1>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
            Ekspor PDF internal berdasarkan transaksi yang tercatat. Ekspor ini bukan dokumen resmi, tidak memulai approval, dan tidak menerbitkan QR privat.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800/60">
          <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400" />
          <span>Ekspor internal · tanpa approval / QR</span>
        </div>
      </div>

      {generationSuccess && (
        <div className="bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800 rounded-xl p-4 flex items-center justify-between text-xs text-emerald-800 dark:text-emerald-300">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>{generationSuccess}</span>
          </div>
          <button
            onClick={() => setGenerationSuccess(null)}
            className="text-emerald-700 dark:text-emerald-300 font-bold hover:underline"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Main Generator Form */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 transition-colors">
        <form onSubmit={handleOpenExportModal} className="space-y-5">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Printer className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Konfigurasi Ekspor Laporan Internal</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5">
              Tentukan jenis laporan, rentang tanggal transaksi, dan identitas penyusun. PDF hanya untuk analisis/arsip kerja.
            </p>
          </div>

          {/* Report Type Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Pilih Jenis Laporan <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                disabled={!canReadStock}
                title={!canReadStock?'Permission inventory.read diperlukan':''}
                onClick={() => setReportType('stock')}
                className={`p-4 rounded-xl border text-left transition-all flex items-start gap-3 ${
                  reportType === 'stock'
                    ? 'border-blue-600 bg-blue-50/50 dark:bg-blue-950/40 dark:border-blue-500 ring-2 ring-blue-500/20'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    reportType === 'stock'
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  <Boxes className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900 dark:text-white">
                    Laporan Mutasi Keluar / Masuk Barang
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium mt-1">
                    Rekapitulasi keluar-masuk stok material fisik proyek, tujuan pemakaian, volume, dan nama PIC lapangan.
                  </div>
                </div>
              </button>

              {!isViewer && (
                <button
                  type="button"
                  disabled={!canReadCash}
                  title={!canReadCash?'Permission cash.read diperlukan':''}
                  onClick={() => setReportType('cash')}
                  className={`p-4 rounded-xl border text-left transition-all flex items-start gap-3 ${
                    reportType === 'cash'
                      ? 'border-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/40 dark:border-emerald-500 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div
                    className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                      reportType === 'cash'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                    }`}
                  >
                    <WalletCards className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white">
                      Laporan Mutasi Kas Keuangan Proyek
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium mt-1">
                      Buku kas mutasi: Kas masuk (IN), Kas keluar (OUT), peruntukan belanja ("Untuk Apa"), dan saldo kas berjalan.
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Dari Tanggal (Periode Awal)
              </label>
              <input
                type="date"
                required
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Sampai Tanggal (Periode Akhir)
              </label>
              <input
                type="date"
                required
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          </div>

          {/* Filter Jenis Transaksi, Pencarian & Pilihan Urutan Sortir */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Filter Jenis Transaksi
              </label>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                {[
                  { id: 'ALL', label: 'Semua' },
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

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Cari Kata Kunci (Opsional)
              </label>
              <input
                type="text"
                placeholder={reportType === 'stock' ? 'Nama material, PIC, surat jalan...' : 'Peruntukan, PIC, no. kuitansi...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Urutan Sortir Laporan PDF
              </label>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as any)}
                className="w-full px-3 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20"
              >
                <option value="DATE_DESC">Tanggal: Terbaru ke Terlama</option>
                <option value="DATE_ASC">Tanggal: Terlama ke Terbaru</option>
                <option value="AMOUNT_DESC">
                  {reportType === 'stock' ? 'Volume: Terbesar ke Terkecil' : 'Nominal: Terbesar ke Terkecil'}
                </option>
                <option value="AMOUNT_ASC">
                  {reportType === 'stock' ? 'Volume: Terkecil ke Terbesar' : 'Nominal: Terkecil ke Terbesar'}
                </option>
              </select>
            </div>
          </div>

          {/* Indikator Baris Cocok */}
          <div className="flex items-center justify-between p-3 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 text-xs text-blue-900 dark:text-blue-200">
            <span className="font-semibold">
              Preview Ekspor: Ditemukan <strong className="font-mono text-sm underline">{matchingCount}</strong> transaksi yang cocok dengan filter & sortir aktif.
            </span>
            <span className="text-[10px] text-blue-700 dark:text-blue-300">
              PDF hanya memuat data hasil filter ini.
            </span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
            Penyusun laporan diambil otomatis dari akun yang sedang masuk: <strong>{user.name}</strong> ({user.email}) — identitas berasal dari akun yang sedang terautentikasi. Nama dan jabatan tidak dapat diketik atau diganti pada formulir.
          </div>

          {/* Features info bar */}
          <div className="bg-slate-50 dark:bg-slate-800/70 p-3.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-900 dark:text-white">Pemisahan Ekspor Internal dan Dokumen Resmi:</span>{' '}
              PDF dari formulir ini tidak memuat QR privat dan tidak memulai approval. QR privat hanya diterbitkan untuk dokumen resmi melalui Operations Hub dan Final Signatory.
            </div>
          </div>

          {generationError&&<div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{generationError}</div>}
          {generationSuccess&&<div role="status" aria-live="polite" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{generationSuccess}</div>}
          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isGenerating||!canGenerateCurrentReport}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-all disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              <span>{isGenerating ? 'Memproses Dokumen PDF...' : 'Ekspor & Unduh PDF Sekarang'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Issued Documents Archive */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileText className="w-4 h-4 text-slate-700 dark:text-slate-300" />
              <span>Arsip Dokumen Resmi Mutasi Stok / Kas</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-0.5">
              Dokumen resmi yang dibuat melalui Operations Hub. Dokumen dengan token privat dibuka pada halaman verifikasi resmi; arsip lama hanya mendukung pemeriksaan checksum snapshot.
            </p>
          </div>
          <span className="text-xs text-slate-600 dark:text-slate-300 font-mono font-medium">
            {canReadDocuments?documents.length:'—'} Dokumen
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {!canReadDocuments ? (
            <div role="alert" className="p-6 text-center text-xs text-amber-700">Permission document.read pada Project aktif diperlukan untuk melihat arsip dokumen resmi.</div>
          ) : documents.length === 0 ? (
            <div role="status" className="p-8 text-center text-xs text-slate-600 dark:text-slate-300 font-medium">
              Belum ada dokumen resmi yang diterbitkan melalui Operations Hub.
            </div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="p-4 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 mt-0.5">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{doc.judul}</span>
                      <span className="text-[10px] font-mono font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800/60">
                        {doc.id}
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-amber-300 bg-amber-50 text-amber-800">{doc.status || 'DRAFT'}</span>
                    </div>
                    <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium mt-1 flex flex-wrap items-center gap-2">
                      <span>Periode: {formatDateOnly(doc.periode_awal)} - {formatDateOnly(doc.periode_akhir)}</span>
                      <span>·</span>
                      <span>Penyusun: {doc.penandatangan_nama} (role: {doc.penandatangan_jabatan})</span>
                      <span>·</span>
                      <span>{formatDateTime(doc.dibuat_pada)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleVerifyDoc(doc.id)}
                    disabled={Boolean(doc.verification_token&&['ISSUED','SIGNED'].includes(doc.status)&&doc.lifecycle_status==='ACTIVE'&&!doc.revoked_at)&&!canVerifyPrivateDocument}
                    title={Boolean(doc.verification_token&&['ISSUED','SIGNED'].includes(doc.status)&&doc.lifecycle_status==='ACTIVE'&&!doc.revoked_at)&&!canVerifyPrivateDocument?'Permission document.qr.scan + document.qr.verify diperlukan':''}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-lg transition-colors border border-blue-200 dark:border-blue-800/60 disabled:opacity-40"
                  >
                    <QrCode className="w-3.5 h-3.5" />
                    <span>{doc.verification_token&&['ISSUED','SIGNED'].includes(doc.status)&&doc.lifecycle_status==='ACTIVE'&&!doc.revoked_at?'Verifikasi dokumen resmi':'Periksa checksum snapshot'}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal Pengaturan Ekspor PDF (Tokopedia/ERP Style) */}
      <ExportSettingsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        targetType={reportType === 'stock' ? 'STOCK_JOURNAL' : 'CASH'}
        title={`Studio Laporan: ${reportType === 'stock' ? 'Mutasi Stok Barang' : 'Mutasi Kas Proyek'}`}
        totalOriginalCount={matchingCount}
        initialIncludeFinancials={reportType === 'stock' ? !isViewer : true}
        onConfirmExport={handleConfirmExport}
        currentFilterLabel={`Periode: ${startDate} s/d ${endDate} · ${filterType === 'ALL' ? 'Semua Jenis' : filterType === 'MASUK' ? 'Masuk' : 'Keluar'}${searchQuery.trim() ? ` · "${searchQuery.trim()}"` : ''}`}
        currentSortLabel={`Urut: ${sortOrder === 'DATE_DESC' ? 'Terbaru' : sortOrder === 'DATE_ASC' ? 'Terlama' : sortOrder === 'AMOUNT_DESC' ? 'Terbesar' : 'Terkecil'}`}
      />
    </div>
  );
};
