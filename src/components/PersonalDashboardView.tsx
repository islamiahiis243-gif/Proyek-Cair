import React from 'react';
import { useApp } from '../context/AppContext';
import { Building2, KeyRound, ShieldCheck, UserCheck, ArrowRight, Info, CheckCircle2 } from 'lucide-react';

export const PersonalDashboardView: React.FC = () => {
  const { user, setCurrentView, activeContext } = useApp();

  const userAssignments = activeContext?.projects || [];
  const hasAssignments = userAssignments.length > 0;

  return (
    <div className="space-y-6">
      {/* Banner Selamat Datang Personal */}
      <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800">
              <UserCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Akun Pribadi Terverifikasi</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white pt-1">
              Dasbor Personal — {user.name || 'Pengguna Proyek Cair'}
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium max-w-2xl">
              Identitas terdaftar: <span className="font-semibold text-slate-800 dark:text-slate-200">{user.email}</span>. Akun ini berada di Mode Personal dengan ruang kerja mandiri yang terisolasi secara privat.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/60">
              Personal Workspace Aktif
            </span>
          </div>
        </div>
      </div>

      {/* Status Keanggotaan & Perlindungan Data Tenant */}
      <div className="rounded-2xl border border-blue-200/80 bg-blue-50/50 p-5 dark:border-blue-900/60 dark:bg-blue-950/20">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">
              Privasi & Isolasi Data Multi-Tenant
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed font-medium">
              Data operasional, anggaran kontrak pelaksanaan, pos BOQ, serta transaksi kas dan logistik adalah milik mutlak masing-masing perusahaan tenant (seperti <b>CV MENARA MEGAH</b>) dan dilindungi oleh sistem keamanan berbasis mandat. Akun personal tidak dapat melihat data internal perusahaan lain tanpa penugasan resmi dari Company Super Admin (CSA).
            </p>
          </div>
        </div>
      </div>

      {/* Grid 2 Kartu Tindakan Utama */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {/* Kartu 1: Pendaftaran Perusahaan Baru (RFIN-A) */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between transition-all hover:border-blue-400 dark:hover:border-blue-600">
          <div>
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400 flex items-center justify-center mb-4">
              <Building2 className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Daftarkan Perusahaan Baru (RFIN-A)
            </h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
              Jika Anda adalah pimpinan kontraktor atau pemilik badan usaha, ajukan pendaftaran perusahaan baru sebagai Tenant di Proyek Cair. Setelah diverifikasi oleh Platform Super Admin (PSA), Anda akan memegang kursi Company Super Admin (CSA) untuk perusahaan Anda sendiri.
            </p>
          </div>

          <div className="pt-6">
            <button
              type="button"
              onClick={() => setCurrentView('rfin-a-request')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              <span>Buka Formulir Pengajuan Tenant (RFIN-A)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Kartu 2: Aktivasi Kode Undangan Tim (RFIN-B) */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-sm flex flex-col justify-between transition-all hover:border-amber-400 dark:hover:border-amber-600">
          <div>
            <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400 flex items-center justify-center mb-4">
              <KeyRound className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              Aktivasi Kode Undangan Jabatan Tim (RFIN-B)
            </h3>
            <p className="mt-2 text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
              Jika Anda staf atau profesional yang ditugaskan oleh Company Super Admin (CSA) pada suatu proyek perusahaan, masukkan kode undangan RFIN-B yang dikirimkan ke email Anda untuk mengaktifkan jabatan resmi (Clerk, Supervisor, Dept. Manager, KTT, atau CEO).
            </p>
          </div>

          <div className="pt-6">
            <button
              type="button"
              onClick={() => setCurrentView('rfin-b-input')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-600 hover:bg-amber-700 px-4 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors cursor-pointer"
            >
              <span>Aktivasi Kode Undangan (RFIN-B)</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Informasi Tambahan Jika Akun Memiliki Penugasan Sah */}
      {hasAssignments && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-900/60 dark:bg-emerald-950/20">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                Penugasan Proyek Terdeteksi pada Akun Anda
              </h4>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mt-1">
                Akun Anda telah memiliki penugasan sah pada proyek perusahaan. Anda dapat beralih ke topi kerja proyek Anda kapan saja melalui pemilih jabatan di bilah atas (Header).
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
