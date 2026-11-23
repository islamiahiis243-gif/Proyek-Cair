import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Boxes,
  WalletCards,
  ArrowDownLeft,
  ArrowUpRight,
  AlertTriangle,
  FileText,
  ShieldCheck,
  TrendingUp,
  PackageX,
  PackageCheck,
  Clock,
  ChevronRight,
  Building,
  Receipt,
  ShoppingBag,
  Coins,
  Warehouse,
  Layers,
  ArrowLeft,
  MoreVertical,
  Sparkles,
  X,
} from 'lucide-react';
import { formatRupiah, formatDateTime } from '../lib/pdfGenerator';
import { isClientProvidedRemark } from '../lib/stockMutationEngine';

interface DashboardViewProps {
  onOpenStockModal: (type?: 'MASUK' | 'KELUAR') => void;
  onOpenCashModal: (type?: 'MASUK' | 'KELUAR') => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  onOpenStockModal,
  onOpenCashModal,
}) => {
  const {
    items,
    stockMutations,
    cashMutations,
    physicalMaterials,
    totalStockAssetValue,
    currentCashBalance,
    cashAccess,
    cashWriteAccess,
    stockWriteAccess,
    outOfStockCount,
    lowStockCount,
    availableStockCount,
    setCurrentView,
    goBack,
    tenantBranding,
    activeRole,
  } = useApp();

  const isViewer = activeRole === 'Viewer/Pengamat';

  // State menu aksi cepat "Mau nyatat apa hari ini?"
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
        setIsActionMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsActionMenuOpen(false);
      }
    };

    if (isActionMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isActionMenuOpen]);

  // Cash stats
  const totalCashIn = cashMutations
    .filter((c) => c.jenis === 'MASUK')
    .reduce((sum, c) => sum + c.jumlah_rp, 0);

  const totalCashOut = cashMutations
    .filter((c) => c.jenis === 'KELUAR')
    .reduce((sum, c) => sum + c.jumlah_rp, 0);

  // Stock mutation stats
  const totalStockInQty = stockMutations
    .filter((m) => m.jenis === 'MASUK')
    .reduce((sum, m) => sum + m.jumlah, 0);

  const totalStockOutQty = stockMutations
    .filter((m) => m.jenis === 'KELUAR')
    .reduce((sum, m) => sum + m.jumlah, 0);

  const totalItemCount = items.length;
  const contractorItemCount = useMemo(() => {
    return items.filter((it) => !isClientProvidedRemark(it.keterangan, tenantBranding.clientName)).length;
  }, [items, tenantBranding.clientName]);
  const imkItemCount = useMemo(() => {
    return items.filter((it) => isClientProvidedRemark(it.keterangan, tenantBranding.clientName)).length;
  }, [items, tenantBranding.clientName]);
  const contractStats = useMemo(() => {
    let material = 0;
    let manpower = 0;
    let clientFreeIssue = 0;
    items.forEach((it) => {
      const val = Number(it.qty_boq || 0) * Number(it.harga_satuan || 0);
      if (isClientProvidedRemark(it.keterangan, tenantBranding.clientName)) {
        clientFreeIssue += val;
      } else {
        const catUpper = (it.kategori || '').toUpperCase();
        const isManpower = !it.is_stock_item || catUpper.startsWith('IV') || catUpper.includes('JASA') || catUpper.includes('UPAH');
        if (isManpower) manpower += val;
        else material += val;
      }
    });
    const total = material + manpower;
    const bruto = total + clientFreeIssue;
    return { material, manpower, total, clientFreeIssue, bruto };
  }, [items, tenantBranding.clientName]);
  const fulfilledOrArrivedCount = useMemo(() => {
    return items.filter((it) => Math.max(it.qty_masuk_total || 0, it.qty_keluar_total || 0) > 0).length;
  }, [items]);
  const pendingDeliveryCount = useMemo(() => {
    return items.filter((it) => Math.max(it.qty_masuk_total || 0, it.qty_keluar_total || 0) === 0).length;
  }, [items]);

  const totalBoqValue = useMemo(() => {
    return items.reduce((sum, it) => sum + (Number(it.qty_boq || 0) * Number(it.harga_satuan || 0)), 0);
  }, [items]);
  const availablePercent = totalItemCount > 0 ? Math.round((availableStockCount / totalItemCount) * 100) : 0;
  const lowPercent = totalItemCount > 0 ? Math.round((lowStockCount / totalItemCount) * 100) : 0;
  const outPercent = totalItemCount > 0 ? Math.round((outOfStockCount / totalItemCount) * 100) : 0;

  // Realisasi Finansial Belanja Material dari Riwayat Mutasi Aktif
  const materialFinancialStats = useMemo(() => {
    let totalInValue = 0;
    let totalOutValue = 0;
    let materialOutValue = 0;
    let itemsWithPriceCount = 0;
    let itemsPendingInvoiceCount = 0;
    let mainStoreName = '';
    const storeCountMap = new Map<string, number>();

    // Buat lookup harga riil material dari physicalMaterials
    const materialPriceMap = new Map<string, number>();
    (physicalMaterials || []).forEach((pm) => {
      const price =
        pm.harga_beli_rata_rata ||
        pm.harga_beli_terakhir ||
        (pm.total_qty_masuk > 0 && pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0
          ? Math.round(pm.total_nilai_belanja_riil / pm.total_qty_masuk)
          : 0);
      if (price > 0) {
        materialPriceMap.set(pm.id, price);
        materialPriceMap.set(pm.nama_barang.trim().toLowerCase(), price);
      }
    });

    // Lookup harga pagu BOQ
    const boqPriceMap = new Map<string, number>();
    items.forEach((it) => {
      if (it.harga_satuan > 0) {
        boqPriceMap.set(it.id, it.harga_satuan);
        boqPriceMap.set(it.nama_barang.trim().toLowerCase(), it.harga_satuan);
      }
    });

    stockMutations.forEach((m) => {
      if (m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') return;

      const qty = Number(m.jumlah || 0);
      const explicitPrice =
        m.harga_satuan_beli != null && Number(m.harga_satuan_beli) > 0 ? Number(m.harga_satuan_beli) : null;
      const fallbackPrice =
        materialPriceMap.get(m.barang_id) ||
        materialPriceMap.get((m.nama_barang || '').trim().toLowerCase()) ||
        boqPriceMap.get(m.barang_id) ||
        boqPriceMap.get((m.nama_barang || '').trim().toLowerCase()) ||
        0;

      const effectivePrice = explicitPrice ?? fallbackPrice;
      const lineTotal = qty * effectivePrice;

      if (m.jenis === 'MASUK') {
        totalInValue += lineTotal;
        if (explicitPrice != null && explicitPrice > 0) {
          itemsWithPriceCount += 1;
        } else {
          itemsPendingInvoiceCount += 1;
        }
        if (m.nama_toko) {
          storeCountMap.set(m.nama_toko, (storeCountMap.get(m.nama_toko) || 0) + 1);
        }
      } else if (m.jenis === 'KELUAR') {
        totalOutValue += lineTotal;

        // Cek apakah item fisik gudang
        const targetBoq = items.find((it) => it.id === m.barang_id);
        const targetPm = (physicalMaterials || []).find(
          (pm) => pm.id === m.barang_id || pm.nama_barang === m.nama_barang
        );
        const isStock = targetBoq ? targetBoq.is_stock_item : targetPm ? targetPm.is_stock_item : true;
        if (isStock) {
          materialOutValue += lineTotal;
        }
      }
    });

    let maxCount = 0;
    storeCountMap.forEach((count, name) => {
      if (count > maxCount) {
        maxCount = count;
        mainStoreName = name;
      }
    });

    const boqMaterialBudget = contractStats.material || 0;
    const sisaPaguMaterial = Math.max(0, boqMaterialBudget - totalInValue);
    const penyerapanPercent = boqMaterialBudget > 0 ? (totalInValue / boqMaterialBudget) * 100 : 0;

    // Valuasi stok gudang dihitung riil dari saldo fisik barang di gudang dikalikan harga riilnya
    const warehouseStockValue = (physicalMaterials || [])
      .filter((pm) => pm.is_stock_item)
      .reduce((sum, pm) => {
        const p =
          pm.harga_beli_rata_rata ||
          pm.harga_beli_terakhir ||
          (pm.total_qty_masuk > 0 && pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0
            ? Math.round(pm.total_nilai_belanja_riil / pm.total_qty_masuk)
            : 0);
        return sum + Math.max(0, pm.stok_fisik || 0) * p;
      }, 0);

    return {
      totalInValue,
      totalOutValue,
      materialOutValue,
      warehouseStockValue,
      boqMaterialBudget,
      sisaPaguMaterial,
      penyerapanPercent,
      itemsWithPriceCount,
      itemsPendingInvoiceCount,
      mainStoreName: mainStoreName || 'Penyedia Resmi'
    };
  }, [stockMutations, physicalMaterials, items, contractStats.material]);

  return (
    <div className="space-y-6">
      {/* Top Banner & Quick Action Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => goBack ? goBack() : setCurrentView('landing')}
              className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer mr-1"
              title="Kembali ke satu langkah/halaman sebelumnya"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Beranda</span>
            </button>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
              Dasbor Proyek
            </span>
          </div>

          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Dashboard Analitik Proyek Cair
            </h1>
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Data Supabase
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
            Monitoring arus barang keluar-masuk dan mutasi kas proyek {tenantBranding.projectName}.
          </p>
        </div>

        {/* Kolom Kanan: Logo words (Jauh Lebih Gede & Leluasa) + 1 Tombol Titik Tiga di Paling Kanan */}
        <div className="flex items-center justify-between sm:justify-end gap-3 sm:gap-4 shrink-0">
          {/* Banner Rata Kanan: words_PNG2 (Dark) & words_light (Light) dibuat jauh lebih GEDE */}
          <div className="flex items-center justify-center self-center shrink-0">
            <img
              src="/words_PNG2.png"
              alt="Proyek Cair"
              className="h-12 sm:h-16 lg:h-20 w-auto max-w-[200px] sm:max-w-[260px] lg:max-w-[320px] object-contain drop-shadow-md dark:block hidden transition-all"
            />
            <img
              src="/words_light.png"
              alt="Proyek Cair"
              className="h-12 sm:h-16 lg:h-20 w-auto max-w-[200px] sm:max-w-[260px] lg:max-w-[320px] object-contain drop-shadow-md dark:hidden block transition-all"
            />
          </div>

          {/* 1 Tombol Titik Tiga di Paling Kanan */}
          {(stockWriteAccess || cashWriteAccess) && (
            <div className="relative" ref={actionMenuRef}>
              <button
                type="button"
                onClick={() => setIsActionMenuOpen((prev) => !prev)}
                className={`p-2.5 sm:p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-center shadow-xs ${
                  isActionMenuOpen
                    ? 'bg-blue-600 text-white border-blue-600 ring-2 ring-blue-500/30 shadow-md'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                }`}
                title="Pencatatan Transaksi Cepat (Mau nyatat apa hari ini?)"
                aria-label="Menu Pencatatan Transaksi Cepat"
                aria-expanded={isActionMenuOpen}
              >
                <MoreVertical className="w-5 h-5" />
              </button>

              {/* Kartu Popover: Mau nyatat apa hari ini? */}
              {isActionMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-[320px] sm:w-[360px] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 p-4 z-50 animate-in fade-in zoom-in-95 duration-150">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800 mb-3">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-950/70 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white leading-tight">
                          Mau nyatat apa hari ini?
                        </h3>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Pilih jenis mutasi yang ingin dibukukan:
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsActionMenuOpen(false)}
                      className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                      title="Tutup Menu"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="space-y-2">
                    {/* 1. Catat Stok Masuk */}
                    {stockWriteAccess && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsActionMenuOpen(false);
                          onOpenStockModal('MASUK');
                        }}
                        className="w-full text-left p-3 rounded-xl border border-blue-100 dark:border-blue-950/60 bg-blue-50/40 dark:bg-blue-950/20 hover:bg-blue-100/60 dark:hover:bg-blue-950/50 hover:border-blue-300 dark:hover:border-blue-800 transition-all cursor-pointer group flex items-start gap-3"
                      >
                        <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                          <ArrowDownLeft className="w-4 h-4 text-blue-100" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-blue-900 dark:text-blue-300">
                              + Catat Stok Masuk
                            </span>
                            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300">
                              Gudang
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                            Penerimaan material/barang tiba dari toko atau supplier
                          </p>
                        </div>
                      </button>
                    )}

                    {/* 2. Catat Stok Keluar */}
                    {stockWriteAccess && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsActionMenuOpen(false);
                          onOpenStockModal('KELUAR');
                        }}
                        className="w-full text-left p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 hover:bg-slate-100 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 transition-all cursor-pointer group flex items-start gap-3"
                      >
                        <div className="w-8 h-8 rounded-lg bg-slate-700 dark:bg-slate-700 text-white flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                          <ArrowUpRight className="w-4 h-4 text-rose-300" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              - Catat Stok Keluar
                            </span>
                            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                              Lapangan
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                            Pengeluaran material dari gudang ke pos pekerjaan fisik
                          </p>
                        </div>
                      </button>
                    )}

                    {/* 3. Catat Kas Masuk */}
                    {cashWriteAccess && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsActionMenuOpen(false);
                          onOpenCashModal('MASUK');
                        }}
                        className="w-full text-left p-3 rounded-xl border border-emerald-100 dark:border-emerald-950/60 bg-emerald-50/40 dark:bg-emerald-950/20 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/50 hover:border-emerald-300 dark:hover:border-emerald-800 transition-all cursor-pointer group flex items-start gap-3"
                      >
                        <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                          <ArrowDownLeft className="w-4 h-4 text-emerald-100" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-emerald-900 dark:text-emerald-300">
                              + Catat Kas Masuk
                            </span>
                            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300">
                              Arus Kas
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                            Penerimaan uang kas proyek dari termin klien atau modal
                          </p>
                        </div>
                      </button>
                    )}

                    {/* 4. Catat Kas Keluar */}
                    {cashWriteAccess && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsActionMenuOpen(false);
                          onOpenCashModal('KELUAR');
                        }}
                        className="w-full text-left p-3 rounded-xl border border-rose-100 dark:border-rose-950/60 bg-rose-50/40 dark:bg-rose-950/20 hover:bg-rose-100/60 dark:hover:bg-rose-950/50 hover:border-rose-300 dark:hover:border-rose-800 transition-all cursor-pointer group flex items-start gap-3"
                      >
                        <div className="w-8 h-8 rounded-lg bg-rose-600 text-white flex items-center justify-center shrink-0 mt-0.5 group-hover:scale-105 transition-transform">
                          <ArrowUpRight className="w-4 h-4 text-rose-100" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-rose-900 dark:text-rose-300">
                              - Catat Kas Keluar
                            </span>
                            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/60 text-rose-700 dark:text-rose-300">
                              Belanja Kas
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 leading-snug">
                            Pengeluaran uang operasional atau belanja tunai lapangan
                          </p>
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Stock Zero Warning Notice */}
      {outOfStockCount > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/50 rounded-xl p-4 flex items-start gap-3 transition-colors">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <span className="font-semibold text-amber-900 dark:text-amber-200">
              Otomasi Status Stok Aktif: {outOfStockCount} item berstatus "Tidak Tersedia" (stok = 0).
            </span>{' '}
            <span className="text-amber-800 dark:text-amber-300/80">
              Saldo fisik saat ini dihitung dari ledger mutasi, bukan dari Qty BOQ. Saat barang benar-benar diterima di lokasi proyek via menu{' '}
              <strong className="underline cursor-pointer" onClick={() => onOpenStockModal('MASUK')}>
                Mutasi Masuk
              </strong>
              , status item akan otomatis beralih menjadi Tersedia.
            </span>
          </div>
          <button
            onClick={() => setCurrentView('inventory')}
            className="text-xs font-semibold text-amber-900 dark:text-amber-300 hover:underline shrink-0"
          >
            Lihat Katalog →
          </button>
        </div>
      )}

      {/* KPI Cards Grid */}
      <div className={`grid grid-cols-1 sm:grid-cols-2 ${isViewer ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-4`}>
        {/* Card 1: Saldo Kas (Disembunyikan sepenuhnya untuk Viewer/Pengamat) */}
        {!isViewer && (
          <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span className="text-xs font-semibold uppercase tracking-wider">Saldo Kas Proyek</span>
              <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <WalletCards className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
              {cashAccess?formatRupiah(currentCashBalance):'Akses terbatas'}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 font-medium border-t border-slate-100 dark:border-slate-800 pt-2">
              <span>Masuk: {cashAccess?formatRupiah(totalCashIn):'—'}</span>
              <span>Keluar: {cashAccess?formatRupiah(totalCashOut):'—'}</span>
            </div>
          </div>
        )}

        {/* Card 2: Ruang Lingkup BOQ (Fisik untuk Viewer, Finansial Kontrak untuk Non-Viewer) */}
        {isViewer ? (
          <div
            onClick={() => setCurrentView('stock-mutations')}
            className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-cyan-400 dark:hover:border-cyan-600 cursor-pointer group"
            title="Klik untuk membuka Mutasi Barang & Pemantauan BOQ"
          >
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span className="text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400 flex items-center gap-1">
                <span>Ruang Lingkup Fisik BOQ</span>
                <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
              <div className="w-8 h-8 rounded-lg bg-cyan-50 dark:bg-cyan-950/50 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
              {items.length} Pos
            </div>
            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
              Material: <span className="font-semibold text-slate-800 dark:text-slate-200">{items.filter(it => !isClientProvidedRemark(it.keterangan, tenantBranding.clientName) && it.satuan !== 'ls').length} Pos</span> · Upah: <span className="font-semibold text-slate-800 dark:text-slate-200">{items.filter(it => (it.kategori || '').toLowerCase().includes('manpower') || (it.kategori || '').toLowerCase().includes('upah') || it.satuan === 'ls').length} Pos</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-purple-600 dark:text-purple-400 border-t border-slate-100 dark:border-slate-800 pt-2 font-medium">
              <span>+ Aset Klien ({tenantBranding.clientName}): {imkItemCount} Pos Material</span>
              <span className="text-slate-600 dark:text-slate-300 font-normal">Fokus Fisik Lapangan</span>
            </div>
          </div>
        ) : (
          <div
            onClick={() => setCurrentView('stock-mutations')}
            className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-blue-400 dark:hover:border-blue-600 cursor-pointer group"
            title="Klik untuk membuka Mutasi Barang & Pemantauan BOQ"
          >
            <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 flex items-center gap-1">
                <span>Nilai Kontrak Pelaksanaan</span>
                <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
              </span>
              <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Boxes className="w-4 h-4" />
              </div>
            </div>
            <div className="mt-2 text-2xl font-bold font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
              {formatRupiah(contractStats.total)}
            </div>
            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
              Material: <span className="font-semibold text-slate-800 dark:text-slate-200">{formatRupiah(contractStats.material)}</span> · Upah: <span className="font-semibold text-slate-800 dark:text-slate-200">{formatRupiah(contractStats.manpower)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-[10px] text-purple-600 dark:text-purple-400 border-t border-slate-100 dark:border-slate-800 pt-2 font-medium">
              <span>+ Aset Klien ({tenantBranding.clientName}): {formatRupiah(contractStats.clientFreeIssue)}</span>
              <span className="text-slate-600 dark:text-slate-300 font-normal">Bruto: {formatRupiah(contractStats.bruto)}</span>
            </div>
          </div>
        )}

        {/* Card 3: Pos Pemenuhan BOQ */}
        <div
          onClick={() => setCurrentView('stock-mutations')}
          className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-all hover:border-emerald-400 dark:hover:border-emerald-600 cursor-pointer group"
          title={`Klik untuk melihat rincian pemenuhan ${items.length} pos item BOQ`}
        >
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1">
              <span>Pos Pemenuhan BOQ</span>
              <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
            </span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <PackageCheck className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-white tabular-nums inline-block min-w-[2.5rem]">{items.length}</span>
            <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">Pos Pekerjaan & Material</span>
          </div>
          <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium flex items-center gap-1">
            <span className="font-semibold text-blue-600 dark:text-blue-400 inline-block min-w-[7rem]">{contractorItemCount} {tenantBranding.contractorName}</span>
            <span>·</span>
            <span className="font-semibold text-purple-600 dark:text-purple-400">{imkItemCount} Free-Issue Klien</span>
          </div>
          <div className="mt-2 flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-2">
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">{fulfilledOrArrivedCount} Terealisasi</span>
            <span className="text-amber-600 dark:text-amber-400 font-semibold">{pendingDeliveryCount} Belum Tiba</span>
          </div>
        </div>

        {/* Card 4: Volume Transaksi */}
        <div className="bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
          <div className="flex items-center justify-between text-slate-600 dark:text-slate-300">
            <span className="text-xs font-semibold uppercase tracking-wider">Aktivitas Mutasi</span>
            <div className="w-8 h-8 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-600 dark:text-purple-400 flex items-center justify-center">
              <TrendingUp className="w-4 h-4" />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold text-slate-900 dark:text-white tabular-nums">
            {isViewer ? stockMutations.length : stockMutations.length + cashMutations.length}
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600 dark:text-slate-300 font-medium border-t border-slate-100 dark:border-slate-800 pt-2">
            <span>Stok: {stockMutations.length} trx</span>
            {!isViewer && <span>Kas: {cashMutations.length} trx</span>}
          </div>
        </div>
      </div>

      {/* Bilah Khusus Finansial Pengadaan Material (Opsi B) */}
      {!isViewer && (
        <div className="bg-slate-50/90 dark:bg-slate-900/60 p-5 rounded-2xl border border-slate-200/90 dark:border-slate-800 space-y-4 transition-colors shadow-2xs">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200/70 dark:border-blue-900/50">
                <Receipt className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                    Realisasi Finansial Belanja Material
                  </h2>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-100/70 dark:bg-blue-950/80 px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                    Audit Nota Riil
                  </span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                  Pelacakan nilai belanja barang masuk terhadap pagu material kontrak BOQ {tenantBranding.projectName}.
                </p>
              </div>
            </div>
            <button
              onClick={() => setCurrentView('stock-mutations')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 inline-flex items-center gap-1 self-start sm:self-auto py-1 px-2.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/50 transition-colors"
            >
              <span>Buka Rincian Nota & Mutasi</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {/* Kartu 1: Belanja Material Masuk (Riil) */}
            <div
              onClick={() => setCurrentView('stock-mutations')}
              className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-blue-400 dark:hover:border-blue-500 transition-all cursor-pointer group"
              title="Klik untuk melihat transaksi mutasi masuk"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Belanja Masuk (Riil)
                </span>
                <div className="w-7 h-7 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                  <ShoppingBag className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="mt-2 text-xl font-bold font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatRupiah(materialFinancialStats.totalInValue)}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                  {materialFinancialStats.penyerapanPercent.toFixed(1)}% Terserap
                </span>
                <span className="text-slate-600 dark:text-slate-300 font-medium">dari Pagu Material</span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-medium flex items-center justify-between">
                <span>Penyedia: <strong className="text-slate-800 dark:text-slate-200">{materialFinancialStats.mainStoreName}</strong></span>
                <span className="font-semibold text-blue-600 dark:text-blue-400">{materialFinancialStats.itemsWithPriceCount} item nota</span>
              </div>
            </div>

            {/* Kartu 2: Sisa Pagu Anggaran Material BOQ */}
            <div
              onClick={() => setCurrentView('stock-mutations')}
              className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-cyan-400 dark:hover:border-cyan-500 transition-all cursor-pointer group"
              title="Klik untuk membuka pemantauan BOQ"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Sisa Pagu Material BOQ
                </span>
                <div className="w-7 h-7 rounded-lg bg-cyan-50 dark:bg-cyan-950/60 text-cyan-600 dark:text-cyan-400 flex items-center justify-center">
                  <Coins className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="mt-2 text-xl font-bold font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatRupiah(materialFinancialStats.sisaPaguMaterial)}
              </div>
              <div className="mt-1 flex items-center gap-1.5 text-[11px]">
                <span className="font-semibold text-cyan-600 dark:text-cyan-400">
                  {(100 - materialFinancialStats.penyerapanPercent).toFixed(1)}% Sisa Aman
                </span>
                <span className="text-slate-600 dark:text-slate-300 font-medium">tersedia</span>
              </div>
              <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-medium flex items-center justify-between">
                <span>Pagu Total Material:</span>
                <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">{formatRupiah(materialFinancialStats.boqMaterialBudget)}</span>
              </div>
            </div>

            {/* Kartu 3: Valuasi Aset Stok di Gudang */}
            <div
              onClick={() => setCurrentView('stock-mutations')}
              className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-amber-400 dark:hover:border-amber-500 transition-all cursor-pointer group"
              title="Klik untuk melihat stok barang di gudang"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Valuasi Stok Gudang
                </span>
                <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Warehouse className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="mt-2 text-xl font-bold font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatRupiah(materialFinancialStats.warehouseStockValue)}
              </div>
              <div className="mt-1 text-[11px] text-amber-600 dark:text-amber-400 font-semibold">
                Aset fisik siap pakai ke lapangan
              </div>
              <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-medium flex items-center justify-between">
                <span>Gudang Utama Proyek</span>
                <span className="font-semibold text-slate-800 dark:text-slate-200">Stok riil aktif</span>
              </div>
            </div>

            {/* Kartu 4: Realisasi Terpasang / Keluar ke Pekerjaan */}
            <div
              onClick={() => setCurrentView('stock-mutations')}
              className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs hover:border-indigo-400 dark:hover:border-indigo-500 transition-all cursor-pointer group"
              title="Klik untuk melihat pemakaian material ke lapangan"
            >
              <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Material Terpakai (Keluar)
                </span>
                <div className="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 flex items-center justify-center">
                  <Layers className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="mt-2 text-xl font-bold font-mono tracking-tight text-slate-900 dark:text-white tabular-nums">
                {formatRupiah(
                  materialFinancialStats.materialOutValue > 0
                    ? materialFinancialStats.materialOutValue
                    : materialFinancialStats.totalOutValue
                )}
              </div>
              <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                {materialFinancialStats.totalOutValue === 0 ? (
                  'Belum ada pengeluaran fisik'
                ) : (
                  <span>
                    Teralokasi ke pos pekerjaan
                    {materialFinancialStats.totalOutValue > materialFinancialStats.materialOutValue && (
                      <span className="block text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold mt-0.5">
                        + {formatRupiah(materialFinancialStats.totalOutValue - materialFinancialStats.materialOutValue)} Jasa/Upah BOQ (Total: {formatRupiah(materialFinancialStats.totalOutValue)})
                      </span>
                    )}
                  </span>
                )}
              </div>
              <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-300 font-medium flex items-center justify-between">
                <span>Realisasi Lapangan</span>
                <span className="font-semibold text-indigo-600 dark:text-indigo-400">Pos Pekerjaan BOQ</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Two-Column Analytics: Recent Stock vs Recent Cash Mutations */}
      <div className={`grid grid-cols-1 ${isViewer ? 'lg:grid-cols-1' : 'lg:grid-cols-2'} gap-6`}>
        {/* Left: Recent Stock Mutations */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col transition-colors">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Boxes className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Mutasi Barang Terkini</h2>
            </div>
            <button
              onClick={() => setCurrentView('stock-mutations')}
              className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 flex items-center gap-1"
            >
              <span>Lihat Semua</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
            {stockMutations.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-300 font-medium">
                Belum ada transaksi mutasi barang.
              </div>
            ) : (
              stockMutations.slice(0, 5).map((mut) => (
                <div key={mut.id} className="p-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                        mut.jenis === 'MASUK'
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                      }`}
                    >
                      {mut.jenis === 'MASUK' ? 'IN' : 'OUT'}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                        {mut.nama_barang}
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium truncate mt-0.5">
                        {mut.tujuan_keperluan}
                      </div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-0.5 flex items-center gap-2">
                        <span>PIC: {mut.pic_penerima_penyerah}</span>
                        <span>·</span>
                        <span>{formatDateTime(mut.tanggal)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <div
                      className={`text-xs font-bold font-mono tabular-nums ${
                        mut.jenis === 'MASUK' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                      }`}
                    >
                      {mut.jenis === 'MASUK' ? '+' : '-'} {mut.jumlah} {mut.satuan}
                    </div>
                    <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-0.5 font-mono">
                      Sisa: {mut.stok_sesudah} {mut.satuan}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right: Recent Cash Mutations (Kas Masuk/Keluar/Untuk Apa/Saldo) - Disembunyikan untuk Viewer */}
        {!isViewer && (
          <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col transition-colors">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <WalletCards className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Buku Mutasi Kas Terkini</h2>
              </div>
              <button
                onClick={() => setCurrentView('cashflow')}
                className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-300 flex items-center gap-1"
              >
                <span>Lihat Semua</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100 dark:divide-slate-800 flex-1">
              {cashMutations.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-300 font-medium">
                  {cashAccess?'Belum ada transaksi kas.':'Data kas tidak tersedia untuk role akun ini.'}
                </div>
              ) : (
                cashMutations.slice(0, 5).map((c) => (
                  <div key={c.id} className="p-3.5 hover:bg-slate-50/70 dark:hover:bg-slate-800/50 transition-colors flex items-center justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 ${
                          c.jenis === 'MASUK'
                            ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                            : 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                        }`}
                      >
                        {c.jenis === 'MASUK' ? 'IN' : 'OUT'}
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                          {c.untuk_apa}
                        </div>
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium mt-0.5 flex items-center gap-2">
                          <span>{c.kategori_keperluan}</span>
                          <span>·</span>
                          <span>PIC: {c.pic}</span>
                        </div>
                        <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-0.5">
                          {formatDateTime(c.tanggal)}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div
                        className={`text-xs font-bold font-mono tabular-nums ${
                          c.jenis === 'MASUK' ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'
                        }`}
                      >
                        {c.jenis === 'MASUK' ? '+' : '-'} {formatRupiah(c.jumlah_rp)}
                      </div>
                      <div className="text-[10px] text-slate-600 dark:text-slate-400 mt-0.5 font-mono">
                        Saldo: {formatRupiah(c.saldo_setelah)}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Quick Export PDF Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-5 sm:p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 border border-indigo-900/60 shadow-xl relative overflow-hidden">
        <div className="space-y-1.5 relative z-10">
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center shrink-0 border border-blue-400/30">
              <FileText className="w-4 h-4 text-blue-400" />
            </div>
            <h3 className="text-sm sm:text-base font-extrabold tracking-tight">
              Cetak Laporan Otomatis & QR Code Validasi
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
              PDF Siap Cetak
            </span>
          </div>
          <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
            Hasilkan dokumen laporan resmi dan rekapitulasi kerja berformat PDF langsung dari transaksi riil proyek, lengkap dengan QR code registrasi validasi, checksum snapshot integritas data, dan kop perusahaan.
          </p>
        </div>
        <button
          onClick={() => setCurrentView('reports')}
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-blue-600 hover:bg-blue-500 rounded-xl transition-all shadow-md hover:shadow-blue-500/25 shrink-0 cursor-pointer relative z-10"
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Buka Studio Laporan PDF ➔</span>
        </button>
      </div>
    </div>
  );
};
