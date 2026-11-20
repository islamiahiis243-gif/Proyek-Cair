import React, { useState, useEffect, startTransition } from 'react';
import { useApp } from '../context/AppContext';
import {
  LayoutDashboard,
  Boxes,
  WalletCards,
  KeyRound,
  Building2,
  Settings,
  ShieldAlert,
  ShieldCheck,
  User,
  Hexagon,
  Eye,
  ChevronLeft,
  ChevronRight,
  type LucideIcon
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string | null;
}

const SIDEBAR_COLLAPSED_KEY = 'proyek_cair_sidebar_collapsed';

export const Sidebar: React.FC = () => {
  const {
    currentView,
    setCurrentView,
    appMode,
    activeRole,
    activeCompany,
    activeProject,
    outOfStockCount,
    user
  } = useApp();

  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch {
      return false;
    }
  });

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(next));
      } catch {}
      return next;
    });
  };

  // Susun menu dinamis sesuai 4 mode bilah sisi
  let navItems: NavItem[] = [];
  let modeTitle = '';
  let modeSubtitle = '';
  let ModeIcon: LucideIcon = User;
  let themeAccent = 'blue';

  if (appMode === 'PSA') {
    modeTitle = 'Platform Super Admin';
    modeSubtitle = 'Konsol Global';
    ModeIcon = ShieldCheck;
    themeAccent = 'purple';
    navItems = [
      { id: 'dashboard', label: 'Dasbor & Analitik', icon: LayoutDashboard },
      { id: 'rfin-a-approval', label: 'Persetujuan RFIN-A', icon: Building2 },
      { id: 'settings', label: 'Pengaturan Platform', icon: Settings }
    ];
  } else if (appMode === 'CSA') {
    modeTitle = activeCompany.name || 'Company Super Admin';
    modeSubtitle = 'Konsol Perusahaan (CSA)';
    ModeIcon = ShieldAlert;
    themeAccent = 'blue';
    navItems = [
      { id: 'dashboard', label: 'Dasbor & Analitik', icon: LayoutDashboard },
      { id: 'rfin-b-generate', label: 'Penerbitan RFIN-B', icon: KeyRound },
      { id: 'settings', label: 'Pengaturan & Proyek', icon: Settings }
    ];
  } else if (appMode === 'PERSONAL') {
    modeTitle = user.name || 'Pengguna Pribadi';
    modeSubtitle = 'Akun Personal';
    ModeIcon = User;
    themeAccent = 'emerald';
    navItems = [
      { id: 'dashboard', label: 'Dasbor & Analitik', icon: LayoutDashboard },
      { id: 'rfin-a-request', label: 'Pengajuan RFIN-A', icon: Building2 },
      { id: 'settings', label: 'Pengaturan Akun', icon: Settings }
    ];
  } else {
    // Mode Impersonate (Karyawan / Anggota Proyek)
    modeTitle = activeProject?.name || activeCompany.name || 'UDU Project';
    modeSubtitle = `${activeCompany.name || 'Perusahaan'} · Jabatan: ${activeRole}`;
    ModeIcon = activeRole === 'Viewer/Pengamat' ? Eye : Hexagon;
    themeAccent = activeRole === 'Viewer/Pengamat' ? 'cyan' : 'amber';
    navItems = [
      { id: 'dashboard', label: 'Dasbor & Analitik', icon: LayoutDashboard },
      { id: 'rfin-b-input', label: 'Aktivasi RFIN-B', icon: KeyRound },
      {
        id: 'stock-mutations',
        label: 'Modul Mutasi Barang',
        icon: Boxes,
        badge: outOfStockCount > 0 ? `${outOfStockCount} Kosong` : null
      },
      { id: 'cashflow', label: 'Modul Mutasi Dana', icon: WalletCards },
      { id: 'settings', label: 'Pengaturan Karyawan & TTE', icon: Settings }
    ];
  }

  return (
    <aside
      className={`flex w-full shrink-0 flex-col border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 md:min-h-[calc(100vh-53px)] md:border-b-0 md:border-r transition-all duration-300 ease-in-out ${
        isCollapsed ? 'md:w-20' : 'md:w-64'
      }`}
    >
      {/* Banner Konteks & Tombol Expand / Collapse */}
      <div className="border-b border-slate-100 dark:border-slate-800 p-3">
        <div className="flex items-center justify-between gap-2">
          {/* Info Mode (Hanya saat expanded di desktop, atau selalu di mobile) */}
          <div
            className={`min-w-0 flex-1 flex items-center gap-2.5 rounded-xl border p-2.5 ${
              isCollapsed ? 'justify-center md:p-2' : ''
            } ${
              themeAccent === 'amber'
                ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20'
                : themeAccent === 'cyan'
                ? 'border-cyan-500/30 bg-cyan-50/50 dark:bg-cyan-950/20'
                : themeAccent === 'purple'
                ? 'border-purple-500/30 bg-purple-50/50 dark:bg-purple-950/20'
                : themeAccent === 'emerald'
                ? 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20'
                : 'border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20'
            }`}
            title={`${modeTitle} (${modeSubtitle})`}
          >
            <div
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                themeAccent === 'amber'
                  ? 'bg-amber-500/20 text-amber-500'
                  : themeAccent === 'cyan'
                  ? 'bg-cyan-500/20 text-cyan-500 dark:text-cyan-400'
                  : themeAccent === 'purple'
                  ? 'bg-purple-500/20 text-purple-400'
                  : themeAccent === 'emerald'
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-blue-500/20 text-blue-400'
              }`}
            >
              <ModeIcon className="h-4 w-4" />
            </div>

            {/* Teks label disembunyikan saat collapsed */}
            {!isCollapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-bold text-slate-900 dark:text-white leading-tight">
                  {modeTitle}
                </div>
                <div className="truncate text-[10px] text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                  {modeSubtitle}
                </div>
              </div>
            )}
          </div>

          {/* Tombol Collapse di Header Bilah Sisi (Desktop Only) */}
          <button
            type="button"
            onClick={toggleCollapsed}
            className="hidden md:flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title={isCollapsed ? 'Luaskan Bilah Sisi (Expand)' : 'Ciutkan Bilah Sisi (Collapse)'}
            aria-label={isCollapsed ? 'Luaskan Bilah Sisi' : 'Ciutkan Bilah Sisi'}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Navigasi Utama */}
      <nav
        aria-label="Navigasi Bilah Sisi"
        className={`flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden ${
          isCollapsed ? 'md:p-2 space-y-1' : 'md:p-3 space-y-0.5'
        }`}
      >
        {navItems.map(item => {
          const Icon = item.icon;
          const active = currentView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                startTransition(() => {
                  setCurrentView(item.id);
                });
              }}
              className={`relative flex w-auto shrink-0 items-center gap-3 whitespace-nowrap rounded-xl transition-all ${
                isCollapsed
                  ? 'md:w-full md:justify-center p-2.5 text-xs'
                  : 'px-3.5 py-2.5 text-xs font-semibold md:w-full justify-between'
              } ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
              title={isCollapsed ? item.label : undefined}
            >
              <span className={`flex min-w-0 items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
                <Icon className="h-4 w-4 shrink-0" />
                {/* Teks label disembunyikan saat collapsed pada layar desktop */}
                {!isCollapsed && <span className="truncate">{item.label}</span>}
              </span>

              {/* Badge saat expanded */}
              {!isCollapsed && item.badge && (
                <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:text-rose-300">
                  {item.badge}
                </span>
              )}

              {/* Indikator dot saat collapsed */}
              {isCollapsed && item.badge && (
                <span
                  className="hidden md:block absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white dark:ring-slate-900"
                  title={item.badge}
                />
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Info & Tombol Toggle Bawah */}
      <div className="hidden border-t border-slate-100 dark:border-slate-800 p-3 text-[11px] text-slate-600 dark:text-slate-300 md:block">
        {!isCollapsed ? (
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-slate-600 dark:text-slate-300 font-medium">Mode:</span>
              <span className="font-bold uppercase text-slate-800 dark:text-slate-100">
                {appMode}
              </span>
            </div>
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Ciutkan Bilah Sisi"
              className="w-full flex items-center justify-center gap-2 rounded-lg border border-slate-200 dark:border-slate-800 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              <span>Ciutkan Bilah Sisi</span>
            </button>
          </div>
        ) : (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={toggleCollapsed}
              aria-label="Luaskan Bilah Sisi"
              className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title="Luaskan Bilah Sisi (Expand)"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
};
