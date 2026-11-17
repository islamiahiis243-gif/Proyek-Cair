import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, Copy, KeyRound, RefreshCw, ShieldCheck, Users, XCircle } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

type Project = { id: string; project_code: string; name: string; status: string };
type Persona = { persona_code: string; display_name: string; description: string };
type Role = { role_code: string; display_name: string; description: string };
type Permission = { permission_code: string; module: string; action: string; requires_authority_check: boolean; description: string };
type Authority = { authority_code: string; display_name: string; description: string; allowed_dimensions: string[] };
type RolePermission = { role_code:string; permission_code:string };
type Member = { membership_id: string; user_id: string; email: string; full_name: string; membership_status: string; activated_at: string | null; is_company_super_admin:boolean };
type Invitation = { token_id: string; recipient_email: string; created_at: string; expires_at: string; redeemed_at: string | null; revoked_at: string | null; snapshot: any };

const emptyAuthority = () => ({ max_amount: '', currency: 'IDR', transaction_category: '', document_type: '', workflow_stage: '' });

export const RfinBInvitationPanel: React.FC<{ workspaceId: string; companyId: string; canAdmin: boolean; projects: Project[] }> = ({ workspaceId, companyId, canAdmin, projects }) => {
  const db = getSupabaseClient();
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [authorities, setAuthorities] = useState<Authority[]>([]);
  const [rolePermissions,setRolePermissions]=useState<RolePermission[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [personaCodes, setPersonaCodes] = useState<string[]>([]);
  const [signatoryOnlyMode,setSignatoryOnlyMode]=useState(false);
  const [roleCodes, setRoleCodes] = useState<string[]>([]);
  const [projectPermissions, setProjectPermissions] = useState<Record<string,string[]>>({});
  const [authorityConfig, setAuthorityConfig] = useState<Record<string,ReturnType<typeof emptyAuthority>>>({});
  const [reason, setReason] = useState('');
  const [expiryDays, setExpiryDays] = useState('7');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedCode, setIssuedCode] = useState('');
  const [issuedExpiry, setIssuedExpiry] = useState('');
  const [activeTab, setActiveTab] = useState<'issue'|'members'|'signatory'>('issue');
  const [selectedMemberId, setSelectedMemberId] = useState('');
  const [memberPersonas, setMemberPersonas] = useState<string[]>([]);
  const [memberRoles, setMemberRoles] = useState<string[]>([]);
  const [memberProjects, setMemberProjects] = useState<Record<string,string[]>>({});
  const [memberAuthorities, setMemberAuthorities] = useState<any[]>([]);
  const [memberReason, setMemberReason] = useState('');
  const [appointments,setAppointments]=useState<any[]>([]);
  const [signatoryProjectId,setSignatoryProjectId]=useState('');
  const [signatoryMemberId,setSignatoryMemberId]=useState('');
  const [signatoryDocType,setSignatoryDocType]=useState('BAST');
  const [signatoryReason,setSignatoryReason]=useState('');
  const [signatoryEnds,setSignatoryEnds]=useState('');
  const [effectivePreview,setEffectivePreview] = useState<any>(null);
  const [revocationDraft,setRevocationDraft]=useState<any|null>(null);

  const refresh = useCallback(async () => {
    if (!companyId || !workspaceId || !canAdmin) { setLoading(false); return; }
    setLoading(true); setError('');
    try {
      const [p,r,perm,a,m,i,ap,rp] = await Promise.all([
        db.from('persona_catalog').select('persona_code,display_name,description').eq('active',true).order('sort_order'),
        db.from('role_catalog').select('role_code,display_name,description').eq('active',true).order('sort_order'),
        db.from('project_permission_catalog').select('permission_code,module,action,requires_authority_check,description').eq('active',true).order('module').order('permission_code'),
        db.from('authority_catalog').select('authority_code,display_name,description,allowed_dimensions').eq('active',true).order('authority_code'),
        db.rpc('list_company_members_for_console',{p_workspace_id:workspaceId}),
        db.rpc('list_company_rfin_b',{p_company_id:companyId}),
        db.from('project_signatory_appointments').select('id,project_id,user_id,document_type,starts_at,ends_at,status,company_membership_id,reason').eq('workspace_id',workspaceId).order('created_at',{ascending:false}),
        db.from('role_permission_catalog').select('role_code,permission_code').eq('active',true)
      ]);
      for (const result of [p,r,perm,a,m,i,ap,rp]) if (result.error) throw result.error;
      setPersonas((p.data||[]) as Persona[]);
      setRoles((r.data||[]) as Role[]);
      setPermissions((perm.data||[]) as Permission[]);
      setAuthorities((a.data||[]) as Authority[]);
      setMembers((m.data||[]) as Member[]);
      setInvitations((i.data||[]) as Invitation[]);
      setAppointments(ap.data||[]);
      setRolePermissions(rp.data||[]);
    } catch (e:any) {
      setError(e?.message || 'Katalog assignment atau data Company Console gagal dimuat.');
    } finally { setLoading(false); }
  },[db,companyId,workspaceId,canAdmin]);

  useEffect(()=>{ setRevocationDraft(null);void refresh(); },[refresh]);

  const permissionByCode = useMemo(()=>new Map(permissions.map(p=>[p.permission_code,p])),[permissions]);
  const authorityRequirements = useMemo(()=>Object.entries(projectPermissions).flatMap(([projectId,codes])=>[...new Set([...codes,...rolePermissions.filter(r=>roleCodes.includes(r.role_code)).map(r=>r.permission_code)])].filter(code=>permissionByCode.get(code)?.requires_authority_check).map(code=>({projectId,code}))),[projectPermissions,permissionByCode,rolePermissions,roleCodes]);
  const selectedProjectCount = Object.keys(projectPermissions).filter(id=>(projectPermissions[id]?.length||0)>0||rolePermissions.some(r=>roleCodes.includes(r.role_code))).length;
  const toggleProject = (projectId:string,checked:boolean) => setProjectPermissions(current=>{
    const next={...current};
    if(checked) next[projectId]=next[projectId]||[];
    else delete next[projectId];
    return next;
  });
  const togglePermission = (projectId:string,code:string,checked:boolean) => setProjectPermissions(current=>{
    const next={...current,[projectId]:checked?[...(current[projectId]||[]),code]:(current[projectId]||[]).filter(x=>x!==code)};
    if(!next[projectId].length) delete next[projectId];
    return next;
  });
  const setAuthorityField=(key:string,field:keyof ReturnType<typeof emptyAuthority>,value:string)=>setAuthorityConfig(current=>({...current,[key]:{...(current[key]||emptyAuthority()),[field]:value}}));

  const buildAuthorityScopes = () => authorityRequirements.map(({projectId,code})=>{
    const key=projectId+':'+code, v=authorityConfig[key]||emptyAuthority();
    const scope:any={};
    if(v.transaction_category.trim()) scope.transaction_category=v.transaction_category.trim();
    if(v.document_type.trim()) scope.document_type=v.document_type.trim();
    if(v.workflow_stage.trim()) scope.workflow_stage=v.workflow_stage.trim();
    return {project_id:projectId,authority_code:code,scope,...(v.max_amount.trim()?{max_amount:v.max_amount.trim(),currency:v.currency}: {})};
  });

  useEffect(()=>{
    if(signatoryOnlyMode){setEffectivePreview({signatory_only:true,projects:[]});return;}
    if(!canAdmin||!workspaceId||!Object.keys(projectPermissions).length||!roleCodes.length){setEffectivePreview(null);return;}
    const snapshot={schema_version:'1',signatory_only:signatoryOnlyMode,persona_codes:personaCodes,role_codes:roleCodes,
      project_assignments:Object.entries(projectPermissions).filter(([,codes])=>codes.length||rolePermissions.some(r=>roleCodes.includes(r.role_code))).map(([project_id,permission_codes])=>({project_id,permission_codes})),
      authority_scopes:buildAuthorityScopes()};
    db.rpc('preview_company_access_snapshot',{p_workspace_id:workspaceId,p_snapshot:snapshot})
      .then(({data,error})=>{if(!error)setEffectivePreview(data);else setEffectivePreview(null);});
  },[canAdmin,workspaceId,personaCodes,roleCodes,projectPermissions,authorityConfig,db,signatoryOnlyMode]);


  const issue = async (e:React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(''); setNotice('');
    if(!canAdmin){setError('Company Super Admin tidak terverifikasi.');return;}
    const validSignatoryOnly=signatoryOnlyMode&&personaCodes.length===0&&roleCodes.length===0&&selectedProjectCount===0;
    const validStandardAccess=!signatoryOnlyMode&&personaCodes.length>0&&roleCodes.length>0&&selectedProjectCount>0;
    if(name.trim().length<2||email.trim().length<5||(!validSignatoryOnly&&!validStandardAccess)||reason.trim().length<8){
      setError(signatoryOnlyMode?'Mode Final Signatory-only hanya membuat Company Membership aktif tanpa Persona, Role, Project Membership atau Authority. Appointment Final Signatory dilakukan terpisah.':'Lengkapi nama, email, minimal satu Persona, satu Role, Project dengan permission eksplisit, dan alasan penugasan (minimal 8 karakter).');return;
    }
    const projectAssignments=Object.entries(projectPermissions).filter(([,codes])=>codes.length||rolePermissions.some(r=>roleCodes.includes(r.role_code))).map(([project_id,permission_codes])=>({project_id,permission_codes}));
    const authorityScopes=buildAuthorityScopes();
    const snapshot={schema_version:'1',display_name:name.trim(),phone:phone.trim()||null,recipient_email:email.trim().toLowerCase(),persona_codes:personaCodes,role_codes:roleCodes,project_assignments:projectAssignments,authority_scopes:authorityScopes};
    setBusy(true);
    try {
      const {data,error:rpcError}=await db.rpc('issue_rfin_b_with_snapshot',{
        p_company_id:companyId,p_recipient_email:email.trim().toLowerCase(),p_snapshot:snapshot,
        p_expires_in:expiryDays+' days',p_reason:reason.trim()
      });
      if(rpcError) throw rpcError;
      if(!data?.code || !data?.token_id) throw new Error('Server tidak mengembalikan credential issuance yang valid.');
      setIssuedCode(data.code);setIssuedExpiry(data.expires_at||'');
      setName('');setEmail('');setPhone('');setPersonaCodes([]);setRoleCodes([]);setProjectPermissions({});setAuthorityConfig({});setSignatoryOnlyMode(false);setReason('');
      setNotice('RFIN-B diterbitkan. Snapshot akses telah dikunci dan hanya dapat digunakan satu kali oleh email penerima.');
      await refresh();
    } catch(e:any){setError(e?.message||'Penerbitan RFIN-B gagal. Tidak ada keberhasilan yang diasumsikan.');}
    finally{setBusy(false);}
  };

  const revoke = (invitation:Invitation) => {if(busy||invitation.revoked_at||invitation.redeemed_at)return;setRevocationDraft({kind:'RFINB',invitation,reason:''});setError('');setNotice('');};

  const loadMemberAssignments = async (membershipId:string) => {
    setSelectedMemberId(membershipId);setMemberReason('');setError('');
    if(!membershipId){setMemberPersonas([]);setMemberRoles([]);setMemberProjects({});setMemberAuthorities([]);return;}
    try{
      const [p,r,a,pm]=await Promise.all([
        db.from('company_membership_persona_assignments').select('persona_code').eq('company_membership_id',membershipId).is('revoked_at',null).is('ends_at',null),
        db.from('company_membership_role_assignments').select('role_code').eq('company_membership_id',membershipId).is('revoked_at',null).is('ends_at',null),
        db.from('company_membership_authority_assignments').select('project_id,authority_code,scope,max_amount,currency').eq('company_membership_id',membershipId).is('revoked_at',null).is('ends_at',null),
        db.from('project_memberships').select('id,project_id').eq('company_membership_id',membershipId).eq('membership_status','ACTIVE')
      ]);
      for(const x of [p,r,a,pm])if(x.error)throw x.error;
      setMemberPersonas((p.data||[]).map((x:any)=>x.persona_code));
      setMemberRoles((r.data||[]).map((x:any)=>x.role_code));
      setMemberAuthorities(a.data||[]);
      const projectIds=(pm.data||[]).map((x:any)=>x.id);
      const projectMap:Record<string,string[]>={};
      for(const row of pm.data||[]){
        const {data,error}=await db.from('project_membership_permissions').select('permission_code').eq('project_membership_id',row.id);
        if(error)throw error;
        projectMap[row.project_id]=data?.map((x:any)=>x.permission_code)||[];
      }
      setMemberProjects(projectMap);
    }catch(e:any){setError(e?.message||'Assignment anggota gagal dimuat.');}
  };

  const saveMemberAssignments = async () => {
    if(!selectedMemberId||memberReason.trim().length<8||busy)return;
    setBusy(true);setError('');setNotice('');
    try{
      const projectAssignments=Object.entries(memberProjects).filter(([,codes])=>codes.length||rolePermissions.some(r=>memberRoles.includes(r.role_code))).map(([project_id,permission_codes])=>({project_id,permission_codes}));
      const {error}=await db.rpc('replace_company_member_access',{
        p_membership_id:selectedMemberId,p_persona_codes:memberPersonas,p_role_codes:memberRoles,
        p_project_assignments:projectAssignments,p_authority_scopes:memberAuthorities.filter(a=>projectAssignments.some(p=>p.project_id===a.project_id&&(p.permission_codes.includes(a.authority_code)||rolePermissions.some(r=>memberRoles.includes(r.role_code)&&r.permission_code===a.authority_code)))),p_reason:memberReason.trim()
      });
      if(error)throw error;
      setNotice('Penugasan Pihak Terkait berhasil diperbarui dan dicatat dalam audit.');await loadMemberAssignments(selectedMemberId);
    }catch(e:any){setError(e?.message||'Penugasan gagal disimpan.');}
    finally{setBusy(false);}
  };

  const changeMemberStatus = async (status:'ACTIVE'|'SUSPENDED'|'REVOKED') => {
    if(!selectedMemberId||busy||memberReason.trim().length<8)return;
    setBusy(true);setError('');setNotice('');
    try{const {error}=await db.rpc('set_company_membership_status',{p_membership_id:selectedMemberId,p_status:status,p_reason:memberReason.trim()});if(error)throw error;
      setNotice('Status Company Membership diperbarui menjadi '+status+'. '+(status==='ACTIVE'?'Tetapkan ulang Persona/Role/Project jika akses sebelumnya pernah dicabut.':'Semua sesi Persona dan Project Membership langsung dicabut.'));
      await refresh();if(status!=='ACTIVE')await loadMemberAssignments(selectedMemberId);
    }catch(e:any){setError(e?.message||'Perubahan status membership gagal.');}
    finally{setBusy(false);}
  };

  const appointSignatory = async(e:React.FormEvent) => {
    e.preventDefault();if(busy)return;
    if(!signatoryProjectId||!signatoryMemberId||signatoryReason.trim().length<8){setError('Pilih anggota aktif, Project, jenis dokumen dan alasan penunjukan.');return;}
    setBusy(true);setError('');setNotice('');
    try{const {error}=await db.rpc('appoint_project_signatory',{p_membership_id:signatoryMemberId,p_project_id:signatoryProjectId,p_document_type:signatoryDocType,p_scope:{},p_starts_at:new Date().toISOString(),p_ends_at:signatoryEnds?new Date(signatoryEnds).toISOString():null,p_reason:signatoryReason.trim()});if(error)throw error;
      setNotice('Final Signatory ditetapkan. Penunjukan berlaku untuk jenis dokumen dan Project yang dipilih, bukan untuk semua dokumen perusahaan.');setSignatoryReason('');setSignatoryEnds('');await refresh();
    }catch(e:any){setError(e?.message||'Penunjukan Final Signatory gagal. Pastikan anggota memiliki Company Membership aktif pada tenant yang sama dan Company Super Admin berwenang menunjuknya.');}
    finally{setBusy(false);}
  };

  const revokeSignatory = (appointment:any) => {if(busy||appointment.status!=='ACTIVE')return;setRevocationDraft({kind:'SIGNATORY',appointment,reason:''});setError('');setNotice('');};
  const confirmRevocation=async(e:React.FormEvent)=>{e.preventDefault();const draft=revocationDraft;if(!draft||busy)return;const reason=String(draft.reason||'').trim();if(draft.kind==='SIGNATORY'&&(reason.length<8||reason.length>500)){setError('Alasan pencabutan Final Signatory wajib 8–500 karakter.');return;}setBusy(true);setError('');setNotice('');try{if(draft.kind==='RFINB'){const {error}=await db.rpc('revoke_rfin',{p_token_id:draft.invitation.token_id});if(error)throw error;setNotice('RFIN-B untuk '+draft.invitation.recipient_email+' berhasil dicabut. Token tidak dapat digunakan kembali.');}else{const {error}=await db.rpc('revoke_project_signatory_appointment',{p_appointment_id:draft.appointment.id,p_reason:reason});if(error)throw error;setNotice('Penunjukan Final Signatory dicabut dan dicatat dalam audit. Dokumen yang sudah diterbitkan tidak dihapus.');}setRevocationDraft(null);await refresh();}catch(e:any){setError(e?.message||'Pencabutan gagal.');}finally{setBusy(false);}};

  const renderAccessPicker=(prefix:string,personaValue:string[],setPersona:(v:string[])=>void,roleValue:string[],setRole:(v:string[])=>void,projectValue:Record<string,string[]>,setProject:(v:Record<string,string[]>)=>void,authoritiesValue:any[],setAuthorities:(v:any[])=>void,signatoryOnly=false)=>{
    const changePermission=(projectId:string,code:string,checked:boolean)=>setProject({...projectValue,[projectId]:checked?[...(projectValue[projectId]||[]),code]:(projectValue[projectId]||[]).filter((x:string)=>x!==code)});
    const required=signatoryOnly?[]:Object.entries(projectValue).flatMap(([projectId,codes])=>[...new Set([...codes,...rolePermissions.filter(r=>roleValue.includes(r.role_code)).map(r=>r.permission_code)])].filter((code:string)=>permissionByCode.get(code)?.requires_authority_check).map((code:string)=>({projectId,code})));
    const updateAuthority=(projectId:string,code:string,field:string,value:string)=>{
      const key=projectId+':'+code;
      const current=authoritiesValue.filter(a=>!(a.project_id===projectId&&a.authority_code===code));
      const prior=authoritiesValue.find(a=>a.project_id===projectId&&a.authority_code===code)||{project_id:projectId,authority_code:code,scope:{}};
      const next={...prior,scope:{...(prior.scope||{})}};
      if(field==='max_amount') {if(value)next.max_amount=value;else{delete next.max_amount;delete next.currency;}}
      else if(field==='currency') next.currency=value;
      else if(value) next.scope[field]=value; else delete next.scope[field];
      setAuthorities([...current,next]);
    };
    return <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-2">
        {!signatoryOnly&&<fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><legend className="px-1 text-sm font-semibold">Persona / konteks pekerjaan</legend><p className="mb-2 text-xs text-slate-500">Persona adalah kapasitas kerja. Ini bukan identitas, jabatan, atau izin otomatis.</p>{personas.map(item=><label key={item.persona_code} className="flex items-start gap-2 rounded-lg p-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" disabled={busy} checked={personaValue.includes(item.persona_code)} onChange={e=>setPersona(e.target.checked?[...personaValue,item.persona_code]:personaValue.filter(x=>x!==item.persona_code))}/><span><b>{item.display_name}</b><span className="block text-slate-500">{item.description}</span></span></label>)}</fieldset>}
        {!signatoryOnly&&<fieldset className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><legend className="px-1 text-sm font-semibold">Role / preset tanggung jawab</legend><p className="mb-2 text-xs text-slate-500">Role adalah preset tanggung jawab; permission efektif dipilih eksplisit dan tidak diwariskan otomatis.</p>{roles.map(item=><label key={item.role_code} className="flex items-start gap-2 rounded-lg p-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800"><input type="checkbox" disabled={busy} checked={roleValue.includes(item.role_code)} onChange={e=>setRole(e.target.checked?[...roleValue,item.role_code]:roleValue.filter(x=>x!==item.role_code))}/><span><b>{item.display_name}</b><span className="block text-slate-500">{item.description}</span><span className="mt-1 block text-[10px] text-blue-700 dark:text-blue-300">Permission mapping: {rolePermissions.filter(r=>r.role_code===item.role_code).map(r=>r.permission_code).join(', ')||'Belum ada permission mapping'}</span></span></label>)}</fieldset>}
      </div>
      {!signatoryOnly&&<div className="space-y-3"><div><h4 className="text-sm font-semibold">Project & permission</h4><p className="text-xs text-slate-500">Pilih Project yang benar-benar menjadi tanggung jawab Pihak Terkait. Permission merupakan tindakan atomik.</p></div>
      {projects.filter(p=>p.status==='ACTIVE').map(project=><section key={project.id} className="rounded-xl border border-slate-200 p-3 dark:border-slate-700"><label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" disabled={busy} checked={Object.hasOwn(projectValue,project.id)} onChange={e=>{const next={...projectValue};if(e.target.checked)next[project.id]=next[project.id]||[];else delete next[project.id];setProject(next);}}/>{project.project_code} · {project.name}</label>{Object.hasOwn(projectValue,project.id)&&<div className="mt-3 grid gap-2 sm:grid-cols-2">{permissions.filter(p=>p.module!=='platform').map(item=><label key={item.permission_code} className="flex items-start gap-2 rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800"><input type="checkbox" disabled={busy} checked={(projectValue[project.id]||[]).includes(item.permission_code)} onChange={e=>changePermission(project.id,item.permission_code,e.target.checked)}/><span><b>{item.permission_code}</b><span className="block text-slate-500">{item.description}</span>{item.requires_authority_check&&<span className="mt-1 inline-flex text-[10px] font-semibold text-amber-700 dark:text-amber-300">Memerlukan Authority</span>}</span></label>)}</div>}</section>)}
      </div>}
      {required.length>0&&<section className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/20"><h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200">Batas Authority bisnis</h4><p className="mb-3 text-xs text-amber-800 dark:text-amber-300">Setiap permission berisiko harus memiliki scope authority untuk Project yang sama. Limit nominal dan dimensi tambahan bersifat eksplisit.</p><div className="space-y-3">{required.map(({projectId,code})=>{const existing=authoritiesValue.find(a=>a.project_id===projectId&&a.authority_code===code)||{project_id:projectId,authority_code:code,scope:{}};return <div key={projectId+':'+code} className="rounded-lg border border-amber-200 bg-white p-3 dark:border-amber-900 dark:bg-slate-900"><b className="text-xs">{projects.find(p=>p.id===projectId)?.project_code} · {code}</b><div className="mt-2 grid gap-2 sm:grid-cols-2">{(authorities.find(a=>a.authority_code===code)?.allowed_dimensions||[]).includes('amount')&&<><label className="text-xs">Limit nominal (opsional)<input type="number" min="0" step="0.01" value={existing.max_amount??''} onChange={e=>updateAuthority(projectId,code,'max_amount',e.target.value)} className="mt-1 w-full rounded border bg-transparent p-2"/></label><label className="text-xs">Mata uang<input value={existing.currency||'IDR'} onChange={e=>updateAuthority(projectId,code,'currency',e.target.value.toUpperCase())} maxLength={3} className="mt-1 w-full rounded border bg-transparent p-2"/></label></>}{(authorities.find(a=>a.authority_code===code)?.allowed_dimensions||[]).includes('transaction_category')&&<label className="text-xs">Kategori transaksi/pekerjaan<input value={existing.scope?.transaction_category||''} onChange={e=>updateAuthority(projectId,code,'transaction_category',e.target.value)} className="mt-1 w-full rounded border bg-transparent p-2"/></label>}{(authorities.find(a=>a.authority_code===code)?.allowed_dimensions||[]).includes('document_type')&&<label className="text-xs">Jenis dokumen<input value={existing.scope?.document_type||''} onChange={e=>updateAuthority(projectId,code,'document_type',e.target.value)} className="mt-1 w-full rounded border bg-transparent p-2"/></label>}{(authorities.find(a=>a.authority_code===code)?.allowed_dimensions||[]).includes('workflow_stage')&&<label className="text-xs sm:col-span-2">Tahap workflow<input value={existing.scope?.workflow_stage||''} onChange={e=>updateAuthority(projectId,code,'workflow_stage',e.target.value)} className="mt-1 w-full rounded border bg-transparent p-2"/></label>}<p className="text-[10px] text-amber-700 dark:text-amber-300 sm:col-span-2">Scope Project selalu diterapkan oleh server. Dimensi tambahan yang tampil mengikuti Authority Catalog.</p></div></div>})}</div></section>}
    </div>;
  };

  if(!canAdmin)return null;
  return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Users className="h-5 w-5 text-blue-600"/><h2 className="text-lg font-bold">Pihak Terkait & RFIN-B</h2></div><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Pihak Terkait adalah User Identity yang ditunjuk untuk pekerjaan perusahaan. Company Super Admin menyiapkan identitas, Role, Persona dan Project sesuai kebutuhan. Mode Final Signatory-only mendukung Company Membership aktif tanpa Persona, Role, Project Membership, atau Authority; Final Signatory ditetapkan melalui appointment eksplisit. RFIN-B diterbitkan setelah Effective Access Preview disetujui; redemption menerapkan snapshot secara atomik. Ini bukan registri Orang Terkait seperti pemegang saham atau beneficial owner.</p></div><button type="button" onClick={()=>void refresh()} disabled={loading||busy} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs disabled:opacity-50 dark:border-slate-700"><RefreshCw className={loading?'h-4 w-4 animate-spin':'h-4 w-4'}/>Perbarui</button></div>
    {error&&<div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><AlertTriangle className="mr-2 inline h-4 w-4"/>{error}</div>}
    {notice&&<div role="status" aria-live="polite" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div>}
    {loading?<div className="py-8 text-center text-sm text-slate-500">Memuat katalog dan anggota dari database…</div>:<>
      <div className="flex gap-2 border-b pb-3 dark:border-slate-800"><button type="button" onClick={()=>setActiveTab('issue')} className={activeTab==='issue'?'rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white':'rounded-lg border px-3 py-2 text-xs dark:border-slate-700'}>Siapkan & terbitkan RFIN-B</button><button type="button" onClick={()=>setActiveTab('members')} className={activeTab==='members'?'rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white':'rounded-lg border px-3 py-2 text-xs dark:border-slate-700'}>Penugasan anggota ({members.length})</button><button type="button" onClick={()=>setActiveTab('signatory')} className={activeTab==='signatory'?'rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white':'rounded-lg border px-3 py-2 text-xs dark:border-slate-700'}>Final Signatory ({appointments.filter(a=>a.status==='ACTIVE').length})</button></div>
      {activeTab==='signatory'?<div className="space-y-4">
        <div><h3 className="text-sm font-semibold">Penunjukan Final Signatory</h3><p className="mt-1 text-xs text-slate-500">Company Super Admin menunjuk Company Member aktif untuk Project dan jenis dokumen tertentu. Appointment eksplisit pada Project dan jenis dokumen adalah dasar final signing; tidak diperlukan Project Membership, Persona, Role, Employee Record, jabatan, permission document.sign terpisah, atau Authority tambahan.</p></div>
        <form onSubmit={appointSignatory} className="grid gap-3 md:grid-cols-2">
          <label className="text-xs font-medium">Pihak Terkait aktif<select required value={signatoryMemberId} onChange={e=>setSignatoryMemberId(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"><option value="">Pilih anggota aktif</option>{members.filter(m=>m.membership_status==='ACTIVE'&&Boolean(m.user_id)).map(m=><option key={m.membership_id} value={m.membership_id}>{m.full_name||m.email} · {m.email}</option>)}</select></label>
          <label className="text-xs font-medium">Project<select required value={signatoryProjectId} onChange={e=>setSignatoryProjectId(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"><option value="">Pilih Project</option>{projects.filter(p=>p.status==='ACTIVE').map(p=><option key={p.id} value={p.id}>{p.project_code} · {p.name}</option>)}</select></label>
          <label className="text-xs font-medium">Jenis dokumen<select value={signatoryDocType} onChange={e=>setSignatoryDocType(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"><option>BAST</option><option>BERITA_ACARA</option><option>SURAT_TERIMA_BARANG</option><option>LAPORAN_PROGRES</option><option>LAPORAN_PROGRES_IMK</option><option>LAPORAN_K3</option><option>MUTASI_KAS</option></select></label>
          <label className="text-xs font-medium">Berlaku sampai (opsional)<input type="datetime-local" value={signatoryEnds} onChange={e=>setSignatoryEnds(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label>
          <label className="text-xs font-medium md:col-span-2">Alasan penunjukan<input required minLength={8} maxLength={500} value={signatoryReason} onChange={e=>setSignatoryReason(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label>
          <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white md:col-span-2">Tetapkan Final Signatory</button>
        </form>
        <div className="space-y-2">{appointments.map(a=>{const member=members.find(m=>m.user_id===a.user_id);return <article key={a.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs dark:border-slate-800"><div className="min-w-0"><b>{projects.find(p=>p.id===a.project_id)?.name||a.project_id} · {a.document_type}</b><p className="text-slate-600 dark:text-slate-300">{member?.full_name||member?.email||'Pihak Terkait'} · {member?.email||a.user_id.slice(0,8)}</p><p className="text-slate-500">{new Date(a.starts_at).toLocaleString('id-ID')} – {a.ends_at?new Date(a.ends_at).toLocaleString('id-ID'):'tanpa batas akhir'}</p><p className="text-slate-500">{a.reason}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 dark:bg-slate-800">{a.status}</span>{a.status==='ACTIVE'&&<button type="button" disabled={busy} onClick={()=>void revokeSignatory(a)} className="rounded-lg border border-rose-300 px-2 py-1.5 text-[11px] font-semibold text-rose-700 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300">Cabut penunjukan</button>}</div></article>})}</div>
      </div>:activeTab==='issue'?<form onSubmit={issue} className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3"><label className="text-xs font-medium">Nama Pihak Terkait<input required minLength={2} maxLength={160} value={name} onChange={e=>setName(e.target.value)} placeholder="Nama sesuai identitas pengguna" className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label><label className="text-xs font-medium">Email identitas (wajib)<input required type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="nama@perusahaan.id" className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label><label className="text-xs font-medium">Nomor telepon (opsional)<input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+62…" className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label></div>
         <label className="flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs dark:border-blue-900 dark:bg-blue-950/20"><input type="checkbox" checked={signatoryOnlyMode} disabled={busy} onChange={e=>{setSignatoryOnlyMode(e.target.checked);if(e.target.checked){setPersonaCodes([]);setRoleCodes([]);setProjectPermissions({});setAuthorityConfig({});}}}/><span><b>Final Signatory-only membership</b><span className="mt-1 block text-slate-600 dark:text-slate-300">Buat Company Membership saja. Tidak ada Persona, Role, Project Membership, permission document.sign, atau Authority. Company Super Admin menetapkan appointment Final Signatory secara terpisah.</span></span></label>
        {renderAccessPicker('new',personaCodes,setPersonaCodes,roleCodes,setRoleCodes,projectPermissions,setProjectPermissions,buildAuthorityScopes(),v=>{const next:Record<string,any>={};for(const a of v)next[a.project_id+':'+a.authority_code]=a;setAuthorityConfig(next);},signatoryOnlyMode)}
        <div className="grid gap-3 md:grid-cols-2"><label className="text-xs font-medium">Masa berlaku RFIN-B<select value={expiryDays} onChange={e=>setExpiryDays(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"><option value="1">1 hari</option><option value="3">3 hari</option><option value="7">7 hari</option><option value="14">14 hari</option></select></label><label className="text-xs font-medium">Alasan penunjukan / audit<input required minLength={8} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} placeholder="Contoh: Penugasan Finance pada Project" className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label></div>
        <button disabled={busy||!canAdmin||!personas.length||!roles.length||!permissions.length} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Menerbitkan snapshot…':<><KeyRound className="h-4 w-4"/>Konfirmasi & terbitkan RFIN-B</>}</button>
      </form>:<div className="space-y-4">
        <label className="block max-w-xl text-xs font-medium">Pilih Pihak Terkait yang sudah memiliki Company Membership<select value={selectedMemberId} onChange={e=>void loadMemberAssignments(e.target.value)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"><option value="">Pilih anggota aktif</option>{members.map(m=><option key={m.membership_id} value={m.membership_id}>{m.full_name||m.email} · {m.email}</option>)}</select></label>
        {selectedMemberId&&<><p className="text-xs text-slate-500">Status saat ini: {members.find(m=>m.membership_id===selectedMemberId)?.membership_status||'—'}. Mengubah assignment tidak mengubah snapshot RFIN-B historis. Semua assignment aktif lama dicabut sebagai event historis dan diganti dalam satu transaksi.</p>{renderAccessPicker('member',memberPersonas,setMemberPersonas,memberRoles,setMemberRoles,memberProjects,setMemberProjects,memberAuthorities,setMemberAuthorities)}<label className="block text-xs font-medium">Alasan perubahan (wajib)<input value={memberReason} onChange={e=>setMemberReason(e.target.value)} minLength={8} maxLength={500} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label><div className="grid gap-2 sm:grid-cols-3"><button type="button" disabled={busy||memberReason.trim().length<8} onClick={()=>void saveMemberAssignments()} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{busy?'Menyimpan…':'Simpan perubahan penugasan'}</button><button type="button" disabled={busy||memberReason.trim().length<8||members.find(m=>m.membership_id===selectedMemberId)?.is_company_super_admin||members.find(m=>m.membership_id===selectedMemberId)?.membership_status==='SUSPENDED'} onClick={()=>void changeMemberStatus('SUSPENDED')} className="rounded-lg border border-amber-300 px-3 py-3 text-xs font-semibold text-amber-800 disabled:opacity-40 dark:border-amber-900 dark:text-amber-300">Tangguhkan akses</button><button type="button" disabled={busy||memberReason.trim().length<8||members.find(m=>m.membership_id===selectedMemberId)?.is_company_super_admin||members.find(m=>m.membership_id===selectedMemberId)?.membership_status==='REVOKED'} onClick={()=>void changeMemberStatus('REVOKED')} className="rounded-lg border border-rose-300 px-3 py-3 text-xs font-semibold text-rose-800 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300">Cabut membership</button></div>
        <button type="button" disabled={busy||memberReason.trim().length<8||members.find(m=>m.membership_id===selectedMemberId)?.is_company_super_admin||members.find(m=>m.membership_id===selectedMemberId)?.membership_status==='ACTIVE'} onClick={()=>void changeMemberStatus('ACTIVE')} className="rounded-lg border border-emerald-300 px-3 py-2 text-xs font-semibold text-emerald-800 disabled:opacity-40 dark:border-emerald-900 dark:text-emerald-300">Aktifkan kembali membership</button></>}
      </div>}
      {issuedCode&&<div className="rounded-xl border-2 border-emerald-400 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950/30"><div className="flex items-center gap-2 font-semibold text-emerald-900 dark:text-emerald-200"><Check className="h-5 w-5"/>RFIN-B diterbitkan — tampil satu kali</div><p className="mt-1 text-xs text-emerald-800 dark:text-emerald-300">Salin credential dan sampaikan hanya kepada penerima melalui kanal aman. Token plaintext tidak dapat ditampilkan ulang.</p><div className="mt-3 flex flex-wrap items-center gap-2"><code className="min-w-0 flex-1 break-all rounded-lg bg-white p-3 text-sm font-bold text-slate-900 dark:bg-slate-950 dark:text-white">{issuedCode}</code><button type="button" onClick={()=>void navigator.clipboard.writeText(issuedCode)} className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white"><Copy className="h-4 w-4"/>Salin</button><button type="button" onClick={()=>setIssuedCode('')} className="rounded-lg border border-emerald-700 px-3 py-2 text-xs dark:border-emerald-600"><XCircle className="h-4 w-4"/></button></div><p className="mt-2 text-xs text-emerald-800 dark:text-emerald-300">Kedaluwarsa: {issuedExpiry?new Date(issuedExpiry).toLocaleString('id-ID'):'—'}</p></div>}
      <div className="border-t pt-4 dark:border-slate-800"><h3 className="mb-3 text-sm font-semibold">Riwayat RFIN-B</h3>{invitations.length?<div className="space-y-2">{invitations.map(item=><article key={item.token_id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3 dark:border-slate-800"><div><p className="text-sm font-semibold">{item.recipient_email}</p><p className="mt-1 text-xs text-slate-500">Diterbitkan {new Date(item.created_at).toLocaleString('id-ID')} · Berakhir {new Date(item.expires_at).toLocaleString('id-ID')}</p><p className="mt-1 text-xs text-slate-500">{item.snapshot?.display_name||'Pihak Terkait'} · {(item.snapshot?.persona_codes||[]).length} Persona · {(item.snapshot?.role_codes||[]).length} Role · {(item.snapshot?.project_assignments||[]).length} Project</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-semibold dark:bg-slate-800">{item.revoked_at?'DICABUT':item.redeemed_at?'REDEEMED':new Date(item.expires_at)<new Date()?'EXPIRED':'ACTIVE'}</span>{!item.revoked_at&&!item.redeemed_at&&new Date(item.expires_at)>new Date()&&<button type="button" disabled={busy} onClick={()=>revoke(item)} className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-700 disabled:opacity-50 dark:border-rose-900 dark:text-rose-300">Cabut</button>}</div></article>)}</div>:<p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500 dark:border-slate-700">Belum ada RFIN-B untuk Company ini.</p>}</div>
    </>}
    {revocationDraft&&<div className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setRevocationDraft(null);}}>
      <form role="dialog" aria-modal="true" aria-labelledby="revocation-title" onSubmit={confirmRevocation} className="my-auto w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
       <div><h3 id="revocation-title" className="text-sm font-bold">{revocationDraft.kind==='RFINB'?'Cabut credential RFIN-B':'Cabut penunjukan Final Signatory'}</h3>{revocationDraft.kind==='RFINB'?<><p className="mt-1 text-xs text-slate-500">{revocationDraft.invitation.recipient_email}</p><p className="mt-2 text-xs text-rose-700 dark:text-rose-300">Token yang dicabut tidak dapat digunakan untuk redemption. Keputusan ini tidak dapat dibatalkan.</p></>:<><p className="mt-1 text-xs text-slate-500">{revocationDraft.appointment.document_type} · Project {projects.find(p=>p.id===revocationDraft.appointment.project_id)?.name||revocationDraft.appointment.project_id}</p><p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Appointment tidak lagi berlaku untuk penerbitan dokumen berikutnya. Dokumen yang sudah diterbitkan dan tanda tangan historis tidak dihapus.</p></>}</div>
       {revocationDraft.kind==='SIGNATORY'&&<label className="block text-xs font-semibold">Alasan pencabutan<textarea required minLength={8} maxLength={500} rows={3} value={revocationDraft.reason} onChange={e=>setRevocationDraft((x:any)=>x?{...x,reason:e.target.value}:x)} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700" placeholder="Jelaskan dasar pencabutan appointment…"/></label>}
       {revocationDraft.kind==='SIGNATORY'&&<p className="text-right text-[10px] text-slate-500">{revocationDraft.reason.trim().length}/500 karakter (minimal 8)</p>}
       <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setRevocationDraft(null)} className="rounded-lg border px-4 py-2 text-xs dark:border-slate-700">Batal</button><button type="submit" disabled={busy||(revocationDraft.kind==='SIGNATORY'&&revocationDraft.reason.trim().length<8)} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy?'Mencabut…':'Konfirmasi pencabutan'}</button></div>
      </form>
    </div>}
  </section>;
};
