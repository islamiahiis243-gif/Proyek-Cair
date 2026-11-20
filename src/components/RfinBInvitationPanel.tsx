import React, { useCallback, useEffect, useState } from 'react';
import { KeyRound, Check, Copy, XCircle, RefreshCw, Send, AlertTriangle, ShieldCheck, Clock, Trash2 } from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';

interface Project {
  id: string;
  project_code: string;
  name: string;
  status: string;
}

interface Invitation {
  token_id: string;
  recipient_email: string;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  revoked_at: string | null;
  snapshot: any;
}

const ROLES = [
  { code: 'CLERK', name: 'Clerk (Staf Administrasi / Logistik)', desc: 'Input transaksi, terbitkan dokumen draf, inisiasi Batal / Ganti' },
  { code: 'FOREMAN', name: 'Foreman (Mandor / Pengawas)', desc: 'Pemeriksaan level 1 (Diperiksa Oleh), instruksi Batal / Ganti' },
  { code: 'SUPERVISOR', name: 'Spv. (Supervisor)', desc: 'Pemeriksaan & Persetujuan (Disetujui Oleh), instruksi Batal / Ganti' },
  { code: 'DEPT_MANAGER', name: 'Dept. Manager (Manajer Bagian)', desc: 'Persetujuan & Mengetahui / TTE QR, instruksi Batal / Ganti' },
  { code: 'KTT_PM', name: 'KTT / Project Manager', desc: 'Pengesahan utama proyek (Mengetahui + TTE / QR), instruksi Batal / Ganti' },
  { code: 'CEO', name: 'CEO / Direktur', desc: 'Otorisasi puncak perusahaan (Mengetahui + TTE / QR), instruksi Batal / Ganti' },
  { code: 'VIEWER', name: 'Viewer / Pengamat (Auditor, Konsultan, Pengawas Klien, Pendana)', desc: 'Akses pantau read-only: dasbor analitik, rekapitulasi, buku mutasi, dan ekspor PDF' }
];

export const RfinBInvitationPanel: React.FC<{
  workspaceId: string;
  companyId: string;
  canAdmin: boolean;
  projects: Project[];
}> = ({ companyId, canAdmin, projects }) => {
  const db = getSupabaseClient();
  const [email, setEmail] = useState('');
  const [selectedRole, setSelectedRole] = useState('CLERK');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [expiryDays, setExpiryDays] = useState('7');
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedCode, setIssuedCode] = useState('');
  const [copyState, setCopyState] = useState('');

  // Default pilih project pertama jika ada
  useEffect(() => {
    if (projects.length > 0 && selectedProjectIds.length === 0) {
      setSelectedProjectIds([projects[0].id]);
    }
  }, [projects]);

  const loadInvitations = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const { data, error: rpcErr } = await db.rpc('list_company_rfin_b', { p_company_id: companyId });
      if (!rpcErr && data) {
        setInvitations(data as Invitation[]);
      }
    } catch {
      // Abaikan jika belum ada RPC
    } finally {
      setLoading(false);
    }
  }, [db, companyId]);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  const handleToggleProject = (id: string) => {
    setSelectedProjectIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const handleIssue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setNotice('');
    setIssuedCode('');
    setCopyState('');

    if (!email.trim() || !selectedRole || selectedProjectIds.length === 0) {
      setError('Mohon lengkapi email penerima, jabatan penugasan, dan minimal satu proyek.');
      return;
    }

    setBusy(true);
    try {
      const { data: code, error: rpcErr } = await db.rpc('issue_rfin_b', {
        p_company_id: companyId,
        p_recipient_email: email.trim().toLowerCase(),
        p_role_code: selectedRole,
        p_project_ids: selectedProjectIds,
        p_expires_in: `${expiryDays} days`
      });

      if (rpcErr) throw rpcErr;
      if (typeof code !== 'string') throw new Error('Gagal mendapatkan kode dari server.');

      setIssuedCode(code);
      setNotice(`Kode RFIN-B berhasil diterbitkan untuk ${email}!`);
      setEmail('');
      await loadInvitations();
    } catch (err: any) {
      setError(err?.message || 'Penerbitan kode RFIN-B gagal.');
    } finally {
      setBusy(false);
    }
  };

  const handleRevoke = async (tokenId: string, recipient: string) => {
    if (busy) return;
    if (!window.confirm(`Yakin ingin mencabut undangan untuk ${recipient}? Kode ini tidak akan dapat digunakan lagi.`)) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { error: rpcErr } = await db.rpc('revoke_rfin', { p_token_id: tokenId });
      if (rpcErr) throw rpcErr;
      setNotice(`Undangan untuk ${recipient} berhasil dicabut.`);
      await loadInvitations();
    } catch (err: any) {
      setError(err?.message || 'Gagal mencabut undangan.');
    } finally {
      setBusy(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(issuedCode);
      setCopyState('Kode disalin!');
      setTimeout(() => setCopyState(''), 3000);
    } catch {
      setCopyState('Gagal menyalin otomatis');
    }
  };

  if (!canAdmin) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Kartu Formulir Penerbitan */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center gap-3 mb-5 border-b border-slate-100 pb-4 dark:border-slate-800">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950 dark:text-blue-400">
            <KeyRound className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Penerbitan Undangan Jabatan Tim (RFIN-B)</h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Terbitkan kode untuk calon anggota tim. Penerima dapat memasukkan kode ini di menu Aktivasi RFIN-B untuk mengaktifkan Jabatan resmi pada proyek.
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {notice && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
            <Check className="h-4 w-4 shrink-0" />
            <span>{notice}</span>
          </div>
        )}

        {/* Modal Tampilan Kode Baru */}
        {issuedCode && (
          <div className="mb-6 rounded-2xl border border-emerald-300 bg-emerald-50/70 p-5 dark:border-emerald-800 dark:bg-emerald-950/40">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                <Check className="h-4 w-4" /> KODE RFIN-B BERHASIL DITERBITKAN
              </span>
              <button
                type="button"
                onClick={() => setIssuedCode('')}
                aria-label="Tutup notifikasi kode"
                className="text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
              Salin kode di bawah dan kirimkan ke email calon anggota. Kode ini berlaku selama {expiryDays} hari:
            </p>
            <div className="mt-3 flex items-center gap-2">
              <input
                readOnly
                value={issuedCode}
                onFocus={(e) => e.target.select()}
                className="flex-1 rounded-xl border border-emerald-300 bg-white p-3 font-mono text-base font-bold text-emerald-950 dark:border-emerald-700 dark:bg-slate-900 dark:text-emerald-200"
              />
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-3 text-xs font-semibold text-white shadow-sm hover:bg-emerald-700"
              >
                <Copy className="h-4 w-4" />
                <span>{copyState || 'Salin Kode'}</span>
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleIssue} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Email Calon Anggota Tim <span className="text-rose-500">*</span>
              </label>
              <input
                type="email"
                required
                disabled={busy}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="contoh: staf@email.com"
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
              <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                Boleh akun yang belum pernah mendaftar; setelah sign-up ia bisa langsung mengklaim.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Masa Berlaku Kode
              </label>
              <select
                value={expiryDays}
                onChange={(e) => setExpiryDays(e.target.value)}
                disabled={busy}
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
              >
                <option value="3">3 Hari</option>
                <option value="7">7 Hari (Disarankan)</option>
                <option value="14">14 Hari</option>
                <option value="30">30 Hari</option>
              </select>
            </div>
          </div>

          {/* Pemilihan Jabatan */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Pilih Jabatan Penugasan pada Proyek <span className="text-rose-500">*</span>
            </label>
            <p className="-mt-0.5 mb-2 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
              Satu orang boleh merangkap beberapa jabatan (misalnya saat kekurangan tenaga di lapangan). Terbitkan satu kode RFIN-B untuk setiap jabatan, lalu penerima mengaktivasi masing-masing kodenya.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {ROLES.map((r) => {
                const isSelected = selectedRole === r.code;
                return (
                  <label
                    key={r.code}
                    className={`flex flex-col p-3 rounded-xl border cursor-pointer transition-all ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50/60 dark:border-blue-600 dark:bg-blue-950/30'
                        : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="projectRole"
                        value={r.code}
                        checked={isSelected}
                        onChange={() => setSelectedRole(r.code)}
                        className="text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-xs font-bold text-slate-900 dark:text-white">{r.name}</span>
                    </div>
                    <span className="mt-1.5 text-[11px] text-slate-600 dark:text-slate-300 font-medium leading-relaxed">{r.desc}</span>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Pemilihan Project */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
              Pilih Project yang Ditugaskan <span className="text-rose-500">*</span>
            </label>
            {projects.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {projects.map((p) => {
                  const isChecked = selectedProjectIds.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleToggleProject(p.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                        isChecked
                          ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-600 dark:bg-blue-950/50 dark:text-blue-300'
                          : 'border-slate-200 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                      }`}
                    >
                      <span className={`h-2 w-2 rounded-full ${isChecked ? 'bg-blue-600' : 'bg-slate-400'}`} />
                      <span>{p.project_code || p.name}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Belum ada project terdaftar pada perusahaan ini. Buat project terlebih dahulu di menu Pengaturan Proyek.
              </p>
            )}
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={busy || projects.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              <Send className="h-4 w-4" />
              <span>{busy ? 'Menerbitkan...' : 'Terbitkan Kode RFIN-B'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Tabel Riwayat Undangan RFIN-B */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">Riwayat Undangan RFIN-B</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">Daftar kode token yang pernah diterbitkan oleh CSA.</p>
          </div>
          <button
            type="button"
            onClick={loadInvitations}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Segarkan</span>
          </button>
        </div>

        {invitations.length > 0 ? (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {invitations.map((inv) => {
              const isRedeemed = Boolean(inv.redeemed_at);
              const isRevoked = Boolean(inv.revoked_at);
              const isExpired = !isRedeemed && !isRevoked && new Date(inv.expires_at) < new Date();
              const roleDisplay = inv.snapshot?.personas?.[0]?.name || inv.snapshot?.role_code || 'Anggota Proyek';

              return (
                <div key={inv.token_id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm text-slate-900 dark:text-white flex items-center gap-2">
                      <span>{inv.recipient_email}</span>
                      <span className="text-xs text-blue-600 dark:text-blue-400 font-normal">
                        ({roleDisplay})
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium flex flex-wrap gap-2">
                      <span>Diterbitkan: {new Date(inv.created_at).toLocaleDateString('id-ID')}</span>
                      <span>·</span>
                      <span>Kedaluwarsa: {new Date(inv.expires_at).toLocaleDateString('id-ID')}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRedeemed ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        ✓ Sudah Diklaim
                      </span>
                    ) : isRevoked ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-medium">
                        Dicabut
                      </span>
                    ) : isExpired ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                        Kedaluwarsa
                      </span>
                    ) : (
                      <>
                        <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                          Menunggu Klaim
                        </span>
                        <button
                          type="button"
                          onClick={() => handleRevoke(inv.token_id, inv.recipient_email)}
                          disabled={busy}
                          className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-2.5 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 dark:border-rose-900 dark:text-rose-300 dark:hover:bg-rose-950/40"
                          title="Cabut kode undangan ini"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          <span>Cabut</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-xs text-slate-600 dark:text-slate-300 font-medium">
            Belum ada kode undangan RFIN-B yang diterbitkan untuk perusahaan ini.
          </p>
        )}
      </div>
    </div>
  );
};
