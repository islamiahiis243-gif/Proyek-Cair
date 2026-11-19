import React, { useEffect, useState } from 'react';
import { Mail, CheckCircle2, AlertCircle, KeyRound, ArrowRight } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import { useApp } from '../context/AppContext';

export const NotificationBanner: React.FC = () => {
  const { user, refreshActiveContext } = useApp();
  const db = getSupabaseClient();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadNotifications = async () => {
    if (!user.email) return;
    try {
      const { data, error: err } = await db
        .from('internal_notifications')
        .select('*')
        .ilike('recipient_email', user.email.trim())
        .eq('is_claimed', false)
        .order('created_at', { ascending: false });

      if (!err && data) {
        setNotifications(data);
      }
    } catch {
      // Ignore
    }
  };

  useEffect(() => {
    void loadNotifications();
  }, [user.email]);

  const handleClaim = async (tokenCode: string, notifId: string) => {
    setBusy(true);
    setNotice('Memproses klaim undangan resmi...');
    setError('');

    try {
      const { data, error: err } = await db.rpc('redeem_rfin', {
        p_code: tokenCode.trim(),
      });

      if (err) throw err;
      if (!data?.ok) throw new Error(data?.error || 'Klaim token gagal.');

      setNotice('Selamat! Kursi Company Super Admin (CSA) berhasil diklaim. Memuat profil Anda...');
      
      // Update lokal notifikasi
      setNotifications(prev => prev.filter(n => n.id !== notifId));

      // Refresh konteks aplikasi
      setTimeout(async () => {
        if (refreshActiveContext) await refreshActiveContext();
        window.location.reload();
      }, 1200);
    } catch (e: any) {
      setError(e?.message || 'Gagal mengklaim token RFIN.');
      setNotice('');
    } finally {
      setBusy(false);
    }
  };

  if (!notifications || notifications.length === 0) return null;

  return (
    <div className="mb-6 space-y-3">
      {notifications.map((n) => (
        <div
          key={n.id}
          className="relative overflow-hidden rounded-2xl border border-blue-400/40 bg-gradient-to-r from-blue-950 via-slate-900 to-indigo-950 p-4 text-white shadow-xl dark:border-blue-500/30"
        >
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-600/30 text-blue-400 border border-blue-400/30 shadow-inner">
                <Mail className="h-5 w-5 animate-pulse" />
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-blue-300">
                  <KeyRound className="h-3 w-3" />
                  Notifikasi Undangan In-House
                </div>
                <h3 className="mt-1 text-sm font-bold text-white sm:text-base">
                  {n.title}
                </h3>
                <p className="mt-0.5 text-xs text-slate-300">
                  {n.message}
                </p>
                {n.token_code && (
                  <div className="mt-2 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400">Kode Aktivasi:</span>
                    <span className="rounded-md border border-amber-400/30 bg-black/40 px-2 py-0.5 font-mono text-xs font-bold tracking-widest text-amber-300">
                      {n.token_code}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2 sm:self-center">
              {n.token_code && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleClaim(n.token_code, n.id)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white shadow-lg hover:bg-emerald-500 active:scale-95 disabled:opacity-50 transition-all"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{busy ? 'Memproses Klaim...' : 'Klaim Kursi CSA Sekarang'}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>

          {notice && (
            <div className="mt-3 rounded-lg bg-emerald-950/80 border border-emerald-500/40 p-2.5 text-xs text-emerald-200">
              {notice}
            </div>
          )}
          {error && (
            <div className="mt-3 rounded-lg bg-rose-950/80 border border-rose-500/40 p-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};
