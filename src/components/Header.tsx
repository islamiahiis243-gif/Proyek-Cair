import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import {
  Hexagon,
  ChevronDown,
  Building2,
  User,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Moon,
  LogOut,
  Wallet,
  CheckCircle2,
  Database
} from 'lucide-react';
import { formatRupiah } from '../lib/pdfGenerator';
import { ImpersonateRole, AppMode } from '../types';

export const Header: React.FC = () => {
  const {
    user,
    logout,
    theme,
    toggleTheme,
    currentCashBalance,
    cashAccess,
    appMode,
    setAppMode,
    activeRole,
    setActiveRole,
    activeCompany,
    supabaseConfig,
    setCurrentView
  } = useApp();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Tutup dropdown saat klik di luar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const roles: Array<{ role: ImpersonateRole; label: string; desc: string }> = [
    { role: 'Clerk', label: 'Clerk', desc: 'Staf Administrasi / Logistik · Terbitkan & Input Transaksi' },
    { role: 'Foreman', label: 'Foreman', desc: 'Mandor / Pengawas Lapangan · Diperiksa Oleh' },
    { role: 'Spv.', label: 'Spv. (Supervisor)', desc: 'Pengawas Teknis · Diperiksa & Disetujui Oleh' },
    { role: 'Dept. Manager', label: 'Dept. Manager', desc: 'Manajer Bagian · Disetujui & TTE/QR' },
    { role: 'KTT/Proj. Manager', label: 'KTT / Project Manager', desc: 'Kepala Teknik Tambang / PM · Mengetahui & TTE/QR' },
    { role: 'CEO/Direktur', label: 'CEO / Direktur', desc: 'Direktur Utama · Otorisasi Puncak & TTE/QR' }
  ];

  const handleSelectRole = (role: ImpersonateRole) => {
    setActiveRole(role);
    setAppMode('IMPERSONATE');
    setDropdownOpen(false);
  };

  const handleSelectPersonal = () => {
    setAppMode('PERSONAL');
    setDropdownOpen(false);
  };

  const handleSelectCSA = () => {
    setAppMode('CSA');
    setDropdownOpen(false);
  };

  const handleSelectPSA = () => {
    setAppMode('PSA');
    setDropdownOpen(false);
  };

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-3 py-2.5 sm:px-6 bg-slate-900 border-b border-slate-800 text-white transition-colors">
      {/* Brand & Logo */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => setCurrentView('dashboard')}
          className="flex items-center gap-2.5 text-left focus:outline-none group"
          title="Ke Dasbor Utama"
        >
          <img
            src="/android-chrome-192x192.png"
            alt="Logo Proyek Cair"
            className="w-9 h-9 rounded-lg object-contain bg-slate-800 p-0.5 border border-slate-700 group-hover:border-blue-500 transition-colors"
          />
          <div className="hidden sm:block">
            <div className="text-sm font-bold tracking-tight text-white group-hover:text-blue-400 transition-colors leading-none">
              Proyek Cair
            </div>
            <div className="text-[10px] text-slate-400 mt-0.5 leading-none font-medium">
              Manajemen Proyek & Keuangan
            </div>
          </div>
        </button>
      </div>

      {/* WIDGET IMPERSONATE / SWITCHER PERSONA (SESUAI GAMBAR 2) */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen(v => !v)}
          className={`flex items-center gap-2.5 rounded-xl px-3 py-1.5 border transition-all text-left shadow-sm ${
            appMode === 'IMPERSONATE'
              ? 'bg-slate-950/90 border-amber-500/40 hover:border-amber-400/80 ring-1 ring-amber-500/20'
              : appMode === 'CSA'
              ? 'bg-slate-950/90 border-blue-500/40 hover:border-blue-400/80 ring-1 ring-blue-500/20'
              : appMode === 'PSA'
              ? 'bg-slate-950/90 border-purple-500/40 hover:border-purple-400/80 ring-1 ring-purple-500/20'
              : 'bg-slate-950/90 border-slate-700 hover:border-slate-600'
          }`}
          aria-haspopup="true"
          aria-expanded={dropdownOpen}
          title="Klik untuk beralih mode dan persona impersonate"
        >
          {/* Ikon Hexagon / Identitas */}
          <div className="flex items-center justify-center shrink-0">
            {appMode === 'IMPERSONATE' ? (
              <div className="relative">
                <Hexagon className="w-6 h-6 text-amber-400 fill-amber-400/10 stroke-[1.8]" />
                <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-slate-950" />
              </div>
            ) : appMode === 'CSA' ? (
              <ShieldAlert className="w-5 h-5 text-blue-400" />
            ) : appMode === 'PSA' ? (
              <ShieldCheck className="w-5 h-5 text-purple-400" />
            ) : (
              <User className="w-5 h-5 text-emerald-400" />
            )}
          </div>

          {/* Info Nama & NPWP */}
          <div className="min-w-0 pr-1">
            <div className="text-[10px] font-mono tracking-wider text-slate-400 leading-none">
              {appMode === 'IMPERSONATE' || appMode === 'CSA'
                ? activeCompany.npwp
                : appMode === 'PSA'
                ? 'GLOBAL PLATFORM'
                : 'PENGGUNA PRIBADI'}
            </div>
            <div className="text-xs font-bold text-white tracking-wide leading-tight truncate">
              {appMode === 'IMPERSONATE' || appMode === 'CSA'
                ? activeCompany.name
                : appMode === 'PSA'
                ? 'PLATFORM ADMIN'
                : user.name || 'Personal User'}
            </div>
          </div>

          {/* Badge Tombol Sesuai Gambar 2 */}
          <div
            className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase border transition-colors ${
              appMode === 'IMPERSONATE'
                ? 'border-amber-500/70 text-amber-300 bg-amber-500/10'
                : appMode === 'CSA'
                ? 'border-blue-500/70 text-blue-300 bg-blue-500/10'
                : appMode === 'PSA'
                ? 'border-purple-500/70 text-purple-300 bg-purple-500/10'
                : 'border-slate-600 text-slate-300 bg-slate-800'
            }`}
          >
            <span>
              {appMode === 'IMPERSONATE'
                ? activeRole
                : appMode === 'CSA'
                ? 'CSA'
                : appMode === 'PSA'
                ? 'PSA'
                : 'PERSONAL'}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400" />
          </div>
        </button>

        {/* Panel Dropdown Pemilih Persona */}
        {dropdownOpen && (
          <div className="absolute left-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-800 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl z-50 text-slate-200 divide-y divide-slate-800/80 animate-in fade-in slide-in-from-top-2 duration-150">
            {/* 1. Akun Personal */}
            <div className="pb-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-2 flex items-center gap-1.5">
                <User className="w-3 h-3 text-emerald-400" /> Akun Pribadi
              </div>
              <button
                type="button"
                onClick={handleSelectPersonal}
                className={`w-full flex items-center justify-between gap-3 p-2 rounded-xl text-left transition-all ${
                  appMode === 'PERSONAL'
                    ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-100'
                    : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{user.name || 'Pengguna'}</div>
                  <div className="text-[10px] text-slate-400 truncate">{user.email} · Mode Personal</div>
                </div>
                {appMode === 'PERSONAL' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
              </button>
            </div>

            {/* 2. Persona Impersonate Perusahaan */}
            <div className="py-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-2 px-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3 h-3" /> Impersonate Peran ({activeCompany.name})
                </span>
                <span className="font-mono text-[9px] text-slate-400">{activeCompany.npwp}</span>
              </div>

              <div className="space-y-1">
                {roles.map(({ role, label, desc }) => {
                  const isActive = appMode === 'IMPERSONATE' && activeRole === role;
                  return (
                    <button
                      key={role}
                      type="button"
                      onClick={() => handleSelectRole(role)}
                      className={`w-full flex items-center justify-between gap-2 p-2 rounded-xl text-left transition-all ${
                        isActive
                          ? 'bg-amber-950/60 border border-amber-500/40 text-amber-100 font-semibold'
                          : 'hover:bg-slate-800/80 text-slate-300'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-xs flex items-center gap-1.5">
                          <span>{label}</span>
                          {role === 'Clerk' && (
                            <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[9px]">CRU</span>
                          )}
                          {['Dept. Manager', 'KTT/Proj. Manager', 'CEO/Direktur'].includes(role) && (
                            <span className="px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300 text-[9px]">TTE/QR</span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 truncate">{desc}</div>
                      </div>
                      {isActive && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 3. Konsol Super Admin (CSA & PSA) */}
            <div className="pt-3 space-y-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 px-2">
                Konsol Pengelola
              </div>

              {/* Konsol CSA */}
              <button
                type="button"
                onClick={handleSelectCSA}
                className={`w-full flex items-center justify-between gap-2 p-2 rounded-xl text-left transition-all ${
                  appMode === 'CSA'
                    ? 'bg-blue-950/60 border border-blue-500/40 text-blue-100'
                    : 'hover:bg-slate-800/80 text-slate-300'
                }`}
              >
                <div>
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-blue-400" />
                    <span>Company Super Admin (CSA)</span>
                  </div>
                  <div className="text-[10px] text-slate-400">Pengaturan Proyek & Terbitkan RFIN-B</div>
                </div>
                {appMode === 'CSA' && <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />}
              </button>

              {/* Konsol PSA */}
              <button
                type="button"
                onClick={handleSelectPSA}
                className={`w-full flex items-center justify-between gap-2 p-2 rounded-xl text-left transition-all ${
                  appMode === 'PSA'
                    ? 'bg-purple-950/60 border border-purple-500/40 text-purple-100'
                    : 'hover:bg-slate-800/80 text-slate-300'
                }`}
              >
                <div>
                  <div className="text-xs font-semibold flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-purple-400" />
                    <span>Platform Super Admin (PSA)</span>
                  </div>
                  <div className="text-[10px] text-slate-400">Persetujuan RFIN-A & Kontrol Platform</div>
                </div>
                {appMode === 'PSA' && <CheckCircle2 className="w-4 h-4 text-purple-400 shrink-0" />}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bagian Kanan: Saldo Kas, Tema & Akun */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* Saldo Kas (Hanya relevan di mode impersonate operasional) */}
        {appMode === 'IMPERSONATE' && (
          <div className="hidden lg:flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs">
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400">Saldo:</span>
            <span className="font-semibold text-emerald-400 font-mono">
              {cashAccess ? formatRupiah(currentCashBalance) : 'Terbatas'}
            </span>
          </div>
        )}

        {/* Status Database */}
        <div className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-400" title="Koneksi Supabase">
          <Database className={`w-3.5 h-3.5 ${supabaseConfig.isConnected ? 'text-emerald-400' : 'text-slate-500'}`} />
          <span className="hidden xl:inline">{supabaseConfig.isConnected ? 'Terkoneksi' : 'Offline'}</span>
        </div>

        {/* Toggle Mode Terang/Gelap */}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
          className="p-2 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white hover:border-slate-700 transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {/* Tombol Logout */}
        {user.id && (
          <button
            onClick={() => void logout()}
            title="Keluar dari akun"
            className="flex items-center gap-1.5 p-2 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-rose-400 hover:border-rose-900/60 transition-colors text-xs font-semibold"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        )}
      </div>
    </header>
  );
};
