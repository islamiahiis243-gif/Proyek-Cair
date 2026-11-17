import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, CheckCircle2, FileCheck2, Loader2, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

type SignableDocument = {
  document_id: string;
  workspace_id: string;
  project_id: string;
  project_code: string;
  project_name: string;
  document_no: string;
  title: string;
  document_type: string;
  status: string;
  content_sha256: string | null;
  created_at: string;
  period_start: string | null;
  period_end: string | null;
  company_name: string | null;
  snapshot: Record<string, unknown> | null;
  resource_current: boolean;
};


const snapshotValue = (value: unknown): string => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Ya' : 'Tidak';
  if (typeof value === 'number') return value.toLocaleString('id-ID');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const SnapshotPreview: React.FC<{ snapshot: Record<string, unknown> | null }> = ({ snapshot }) => {
  const data = snapshot || {};
  const project = (data.project || {}) as Record<string, unknown>;
  const workspace = (data.workspace || {}) as Record<string, unknown>;
  const preparedBy = (data.prepared_by || {}) as Record<string, unknown>;
  const records = Array.isArray(data.records) ? data.records as Record<string, unknown>[] : [];
  const amount = Number(data.amount_summary || 0);
  const money = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 2 });
  const hiddenKeys = new Set(['id', 'workspace_id', 'project_id', 'company_id', 'created_by', 'updated_at', 'deleted_at']);
  return <section className="mt-3 space-y-4 rounded-xl border border-slate-200 p-4 dark:border-slate-700">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div><p className="text-[10px] text-slate-500">Project</p><p className="mt-1 text-xs font-semibold">{snapshotValue(project.name)} ({snapshotValue(project.code)})</p></div>
      <div><p className="text-[10px] text-slate-500">Workspace</p><p className="mt-1 text-xs font-semibold">{snapshotValue(workspace.name)}</p></div>
      <div><p className="text-[10px] text-slate-500">Disiapkan oleh</p><p className="mt-1 text-xs font-semibold">{snapshotValue(preparedBy.name)}</p><p className="text-[10px] text-slate-500">{snapshotValue(preparedBy.role)}</p></div>
      <div><p className="text-[10px] text-slate-500">Ringkasan</p><p className="mt-1 text-xs font-semibold">{Number(data.total_transactions || records.length).toLocaleString('id-ID')} record</p><p className="text-[10px] text-slate-500">{money.format(Number.isFinite(amount) ? amount : 0)}</p></div>
    </div>
    <div><p className="text-xs font-semibold">Isi dokumen · {records.length} record</p>
      {records.length ? <div className="mt-2 space-y-2">{records.map((record, index) => {
        const groups = record.transaction
          ? [{ title: 'Transaksi', value: record.transaction as Record<string, unknown> }, { title: 'Item BOQ', value: (record.boq_item || {}) as Record<string, unknown> }]
          : [{ title: 'Detail', value: record }];
        return <article key={index} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
          <p className="mb-2 text-[10px] font-semibold text-slate-500">RECORD {index + 1}</p>
          {groups.map((group, groupIndex) => <div key={groupIndex} className={groupIndex ? 'mt-3 border-t border-slate-200 pt-3 dark:border-slate-800' : ''}>
            {groups.length > 1 && <p className="mb-2 text-[10px] font-semibold">{group.title}</p>}
            <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(group.value).filter(([key]) => !hiddenKeys.has(key)).slice(0, 18).map(([key, value]) => <div key={key} className="min-w-0"><dt className="text-[9px] uppercase tracking-wide text-slate-500">{key.replace(/_/g, ' ')}</dt><dd className="mt-0.5 break-words text-[11px]">{snapshotValue(value)}</dd></div>)}</dl>
          </div>)}
        </article>;
      })}</div> : <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500 dark:bg-slate-950">Tidak ada transaksi dalam periode ini. Snapshot tetap mencatat periode laporan yang disahkan.</p>}
    </div>
    <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><summary className="cursor-pointer text-[10px] font-semibold">Detail teknis snapshot (JSON)</summary><pre className="mt-3 max-h-64 overflow-auto whitespace-pre-wrap break-words text-[9px] text-slate-500">{JSON.stringify(data, null, 2)}</pre></details>
  </section>;
};

export const FinalSignatoryInbox: React.FC = () => {
  const db = getSupabaseClient();
  const [rows, setRows] = useState<SignableDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [signingDraft, setSigningDraft] = useState<{doc:SignableDocument;reason:string}|null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await db.rpc('list_my_final_signatory_documents');
      if (rpcError) throw rpcError;
      setRows((data || []) as SignableDocument[]);
    } catch (e: any) {
      setError(e?.message || 'Inbox Final Signatory belum dapat dimuat.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openSignDialog = (doc: SignableDocument) => {
    setError('');
    setNotice('');
    if (!doc.resource_current) {
      setError('Snapshot dokumen berubah setelah approval selesai. Dokumen harus dikembalikan ke proses review dan approval baru; tanda tangan diblokir.');
      return;
    }
    setSigningDraft({ doc, reason: '' });
  };

  const confirmSignAndIssue = async () => {
    if (!signingDraft || busyId) return;
    const { doc, reason } = signingDraft;
    if (reason.trim().length < 8 || reason.trim().length > 500) {
      setError('Pernyataan pengesahan wajib 8–500 karakter.');
      return;
    }
    setBusyId(doc.document_id);
    setError('');
    setNotice('');
    try {
      const { error: rpcError } = await db.rpc('issue_project_document_scoped', {
        p_workspace_id: doc.workspace_id,
        p_project_id: doc.project_id,
        p_document_id: doc.document_id,
        p_reason: reason.trim()
      });
      if (rpcError) throw rpcError;
      setSigningDraft(null);
      setNotice('Tanda tangan final dan penerbitan dokumen berhasil dicatat secara atomik.');
      await refresh();
    } catch (e: any) {
      const message = e?.message || 'Tanda tangan final belum berhasil dicatat.';
      await refresh();
      setError(message + ' Inbox sudah disegarkan untuk memeriksa status terbaru.');
    } finally {
      setBusyId('');
    }
  };

  return <main className="min-h-screen bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100 sm:p-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-blue-100 p-3 text-blue-700 dark:bg-blue-950 dark:text-blue-300"><FileCheck2 className="h-6 w-6"/></div>
          <div><p className="text-[10px] font-semibold tracking-[.2em] text-blue-600 dark:text-blue-300">PROYEK CAIR · PENGESAHAN</p><h1 className="text-2xl font-bold">Inbox Final Signatory</h1><p className="mt-1 text-xs text-slate-500">Dokumen yang secara eksplisit ditugaskan kepada identitas dan Company Membership Anda.</p></div>
        </div>
        <div className="flex items-center gap-2"><button type="button" onClick={()=>void refresh()} disabled={loading||Boolean(busyId)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700"><RefreshCw className={`h-4 w-4 ${loading?'animate-spin':''}`}/>Perbarui</button><a href="/" className="inline-flex items-center gap-1 rounded-lg border border-slate-300 px-3 py-2 text-xs dark:border-slate-700"><ArrowLeft className="h-4 w-4"/>Workspace Center</a></div>
      </header>
      {error&&<div role="alert" className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200"><ShieldAlert className="mr-2 inline h-4 w-4"/>{error}</div>}
      {notice&&<div role="status" aria-live="polite" className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200"><CheckCircle2 className="mr-2 inline h-4 w-4"/>{notice}</div>}
      <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="h-4 w-4 text-emerald-600"/>Otorisasi pengesahan</div>
        <p className="mt-2 text-xs leading-5 text-slate-500">Akses inbox ditentukan server berdasarkan Company Membership aktif dan appointment Final Signatory yang aktif untuk Project serta jenis dokumen. Persona, Role, permission document.sign terpisah, Employee Record, jabatan, Project Membership, dan Authority tambahan tidak dijadikan prasyarat signing. Setiap tindakan tetap memeriksa ulang seluruh approval serial dan hash resource di server.</p>
      </section>
      {loading?<div className="grid min-h-40 place-items-center text-sm text-slate-500"><Loader2 className="mr-2 inline h-5 w-5 animate-spin"/>Memuat dokumen yang dapat disahkan…</div>
      :rows.length?<div className="space-y-4">{rows.map(doc=><article key={doc.document_id} className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="font-mono text-[10px] text-blue-600 dark:text-blue-300">{doc.project_code} · {doc.project_name}</p><h2 className="mt-1 text-base font-semibold">{doc.title}</h2><p className="mt-1 text-xs text-slate-500">{doc.document_no} · {doc.document_type} · {doc.company_name||'Company'}</p><p className="mt-1 text-[11px] text-slate-500">Periode {doc.period_start||'—'} s/d {doc.period_end||'—'} · Dibuat {new Date(doc.created_at).toLocaleString('id-ID')}</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">APPROVAL SERIAL SELESAI</span></div>
        <div className="mt-4 rounded-lg bg-slate-50 p-3 dark:bg-slate-950"><p className="text-[10px] font-semibold text-slate-500">SHA-256 SNAPSHOT</p><p className="mt-1 break-all font-mono text-[10px]">{doc.content_sha256||'Tidak tersedia'}</p></div>
        <details className="mt-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700" open><summary className="cursor-pointer text-xs font-semibold">Periksa isi dokumen dan data sumber sebelum pengesahan</summary><SnapshotPreview snapshot={doc.snapshot}/></details>
        {!doc.resource_current&&<p className="mt-3 rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-200">Snapshot resource tidak lagi sama dengan versi yang disetujui. Pengesahan diblokir sampai dokumen melewati approval ulang.</p>}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-[10px] text-slate-500">Tindakan ini mencatat pengesahan final dan menerbitkan dokumen dalam satu transaksi database. QR hanya dapat diverifikasi oleh pengguna yang memiliki permission pemindaian dan verifikasi privat.</p><button type="button" disabled={Boolean(busyId)||!doc.resource_current} onClick={()=>openSignDialog(doc)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{busyId===doc.document_id?<Loader2 className="h-4 w-4 animate-spin"/>:<ShieldCheck className="h-4 w-4"/>}Tanda tangani & terbitkan</button></div>
      </article>)}</div>
      :<div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-700 dark:bg-slate-900"><FileCheck2 className="mx-auto h-9 w-9 text-slate-400"/><h2 className="mt-3 font-semibold">Tidak ada dokumen menunggu pengesahan</h2><p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-slate-500">Dokumen akan muncul setelah Company Super Admin menunjuk Anda sebagai Final Signatory untuk Project dan jenis dokumen yang sesuai, serta seluruh tahap approval serial selesai.</p></div>}
    </div>
    {signingDraft && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/60 p-4" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget&&!busyId)setSigningDraft(null);}}>
      <section role="dialog" aria-modal="true" aria-labelledby="final-sign-title" className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-3"><div><h2 id="final-sign-title" className="text-lg font-semibold">Pengesahan Final</h2><p className="mt-1 text-xs text-slate-500">{signingDraft.doc.document_no} · {signingDraft.doc.title}</p></div><button type="button" disabled={Boolean(busyId)} onClick={()=>setSigningDraft(null)} className="rounded-lg px-3 py-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-slate-800" aria-label="Tutup dialog">✕</button></div>
        <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">Pengesahan ini menerbitkan dokumen final dan mengaktifkan verifikasi QR. Pastikan snapshot serta seluruh tahap approval telah benar.</p>
        <label className="mt-4 block text-sm font-medium">Pernyataan / alasan pengesahan<textarea rows={4} minLength={8} maxLength={500} value={signingDraft.reason} onChange={e=>setSigningDraft(current=>current?{...current,reason:e.target.value}:current)} className="mt-2 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 dark:border-slate-700 dark:bg-slate-950 dark:focus:ring-blue-900" placeholder="Nyatakan dasar pengesahan final (8–500 karakter)…"/></label>
        <p className="mt-1 text-right text-xs text-slate-500">{signingDraft.reason.trim().length}/500 karakter</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" disabled={Boolean(busyId)} onClick={()=>setSigningDraft(null)} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium dark:border-slate-700">Batal</button><button type="button" disabled={Boolean(busyId)||signingDraft.reason.trim().length<8} onClick={()=>void confirmSignAndIssue()} className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busyId?<Loader2 className="h-4 w-4 animate-spin"/>:<ShieldCheck className="h-4 w-4"/>}Tandatangani & Terbitkan</button></div>
      </section>
    </div>}
  </main>;
};
