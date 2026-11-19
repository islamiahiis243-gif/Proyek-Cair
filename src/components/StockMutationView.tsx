import React, { useState, useMemo, useRef, useEffect } from 'react';
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
    physicalMaterials,
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
  const [selectedAllocationItemId, setSelectedAllocationItemId] = useState<string>('');
  const [mutationType, setMutationType] = useState<JenisMutasiBarang>(preselectedType || 'MASUK');
  const [mutationDate, setMutationDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [isItemSearchOpen, setIsItemSearchOpen] = useState(false);
  const itemSearchRef = useRef<HTMLDivElement>(null);

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

  // Tutup dropdown pencarian material jika klik di luar
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (itemSearchRef.current && !itemSearchRef.current.contains(e.target as Node)) {
        setIsItemSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync if preselected props change
  useEffect(() => {
    if (preselectedItem) {
      setSelectedItemId(preselectedItem.id);
    }
    if (preselectedType) {
      setMutationType(preselectedType);
    }
  }, [preselectedItem, preselectedType]);

  // Material Fisik Terpadu yang aktif dipilih
  const currentPhysicalMaterial = useMemo(() => {
    if (!physicalMaterials || physicalMaterials.length === 0) return null;
    if (selectedItemId) {
      const found = physicalMaterials.find(
        (pm) => pm.id === selectedItemId || pm.budget_lines.some((bl) => bl.id === selectedItemId)
      );
      if (found) return found;
    }
    return physicalMaterials.find((pm) => pm.is_stock_item) || physicalMaterials[0];
  }, [physicalMaterials, selectedItemId]);

  // Sinkronisasi Alokasi Pos BOQ ketika material fisik berganti
  useEffect(() => {
    if (currentPhysicalMaterial) {
      const lines = currentPhysicalMaterial.budget_lines;
      const isCurrentValid = lines.some((bl) => bl.id === selectedAllocationItemId);
      if (!isCurrentValid && lines.length > 0) {
        // Cek jika preselectedItem cocok
        const matchingPre = preselectedItem ? lines.find((bl) => bl.id === preselectedItem.id) : null;
        const targetLine = matchingPre || lines[0];
        setSelectedAllocationItemId(targetLine.id);
        if (mutationType === 'KELUAR') {
          setPurpose(`${targetLine.kode_boq} - ${targetLine.kategori}`);
        }
      }
    }
  }, [currentPhysicalMaterial, preselectedItem, mutationType]);

  const selectedBudgetLine = useMemo(() => {
    if (!currentPhysicalMaterial) return null;
    return (
      currentPhysicalMaterial.budget_lines.find((bl) => bl.id === selectedAllocationItemId) ||
      currentPhysicalMaterial.budget_lines[0] ||
      null
    );
  }, [currentPhysicalMaterial, selectedAllocationItemId]);

  // Autocomplete pencarian material fisik
  const filteredPhysicalMaterialsForPicker = useMemo(() => {
    const list = physicalMaterials.filter((pm) => pm.is_stock_item);
    if (!itemSearchQuery.trim()) {
      return list.slice(0, 15);
    }
    const q = itemSearchQuery.toLowerCase();
    return list
      .filter(
        (pm) =>
          pm.nama_barang.toLowerCase().includes(q) ||
          pm.satuan.toLowerCase().includes(q) ||
          pm.budget_lines.some(
            (bl) => bl.kode_boq.toLowerCase().includes(q) || bl.kategori.toLowerCase().includes(q)
          )
      )
      .slice(0, 25);
  }, [physicalMaterials, itemSearchQuery]);

  const currentStock = currentPhysicalMaterial?.stok_fisik || 0;
  const projectedStock =
    mutationType === 'MASUK'
      ? currentStock + Number(qty || 0)
      : Math.max(0, currentStock - Number(qty || 0));
  const projectedStatus = currentPhysicalMaterial
    ? computeItemStatus(projectedStock, 0)
    : 'Tidak Tersedia';

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
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setMutationDate(new Date().toISOString().slice(0, 10));
    setItemSearchQuery('');
    setIsItemSearchOpen(false);
    setSourceName(type === 'MASUK' ? 'Supplier / Vendor' : 'Gudang Proyek');
    setDestinationName(type === 'MASUK' ? 'Gudang Utama' : 'Area Proyek UDU');
    setOwnerType('KONTRAKTOR');
    setErrorMessage(null);

    if (type === 'KELUAR' && currentPhysicalMaterial) {
      const bl = currentPhysicalMaterial.budget_lines[0];
      if (bl) {
        setSelectedAllocationItemId(bl.id);
        setPurpose(`${bl.kode_boq} - ${bl.kategori}`);
      }
    } else {
      setPurpose('');
    }

    setIsModalOpen(true);
  };

  const handleSubmitMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!currentPhysicalMaterial) {
      setErrorMessage('Pilih material fisik dari katalog.');
      return;
    }
    if (qty <= 0) {
      setErrorMessage('Jumlah kuantitas mutasi harus lebih besar dari 0.');
      return;
    }
    if (mutationType === 'KELUAR' && currentStock < qty) {
      setErrorMessage(
        `Stok fisik saat ini di gudang (${currentStock} ${currentPhysicalMaterial.satuan}) tidak mencukupi untuk pengeluaran ${qty} ${currentPhysicalMaterial.satuan}.`
      );
      return;
    }

    // Pemasukan disatukan (mengacu pada ID material fisik agregat), Pengeluaran dirincikan (mengacu pada ID pos BOQ spesifik)
    const targetItemId =
      mutationType === 'KELUAR'
        ? (selectedAllocationItemId || currentPhysicalMaterial.id)
        : currentPhysicalMaterial.id;

    setSubmitting(true);
    setErrorMessage(null);

    const defaultPurpose =
      mutationType === 'MASUK'
        ? 'Penerimaan logistik masuk gudang'
        : selectedBudgetLine
        ? `Pemakaian: ${selectedBudgetLine.kode_boq} - ${selectedBudgetLine.kategori}`
        : 'Pemakaian material proyek';

    try {
      const res = await addStockMutation({
        barang_id: targetItemId,
        nama_barang: currentPhysicalMaterial.nama_barang,
        jenis: mutationType,
        jumlah: qty,
        satuan: currentPhysicalMaterial.satuan,
        tujuan_keperluan: purpose || defaultPurpose,
        pic_penerima_penyerah: pic,
        nomor_surat_jalan: suratJalan || undefined,
        tanggal: new Date(mutationDate).toISOString(),
        catatan: notes || undefined,
        source_name: sourceName || undefined,
        destination_name: destinationName || undefined,
        recipient_name: pic || undefined,
        owner_type: ownerType,
        purpose: purpose || defaultPurpose
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
    setMutationDate(item.tanggal ? new Date(item.tanggal).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
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
          nama_barang: currentPhysicalMaterial?.nama_barang || 'Material',
          jenis: mutationType,
          jumlah: qty,
          satuan: currentPhysicalMaterial?.satuan || 'Unit',
          tujuan_keperluan: purpose,
          pic_penerima_penyerah: pic,
          nomor_surat_jalan: suratJalan || undefined,
          tanggal: new Date(mutationDate).toISOString(),
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
              {/* Pemilihan Material Berbasis Kolom Pencarian (Search Autocomplete) */}
              <div className="relative" ref={itemSearchRef}>
                <div className="flex items-center justify-between mb-1">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Pilih Material / Barang <span className="text-rose-500">*</span>
                  </label>
                  {currentPhysicalMaterial && (
                    <span className="text-[10px] text-slate-400 font-mono">
                      Stok Fisik Gudang: <b className="text-slate-700 dark:text-slate-200">{currentStock} {currentPhysicalMaterial.satuan}</b>
                    </span>
                  )}
                </div>

                {/* Tampilan Material Terpilih */}
                {currentPhysicalMaterial && !isItemSearchOpen ? (
                  <div className={`p-3 rounded-xl border transition-colors ${
                    mutationType === 'MASUK'
                      ? 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/30'
                      : 'border-blue-200 dark:border-blue-900/60 bg-blue-50/50 dark:bg-blue-950/30'
                  }`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                            {currentPhysicalMaterial.nama_barang}
                          </span>
                          <span className={`text-[9px] px-2 py-0.5 rounded-full font-semibold uppercase ${
                            mutationType === 'MASUK'
                              ? 'bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                              : 'bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300'
                          }`}>
                            {mutationType === 'MASUK' ? 'Penerimaan Fisik Terpadu' : 'Material Fisik Gudang'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 flex flex-wrap items-center gap-2 mt-1">
                          <span>Satuan: <b className="text-slate-700 dark:text-slate-300">{currentPhysicalMaterial.satuan}</b></span>
                          <span>·</span>
                          <span>Saldo Fisik Saat Ini: <b className={currentStock > 0 ? "text-emerald-600 dark:text-emerald-400 font-mono" : "text-rose-600 dark:text-rose-400 font-mono"}>{currentStock} {currentPhysicalMaterial.satuan}</b></span>
                          <span>·</span>
                          <span>Total Kebutuhan Proyek: <b className="text-blue-600 dark:text-blue-400 font-mono">{currentPhysicalMaterial.total_qty_boq.toLocaleString('id-ID', { maximumFractionDigits: 4 })} {currentPhysicalMaterial.satuan}</b> ({currentPhysicalMaterial.budget_lines.length} Pos Alokasi BOQ)</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsItemSearchOpen(true);
                          setItemSearchQuery('');
                        }}
                        className="shrink-0 px-3 py-1.5 text-[11px] font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 bg-white dark:bg-slate-800 rounded-lg border border-blue-200 dark:border-blue-800 shadow-2xs hover:bg-blue-50 dark:hover:bg-slate-700 transition-colors"
                      >
                        Ganti Material
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Kolom Search Input dengan Hasil Autocomplete */
                  <div>
                    <div className="relative">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        autoFocus
                        placeholder="Ketik nama material fisik (cth: Pasir, Semen, Kayu, Besi, Batako)..."
                        value={itemSearchQuery}
                        onChange={(e) => {
                          setItemSearchQuery(e.target.value);
                          setIsItemSearchOpen(true);
                        }}
                        onFocus={() => setIsItemSearchOpen(true)}
                        className="w-full pl-9 pr-8 py-2.5 bg-slate-50 dark:bg-slate-800 border border-blue-400 dark:border-blue-500 text-slate-900 dark:text-white rounded-xl text-xs focus:ring-2 focus:ring-blue-500/20 font-medium"
                      />
                      {currentPhysicalMaterial && (
                        <button
                          type="button"
                          onClick={() => setIsItemSearchOpen(false)}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs font-bold"
                          title="Tutup pencarian"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    {/* Dropdown Hasil Pencarian Autocomplete */}
                    {isItemSearchOpen && (
                      <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl z-50 divide-y divide-slate-100 dark:divide-slate-700/60">
                        {filteredPhysicalMaterialsForPicker.length > 0 ? (
                          filteredPhysicalMaterialsForPicker.map((pm) => (
                            <button
                              key={pm.id}
                              type="button"
                              onClick={() => {
                                setSelectedItemId(pm.id);
                                if (pm.budget_lines.length > 0) {
                                  setSelectedAllocationItemId(pm.budget_lines[0].id);
                                  if (mutationType === 'KELUAR') {
                                    setPurpose(`${pm.budget_lines[0].kode_boq} - ${pm.budget_lines[0].kategori}`);
                                  }
                                }
                                setIsItemSearchOpen(false);
                                setItemSearchQuery('');
                              }}
                              className={`w-full text-left p-2.5 transition-colors flex items-center justify-between gap-2 hover:bg-blue-50 dark:hover:bg-slate-700/60 ${
                                pm.id === currentPhysicalMaterial?.id ? 'bg-blue-50/80 dark:bg-slate-700/90 font-semibold' : ''
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                  {pm.nama_barang}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5 truncate">
                                  <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold">
                                    {pm.budget_lines.length} Pos BOQ
                                  </span>
                                  <span>·</span>
                                  <span className="truncate">
                                    {pm.budget_lines.slice(0, 2).map((bl) => bl.kode_boq).join(', ')}
                                    {pm.budget_lines.length > 2 ? '...' : ''}
                                  </span>
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">
                                  Stok Fisik: {pm.stok_fisik} {pm.satuan}
                                </div>
                                <div className="text-[9px] text-slate-400">
                                  Total Rencana: {pm.total_qty_boq.toLocaleString('id-ID')} {pm.satuan}
                                </div>
                              </div>
                            </button>
                          ))
                        ) : (
                          <div className="p-4 text-center text-xs text-slate-400">
                            Tidak ditemukan material fisik dengan kata kunci "{itemSearchQuery}".
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* KHUSUS PENGELUARAN: Rincian Alokasi Pos BOQ (Pengeluaran Dirincikan) */}
              {mutationType === 'KELUAR' && currentPhysicalMaterial && (
                <div className="p-3 rounded-xl border border-amber-300 dark:border-amber-900/60 bg-amber-50/40 dark:bg-amber-950/20 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                      Alokasi Pos Pekerjaan BOQ <span className="text-rose-500">*</span>
                    </label>
                    <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                      {currentPhysicalMaterial.budget_lines.length} pos pekerjaan tersedia
                    </span>
                  </div>

                  {currentPhysicalMaterial.budget_lines.length === 1 ? (
                    <div className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-mono font-bold text-blue-600 dark:text-blue-400">
                          {currentPhysicalMaterial.budget_lines[0].kode_boq}
                        </span>
                        <span className="text-[10px] text-slate-400">Tunggal / Otomatis</span>
                      </div>
                      <div className="text-slate-800 dark:text-slate-200 font-semibold mt-0.5">
                        {currentPhysicalMaterial.budget_lines[0].kategori}
                      </div>
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 flex gap-3 font-mono">
                        <span>Target: <b>{currentPhysicalMaterial.budget_lines[0].qty_boq.toLocaleString('id-ID')}</b></span>
                        <span>Terpakai: <b className="text-rose-600 dark:text-rose-400">{currentPhysicalMaterial.budget_lines[0].qty_keluar_total.toLocaleString('id-ID')}</b></span>
                        <span>Sisa Kuota: <b className="text-emerald-600 dark:text-emerald-400">{currentPhysicalMaterial.budget_lines[0].sisa_anggaran.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan}</b></span>
                      </div>
                    </div>
                  ) : (
                    <select
                      value={selectedAllocationItemId}
                      onChange={(e) => {
                        const newId = e.target.value;
                        setSelectedAllocationItemId(newId);
                        const line = currentPhysicalMaterial.budget_lines.find((bl) => bl.id === newId);
                        if (line) {
                          setPurpose(`${line.kode_boq} - ${line.kategori}`);
                        }
                      }}
                      className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700/80 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:ring-2 focus:ring-amber-500/20"
                    >
                      {currentPhysicalMaterial.budget_lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          [{line.kode_boq}] {line.kategori} — Rencana: {line.qty_boq.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan} (Sisa: {line.sisa_anggaran.toLocaleString('id-ID')})
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedBudgetLine && currentPhysicalMaterial.budget_lines.length > 1 && (
                    <div className="p-2 rounded-lg bg-white/90 dark:bg-slate-800/90 border border-slate-200 dark:border-slate-700 text-[11px] grid grid-cols-3 gap-2 text-center">
                      <div>
                        <span className="text-[10px] text-slate-400 block">Rencana Pos</span>
                        <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                          {selectedBudgetLine.qty_boq.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">Sudah Terpakai</span>
                        <span className="font-mono font-semibold text-rose-600 dark:text-rose-400">
                          {selectedBudgetLine.qty_keluar_total.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan}
                        </span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block">Sisa Anggaran Pos</span>
                        <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                          {selectedBudgetLine.sisa_anggaran.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan}
                        </span>
                      </div>
                    </div>
                  )}

                  {selectedBudgetLine && qty > selectedBudgetLine.sisa_anggaran && (
                    <div className="text-[10px] text-amber-700 dark:text-amber-300 bg-amber-100/70 dark:bg-amber-900/40 p-2 rounded-lg flex items-center gap-1.5">
                      <span>⚠️</span>
                      <span>
                        Kuantitas keluar ({qty} {currentPhysicalMaterial.satuan}) melebihi sisa anggaran pos ini ({selectedBudgetLine.sisa_anggaran.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan}). Dokumen tetap dapat diterbitkan dan memerlukan otorisasi pengawas.
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Tanggal Mutasi & Jumlah Kuantitas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {mutationType === 'MASUK' ? 'Tanggal Masuk' : 'Tanggal Keluar'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={mutationDate}
                    onChange={(e) => setMutationDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jumlah ({currentPhysicalMaterial?.satuan || 'Unit'}) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    required
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {/* Ringkasan Proyeksi Sisa Stok Fisik Gudang */}
              <div className="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-slate-400 uppercase font-semibold block">Proyeksi Saldo Fisik Gudang</span>
                  <div className="text-xs font-bold text-slate-900 dark:text-white font-mono mt-0.5">
                    {currentStock} →{' '}
                    <span
                      className={
                        mutationType === 'MASUK' ? 'text-emerald-500 font-extrabold' : 'text-rose-500 font-extrabold'
                      }
                    >
                      {projectedStock}
                    </span>{' '}
                    {currentPhysicalMaterial?.satuan}
                  </div>
                </div>
                {currentPhysicalMaterial && (
                  <div className="text-right">
                    <span className="text-[10px] text-slate-400 uppercase font-semibold block">Total Kebutuhan Proyek</span>
                    <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {currentPhysicalMaterial.total_qty_boq.toLocaleString('id-ID', { maximumFractionDigits: 4 })}{' '}
                      {currentPhysicalMaterial.satuan}
                    </span>
                  </div>
                )}
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
