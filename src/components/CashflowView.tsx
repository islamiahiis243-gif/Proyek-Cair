import React, { useState, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import { JenisMutasiKas, MutasiKas, StatusDokumenWorkflow } from '../types';
import {
  WalletCards,
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  FileCheck2,
  XCircle,
  Ban,
  FileEdit,
  Clock,
  ShieldCheck,
  Eye,
  History,
  FileText,
  ArrowUpDown
} from 'lucide-react';
import { formatRupiah, formatDateTime, generateCashflowPDF } from '../lib/pdfGenerator';

interface CashflowViewProps {
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  defaultType?: JenisMutasiKas;
  modalOnly?: boolean;
}

export const CashflowView: React.FC<CashflowViewProps> = ({
  isModalOpen,
  setIsModalOpen,
  defaultType = 'KELUAR',
  modalOnly = false,
}) => {
  const {
    cashMutations,
    documents,
    addCashMutation,
    batalCashMutation,
    gantiCashMutation,
    issueOfficialDocument,
    advanceDocumentWorkflow,
    batalOfficialDocument,
    gantiOfficialDocument,
    currentCashBalance,
    user,
    cashAccess,
    rolePermissions,
    activeRole,
    dataReady,
    tenantBranding
  } = useApp();

  const [activeTab, setActiveTab] = useState<'CASH_JOURNAL' | 'CASH_DOCUMENTS'>('CASH_JOURNAL');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [filterCategory] = useState<string>('ALL');

  // State Dokumen Resmi Kas (Tab 2)
  const [docTitle, setDocTitle] = useState('Berita Acara Rekapitulasi Arus Kas & Mutasi Dana');
  const [docPeriode, setDocPeriode] = useState(() => new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }));
  const [batalDocTargetId, setBatalDocTargetId] = useState<string | null>(null);
  const [batalDocReason, setBatalDocReason] = useState('');
  const [gantiDocTargetId, setGantiDocTargetId] = useState<string | null>(null);
  const [gantiDocTitle, setGantiDocTitle] = useState('');
  const [gantiDocReason, setGantiDocReason] = useState('');

  // Form states
  const [jenis, setJenis] = useState<JenisMutasiKas>(defaultType);
  const [amount, setAmount] = useState<number>(0);
  const [cashDate, setCashDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [purpose, setPurpose] = useState('');
  const [category, setCategory] = useState<MutasiKas['kategori_keperluan']>('Material');
  const [pic, setPic] = useState(user.name);
  const [receipt, setReceipt] = useState('');
  const [notes, setNotes] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Modal Batal & Ganti States
  const [batalTarget, setBatalTarget] = useState<MutasiKas | null>(null);
  const [batalReason, setBatalReason] = useState('');
  const [gantiTarget, setGantiTarget] = useState<MutasiKas | null>(null);
  const [gantiReason, setGantiReason] = useState('');

  React.useEffect(() => {
    if (defaultType) {
      setJenis(defaultType);
    }
  }, [defaultType]);

  const totalIn = useMemo(() => {
    return cashMutations
      .filter((c) => c.jenis === 'MASUK' && !c.is_batal && !c.is_ganti)
      .reduce((acc, c) => acc + c.jumlah_rp, 0);
  }, [cashMutations]);

  const totalOut = useMemo(() => {
    return cashMutations
      .filter((c) => c.jenis === 'KELUAR' && !c.is_batal && !c.is_ganti)
      .reduce((acc, c) => acc + c.jumlah_rp, 0);
  }, [cashMutations]);

  const cashDocuments = useMemo(() => {
    return (documents || []).filter((d) => d.jenis === 'MUTASI_KAS');
  }, [documents]);

  const projectedBalance = jenis === 'MASUK' ? currentCashBalance + Number(amount || 0) : currentCashBalance - Number(amount || 0);

  const filteredList = useMemo(() => {
    return cashMutations.filter((c) => {
      const matchSearch =
        (c.untuk_apa || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.pic || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (c.nomor_kuitansi && c.nomor_kuitansi.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchType = filterType === 'ALL' || c.jenis === filterType;
      const matchCat = filterCategory === 'ALL' || c.kategori_keperluan === filterCategory;

      return matchSearch && matchType && matchCat;
    });
  }, [cashMutations, searchQuery, filterType, filterCategory]);

  const [sortField, setSortField] = useState<'tanggal' | 'nominal' | 'untuk_apa'>('tanggal');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [isExportingCash, setIsExportingCash] = useState(false);

  const sortedCashList = useMemo(() => {
    const list = [...filteredList];
    list.sort((a, b) => {
      if (sortField === 'tanggal') {
        const tA = new Date(a.tanggal).getTime();
        const tB = new Date(b.tanggal).getTime();
        return sortDir === 'asc' ? tA - tB : tB - tA;
      }
      if (sortField === 'nominal') {
        return sortDir === 'asc' ? a.jumlah_rp - b.jumlah_rp : b.jumlah_rp - a.jumlah_rp;
      }
      if (sortField === 'untuk_apa') {
        return sortDir === 'asc'
          ? (a.untuk_apa || '').localeCompare(b.untuk_apa || '')
          : (b.untuk_apa || '').localeCompare(a.untuk_apa || '');
      }
      return 0;
    });
    return list;
  }, [filteredList, sortField, sortDir]);

  const toggleSort = (field: 'tanggal' | 'nominal' | 'untuk_apa') => {
    if (sortField === field) {
      setSortDir(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const handleExportCashPDF = async () => {
    if (sortedCashList.length === 0) {
      setErrorMessage('Tidak ada transaksi kas di layar untuk diekspor ke PDF.');
      return;
    }
    try {
      setIsExportingCash(true);
      const docId = `KAS-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      const dates = sortedCashList
        .map((c) => (c.tanggal ? new Date(c.tanggal).getTime() : NaN))
        .filter((t) => !Number.isNaN(t));
      const today = new Date().toISOString().slice(0, 10);
      const startDate = dates.length > 0 ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : today;
      const endDate = dates.length > 0 ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : today;

      const typeLabel = filterType === 'ALL' ? 'Semua Jenis' : filterType === 'MASUK' ? 'Kas Masuk (IN)' : 'Kas Keluar (OUT)';
      const searchPart = searchQuery.trim() ? ` · Cari: "${searchQuery.trim()}"` : '';
      const sortLabel = `Urut: ${sortField} (${sortDir === 'asc' ? 'Naik' : 'Turun'})`;

      await generateCashflowPDF({
        docId,
        startDate,
        endDate,
        cashMutations: sortedCashList,
        signer: user,
        projectName: tenantBranding.projectName,
        branding: tenantBranding,
        filterSummary: `${typeLabel}${searchPart} · ${sortLabel}`
      });
      setNoticeMessage(`PDF Jurnal Kas (${sortedCashList.length} baris sesuai sortir layar) berhasil diunduh.`);
    } catch (err: any) {
      setErrorMessage('Gagal mengunduh PDF Kas: ' + (err?.message || 'Kesalahan sistem'));
    } finally {
      setIsExportingCash(false);
    }
  };

  const handleOpenModal = (t: JenisMutasiKas) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat kas baru. Wewenang penerbitan transaksi dimiliki oleh Clerk.`);
      return;
    }
    setJenis(t);
    setAmount(0);
    setCashDate(new Date().toISOString().slice(0, 10));
    setPurpose('');
    setCategory(t === 'MASUK' ? 'Dana Termin Proyek' : 'Material');
    setPic(user.name);
    setReceipt('');
    setNotes('');
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleSubmitCash = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (amount <= 0) {
      setErrorMessage('Nominal transaksi kas harus lebih dari Rp 0.');
      return;
    }
    if (jenis === 'KELUAR' && amount > currentCashBalance) {
      setErrorMessage(`Saldo kas operasional (${formatRupiah(currentCashBalance)}) tidak mencukupi untuk pengeluaran ${formatRupiah(amount)}.`);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await addCashMutation({
        jenis,
        jumlah_rp: amount,
        untuk_apa: purpose,
        kategori_keperluan: category,
        pic,
        nomor_kuitansi: receipt || undefined,
        tanggal: new Date(cashDate).toISOString(),
        catatan: notes || undefined,
      });

      if (!res.success) {
        setErrorMessage(res.message);
        return;
      }

      setNoticeMessage(res.message);
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mencatat transaksi kas.');
    } finally {
      setSubmitting(false);
    }
  };

  // Konfirmasi BATAL Kas
  const handleConfirmBatal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalCashMutation(batalTarget.id, batalReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalTarget(null);
        setBatalReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membatalkan transaksi kas.');
    } finally {
      setSubmitting(false);
    }
  };

  // Buka Modal GANTI Kas
  const handleOpenGanti = (item: MutasiKas) => {
    setGantiTarget(item);
    setGantiReason('');
    setJenis(item.jenis);
    setAmount(item.jumlah_rp);
    setPurpose(item.untuk_apa || '');
    setCategory(item.kategori_keperluan);
    setPic(item.pic || user.name);
    setReceipt(item.nomor_kuitansi || '');
    setNotes(item.catatan || '');
  };

  // Konfirmasi GANTI Kas
  const handleConfirmGanti = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await gantiCashMutation(
        gantiTarget.id,
        {
          jenis,
          jumlah_rp: amount,
          untuk_apa: purpose,
          kategori_keperluan: category,
          pic,
          nomor_kuitansi: receipt || undefined,
          tanggal: new Date().toISOString(),
          catatan: notes || undefined,
        },
        gantiReason
      );

      if (res.success) {
        setNoticeMessage(res.message);
        setGantiTarget(null);
        setGantiReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengganti dokumen kas.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // HANDLER DOKUMEN RESMI ARUS KAS & PERSETUJUAN BERANTAI (KHUSUS DOKUMEN)
  // ============================================================================
  const handleIssueCashDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!docTitle.trim()) {
      setErrorMessage('Judul dokumen resmi kas wajib diisi.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const validTrx = cashMutations.filter((c) => !c.is_batal && !c.is_ganti);
      const res = await issueOfficialDocument({
        jenis: 'MUTASI_KAS',
        judul: docTitle.trim(),
        periode: docPeriode.trim() || 'Periode Berjalan',
        ringkasan: `Rekapitulasi ${validTrx.length} transaksi kas (Saldo: ${formatRupiah(currentCashBalance)})`,
        total_nilai_atau_item: formatRupiah(currentCashBalance)
      });
      if (res.success) {
        setNoticeMessage(res.message);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal menerbitkan dokumen kas.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvanceCashDocument = async (docDbId: string, currentStatus: StatusDokumenWorkflow, nextStatus: StatusDokumenWorkflow) => {
    if (nextStatus === 'DISETUJUI' && currentStatus !== 'DIPERIKSA') {
      setErrorMessage('Alur persetujuan berantai: Dokumen wajib Diperiksa terlebih dahulu oleh Foreman / Spv sebelum Disetujui.');
      return;
    }
    if (nextStatus === 'MENGETAHUI' && currentStatus !== 'DISETUJUI') {
      setErrorMessage('Alur persetujuan berantai: Dokumen wajib Disetujui terlebih dahulu oleh Spv / Dept. Manager sebelum disahkan Mengetahui (TTE/QR).');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceDocumentWorkflow(docDbId, nextStatus);
      if (res.success) {
        setNoticeMessage(res.message);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal memproses persetujuan dokumen kas.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmBatalDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalDocTargetId || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalOfficialDocument(batalDocTargetId, batalDocReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalDocTargetId(null);
        setBatalDocReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membatalkan dokumen kas.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmGantiDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiDocTargetId || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const validTrx = cashMutations.filter((c) => !c.is_batal && !c.is_ganti);
      const res = await gantiOfficialDocument(
        gantiDocTargetId,
        {
          jenis: 'MUTASI_KAS',
          judul: gantiDocTitle.trim() || 'Berita Acara Rekapitulasi Arus Kas (Revisi)',
          periode: docPeriode.trim() || 'Periode Berjalan',
          ringkasan: `Revisi Rekapitulasi ${validTrx.length} transaksi kas`,
          total_nilai_atau_item: formatRupiah(currentCashBalance)
        },
        gantiDocReason
      );
      if (res.success) {
        setNoticeMessage(res.message);
        setGantiDocTargetId(null);
        setGantiDocReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengganti dokumen kas.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadCashDocPDF = async (docCode: string) => {
    try {
      const validCash = cashMutations.filter((c) => !c.is_batal && !c.is_ganti);
      const today = new Date().toISOString().slice(0, 10);
      await generateCashflowPDF({
        docId: docCode,
        startDate: '2026-01-01',
        endDate: today,
        cashMutations: validCash,
        signer: user,
        projectName: tenantBranding.projectName,
        branding: tenantBranding
      });
      setNoticeMessage(`Dokumen PDF Resmi Kas (${docCode}) dengan QR Code Verifikasi berhasil diunduh.`);
    } catch (err: any) {
      setErrorMessage('Gagal mengunduh PDF dokumen kas: ' + (err?.message || 'Kesalahan sistem'));
    }
  };

  if (modalOnly && !isModalOpen) return null;
  if (!dataReady) return <div className="p-8 text-center text-xs text-slate-500">Memuat data mutasi dana...</div>;

  return (
    <div className={modalOnly ? '' : 'space-y-5'}>
      {/* Pesan & Status */}
      {noticeMessage && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{noticeMessage}</span>
          </div>
          <button onClick={() => setNoticeMessage(null)} aria-label="Tutup pemberitahuan" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-base font-bold">×</button>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} aria-label="Tutup pesan galat" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-base font-bold">×</button>
        </div>
      )}

      {!modalOnly && (
        <>
          {/* Banner Viewer / Pengamat */}
          {activeRole === 'Viewer/Pengamat' && (
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-xs">
              <Eye className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="flex-1 leading-relaxed">
                <span className="font-bold text-cyan-300">Mode Viewer / Pengamat Aktif:</span> Anda memiliki akses transparansi penuh untuk mengamati saldo kas, arus kas masuk/keluar, rincian kuitansi, dan ekspor laporan keuangan PDF. Fitur entri dan persetujuan transaksi dinonaktifkan untuk menjaga akuntabilitas.
              </div>
            </div>
          )}

          {/* Header Panel */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Modul Mutasi Dana (Arus Kas Proyek)
              </h1>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
                Pencatatan kas masuk & kas keluar. Koreksi baris langsung (Batal/Ganti) tanpa hapus, dan persetujuan berantai khusus Dokumen Resmi.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenModal('MASUK')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Kas Masuk' : 'Hanya Clerk yang dapat mencatat transaksi baru'}
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>+ Kas Masuk (IN)</span>
              </button>
              <button
                onClick={() => handleOpenModal('KELUAR')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 rounded-xl hover:bg-rose-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Kas Keluar' : 'Hanya Clerk yang dapat mencatat transaksi baru'}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>- Kas Keluar (OUT)</span>
              </button>
            </div>
          </div>

          {/* Kartu Ringkasan Saldo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Saldo Kas Operasional</span>
              <div className="mt-1 text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {cashAccess ? formatRupiah(currentCashBalance) : 'Akses Terbatas'}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Total Penerimaan Kas</span>
              <div className="mt-1 text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {formatRupiah(totalIn)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Total Pengeluaran Kas</span>
              <div className="mt-1 text-xl font-bold font-mono text-rose-600 dark:text-rose-400">
                {formatRupiah(totalOut)}
              </div>
            </div>
          </div>

          {/* Navigasi Tab Kas (Scroll Horizontal Mulus di Mobile) */}
          <div className="flex overflow-x-auto no-scrollbar touch-scroll whitespace-nowrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-1">
            <button
              type="button"
              onClick={() => setActiveTab('CASH_JOURNAL')}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'CASH_JOURNAL'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              <span>📋 Jurnal Transaksi Kas Harian</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 font-bold">
                {cashMutations.length} Baris
              </span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('CASH_DOCUMENTS')}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'CASH_DOCUMENTS'
                  ? 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/25 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <FileCheck2 className="w-4 h-4" />
              <span>📄 Dokumen & Persetujuan Kas (TTE/QR)</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 font-bold">
                {cashDocuments.length} Dokumen
              </span>
            </button>
          </div>

          {activeTab === 'CASH_JOURNAL' && (
            <>
              {/* Filter & Pencarian */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Cari transaksi kas, peruntukan, PIC, atau no kuitansi"
                    placeholder="Cari transaksi kas, peruntukan, PIC, atau no kuitansi..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'ALL', label: `Semua (${cashMutations.length})` },
                    { id: 'MASUK', label: `Masuk (${cashMutations.filter((m) => m.jenis === 'MASUK').length})` },
                    { id: 'KELUAR', label: `Keluar (${cashMutations.filter((m) => m.jenis === 'KELUAR').length})` },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setFilterType(tab.id as any)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors ${
                        filterType === tab.id
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}

                  <button
                    type="button"
                    onClick={handleExportCashPDF}
                    disabled={isExportingCash || sortedCashList.length === 0}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50 shrink-0 ml-1"
                    title="Ekspor PDF sesuai filter & urutan sortir di layar"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>{isExportingCash ? 'Menyiapkan...' : 'Ekspor PDF Kas'}</span>
                  </button>
                </div>
              </div>

              {/* Tabel Riwayat Kas (Tanpa Kolom Persetujuan per Baris!) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 w-10 text-center">No</th>
                        <th
                          onClick={() => toggleSort('tanggal')}
                          className="py-3 px-3.5 cursor-pointer hover:text-blue-500 select-none transition-colors"
                          title="Klik untuk mengurutkan berdasarkan tanggal"
                        >
                          <div className="inline-flex items-center gap-1">
                            <span>Tanggal</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                            {sortField === 'tanggal' && (
                              <span className="text-[9px] text-blue-500 font-mono">({sortDir.toUpperCase()})</span>
                            )}
                          </div>
                        </th>
                        <th className="py-3 px-3.5 text-center">Jenis</th>
                        <th
                          onClick={() => toggleSort('untuk_apa')}
                          className="py-3 px-3.5 cursor-pointer hover:text-blue-500 select-none transition-colors"
                          title="Klik untuk mengurutkan berdasarkan keterangan"
                        >
                          <div className="inline-flex items-center gap-1">
                            <span>Peruntukan / Keterangan & Jejak Audit</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                            {sortField === 'untuk_apa' && (
                              <span className="text-[9px] text-blue-500 font-mono">({sortDir.toUpperCase()})</span>
                            )}
                          </div>
                        </th>
                        <th
                          onClick={() => toggleSort('nominal')}
                          className="py-3 px-3.5 text-right cursor-pointer hover:text-blue-500 select-none transition-colors"
                          title="Klik untuk mengurutkan berdasarkan nominal"
                        >
                          <div className="inline-flex items-center gap-1 justify-end w-full">
                            <span>Nominal (Rp)</span>
                            <ArrowUpDown className="w-3 h-3 opacity-60" />
                            {sortField === 'nominal' && (
                              <span className="text-[9px] text-blue-500 font-mono">({sortDir.toUpperCase()})</span>
                            )}
                          </div>
                        </th>
                        <th className="py-3 px-3.5">PIC / No. Ref</th>
                        <th className="py-3 px-3.5 text-center">Status Baris Data</th>
                        <th className="py-3 px-3.5 text-center">Koreksi Langsung (Batal / Ganti)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {sortedCashList.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Belum ada riwayat transaksi mutasi kas.
                          </td>
                        </tr>
                      ) : (
                        sortedCashList.map((c, idx) => {
                          const isVoid = c.is_batal || c.status_dokumen === 'BATAL';
                          const isReplaced = c.is_ganti || c.status_dokumen === 'DIGANTI';
                          const canCorrectRow = rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti;

                          return (
                            <tr
                              key={c.id}
                              className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                                isVoid ? 'opacity-55 bg-rose-50/20 line-through' : isReplaced ? 'opacity-65 bg-amber-50/20 line-through' : ''
                              }`}
                            >
                              <td className="py-3 px-3.5 text-center text-slate-600 dark:text-slate-300 font-mono text-[11px] font-medium">
                                {idx + 1}
                              </td>
                              <td className="py-3 px-3.5 text-slate-700 dark:text-slate-200 font-mono text-[11px] whitespace-nowrap">
                                {formatDateTime(c.tanggal)}
                              </td>
                              <td className="py-3 px-3.5 text-center">
                                <span
                                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    c.jenis === 'MASUK'
                                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                      : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                                  }`}
                                >
                                  {c.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                  {c.jenis}
                                </span>
                              </td>
                              <td className="py-3 px-3.5 max-w-sm">
                                <div className="font-semibold text-slate-900 dark:text-white">{c.untuk_apa}</div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-0.5 flex gap-2 font-medium">
                                  <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">{c.kategori_keperluan}</span>
                                  {c.catatan && <span className="italic">{c.catatan}</span>}
                                  {c.referensi_ganti_id && (
                                    <span className="font-mono">· Revisi dari #{c.referensi_ganti_id.slice(0, 8)}</span>
                                  )}
                                </div>
                                {c.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-md">
                                    {c.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                                <span className={c.jenis === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                  {c.jenis === 'MASUK' ? '+' : '-'} {formatRupiah(c.jumlah_rp)}
                                </span>
                                {(isVoid || isReplaced) && (
                                  <div className="text-[9px] font-bold text-rose-600 dark:text-rose-400 no-underline">
                                    Dinolkan (Rp 0)
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">
                                <div>{c.pic}</div>
                                {c.nomor_kuitansi && (
                                  <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300 font-medium">Ref: {c.nomor_kuitansi}</div>
                                )}
                              </td>

                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {isVoid ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                    <Ban className="h-3 w-3" /> BATAL (Dinolkan)
                                  </span>
                                ) : isReplaced ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    <FileEdit className="h-3 w-3" /> DIGANTI (Dinolkan)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    <CheckCircle2 className="h-3 w-3" /> TERCATAT AKTIF
                                  </span>
                                )}
                              </td>

                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {!isVoid && !isReplaced ? (
                                  canCorrectRow ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        onClick={() => {
                                          setBatalTarget(c);
                                          setBatalReason('');
                                        }}
                                        className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                                        title="Batalkan baris kas ini secara langsung (nominal dinolkan)"
                                      >
                                        Batal
                                      </button>
                                      <button
                                        onClick={() => handleOpenGanti(c)}
                                        className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer"
                                        title="Ganti baris kas ini dengan baris revisi baru"
                                      >
                                        Ganti
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                      🔒 Hanya Baca
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">Selesai Dikoreksi</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* TAB 2: DOKUMEN RESMI KAS & PERSETUJUAN BERANTAI */}
          {activeTab === 'CASH_DOCUMENTS' && (
            <div className="space-y-4">
              <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <FileCheck2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                    <span>Penerbitan & Persetujuan Berantai Dokumen Resmi Arus Kas</span>
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-medium">
                    Alur persetujuan berjenjang khusus dokumen: <b>1. Diterbitkan (Clerk)</b> ➔ <b>2. Diperiksa (Foreman / Spv.)</b> ➔ <b>3. Disetujui (Spv. / Dept. Manager)</b> ➔ <b>4. Mengetahui & Sah TTE/QR (Dept. Manager / KTT-PM / CEO-Direktur)</b>.
                  </p>
                </div>

                {rolePermissions.canIssue ? (
                  <form onSubmit={handleIssueCashDocument} className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                    <div className="md:col-span-2">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Judul Dokumen Berita Acara Kas <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Periode Laporan <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={docPeriode}
                        onChange={(e) => setDocPeriode(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {submitting ? 'Menerbitkan...' : '+ Terbitkan Dokumen Kas'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 font-medium">
                    ℹ️ Penerbitan Dokumen Resmi baru dilakukan oleh <b>Clerk</b>. Jabatan Anda saat ini (<b>{activeRole}</b>) dapat memproses pemeriksaan/persetujuan sesuai wewenang di bawah.
                  </div>
                )}
              </div>

              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5">Kode & Tanggal</th>
                        <th className="py-3 px-3.5">Judul Dokumen</th>
                        <th className="py-3 px-3.5">Jejak Persetujuan Berantai</th>
                        <th className="py-3 px-3.5 text-center">Status Dokumen</th>
                        <th className="py-3 px-3.5 text-center">Aksi Persetujuan</th>
                        <th className="py-3 px-3.5 text-center">Koreksi & PDF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {cashDocuments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Belum ada Dokumen Resmi Mutasi Kas yang diterbitkan.
                          </td>
                        </tr>
                      ) : (
                        cashDocuments.map((doc) => {
                          const docDbId = doc.db_id || doc.id;
                          const wfStatus = doc.status_dokumen || 'DITERBITKAN';
                          const isDocVoid = Boolean(doc.is_batal) || wfStatus === 'BATAL';
                          const isDocReplaced = Boolean(doc.is_ganti) || wfStatus === 'DIGANTI';
                          const canCorrectDoc = rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti;

                          return (
                            <tr key={docDbId} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                              <td className="py-3 px-3.5 whitespace-nowrap">
                                <div className="font-mono font-bold text-slate-900 dark:text-white">{doc.id}</div>
                                <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                  {formatDateTime(doc.dibuat_pada)}
                                </div>
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="font-bold text-slate-900 dark:text-white">{doc.judul}</div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                                  Diterbitkan oleh: {doc.penandatangan_nama} ({doc.penandatangan_jabatan})
                                </div>
                                {doc.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-md">
                                    {doc.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-[11px] space-y-1">
                                <div className="text-slate-700 dark:text-slate-200">
                                  <span className="font-semibold">1. Terbit:</span> {doc.penandatangan_nama}
                                </div>
                                <div className={doc.diperiksa_oleh ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">2. Diperiksa:</span> {doc.diperiksa_oleh || 'Menunggu Foreman / Spv.'}
                                </div>
                                <div className={doc.disetujui_oleh ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">3. Disetujui:</span> {doc.disetujui_oleh || 'Menunggu Spv. / Dept. Mgr'}
                                </div>
                                <div className={doc.mengetahui_oleh ? 'text-blue-700 dark:text-blue-300 font-bold' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">4. Disahkan (TTE):</span> {doc.mengetahui_oleh || 'Menunggu Dept. Mgr / KTT-PM / CEO'}
                                </div>
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {isDocVoid ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                    <Ban className="h-3 w-3" /> BATAL
                                  </span>
                                ) : isDocReplaced ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    <FileEdit className="h-3 w-3" /> DIGANTI
                                  </span>
                                ) : wfStatus === 'MENGETAHUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                    <QrCode className="h-3 w-3" /> SAH (TTE/QR)
                                  </span>
                                ) : wfStatus === 'DISETUJUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    <FileCheck2 className="h-3 w-3" /> DISETUJUI
                                  </span>
                                ) : wfStatus === 'DIPERIKSA' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                                    <ShieldCheck className="h-3 w-3" /> DIPERIKSA
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    <Clock className="h-3 w-3" /> DITERBITKAN
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {!isDocVoid && !isDocReplaced && (
                                  <div className="flex items-center justify-center gap-1.5">
                                    {wfStatus === 'DITERBITKAN' && (
                                      <button
                                        onClick={() => handleAdvanceCashDocument(docDbId, wfStatus, 'DIPERIKSA')}
                                        disabled={!rolePermissions.canCheck || submitting}
                                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-35 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 cursor-pointer"
                                      >
                                        Periksa Dokumen
                                      </button>
                                    )}
                                    {wfStatus === 'DIPERIKSA' && (
                                      <button
                                        onClick={() => handleAdvanceCashDocument(docDbId, wfStatus, 'DISETUJUI')}
                                        disabled={!rolePermissions.canApprove || submitting}
                                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-35 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 cursor-pointer"
                                      >
                                        Setujui Dokumen
                                      </button>
                                    )}
                                    {wfStatus === 'DISETUJUI' && (
                                      <button
                                        onClick={() => handleAdvanceCashDocument(docDbId, wfStatus, 'MENGETAHUI')}
                                        disabled={!rolePermissions.canAcknowledge || submitting}
                                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-35 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 cursor-pointer"
                                      >
                                        Sahkan (TTE/QR)
                                      </button>
                                    )}
                                    {wfStatus === 'MENGETAHUI' && (
                                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Sah & Terverifikasi
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadCashDocPDF(doc.id)}
                                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
                                  >
                                    PDF QR
                                  </button>
                                  {!isDocVoid && !isDocReplaced && canCorrectDoc && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setBatalDocTargetId(docDbId);
                                          setBatalDocReason('');
                                        }}
                                        className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                                      >
                                        Batal
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setGantiDocTargetId(docDbId);
                                          setGantiDocTitle(`${doc.judul} (Revisi)`);
                                          setGantiDocReason('');
                                        }}
                                        className="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer"
                                      >
                                        Ganti
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal Konfirmasi BATAL Dokumen Kas */}
      {batalDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmBatalDoc} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Dokumen Resmi Kas
            </h2>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Pembatalan Dokumen <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={batalDocReason}
                onChange={(e) => setBatalDocReason(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatalDocTargetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || batalDocReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Ya, Batalkan Dokumen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Form GANTI Dokumen Kas */}
      {gantiDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmGantiDoc} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Terbitkan Revisi Dokumen Kas
            </h2>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian Dokumen <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={gantiDocReason}
                onChange={(e) => setGantiDocReason(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Judul Dokumen Revisi Baru <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={gantiDocTitle}
                onChange={(e) => setGantiDocTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGantiDocTargetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || gantiDocReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Terbitkan Dokumen Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Dialog Form Catat Kas Baru */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="font-bold text-sm flex items-center gap-2">
                <WalletCards className="w-4 h-4 text-emerald-400" />
                <span>Catat Transaksi Kas: {jenis === 'MASUK' ? 'Kas Masuk (IN)' : 'Kas Keluar (OUT)'}</span>
              </div>
              <button onClick={() => setIsModalOpen(false)} aria-label="Tutup jendela mutasi kas" className="text-slate-300 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitCash} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {jenis === 'MASUK' ? 'Tanggal Kas Masuk' : 'Tanggal Kas Keluar'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={cashDate}
                    onChange={(e) => setCashDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nominal Transaksi (Rp) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    required
                    value={amount || ''}
                    onChange={(e) => setAmount(Number(e.target.value))}
                    placeholder="0"
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold text-sm focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <span className="text-[10px] text-slate-600 dark:text-slate-300 uppercase font-semibold">Proyeksi Saldo Kas Akhir</span>
                <div className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                  {formatRupiah(projectedBalance)}
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Uraian Peruntukan / Keperluan <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Pembelian semen 50 sak, Pembayaran upah tukang minggu ke-2..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Kategori Pengeluaran</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value as any)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                  >
                    <option value="Material">Material</option>
                    <option value="Upah & Konsumsi">Upah & Konsumsi</option>
                    <option value="Operasional">Operasional</option>
                    <option value="Sewa Alat & Angkut">Sewa Alat & Angkut</option>
                    <option value="Dana Termin Proyek">Dana Termin Proyek</option>
                    <option value="Lainnya">Lainnya</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Kuitansi / Bukti</label>
                  <input
                    type="text"
                    placeholder="KWT-001"
                    value={receipt}
                    onChange={(e) => setReceipt(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-5 py-2.5 text-xs font-semibold text-white rounded-xl shadow-sm ${
                    jenis === 'MASUK' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {submitting ? 'Menyimpan...' : 'Terbitkan Transaksi Kas'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi BATAL Kas */}
      {batalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmBatal} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Transaksi Kas
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen ini akan ditandai <b>BATAL</b>. Riwayat audit tetap tersimpan, namun nominal (<b>{formatRupiah(batalTarget.jumlah_rp)}</b>) tidak akan diperhitungkan dalam saldo kas.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Pembatalan <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={batalReason}
                onChange={(e) => setBatalReason(e.target.value)}
                placeholder="Contoh: Kesalahan nominal kuitansi, dibatalkan atas instruksi Spv..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatalTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || batalReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Ya, Batalkan Transaksi Kas'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Form GANTI Kas */}
      {gantiTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmGanti} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Revisi Transaksi Kas
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen kas lama akan ditandai <b>DIGANTI</b> dan dokumen baru akan diterbitkan dengan rujukan ke transaksi ini.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={gantiReason}
                onChange={(e) => setGantiReason(e.target.value)}
                placeholder="Contoh: Koreksi nominal kuitansi fisik..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Nominal Baru (Rp)</label>
                <input
                  type="number"
                  min="1"
                  required
                  value={amount || ''}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold text-xs"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Kuitansi Baru</label>
                <input
                  type="text"
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Uraian Baru</label>
              <input
                type="text"
                required
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGantiTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || gantiReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Simpan Transaksi Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
