import React, { useEffect, useState } from 'react';
import { getSupabaseClient, saveStoredUser, resolveMyActiveContext } from '../lib/supabase';

export const AuthGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [email, setEmail] = useState('');
  const [npwp, setNpwp] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [loginMethod, setLoginMethod] = useState<'email' | 'npwp'>('email');
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [showRecoveryForm, setShowRecoveryForm] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const client = getSupabaseClient();
    let disposed = false;
    let authEventVersion = 0;

    const sync = async (session: any, version: number) => {
      const isCurrent = () => !disposed && version === authEventVersion;
      if (!isCurrent()) return;

      if (!session?.user) {
        setAuthed(false);
        localStorage.removeItem('proyek_cair_user');
        setReady(true);
        return;
      }

      const { data: profile, error: profileError } = await client
        .from('profiles')
        .select('id,full_name,avatar_url,is_active,personal_workspace_id')
        .eq('id', session.user.id)
        .maybeSingle();
      if (!isCurrent()) return;
      if (profileError) {
        setError('Gagal memuat profil akses: ' + profileError.message);
        setAuthed(false);
        setReady(true);
        return;
      }

      let activeContext;
      try {
        activeContext = await resolveMyActiveContext();
      } catch (contextError: any) {
        if (!isCurrent()) return;
        setError(contextError.message || 'Konteks akses tidak dapat diverifikasi.');
        setAuthed(false);
        setReady(true);
        return;
      }
      if (!isCurrent()) return;
      if (activeContext.user_id !== session.user.id) {
        setError('Identitas sesi dan konteks akses tidak cocok.');
        setAuthed(false);
        setReady(true);
        return;
      }

      if (profile && !profile.is_active) {
        setError('Akun dinonaktifkan. Hubungi administrator.');
        setAuthed(false);
        setReady(true);
        await client.auth.signOut();
        return;
      }

      const personalWsId = profile?.personal_workspace_id || activeContext.workspaces?.find((w: any) => w.type === 'PERSONAL')?.id || activeContext.workspaces?.[0]?.id;
      
      // Prioritas foto profil:
      // 1. Foto profil aplikasi (tersimpan di profiles / user_metadata)
      // 2. Foto profil Google OAuth (picture / Google avatar_url)
      const appAvatar = profile?.avatar_url || session.user.user_metadata?.avatar_url;
      const googleAvatar = session.user.user_metadata?.picture || (session.user.app_metadata?.provider === 'google' ? session.user.user_metadata?.avatar_url : undefined);
      const resolvedAvatar = appAvatar || googleAvatar;

      saveStoredUser({
        id: session.user.id,
        name: profile?.full_name || session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Pengguna',
        email: session.user.email || '',
        avatar_url: resolvedAvatar,
        role: 'User',
        personalWorkspaceId: personalWsId,
        workspaceType: 'PERSONAL',
        provider: session.user.app_metadata?.provider === 'google' ? 'google' : 'guest',
      });
      if (!isCurrent()) return;
      setError('');
      setAuthed(true);
      setReady(true);
    };

    // Keep the auth callback synchronous. Defer profile/context queries until
    // the auth event handler has returned to avoid auth-client lock/deadlock issues.
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      const version = ++authEventVersion;
      window.setTimeout(() => {
        if (!disposed && version === authEventVersion) void sync(session, version);
      }, 0);
    });

    return () => {
      disposed = true;
      authEventVersion += 1;
      subscription.unsubscribe();
    };
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const client = getSupabaseClient();

      if (recoveryMode) {
        if (newPassword.length < 8) throw new Error('Kata sandi baru minimal 8 karakter.');
        if (newPassword !== confirmPassword) throw new Error('Konfirmasi kata sandi tidak sama.');
        const { error } = await client.auth.updateUser({ password: newPassword });
        if (error) throw error;
        setRecoveryMode(false);
        setNewPassword('');
        setConfirmPassword('');
        setNotice('Kata sandi berhasil diperbarui. Silakan masuk kembali.');
        await client.auth.signOut();
        return;
      }

      if (mode === 'signin' && loginMethod === 'npwp') {
        const { data, error } = await client.functions.invoke('company-admin-npwp-login', {
          body: { npwp: npwp.trim(), password },
        });
        if (error) {
          const status = (error as any)?.context?.status;
          if (status === 429) throw new Error('Terlalu banyak percobaan. Coba lagi nanti.');
          throw new Error('NPWP atau kata sandi tidak valid.');
        }
        if (!data?.access_token || !data?.refresh_token) {
          throw new Error('NPWP atau kata sandi tidak valid.');
        }
        const { error: sessionError } = await client.auth.setSession({
          access_token: data.access_token,
          refresh_token: data.refresh_token,
        });
        if (sessionError) throw new Error('NPWP atau kata sandi tidak valid.');
      } else if (mode === 'signin') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } },
        });
        if (error) throw error;
        if (!data.session) setNotice('Pendaftaran berhasil. Periksa email untuk konfirmasi, lalu masuk kembali.');
      }
    } catch (e: any) {
      setError(e.message || 'Autentikasi gagal.');
    } finally {
      setBusy(false);
    }
  };

  const sendPasswordRecovery = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!recoveryEmail.trim()) throw new Error('Masukkan email yang terhubung dengan akun.');
      const { error } = await getSupabaseClient().auth.resetPasswordForEmail(recoveryEmail.trim(), {
        redirectTo: window.location.origin,
      });
      if (error) throw error;
      setShowRecoveryForm(false);
      setNotice('Jika email tersebut terdaftar, tautan pemulihan akan dikirim. Periksa kotak masuk Anda.');
    } catch {
      setError('Permintaan pemulihan tidak dapat diproses. Periksa email dan coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  const google = async () => {
    setBusy(true);
    setError('');
    try {
      const { error } = await getSupabaseClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (e: any) {
      setError(e.message || 'Google sign-in gagal.');
      setBusy(false);
    }
  };

  if (!ready) return <div className="min-h-screen grid place-items-center bg-slate-950 text-white">Memeriksa sesi Proyek Cair…</div>;

  if (recoveryMode) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 p-4 text-slate-100">
        <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
          <h1 className="text-2xl font-bold">Buat kata sandi baru</h1>
          <p className="mt-2 text-sm text-slate-400">Gunakan kata sandi baru untuk akun Proyek Cair Anda.</p>
          <form onSubmit={submit} className="mt-6 space-y-4">
            <label className="block text-sm">Kata sandi baru
              <input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={e => setNewPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
            </label>
            <label className="block text-sm">Ulangi kata sandi baru
              <input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
            </label>
            {error && <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-300">{error}</div>}
            <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold disabled:opacity-50">
              {busy ? 'Memproses…' : 'Simpan kata sandi'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-screen grid place-items-center bg-slate-950 p-4 text-slate-100">
      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900 p-7 shadow-2xl">
        <div className="mb-7 flex items-center gap-4">
          <img
            src="/android-chrome-512x512.png"
            alt="Logo Proyek Cair"
            className="h-16 w-16 rounded-2xl border border-blue-500/40 object-cover shadow-lg shadow-blue-500/20"
          />
          <div>
            <div className="text-xs font-bold tracking-[.25em] text-blue-400">PLATFORM MANAJEMEN PROYEK</div>
            <h1 className="mt-1 text-2xl font-bold">Proyek Cair</h1>
            <p className="mt-1 text-sm text-slate-400">Satu identitas untuk workspace personal dan perusahaan.</p>
          </div>
        </div>

        {mode === 'signin' && (
          <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-slate-800 p-1">
            <button type="button" onClick={() => { setLoginMethod('email'); setError(''); }} aria-pressed={loginMethod === 'email'} className={`rounded-lg px-3 py-2 text-sm font-medium ${loginMethod === 'email' ? 'bg-blue-600 text-white' : 'text-slate-300'}`}>
              Email
            </button>
            <button type="button" onClick={() => { setLoginMethod('npwp'); setError(''); }} aria-pressed={loginMethod === 'npwp'} className={`rounded-lg px-3 py-2 text-sm font-medium ${loginMethod === 'npwp' ? 'bg-blue-600 text-white' : 'text-slate-300'}`}>
              NPWP Perusahaan
            </button>
          </div>
        )}

        <form onSubmit={submit} className="space-y-4">
          {mode === 'signup' && (
            <label className="block text-sm">Nama lengkap
              <input required value={fullName} onChange={e => setFullName(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
            </label>
          )}

          {(mode === 'signup' || loginMethod === 'email') && (
            <label className="block text-sm">Email
              <input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
            </label>
          )}

          {mode === 'signin' && loginMethod === 'npwp' && (
            <label className="block text-sm">NPWP Perusahaan
              <input type="text" inputMode="numeric" autoComplete="off" maxLength={32} required value={npwp} onChange={e => setNpwp(e.target.value)} placeholder="Masukkan NPWP perusahaan" className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
              <span className="mt-1 block text-xs text-slate-400">Khusus Company Super Admin yang telah mengklaim kursi administrator.</span>
            </label>
          )}

          <label className="block text-sm">Password
            <input type="password" autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required minLength={8} value={password} onChange={e => setPassword(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
          </label>

          {error && <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-sm text-rose-300">{error}</div>}
          {notice && <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/50 p-3 text-sm text-emerald-300">{notice}</div>}

          <button disabled={busy} className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold disabled:opacity-50">
            {busy ? 'Memproses…' : mode === 'signin' ? 'Masuk' : 'Daftar akun'}
          </button>
        </form>

        {mode === 'signin' && (
          <div className="mt-3">
            <button type="button" onClick={() => { setShowRecoveryForm(!showRecoveryForm); setRecoveryEmail(loginMethod === 'email' ? email : ''); setError(''); setNotice(''); }} className="w-full text-sm text-blue-400">
              Lupa kata sandi?
            </button>
            {showRecoveryForm && (
              <div className="mt-3 space-y-3 rounded-xl border border-slate-700 p-3">
                <p className="text-xs text-slate-400">Pemulihan dikirim ke email yang terhubung dengan User Identity Anda. Pesan konfirmasi tidak mengungkap apakah email terdaftar.</p>
                <label className="block text-sm">Email akun
                  <input type="email" autoComplete="email" required value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2" />
                </label>
                <button type="button" disabled={busy} onClick={sendPasswordRecovery} className="w-full rounded-lg border border-slate-700 px-3 py-2 text-sm font-semibold disabled:opacity-50">
                  {busy ? 'Mengirim…' : 'Kirim tautan pemulihan'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
          <span className="h-px flex-1 bg-slate-800" /><span>ATAU</span><span className="h-px flex-1 bg-slate-800" />
        </div>
        <a href="/recovery-custodian" className="mt-3 block w-full rounded-lg border border-cyan-800 px-4 py-3 text-center text-sm font-semibold text-cyan-300 hover:bg-cyan-950/40">Portal Recovery Custodian</a>
        <button onClick={google} disabled={busy} className="mt-3 w-full rounded-lg border border-slate-700 px-4 py-3 text-sm font-semibold hover:bg-slate-800">
          Lanjutkan dengan Google
        </button>
        <button onClick={() => { setMode(mode === 'signin' ? 'signup' : 'signin'); setLoginMethod('email'); setShowRecoveryForm(false); setError(''); setNotice(''); }} className="mt-5 w-full text-sm text-blue-400">
          {mode === 'signin' ? 'Belum punya akun? Daftar' : 'Sudah punya akun? Masuk'}
        </button>
      </div>
    </div>
  );
};
