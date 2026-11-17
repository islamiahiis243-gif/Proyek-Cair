import React from 'react';
import {BookOpen} from 'lucide-react';
import {useApp} from '../context/AppContext';
import {LayoutDashboard,Boxes,ArrowLeftRight,WalletCards,FileText,QrCode,Settings,HardHat,AlertCircle,CalendarClock,ClipboardList,Layers,Truck,type LucideIcon} from 'lucide-react';
export const Sidebar:React.FC=()=>{
 const {currentView,setCurrentView,outOfStockCount,activeContext,activeWorkspaceId,activeProject}=useApp();
 const activeWorkspace=activeContext?.workspaces.find(w=>w.id===activeWorkspaceId)||null;
 const activePersona=activeWorkspace?.personas?.find(p=>p.persona_code===activeWorkspace.active_persona_code)||null;
 const permissions=new Set(activeProject?.permissions||[]);
 const hasAny=(codes:string[])=>Boolean(activeProject&&activeProject.workspace_id===activeWorkspaceId&&codes.some(code=>permissions.has(code)));
 const navItems:Array<{id:string;label:string;icon:LucideIcon;badge?:string|null;requires?:string[]}>= [
  {id:'dashboard',label:'Dashboard Analitik',icon:LayoutDashboard},
  {id:'workspaces',label:'Workspace & Personal Projects',icon:Layers},
  {id:'operations',label:'Operasi Terintegrasi',icon:ClipboardList,requires:['personnel.roster.manage','data.import','data.export','k3.report.close','progress.read','k3.read','project.read','document.read','document.qr.scan','document.qr.verify','workflow.read','workflow.step.act','notification.read','notification.preference.update','procurement.read','boq.read','inventory.read','cash.read','workflow.start','workflow.definition.create','workflow.definition.update','progress.create','k3.report.create','project.media.create','document.create','document.void','document.replace','workflow.delegate','workflow.reassign','workflow.cancel','procurement.create','procurement.submit','procurement.issue_order','procurement.receive','boq.create','boq.update','boq.addition.create','audit.read','project.update','project.close','procurement.update','inventory.movement.create','inventory.movement.reverse','cash.transaction.create','cash.transaction.reverse']},
  {id:'project-control',label:'Jadwal, Tambahan & Audit',icon:CalendarClock,requires:['project.read','procurement.read','boq.read','audit.read']},
  {id:'procurement',label:'Pengadaan & Penerimaan',icon:Truck,requires:['procurement.read']},
  {id:'inventory',label:'Katalog & Stok Barang',icon:Boxes,requires:['boq.read'],badge:outOfStockCount>0?`${outOfStockCount} Kosong`:null},
  {id:'stock-mutations',label:'Mutasi Keluar / Masuk',icon:ArrowLeftRight,requires:['boq.read']},
  {id:'cashflow',label:'Mutasi Kas Keuangan',icon:WalletCards,requires:['cash.read']},
  {id:'reports',label:'Laporan & Ekspor PDF',icon:FileText,requires:['inventory.read','cash.read','document.read'],badge:'Checksum'},
  {id:'verification',label:'Pemeriksaan Checksum Laporan',icon:QrCode,requires:['document.read']},
  {id:'settings',label:'Sinkronisasi & Supabase',icon:Settings}
 ];
 const contextTitle=activeProject?.name||activeWorkspace?.name||'Workspace belum dipilih';
 const contextSubtitle=activeWorkspace?.type==='COMPANY'
  ?(activePersona?.display_name||'Pilih Persona aktif')
  :activeWorkspace?.type==='PERSONAL'?'Personal Workspace':'Pilih Workspace untuk memulai';
 return <aside className="flex w-full shrink-0 flex-col border-b border-slate-800 bg-slate-900 text-slate-300 md:min-h-[calc(100vh-57px)] md:w-64 md:border-b-0 md:border-r">
  <div className="border-b border-slate-800 p-3 md:p-4">
   <div className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-700/60 bg-slate-800/80 p-3">
    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-blue-500/20 text-blue-400"><HardHat className="h-4 w-4"/></div>
    <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-white">{contextTitle}</div><div className="truncate text-[11px] text-slate-400">{contextSubtitle}</div></div>
   </div>
   {outOfStockCount>0&&<div className="mt-3 flex items-center gap-1.5 rounded-md border border-rose-800/50 bg-rose-950/40 px-2.5 py-1.5 text-[11px] text-rose-300"><AlertCircle className="h-3.5 w-3.5"/>{outOfStockCount} item belum tersedia</div>}
  </div>
  <nav aria-label="Navigasi utama" className="flex gap-1 overflow-x-auto p-2 md:flex-1 md:flex-col md:overflow-y-auto md:overflow-x-hidden md:p-3">
   {navItems.filter(item=>!item.requires||hasAny(item.requires)).map(item=>{const Icon=item.icon;const active=currentView===item.id;return <button key={item.id} type="button" aria-current={active?'page':undefined} onClick={()=>setCurrentView(item.id)} className={`flex w-auto shrink-0 items-center justify-between gap-3 whitespace-nowrap rounded-lg px-3 py-2.5 text-xs font-medium transition-all md:w-full ${active?'bg-blue-600 text-white':'text-slate-300 hover:bg-slate-800/70 hover:text-white'}`}><span className="flex min-w-0 items-center gap-3"><Icon className="h-4 w-4 shrink-0"/><span className="truncate">{item.label}</span></span>{item.badge&&<span className="text-[10px]">{item.badge}</span>}</button>})}
  </nav>
  {!activeProject&&activeWorkspace?.type==='COMPANY'&&<p className="px-4 pb-3 text-[10px] leading-4 text-amber-300 md:pb-4">Pilih Project operasional aktif untuk menampilkan menu sesuai permission.</p>}
  <div className="hidden border-t border-slate-800 p-4 text-[11px] text-slate-500 md:block">
   <a href="/guide/workspace-center" target="_blank" rel="noreferrer" className="mb-3 flex items-center gap-2 text-blue-400 hover:text-blue-300"><BookOpen className="h-4 w-4"/>Panduan Workspace Center</a>
   <div className="flex justify-between"><span>Sumber data</span><span className="font-mono text-slate-400">Supabase</span></div>
   <div className="mt-1 text-[10px]">Data operasional tersimpan di database</div>
  </div>
 </aside>;
};
