import React, { useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { KeyRound, ShieldCheck, CheckCircle2, AlertTriangle, ArrowRight, Building2, Users } from 'lucide-react';

export const RfinBInputView: React.FC = () => {
  const { user, refreshActiveContext } = useApp();
  const db = getSupabaseClient();
  const [code, setCode] = useState('');
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'info'|'success'|'error'>('info');

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setBusy(true);
    setMessage('Memeriksa token undangan...');
    setMessageTone('info');
    try {
      const { data, error } = await db.rpc('preview_rfin_redemption', { p_code: code.trim() });
      if (error) throw error;
      setPreview(data);
      setMessage('Kode undangan valid. Silakan tinjau ringkasan peran sebelum aktivasi.');
      setMessageTone('success');
    } catch (err: any) {
      setPreview(null);
      setMessage(err?.message || 'Kode RFIN tidak valid atau sudah kedaluwarsa.');
      setMessageTone('error');
    } finally {
      setBusy(false);
    }
  };

  const handleRedeem = async () => {
    if (!preview || busy) return;
    setBusy(true);
    setMessage('Mengaktifkan penugasan peran proyek...');
    setMessageTone('info');
    try {
      const { data, error } = await db.rpc('redeem_rfin', { p_code: code.trim() });
      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error || 'Aktivasi kode gagal.');
      }
      setMessage(`Aktivasi berhasil! Anda kini memiliki akses impersonate pada ${preview.company_name || 'perusahaan'}.`);
      setMessageTone('success');
      setCode('');
      setPreview(null);
      await refreshActiveContext();
    } catch (err: any) {
      setMessage(err?.message || 'Gagal mengaktifkan kode undangan.');
      setMessageTone('error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950 dark:text-amber-400">
            <KeyRound className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Aktivasi Kode Undangan (RFIN-B)</h1>
            <p className="mt-1 text-xs text-slate-500">
              Masukkan kode RFIN-B yang Anda terima dari Company Super Admin (CSA) untuk mengaktifkan peran proyek & mode impersonate Anda.
            </p>
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
          ) : (
            <AlertTriangle className="h-5 w-5 shrink-0 text-rose-600 dark:text-rose-400" />
          )}
          <div className="flex-1 leading-relaxed">{message}</div>
        </div>
      )}

      {/* Form Input Kode */}
      <form onSubmit={handlePreview} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            Kode Undangan RFIN-B <span className="text-rose-500">*</span>
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              type="text"
              required
              disabled={busy}
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setPreview(null);
              }}
              placeholder="Contoh: RFB-XXXX-XXXX-XXXX"
              className="flex-1 rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm uppercase dark:border-slate-700 dark:bg-slate-950 tracking-wider"
            />
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <span>{busy ? 'Memeriksa...' : 'Periksa'}</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Kode RFIN-B dikirim ke email Anda oleh CSA dan terikat dengan akun Anda ({user.email}).
          </p>
        </div>
      </form>

      {/* Ringkasan Undangan */}
      {preview && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-6 dark:border-blue-900 dark:bg-blue-950/30 space-y-4">
          <div className="flex items-center gap-2 text-blue-700 dark:text-blue-300 font-bold text-sm">
            <ShieldCheck className="h-5 w-5" /> Ringkasan Hak Akses & Penugasan
          </div>

          <div className="rounded-xl border border-blue-200/60 bg-white p-4 dark:border-blue-900/60 dark:bg-slate-900 grid gap-3 sm:grid-cols-2">
            <div>
              <span className="text-xs text-slate-500">Perusahaan</span>
              <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-1.5 mt-0.5">
                <Building2 className="h-4 w-4 text-blue-500" />
                {preview.company_name || 'CV Menara Megah'}
              </div>
            </div>

            <div>
              <span className="text-xs text-slate-500">Penerima Undangan</span>
              <div className="font-semibold text-sm text-slate-900 dark:text-white mt-0.5">
                {preview.recipient_email || user.email}
              </div>
            </div>

            <div>
              <span className="text-xs text-slate-500">Peran Persona yang Diberikan</span>
              <div className="font-semibold text-sm text-blue-600 dark:text-blue-400 mt-0.5 flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                {Array.isArray(preview.personas) && preview.personas.length > 0
                  ? preview.personas.map((p: any) => p.name || p.display_name).join(', ')
                  : 'Anggota Proyek Operasional'}
              </div>
            </div>

            <div>
              <span className="text-xs text-slate-500">Masa Berlaku</span>
              <div className="font-semibold text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                {preview.expires_at ? new Date(preview.expires_at).toLocaleDateString('id-ID') : '7 Hari'}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="button"
              disabled={busy}
              onClick={handleRedeem}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 transition-colors"
            >
              <CheckCircle2 className="h-4 w-4" />
              <span>{busy ? 'Mengaktifkan...' : 'Konfirmasi & Aktifkan Peran Impersonate'}</span>
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setCode('');
              }}
              className="rounded-xl border border-slate-300 px-4 py-3 text-sm font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Batal
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
