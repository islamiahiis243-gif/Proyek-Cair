import React, { useState, useEffect, useCallback } from 'react';
import {
  Sun,
  Moon,
  ShieldCheck,
  Lock,
  ArrowRight,
  Sparkles,
  Layers,
  QrCode,
  Building2,
  CheckCircle2,
  Menu,
  X
} from 'lucide-react';
import {
  HeroSection,
  ModuleCatalogSection,
  PricingCalculatorSection,
  ComparisonTableSection,
  QuickVerifySection,
  CallToActionFooter
} from './LandingPageView';

export interface PublicLandingViewProps {
  onOpenAuth: (mode?: 'signin' | 'signup') => void;
  onNavigateToVerification?: (docId?: string) => void;
}

export const PublicLandingView: React.FC<PublicLandingViewProps> = React.memo(({
  onOpenAuth,
  onNavigateToVerification
}) => {
  // Pengaturan Tema Terang / Gelap Publik (Disinkronkan dengan localStorage & DOM class)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const saved = localStorage.getItem('proyek_cair_theme');
      if (saved === 'dark' || saved === 'light') return saved;
    } catch {}
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try {
      localStorage.setItem('proyek_cair_theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'light' ? 'dark' : 'light'));
  }, []);

  // Filter modul etalase
  const [moduleFilter, setModuleFilter] = useState<'ALL' | 'ACTIVE' | 'UPCOMING'>('ALL');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const scrollToSection = (id: string) => {
    setMobileMenuOpen(false);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleVerification = useCallback((docId?: string) => {
    if (onNavigateToVerification) {
      onNavigateToVerification(docId);
    } else {
      const targetUrl = docId ? `?verify_doc=${encodeURIComponent(docId)}` : '?verify_doc=demo';
      window.location.href = targetUrl;
    }
  }, [onNavigateToVerification]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans transition-colors duration-200">
      {/* =========================================================================
          1. HEADER NAVIGASI PUBLIK (STICKY, BLUR, BRANDING & TOGGLE THEME)
          ========================================================================= */}
      <header className="sticky top-0 z-50 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 sm:h-20 flex items-center justify-between gap-4">
          {/* Logo & Identitas */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
              <img
                src="/mascot_3d.png"
                alt="Maskot Proyek Cair"
                className="w-8 h-8 sm:w-10 sm:h-10 object-contain drop-shadow-md"
                width={40}
                height={40}
              />
              <img
                src="/words_PNG2.png"
                alt="Proyek Cair"
                className="h-7 sm:h-9 w-auto object-contain"
                width={140}
                height={36}
              />
            </div>
            <span className="hidden xl:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
              <Sparkles className="w-2.5 h-2.5" />
              <span>Platform Operasional Proyek Konstruksi</span>
            </span>
          </div>

          {/* Navigasi Desktop */}
          <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-600 dark:text-slate-300">
            <button
              type="button"
              onClick={() => scrollToSection('katalog-modul')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              Etalase Modul
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('keunggulan')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              Komparasi vs Excel
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('skema-biaya')}
              className="hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
            >
              Simulasi Biaya (RFIN-B)
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('verifikasi-qr')}
              className="hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors cursor-pointer inline-flex items-center gap-1"
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Cek Dokumen QR</span>
            </button>
          </nav>

          {/* Tombol Aksi Cepat & Theme Toggle */}
          <div className="flex items-center gap-2.5">
            {/* Saklar Mode Terang / Gelap */}
            <button
              type="button"
              onClick={toggleTheme}
              aria-label="Ubah Tema Tampilan"
              title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
              className="p-2 sm:p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-all cursor-pointer shadow-xs"
            >
              {theme === 'dark' ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-indigo-600" />}
            </button>

            {/* Tombol Masuk ke Akun */}
            <button
              type="button"
              onClick={() => onOpenAuth('signin')}
              className="px-3.5 sm:px-4 py-2 sm:py-2.5 rounded-xl border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/40 text-blue-700 dark:text-blue-300 font-bold text-xs transition-all cursor-pointer shadow-xs"
            >
              Masuk
            </button>

            {/* Tombol Coba Sekarang / Daftar */}
            <button
              type="button"
              onClick={() => onOpenAuth('signup')}
              className="px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-md shadow-blue-600/25 transition-all cursor-pointer inline-flex items-center gap-1.5"
            >
              <span>Daftar Akun</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            {/* Menu Hamburger Mobile */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden p-2 rounded-xl text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Menu Dropdown Mobile */}
        {mobileMenuOpen && (
          <div className="md:hidden border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 pt-3 pb-5 space-y-2 text-xs font-semibold animate-in slide-in-from-top-2">
            <button
              type="button"
              onClick={() => scrollToSection('katalog-modul')}
              className="block w-full text-left py-2 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              Etalase Modul Proyek
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('keunggulan')}
              className="block w-full text-left py-2 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              Komparasi vs Excel
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('skema-biaya')}
              className="block w-full text-left py-2 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
            >
              Simulasi Biaya Lisensi (RFIN-B)
            </button>
            <button
              type="button"
              onClick={() => scrollToSection('verifikasi-qr')}
              className="block w-full text-left py-2 px-3 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-cyan-600 dark:text-cyan-400"
            >
              Cek Keabsahan Dokumen QR
            </button>
          </div>
        )}
      </header>

      {/* =========================================================================
          2. KONTEN UTAMA PROMOSI & NILAI TAMBAH PLATFORM
          ========================================================================= */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-12 space-y-12 sm:space-y-16">
        {/* HERO SECTION DENGAN CALL-TO-ACTION PUBLIK */}
        <HeroSection
          onOpenAuth={onOpenAuth}
          onExploreModules={() => scrollToSection('katalog-modul')}
        />

        {/* ETALASE MODUL OPERASIONAL */}
        <div id="katalog-modul">
          <ModuleCatalogSection
            moduleFilter={moduleFilter}
            onFilterChange={setModuleFilter}
            onSelectView={() => onOpenAuth('signin')}
          />
        </div>

        {/* KOMPARASI EXCEL VS PROYEK CAIR */}
        <div id="keunggulan">
          <ComparisonTableSection />
        </div>

        {/* KALKULATOR SIMULASI BIAYA LISENSI */}
        <div id="skema-biaya">
          <PricingCalculatorSection
            onGoToDashboard={() => onOpenAuth('signin')}
            onGoToRfinB={() => onOpenAuth('signup')}
            onGoToRfinA={() => onOpenAuth('signup')}
          />
        </div>

        {/* WIDGET PERIKSA DOKUMEN PUBLIK QR */}
        <div id="verifikasi-qr">
          <QuickVerifySection
            documents={[]}
            onNavigateToVerification={() => handleVerification()}
          />
        </div>

        {/* CALL TO ACTION PENUTUP */}
        <CallToActionFooter onGoToDashboard={() => onOpenAuth('signup')} />
      </main>

      {/* =========================================================================
          3. FOOTER RESMI PUBLIK & HAK CIPTA
          ========================================================================= */}
      <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 py-8 transition-colors">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2">
            <span className="font-bold text-slate-700 dark:text-slate-200">Proyek Cair Ecosystem</span>
            <span>·</span>
            <span>© {new Date().getFullYear()} Hak Cipta Dilindungi Undang-Undang</span>
          </div>

          <div className="flex items-center gap-4 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <Lock className="w-3.5 h-3.5" />
              <span>Enkripsi TLS & RLS Database</span>
            </span>
            <span>·</span>
            <span className="inline-flex items-center gap-1.5 text-cyan-600 dark:text-cyan-400">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Validasi Checksum Kriptografi SHA-256</span>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
});

PublicLandingView.displayName = 'PublicLandingView';
