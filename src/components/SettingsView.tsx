import React from 'react';
import { useApp } from '../context/AppContext';
import { Database, ShieldCheck, LogOut, Sun, Moon, Download, CheckCircle2, AlertTriangle } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const {
    user,
    logout,
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
    activeRole
  } = useApp();

  const activeWorkspace = activeContext?.workspaces.find((w) => w.id === activeWorkspaceId) || null;

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

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 transition-colors">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Pengaturan Aplikasi</h1>
        <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
          Status akun dan sumber data operasional. Kredensial Supabase dikelola melalui environment Vercel, bukan browser.
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 transition-colors">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-bold text-slate-900 dark:text-white">{user.name}</div>
            <div className="text-xs text-slate-600 dark:text-slate-300 font-medium">{user.email}</div>
            <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
              Konteks: {activeContext?.workspaces.find((w) => w.id === activeWorkspaceId)?.name || 'Belum memilih Workspace'} · Jabatan: {activeRole || 'Belum dipilih'} · Project: {activeProject?.name || 'Belum dipilih'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void logout()}
            aria-label="Keluar dari akun"
            className="ml-auto inline-flex items-center gap-2 rounded-lg border border-rose-200 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
            <span>Keluar</span>
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 transition-colors">
        <div className="flex items-center gap-3">
          <Database className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
          <div>
            <h2 className="text-sm font-bold text-slate-900 dark:text-white">Database Supabase</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              {supabaseConfig.url || 'URL Supabase belum tersedia di environment.'}
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
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{dataError}</span>
          </div>
        )}

        <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            ['Baris BOQ', items.length],
            ['Mutasi Stok', stockMutations.length],
            ['Mutasi Kas', cashAccess ? cashMutations.length : 'Terbatas'],
            ['Dokumen', documents.length]
          ].map(([label, value]) => (
            <div key={String(label)} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-800">
              <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">{label}</div>
              <div className="mt-1 text-xl font-bold text-slate-900 dark:text-white tabular-nums">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-2 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          <span>Master BOQ dan transaksi berasal dari database. Tidak ada fallback data contoh atau penyimpanan transaksi lokal.</span>
        </div>
      </section>

      <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 transition-colors">
        <div className="flex-1">
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Tampilan</h2>
          <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">Preferensi tema perangkat ini.</p>
        </div>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Beralih ke Mode Terang' : 'Beralih ke Mode Gelap'}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800 transition-colors cursor-pointer"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-slate-600" />}
          <span>{theme === 'dark' ? 'Mode Terang' : 'Mode Gelap'}</span>
        </button>
        <button
          type="button"
          onClick={exportBackup}
          disabled={!dataReady || !!dataError || !activeProject?.permissions.includes('data.export')}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <Download className="h-4 w-4" />
          <span>Ekspor Data Database</span>
        </button>
      </section>
    </div>
  );
};
