import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  FolderKanban,
  Eye,
  Bell,
  Mail
} from 'lucide-react';
import { formatRupiah } from '../lib/pdfGenerator';
import { resolveStockApprovalTargetTab } from '../lib/cashflowEngine';
import { getSupabaseClient } from '../lib/supabase';
import { ImpersonateRole, AppMode } from '../types';

export const Header: React.FC = () => {
  const {
    user,
    logout,
    theme,
    toggleTheme,
    currentCashBalance,
    cashSummaryMetrics,
    cashAccess,
    stockMutations,
    documents,
    pendingStockApprovalCount,
    pendingCashApprovalCount,
    pendingPoApprovalCount,
    pendingDocumentApprovalCount,
    pendingApprovalCount,
    setCashTargetTab,
    setStockTargetTab,
    setProcurementTargetTab,
    appMode,
    setAppMode,
    activeRole,
    setActiveRole,
    activeCompany,
    setActiveCompany,
    activeProjectId,
    activeProject,
    activeWorkspaceId,
    setActiveProjectId,
    setActiveWorkspaceId,
    activeContext,
    supabaseConfig,
    setCurrentView,
    refreshActiveContext
  } = useApp();

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // State Notifikasi Aplikasi (tanda-B)
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const notifRef = useRef<HTMLDivElement>(null);
  const [claimingToken, setClaimingToken] = useState<string | null>(null);
  const [notifNotice, setNotifNotice] = useState('');
  const [notifError, setNotifError] = useState('');

  // Tutup dropdown penugasan & dropdown notifikasi saat klik di luar
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(target)) {
        setDropdownOpen(false);
      }
      if (notifRef.current && !notifRef.current.contains(target)) {
        setNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Muat notifikasi resmi untuk user aktif
  const loadNotifications = useCallback(async () => {
    if (!user.email) return;
    try {
      const db = getSupabaseClient();
      const { data, error: err } = await db
        .from('internal_notifications')
        .select('*')
        .ilike('recipient_email', user.email.trim())
        .eq('is_claimed', false)
        .order('created_at', { ascending: false });

      if (!err && data) {
        const tokenCodes = data.map((d: any) => d.token_code).filter(Boolean);
        let validSet = new Set<string>();

        if (tokenCodes.length > 0) {
          const { data: validTokens } = await db
            .from('rfin_tokens')
            .select('token_code')
            .in('token_code', tokenCodes)
            .is('revoked_at', null)
            .is('redeemed_at', null);

          validSet = new Set((validTokens || []).map((t: any) => t.token_code));
        }

        const activeOnly = data.filter((d: any) => {
          if (appMode === 'CSA' && d.category === 'RFIN_A') return false;
          return d.token_code ? validSet.has(d.token_code) : true;
        });

        const latestByCategory: Record<string, any> = {};
        for (const item of activeOnly) {
          if (!latestByCategory[item.category]) {
            latestByCategory[item.category] = item;
          }
        }
        setNotifications(Object.values(latestByCategory));
      } else {
        setNotifications([]);
      }
    } catch {
      // Ignore
    }
  }, [user.email, appMode]);

  useEffect(() => {
    void loadNotifications();
    const interval = setInterval(loadNotifications, 30000);
    return () => clearInterval(interval);
  }, [loadNotifications]);

  const handleQuickClaim = async (tokenCode: string, notifId: string) => {
    if (!tokenCode || claimingToken) return;
    setClaimingToken(tokenCode);
    setNotifNotice('Mengklaim undangan resmi...');
    setNotifError('');
    try {
      const db = getSupabaseClient();
      const { data, error: err } = await db.rpc('redeem_rfin', {
        p_code: tokenCode.trim(),
      });
      if (err) throw err;
      if (!data?.ok) throw new Error(data?.error || 'Klaim token gagal.');

      setNotifNotice('Undangan berhasil diklaim!');
      setNotifications(prev => prev.filter(n => n.id !== notifId));
      setTimeout(async () => {
        if (refreshActiveContext) await refreshActiveContext();
        window.location.reload();
      }, 800);
    } catch (e: any) {
      setNotifError(e?.message || 'Gagal mengklaim token.');
    } finally {
      setClaimingToken(null);
    }
  };

  const mapRoleCode = (code?: string): ImpersonateRole => {
    if (!code) return 'Clerk';
    const upper = code.toUpperCase();
    if (upper === 'CLERK') return 'Clerk';
    if (upper === 'FOREMAN') return 'Foreman';
    if (upper === 'SUPERVISOR' || upper === 'SPV') return 'Spv.';
    if (upper === 'DEPT_MANAGER' || upper === 'MANAGER') return 'Dept. Manager';
    if (upper === 'KTT_PM' || upper === 'PM') return 'KTT/Proj. Manager';
    if (upper === 'CEO' || upper === 'DIRECTOR' || upper === 'DIREKTUR') return 'CEO/Direktur';
    if (upper === 'VIEWER' || upper === 'PENGAMAT' || upper === 'OBSERVER') return 'Viewer/Pengamat';
    return 'Clerk';
  };

  const userAssignments = activeContext?.projects || [];
  const isCSA = (activeContext?.workspaces || []).some(
    w => w.type === 'COMPANY' && w.is_company_super_admin === true
  );
  const isPSA = Boolean(activeContext?.is_platform_super_admin);

  // Auto-snap penugasan proyek jika belum ada proyek aktif yang terpilih
  useEffect(() => {
    if (appMode === 'IMPERSONATE' && userAssignments.length > 0) {
      if (!activeProjectId && userAssignments[0]?.id) {
        setActiveProjectId(userAssignments[0].id);
      }
      if (!activeWorkspaceId && userAssignments[0]?.workspace_id) {
        setActiveWorkspaceId(userAssignments[0].workspace_id);
      }
    }
  }, [userAssignments, appMode, activeProjectId, activeWorkspaceId]);

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
    if (proj.workspace_id) {
      setActiveWorkspaceId(proj.workspace_id);
    }
    if (proj.id) {
      setActiveProjectId(proj.id);
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

  const stockApprovalTargetTab = resolveStockApprovalTargetTab(
    stockMutations,
    documents,
    activeRole
  );

  const cashApprovalTargetTab =
    cashSummaryMetrics.pendingWorkflowCount > 0 ? 'JOURNAL' : 'DOCUMENTS';

  const getOperationalBellPillClass = (tone: 'sky' | 'amber' | 'teal' | 'blue') => {
    switch (tone) {
      case 'sky':
        return 'bg-sky-500/20 text-sky-300';
      case 'amber':
        return 'bg-amber-500/20 text-amber-300';
      case 'teal':
        return 'bg-teal-500/20 text-teal-300';
      case 'blue':
      default:
        return 'bg-blue-500/20 text-blue-300';
    }
  };

  const operationalBellItems =
    appMode === 'IMPERSONATE'
      ? [
          ...(pendingStockApprovalCount > 0 && activeRole !== 'Viewer/Pengamat'
            ? [
                {
                  id: 'op-stock-approval',
                  title: `${pendingStockApprovalCount} Antrean Persetujuan Mutasi Barang`,
                  message:
                    stockApprovalTargetTab === 'OFFICIAL_DOCUMENTS'
                      ? `Menunggu tindakan jabatan ${activeRole} pada Dokumen Resmi Mutasi Barang.`
                      : `Menunggu tindakan jabatan ${activeRole} di Jurnal Mutasi / Dokumen Resmi Barang.`,
                  tone: 'sky' as const,
                  actionLabel:
                    stockApprovalTargetTab === 'OFFICIAL_DOCUMENTS'
                      ? 'Buka Dokumen Resmi'
                      : 'Buka Mutasi Barang',
                  onClick: () => {
                    setStockTargetTab(stockApprovalTargetTab);
                    setCurrentView('stock-mutations');
                    setNotifOpen(false);
                  },
                },
              ]
            : []),
          ...(pendingCashApprovalCount > 0 && activeRole !== 'Viewer/Pengamat'
            ? [
                {
                  id: 'op-cash-approval',
                  title: `${pendingCashApprovalCount} Antrean Persetujuan Mutasi Dana`,
                  message:
                    cashApprovalTargetTab === 'DOCUMENTS'
                      ? `Menunggu tindakan jabatan ${activeRole} pada Berita Acara Kas.`
                      : `Menunggu tindakan jabatan ${activeRole} di Jurnal Kas / Berita Acara Kas.`,
                  tone: 'amber' as const,
                  actionLabel:
                    cashApprovalTargetTab === 'DOCUMENTS'
                      ? 'Buka Dokumen Kas'
                      : 'Buka Mutasi Dana',
                  onClick: () => {
                    setCashTargetTab(cashApprovalTargetTab);
                    setCurrentView('cashflow');
                    setNotifOpen(false);
                  },
                },
              ]
            : []),
          ...(pendingPoApprovalCount > 0 && activeRole !== 'Viewer/Pengamat'
            ? [
                {
                  id: 'op-po-approval',
                  title: `${pendingPoApprovalCount} Antrean Persetujuan Surat Pesanan (PO)`,
                  message: `Menunggu tindakan jabatan ${activeRole} pada Daftar Surat Pesanan (PO).`,
                  tone: 'amber' as const,
                  actionLabel: 'Buka Pengadaan & PO',
                  onClick: () => {
                    setProcurementTargetTab('PO_LIST');
                    setCurrentView('procurement');
                    setNotifOpen(false);
                  },
                },
              ]
            : []),
          ...(pendingDocumentApprovalCount > 0 && activeRole !== 'Viewer/Pengamat'
            ? [
                {
                  id: 'op-doc-approval',
                  title: `${pendingDocumentApprovalCount} Laporan Terpadu Menunggu Pengesahan`,
                  message: `Menunggu tinjauan jabatan ${activeRole} di Studio Laporan PDF.`,
                  tone: 'teal' as const,
                  actionLabel: 'Buka Studio Laporan',
                  onClick: () => {
                    setCurrentView('reports');
                    setNotifOpen(false);
                  },
                },
              ]
            : []),
          ...(activeRole === 'Clerk' && cashSummaryMetrics.unreconciledStockReceiptsCount > 0
            ? [
                {
                  id: 'op-unreconciled',
                  title: `${cashSummaryMetrics.unreconciledStockReceiptsCount} Nota Gudang Siap Dibayar Kas`,
                  message: 'Pelunasan ekspres 2-klik tersedia di Tab Rekonsiliasi & Panjar.',
                  tone: 'blue' as const,
                  actionLabel: 'Buka Rekonsiliasi',
                  onClick: () => {
                    setCashTargetTab('RECONCILIATION');
                    setCurrentView('cashflow');
                    setNotifOpen(false);
                  },
                },
              ]
            : []),
        ]
      : [];

  const totalBellCount =
    notifications.length +
    (appMode === 'IMPERSONATE'
      ? pendingApprovalCount +
        (activeRole === 'Clerk' ? cashSummaryMetrics.unreconciledStockReceiptsCount : 0)
      : 0);

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-3 py-2.5 sm:px-6 bg-slate-900 border-b border-slate-800 text-white transition-colors">
      {/* Brand & Logo: Maskot Transparan + Banner Resmi (Klik mengarah ke Beranda) */}
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => setCurrentView('landing')}
          className="flex items-center gap-2 sm:gap-2.5 text-left focus:outline-none group cursor-pointer"
          title="Ke Beranda Proyek Cair"
        >
          <img
            src="/mascot_3d.png"
            alt="Maskot Proyek Cair"
            className="w-9 h-9 sm:w-10 sm:h-10 object-contain drop-shadow transition-transform group-hover:scale-105 shrink-0"
          />
          <img
            src="/words_PNG2.png"
            alt="Proyek Cair - Platform Operasional Proyek Konstruksi"
            className="h-8 sm:h-9 md:h-10 w-auto object-contain opacity-95 group-hover:opacity-100 transition-all shrink-0"
          />
        </button>

        {appMode !== 'PERSONAL' && (
          <button
            onClick={handleSelectPersonal}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-medium transition-colors cursor-pointer"
            title="Beralih kembali ke Ruang Akun Personal (Filosofi Coretax)"
          >
            <User className="w-3.5 h-3.5 text-emerald-400" />
            <span>Ke Akun Personal</span>
          </button>
        )}
      </div>

      {/* WIDGET STATUS KONTEKS / PENUGASAN JABATAN */}
      <div className="relative" ref={dropdownRef}>
        <button
          type="button"
          onClick={() => setDropdownOpen(v => !v)}
          className={`flex items-center gap-2.5 rounded-xl px-3 py-1.5 border transition-all text-left shadow-sm ${
            appMode === 'IMPERSONATE'
              ? activeRole === 'Viewer/Pengamat'
                ? 'bg-slate-950/90 border-cyan-500/40 hover:border-cyan-400/80 ring-1 ring-cyan-500/20'
                : 'bg-slate-950/90 border-amber-500/40 hover:border-amber-400/80 ring-1 ring-amber-500/20'
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
            {activeCompany.logoUrl && (appMode === 'IMPERSONATE' || appMode === 'CSA') ? (
              <img
                src={activeCompany.logoUrl}
                alt={activeCompany.name}
                className="w-5 h-5 rounded-md object-contain bg-white/10 p-0.5 border border-white/20"
              />
            ) : appMode === 'IMPERSONATE' ? (
              activeRole === 'Viewer/Pengamat' ? (
                <div className="relative">
                  <Eye className="w-5 h-5 text-cyan-400 stroke-[2]" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-cyan-400 border border-slate-950 animate-pulse" />
                </div>
              ) : (
                <div className="relative">
                  <Hexagon className="w-6 h-6 text-amber-400 fill-amber-400/10 stroke-[1.8]" />
                  <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 border border-slate-950" />
                </div>
              )
            ) : appMode === 'CSA' ? (
              <ShieldAlert className="w-5 h-5 text-blue-400" />
            ) : appMode === 'PSA' ? (
              <ShieldCheck className="w-5 h-5 text-purple-400" />
            ) : (
              <User className="w-5 h-5 text-emerald-400" />
            )}
          </div>

          {/* Info Identitas: Nama Perusahaan (Biru) & Nama Proyek (Merah) */}
          <div className="min-w-0 pr-1 text-left">
            <div className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase leading-none truncate max-w-[85px] sm:max-w-[200px]">
              {appMode === 'IMPERSONATE'
                ? (activeCompany.name || 'Perusahaan')
                : appMode === 'CSA'
                ? (activeCompany.npwp || 'KONSOL PERUSAHAAN')
                : appMode === 'PSA'
                ? 'GLOBAL PLATFORM'
                : 'PENGGUNA PRIBADI'}
            </div>
            <div className="text-xs font-bold text-white tracking-wide leading-tight truncate max-w-[85px] sm:max-w-[200px] mt-0.5">
              {appMode === 'IMPERSONATE'
                ? (activeProject?.name || 'Proyek Aktif')
                : appMode === 'CSA'
                ? activeCompany.name
                : appMode === 'PSA'
                ? 'PLATFORM ADMIN'
                : user.name || 'Personal User'}
            </div>
          </div>

          {/* Badge Jabatan Tombol Sesuai Gambar */}
          <div
            className={`flex items-center gap-1 rounded-full px-1.5 sm:px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase border transition-colors shrink-0 ${
              appMode === 'IMPERSONATE'
                ? activeRole === 'Viewer/Pengamat'
                  ? 'border-cyan-500/70 text-cyan-300 bg-cyan-500/10'
                  : 'border-amber-500/70 text-amber-300 bg-amber-500/10'
                : appMode === 'CSA'
                ? 'border-blue-500/70 text-blue-300 bg-blue-500/10'
                : appMode === 'PSA'
                ? 'border-purple-500/70 text-purple-300 bg-purple-500/10'
                : 'border-slate-600 text-slate-300 bg-slate-800'
            }`}
          >
            <span className="truncate max-w-[70px] sm:max-w-none">
              {appMode === 'IMPERSONATE'
                ? (activeRole === 'Viewer/Pengamat' ? 'PENGAMAT' : activeRole)
                : appMode === 'CSA'
                ? 'CSA'
                : appMode === 'PSA'
                ? 'PSA'
                : 'PERSONAL'}
            </span>
            <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
          </div>
        </button>

        {/* Panel Dropdown Pemilih Penugasan Jabatan (Tengah Layar di Ponsel, Rapi di Desktop) */}
        {dropdownOpen && (
          <div className="absolute left-1/2 -translate-x-1/2 sm:left-0 sm:translate-x-0 mt-2 w-[calc(100vw-24px)] max-w-sm sm:w-96 rounded-2xl border border-slate-800 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl z-50 text-slate-200 divide-y divide-slate-800/80 animate-in fade-in slide-in-from-top-2 duration-150 max-h-[82vh] overflow-y-auto">
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
                <div className="flex items-center gap-2.5 min-w-0">
                  {user.avatar_url ? (
                    <img
                      src={user.avatar_url}
                      alt={user.name || 'Personal'}
                      className="w-7 h-7 rounded-full object-cover border border-emerald-500/40 shrink-0"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-full bg-emerald-900/60 border border-emerald-500/40 text-emerald-200 flex items-center justify-center font-bold text-xs shrink-0">
                      {user.name?.charAt(0).toUpperCase() || 'P'}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{user.name || 'Pengguna Pribadi'}</div>
                    <div className="text-[10px] text-slate-400 truncate">{user.email} · Mode Personal</div>
                  </div>
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
                <span className="text-[10px] text-slate-400 font-semibold">{activeCompany.name}</span>
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
                        className={`w-full flex items-center justify-between gap-2 p-2.5 rounded-xl text-left transition-all border ${
                          isActive
                            ? 'bg-amber-950/60 border-amber-500/50 text-amber-100 font-semibold shadow-xs'
                            : 'border-slate-800/60 hover:bg-slate-800/80 text-slate-300'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-white flex items-center gap-1.5">
                            <FolderKanban className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                            <span className="truncate">{proj.name}</span>
                            {proj.project_code && (
                              <span className="font-mono text-blue-300 text-[10px]">({proj.project_code})</span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 mt-0.5 truncate">
                            Perusahaan: <span className="text-slate-300 font-medium">{proj.company_name || activeCompany.name}</span>
                          </div>
                          <div className="mt-1.5 flex items-center justify-between gap-2">
                            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              Jabatan: {proj.role_name || role}
                            </span>
                            {['Dept. Manager', 'KTT/Proj. Manager', 'CEO/Direktur', 'Spv.'].includes(role) && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-semibold">TTE/QR</span>
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
                  <p className="text-[10px] text-slate-400 mt-1">
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
        {/* Saldo Kas Interaktif (Hanya relevan di mode operasional dan bukan untuk jabatan Pengamat) */}
        {appMode === 'IMPERSONATE' && activeRole !== 'Viewer/Pengamat' && (
          <button
            type="button"
            onClick={() => {
              setCashTargetTab('SUMMARY');
              setCurrentView('cashflow');
            }}
            title={`Saldo kas proyek (${cashSummaryMetrics.healthLabel}) — Klik untuk membuka Mutasi Dana`}
            className={`hidden lg:flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs min-w-[140px] justify-between transition-colors cursor-pointer ${
              cashSummaryMetrics.isCashCritical
                ? 'border-rose-500/60 bg-rose-950/60 hover:bg-rose-950'
                : 'border-slate-800 bg-slate-950/60 hover:border-emerald-500/50'
            }`}
          >
            <div className="flex items-center gap-1.5">
              <Wallet className={`w-3.5 h-3.5 shrink-0 ${cashSummaryMetrics.isCashCritical ? 'text-rose-400' : 'text-emerald-400'}`} />
              <span className="text-slate-400">Saldo:</span>
            </div>
            <span className={`font-semibold font-mono tabular-nums ${cashSummaryMetrics.isCashCritical ? 'text-rose-300' : 'text-emerald-400'}`}>
              {cashAccess ? formatRupiah(currentCashBalance) : 'Terbatas'}
            </span>
          </button>
        )}

        {/* Status Database */}
        <div className="hidden md:flex items-center gap-1.5 text-[11px] text-slate-300 min-w-[90px]" title="Koneksi Supabase">
          <Database className={`w-3.5 h-3.5 shrink-0 ${supabaseConfig.isConnected ? 'text-emerald-400' : 'text-slate-400'}`} />
          <span className="hidden xl:inline">{supabaseConfig.isConnected ? 'Terkoneksi' : 'Offline'}</span>
        </div>

        {/* IKON NOTIFIKASI APP (RFIN + ANTREAN PERSETUJUAN BARANG & KAS) */}
        {user.id && (
          <div className="relative" ref={notifRef}>
            <button
              type="button"
              onClick={() => setNotifOpen(v => !v)}
              aria-label="Notifikasi Aplikasi"
              title={totalBellCount > 0 ? `${totalBellCount} notifikasi & antrean aktif` : 'Notifikasi Aplikasi'}
              className="relative p-2 rounded-xl border border-slate-800 bg-slate-950 text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
            >
              <Bell className="w-4 h-4" />
              {totalBellCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] px-1 items-center justify-center rounded-full bg-rose-500 text-[10px] font-extrabold text-white shadow-sm ring-2 ring-slate-950 animate-pulse">
                  {totalBellCount}
                </span>
              )}
            </button>

            {/* Panel Dropdown Notifikasi */}
            {notifOpen && (
              <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-2xl border border-slate-800 bg-slate-900/95 p-3.5 shadow-2xl backdrop-blur-xl z-50 text-slate-200 animate-in fade-in slide-in-from-top-2 duration-150 max-h-[82vh] overflow-y-auto">
                <div className="flex items-center justify-between pb-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Bell className="w-4 h-4 text-blue-400" />
                    <span className="text-xs font-bold text-white">Notifikasi &amp; Antrean Proyek</span>
                  </div>
                  {totalBellCount > 0 && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold">
                      {totalBellCount} Aktif
                    </span>
                  )}
                </div>

                {notifNotice && (
                  <div className="mt-2.5 p-2 rounded-lg bg-emerald-950/80 border border-emerald-500/40 text-xs text-emerald-200">
                    {notifNotice}
                  </div>
                )}
                {notifError && (
                  <div className="mt-2.5 p-2 rounded-lg bg-rose-950/80 border border-rose-500/40 text-xs text-rose-200">
                    {notifError}
                  </div>
                )}

                <div className="mt-2.5 space-y-2">
                  {/* 1. Antrean Operasional & Persetujuan Proyek */}
                  {operationalBellItems.map((op) => (
                    <button
                      key={op.id}
                      type="button"
                      onClick={op.onClick}
                      className="w-full text-left p-3 rounded-xl bg-slate-800/80 hover:bg-slate-800 border border-slate-700/70 transition-colors cursor-pointer space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-white leading-snug">{op.title}</span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${getOperationalBellPillClass(op.tone)}`}
                        >
                          {op.actionLabel} →
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 leading-relaxed">{op.message}</p>
                    </button>
                  ))}

                  {/* 2. Undangan Resmi RFIN */}
                  {notifications.map((n) => (
                    <div
                      key={n.id}
                      className="p-3 rounded-xl bg-slate-800/60 border border-slate-700/60 space-y-2"
                    >
                      <div className="flex items-start gap-2.5">
                        <div className="p-1.5 rounded-lg bg-blue-500/20 text-blue-400 shrink-0 mt-0.5">
                          <Mail className="w-3.5 h-3.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-white leading-snug">{n.title}</p>
                          <p className="text-[11px] text-slate-300 mt-0.5 leading-relaxed">{n.message}</p>
                          {n.token_code && (
                            <div className="mt-1.5 flex items-center gap-1.5">
                              <span className="text-[10px] text-slate-400 font-semibold">Kode Token:</span>
                              <span className="font-mono text-xs font-bold text-amber-300 bg-black/40 px-1.5 py-0.5 rounded border border-amber-400/30">
                                {n.token_code}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>

                      {n.token_code && (
                        <div className="pt-1 flex justify-end">
                          <button
                            type="button"
                            disabled={Boolean(claimingToken)}
                            onClick={() => handleQuickClaim(n.token_code, n.id)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-colors disabled:opacity-40 cursor-pointer shadow-xs"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>{claimingToken === n.token_code ? 'Mengklaim…' : 'Klaim Sekarang'}</span>
                          </button>
                        </div>
                      )}
                    </div>
                  ))}

                  {operationalBellItems.length === 0 && notifications.length === 0 && (
                    <div className="py-6 text-center text-slate-400">
                      <CheckCircle2 className="w-8 h-8 text-emerald-400/80 mx-auto mb-2" />
                      <p className="text-xs font-semibold text-slate-300">Semua Beres</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Tidak ada notifikasi atau antrean persetujuan saat ini.</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Toggle Mode Terang/Gelap (Tersedia di Semua Mode) */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
          title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
          className="p-2 rounded-xl border border-slate-800 bg-slate-950 text-slate-300 hover:text-white hover:border-slate-700 transition-colors cursor-pointer"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400" />
          ) : (
            <Moon className="w-4 h-4 text-slate-300" />
          )}
        </button>

        {/* FOTO PROFIL / AVATAR PENGGUNA BERDIRI SENDIRI DI TOPBAR */}
        {user.id && (
          <button
            type="button"
            onClick={() => {
              setCurrentView('settings');
            }}
            aria-label={`Profil ${user.name || user.email}`}
            title={`Profil: ${user.name || 'Pengguna Pribadi'} (${user.email})\nKlik untuk Pengaturan Profil & Foto`}
            className="group relative flex items-center justify-center rounded-full transition-transform hover:scale-105 focus:outline-none shrink-0 cursor-pointer"
          >
            {user.avatar_url ? (
              <img
                src={user.avatar_url}
                alt={user.name || 'Foto Profil'}
                className="w-9 h-9 rounded-full object-cover border-2 border-slate-700 group-hover:border-blue-400 shadow-sm transition-all"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div
              className={`${user.avatar_url ? 'hidden' : ''} w-9 h-9 rounded-full bg-gradient-to-br from-blue-600 to-indigo-700 text-white font-bold text-sm flex items-center justify-center border-2 border-slate-700 group-hover:border-blue-400 shadow-sm transition-all`}
            >
              {user.name ? user.name.charAt(0).toUpperCase() : (user.email ? user.email.charAt(0).toUpperCase() : 'U')}
            </div>
          </button>
        )}

        {/* Tombol Logout */}
        {user.id && (
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Keluar dari akun"
            title="Keluar dari akun"
            className="flex items-center gap-1.5 p-2 rounded-xl border border-slate-800 bg-slate-950 text-slate-300 hover:text-rose-400 hover:border-rose-900/60 transition-colors text-xs font-semibold cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Keluar</span>
          </button>
        )}
      </div>
    </header>
  );
};
