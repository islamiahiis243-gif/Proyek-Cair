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
  ShieldCheck
} from 'lucide-react';
import { formatRupiah, formatDateTime } from '../lib/pdfGenerator';

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
    addCashMutation,
    batalCashMutation,
    gantiCashMutation,
    advanceCashWorkflow,
    currentCashBalance,
    user,
    cashAccess,
    rolePermissions,
    activeRole,
    dataReady
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [filterCategory, setFilterCategory] = useState<string>('ALL');

  // Form states
  const [jenis, setJenis] = useState<JenisMutasiKas>(defaultType);
  const [amount, setAmount] = useState<number>(0);
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
      .filter((c) => c.jenis === 'MASUK' && !c.is_batal)
      .reduce((acc, c) => acc + c.jumlah_rp, 0);
  }, [cashMutations]);

  const totalOut = useMemo(() => {
    return cashMutations
      .filter((c) => c.jenis === 'KELUAR' && !c.is_batal)
      .reduce((acc, c) => acc + c.jumlah_rp, 0);
  }, [cashMutations]);

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

  const handleOpenModal = (t: JenisMutasiKas) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Peran Anda (${activeRole}) tidak memiliki wewenang mencatat kas baru. Wewenang penerbitan transaksi dimiliki oleh Clerk.`);
      return;
    }
    setJenis(t);
    setAmount(0);
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
        tanggal: new Date().toISOString(),
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

  // Alur Persetujuan Berseri (Serial Approval Kas)
  const handleAdvanceWorkflow = async (mut: MutasiKas, nextStatus: StatusDokumenWorkflow) => {
    if (nextStatus === 'DISETUJUI' && mut.status_dokumen !== 'DIPERIKSA') {
      setErrorMessage('Approval berseri: Dokumen wajib Diperiksa terlebih dahulu oleh Foreman / Spv sebelum Disetujui.');
      return;
    }
    if (nextStatus === 'MENGETAHUI' && mut.status_dokumen !== 'DISETUJUI') {
      setErrorMessage('Approval berseri: Dokumen wajib Disetujui terlebih dahulu oleh Spv / Dept. Manager sebelum disahkan Mengetahui (TTE/QR).');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceCashWorkflow(mut.id, nextStatus);
      if (res.success) {
        setNoticeMessage(res.message);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Pembaruan status persetujuan gagal.');
    } finally {
      setSubmitting(false);
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
          <button onClick={() => setNoticeMessage(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">×</button>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">×</button>
        </div>
      )}

      {!modalOnly && (
        <>
          {/* Header Panel */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Modul Mutasi Dana (Arus Kas Proyek)
              </h1>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Pencatatan kas masuk & kas keluar. Saldo dihitung dari riwayat transaksi yang sah tanpa fitur hapus.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenModal('MASUK')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Kas Masuk' : 'Hanya Clerk yang dapat menerbitkan dokumen'}
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>+ Kas Masuk (IN)</span>
              </button>
              <button
                onClick={() => handleOpenModal('KELUAR')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 rounded-xl hover:bg-rose-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Kas Keluar' : 'Hanya Clerk yang dapat menerbitkan dokumen'}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>- Kas Keluar (OUT)</span>
              </button>
            </div>
          </div>

          {/* Kartu Ringkasan Saldo */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500">Saldo Kas Operasional</span>
              <div className="mt-1 text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {cashAccess ? formatRupiah(currentCashBalance) : 'Akses Terbatas'}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500">Total Penerimaan Kas</span>
              <div className="mt-1 text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                {formatRupiah(totalIn)}
              </div>
            </div>
            <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
              <span className="text-xs text-slate-500">Total Pengeluaran Kas</span>
              <div className="mt-1 text-xl font-bold font-mono text-rose-600 dark:text-rose-400">
                {formatRupiah(totalOut)}
              </div>
            </div>
          </div>

          {/* Filter & Pencarian */}
          <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari transaksi kas, peruntukan, PIC, atau no kuitansi..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="flex items-center gap-1.5">
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
            </div>
          </div>

          {/* Tabel Riwayat Kas */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-3.5 w-10 text-center">No</th>
                    <th className="py-3 px-3.5">Tanggal</th>
                    <th className="py-3 px-3.5 text-center">Jenis</th>
                    <th className="py-3 px-3.5">Peruntukan / Keterangan</th>
                    <th className="py-3 px-3.5 text-right">Nominal (Rp)</th>
                    <th className="py-3 px-3.5">PIC / No. Ref</th>
                    <th className="py-3 px-3.5 text-center">Status Dokumen</th>
                    <th className="py-3 px-3.5 text-center">Alur Persetujuan</th>
                    <th className="py-3 px-3.5 text-center">Koreksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredList.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Belum ada riwayat transaksi mutasi kas.
                      </td>
                    </tr>
                  ) : (
                    filteredList.map((c, idx) => {
                      const isVoid = c.is_batal;
                      const isReplaced = c.is_ganti;
                      const status = c.status_dokumen || 'DITERBITKAN';

                      return (
                        <tr
                          key={c.id}
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                            isVoid ? 'opacity-50 bg-rose-50/20 line-through' : isReplaced ? 'opacity-70 bg-amber-50/20' : ''
                          }`}
                        >
                          <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap">
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
                            <div className="text-[10px] text-slate-400 mt-0.5 flex gap-2">
                              <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.2 rounded">{c.kategori_keperluan}</span>
                              {c.catatan && <span className="italic">{c.catatan}</span>}
                            </div>
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                            <span className={c.jenis === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {c.jenis === 'MASUK' ? '+' : '-'} {formatRupiah(c.jumlah_rp)}
                            </span>
                          </td>
                          <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">
                            <div>{c.pic}</div>
                            {c.nomor_kuitansi && (
                              <div className="text-[10px] font-mono text-slate-400">Ref: {c.nomor_kuitansi}</div>
                            )}
                          </td>

                          {/* Status Dokumen */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {isVoid ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                <Ban className="h-3 w-3" /> BATAL
                              </span>
                            ) : isReplaced ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                <FileEdit className="h-3 w-3" /> DIGANTI
                              </span>
                            ) : status === 'MENGETAHUI' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                <QrCode className="h-3 w-3" /> SAH (TTE/QR)
                              </span>
                            ) : status === 'DISETUJUI' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                <FileCheck2 className="h-3 w-3" /> DISETUJUI
                              </span>
                            ) : status === 'DIPERIKSA' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                                <ShieldCheck className="h-3 w-3" /> DIPERIKSA
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                <Clock className="h-3 w-3" /> DITERBITKAN
                              </span>
                            )}
                          </td>

                          {/* Tombol Aksi Approval Berjenjang */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {!isVoid && !isReplaced && (
                              <div className="flex items-center justify-center gap-1.5">
                                {status === 'DITERBITKAN' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(c, 'DIPERIKSA')}
                                    disabled={!rolePermissions.canCheck || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-30 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                                    title={rolePermissions.canCheck ? 'Klik untuk Memeriksa' : 'Hanya Foreman / Spv yang berhak memeriksa'}
                                  >
                                    Periksa
                                  </button>
                                )}

                                {status === 'DIPERIKSA' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(c, 'DISETUJUI')}
                                    disabled={!rolePermissions.canApprove || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-30 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    title={rolePermissions.canApprove ? 'Klik untuk Menyetujui' : 'Hanya Spv / Dept. Manager yang berhak menyetujui'}
                                  >
                                    Setujui
                                  </button>
                                )}

                                {status === 'DISETUJUI' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(c, 'MENGETAHUI')}
                                    disabled={!rolePermissions.canAcknowledge || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-30 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                    title={rolePermissions.canAcknowledge ? 'Klik untuk Mengesahkan dengan TTE/QR' : 'Hanya Dept. Mgr / PM / Direktur yang berhak mengesahkan'}
                                  >
                                    Sahkan (TTE/QR)
                                  </button>
                                )}

                                {status === 'MENGETAHUI' && (
                                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Selesai
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Tombol Koreksi (Batal & Ganti) */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {!isVoid && !isReplaced ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => {
                                    setBatalTarget(c);
                                    setBatalReason('');
                                  }}
                                  className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                                  title="Batalkan dokumen ini (nominal dinolkan)"
                                >
                                  Batal
                                </button>
                                <button
                                  onClick={() => handleOpenGanti(c)}
                                  className="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                                  title="Ganti dokumen ini dengan revisi baru"
                                >
                                  Ganti
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-400">—</span>
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

      {/* Modal Dialog Form Catat Kas Baru */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="font-bold text-sm flex items-center gap-2">
                <WalletCards className="w-4 h-4 text-emerald-400" />
                <span>Catat Transaksi Kas: {jenis === 'MASUK' ? 'Kas Masuk (IN)' : 'Kas Keluar (OUT)'}</span>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitCash} className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
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
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold text-sm"
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col justify-center">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Proyeksi Saldo Akhir</span>
                  <div className="text-xs font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                    {formatRupiah(projectedBalance)}
                  </div>
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
            <p className="text-xs text-slate-500">
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
            <p className="text-xs text-slate-500">
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
