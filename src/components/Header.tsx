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
  Database,
  FolderKanban
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
    setActiveCompany,
    activeProjectId,
    setActiveProjectId,
    setActiveWorkspaceId,
    activeContext,
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

  const mapRoleCode = (code?: string): ImpersonateRole => {
    if (!code) return 'Clerk';
    const upper = code.toUpperCase();
    if (upper === 'CLERK') return 'Clerk';
    if (upper === 'FOREMAN') return 'Foreman';
    if (upper === 'SUPERVISOR' || upper === 'SPV') return 'Spv.';
    if (upper === 'DEPT_MANAGER' || upper === 'MANAGER') return 'Dept. Manager';
    if (upper === 'KTT_PM' || upper === 'PM') return 'KTT/Proj. Manager';
    if (upper === 'CEO' || upper === 'DIRECTOR' || upper === 'DIREKTUR') return 'CEO/Direktur';
    return 'Clerk';
  };

  const userAssignments = activeContext?.projects || [];
  const isCSA = (activeContext?.workspaces || []).some(
    w => w.type === 'COMPANY' && w.is_company_super_admin === true
  );
  const isPSA = Boolean(activeContext?.is_platform_super_admin || user.email === 'islamiahiis243@gmail.com');

  // Auto-snap: jika di mode jabatan tapi peran aktif tidak ada di penugasan sah, kunci ke penugasan pertama
  useEffect(() => {
    if (appMode === 'IMPERSONATE' && userAssignments.length > 0) {
      const validRoles = userAssignments.map(a => mapRoleCode(a.role_code));
      if (!validRoles.includes(activeRole)) {
        const first = userAssignments[0];
        setActiveRole(mapRoleCode(first.role_code));
        if (first.id) setActiveProjectId(first.id);
        if (first.workspace_id) setActiveWorkspaceId(first.workspace_id);
        if (first.company_id && first.company_name) {
          setActiveCompany({
            id: first.company_id,
            name: first.company_name,
            npwp: first.company_npwp || activeCompany.npwp
          });
        }
      }
    }
  }, [userAssignments, appMode, activeRole]);

  const handleSelectAssignment = (proj: any) => {
    const role = mapRoleCode(proj.role_code);
    setActiveRole(role);
    if (proj.company_id && proj.company_name) {
      setActiveCompany({
        id: proj.company_id,
        name: proj.company_name,
        npwp: proj.company_npwp || activeCompany.npwp
      });
    }
    if (proj.id) {
      setActiveProjectId(proj.id);
    }
    if (proj.workspace_id) {
      setActiveWorkspaceId(proj.workspace_id);
    }
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

      {/* WIDGET STATUS KONTEKS / PENUGASAN JABATAN */}
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
          title="Klik untuk memilih penugasan jabatan dan perusahaan"
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

          {/* Badge Jabatan Tombol Sesuai Gambar */}
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

        {/* Panel Dropdown Pemilih Penugasan Jabatan */}
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
                    ? 'bg-emerald-950/60 border border-emerald-500/40 text-emerald-100 font-semibold'
                    : 'hover:bg-slate-800 text-slate-300'
                }`}
              >
                <div className="min-w-0">
                  <div className="text-xs font-bold truncate">{user.name || 'Pengguna Pribadi'}</div>
                  <div className="text-[10px] text-slate-400 truncate">{user.email} · Mode Personal</div>
                </div>
                {appMode === 'PERSONAL' && (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                )}
              </button>
            </div>

            {/* 2. Daftar Penugasan Jabatan Proyek (Topi Kerja Aktif) */}
            <div className="py-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-amber-400 mb-2 px-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3 h-3" /> Penugasan Jabatan Proyek
                </span>
                <span className="font-mono text-[9px] text-slate-400">{activeCompany.npwp}</span>
              </div>

              {/* Tampilkan Penugasan Nyata dari Database jika ada */}
              {userAssignments.length > 0 ? (
                <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                  {userAssignments.map((proj) => {
                    const role = mapRoleCode(proj.role_code);
                    const isActive = appMode === 'IMPERSONATE' && activeProjectId === proj.id && activeRole === role;
                    return (
                      <button
                        key={`${proj.id}-${proj.role_code}`}
                        type="button"
                        onClick={() => handleSelectAssignment(proj)}
                        className={`w-full flex items-center justify-between gap-2 p-2 rounded-xl text-left transition-all border ${
                          isActive
                            ? 'bg-amber-950/60 border-amber-500/50 text-amber-100 font-semibold'
                            : 'border-slate-800/60 hover:bg-slate-800/80 text-slate-300'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] text-slate-400 flex items-center gap-1">
                            <FolderKanban className="w-3 h-3 text-blue-400 shrink-0" />
                            <span className="truncate font-medium text-slate-300">
                              {proj.company_name ? `${proj.company_name} — ` : ''}{proj.name}
                            </span>
                            {proj.project_code && (
                              <span className="font-mono text-blue-300 text-[9px]">({proj.project_code})</span>
                            )}
                          </div>
                          <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              {proj.role_name || role}
                            </span>
                            {['Dept. Manager', 'KTT/Proj. Manager', 'CEO/Direktur', 'Spv.'].includes(role) && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/20 text-blue-300">TTE/QR</span>
                            )}
                          </div>
                        </div>
                        {isActive && <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="p-3 text-center rounded-xl bg-slate-800/40 border border-slate-800/80 text-slate-400">
                  <p className="text-xs font-semibold text-slate-300">Belum ada penugasan proyek</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Aktifkan kode RFIN-B yang Anda terima dari CSA untuk membuka wewenang jabatan proyek Anda.
                  </p>
                </div>
              )}
            </div>

            {/* 3. Konsol Pengelola (Hanya muncul jika pengguna sah memegang kursi CSA atau PSA) */}
            {(isCSA || isPSA) && (
              <div className="pt-3 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 px-2">
                  Konsol Pengelola
                </div>

                {/* Konsol CSA */}
                {isCSA && (
                  <button
                    type="button"
                    onClick={handleSelectCSA}
                    className={`w-full flex items-center justify-between gap-2 p-2 rounded-xl text-left transition-all ${
                      appMode === 'CSA'
                        ? 'bg-blue-950/60 border border-blue-500/40 text-blue-100 font-semibold'
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
                )}

                {/* Konsol PSA */}
                {isPSA && (
                  <button
                    type="button"
                    onClick={handleSelectPSA}
                    className={`w-full flex items-center justify-between gap-2 p-2 rounded-xl text-left transition-all ${
                      appMode === 'PSA'
                        ? 'bg-purple-950/60 border border-purple-500/40 text-purple-100 font-semibold'
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
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bagian Kanan: Saldo Kas, Tema & Akun */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* Saldo Kas (Hanya relevan di mode operasional) */}
        {appMode === 'IMPERSONATE' && (
          <div className="hidden lg:flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-1.5 text-xs">
            <Wallet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-slate-400">Saldo Kas:</span>
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
