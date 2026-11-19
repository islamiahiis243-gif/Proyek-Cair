import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertCircle, Building2, CheckCircle2, Clock3,
  Copy, FileCheck2, LayoutDashboard, LockKeyhole, RefreshCw,
  Search, ShieldCheck, Users, XCircle, ChevronDown, ChevronRight
} from 'lucide-react';
import { getSupabaseClient, resolveMyActiveContext } from '../lib/supabase';

// ─── Tipe ─────────────────────────────────────────────────────────────────────
type Permohonan = {
  id: string;
  legal_name: string;
  npwp_last4: string;
  super_admin_email: string;
  status: string;
  created_at: string;
  review_notes: string | null;
  notes: string | null;
};
type Company = { id: string; legal_name: string; registration_status?: string; status?: string; created_at: string };
type Seat = { company_id: string; recipient_email: string; seat_status: string };
type AuditRow = { id: string; actor_id: string; action: string; entity_type: string; entity_id: string; details: any; created_at: string };
type ProfileChange = {
  id: string; company_id: string; proposed_legal_name: string | null;
  change_npwp: boolean; proposed_npwp_last4: string | null;
  reason: string; status: string; created_at: string; review_notes: string | null;
};
type RoleRow = { role_code: string; display_name: string; description: string; sort_order: number };
type PermRow = { permission_code: string; display_name: string; module: string; action: string; requires_authority_check: boolean; description: string };
type Mapping = { role_code: string; permission_code: string; active: boolean };
type Snap = {
  permohonan: Permohonan[]; companies: Company[]; seats: Seat[];
  audit: AuditRow[]; totalProject: number; profileChanges: ProfileChange[];
};

const EMPTY: Snap = { permohonan: [], companies: [], seats: [], audit: [], totalProject: 0, profileChanges: [] };

// ─── Helpers ──────────────────────────────────────────────────────────────────
const tgl = (v: string) =>
  new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v));

const BADGE: Record<string, string> = {
  PENDING:        'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  ACCEPTED:       'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  APPROVED:       'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  REJECTED:       'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
  UNCLAIMED:      'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  CLAIMED:        'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  CLAIM_PENDING:  'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  ACTIVE:         'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
};
const LABEL: Record<string, string> = {
  PENDING: 'Menunggu', ACCEPTED: 'Diterima', APPROVED: 'Disetujui',
  REJECTED: 'Ditolak', UNCLAIMED: 'Belum diklaim', CLAIMED: 'Diklaim',
  CLAIM_PENDING: 'Menunggu klaim', ACTIVE: 'Aktif',
};
const Badge = ({ status }: { status: string }) => (
  <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${BADGE[status] ?? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>
    {LABEL[status] ?? status}
  </span>
);

// ─── Kartu Statistik ──────────────────────────────────────────────────────────
const KartuStat = ({ label, nilai, icon: Icon, warna }: { label: string; nilai: number; icon: any; warna: string }) => (
  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
    <div className="flex items-center justify-between">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${warna}`}>
        <Icon className="h-4 w-4" />
      </div>
    </div>
    <p className="mt-3 text-3xl font-bold text-slate-900 dark:text-white">{nilai}</p>
  </div>
);

// ─── Komponen Utama ───────────────────────────────────────────────────────────
export const PlatformConsole: React.FC = () => {
  const db = getSupabaseClient();

  // State utama
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [data, setData] = useState<Snap>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Role-Permission
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [perms, setPerms] = useState<PermRow[]>([]);
  const [mappings, setMappings] = useState<Mapping[]>([]);
  const [alasanMapping, setAlasanMapping] = useState('');

  // Filter & cari permohonan
  const [cari, setCari] = useState('');
  const [filter, setFilter] = useState('PENDING');

  // Review permohonan
  const [terpilih, setTerpilih] = useState<Permohonan | null>(null);
  const [alasanReview, setAlasanReview] = useState('');

  // Penerbitan RFIN-A
  const [konfirmasiRfin, setKonfirmasiRfin] = useState<{ companyId: string; email: string; nama: string } | null>(null);
  const [kodeTerbit, setKodeTerbit] = useState('');
  const [emailTerbit, setEmailTerbit] = useState('');
  const [namaTerbit, setNamaTerbit] = useState('');
  const [statusSalin, setStatusSalin] = useState('');

  // Review perubahan profil
  const [catatanProfil, setCatatanProfil] = useState('');

  // Navigasi tab
  const [tab, setTab] = useState<'permohonan' | 'tenant' | 'profil' | 'role' | 'audit'>('permohonan');

  // ─── Muat data ──────────────────────────────────────────────────────────────
  const muat = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const ctx = await resolveMyActiveContext();
      if (!ctx?.is_platform_super_admin) { setAuthorized(false); return; }
      setAuthorized(true);

      const [rPerm, rComp, rSeat, rAudit, rProj, rRole, rPermCat, rMap, rProfil] = await Promise.all([
        db.from('company_registration_requests')
          .select('id,legal_name,npwp_last4,super_admin_email,status,created_at,review_notes,notes')
          .order('created_at', { ascending: false }).limit(100),
        db.from('companies')
          .select('id,legal_name,status,created_at')
          .order('created_at', { ascending: false }).limit(100),
        db.from('company_admin_seats').select('company_id,recipient_email,seat_status').limit(100),
        db.from('audit_logs')
          .select('id,actor_id,action,entity_type,entity_id,details,created_at')
          .order('created_at', { ascending: false }).limit(10),
        db.from('projects').select('id', { count: 'exact', head: true }),
        db.from('role_catalog').select('role_code,display_name,description,sort_order')
          .eq('active', true).order('sort_order'),
        db.from('project_permission_catalog')
          .select('permission_code,display_name,module,action,requires_authority_check,description')
          .eq('active', true).order('module').order('permission_code'),
        db.from('role_permission_catalog')
          .select('role_code,permission_code,active').eq('active', true),
        db.from('company_profile_change_requests')
          .select('id,company_id,proposed_legal_name,change_npwp,proposed_npwp_last4,reason,status,created_at,review_notes')
          .order('created_at', { ascending: false }).limit(100),
      ]);

      for (const r of [rPerm, rComp, rSeat, rAudit, rProj, rRole, rPermCat, rMap, rProfil]) {
        if (r.error) throw r.error;
      }

      setData({
        permohonan: rPerm.data ?? [],
        companies: rComp.data ?? [],
        seats: rSeat.data ?? [],
        audit: rAudit.data ?? [],
        totalProject: rProj.count ?? 0,
        profileChanges: rProfil.data ?? [],
      });
      setRoles(rRole.data ?? []);
      setPerms(rPermCat.data ?? []);
      setMappings(rMap.data ?? []);
    } catch (e: any) {
      setError(e?.message ?? 'Gagal memuat data Platform Console.');
    } finally {
      setLoading(false);
    }
  }, [db]);

  useEffect(() => { void muat(); }, [muat]);

  // ─── Statistik ──────────────────────────────────────────────────────────────
  const jmlPending = data.permohonan.filter(x => x.status === 'PENDING').length;
  const jmlKlaimPending = data.seats.filter(x => x.seat_status === 'UNCLAIMED').length;

  // ─── Filter permohonan ──────────────────────────────────────────────────────
  const barisPermohonan = useMemo(() =>
    data.permohonan.filter(x =>
      (filter === 'ALL' || x.status === filter) &&
      (!cari || x.legal_name.toLowerCase().includes(cari.toLowerCase()) ||
        x.super_admin_email.toLowerCase().includes(cari.toLowerCase()) ||
        x.id.toLowerCase().includes(cari.toLowerCase()))
    ),
    [data.permohonan, filter, cari]
  );

  // ─── Aksi: Review permohonan ─────────────────────────────────────────────
  const putuskan = async (keputusan: 'ACCEPTED' | 'REJECTED') => {
    if (!terpilih || busy) return;
    if (alasanReview.trim().length < 10) { setError('Alasan keputusan wajib minimal 10 karakter.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: e } = await db.rpc('review_company_registration', {
        p_request_id: terpilih.id,
        p_decision: keputusan,
        p_review_notes: alasanReview.trim(),
      });
      if (e) throw e;
      setNotice(`Keputusan tersimpan — ${terpilih.legal_name} ${keputusan === 'ACCEPTED' ? 'diterima' : 'ditolak'}.`);
      setTerpilih(null); setAlasanReview('');
      await muat();
    } catch (e: any) {
      setError(e?.message ?? 'Keputusan gagal disimpan. Segarkan dan coba lagi.');
    } finally { setBusy(false); }
  };

  // ─── Aksi: Terbitkan RFIN-A ─────────────────────────────────────────────
  const terbitkanRfinA = async (companyId: string, email: string, nama: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice(''); setStatusSalin('');
    try {
      const { data: kode, error: e } = await db.rpc('issue_rfin_a', {
        p_company_id: companyId,
        p_recipient_email: email,
        p_expires_in: '7 days',
      });
      if (e) throw e;
      if (typeof kode !== 'string' || !kode.startsWith('RFA-'))
        throw new Error('Server tidak mengembalikan kode RFIN-A yang valid.');
      setKonfirmasiRfin(null);
      setKodeTerbit(kode);
      setEmailTerbit(email);
      setNamaTerbit(nama);
      setNotice('RFIN-A diterbitkan. Kode hanya tampil sekali — salin sekarang.');
      await muat();
    } catch (e: any) {
      setError(e?.message ?? 'Penerbitan RFIN-A gagal.');
    } finally { setBusy(false); }
  };

  const salinKode = async () => {
    try {
      await navigator.clipboard.writeText(kodeTerbit);
      setStatusSalin('Kode berhasil disalin. Kirim hanya kepada penerima melalui kanal aman.');
    } catch {
      setStatusSalin('Clipboard tidak tersedia — pilih dan salin kode secara manual.');
    }
  };

  // ─── Aksi: Review perubahan profil ─────────────────────────────────────
  const putuskanProfil = async (id: string, keputusan: 'APPROVE' | 'REJECT') => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data: hasil, error: e } = await db.rpc('review_company_profile_change', {
        p_request_id: id,
        p_decision: keputusan,
        p_review_notes: catatanProfil.trim() || null,
      });
      if (e) throw e;
      if (!hasil?.ok) throw new Error(hasil?.error ?? 'Keputusan gagal.');
      setCatatanProfil('');
      setNotice('Perubahan profil ' + (keputusan === 'APPROVE' ? 'disetujui.' : 'ditolak.'));
      await muat();
    } catch (e: any) {
      setError(e?.message ?? 'Keputusan perubahan profil gagal.');
    } finally { setBusy(false); }
  };

  // ─── Aksi: Mapping Role-Permission ─────────────────────────────────────
  const ubahMapping = async (roleCode: string, permCode: string, aktif: boolean) => {
    if (busy) return;
    if (alasanMapping.trim().length < 8) { setError('Alasan perubahan mapping wajib minimal 8 karakter.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: e } = await db.rpc('set_role_permission_mapping', {
        p_role_code: roleCode,
        p_permission_code: permCode,
        p_active: aktif,
        p_reason: alasanMapping.trim(),
      });
      if (e) throw e;
      setMappings(prev => aktif
        ? [...prev.filter(x => !(x.role_code === roleCode && x.permission_code === permCode)),
            { role_code: roleCode, permission_code: permCode, active: true }]
        : prev.filter(x => !(x.role_code === roleCode && x.permission_code === permCode))
      );
      setNotice(`Mapping ${roleCode} → ${permCode} ${aktif ? 'diaktifkan' : 'dinonaktifkan'}.`);
    } catch (e: any) {
      setError(e?.message ?? 'Mapping gagal disimpan.');
    } finally { setBusy(false); }
  };

  // ─── Render: Akses ditolak ──────────────────────────────────────────────
  if (authorized === false) return (
    <div className="flex min-h-96 items-center justify-center p-6">
      <div className="max-w-sm rounded-2xl border border-rose-200 bg-white p-8 text-center shadow-sm dark:border-rose-900 dark:bg-slate-900">
        <LockKeyhole className="mx-auto mb-4 h-10 w-10 text-rose-500" />
        <h2 className="text-lg font-bold text-slate-900 dark:text-white">Akses Ditolak</h2>
        <p className="mt-2 text-sm text-slate-500">
          Identitas ini bukan Platform Super Admin. Halaman ini tidak dapat dimuat.
        </p>
      </div>
    </div>
  );

  // ─── Tab nav ────────────────────────────────────────────────────────────────
  const tabs: { id: typeof tab; label: string; badge?: number }[] = [
    { id: 'permohonan', label: 'Permohonan RFIN-A', badge: jmlPending },
    { id: 'tenant',     label: 'Tenant & Kursi Admin' },
    { id: 'profil',     label: 'Perubahan Profil' },
    { id: 'role',       label: 'Role & Permission' },
    { id: 'audit',      label: 'Jejak Aktivitas' },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Platform Console</h1>
            <p className="text-xs text-slate-500">Control plane global · PSA only</p>
          </div>
        </div>
        <button
          disabled={loading}
          onClick={() => void muat()}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Segarkan
        </button>
      </div>

      {/* Pesan error/notice */}
      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3.5 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3.5 text-sm text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /><span>{notice}</span>
        </div>
      )}

      {/* Kartu statistik */}
      {!loading && authorized && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KartuStat label="Menunggu review" nilai={jmlPending} icon={Clock3}
            warna="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" />
          <KartuStat label="Tenant terdaftar" nilai={data.companies.length} icon={Building2}
            warna="bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300" />
          <KartuStat label="Kursi admin belum diklaim" nilai={jmlKlaimPending} icon={Users}
            warna="bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300" />
          <KartuStat label="Total proyek" nilai={data.totalProject} icon={LayoutDashboard}
            warna="bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" />
        </div>
      )}

      {/* Tab navigasi */}
      {!loading && authorized && (
        <>
          <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900">
            {tabs.map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                  tab === t.id
                    ? 'bg-white shadow-sm text-slate-900 dark:bg-slate-800 dark:text-white'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white leading-none">
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Tab: Permohonan RFIN-A ───────────────────────────────────── */}
          {tab === 'permohonan' && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <FileCheck2 className="h-4 w-4 text-blue-600" />
                  Daftar Permohonan Registrasi Perusahaan
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Penerimaan memulai provisioning Company + Workspace + Kursi CSA. Tolak untuk mencegah pembuatan tenant.
                </p>
              </div>

              {/* Filter & cari */}
              <div className="flex flex-col gap-2 border-b border-slate-100 p-4 sm:flex-row dark:border-slate-800">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  <input
                    value={cari} onChange={e => setCari(e.target.value)}
                    placeholder="Cari nama perusahaan, email, atau ID…"
                    className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </div>
                <select
                  value={filter} onChange={e => setFilter(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                >
                  <option value="PENDING">Menunggu review</option>
                  <option value="ACCEPTED">Diterima</option>
                  <option value="REJECTED">Ditolak</option>
                  <option value="ALL">Semua status</option>
                </select>
              </div>

              {/* Tabel permohonan */}
              {barisPermohonan.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {barisPermohonan.map(r => (
                    <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white">{r.legal_name}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          Ref {r.id.slice(0, 8).toUpperCase()} · NPWP ****{r.npwp_last4} · {tgl(r.created_at)}
                        </p>
                        <p className="text-xs text-slate-500">{r.super_admin_email}</p>
                        {r.review_notes && (
                          <p className="mt-1 text-xs italic text-slate-500">Catatan PSA: {r.review_notes}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge status={r.status} />
                        <button
                          onClick={() => { setTerpilih(r); setAlasanReview(r.review_notes ?? ''); setError(''); setNotice(''); }}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
                        >
                          Detail & review
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-slate-400">
                  Tidak ada permohonan pada filter ini.
                </p>
              )}
            </div>
          )}

          {/* ── Tab: Tenant & Kursi Admin ────────────────────────────────── */}
          {tab === 'tenant' && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Building2 className="h-4 w-4 text-blue-600" />
                  Tenant Terdaftar & Kursi Company Super Admin
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Terbitkan RFIN-A ke calon CSA yang belum klaim kursinya.
                </p>
              </div>
              {data.companies.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.companies.map(c => {
                    const kursi = data.seats.find(s => s.company_id === c.id);
                    return (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{c.legal_name}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {kursi ? kursi.recipient_email : 'Belum ada kursi admin'} · {tgl(c.created_at)}
                          </p>
                          <div className="mt-1 flex gap-2">
                            {(c.status || c.registration_status) && <Badge status={c.status || c.registration_status || ''} />}
                            {kursi && <Badge status={kursi.seat_status} />}
                          </div>
                        </div>
                        {kursi?.seat_status === 'UNCLAIMED' && (
                          <button
                            disabled={busy}
                            onClick={() => setKonfirmasiRfin({ companyId: c.id, email: kursi.recipient_email, nama: c.legal_name })}
                            className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                          >
                            Terbitkan RFIN-A
                          </button>
                        )}
                        {kursi?.seat_status === 'CLAIMED' && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400">✓ CSA sudah aktif</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-slate-400">
                  Belum ada tenant yang diprovisioning.
                </p>
              )}
            </div>
          )}

          {/* ── Tab: Perubahan Profil ─────────────────────────────────────── */}
          {tab === 'profil' && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <FileCheck2 className="h-4 w-4 text-blue-600" />
                  Review Permohonan Perubahan Profil Perusahaan
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Perubahan nama legal atau NPWP hanya berlaku setelah PSA menyetujuinya.
                </p>
              </div>
              <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Catatan review (opsional)
                  <textarea
                    value={catatanProfil}
                    onChange={e => setCatatanProfil(e.target.value)}
                    rows={2} maxLength={1000}
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>
              {data.profileChanges.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.profileChanges.map(item => {
                    const namaComp = data.companies.find(c => c.id === item.company_id)?.legal_name ?? item.company_id;
                    return (
                      <div key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                        <div>
                          <p className="font-semibold text-slate-900 dark:text-white">{namaComp}</p>
                          {item.proposed_legal_name && (
                            <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                              Nama baru: <b>{item.proposed_legal_name}</b>
                            </p>
                          )}
                          {item.change_npwp && (
                            <p className="text-sm text-slate-700 dark:text-slate-300">
                              NPWP baru berakhir <b>{item.proposed_npwp_last4}</b>
                            </p>
                          )}
                          <p className="mt-1 text-xs text-slate-500">Alasan: {item.reason}</p>
                          <p className="text-[11px] text-slate-400">
                            Ref {item.id.slice(0, 8).toUpperCase()} · {tgl(item.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge status={item.status} />
                          {item.status === 'PENDING' && (
                            <>
                              <button disabled={busy} onClick={() => void putuskanProfil(item.id, 'REJECT')}
                                className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-300 dark:hover:bg-rose-950/30">
                                Tolak
                              </button>
                              <button disabled={busy} onClick={() => void putuskanProfil(item.id, 'APPROVE')}
                                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
                                Setujui
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-slate-400">
                  Tidak ada permohonan perubahan profil.
                </p>
              )}
            </div>
          )}

          {/* ── Tab: Role & Permission ─────────────────────────────────────── */}
          {tab === 'role' && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <ShieldCheck className="h-4 w-4 text-blue-600" />
                  Katalog Role & Mapping Permission
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  PSA menetapkan bundle permission per role. Perubahan langsung memengaruhi effective access semua anggota dengan role tersebut.
                </p>
              </div>
              <div className="border-b border-slate-100 p-4 dark:border-slate-800">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Alasan perubahan mapping (wajib, minimal 8 karakter)
                  <input
                    value={alasanMapping}
                    onChange={e => setAlasanMapping(e.target.value)}
                    minLength={8} maxLength={500}
                    placeholder="Dasar kebijakan perubahan mapping role-permission…"
                    className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-sm dark:border-slate-700 dark:bg-slate-950"
                  />
                </label>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {roles.map(role => {
                  const jmlAktif = mappings.filter(m => m.role_code === role.role_code && m.active).length;
                  const permPerModul = perms.reduce<Record<string, PermRow[]>>((acc, p) => {
                    (acc[p.module] = acc[p.module] ?? []).push(p); return acc;
                  }, {});
                  return (
                    <details key={role.role_code} className="group p-4">
                      <summary className="flex cursor-pointer list-none items-center justify-between">
                        <div>
                          <span className="font-semibold text-slate-900 dark:text-white">{role.display_name}</span>
                          <span className="ml-2 text-xs text-slate-500">{role.role_code} · {jmlAktif} permission aktif</span>
                          <p className="mt-0.5 text-xs text-slate-400">{role.description}</p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-slate-400 transition-transform group-open:rotate-90" />
                      </summary>
                      <div className="mt-4 space-y-4">
                        {Object.entries(permPerModul).map(([modul, daftarPerm]) => (
                          <div key={modul}>
                            <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-slate-400">{modul}</p>
                            <div className="grid gap-2 sm:grid-cols-2">
                              {daftarPerm.map(p => {
                                const aktif = mappings.some(m => m.role_code === role.role_code && m.permission_code === p.permission_code && m.active);
                                return (
                                  <label key={p.permission_code} className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-xs cursor-pointer transition-colors ${
                                    aktif ? 'border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30' : 'border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950'
                                  }`}>
                                    <input
                                      type="checkbox"
                                      checked={aktif}
                                      disabled={busy || alasanMapping.trim().length < 8}
                                      onChange={e => void ubahMapping(role.role_code, p.permission_code, e.target.checked)}
                                      className="mt-0.5 rounded text-blue-600"
                                    />
                                    <span>
                                      <b className="text-slate-900 dark:text-white">{p.display_name}</b>
                                      <span className="mt-0.5 block text-slate-500">{p.description}</span>
                                      {p.requires_authority_check && (
                                        <span className="mt-1 block text-amber-600 dark:text-amber-400">⚠ Memerlukan Authority</span>
                                      )}
                                    </span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </details>
                  );
                })}
              </div>
              <p className="border-t border-slate-100 p-4 text-xs text-amber-600 dark:border-slate-800 dark:text-amber-400">
                ⚠ Tidak ada bundle default yang ditebak otomatis. Role hanya menghasilkan akses setelah mapping disahkan di sini.
                Permission berlabel "Memerlukan Authority" tetap memerlukan verifikasi konteks, project scope, dan state workflow.
              </p>
            </div>
          )}

          {/* ── Tab: Jejak Aktivitas ─────────────────────────────────────── */}
          {tab === 'audit' && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div className="border-b border-slate-100 p-5 dark:border-slate-800">
                <h2 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Activity className="h-4 w-4 text-blue-600" />
                  Jejak Aktivitas Administratif
                </h2>
                <p className="mt-1 text-xs text-slate-500">10 event terbaru dari audit_logs.</p>
              </div>
              {data.audit.length > 0 ? (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.audit.map(e => (
                    <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 p-4">
                      <div>
                        <p className="font-semibold text-sm text-slate-900 dark:text-white">{e.action}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {e.entity_type} · {e.entity_id?.slice(0, 8) ?? '—'} · aktor {e.actor_id?.slice(0, 8) ?? 'sistem'}
                        </p>
                        {e.details?.review_notes && (
                          <p className="mt-1 text-xs italic text-slate-400">"{e.details.review_notes}"</p>
                        )}
                      </div>
                      <time className="text-xs text-slate-400">{tgl(e.created_at)}</time>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-12 text-center text-sm text-slate-400">Belum ada event administratif tercatat.</p>
              )}
            </div>
          )}
        </>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex min-h-64 items-center justify-center">
          <div className="text-center text-sm text-slate-500">
            <RefreshCw className="mx-auto mb-2 h-6 w-6 animate-spin text-blue-500" />
            Memverifikasi otoritas dan memuat data…
          </div>
        </div>
      )}

      {/* ── Modal: Konfirmasi Terbitkan RFIN-A ──────────────────────────── */}
      {konfirmasiRfin && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl dark:border-amber-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Konfirmasi tindakan administratif</p>
            <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">Terbitkan RFIN-A?</h2>
            <div className="mt-3 space-y-1 text-sm text-slate-700 dark:text-slate-300">
              <p>Perusahaan: <b>{konfirmasiRfin.nama}</b></p>
              <p>Penerima: <b className="break-all">{konfirmasiRfin.email}</b></p>
            </div>
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Kode hanya tampil satu kali dan berlaku 7 hari. Penerbitan baru mencabut token lama yang belum digunakan.
              Salin kode dan kirim <b>hanya</b> kepada penerima melalui kanal aman.
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button disabled={busy} onClick={() => setKonfirmasiRfin(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
                Batal
              </button>
              <button disabled={busy}
                onClick={() => void terbitkanRfinA(konfirmasiRfin.companyId, konfirmasiRfin.email, konfirmasiRfin.nama)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Menerbitkan…' : 'Ya, terbitkan RFIN-A'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Tampilkan Kode RFIN-A ────────────────────────────────── */}
      {kodeTerbit && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="w-full max-w-lg rounded-2xl border border-amber-200 bg-white p-6 shadow-2xl dark:border-amber-800 dark:bg-slate-900">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400">Credential rahasia · tampil satu kali</p>
            <h2 className="mt-2 text-lg font-bold text-slate-900 dark:text-white">RFIN-A Diterbitkan</h2>
            <div className="mt-2 space-y-0.5 text-sm text-slate-700 dark:text-slate-300">
              <p>Perusahaan: <b>{namaTerbit}</b></p>
              <p>Penerima: <b className="break-all">{emailTerbit}</b></p>
              <p className="text-xs text-slate-400">Berlaku 7 hari sejak diterbitkan.</p>
            </div>
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-950">
              <label className="text-xs text-slate-500">Kode RFIN-A — jangan bagikan ke pihak lain</label>
              <input
                readOnly value={kodeTerbit}
                onFocus={e => e.currentTarget.select()}
                className="mt-2 w-full select-all rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm tracking-widest text-amber-700 dark:border-slate-700 dark:bg-slate-900 dark:text-amber-300"
              />
            </div>
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Kode <b>tidak</b> dikirim otomatis melalui email. Salin dan sampaikan hanya kepada penerima yang ditunjuk.
              Jangan masukkan ke tiket, chat grup, atau catatan audit. Setelah dialog ditutup, kode tidak dapat ditampilkan lagi.
            </div>
            {statusSalin && (
              <p className="mt-3 text-sm text-emerald-700 dark:text-emerald-400">{statusSalin}</p>
            )}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button onClick={() => { setKodeTerbit(''); setEmailTerbit(''); setNamaTerbit(''); setStatusSalin(''); }}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm dark:border-slate-700">
                Tutup & hapus dari layar
              </button>
              <button onClick={() => void salinKode()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">
                <Copy className="h-4 w-4" /> Salin kode
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Review Permohonan ─────────────────────────────────────── */}
      {terpilih && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-5">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl sm:p-7">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs uppercase tracking-widest text-blue-600 dark:text-blue-400">Review Permohonan</p>
                <h2 className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{terpilih.legal_name}</h2>
              </div>
              <button disabled={busy} onClick={() => setTerpilih(null)} aria-label="Tutup">
                <XCircle className="h-5 w-5 text-slate-400 hover:text-slate-600" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              {[
                ['Nama Legal', terpilih.legal_name],
                ['NPWP Masked', `•••• •••• •••• ${terpilih.npwp_last4}`],
                ['Calon CSA', terpilih.super_admin_email],
                ['Tanggal Ajukan', tgl(terpilih.created_at)],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                  <p className="text-[11px] text-slate-400">{k}</p>
                  <p className="mt-0.5 break-all text-sm font-semibold text-slate-900 dark:text-white">{v}</p>
                </div>
              ))}
            </div>

            {terpilih.notes && (
              <div className="mt-3 rounded-lg bg-slate-50 p-3 dark:bg-slate-950">
                <p className="text-[11px] text-slate-400">Catatan dari pemohon</p>
                <p className="mt-0.5 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">{terpilih.notes}</p>
              </div>
            )}

            <label className="mt-4 block text-sm font-semibold text-slate-700 dark:text-slate-300">
              Alasan keputusan <span className="text-rose-500">*</span> (minimal 10 karakter)
              <textarea
                value={alasanReview}
                onChange={e => setAlasanReview(e.target.value)}
                maxLength={2000} rows={3}
                placeholder="Catatan yang akan tersimpan di audit trail…"
                className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm dark:border-slate-700 dark:bg-slate-950"
              />
            </label>

            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Penerimaan secara otomatis membuat <b>Company</b>, <b>Company Workspace</b>, dan satu <b>Kursi CSA (UNCLAIMED)</b>.
              Tenant belum aktif operasional sebelum kursi diklaim melalui kode RFIN-A.
            </div>

            {terpilih.status === 'PENDING' && (
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button disabled={busy} onClick={() => void putuskan('REJECTED')}
                  className="rounded-lg border border-rose-300 px-4 py-2.5 text-sm text-rose-700 hover:bg-rose-50 disabled:opacity-40 dark:border-rose-800 dark:text-rose-300">
                  Tolak Permohonan
                </button>
                <button disabled={busy} onClick={() => void putuskan('ACCEPTED')}
                  className="rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {busy ? 'Menyimpan…' : 'Terima & Siapkan Klaim'}
                </button>
              </div>
            )}
            {terpilih.status !== 'PENDING' && (
              <p className="mt-4 text-center text-sm text-slate-400">
                Permohonan ini sudah diproses — <Badge status={terpilih.status} />
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
