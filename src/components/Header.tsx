import React,{useCallback,useEffect,useState} from 'react';
import { useApp } from '../context/AppContext';
import { Bell, Building2, ChevronDown, CloudCheck, CloudOff, LogOut, Plus, ShieldCheck, Sun, Moon, CheckCheck, RefreshCw } from 'lucide-react';
import { formatRupiah } from '../lib/pdfGenerator';
import { getSupabaseClient } from '../lib/supabase';

export const Header: React.FC = () => {
  const { user, supabaseConfig, logout, currentCashBalance, cashAccess, stockWriteAccess, setCurrentView, theme, toggleTheme, activeProject, activeContext, activeWorkspaceId, setActiveWorkspaceId, setActiveProjectId, refreshActiveContext } = useApp();
  const [notifications,setNotifications]=useState<any[]>([]);
  const [notificationOpen,setNotificationOpen]=useState(false);
  const [notificationLoading,setNotificationLoading]=useState(false);
  const [notificationError,setNotificationError]=useState('');
  const [unreadCount,setUnreadCount]=useState(0);
  const [contextOpen,setContextOpen]=useState(false);
  const [contextBusy,setContextBusy]=useState(false);
  const [contextError,setContextError]=useState('');
  const activeWorkspace=activeContext?.workspaces.find(w=>w.id===activeWorkspaceId)||null;
  const activePersona=activeWorkspace?.personas?.find(p=>p.persona_code===activeWorkspace.active_persona_code)||null;
  const workspaceProjects=activeContext?.projects.filter(p=>p.workspace_id===activeWorkspaceId)||[];
  const switchWorkspace=async(nextWorkspaceId:string)=>{
    if(!user.id||!nextWorkspaceId||nextWorkspaceId===activeWorkspaceId)return;
    setContextBusy(true);setContextError('');
    try{
      const {error}=await getSupabaseClient().from('workspace_context_audit').insert({user_id:user.id,from_workspace_id:activeWorkspaceId||null,to_workspace_id:nextWorkspaceId});
      if(error)throw error;
      setActiveWorkspaceId(nextWorkspaceId);
      setCurrentView('workspaces');
      setContextOpen(false);
    }catch(e:any){setContextError(e?.message||'Workspace tidak dapat diganti.');}
    finally{setContextBusy(false);}
  };
  const switchPersona=async(personaCode:string)=>{
    if(!activeWorkspaceId||!personaCode||!activeWorkspace||activeWorkspace.type!=='COMPANY')return;
    setContextBusy(true);setContextError('');
    try{
      const {error}=await getSupabaseClient().rpc('set_my_active_persona',{p_workspace_id:activeWorkspaceId,p_persona_code:personaCode});
      if(error)throw error;
      setActiveWorkspaceId(activeWorkspaceId);
      await refreshActiveContext();
      setCurrentView('workspaces');
      setContextOpen(false);
    }catch(e:any){setContextError(e?.message||'Persona aktif tidak dapat diganti.');}
    finally{setContextBusy(false);}
  };
  const switchProject=(projectId:string)=>{
    if(!projectId){setActiveWorkspaceId(activeWorkspaceId);setCurrentView('workspaces');return;}
    try{setActiveProjectId(projectId);setCurrentView('dashboard');setContextOpen(false);setContextError('');}
    catch(e:any){setContextError(e?.message||'Project tidak tersedia pada konteks aktif.');}
  };
  const loadNotifications=useCallback(async()=>{if(!user.id||!activeProject?.id){setNotifications([]);setUnreadCount(0);return;}setNotificationLoading(true);setNotificationError('');try{const db=getSupabaseClient();const [list,count]=await Promise.all([db.from('user_notifications').select('id,notification_type,title,body,reference_type,reference_id,read_at,created_at').eq('user_id',user.id).eq('project_id',activeProject.id).order('created_at',{ascending:false}).limit(10),db.from('user_notifications').select('id',{count:'exact',head:true}).eq('user_id',user.id).eq('project_id',activeProject.id).is('read_at',null)]);if(list.error)throw list.error;if(count.error)throw count.error;setNotifications(list.data||[]);setUnreadCount(count.count||0);}catch(e:any){setNotificationError(e?.message||'Notifikasi belum dapat dimuat.');}finally{setNotificationLoading(false);}},[user.id,activeProject?.id]);
  useEffect(()=>{void loadNotifications();setNotificationOpen(false);},[loadNotifications]);
  const markNotificationRead=async(id:string)=>{const {error}=await getSupabaseClient().from('user_notifications').update({read_at:new Date().toISOString()}).eq('id',id).eq('user_id',user.id).eq('project_id',activeProject?.id||'');if(error){setNotificationError(error.message);return;}setNotifications(rows=>rows.map(n=>n.id===id?{...n,read_at:new Date().toISOString()}:n));setUnreadCount(n=>Math.max(0,n-1));};
  const openNotification=async(n:any)=>{if(!n.read_at)await markNotificationRead(n.id);setNotificationOpen(false);const type=String(n.reference_type||'').toLowerCase();if(type==='final_signatory'||type==='signatory'||String(n.notification_type||'').includes('SIGNATORY')){window.location.assign('/signatory');return;}const destinations:Record<string,string>={workflow:'operations',procurement_request:'procurement',procurement_order:'procurement',goods_receipt:'procurement',cash_transaction:'cashflow',inventory_transaction:'inventory',boq_addition:'project-control',boq_item:'project-control',project:'project-control',document:'operations',safety_report:'operations'};if(type==='workflow'&&n.reference_id){const hash='#workflow-'+encodeURIComponent(String(n.reference_id));if(window.location.hash===hash)window.dispatchEvent(new Event('hashchange'));else window.location.hash=hash;setCurrentView('operations');return;}setCurrentView((destinations[type]||'operations') as any);};
  const markAllNotificationsRead=async()=>{if(!user.id||!activeProject?.id)return;const now=new Date().toISOString();const {error}=await getSupabaseClient().from('user_notifications').update({read_at:now}).eq('user_id',user.id).eq('project_id',activeProject.id).is('read_at',null);if(error){setNotificationError(error.message);return;}setNotifications(rows=>rows.map(n=>({...n,read_at:n.read_at||now})));setUnreadCount(0);};

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between gap-2 px-3 py-3 sm:gap-4 sm:px-6 sm:py-3.5 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-colors">
      <div className="flex items-center gap-3 shrink-0">
        <button
          onClick={() => setCurrentView('dashboard')}
          className="flex items-center gap-2.5 text-left focus:outline-none group"
          aria-label="Proyek Cair - Dashboard"
        >
          <img
            src="/android-chrome-512x512.png"
            alt="Logo Proyek Cair"
            className="w-10 h-10 rounded-lg object-contain bg-white border border-slate-200"
          />
          <div>
            <div className="text-base font-bold tracking-tight text-slate-900 dark:text-white group-hover:text-blue-600 transition-colors">
              Proyek Cair
            </div>
            <div className="text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {activeWorkspace?.type==='COMPANY'?'Company Workspace':activeWorkspace?.type==='PERSONAL'?'Personal Workspace':'Pilih Workspace'}
            </div>
          </div>
        </button>
      </div>

      {user.id&&<div className="relative min-w-0">
        <button type="button" onClick={()=>{setContextError('');setContextOpen(v=>!v);}} aria-label={`Konteks aktif: ${activeWorkspace?.name||'Pilih Workspace'}${activeProject?' · '+activeProject.name:''}. Ganti konteks`} aria-expanded={contextOpen} aria-haspopup="dialog" className="flex max-w-[2.5rem] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2 text-left hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 sm:max-w-[16rem] sm:px-3">
          <Building2 className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-300"/>
          <span className="hidden min-w-0 sm:block"><span className="block truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">{activeWorkspace?.name||'Pilih Workspace'}</span><span className="block truncate text-[10px] text-slate-500 dark:text-slate-400">{activeProject?.name||activePersona?.display_name||(activeWorkspace?.type==='PERSONAL'?'Personal Workspace':'Pilih Persona / Project')}</span></span>
          <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-slate-400 sm:block"/>
        </button>
        {contextOpen&&<div role="dialog" aria-label="Pemilih konteks kerja" className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] sm:left-0 sm:right-auto space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div><h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Konteks kerja</h2><p className="mt-1 text-[11px] leading-5 text-slate-500">Workspace, Persona, dan Project berasal dari resolver server. Mengganti konteks tidak menambah hak akses.</p></div>
          <label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Workspace
            <select aria-label="Workspace aktif" value={activeWorkspaceId} disabled={contextBusy||!activeContext?.workspaces.length} onChange={e=>void switchWorkspace(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">
              <option value="">Pilih Workspace</option>{(activeContext?.workspaces||[]).map(w=><option key={w.id} value={w.id}>{w.type==='PERSONAL'?'Personal':'Perusahaan'} · {w.name}</option>)}
            </select>
          </label>
          {activeWorkspace?.type==='COMPANY'&&<label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Persona aktif
            <select aria-label="Persona aktif" value={activeWorkspace.active_persona_code||''} disabled={contextBusy||!activeWorkspace.personas?.length} onChange={e=>void switchPersona(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">
              <option value="">Pilih Persona</option>{(activeWorkspace.personas||[]).map(p=><option key={p.persona_code} value={p.persona_code}>{p.display_name}</option>)}
            </select>
          </label>}
          {activeWorkspace?.type==='COMPANY'&&<label className="block text-xs font-medium text-slate-700 dark:text-slate-300">Project operasional
            <select aria-label="Project aktif" value={activeProject?.id||''} disabled={contextBusy||!activeWorkspace.active_persona_code||!workspaceProjects.length} onChange={e=>switchProject(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950">
              <option value="">{workspaceProjects.length?'Pilih Project':'Belum ada Project yang dapat diakses'}</option>{workspaceProjects.map(p=><option key={p.id} value={p.id}>{p.project_code?p.project_code+' · ':''}{p.name}</option>)}
            </select>
          </label>}
          {activeWorkspace?.type==='COMPANY'&&!activeWorkspace.active_persona_code&&<p className="rounded-lg bg-amber-50 p-2 text-[11px] text-amber-800 dark:bg-amber-950/30 dark:text-amber-200">Pilih Persona aktif terlebih dahulu. Project baru ditampilkan setelah resolver server memvalidasi Persona dan Project Membership.</p>}
          {activeWorkspace?.type==='PERSONAL'&&<p className="rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">Personal Workspace aktif. Kelola Personal Project melalui Workspace Center.</p>}
          {contextError&&<p role="alert" className="text-xs text-rose-600 dark:text-rose-300">{contextError}</p>}
          <div className="flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800"><span className="text-[10px] text-slate-400">{activePersona?activePersona.display_name:activeWorkspace?.type==='COMPANY'?'Persona belum dipilih':'Konteks server'}</span><button type="button" disabled={contextBusy} onClick={()=>setContextOpen(false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700">Tutup</button></div>
        </div>}
      </div>}

      <div className="hidden md:flex items-center gap-6 text-xs text-slate-500 dark:text-slate-400">
        <div className="flex items-center gap-2">
          <Building2 className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
          <button onClick={() => setCurrentView('workspaces')} className="font-medium text-blue-700 dark:text-blue-300 hover:underline">Workspace & Projects</button>
        </div>
        <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 dark:text-slate-500">Saldo Kas:</span>
          <span className="font-semibold text-emerald-600 dark:text-emerald-400 tabular-nums">
            {cashAccess ? formatRupiah(currentCashBalance) : 'Akses terbatas'}
          </span>
        </div>
        <span aria-hidden="true" className="text-slate-300 dark:text-slate-700">·</span>
        <div className="flex items-center gap-1.5">
          {supabaseConfig.isConnected ? (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
              <CloudCheck className="w-3.5 h-3.5" />
              <span>Database Supabase</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-slate-500 dark:text-slate-400">
              <CloudOff className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              <span>Database belum terhubung</span>
            </span>
          )}
        </div>
      </div>

      <div className="relative flex items-center gap-2.5 shrink-0">
        {user.id&&<div className="relative"><button type="button" onClick={()=>{const next=!notificationOpen;setNotificationOpen(next);if(next)void loadNotifications();}} aria-label={unreadCount?unreadCount+' notifikasi belum dibaca':'Notifikasi Project'} aria-expanded={notificationOpen} className="relative rounded-lg bg-slate-100 p-2 text-slate-600 transition-colors hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"><Bell className="h-4 w-4"/>{unreadCount>0&&<span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[9px] font-bold text-white">{unreadCount>9?'9+':unreadCount}</span>}</button>
          {notificationOpen&&<div className="absolute right-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"><div className="flex items-center justify-between gap-2 border-b p-3 dark:border-slate-800"><div><b className="text-xs">Notifikasi Project</b><p className="text-[10px] text-slate-500">{activeProject?.name||'Pilih Project'} · {unreadCount} belum dibaca</p></div><div className="flex gap-1"><button type="button" title="Perbarui" onClick={()=>void loadNotifications()} disabled={notificationLoading} className="rounded border p-1.5 text-slate-500 dark:border-slate-700"><RefreshCw className={'h-3.5 w-3.5 '+(notificationLoading?'animate-spin':'')}/></button><button type="button" title="Tandai semua dibaca" onClick={()=>void markAllNotificationsRead()} disabled={!unreadCount} className="rounded border p-1.5 text-slate-500 disabled:opacity-30 dark:border-slate-700"><CheckCheck className="h-3.5 w-3.5"/></button></div></div>
            {notificationError&&<p role="alert" className="p-3 text-[10px] text-rose-600">{notificationError}</p>}
            <div className="max-h-80 divide-y overflow-y-auto dark:divide-slate-800">{notificationLoading&&!notifications.length?<p className="p-4 text-center text-xs text-slate-500">Memuat notifikasi…</p>:notifications.length?notifications.map(n=><article key={n.id} className={'p-3 '+(!n.read_at?'bg-blue-50/70 dark:bg-blue-950/20':'')}><div className="flex items-start justify-between gap-2"><div className="min-w-0"><b className="text-xs">{n.title}</b><p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{n.body}</p><p className="mt-1 text-[9px] text-slate-400">{new Date(n.created_at).toLocaleString('id-ID')}</p></div><div className="flex shrink-0 flex-col items-end gap-1"><button type="button" onClick={()=>void openNotification(n)} className="text-[10px] font-semibold text-blue-700 underline dark:text-blue-300">Buka</button>{!n.read_at&&<button type="button" onClick={()=>void markNotificationRead(n.id)} className="text-[10px] text-slate-500 underline dark:text-slate-400">Dibaca</button>}</div></div></article>):<p className="p-5 text-center text-xs text-slate-500">Tidak ada notifikasi untuk Project aktif.</p>}</div>
            <div className="border-t p-2 dark:border-slate-800"><button type="button" onClick={()=>{setNotificationOpen(false);setCurrentView('operations');}} className="w-full rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Buka Operations Hub</button></div>
          </div>}
        </div>}
      </div>
      <div className="flex items-center gap-2.5 shrink-0">
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
          aria-label={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
          className="p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
        >
          {theme === 'dark' ? (
            <Sun className="w-4 h-4 text-amber-400 animate-in spin-in-90 duration-200" />
          ) : (
            <Moon className="w-4 h-4 text-slate-600 animate-in spin-in-90 duration-200" />
          )}
        </button>

        {stockWriteAccess && (
          <button
            onClick={() => setCurrentView('stock-mutations')}
            className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Catat Mutasi</span>
          </button>
        )}

        {user.id ? (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <img
                src={user.avatar_url || 'https://api.dicebear.com/7.x/initials/svg?seed=UDU'}
                alt={user.name}
                className="w-7 h-7 rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
              <div className="hidden lg:block text-left">
                <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 leading-tight flex items-center gap-1">
                  {user.name}
                  <ShieldCheck className="w-3 h-3 text-blue-600 inline" />
                </div>
                <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-none">{activeContext?.is_platform_super_admin?'Platform Super Admin':activePersona?.display_name||(activeWorkspace?.type==='COMPANY'?'Company Member':'Personal User')}</div>
              </div>
            </div>
            <button
              onClick={logout}
              title="Keluar akun"
              className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-md transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
};
