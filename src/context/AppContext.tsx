import React, { createContext, useContext, useEffect, useState, useCallback, useMemo, startTransition } from 'react';
import {
  ItemBarang,
  MutasiBarang,
  MutasiKas,
  DokumenLaporan,
  UserProfile,
  SupabaseConfig,
  AvailabilityStatus,
  BoqSection,
  AppMode,
  ImpersonateRole,
  StatusDokumenWorkflow,
  PhysicalMaterialItem,
  PhysicalBudgetLine,
  BebanBiaya,
  TenantBranding
} from '../types';
import {
  getStoredConfig,
  getStoredUser,
  saveStoredUser,
  DEFAULT_USER,
  getSupabaseClient,
  signOutSupabase,
  resolveMyActiveContext,
  ActiveContext
} from '../lib/supabase';

export interface RolePermissions {
  canRead: boolean;
  canIssue: boolean;
  canInitiateBatalGanti: boolean;
  canInstructBatalGanti: boolean;
  canCheck: boolean;
  canApprove: boolean;
  canAcknowledge: boolean;
}

export function getRolePermissions(role: ImpersonateRole): RolePermissions {
  switch (role) {
    case 'Clerk':
      return { canRead: true, canIssue: true, canInitiateBatalGanti: true, canInstructBatalGanti: false, canCheck: false, canApprove: false, canAcknowledge: false };
    case 'Foreman':
      return { canRead: true, canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true, canCheck: true, canApprove: false, canAcknowledge: false };
    case 'Spv.':
      return { canRead: true, canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true, canCheck: true, canApprove: true, canAcknowledge: false };
    case 'Dept. Manager':
      return { canRead: true, canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true, canCheck: false, canApprove: true, canAcknowledge: true };
    case 'KTT/Proj. Manager':
      return { canRead: true, canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true, canCheck: false, canApprove: false, canAcknowledge: true };
    case 'CEO/Direktur':
      return { canRead: true, canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: true, canCheck: false, canApprove: false, canAcknowledge: true };
    case 'Viewer/Pengamat':
      return { canRead: true, canIssue: false, canInitiateBatalGanti: false, canInstructBatalGanti: false, canCheck: false, canApprove: false, canAcknowledge: false };
  }
}

interface AppContextType {
  activeContext: ActiveContext | null;
  activeWorkspaceId: string;
  activeProjectId: string;
  activeProject: ActiveContext['projects'][number] | null;
  hasActiveProjectScope: boolean;
  setActiveProjectId: (id: string) => void;
  refreshActiveContext: () => Promise<void>;
  refreshData: () => Promise<void>;
  setActiveWorkspaceId: (id: string) => void;
  items: ItemBarang[];
  physicalMaterials: PhysicalMaterialItem[];
  boqSections: BoqSection[];
  stockMutations: MutasiBarang[];
  cashMutations: MutasiKas[];
  documents: DokumenLaporan[];
  user: UserProfile;
  supabaseConfig: SupabaseConfig;
  currentView: string;
  setCurrentView: (view: string) => void;
  verifyingDocId: string | null;
  setVerifyingDocId: (id: string | null) => void;
  addStockMutation: (mutation: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>) => Promise<{ success: boolean; message: string }>;
  reverseStockMutation: (id: string, reason: string) => Promise<{ success: boolean; message: string }>;
  batalStockMutation: (id: string, reason: string) => Promise<{ success: boolean; message: string }>;
  gantiStockMutation: (id: string, newMutation: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>, reason: string) => Promise<{ success: boolean; message: string }>;
  advanceStockWorkflow: (id: string, nextStatus: StatusDokumenWorkflow) => Promise<{ success: boolean; message: string }>;
  addCashMutation: (cash: Omit<MutasiKas, 'id' | 'saldo_setelah'>) => Promise<{ success: boolean; message: string }>;
  reverseCashMutation: (id: string, reason: string) => Promise<{ success: boolean; message: string }>;
  batalCashMutation: (id: string, reason: string) => Promise<{ success: boolean; message: string }>;
  gantiCashMutation: (id: string, newMutation: Omit<MutasiKas, 'id' | 'saldo_setelah'>, reason: string) => Promise<{ success: boolean; message: string }>;
  advanceCashWorkflow: (id: string, nextStatus: StatusDokumenWorkflow) => Promise<{ success: boolean; message: string }>;
  issueOfficialDocument: (params: {
    jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'INVENTARIS_LENGKAP';
    judul: string;
    periode: string;
    ringkasan: string;
    total_nilai_atau_item: string;
  }) => Promise<{ success: boolean; message: string }>;
  advanceDocumentWorkflow: (dbId: string, nextStatus: StatusDokumenWorkflow) => Promise<{ success: boolean; message: string }>;
  batalOfficialDocument: (dbId: string, reason: string) => Promise<{ success: boolean; message: string }>;
  gantiOfficialDocument: (
    dbId: string,
    params: {
      jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'INVENTARIS_LENGKAP';
      judul: string;
      periode: string;
      ringkasan: string;
      total_nilai_atau_item: string;
    },
    reason: string
  ) => Promise<{ success: boolean; message: string }>;
  addDocument: (doc: DokumenLaporan) => Promise<void>;
  logout: () => Promise<void>;
  updateUserProfile: (updates: Partial<UserProfile>) => Promise<void>;
  totalStockAssetValue: number;
  currentCashBalance: number;
  outOfStockCount: number;
  lowStockCount: number;
  availableStockCount: number;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  dataReady: boolean;
  dataError: string | null;
  cashAccess: boolean;
  cashWriteAccess: boolean;
  cashHasEntries: boolean;
  recordedStockCount: number;
  unrecordedStockCount: number;
  stockWriteAccess: boolean;
  // Persona & Mode System (Sesuai Gambar 1 & Gambar 2)
  appMode: AppMode;
  setAppMode: (mode: AppMode) => void;
  activeRole: ImpersonateRole;
  setActiveRole: (role: ImpersonateRole) => void;
  activeCompany: { id: string; name: string; npwp: string; logoUrl?: string };
  setActiveCompany: React.Dispatch<React.SetStateAction<{ id: string; name: string; npwp: string; logoUrl?: string }>>;
  updateCompanyLogo: (logoUrl: string) => Promise<void>;
  tenantBranding: TenantBranding;
  rolePermissions: RolePermissions;
  canViewFinancials: boolean;
}

const AppContext = createContext<AppContextType | undefined>(undefined);
const THEME_KEY = 'proyek_cair_theme';
const APP_MODE_KEY = 'proyek_cair_app_mode';
const ACTIVE_ROLE_KEY = 'proyek_cair_active_role';

export function computeItemStatus(stok: number, minStok: number, hasHistory = true): AvailabilityStatus {
  if (!hasHistory) return 'Belum Dicatat';
  if (stok <= 0) return 'Tidak Tersedia';
  if (stok <= minStok) return 'Stok Menipis';
  return 'Tersedia';
}

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [activeContext, setActiveContext] = useState<ActiveContext | null>(null);
  const [activeWorkspaceId, setActiveWorkspaceIdState] = useState(() => localStorage.getItem('udu_active_workspace') || '');
  const [activeProjectId, setActiveProjectIdState] = useState(() => localStorage.getItem('udu_active_project') || '');
  const [user, setUser] = useState<UserProfile>(() => getStoredUser());
  const [supabaseConfig] = useState<SupabaseConfig>(() => getStoredConfig());
  const [currentView, setCurrentViewRaw] = useState('dashboard');
  const setCurrentView = useCallback((view: string) => {
    startTransition(() => {
      setCurrentViewRaw(view);
    });
  }, []);
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [cashAccess, setCashAccess] = useState(false);

  // App Mode & Impersonate State (Default aman selalu PERSONAL)
  const [appMode, setAppModeState] = useState<AppMode>(() => {
    try {
      const saved = localStorage.getItem(APP_MODE_KEY);
      if (saved === 'PERSONAL' || saved === 'IMPERSONATE' || saved === 'CSA' || saved === 'PSA') return saved;
    } catch {}
    return 'PERSONAL';
  });

  const [activeRole, setActiveRoleState] = useState<ImpersonateRole>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_ROLE_KEY) as ImpersonateRole;
      if (['Clerk', 'Foreman', 'Spv.', 'Dept. Manager', 'KTT/Proj. Manager', 'CEO/Direktur', 'Viewer/Pengamat'].includes(saved)) {
        return saved;
      }
    } catch {}
    return 'Clerk';
  });

  const [activeCompany, setActiveCompany] = useState<{ id: string; name: string; npwp: string; logoUrl?: string }>({
    id: '',
    name: 'Akun Pribadi',
    npwp: '',
    logoUrl: ''
  });
  const [activeClientName, setActiveClientName] = useState<string>('');

  const setAppMode = (mode: AppMode) => {
    setAppModeState(mode);
    localStorage.setItem(APP_MODE_KEY, mode);
    // Set default view on mode switch
    setCurrentView('dashboard');
  };

  const setActiveRole = (role: ImpersonateRole) => {
    setActiveRoleState(role);
    localStorage.setItem(ACTIVE_ROLE_KEY, role);
  };

  const rolePermissions = getRolePermissions(activeRole);

  const activeProject = activeContext?.projects.find(p => p.id === activeProjectId && p.workspace_id === activeWorkspaceId) || null;
  const hasActiveProjectScope = Boolean(activeContext && activeProject && activeContext.projects.some(p => p.id === activeProject.id && p.workspace_id === activeWorkspaceId));

  const setActiveWorkspaceId = (id: string) => {
    setActiveWorkspaceIdState(prev => {
      if (prev !== id) {
        setActiveProjectIdState('');
        localStorage.removeItem('udu_active_project');
      }
      return id;
    });
    localStorage.setItem('udu_active_workspace', id);
  };

  const setActiveProjectId = (id: string) => {
    setActiveProjectIdState(id);
    localStorage.setItem('udu_active_project', id);
  };

  const refreshActiveContext = async () => {
    try {
      const next = await resolveMyActiveContext();
      setActiveContext(next);

      const latestStored = getStoredUser();
      if (latestStored?.id) {
        setUser(latestStored);
      }

      const isPlatformAdmin = Boolean(next.is_platform_super_admin);
      const isCompanyAdmin = (next.workspaces || []).some(w => w.type === 'COMPANY' && (w as any).is_company_super_admin);
      const hasProjects = (next.projects || []).length > 0;

      // Pengamanan E2E: Cegah akun tanpa wewenang proyek masuk ke mode IMPERSONATE
      if (appMode === 'IMPERSONATE' && !hasProjects) {
        if (isCompanyAdmin) {
          setAppModeState('CSA');
        } else if (isPlatformAdmin) {
          setAppModeState('PSA');
        } else {
          setAppModeState('PERSONAL');
        }
      }

      if (next.workspaces.length > 0) {
        const companyWs = next.workspaces.find(w => w.type === 'COMPANY');
        if (companyWs) {
          setActiveCompany({
            id: companyWs.company_id || companyWs.id,
            name: companyWs.name || 'Perusahaan',
            npwp: (companyWs as any).company_npwp || (companyWs as any).npwp || '',
            logoUrl: (companyWs as any).company_logo_url || ''
          });
        } else {
          setActiveCompany({
            id: '',
            name: 'Akun Pribadi',
            npwp: '',
            logoUrl: ''
          });
        }
      } else {
        setActiveCompany({
          id: '',
          name: 'Akun Pribadi',
          npwp: ''
        });
      }
    } catch {
      // Ignored
    }
  };

  const [items, setItems] = useState<ItemBarang[]>([]);
  const [physicalMaterials, setPhysicalMaterials] = useState<PhysicalMaterialItem[]>([]);
  const [boqSections, setBoqSections] = useState<BoqSection[]>([]);
  const [stockMutations, setStockMutations] = useState<MutasiBarang[]>([]);
  const [cashMutations, setCashMutations] = useState<MutasiKas[]>([]);
  const [documents, setDocuments] = useState<DokumenLaporan[]>([]);

  const cashWriteAccess = appMode === 'IMPERSONATE'
    ? rolePermissions.canIssue
    : (Boolean(activeProject?.permissions.includes('cash.transaction.create')) || rolePermissions.canIssue);
  const stockWriteAccess = appMode === 'IMPERSONATE'
    ? rolePermissions.canIssue
    : (Boolean(activeProject?.permissions.includes('inventory.movement.create')) || rolePermissions.canIssue);

  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const v = localStorage.getItem(THEME_KEY);
      if (v === 'dark' || v === 'light') return v;
    } catch {}
    return 'dark';
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme(v => (v === 'light' ? 'dark' : 'light'));

  const refreshData = async () => {
    const next = await resolveMyActiveContext();
    setActiveContext(next);

    const isPlatformAdmin = Boolean(next.is_platform_super_admin);
    const isCompanyAdmin = (next.workspaces || []).some(w => w.type === 'COMPANY' && (w as any).is_company_super_admin);
    const hasProjects = (next.projects || []).length > 0;

    let effectiveMode = appMode;
    const savedMode = localStorage.getItem(APP_MODE_KEY);
    if (!savedMode) {
      if (isPlatformAdmin) {
        effectiveMode = 'PSA';
        setAppModeState('PSA');
      } else if (isCompanyAdmin) {
        effectiveMode = 'CSA';
        setAppModeState('CSA');
      } else if (hasProjects) {
        effectiveMode = 'IMPERSONATE';
        setAppModeState('IMPERSONATE');
      }
    } else if (effectiveMode === 'IMPERSONATE' && !hasProjects) {
      effectiveMode = isCompanyAdmin ? 'CSA' : isPlatformAdmin ? 'PSA' : 'PERSONAL';
      setAppModeState(effectiveMode);
    }

    const companyWs = next.workspaces.find(w => w.type === 'COMPANY');
    if (companyWs) {
      setActiveCompany({
        id: companyWs.company_id || companyWs.id,
        name: companyWs.name || 'Perusahaan',
        npwp: (companyWs as any).company_npwp || (companyWs as any).npwp || '',
        logoUrl: (companyWs as any).company_logo_url || ''
      });
    }

    // Ambil workspace aktif atau fallback ke company workspace pertama
    let targetWorkspaceId = activeWorkspaceId;
    if ((!targetWorkspaceId || (effectiveMode !== 'PERSONAL' && !next.workspaces.some(w => w.id === targetWorkspaceId && w.type === 'COMPANY'))) && next.workspaces.length > 0) {
      const comp = companyWs || next.workspaces[0];
      targetWorkspaceId = comp.id;
      setActiveWorkspaceIdState(targetWorkspaceId);
      localStorage.setItem('udu_active_workspace', targetWorkspaceId);
    }

    let selectedProject = next.projects.find(p => p.id === activeProjectId && p.workspace_id === targetWorkspaceId);
    if (!selectedProject && next.projects.length > 0) {
      selectedProject = next.projects.find(p => p.workspace_id === targetWorkspaceId) || next.projects[0];
      if (selectedProject) {
        setActiveProjectIdState(selectedProject.id);
        localStorage.setItem('udu_active_project', selectedProject.id);
        if (selectedProject.workspace_id && selectedProject.workspace_id !== targetWorkspaceId) {
          targetWorkspaceId = selectedProject.workspace_id;
          setActiveWorkspaceIdState(targetWorkspaceId);
          localStorage.setItem('udu_active_workspace', targetWorkspaceId);
        }
      }
    }

    // Isolasi E2E: Jika Akun Personal, PSA, atau tidak memiliki penugasan proyek yang sah,
    // data rahasia operasional tenant (BOQ, mutasi kas, stok) TIDAK dimuat.
    if (effectiveMode === 'PERSONAL' || effectiveMode === 'PSA' || next.projects.length === 0 || !selectedProject) {
      setItems([]);
      setPhysicalMaterials([]);
      setBoqSections([]);
      setStockMutations([]);
      setCashMutations([]);
      setDocuments([]);
      setDataReady(true);
      setDataError(null);
      return;
    }

    const client = getSupabaseClient();
    const [boqRes, sectionsRes, stockRes, cashRes, docsRes, reversalsRes, clientRelRes] = await Promise.all([
      client.from('boq_items').select('*').eq('project_id', selectedProject.id).eq('is_active', true).order('source_row'),
      client.from('boq_sections').select('*').eq('project_id', selectedProject.id).eq('is_active', true).order('sort_order'),
      client.from('inventory_transactions').select('*').eq('project_id', selectedProject.id).order('occurred_at', { ascending: true }).order('created_at', { ascending: true }),
      client.from('cash_transactions').select('*').eq('project_id', selectedProject.id).order('occurred_at', { ascending: true }).order('created_at', { ascending: true }),
      client.from('documents').select('*').eq('project_id', selectedProject.id).in('document_type', ['MUTASI_KAS', 'MUTASI_STOK']).order('created_at', { ascending: false }),
      client.from('inventory_transaction_reversals').select('original_transaction_id'),
      client.from('project_client_relationships').select('client_name, relationship_type').eq('project_id', selectedProject.id).order('created_at', { ascending: true })
    ]);

    const mainClientRow =
      (clientRelRes.data || []).find((r: any) => r.relationship_type === 'MAIN_CLIENT') ||
      (clientRelRes.data || [])[0];
    setActiveClientName(mainClientRow?.client_name || '');

    const reversedIds = new Set((reversalsRes.data || []).map((r: any) => r.original_transaction_id));

    // 1. Indeks Material Fisik dari data mentah boq_items (Prinsip: Satukan Masuk, Bedakan Keluar)
    const rawBoq = boqRes.data || [];
    const itemToKey = new Map<string, string>();
    const itemById = new Map<string, any>();
    const totalBoqByKey = new Map<string, number>();
    const posCountByKey = new Map<string, number>();
    rawBoq.forEach((b: any) => {
      itemById.set(b.id, b);
      const key = `${(b.description || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${(b.uom || '').trim().toLowerCase()}`;
      itemToKey.set(b.id, key);
      totalBoqByKey.set(key, (totalBoqByKey.get(key) || 0) + (Number(b.quantity) || 0));
      posCountByKey.set(key, (posCountByKey.get(key) || 0) + 1);
    });

    // 2. Lacak Saldo Fisik Gudang Bersama (Satukan Masuk) & Serapan per Pos BOQ (Bedakan Keluar)
    const physicalBalance = new Map<string, number>();
    const physicalReceived = new Map<string, number>();
    const physicalConsumed = new Map<string, number>();
    const boqItemConsumed = new Map<string, number>();
    const stockHistory = new Set<string>();
    // Finansial Belanja Riil & Weighted Average per Jenis Material
    const physicalFinancialTotal = new Map<string, number>();
    const physicalFinancialQty = new Map<string, number>();
    const physicalLastPrice = new Map<string, { price: number; date: string }>();
    const physicalPendingInvoiceCount = new Map<string, number>();

    const stockRows: MutasiBarang[] = (stockRes.data || []).map((t: any) => {
      const targetItem = itemById.get(t.item_id);
      const key = targetItem
        ? itemToKey.get(t.item_id)!
        : `${(t.nama_barang || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${(t.uom || '').trim().toLowerCase()}`;
      
      const beforePhysical = physicalBalance.get(key) || 0;
      const incoming = ['MASUK', 'PENYESUAIAN_MASUK'].includes(t.transaction_type);
      const isVoid = Boolean(
        t.is_batal ||
        t.is_ganti ||
        t.status_dokumen === 'BATAL' ||
        t.status_dokumen === 'DIGANTI' ||
        reversedIds.has(t.id)
      );
      const qtyNum = Number(t.quantity) || 0;
      const delta = isVoid ? 0 : incoming ? qtyNum : -qtyNum;
      const afterPhysical = beforePhysical + delta;

      if (!isVoid) {
        physicalBalance.set(key, afterPhysical);
        if (incoming) {
          physicalReceived.set(key, (physicalReceived.get(key) || 0) + qtyNum);

          const unitPrice = t.harga_satuan_beli != null ? Number(t.harga_satuan_beli) : null;
          if (unitPrice != null && unitPrice > 0) {
            const lineTotal = unitPrice * qtyNum;
            physicalFinancialTotal.set(key, (physicalFinancialTotal.get(key) || 0) + lineTotal);
            physicalFinancialQty.set(key, (physicalFinancialQty.get(key) || 0) + qtyNum);
            physicalLastPrice.set(key, { price: unitPrice, date: t.occurred_at || t.created_at });
          } else if (t.status_harga === 'NOTA_MENYUSUL' || t.status_harga === 'BELUM_DIKETAHUI') {
            physicalPendingInvoiceCount.set(key, (physicalPendingInvoiceCount.get(key) || 0) + 1);
          }
        } else {
          physicalConsumed.set(key, (physicalConsumed.get(key) || 0) + qtyNum);
          boqItemConsumed.set(t.item_id, (boqItemConsumed.get(t.item_id) || 0) + qtyNum);
        }
        if (t.item_id) stockHistory.add(t.item_id);
      }

      return {
        id: t.id,
        barang_id: t.item_id || '',
        nama_barang: t.nama_barang || targetItem?.description || 'Material',
        jenis: incoming ? 'MASUK' : 'KELUAR',
        jumlah: Number(t.quantity),
        satuan: t.uom || targetItem?.uom || 'Unit',
        tujuan_keperluan: t.purpose || t.location || t.notes || '-',
        pic_penerima_penyerah: t.counterparty || '-',
        nomor_surat_jalan: t.reference_no || undefined,
        tanggal: t.occurred_at || t.created_at,
        stok_sebelum: beforePhysical,
        stok_sesudah: afterPhysical,
        catatan: t.notes || undefined,
        source_name: t.source_name || undefined,
        destination_name: t.destination_name || undefined,
        recipient_name: t.recipient_name || undefined,
        owner_type: t.owner_type || 'KONTRAKTOR',
        purpose: t.purpose || undefined,
        beban_biaya: (t.beban_biaya as BebanBiaya) || 'KONTRAKTOR',
        is_custom_item: Boolean(t.is_custom_item),
        created_by_name: t.created_by_name || t.created_by || 'Clerk',
        status_dokumen: (t.status_dokumen as StatusDokumenWorkflow) || (isVoid ? 'BATAL' : 'DITERBITKAN'),
        diperiksa_oleh: t.diperiksa_oleh || undefined,
        disetujui_oleh: t.disetujui_oleh || undefined,
        mengetahui_oleh: t.mengetahui_oleh || undefined,
        tte_qr_code: t.tte_qr_code || undefined,
        is_batal: Boolean(t.is_batal || isVoid),
        is_ganti: Boolean(t.is_ganti),
        referensi_ganti_id: t.referensi_ganti_id || undefined,
        alasan_batal_ganti: t.alasan_batal_ganti || undefined,
        harga_satuan_beli: t.harga_satuan_beli != null ? Number(t.harga_satuan_beli) : undefined,
        status_harga: t.status_harga || undefined,
        nama_item_aktual: t.nama_item_aktual || undefined
      };
    });

    // 3. Petakan Item BOQ Terperinci (Satukan Masuk di Level Gudang, Bedakan Keluar per Pos Pekerjaan)
    const mappedItems: ItemBarang[] = rawBoq.map((b: any) => {
      const baseTarget = Number(b.quantity) || 0;
      const key = itemToKey.get(b.id)!;
      const totalBoqGabungan = totalBoqByKey.get(key) || baseTarget;
      const jumlahPosGabungan = posCountByKey.get(key) || 1;
      const physicalStock = Math.max(0, physicalBalance.get(key) || 0);
      const masukGudang = physicalReceived.get(key) || 0;
      const terpakaiDiPosIni = boqItemConsumed.get(b.id) || 0;
      const sisaTargetPos = Math.max(baseTarget - terpakaiDiPosIni, 0);
      const sisaBelumTibaGudang = Math.max(totalBoqGabungan - masukGudang, 0);
      const progress = baseTarget > 0 ? Math.min((terpakaiDiPosIni / baseTarget) * 100, 100) : 0;
      const EPS = 0.0001;
      const statusPemenuhan: ItemBarang['status_pemenuhan'] =
        terpakaiDiPosIni > baseTarget + EPS && baseTarget > 0
          ? 'Melebihi BOQ'
          : terpakaiDiPosIni + EPS >= baseTarget && baseTarget > 0
          ? 'Terpenuhi'
          : terpakaiDiPosIni > 0
          ? 'Dalam pemenuhan'
          : 'Belum dipenuhi';

      return {
        id: b.id,
        parent_section_id: b.parent_section_id || null,
        source_excel_row: b.source_excel_row ?? null,
        source_qty: b.quantity == null ? null : Number(b.quantity),
        source_uom: b.uom ?? null,
        kode_boq: b.boq_code,
        source_sheet: b.source_sheet,
        source_row: b.source_row,
        nama_barang: b.description,
        kategori: b.category || 'Tanpa kategori',
        qty_boq: baseTarget,
        qty_tambahan_disetujui: 0,
        target_kebutuhan_total: baseTarget,
        is_stock_item: Boolean(b.is_stock_item),
        has_stock_history: stockHistory.has(b.id) || masukGudang > 0 || terpakaiDiPosIni > 0,
        qty_masuk_total: masukGudang,
        qty_keluar_total: terpakaiDiPosIni,
        qty_pemenuhan_sisa: sisaTargetPos,
        total_boq_material_gabungan: totalBoqGabungan,
        jumlah_pos_material_gabungan: jumlahPosGabungan,
        sisa_belum_tiba_gudang: sisaBelumTibaGudang,
        progress_pemenuhan: progress,
        status_pemenuhan: statusPemenuhan,
        satuan: b.uom || 'Unit',
        harga_satuan: Number(b.unit_rate || 0),
        stok_saat_ini: physicalStock,
        stok_minimum: 0,
        status: computeItemStatus(physicalStock, 0, stockHistory.has(b.id) || masukGudang > 0 || terpakaiDiPosIni > 0),
        keterangan: b.remarks || ''
      };
    });

    // 4. Kelompokkan Material Fisik Terpadu (Pemasukan Disatukan, Pengeluaran Dirincikan)
    const physicalGroupMap = new Map<string, {
      id: string;
      nama_barang: string;
      satuan: string;
      is_stock_item: boolean;
      total_qty_boq: number;
      budget_lines: PhysicalBudgetLine[];
    }>();

    mappedItems.forEach(item => {
      const key = itemToKey.get(item.id)!;
      if (!physicalGroupMap.has(key)) {
        physicalGroupMap.set(key, {
          id: item.id,
          nama_barang: item.nama_barang,
          satuan: item.satuan,
          is_stock_item: item.is_stock_item,
          total_qty_boq: 0,
          budget_lines: []
        });
      }
      const g = physicalGroupMap.get(key)!;
      g.total_qty_boq += item.qty_boq;
      if (item.is_stock_item) g.is_stock_item = true;
      g.budget_lines.push({
        id: item.id,
        kode_boq: item.kode_boq,
        kategori: item.kategori,
        qty_boq: item.qty_boq,
        qty_keluar_total: item.qty_keluar_total,
        sisa_anggaran: item.qty_pemenuhan_sisa,
        keterangan: item.keterangan
      });
    });

    const calculatedPhysicalMaterials: PhysicalMaterialItem[] = Array.from(physicalGroupMap.entries()).map(([key, g]) => {
      const totalBelanja = physicalFinancialTotal.get(key) || 0;
      const totalQtyFin = physicalFinancialQty.get(key) || 0;
      const avgPrice = totalQtyFin > 0 ? Math.round(totalBelanja / totalQtyFin) : undefined;
      const lastPriceInfo = physicalLastPrice.get(key);

      return {
        id: g.id,
        nama_barang: g.nama_barang,
        satuan: g.satuan,
        stok_fisik: physicalBalance.get(key) || 0,
        total_qty_boq: g.total_qty_boq,
        total_qty_masuk: physicalReceived.get(key) || 0,
        total_qty_keluar: physicalConsumed.get(key) || 0,
        is_stock_item: g.is_stock_item,
        budget_lines: g.budget_lines,
        total_nilai_belanja_riil: totalBelanja,
        harga_beli_rata_rata: avgPrice,
        harga_beli_terakhir: lastPriceInfo?.price,
        tanggal_beli_terakhir: lastPriceInfo?.date,
        count_nota_menyusul: physicalPendingInvoiceCount.get(key) || 0
      };
    });

    setPhysicalMaterials(calculatedPhysicalMaterials);

    const nameById = new Map(mappedItems.map(x => [x.id, x.nama_barang]));
    stockRows.forEach(x => {
      x.nama_barang = nameById.get(x.barang_id) || x.nama_barang || 'Item BOQ';
    });

    let cashBalance = 0;
    const cashRows: MutasiKas[] = (cashRes.data || []).map((t: any) => {
      const incoming = t.transaction_type === 'MASUK';
      const isVoid = Boolean(
        t.is_batal ||
        t.is_ganti ||
        t.status_dokumen === 'BATAL' ||
        t.status_dokumen === 'DIGANTI'
      );
      const delta = isVoid ? 0 : incoming ? Number(t.amount) : -Number(t.amount);
      cashBalance += delta;
      return {
        id: t.id,
        jenis: t.transaction_type,
        jumlah_rp: Number(t.amount),
        untuk_apa: t.description,
        kategori_keperluan: (t.category || 'Lainnya') as MutasiKas['kategori_keperluan'],
        pic: t.pic || '-',
        nomor_kuitansi: t.reference_no || undefined,
        tanggal: t.occurred_at || t.created_at,
        saldo_setelah: cashBalance,
        catatan: t.notes || undefined,
        status_dokumen: (t.status_dokumen as StatusDokumenWorkflow) || (isVoid ? 'BATAL' : 'DITERBITKAN'),
        diperiksa_oleh: t.diperiksa_oleh || undefined,
        disetujui_oleh: t.disetujui_oleh || undefined,
        mengetahui_oleh: t.mengetahui_oleh || undefined,
        tte_qr_code: t.tte_qr_code || undefined,
        is_batal: isVoid,
        is_ganti: Boolean(t.is_ganti),
        referensi_ganti_id: t.referensi_ganti_id || undefined,
        alasan_batal_ganti: t.alasan_batal_ganti || undefined,
        harga_satuan_beli: t.harga_satuan_beli != null ? Number(t.harga_satuan_beli) : undefined,
        status_harga: t.status_harga || undefined,
        nama_item_aktual: t.nama_item_aktual || undefined
      };
    });

    const sectionRows: BoqSection[] = (sectionsRes.data || []).map((s: any) => ({
      id: s.id,
      source_sheet: s.source_sheet,
      source_row: s.source_row,
      node_code: s.node_code,
      description: s.description,
      level: s.level,
      parent_id: s.parent_id,
      sort_order: s.sort_order,
      source_color: s.source_color,
      source_qty: s.source_qty,
      source_uom: s.source_uom,
      source_total_price: s.source_total_price,
      calculated_total_price: Number(s.source_total_price || 0),
      quantities_by_uom: {},
      item_count: 0,
      source_total_variance: 0
    }));

    const docRows: DokumenLaporan[] = (docsRes.data || []).map((d: any) => ({
      id: d.document_no || d.id,
      db_id: d.id,
      judul: d.title || 'Dokumen Berita Acara',
      jenis: (d.document_type || 'MUTASI_STOK') as DokumenLaporan['jenis'],
      status: d.status || 'ISSUED',
      periode_awal: d.period_start || d.created_at,
      periode_akhir: d.period_end || d.created_at,
      dibuat_pada: d.created_at,
      penandatangan_nama: d.signer_name || 'Clerk',
      penandatangan_jabatan: d.signer_role || 'Clerk',
      penandatangan_email: d.signer_email || '',
      hash_keamanan: d.content_sha256 || '',
      total_transaksi: Number(d.total_transactions || 0),
      ringkasan_nilai_rp: Number(d.amount_summary || 0),
      qr_payload: d.qr_payload || '',
      verification_token: d.verification_token || undefined,
      document_no: d.document_no,
      title: d.title,
      document_type: d.document_type,
      created_at: d.created_at,
      issued_at: d.issued_at,
      content_sha256: d.content_sha256,
      signer_name: d.signer_name,
      signer_role: d.signer_role,
      workspace_id: d.workspace_id,
      project_id: d.project_id,
      status_dokumen: (d.status_dokumen as StatusDokumenWorkflow) || (d.is_batal ? 'BATAL' : d.is_ganti ? 'DIGANTI' : 'DITERBITKAN'),
      diperiksa_oleh: d.diperiksa_oleh || undefined,
      disetujui_oleh: d.disetujui_oleh || undefined,
      mengetahui_oleh: d.mengetahui_oleh || undefined,
      tte_qr_code: d.tte_qr_code || undefined,
      is_batal: Boolean(d.is_batal),
      is_ganti: Boolean(d.is_ganti),
      referensi_ganti_id: d.referensi_ganti_id || undefined,
      alasan_batal_ganti: d.alasan_batal_ganti || undefined
    }));

    setItems(mappedItems);
    setBoqSections(sectionRows);
    setStockMutations(stockRows.reverse());
    setCashMutations(cashRows.reverse());
    setCashAccess(true);
    setDocuments(docRows);
    setDataError(null);
    setDataReady(true);
  };

  useEffect(() => {
    if (!user.id) return;
    let live = true;
    setDataReady(false);
    refreshData().catch((e: any) => {
      if (live) {
        setDataError(e.message || 'Gagal memuat data operasional dari Supabase.');
        setDataReady(true);
      }
    });
    return () => {
      live = false;
    };
  }, [user.id, activeProjectId, activeWorkspaceId, appMode]);

  // Transaksi Baru Mutasi Barang (Diterbitkan oleh Clerk)
  const addStockMutation = async (data: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>) => {
    try {
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const { error } = await client.from('inventory_transactions').insert({
        idempotency_key: crypto.randomUUID(),
        workspace_id: wsId,
        project_id: prId,
        item_id: data.barang_id || null,
        nama_barang: data.nama_barang,
        transaction_type: data.jenis,
        quantity: data.jumlah,
        uom: data.satuan,
        occurred_at: data.tanggal,
        reference_no: data.nomor_surat_jalan || null,
        counterparty: data.pic_penerima_penyerah,
        notes: data.catatan || null,
        purpose: data.purpose || data.tujuan_keperluan,
        beban_biaya: data.beban_biaya || 'KONTRAKTOR',
        is_custom_item: Boolean(data.is_custom_item),
        destination_name: data.destination_name || null,
        source_name: data.source_name || null,
        recipient_name: data.recipient_name || data.pic_penerima_penyerah,
        owner_type: data.owner_type || 'KONTRAKTOR',
        status_dokumen: 'DITERBITKAN',
        created_by_name: `${user.name} (${activeRole})`,
        harga_satuan_beli: data.harga_satuan_beli != null ? data.harga_satuan_beli : null,
        status_harga: data.status_harga || null,
        nama_item_aktual: data.nama_item_aktual || null
      });

      if (error) throw error;
      await refreshData();
      return { success: true, message: 'Catatan mutasi barang berhasil disimpan.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Penerbitan mutasi inventaris gagal.' };
    }
  };

  // Batalkan Mutasi Barang (Nominal dinolkan / tidak dihitung di stok, data tetap ada)
  const batalStockMutation = async (id: string, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan pembatalan minimal 5 karakter.');
      const client = getSupabaseClient();
      const { error } = await client.from('inventory_transactions').update({
        is_batal: true,
        status_dokumen: 'BATAL',
        alasan_batal_ganti: `Dibatalkan oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (error) throw error;
      await refreshData();
      return { success: true, message: 'Transaksi mutasi berhasil dibatalkan. Riwayat tetap tercatat dan stok disesuaikan secara otomatis.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Pembatalan transaksi gagal.' };
    }
  };

  // Ganti Mutasi Barang (Tautkan ke baris revisi baru, data lama dinolkan)
  const gantiStockMutation = async (id: string, newMutation: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan penggantian minimal 5 karakter.');
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      // 1. Masukkan mutasi baru
      const { data: newRow, error: insertErr } = await client.from('inventory_transactions').insert({
        idempotency_key: crypto.randomUUID(),
        workspace_id: wsId,
        project_id: prId,
        item_id: newMutation.barang_id || null,
        nama_barang: newMutation.nama_barang,
        transaction_type: newMutation.jenis,
        quantity: newMutation.jumlah,
        uom: newMutation.satuan,
        occurred_at: newMutation.tanggal,
        reference_no: newMutation.nomor_surat_jalan || null,
        counterparty: newMutation.pic_penerima_penyerah,
        notes: newMutation.catatan || null,
        purpose: newMutation.purpose || newMutation.tujuan_keperluan,
        beban_biaya: newMutation.beban_biaya || 'KONTRAKTOR',
        is_custom_item: Boolean(newMutation.is_custom_item),
        destination_name: newMutation.destination_name || null,
        source_name: newMutation.source_name || null,
        recipient_name: newMutation.recipient_name || newMutation.pic_penerima_penyerah,
        owner_type: newMutation.owner_type || 'KONTRAKTOR',
        status_dokumen: 'DITERBITKAN',
        referensi_ganti_id: id,
        harga_satuan_beli: newMutation.harga_satuan_beli != null ? newMutation.harga_satuan_beli : null,
        status_harga: newMutation.status_harga || null,
        nama_item_aktual: newMutation.nama_item_aktual || null,
        created_by_name: `${user.name} (${activeRole})`
      }).select().single();

      if (insertErr) throw insertErr;

      // 2. Tandai mutasi lama sebagai DIGANTI
      const { error: updateErr } = await client.from('inventory_transactions').update({
        is_ganti: true,
        status_dokumen: 'DIGANTI',
        alasan_batal_ganti: `Digantikan oleh baris #${newRow?.id?.slice(0, 8)} oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (updateErr) throw updateErr;
      await refreshData();
      return { success: true, message: 'Baris mutasi berhasil diganti. Data revisi baru telah tercatat dan baris lama dinolkan secara otomatis.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Penggantian mutasi gagal.' };
    }
  };

  // Alur Persetujuan Berjenjang (Berseri) Mutasi Barang
  const advanceStockWorkflow = async (id: string, nextStatus: StatusDokumenWorkflow) => {
    try {
      const client = getSupabaseClient();
      const payload: any = { status_dokumen: nextStatus };
      const actorTag = `${user.name} (${activeRole})`;

      if (nextStatus === 'DIPERIKSA') {
        if (!rolePermissions.canCheck) throw new Error('Jabatan Anda tidak memiliki hak untuk Memeriksa dokumen ini.');
        payload.diperiksa_oleh = actorTag;
      } else if (nextStatus === 'DISETUJUI') {
        if (!rolePermissions.canApprove) throw new Error('Jabatan Anda tidak memiliki hak untuk Menyetujui dokumen ini.');
        payload.disetujui_oleh = actorTag;
      } else if (nextStatus === 'MENGETAHUI') {
        if (!rolePermissions.canAcknowledge) throw new Error('Jabatan Anda tidak memiliki hak untuk Mengesahkan (TTE/QR) dokumen ini.');
        payload.mengetahui_oleh = actorTag;
        payload.tte_qr_code = `TTE-${activeCompany.npwp}-${id.slice(0, 8)}-${Date.now()}`;
      }

      const { error } = await client.from('inventory_transactions').update(payload).eq('id', id);
      if (error) throw error;
      await refreshData();
      return { success: true, message: `Status dokumen mutasi barang berhasil dinaikkan ke: ${nextStatus}.` };
    } catch (e: any) {
      return { success: false, message: e.message || 'Pembaruan persetujuan gagal.' };
    }
  };

  // Transaksi Baru Mutasi Kas (Diterbitkan oleh Clerk)
  const addCashMutation = async (data: Omit<MutasiKas, 'id' | 'saldo_setelah'>) => {
    try {
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const { error } = await client.from('cash_transactions').insert({
        idempotency_key: crypto.randomUUID(),
        workspace_id: wsId,
        project_id: prId,
        transaction_type: data.jenis,
        amount: data.jumlah_rp,
        occurred_at: data.tanggal,
        category: data.kategori_keperluan,
        description: data.untuk_apa,
        reference_no: data.nomor_kuitansi || null,
        pic: data.pic,
        notes: data.catatan || null,
        status_dokumen: 'DITERBITKAN'
      });

      if (error) throw error;
      await refreshData();
      return { success: true, message: 'Transaksi kas berhasil dicatat ke dalam jurnal.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Pencatatan transaksi kas gagal.' };
    }
  };

  // Batalkan Mutasi Kas (Nominal tidak dihitung di saldo, data tetap ada)
  const batalCashMutation = async (id: string, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan pembatalan minimal 5 karakter.');
      const client = getSupabaseClient();
      const { error } = await client.from('cash_transactions').update({
        is_batal: true,
        status_dokumen: 'BATAL',
        alasan_batal_ganti: `Dibatalkan oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (error) throw error;
      await refreshData();
      return { success: true, message: 'Transaksi kas berhasil dibatalkan. Saldo kas disesuaikan secara otomatis.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Pembatalan transaksi kas gagal.' };
    }
  };

  // Ganti Mutasi Kas (Revisi ke baris baru, rujukan tercatat, baris lama dinolkan)
  const gantiCashMutation = async (id: string, newMutation: Omit<MutasiKas, 'id' | 'saldo_setelah'>, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan penggantian minimal 5 karakter.');
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const { data: newRow, error: insertErr } = await client.from('cash_transactions').insert({
        idempotency_key: crypto.randomUUID(),
        workspace_id: wsId,
        project_id: prId,
        transaction_type: newMutation.jenis,
        amount: newMutation.jumlah_rp,
        occurred_at: newMutation.tanggal,
        category: newMutation.kategori_keperluan,
        description: newMutation.untuk_apa,
        reference_no: newMutation.nomor_kuitansi || null,
        pic: newMutation.pic,
        notes: newMutation.catatan || null,
        status_dokumen: 'DITERBITKAN',
        referensi_ganti_id: id
      }).select().single();

      if (insertErr) throw insertErr;

      const { error: updateErr } = await client.from('cash_transactions').update({
        is_ganti: true,
        status_dokumen: 'DIGANTI',
        alasan_batal_ganti: `Digantikan oleh baris #${newRow?.id?.slice(0, 8)} oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (updateErr) throw updateErr;
      await refreshData();
      return { success: true, message: 'Transaksi kas berhasil diganti dengan baris revisi baru dan nominal lama dinolkan.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Penggantian transaksi kas gagal.' };
    }
  };

  // Alur Persetujuan Berjenjang (Berseri) Mutasi Kas
  const advanceCashWorkflow = async (id: string, nextStatus: StatusDokumenWorkflow) => {
    try {
      const client = getSupabaseClient();
      const payload: any = { status_dokumen: nextStatus };
      const actorTag = `${user.name} (${activeRole})`;

      if (nextStatus === 'DIPERIKSA') {
        if (!rolePermissions.canCheck) throw new Error('Jabatan Anda tidak memiliki hak untuk Memeriksa dokumen ini.');
        payload.diperiksa_oleh = actorTag;
      } else if (nextStatus === 'DISETUJUI') {
        if (!rolePermissions.canApprove) throw new Error('Jabatan Anda tidak memiliki hak untuk Menyetujui dokumen ini.');
        payload.disetujui_oleh = actorTag;
      } else if (nextStatus === 'MENGETAHUI') {
        if (!rolePermissions.canAcknowledge) throw new Error('Jabatan Anda tidak memiliki hak untuk Mengesahkan (TTE/QR) dokumen ini.');
        payload.mengetahui_oleh = actorTag;
        payload.tte_qr_code = `TTE-${activeCompany.npwp}-${id.slice(0, 8)}-${Date.now()}`;
      }

      const { error } = await client.from('cash_transactions').update(payload).eq('id', id);
      if (error) throw error;
      await refreshData();
      return { success: true, message: `Status transaksi kas berhasil dinaikkan ke: ${nextStatus}.` };
    } catch (e: any) {
      return { success: false, message: e.message || 'Pembaruan persetujuan kas gagal.' };
    }
  };

  // ============================================================================
  // DOKUMEN RESMI & PERSETUJUAN BERANTAI (SERIAL APPROVAL KHUSUS DOKUMEN)
  // ============================================================================
  const issueOfficialDocument = async (params: {
    jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'INVENTARIS_LENGKAP';
    judul: string;
    periode: string;
    ringkasan: string;
    total_nilai_atau_item: string;
  }) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk (Pelaksana Administrasi) yang memiliki wewenang menerbitkan Dokumen Resmi baru.');
      }
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const prefix = params.jenis === 'MUTASI_STOK' ? 'BA-STOK' : params.jenis === 'MUTASI_KAS' ? 'BA-KAS' : 'BA-INV';
      const docCode = `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const shaHash = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();

      const { error } = await client.from('documents').insert({
        workspace_id: wsId,
        project_id: prId,
        document_no: docCode,
        document_type: params.jenis,
        title: params.judul.trim(),
        status: 'ISSUED',
        status_dokumen: 'DITERBITKAN',
        signer_name: user.name,
        signer_role: activeRole,
        signer_email: user.email || null,
        content_sha256: `SHA256:${shaHash}`,
        qr_payload: `DOC:${docCode}:${activeCompany.npwp}`,
        snapshot: {
          periode: params.periode,
          ringkasan: params.ringkasan,
          total_nilai_atau_item: params.total_nilai_atau_item,
          penandatangan: user.name,
          jabatan: activeRole
        },
        created_by: user.id || null,
        issued_at: new Date().toISOString()
      });

      if (error) throw error;
      await refreshData();
      return { success: true, message: `Dokumen Resmi ${docCode} berhasil diterbitkan oleh Clerk dan siap memasuki alur persetujuan berantai.` };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal menerbitkan dokumen resmi.' };
    }
  };

  const advanceDocumentWorkflow = async (docDbId: string, nextStatus: StatusDokumenWorkflow) => {
    try {
      const client = getSupabaseClient();
      const actorTag = `${user.name} (${activeRole}) · ${new Date().toLocaleString('id-ID')}`;
      const payload: any = { status_dokumen: nextStatus };

      if (nextStatus === 'DIPERIKSA') {
        if (!rolePermissions.canCheck) throw new Error('Jabatan Anda tidak memiliki wewenang untuk Memeriksa (Tahap 2) dokumen ini.');
        payload.diperiksa_oleh = actorTag;
      } else if (nextStatus === 'DISETUJUI') {
        if (!rolePermissions.canApprove) throw new Error('Jabatan Anda tidak memiliki wewenang untuk Menyetujui (Tahap 3) dokumen ini.');
        payload.disetujui_oleh = actorTag;
      } else if (nextStatus === 'MENGETAHUI') {
        if (!rolePermissions.canAcknowledge) throw new Error('Jabatan Anda tidak memiliki wewenang untuk Mengesahkan TTE/QR (Tahap 4) dokumen ini.');
        payload.mengetahui_oleh = actorTag;
        payload.status = 'SIGNED';
        payload.tte_qr_code = `TTE-DOC-${activeCompany.npwp}-${docDbId.slice(0, 8).toUpperCase()}-${Date.now()}`;
      }

      const { error } = await client.from('documents').update(payload).eq('id', docDbId);
      if (error) throw error;
      await refreshData();
      return {
        success: true,
        message:
          nextStatus === 'MENGETAHUI'
            ? 'Dokumen Resmi telah DISAHKAN dengan Tanda Tangan Elektronik (TTE) & QR Code Verifikasi!'
            : `Tahap persetujuan Dokumen Resmi berhasil dinaikkan menjadi: ${nextStatus}.`
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal memproses persetujuan dokumen.' };
    }
  };

  const batalOfficialDocument = async (docDbId: string, reason: string) => {
    try {
      if (!rolePermissions.canInitiateBatalGanti && !rolePermissions.canInstructBatalGanti) {
        throw new Error('Jabatan Pengamat (Viewer) tidak memiliki akses untuk membatalkan dokumen.');
      }
      if (!reason || reason.trim().length < 5) throw new Error('Alasan pembatalan dokumen minimal 5 karakter.');
      const client = getSupabaseClient();
      const { error } = await client.from('documents').update({
        is_batal: true,
        status: 'REVOKED',
        status_dokumen: 'BATAL',
        alasan_batal_ganti: `Dibatalkan oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', docDbId);

      if (error) throw error;
      await refreshData();
      return { success: true, message: 'Dokumen Resmi berhasil dibatalkan. Riwayat dokumen tetap tersimpan sebagai jejak audit.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal membatalkan dokumen resmi.' };
    }
  };

  const gantiOfficialDocument = async (
    docDbId: string,
    newParams: {
      jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'INVENTARIS_LENGKAP';
      judul: string;
      periode: string;
      ringkasan: string;
      total_nilai_atau_item: string;
    },
    reason: string
  ) => {
    try {
      if (!rolePermissions.canInitiateBatalGanti && !rolePermissions.canInstructBatalGanti) {
        throw new Error('Jabatan Pengamat (Viewer) tidak memiliki akses untuk mengganti dokumen.');
      }
      if (!reason || reason.trim().length < 5) throw new Error('Alasan penggantian dokumen minimal 5 karakter.');
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const prefix = newParams.jenis === 'MUTASI_STOK' ? 'BA-STOK-REV' : newParams.jenis === 'MUTASI_KAS' ? 'BA-KAS-REV' : 'BA-INV-REV';
      const newDocCode = `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const shaHash = Array.from(crypto.getRandomValues(new Uint8Array(16)))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();

      const { data: insertedDoc, error: insertErr } = await client.from('documents').insert({
        workspace_id: wsId,
        project_id: prId,
        document_no: newDocCode,
        document_type: newParams.jenis,
        title: newParams.judul.trim(),
        status: 'ISSUED',
        status_dokumen: 'DITERBITKAN',
        signer_name: user.name,
        signer_role: activeRole,
        signer_email: user.email || null,
        referensi_ganti_id: docDbId,
        content_sha256: `SHA256:${shaHash}`,
        qr_payload: `DOC:${newDocCode}:${activeCompany.npwp}`,
        snapshot: {
          periode: newParams.periode,
          ringkasan: newParams.ringkasan,
          total_nilai_atau_item: newParams.total_nilai_atau_item,
          penandatangan: user.name,
          jabatan: activeRole
        },
        created_by: user.id || null,
        issued_at: new Date().toISOString()
      }).select().single();

      if (insertErr) throw insertErr;

      const { error: updateErr } = await client.from('documents').update({
        is_ganti: true,
        status: 'REVOKED',
        status_dokumen: 'DIGANTI',
        alasan_batal_ganti: `Digantikan oleh Dokumen Revisi ${insertedDoc?.document_no || newDocCode} oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', docDbId);

      if (updateErr) throw updateErr;
      await refreshData();
      return { success: true, message: `Dokumen lama ditandai DIGANTI dan Dokumen Revisi baru (${newDocCode}) berhasil diterbitkan!` };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal mengganti dokumen resmi.' };
    }
  };

  const reverseStockMutation = batalStockMutation;
  const reverseCashMutation = batalCashMutation;
  const addDocument = async (_doc: DokumenLaporan) => {};

  const logout = async () => {
    try {
      await signOutSupabase();
    } finally {
      setUser({ ...DEFAULT_USER, id: '', email: '' });
    }
  };

  const updateUserProfile = async (updates: Partial<UserProfile>) => {
    const updatedUser = { ...user, ...updates };
    setUser(updatedUser);
    saveStoredUser(updatedUser);

    try {
      const client = getSupabaseClient();
      if (user.id) {
        await client.auth.updateUser({
          data: {
            full_name: updates.name ?? user.name,
            avatar_url: updates.avatar_url ?? user.avatar_url
          }
        });
        const profileUpdates: Record<string, any> = {};
        if (updates.name) profileUpdates.full_name = updates.name;
        if (updates.avatar_url !== undefined) profileUpdates.avatar_url = updates.avatar_url;
        if (Object.keys(profileUpdates).length > 0) {
          await client.from('profiles').update(profileUpdates).eq('id', user.id);
        }
      }
    } catch (err) {
      console.warn('Sinkronisasi profil Supabase:', err);
    }
  };

  const stockItems = items.filter(x => x.is_stock_item);
  const totalStockAssetValue = stockItems.reduce((s, x) => s + x.stok_saat_ini * x.harga_satuan, 0);
  const currentCashBalance = cashMutations[0]?.saldo_setelah ?? 0;
  const cashHasEntries = cashMutations.length > 0;
  const recordedStockCount = stockItems.filter(x => x.has_stock_history).length;
  const unrecordedStockCount = stockItems.length - recordedStockCount;
  const outOfStockCount = stockItems.filter(x => x.has_stock_history && x.stok_saat_ini <= 0).length;
  const lowStockCount = stockItems.filter(x => x.stok_saat_ini > 0 && x.stok_saat_ini <= x.stok_minimum).length;
  const availableStockCount = stockItems.filter(x => x.has_stock_history && x.stok_saat_ini > x.stok_minimum).length;

  const updateCompanyLogo = async (logoUrl: string) => {
    const targetCompanyId = activeCompany.id || activeContext?.workspaces.find(w => w.type === 'COMPANY')?.company_id;
    if (!targetCompanyId) throw new Error('ID Perusahaan tidak ditemukan.');
    const client = getSupabaseClient();
    const { error } = await client
      .from('companies')
      .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
      .eq('id', targetCompanyId);
    if (error) throw error;
    setActiveCompany(prev => ({ ...prev, logoUrl }));
    await refreshActiveContext();
    await refreshData();
  };

  const tenantBranding: TenantBranding = {
    contractorName:
      activeProject?.company_name ||
      (activeCompany.id ? activeCompany.name : '') ||
      'Kontraktor',
    contractorNpwp: activeProject?.company_npwp || activeCompany.npwp || '',
    contractorLogoUrl: activeProject?.company_logo_url || activeCompany.logoUrl || '',
    clientName: activeClientName || 'Klien',
    projectName: activeProject?.name || 'Proyek Aktif',
    projectCode: activeProject?.project_code || '',
    directorName: activeRole === 'CEO/Direktur' && user?.name ? user.name : 'Direktur Utama',
    directorEmail: activeRole === 'CEO/Direktur' && user?.email ? user.email : ''
  };

  const canViewFinancials = useMemo(() => {
    if (activeRole === 'CEO/Direktur') return true;
    const isCsa = activeContext?.workspaces?.some(w => w.type === 'COMPANY' && w.is_company_super_admin);
    if (isCsa) return true;

    const currentProj = activeProject || activeContext?.projects.find(p => p.id === activeProjectId);
    if (currentProj && typeof currentProj.can_view_financials === 'boolean') {
      return currentProj.can_view_financials;
    }

    if (activeRole === 'Viewer/Pengamat') {
      return false;
    }

    return true;
  }, [activeRole, activeContext, activeProjectId, activeProject]);

  return (
    <AppContext.Provider
      value={{
        activeContext,
        activeWorkspaceId,
        activeProjectId,
        activeProject,
        hasActiveProjectScope,
        setActiveProjectId,
        refreshActiveContext,
        refreshData,
        setActiveWorkspaceId,
        items,
        physicalMaterials,
        boqSections,
        stockMutations,
        cashMutations,
        documents,
        user,
        supabaseConfig,
        currentView,
        setCurrentView,
        verifyingDocId,
        setVerifyingDocId,
        addStockMutation,
        reverseStockMutation,
        batalStockMutation,
        gantiStockMutation,
        advanceStockWorkflow,
        addCashMutation,
        reverseCashMutation,
        batalCashMutation,
        gantiCashMutation,
        advanceCashWorkflow,
        issueOfficialDocument,
        advanceDocumentWorkflow,
        batalOfficialDocument,
        gantiOfficialDocument,
        addDocument,
        logout,
        updateUserProfile,
        totalStockAssetValue,
        currentCashBalance,
        outOfStockCount,
        lowStockCount,
        availableStockCount,
        theme,
        toggleTheme,
        dataReady,
        dataError,
        cashAccess,
        cashWriteAccess,
        stockWriteAccess,
        cashHasEntries,
        recordedStockCount,
        unrecordedStockCount,
        appMode,
        setAppMode,
        activeRole,
        setActiveRole,
        activeCompany,
        setActiveCompany,
        updateCompanyLogo,
        tenantBranding,
        rolePermissions,
        canViewFinancials
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const c = useContext(AppContext);
  if (!c) throw new Error('useApp must be used within AppProvider');
  return c;
};
