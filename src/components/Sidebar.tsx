import React from 'react';
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
  type LucideIcon
} from 'lucide-react';

interface NavItem {
  id: string;
  label: string;
  icon: LucideIcon;
  badge?: string | null;
}

export const Sidebar: React.FC = () => {
  const {
    currentView,
    setCurrentView,
    appMode,
    activeRole,
    activeCompany,
    outOfStockCount,
    user
  } = useApp();

  // Susun menu dinamis sesuai 4 mode bilah sisi (sesuai dokumen spesifikasi)
  let navItems: NavItem[] = [];
  let modeTitle = '';
  let modeSubtitle = '';
  let ModeIcon: LucideIcon = User;
  let themeAccent = 'blue';

  if (appMode === 'PSA') {
    modeTitle = 'Platform Super Admin';
    modeSubtitle = 'Konsol Platform Global';
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
      { id: 'settings', label: 'Pengaturan & Setup Proyek', icon: Settings }
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
    modeTitle = activeCompany.name;
    modeSubtitle = `Peran: ${activeRole}`;
    ModeIcon = Hexagon;
    themeAccent = 'amber';
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
    <aside className="flex w-full shrink-0 flex-col border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 md:min-h-[calc(100vh-53px)] md:w-64 md:border-b-0 md:border-r transition-colors">
      {/* Banner Konteks Aktif */}
      <div className="border-b border-slate-100 dark:border-slate-800 p-3.5">
        <div
          className={`flex min-w-0 items-center gap-3 rounded-xl border p-3 ${
            themeAccent === 'amber'
              ? 'border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20'
              : themeAccent === 'purple'
              ? 'border-purple-500/30 bg-purple-50/50 dark:bg-purple-950/20'
              : themeAccent === 'emerald'
              ? 'border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20'
              : 'border-blue-500/30 bg-blue-50/50 dark:bg-blue-950/20'
          }`}
        >
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              themeAccent === 'amber'
                ? 'bg-amber-500/20 text-amber-500'
                : themeAccent === 'purple'
                ? 'bg-purple-500/20 text-purple-400'
                : themeAccent === 'emerald'
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'bg-blue-500/20 text-blue-400'
            }`}
          >
            <ModeIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-bold text-slate-900 dark:text-white leading-tight">
              {modeTitle}
            </div>
            <div className="truncate text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
              {modeSubtitle}
            </div>
          </div>
        </div>
      </div>

      {/* Navigasi Utama */}
      <nav aria-label="Navigasi Bilah Sisi" className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:p-3 space-y-0.5">
        {navItems.map(item => {
          const Icon = item.icon;
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setCurrentView(item.id)}
              className={`flex w-auto shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-xl px-3.5 py-2.5 text-xs font-semibold transition-all md:w-full ${
                active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <span className="flex min-w-0 items-center gap-3">
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </span>
              {item.badge && (
                <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-500 dark:text-rose-400">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Footer Info Sederhana */}
      <div className="hidden border-t border-slate-100 dark:border-slate-800 p-4 text-[11px] text-slate-400 md:block">
        <div className="flex justify-between items-center">
          <span>Mode Sistem:</span>
          <span className="font-bold uppercase text-slate-600 dark:text-slate-300">
            {appMode}
          </span>
        </div>
        <div className="mt-1 text-[10px] text-slate-400">
          Audit jejak abadi · Tanpa fitur hapus data
        </div>
      </div>
    </aside>
  );
};
