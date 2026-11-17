import React,{useCallback,useEffect,useRef,useState} from 'react';
import {ClipboardList,PackageCheck,Plus,RefreshCw,Truck} from 'lucide-react';
import {getSupabaseClient} from '../lib/supabase';
import {useApp} from '../context/AppContext';

type RequestRow={id:string;request_no:string;status:string;supplier_name:string;currency:string;needed_by:string|null;created_at:string;notes:string|null};
type OrderRow={id:string;po_no:string;status:string;supplier_name:string;currency:string;total_amount:number;issued_at:string};
type Line={item_id:string;quantity:string;unit_price:string};
type ReceiptLineDraft={id:string;description:string;ordered_quantity:number;received_quantity:number;uom:string;accepted_quantity:string;rejected_quantity:string};
const input='w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-700 dark:bg-slate-800';
export const ProcurementView:React.FC=()=>{
 const {activeProject,activeWorkspaceId,items,dataReady,dataError,refreshData}=useApp();const db=getSupabaseClient();
 const [requests,setRequests]=useState<RequestRow[]>([]);const [orders,setOrders]=useState<OrderRow[]>([]);const [lines,setLines]=useState<any[]>([]);
 const [supplier,setSupplier]=useState('');const [currency,setCurrency]=useState('IDR');const [neededBy,setNeededBy]=useState('');const [notes,setNotes]=useState('');
 const [draftLines,setDraftLines]=useState<Line[]>([{item_id:'',quantity:'1',unit_price:'0'}]);
 const createRequestKeys=useRef<Record<string,string>>({});const receiptKeys=useRef<Record<string,string>>({});
 const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [notice,setNotice]=useState('');const [schemaUnavailable,setSchemaUnavailable]=useState(false);
 const [issueRequest,setIssueRequest]=useState<RequestRow|null>(null);const [issueReason,setIssueReason]=useState('');
 const [receiptOrder,setReceiptOrder]=useState<OrderRow|null>(null);const [receiptLines,setReceiptLines]=useState<ReceiptLineDraft[]>([]);const [receiptReference,setReceiptReference]=useState('');const [receiptNotes,setReceiptNotes]=useState('');const [receiptLoading,setReceiptLoading]=useState(false);
 const canRead=Boolean(activeProject?.permissions.includes('procurement.read'));
 const canReadBoq=Boolean(activeProject?.permissions.includes('boq.read'));
 const canCreate=Boolean(activeProject?.permissions.includes('procurement.create')&&canReadBoq);
 const canSubmit=Boolean(activeProject?.permissions.includes('procurement.submit'));
 const canIssue=Boolean(activeProject?.permissions.includes('procurement.issue_order'));
 const canReceive=Boolean(activeProject?.permissions.includes('procurement.receive')&&activeProject?.permissions.includes('inventory.movement.create'));
 const load=useCallback(async()=>{
  setLoading(true);setError('');setSchemaUnavailable(false);
  try{
   if(!activeProject||activeProject.workspace_id!==activeWorkspaceId||!canRead){setRequests([]);setOrders([]);setLines([]);return;}
   const [r,o]=await Promise.all([
    db.from('procurement_requests').select('id,request_no,status,supplier_name,currency,needed_by,created_at,notes').eq('workspace_id',activeWorkspaceId).eq('project_id',activeProject.id).order('created_at',{ascending:false}),
    db.from('procurement_orders').select('id,po_no,status,supplier_name,currency,total_amount,issued_at').eq('workspace_id',activeWorkspaceId).eq('project_id',activeProject.id).order('issued_at',{ascending:false})
   ]);
   if(r.error)throw r.error;if(o.error)throw o.error;setRequests(r.data||[]);setOrders(o.data||[]);
   const ids=(r.data||[]).map((x:any)=>x.id);
   if(ids.length){const l=await db.from('procurement_request_items').select('id,request_id,item_id,description,quantity,uom,unit_price').eq('workspace_id',activeWorkspaceId).eq('project_id',activeProject.id).in('request_id',ids);if(l.error)throw l.error;setLines(l.data||[]);}else setLines([]);
  }catch(e:any){if(['42P01','PGRST205'].includes(e?.code)){setSchemaUnavailable(true);setRequests([]);setOrders([]);setLines([]);}else throw e;}
  finally{setLoading(false);}
 },[db,activeProject?.id,activeWorkspaceId,canRead]);

 useEffect(()=>{void load().catch(e=>setError(e.message||'Gagal memuat procurement.'));},[load]);
 useEffect(()=>{setIssueRequest(null);setIssueReason('');setReceiptOrder(null);setReceiptLines([]);setReceiptReference('');setReceiptNotes('');},[activeProject?.id,activeWorkspaceId]);
 const createRequest=async(e:React.FormEvent)=>{
  e.preventDefault();if(!activeProject||!canCreate||busy)return;
  const payload=draftLines.filter(x=>x.item_id).map(x=>({item_id:x.item_id,quantity:Number(x.quantity),unit_price:Number(x.unit_price)}));
  if(!supplier.trim()||!payload.length||payload.some(x=>!Number.isFinite(x.quantity)||!Number.isFinite(x.unit_price)||x.quantity<=0||x.unit_price<0)){setError('Supplier dan minimal satu item BOQ valid wajib diisi.');return;}
  const keyMaterial=JSON.stringify({project_id:activeProject.id,supplier:supplier.trim(),currency,needed_by:neededBy||null,notes:notes.trim(),items:payload});
  const idempotencyKey=createRequestKeys.current[keyMaterial]||(createRequestKeys.current[keyMaterial]=crypto.randomUUID());
  setBusy(true);setError('');setNotice('');
  try{
   const {data,error}=await db.rpc('create_procurement_request_scoped',{p_workspace_id:activeWorkspaceId,p_project_id:activeProject.id,p_supplier_name:supplier.trim(),p_currency:currency,p_needed_by:neededBy||null,p_notes:notes||null,p_items:payload,p_idempotency_key:idempotencyKey});
   if(error)throw error;
   setNotice('Purchase Request dibuat: '+data+'. Submit untuk memulai approval serial.');
   setSupplier('');setNeededBy('');setNotes('');setDraftLines([{item_id:'',quantity:'1',unit_price:'0'}]);delete createRequestKeys.current[keyMaterial];
   try{await load();}catch(refreshError:any){setError('Purchase Request berhasil dibuat, tetapi daftar gagal dimuat ulang: '+(refreshError.message||'kesalahan tidak diketahui')+'. Gunakan Muat ulang.');}
  }catch(e:any){setError(e.message||'Gagal membuat Purchase Request.');}
  finally{setBusy(false);}
 };
 const submitRequest=async(id:string)=>{
  if(!activeProject||!canSubmit||busy)return;setBusy(true);setError('');setNotice('');
  try{const {error}=await db.rpc('submit_procurement_request_scoped',{p_workspace_id:activeWorkspaceId,p_project_id:activeProject.id,p_request_id:id});if(error)throw error;setNotice('Purchase Request disubmit. Mulai Workflow → Procurement untuk approval serial.');try{await load();}catch(refreshError:any){setError('Purchase Request berhasil disubmit, tetapi daftar gagal dimuat ulang: '+(refreshError.message||'kesalahan tidak diketahui')+'. Gunakan Muat ulang.');}}
  catch(e:any){setError(e.message||'Gagal submit Purchase Request.');}
  finally{setBusy(false);}
 };
 const issueOrder=async(id:string)=>{const request=requests.find(x=>x.id===id);if(!request||!canIssue||busy)return;setIssueRequest(request);setIssueReason('');setError('');};
 const confirmIssueOrder=async(e:React.FormEvent)=>{
  e.preventDefault();if(!activeProject||!canIssue||!issueRequest||busy)return;const reason=issueReason.trim();if(reason.length<8||reason.length>500){setError('Alasan penerbitan PO harus 8–500 karakter.');return;}setBusy(true);setError('');setNotice('');
  try{const {data,error}=await db.rpc('issue_procurement_order_scoped',{p_workspace_id:activeWorkspaceId,p_project_id:activeProject.id,p_request_id:issueRequest.id,p_reason:reason});if(error)throw error;setNotice('Purchase Order diterbitkan: '+data);setIssueRequest(null);setIssueReason('');try{await load();}catch(refreshError:any){setError('Purchase Order berhasil diterbitkan, tetapi daftar gagal dimuat ulang: '+(refreshError.message||'kesalahan tidak diketahui')+'. Gunakan Muat ulang.');}}
  catch(e:any){setError(e.message||'Gagal menerbitkan Purchase Order.');}
  finally{setBusy(false);}
 };
 const receiveOrder=async(order:OrderRow)=>{
  if(!activeProject||!canReceive||busy||receiptLoading)return;setReceiptLoading(true);setError('');setNotice('');
  try{const {data,error:readError}=await db.from('procurement_order_items').select('id,description,ordered_quantity,received_quantity,uom').eq('workspace_id',activeWorkspaceId).eq('project_id',activeProject.id).eq('order_id',order.id);if(readError)throw readError;const openLines=(data||[]).map((line:any)=>({...line,ordered_quantity:Number(line.ordered_quantity),received_quantity:Number(line.received_quantity),accepted_quantity:String(Math.max(0,Number(line.ordered_quantity)-Number(line.received_quantity))),rejected_quantity:'0'})).filter((line:ReceiptLineDraft)=>line.ordered_quantity>line.received_quantity);if(!openLines.length)throw new Error('Tidak ada kuantitas tersisa untuk diterima pada Purchase Order ini.');setReceiptOrder(order);setReceiptLines(openLines);setReceiptReference('');setReceiptNotes('');}
  catch(e:any){setError(e.message||'Gagal memuat detail Purchase Order.');}
  finally{setReceiptLoading(false);}
 };
 const confirmReceipt=async(e:React.FormEvent)=>{
  e.preventDefault();if(!activeProject||!canReceive||!receiptOrder||busy)return;const payload:any[]=[];
  for(const line of receiptLines){const accepted=Number(line.accepted_quantity);const rejected=Number(line.rejected_quantity);const remaining=line.ordered_quantity-line.received_quantity;if(!Number.isFinite(accepted)||!Number.isFinite(rejected)||accepted<0||rejected<0||accepted+rejected>remaining){setError('Total qty diterima dan ditolak untuk '+line.description+' harus antara 0 dan '+remaining+' '+line.uom+'.');return;}if(accepted+rejected>0)payload.push({order_item_id:line.id,accepted_quantity:accepted,rejected_quantity:rejected});}
  if(!payload.length){setError('Masukkan minimal satu kuantitas diterima atau ditolak.');return;}
  setBusy(true);setError('');setNotice('');
  try{const keyMaterial=JSON.stringify({order_id:receiptOrder.id,reference_no:receiptReference.trim(),notes:receiptNotes.trim(),items:payload});const idempotencyKey=receiptKeys.current[keyMaterial]||(receiptKeys.current[keyMaterial]=crypto.randomUUID());const {data:receipt,error}=await db.rpc('receive_procurement_order_scoped',{p_workspace_id:activeWorkspaceId,p_project_id:activeProject.id,p_order_id:receiptOrder.id,p_reference_no:receiptReference.trim()||null,p_notes:receiptNotes.trim()||null,p_items:payload,p_idempotency_key:idempotencyKey});if(error)throw error;setNotice('Goods Receipt tercatat: '+receipt+'. Kuantitas diterima telah diposting ke Inventory Ledger Project.');setReceiptOrder(null);setReceiptLines([]);setReceiptReference('');setReceiptNotes('');delete receiptKeys.current[keyMaterial];try{await load();}catch(refreshError:any){setError('Goods Receipt berhasil dicatat, tetapi daftar gagal dimuat ulang: '+(refreshError.message||'kesalahan tidak diketahui')+'. Gunakan Muat ulang.');}}
  catch(e:any){setError(e.message||'Gagal mencatat Goods Receipt.');}
  finally{setBusy(false);}
 };

 if(loading||!dataReady)return <div role="status" aria-live="polite" className="rounded-xl border bg-white p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900">Memuat konteks Project dan data Procurement…</div>;
 if(dataError)return <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800"><p>Data konteks Project gagal dimuat: {dataError}</p><button onClick={()=>void refreshData()} className="mt-3 rounded-lg bg-rose-700 px-3 py-2 text-xs font-semibold text-white">Coba lagi</button></div>;
 if(!activeProject||activeProject.workspace_id!==activeWorkspaceId)return <div role="status" className="rounded-xl border p-6 text-sm text-amber-700">Pilih Project operasional aktif terlebih dahulu.</div>;
 if(schemaUnavailable)return <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">Skema Procurement tidak dapat diakses melalui API saat ini. Migration 20261116012800 sudah tercatat pada histori Production; periksa schema cache PostgREST, schema drift, dan akses tabel/RLS sebelum melanjutkan. Tidak ada transaksi yang dibuat.</div>;
 if(!canRead)return <div role="alert" className="rounded-xl border p-6 text-sm text-amber-700">Permission procurement.read pada Project aktif diperlukan.</div>;
 return <div className="space-y-5">
  <header><div className="flex items-center gap-2"><Truck className="h-5 w-5 text-blue-600"/><h1 className="text-xl font-bold">Procurement & Goods Receipt</h1></div><p className="mt-1 text-xs text-slate-500">Purchase Request → approval serial → Purchase Order → Goods Receipt → Inventory Ledger. Seluruh transaksi dibatasi Project aktif.</p></header>
  {error&&<div role="alert" className="rounded-lg border border-rose-300 bg-rose-50 p-3 text-xs text-rose-800">{error}</div>}{notice&&<div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-xs text-emerald-800">{notice}</div>}
  {activeProject.permissions.includes('procurement.create')&&!canReadBoq&&<div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">Permission boq.read diperlukan untuk memilih item BOQ saat membuat Purchase Request.</div>}{canCreate&&items.length===0&&<div role="status" className="rounded-lg border border-dashed p-4 text-xs text-slate-500">Belum ada item BOQ aktif yang dapat dipilih. Purchase Request belum dapat dibuat.</div>}{canCreate&&items.length>0&&<form onSubmit={createRequest} className="space-y-3 rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><h2 className="text-sm font-bold"><Plus className="mr-2 inline h-4 w-4"/>Buat Purchase Request</h2><div className="grid gap-3 md:grid-cols-3"><label className="text-xs">Supplier<input required value={supplier} onChange={e=>setSupplier(e.target.value)} className={input}/></label><label className="text-xs">Mata uang<select value={currency} onChange={e=>setCurrency(e.target.value)} className={input}><option>IDR</option><option>USD</option><option>SGD</option></select></label><label className="text-xs">Dibutuhkan tanggal<input type="date" value={neededBy} onChange={e=>setNeededBy(e.target.value)} className={input}/></label></div>
   {draftLines.map((line,i)=><div key={i} className="grid gap-2 rounded-lg border p-3 dark:border-slate-700 md:grid-cols-[2fr_1fr_1fr_auto]"><label className="text-xs">Item BOQ<select required value={line.item_id} onChange={e=>setDraftLines(rows=>rows.map((x,j)=>j===i?{...x,item_id:e.target.value,unit_price:String(items.find(it=>it.id===e.target.value)?.harga_satuan||0)}:x))} className={input}><option value="">Pilih item aktif</option>{items.map(it=><option key={it.id} value={it.id}>{it.kode_boq} · {it.nama_barang}</option>)}</select></label><label className="text-xs">Qty<input type="number" min="0.0001" step="any" value={line.quantity} onChange={e=>setDraftLines(rows=>rows.map((x,j)=>j===i?{...x,quantity:e.target.value}:x))} className={input}/></label><label className="text-xs">Harga satuan<input type="number" min="0" step="any" value={line.unit_price} onChange={e=>setDraftLines(rows=>rows.map((x,j)=>j===i?{...x,unit_price:e.target.value}:x))} className={input}/></label><button type="button" onClick={()=>setDraftLines(rows=>rows.length>1?rows.filter((_,j)=>j!==i):rows)} className="self-end rounded border px-3 py-2 text-xs">Hapus</button></div>)}
   <button type="button" onClick={()=>setDraftLines(rows=>[...rows,{item_id:'',quantity:'1',unit_price:'0'}])} className="rounded border px-3 py-2 text-xs">Tambah item</button><label className="block text-xs">Catatan<textarea value={notes} onChange={e=>setNotes(e.target.value)} className={input}/></label><button disabled={busy} className="rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40">{busy?'Menyimpan…':'Simpan Purchase Request'}</button>
  </form>}
  <section className="space-y-3"><h2 className="text-sm font-bold">Purchase Requests ({requests.length})</h2>{requests.length===0?<p role="status" className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">Belum ada Purchase Request pada Project aktif.</p>:requests.map(r=><article key={r.id} className="rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div className="flex flex-wrap justify-between gap-2"><div><b className="text-sm">{r.request_no} · {r.supplier_name}</b><p className="text-xs text-slate-500">{r.currency} · Dibutuhkan {r.needed_by||'—'} · {new Date(r.created_at).toLocaleString('id-ID')}</p><div className="mt-2 space-y-1 text-xs">{lines.filter(x=>x.request_id===r.id).map(x=><p key={x.id}>{x.description} · {x.quantity} {x.uom} × {Number(x.unit_price).toLocaleString('id-ID')}</p>)}</div></div><span className="h-fit rounded-full bg-slate-100 px-3 py-1 text-[10px] font-semibold dark:bg-slate-800">{r.status}</span></div>{r.status==='DRAFT'&&canSubmit&&<button disabled={busy} onClick={()=>void submitRequest(r.id)} className="mt-3 rounded-lg border border-blue-300 px-3 py-2 text-xs text-blue-700">Submit untuk approval</button>}{r.status==='APPROVED'&&canIssue&&<button disabled={busy} onClick={()=>void issueOrder(r.id)} className="mt-3 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Terbitkan Purchase Order</button>}</article>)}</section>
  <section className="space-y-3"><h2 className="text-sm font-bold"><PackageCheck className="mr-2 inline h-4 w-4"/>Purchase Orders & Goods Receipt ({orders.length})</h2>{orders.length===0?<p role="status" className="rounded-lg border border-dashed p-4 text-center text-xs text-slate-500">Belum ada Purchase Order pada Project aktif.</p>:orders.map(o=><article key={o.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><div><b className="text-sm">{o.po_no} · {o.supplier_name}</b><p className="text-xs text-slate-500">{o.currency} {Number(o.total_amount).toLocaleString('id-ID')} · {new Date(o.issued_at).toLocaleString('id-ID')}</p></div><div className="flex items-center gap-2"><span className="rounded-full bg-slate-100 px-3 py-1 text-[10px] dark:bg-slate-800">{o.status}</span>{['ISSUED','PARTIALLY_RECEIVED'].includes(o.status)&&canReceive&&<button disabled={busy||receiptLoading} onClick={()=>void receiveOrder(o)} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white">{receiptLoading?'Memuat…':'Catat Goods Receipt'}</button>}</div></article>)}</section>
  {issueRequest&&<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setIssueRequest(null);}}>
   <form role="dialog" aria-modal="true" aria-labelledby="issue-po-title" onSubmit={confirmIssueOrder} className="w-full max-w-lg space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
    <div><h2 id="issue-po-title" className="text-base font-bold">Terbitkan Purchase Order</h2><p className="mt-1 text-xs text-slate-500">{issueRequest.request_no} · {issueRequest.supplier_name}</p><p className="mt-2 text-xs text-slate-500">PO hanya dapat diterbitkan setelah Purchase Request berstatus APPROVED, workflow selesai, dan Authority Anda tervalidasi oleh server.</p></div>
    <label className="block text-xs font-semibold">Alasan penerbitan PO<textarea required minLength={8} maxLength={500} rows={3} value={issueReason} onChange={e=>setIssueReason(e.target.value)} className={input+" mt-1"} placeholder="Jelaskan dasar penerbitan Purchase Order…"/></label>
    <p className="text-right text-[10px] text-slate-500">{issueReason.trim().length}/500 karakter (minimal 8)</p>
    <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setIssueRequest(null)} className="rounded-lg border px-4 py-2 text-xs">Batal</button><button type="submit" disabled={busy||issueReason.trim().length<8} className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy?'Menerbitkan…':'Konfirmasi terbitkan PO'}</button></div>
   </form>
  </div>}
  {receiptOrder&&<div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)setReceiptOrder(null);}}>
   <form role="dialog" aria-modal="true" aria-labelledby="goods-receipt-title" onSubmit={confirmReceipt} className="my-auto w-full max-w-2xl space-y-4 rounded-xl bg-white p-5 shadow-xl dark:bg-slate-900">
    <div><h2 id="goods-receipt-title" className="text-base font-bold">Catat Goods Receipt</h2><p className="mt-1 text-xs text-slate-500">{receiptOrder.po_no} · {receiptOrder.supplier_name}</p><p className="mt-2 text-xs text-slate-500">Catat kuantitas yang diterima dan ditolak. Penerimaan parsial diperbolehkan; kuantitas 0 melewati baris tersebut. Hanya kuantitas diterima yang masuk Inventory Ledger; kuantitas ditolak tercatat pada Goods Receipt dan tetap menjadi sisa kewajiban pemasok.</p></div>
    <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">{receiptLines.map(line=>{const remaining=line.ordered_quantity-line.received_quantity;return <div key={line.id} className="grid gap-2 rounded-lg border p-3 dark:border-slate-700 sm:grid-cols-[minmax(0,1fr)_150px]"><div><p className="text-xs font-semibold">{line.description}</p><p className="mt-1 text-[10px] text-slate-500">Dipesan {line.ordered_quantity} {line.uom} · Sudah diterima {line.received_quantity} {line.uom} · Sisa {remaining} {line.uom}</p></div><div className="grid grid-cols-2 gap-2"><label className="text-xs">Diterima ({line.uom})<input type="number" min="0" max={remaining} step="any" value={line.accepted_quantity} onChange={e=>setReceiptLines(rows=>rows.map(x=>x.id===line.id?{...x,accepted_quantity:e.target.value}:x))} className={input+" mt-1"}/></label><label className="text-xs">Ditolak ({line.uom})<input type="number" min="0" max={remaining} step="any" value={line.rejected_quantity} onChange={e=>setReceiptLines(rows=>rows.map(x=>x.id===line.id?{...x,rejected_quantity:e.target.value}:x))} className={input+" mt-1"}/></label></div></div>;})}</div>
    <label className="block text-xs">Nomor surat jalan / referensi<input maxLength={120} value={receiptReference} onChange={e=>setReceiptReference(e.target.value)} className={input+" mt-1"} placeholder="Opsional"/></label>
    <label className="block text-xs">Catatan penerimaan<textarea maxLength={2000} rows={2} value={receiptNotes} onChange={e=>setReceiptNotes(e.target.value)} className={input+" mt-1"} placeholder="Catatan kondisi barang, kekurangan, atau penerimaan parsial…"/></label>
    <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={()=>setReceiptOrder(null)} className="rounded-lg border px-4 py-2 text-xs">Batal</button><button type="submit" disabled={busy||!receiptLines.some(x=>Number(x.accepted_quantity)>0||Number(x.rejected_quantity)>0)} className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{busy?'Menyimpan…':'Simpan Goods Receipt'}</button></div>
   </form>
  </div>}
  <div className="flex items-center justify-between text-xs text-slate-500"><span>Workflow approval dilakukan di tab Operasi Terintegrasi → Workflow & Approval.</span><button onClick={()=>void load().catch(e=>setError(e.message||'Gagal memuat ulang Procurement.'))} disabled={busy||loading} className="inline-flex items-center gap-1 rounded border px-3 py-2"><RefreshCw className="h-3 w-3"/>Muat ulang</button></div>
 </div>;
};
