import React, { useState, useMemo } from 'react';
import { useApp, computeItemStatus } from '../context/AppContext';
import { ItemBarang, JenisMutasiBarang, MutasiBarang, StatusDokumenWorkflow } from '../types';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  FileCheck2,
  XCircle,
  RefreshCw,
  Ban,
  FileEdit,
  Clock,
  ShieldCheck
} from 'lucide-react';
import { formatDateTime } from '../lib/pdfGenerator';

interface StockMutationViewProps {
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  preselectedItem: ItemBarang | null;
  preselectedType: JenisMutasiBarang;
  modalOnly?: boolean;
}

export const StockMutationView: React.FC<StockMutationViewProps> = ({
  isModalOpen,
  setIsModalOpen,
  preselectedItem,
  preselectedType,
  modalOnly = false,
}) => {
  const {
    items,
    stockMutations,
    addStockMutation,
    batalStockMutation,
    gantiStockMutation,
    advanceStockWorkflow,
    user,
    rolePermissions,
    activeRole,
    dataReady,
    dataError,
    refreshData
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');

  // Form input states
  const [selectedItemId, setSelectedItemId] = useState<string>(preselectedItem ? preselectedItem.id : (items[0]?.id || ''));
  const [mutationType, setMutationType] = useState<JenisMutasiBarang>(preselectedType || 'MASUK');
  const [qty, setQty] = useState<number>(1);
  const [purpose, setPurpose] = useState('');
  const [pic, setPic] = useState(user.name);
  const [suratJalan, setSuratJalan] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [ownerType, setOwnerType] = useState<'KONTRAKTOR' | 'IMK'>('KONTRAKTOR');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Modal Batal & Ganti States
  const [batalTarget, setBatalTarget] = useState<MutasiBarang | null>(null);
  const [batalReason, setBatalReason] = useState('');
  const [gantiTarget, setGantiTarget] = useState<MutasiBarang | null>(null);
  const [gantiReason, setGantiReason] = useState('');

  // Sync if preselected props change
  React.useEffect(() => {
    if (preselectedItem) {
      setSelectedItemId(preselectedItem.id);
    }
    if (preselectedType) {
      setMutationType(preselectedType);
    }
  }, [preselectedItem, preselectedType]);

  const currentSelectedItem = useMemo(() => {
    return items.find((it) => it.id === selectedItemId && it.is_stock_item) || items.find((it) => it.is_stock_item) || items[0];
  }, [items, selectedItemId]);

  const currentStock = currentSelectedItem?.stok_saat_ini || 0;
  const projectedStock = mutationType === 'MASUK' ? currentStock + Number(qty || 0) : Math.max(0, currentStock - Number(qty || 0));
  const projectedStatus = currentSelectedItem ? computeItemStatus(projectedStock, currentSelectedItem.stok_minimum) : 'Tidak Tersedia';

  const filteredMutations = useMemo(() => {
    return stockMutations.filter((m) => {
      const matchSearch =
        (m.nama_barang || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.tujuan_keperluan || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.pic_penerima_penyerah || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.nomor_surat_jalan && m.nomor_surat_jalan.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchType = filterType === 'ALL' || m.jenis === filterType;
      return matchSearch && matchType;
    });
  }, [stockMutations, searchQuery, filterType]);

  const handleOpenNewModal = (type: JenisMutasiBarang = 'MASUK') => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang menerbitkan dokumen mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    setMutationType(type);
    setQty(1);
    setPurpose('');
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setSourceName(type === 'MASUK' ? 'Supplier / Vendor' : 'Gudang Proyek');
    setDestinationName(type === 'MASUK' ? 'Gudang Utama' : 'Area Proyek UDU');
    setOwnerType('KONTRAKTOR');
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleSubmitMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!selectedItemId) {
      setErrorMessage('Pilih barang / material dari katalog.');
      return;
    }
    if (qty <= 0) {
      setErrorMessage('Jumlah kuantitas mutasi harus lebih besar dari 0.');
      return;
    }
    if (mutationType === 'KELUAR' && currentStock < qty) {
      setErrorMessage(`Stok saat ini (${currentStock}) tidak mencukupi untuk pengeluaran ${qty}.`);
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await addStockMutation({
        barang_id: selectedItemId,
        nama_barang: currentSelectedItem?.nama_barang || 'Material',
        jenis: mutationType,
        jumlah: qty,
        satuan: currentSelectedItem?.satuan || 'Unit',
        tujuan_keperluan: purpose,
        pic_penerima_penyerah: pic,
        nomor_surat_jalan: suratJalan || undefined,
        tanggal: new Date().toISOString(),
        catatan: notes || undefined,
        source_name: sourceName || undefined,
        destination_name: destinationName || undefined,
        recipient_name: pic || undefined,
        owner_type: ownerType,
        purpose: purpose
      });

      if (!res.success) {
        setErrorMessage(res.message);
        return;
      }

      setNoticeMessage(res.message);
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal mencatat mutasi stok.');
    } finally {
      setSubmitting(false);
    }
  };

  // Konfirmasi BATAL Mutasi
  const handleConfirmBatal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalStockMutation(batalTarget.id, batalReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalTarget(null);
        setBatalReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membatalkan transaksi.');
    } finally {
      setSubmitting(false);
    }
  };

  // Buka Modal GANTI Mutasi
  const handleOpenGanti = (item: MutasiBarang) => {
    setGantiTarget(item);
    setGantiReason('');
    setSelectedItemId(item.barang_id);
    setMutationType(item.jenis);
    setQty(item.jumlah);
    setPurpose(item.tujuan_keperluan || '');
    setPic(item.pic_penerima_penyerah || user.name);
    setSuratJalan(item.nomor_surat_jalan || '');
    setNotes(item.catatan || '');
    setSourceName(item.source_name || '');
    setDestinationName(item.destination_name || '');
  };

  // Konfirmasi GANTI Mutasi
  const handleConfirmGanti = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await gantiStockMutation(
        gantiTarget.id,
        {
          barang_id: selectedItemId,
          nama_barang: currentSelectedItem?.nama_barang || 'Material',
          jenis: mutationType,
          jumlah: qty,
          satuan: currentSelectedItem?.satuan || 'Unit',
          tujuan_keperluan: purpose,
          pic_penerima_penyerah: pic,
          nomor_surat_jalan: suratJalan || undefined,
          tanggal: new Date().toISOString(),
          catatan: notes || undefined,
          source_name: sourceName || undefined,
          destination_name: destinationName || undefined,
          recipient_name: pic || undefined,
          owner_type: ownerType,
          purpose: purpose
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
      setErrorMessage(err?.message || 'Gagal mengganti dokumen transaksi.');
    } finally {
      setSubmitting(false);
    }
  };

  // Eksekusi Persetujuan Berseri (Serial Approval)
  const handleAdvanceWorkflow = async (mut: MutasiBarang, nextStatus: StatusDokumenWorkflow) => {
    // Validasi Berseri (Serial)
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
      const res = await advanceStockWorkflow(mut.id, nextStatus);
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
  if (!dataReady) return <div className="p-8 text-center text-xs text-slate-500">Memuat data mutasi barang...</div>;

  return (
    <div className={modalOnly ? '' : 'space-y-5'}>
      {/* Notifikasi & Pesan */}
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
                Modul Mutasi Barang
              </h1>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                Pencatatan masuk/keluar material. Jejak audit abadi tanpa fitur hapus (koreksi via Batal atau Ganti).
              </p>
            </div>

            {/* Tombol Terbitkan (Hanya untuk Clerk atau Admin) */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenNewModal('MASUK')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Penerimaan Barang' : 'Hanya Clerk yang dapat menerbitkan dokumen'}
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>+ Catat Masuk</span>
              </button>
              <button
                onClick={() => handleOpenNewModal('KELUAR')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 rounded-xl hover:bg-rose-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Pengeluaran Barang' : 'Hanya Clerk yang dapat menerbitkan dokumen'}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>- Catat Keluar</span>
              </button>
            </div>
          </div>

          {/* Filter & Pencarian */}
          <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari transaksi, material, keperluan, PIC, atau no surat jalan..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
              />
            </div>

            <div className="flex items-center gap-1.5">
              {[
                { id: 'ALL', label: `Semua (${stockMutations.length})` },
                { id: 'MASUK', label: `Masuk (${stockMutations.filter((m) => m.jenis === 'MASUK').length})` },
                { id: 'KELUAR', label: `Keluar (${stockMutations.filter((m) => m.jenis === 'KELUAR').length})` },
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

          {/* Tabel Riwayat Mutasi Barang */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-3.5 w-10 text-center">No</th>
                    <th className="py-3 px-3.5">Tanggal</th>
                    <th className="py-3 px-3.5 text-center">Jenis</th>
                    <th className="py-3 px-3.5">Material</th>
                    <th className="py-3 px-3.5 text-right">Jumlah</th>
                    <th className="py-3 px-3.5">Keperluan / Lokasi</th>
                    <th className="py-3 px-3.5 text-center">Status Dokumen</th>
                    <th className="py-3 px-3.5 text-center">Alur Persetujuan</th>
                    <th className="py-3 px-3.5 text-center">Koreksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredMutations.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-12 text-center text-slate-400">
                        Belum ada riwayat transaksi mutasi barang.
                      </td>
                    </tr>
                  ) : (
                    filteredMutations.map((mut, idx) => {
                      const isVoid = mut.is_batal;
                      const isReplaced = mut.is_ganti;
                      const status = mut.status_dokumen || 'DITERBITKAN';

                      return (
                        <tr
                          key={mut.id}
                          className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                            isVoid ? 'opacity-50 bg-rose-50/20 line-through' : isReplaced ? 'opacity-70 bg-amber-50/20' : ''
                          }`}
                        >
                          <td className="py-3 px-3.5 text-center text-slate-400 font-mono text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400 font-mono text-[11px] whitespace-nowrap">
                            {formatDateTime(mut.tanggal)}
                          </td>
                          <td className="py-3 px-3.5 text-center">
                            <span
                              className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                mut.jenis === 'MASUK'
                                  ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                  : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                              }`}
                            >
                              {mut.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                              {mut.jenis}
                            </span>
                          </td>
                          <td className="py-3 px-3.5">
                            <div className="font-semibold text-slate-900 dark:text-white">{mut.nama_barang}</div>
                            {mut.catatan && <div className="text-[11px] text-slate-400 italic mt-0.5">{mut.catatan}</div>}
                          </td>
                          <td className="py-3 px-3.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                            <span className={mut.jenis === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                              {mut.jenis === 'MASUK' ? '+' : '-'} {mut.jumlah.toLocaleString('id-ID')}
                            </span>{' '}
                            <span className="text-[11px] text-slate-400 font-normal">{mut.satuan}</span>
                          </td>
                          <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300 max-w-xs truncate">
                            <div>{mut.tujuan_keperluan || '-'}</div>
                            <div className="text-[10px] text-slate-400 font-mono">PIC: {mut.pic_penerima_penyerah}</div>
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
                                {/* Tombol Periksa (Foreman & Spv) */}
                                {status === 'DITERBITKAN' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(mut, 'DIPERIKSA')}
                                    disabled={!rolePermissions.canCheck || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-30 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                                    title={rolePermissions.canCheck ? 'Klik untuk Memeriksa' : 'Hanya Foreman / Spv yang berhak memeriksa'}
                                  >
                                    Periksa
                                  </button>
                                )}

                                {/* Tombol Setujui (Spv & Dept. Mgr) */}
                                {status === 'DIPERIKSA' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(mut, 'DISETUJUI')}
                                    disabled={!rolePermissions.canApprove || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-30 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    title={rolePermissions.canApprove ? 'Klik untuk Menyetujui' : 'Hanya Spv / Dept. Manager yang berhak menyetujui'}
                                  >
                                    Setujui
                                  </button>
                                )}

                                {/* Tombol Sahkan Mengetahui + TTE/QR (Dept. Mgr, PM, Direktur) */}
                                {status === 'DISETUJUI' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(mut, 'MENGETAHUI')}
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

                          {/* Tombol Koreksi (Batal & Ganti - Tanpa Hapus) */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {!isVoid && !isReplaced ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => {
                                    setBatalTarget(mut);
                                    setBatalReason('');
                                  }}
                                  className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                                  title="Batalkan dokumen ini (nominal dinolkan)"
                                >
                                  Batal
                                </button>
                                <button
                                  onClick={() => handleOpenGanti(mut)}
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

      {/* Modal Dialog Form Tambah / Terbitkan Mutasi Baru */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="font-bold text-sm flex items-center gap-2">
                {mutationType === 'MASUK' ? (
                  <>
                    <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                    <span>Catat Penerimaan Barang (Stok Masuk)</span>
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="w-4 h-4 text-rose-400" />
                    <span>Catat Pengeluaran Barang (Stok Keluar)</span>
                  </>
                )}
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitMutation} className="p-5 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pilih Material / Barang <span className="text-rose-500">*</span>
                </label>
                <select
                  required
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium"
                >
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.nama_barang} ({it.satuan}) - Stok saat ini: {it.stok_saat_ini}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jumlah ({currentSelectedItem?.satuan || 'Unit'}) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold"
                  />
                </div>

                <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 flex flex-col justify-center">
                  <span className="text-[10px] text-slate-400 uppercase font-semibold">Proyeksi Sisa Stok</span>
                  <div className="text-xs font-bold text-slate-900 dark:text-white font-mono">
                    {currentStock} → <span className={mutationType === 'MASUK' ? 'text-emerald-500' : 'text-rose-500'}>{projectedStock}</span> {currentSelectedItem?.satuan}
                  </div>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tujuan & Keperluan <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Pengecoran sloof kolom zona A..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">PIC / Petugas</label>
                  <input
                    type="text"
                    value={pic}
                    onChange={(e) => setPic(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Surat Jalan / Ref</label>
                  <input
                    type="text"
                    placeholder="SJ-001 / BON-12"
                    value={suratJalan}
                    onChange={(e) => setSuratJalan(e.target.value)}
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
                    mutationType === 'MASUK' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {submitting ? 'Menyimpan...' : 'Terbitkan Dokumen Mutasi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi BATAL */}
      {batalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmBatal} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Dokumen Mutasi
            </h2>
            <p className="text-xs text-slate-500">
              Dokumen ini akan ditandai <b>BATAL</b>. Riwayat audit tetap tersimpan, namun nominal kuantitas (<b>{batalTarget.jumlah} {batalTarget.satuan}</b>) tidak akan diperhitungkan dalam stok fisik.
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
                placeholder="Contoh: Kesalahan input kuantitas, dibatalkan atas instruksi Spv..."
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
                {submitting ? 'Memproses...' : 'Ya, Batalkan Dokumen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Form GANTI Mutasi */}
      {gantiTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmGanti} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Revisi Dokumen Mutasi
            </h2>
            <p className="text-xs text-slate-500">
              Dokumen lama akan ditandai <b>DIGANTI</b> dan dokumen baru akan diterbitkan dengan nomor rujukan ke dokumen ini.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian / Koreksi <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={gantiReason}
                onChange={(e) => setGantiReason(e.target.value)}
                placeholder="Contoh: Koreksi nomor surat jalan dan penyesuaian kuantitas nyata..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Jumlah Baru</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold text-xs"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Surat Jalan Baru</label>
                <input
                  type="text"
                  value={suratJalan}
                  onChange={(e) => setSuratJalan(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Uraian Keperluan Baru</label>
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
                {submitting ? 'Memproses...' : 'Simpan Dokumen Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
