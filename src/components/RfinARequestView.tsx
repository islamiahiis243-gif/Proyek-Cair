import React, { useEffect, useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { Building2, CheckCircle2, Clock, FileText, Send, AlertTriangle, RefreshCw } from 'lucide-react';

export const RfinARequestView: React.FC = () => {
  const { user } = useApp();
  const db = getSupabaseClient();
  const [companyName, setCompanyName] = useState('');
  const [companyNpwp, setCompanyNpwp] = useState('');
  const [superAdminEmail, setSuperAdminEmail] = useState(user.email || '');
  const [businessEmail, setBusinessEmail] = useState(user.email || '');
  const [companyAddress, setCompanyAddress] = useState('');
  const [declarationAccepted, setDeclarationAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info'|'success'|'error'>('info');
  const [requests, setRequests] = useState<any[]>([]);

  const loadRequests = async () => {
    try {
      const { data, error } = await db
        .from('company_registration_requests')
        .select('*')
        .eq('requested_by', user.id)
        .order('created_at', { ascending: false });
      if (!error && data) {
        setRequests(data);
      }
    } catch {
      // Ignored
    }
  };

  useEffect(() => {
    if (user.id) void loadRequests();
  }, [user.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!declarationAccepted) {
      setMessage('Pernyataan tanggung jawab pendaftaran wajib dicentang.');
      setMessageTone('error');
      return;
    }

    const cleanNpwp = companyNpwp.replace(/\D/g, '');
    if (cleanNpwp.length !== 16) {
      setMessage('Format NPWP wajib tepat 16 digit angka demi keseragaman dan keabsahan identitas.');
      setMessageTone('error');
      return;
    }

    setBusy(true);
    setMessage('Memeriksa kelayakan dan mendaftarkan tenant baru...');
    setMessageTone('info');

    try {
      // 1. Pre-flight check duplikasi di sisi klien sebelum submit
      const cleanName = companyName.trim().toUpperCase();
      const cleanEmail = superAdminEmail.trim().toLowerCase();

      const [chkComp, chkSeats, chkReqs] = await Promise.all([
        db.from('companies').select('legal_name,npwp').or(`npwp.eq.${cleanNpwp},legal_name.ilike.${cleanName}`).limit(1),
        db.from('company_admin_seats').select('recipient_email').ilike('recipient_email', cleanEmail).limit(1),
        db.from('company_registration_requests').select('legal_name,npwp,super_admin_email')
          .eq('status', 'PENDING')
          .or(`npwp.eq.${cleanNpwp},legal_name.ilike.${cleanName},super_admin_email.ilike.${cleanEmail}`).limit(1)
      ]);

      if (chkComp.data && chkComp.data.length > 0) {
        const found = chkComp.data[0];
        const reason = found.npwp === cleanNpwp ? `NPWP ${cleanNpwp}` : `Nama ${found.legal_name}`;
        throw new Error(`Perusahaan dengan ${reason} telah terdaftar dalam sistem. Pendaftaran tenant ganda tidak diperkenankan.`);
      }

      if (chkSeats.data && chkSeats.data.length > 0) {
        throw new Error(`Email calon CSA (${cleanEmail}) telah terdaftar sebagai pengelola perusahaan lain.`);
      }

      if (chkReqs.data && chkReqs.data.length > 0) {
        throw new Error(`Permohonan pendaftaran untuk perusahaan / NPWP / email CSA ini sudah ada dan sedang menunggu review PSA.`);
      }

      const { data, error } = await db.rpc('submit_company_registration', {
        p_legal_name: cleanName,
        p_npwp: cleanNpwp,
        p_super_admin_email: cleanEmail,
        p_business_email: businessEmail.trim().toLowerCase() || null,
        p_notes: `Pendaftaran Tenant oleh ${user.name} (${user.email}). Alamat: ${companyAddress}`,
        p_declaration_version: 'CV-COMPANY-IDENTITY-v1'
      });

      if (error) throw error;

      setMessage(`Permohonan pendaftaran ${companyName} berhasil diajukan dengan status MENUNGGU PERSETUJUAN PSA. Calon CSA (${superAdminEmail}) akan menerima kode RFIN-A setelah disetujui.`);
      setMessageTone('success');
      setCompanyName('');
      setCompanyNpwp('');
      setCompanyAddress('');
      setDeclarationAccepted(false);
      await loadRequests();
    } catch (err: any) {
      setMessage(err?.message || 'Gagal mengirim permohonan pendaftaran.');
      setMessageTone('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header Halaman */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
              <Building2 className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white">Pengajuan Pendaftaran Perusahaan (RFIN-A)</h1>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
                Daftarkan perusahaan baru Anda sebagai Tenant di Proyek Cair. Pengajuan ini akan ditinjau oleh Platform Super Admin (PSA).
              </p>
            </div>
          </div>

          {/* Banner Rata Kanan: words_PNG2 */}
          <div className="flex items-center justify-end self-center shrink-0">
            <img
              src="/words_PNG2.png"
              alt="Proyek Cair"
              className="h-12 sm:h-14 lg:h-16 w-auto max-w-[180px] sm:max-w-[240px] lg:max-w-[280px] object-contain drop-shadow-md dark:block hidden"
            />
            <img
              src="/words_light.png"
              alt="Proyek Cair"
              className="h-12 sm:h-14 lg:h-16 w-auto max-w-[180px] sm:max-w-[240px] lg:max-w-[280px] object-contain drop-shadow-md dark:hidden block"
            />
          </div>
        </div>
      </div>

      {message && (
        <div
          className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
            messageTone === 'success'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200'
              : messageTone === 'error'
              ? 'border-rose-200 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200'
              : 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200'
          }`}
        >
          {messageTone === 'success' ? (
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : messageTone === 'error' ? (
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          ) : (
            <Clock className="h-5 w-5 shrink-0 text-blue-600 dark:text-blue-400" />
          )}
          <div className="flex-1 leading-relaxed">{message}</div>
        </div>
      )}

      {/* Formulir Pendaftaran */}
      <form onSubmit={handleSubmit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-5">
        <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
          <FileText className="h-4 w-4 text-blue-600" /> Formulir Data Perusahaan & Calon CSA
        </h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Nama Legal Perusahaan <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              disabled={busy}
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Contoh: PT Karya Konstruksi Nusantara"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              NPWP Perusahaan (Tepat 16 Digit) <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              disabled={busy}
              inputMode="numeric"
              maxLength={16}
              value={companyNpwp}
              onChange={(e) => setCompanyNpwp(e.target.value.replace(/\D/g, '').slice(0, 16))}
              placeholder="16 digit angka (contoh: 0024376584714000)"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm font-mono tracking-wider dark:border-slate-700 dark:bg-slate-950"
            />
            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
              {companyNpwp.length}/16 digit {companyNpwp.length === 16 ? '✓ Lengkap' : '(Wajib 16 digit angka)'}
            </p>
          </div>

          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Alamat Kantor Perusahaan
            </label>
            <textarea
              rows={2}
              disabled={busy}
              value={companyAddress}
              onChange={(e) => setCompanyAddress(e.target.value)}
              placeholder="Alamat domisili operasional kantor perusahaan"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Email Calon Company Super Admin (CSA) <span className="text-rose-500">*</span>
            </label>
            <input
              type="email"
              required
              disabled={busy}
              value={superAdminEmail}
              onChange={(e) => setSuperAdminEmail(e.target.value)}
              placeholder="contoh: admin@email.com"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
            <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
              Bisa email Anda sendiri atau staf/pimpinan yang ditunjuk sebagai administrator utama.
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Email Korespondensi Perusahaan (Opsional)
            </label>
            <input
              type="email"
              disabled={busy}
              value={businessEmail}
              onChange={(e) => setBusinessEmail(e.target.value)}
              placeholder="contoh: kontak@email.com"
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
            />
          </div>
        </div>

        <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300 cursor-pointer">
          <input
            type="checkbox"
            required
            disabled={busy}
            checked={declarationAccepted}
            onChange={(e) => setDeclarationAccepted(e.target.checked)}
            className="mt-0.5 rounded text-blue-600"
          />
          <span>
            Saya menyatakan bahwa data perusahaan yang diajukan adalah benar, dan email yang tercantum berhak menerima kode aktivasi RFIN-A untuk mengelola Company Workspace.
          </span>
        </label>

        <button
          type="submit"
          disabled={busy || !declarationAccepted}
          className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          <Send className="h-4 w-4" />
          <span>{busy ? 'Mengirim Permohonan...' : 'Kirim Permohonan Pendaftaran (RFIN-A)'}</span>
        </button>
      </form>

      {/* Daftar Status Permohonan */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Riwayat Permohonan Saya</h2>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300 font-medium">Status verifikasi pendaftaran perusahaan oleh PSA.</p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={loadRequests}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Segarkan
          </button>
        </div>

        {requests.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {requests.map((req) => (
              <div key={req.id} className="py-3.5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm text-slate-900 dark:text-white">{req.legal_name}</div>
                  <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium flex flex-wrap gap-2">
                    <span>NPWP: {req.npwp_last4 ? `•••• •••• •••• ${req.npwp_last4}` : 'Tercatat'}</span>
                    <span>·</span>
                    <span>Calon CSA: <b>{req.super_admin_email}</b></span>
                    <span>·</span>
                    <span>Diajukan: {new Date(req.created_at).toLocaleDateString('id-ID')}</span>
                  </div>
                  {req.review_notes && (
                    <div className="mt-1 text-xs text-slate-700 dark:text-slate-300 italic">
                      Catatan PSA: {req.review_notes}
                    </div>
                  )}
                </div>

                <div>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                      req.status === 'ACCEPTED' || req.status === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : req.status === 'REJECTED'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                        : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                    }`}
                  >
                    {req.status === 'ACCEPTED' || req.status === 'APPROVED'
                      ? 'Disetujui'
                      : req.status === 'REJECTED'
                      ? 'Ditolak'
                      : 'Menunggu Persetujuan'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-xs text-slate-600 dark:text-slate-300 font-medium">
            Belum ada permohonan pendaftaran tenant dari akun Anda.
          </p>
        )}
      </div>
    </div>
  );
};
