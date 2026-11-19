import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Building2, FolderKanban, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { getSupabaseClient, resolveMyActiveContext } from '../lib/supabase';
import { RfinBInvitationPanel } from './RfinBInvitationPanel';

type CompanyWorkspace = { id: string; name: string; company_id: string | null };
type ProjectRow = { id: string; workspace_id: string; project_code: string; name: string; description: string | null; status: string; created_at: string };
type ClientRow = { id: string; project_id: string; client_name: string; relationship_type: string; commercial_reference: string | null; notes: string | null };
type ProfileChangeRow={id:string;proposed_legal_name:string|null;change_npwp:boolean;proposed_npwp_last4:string|null;reason:string;status:string;created_at:string;review_notes:string|null};
type CompanyDashboard={company_name:string;company_status:string;memberships:{total:number;active:number;suspended:number;revoked:number};invitations:{active:number;expired:number;redeemed:number;revoked:number};projects:{total:number;active:number;completed:number;archived:number};approvals:{pending:number};documents:{total:number;by_status:Record<string,number>};access_alerts:{suspended_memberships:number;revoked_memberships:number;expired_invitations:number};last_activity_at:string|null;recent_activity:{action:string;entity_type:string;created_at:string}[]};
type CoveragePermission={permission_code:string;module:string;action:string;risk_level:string;requires_authority_check:boolean;description:string};
type CoverageMember={project_membership_id:string;company_membership_id:string;user_id:string;full_name:string;membership_status:string;permissions:CoveragePermission[]};
type CoverageProject={id:string;project_code:string;name:string;status:string;active_member_count:number;members_without_permissions:number;permission_code_count:number;members:CoverageMember[]};
type ProjectCoverage={active_company_members:number;active_projects:number;active_project_memberships:number;members_without_active_project:number;active_members_without_permissions:number;projects:CoverageProject[];unassigned_members:{company_membership_id:string;user_id:string;full_name:string;activated_at:string|null}[]};

type MemberAccessCatalogItem={code:string;name:string;description?:string;approved_permission_codes?:string[]};
type AuthorityCatalogItem={authority_code:string;permission_code:string;display_name:string;description:string;allowed_dimensions:string[]};
type MemberAccessAssignment={id:string;code:string;name:string;starts_at:string;ends_at:string|null;revoked_at:string|null;is_active:boolean;approved_permission_codes?:string[];project_id?:string;project_code?:string;project_name?:string;scope?:Record<string,unknown>;max_amount?:number|null;currency?:string|null};
type MemberAccessMember={company_membership_id:string;user_id:string;full_name:string;membership_status:string;personas:MemberAccessAssignment[];roles:MemberAccessAssignment[];authorities:MemberAccessAssignment[]};
type MemberAccessState={workspace_id:string;personas:MemberAccessCatalogItem[];roles:MemberAccessCatalogItem[];members:MemberAccessMember[]};


export const CompanyConsole: React.FC = () => {
  const db = getSupabaseClient();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [workspaces, setWorkspaces] = useState<CompanyWorkspace[]>([]);
  const [adminWorkspaceIds, setAdminWorkspaceIds] = useState<string[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [projectCode, setProjectCode] = useState('');
  const [projectName, setProjectName] = useState('');
  const [description, setDescription] = useState('');
  const [clientName, setClientName] = useState('');
  const [commercialReference, setCommercialReference] = useState('');
  const [currentCompanyLegalName,setCurrentCompanyLegalName]=useState('');
  const [companyLegalName,setCompanyLegalName]=useState('');
  const [profileNpwp,setProfileNpwp]=useState('');
  const [changeNpwp,setChangeNpwp]=useState(false);
  const [profileReason,setProfileReason]=useState('');
  const [profileChanges,setProfileChanges]=useState<ProfileChangeRow[]>([]);
  const [dashboard,setDashboard]=useState<CompanyDashboard|null>(null);
  const [dashboardLoading,setDashboardLoading]=useState(false);
  const [dashboardError,setDashboardError]=useState('');
  const [projectCoverage,setProjectCoverage]=useState<ProjectCoverage|null>(null);
  const [coverageLoading,setCoverageLoading]=useState(false);
  const [coverageError,setCoverageError]=useState('');
  const [assignmentTargets,setAssignmentTargets]=useState<Record<string,string>>({});
  const [assigningMember,setAssigningMember]=useState('');
  const [memberAccess,setMemberAccess]=useState<MemberAccessState|null>(null);
  const [authorityCatalog,setAuthorityCatalog]=useState<AuthorityCatalogItem[]>([]);
  const [memberAccessLoading,setMemberAccessLoading]=useState(false);
  const [memberAccessError,setMemberAccessError]=useState('');
  const [memberAccessDrafts,setMemberAccessDrafts]=useState<Record<string,{persona:string;role:string;authorityCode:string;authorityProjectId:string;authorityScope:string;authorityMaxAmount:string;authorityCurrency:string;endsAt:string;reason:string}>>({});
  const [memberAccessBusy,setMemberAccessBusy]=useState('');

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
      console.warn('Gagal memuat relasi client:', clientError);
      setClients([]);
    } else {
      setClients((clientData || []) as ClientRow[]);
    }
    return rows;
  }, [db]);

  const loadDashboard=useCallback(async(targetWorkspaceId:string)=>{
    if(!targetWorkspaceId){setDashboard(null);setDashboardError('');return;}
    setDashboardLoading(true);setDashboardError('');
    try{const {data,error}=await db.rpc('get_company_console_dashboard',{p_workspace_id:targetWorkspaceId});if(error)throw error;setDashboard(data as CompanyDashboard);}
    catch(e:any){setDashboard(null);setDashboardError(e?.message||'Ringkasan Company Dashboard gagal dimuat.');}
    finally{setDashboardLoading(false);}
  },[db]);

  const loadProjectCoverage=useCallback(async(targetWorkspaceId:string)=>{
    if(!targetWorkspaceId){setProjectCoverage(null);setCoverageError('');return;}
    setCoverageLoading(true);setCoverageError('');
    try{const {data,error}=await db.rpc('get_company_project_assignment_coverage',{p_workspace_id:targetWorkspaceId});if(error)throw error;setProjectCoverage(data as ProjectCoverage);}
    catch(e:any){setProjectCoverage(null);setCoverageError(e?.message||'Ringkasan Project Assignment & Coverage gagal dimuat.');}
    finally{setCoverageLoading(false);}
  },[db]);


  const loadMemberAccess=useCallback(async(targetWorkspaceId:string)=>{
    if(!targetWorkspaceId){setMemberAccess(null);setMemberAccessError('');return;}
    setMemberAccessLoading(true);setMemberAccessError('');
    try{const [accessResult,catalogResult]=await Promise.all([db.rpc('get_company_member_access_assignments',{p_workspace_id:targetWorkspaceId}),db.from('authority_catalog').select('authority_code,permission_code,display_name,description,allowed_dimensions').eq('active',true).order('display_name')]);if(accessResult.error)throw accessResult.error;if(catalogResult.error)throw catalogResult.error;setMemberAccess(accessResult.data as MemberAccessState);setAuthorityCatalog((catalogResult.data||[]) as AuthorityCatalogItem[]);}
    catch(e:any){setMemberAccess(null);setAuthorityCatalog([]);setMemberAccessError(e?.message||'Daftar persona, role, dan Authority anggota gagal dimuat.');}
    finally{setMemberAccessLoading(false);}
  },[db]);

  const assignMemberAccess=async(memberId:string,type:'PERSONA'|'ROLE'|'AUTHORITY')=>{
    const draft=memberAccessDrafts[memberId];const code=type==='PERSONA'?draft?.persona:type==='ROLE'?draft?.role:draft?.authorityCode;
    if(!canAdmin||!draft||!code||draft.reason.trim().length<8||memberAccessBusy)return;
    let authorityScope:Record<string,unknown>={};
    if(type==='AUTHORITY'){
      if(!draft.authorityProjectId){setError('Pilih Project tempat anggota memiliki Project Membership aktif.');return;}
      try{const parsed=JSON.parse(draft.authorityScope||'{}');if(!parsed||Array.isArray(parsed)||typeof parsed!=='object'){setError('Scope Authority harus berupa objek JSON.');return;}authorityScope=parsed;}
      catch{setError('Scope Authority harus berupa JSON objek yang valid.');return;}
      if(Boolean(draft.authorityMaxAmount.trim())!==Boolean(draft.authorityCurrency.trim())){setError('Nominal maksimum dan mata uang harus diisi bersamaan.');return;}
      if(draft.authorityMaxAmount.trim()&&(!Number.isFinite(Number(draft.authorityMaxAmount))||Number(draft.authorityMaxAmount)<0||!/^[A-Z]{3}$/.test(draft.authorityCurrency.trim()))){setError('Nominal harus >= 0 dan mata uang menggunakan kode ISO 4217 tiga huruf kapital.');return;}
    }
    const busyKey=memberId+':'+type;setMemberAccessBusy(busyKey);setError('');setNotice('');
    try{
      const {data,error}=await db.rpc('assign_company_member_access',{
        p_workspace_id:workspaceId,p_company_membership_id:memberId,p_assignment_type:type,p_code:code,
        p_ends_at:draft.endsAt?new Date(draft.endsAt).toISOString():null,p_reason:draft.reason.trim(),
        p_project_id:type==='AUTHORITY'?draft.authorityProjectId:null,p_scope:type==='AUTHORITY'?authorityScope:{},
        p_max_amount:type==='AUTHORITY'&&draft.authorityMaxAmount.trim()?Number(draft.authorityMaxAmount):null,
        p_currency:type==='AUTHORITY'&&draft.authorityCurrency.trim()?draft.authorityCurrency.trim():null
      });
      if(error)throw error;
      setNotice((type==='PERSONA'?'Persona':type==='ROLE'?'Role':'Authority')+' berhasil ditetapkan. Penetapan ini tidak membuat Project Membership atau permission baru. Referensi '+String(data).slice(0,8).toUpperCase()+'.');
      setMemberAccessDrafts(current=>({...current,[memberId]:{...current[memberId],persona:type==='PERSONA'?'':current[memberId]?.persona||'',role:type==='ROLE'?'':current[memberId]?.role||'',authorityCode:type==='AUTHORITY'?'':current[memberId]?.authorityCode||'',authorityProjectId:type==='AUTHORITY'?'':current[memberId]?.authorityProjectId||'',authorityScope:type==='AUTHORITY'?'{}':current[memberId]?.authorityScope||'{}',authorityMaxAmount:type==='AUTHORITY'?'':current[memberId]?.authorityMaxAmount||'',authorityCurrency:type==='AUTHORITY'?'':current[memberId]?.authorityCurrency||'',reason:''}}));
      await loadMemberAccess(workspaceId);
    }catch(e:any){setError(e?.message||'Penetapan akses anggota gagal.');}
    finally{setMemberAccessBusy('');}
  };

  const revokeMemberAccess=async(type:'PERSONA'|'ROLE'|'AUTHORITY',assignmentId:string)=>{
    if(!canAdmin||memberAccessBusy)return;
    const reason=window.prompt('Alasan pencabutan akses (8–500 karakter):')||'';
    if(reason.trim().length<8||reason.trim().length>500){setError('Alasan pencabutan wajib 8–500 karakter.');return;}
    setMemberAccessBusy(assignmentId);setError('');setNotice('');
    try{const {error}=await db.rpc('revoke_company_member_access',{p_workspace_id:workspaceId,p_assignment_type:type,p_assignment_id:assignmentId,p_reason:reason.trim()});if(error)throw error;
      setNotice('Penugasan '+type+' berhasil dicabut. Riwayat tetap dipertahankan.');await loadMemberAccess(workspaceId);
    }catch(e:any){setError(e?.message||'Pencabutan akses gagal.');}
    finally{setMemberAccessBusy('');}
  };

  const assignMemberToProject=async(companyMembershipId:string,targetProjectId:string)=>{
    if(!canAdmin||!companyMembershipId||!targetProjectId||assigningMember)return;
    setAssigningMember(companyMembershipId);setError('');setNotice('');
    try{const {data,error}=await db.rpc('assign_company_member_to_project',{p_project_id:targetProjectId,p_company_membership_id:companyMembershipId});if(error)throw error;
      setNotice('Penugasan Project berhasil dibuat. Tidak ada permission operasional yang diberikan otomatis. Referensi '+String(data).slice(0,8).toUpperCase()+'.');
      setAssignmentTargets(current=>({...current,[companyMembershipId]:''}));
      await loadProjectCoverage(workspaceId);await loadDashboard(workspaceId);
    }catch(e:any){setError(e?.message||'Penugasan anggota ke Project gagal.');}
    finally{setAssigningMember('');}
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
      // This read only controls the UI. Every project RPC and row read is independently
      // enforced by database authorization and RLS.
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
      await loadProjects(preferred);
      await loadDashboard(preferred);
      await loadProjectCoverage(preferred);
      await loadMemberAccess(preferred);
      const selectedWorkspace=companyWorkspaces.find(w=>w.id===preferred);
      if(selectedWorkspace?.company_id){
        const [profileResult,changeResult]=await Promise.all([
          db.from('companies').select('legal_name').eq('id',selectedWorkspace.company_id).maybeSingle(),
          db.from('company_profile_change_requests').select('id,proposed_legal_name,change_npwp,proposed_npwp_last4,reason,status,created_at,review_notes').eq('company_id',selectedWorkspace.company_id).order('created_at',{ascending:false}).limit(20)
        ]);
        if(profileResult.error)throw profileResult.error;if(changeResult.error)throw changeResult.error;
        setCurrentCompanyLegalName(profileResult.data?.legal_name||'');setProfileChanges(changeResult.data||[]);
      }else{setCurrentCompanyLegalName('');setProfileChanges([]);}

    } catch (e: any) {
      setError(e?.message || 'Gagal memuat Company Console.');
    } finally { setLoading(false); }
  }, [db, loadProjects, loadDashboard, loadProjectCoverage, loadMemberAccess, workspaceId]);

  useEffect(() => { void refresh(); }, []);

  const changeWorkspace = async (id: string) => {
    setWorkspaceId(id); setError(''); setNotice('');
    try {
      await loadProjects(id);
      await loadDashboard(id);
      await loadProjectCoverage(id);
      await loadMemberAccess(id);
      const selectedWorkspace=workspaces.find(w=>w.id===id);
      if(selectedWorkspace?.company_id){
        const [profileResult,changeResult]=await Promise.all([
          db.from('companies').select('legal_name').eq('id',selectedWorkspace.company_id).maybeSingle(),
          db.from('company_profile_change_requests').select('id,proposed_legal_name,change_npwp,proposed_npwp_last4,reason,status,created_at,review_notes').eq('company_id',selectedWorkspace.company_id).order('created_at',{ascending:false}).limit(20)
        ]);
        if(profileResult.error)throw profileResult.error;if(changeResult.error)throw changeResult.error;
        setCurrentCompanyLegalName(profileResult.data?.legal_name||'');setProfileChanges(changeResult.data||[]);
      }else{setCurrentCompanyLegalName('');setProfileChanges([]);}
    } catch (e: any) { setError(e?.message || 'Gagal memuat Company Profile dan daftar Project.'); }
  };

  const createProject = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!adminWorkspaceIds.includes(workspaceId)) { setError('Akses Company Super Admin tidak terverifikasi untuk workspace ini.'); return; }
    const code = projectCode.trim().toUpperCase();
    const name = projectName.trim();
    const client = clientName.trim();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(code)) { setError('Kode Project harus 2–40 karakter: huruf kapital, angka, garis bawah, atau tanda hubung.'); return; }
    if (name.length < 2 || name.length > 160) { setError('Nama Project harus 2–160 karakter.'); return; }
    if (client.length < 2 || client.length > 200) { setError('Nama client harus 2–200 karakter.'); return; }
    if (projects.some(p => p.project_code.toUpperCase() === code)) { setError('Kode Project sudah digunakan pada Company Workspace ini.'); return; }
    setBusy(true); setError(''); setNotice('Membuat Project dan relasi client secara atomik…');
    try {
      const { data, error: rpcError } = await db.rpc('create_company_project_with_client', {
        p_workspace_id: workspaceId,
        p_project_code: code,
        p_name: name,
        p_description: description.trim() || null,
        p_client_name: client,
        p_relationship_type: 'CLIENT',
        p_commercial_reference: commercialReference.trim() || null,
        p_notes: null
      });
      if (rpcError) throw rpcError;
      await loadProjects(workspaceId);
      setProjectCode(''); setProjectName(''); setDescription(''); setClientName(''); setCommercialReference('');
      setNotice('Project berhasil dibuat. Company Super Admin tercatat sebagai anggota Project; permission operasional tetap harus diberikan secara eksplisit.');
    } catch (e: any) {
      // A network timeout can occur after the database transaction committed.
      // Reconcile by the tenant-scoped unique project code before allowing retry.
      try {
        const refreshedProjects = await loadProjects(workspaceId);
        const existing = refreshedProjects.find(p => p.project_code.toUpperCase() === code);
        if (existing) {
          setNotice('Project dengan kode tersebut sudah tercatat. Daftar telah disinkronkan; jangan mengirim ulang.');
        } else {
          setError(e?.message || 'Project belum dapat dibuat. Periksa daftar sebelum mencoba kembali.');
          setNotice('');
        }
      } catch {
        setError((e?.message || 'Hasil transaksi belum dapat dipastikan.') + ' Periksa koneksi dan muat ulang daftar sebelum mencoba kembali.');
        setNotice('');
      }
    } finally { setBusy(false); }
  };

  const submitProfileChange=async(event:React.FormEvent)=>{
    event.preventDefault();if(busy||!activeWorkspace?.company_id||!canAdmin)return;
    const name=companyLegalName.trim(),reasonText=profileReason.trim();
    if(!name&&!changeNpwp){setError('Isi perubahan nama legal atau aktifkan perubahan NPWP.');return;}
    if(name&&(name.length<2||name.length>200)){setError('Nama legal harus 2–200 karakter.');return;}
    if(changeNpwp&&!profileNpwp.trim()){setError('NPWP baru wajib diisi.');return;}
    if(reasonText.length<8||reasonText.length>500){setError('Alasan perubahan wajib 8–500 karakter.');return;}
    setBusy(true);setError('');setNotice('');
    try{const {data,error}=await db.rpc('request_company_profile_change',{p_company_id:activeWorkspace.company_id,p_legal_name:name||null,p_npwp:changeNpwp?profileNpwp:null,p_change_npwp:changeNpwp,p_reason:reasonText});if(error)throw error;
      setCompanyLegalName('');setProfileNpwp('');setChangeNpwp(false);setProfileReason('');
      setNotice('Permohonan perubahan profil perusahaan dikirim untuk keputusan Platform Super Admin. Referensi '+String(data).slice(0,8).toUpperCase()+'.');
      await refresh();
    }catch(e:any){setError(e?.message||'Permohonan perubahan profil gagal dikirim.');}
    finally{setBusy(false);}
  };
  const activeWorkspace = workspaces.find(w => w.id === workspaceId);
  const canAdmin = Boolean(activeWorkspace && adminWorkspaceIds.includes(workspaceId));

  return <div className="min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
        <div className="flex items-center gap-3"><div className="rounded-xl bg-blue-100 p-2 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><Building2 className="h-5 w-5"/></div><div><p className="text-[10px] font-semibold tracking-[.2em] text-blue-600 dark:text-blue-300">PROYEK CAIR · COMPANY</p><h1 className="text-xl font-bold">Company Console</h1><p className="text-xs text-slate-500">Tata kelola tenant dan Project Registry</p></div></div>
        <div className="flex items-center gap-2"><button onClick={() => void refresh()} disabled={loading || busy} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`}/>Perbarui</button><a href="/" className="hidden items-center gap-1 text-xs text-slate-500 hover:text-blue-600 sm:inline-flex"><ArrowLeft className="h-4 w-4"/>Workspace Center</a></div>
      </div>
    </header>
    <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
      {error && <div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
      {notice && <div role="status" aria-live="polite" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div>}
      {loading ? <div className="grid min-h-56 place-items-center text-sm text-slate-500"><RefreshCw className="mr-2 inline h-4 w-4 animate-spin"/>Memverifikasi membership Company…</div>
      : !workspaces.length ? <section className="rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900"><ShieldAlert className="mx-auto h-8 w-8 text-slate-400"/><h2 className="mt-3 font-semibold">Company Workspace belum tersedia</h2><p className="mt-2 text-sm text-slate-500">Akun ini belum memiliki Company Workspace aktif. Gunakan Workspace Center untuk proses onboarding resmi.</p><a href="/" className="mt-4 inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Buka Workspace Center</a></section>
      : !canAdmin ? <section className="rounded-2xl border border-amber-300 bg-amber-50 p-8 text-center dark:border-amber-900 dark:bg-amber-950/20"><ShieldAlert className="mx-auto h-8 w-8 text-amber-600"/><h2 className="mt-3 font-semibold">Akses Company Super Admin diperlukan</h2><p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Company Console hanya tersedia bagi pemegang kursi Company Super Admin aktif. Keanggotaan biasa tidak memberikan hak pengelolaan tenant.</p></section>
      : <><section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold tracking-widest text-blue-600 dark:text-blue-300">TENANT AKTIF</p><h2 className="mt-1 text-lg font-bold">{activeWorkspace?.name}</h2><p className="mt-1 text-xs text-slate-500">Company Super Admin terverifikasi melalui membership aktif.</p></div><span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300"><ShieldCheck className="h-4 w-4"/>Server-side authorization</span></div>{workspaces.length > 1 && <label className="mt-4 block max-w-lg text-xs font-medium">Pilih Company Workspace<select value={workspaceId} onChange={e => void changeWorkspace(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">{workspaces.filter(w => adminWorkspaceIds.includes(w.id)).map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>}</section>
      <section aria-labelledby="company-dashboard-title" className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="company-dashboard-title" className="font-semibold">Company Dashboard</h2><p className="mt-1 text-xs text-slate-500">Ringkasan live tenant dari database. Semua angka dibatasi pada Company Workspace aktif.</p></div><span className="text-xs text-slate-500">{dashboard?.company_status||'Status belum tersedia'}</span></div>
        {dashboardLoading?<p role="status" className="mt-4 text-sm text-slate-500">Memuat ringkasan tenant…</p>:dashboardError?<div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200">{dashboardError}<button type="button" onClick={()=>void loadDashboard(workspaceId)} className="ml-2 font-semibold underline">Coba lagi</button></div>:dashboard?<>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">{[
            ['Anggota aktif',dashboard.memberships.active],['Total anggota',dashboard.memberships.total],['Undangan aktif',dashboard.invitations.active],['Project aktif',dashboard.projects.active],['Persetujuan berjalan',dashboard.approvals.pending],['Dokumen',dashboard.documents.total]
          ].map(([label,value])=><div key={String(label)} className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-[11px] text-slate-500">{label}</p><p className="mt-1 text-2xl font-bold tabular-nums">{Number(value).toLocaleString('id-ID')}</p></div>)}</div>
          <div className="mt-4 grid gap-4 md:grid-cols-2"><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><h3 className="text-xs font-semibold">Status keanggotaan & akses</h3><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><p>Ditangguhkan <b className="float-right">{dashboard.memberships.suspended}</b></p><p>Dicabut <b className="float-right">{dashboard.memberships.revoked}</b></p><p>Undangan kedaluwarsa <b className="float-right">{dashboard.invitations.expired}</b></p><p>Undangan ditebus <b className="float-right">{dashboard.invitations.redeemed}</b></p></div><p className="mt-3 text-[11px] text-slate-500">Peringatan akses: {dashboard.access_alerts.suspended_memberships+dashboard.access_alerts.revoked_memberships+dashboard.access_alerts.expired_invitations} kondisi perlu ditinjau.</p></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60"><h3 className="text-xs font-semibold">Project & dokumen</h3><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><p>Semua Project <b className="float-right">{dashboard.projects.total}</b></p><p>Selesai <b className="float-right">{dashboard.projects.completed}</b></p><p>Diarsipkan <b className="float-right">{dashboard.projects.archived}</b></p><p>Semua dokumen <b className="float-right">{dashboard.documents.total}</b></p></div><div className="mt-2 flex flex-wrap gap-1">{Object.entries(dashboard.documents.by_status).map(([status,count])=><span key={status} className="rounded-md border border-slate-200 px-2 py-1 text-[10px] dark:border-slate-700">{status}: {count}</span>)}</div></div></div>
          <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800"><div className="flex flex-wrap justify-between gap-2"><h3 className="text-xs font-semibold">Aktivitas administrasi terbaru</h3><span className="text-[10px] text-slate-500">Terakhir: {dashboard.last_activity_at?new Date(dashboard.last_activity_at).toLocaleString('id-ID'):'Belum ada aktivitas'}</span></div>{dashboard.recent_activity.length?<ul className="mt-2 space-y-1">{dashboard.recent_activity.map((item,index)=><li key={item.created_at+'-'+index} className="flex flex-wrap justify-between gap-2 text-[11px]"><span>{item.action} · {item.entity_type}</span><time className="text-slate-500">{new Date(item.created_at).toLocaleString('id-ID')}</time></li>)}</ul>:<p className="mt-2 text-xs text-slate-500">Belum ada aktivitas tenant yang tercatat.</p>}</div>
        </>:<p className="mt-4 text-xs text-slate-500">Ringkasan belum tersedia.</p>}
      </section>
      <section aria-labelledby="project-coverage-title" className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="project-coverage-title" className="font-semibold">Project Assignment & Coverage</h2><p className="mt-1 text-xs text-slate-500">Penugasan anggota dan permission aktual per Project. Tidak ada role bundle atau permission yang diasumsikan.</p></div><button type="button" onClick={()=>void loadProjectCoverage(workspaceId)} disabled={coverageLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:hover:bg-slate-800">{coverageLoading?'Memuat…':'Perbarui coverage'}</button></div>
        {coverageLoading?<p role="status" className="mt-4 text-sm text-slate-500">Memuat penugasan Project…</p>:coverageError?<div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200">{coverageError}<button type="button" onClick={()=>void loadProjectCoverage(workspaceId)} className="ml-2 font-semibold underline">Coba lagi</button></div>:projectCoverage?<>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-[11px] text-slate-500">Anggota aktif tenant</p><p className="mt-1 text-2xl font-bold tabular-nums">{projectCoverage.active_company_members}</p></div><div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-[11px] text-slate-500">Project aktif</p><p className="mt-1 text-2xl font-bold tabular-nums">{projectCoverage.active_projects}</p></div><div className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"><p className="text-[11px] text-slate-500">Penugasan Project aktif</p><p className="mt-1 text-2xl font-bold tabular-nums">{projectCoverage.active_project_memberships}</p></div><div className="rounded-xl border border-amber-200 p-3 dark:border-amber-900"><p className="text-[11px] text-slate-500">Belum ditugaskan ke Project aktif</p><p className="mt-1 text-2xl font-bold tabular-nums">{projectCoverage.members_without_active_project}</p></div></div>
          <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-800/60">Anggota Project aktif tanpa permission operasional: <b>{projectCoverage.active_members_without_permissions}</b>. Keanggotaan Project dan permission operasional adalah dua hal berbeda.</div>
          <div className="mt-4 space-y-3">{projectCoverage.projects.map(project=><article key={project.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-mono text-[11px] text-blue-600 dark:text-blue-300">{project.project_code}</p><h3 className="mt-1 text-sm font-semibold">{project.name}</h3><p className="mt-1 text-[11px] text-slate-500">{project.status} · {project.active_member_count} anggota aktif · {project.permission_code_count} kode permission terpakai</p></div><span className="rounded-lg bg-amber-50 px-2 py-1 text-[10px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">{project.members_without_permissions} anggota tanpa permission</span></div>
            {project.members.length?<div className="mt-3 space-y-2">{project.members.map(member=><div key={member.project_membership_id} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800/50"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-semibold">{member.full_name}</p><p className="text-[10px] text-slate-500">Membership aktif · {member.permissions.length} permission eksplisit</p></div><span className="text-[10px] text-slate-400">{member.user_id.slice(0,8)}…</span></div>{member.permissions.length?<div className="mt-2 flex flex-wrap gap-1">{member.permissions.map(permission=><span key={permission.permission_code} title={permission.description} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] dark:border-slate-700 dark:bg-slate-900">{permission.permission_code} · {permission.risk_level}{permission.requires_authority_check?' · authority':''}</span>)}</div>:<p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">Belum ada permission operasional eksplisit.</p>}</div>)}</div>:<p className="mt-3 rounded-lg border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">Belum ada anggota yang ditugaskan ke Project ini.</p>}
          </article>)}{!projectCoverage.projects.length&&<p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 dark:border-slate-700">Belum ada Project pada Company Workspace ini.</p>}</div>
          <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800"><h3 className="text-sm font-semibold">Anggota belum memiliki penugasan operasional</h3><p className="mt-1 text-[11px] text-slate-500">Daftar ini berisi Company Membership aktif yang belum memiliki Project Membership aktif pada Project aktif mana pun.</p>{projectCoverage.unassigned_members.length?<ul className="mt-3 space-y-2">{projectCoverage.unassigned_members.map(member=><li key={member.company_membership_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800"><div><p className="font-medium">{member.full_name}</p><p className="mt-1 text-[10px] text-slate-500">Aktif sejak {member.activated_at?new Date(member.activated_at).toLocaleDateString('id-ID'):'tanggal tidak tersedia'}</p></div><div className="flex flex-wrap items-center gap-2"><select aria-label={'Project tujuan untuk '+member.full_name} value={assignmentTargets[member.company_membership_id]||''} onChange={e=>setAssignmentTargets(current=>({...current,[member.company_membership_id]:e.target.value}))} disabled={assigningMember===member.company_membership_id||!projectCoverage.projects.some(p=>p.status==='ACTIVE')} className="max-w-56 rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="">Pilih Project aktif</option>{projectCoverage.projects.filter(p=>p.status==='ACTIVE').map(p=><option key={p.id} value={p.id}>{p.project_code} · {p.name}</option>)}</select><button type="button" onClick={()=>void assignMemberToProject(member.company_membership_id,assignmentTargets[member.company_membership_id]||'')} disabled={!canAdmin||!assignmentTargets[member.company_membership_id]||Boolean(assigningMember)||!projectCoverage.projects.some(p=>p.status==='ACTIVE')} className="rounded-lg bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-40">{assigningMember===member.company_membership_id?'Menugaskan…':'Tugaskan tanpa permission'}</button></div></li>)}</ul>:<p className="mt-2 text-xs text-slate-500">Semua anggota aktif sudah memiliki penugasan pada Project aktif, atau belum ada anggota yang perlu ditugaskan.</p>}</div>
        </>:<p className="mt-4 text-xs text-slate-500">Coverage belum tersedia.</p>}
      </section>
      <section aria-labelledby="member-access-title" className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 id="member-access-title" className="font-semibold">Company Member Access Assignment</h2><p className="mt-1 text-xs text-slate-500">Penetapan Persona, Role, Authority, masa berlaku, dan pencabutan dengan histori audit.</p></div><button type="button" onClick={()=>void loadMemberAccess(workspaceId)} disabled={memberAccessLoading} className="rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700">{memberAccessLoading?'Memuat…':'Perbarui akses anggota'}</button></div>
        <p className="mt-3 rounded-lg bg-blue-50 p-3 text-xs text-blue-900 dark:bg-blue-950/30 dark:text-blue-200">Role tidak otomatis memberikan hak. Permission turunan hanya berasal dari Role–Permission mapping yang aktif dan disahkan Platform Super Admin. Efektivitas pada Project tetap memerlukan Project Membership aktif, Persona aktif yang sesuai, katalog permission aktif, dan Authority bila diwajibkan.</p>
        {memberAccessLoading?<p role="status" className="mt-4 text-sm text-slate-500">Memuat konfigurasi akses anggota…</p>:memberAccessError?<div role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/20 dark:text-rose-200">{memberAccessError}<button type="button" onClick={()=>void loadMemberAccess(workspaceId)} className="ml-2 font-semibold underline">Coba lagi</button></div>:memberAccess?<div className="mt-4 space-y-3">
          {memberAccess.members.length?memberAccess.members.map(member=>{const draft=memberAccessDrafts[member.company_membership_id]||{persona:'',role:'',authorityCode:'',authorityProjectId:'',authorityScope:'{}',authorityMaxAmount:'',authorityCurrency:'',endsAt:'',reason:''};return <article key={member.company_membership_id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-semibold">{member.full_name}</h3><p className="text-[10px] text-slate-500">{member.membership_status} · {member.user_id.slice(0,8)}…</p></div><span className="text-[10px] text-slate-500">{member.personas.filter(x=>x.is_active).length} Persona aktif · {member.roles.filter(x=>x.is_active).length} Role aktif</span></div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div><h4 className="text-xs font-semibold">Persona</h4>{member.personas.length?<div className="mt-2 space-y-1">{member.personas.map(a=><div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"><span>{a.name} · {a.is_active?'Aktif':a.revoked_at?'Dicabut':'Kedaluwarsa'}{a.ends_at?' · s.d. '+new Date(a.ends_at).toLocaleDateString('id-ID'):''}</span>{!a.revoked_at&&<button type="button" disabled={Boolean(memberAccessBusy)} onClick={()=>void revokeMemberAccess('PERSONA',a.id)} className="text-rose-700 underline disabled:opacity-40 dark:text-rose-300">Cabut</button>}</div>)}</div>:<p className="mt-1 text-[11px] text-slate-500">Belum ada Persona.</p>}</div>
              <div><h4 className="text-xs font-semibold">Role & permission mapping disahkan</h4>{member.roles.length?<div className="mt-2 space-y-1">{member.roles.map(a=><div key={a.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"><div className="flex flex-wrap justify-between gap-2"><span>{a.name} · {a.is_active?'Aktif':a.revoked_at?'Dicabut':'Kedaluwarsa'}</span>{!a.revoked_at&&<button type="button" disabled={Boolean(memberAccessBusy)} onClick={()=>void revokeMemberAccess('ROLE',a.id)} className="text-rose-700 underline disabled:opacity-40 dark:text-rose-300">Cabut</button>}</div><p className="mt-1 text-[10px] text-slate-500">{a.approved_permission_codes?.length?('Mapping disahkan: '+a.approved_permission_codes.join(', ')):'Belum ada Role–Permission mapping aktif yang disahkan.'}</p>{a.ends_at&&<p className="text-[10px] text-slate-500">Berlaku sampai {new Date(a.ends_at).toLocaleString('id-ID')}</p>}</div>)}</div>:<p className="mt-1 text-[11px] text-slate-500">Belum ada Role.</p>}</div>
            </div>
            {member.authorities.length>0&&<div className="mt-3"><h4 className="text-xs font-semibold">Authority per Project</h4><div className="mt-2 space-y-1">{member.authorities.map(a=><div key={a.id} className="flex flex-wrap justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs dark:bg-slate-800/60"><span>{a.name} · {a.project_code} · {a.is_active?'Aktif':a.revoked_at?'Dicabut':'Kedaluwarsa'}{a.max_amount!=null?' · '+a.currency+' '+Number(a.max_amount).toLocaleString('id-ID'):''}</span>{!a.revoked_at&&<button type="button" disabled={Boolean(memberAccessBusy)} onClick={()=>void revokeMemberAccess('AUTHORITY',a.id)} className="text-rose-700 underline disabled:opacity-40 dark:text-rose-300">Cabut</button>}</div>)}</div></div>}
            {member.membership_status==='ACTIVE'&&<div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800"><h4 className="text-xs font-semibold">Tetapkan akses baru</h4><div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="text-[11px]">Persona<select value={draft.persona} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,persona:e.target.value}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="">Pilih Persona</option>{memberAccess.personas.map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
              <label className="text-[11px]">Role<select value={draft.role} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,role:e.target.value}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="">Pilih Role</option>{memberAccess.roles.map(x=><option key={x.code} value={x.code}>{x.name}</option>)}</select></label>
              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:col-span-2"><h5 className="text-[11px] font-semibold">Authority per Project</h5><p className="mt-1 text-[10px] text-slate-500">Authority hanya dapat diberikan pada Project tempat anggota sudah memiliki Project Membership aktif. Authority tidak membuat permission atau membership.</p>{draft.authorityCode&&<p className="mt-2 rounded bg-amber-50 p-2 text-[10px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">Pratinjau katalog: membatasi kewenangan untuk permission <b>{authorityCatalog.find(x=>x.authority_code===draft.authorityCode)?.permission_code||draft.authorityCode}</b>. Ini bukan pemberian permission; grant tetap harus berasal dari assignment yang sah dan mapping Role–Permission yang disetujui Platform.</p>}<div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-[11px]">Katalog Authority<select value={draft.authorityCode} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,authorityCode:e.target.value}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="">Pilih Authority</option>{authorityCatalog.map(x=><option key={x.authority_code} value={x.authority_code}>{x.display_name}</option>)}</select></label><label className="text-[11px]">Project anggota<select value={draft.authorityProjectId} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,authorityProjectId:e.target.value}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"><option value="">Pilih Project Membership aktif</option>{(projectCoverage?.projects||[]).filter(p=>p.status==='ACTIVE'&&p.members.some(m=>m.company_membership_id===member.company_membership_id)).map(p=><option key={p.id} value={p.id}>{p.project_code} · {p.name}</option>)}</select></label><label className="text-[11px]">Nominal maksimum (opsional)<input type="number" min="0" step="0.01" value={draft.authorityMaxAmount} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,authorityMaxAmount:e.target.value}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"/></label><label className="text-[11px]">Mata uang ISO 4217 (opsional)<input maxLength={3} placeholder="IDR" value={draft.authorityCurrency} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,authorityCurrency:e.target.value.toUpperCase()}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs uppercase dark:border-slate-700 dark:bg-slate-950"/></label><label className="text-[11px] sm:col-span-2">Scope Authority (JSON object)<textarea rows={2} value={draft.authorityScope} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,authorityScope:e.target.value}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-950"/><span className="text-[10px] text-slate-500">Dimensi yang diizinkan katalog: {authorityCatalog.find(x=>x.authority_code===draft.authorityCode)?.allowed_dimensions.join(', ')||'pilih Authority terlebih dahulu'}</span></label></div><button type="button" onClick={()=>void assignMemberAccess(member.company_membership_id,'AUTHORITY')} disabled={!canAdmin||!draft.authorityCode||!draft.authorityProjectId||!draft.reason.trim()||draft.reason.trim().length<8||Boolean(memberAccessBusy)} className="mt-2 rounded-lg border border-amber-600 px-3 py-2 text-xs font-semibold text-amber-800 disabled:opacity-40 dark:text-amber-300">{memberAccessBusy===member.company_membership_id+':AUTHORITY'?'Menyimpan…':'Tetapkan Authority'}</button></div>
              <label className="text-[11px]">Masa berlaku sampai (opsional)<input type="datetime-local" value={draft.endsAt} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,endsAt:e.target.value}}))} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"/></label>
              <label className="text-[11px] sm:col-span-2">Alasan penugasan (wajib, 8–500 karakter)<input value={draft.reason} onChange={e=>setMemberAccessDrafts(v=>({...v,[member.company_membership_id]:{...draft,reason:e.target.value}}))} maxLength={500} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-slate-700 dark:bg-slate-950"/></label>
            </div><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={()=>void assignMemberAccess(member.company_membership_id,'PERSONA')} disabled={!canAdmin||!draft.persona||draft.reason.trim().length<8||Boolean(memberAccessBusy)} className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{memberAccessBusy===member.company_membership_id+':PERSONA'?'Menyimpan…':'Tetapkan Persona'}</button><button type="button" onClick={()=>void assignMemberAccess(member.company_membership_id,'ROLE')} disabled={!canAdmin||!draft.role||draft.reason.trim().length<8||Boolean(memberAccessBusy)} className="rounded-lg border border-blue-600 px-3 py-2 text-xs font-semibold text-blue-700 disabled:opacity-40 dark:text-blue-300">{memberAccessBusy===member.company_membership_id+':ROLE'?'Menyimpan…':'Tetapkan Role'}</button></div></div>}
          </article>}) : <p className="rounded-lg border border-dashed border-slate-300 p-5 text-center text-xs text-slate-500 dark:border-slate-700">Belum ada Company Member selain Company Super Admin.</p>}
        </div>:<p className="mt-4 text-xs text-slate-500">Data assignment belum tersedia.</p>}
      </section>
      <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><h2 className="font-semibold">Profil perusahaan & perubahan identitas</h2><p className="mt-1 text-xs text-slate-500">Nama legal saat ini: <b>{currentCompanyLegalName||"—"}</b>. Perubahan nama legal atau NPWP tidak langsung mengubah identitas tenant. Semua perubahan menunggu keputusan Platform Super Admin. NPWP hanya diproses server-side dan tidak ditampilkan kembali.</p><form onSubmit={submitProfileChange} className="mt-4 grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Nama legal baru <span className="font-normal text-slate-500">(kosongkan jika tidak berubah)</span><input maxLength={200} value={companyLegalName} onChange={e=>setCompanyLegalName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label><label className="flex items-center gap-2 self-end text-xs"><input type="checkbox" checked={changeNpwp} onChange={e=>setChangeNpwp(e.target.checked)}/> Ajukan perubahan NPWP</label>{changeNpwp&&<label className="text-xs font-medium md:col-span-2">NPWP baru<input required inputMode="numeric" autoComplete="off" value={profileNpwp} onChange={e=>setProfileNpwp(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950" placeholder="Masukkan NPWP baru"/></label>}<label className="text-xs font-medium md:col-span-2">Alasan perubahan (8–500 karakter)<textarea required minLength={8} maxLength={500} rows={2} value={profileReason} onChange={e=>setProfileReason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label><button disabled={busy||!canAdmin||profileReason.trim().length<8||(!companyLegalName.trim()&&!changeNpwp)} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40 md:col-span-2">Ajukan perubahan profil</button></form><div className="mt-5 border-t border-slate-200 pt-4 dark:border-slate-800"><h3 className="text-sm font-semibold">Riwayat permohonan profil</h3>{profileChanges.length?<div className="mt-2 space-y-2">{profileChanges.map(x=><article key={x.id} className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-800"><div className="flex flex-wrap justify-between gap-2"><b>{x.proposed_legal_name||'Perubahan NPWP'}{x.change_npwp?' · NPWP berakhir '+(x.proposed_npwp_last4||'••••'):''}</b><span>{x.status}</span></div><p className="mt-1 text-slate-500">{x.reason}</p><p className="mt-1 text-[10px] text-slate-400">{new Date(x.created_at).toLocaleString('id-ID')}{x.review_notes?' · Review: '+x.review_notes:''}</p></article>)}</div>:<p className="mt-2 text-xs text-slate-500">Belum ada permohonan perubahan profil.</p>}</div></section>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="mb-4"><h2 className="flex items-center gap-2 font-semibold"><FolderKanban className="h-5 w-5 text-blue-600"/>Buat Project</h2><p className="mt-1 text-xs leading-5 text-slate-500">Project dibuat di Company Workspace aktif. Relasi client disimpan sebagai hubungan bisnis, bukan tenant atau membership.</p></div>
          <form onSubmit={createProject} className="space-y-3">
            <label className="block text-xs font-medium">Kode Project<input required maxLength={40} value={projectCode} onChange={e => setProjectCode(e.target.value.toUpperCase())} placeholder="Contoh: PRJ-001" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm uppercase dark:border-slate-700 dark:bg-slate-950"/></label>
            <label className="block text-xs font-medium">Nama Project<input required minLength={2} maxLength={160} value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Nama project operasional" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
            <label className="block text-xs font-medium">Deskripsi <span className="font-normal text-slate-500">(opsional)</span><textarea maxLength={2000} rows={3} value={description} onChange={e => setDescription(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label>
            <div className="border-t border-slate-200 pt-3 dark:border-slate-800"><p className="mb-2 text-xs font-semibold">Relasi client awal</p><label className="block text-xs font-medium">Nama client<input required minLength={2} maxLength={200} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Nama client / pemberi kerja" className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label><label className="mt-3 block text-xs font-medium">Referensi komersial <span className="font-normal text-slate-500">(opsional)</span><input maxLength={200} value={commercialReference} onChange={e => setCommercialReference(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"/></label></div>
            <button disabled={busy || !canAdmin} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">{busy ? 'Menyimpan…' : 'Buat Project & relasi client'}</button>
          </form>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="font-semibold">Project Registry</h2><p className="mt-1 text-xs text-slate-500">Daftar dibaca dari Supabase melalui RLS.</p></div><span className="text-2xl font-bold tabular-nums">{projects.length}</span></div>
          {projects.length ? <div className="space-y-3">{projects.map(project => <article key={project.id} className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-mono text-blue-600 dark:text-blue-300">{project.project_code}</p><h3 className="mt-1 font-semibold">{project.name}</h3><p className="mt-1 text-xs text-slate-500">{project.description || 'Tanpa deskripsi'}</p></div><span className="text-xs text-slate-500">{project.status}</span></div><div className="mt-3 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">{clients.filter(c => c.project_id === project.id).length ? clients.filter(c => c.project_id === project.id).map(c => <p key={c.id}><span className="text-slate-500">{c.relationship_type}:</span> <b>{c.client_name}</b>{c.commercial_reference ? ` · ${c.commercial_reference}` : ''}</p>) : <p className="text-slate-500">Belum ada relasi client.</p>}</div></article>)}</div>
          : <div className="rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center dark:border-slate-700"><FolderKanban className="mx-auto h-7 w-7 text-slate-400"/><p className="mt-3 text-sm font-medium">Belum ada Project</p><p className="mt-1 text-xs text-slate-500">Buat Project pertama melalui form. Project tidak otomatis menerima permission operasional.</p></div>}
        </section>
      </div>
      <RfinBInvitationPanel workspaceId={workspaceId} companyId={activeWorkspace?.company_id || ''} canAdmin={canAdmin} projects={projects}/>
      <p className="text-xs leading-5 text-slate-500">Catatan keamanan: Company Super Admin otomatis menjadi anggota awal Project untuk tata kelola, tetapi tidak otomatis menerima hak BOQ, inventory, cash, dokumen, approval, TTE, atau QR. Permission tersebut harus diberikan secara eksplisit melalui alur penugasan yang sesuai. Relasi client pada Project Registry adalah hubungan bisnis, bukan Company/Tenant, Workspace, atau Membership. Client tidak memperoleh akses aplikasi hanya karena dicatat sebagai client.</p>
      </>}
    </main>
  </div>;
};
