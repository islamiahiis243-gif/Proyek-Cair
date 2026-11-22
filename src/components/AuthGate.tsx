import React, { useEffect, useState } from 'react';
import { getSupabaseClient, saveStoredUser, resolveMyActiveContext } from '../lib/supabase';
import {
  ShieldCheck,
  Receipt,
  QrCode,
  CheckCircle2,
  Lock,
  Mail,
  Building2,
  ArrowRight
} from 'lucide-react';

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

      const personalWsId =
        profile?.personal_workspace_id ||
        activeContext.workspaces?.find((w: any) => w.type === 'PERSONAL')?.id ||
        activeContext.workspaces?.[0]?.id;

      // Prioritas foto profil:
      // 1. Foto profil aplikasi (tersimpan di profiles / user_metadata)
      // 2. Foto profil Google OAuth (picture / Google avatar_url)
      const appAvatar = profile?.avatar_url || session.user.user_metadata?.avatar_url;
      const googleAvatar =
        session.user.user_metadata?.picture ||
        (session.user.app_metadata?.provider === 'google' ? session.user.user_metadata?.avatar_url : undefined);
      const resolvedAvatar = appAvatar || googleAvatar;

      saveStoredUser({
        id: session.user.id,
        name:
          profile?.full_name ||
          session.user.user_metadata?.full_name ||
          session.user.email?.split('@')[0] ||
          'Pengguna',
        email: session.user.email || '',
        avatar_url: resolvedAvatar,
        role: 'User',
        personalWorkspaceId: personalWsId,
        workspaceType: 'PERSONAL',
        provider: session.user.app_metadata?.provider === 'google' ? 'google' : 'guest'
      });
      if (!isCurrent()) return;
      setError('');
      setAuthed(true);
      setReady(true);
    };

    // Keep the auth callback synchronous. Defer profile/context queries until
    // the auth event handler has returned to avoid auth-client lock/deadlock issues.
    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((event, session) => {
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
          body: { npwp: npwp.trim(), password }
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
          refresh_token: data.refresh_token
        });
        if (sessionError) throw new Error('NPWP atau kata sandi tidak valid.');
      } else if (mode === 'signin') {
        const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      } else {
        const { data, error } = await client.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { full_name: fullName.trim() } }
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
        redirectTo: window.location.origin
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
        options: { redirectTo: window.location.origin }
      });
      if (error) throw error;
    } catch (e: any) {
      setError(e.message || 'Google sign-in gagal.');
      setBusy(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen grid place-items-center bg-slate-950 text-white p-4">
        <div className="flex flex-col items-center gap-4 animate-pulse">
          <img
            src="/mascot_3d.png"
            alt="Memeriksa Sesi Proyek Cair"
            className="w-20 h-20 object-contain drop-shadow-2xl"
          />
          <div className="text-sm font-semibold text-slate-400">Memeriksa sesi Proyek Cair…</div>
        </div>
      </div>
    );
  }

  if (recoveryMode) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 text-slate-100">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 shadow-2xl space-y-6">
          <div className="flex items-center gap-3">
            <img src="/mascot_3d.png" alt="Proyek Cair" className="w-12 h-12 object-contain" />
            <div>
              <h1 className="text-xl font-bold text-white">Buat Kata Sandi Baru</h1>
              <p className="text-xs text-slate-400">Gunakan kata sandi baru untuk akun Proyek Cair Anda.</p>
            </div>
          </div>
          <form onSubmit={submit} className="space-y-4">
            <label className="block text-xs font-semibold text-slate-300">
              Kata sandi baru
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>
            <label className="block text-xs font-semibold text-slate-300">
              Ulangi kata sandi baru
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </label>
            {error && (
              <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-300">
                {error}
              </div>
            )}
            <button
              disabled={busy}
              className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-3 text-xs font-bold text-white transition-all disabled:opacity-50 cursor-pointer shadow-lg shadow-blue-600/30"
            >
              {busy ? 'Memproses…' : 'Simpan Kata Sandi'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (authed) return <>{children}</>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 p-3 sm:p-6 lg:p-10 text-slate-100 selection:bg-blue-500 selection:text-white">
      {/* KARTU UTAMA DENGAN DUA KOLOM PROMOSI & LOGIN */}
      <div className="w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl grid grid-cols-1 lg:grid-cols-12">
        {/* =========================================================================
            KOLOM KIRI: BRANDING & 3D VISUAL SHOWCASE (SELALU TERINGAT)
           ========================================================================= */}
        <div className="lg:col-span-5 relative flex flex-col justify-between p-6 sm:p-8 lg:p-10 bg-linear-to-br from-slate-900 via-blue-950/70 to-slate-950 border-b lg:border-b-0 lg:border-r border-slate-800 overflow-hidden">
          {/* Ambient Lighting Glow di Balik Maskot */}
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -mt-10 w-72 h-72 bg-blue-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 right-0 -mb-10 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />

          {/* Bagian Atas: Banner Logo Resmi & Maskot 3D 1:1 */}
          <div className="relative z-10 space-y-6">
            {/* Banner Resmi (words_PNG2.png) */}
            <div className="w-full flex items-center justify-start">
              <img
                src="/words_PNG2.png"
                alt="Proyek Cair - Platform Operasional Proyek Konstruksi"
                className="w-full max-w-[280px] sm:max-w-[320px] h-auto object-contain drop-shadow-xl"
              />
            </div>

            {/* Container Maskot 3D: Rasio 1:1, Auto Shrink to Fit */}
            <div className="w-full flex items-center justify-center py-2">
              <div className="w-full max-w-[220px] sm:max-w-[260px] aspect-square flex items-center justify-center">
                <img
                  src="/mascot_3d.png"
                  alt="Maskot Proyek Cair"
                  className="w-full h-full object-contain drop-shadow-[0_15px_30px_rgba(37,99,235,0.3)] hover:scale-105 transition-transform duration-500"
                />
              </div>
            </div>

            {/* Tagline Promosi Utama */}
            <div className="space-y-2">
              <h3 className="text-base sm:text-lg font-bold text-white leading-snug">
                Kendalikan Arus Material & Keuangan Proyek{' '}
                <span className="text-transparent bg-clip-text bg-linear-to-r from-blue-400 via-cyan-300 to-emerald-400">
                  Tanpa Celah Kebocoran.
                </span>
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                Satu identitas terintegrasi untuk pembukuan nota fisik toko, pemantauan BOQ presisi, dan legalitas tanda tangan elektronik (TTE/QR).
              </p>
            </div>

            {/* 3 Keunggulan Utama */}
            <div className="space-y-2.5 pt-2 text-xs">
              <div className="flex items-start gap-2.5 text-slate-300">
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span><b>Buku Besar Abadi:</b> Tata kelola CRU Batal & Ganti tanpa hapus data.</span>
              </div>
              <div className="flex items-start gap-2.5 text-slate-300">
                <Receipt className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
                <span><b>Album Nota Fisik:</b> Deteksi belanja fiktif & selisih harga toko.</span>
              </div>
              <div className="flex items-start gap-2.5 text-slate-300">
                <QrCode className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span><b>TTE Digital Berjenjang:</b> Validasi checksum SHA-256 anti-pemalsuan.</span>
              </div>
            </div>
          </div>

          {/* Bagian Bawah: Badge Hak Cipta & Standar Keamanan */}
          <div className="relative z-10 pt-6 mt-6 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
            <span>© Proyek Cair Ecosystem</span>
            <span className="inline-flex items-center gap-1 text-slate-400">
              <Lock className="w-3 h-3 text-emerald-400" />
              <span>Enkripsi TLS & RLS</span>
            </span>
          </div>
        </div>

        {/* =========================================================================
            KOLOM KANAN: FORMULIR AUTENTIKASI (CLEAN, INTUITIF & RESPONSIF)
           ========================================================================= */}
        <div className="lg:col-span-7 p-6 sm:p-8 lg:p-10 flex flex-col justify-center bg-slate-900">
          <div className="max-w-md w-full mx-auto space-y-6">
            {/* Header Formulir */}
            <div>
              <h2 className="text-2xl font-black text-white tracking-tight">
                {mode === 'signin' ? 'Masuk ke Akun Anda' : 'Daftar Akun Baru'}
              </h2>
              <p className="mt-1 text-xs text-slate-400">
                {mode === 'signin'
                  ? 'Gunakan akun personal Anda atau NPWP untuk login Company Super Admin.'
                  : 'Satu akun personal berlaku untuk seluruh penugasan proyek dan perusahaan.'}
              </p>
            </div>

            {/* Tab Pilihan Metode Masuk (Email vs NPWP) */}
            {mode === 'signin' && (
              <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-slate-800/80 p-1 border border-slate-700/60 text-xs font-semibold">
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod('email');
                    setError('');
                  }}
                  className={`rounded-lg py-2 transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    loginMethod === 'email'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" />
                  <span>Email Akun</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLoginMethod('npwp');
                    setError('');
                  }}
                  className={`rounded-lg py-2 transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                    loginMethod === 'npwp'
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Building2 className="w-3.5 h-3.5" />
                  <span>NPWP Perusahaan (CSA)</span>
                </button>
              </div>
            )}

            {/* Formulir Input Data */}
            <form onSubmit={submit} className="space-y-4">
              {mode === 'signup' && (
                <label className="block text-xs font-semibold text-slate-300">
                  Nama Lengkap
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Contoh: Budi Santoso, S.T."
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </label>
              )}

              {(mode === 'signup' || loginMethod === 'email') && (
                <label className="block text-xs font-semibold text-slate-300">
                  Alamat Email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="nama@perusahaan.com"
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </label>
              )}

              {mode === 'signin' && loginMethod === 'npwp' && (
                <label className="block text-xs font-semibold text-slate-300">
                  Nomor Pokok Wajib Pajak (NPWP Perusahaan)
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    maxLength={32}
                    required
                    value={npwp}
                    onChange={(e) => setNpwp(e.target.value)}
                    placeholder="Contoh: 01.234.567.8-901.000"
                    className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <span className="mt-1 block text-[11px] text-slate-400">
                    Khusus Company Super Admin yang telah mendaftarkan badan usaha (RFIN-A).
                  </span>
                </label>
              )}

              <label className="block text-xs font-semibold text-slate-300">
                Kata Sandi (Password)
                <input
                  type="password"
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Minimal 8 karakter"
                  className="mt-1.5 w-full rounded-xl border border-slate-700 bg-slate-800/90 px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </label>

              {error && (
                <div role="alert" className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-300 leading-relaxed">
                  {error}
                </div>
              )}
              {notice && (
                <div role="status" className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-3 text-xs text-emerald-300 leading-relaxed">
                  {notice}
                </div>
              )}

              <button
                disabled={busy}
                className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-3 text-xs font-bold text-white transition-all shadow-md shadow-blue-600/30 disabled:opacity-50 cursor-pointer inline-flex items-center justify-center gap-2"
              >
                <span>{busy ? 'Memproses…' : mode === 'signin' ? 'Masuk ke Aplikasi' : 'Daftarkan Akun'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </form>

            {/* Lupa Kata Sandi */}
            {mode === 'signin' && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowRecoveryForm(!showRecoveryForm);
                    setRecoveryEmail(loginMethod === 'email' ? email : '');
                    setError('');
                    setNotice('');
                  }}
                  className="w-full text-xs font-medium text-blue-400 hover:underline cursor-pointer"
                >
                  Lupa kata sandi?
                </button>
                {showRecoveryForm && (
                  <div className="mt-3 space-y-3 rounded-2xl border border-slate-700 bg-slate-800/50 p-4 animate-fade-in">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Tautan pemulihan akan dikirimkan ke email yang terdaftar. Pesan konfirmasi tidak mengungkap apakah email terdaftar atau tidak demi keamanan.
                    </p>
                    <label className="block text-xs font-semibold text-slate-300">
                      Email akun Anda
                      <input
                        type="email"
                        autoComplete="email"
                        required
                        value={recoveryEmail}
                        onChange={(e) => setRecoveryEmail(e.target.value)}
                        placeholder="nama@email.com"
                        className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={sendPasswordRecovery}
                      className="w-full rounded-xl border border-slate-700 hover:bg-slate-700/60 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      {busy ? 'Mengirim…' : 'Kirim Tautan Pemulihan'}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Pemisah Garis ATAU */}
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="h-px flex-1 bg-slate-800" />
              <span>ATAU</span>
              <span className="h-px flex-1 bg-slate-800" />
            </div>

            {/* Tombol Masuk Google & Portal Recovery Custodian */}
            <div className="space-y-2">
              <button
                type="button"
                onClick={google}
                disabled={busy}
                className="w-full rounded-xl border border-slate-700 hover:bg-slate-800 px-4 py-2.5 text-xs font-semibold text-white transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                  />
                </svg>
                <span>Lanjutkan dengan Google</span>
              </button>

              <a
                href="/recovery-custodian"
                className="block w-full rounded-xl border border-cyan-800/70 hover:bg-cyan-950/40 px-4 py-2 text-center text-xs font-semibold text-cyan-300 transition-colors"
              >
                Portal Pemulihan Akses (Recovery Custodian)
              </a>
            </div>

            {/* Alih Mode Sign In / Sign Up */}
            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => {
                  setMode(mode === 'signin' ? 'signup' : 'signin');
                  setLoginMethod('email');
                  setShowRecoveryForm(false);
                  setError('');
                  setNotice('');
                }}
                className="text-xs font-semibold text-blue-400 hover:underline cursor-pointer"
              >
                {mode === 'signin'
                  ? 'Belum punya akun? Daftar Sekarang'
                  : 'Sudah punya akun? Masuk ke Aplikasi'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
