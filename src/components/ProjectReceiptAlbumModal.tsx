import React, { useState, useMemo } from 'react';
import {
  X,
  Images,
  Search,
  Building2,
  Calendar,
  Receipt,
  FileText,
  ExternalLink,
  PackageCheck,
  Eye,
  CheckCircle2,
  Paperclip
} from 'lucide-react';
import { ProjectReceiptAlbumItem, MutasiBarang } from '../types';
import { formatDateTime, formatRupiah } from '../lib/pdfGenerator';

interface ProjectReceiptAlbumModalProps {
  isOpen: boolean;
  onClose: () => void;
  albumItems: ProjectReceiptAlbumItem[];
  onOpenReceiptViewer: (mutation: MutasiBarang, related: MutasiBarang[]) => void;
  onSelectForLinking?: (receipt: ProjectReceiptAlbumItem) => void;
}

export const ProjectReceiptAlbumModal: React.FC<ProjectReceiptAlbumModalProps> = ({
  isOpen,
  onClose,
  albumItems,
  onOpenReceiptViewer,
  onSelectForLinking
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'ALL' | 'HAS_FILE' | 'PENDING_FILE'>('ALL');

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return albumItems.filter((item) => {
      const matchSearch =
        !q ||
        item.storeName.toLowerCase().includes(q) ||
        item.receiptNo.toLowerCase().includes(q) ||
        (item.receiptDate && item.receiptDate.toLowerCase().includes(q)) ||
        item.sampleItemNames.some((n) => n.toLowerCase().includes(q));

      const hasFile = item.attachmentUrls && item.attachmentUrls.length > 0;
      if (activeTab === 'HAS_FILE' && !hasFile) return false;
      if (activeTab === 'PENDING_FILE' && hasFile) return false;

      return matchSearch;
    });
  }, [albumItems, searchQuery, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl max-h-[92vh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden">
        {/* Header Modal */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-300 flex items-center justify-center shrink-0 shadow-inner">
              <Images className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white">
                  Album Galeri Berkas Nota Resmi Proyek
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-indigo-100 dark:bg-indigo-950/80 text-indigo-800 dark:text-indigo-200">
                  {albumItems.length} Nota Terdaftar
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Koleksi terpusat seluruh foto & pindaian PDF nota resmi toko yang telah tersimpan rapi untuk ditautkan ke mutasi barang.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar Pencarian & Filter */}
        <div className="p-4 border-b border-slate-200/80 dark:border-slate-800 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama toko suplier, nomor nota fisik, nama barang..."
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setActiveTab('ALL')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'ALL'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Semua ({albumItems.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('HAS_FILE')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'HAS_FILE'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Ada Lampiran ({albumItems.filter((i) => i.attachmentUrls.length > 0).length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('PENDING_FILE')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                activeTab === 'PENDING_FILE'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Belum Berkas ({albumItems.filter((i) => i.attachmentUrls.length === 0).length})
            </button>
          </div>
        </div>

        {/* Isi Galeri Album Nota */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {filteredItems.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center">
                <Images className="w-6 h-6" />
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                Belum ada berkas nota yang cocok dengan kriteria pencarian ini.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredItems.map((item) => {
                const hasUrls = item.attachmentUrls && item.attachmentUrls.length > 0;
                const firstUrl = hasUrls ? item.attachmentUrls[0] : '';
                const isPdf = firstUrl.toLowerCase().includes('.pdf') || firstUrl.startsWith('data:application/pdf');

                return (
                  <div
                    key={item.id}
                    className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-850 hover:border-indigo-500/80 dark:hover:border-indigo-400/80 hover:shadow-xl transition-all p-4 flex flex-col justify-between space-y-3.5"
                  >
                    {/* Header Kartu: Toko & No Seri */}
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400">
                            <Building2 className="w-3.5 h-3.5 shrink-0" />
                            <span className="text-xs font-black truncate">{item.storeName}</span>
                          </div>
                          <h3 className="text-sm font-extrabold text-slate-900 dark:text-white mt-0.5 truncate" title={item.receiptNo}>
                            {item.receiptNo}
                          </h3>
                        </div>
                        <span className="shrink-0 text-[10px] font-black px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          {item.linkedMutationsCount} Item Masuk
                        </span>
                      </div>

                      {/* Frame Thumbnail Berkas */}
                      <div
                        onClick={() => {
                          if (hasUrls && item.rawMutations.length > 0) {
                            onOpenReceiptViewer(item.rawMutations[0], item.rawMutations);
                          }
                        }}
                        className={`h-36 rounded-xl border border-slate-200 dark:border-slate-700/80 overflow-hidden relative flex items-center justify-center transition-all ${
                          hasUrls ? 'cursor-pointer group-hover:ring-2 group-hover:ring-indigo-500/50' : 'bg-slate-50 dark:bg-slate-800/40'
                        }`}
                      >
                        {hasUrls ? (
                          isPdf ? (
                            <div className="flex flex-col items-center justify-center gap-2 p-3 text-rose-600 dark:text-rose-400 bg-rose-50/50 dark:bg-rose-950/30 w-full h-full">
                              <FileText className="w-10 h-10" />
                              <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900 text-rose-900 dark:text-rose-100 border border-rose-200 dark:border-rose-800">
                                Berkas Pindaian PDF
                              </span>
                              <span className="text-[9px] text-slate-500 dark:text-slate-400">Klik untuk melihat isi</span>
                            </div>
                          ) : (
                            <img
                              src={firstUrl}
                              alt={item.receiptNo}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          )
                        ) : (
                          <div className="flex flex-col items-center justify-center gap-1.5 p-3 text-slate-400">
                            <Receipt className="w-10 h-10 stroke-[1.5]" />
                            <span className="text-[10px] font-semibold">Belum Ada Foto Nota</span>
                          </div>
                        )}

                        {item.attachmentUrls.length > 1 && (
                          <span className="absolute bottom-2 right-2 text-[9px] font-black px-2 py-0.5 rounded-lg bg-slate-950/80 text-white backdrop-blur-xs flex items-center gap-1">
                            <Paperclip className="w-2.5 h-2.5" />
                            <span>{item.attachmentUrls.length} Lembar</span>
                          </span>
                        )}
                      </div>

                      {/* Detail Nominal & Tanggal */}
                      <div className="space-y-1.5 pt-1 text-xs">
                        <div className="flex items-center justify-between text-slate-600 dark:text-slate-300 font-mono">
                          <span className="text-[11px] text-slate-500 flex items-center gap-1">
                            <Calendar className="w-3.5 h-3.5" />
                            <span>{item.receiptDate ? formatDateTime(item.receiptDate).split(',')[0] : '-'}</span>
                          </span>
                          <span className="font-bold text-slate-900 dark:text-white">
                            Rp {item.totalPhysicalAmount.toLocaleString('id-ID')}
                          </span>
                        </div>

                        {item.sampleItemNames.length > 0 && (
                          <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[10px] text-slate-600 dark:text-slate-300 line-clamp-2">
                            <b>Item Terhubung:</b> {item.sampleItemNames.join(', ')}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Tombol Aksi */}
                    <div className="pt-2 flex items-center gap-2 border-t border-slate-100 dark:border-slate-850">
                      {hasUrls && (
                        <button
                          type="button"
                          onClick={() => {
                            if (item.rawMutations.length > 0) {
                              onOpenReceiptViewer(item.rawMutations[0], item.rawMutations);
                            }
                          }}
                          className="flex-1 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-2xs"
                        >
                          <Eye className="w-3.5 h-3.5 text-slate-500" />
                          <span>Periksa Berkas</span>
                        </button>
                      )}

                      {onSelectForLinking && (
                        <button
                          type="button"
                          onClick={() => onSelectForLinking(item)}
                          className="flex-1 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
                        >
                          <PackageCheck className="w-3.5 h-3.5" />
                          <span>Pilih Nota Ini</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 flex items-center justify-between text-xs">
          <div className="text-slate-500 dark:text-slate-400 text-[11px]">
            💡 Seluruh berkas nota tersimpan di album terpusat proyek tanpa duplikasi kuota penyimpanan.
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 font-bold transition-colors cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
