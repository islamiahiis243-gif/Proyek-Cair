import React, { useState, useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext';
import {
  CheckCircle2,
  AlertTriangle,
  FileText,
  User,
  KeyRound,
  Search,
  ArrowLeft,
  Building2,
  Copy,
  ShieldCheck,
} from 'lucide-react';
import QRCode from 'qrcode';
import { formatDateTime, formatDateOnly } from '../lib/pdfGenerator';
import { filterDocumentsForPov } from '../lib/projectReportEngine';

const DOC_TYPE_LABELS: Record<string, string> = {
  MUTASI_STOK: 'Berita Acara Mutasi Barang',
  MUTASI_KAS: 'Berita Acara Mutasi Dana',
  PO_PENGADAAN: 'Surat Pesanan (PO Toko)',
  GABUNGAN_PROYEK: 'Laporan Proyek Terpadu',
  INVENTARIS_LENGKAP: 'Laporan Inventaris Lengkap',
};

const AUDIENCE_LABELS: Record<string, string> = {
  KONTRAKTOR: 'Edisi Kontraktor',
  KLIEN: 'Edisi Klien',
  UMUM: 'Umum / Bersama',
};

const WORKFLOW_STATUS_LABELS: Record<string, string> = {
  DITERBITKAN: 'Tahap 1 · Diterbitkan',
  DIPERIKSA: 'Tahap 2 · Diperiksa',
  DISETUJUI: 'Tahap 3 · Disetujui',
  MENGETAHUI: 'Tahap 4 · Sah (TTE/QR)',
  BATAL: 'Dibatalkan',
  DIGANTI: 'Diganti Revisi Baru',
};

export const VerificationPortal: React.FC = () => {
  const {
    documents,
    verifyingDocId,
    setVerifyingDocId,
    setCurrentView,
    activeProject,
    activeWorkspaceId,
    activeRole,
    canViewFinancials,
    dataReady,
    dataError,
    refreshData,
  } = useApp();

  const isViewer = activeRole === 'Viewer/Pengamat';
  const canReadDocuments = Boolean(activeProject?.permissions.includes('document.read') ?? true);

  // Saring arsip sesuai sudut pandang pihak aktif (Pengamat/Klien tidak pernah bisa membuka MUTASI_KAS / KONTRAKTOR)
  const visibleDocuments = useMemo(
    () => filterDocumentsForPov(documents, isViewer || !canViewFinancials ? 'KLIEN' : 'KONTRAKTOR'),
    [documents, isViewer, canViewFinancials]
  );

  const [inputSearchDoc, setInputSearchDoc] = useState('');
  const [searchError, setSearchError] = useState('');
  const [activeQrDataUrl, setActiveQrDataUrl] = useState<string>('');
  const [copiedLink, setCopiedLink] = useState(false);
  const [integrityStatus, setIntegrityStatus] = useState<
    'checking' | 'valid' | 'invalid' | 'unavailable'
  >('unavailable');

  // Pilih dokumen sesuai verifyingDocId (dari daftar yang boleh diakses) atau dokumen terbaru
  const currentDoc = verifyingDocId
    ? visibleDocuments.find((d) => d.id === verifyingDocId || d.db_id === verifyingDocId) || null
    : visibleDocuments[0] || null;

  const activeDocId = currentDoc?.id || '';
  const lifecycleStatus = currentDoc?.lifecycle_status || 'TIDAK_TERSEDIA';
  const isRevokedOrReplaced = Boolean(
    currentDoc &&
      (currentDoc.is_batal ||
        currentDoc.is_ganti ||
        currentDoc.revoked_at ||
        currentDoc.status === 'REVOKED' ||
        currentDoc.status_dokumen === 'BATAL' ||
        currentDoc.status_dokumen === 'DIGANTI')
  );
  const lifecycleActive = Boolean(
    currentDoc &&
      !isRevokedOrReplaced &&
      lifecycleStatus === 'ACTIVE' &&
      ['ISSUED', 'SIGNED', 'TERVERIFIKASI'].includes(currentDoc.status)
  );

  useEffect(() => {
    let active = true;
    setActiveQrDataUrl('');

    const verify = async () => {
      setIntegrityStatus('checking');
      if (!currentDoc) {
        setIntegrityStatus('unavailable');
        return;
      }
      if (!currentDoc.snapshot_json || !currentDoc.hash_keamanan) {
        setIntegrityStatus('unavailable');
        return;
      }
      try {
        const parsed = JSON.parse(currentDoc.snapshot_json);
        const stable = (value: any): string =>
          Array.isArray(value)
            ? '[' + value.map((item) => (item === undefined ? 'null' : stable(item))).join(',') + ']'
            : value && typeof value === 'object'
            ? '{' +
              Object.keys(value)
                .filter((k) => value[k] !== undefined)
                .sort()
                .map((k) => JSON.stringify(k) + ':' + stable(value[k]))
                .join(',') +
              '}'
            : JSON.stringify(value);
        const digest = await crypto.subtle.digest(
          'SHA-256',
          new TextEncoder().encode(stable(parsed))
        );
        const computedHex = Array.from(new Uint8Array(digest))
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('')
          .toLowerCase();
        const storedHex = currentDoc.hash_keamanan
          .replace(/^SHA256:/i, '')
          .trim()
          .toLowerCase();

        if (active) {
          setIntegrityStatus(computedHex === storedHex ? 'valid' : 'invalid');
        }
      } catch {
        if (active) setIntegrityStatus('invalid');
      }
    };

    void verify();

    if (currentDoc) {
      const url = `${window.location.origin}/?verify_doc=${encodeURIComponent(currentDoc.id)}`;
      QRCode.toDataURL(url, {
        margin: 1,
        width: 200,
        color: { dark: '#0f172a', light: '#ffffff' },
      })
        .then((qrUrl) => {
          if (active) setActiveQrDataUrl(qrUrl);
        })
        .catch(() => {
          if (active) setActiveQrDataUrl('');
        });
    }

    return () => {
      active = false;
    };
  }, [currentDoc]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputSearchDoc.trim()) return;
    const query = inputSearchDoc.trim().toLowerCase();
    const found = visibleDocuments.find(
      (d) =>
        d.id.toLowerCase() === query ||
        (d.db_id && d.db_id.toLowerCase() === query)
    );
    if (found) {
      setSearchError('');
      setVerifyingDocId(found.id);
    } else {
      setSearchError(
        `Dokumen dengan nomor registrasi "${inputSearchDoc}" tidak ditemukan pada arsip yang dapat Anda akses.`
      );
    }
  };

  const handleCopyVerificationLink = async () => {
    if (!activeDocId) return;
    const url = `${window.location.origin}/?verify_doc=${encodeURIComponent(activeDocId)}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      setSearchError('Peramban tidak mengizinkan penyalinan tautan secara otomatis.');
    }
  };

  if (!dataReady) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="rounded-xl border bg-white p-8 text-center text-sm text-slate-600 dark:text-slate-300 font-medium dark:border-slate-800 dark:bg-slate-900"
      >
        Memuat arsip dokumen proyek aktif…
      </div>
    );
  }

  if (!activeProject || activeProject.workspace_id !== activeWorkspaceId) {
    return (
      <div
        role="status"
        className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-6 text-sm text-amber-900 dark:text-amber-200"
      >
        Pilih proyek aktif terlebih dahulu untuk membuka pemeriksaan integritas dokumen.
      </div>
    );
  }

  if (dataError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/40 p-6 text-sm text-rose-900 dark:text-rose-200"
      >
        <p>Arsip dokumen gagal dimuat: {dataError}</p>
        <button
          onClick={() => void refreshData()}
          className="mt-3 rounded-lg bg-rose-700 hover:bg-rose-800 px-3 py-2 text-xs font-semibold text-white cursor-pointer"
        >
          Coba Lagi
        </button>
      </div>
    );
  }

  if (!canReadDocuments) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-6 text-sm text-amber-900 dark:text-amber-200"
      >
        Hak akses baca arsip dokumen pada proyek aktif diperlukan untuk membuka portal pemeriksaan integritas ini.
      </div>
    );
  }

  const docTypeLabel = currentDoc
    ? DOC_TYPE_LABELS[currentDoc.jenis || currentDoc.document_type || ''] || 'Dokumen Resmi Proyek'
    : '';
  const audienceLabel = currentDoc?.audience_pov
    ? AUDIENCE_LABELS[currentDoc.audience_pov] || currentDoc.audience_pov
    : null;
  const workflowLabel = currentDoc?.status_dokumen
    ? WORKFLOW_STATUS_LABELS[currentDoc.status_dokumen] || currentDoc.status_dokumen
    : null;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header Atas */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentView('reports')}
            aria-label="Kembali ke Studio Laporan"
            className="p-2 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">
              Portal Pemeriksaan Integritas Dokumen
            </h1>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 font-medium">
              Pemeriksaan internal kode integritas SHA-256 terhadap rekaman data resmi proyek yang tersimpan di basis data.
            </p>
          </div>
        </div>

        {/* Kotak Pencarian Dokumen */}
        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              aria-label="Cari nomor registrasi dokumen"
              placeholder="Cari No. Registrasi Dokumen..."
              value={inputSearchDoc}
              onChange={(e) => {
                setInputSearchDoc(e.target.value);
                setSearchError('');
              }}
              className="pl-8 pr-2.5 py-1.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 w-52"
            />
          </div>
          <button
            type="submit"
            className="px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
          >
            Periksa
          </button>
        </form>
      </div>

      {searchError && (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs font-medium text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"
        >
          {searchError}
        </p>
      )}

      {/* Pemilih Cepat Dokumen Bila Tersedia > 1 */}
      {visibleDocuments.length > 1 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-2 overflow-x-auto">
          <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 shrink-0 px-1">
            Arsip Terdaftar ({visibleDocuments.length}):
          </span>
          {visibleDocuments.slice(0, 8).map((doc) => {
            const isSelected = currentDoc?.id === doc.id;
            return (
              <button
                key={doc.id}
                type="button"
                onClick={() => {
                  setSearchError('');
                  setVerifyingDocId(doc.id);
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold border transition-colors shrink-0 cursor-pointer ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                }`}
              >
                {doc.id}
              </button>
            );
          })}
        </div>
      )}

      {!currentDoc ? (
        <div
          role="status"
          className="bg-white dark:bg-slate-900 p-12 text-center rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 font-medium"
        >
          {verifyingDocId
            ? 'Dokumen yang diminta tidak ditemukan pada arsip yang dapat Anda akses.'
            : 'Belum ada arsip dokumen resmi yang diterbitkan untuk diperiksa. Terbitkan berita acara melalui Studio Laporan atau modul Mutasi Proyek.'}
        </div>
      ) : (
        /* Sertifikat Pemeriksaan Integritas */
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-md overflow-hidden transition-colors">
          {/* Banner Header Sertifikat */}
          <div className="bg-slate-900 dark:bg-slate-950 text-white p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 border-b border-slate-800">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <img
                  src="/mascot_3d.png"
                  alt="Proyek Cair"
                  className="w-10 h-10 sm:w-12 sm:h-12 object-contain drop-shadow-md shrink-0"
                />
                <img
                  src="/words_PNG2.png"
                  alt="Proyek Cair - Platform Operasional Proyek Konstruksi"
                  className="h-9 sm:h-11 w-auto max-w-[220px] sm:max-w-[260px] object-contain shrink-0 drop-shadow-md"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                    integrityStatus === 'valid' && lifecycleActive
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : integrityStatus === 'invalid'
                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                      : 'bg-amber-500/20 text-amber-200 border-amber-500/40'
                  }`}
                >
                  {integrityStatus === 'valid' && lifecycleActive ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-300" />
                  )}
                  <span>
                    {integrityStatus === 'checking'
                      ? 'MEMERIKSA INTEGRITAS DATA...'
                      : integrityStatus === 'valid' && !lifecycleActive
                      ? 'DATA COCOK · DOKUMEN TIDAK BERLAKU'
                      : integrityStatus === 'valid'
                      ? 'INTEGRITAS DATA COCOK & AKTIF'
                      : integrityStatus === 'invalid'
                      ? 'INTEGRITAS DATA TIDAK COCOK'
                      : 'REKAMAN INTEGRITAS BELUM TERSEDIA'}
                  </span>
                </div>

                {audienceLabel && (
                  <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-blue-500/20 text-blue-200 border border-blue-400/30">
                    {audienceLabel}
                  </span>
                )}
              </div>

              {currentDoc && integrityStatus === 'valid' && !lifecycleActive && (
                <p
                  role="alert"
                  className="max-w-xl rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-200"
                >
                  Sidik integritas rekaman cocok, tetapi status masa berlaku dokumen ini sudah tidak aktif (dibatalkan atau telah diganti revisi baru). Jangan gunakan sebagai dokumen aktif terbaru.
                </p>
              )}

              <h2 className="text-2xl font-bold tracking-tight text-white">
                Registrasi Laporan &amp; Pemeriksaan Integritas Data
              </h2>
              <div className="text-xs text-slate-300 flex items-center gap-2 flex-wrap">
                <Building2 className="w-3.5 h-3.5" />
                <span>
                  Proyek: {activeProject.name || activeProject.project_code || 'Proyek aktif'}
                </span>
                <span className="text-slate-500">·</span>
                <span>{docTypeLabel}</span>
              </div>
            </div>

            {/* Kotak Pratinjau Kode QR */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 dark:border-slate-700 shadow-inner flex flex-col items-center justify-center shrink-0 w-32">
              {activeQrDataUrl && (
                <img
                  src={activeQrDataUrl}
                  alt="Kode QR Verifikasi"
                  className="w-24 h-24 object-contain"
                />
              )}
              <span className="text-[9px] font-bold text-slate-700 mt-1 uppercase tracking-wider">
                Verifikasi Internal
              </span>
            </div>
          </div>

          {/* Isi Sertifikat */}
          <div className="p-6 sm:p-8 space-y-6">
            {/* Grid Metadata */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-800/60 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
              <div>
                <div className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                  Nomor Registrasi Dokumen
                </div>
                <div className="text-sm font-bold font-mono text-slate-900 dark:text-white mt-0.5">
                  {currentDoc.id}
                </div>
              </div>

              <div>
                <div className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                  Judul Berita Acara / Laporan
                </div>
                <div className="text-sm font-bold text-slate-900 dark:text-white mt-0.5">
                  {currentDoc.judul}
                </div>
              </div>

              <div>
                <div className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                  Periode Transaksi
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                  {formatDateOnly(currentDoc.periode_awal)} s/d {formatDateOnly(currentDoc.periode_akhir)}
                </div>
              </div>

              <div>
                <div className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                  Tanggal &amp; Waktu Penerbitan
                </div>
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mt-0.5 font-mono">
                  {formatDateTime(currentDoc.dibuat_pada)}
                </div>
              </div>
            </div>

            {/* Identitas Penyusun Laporan */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-4 bg-transparent">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  <span>Identitas Penyusun &amp; Jejak Pengesahan Berjenjang</span>
                </h3>
                {workflowLabel && (
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                    {workflowLabel}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                <div>
                  <div className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                    Nama Penyusun
                  </div>
                  <div className="font-bold text-slate-900 dark:text-white mt-0.5">
                    {currentDoc.penandatangan_nama}
                  </div>
                </div>

                <div>
                  <div className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                    Jabatan Struktural
                  </div>
                  <div className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                    {currentDoc.penandatangan_jabatan}
                  </div>
                </div>

                <div>
                  <div className="text-slate-600 dark:text-slate-300 text-[11px] font-medium">
                    Surel Akun Penanggung Jawab
                  </div>
                  <div className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                    {currentDoc.penandatangan_email || '-'}
                  </div>
                </div>
              </div>

              {/* Jejak Persetujuan Berjenjang 4 Tingkat */}
              {(currentDoc.diperiksa_oleh || currentDoc.disetujui_oleh || currentDoc.mengetahui_oleh) && (
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Tahap 2 · Diperiksa Oleh
                    </div>
                    <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                      {currentDoc.diperiksa_oleh || 'Belum diperiksa'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      Tahap 3 · Disetujui Oleh
                    </div>
                    <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                      {currentDoc.disetujui_oleh || 'Belum disetujui'}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-800/70">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300 flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3" />
                      <span>Tahap 4 · Mengetahui (Sah TTE)</span>
                    </div>
                    <div className="mt-1 font-semibold text-slate-900 dark:text-white">
                      {currentDoc.mengetahui_oleh || 'Menunggu pengesahan akhir'}
                    </div>
                  </div>
                </div>
              )}

              {currentDoc.alasan_batal_ganti && (
                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200">
                  <span className="font-bold">Catatan Pembatalan / Penggantian: </span>
                  {currentDoc.alasan_batal_ganti}
                </div>
              )}
            </div>

            {/* Sidik Integritas SHA-256 */}
            <div className="bg-slate-900 dark:bg-slate-950 text-slate-300 p-4 rounded-xl border border-slate-800 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                  <span>Sidik Integritas SHA-256 Rekaman Data</span>
                </span>
                <span className="text-[10px] text-slate-200 font-mono font-bold">
                  {integrityStatus === 'valid'
                    ? lifecycleActive
                      ? 'COCOK'
                      : 'COCOK · TIDAK AKTIF'
                    : integrityStatus === 'invalid'
                    ? 'TIDAK COCOK'
                    : 'BELUM TERVERIFIKASI'}
                </span>
              </div>
              <div className="text-[11px] font-mono text-slate-300 break-all bg-slate-950 dark:bg-black/60 p-2.5 rounded-lg border border-slate-800">
                {currentDoc.hash_keamanan}
              </div>
              <div className="text-[10px] text-slate-400 dark:text-slate-300">
                Sidik SHA-256 ini memeriksa kesesuaian isi rekaman transaksi yang tersimpan di basis data proyek. Pemeriksaan ini memverifikasi keutuhan rekaman internal dan bukan sertifikat tanda tangan elektronik tersertifikasi eksternal.
              </div>
            </div>

            {/* Baris Aksi */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={handleCopyVerificationLink}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors border border-slate-200 dark:border-slate-700 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5 text-slate-700 dark:text-slate-300" />
                <span>{copiedLink ? 'Tautan Disalin!' : 'Salin Tautan Internal'}</span>
              </button>

              <button
                onClick={() => setCurrentView('reports')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors cursor-pointer"
              >
                <FileText className="w-4 h-4" />
                <span>Cetak / Ekspor Ulang Dokumen PDF</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
