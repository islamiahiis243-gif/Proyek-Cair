import React, { useCallback, useEffect, useState } from 'react';
import {
  Building2,
  FolderKanban,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  LayoutDashboard,
  KeyRound,
  Settings,
  Users,
  CheckCircle2,
  UserCheck,
  Briefcase,
  Camera,
  Trash2,
  XCircle
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import { getSupabaseClient, resolveMyActiveContext } from '../lib/supabase';
import { RfinBInvitationPanel } from './RfinBInvitationPanel';
import { AvatarCropperModal } from './AvatarCropperModal';

type CompanyWorkspace = { id: string; name: string; company_id: string | null };
type ProjectRow = { id: string; workspace_id: string; project_code: string; name: string; description: string | null; status: string; created_at: string };
type ClientRow = { id: string; project_id: string; client_name: string; relationship_type: string; commercial_reference: string | null; notes: string | null };
type ProfileChangeRow = { id: string; proposed_legal_name: string | null; change_npwp: boolean; proposed_npwp_last4: string | null; reason: string; status: string; created_at: string; review_notes: string | null };
type CompanyDashboard = {
  company_name: string;
  company_status: string;
  memberships: { total: number; active: number; suspended: number; revoked: number };
  invitations: { active: number; expired: number; redeemed: number; revoked: number };
  projects: { total: number; active: number; completed: number; archived: number };
  approvals: { pending: number };
  documents: { total: number; by_status: Record<string, number> };
  access_alerts: { suspended_memberships: number; revoked_memberships: number; expired_invitations: number };
  last_activity_at: string | null;
  recent_activity: { action: string; entity_type: string; created_at: string }[];
};
type CoveragePermission = { permission_code: string; module: string; action: string; risk_level: string; requires_authority_check: boolean; description: string };
type CoverageRole = { role_code: string; display_name: string };
type CoverageMember = {
  project_membership_id: string;
  company_membership_id: string;
  user_id: string;
  full_name: string;
  email?: string;
  avatar_url?: string | null;
  membership_status: string;
  can_view_financials?: boolean;
  roles?: CoverageRole[];
  permissions: CoveragePermission[];
};
type CoverageProject = { id: string; project_code: string; name: string; status: string; active_member_count: number; members_without_permissions: number; permission_code_count: number; members: CoverageMember[] };
type ProjectCoverage = {
  active_company_members: number;
  active_projects: number;
  active_project_memberships: number;
  members_without_active_project: number;
  active_members_without_permissions: number;
  projects: CoverageProject[];
  unassigned_members: {
    company_membership_id: string;
    user_id: string;
    full_name: string;
    email?: string;
    avatar_url?: string | null;
    activated_at: string | null;
  }[];
};

export const CompanyConsole: React.FC = () => {
  const db = getSupabaseClient();
  const { currentView, setCurrentView, activeCompany, updateCompanyLogo } = useApp();

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<CompanyWorkspace[]>([]);
  const [adminWorkspaceIds, setAdminWorkspaceIds] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLogoModalOpen, setIsLogoModalOpen] = useState(false);
  const [isSavingLogo, setIsSavingLogo] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<{
    projectId: string;
    projectName: string;
    userId: string;
    memberName: string;
    memberEmail?: string;
    roleCode: string;
    roleDisplayName: string;
  } | null>(null);
  const [revokeLoading, setRevokeLoading] = useState(false);

  const handleConfirmRevokeRole = async () => {
    if (!revokeTarget) return;
    setRevokeLoading(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcErr } = await db.rpc('revoke_project_member_role', {
        p_project_id: revokeTarget.projectId,
        p_user_id: revokeTarget.userId,
        p_role_code: revokeTarget.roleCode
      });
      if (rpcErr || !data?.ok) {
        // Fallback langsung update project_memberships
        const { error: fErr } = await db.from('project_memberships')
          .update({ membership_status: 'REVOKED', updated_at: new Date().toISOString() })
          .eq('project_id', revokeTarget.projectId)
          .eq('user_id', revokeTarget.userId)
          .eq('role_code', revokeTarget.roleCode);
        if (fErr) throw fErr;
      }
      setNotice(`Jabatan ${revokeTarget.roleDisplayName} berhasil dicabut dari ${revokeTarget.memberName}.`);
      setRevokeTarget(null);
      await loadProjectCoverage(workspaceId);
    } catch (err: any) {
      setError(err?.message || 'Gagal mencabut jabatan.');
    } finally {
      setRevokeLoading(false);
    }
  };

  const [togglingFinancialUserId, setTogglingFinancialUserId] = useState<string | null>(null);

  const handleToggleFinancialAccess = async (
    projectId: string,
    userId: string,
    memberName: string,
    currentAccess: boolean
  ) => {
    setTogglingFinancialUserId(userId);
    setError('');
    try {
      const newAccess = !currentAccess;
      const { data, error: rpcErr } = await db.rpc('toggle_member_financial_access', {
        p_project_id: projectId,
        p_user_id: userId,
        p_can_view: newAccess
      });
      if (rpcErr) {
        const { error: directErr } = await db
          .from('project_memberships')
          .update({ can_view_financials: newAccess })
          .eq('project_id', projectId)
          .eq('user_id', userId)
          .eq('membership_status', 'ACTIVE');
        if (directErr) throw directErr;
      }
      setNotice(`Wewenang nominal ${memberName} berhasil diubah ke: ${newAccess ? 'Aktif (Dapat melihat harga & belanja)' : 'Terbatas (Nominal disembunyikan)'}.`);
      setTimeout(() => setNotice(''), 4000);
      await loadProjectCoverage(workspaceId);
    } catch (err: any) {
      setError(err?.message || 'Gagal mengubah wewenang nominal.');
    } finally {
      setTogglingFinancialUserId(null);
    }
  };

  const handleSaveCompanyLogo = async (dataUrl: string) => {
    setIsSavingLogo(true);
    setError('');
    try {
      await updateCompanyLogo(dataUrl);
      setNotice('Logo resmi perusahaan berhasil diperbarui dan diterapkan secara dinamis ke seluruh sistem.');
      setTimeout(() => setNotice(''), 4000);
    } catch (err: any) {
      setError(err?.message || 'Gagal menyimpan logo perusahaan.');
    } finally {
      setIsSavingLogo(false);
    }
  };

  // Proyek Baru
  const [projectCode, setProjectCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [clientName, setClientName] = useState('');
  const [commercialReference, setCommercialReference] = useState('');

  // Profil Perusahaan
  const [currentCompanyLegalName, setCurrentCompanyLegalName] = useState('');
  const [companyLegalName, setCompanyLegalName] = useState('');
  const [profileNpwp, setProfileNpwp] = useState('');
  const [changeNpwp, setChangeNpwp] = useState(false);
  const [profileReason, setProfileReason] = useState('');
  const [profileChanges, setProfileChanges] = useState<ProfileChangeRow[]>([]);

  // Dasbor & Coverage
  const [dashboard, setDashboard] = useState<CompanyDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState('');
  const [projectCoverage, setProjectCoverage] = useState<ProjectCoverage | null>(null);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageError, setCoverageError] = useState('');
  const [assignmentTargets, setAssignmentTargets] = useState<Record<string, string>>({});
  const [assigningMember, setAssigningMember] = useState('');
  const [rfinBTarget, setRfinBTarget] = useState<{ email?: string; projectId?: string }>({});

  const loadProjects = useCallback(async (targetWorkspaceId: string): Promise<ProjectRow[]> => {
    if (!targetWorkspaceId) { setProjects([]); setClients([]); return []; }
    const { data, error: projectError } = await db.from('projects')
      .select('id,workspace_id,project_code,name,description,status,created_at')
      .eq('workspace_id', targetWorkspaceId)
      .order('created_at', { ascending: false });
    if (projectError) throw projectError;
    const rows = (data || []) as ProjectRow[];
    setProjects(rows);
    if (!rows.length) { setClients([]); return rows; }
    const { data: clientData, error: clientError } = await db.from('project_client_relationships')
      .select('id,project_id,client_name,relationship_type,commercial_reference,notes')
      .in('project_id', rows.map(row => row.id));
    if (clientError) {
      console.warn('Gagal memuat relasi klien:', clientError);
      setClients([]);
    } else {
      setClients((clientData || []) as ClientRow[]);
    }
    return rows;
  }, [db]);

  const loadDashboard = useCallback(async (targetWorkspaceId: string) => {
    if (!targetWorkspaceId) { setDashboard(null); setDashboardError(''); return; }
    setDashboardLoading(true); setDashboardError('');
    try {
      const { data, error: rpcErr } = await db.rpc('get_company_console_dashboard', { p_workspace_id: targetWorkspaceId });
      if (rpcErr) throw rpcErr;
      setDashboard(data as CompanyDashboard);
    } catch (e: any) {
      setDashboard(null);
      setDashboardError(e?.message || 'Ringkasan Dasbor Perusahaan gagal dimuat.');
    } finally {
      setDashboardLoading(false);
    }
  }, [db]);

  const loadProjectCoverage = useCallback(async (targetWorkspaceId: string) => {
    if (!targetWorkspaceId) { setProjectCoverage(null); setCoverageError(''); return; }
    setCoverageLoading(true); setCoverageError('');
    try {
      const { data, error: rpcErr } = await db.rpc('get_company_project_assignment_coverage', { p_workspace_id: targetWorkspaceId });
      if (rpcErr) throw rpcErr;
      setProjectCoverage(data as ProjectCoverage);
    } catch (e: any) {
      setProjectCoverage(null);
      setCoverageError(e?.message || 'Ringkasan penugasan tim proyek gagal dimuat.');
    } finally {
      setCoverageLoading(false);
    }
  }, [db]);

  const handleAssignToProjectClick = (companyMembershipId: string, memberEmail?: string) => {
    const selectedProjectId = assignmentTargets[companyMembershipId] || '';
    setRfinBTarget({
      email: memberEmail || '',
      projectId: selectedProjectId || undefined
    });
    setError('');
    setNotice('');
    setCurrentView('rfin-b-generate');
  };

  const refresh = useCallback(async () => {
    setLoading(true); setError(''); setNotice('');
    try {
      const resolved = await resolveMyActiveContext();
      if (!resolved.authenticated || !resolved.user_id) throw new Error('Sesi autentikasi tidak valid.');
      const companyWorkspaces = (resolved.workspaces || [])
        .filter(w => w.type === 'COMPANY' && w.status === 'ACTIVE')
        .map(w => ({ id: w.id, name: w.name, company_id: w.company_id }));
      setWorkspaces(companyWorkspaces);
      if (!companyWorkspaces.length) {
        setAdminWorkspaceIds([]); setWorkspaceId(''); setProjects([]); setClients([]); setDashboard(null); setProjectCoverage(null);
        return;
      }

      // Verifikasi ganda hak akses CSA melalui membership aktif dan kursi terverifikasi
      const [membershipsRes, seatsRes] = await Promise.all([
        db.from('company_memberships')
          .select('workspace_id,company_id,is_company_super_admin,membership_status')
          .eq('user_id', resolved.user_id)
          .eq('membership_status', 'ACTIVE'),
        db.from('company_admin_seats')
          .select('company_id')
          .eq('claimed_by', resolved.user_id)
          .eq('seat_status', 'CLAIMED')
      ]);

      const claimedCompanyIds = new Set((seatsRes.data || []).map((s: any) => s.company_id));
      const allowed = new Set(companyWorkspaces.map(w => w.id));
      const adminIds = (membershipsRes.data || [])
        .filter((m: any) => m.is_company_super_admin || claimedCompanyIds.has(m.company_id))
        .map((m: any) => m.workspace_id)
        .filter((id: string) => allowed.has(id));

      setAdminWorkspaceIds(adminIds);
      const preferred = adminIds.includes(workspaceId) ? workspaceId : adminIds[0] || '';
      setWorkspaceId(preferred);

      await Promise.all([
        loadProjects(preferred),
        loadDashboard(preferred),
        loadProjectCoverage(preferred)
      ]);

      const selectedWorkspace = companyWorkspaces.find(w => w.id === preferred);
      if (selectedWorkspace?.company_id) {
        const [profileResult, changeResult] = await Promise.all([
          db.from('companies').select('legal_name').eq('id', selectedWorkspace.company_id).maybeSingle(),
          db.from('company_profile_change_requests').select('id,proposed_legal_name,change_npwp,proposed_npwp_last4,reason,status,created_at,review_notes').eq('company_id', selectedWorkspace.company_id).order('created_at', { ascending: false }).limit(10)
        ]);
        if (!profileResult.error) setCurrentCompanyLegalName(profileResult.data?.legal_name || '');
        if (!changeResult.error) setProfileChanges(changeResult.data || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Gagal memuat Konsol Perusahaan.');
    } finally {
      setLoading(false);
    }
  }, [db, loadProjects, loadDashboard, loadProjectCoverage, workspaceId]);

  useEffect(() => { void refresh(); }, []);

  const changeWorkspace = async (id: string) => {
    setWorkspaceId(id); setError(''); setNotice('');
    try {
      await Promise.all([
        loadProjects(id),
        loadDashboard(id),
        loadProjectCoverage(id)
      ]);
      const selectedWorkspace = workspaces.find(w => w.id === id);
      if (selectedWorkspace?.company_id) {
        const [profileResult, changeResult] = await Promise.all([
          db.from('companies').select('legal_name').eq('id', selectedWorkspace.company_id).maybeSingle(),
          db.from('company_profile_change_requests').select('id,proposed_legal_name,change_npwp,proposed_npwp_last4,reason,status,created_at,review_notes').eq('company_id', selectedWorkspace.company_id).order('created_at', { ascending: false }).limit(10)
        ]);
        if (!profileResult.error) setCurrentCompanyLegalName(profileResult.data?.legal_name || '');
        if (!changeResult.error) setProfileChanges(changeResult.data || []);
      }
    } catch (e: any) {
      setError(e?.message || 'Gagal memperbarui workspace.');
    }
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!adminWorkspaceIds.includes(workspaceId)) {
      setError('Akses Company Super Admin tidak terverifikasi untuk workspace ini.');
      return;
    }
    const code = projectCode.trim().toUpperCase();
    const name = projectName.trim();
    const client = clientName.trim();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) {
      setError('Kode Proyek harus 2–40 karakter: huruf kapital, angka, garis bawah, atau tanda hubung.');
      return;
    }
    if (name.length < 2 || name.length > 160) {
      setError('Nama Proyek harus 2–160 karakter.');
      return;
    }
    if (client.length < 2 || client.length > 200) {
      setError('Nama klien harus 2–200 karakter.');
      return;
    }
    if (projects.some(p => p.project_code.toUpperCase() === code)) {
      setError('Kode Proyek sudah digunakan pada Ruang Kerja Perusahaan ini.');
      return;
    }

    setBusy(true); setError(''); setNotice('Membuat Proyek dan relasi klien…');
    try {
      const { error: rpcError } = await db.rpc('create_company_project_with_client', {
        p_workspace_id: workspaceId,
        p_project_code: code,
        p_name: name,
        p_description: description.trim() || null,
        p_client_name: client,
        p_relationship_type: 'MAIN_CLIENT',
        p_commercial_reference: commercialReference.trim() || null,
        p_notes: null
      });
      if (rpcError) throw rpcError;
      await loadProjects(workspaceId);
      setProjectCode(''); setProjectName(''); setDescription(''); setClientName(''); setCommercialReference('');
      setNotice('Proyek baru dan hubungan klien berhasil didaftarkan.');
    } catch (e: any) {
      setError(e?.message || 'Proyek belum dapat dibuat. Periksa data kembali.');
    } finally {
      setBusy(false);
    }
  };

  const submitProfileChange = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || !activeWorkspace?.company_id || !canAdmin) return;
    const name = companyLegalName.trim();
    const reasonText = profileReason.trim();
    if (!name && !changeNpwp) {
      setError('Isi perubahan nama legal atau aktifkan opsi perubahan NPWP.');
      return;
    }
    if (name && (name.length < 2 || name.length > 200)) {
      setError('Nama legal harus 2–200 karakter.');
      return;
    }
    if (changeNpwp && !profileNpwp.trim()) {
      setError('NPWP baru wajib diisi.');
      return;
    }
    if (reasonText.length < 8 || reasonText.length > 500) {
      setError('Alasan perubahan wajib 8–500 karakter.');
      return;
    }
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: rpcErr } = await db.rpc('request_company_profile_change', {
        p_company_id: activeWorkspace.company_id,
        p_legal_name: name || null,
        p_npwp: changeNpwp ? profileNpwp : null,
        p_change_npwp: changeNpwp,
        p_reason: reasonText
      });
      if (rpcErr) throw rpcErr;
      setCompanyLegalName(''); setProfileNpwp(''); setChangeNpwp(false); setProfileReason('');
      setNotice('Permohonan perubahan profil perusahaan telah dikirim ke Platform Super Admin. Ref: ' + String(data).slice(0, 8).toUpperCase());
      await refresh();
    } catch (e: any) {
      setError(e?.message || 'Permohonan perubahan profil gagal dikirim.');
    } finally {
      setBusy(false);
    }
  };

  const activeWorkspace = workspaces.find(w => w.id === workspaceId);
  const canAdmin = Boolean(activeWorkspace && adminWorkspaceIds.includes(workspaceId));

  // Tab yang aktif sesuai sidebar atau default ke dashboard
  const activeTab = currentView === 'rfin-b-generate' ? 'rfin-b-generate' : currentView === 'settings' ? 'settings' : 'dashboard';

  return (
    <div className="space-y-6">
      {/* Header Utama Konsol Perusahaan */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-3">
          <div
            role="button"
            tabIndex={0}
            onClick={() => setIsLogoModalOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setIsLogoModalOpen(true); }}
            title="Klik untuk mengunggah atau mengganti logo perusahaan resmi (1:1)"
            className="relative group p-1.5 rounded-2xl bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900 cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 hover:shadow-md transition-all shrink-0 w-14 h-14 flex items-center justify-center overflow-hidden"
          >
            {activeCompany.logoUrl ? (
              <img
                src={activeCompany.logoUrl}
                alt={activeCompany.name}
                className="w-full h-full object-contain rounded-xl p-0.5 bg-white dark:bg-slate-900"
              />
            ) : (
              <Building2 className="h-7 w-7 group-hover:scale-105 transition-transform" />
            )}
            <div className="absolute -bottom-0.5 -right-0.5 p-1 rounded-full bg-blue-600 text-white shadow-xs group-hover:scale-110 transition-transform">
              <Camera className="w-3 h-3" />
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Konsol Perusahaan (CSA)</h1>
              <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-blue-100 dark:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                ADMIN
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tata kelola tenant resmi, penerbitan undangan tim (RFIN-B), dan manajemen proyek.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => void refresh()}
            disabled={loading || busy}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-50 transition-colors shadow-sm"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin text-blue-600' : ''}`} />
            Segarkan Data
          </button>
        </div>
      </div>

      {/* Tab Navigasi Bersih & Ramah Pengguna (Scroll Horizontal Mulus di Mobile) */}
      <div className="flex overflow-x-auto no-scrollbar touch-scroll whitespace-nowrap border-b border-slate-200 dark:border-slate-800 gap-1 sm:gap-2 pb-1">
        <button
          onClick={() => setCurrentView('dashboard')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg transition-colors border-b-2 -mb-[2px] ${
            activeTab === 'dashboard'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/30'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40'
          }`}
        >
          <LayoutDashboard className="h-4 w-4" />
          Dasbor & Tim
        </button>

        <button
          onClick={() => setCurrentView('rfin-b-generate')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg transition-colors border-b-2 -mb-[2px] ${
            activeTab === 'rfin-b-generate'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/30'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40'
          }`}
        >
          <KeyRound className="h-4 w-4" />
          Penerbitan RFIN-B
          {dashboard?.invitations?.active ? (
            <span className="ml-1 px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-blue-600 text-white">
              {dashboard.invitations.active}
            </span>
          ) : null}
        </button>

        <button
          onClick={() => setCurrentView('settings')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs sm:text-sm font-semibold rounded-t-lg transition-colors border-b-2 -mb-[2px] ${
            activeTab === 'settings'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/30'
              : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800/40'
          }`}
        >
          <Settings className="h-4 w-4" />
          Pengaturan & Proyek
        </button>
      </div>

      {/* Pesan Pemberitahuan & Peringatan */}
      {error && (
        <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-rose-600 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {notice && (
        <div role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200 flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <span>{notice}</span>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-64 place-items-center text-sm text-slate-500">
          <div className="flex flex-col items-center gap-3">
            <RefreshCw className="h-6 w-6 animate-spin text-blue-600" />
            <p className="font-medium">Memverifikasi keanggotaan Company Super Admin…</p>
          </div>
        </div>
      ) : !workspaces.length ? (
        <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
          <ShieldAlert className="mx-auto h-10 w-10 text-slate-400" />
          <h2 className="mt-3 font-semibold text-base">Ruang Kerja Perusahaan belum tersedia</h2>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            Akun ini belum memiliki Ruang Kerja Perusahaan aktif. Silakan ajukan pendaftaran perusahaan atau hubungi Platform Super Admin.
          </p>
        </section>
      ) : !canAdmin ? (
        <section className="rounded-2xl border border-amber-300 bg-amber-50 p-8 text-center dark:border-amber-900/60 dark:bg-amber-950/20">
          <ShieldAlert className="mx-auto h-10 w-10 text-amber-600" />
          <h2 className="mt-3 font-semibold text-base text-amber-900 dark:text-amber-200">Akses Company Super Admin Diperlukan</h2>
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto">
            Konsol Perusahaan hanya dapat diakses oleh pemegang kursi Company Super Admin resmi yang telah mengklaim undangan RFIN-A.
          </p>
        </section>
      ) : (
        <>
          {/* TAB 1: DASBOR & TIM */}
          {activeTab === 'dashboard' && (
            <div className="space-y-6">
              {/* Kartu Informasi Perusahaan Aktif */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <span className="text-[11px] font-bold tracking-wider text-blue-600 dark:text-blue-400 uppercase">
                      Perusahaan / Tenant Aktif
                    </span>
                    <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">
                      {activeWorkspace?.name || currentCompanyLegalName || 'Perusahaan'}
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                      Status Administrator: <b>Company Super Admin Terverifikasi</b>
                    </p>
                  </div>

                  {workspaces.length > 1 && (
                    <label className="text-xs font-medium">
                      Ganti Perusahaan
                      <select
                        value={workspaceId}
                        onChange={e => void changeWorkspace(e.target.value)}
                        className="mt-1 block rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"
                      >
                        {workspaces.filter(w => adminWorkspaceIds.includes(w.id)).map(w => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {/* Ringkasan Angka Cepat */}
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Total Anggota Perusahaan</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {dashboard?.memberships.active ?? projectCoverage?.active_company_members ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Proyek Aktif</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {projects.length}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Undangan Aktif (RFIN-B)</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums text-blue-600 dark:text-blue-400">
                      {dashboard?.invitations.active ?? 0}
                    </p>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    <p className="text-xs text-slate-500 dark:text-slate-400">Dokumen Transaksi</p>
                    <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                      {dashboard?.documents.total ?? 0}
                    </p>
                  </div>
                </div>
              </section>

              {/* Penugasan Tim Proyek (Sederhana & User Friendly) */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <div>
                      <h2 className="font-bold text-base text-slate-900 dark:text-slate-100">Tim & Penugasan Proyek</h2>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Daftar anggota tim proyek, Jabatan aktif, dan akses operasional.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void loadProjectCoverage(workspaceId)}
                    disabled={coverageLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${coverageLoading ? 'animate-spin text-blue-600' : ''}`} />
                    Segarkan Tim
                  </button>
                </div>

                {coverageLoading ? (
                  <p className="py-8 text-center text-xs text-slate-500">Memuat data tim operasional…</p>
                ) : coverageError ? (
                  <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200">
                    {coverageError}
                  </div>
                ) : (
                  <div className="mt-4 space-y-4">
                    {/* Daftar per Proyek */}
                    {projectCoverage?.projects?.length ? (
                      projectCoverage.projects.map(project => {
                        const clientRel = clients.find(c => c.project_id === project.id);
                        return (
                          <div key={project.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20">
                            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200/80 dark:border-slate-700/60">
                              <div>
                                <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{project.project_code}</span>
                                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">{project.name}</h3>
                                {clientRel && (
                                  <p className="text-xs text-slate-500 dark:text-slate-400">
                                    Klien: <b>{clientRel.client_name}</b> {clientRel.commercial_reference ? `(${clientRel.commercial_reference})` : ''}
                                  </p>
                                )}
                              </div>
                              <span className="px-2.5 py-1 text-xs font-semibold rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                {project.active_member_count} Anggota Bertugas
                              </span>
                            </div>

                            {/* Anggota di Proyek ini */}
                            <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                              {project.members?.map(member => (
                                <div key={member.project_membership_id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900 shadow-xs">
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2.5 min-w-0">
                                      {member.avatar_url ? (
                                        <img
                                          src={member.avatar_url}
                                          alt={member.full_name}
                                          className="w-7 h-7 rounded-full object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                                          onError={(e) => {
                                            // Fallback graceful jika URL gambar gagal dimuat
                                            e.currentTarget.style.display = 'none';
                                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                          }}
                                        />
                                      ) : null}
                                      <div className={`w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs shrink-0 ${member.avatar_url ? 'hidden' : ''}`}>
                                        {member.full_name?.charAt(0).toUpperCase() || 'U'}
                                      </div>
                                      <div className="min-w-0">
                                        <p className="text-xs font-bold text-slate-900 dark:text-slate-100 leading-tight truncate">{member.full_name}</p>
                                        <p className="text-[10px] text-slate-600 dark:text-slate-300 font-medium break-all truncate">{member.email || 'Email tidak tersedia'}</p>
                                      </div>
                                    </div>
                                    <span className="px-1.5 py-0.5 text-[9px] font-semibold rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                                      Aktif
                                    </span>
                                  </div>

                                  {/* Jabatan yang dimandatkan pada proyek ini (boleh merangkap) */}
                                  <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                                    <p className="text-[10px] font-semibold text-slate-600 dark:text-slate-300 mb-1">
                                      Jabatan pada proyek ini{(member.roles?.length || 0) > 1 ? ` (merangkap ${member.roles!.length})` : ''}
                                    </p>
                                    <div className="flex flex-wrap gap-1">
                                      {member.roles?.length ? (
                                        member.roles.map(r => (
                                          <button
                                            type="button"
                                            key={r.role_code}
                                            onClick={() => setRevokeTarget({
                                              projectId: project.id,
                                              projectName: project.name,
                                              userId: member.user_id,
                                              memberName: member.full_name,
                                              memberEmail: member.email,
                                              roleCode: r.role_code,
                                              roleDisplayName: r.display_name
                                            })}
                                            className={`group inline-flex items-center gap-1.5 px-2.5 py-0.5 text-[10px] font-semibold rounded-full border transition-all cursor-pointer hover:border-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-700 dark:hover:text-rose-300 ${
                                              r.role_code === 'VIEWER'
                                                ? 'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-200 dark:border-cyan-800'
                                                : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800'
                                            }`}
                                            title={`Klik untuk mencabut jabatan ${r.display_name} dari ${member.full_name}`}
                                          >
                                            <span>{r.display_name}</span>
                                            <span className="text-[9px] text-slate-400 group-hover:text-rose-600 font-bold">✕</span>
                                          </button>
                                        ))
                                      ) : (
                                        <span className="text-[10px] text-slate-600 dark:text-slate-300 italic">Belum ada jabatan</span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Pengaturan Akses Nominal & Finansial CSA */}
                                  <div className="mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2">
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-medium">Akses Nominal:</span>
                                    <button
                                      type="button"
                                      disabled={togglingFinancialUserId === member.user_id}
                                      onClick={() => handleToggleFinancialAccess(project.id, member.user_id, member.full_name, member.can_view_financials ?? true)}
                                      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border transition-all cursor-pointer ${
                                        (member.can_view_financials ?? true)
                                          ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800 hover:bg-emerald-100'
                                          : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700 hover:bg-slate-200'
                                      }`}
                                      title="Klik untuk mengubah izin akses nominal & finansial anggota ini pada proyek"
                                    >
                                      <span>{(member.can_view_financials ?? true) ? '💰 Nominal Aktif' : '🔒 Nominal Terbatas'}</span>
                                    </button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-xs text-slate-500">
                        Belum ada Proyek yang tercatat. Silakan buat proyek pertama di tab <b>Pengaturan & Proyek</b>.
                      </div>
                    )}

                    {/* Anggota yang belum terhubung ke Proyek */}
                    {projectCoverage?.unassigned_members?.length ? (
                      <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50/40 p-4 dark:border-amber-900/50 dark:bg-amber-950/20">
                        <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
                          <UserCheck className="h-4 w-4" />
                          Anggota Terdaftar Belum Ditugaskan ke Proyek Spesifik
                        </h4>
                        <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-400">
                          Anggota berikut telah terdaftar di perusahaan. Anda dapat langsung menugaskannya ke proyek aktif di bawah ini:
                        </p>
                        <div className="mt-3 space-y-2">
                          {projectCoverage.unassigned_members.map(member => (
                            <div key={member.company_membership_id} className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                              <div className="flex items-center gap-2.5 min-w-0">
                                {member.avatar_url ? (
                                  <img
                                    src={member.avatar_url}
                                    alt={member.full_name}
                                    className="w-7 h-7 rounded-full object-cover border border-amber-200 dark:border-amber-700 shrink-0"
                                    onError={(e) => {
                                      e.currentTarget.style.display = 'none';
                                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                                    }}
                                  />
                                ) : null}
                                <div className={`w-7 h-7 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center justify-center font-bold text-xs shrink-0 ${member.avatar_url ? 'hidden' : ''}`}>
                                  {member.full_name?.charAt(0).toUpperCase() || 'U'}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-900 dark:text-slate-100 truncate">{member.full_name}</p>
                                  <p className="text-[10px] text-slate-500">{member.activated_at ? `Bergabung: ${new Date(member.activated_at).toLocaleDateString('id-ID')}` : ''}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2">
                                <select
                                  aria-label={'Pilih proyek untuk ' + member.full_name}
                                  value={assignmentTargets[member.company_membership_id] || ''}
                                  onChange={e => setAssignmentTargets(cur => ({ ...cur, [member.company_membership_id]: e.target.value }))}
                                  className="rounded-lg border border-slate-300 bg-white p-1.5 text-xs dark:border-slate-700 dark:bg-slate-950"
                                >
                                  <option value="">Pilih Proyek…</option>
                                  {projects.map(p => (
                                    <option key={p.id} value={p.id}>{p.project_code} - {p.name}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  onClick={() => handleAssignToProjectClick(member.company_membership_id, member.email)}
                                  className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold text-xs hover:bg-blue-700 transition-colors shadow-xs"
                                >
                                  Tugaskan ke Proyek
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>
            </div>
          )}

          {/* TAB 2: PENERBITAN RFIN-B (UNDANGAN TIM) */}
          {activeTab === 'rfin-b-generate' && (
            <div className="space-y-6">
              <RfinBInvitationPanel
                workspaceId={workspaceId}
                companyId={activeWorkspace?.company_id || ''}
                canAdmin={canAdmin}
                projects={projects}
                initialEmail={rfinBTarget.email}
                initialProjectId={rfinBTarget.projectId}
              />
            </div>
          )}

          {/* TAB 3: PENGATURAN & PROYEK */}
          {activeTab === 'settings' && (
            <div className="space-y-6">
              {/* Bagian Manajemen Proyek */}
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                {/* Form Buat Proyek */}
                <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                  <div className="mb-4">
                    <h2 className="flex items-center gap-2 font-bold text-base text-slate-900 dark:text-slate-100">
                      <FolderKanban className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      Daftarkan Proyek Baru
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      Proyek dibuat di Ruang Kerja Perusahaan aktif beserta hubungan bisnis dengan klien utama.
                    </p>
                  </div>

                  <form onSubmit={createProject} className="space-y-3 text-xs">
                    <div>
                      <label className="block font-medium mb-1">Kode Proyek *</label>
                      <input
                        required
                        maxLength={40}
                        value={projectCode}
                        onChange={e => setProjectCode(e.target.value.toUpperCase())}
                        placeholder="Contoh: UDU-02"
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 uppercase dark:border-slate-700 dark:bg-slate-950 font-mono"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Nama Proyek Operasional *</label>
                      <input
                        required
                        minLength={2}
                        maxLength={160}
                        value={projectName}
                        onChange={e => setProjectName(e.target.value)}
                        placeholder="Contoh: Proyek Pembangunan Office UDU"
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>
                    <div>
                      <label className="block font-medium mb-1">Deskripsi Proyek (Opsional)</label>
                      <textarea
                        maxLength={2000}
                        rows={2}
                        value={description}
                        onChange={e => setDescription(e.target.value)}
                        placeholder="Ringkasan lingkup pekerjaan"
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                      />
                    </div>

                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-3">
                      <div>
                        <label className="block font-medium mb-1">Nama Klien / Pemberi Kerja *</label>
                        <input
                          required
                          minLength={2}
                          maxLength={200}
                          value={clientName}
                          onChange={e => setClientName(e.target.value)}
                          placeholder="Contoh: PT Pemilik Proyek Utama"
                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                        />
                      </div>
                      <div>
                        <label className="block font-medium mb-1">Referensi Kontrak / SPK (Opsional)</label>
                        <input
                          maxLength={200}
                          value={commercialReference}
                          onChange={e => setCommercialReference(e.target.value)}
                          placeholder="Nomor kontrak atau surat perintah kerja"
                          className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                        />
                      </div>
                    </div>

                    <button
                      disabled={busy || !canAdmin}
                      className="w-full mt-2 rounded-lg bg-blue-600 px-4 py-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition-colors shadow-sm"
                    >
                      {busy ? 'Menyimpan…' : 'Simpan Proyek & Hubungan Klien'}
                    </button>
                  </form>
                </section>

                {/* Daftar Proyek Terdaftar */}
                <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                  <div className="mb-4 flex items-center justify-between">
                    <div>
                      <h2 className="font-bold text-base text-slate-900 dark:text-slate-100">Daftar Proyek Terdaftar</h2>
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Proyek yang aktif di bawah naungan perusahaan.</p>
                    </div>
                    <span className="text-xl font-bold text-blue-600 dark:text-blue-400 tabular-nums">
                      {projects.length}
                    </span>
                  </div>

                  {projects.length ? (
                    <div className="space-y-3">
                      {projects.map(project => {
                        const relClients = clients.filter(c => c.project_id === project.id);
                        return (
                          <article key={project.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/20">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div>
                                <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400">{project.project_code}</span>
                                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{project.name}</h3>
                                {project.description && (
                                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{project.description}</p>
                                )}
                              </div>
                              <span className="px-2 py-0.5 text-[10px] font-semibold rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                                {project.status}
                              </span>
                            </div>

                            <div className="mt-3 pt-2.5 border-t border-slate-200/80 dark:border-slate-700/60 text-xs text-slate-600 dark:text-slate-300">
                              {relClients.length ? (
                                relClients.map(c => (
                                  <div key={c.id} className="flex items-center gap-1.5">
                                    <Briefcase className="h-3.5 w-3.5 text-slate-400" />
                                    <span>Klien: <b>{c.client_name}</b> {c.commercial_reference ? `· ${c.commercial_reference}` : ''}</span>
                                  </div>
                                ))
                              ) : (
                                <p className="text-slate-400 italic">Belum ada data klien terhubung.</p>
                              )}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-xs text-slate-500 dark:border-slate-700">
                      Belum ada Proyek yang tercatat.
                    </div>
                  )}
                </section>
              </div>

              {/* Bagian Profil Perusahaan */}
              <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 shadow-sm">
                <div className="mb-4">
                  <h2 className="font-bold text-base text-slate-900 dark:text-slate-100">Profil Perusahaan & Legalitas</h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Nama Legal Resmi: <b>{currentCompanyLegalName || 'Perusahaan'}</b>.
                    Perubahan nama legal atau NPWP akan dikirim untuk peninjauan resmi Platform Super Admin.
                  </p>
                </div>

                {/* Kartu Kelola Logo Perusahaan */}
                <div className="rounded-xl border border-blue-200/80 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/20 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-1 shrink-0 flex items-center justify-center shadow-xs">
                      {activeCompany.logoUrl ? (
                        <img src={activeCompany.logoUrl} alt="Logo Perusahaan" className="w-full h-full object-contain rounded-lg" />
                      ) : (
                        <Building2 className="w-6 h-6 text-slate-400" />
                      )}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-900 dark:text-white">Logo Resmi Tenant / Perusahaan</h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Ditampilkan dinamis pada kop surat ekspor PDF, bilah navigasi header, dan modul operasional.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsLogoModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-xl bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors cursor-pointer shrink-0"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>{activeCompany.logoUrl ? 'Ubah Logo Perusahaan' : 'Unggah Logo Perusahaan'}</span>
                  </button>
                </div>

                <form onSubmit={submitProfileChange} className="grid gap-3 sm:grid-cols-2 text-xs">
                  <div>
                    <label className="block font-medium mb-1">Nama Legal Baru (Kosongkan jika tidak berubah)</label>
                    <input
                      maxLength={200}
                      value={companyLegalName}
                      onChange={e => setCompanyLegalName(e.target.value)}
                      placeholder="Masukkan nama legal baru"
                      className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>

                  <div className="flex flex-col justify-end">
                    <label className="flex items-center gap-2 p-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={changeNpwp}
                        onChange={e => setChangeNpwp(e.target.checked)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="font-medium text-slate-700 dark:text-slate-300">Ajukan Perubahan NPWP Perusahaan (16 Digit)</span>
                    </label>
                  </div>

                  {changeNpwp && (
                    <div className="sm:col-span-2">
                      <label className="block font-medium mb-1">Nomor NPWP 16 Digit Baru</label>
                      <input
                        required
                        inputMode="numeric"
                        maxLength={16}
                        value={profileNpwp}
                        onChange={e => setProfileNpwp(e.target.value.replace(/\D/g, '').slice(0, 16))}
                        placeholder="Contoh: 0024376584714000"
                        className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950 font-mono"
                      />
                    </div>
                  )}

                  <div className="sm:col-span-2">
                    <label className="block font-medium mb-1">Alasan Permohonan Perubahan (8–500 karakter) *</label>
                    <textarea
                      required
                      minLength={8}
                      maxLength={500}
                      rows={2}
                      value={profileReason}
                      onChange={e => setProfileReason(e.target.value)}
                      placeholder="Jelaskan alasan pembaruan data legalitas perusahaan…"
                      className="w-full rounded-lg border border-slate-300 bg-white p-2.5 dark:border-slate-700 dark:bg-slate-950"
                    />
                  </div>

                  <div className="sm:col-span-2">
                    <button
                      disabled={busy || !canAdmin || profileReason.trim().length < 8 || (!companyLegalName.trim() && !changeNpwp)}
                      className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors shadow-sm"
                    >
                      Kirim Permohonan Perubahan Profil
                    </button>
                  </div>
                </form>

                {/* Riwayat Permohonan */}
                {profileChanges.length ? (
                  <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800">
                    <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 mb-2">Riwayat Pengajuan Perubahan</h3>
                    <div className="space-y-2">
                      {profileChanges.map(change => (
                        <div key={change.id} className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 text-xs bg-slate-50/50 dark:bg-slate-800/30 flex flex-wrap justify-between gap-2">
                          <div>
                            <p className="font-semibold text-slate-900 dark:text-slate-100">
                              {change.proposed_legal_name || 'Perubahan NPWP'}
                              {change.change_npwp ? ` (NPWP akhiran: ${change.proposed_npwp_last4 || '••••'})` : ''}
                            </p>
                            <p className="text-slate-500 mt-0.5">{change.reason}</p>
                          </div>
                          <div className="text-right">
                            <span className={`px-2 py-0.5 text-[10px] font-bold rounded ${
                              change.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                              change.status === 'REJECTED' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300' :
                              'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}>
                              {change.status === 'PENDING' ? 'Menunggu Peninjauan' : change.status === 'APPROVED' ? 'Disetujui' : 'Ditolak'}
                            </span>
                            <p className="text-[10px] text-slate-400 mt-1">{new Date(change.created_at).toLocaleDateString('id-ID')}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          )}
        </>
      )}

      {/* Modal Potong & Manipulasi Logo Perusahaan (Crop 1:1) */}
      <AvatarCropperModal
        isOpen={isLogoModalOpen}
        onClose={() => setIsLogoModalOpen(false)}
        onSave={handleSaveCompanyLogo}
        currentAvatarUrl={activeCompany.logoUrl}
        title="Logo Resmi Perusahaan (Tenant)"
        subtitle="Pilih berkas logo resmi dari perangkat atau jepret langsung dari kamera. Pangkas dengan rasio 1:1."
        cropShape="rect"
      />

      {/* Modal Konfirmasi Cabut Jabatan Anggota Tim Proyek */}
      {revokeTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-100 text-rose-600 dark:bg-rose-950 dark:text-rose-400 shrink-0">
                <Trash2 className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Cabut Jabatan Anggota Tim
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Konfirmasi penonaktifan peran pada proyek.
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Anggota:</span>
                <span className="font-bold text-slate-900 dark:text-white">{revokeTarget.memberName}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Jabatan yang Dicabut:</span>
                <span className="font-bold text-rose-600 dark:text-rose-400 px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900">
                  {revokeTarget.roleDisplayName}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-500 dark:text-slate-400 font-medium">Proyek:</span>
                <span className="font-bold text-slate-900 dark:text-white">{revokeTarget.projectName}</span>
              </div>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              Apakah Anda yakin ingin mencabut jabatan ini? Anggota tidak akan lagi memiliki hak akses dan wewenang untuk peran ini pada proyek terkait.
            </p>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setRevokeTarget(null)}
                disabled={revokeLoading}
                className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmRevokeRole}
                disabled={revokeLoading}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 cursor-pointer shadow-sm"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>{revokeLoading ? 'Mencabut...' : 'Ya, Cabut Jabatan'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
