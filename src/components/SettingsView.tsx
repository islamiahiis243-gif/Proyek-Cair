import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { AvatarCropperModal } from './AvatarCropperModal';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  testGeminiConnection,
  isGeminiAiAvailable
} from '../lib/geminiService';
import {
  User,
  ShieldCheck,
  LogOut,
  Sun,
  Moon,
  Download,
  CheckCircle2,
  AlertTriangle,
  Camera,
  Globe2,
  Sparkles,
  Sliders,
  Database,
  ArrowRight,
  Save,
  Check,
  Upload,
  ArrowLeft,
  QrCode,
  KeyRound,
  Building2
} from 'lucide-react';

export const SettingsView: React.FC = () => {
  const {
    user,
    logout,
    updateUserProfile,
    theme,
    toggleTheme,
    items,
    stockMutations,
    cashMutations,
    documents,
    supabaseConfig,
    dataReady,
    dataError,
    cashAccess,
    activeContext,
    activeWorkspaceId,
    activeProject,
    activeRole,
    rolePermissions,
    canViewFinancials,
    appMode,
    setAppMode,
    activeCompany,
    setCurrentView,
    goBack
  } = useApp();

  // Local state for editing personal profile
  const [fullName, setFullName] = useState(user.name || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // State frasa sandi TTE/QR lapangan
  const [ttePassphrase, setTtePassphrase] = useState(() => {
    try {
      return localStorage.getItem(`pc_tte_passphrase_${user.id}`) || '';
    } catch {
      return '';
    }
  });
  const [tteSaved, setTteSaved] = useState(false);

  const handleSaveTtePassphrase = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      localStorage.setItem(`pc_tte_passphrase_${user.id}`, ttePassphrase.trim());
      setTteSaved(true);
      setTimeout(() => setTteSaved(false), 3000);
    } catch {}
  };

  // Preference density state
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>(() => {
    return (localStorage.getItem('proyek_cair_density') as any) || 'comfortable';
  });

  // State API Key Google Gemini
  const [geminiKeyInput, setGeminiKeyInput] = useState(() => getGeminiApiKey());
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [isTestingGemini, setIsTestingGemini] = useState(false);
  const [geminiTestResult, setGeminiTestResult] = useState<{ success: boolean; message: string; model?: string } | null>(null);

  const handleSaveGeminiKey = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setGeminiApiKey(geminiKeyInput);
    setGeminiTestResult({
      success: true,
      message: geminiKeyInput.trim()
        ? 'Kunci Google Gemini AI berhasil disimpan!'
        : 'Kunci Google Gemini dikosongkan. Sistem beroperasi dalam Mode Pintar Offline.'
    });
    setTimeout(() => setGeminiTestResult(null), 5000);
  };

  const handleTestGemini = async () => {
    setIsTestingGemini(true);
    setGeminiTestResult(null);
    const res = await testGeminiConnection(geminiKeyInput);
    setIsTestingGemini(false);
    setGeminiTestResult(res);
  };

  const renderGeminiSettingsCard = () => (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-linear-to-br from-blue-500 to-indigo-600 text-white shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Google Gemini Live AI & Vision OCR
              </h2>
              <span
                className={`text-[9px] font-bold px-2 py-0.5 rounded-full border ${
                  isGeminiAiAvailable()
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                    : 'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                }`}
              >
                {isGeminiAiAvailable() ? '🟢 Terhubung AI Cloud' : '🟡 Mode Pintar Offline'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Aktifkan percakapan alami seperti Gemini Live dan pembacaan foto nota otomatis via kamera/unggah.
            </p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSaveGeminiKey} className="space-y-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
            API Key Google Gemini (Gratis dari Google AI Studio)
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="relative flex-1">
              <input
                type={showGeminiKey ? 'text' : 'password'}
                value={geminiKeyInput}
                onChange={e => setGeminiKeyInput(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-colors pr-16"
              />
              <button
                type="button"
                onClick={() => setShowGeminiKey(!showGeminiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 px-1.5 py-0.5 rounded-md cursor-pointer"
              >
                {showGeminiKey ? 'Tutup' : 'Lihat'}
              </button>
            </div>
            <button
              type="submit"
              className="py-2.5 px-4 rounded-xl bg-blue-600 hover:bg-blue-500 active:scale-98 text-white font-bold text-xs shadow-xs transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Simpan</span>
            </button>
            <button
              type="button"
              disabled={isTestingGemini || !geminiKeyInput.trim()}
              onClick={handleTestGemini}
              className="py-2.5 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-all cursor-pointer inline-flex items-center gap-1.5 shrink-0 disabled:opacity-50"
            >
              {isTestingGemini ? (
                <Sparkles className="w-3.5 h-3.5 animate-spin text-blue-500" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              )}
              <span>{isTestingGemini ? 'Menguji...' : 'Uji Koneksi'}</span>
            </button>
          </div>
        </div>

        {geminiTestResult && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${
              geminiTestResult.success
                ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
            }`}
          >
            {geminiTestResult.success ? (
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
            )}
            <div>
              <p className="font-semibold">{geminiTestResult.message}</p>
              {geminiTestResult.model && (
                <p className="text-[10px] mt-0.5 opacity-80">Model aktif: {geminiTestResult.model}</p>
              )}
            </div>
          </div>
        )}

        <div className="pt-2 text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
          <p>
            💡 Kunci disimpan di peramban Anda. Anda bisa membuat API Key gratis tanpa kartu kredit di{' '}
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 dark:text-blue-400 font-semibold underline underline-offset-2 hover:text-blue-500"
            >
              Google AI Studio
            </a>
            .
          </p>
          <p>
            ⚡ Bila kunci tidak diisi atau perangkat offline di lapangan tanpa sinyal internet, asisten suara dan mutasi tetap berjalan mulus menggunakan <strong>Mesin Pintar Heuristik Proyek Cair</strong>.
          </p>
        </div>
      </form>
    </section>
  );

  const activeWorkspace = activeContext?.workspaces.find((w) => w.id === activeWorkspaceId) || null;

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      await updateUserProfile({
        name: fullName.trim() || user.name,
        avatar_url: avatarUrl.trim() || undefined
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveCroppedAvatar = async (croppedDataUrl: string) => {
    setAvatarUrl(croppedDataUrl);
    setIsSaving(true);
    try {
      await updateUserProfile({
        name: fullName.trim() || user.name,
        avatar_url: croppedDataUrl
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3500);
    } finally {
      setIsSaving(false);
    }
  };

  const handleSelectDensity = (density: 'comfortable' | 'compact') => {
    setTableDensity(density);
    localStorage.setItem('proyek_cair_density', density);
  };

  const exportBackup = () => {
    if (!activeProject || !activeProject.permissions.includes('data.export')) return;
    const payload = {
      product: 'Proyek Cair',
      format_version: 1,
      workspace_id: activeWorkspaceId,
      project_id: activeProject.id,
      workspace: {
        id: activeWorkspaceId,
        name: activeWorkspace?.name || null,
        type: activeWorkspace?.type || null
      },
      project: activeProject.name,
      project_code: activeProject.project_code,
      exported_at: new Date().toISOString(),
      source: 'Supabase operational database',
      cash_access: cashAccess,
      boq_items: items,
      inventory_transactions: stockMutations,
      cash_transactions: cashMutations,
      documents
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(activeProject.project_code || activeProject.name || 'project').replace(/[^a-z0-9_-]+/gi, '-')}-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // JIKA SEDANG DALAM MODE IMPERSONATE: Tampilkan Pengaturan Karyawan, Frasa Sandi TTE/QR & Kenyamanan Lapangan
  if (appMode === 'IMPERSONATE') {
    const isSoloClerk = Boolean(
      rolePermissions.canCheck && rolePermissions.canApprove && rolePermissions.canAcknowledge
    );

    return (
      <div className="mx-auto max-w-4xl space-y-6 pb-12">
        {/* Header Utama Pengaturan Karyawan */}
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goBack ? goBack() : setCurrentView('dashboard')}
                  className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer mr-1"
                  title="Kembali ke Dasbor"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Dasbor</span>
                </button>
                <span className="text-slate-300 dark:text-slate-700">/</span>
                <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
                  Pengaturan Karyawan
                </span>
              </div>
              <div>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                  <span>Penugasan Karyawan Proyek ({activeRole})</span>
                </div>
                <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-1.5">
                  Pengaturan Data Diri & TTE Lapangan
                </h1>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
                  Kelola data diri sebagai karyawan di {activeCompany.name}, frasa sandi verifikasi TTE/QR elektronik, dan kenyamanan visual lapangan.
                </p>
              </div>
            </div>

            {/* Banner Logo Rata Kanan Atas */}
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

        {/* Bagian 1: Identitas Karyawan & Penugasan Lapangan */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
                <User className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-900 dark:text-white">Identitas Karyawan & Penugasan</h2>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                  Informasi jabatan resmi yang disematkan saat menandatangani dokumen dan transaksi lapangan.
                </p>
              </div>
            </div>
            {isSoloClerk && (
              <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                Klerk Mandiri Lapangan (Solo)
              </span>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Perusahaan Kontraktor</span>
              <div className="font-bold text-sm text-slate-900 dark:text-white mt-0.5">{activeCompany.name}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">NPWP: {activeCompany.npwp || 'Belum Terdaftar'}</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Proyek yang Ditugaskan</span>
              <div className="font-bold text-sm text-slate-900 dark:text-white mt-0.5">{activeProject?.name || 'Semua Proyek Perusahaan'}</div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">Kode: {activeProject?.project_code || '-'}</div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Jabatan Penugasan Saat Ini</span>
              <div className="font-bold text-sm text-slate-900 dark:text-white mt-0.5 flex items-center gap-2">
                <span>{activeRole}</span>
                <span className="text-xs font-normal text-slate-500 dark:text-slate-400">({user.email})</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Hak Akses Finansial</span>
              <div className="font-bold text-sm text-slate-900 dark:text-white mt-0.5">
                {canViewFinancials ? (
                  <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Nominal Finansial & Harga Terbuka
                  </span>
                ) : (
                  <span className="text-slate-500 dark:text-slate-400">Nominal Finansial Disembunyikan (CSA)</span>
                )}
              </div>
            </div>
          </div>

          {/* Form Pembaruan Nama Lengkap Penandatangan */}
          <form onSubmit={handleSaveProfile} className="pt-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Nama Lengkap / Gelar Resmi Penandatangan (Tercetak di Dokumen Resmi)
            </label>
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Contoh: Budi Santoso, S.T."
                className="flex-1 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs disabled:opacity-50 transition-colors"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Menyimpan...' : 'Simpan Nama'}</span>
              </button>
            </div>
            {saveSuccess && (
              <p className="mt-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                <Check className="w-3.5 h-3.5" /> Nama penandatangan berhasil diperbarui.
              </p>
            )}
          </form>
        </section>

        {/* Bagian 2: Pengaturan & Frasa Sandi TTE / Validasi QR */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
              <QrCode className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Validasi TTE & Frasa Sandi Pengesahan (QR Code)
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Setiap dokumen resmi yang disahkan (Tahap 4) akan mencetak QR Code Tanda Tangan Elektronik resmi berstempel waktu.
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 items-start">
            {/* Form Frasa Sandi TTE */}
            <form onSubmit={handleSaveTtePassphrase} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Frasa Sandi TTE / Kata Kunci Pengesahan (Opsional)
                </label>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Kata sandi cepat pribadi untuk memverifikasi niat sebelum menerbitkan stempel QR sah pada dokumen proyek.
                </p>
                <input
                  type="password"
                  value={ttePassphrase}
                  onChange={(e) => setTtePassphrase(e.target.value)}
                  placeholder="Contoh: SAHKAN-2026 atau PIN 6 angka"
                  className="mt-1.5 w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-950 p-2.5 text-xs text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-xs transition-colors"
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>Simpan Frasa Sandi TTE</span>
              </button>

              {tteSaved && (
                <p className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <Check className="w-3.5 h-3.5" /> Frasa sandi TTE tersimpan di perangkat ini.
                </p>
              )}
            </form>

            {/* Pratinjau Visual Stempel TTE QR */}
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/30 flex items-center gap-3.5">
              <div className="p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-emerald-300 dark:border-emerald-700 shadow-xs shrink-0">
                <QrCode className="w-12 h-12 text-emerald-700 dark:text-emerald-400" />
              </div>
              <div className="text-[11px] space-y-0.5">
                <div className="font-extrabold text-emerald-950 dark:text-emerald-300 uppercase tracking-wide">
                  Tanda Tangan Elektronik Sah (TTE)
                </div>
                <div className="font-bold text-slate-800 dark:text-slate-200">{fullName || user.name}</div>
                <div className="text-slate-500 dark:text-slate-400">{activeRole} · {activeCompany.name}</div>
                <div className="text-[10px] text-emerald-700 dark:text-emerald-400 font-mono font-medium">
                  STATUS: TERVERIFIKASI SISTEM
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Integrasi Google Gemini Live & Vision AI Lapangan */}
        {renderGeminiSettingsCard()}

        {/* Bagian 3: Kenyamanan & Mode Tampilan Lapangan */}
        <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors space-y-4">
          <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-4">
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                Kenyamanan Tampilan Lapangan
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Sesuaikan kontras dan pencahayaan untuk kenyamanan mata di lapangan terbuka maupun malam hari.
              </p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={toggleTheme}
              className="flex items-center justify-between p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors text-left"
            >
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  {theme === 'dark' ? <Moon className="w-4 h-4 text-purple-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
                  Tema: {theme === 'dark' ? 'Mode Gelap (Dark)' : 'Mode Terang (Light)'}
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                  Klik untuk beralih ke {theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}
                </span>
              </div>
              <span className="text-xs font-bold text-blue-600 dark:text-blue-400">Ganti</span>
            </button>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Globe2 className="w-4 h-4 text-blue-500" />
                  Bahasa Antarmuka
                </span>
                <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 block">
                  100% Bahasa Indonesia baku & istilah teknis kontraktor
                </span>
              </div>
              <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400">Indonesia</span>
            </div>
          </div>
        </section>

        {/* Bagian 4: Navigasi Beralih ke Akun Personal */}
        <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <span className="text-xs font-bold text-slate-900 dark:text-white">Ingin mendaftarkan perusahaan baru atau mengelola akun pribadi?</span>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">Beralih ke Akun Personal untuk mengajukan RFIN-A atau mereset data akun pribadi.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setAppMode('PERSONAL');
              setCurrentView('dashboard');
            }}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors shrink-0 cursor-pointer"
          >
            <User className="w-3.5 h-3.5" />
            <span>Beralih ke Akun Personal</span>
          </button>
        </div>
      </div>
    );
  }

  // MODE PERSONAL: Akses Lengkap Pengaturan Akun & Aplikasi
  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      {/* Header Utama Pengaturan */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => goBack ? goBack() : setCurrentView('dashboard')}
                className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer mr-1"
                title="Kembali ke satu langkah/halaman sebelumnya"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Dasbor</span>
              </button>
              <span className="text-slate-300 dark:text-slate-700">/</span>
              <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
                Pengaturan
              </span>
            </div>
            <div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                <User className="w-3.5 h-3.5" />
                <span>Pusat Kendali Akun Pribadi</span>
              </div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-white mt-1.5">
                Pengaturan Akun & Aplikasi
              </h1>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
                Kelola identitas pribadi, foto profil, tema warna, bahasa, serta preferensi aplikasi Proyek Cair Anda.
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

      {/* Bagian 1: Profil Pengguna & Foto Avatar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4 mb-5">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400">
              <User className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">Profil Pribadi</h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                Nama lengkap dan foto profil yang digunakan saat menandatangani dokumen atau mencatat transaksi.
              </p>
            </div>
          </div>
          {saveSuccess && (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 animate-in fade-in">
              <Check className="w-3.5 h-3.5" />
              <span>Perubahan Disimpan!</span>
            </span>
          )}
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-5">
          {/* Baris Foto Profil & Pilihan Cepat */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="relative group shrink-0">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt={fullName || user.name}
                  className="w-16 h-16 rounded-2xl object-cover border-2 border-slate-200 dark:border-slate-700 shadow-xs cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => setIsCropperOpen(true)}
                />
              ) : (
                <div
                  onClick={() => setIsCropperOpen(true)}
                  className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center font-bold text-xl shadow-xs cursor-pointer hover:opacity-90 transition-opacity"
                >
                  {(fullName || user.name || 'P').slice(0, 2).toUpperCase()}
                </div>
              )}
              <button
                type="button"
                onClick={() => setIsCropperOpen(true)}
                title="Ambil / Unggah Foto (Potong 1:1)"
                className="absolute -bottom-1 -right-1 p-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm cursor-pointer transition-colors"
              >
                <Camera className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex-1 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Foto / Avatar Profil
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Format persegi (1:1)
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCropperOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Ambil / Unggah Foto (Potong 1:1)</span>
                </button>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl('')}
                    className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                  >
                    Gunakan Inisial Nama
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Input Nama Lengkap & Email */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nama Lengkap
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80 px-3.5 py-2.5 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center justify-between">
                <span>Alamat Email (Login)</span>
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold">● Terverifikasi</span>
              </label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/40 px-3.5 py-2.5 text-slate-500 dark:text-slate-400 cursor-not-allowed"
              />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSaving ? 'Menyimpan...' : 'Simpan Perubahan Profil'}</span>
            </button>
          </div>
        </form>
      </section>

      {/* Bagian 2: Pengaturan Tema Tampilan (Light & Dark) */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors">
        <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-4 mb-5">
          <div className="p-2 rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Tema Tampilan Aplikasi</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Sesuaikan kontras dan kenyamanan visual layar dengan kondisi pencahayaan tempat Anda bekerja.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Opsi Mode Terang */}
          <button
            type="button"
            onClick={() => {
              if (theme !== 'light') toggleTheme();
            }}
            className={`flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all cursor-pointer ${
              theme === 'light'
                ? 'border-blue-600 bg-blue-50/50 shadow-xs ring-2 ring-blue-500/20'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className={`p-2.5 rounded-xl shrink-0 ${theme === 'light' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
              <Sun className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">Mode Terang (Light)</span>
                {theme === 'light' && <CheckCircle2 className="w-4 h-4 text-blue-600 shrink-0" />}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                Warna cerah dengan latar putih bersih. Sangat direkomendasikan untuk penggunaan siang hari atau di luar ruangan.
              </p>
            </div>
          </button>

          {/* Opsi Mode Gelap */}
          <button
            type="button"
            onClick={() => {
              if (theme !== 'dark') toggleTheme();
            }}
            className={`flex items-start gap-3.5 p-4 rounded-xl border text-left transition-all cursor-pointer ${
              theme === 'dark'
                ? 'border-blue-500 bg-blue-950/40 shadow-xs ring-2 ring-blue-500/30'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 hover:border-slate-300 dark:hover:border-slate-700'
            }`}
          >
            <div className={`p-2.5 rounded-xl shrink-0 ${theme === 'dark' ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300'}`}>
              <Moon className="w-5 h-5" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 dark:text-white">Mode Gelap (Dark)</span>
                {theme === 'dark' && <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />}
              </div>
              <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium leading-relaxed">
                Latar gelap elegan dengan teks kontras tinggi. Mengurangi kelelahan mata saat bekerja malam hari dan menghemat baterai.
              </p>
            </div>
          </button>
        </div>
      </section>

      {/* Bagian 3: Bahasa Aplikasi & Aksesibilitas */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors">
        <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-4 mb-5">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Globe2 className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Bahasa Antarmuka & Standar Operasional</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Pengaturan bahasa resmi dan penataan teks aplikasi.
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-xl border border-emerald-500/30 bg-emerald-50/40 dark:bg-emerald-950/20">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🇮🇩</span>
            <div>
              <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                <span>Bahasa Indonesia (Native 100%)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-emerald-600 text-white">Aktif</span>
              </div>
              <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                Seluruh istilah teknis mutasi barang, mutasi kas, dokumen TTE, dan katalog BOQ disajikan dalam tata bahasa Indonesia baku.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Bagian 4: Kepadatan Tampilan & Kenyamanan Penggunaan */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors">
        <div className="flex items-center gap-2.5 border-b border-slate-100 dark:border-slate-800 pb-4 mb-5">
          <div className="p-2 rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Kenyamanan Tampilan Tabel</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Pilihan kepadatan baris data mutasi barang dan laporan kas sesuai perangkat Anda.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            type="button"
            onClick={() => handleSelectDensity('comfortable')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              tableDensity === 'comfortable'
                ? 'border-purple-600 bg-purple-50/40 dark:bg-purple-950/30 ring-2 ring-purple-500/20'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white">Tampilan Nyaman (Standar)</span>
              {tableDensity === 'comfortable' && <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Jarak baris lega dengan tombol aksi yang mudah disentuh pada layar tablet dan ponsel.
            </p>
          </button>

          <button
            type="button"
            onClick={() => handleSelectDensity('compact')}
            className={`p-4 rounded-xl border text-left transition-all cursor-pointer ${
              tableDensity === 'compact'
                ? 'border-purple-600 bg-purple-50/40 dark:bg-purple-950/30 ring-2 ring-purple-500/20'
                : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-900 dark:text-white">Tampilan Ringkas (Kompak)</span>
              {tableDensity === 'compact' && <CheckCircle2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
            </div>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              Kepadatan tinggi untuk melihat puluhan baris data sekaligus tanpa banyak menggulir layar desktop.
            </p>
          </button>
        </div>
      </section>

      {/* Integrasi Google Gemini Live & Vision AI */}
      {renderGeminiSettingsCard()}

      {/* Bagian 5: Status Database & Kredensial Lingkungan */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 shadow-xs transition-colors">
        <div className="flex items-center gap-3 border-b border-slate-100 dark:border-slate-800 pb-4 mb-5">
          <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Status Database & Server</h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
              {supabaseConfig.url || 'URL Supabase terpasang via Environment Vercel.'}
            </p>
          </div>
          <span
            className={`ml-auto rounded-full px-3 py-1 text-[11px] font-semibold ${
              dataReady && !dataError
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
            }`}
          >
            {dataReady && !dataError ? 'Data Termuat' : 'Memeriksa Koneksi'}
          </span>
        </div>

        {dataError && (
          <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{dataError}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Baris BOQ', items.length],
            ['Mutasi Stok', stockMutations.length],
            ['Mutasi Kas', cashAccess ? cashMutations.length : 'Terbatas'],
            ['Dokumen Resmi', documents.length]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
              <div className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">{label}</div>
              <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-1.5 font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>Master BOQ dan transaksi disinkronkan secara aman ke Postgres Supabase.</span>
          </div>
          {activeProject?.permissions.includes('data.export') && (
            <button
              type="button"
              onClick={exportBackup}
              disabled={!dataReady || !!dataError}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ekspor Backup JSON</span>
            </button>
          )}
        </div>
      </section>

      {/* Bagian 6: Keamanan Akun & Keluar Sesi */}
      <section className="rounded-2xl border border-rose-200/80 bg-rose-50/30 p-6 dark:border-rose-950/60 dark:bg-rose-950/10 shadow-xs transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>Sesi Masuk Pengguna</span>
          </h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
            Keluar dari sesi peramban ini jika Anda menggunakan komputer bersama atau telah selesai bertugas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          aria-label="Keluar dari akun"
          className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0"
        >
          <LogOut className="w-4 h-4" />
          <span>Keluar dari Akun</span>
        </button>
      </section>
      {/* Modal Potong & Manipulasi Foto Profil (Crop 1:1 ala FB) */}
      <AvatarCropperModal
        isOpen={isCropperOpen}
        onClose={() => setIsCropperOpen(false)}
        onSave={handleSaveCroppedAvatar}
        currentAvatarUrl={avatarUrl}
      />
    </div>
  );
};
