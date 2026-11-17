import React, { createContext, useContext, useEffect, useState } from 'react';
import { ItemBarang, MutasiBarang, MutasiKas, DokumenLaporan, UserProfile, SupabaseConfig, AvailabilityStatus, BoqSection } from '../types';
import { getStoredConfig, getStoredUser, saveStoredUser, initiateGoogleSignIn, DEFAULT_USER, getSupabaseClient, signOutSupabase, resolveMyActiveContext, ActiveContext } from '../lib/supabase';

interface AppContextType {
  activeContext: ActiveContext | null;
  activeWorkspaceId: string;
  activeProjectId: string;
  activeProject: ActiveContext['projects'][number] | null;
  hasActiveProjectScope: boolean;
  setActiveProjectId: (id:string)=>void;
  refreshActiveContext: ()=>Promise<void>;
  refreshData: ()=>Promise<void>;
  setActiveWorkspaceId: (id:string)=>void;
  items: ItemBarang[];
  boqSections: BoqSection[];
  stockMutations: MutasiBarang[];
  cashMutations: MutasiKas[];
  documents: DokumenLaporan[];
  user: UserProfile;
  supabaseConfig: SupabaseConfig;
  currentView: string;
  setCurrentView: (view:string)=>void;
  verifyingDocId: string | null;
  setVerifyingDocId: (id:string|null)=>void;
  addStockMutation: (mutation:Omit<MutasiBarang,'id'|'stok_sebelum'|'stok_sesudah'>)=>Promise<{success:boolean;message:string}>;
  reverseStockMutation: (id:string,reason:string)=>Promise<{success:boolean;message:string}>;
 reverseCashMutation: (id:string,reason:string)=>Promise<{success:boolean;message:string}>;
  addCashMutation: (cash:Omit<MutasiKas,'id'|'saldo_setelah'>)=>Promise<{success:boolean;message:string}>;
  addDocument: (doc:DokumenLaporan)=>Promise<void>;
  logout: ()=>Promise<void>;
  totalStockAssetValue:number;
  currentCashBalance:number;
  outOfStockCount:number;
  lowStockCount:number;
  availableStockCount:number;
  theme:'light'|'dark';
  toggleTheme:()=>void;
  dataReady:boolean;
  dataError:string|null;
  cashAccess:boolean;
  cashWriteAccess:boolean;
  cashHasEntries:boolean;
  recordedStockCount:number;
  unrecordedStockCount:number;
  stockWriteAccess:boolean;
}
const AppContext=createContext<AppContextType|undefined>(undefined);
const THEME_KEY='proyek_cair_theme';
const offlineLedgerStore={async db():Promise<IDBDatabase>{return new Promise((resolve,reject)=>{const r=indexedDB.open('proyek-cair-offline',1);r.onupgradeneeded=()=>r.result.createObjectStore('queue',{keyPath:'client_key'});r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});},async all():Promise<any[]>{const d=await this.db();return new Promise((resolve,reject)=>{const r=d.transaction('queue').objectStore('queue').getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error);});},async put(row:any){const d=await this.db();return new Promise<void>((resolve,reject)=>{const r=d.transaction('queue','readwrite').objectStore('queue').put(row);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});},async del(key:string){const d=await this.db();return new Promise<void>((resolve,reject)=>{const r=d.transaction('queue','readwrite').objectStore('queue').delete(key);r.onsuccess=()=>resolve();r.onerror=()=>reject(r.error);});}};

export function computeItemStatus(stok:number,minStok:number,hasHistory=true):AvailabilityStatus {
  if(!hasHistory)return 'Belum Dicatat';
  if(stok<=0)return 'Tidak Tersedia';
  if(stok<=minStok)return 'Stok Menipis';
  return 'Tersedia';
}
export const AppProvider:React.FC<{children:React.ReactNode}>=({children})=>{
 const [activeContext,setActiveContext]=useState<ActiveContext|null>(null);
 const [activeWorkspaceId,setActiveWorkspaceIdState]=useState(()=>localStorage.getItem('udu_active_workspace')||'');
 const [activeProjectId,setActiveProjectIdState]=useState(()=>localStorage.getItem('udu_active_project')||'');
 const activeProject=activeContext?.projects.find(p=>p.id===activeProjectId&&p.workspace_id===activeWorkspaceId)||null;
 const hasActiveProjectScope=Boolean(activeContext&&activeProject&&activeContext.projects.some(p=>p.id===activeProject.id&&p.workspace_id===activeWorkspaceId));
 const setActiveWorkspaceId=(id:string)=>{ if(!activeContext?.workspaces.some(w=>w.id===id)) throw new Error('Workspace tidak termasuk dalam akses aktif dari server.'); setActiveWorkspaceIdState(id); localStorage.setItem('udu_active_workspace',id); setActiveProjectIdState('');localStorage.removeItem('udu_active_project'); };
 const setActiveProjectId=(id:string)=>{ const project=activeContext?.projects.find(p=>p.id===id&&p.workspace_id===activeWorkspaceId); if(!project) throw new Error('Project tidak termasuk dalam membership aktif pada workspace terpilih.');setActiveProjectIdState(id);localStorage.setItem('udu_active_project',id); };
 const refreshActiveContext=async()=>{ const next=await resolveMyActiveContext(); if(next.user_id!==user.id) throw new Error('Identitas konteks tidak cocok dengan sesi aplikasi.'); setActiveContext(next); if(activeWorkspaceId&&!next.workspaces.some(w=>w.id===activeWorkspaceId)){setActiveWorkspaceIdState('');localStorage.removeItem('udu_active_workspace');setActiveProjectIdState('');localStorage.removeItem('udu_active_project');} if(activeProjectId&&!next.projects.some(p=>p.id===activeProjectId&&p.workspace_id===activeWorkspaceId)){setActiveProjectIdState('');localStorage.removeItem('udu_active_project');} };
 const [items,setItems]=useState<ItemBarang[]>([]);
 const [boqSections,setBoqSections]=useState<BoqSection[]>([]);
 const [stockMutations,setStockMutations]=useState<MutasiBarang[]>([]);
 const [cashMutations,setCashMutations]=useState<MutasiKas[]>([]);
 const [documents,setDocuments]=useState<DokumenLaporan[]>([]);
 const [user,setUser]=useState<UserProfile>(()=>getStoredUser());
 const [supabaseConfig]=useState<SupabaseConfig>(()=>getStoredConfig());
 const [currentView,setCurrentView]=useState('dashboard');
 const [verifyingDocId,setVerifyingDocId]=useState<string|null>(null);
 const [dataReady,setDataReady]=useState(false);
 const [dataError,setDataError]=useState<string|null>(null);
 const [cashAccess,setCashAccess]=useState(false);
 const cashWriteAccess=Boolean(activeProject?.permissions.includes('cash.transaction.create'));
 const stockWriteAccess=Boolean(activeProject?.permissions.includes('inventory.movement.create'));
 const [theme,setTheme]=useState<'light'|'dark'>(()=>{try{const v=localStorage.getItem(THEME_KEY);if(v==='dark'||v==='light')return v;}catch{}return 'dark';});
 useEffect(()=>{document.documentElement.classList.toggle('dark',theme==='dark');localStorage.setItem(THEME_KEY,theme);},[theme]);
 const toggleTheme=()=>setTheme(v=>v==='light'?'dark':'light');
 useEffect(()=>{const p=new URLSearchParams(window.location.search);const id=p.get('verify_doc');if(id){setVerifyingDocId(id);setCurrentView('verification');}},[]);
 const requireProjectPermission=(permission:string)=>{ if(!activeContext||!activeProject||activeProject.workspace_id!==activeWorkspaceId)throw new Error('Pilih Project aktif yang telah diverifikasi server sebelum mengakses data operasional.');if(!activeProject.permissions.includes(permission))throw new Error('Akses ditolak: permission '+permission+' tidak diberikan pada Project aktif.');return activeProject; };
 const refreshData=async()=>{
  const next=await resolveMyActiveContext();
  if(next.user_id!==user.id)throw new Error('Identitas konteks tidak cocok dengan sesi aplikasi.');
  setActiveContext(next);
  const selectedProject=next.projects.find(p=>p.id===activeProjectId&&p.workspace_id===activeWorkspaceId);
  if(!selectedProject){
   setActiveProjectIdState('');localStorage.removeItem('udu_active_project');
   setItems([]);setBoqSections([]);setStockMutations([]);setCashMutations([]);setDocuments([]);setCashAccess(false);
   setDataError(next.projects.length?'Pilih Project dari Workspace Center untuk memuat data.':'Belum ada Project Membership aktif. Data legacy tidak ditampilkan tanpa scope proyek kanonis.');
   setDataReady(true);return;
  }
  const client=getSupabaseClient();
  const canReadBoq=selectedProject.permissions.includes('boq.read');
  const canReadInventory=selectedProject.permissions.includes('inventory.read');
  const canReadCash=selectedProject.permissions.includes('cash.read');
  const canReadDocuments=selectedProject.permissions.includes('document.read');
  const scope=(query:any)=>query.eq('workspace_id',selectedProject.workspace_id).eq('project_id',selectedProject.id);
  const [boqRes,sectionsRes,stockRes,cashRes,docsRes,additionsRes,reversalsRes]=await Promise.all([
   canReadBoq?scope(client.from('boq_items').select('*').eq('is_active',true)).order('source_row'):{data:[],error:null},
   canReadBoq?scope(client.from('boq_sections').select('*').eq('is_active',true)).order('sort_order'):{data:[],error:null},
   canReadInventory?scope(client.from('inventory_transactions').select('*')).order('occurred_at',{ascending:true}).order('created_at',{ascending:true}):{data:[],error:null},
   canReadCash?scope(client.from('cash_transactions').select('*')).order('occurred_at',{ascending:true}).order('created_at',{ascending:true}):{data:[],error:null},
   canReadDocuments?scope(client.from('documents').select('*').in('document_type',['MUTASI_KAS','MUTASI_STOK'])).order('created_at',{ascending:false}):{data:[],error:null},
   canReadBoq?scope(client.from('boq_additions').select('item_id,quantity,approval_status').eq('approval_status','DISETUJUI')):{data:[],error:null},
   canReadInventory?scope(client.from('inventory_transaction_reversals').select('original_transaction_id')):{data:[],error:null}
  ]);
  for(const result of [boqRes,sectionsRes,stockRes,cashRes,docsRes,additionsRes,reversalsRes])if(result.error)throw result.error;
  const reversedIds=new Set((reversalsRes.data||[]).map((r:any)=>r.original_transaction_id));
  const approvedAdds=new Map<string,number>();(additionsRes.data||[]).forEach((a:any)=>{if(a.item_id)approvedAdds.set(a.item_id,(approvedAdds.get(a.item_id)||0)+Number(a.quantity));});
  const balance=new Map<string,number>();const received=new Map<string,number>();const consumed=new Map<string,number>();
  const stockHistory=new Set<string>((stockRes.data||[]).map((t:any)=>t.item_id));
  const stockRows:MutasiBarang[]=(stockRes.data||[]).map((t:any)=>{const ownerKey=`${t.item_id}:${t.owner_type||'KONTRAKTOR'}`;const before=balance.get(ownerKey)||0;const incoming=['MASUK','PENYESUAIAN_MASUK'].includes(t.transaction_type);const delta=incoming?Number(t.quantity):-Number(t.quantity);const after=before+delta;balance.set(ownerKey,after);if(!reversedIds.has(t.id)&&t.transaction_type==='MASUK')received.set(ownerKey,(received.get(ownerKey)||0)+Number(t.quantity));if(!reversedIds.has(t.id)&&t.transaction_type==='KELUAR')consumed.set(ownerKey,(consumed.get(ownerKey)||0)+Number(t.quantity));return {id:t.id,barang_id:t.item_id,nama_barang:'',jenis:incoming?'MASUK':'KELUAR',jumlah:Number(t.quantity),satuan:t.uom,tujuan_keperluan:t.purpose||t.location||t.notes||'-',pic_penerima_penyerah:t.counterparty||'-',nomor_surat_jalan:t.reference_no||undefined,tanggal:t.occurred_at,stok_sebelum:before,stok_sesudah:after,catatan:t.notes||undefined,source_name:t.source_name||undefined,destination_name:t.destination_name||undefined,recipient_name:t.recipient_name||undefined,owner_type:t.owner_type||'KONTRAKTOR',purpose:t.purpose||undefined,addition_id:t.addition_id||undefined,created_by_name:t.created_by_name||t.created_by||'-'};});
  const mappedItems:ItemBarang[]=(boqRes.data||[]).map((b:any)=>{const baseTarget=Number(b.quantity)||0;const additionalTarget=approvedAdds.get(b.id)||0;const target=baseTarget+additionalTarget;const ownerType=(b.remarks||'').toLowerCase().includes('by imk')?'IMK':'KONTRAKTOR';const ownerKey=`${b.id}:${ownerType}`;const masuk=received.get(ownerKey)||0;const keluar=consumed.get(ownerKey)||0;const progress=target>0?(masuk/target)*100:0;const statusPemenuhan:ItemBarang['status_pemenuhan']=masuk>target?'Melebihi BOQ':masuk>=target&&target>0?'Terpenuhi':masuk>0?'Dalam pemenuhan':'Belum dipenuhi';return {id:b.id,parent_section_id:b.parent_section_id||null,source_excel_row:b.source_excel_row??null,source_qty:b.quantity==null?null:Number(b.quantity),source_uom:b.uom??null,kode_boq:b.boq_code,source_sheet:b.source_sheet,source_row:b.source_row,nama_barang:b.description,kategori:b.category||'Tanpa kategori',qty_boq:baseTarget,qty_tambahan_disetujui:additionalTarget,target_kebutuhan_total:target,is_stock_item:Boolean(b.is_stock_item),has_stock_history:stockHistory.has(b.id),qty_masuk_total:masuk,qty_keluar_total:keluar,qty_pemenuhan_sisa:Math.max(target-masuk,0),progress_pemenuhan:progress,status_pemenuhan:statusPemenuhan,satuan:b.uom,harga_satuan:Number(b.unit_rate||0),stok_saat_ini:balance.get(ownerKey)||0,stok_minimum:0,status:computeItemStatus(balance.get(ownerKey)||0,0,stockHistory.has(b.id)),keterangan:b.remarks||''};});
  const nameById=new Map(mappedItems.map(x=>[x.id,x.nama_barang]));stockRows.forEach(x=>{x.nama_barang=nameById.get(x.barang_id)||'Item BOQ';});
  let cashBalance=0;const cashRows:MutasiKas[]=(cashRes.data||[]).map((t:any)=>{const incoming=t.transaction_type==='MASUK';cashBalance+=incoming?Number(t.amount):-Number(t.amount);return {id:t.id,jenis:t.transaction_type,jumlah_rp:Number(t.amount),untuk_apa:t.description,kategori_keperluan:(t.category||'Lainnya') as MutasiKas['kategori_keperluan'],pic:t.pic||'-',nomor_kuitansi:t.reference_no||undefined,tanggal:t.occurred_at,saldo_setelah:cashBalance,catatan:t.notes||undefined};});
  const docs:DokumenLaporan[]=(docsRes.data||[]).map((d:any)=>({id:d.document_no,judul:d.title,jenis:d.document_type as DokumenLaporan['jenis'],status:d.status||'DRAFT',periode_awal:d.period_start||'',periode_akhir:d.period_end||'',dibuat_pada:d.created_at,penandatangan_nama:d.signer_name||'',penandatangan_jabatan:d.signer_role||'',penandatangan_email:d.signer_email||'',hash_keamanan:d.content_sha256||'',total_transaksi:Number(d.total_transactions||0),ringkasan_nilai_rp:Number(d.amount_summary||0),qr_payload:d.qr_payload||'',verification_token:d.verification_token||undefined,snapshot_json:d.snapshot?JSON.stringify(d.snapshot):undefined,document_no:d.document_no,title:d.title,document_type:d.document_type,created_at:d.created_at,issued_at:d.issued_at,revision_number:d.revision_number,lifecycle_status:d.lifecycle_status,revoked_at:d.revoked_at,replaces_document_id:d.replaces_document_id,replaced_by_document_id:d.replaced_by_document_id,content_sha256:d.content_sha256,signer_name:d.signer_name,signer_role:d.signer_role,approval_level:d.approval_level,workspace_id:d.workspace_id,project_id:d.project_id}));
  const sectionRows:BoqSection[]=(sectionsRes.data||[]).map((s:any)=>({id:s.id,source_sheet:s.source_sheet,source_row:s.source_row,node_code:s.node_code,description:s.description,level:s.level,parent_id:s.parent_id,sort_order:s.sort_order,source_color:s.source_color,source_qty:s.source_qty,source_uom:s.source_uom,source_total_price:s.source_total_price,calculated_total_price:Number(s.source_total_price||0),quantities_by_uom:{},item_count:0,source_total_variance:0}));
  setItems(mappedItems);setBoqSections(sectionRows);setStockMutations(stockRows.reverse());setCashMutations(cashRows.reverse());setCashAccess(canReadCash);setDocuments(docs);setDataError(null);setDataReady(true);
 };
 useEffect(()=>{if(!user.id)return;let live=true;setDataReady(false);refreshData().catch((e:any)=>{if(live){setDataError(e.message||'Gagal memuat data dari Supabase.');setDataReady(true);}});return()=>{live=false;};},[user.id,activeProjectId,activeWorkspaceId]);
 // Legacy offline queue replay is deliberately paused. Its payload has no verified workspace/project binding and its RPC targets are not yet project-scoped.
 const addStockMutation=async(data:Omit<MutasiBarang,'id'|'stok_sebelum'|'stok_sesudah'>)=>{
  try{const project=requireProjectPermission('inventory.movement.create');const {error}=await getSupabaseClient().rpc('record_inventory_mutation_scoped',{
   p_workspace_id:project.workspace_id,p_project_id:project.id,p_idempotency_key:crypto.randomUUID(),p_item_id:data.barang_id,
   p_type:data.jenis,p_quantity:data.jumlah,p_occurred_at:data.tanggal,p_reference_no:data.nomor_surat_jalan||null,
   p_counterparty:data.pic_penerima_penyerah,p_location:data.destination_name||data.tujuan_keperluan,p_notes:data.catatan||null,
   p_source_name:data.source_name||'Lokasi asal',p_destination_name:data.destination_name||'Lokasi proyek',
   p_recipient_name:data.recipient_name||data.pic_penerima_penyerah,p_owner_type:data.owner_type||'KONTRAKTOR',
   p_purpose:data.purpose||data.tujuan_keperluan,p_addition_id:data.addition_id||null
  });if(error)throw error;await refreshData();return {success:true,message:'Mutasi inventaris tercatat pada Project aktif.'};}
  catch(e:any){return {success:false,message:e.message||'Mutasi inventaris gagal.'};}
 };
 const reverseStockMutation=async(id:string,reason:string)=>{
  try{const project=requireProjectPermission('inventory.movement.reverse');if(reason.trim().length<8)throw new Error('Alasan koreksi minimal 8 karakter.');const {error}=await getSupabaseClient().rpc('reverse_inventory_transaction_scoped',{p_workspace_id:project.workspace_id,p_project_id:project.id,p_transaction_id:id,p_reason:reason.trim(),p_idempotency_key:crypto.randomUUID()});if(error)throw error;await refreshData();return {success:true,message:'Transaksi pembalik tercatat; ledger asli tidak diubah.'};}
  catch(e:any){return {success:false,message:e.message||'Pembalikan inventaris gagal.'};}
 };
 const addCashMutation=async(data:Omit<MutasiKas,'id'|'saldo_setelah'>)=>{
  try{const project=requireProjectPermission('cash.transaction.create');const {error}=await getSupabaseClient().rpc('record_cash_mutation_scoped',{
   p_workspace_id:project.workspace_id,p_project_id:project.id,p_idempotency_key:crypto.randomUUID(),p_type:data.jenis,
   p_amount:data.jumlah_rp,p_occurred_at:data.tanggal,p_category:data.kategori_keperluan,p_description:data.untuk_apa,
   p_reference_no:data.nomor_kuitansi||null,p_pic:data.pic,p_notes:data.catatan||null
  });if(error)throw error;await refreshData();return {success:true,message:'Transaksi kas tercatat pada Project aktif.'};}
  catch(e:any){return {success:false,message:e.message||'Transaksi kas gagal.'};}
 };
 const reverseCashMutation=async(id:string,reason:string)=>{
  try{const project=requireProjectPermission('cash.transaction.reverse');if(reason.trim().length<8)throw new Error('Alasan koreksi minimal 8 karakter.');const {error}=await getSupabaseClient().rpc('reverse_cash_transaction_scoped',{p_workspace_id:project.workspace_id,p_project_id:project.id,p_transaction_id:id,p_reason:reason.trim(),p_idempotency_key:crypto.randomUUID()});if(error)throw error;await refreshData();return {success:true,message:'Transaksi pembalik kas tercatat; ledger asli tidak diubah.'};}
  catch(e:any){return {success:false,message:e.message||'Pembalikan kas gagal.'};}
 };
 const addDocument=async(_doc:DokumenLaporan)=>{requireProjectPermission('document.create');throw new Error('Pembuatan dokumen dinonaktifkan sementara sampai INSERT memiliki enforcement project scope di database.');};
 const logout=async()=>{try{await signOutSupabase();}finally{setUser({...DEFAULT_USER,id:'',email:''});}};
 const stockItems=items.filter(x=>x.is_stock_item);
 const totalStockAssetValue=stockItems.reduce((s,x)=>s+x.stok_saat_ini*x.harga_satuan,0);
 const currentCashBalance=cashMutations[0]?.saldo_setelah??0;
 const cashHasEntries=cashMutations.length>0;
 const recordedStockCount=stockItems.filter(x=>x.has_stock_history).length;
 const unrecordedStockCount=stockItems.length-recordedStockCount;
 const outOfStockCount=stockItems.filter(x=>x.has_stock_history&&x.stok_saat_ini<=0).length;
 const lowStockCount=stockItems.filter(x=>x.stok_saat_ini>0&&x.stok_saat_ini<=x.stok_minimum).length;
 const availableStockCount=stockItems.filter(x=>x.has_stock_history&&x.stok_saat_ini>x.stok_minimum).length;
 return <AppContext.Provider value={{activeContext,activeWorkspaceId,activeProjectId,activeProject,hasActiveProjectScope,setActiveProjectId,refreshActiveContext,refreshData,setActiveWorkspaceId,items,boqSections,stockMutations,cashMutations,documents,user,supabaseConfig,currentView,setCurrentView,verifyingDocId,setVerifyingDocId,addStockMutation,reverseStockMutation,reverseCashMutation,addCashMutation,addDocument,logout,totalStockAssetValue,currentCashBalance,outOfStockCount,lowStockCount,availableStockCount,theme,toggleTheme,dataReady,dataError,cashAccess,cashWriteAccess,stockWriteAccess,cashHasEntries,recordedStockCount,unrecordedStockCount}}>{children}</AppContext.Provider>;
};
export const useApp=()=>{const c=useContext(AppContext);if(!c)throw new Error('useApp must be used within AppProvider');return c;};
