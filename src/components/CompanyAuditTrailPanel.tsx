import React,{useCallback,useEffect,useMemo,useState} from 'react';
import {Activity,RefreshCw,Search} from 'lucide-react';
import {getSupabaseClient} from '../lib/supabase';

type AuditRow={id:number;actor_id:string|null;action:string;entity_type:string;entity_id:string|null;project_id:string|null;details:Record<string,unknown>|null;created_at:string};

export const CompanyAuditTrailPanel:React.FC<{workspaceId:string;canAdmin:boolean}> = ({workspaceId,canAdmin})=>{
 const db=getSupabaseClient();
 const [rows,setRows]=useState<AuditRow[]>([]);
 const [query,setQuery]=useState('');
 const [loading,setLoading]=useState(false);
 const [error,setError]=useState('');
 const refresh=useCallback(async()=>{
  if(!workspaceId||!canAdmin){setRows([]);return;}
  setLoading(true);setError('');
  try{const {data,error}=await db.rpc('list_company_audit_events',{p_workspace_id:workspaceId,p_limit:100,p_before:null});if(error)throw error;setRows((data||[]) as AuditRow[]);}
  catch(e:any){setError(e?.message||'Audit trail perusahaan gagal dimuat.');}
  finally{setLoading(false);}
 },[db,workspaceId,canAdmin]);
 useEffect(()=>{void refresh();},[refresh]);
 const filtered=useMemo(()=>{const q=query.trim().toLowerCase();if(!q)return rows;return rows.filter(r=>[r.action,r.entity_type,r.entity_id||'',r.project_id||'',JSON.stringify(r.details||{})].join(' ').toLowerCase().includes(q));},[rows,query]);
 if(!canAdmin)return null;
 return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><Activity className="h-5 w-5 text-blue-600"/>Audit Trail Perusahaan</h2><p className="mt-1 text-xs leading-5 text-slate-500">Riwayat administratif tenant, assignment, RFIN-B, workflow dan perubahan scope. Akses dibatasi Company Super Admin dan detail sensitif disamarkan.</p></div><button type="button" onClick={()=>void refresh()} disabled={loading} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs dark:border-slate-700"><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')}/>Perbarui</button></div>
  {error&&<div role="alert" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
  <label className="mt-4 flex items-center gap-2 rounded-lg border px-3 py-2 dark:border-slate-700"><Search className="h-4 w-4 text-slate-400"/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Cari aksi, entitas, Project, atau detail…" className="w-full bg-transparent text-xs outline-none"/></label>
  <div className="mt-3 space-y-2">{loading&&!rows.length?<p className="py-6 text-center text-xs text-slate-500">Memuat audit trail…</p>:filtered.length?filtered.map(row=><article key={row.id} className="rounded-lg border p-3 dark:border-slate-800"><div className="flex flex-wrap items-start justify-between gap-2"><div><b className="text-xs">{row.action}</b><p className="mt-0.5 text-[11px] text-slate-500">{row.entity_type}{row.entity_id?' · '+row.entity_id:''}{row.project_id?' · Project '+row.project_id.slice(0,8):''}</p></div><time className="text-[10px] text-slate-500">{new Date(row.created_at).toLocaleString('id-ID')}</time></div><p className="mt-2 text-[10px] text-slate-500">Actor {row.actor_id?row.actor_id.slice(0,8)+'…':'System'}</p>{row.details&&Object.keys(row.details).length>0&&<details className="mt-2"><summary className="cursor-pointer text-[10px] text-blue-600">Detail audit</summary><pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-[10px] dark:bg-slate-950">{JSON.stringify(row.details,null,2)}</pre></details>}</article>):<p className="rounded-lg border border-dashed p-6 text-center text-xs text-slate-500 dark:border-slate-700">{query?'Tidak ada audit yang cocok dengan pencarian.':'Belum ada event audit pada workspace ini.'}</p>}</div>
  <p className="mt-3 text-[10px] text-slate-500">Menampilkan maksimal 100 event terbaru. Audit bersifat append-only; panel ini hanya menyediakan pembacaan.</p>
 </section>;
};
