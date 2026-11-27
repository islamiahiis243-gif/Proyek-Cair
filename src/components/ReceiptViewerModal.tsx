import React, { useEffect, useState } from 'react';
import {
  X,
  ZoomIn,
  ZoomOut,
  RotateCw,
  Download,
  FileText,
  Building2,
  Calendar,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Layers
} from 'lucide-react';
import { MutasiBarang, MutasiKas, ReceiptScope } from '../types';
import { PAYMENT_METHOD_LABELS } from '../lib/cashflowEngine';
import { getReceiptSignedUrl } from '../lib/receiptStorage';

interface ReceiptViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  primaryMutation?: MutasiBarang | null;
  allMutationsInReceipt?: MutasiBarang[];
  primaryCashMutation?: MutasiKas | null;
  allCashMutationsInReceipt?: MutasiKas[];
  receiptScope?: ReceiptScope;
  hideFinancialDetails?: boolean;
}

export const ReceiptViewerModal: React.FC<ReceiptViewerModalProps> = ({
  isOpen,
  onClose,
  primaryMutation = null,
  allMutationsInReceipt = [],
  primaryCashMutation = null,
  allCashMutationsInReceipt = [],
  receiptScope,
  hideFinancialDetails = false,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [rotation, setRotation] = useState<number>(0);
  const [activePageIndex, setActivePageIndex] = useState<number>(0);

  useEffect(() => {
    if (isOpen) {
      setActivePageIndex(0);
      setZoomLevel(1);
      setRotation(0);
    }
  }, [isOpen, primaryMutation?.id, primaryCashMutation?.id]);

  if (!isOpen || (!primaryMutation && !primaryCashMutation)) return null;

  const stockUrls = primaryMutation?.lampiran_nota_urls || [];
  const cashUrls = primaryCashMutation?.lampiran_nota_urls || [];
  const receiptUrls = Array.from(new Set([...stockUrls, ...cashUrls].filter(Boolean)));

  const currentUrl = receiptUrls[activePageIndex] || '';
  const [resolvedUrl, setResolvedUrl] = useState<string>(currentUrl);

  useEffect(() => {
    let isMounted = true;
    if (!currentUrl) {
      setResolvedUrl('');
      return;
    }
    if (currentUrl.startsWith('data:') || currentUrl.startsWith('blob:')) {
      setResolvedUrl(currentUrl);
      return;
    }
    getReceiptSignedUrl(currentUrl, 3600).then((signed) => {
      if (isMounted) setResolvedUrl(signed);
    });
    return () => {
      isMounted = false;
    };
  }, [currentUrl]);

  const effectiveDisplayUrl = resolvedUrl || currentUrl;
  const isPdf = effectiveDisplayUrl.toLowerCase().includes('.pdf') || effectiveDisplayUrl.startsWith('data:application/pdf');

  const receiptNo =
    primaryMutation?.nomor_nota ||
    primaryMutation?.nomor_surat_jalan ||
    primaryCashMutation?.nomor_kuitansi ||
    primaryCashMutation?.nomor_nota ||
    '-';
  const storeName =
    primaryMutation?.nama_toko ||
    primaryMutation?.source_name ||
    primaryCashMutation?.nama_toko ||
    primaryCashMutation?.pic ||
    'Toko / Pihak Lawan';
  const displayStoreName = hideFinancialDetails ? 'Pemasok Rekanan Proyek' : storeName;
  const storeContact = primaryMutation?.toko_kontak || primaryCashMutation?.toko_kontak;
  const receiptDate =
    primaryMutation?.tanggal_nota ||
    primaryCashMutation?.tanggal_nota ||
    primaryCashMutation?.tanggal ||
    primaryMutation?.tanggal;

  const relatedItems =
    allMutationsInReceipt.length > 0
      ? allMutationsInReceipt
      : primaryMutation
      ? [primaryMutation]
      : [];

  const relatedCash =
    allCashMutationsInReceipt.length > 0
      ? allCashMutationsInReceipt
      : primaryCashMutation
      ? [primaryCashMutation]
      : [];

  const effectiveScope: ReceiptScope =
    receiptScope ||
    (relatedItems.length > 0 && relatedCash.length > 0
      ? 'TERPADU'
      : relatedCash.length > 0
      ? 'KAS_OPERASIONAL'
      : 'BELANJA_BARANG');

  const totalItemAmount = relatedItems.reduce((acc, m) => {
    const price = m.harga_satuan_beli || 0;
    return acc + price * m.jumlah;
  }, 0);

  const totalCashAmount = relatedCash.reduce((acc, c) => acc + (Number(c.jumlah_rp) || 0), 0);

  const physicalTotal =
    primaryMutation?.total_nota_fisik ||
    primaryCashMutation?.total_nota_fisik ||
    (totalItemAmount > 0 ? totalItemAmount : totalCashAmount);

  const comparedAmount = relatedItems.length > 0 ? totalItemAmount : totalCashAmount;
  const isMatch = Math.abs(comparedAmount - physicalTotal) < 1;

  const handleZoomIn = () => setZoomLevel((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoomLevel((z) => Math.max(z - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoomLevel(1);
    setRotation(0);
  };
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-5xl h-[90vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 flex items-center justify-center">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                  {effectiveScope === 'KAS_OPERASIONAL' ? 'Bukti Kuitansi Kas' : 'Bukti Fisik Nota'}: {receiptNo}
                </h2>
                {!hideFinancialDetails && effectiveScope === 'TERPADU' && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800">
                    ✓ Terbayar Kas
                  </span>
                )}
                {receiptUrls.length > 1 && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200">
                    {receiptUrls.length} Lembar Berkas
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Pihak/Toko: <b>{displayStoreName}</b>
                {receiptDate && ` · Tanggal: ${new Date(receiptDate).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {effectiveDisplayUrl && (
              <a
                href={effectiveDisplayUrl}
                target="_blank"
                rel="noreferrer"
                download={`Nota_${receiptNo}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition-colors"
                title="Buka / Unduh Berkas Asli"
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Unduh</span>
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Konten Utama: 2 Kolom (Viewer Gambar Kiri, Rincian Item Kanan) */}
        <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
          {/* Kolom Kiri: Canvas Pratinjau Foto Nota */}
          <div className="flex-1 bg-slate-950 flex flex-col relative overflow-hidden select-none">
            {/* Toolbar Kontrol Gambar */}
            <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-md border border-slate-700/80 rounded-xl p-1 text-slate-200 shadow-lg">
              <button
                type="button"
                onClick={handleZoomIn}
                className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                title="Perbesar Tampilan"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleZoomOut}
                className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                title="Perkecil Tampilan"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleRotate}
                className="p-1.5 rounded-lg hover:bg-slate-800 transition-colors"
                title="Putar 90° Searah Jarum Jam"
              >
                <RotateCw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="px-2 py-1 text-[10px] font-bold rounded-lg hover:bg-slate-800 transition-colors"
                title="Kembalikan Tampilan Normal"
              >
                Atur Ulang
              </button>
            </div>

            {/* Navigasi Multi-Halaman (Jika > 1 Foto Nota) */}
            {receiptUrls.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 bg-slate-900/85 backdrop-blur-md border border-slate-700/80 rounded-full px-3 py-1.5 text-xs text-white shadow-xl">
                <button
                  type="button"
                  disabled={activePageIndex === 0}
                  onClick={() => {
                    setActivePageIndex((i) => Math.max(i - 1, 0));
                    handleResetZoom();
                  }}
                  className="p-1 disabled:opacity-30 hover:bg-slate-800 rounded-full"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="font-semibold text-[11px]">
                  Lembar {activePageIndex + 1} dari {receiptUrls.length}
                </span>
                <button
                  type="button"
                  disabled={activePageIndex === receiptUrls.length - 1}
                  onClick={() => {
                    setActivePageIndex((i) => Math.min(i + 1, receiptUrls.length - 1));
                    handleResetZoom();
                  }}
                  className="p-1 disabled:opacity-30 hover:bg-slate-800 rounded-full"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Area Gambar / PDF Viewer */}
            <div className="flex-1 overflow-auto flex items-center justify-center p-4">
              {receiptUrls.length === 0 ? (
                <div className="text-center p-8 text-slate-400">
                  <AlertCircle className="w-10 h-10 mx-auto mb-2 text-amber-500 opacity-80" />
                  <p className="text-sm font-semibold">Belum Ada Berkas Foto / PDF Nota</p>
                  <p className="text-xs text-slate-500 mt-1">
                    Gunakan tombol "Lengkapi Nota" untuk mengunggah lembar bon fisik toko.
                  </p>
                </div>
              ) : isPdf ? (
                <div className="w-full h-full flex flex-col items-center justify-center relative p-2">
                  <iframe
                    src={effectiveDisplayUrl}
                    className="w-full h-full rounded-xl bg-white border border-slate-700/60 shadow-2xl"
                    title={`Pratinjau Berkas PDF Nota ${receiptNo}`}
                  />
                  <div className="absolute top-4 right-4 z-20">
                    <a
                      href={effectiveDisplayUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-white text-xs font-semibold backdrop-blur-md border border-slate-700 shadow-lg transition-colors cursor-pointer"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Buka di Tab Baru</span>
                    </a>
                  </div>
                </div>
              ) : (
                <div
                  className="transition-transform duration-100 ease-out origin-center max-w-full max-h-full flex items-center justify-center"
                  style={{
                    transform: `scale(${zoomLevel}) rotate(${rotation}deg)`
                  }}
                >
                  <img
                    src={effectiveDisplayUrl}
                    alt={`Nota Toko ${receiptNo}`}
                    className="max-w-full max-h-[75vh] w-auto h-auto object-contain rounded-lg shadow-2xl pointer-events-none"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Kolom Kanan: Rekonsiliasi & Rincian Item dalam Nota Ini */}
          <div className="w-full lg:w-96 border-t lg:border-t-0 lg:border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col p-4 sm:p-5 overflow-y-auto">
            <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-3 flex items-center gap-2">
              <Layers className="w-3.5 h-3.5" />
              <span>Rekonsiliasi Rincian Nota</span>
            </h3>

            {/* Kotak Ringkasan Finansial Nota */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 p-3.5 space-y-2 mb-4">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Nomor Bon / Kuitansi:</span>
                <span className="font-bold text-slate-900 dark:text-white font-mono">{receiptNo}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Nama Toko / Pihak:</span>
                <span className="font-bold text-slate-900 dark:text-white">{displayStoreName}</span>
              </div>
              {!hideFinancialDetails && storeContact && (
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-slate-500">Kontak:</span>
                  <span className="text-slate-700 dark:text-slate-300">{storeContact}</span>
                </div>
              )}
              {!hideFinancialDetails && (
                <>
                  <div className="border-t border-slate-200 dark:border-slate-700/60 pt-2 flex items-center justify-between text-xs">
                    <span className="text-slate-600 dark:text-slate-400">Total Tercetak di Bukti:</span>
                    <span className="font-extrabold text-slate-900 dark:text-white font-mono">
                      Rp {physicalTotal.toLocaleString('id-ID')}
                    </span>
                  </div>
                  {relatedItems.length > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-slate-400">Akumulasi {relatedItems.length} Item Barang:</span>
                      <span className="font-extrabold text-blue-600 dark:text-blue-400 font-mono">
                        Rp {totalItemAmount.toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}
                  {relatedCash.length > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-600 dark:text-slate-400">Pembayaran Kas ({relatedCash.length} Baris):</span>
                      <span className="font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                        Rp {totalCashAmount.toLocaleString('id-ID')}
                      </span>
                    </div>
                  )}

                  {/* Status Rekonsiliasi Klop */}
                  <div
                    className={`mt-2 p-2 rounded-lg text-xs font-semibold flex items-center gap-2 ${
                      isMatch
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800'
                    }`}
                  >
                    {isMatch ? (
                      <>
                        <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        <span>✓ Total Klop 100% Sesuai Fisik Bukti</span>
                      </>
                    ) : (
                      <>
                        <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span>Selisih Rp {Math.abs(comparedAmount - physicalTotal).toLocaleString('id-ID')} (Diskon/Ongkir)</span>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Daftar Item Material yang Tercakup dalam Nota Ini */}
            {relatedItems.length > 0 && (
              <div className="space-y-2 mb-4">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Item Material dalam Nota Ini ({relatedItems.length} Jenis):
                </span>

                <div className="space-y-2 max-h-[28vh] overflow-y-auto pr-1">
                  {relatedItems.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {item.nama_item_aktual || item.nama_barang}
                          </div>
                          {item.nama_item_aktual && (
                            <div className="text-[10px] text-slate-400 truncate">
                              BOQ: {item.nama_barang}
                            </div>
                          )}
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {item.jumlah} {item.satuan}
                            {!hideFinancialDetails && ` @ Rp ${(item.harga_satuan_beli || 0).toLocaleString('id-ID')}`}
                          </div>
                        </div>
                        {!hideFinancialDetails && (
                          <div className="text-xs font-extrabold text-slate-900 dark:text-white shrink-0 text-right font-mono">
                            Rp {((item.harga_satuan_beli || 0) * item.jumlah).toLocaleString('id-ID')}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Daftar Baris Mutasi Kas yang Tertaut pada Bukti Ini */}
            {!hideFinancialDetails && relatedCash.length > 0 && (
              <div className="flex-1 space-y-2">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Transaksi Kas Tertaut ({relatedCash.length} Baris):
                </span>

                <div className="space-y-2 max-h-[28vh] overflow-y-auto pr-1">
                  {relatedCash.map((tx, idx) => (
                    <div
                      key={tx.id || idx}
                      className="p-2.5 rounded-xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/40 dark:bg-emerald-950/20"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {tx.untuk_apa}
                          </div>
                          <div className="text-[10px] text-slate-600 dark:text-slate-300 mt-0.5">
                            {tx.kategori_keperluan} · {PAYMENT_METHOD_LABELS[tx.payment_method || 'TUNAI']} · PIC: {tx.pic}
                          </div>
                        </div>
                        <div
                          className={`text-xs font-extrabold font-mono shrink-0 ${
                            tx.jenis === 'MASUK'
                              ? 'text-emerald-700 dark:text-emerald-300'
                              : 'text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {tx.jenis === 'MASUK' ? '+' : '-'} Rp {(tx.jumlah_rp || 0).toLocaleString('id-ID')}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer Penjelas Audit */}
            <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 text-[10px] text-slate-400 leading-relaxed">
              Catatan: Berkas nota ini tersimpan permanen sebagai bukti audit sah. Nilai barang telah diperhitungkan dalam Laporan Belanja Riil Proyek.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
