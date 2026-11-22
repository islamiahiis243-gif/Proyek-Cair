import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import {
  Boxes,
  WalletCards,
  FileText,
  KeyRound,
  ShieldCheck,
  CheckCircle2,
  ChevronRight,
  ArrowRight,
  Sparkles,
  Building2,
  QrCode,
  Layers,
  ShoppingBag,
  Users,
  Receipt,
  Truck,
  HardHat,
  BadgePercent,
  Check,
  ExternalLink,
  Search,
  Lock,
  Eye,
  Info,
  HelpCircle,
  Clock,
  Briefcase,
  User
} from 'lucide-react';
import { formatRupiah } from '../lib/pdfGenerator';

export const LandingPageView: React.FC = () => {
  const {
    user,
    setCurrentView,
    appMode,
    setAppMode,
    activeRole,
    setActiveRole,
    activeCompany,
    setActiveCompany,
    activeProject,
    activeContext,
    setActiveProjectId,
    setActiveWorkspaceId,
    documents
  } = useApp();

  // Helper Peralihan Peran Coretax: Masuk ke Penugasan Proyek
  const handleSwitchToProject = (proj: any) => {
    if (proj.company_id && proj.company_name) {
      setActiveCompany({
        id: proj.company_id,
        name: proj.company_name,
        npwp: proj.company_npwp || activeCompany.npwp
      });
    }
    if (proj.workspace_id) {
      setActiveWorkspaceId(proj.workspace_id);
    }
    if (proj.id) {
      setActiveProjectId(proj.id);
    }
    setAppMode('IMPERSONATE');
    setCurrentView('dashboard');
  };

  // Helper Peralihan Peran Coretax: Kembali ke Ruang Personal
  const handleSwitchToPersonal = () => {
    setAppMode('PERSONAL');
    setCurrentView('landing');
  };

  // State Filter Modul (Odoo-Style App Catalog)
  const [moduleFilter, setModuleFilter] = useState<'ALL' | 'ACTIVE' | 'UPCOMING'>('ALL');

  // State Kalkulator Simulasi Biaya Proyek
  const [projectValue, setProjectValue] = useState<number>(1500000000); // Default 1.5 Miliar

  // State Verifikasi Cepat
  const [quickVerifyCode, setQuickVerifyCode] = useState('');
  const [verifyFeedback, setVerifyFeedback] = useState<string | null>(null);

  // Kalkulasi Rekomendasi Paket
  const getRecommendedTier = (val: number) => {
    if (val < 300000000) {
      return {
        name: 'Paket Mikro / Rintisan',
        price: 'Gratis (Trial)',
        priceNum: 0,
        badge: 'Untuk Renovasi & Proyek Kecil',
        desc: 'Cocok untuk mandor independen, subkon kecil, atau renovasi rumah pribadi.',
        rfinType: 'RFIN-B Mikro',
        features: [
          '1 Proyek Aktif',
          'Modul Mutasi Barang (Stok & Masuk/Keluar)',
          'Modul Mutasi Dana Kas Harian',
          'Album Berkas Nota Fisik (Hingga 50 Nota)',
          'Ekspor Laporan Dasar PDF'
        ]
      };
    } else if (val <= 3000000000) {
      return {
        name: 'Paket Kontraktor Pro',
        price: 'Rp 750.000 / Proyek',
        priceNum: 750000,
        badge: 'Paling Populer & Optimal',
        desc: 'Solusi lengkap kontraktor tender swasta, ruko, gedung bertingkat, dan pengadaan APBD.',
        rfinType: 'RFIN-B Standar',
        features: [
          'Lisensi Penuh 1 Proyek (Berlaku hingga Serah Terima FHO)',
          'Multi-POV Alur Lapangan (Clerk, Foreman, Spv, KTT/CEO)',
          'Akses Khusus Viewer / Pengamat Klien Transparan',
          'Penyelarasan Nota Resmi & Deteksi Beda Toko / Talangan',
          'Dokumen Resmi TTE & Validasi QR Code SHA-256',
          'Koreksi Data Tanpa Hapus (Immutable Ledger Batal / Ganti)',
          'Biaya Resmi Masuk Pos Overhead RAP Proyek'
        ]
      };
    } else {
      return {
        name: 'Paket Korporat & Multi-Proyek',
        price: 'Rp 8.500.000 / Tahun',
        priceNum: 8500000,
        badge: 'Skala Besar & Tanpa Batas',
        desc: 'Ideal untuk PT / CV kontraktor menengah-besar dengan portofolio proyek simultan.',
        rfinType: 'RFIN-A Korporat',
        features: [
          'Aktivasi RFIN-B Multi-Proyek Tanpa Batas',
          'Konsol Company Super Admin (CSA) Terpusat',
          'Kustomisasi Kop Surat Resmi & Logo Perusahaan di PDF',
          'Dukungan Multi-Gudang & Pemantauan Multi-Kontrak BOQ',
          'Jalur Prioritas Verifikasi Audit & Dukungan Teknis Langsung'
        ]
      };
    }
  };

  const currentTier = getRecommendedTier(projectValue);

  // Daftar Modul Terintegrasi ala Odoo
  const modules = [
    {
      id: 'stock',
      title: 'Mutasi Barang & Pemantauan BOQ',
      category: 'Logistik & Gudang',
      status: 'ACTIVE',
      badge: 'Aktif & Siap Pakai',
      icon: Boxes,
      color: 'emerald',
      description:
        'Pencatatan material masuk dan keluar gudang yang tersinkronisasi otomatis dengan pos anggaran BOQ kontrak. Dilengkapi audit talangan dan selisih penyedia.',
      actionView: 'stock-mutations'
    },
    {
      id: 'cash',
      title: 'Mutasi Dana (Arus Kas Proyek)',
      category: 'Keuangan & Kasir',
      status: 'ACTIVE',
      badge: 'Aktif & Siap Pakai',
      icon: WalletCards,
      color: 'amber',
      description:
        'Pencatatan kas masuk termin dan kas keluar operasional harian. Saldo riil terhitung akurat dengan proteksi anti-hapus data (Batal/Ganti).',
      actionView: 'cashflow'
    },
    {
      id: 'documents',
      title: 'Dokumen Resmi Berita Acara & TTE QR',
      category: 'Legalitas & Approval',
      status: 'ACTIVE',
      badge: 'Aktif & Siap Pakai',
      icon: FileText,
      color: 'blue',
      description:
        'Penerbitan Berita Acara Rekapitulasi dengan alur persetujuan berjenjang 4 tingkat (Clerk ➔ Foreman ➔ Spv ➔ CEO) dan enkripsi TTE QR Code.',
      actionView: 'stock-mutations'
    },
    {
      id: 'receipt-album',
      title: 'Album Galeri Nota Resmi Toko',
      category: 'Verifikasi Fisik',
      status: 'ACTIVE',
      badge: 'Aktif & Siap Pakai',
      icon: Receipt,
      color: 'cyan',
      description:
        'Repositori foto dan bukti fisik nota toko terpusat per proyek. Mencegah nota fiktif, pembelian ganda, dan mempermudah pelacakan nota menyusul.',
      actionView: 'stock-mutations'
    },
    {
      id: 'po-purchasing',
      title: 'Pengadaan Material & PO Toko',
      category: 'Pengadaan / Purchasing',
      status: 'UPCOMING',
      badge: 'Tahap 2 (Segera Hadir)',
      icon: ShoppingBag,
      color: 'purple',
      description:
        'Penerbitan Surat Pesanan (PO) ke toko rekanan suplier, rekonsiliasi Surat Jalan delivery order, dan penguncian harga satuan grosir.',
      actionView: null
    },
    {
      id: 'labor-payroll',
      title: 'Upah Mandor & Harian Tukang',
      category: 'SDM & Manpower Lapangan',
      status: 'UPCOMING',
      badge: 'Tahap 2 (Segera Hadir)',
      icon: HardHat,
      color: 'rose',
      description:
        'Pencatatan absensi harian tukang, pembukuan kasbon mandor, dan perhitungan otomatis upah borongan volume fisik vs harian.',
      actionView: null
    },
    {
      id: 'progress-billing',
      title: 'Penagihan Termin Klien & BAP (MC)',
      category: 'Invoicing & Klien',
      status: 'UPCOMING',
      badge: 'Tahap 3 (Segera Hadir)',
      icon: BadgePercent,
      color: 'indigo',
      description:
        'Penyusunan Monthly Certificate (MC), Berita Acara Pembayaran (BAP), pelacakan retensi 5%, serta pemotongan PPN & PPh Final jasa konstruksi.',
      actionView: null
    },
    {
      id: 'subcon-heavy',
      title: 'Subkontraktor & Sewa Alat Berat',
      category: 'Kontrak Lapangan',
      status: 'UPCOMING',
      badge: 'Tahap 3 (Segera Hadir)',
      icon: Truck,
      color: 'orange',
      description:
        'Pengelolaan SPK subkon spesialis, monitoring time-sheet jam kerja excavator/crane, dan pencatatan konsumsi bahan bakar solar alat berat.',
      actionView: null
    }
  ];

  const filteredModules = modules.filter((m) => {
    if (moduleFilter === 'ACTIVE') return m.status === 'ACTIVE';
    if (moduleFilter === 'UPCOMING') return m.status === 'UPCOMING';
    return true;
  });

  const handleQuickVerify = (e: React.FormEvent) => {
    e.preventDefault();
    const query = quickVerifyCode.trim();
    if (!query) {
      setVerifyFeedback('Silakan masukkan nomor dokumen atau kode registrasi.');
      return;
    }
    const found = documents.find(
      (d) =>
        d.id.toLowerCase().includes(query.toLowerCase()) ||
        (d.document_no && d.document_no.toLowerCase().includes(query.toLowerCase())) ||
        (d.judul && d.judul.toLowerCase().includes(query.toLowerCase())) ||
        (d.tte_qr_code && d.tte_qr_code.toLowerCase().includes(query.toLowerCase())) ||
        (d.qr_payload && d.qr_payload.toLowerCase().includes(query.toLowerCase()))
    );

    if (found) {
      setVerifyFeedback(`Dokumen DITEMUKAN: "${found.judul}" status ${found.status_dokumen || found.status}. Mengalihkan ke Portal Verifikasi Resmi...`);
      setTimeout(() => {
        setCurrentView('verification');
      }, 1200);
    } else {
      setVerifyFeedback('Dokumen tidak ditemukan dalam arsip lokal aktif. Mengalihkan ke Portal Verifikasi Global...');
      setTimeout(() => {
        setCurrentView('verification');
      }, 1000);
    }
  };

  return (
    <div className="space-y-8 pb-16">
      {/* 0. KARTU SAMBUTAN & STATUS PENUGASAN (FILOSOFI CORETAX: PERSONAL USER FIRST) */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs transition-colors">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-start sm:items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-linear-to-br from-blue-600 to-indigo-700 text-white flex items-center justify-center font-bold text-base shadow-md shadow-blue-500/20 shrink-0">
              {user.name ? user.name.slice(0, 2).toUpperCase() : 'PS'}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-base font-bold text-slate-900 dark:text-white">
                  Selamat Datang, {user.name || 'Pengguna'}!
                </span>
                {appMode === 'PERSONAL' ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    <User className="w-3 h-3" />
                    <span>Ruang Personal (Akun Pribadi)</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                    <Briefcase className="w-3 h-3" />
                    <span>Penugasan Lapangan: {activeRole}</span>
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {appMode === 'PERSONAL'
                  ? 'Anda sedang berada di Beranda Utama Personal. Pilih modul yang ingin dipelajari, aktifkan kunci lisensi RFIN, atau beralih ke penugasan proyek lapangan yang Anda miliki.'
                  : `Anda sedang bertugas aktif di proyek ${activeProject?.name || activeCompany.name || 'Proyek Lapangan'}. Semua transaksi operasional akan tercatat sah atas nama Anda.`}
              </p>
            </div>
          </div>

          {/* Tombol Aksi Cepat Sesuai Status Coretax */}
          <div className="flex items-center gap-2 flex-wrap self-start lg:self-auto shrink-0">
            {appMode === 'PERSONAL' ? (
              <>
                {activeContext?.projects && activeContext.projects.length > 0 ? (
                  <button
                    onClick={() => handleSwitchToProject(activeContext.projects[0])}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-sm transition-all hover:translate-y-[-1px] cursor-pointer"
                  >
                    <Building2 className="w-4 h-4 text-blue-200" />
                    <span>Masuk ke Proyek: {(activeContext.projects[0].name || 'Proyek').slice(0, 20)}...</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => setCurrentView('rfin-b-input')}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 text-xs font-semibold hover:bg-amber-100 transition-colors cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>Aktivasi Kunci RFIN-B</span>
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={handleSwitchToPersonal}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
              >
                <User className="w-3.5 h-3.5 text-blue-500" />
                <span>Beralih Kembali ke Akun Personal</span>
              </button>
            )}
          </div>
        </div>

        {/* Jika di mode Personal dan ada penugasan resmi */}
        {appMode === 'PERSONAL' && activeContext?.projects && activeContext.projects.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 flex-wrap">
            <div className="text-[11px] text-slate-600 dark:text-slate-400 font-medium flex items-center gap-2">
              <span className="font-bold text-slate-700 dark:text-slate-300">Penugasan Badan Usaha Anda:</span>
              <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
                {activeCompany.name || 'CV. MENARA MEGAH'} · {activeProject?.name || activeContext.projects[0].name}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentView('rfin-b-input')}
                className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <KeyRound className="w-3 h-3" />
                <span>+ Masukkan Kunci Proyek Lain</span>
              </button>
              <span className="text-slate-300 dark:text-slate-700">·</span>
              <button
                onClick={() => setCurrentView('rfin-a-request')}
                className="text-[11px] font-semibold text-purple-600 dark:text-purple-400 hover:underline inline-flex items-center gap-1 cursor-pointer"
              >
                <Building2 className="w-3 h-3" />
                <span>Daftarkan Badan Usaha Baru (RFIN-A)</span>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 1. HERO SECTION */}
      <section className="relative overflow-hidden rounded-3xl bg-linear-to-br from-slate-900 via-slate-900 to-blue-950 border border-slate-800 p-6 sm:p-10 lg:p-12 text-white shadow-2xl">
        <div className="absolute top-0 right-0 -mt-12 -mr-12 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
          {/* Kolom Kiri: Teks & Aksi */}
          <div className="flex-1 space-y-6">
            {/* Headline Utama */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight">
              Kendalikan Arus Material & Keuangan Proyek{' '}
              <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-400 via-teal-300 to-emerald-400">
                Tanpa Celah Kebocoran.
              </span>
            </h1>

            {/* Subheadline */}
            <p className="text-sm sm:text-base text-slate-300 max-w-2xl leading-relaxed">
              Platform operasional konstruksi berbasis buku besar abadi (<i>Immutable Ledger</i>). 
              Selaraskan nota fisik toko, pantau realisasi BOQ secara presisi, dan sahkan berita acara 
              tanda tangan digital (TTE/QR) 4 jenjang dalam satu layar yang mudah bagi siapa saja.
            </p>
          </div>

          {/* Kolom Kanan: Banner Branding Resmi (words.png) Ukuran Semula */}
          <div className="w-full lg:w-[420px] shrink-0 flex items-center justify-center">
            <img
              src="/words.png"
              alt="Proyek Cair - Platform Operasional Proyek Konstruksi"
              className="w-full max-w-[380px] lg:max-w-none h-auto object-contain drop-shadow-2xl"
            />
          </div>
        </div>

        {/* Nilai Inti Ringkas (3 Nilai Utama) */}
        <div className="mt-8 pt-6 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div className="flex items-center gap-2.5 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
            <span><b>Tata Kelola CRU:</b> Batal & Ganti tanpa hapus data</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" />
            <span><b>Multi-POV:</b> Clerk, Spv, hingga Viewer Klien</span>
          </div>
          <div className="flex items-center gap-2.5 text-slate-300">
            <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
            <span><b>Pay-per-Project:</b> Masuk overhead resmi RAP</span>
          </div>
        </div>
      </section>

      {/* 2. ETALASE MODUL PROYEK ALA ODOO (MODULAR APPS) */}
      <section className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 mb-1">
              <Layers className="w-4 h-4" />
              <span>Arsitektur Modular Terbuka (Gaya Odoo Apps)</span>
            </div>
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              Pasang & Gunakan Modul Sesuai Kebutuhan Lapangan
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-2xl">
              Tidak perlu membayar fitur yang belum dipakai. Mulai dari modul inti mutasi barang dan kas, lalu aktifkan modul lanjutan seiring membesarnya skala proyek Anda.
            </p>
          </div>

          {/* Filter Tab Modul */}
          <div className="inline-flex p-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs font-semibold">
            <button
              onClick={() => setModuleFilter('ALL')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                moduleFilter === 'ALL'
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Semua Modul ({modules.length})
            </button>
            <button
              onClick={() => setModuleFilter('ACTIVE')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                moduleFilter === 'ACTIVE'
                  ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Tersedia ({modules.filter((m) => m.status === 'ACTIVE').length})
            </button>
            <button
              onClick={() => setModuleFilter('UPCOMING')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                moduleFilter === 'UPCOMING'
                  ? 'bg-white dark:bg-slate-800 text-purple-600 dark:text-purple-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              Roadmap ({modules.filter((m) => m.status === 'UPCOMING').length})
            </button>
          </div>
        </div>

        {/* Grid Kartu Modul */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {filteredModules.map((mod) => {
            const ModIcon = mod.icon;
            const isActive = mod.status === 'ACTIVE';

            return (
              <div
                key={mod.id}
                className={`flex flex-col justify-between p-5 rounded-2xl border transition-all duration-200 ${
                  isActive
                    ? 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-blue-400 dark:hover:border-blue-500 shadow-xs'
                    : 'bg-slate-50/70 dark:bg-slate-900/40 border-dashed border-slate-200 dark:border-slate-800/80 opacity-90'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div
                      className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        isActive
                          ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/50'
                          : 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-900/30'
                      }`}
                    >
                      <ModIcon className="w-5 h-5" />
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        isActive
                          ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800/60'
                          : 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/60'
                      }`}
                    >
                      {mod.badge}
                    </span>
                  </div>

                  <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {mod.category}
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-0.5 leading-snug">
                    {mod.title}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-2 leading-relaxed">
                    {mod.description}
                  </p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800">
                  {isActive && mod.actionView ? (
                    <button
                      onClick={() => setCurrentView(mod.actionView as any)}
                      className="w-full inline-flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-xs font-semibold transition-colors cursor-pointer"
                    >
                      <span>Buka Modul</span>
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <div className="text-center text-[11px] font-medium text-slate-500 dark:text-slate-500 py-1">
                      🔒 Rilis di Pembaruan Modul
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 3. SIMULASI SKEMA MONETISASI PAY-PER-PROJECT (RFIN-B) */}
      <section className="rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 lg:p-10 shadow-sm space-y-8">
        <div>
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
            <KeyRound className="w-4 h-4" />
            <span>Skema Lisensi Fleksibel & Terjangkau (Pay-Per-Project)</span>
          </div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
            Bayar Hanya Saat Ada Proyek, Tanpa Beban Langganan Mengikat
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1 max-w-3xl leading-relaxed">
            Kontraktor Indonesia bekerja berdasarkan siklus proyek dan termin. Kunci aktivasi <b>RFIN-B</b> dibayar sekali per proyek dan berlaku penuh hingga masa retensi/serah terima tuntas. Biaya ini sah dimasukkan ke dalam pos overhead operasional RAP proyek.
          </p>
        </div>

        {/* Kalkulator Simulasi Interaktif */}
        <div className="p-5 sm:p-6 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Geser untuk Menentukan Perkiraan Nilai Kontrak Proyek Anda:
              </span>
              <div className="text-2xl font-black font-mono text-blue-600 dark:text-blue-400 mt-1">
                {formatRupiah(projectValue)}
              </div>
            </div>
            <div className="text-right">
              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                Rekomendasi Paket Lisensi:
              </span>
              <div className="inline-flex items-center gap-2 mt-1">
                <span className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 text-xs font-bold border border-emerald-300 dark:border-emerald-800">
                  {currentTier.name}
                </span>
                <span className="text-base font-bold text-slate-900 dark:text-white">
                  {currentTier.price}
                </span>
              </div>
            </div>
          </div>

          <input
            type="range"
            min={100000000}
            max={5000000000}
            step={50000000}
            value={projectValue}
            onChange={(e) => setProjectValue(Number(e.target.value))}
            className="w-full h-2.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-blue-600"
          />

          <div className="flex justify-between text-[10px] text-slate-500 font-mono">
            <span>Rp 100 Juta (Renovasi)</span>
            <span>Rp 1 Miliar (Standar)</span>
            <span>Rp 3 Miliar (Menengah)</span>
            <span>Rp 5 Miliar+ (Besar)</span>
          </div>
        </div>

        {/* 3 Kartu Paket Lisensi Transparan */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Paket 1: Mikro */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col justify-between bg-white dark:bg-slate-900">
            <div className="space-y-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                Pemula / Uji Coba
              </span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Paket Rintisan</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Pilihan tepat untuk mencoba alur pencatatan mutasi barang dan kas harian.
              </p>
              <div className="text-2xl font-black text-slate-900 dark:text-white pt-2">
                Gratis
                <span className="text-xs font-normal text-slate-500 ml-1">/ 1 Proyek</span>
              </div>
              <ul className="space-y-2 pt-3 text-xs text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>1 Proyek Mandiri</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Modul Mutasi Barang Dasar</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Mutasi Kas Operasional</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Ekspor PDF Format Standar</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => setCurrentView('dashboard')}
              className="mt-6 w-full py-2.5 px-4 rounded-xl border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
            >
              Mulai Gratis Sekarang
            </button>
          </div>

          {/* Paket 2: Pro (Rekomendasi Utama) */}
          <div className="relative rounded-2xl border-2 border-blue-500 dark:border-blue-500 p-6 flex flex-col justify-between bg-blue-50/20 dark:bg-blue-950/20 shadow-lg shadow-blue-500/5">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full bg-blue-600 text-white text-[10px] font-bold tracking-wider uppercase shadow-xs">
              Pilihan Paling Populer
            </div>
            <div className="space-y-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-200 border border-blue-200 dark:border-blue-800">
                Lisensi Kunci RFIN-B
              </span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Kontraktor Proyek Pro</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Lisensi operasional penuh per proyek hingga serah terima fisik (FHO).
              </p>
              <div className="text-2xl font-black text-blue-600 dark:text-blue-400 pt-2">
                Rp 750.000
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400 ml-1">/ Proyek (Sekali Bayar)</span>
              </div>
              <ul className="space-y-2 pt-3 text-xs text-slate-600 dark:text-slate-300 border-t border-blue-100 dark:border-blue-900/50">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span><b>Multi-POV Lapangan:</b> Clerk, Foreman, Spv, CEO</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span><b>Portal Viewer / Pengamat:</b> Transparan ke Klien</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span><b>Album Berkas Nota Toko:</b> Anti-Nota Ganda</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span><b>Dokumen Resmi Berantai:</b> Validasi TTE & QR Code</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                  <span>Masuk Komponen Resmi Overhead RAP Proyek</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => setCurrentView('rfin-b-input')}
              className="mt-6 w-full py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-md shadow-blue-600/30 transition-all cursor-pointer"
            >
              Aktivasi Kunci RFIN-B Proyek
            </button>
          </div>

          {/* Paket 3: Korporat RFIN-A */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 p-6 flex flex-col justify-between bg-white dark:bg-slate-900">
            <div className="space-y-3">
              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/60 text-purple-800 dark:text-purple-200 border border-purple-200 dark:border-purple-800">
                Lisensi Perusahaan (RFIN-A)
              </span>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">Korporat Multi-Proyek</h3>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Untuk PT / CV yang menangani banyak paket pekerjaan secara simultan.
              </p>
              <div className="text-2xl font-black text-slate-900 dark:text-white pt-2">
                Rp 8.500.000
                <span className="text-xs font-normal text-slate-500 ml-1">/ Tahun</span>
              </div>
              <ul className="space-y-2 pt-3 text-xs text-slate-600 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800">
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-purple-500 shrink-0" />
                  <span><b>Aktivasi RFIN-B Tanpa Batas</b></span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-purple-500 shrink-0" />
                  <span>Konsol Company Super Admin (CSA)</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-purple-500 shrink-0" />
                  <span>Kustomisasi Kop Surat & Legalitas Lengkap</span>
                </li>
                <li className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-purple-500 shrink-0" />
                  <span>Akses Awal ke Seluruh Modul Baru (Roadmap)</span>
                </li>
              </ul>
            </div>
            <button
              onClick={() => setCurrentView('rfin-a-request')}
              className="mt-6 w-full py-2.5 px-4 rounded-xl border border-purple-300 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 text-xs font-bold text-purple-700 dark:text-purple-300 transition-colors cursor-pointer"
            >
              Ajukan Lisensi RFIN-A Perusahaan
            </button>
          </div>
        </div>
      </section>

      {/* 4. PERBANDINGAN REALITA LAPANGAN: EXCEL vs PROYEK CAIR */}
      <section className="rounded-3xl bg-slate-900 text-white p-6 sm:p-8 lg:p-10 border border-slate-800 space-y-6">
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <h2 className="text-2xl font-bold tracking-tight">
            Mengapa Kontraktor Indonesia Beralih dari Excel ke Proyek Cair?
          </h2>
          <p className="text-xs text-slate-400">
            Masalah klasik di lapangan yang membuat proyek bocor dan termin tertahan klien terselesaikan secara sistematis.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-400 font-semibold">
                <th className="py-3 px-4">Aspek Operasional</th>
                <th className="py-3 px-4 text-rose-400">Pola Lama (Excel / Kertas)</th>
                <th className="py-3 px-4 text-emerald-400">Proyek Cair (Sistem Modular)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              <tr>
                <td className="py-3 px-4 font-bold text-white">Jejak Transaksi & Koreksi</td>
                <td className="py-3 px-4 text-slate-400">Baris salah bisa dihapus sesuka hati; rawan manipulasi kasir/mandor.</td>
                <td className="py-3 px-4 text-emerald-300 font-medium">Buku besar abadi (<i>Immutable</i>); koreksi sah via <b>Batal & Ganti</b> dengan jejak audit permanen.</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-bold text-white">Pengelolaan Nota Fisik Toko</td>
                <td className="py-3 px-4 text-slate-400">Nota toko tercecer, tinta pudar, sering nota yang sama diklaim dua kali.</td>
                <td className="py-3 px-4 text-emerald-300 font-medium"><b>Album Galeri Terpusat</b>; tiap item belanja tertaut langsung ke foto nota riil toko.</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-bold text-white">Persetujuan Berita Acara</td>
                <td className="py-3 px-4 text-slate-400">Menunggu tanda tangan basah berhari-hari; rawan dipalsukan.</td>
                <td className="py-3 px-4 text-emerald-300 font-medium">Alur digital 4 jenjang (Clerk ➔ Foreman ➔ Spv ➔ CEO) dengan <b>TTE & QR Code</b> terenkripsi.</td>
              </tr>
              <tr>
                <td className="py-3 px-4 font-bold text-white">Keterbukaan Terhadap Klien</td>
                <td className="py-3 px-4 text-slate-400">Klien curiga markup harga; termin sering ditahan karena laporan tidak sinkron.</td>
                <td className="py-3 px-4 text-emerald-300 font-medium">Tersedia <b>Mode Viewer / Pengamat</b> khusus owner untuk memantau progres fisik secara transparan.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 5. WIDGET UJI COBA CEPAT VERIFIKASI QR (PUBLIC PORTAL WIDGET) */}
      <section className="rounded-3xl bg-linear-to-r from-blue-900/30 via-slate-900 to-emerald-900/30 border border-slate-200 dark:border-slate-800 p-6 sm:p-8 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 max-w-xl">
          <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-cyan-600 dark:text-cyan-400">
            <ShieldCheck className="w-4 h-4" />
            <span>Portal Validasi Keabsahan Dokumen Publik</span>
          </div>
          <h3 className="text-xl font-bold text-slate-900 dark:text-white">
            Punya Berkas Berita Acara? Uji Keasliannya di Sini
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Setiap dokumen yang diterbitkan oleh Proyek Cair memuat tanda tangan elektronik (TTE) dan checksum SHA-256 yang dapat diverifikasi oleh auditor atau pemberi kerja secara langsung.
          </p>
        </div>

        <form onSubmit={handleQuickVerify} className="w-full md:w-auto shrink-0 flex flex-col sm:flex-row gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={quickVerifyCode}
              onChange={(e) => setQuickVerifyCode(e.target.value)}
              placeholder="Masukkan No. Dokumen / ID..."
              className="pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white focus:outline-none focus:border-blue-500 w-full sm:w-64"
            />
          </div>
          <button
            type="submit"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-colors cursor-pointer"
          >
            <QrCode className="w-4 h-4" />
            <span>Periksa Dokumen</span>
          </button>
        </form>
      </section>

      {verifyFeedback && (
        <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200 text-xs font-medium text-center animate-fade-in">
          {verifyFeedback}
        </div>
      )}

      {/* 6. CALL TO ACTION PENUTUP */}
      <section className="text-center py-6 space-y-4">
        <h3 className="text-xl font-bold text-slate-900 dark:text-white">
          Siap Mewujudkan Pembukuan Proyek yang Rapi & Anti-Boncos?
        </h3>
        <p className="text-xs text-slate-600 dark:text-slate-400 max-w-md mx-auto">
          Mulai operasionalkan material dan kas proyek Anda hari ini dengan ekosistem modular Proyek Cair.
        </p>
        <div className="inline-flex items-center gap-3">
          <button
            onClick={() => setCurrentView('dashboard')}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold shadow-md shadow-blue-600/30 transition-all cursor-pointer"
          >
            <span>Masuk ke Dasbor Sekarang</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </section>
    </div>
  );
};
