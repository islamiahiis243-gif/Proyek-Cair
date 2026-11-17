import React,{useCallback,useEffect,useState} from 'react';
import {CalendarDays,RefreshCw,Trash2} from 'lucide-react';
import {getSupabaseClient} from '../lib/supabase';

type Holiday={id:string;holiday_date:string;label:string;created_at:string};

export const CompanyBusinessCalendarPanel:React.FC<{workspaceId:string;canAdmin:boolean}> = ({workspaceId,canAdmin})=>{
 const db=getSupabaseClient();
 const [rows,setRows]=useState<Holiday[]>([]);
 const [date,setDate]=useState(new Date().toISOString().slice(0,10));
 const [label,setLabel]=useState('');
 const [reason,setReason]=useState('');
 const [busy,setBusy]=useState(false);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [removeDraft,setRemoveDraft]=useState<Holiday|null>(null);
 const [removeReason,setRemoveReason]=useState('');
 const refresh=useCallback(async()=>{
  if(!workspaceId||!canAdmin){setRows([]);setLoading(false);return;}
  setLoading(true);setError('');
  try{const {data,error}=await db.from('workspace_business_holidays').select('id,holiday_date,label,created_at').eq('workspace_id',workspaceId).order('holiday_date');if(error)throw error;setRows((data||[]) as Holiday[]);}
  catch(e:any){setError(e?.message||'Kalender hari kerja gagal dimuat.');}
  finally{setLoading(false);}
 },[db,workspaceId,canAdmin]);
 useEffect(()=>{setRemoveDraft(null);setRemoveReason('');void refresh();},[refresh]);
 const save=async(e:React.FormEvent)=>{
  e.preventDefault();if(busy||!canAdmin)return;
  if(!date||label.trim().length<2||reason.trim().length<8){setError('Tanggal, nama hari libur, dan alasan minimal 8 karakter wajib diisi.');return;}
  setBusy(true);setError('');setNotice('');
  try{const {error}=await db.rpc('set_workspace_business_holiday',{p_workspace_id:workspaceId,p_holiday_date:date,p_label:label.trim(),p_is_holiday:true,p_reason:reason.trim()});if(error)throw error;setNotice('Hari libur perusahaan disimpan. SLA workflow berikutnya akan melewati tanggal ini.');setLabel('');setReason('');await refresh();}
  catch(e:any){setError(e?.message||'Hari libur gagal disimpan.');}
  finally{setBusy(false);}
 };
 const remove=(item:Holiday)=>{if(busy)return;setRemoveDraft(item);setRemoveReason('');setError('');setNotice('');};
 const confirmRemove=async(e:React.FormEvent)=>{e.preventDefault();if(!removeDraft||busy)return;const why=removeReason.trim();if(why.length<8||why.length>500){setError('Alasan penghapusan wajib 8–500 karakter.');return;}setBusy(true);setError('');setNotice('');try{const {error}=await db.rpc('set_workspace_business_holiday',{p_workspace_id:workspaceId,p_holiday_date:removeDraft.holiday_date,p_label:removeDraft.label,p_is_holiday:false,p_reason:why});if(error)throw error;setNotice('Hari libur dihapus dan perubahan dicatat dalam audit.');setRemoveDraft(null);setRemoveReason('');await refresh();}catch(e:any){setError(e?.message||'Hari libur gagal dihapus.');}finally{setBusy(false);}};
 if(!canAdmin)return null;
 return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 font-semibold"><CalendarDays className="h-5 w-5 text-blue-600"/>Kalender hari kerja</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-slate-500">Hari libur tenant dikecualikan dari perhitungan SLA workflow. Default hari kerja Senin–Jumat, pukul 08.00–17.00 Asia/Jakarta. Pengingat dan eskalasi tidak pernah menyetujui workflow secara otomatis.</p></div><button type="button" onClick={()=>void refresh()} disabled={loading||busy} className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs dark:border-slate-700"><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')}/>Perbarui</button></div>
  {error&&<div role="alert" className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">{error}</div>}
  {notice&&<div role="status" aria-live="polite" className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200">{notice}</div>}
  <form onSubmit={save} className="mt-4 grid gap-3 md:grid-cols-[1fr_1.4fr_1.6fr_auto] md:items-end">
   <label className="text-xs font-medium">Tanggal libur<input type="date" required value={date} onChange={e=>setDate(e.target.value)} disabled={busy} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label>
   <label className="text-xs font-medium">Nama / keterangan<input required minLength={2} maxLength={160} value={label} onChange={e=>setLabel(e.target.value)} disabled={busy} placeholder="Contoh: Libur nasional" className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label>
   <label className="text-xs font-medium">Alasan audit<input required minLength={8} maxLength={500} value={reason} onChange={e=>setReason(e.target.value)} disabled={busy} placeholder="Dasar penetapan hari libur" className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700"/></label>
   <button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-50">{busy?'Menyimpan…':'Tambahkan hari libur'}</button>
  </form>
  <div className="mt-4 space-y-2">{loading?<p className="py-4 text-center text-xs text-slate-500">Memuat kalender…</p>:rows.length?rows.map(item=><article key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 text-xs dark:border-slate-800"><div><b>{new Date(item.holiday_date+'T00:00:00').toLocaleDateString('id-ID',{dateStyle:'full'})}</b><p className="text-slate-500">{item.label}</p></div><button type="button" disabled={busy} onClick={()=>void remove(item)} className="inline-flex items-center gap-1 rounded-lg border border-rose-300 px-2.5 py-1.5 text-rose-700 disabled:opacity-40 dark:border-rose-900 dark:text-rose-300"><Trash2 className="h-3.5 w-3.5"/>Hapus</button></article>):<p className="rounded-lg border border-dashed p-5 text-center text-xs text-slate-500 dark:border-slate-700">Belum ada hari libur tenant. Kalender tetap menggunakan Senin–Jumat.</p>}</div>
  {removeDraft&&<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setRemoveDraft(null);}}>
   <form role="dialog" aria-modal="true" aria-labelledby="holiday-remove-title" onSubmit={confirmRemove} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
    <div><h3 id="holiday-remove-title" className="text-sm font-bold">Hapus hari libur tenant?</h3><p className="mt-1 text-xs text-slate-500">{removeDraft.holiday_date} · {removeDraft.label}</p><p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Tanggal ini akan kembali dihitung sebagai hari kerja untuk perhitungan SLA workflow berikutnya. Perubahan dicatat pada audit log.</p></div>
    <label className="block text-xs font-semibold">Alasan penghapusan<textarea required minLength={8} maxLength={500} rows={3} value={removeReason} onChange={e=>setRemoveReason(e.target.value)} disabled={busy} className="mt-1 w-full rounded-lg border bg-transparent p-2.5 dark:border-slate-700" placeholder="Jelaskan dasar koreksi kalender…"/></label><p className="text-right text-[10px] text-slate-500">{removeReason.trim().length}/500 karakter (minimal 8)</p>
    <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setRemoveDraft(null)} className="rounded-lg border px-4 py-2 text-xs dark:border-slate-700">Batal</button><button type="submit" disabled={busy||removeReason.trim().length<8} className="rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy?'Menyimpan…':'Konfirmasi hapus'}</button></div>
   </form>
  </div>}
 </section>;
};
