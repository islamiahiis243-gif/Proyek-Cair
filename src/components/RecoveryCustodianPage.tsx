import React,{useCallback,useEffect,useState}from'react';
import {getSupabaseClient}from'../lib/supabase';
import {ShieldCheck,ShieldAlert,Loader2,LogOut,RefreshCw,CheckCircle2,LockKeyhole}from'lucide-react';

type Assignment={recovery_set_id:string;secret_name:string;recovery_status:string;threshold:number;share_count:number;share_index:number;custodian_label:string;my_retrieval_approval_at:string|null;pending_distinct_approvals:number;last_verified_at:string|null};
export const RecoveryCustodianPage:React.FC=()=>{
 const db=getSupabaseClient();
 const [email,setEmail]=useState('');
 const [assignment,setAssignment]=useState<Assignment|null>(null);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [verified,setVerified]=useState(false);
 const refresh=useCallback(async()=>{
  setLoading(true);setMessage('');
  try{
   const [{data:userResult,error:userError},{data,error}]=await Promise.all([db.auth.getUser(),db.rpc('get_my_key_recovery_assignments')]);
   if(userError)throw userError;
   if(!userResult.user)throw new Error('Sesi login tidak ditemukan. Silakan masuk kembali.');
   setEmail(userResult.user.email||'');
   if(error)throw error;
   const row=(data||[])[0] as Assignment|undefined;
   setAssignment(row||null);
   setVerified(Boolean(row?.last_verified_at));
  }catch(e:any){setMessage(e.message||'Gagal memuat penugasan custodian.');setAssignment(null);}
  finally{setLoading(false);}
 },[db]);
 useEffect(()=>{void refresh();},[refresh]);
 const approve=async()=>{
  if(!assignment||busy||assignment.my_retrieval_approval_at)return;
  setBusy(true);setMessage('');
  try{
   const {data:count,error}=await db.rpc('approve_key_recovery',{p_recovery_set_id:assignment.recovery_set_id,p_purpose:'RETRIEVAL_DRILL'});
   if(error)throw error;
   await refresh();
   const approvals=Number(count);
   if(approvals>=assignment.threshold){
    const {data:result,error:verifyError}=await db.rpc('verify_key_recovery_set',{p_recovery_set_id:assignment.recovery_set_id,p_purpose:'RETRIEVAL_DRILL'});
    if(verifyError)throw verifyError;
    if(result===true){setVerified(true);setMessage('Retrieval drill berhasil diverifikasi. Dual custody aktif.');}
    else setMessage('Dua persetujuan belum dapat diverifikasi. Hubungi Platform Super Admin.');
   }else setMessage('Persetujuan Anda tercatat. Menunggu custodian lain menyetujui melalui akunnya sendiri.');
  }catch(e:any){setMessage(e.message||'Persetujuan gagal.');}
  finally{setBusy(false);await refresh();}
 };
 const logout=async()=>{await db.auth.signOut();window.location.assign('/recovery-custodian');};
 return <main className="min-h-screen bg-slate-950 px-4 py-10 text-slate-100"><div className="mx-auto max-w-2xl space-y-6">
  <header className="flex items-center justify-between"><div><p className="text-xs font-bold tracking-[.2em] text-cyan-400">PROYEK CAIR · SECURITY</p><h1 className="mt-2 text-2xl font-bold">Recovery Custodian</h1><p className="mt-1 text-sm text-slate-400">Portal persetujuan recovery master key NPWP.</p></div><button onClick={logout} className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-sm"><LogOut size={16}/> Keluar</button></header>
  {email&&<p className="text-sm text-slate-400">Login sebagai <span className="text-slate-200">{email}</span></p>}
  {message&&<div role="status" className="rounded-xl border border-cyan-900 bg-cyan-950/40 p-4 text-sm">{message}</div>}
  {loading?<div className="flex items-center gap-2 text-slate-400"><Loader2 className="animate-spin"/> Memuat penugasan…</div>:!assignment?<section className="rounded-2xl border border-rose-900 bg-rose-950/30 p-6"><ShieldAlert className="mb-3 text-rose-400"/><h2 className="font-semibold">Tidak ada penugasan custodian aktif</h2><p className="mt-2 text-sm text-slate-400">Akun ini tidak memiliki recovery share aktif. Portal tidak menampilkan atau mengubah data rahasia.</p></section>:<section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900 p-6">
   <div className="flex items-start justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-slate-500">Penugasan Anda</p><h2 className="mt-1 text-xl font-semibold">{assignment.custodian_label}</h2></div><span className="rounded-full bg-emerald-950 px-3 py-1 text-xs text-emerald-300">Custodian aktif</span></div>
   <div className="grid grid-cols-2 gap-3 sm:grid-cols-3"><div className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-400">Share index</p><p className="mt-1 text-2xl font-bold">{assignment.share_index} <span className="text-sm text-slate-400">/ {assignment.share_count}</span></p></div><div className="rounded-lg bg-slate-800 p-3"><p className="text-xs text-slate-400">Ambang persetujuan</p><p className="mt-1 text-2xl font-bold">{assignment.threshold} dari {assignment.share_count}</p></div><div className="col-span-2 rounded-lg bg-slate-800 p-3 sm:col-span-1"><p className="text-xs text-slate-400">Persetujuan drill</p><p className="mt-1 text-2xl font-bold">{assignment.pending_distinct_approvals} / {assignment.threshold}</p></div></div>
   <div className="rounded-lg border border-slate-700 p-4"><div className="flex items-center gap-2 text-sm font-medium"><LockKeyhole size={16}/> Informasi rahasia</div><p className="mt-2 text-sm text-slate-400">Master key dan nilai recovery share tidak pernah ditampilkan pada halaman ini. Portal hanya memperlihatkan indeks share dan status penugasan.</p><p className="mt-2 text-xs text-slate-500">Recovery set: {assignment.recovery_set_id}</p></div>
   {verified?<div className="flex items-center gap-2 rounded-lg bg-emerald-950/50 p-4 text-emerald-300"><CheckCircle2/> Retrieval drill terverifikasi · dual custody aktif</div>:assignment.my_retrieval_approval_at?<div className="rounded-lg border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">Persetujuan Anda sudah tercatat. Menunggu custodian berbeda. Persetujuan hanya dapat diberikan satu kali per drill.</div>:<button onClick={approve} disabled={busy} className="w-full rounded-lg bg-cyan-600 px-4 py-3 font-semibold text-white disabled:opacity-50">{busy?<Loader2 className="mx-auto animate-spin"/>:'Setujui retrieval drill'}</button>}
   <button onClick={()=>void refresh()} disabled={busy||loading} className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><RefreshCw size={15}/> Perbarui status</button>
  </section>}
  <p className="text-xs leading-5 text-slate-500">Persetujuan dicatat menggunakan identitas Supabase Auth yang sedang login. Jangan membagikan akun atau meminta orang lain menyetujui atas nama Anda. Halaman ini tidak mengakses nilai master key maupun nilai recovery share.</p>
 </div></main>;
};
