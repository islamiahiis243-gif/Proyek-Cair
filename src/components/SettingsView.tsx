import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { AvatarCropperModal } from './AvatarCropperModal';
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
  ArrowLeft
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
    appMode,
    setAppMode,
    activeCompany,
    setCurrentView,
    goBack
  } = useApp();

  // Local state for editing personal profile
  const [fullName, setFullName] = useState(user.name || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatar_url || '');
  const [showAvatarPresets, setShowAvatarPresets] = useState(false);
  const [isCropperOpen, setIsCropperOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Preference density state
  const [tableDensity, setTableDensity] = useState<'comfortable' | 'compact'>(() => {
    return (localStorage.getItem('proyek_cair_density') as any) || 'comfortable';
  });

  const activeWorkspace = activeContext?.workspaces.find((w) => w.id === activeWorkspaceId) || null;

  // Preset avatars for quick selection
  const avatarPresets = [
    { label: 'Helm Proyek', url: 'https://images.unsplash.com/photo-1541888946425-d0fbb186156f?w=150&auto=format&fit=crop&q=80' },
    { label: 'Insinyur Lapangan', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80' },
    { label: 'Manajer Proyek', url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=150&auto=format&fit=crop&q=80' },
    { label: 'Administrasi / Clerk', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80' }
  ];

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

  // JIKA SEDANG DALAM MODE IMPERSONATE: Pengaturan dikunci
  if (appMode === 'IMPERSONATE') {
    return (
      <div className="mx-auto max-w-2xl py-12 px-4">
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 md:p-8 backdrop-blur-sm text-center space-y-4">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-amber-500/20 text-amber-500 flex items-center justify-center">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">
              Pengaturan Dikunci di Mode Penugasan Proyek
            </h1>
            <p className="mt-2 text-xs md:text-sm text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              Saat ini Anda sedang bertugas sebagai <span className="font-bold text-amber-600 dark:text-amber-400">{activeRole}</span> di <span className="font-bold text-slate-800 dark:text-slate-200">{activeCompany.name}</span>.
              <br className="hidden sm:inline" />
              Untuk menjaga integritas dan keamanan penugasan lapangan, pengaturan akun, profil, foto, tema, dan preferensi aplikasi hanya dapat diakses melalui <span className="font-bold text-emerald-600 dark:text-emerald-400">Akun Personal</span>.
            </p>
          </div>
          <div className="pt-2">
            <button
              type="button"
              onClick={() => setAppMode('PERSONAL')}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-md transition-colors cursor-pointer"
            >
              <span>Beralih ke Akun Personal untuk Mengatur Akun & Aplikasi</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
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
                <button
                  type="button"
                  onClick={() => setShowAvatarPresets(!showAvatarPresets)}
                  className="px-3 py-2 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                >
                  Pilih Preset
                </button>
              </div>
            </div>
          </div>

          {/* Pilihan Preset Avatar Cepat */}
          {showAvatarPresets && (
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2">
              <div className="text-[11px] font-semibold text-slate-600 dark:text-slate-400">
                Pilih Avatar Proyek Siap Pakai:
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {avatarPresets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setAvatarUrl(preset.url);
                      setShowAvatarPresets(false);
                    }}
                    className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-500 text-left transition-all"
                  >
                    <img src={preset.url} alt={preset.label} className="w-8 h-8 rounded-lg object-cover" />
                    <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate">
                      {preset.label}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

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
