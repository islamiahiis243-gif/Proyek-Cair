import React, { useState, useMemo } from 'react';
import { useApp, computeItemStatus } from '../context/AppContext';
import { ItemBarang, JenisMutasiBarang } from '../types';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  Filter,
  Plus,
  Clock,
  User,
  FileCheck2,
  AlertTriangle,
  Building2,
  Calendar,
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
  const { items, stockMutations, addStockMutation, reverseStockMutation, user, stockWriteAccess, activeProject, dataReady, dataError, refreshData } = useApp();
  const canReadBoq=Boolean(activeProject?.permissions.includes('boq.read'));
  const canReadInventory=Boolean(activeProject?.permissions.includes('inventory.read'));
  const canReverse=Boolean(activeProject?.permissions.includes('inventory.movement.reverse'));

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');

  // Form states
  const [selectedItemId, setSelectedItemId] = useState<string>(preselectedItem ? preselectedItem.id : (items[0]?.id || ''));
  const [mutationType, setMutationType] = useState<JenisMutasiBarang>(preselectedType || 'MASUK');
  const [qty, setQty] = useState<number>(1);
  const [purpose, setPurpose] = useState('');
  const [pic, setPic] = useState(user.name);
  const [suratJalan, setSuratJalan] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceName,setSourceName]=useState('');
  const [destinationName,setDestinationName]=useState('');
  const [ownerType,setOwnerType]=useState<'KONTRAKTOR'|'IMK'>('KONTRAKTOR');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reverseDraft,setReverseDraft]=useState<any|null>(null);
  const [reverseError,setReverseError]=useState<string|null>(null);
  const [reverseNotice,setReverseNotice]=useState<string|null>(null);
  const [reverseSubmitting,setReverseSubmitting]=useState(false);
  const [submitting,setSubmitting]=useState(false);

  // Sync if preselected props change
  React.useEffect(() => {
    if (preselectedItem) {
      setSelectedItemId(preselectedItem.id);
    }
    if (preselectedType) {
      setMutationType(preselectedType);
    }
  }, [preselectedItem, preselectedType]);

  React.useEffect(()=>{setReverseDraft(null);setReverseError(null);},[activeProject?.id]);

  const openReverse=(transaction:any)=>{if(!canReverse){setReverseError('Permission inventory.movement.reverse diperlukan.');return;}setReverseDraft({...transaction,reason:''});setReverseError(null);setReverseNotice(null);};
  const confirmReverse=async(e:React.FormEvent)=>{e.preventDefault();if(!reverseDraft||reverseSubmitting||!activeProject||!canReverse)return;const reason=String(reverseDraft.reason||'').trim();if(reason.length<8||reason.length>500){setReverseError('Alasan koreksi wajib 8–500 karakter.');return;}setReverseSubmitting(true);setReverseError(null);try{const result=await reverseStockMutation(reverseDraft.id,reason);if(result.success){setReverseNotice(result.message);setReverseDraft(null);}else setReverseError(result.message);}catch(err:any){setReverseError(err.message||'Pembalikan inventaris gagal.');}finally{setReverseSubmitting(false);}};

  const currentSelectedItem = useMemo(() => {
    return items.find((it) => it.id === selectedItemId && it.is_stock_item) || items.find((it) => it.is_stock_item);
  }, [items, selectedItemId]);

  // Projected stock
  const currentStock = canReadInventory ? (currentSelectedItem?.stok_saat_ini || 0) : null;
  const projectedStock = currentStock===null?null:mutationType === 'MASUK' ? currentStock + Number(qty || 0) : Math.max(0, currentStock - Number(qty || 0));
  const projectedStatus = projectedStock===null?null:currentSelectedItem ? computeItemStatus(projectedStock, currentSelectedItem.stok_minimum) : 'Tidak Tersedia';

  const filteredMutations = useMemo(() => {
    return stockMutations.filter((m) => {
      const matchSearch =
        m.nama_barang.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.tujuan_keperluan.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.pic_penerima_penyerah.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.nomor_surat_jalan && m.nomor_surat_jalan.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchType = filterType === 'ALL' || m.jenis === filterType;
      return matchSearch && matchType;
    });
  }, [stockMutations, searchQuery, filterType]);

  const handleOpenNewModal = (type: JenisMutasiBarang = 'MASUK') => {
    if(!activeProject||!stockWriteAccess||!canReadBoq){setErrorMessage('Permission inventory.movement.create dan boq.read pada Project aktif diperlukan.');return;}
    setMutationType(type);
    setQty(1);
    setPurpose('');
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setSourceName('');setDestinationName('');setOwnerType('KONTRAKTOR');
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleSubmitMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    if(submitting)return;
    if(!activeProject||!stockWriteAccess||!canReadBoq){setErrorMessage('Permission inventory.movement.create dan boq.read pada Project aktif diperlukan.');return;}
    setErrorMessage(null);

    if (!currentSelectedItem) {
      setErrorMessage('Pilih barang terlebih dahulu!');
      return;
    }

    if (qty <= 0) {
      setErrorMessage('Jumlah mutasi harus lebih besar dari 0!');
      return;
    }

    if (!sourceName.trim()||!destinationName.trim()) { setErrorMessage('Asal dan tujuan/lokasi barang wajib diisi.'); return; }
    if (!purpose.trim()) {
      setErrorMessage('Tujuan / keperluan pemakaian barang wajib diisi!');
      return;
    }

    setSubmitting(true);
    try { const res = await addStockMutation({
      barang_id: currentSelectedItem.id,
      nama_barang: currentSelectedItem.nama_barang,
      jenis: mutationType,
      jumlah: Number(qty),
      satuan: currentSelectedItem.satuan,
      tujuan_keperluan: purpose.trim(),
      pic_penerima_penyerah: pic.trim() || user.name,
      nomor_surat_jalan: suratJalan.trim() || undefined,
      tanggal: new Date().toISOString(),
      catatan: notes.trim() || undefined,
      source_name: sourceName.trim(),
      destination_name: destinationName.trim(),
      recipient_name: pic.trim()||user.name,
      owner_type: ownerType,
      purpose: purpose.trim(),
    });

    if (!res.success) {
      setErrorMessage(res.message);
      return;
    }

    setIsModalOpen(false);
    } catch(err:any) { setErrorMessage(err.message||'Gagal mencatat mutasi stok.'); }
    finally { setSubmitting(false); }
  };

  if (modalOnly && !isModalOpen) {
    return null;
  }
  if(!dataReady)return modalOnly?null:<div role="status" aria-live="polite" className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Memuat konteks Project dan Inventory…</div>;
  if(!activeProject)return modalOnly?null:<div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Pilih Project aktif untuk membuka mutasi stok.</div>;
  if(dataError)return modalOnly?null:<div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800"><p>Data Inventory gagal dimuat: {dataError}</p><button onClick={()=>void refreshData()} className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white">Coba lagi</button></div>;
  if(!canReadBoq)return modalOnly?null:<div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Permission boq.read pada Project aktif diperlukan untuk memilih item mutasi.</div>;
  if (!stockWriteAccess) {
    return modalOnly ? null : <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Permission inventory.movement.create pada Project aktif diperlukan untuk mencatat mutasi stok.</div>;
  }

  return (
    <div className={modalOnly ? '' : 'space-y-5'}>
      {reverseNotice&&<div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-300">{reverseNotice}</div>}
      {!modalOnly && (
        <>
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
                Mutasi Keluar / Masuk Stok Barang
              </h1>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            Setiap mutasi disimpan ke Supabase. Saldo fisik dihitung dari ledger transaksi; Qty BOQ tetap sebagai acuan kontrak.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenNewModal('MASUK')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <ArrowDownLeft className="w-4 h-4" />
            <span>+ Catat Masuk</span>
          </button>
          <button
            onClick={() => handleOpenNewModal('KELUAR')}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/50 rounded-lg transition-colors border border-rose-200 dark:border-rose-800"
          >
            <ArrowUpRight className="w-4 h-4" />
            <span>- Catat Keluar</span>
          </button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Cari transaksi mutasi, nama barang, keperluan, PIC, atau no surat jalan..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400 dark:text-slate-500 mr-1 font-medium">Jenis:</span>
          {[
            { id: 'ALL', label: `Semua (${stockMutations.length})` },
            { id: 'MASUK', label: `Masuk (${stockMutations.filter((m) => m.jenis === 'MASUK').length})` },
            { id: 'KELUAR', label: `Keluar (${stockMutations.filter((m) => m.jenis === 'KELUAR').length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id as any)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                filterType === tab.id
                  ? 'bg-slate-900 dark:bg-blue-600 text-white font-semibold'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mutation Log Table */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider text-[11px]">
                <th className="py-3 px-3.5 w-12 text-center">No</th>
                <th className="py-3 px-3.5">Waktu Transaksi</th>
                <th className="py-3 px-3.5 text-center">Jenis</th>
                <th className="py-3 px-3.5">Nama Material / Barang</th>
                <th className="py-3 px-3.5 text-right font-bold">Kuantitas</th>
                <th className="py-3 px-3.5">Asal / Tujuan Barang</th>
                <th className="py-3 px-3.5">Dicatat oleh</th>
                <th className="py-3 px-3.5">Penanggung Jawab (PIC)</th>
                <th className="py-3 px-3.5 text-center">No. Ref / Bon</th>
                <th className="py-3 px-3.5 text-right">Perubahan Stok</th>
                <th className="py-3 px-3.5">Koreksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {!canReadInventory ? (
                <tr><td colSpan={11} className="py-12 text-center text-amber-700">Permission inventory.read diperlukan untuk melihat riwayat mutasi.</td></tr>
              ) : filteredMutations.length === 0 ? (
                <tr>
                  <td colSpan={11} className="py-12 text-center text-slate-400 dark:text-slate-500">
                    Belum ada riwayat mutasi barang sesuai filter.
                  </td>
                </tr>
              ) : (
                filteredMutations.map((mut, idx) => (
                  <tr key={mut.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-3.5 text-center text-slate-400 dark:text-slate-500 font-mono text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                      {formatDateTime(mut.tanggal)}
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded ${
                          mut.jenis === 'MASUK'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        {mut.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        {mut.jenis}
                      </span>
                    </td>
                    <td className="py-3 px-3.5">
                      <div className="font-semibold text-slate-900 dark:text-white">{mut.nama_barang}</div>
                      {mut.catatan && <div className="text-[11px] text-slate-400 dark:text-slate-500 italic mt-0.5">{mut.catatan}</div>}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono font-bold tabular-nums">
                      <span className={mut.jenis === 'MASUK' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}>
                        {mut.jenis === 'MASUK' ? '+' : '-'} {mut.jumlah.toLocaleString('id-ID')}
                      </span>{' '}
                      <span className="text-[11px] text-slate-400 dark:text-slate-500 font-normal">{mut.satuan}</span>
                    </td>
                    <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300 max-w-xs truncate">{mut.source_name||mut.destination_name||mut.tujuan_keperluan}</td>
                    <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">{mut.created_by_name||'-'}</td>
                    <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300">
                      {mut.pic_penerima_penyerah}
                    </td>
                    <td className="py-3 px-3.5 text-center font-mono text-[11px] text-slate-500 dark:text-slate-400">
                      {mut.nomor_surat_jalan || '-'}
                    </td>
                    <td className="py-3 px-3.5 text-right font-mono text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
                      {mut.stok_sebelum} → <span className="font-bold text-slate-900 dark:text-white">{mut.stok_sesudah}</span> {mut.satuan}
                    </td>
                    <td className="py-3 px-3.5">{canReverse?<button onClick={()=>openReverse(mut)} className="rounded border border-amber-300 px-2 py-1 text-[10px] font-semibold text-amber-700 hover:bg-amber-50">Balikkan</button>:<span className="text-[10px] text-slate-400">—</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
        </>
      )}

      {/* Modal Record Stock Mutation */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 dark:bg-slate-950/80 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95 transition-colors">
            <div className="p-4 bg-slate-900 dark:bg-slate-950 text-white flex items-center justify-between border-b border-slate-800">
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
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white text-xs font-bold"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitMutation} className="p-5 space-y-4 text-xs">
              {errorMessage && (
                <div className="p-3 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 rounded-lg text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{errorMessage}</span>
                </div>
              )}

              {/* Mode Toggle */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  type="button"
                  onClick={() => setMutationType('MASUK')}
                  className={`py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    mutationType === 'MASUK'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <ArrowDownLeft className="w-3.5 h-3.5" />
                  <span>Stok Masuk (IN)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMutationType('KELUAR')}
                  className={`py-2 text-xs font-bold rounded-md transition-all flex items-center justify-center gap-1.5 ${
                    mutationType === 'KELUAR'
                      ? 'bg-rose-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  <span>Stok Keluar (OUT)</span>
                </button>
              </div>

              {/* Select Item */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pilih Material dari Katalog BOQ <span className="text-rose-500">*</span>
                </label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 text-xs"
                >
                  {items.filter((it) => it.is_stock_item).map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.nama_barang} (Sisa: {it.stok_saat_ini} {it.satuan} - {it.status})
                    </option>
                  ))}
                </select>
              </div>

              {/* Quantity and Preview */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Jumlah ({currentSelectedItem?.satuan || 'unit'}) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="number"
                    min="0.01"
                    step="any"
                    required
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg font-mono font-bold text-sm"
                  />
                </div>

                {canReadInventory?<div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col justify-center">
                  <span className="text-[10px] text-slate-400 dark:text-slate-500 uppercase tracking-wider font-semibold">Proyeksi Sisa Stok</span>
                  <div className="text-xs font-bold text-slate-900 dark:text-white mt-0.5 font-mono">{currentStock} → <span className={mutationType === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{projectedStock}</span> {currentSelectedItem?.satuan}</div>
                  <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Status baru: <strong className={projectedStatus === 'Tidak Tersedia' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>{projectedStatus}</strong></div>
                </div>:<div role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-[10px] text-amber-800">Saldo dan proyeksi stok disembunyikan karena permission inventory.read tidak tersedia. Server tetap memvalidasi saldo saat mutasi disimpan.</div>}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block"><span className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">Kepemilikan material *</span><select value={ownerType} onChange={e=>setOwnerType(e.target.value as any)} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"><option value="KONTRAKTOR">By Kontraktor</option><option value="IMK">By IMK</option></select></label>
                <label className="block"><span className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">{mutationType==='MASUK'?'Asal barang / supplier *':'Dari gudang / lokasi *'}</span><input required value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder={mutationType==='MASUK'?'Nama supplier / pihak pengirim':'Gudang / lokasi asal'} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"/></label>
                <label className="block"><span className="mb-1 block font-semibold text-slate-700 dark:text-slate-300">{mutationType==='MASUK'?'Masuk ke gudang / lokasi *':'Tujuan / area kerja *'}</span><input required value={destinationName} onChange={e=>setDestinationName(e.target.value)} placeholder={mutationType==='MASUK'?'Gudang / laydown penerimaan':'Area kerja / penerima tujuan'} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800"/></label>
              </div>

              {/* Purpose */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tujuan & Keperluan Pemakaian <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Pengecoran sloof kolom zona A, Pemasangan dinding container..."
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                />
              </div>

              {/* PIC & Surat Jalan */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Nama pihak pengirim / penerima</label>
                  <input
                    type="text"
                    value={pic}
                    onChange={(e) => setPic(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Surat Jalan / Bon</label>
                  <input
                    type="text"
                    placeholder="SJ-001 / BON-12"
                    value={suratJalan}
                    onChange={(e) => setSuratJalan(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg"
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Catatan Tambahan (Opsional)</label>
                <input
                  type="text"
                  placeholder="Kondisi barang, suplier, atau nama supir..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-lg"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-4 py-2 text-xs font-semibold text-white rounded-lg shadow-sm transition-colors ${
                    mutationType === 'MASUK'
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {submitting?'Menyimpan…':'Simpan Transaksi Mutasi'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {reverseDraft&&<div className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-slate-900/60 p-4 backdrop-blur-xs" onMouseDown={e=>{if(e.target===e.currentTarget&&!reverseSubmitting)setReverseDraft(null);}}>
        <form role="dialog" aria-modal="true" aria-labelledby="stock-reversal-title" onSubmit={confirmReverse} className="w-full max-w-lg space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-800 dark:bg-slate-900">
          <div><h2 id="stock-reversal-title" className="text-sm font-bold text-slate-900 dark:text-white">Pembalikan / koreksi transaksi stok</h2><p className="mt-1 text-xs text-slate-500">{reverseDraft.tanggal} · {reverseDraft.jenis} · {reverseDraft.nama_barang||reverseDraft.item_name||reverseDraft.item_id}</p><p className="mt-1 text-xs text-slate-500">{reverseDraft.qty} {reverseDraft.satuan} · {reverseDraft.tujuan||reverseDraft.keperluan||''}</p><p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Ledger asli bersifat append-only. Sistem membuat transaksi pembalik yang terhubung dan mencatat alasan koreksi.</p></div>
          {reverseError&&<p role="alert" className="rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{reverseError}</p>}
          <label className="block text-xs font-semibold">Alasan pembalikan<textarea required minLength={8} maxLength={500} rows={3} value={reverseDraft.reason} onChange={e=>setReverseDraft((x:any)=>x?{...x,reason:e.target.value}:x)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white" placeholder="Jelaskan kesalahan atau dasar koreksi…"/></label><p className="text-right text-[10px] text-slate-500">{reverseDraft.reason.trim().length}/500 karakter (minimal 8)</p>
          <div className="flex justify-end gap-2"><button type="button" disabled={reverseSubmitting} onClick={()=>setReverseDraft(null)} className="rounded-lg border px-4 py-2 text-xs">Batal</button><button type="submit" disabled={reverseSubmitting||reverseDraft.reason.trim().length<8} className="rounded-lg bg-amber-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{reverseSubmitting?'Memproses…':'Konfirmasi pembalikan'}</button></div>
        </form>
      </div>}
    </div>
  );
};
