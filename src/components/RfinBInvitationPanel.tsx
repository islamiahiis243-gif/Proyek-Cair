import React, { useCallback, useEffect, useState } from 'react';
import {
  KeyRound,
  Check,
  Copy,
  XCircle,
  RefreshCw,
  Send,
  AlertTriangle,
  ShieldCheck,
  Clock,
  Trash2,
  MoreVertical,
  UserX,
  Sparkles,
  CheckCircle2,
  FileEdit,
  Search,
  Award,
  QrCode,
  DollarSign,
  Wallet,
  Boxes,
  FileCheck,
  RotateCcw
} from 'lucide-react';
import { getSupabaseClient } from '../lib/supabase';
import { CustomRolePermissions } from '../types';

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

const ROLE_DEFAULT_PERMISSIONS: Record<string, CustomRolePermissions> = {
  CLERK: {
    canIssue: true,
    canCheck: false,
    canApprove: false,
    canAcknowledge: false,
    canInitiateBatalGanti: true,
    canInstructBatalGanti: false,
    canViewFinancials: true,
    canManageCash: true,
    canManageInventory: true,
  },
  FOREMAN: {
    canIssue: false,
    canCheck: true,
    canApprove: false,
    canAcknowledge: false,
    canInitiateBatalGanti: false,
    canInstructBatalGanti: true,
    canViewFinancials: false,
    canManageCash: false,
    canManageInventory: true,
  },
  SUPERVISOR: {
    canIssue: false,
    canCheck: true,
    canApprove: true,
    canAcknowledge: false,
    canInitiateBatalGanti: false,
    canInstructBatalGanti: true,
    canViewFinancials: true,
    canManageCash: true,
    canManageInventory: true,
  },
  DEPT_MANAGER: {
    canIssue: false,
    canCheck: false,
    canApprove: true,
    canAcknowledge: true,
    canInitiateBatalGanti: false,
    canInstructBatalGanti: true,
    canViewFinancials: true,
    canManageCash: true,
    canManageInventory: true,
  },
  KTT_PM: {
    canIssue: false,
    canCheck: false,
    canApprove: false,
    canAcknowledge: true,
    canInitiateBatalGanti: false,
    canInstructBatalGanti: true,
    canViewFinancials: true,
    canManageCash: true,
    canManageInventory: true,
  },
  CEO: {
    canIssue: false,
    canCheck: false,
    canApprove: false,
    canAcknowledge: true,
    canInitiateBatalGanti: false,
    canInstructBatalGanti: true,
    canViewFinancials: true,
    canManageCash: true,
    canManageInventory: true,
  },
  VIEWER: {
    canIssue: false,
    canCheck: false,
    canApprove: false,
    canAcknowledge: false,
    canInitiateBatalGanti: false,
    canInstructBatalGanti: false,
    canViewFinancials: false,
    canManageCash: false,
    canManageInventory: false,
  },
};

const SOLO_CLERK_ALL_IN_ONE_PERMISSIONS: CustomRolePermissions = {
  canIssue: true,
  canCheck: true,
  canApprove: true,
  canAcknowledge: true,
  canInitiateBatalGanti: true,
  canInstructBatalGanti: true,
  canViewFinancials: true,
  canManageCash: true,
  canManageInventory: true,
};

export const RfinBInvitationPanel: React.FC<{
  workspaceId: string;
  companyId: string;
  canAdmin: boolean;
  projects: Project[];
  initialEmail?: string;
  initialProjectId?: string;
}> = ({ companyId, canAdmin, projects, initialEmail, initialProjectId }) => {
  const db = getSupabaseClient();
  const [email, setEmail] = useState(initialEmail || '');
  const [selectedRole, setSelectedRole] = useState('CLERK');
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>(() => {
    if (initialProjectId) return [initialProjectId];
    return [];
  });
  const [expiryDays, setExpiryDays] = useState('7');
  const [customPermissions, setCustomPermissions] = useState<CustomRolePermissions>(() => ({
    ...ROLE_DEFAULT_PERMISSIONS['CLERK']
  }));
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issuedCode, setIssuedCode] = useState('');
  const [copyState, setCopyState] = useState('');
  const [openMenuTokenId, setOpenMenuTokenId] = useState<string | null>(null);

  // Perbarui wewenang saat peran dipilih (kecuali jika di-custom)
  const handleRoleChange = (roleCode: string) => {
    setSelectedRole(roleCode);
    const defaults = ROLE_DEFAULT_PERMISSIONS[roleCode] || ROLE_DEFAULT_PERMISSIONS['CLERK'];
    setCustomPermissions({ ...defaults });
  };

  const handleTogglePermission = (key: keyof CustomRolePermissions) => {
    setCustomPermissions((prev) => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  // Preset 1: Klerk Mandiri Lapangan (Solo / All-in-One) - Solusi skala menengah-bawah
  const handleApplySoloClerkPreset = () => {
    setCustomPermissions({ ...SOLO_CLERK_ALL_IN_ONE_PERMISSIONS });
    setNotice('Preset "Klerk Mandiri Lapangan (Solo / All-in-One)" diaktifkan: Wewenang penuh diberikan!');
    setTimeout(() => setNotice(''), 3500);
  };

  // Preset 2: Standar Jabatan Baku
  const handleApplyRoleDefaultPreset = () => {
    const defaults = ROLE_DEFAULT_PERMISSIONS[selectedRole] || ROLE_DEFAULT_PERMISSIONS['CLERK'];
    setCustomPermissions({ ...defaults });
    setNotice(`Wewenang disetel ulang sesuai standar jabatan ${selectedRole}.`);
    setTimeout(() => setNotice(''), 3000);
  };

  // Preset 3: Pengawas / Auditor (Read-Only)
  const handleApplyReadOnlyPreset = () => {
    setCustomPermissions({ ...ROLE_DEFAULT_PERMISSIONS['VIEWER'] });
    setNotice('Preset "Pengawas / Read-Only" diaktifkan.');
    setTimeout(() => setNotice(''), 3000);
  };

  // Tutup dropdown jika klik di luar
  useEffect(() => {
    const handleClose = () => setOpenMenuTokenId(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, []);

  // Sinkronisasi data awal jika diteruskan dari penugasan anggota
  useEffect(() => {
    if (initialEmail) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  useEffect(() => {
    if (initialProjectId) {
      setSelectedProjectIds([initialProjectId]);
    } else if (projects.length > 0 && selectedProjectIds.length === 0) {
      setSelectedProjectIds([projects[0].id]);
    }
  }, [initialProjectId, projects]);

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
      let code: string | null = null;
      let rpcErr: any = null;

      // 1. Coba panggil RPC dengan parameter custom_permissions
      try {
        const res = await db.rpc('issue_rfin_b', {
          p_company_id: companyId,
          p_recipient_email: email.trim().toLowerCase(),
          p_role_code: selectedRole,
          p_project_ids: selectedProjectIds,
          p_expires_in: `${expiryDays} days`,
          p_can_view_financials: Boolean(customPermissions.canViewFinancials),
          p_custom_permissions: customPermissions
        });
        code = res.data;
        rpcErr = res.error;
      } catch (callErr) {
        rpcErr = callErr;
      }

      // 2. Jika overload 7 parameter belum aktif di database, panggil dengan parameter dasar
      if (rpcErr || !code) {
        const fallbackRes = await db.rpc('issue_rfin_b', {
          p_company_id: companyId,
          p_recipient_email: email.trim().toLowerCase(),
          p_role_code: selectedRole,
          p_project_ids: selectedProjectIds,
          p_expires_in: `${expiryDays} days`,
          p_can_view_financials: Boolean(customPermissions.canViewFinancials)
        });
        code = fallbackRes.data;
        if (fallbackRes.error) {
          const f5 = await db.rpc('issue_rfin_b', {
            p_company_id: companyId,
            p_recipient_email: email.trim().toLowerCase(),
            p_role_code: selectedRole,
            p_project_ids: selectedProjectIds,
            p_expires_in: `${expiryDays} days`
          });
          code = f5.data;
          if (f5.error) throw f5.error;
        }
      }

      if (typeof code !== 'string') throw new Error('Gagal mendapatkan kode dari server.');

      // 3. Simpan snapshot wewenang kustom langsung ke database rfin_tokens
      const roleObj = ROLES.find((r) => r.code === selectedRole);
      const roleName = roleObj ? roleObj.name : selectedRole;
      try {
        await db
          .from('rfin_tokens')
          .update({
            snapshot: {
              role_code: selectedRole,
              personas: [{ name: roleName }],
              project_ids: selectedProjectIds,
              can_view_financials: Boolean(customPermissions.canViewFinancials),
              custom_permissions: customPermissions
            }
          })
          .eq('token_code', code);
      } catch (snapErr) {
        console.warn('Gagal update snapshot rfin_tokens:', snapErr);
      }

      // 4. Simpan ke local storage agar context aktif langsung mengenali wewenang kustom
      try {
        if (typeof window !== 'undefined') {
          localStorage.setItem(`pc_rfin_b_custom_perms_${code}`, JSON.stringify(customPermissions));
          for (const pid of selectedProjectIds) {
            localStorage.setItem(`pc_project_custom_perms_${pid}`, JSON.stringify(customPermissions));
          }
        }
      } catch {}

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

  // Batalkan undangan yang belum diklaim
  const handleCancelUnclaimed = async (inv: Invitation) => {
    setOpenMenuTokenId(null);
    if (busy) return;
    if (!window.confirm(`Batalkan undangan untuk ${inv.recipient_email}? Kode token ini tidak akan dapat digunakan lagi.`)) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: rpcErr } = await db.rpc('revoke_rfin_invitation', { p_token_id: inv.token_id });
      if (rpcErr || !data?.ok) {
        // Fallback ke revoke_rfin bawaan
        const { error: fErr } = await db.rpc('revoke_rfin', { p_token_id: inv.token_id });
        if (fErr) {
          await db.from('rfin_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', inv.token_id);
        }
      }
      setNotice(`Undangan untuk ${inv.recipient_email} berhasil dibatalkan.`);
      await loadInvitations();
    } catch (err: any) {
      setError(err?.message || 'Gagal membatalkan undangan.');
    } finally {
      setBusy(false);
    }
  };

  // Cabut akses / penugasan yang sudah diklaim
  const handleRevokeClaimed = async (inv: Invitation) => {
    setOpenMenuTokenId(null);
    if (busy) return;
    const roleName = inv.snapshot?.personas?.[0]?.name || inv.snapshot?.role_code || 'Jabatan Proyek';
    if (!window.confirm(`Cabut penugasan "${roleName}" untuk ${inv.recipient_email}? Akses dan kewenangan pada proyek terkait akan segera dinonaktifkan.`)) {
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      let rpcSuccess = false;
      const { data, error: rpcErr } = await db.rpc('revoke_rfin_invitation', { p_token_id: inv.token_id });
      if (!rpcErr && data?.ok) {
        rpcSuccess = true;
      } else {
        const { error: fErr } = await db.rpc('revoke_rfin', { p_token_id: inv.token_id });
        if (!fErr) rpcSuccess = true;
      }

      if (!rpcSuccess) {
        // Fallback langsung update project_memberships
        const roleCode = inv.snapshot?.role_code;
        const projectIds: string[] = inv.snapshot?.project_ids || [];
        const emailLower = inv.recipient_email.toLowerCase();

        let userId = (inv as any).redeemed_by;
        if (!userId) {
          const { data: prof } = await db.from('profiles').select('id').eq('email', emailLower).maybeSingle();
          userId = prof?.id;
        }

        if (userId && roleCode && projectIds.length > 0) {
          for (const pid of projectIds) {
            await db.from('project_memberships')
              .update({ membership_status: 'REVOKED', updated_at: new Date().toISOString() })
              .eq('project_id', pid)
              .eq('user_id', userId)
              .eq('role_code', roleCode);
          }
        }
        await db.from('rfin_tokens').update({ revoked_at: new Date().toISOString() }).eq('id', inv.token_id);
      }
      setNotice(`Penugasan "${roleName}" untuk ${inv.recipient_email} berhasil dicabut.`);
      await loadInvitations();
    } catch (err: any) {
      setError(err?.message || 'Gagal mencabut penugasan.');
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
                        onChange={() => handleRoleChange(r.code)}
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

          {/* Pengaturan Wewenang Dinamis Lapangan & Kantor (Diatur CSA) */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/60 pb-3">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                    Pengaturan Wewenang Custom (Otoritas CSA)
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                  Atur hak wewenang secara spesifik untuk penugasan ini, atau gunakan preset cepat di bawah.
                </p>
              </div>

              {/* Status Ringkasan Wewenang */}
              <div className="flex items-center gap-1.5 self-start sm:self-auto">
                {customPermissions.canCheck && customPermissions.canApprove && customPermissions.canAcknowledge ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                    <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                    Klerk Mandiri Lapangan (Solo)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200">
                    Wewenang Disesuaikan
                  </span>
                )}
              </div>
            </div>

            {/* Smart Preset Bar */}
            <div className="grid gap-2 sm:grid-cols-3">
              {/* Preset 1: Solo Clerk All-in-One */}
              <button
                type="button"
                onClick={handleApplySoloClerkPreset}
                className="group flex flex-col text-left p-2.5 rounded-xl border border-emerald-300 bg-emerald-50/80 dark:border-emerald-700/70 dark:bg-emerald-950/30 hover:bg-emerald-100/80 dark:hover:bg-emerald-900/40 transition-all shadow-sm"
              >
                <div className="flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <span className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
                    Klerk Mandiri Lapangan
                  </span>
                </div>
                <span className="text-[10px] text-emerald-800/80 dark:text-emerald-300/80 mt-1 leading-snug">
                  Wewenang lengkap input, periksa, setujui & TTE QR. Cocok untuk 1 klerk di lapangan tanpa multi-kursi.
                </span>
              </button>

              {/* Preset 2: Sesuai Standar Jabatan */}
              <button
                type="button"
                onClick={handleApplyRoleDefaultPreset}
                className="flex flex-col text-left p-2.5 rounded-xl border border-blue-200 bg-blue-50/60 dark:border-blue-800/60 dark:bg-blue-950/20 hover:bg-blue-100/60 dark:hover:bg-blue-900/30 transition-all shadow-sm"
              >
                <div className="flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  <span className="text-xs font-bold text-blue-900 dark:text-blue-200">
                    Standar Jabatan Baku
                  </span>
                </div>
                <span className="text-[10px] text-blue-800/80 dark:text-blue-300/80 mt-1 leading-snug">
                  Reset wewenang sesuai hierarki baku standar peran {selectedRole} yang dipilih.
                </span>
              </button>

              {/* Preset 3: Pengawas / Auditor */}
              <button
                type="button"
                onClick={handleApplyReadOnlyPreset}
                className="flex flex-col text-left p-2.5 rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-all shadow-sm"
              >
                <div className="flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-slate-600 dark:text-slate-400" />
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-200">
                    Pengawas (Read-Only)
                  </span>
                </div>
                <span className="text-[10px] text-slate-600 dark:text-slate-400 mt-1 leading-snug">
                  Hanya membaca laporan, tanpa izin membuat, memvalidasi, atau mengubah transaksi.
                </span>
              </button>
            </div>

            {/* 9 Interactive Authority Toggles */}
            <div className="grid gap-3 pt-1">
              {/* Grup 1: Alur Kerja & Pengesahan Dokumen */}
              <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-3 space-y-2">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <FileCheck className="w-3.5 h-3.5 text-blue-500" />
                  1. Alur Persetujuan & Pengesahan Dokumen (Workflow)
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canIssue)}
                      onChange={() => handleTogglePermission('canIssue')}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">Input / Terbitkan Draft (Tahap 1)</span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat menginput mutasi kas, stok barang, atau dokumen arsip proyek.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canCheck)}
                      onChange={() => handleTogglePermission('canCheck')}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">Periksa Fisik Lapangan (Tahap 2)</span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat memvalidasi kecocokan fisik barang dan nota pengeluaran.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canApprove)}
                      onChange={() => handleTogglePermission('canApprove')}
                      className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">Setujui Dokumen (Tahap 3)</span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat menyetujui dokumen dan transaksi untuk diteruskan ke pengesahan.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canAcknowledge)}
                      onChange={() => handleTogglePermission('canAcknowledge')}
                      className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                        Sahkan TTE & QR Code (Tahap 4)
                        <QrCode className="w-3 h-3 text-emerald-600" />
                      </span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat menandatangani resmi secara elektronik dan menerbitkan QR Code.</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Grup 2: Audit Trail Koreksi Batal / Ganti */}
              <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-3 space-y-2">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <RotateCcw className="w-3.5 h-3.5 text-amber-500" />
                  2. Koreksi Transaksi (Zero-Delete Audit Trail)
                </span>
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canInitiateBatalGanti)}
                      onChange={() => handleTogglePermission('canInitiateBatalGanti')}
                      className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">Inisiasi Batal / Ganti (Draft Koreksi)</span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat mengajukan perbaikan kesalahan pencatatan transaksi lama.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canInstructBatalGanti)}
                      onChange={() => handleTogglePermission('canInstructBatalGanti')}
                      className="mt-0.5 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white">Instruksikan / Putuskan Batal Ganti</span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat memutuskan pembatalan atau penggantian transaksi secara final.</p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Grup 3: Akses Finansial & Modul Operasional */}
              <div className="rounded-xl border border-slate-200/90 dark:border-slate-700/60 bg-white dark:bg-slate-900 p-3 space-y-2">
                <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                  <Boxes className="w-3.5 h-3.5 text-indigo-500" />
                  3. Modul Operasional & Akses Nilai Finansial
                </span>
                <div className="grid gap-2 sm:grid-cols-3">
                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canViewFinancials)}
                      onChange={() => handleTogglePermission('canViewFinancials')}
                      className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
                        <DollarSign className="w-3 h-3 text-indigo-500" />
                        Akses Nilai Finansial
                      </span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat melihat harga nota, total belanja riil, dan nominal kas.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canManageCash)}
                      onChange={() => handleTogglePermission('canManageCash')}
                      className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
                        <Wallet className="w-3 h-3 text-indigo-500" />
                        Kelola Kas Proyek
                      </span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat mengoperasikan buku kas, panjar, dan pencairan kas.</p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 p-2 rounded-lg border border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/40 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={Boolean(customPermissions.canManageInventory)}
                      onChange={() => handleTogglePermission('canManageInventory')}
                      className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <div>
                      <span className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1">
                        <Boxes className="w-3 h-3 text-indigo-500" />
                        Kelola Gudang Proyek
                      </span>
                      <p className="text-[10px] text-slate-600 dark:text-slate-400">Dapat mencatat penerimaan, pengeluaran & opname stok barang.</p>
                    </div>
                  </label>
                </div>
              </div>
            </div>
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

                    {/* Badge Wewenang Dinamis */}
                    {inv.snapshot?.custom_permissions && (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        {inv.snapshot.custom_permissions.canCheck &&
                        inv.snapshot.custom_permissions.canApprove &&
                        inv.snapshot.custom_permissions.canAcknowledge ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                            <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                            Klerk Solo Lapangan (All-in-One)
                          </span>
                        ) : (
                          <>
                            {inv.snapshot.custom_permissions.canIssue && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                Input
                              </span>
                            )}
                            {inv.snapshot.custom_permissions.canCheck && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                                Periksa
                              </span>
                            )}
                            {inv.snapshot.custom_permissions.canApprove && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                                Setujui
                              </span>
                            )}
                            {inv.snapshot.custom_permissions.canAcknowledge && (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                                TTE QR
                              </span>
                            )}
                          </>
                        )}
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                          inv.snapshot.custom_permissions.canViewFinancials
                            ? 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}>
                          {inv.snapshot.custom_permissions.canViewFinancials ? 'Rp Terbuka' : 'Rp Disembunyikan'}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {isRedeemed ? (
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        isRevoked
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                      }`}>
                        {isRevoked ? 'Akses Dicabut' : '✓ Sudah Diklaim'}
                      </span>
                    ) : isRevoked ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-medium">
                        Dibatalkan
                      </span>
                    ) : isExpired ? (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                        Kedaluwarsa
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                        Menunggu Klaim
                      </span>
                    )}

                    {/* Menu Titik Tiga (Aksi Dinamis Batalkan / Cabut) */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setOpenMenuTokenId(openMenuTokenId === inv.token_id ? null : inv.token_id)}
                        disabled={busy}
                        className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 transition-colors cursor-pointer"
                        title="Pilihan tindakan undangan"
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>

                      {openMenuTokenId === inv.token_id && (
                        <div className="absolute right-0 top-full mt-1.5 w-48 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-xl py-1.5 z-30 animate-in fade-in zoom-in-95">
                          {!isRedeemed && !isRevoked && !isExpired && (
                            <button
                              type="button"
                              onClick={() => handleCancelUnclaimed(inv)}
                              className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-left transition-colors cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5 text-rose-500" />
                              <span>Batalkan Undangan</span>
                            </button>
                          )}

                          {isRedeemed && !isRevoked && (
                            <button
                              type="button"
                              onClick={() => handleRevokeClaimed(inv)}
                              className="w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-left transition-colors cursor-pointer"
                            >
                              <UserX className="w-3.5 h-3.5 text-rose-500" />
                              <span>Cabut Akses / Penugasan</span>
                            </button>
                          )}

                          {(isRevoked || isExpired) && (
                            <div className="px-3.5 py-2 text-[11px] text-slate-400 dark:text-slate-500 italic">
                              {isRevoked ? 'Undangan telah dinonaktifkan' : 'Undangan sudah kedaluwarsa'}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
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
