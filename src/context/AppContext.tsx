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
  TenantBranding,
  ProjectReceipt,
  DocumentAudiencePov,
  MetodePembayaran,
  StatusBuktiKas,
  StatusKasbon,
  ProjectModuleCode,
  PoPaymentTerms,
  PurchaseOrder,
  PurchaseOrderItem,
  SupplierStore,
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
import {
  CashSummaryMetrics,
  computeCashSummaryMetrics,
  computeRunningCashBalances,
  countPendingCashApprovals,
  countPendingDocumentApprovals,
  countPendingStockApprovals,
  deriveBebanBiayaFromCategory,
  isCashRowExcluded,
  KasbonSettlementInput,
  planKasbonSettlement,
  resolveCashEvalContext,
  validateSerialWorkflowTransition,
} from '../lib/cashflowEngine';
import {
  createProjectReceipt,
  downgradeReceiptScopeToBelanjaBarang,
  saveSupplierStore,
  upgradeReceiptScopeToTerpadu,
} from '../lib/receiptStorage';
import {
  computeDueDateFromTerms,
  computePoPaymentProgress,
  computePoReceiveProgress,
  computeProcurementSummaryMetrics,
  countPendingPoApprovals,
  generateNextPoNumber,
  ProcurementSummaryMetrics,
} from '../lib/procurementEngine';

export type CashflowTabKey = 'SUMMARY' | 'RECONCILIATION' | 'JOURNAL' | 'DOCUMENTS';
export type ProcurementTabKey = 'NEEDS_STORES' | 'PO_LIST' | 'DELIVERIES' | 'DOCUMENTS';

export interface CreatePurchaseOrderInput {
  po_no?: string;
  store_id?: string | null;
  nama_toko: string;
  toko_kontak?: string;
  tanggal_po: string;
  estimasi_tiba?: string | null;
  payment_terms: PoPaymentTerms;
  jatuh_tempo_bayar?: string | null;
  dp_amount_rp?: number;
  catatan_toko?: string;
  items: Array<{
    boq_item_id?: string | null;
    nama_barang: string;
    satuan: string;
    qty_pesan: number;
    harga_satuan_po: number;
    harga_pagu_boq: number;
    catatan?: string;
  }>;
}

export interface ReceivePurchaseOrderInput {
  poId: string;
  tanggal: string;
  nomor_surat_jalan?: string;
  pic_penerima: string;
  catatan?: string;
  lampiran_nota_urls?: string[];
  items: Array<{
    po_item_id: string;
    qty_terima: number;
  }>;
}

export interface PayPurchaseOrderInput {
  poId: string;
  jumlah_rp: number;
  tanggal: string;
  payment_method: MetodePembayaran;
  pic: string;
  nomor_kuitansi?: string;
  lampiran_nota_urls?: string[];
  catatan?: string;
  jenis_bayar?: 'DP' | 'PELUNASAN' | 'SEBAGIAN';
}

function stableStringify(value: any): string {
  if (Array.isArray(value)) {
    return '[' + value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

async function computeDeterministicSha256(snapshot: Record<string, unknown>): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableStringify(snapshot)));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

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
  purchaseOrders: PurchaseOrder[];
  supplierStores: SupplierStore[];
  documents: DokumenLaporan[];
  projectReceipts: ProjectReceipt[];
  refreshProjectReceipts: () => Promise<void>;
  saveProjectStore: (store: Partial<SupplierStore> & { nama_toko: string }) => Promise<{ success: boolean; message: string; store?: SupplierStore | null }>;
  createPurchaseOrder: (input: CreatePurchaseOrderInput) => Promise<{ success: boolean; message: string; po?: PurchaseOrder }>;
  advancePurchaseOrderWorkflow: (poId: string, nextStatus: StatusDokumenWorkflow, customActorRole?: ImpersonateRole) => Promise<{ success: boolean; message: string }>;
  markPurchaseOrderSent: (poId: string) => Promise<{ success: boolean; message: string }>;
  receivePurchaseOrderItems: (input: ReceivePurchaseOrderInput) => Promise<{ success: boolean; message: string }>;
  payPurchaseOrder: (input: PayPurchaseOrderInput) => Promise<{ success: boolean; message: string }>;
  batalPurchaseOrder: (poId: string, reason: string) => Promise<{ success: boolean; message: string }>;
  gantiPurchaseOrder: (poId: string, newInput: CreatePurchaseOrderInput, reason: string) => Promise<{ success: boolean; message: string }>;
  user: UserProfile;
  supabaseConfig: SupabaseConfig;
  currentView: string;
  setCurrentView: (view: string) => void;
  goBack: () => void;
  previousView: string | null;
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
  lengkapiBuktiCashMutation: (
    targetTx: MutasiKas,
    proof: {
      nomor_kuitansi?: string;
      nama_toko?: string;
      toko_kontak?: string;
      tanggal_nota?: string;
      lampiran_nota_urls: string[];
      receipt_id?: string;
      catatan?: string;
      reason?: string;
    }
  ) => Promise<{ success: boolean; message: string }>;
  selesaikanKasbonMutation: (input: KasbonSettlementInput) => Promise<{ success: boolean; message: string }>;
  issueOfficialDocument: (params: {
    jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'PO_PENGADAAN' | 'INVENTARIS_LENGKAP' | 'GABUNGAN_PROYEK';
    judul: string;
    periode: string;
    ringkasan: string;
    total_nilai_atau_item: string;
    audience_pov?: DocumentAudiencePov;
    extraSnapshot?: Record<string, unknown>;
  }) => Promise<{ success: boolean; message: string }>;
  advanceDocumentWorkflow: (
    dbId: string,
    nextStatus: StatusDokumenWorkflow,
    customActorRole?: ImpersonateRole
  ) => Promise<{ success: boolean; message: string }>;
  batalOfficialDocument: (dbId: string, reason: string) => Promise<{ success: boolean; message: string }>;
  gantiOfficialDocument: (
    dbId: string,
    params: {
      jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'PO_PENGADAAN' | 'INVENTARIS_LENGKAP' | 'GABUNGAN_PROYEK';
      judul: string;
      periode: string;
      ringkasan: string;
      total_nilai_atau_item: string;
      audience_pov?: DocumentAudiencePov;
      extraSnapshot?: Record<string, unknown>;
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
  cashSummaryMetrics: CashSummaryMetrics;
  procurementSummary: ProcurementSummaryMetrics;
  cashCriticalAlertCount: number;
  cashActionBadgeCount: number;
  pendingStockApprovalCount: number;
  pendingCashApprovalCount: number;
  pendingPoApprovalCount: number;
  pendingDocumentApprovalCount: number;
  pendingApprovalCount: number;
  cashTargetTab: CashflowTabKey | null;
  setCashTargetTab: (tab: CashflowTabKey | null) => void;
  stockTargetTab: string | null;
  setStockTargetTab: (tab: string | null) => void;
  procurementTargetTab: ProcurementTabKey | null;
  setProcurementTargetTab: (tab: ProcurementTabKey | null) => void;
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
  const [currentView, setCurrentViewRaw] = useState('landing');
  const [viewHistory, setViewHistory] = useState<string[]>(['landing']);

  const setCurrentView = useCallback((view: string) => {
    startTransition(() => {
      setViewHistory(prev => {
        if (prev[prev.length - 1] === view) return prev;
        return [...prev, view];
      });
      setCurrentViewRaw(view);
    });
  }, []);

  const goBack = useCallback(() => {
    startTransition(() => {
      setViewHistory(prev => {
        if (prev.length <= 1) {
          const fallback = 'dashboard';
          setCurrentViewRaw(fallback);
          return [fallback];
        }
        const updated = prev.slice(0, -1);
        const target = updated[updated.length - 1] || 'dashboard';
        setCurrentViewRaw(target);
        return updated;
      });
    });
  }, []);

  const previousView = viewHistory.length > 1 ? viewHistory[viewHistory.length - 2] : null;
  const [verifyingDocId, setVerifyingDocId] = useState<string | null>(null);
  const [cashTargetTab, setCashTargetTab] = useState<CashflowTabKey | null>(null);
  const [stockTargetTab, setStockTargetTab] = useState<string | null>(null);
  const [procurementTargetTab, setProcurementTargetTab] = useState<ProcurementTabKey | null>(null);
  const [dataReady, setDataReady] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);
  const [cashAccess, setCashAccess] = useState(false);

  // App Mode & Impersonate State (Default aman selalu PERSONAL ala filosofi Coretax)
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
    // Set default view: PERSONAL default ke landing (katalog & beranda), mode lain ke dashboard
    if (mode === 'PERSONAL') {
      setCurrentView('landing');
    } else {
      setCurrentView('dashboard');
    }
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
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [supplierStores, setSupplierStores] = useState<SupplierStore[]>([]);
  const [documents, setDocuments] = useState<DokumenLaporan[]>([]);
  const [projectReceipts, setProjectReceipts] = useState<ProjectReceipt[]>([]);

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
      setPurchaseOrders([]);
      setSupplierStores([]);
      setDocuments([]);
      setProjectReceipts([]);
      setDataReady(true);
      setDataError(null);
      return;
    }

    const client = getSupabaseClient();
    const [boqRes, sectionsRes, stockRes, cashRes, docsRes, reversalsRes, clientRelRes, receiptsRes, poRes, poItemsRes, storesRes] = await Promise.all([
      client.from('boq_items').select('*').eq('project_id', selectedProject.id).eq('is_active', true).order('source_row'),
      client.from('boq_sections').select('*').eq('project_id', selectedProject.id).eq('is_active', true).order('sort_order'),
      client.from('inventory_transactions').select('*').eq('project_id', selectedProject.id).order('occurred_at', { ascending: true }).order('created_at', { ascending: true }),
      client.from('cash_transactions').select('*').eq('project_id', selectedProject.id).order('occurred_at', { ascending: true }).order('created_at', { ascending: true }),
      client.from('documents').select('*').eq('project_id', selectedProject.id).in('document_type', ['MUTASI_KAS', 'MUTASI_STOK', 'PO_PENGADAAN', 'GABUNGAN_PROYEK']).order('created_at', { ascending: false }),
      client.from('inventory_transaction_reversals').select('original_transaction_id'),
      client.from('project_client_relationships').select('client_name, relationship_type').eq('project_id', selectedProject.id).order('created_at', { ascending: true }),
      client.from('project_receipts').select('*').eq('project_id', selectedProject.id).order('created_at', { ascending: false }),
      client.from('purchase_orders').select('*').eq('project_id', selectedProject.id).order('tanggal_po', { ascending: false }).order('created_at', { ascending: false }),
      client.from('purchase_order_items').select('*').eq('project_id', selectedProject.id).order('sort_order', { ascending: true }),
      client.from('supplier_stores').select('*').or(`project_id.eq.${selectedProject.id},project_id.is.null`).order('nama_toko', { ascending: true })
    ]);

    setProjectReceipts(receiptsRes.data || []);
    setSupplierStores((storesRes.data as SupplierStore[]) || []);

    const poItemsByPoId = new Map<string, PurchaseOrderItem[]>();
    for (const pi of (poItemsRes.data || []) as any[]) {
      const mappedItem: PurchaseOrderItem = {
        id: pi.id,
        po_id: pi.po_id,
        project_id: pi.project_id,
        boq_item_id: pi.boq_item_id || null,
        nama_barang: pi.nama_barang,
        satuan: pi.satuan || 'Unit',
        qty_pesan: Number(pi.qty_pesan) || 0,
        harga_satuan_po: Number(pi.harga_satuan_po) || 0,
        harga_pagu_boq: Number(pi.harga_pagu_boq) || 0,
        subtotal_rp: Number(pi.subtotal_rp) || 0,
        catatan: pi.catatan || undefined,
        sort_order: Number(pi.sort_order) || 0,
        created_at: pi.created_at || undefined,
      };
      const arr = poItemsByPoId.get(pi.po_id) || [];
      arr.push(mappedItem);
      poItemsByPoId.set(pi.po_id, arr);
    }

    const mappedPurchaseOrders: PurchaseOrder[] = ((poRes.data || []) as any[]).map((p) => {
      const isBatalFlag = Boolean(p.is_batal || p.status_dokumen === 'BATAL');
      const isGantiFlag = Boolean(p.is_ganti || p.status_dokumen === 'DIGANTI');
      return {
        id: p.id,
        workspace_id: p.workspace_id || undefined,
        project_id: p.project_id,
        po_no: p.po_no,
        store_id: p.store_id || null,
        nama_toko: p.nama_toko,
        toko_kontak: p.toko_kontak || undefined,
        tanggal_po: p.tanggal_po || p.created_at,
        estimasi_tiba: p.estimasi_tiba || null,
        payment_terms: (p.payment_terms as PoPaymentTerms) || 'TUNAI_SAAT_TIBA',
        jatuh_tempo_bayar: p.jatuh_tempo_bayar || null,
        dp_amount_rp: Number(p.dp_amount_rp) || 0,
        total_amount_rp: Number(p.total_amount_rp) || 0,
        catatan_toko: p.catatan_toko || undefined,
        sent_to_store_at: p.sent_to_store_at || null,
        created_by: p.created_by || undefined,
        created_by_name: p.created_by_name || undefined,
        status_dokumen: (p.status_dokumen as StatusDokumenWorkflow) || (isBatalFlag ? 'BATAL' : isGantiFlag ? 'DIGANTI' : 'DITERBITKAN'),
        diperiksa_oleh: p.diperiksa_oleh || undefined,
        disetujui_oleh: p.disetujui_oleh || undefined,
        mengetahui_oleh: p.mengetahui_oleh || undefined,
        tte_qr_code: p.tte_qr_code || undefined,
        is_batal: isBatalFlag,
        is_ganti: isGantiFlag,
        referensi_ganti_id: p.referensi_ganti_id || undefined,
        alasan_batal_ganti: p.alasan_batal_ganti || undefined,
        created_at: p.created_at || undefined,
        updated_at: p.updated_at || undefined,
        items: poItemsByPoId.get(p.id) || [],
      };
    });
    setPurchaseOrders(mappedPurchaseOrders);

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
      const isStock = targetItem ? Boolean(targetItem.is_stock_item) : true;
      const qtyNum = Number(t.quantity) || 0;
      const delta = isVoid || !isStock ? 0 : incoming ? qtyNum : -qtyNum;
      const afterPhysical = beforePhysical + delta;

      if (!isVoid) {
        if (isStock) {
          physicalBalance.set(key, afterPhysical);
        }
        if (incoming) {
          if (isStock) {
            physicalReceived.set(key, (physicalReceived.get(key) || 0) + qtyNum);
          }

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
          if (isStock) {
            physicalConsumed.set(key, (physicalConsumed.get(key) || 0) + qtyNum);
          }
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
        is_batal: Boolean(t.is_batal || t.status_dokumen === 'BATAL' || reversedIds.has(t.id)),
        is_ganti: Boolean(t.is_ganti || t.status_dokumen === 'DIGANTI'),
        referensi_ganti_id: t.referensi_ganti_id || undefined,
        alasan_batal_ganti: t.alasan_batal_ganti || undefined,
        harga_satuan_beli: t.harga_satuan_beli != null ? Number(t.harga_satuan_beli) : undefined,
        status_harga: t.status_harga || undefined,
        nama_item_aktual: t.nama_item_aktual || undefined,
        nomor_nota: t.reference_no || t.nomor_nota || undefined,
        tanggal_nota: t.tanggal_nota || undefined,
        nama_toko: t.nama_toko || t.source_name || undefined,
        toko_kontak: t.toko_kontak || undefined,
        total_nota_fisik: t.total_nota_fisik != null ? Number(t.total_nota_fisik) : undefined,
        lampiran_nota_urls: Array.isArray(t.lampiran_nota_urls) ? t.lampiran_nota_urls : [],
        receipt_id: t.receipt_id || undefined,
        po_id: t.po_id || undefined,
        po_item_id: t.po_item_id || undefined
      };
    });

    // 3. Petakan Item BOQ Terperinci dengan Alokasi FIFO Kedatangan Gudang (Mencegah Duplikasi Multi-Pos)
    const remainingReceivedPool = new Map<string, number>();
    physicalReceived.forEach((qty, key) => remainingReceivedPool.set(key, qty));

    const mappedItems: ItemBarang[] = rawBoq.map((b: any) => {
      const baseTarget = Number(b.quantity) || 0;
      const key = itemToKey.get(b.id)!;
      const totalBoqGabungan = totalBoqByKey.get(key) || baseTarget;
      const jumlahPosGabungan = posCountByKey.get(key) || 1;
      const physicalStock = Math.max(0, physicalBalance.get(key) || 0);
      const masukGudangTotal = physicalReceived.get(key) || 0;
      const terpakaiDiPosIni = boqItemConsumed.get(b.id) || 0;

      // Alokasi kedatangan material untuk pos ini:
      // - Untuk item 1 pos: seluruh kedatangan masuk ke pos ini
      // - Untuk item multi-pos: alokasikan secara berurutan (FIFO) dari pool penerimaan fisik yang ada
      let masukKePosIni = 0;
      if (jumlahPosGabungan === 1) {
        masukKePosIni = masukGudangTotal;
      } else {
        const poolAvailable = remainingReceivedPool.get(key) || 0;
        masukKePosIni = Math.min(baseTarget, poolAvailable);
        remainingReceivedPool.set(key, Math.max(0, poolAvailable - masukKePosIni));
      }

      // Sisa Kebutuhan Pemakaian di level pos (Dimensi Realisasi BOQ: target - terpakai)
      const sisaKebutuhanPos = Math.max(0, baseTarget - terpakaiDiPosIni);
      // Sisa Belum Tiba di Gudang (Dimensi Pengadaan: total target BOQ gabungan - total fisik masuk)
      const sisaBelumTibaGudang = Math.max(0, totalBoqGabungan - masukGudangTotal);
      
      const EPS = 0.0001;
      // Status Pemenuhan Pos BOQ (Baku & Murni Berdasarkan Realisasi Lapangan):
      // Pos baru 'Terpenuhi' jika terpasang/terpakai >= target, bukan sekadar barang baru tiba di gudang
      let statusPemenuhan: ItemBarang['status_pemenuhan'] = 'Belum dipenuhi';
      if (terpakaiDiPosIni >= baseTarget - EPS && baseTarget > 0) {
        statusPemenuhan = terpakaiDiPosIni > baseTarget + EPS ? 'Melebihi BOQ' : 'Terpenuhi';
      } else if (terpakaiDiPosIni > 0) {
        statusPemenuhan = 'Dalam pemenuhan';
      }

      const progress = baseTarget > 0 ? Math.min((terpakaiDiPosIni / baseTarget) * 100, 100) : 0;

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
        has_stock_history: stockHistory.has(b.id) || masukGudangTotal > 0 || terpakaiDiPosIni > 0,
        qty_masuk_total: masukKePosIni,
        qty_keluar_total: terpakaiDiPosIni,
        qty_pemenuhan_sisa: sisaKebutuhanPos,
        total_boq_material_gabungan: totalBoqGabungan,
        jumlah_pos_material_gabungan: jumlahPosGabungan,
        sisa_belum_tiba_gudang: sisaBelumTibaGudang,
        progress_pemenuhan: progress,
        status_pemenuhan: statusPemenuhan,
        satuan: b.uom || 'Unit',
        harga_satuan: Number(b.unit_rate || 0),
        stok_saat_ini: physicalStock,
        stok_minimum: 0,
        status: computeItemStatus(physicalStock, 0, stockHistory.has(b.id) || masukGudangTotal > 0 || terpakaiDiPosIni > 0),
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

    const rawCashRows: MutasiKas[] = (cashRes.data || []).map((t: any) => {
      const isBatalFlag = Boolean(t.is_batal || t.status_dokumen === 'BATAL');
      const isGantiFlag = Boolean(t.is_ganti || t.status_dokumen === 'DIGANTI');
      const isExcluded = isBatalFlag || isGantiFlag;
      const jenis = (t.transaction_type || 'KELUAR') as MutasiKas['jenis'];
      const category = (t.category || 'Lainnya') as MutasiKas['kategori_keperluan'];
      const urls: string[] = Array.isArray(t.lampiran_nota_urls) ? t.lampiran_nota_urls.filter(Boolean) : [];
      const resolvedStatusBukti: StatusBuktiKas =
        (t.status_bukti as StatusBuktiKas) ||
        (t.receipt_id && t.source_module === 'MUTASI_BARANG'
          ? 'REKONSILIASI_NOTA'
          : urls.length > 0
          ? 'TERLAMPIR'
          : 'TANPA_BUKTI');

      return {
        id: t.id,
        jenis,
        jumlah_rp: Number(t.amount),
        untuk_apa: t.description,
        kategori_keperluan: category,
        pic: t.pic || '-',
        nomor_kuitansi: t.reference_no || undefined,
        tanggal: t.occurred_at || t.created_at,
        created_at: t.created_at || undefined,
        saldo_setelah: 0,
        catatan: t.notes || undefined,
        created_by_name: t.created_by_name || undefined,
        payment_method: (t.payment_method as MetodePembayaran) || 'TUNAI',
        beban_biaya: (t.beban_biaya as BebanBiaya) || deriveBebanBiayaFromCategory(jenis, category),
        status_bukti: resolvedStatusBukti,
        boq_item_id: t.boq_item_id || undefined,
        is_kasbon: Boolean(t.is_kasbon || category === 'Panjar / Kasbon'),
        status_kasbon: (t.status_kasbon as StatusKasbon) || (t.is_kasbon ? 'TERBUKA' : 'TIDAK_BERLAKU'),
        kasbon_induk_id: t.kasbon_induk_id || undefined,
        nominal_lpj: t.nominal_lpj != null ? Number(t.nominal_lpj) : 0,
        lpj_kategori_riil: t.lpj_kategori_riil || undefined,
        source_module: (t.source_module as ProjectModuleCode) || 'KAS_LANGSUNG',
        source_entity_id: t.source_entity_id || undefined,
        source_entity_no: t.source_entity_no || undefined,
        status_dokumen: (t.status_dokumen as StatusDokumenWorkflow) || (isBatalFlag ? 'BATAL' : isGantiFlag ? 'DIGANTI' : 'DITERBITKAN'),
        diperiksa_oleh: t.diperiksa_oleh || undefined,
        disetujui_oleh: t.disetujui_oleh || undefined,
        mengetahui_oleh: t.mengetahui_oleh || undefined,
        tte_qr_code: t.tte_qr_code || undefined,
        is_batal: isBatalFlag,
        is_ganti: isGantiFlag,
        referensi_ganti_id: t.referensi_ganti_id || undefined,
        alasan_batal_ganti: t.alasan_batal_ganti || undefined,
        harga_satuan_beli: t.harga_satuan_beli != null ? Number(t.harga_satuan_beli) : undefined,
        status_harga: t.status_harga || undefined,
        nama_item_aktual: t.nama_item_aktual || undefined,
        nomor_nota: t.reference_no || t.nomor_nota || undefined,
        tanggal_nota: t.tanggal_nota || undefined,
        nama_toko: t.nama_toko || t.source_name || undefined,
        toko_kontak: t.toko_kontak || undefined,
        total_nota_fisik: t.total_nota_fisik != null ? Number(t.total_nota_fisik) : undefined,
        lampiran_nota_urls: urls,
        receipt_id: t.receipt_id || undefined,
        // flag internal tidak mengubah saldo untuk baris dikecualikan
        ...(isExcluded ? {} : {}),
      };
    });

    const runningMap = computeRunningCashBalances(rawCashRows);
    let lastValidRunning = 0;
    const cashRows: MutasiKas[] = rawCashRows.map((row) => {
      const bal = runningMap.get(row.id);
      if (bal != null) {
        lastValidRunning = bal;
        return { ...row, saldo_setelah: bal };
      }
      return { ...row, saldo_setelah: lastValidRunning };
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

    const docRows: DokumenLaporan[] = (docsRes.data || []).map((d: any) => {
      const isRevoked = Boolean(d.is_batal || d.is_ganti || d.status === 'REVOKED' || d.status_dokumen === 'BATAL' || d.status_dokumen === 'DIGANTI');
      const docType = (d.document_type || 'MUTASI_STOK') as DokumenLaporan['jenis'];
      const defaultPov: DocumentAudiencePov =
        docType === 'MUTASI_KAS' || docType === 'PO_PENGADAAN'
          ? 'KONTRAKTOR'
          : docType === 'MUTASI_STOK'
          ? 'UMUM'
          : 'KONTRAKTOR';

      return {
        id: d.document_no || d.id,
        db_id: d.id,
        judul: d.title || 'Dokumen Berita Acara',
        jenis: docType,
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
        snapshot_json: d.snapshot ? (typeof d.snapshot === 'string' ? d.snapshot : JSON.stringify(d.snapshot)) : undefined,
        lifecycle_status: isRevoked ? 'REVOKED' : 'ACTIVE',
        revoked_at: isRevoked ? (d.updated_at || d.created_at) : null,
        audience_pov: (d.audience_pov as DocumentAudiencePov) || defaultPov,
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
      };
    });

    setItems(mappedItems);
    setBoqSections(sectionRows);
    setStockMutations(stockRows.reverse());
    setCashMutations(cashRows.reverse());
    setCashAccess(true);
    setDocuments(docRows);
    setDataError(null);
    setDataReady(true);
  };

  const refreshProjectReceipts = useCallback(async () => {
    if (!activeProjectId) return;
    const client = getSupabaseClient();
    if (!client) return;
    const { data } = await client
      .from('project_receipts')
      .select('*')
      .eq('project_id', activeProjectId)
      .order('created_at', { ascending: false });
    setProjectReceipts(data || []);
  }, [activeProjectId]);

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
        nama_item_aktual: data.nama_item_aktual || null,
        po_id: data.po_id || null,
        po_item_id: data.po_item_id || null
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

  // Alur Persetujuan Berjenjang (Berseri) Mutasi Barang — dengan validasi urutan serial ketat
  const advanceStockWorkflow = async (id: string, nextStatus: StatusDokumenWorkflow) => {
    try {
      const client = getSupabaseClient();
      const targetRow = stockMutations.find((m) => m.id === id);
      if (!targetRow) throw new Error('Baris mutasi barang tidak ditemukan.');
      const currentStatus = targetRow.status_dokumen || 'DITERBITKAN';
      const serialErr = validateSerialWorkflowTransition(currentStatus, nextStatus);
      if (serialErr) throw new Error(serialErr);

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

  // Helper internal membangun payload insert cash_transactions lengkap
  const buildCashInsertRow = (
    wsId: string,
    prId: string,
    data: Omit<MutasiKas, 'id' | 'saldo_setelah'>,
    referensiGantiId?: string
  ) => {
    const isPanjar =
      Boolean(data.is_kasbon) ||
      (data.jenis === 'KELUAR' && data.kategori_keperluan === 'Panjar / Kasbon');
    const urls = Array.isArray(data.lampiran_nota_urls) ? data.lampiran_nota_urls.filter(Boolean) : [];
    const statusBukti: StatusBuktiKas =
      data.status_bukti ||
      (data.receipt_id && data.source_module === 'MUTASI_BARANG'
        ? 'REKONSILIASI_NOTA'
        : urls.length > 0
        ? 'TERLAMPIR'
        : 'TANPA_BUKTI');

    return {
      idempotency_key: crypto.randomUUID(),
      workspace_id: wsId,
      project_id: prId,
      transaction_type: data.jenis,
      amount: Math.round(Number(data.jumlah_rp) || 0),
      occurred_at: data.tanggal,
      category: data.kategori_keperluan,
      description: data.untuk_apa,
      reference_no: data.nomor_kuitansi || null,
      pic: data.pic || user.name || '-',
      notes: data.catatan || null,
      created_by: user.id || null,
      created_by_name: `${user.name} (${activeRole})`,
      payment_method: data.payment_method || 'TUNAI',
      beban_biaya: data.beban_biaya || deriveBebanBiayaFromCategory(data.jenis, data.kategori_keperluan),
      status_bukti: statusBukti,
      nama_toko: data.nama_toko || null,
      toko_kontak: data.toko_kontak || null,
      tanggal_nota: data.tanggal_nota || null,
      total_nota_fisik: data.total_nota_fisik != null ? Number(data.total_nota_fisik) : null,
      lampiran_nota_urls: urls,
      receipt_id: data.receipt_id || null,
      boq_item_id: data.boq_item_id || null,
      is_kasbon: isPanjar,
      status_kasbon: isPanjar ? (data.status_kasbon || 'TERBUKA') : 'TIDAK_BERLAKU',
      kasbon_induk_id: data.kasbon_induk_id || null,
      nominal_lpj: data.nominal_lpj != null ? Number(data.nominal_lpj) : 0,
      lpj_kategori_riil: data.lpj_kategori_riil || null,
      source_module: data.source_module || 'KAS_LANGSUNG',
      source_entity_id: data.source_entity_id || null,
      source_entity_no: data.source_entity_no || null,
      status_dokumen: 'DITERBITKAN',
      ...(referensiGantiId ? { referensi_ganti_id: referensiGantiId } : {}),
    };
  };

  // Transaksi Baru Mutasi Kas (Diterbitkan oleh Clerk)
  const addCashMutation = async (data: Omit<MutasiKas, 'id' | 'saldo_setelah'>) => {
    try {
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      let resolvedReceiptId = data.receipt_id;
      const urls = Array.isArray(data.lampiran_nota_urls) ? data.lampiran_nota_urls.filter(Boolean) : [];

      // Jika mengunggah bukti langsung dari kas tanpa receipt_id -> buat entitas resmi di project_receipts (KAS_OPERASIONAL)
      if (!resolvedReceiptId && urls.length > 0 && prId) {
        const createdRc = await createProjectReceipt(
          {
            project_id: prId,
            reference_no: data.nomor_kuitansi || '',
            nama_toko: data.nama_toko || '',
            toko_kontak: data.toko_kontak,
            tanggal_nota: (data.tanggal_nota || data.tanggal || new Date().toISOString()).slice(0, 10),
            total_nota_fisik: data.total_nota_fisik || data.jumlah_rp,
            lampiran_nota_urls: urls,
            notes: data.catatan || data.untuk_apa,
            receipt_scope: 'KAS_OPERASIONAL',
            created_by: user.id || undefined,
            created_by_name: `${user.name} (${activeRole})`,
          },
          data.pic || user.name
        );
        if (createdRc?.id) {
          resolvedReceiptId = createdRc.id;
        }
      }

      const row = buildCashInsertRow(wsId, prId, {
        ...data,
        receipt_id: resolvedReceiptId,
      });

      const { error } = await client.from('cash_transactions').insert(row);
      if (error) throw error;

      // Jika melunasi nota gudang (receipt_id berasal dari BELANJA_BARANG), naikkan receipt_scope -> TERPADU
      if (resolvedReceiptId) {
        const existingRc = projectReceipts.find((r) => r.id === resolvedReceiptId);
        if (data.source_module === 'MUTASI_BARANG' || existingRc?.receipt_scope === 'BELANJA_BARANG') {
          await upgradeReceiptScopeToTerpadu(resolvedReceiptId);
        }
      }

      await refreshData();
      return { success: true, message: 'Transaksi kas berhasil dicatat ke dalam jurnal.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Pencatatan transaksi kas gagal.' };
    }
  };

  // Batalkan Mutasi Kas (Nominal tidak dihitung di saldo, data tetap ada; turunkan receipt_scope TERPADU bila perlu)
  const batalCashMutation = async (id: string, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan pembatalan minimal 5 karakter.');
      const client = getSupabaseClient();
      const targetTx = cashMutations.find((c) => c.id === id);

      const { error } = await client.from('cash_transactions').update({
        is_batal: true,
        status_dokumen: 'BATAL',
        alasan_batal_ganti: `Dibatalkan oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (error) throw error;

      // Jika transaksi ini menautkan nota gudang (TERPADU) dan tidak ada pembayaran kas aktif lain pada nota tsb,
      // turunkan kembali receipt_scope -> BELANJA_BARANG agar nota kembali muncul di antrean Rekonsiliasi
      if (targetTx?.receipt_id) {
        const hasOtherActiveCash = cashMutations.some(
          (c) => c.id !== id && !isCashRowExcluded(c) && c.receipt_id === targetTx.receipt_id
        );
        if (!hasOtherActiveCash) {
          await downgradeReceiptScopeToBelanjaBarang(targetTx.receipt_id);
        }
      }

      await refreshData();
      return { success: true, message: 'Transaksi kas berhasil dibatalkan. Saldo kas disesuaikan secara otomatis.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Pembatalan transaksi kas gagal.' };
    }
  };

  // Ganti Mutasi Kas (Revisi ke baris baru, pertahankan tanggal asli & salin metadata lengkap)
  const gantiCashMutation = async (id: string, newMutation: Omit<MutasiKas, 'id' | 'saldo_setelah'>, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan penggantian minimal 5 karakter.');
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const oldRow = cashMutations.find((c) => c.id === id);
      const categoryChanged =
        oldRow != null &&
        (newMutation.kategori_keperluan !== oldRow.kategori_keperluan || newMutation.jenis !== oldRow.jenis);
      const resolvedBeban: BebanBiaya =
        newMutation.beban_biaya ||
        (categoryChanged
          ? deriveBebanBiayaFromCategory(newMutation.jenis, newMutation.kategori_keperluan)
          : oldRow?.beban_biaya || deriveBebanBiayaFromCategory(newMutation.jenis, newMutation.kategori_keperluan));
      const nextIsKasbon =
        newMutation.is_kasbon !== undefined
          ? newMutation.is_kasbon
          : categoryChanged
          ? newMutation.jenis === 'KELUAR' && newMutation.kategori_keperluan === 'Panjar / Kasbon'
          : oldRow?.is_kasbon;
      const nextStatusKasbon: StatusKasbon | undefined =
        newMutation.status_kasbon !== undefined
          ? newMutation.status_kasbon
          : nextIsKasbon
          ? oldRow?.status_kasbon && oldRow.status_kasbon !== 'TIDAK_BERLAKU'
            ? oldRow.status_kasbon
            : 'TERBUKA'
          : 'TIDAK_BERLAKU';

      const mergedData: Omit<MutasiKas, 'id' | 'saldo_setelah'> = {
        ...oldRow,
        ...newMutation,
        tanggal: newMutation.tanggal || oldRow?.tanggal || new Date().toISOString(),
        payment_method: newMutation.payment_method || oldRow?.payment_method || 'TUNAI',
        beban_biaya: resolvedBeban,
        nama_toko: newMutation.nama_toko !== undefined ? newMutation.nama_toko : oldRow?.nama_toko,
        toko_kontak: newMutation.toko_kontak !== undefined ? newMutation.toko_kontak : oldRow?.toko_kontak,
        tanggal_nota: newMutation.tanggal_nota !== undefined ? newMutation.tanggal_nota : oldRow?.tanggal_nota,
        total_nota_fisik:
          newMutation.total_nota_fisik !== undefined ? newMutation.total_nota_fisik : oldRow?.total_nota_fisik,
        lampiran_nota_urls:
          newMutation.lampiran_nota_urls !== undefined
            ? newMutation.lampiran_nota_urls
            : oldRow?.lampiran_nota_urls || [],
        receipt_id: newMutation.receipt_id !== undefined ? newMutation.receipt_id : oldRow?.receipt_id,
        boq_item_id: newMutation.boq_item_id !== undefined ? newMutation.boq_item_id : oldRow?.boq_item_id,
        is_kasbon: nextIsKasbon,
        status_kasbon: nextStatusKasbon,
        kasbon_induk_id:
          newMutation.kasbon_induk_id !== undefined ? newMutation.kasbon_induk_id : oldRow?.kasbon_induk_id,
        nominal_lpj: newMutation.nominal_lpj !== undefined ? newMutation.nominal_lpj : oldRow?.nominal_lpj,
        lpj_kategori_riil:
          newMutation.lpj_kategori_riil !== undefined ? newMutation.lpj_kategori_riil : oldRow?.lpj_kategori_riil,
        source_module: newMutation.source_module || oldRow?.source_module || 'KAS_LANGSUNG',
        source_entity_id:
          newMutation.source_entity_id !== undefined ? newMutation.source_entity_id : oldRow?.source_entity_id,
        source_entity_no:
          newMutation.source_entity_no !== undefined ? newMutation.source_entity_no : oldRow?.source_entity_no,
      };

      const insertPayload = buildCashInsertRow(wsId, prId, mergedData, id);

      const { data: newRow, error: insertErr } = await client
        .from('cash_transactions')
        .insert(insertPayload)
        .select()
        .single();

      if (insertErr) throw insertErr;

      const { error: updateErr } = await client.from('cash_transactions').update({
        is_ganti: true,
        status_dokumen: 'DIGANTI',
        referensi_ganti_id: newRow?.id || null,
        alasan_batal_ganti: `Digantikan oleh baris #${newRow?.id?.slice(0, 8)} oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (updateErr) throw updateErr;

      // Jika baris panjar induk diganti, alihkan tautan kasbon_induk_id baris anak ke ID baris baru
      if (oldRow?.is_kasbon && newRow?.id) {
        await client
          .from('cash_transactions')
          .update({ kasbon_induk_id: newRow.id })
          .eq('kasbon_induk_id', id);
      }

      await refreshData();
      return { success: true, message: 'Transaksi kas berhasil diganti dengan baris revisi baru dan nominal lama dinolkan.' };
    } catch (e: any) {
      return { success: false, message: e.message || 'Penggantian transaksi kas gagal.' };
    }
  };

  // Lengkapi Bukti Kuitansi untuk transaksi BUKTI_MENYUSUL (mengikuti metode GANTI abadi)
  const lengkapiBuktiCashMutation = async (
    targetTx: MutasiKas,
    proof: {
      nomor_kuitansi?: string;
      nama_toko?: string;
      toko_kontak?: string;
      tanggal_nota?: string;
      lampiran_nota_urls: string[];
      receipt_id?: string;
      catatan?: string;
      reason?: string;
    }
  ) => {
    try {
      const targetProj = activeProject || activeContext?.projects[0];
      const prId = targetProj?.id || activeProjectId;
      let receiptId = proof.receipt_id || targetTx.receipt_id;
      const urls = (proof.lampiran_nota_urls || []).filter(Boolean);
      const resolvedNo = proof.nomor_kuitansi?.trim() || targetTx.nomor_kuitansi;

      if (!receiptId && urls.length > 0 && prId) {
        const created = await createProjectReceipt(
          {
            project_id: prId,
            reference_no: resolvedNo || '',
            nama_toko: proof.nama_toko || targetTx.nama_toko || '',
            toko_kontak: proof.toko_kontak || targetTx.toko_kontak,
            tanggal_nota: (proof.tanggal_nota || targetTx.tanggal || new Date().toISOString()).slice(0, 10),
            total_nota_fisik: targetTx.jumlah_rp,
            lampiran_nota_urls: urls,
            notes: proof.catatan || targetTx.untuk_apa,
            receipt_scope: 'KAS_OPERASIONAL',
            created_by: user.id || undefined,
            created_by_name: `${user.name} (${activeRole})`,
          },
          targetTx.pic || user.name
        );
        if (created?.id) receiptId = created.id;
      }

      const hasProof = urls.length > 0 || Boolean(receiptId) || Boolean(resolvedNo);
      const nextStatusBukti: StatusBuktiKas = hasProof
        ? targetTx.source_module === 'MUTASI_BARANG'
          ? 'REKONSILIASI_NOTA'
          : 'TERLAMPIR'
        : 'BUKTI_MENYUSUL';

      return await gantiCashMutation(
        targetTx.id,
        {
          ...targetTx,
          nomor_kuitansi: resolvedNo,
          nama_toko: proof.nama_toko?.trim() || targetTx.nama_toko,
          toko_kontak: proof.toko_kontak?.trim() || targetTx.toko_kontak,
          tanggal_nota: proof.tanggal_nota || targetTx.tanggal_nota || targetTx.tanggal,
          lampiran_nota_urls: urls,
          receipt_id: receiptId,
          status_bukti: nextStatusBukti,
          catatan: proof.catatan?.trim() || targetTx.catatan,
        },
        proof.reason?.trim() || 'Melengkapi bukti kuitansi / nota transaksi kas'
      );
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal melengkapi bukti kuitansi kas.' };
    }
  };

  // Penyelesaian / Pertanggungjawaban (LPJ) Panjar / Kasbon — 3 Skenario Bebas Double-Counting
  const selesaikanKasbonMutation = async (input: KasbonSettlementInput) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk yang dapat mencatat pelunasan LPJ panjar.');
      }
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      // Hitung total pengembalian tunai sebelumnya untuk panjar induk ini agar tidak terjadi double-return
      const computedPreviousReturnedRp =
        input.previousReturnedRp !== undefined
          ? input.previousReturnedRp
          : cashMutations
              .filter(
                (c) =>
                  !isCashRowExcluded(c) &&
                  c.jenis === 'MASUK' &&
                  c.kasbon_induk_id === input.kasbonTx.id
              )
              .reduce((sum, c) => sum + (Number(c.jumlah_rp) || 0), 0);

      const plan = planKasbonSettlement({
        ...input,
        previousReturnedRp: computedPreviousReturnedRp,
      });

      // Jika Kasus 3 (Belanja Riil > Pokok Panjar Efektif -> perlu KELUAR tambahan), pastikan saldo kas mencukupi
      if (plan.followUpTransaction && plan.followUpTransaction.jenis === 'KELUAR') {
        const activeBalance = cashMutations
          .filter((c) => !isCashRowExcluded(c))
          .reduce((s, c) => s + (c.jenis === 'MASUK' ? c.jumlah_rp : -c.jumlah_rp), 0);
        if (plan.followUpTransaction.jumlah_rp > activeBalance) {
          throw new Error(
            `Saldo kas saat ini (Rp ${activeBalance.toLocaleString('id-ID')}) belum mencukupi untuk menutup kekurangan bayar panjar sebesar Rp ${plan.followUpTransaction.jumlah_rp.toLocaleString('id-ID')}. Catat Kas Masuk terlebih dahulu.`
          );
        }
      }

      // Jika ada unggahan foto bukti LPJ baru tanpa receiptId -> buat di project_receipts
      let resolvedReceiptId = input.receiptId;
      const urls = (input.attachmentUrls || []).filter(Boolean);
      const mergedParentUrls = Array.from(
        new Set([...(input.kasbonTx.lampiran_nota_urls || []), ...urls].filter(Boolean))
      );
      if (!resolvedReceiptId && urls.length > 0 && prId) {
        const rc = await createProjectReceipt(
          {
            project_id: prId,
            reference_no: input.receiptNo || `LPJ-${input.kasbonTx.id.slice(0, 6).toUpperCase()}`,
            nama_toko: `LPJ ${input.kasbonTx.pic || 'Lapangan'}`,
            tanggal_nota: (input.settlementDate || new Date().toISOString()).slice(0, 10),
            total_nota_fisik: input.realSpentRp,
            lampiran_nota_urls: urls,
            notes: input.notes || `Bukti LPJ Panjar ${input.kasbonTx.untuk_apa}`,
            receipt_scope: 'KAS_OPERASIONAL',
            created_by: user.id || undefined,
            created_by_name: `${user.name} (${activeRole})`,
          },
          input.kasbonTx.pic || user.name
        );
        if (rc?.id) resolvedReceiptId = rc.id;
      }

      // 1. Perbarui status & alokasi pos biaya riil pada baris panjar induk
      const parentUpdate: Record<string, any> = {
        status_kasbon: plan.updatedParent.status_kasbon,
        nominal_lpj: plan.updatedParent.nominal_lpj,
        lpj_kategori_riil: plan.updatedParent.lpj_kategori_riil,
      };
      if (resolvedReceiptId) parentUpdate.receipt_id = resolvedReceiptId;
      if (mergedParentUrls.length > 0) {
        parentUpdate.lampiran_nota_urls = mergedParentUrls;
        parentUpdate.status_bukti = 'TERLAMPIR';
      }

      const { error: updErr } = await client
        .from('cash_transactions')
        .update(parentUpdate)
        .eq('id', input.kasbonTx.id);
      if (updErr) throw updErr;

      // 2. Jika Kasus 1 (<) atau Kasus 3 (>) atau Bertahap dengan setor sisa, terbitkan baris tindak lanjut (amount > 0!)
      if (plan.followUpTransaction && plan.followUpTransaction.jumlah_rp > 0) {
        const followPayload = buildCashInsertRow(wsId, prId, {
          ...plan.followUpTransaction,
          receipt_id: resolvedReceiptId || plan.followUpTransaction.receipt_id,
          lampiran_nota_urls: urls.length > 0 ? urls : plan.followUpTransaction.lampiran_nota_urls,
        });
        const { error: insErr } = await client.from('cash_transactions').insert(followPayload);
        if (insErr) {
          // Kompensasi bila insert baris tindak lanjut gagal agar induk tidak menggantung di status LUNAS
          await client
            .from('cash_transactions')
            .update({
              status_kasbon: input.kasbonTx.status_kasbon || 'TERBUKA',
              nominal_lpj: input.kasbonTx.nominal_lpj || 0,
              lpj_kategori_riil: input.kasbonTx.lpj_kategori_riil || null,
            })
            .eq('id', input.kasbonTx.id);
          throw insErr;
        }
      }

      await refreshData();
      return { success: true, message: plan.summaryText };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal menyelesaikan LPJ panjar.' };
    }
  };

  // Alur Persetujuan Berjenjang (Berseri) Mutasi Kas — dengan validasi urutan serial ketat
  const advanceCashWorkflow = async (id: string, nextStatus: StatusDokumenWorkflow) => {
    try {
      const client = getSupabaseClient();
      const targetRow = cashMutations.find((c) => c.id === id);
      if (!targetRow) throw new Error('Baris transaksi kas tidak ditemukan.');
      const currentStatus = targetRow.status_dokumen || 'DITERBITKAN';
      const serialErr = validateSerialWorkflowTransition(currentStatus, nextStatus);
      if (serialErr) throw new Error(serialErr);

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
  // MODUL PENGADAAN MATERIAL & SURAT PESANAN PO TOKO (3-WAY MATCHING)
  // ============================================================================
  const saveProjectStore = async (store: Partial<SupplierStore> & { nama_toko: string }) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk (Pelaksana) yang dapat menambah atau memperbarui direktori toko rekanan.');
      }
      const targetProj = activeProject || activeContext?.projects[0];
      const prId = targetProj?.id || activeProjectId;
      const saved = await saveSupplierStore({
        ...store,
        project_id: store.project_id || prId,
      });
      if (!saved) {
        throw new Error('Gagal menyimpan data toko rekanan.');
      }
      await refreshData();
      return { success: true, message: `Toko rekanan "${saved.nama_toko}" berhasil disimpan.`, store: saved };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal menyimpan data toko rekanan.' };
    }
  };

  const createPurchaseOrder = async (input: CreatePurchaseOrderInput) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk (Pelaksana Administrasi) yang berwenang menerbitkan Surat Pesanan (PO) baru.');
      }
      if (!input.nama_toko?.trim()) {
        throw new Error('Nama toko rekanan wajib diisi.');
      }
      const validItems = (input.items || []).filter(
        (it) => it.nama_barang?.trim() && Number(it.qty_pesan) > 0
      );
      if (validItems.length === 0) {
        throw new Error('Tambahkan minimal 1 material dengan kuantitas pesanan lebih dari 0.');
      }

      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId =
        targetProj?.workspace_id ||
        activeWorkspaceId ||
        (activeContext?.workspaces.find((w) => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      let resolvedStoreId = input.store_id || null;
      if (!resolvedStoreId) {
        const savedStore = await saveSupplierStore({
          nama_toko: input.nama_toko.trim(),
          telepon: input.toko_kontak?.trim(),
          syarat_bayar_default: input.payment_terms,
          project_id: prId,
        });
        if (savedStore?.id) resolvedStoreId = savedStore.id;
      }

      const poNo = input.po_no?.trim() || generateNextPoNumber(purchaseOrders, input.tanggal_po);
      const totalAmountRp = Math.round(
        validItems.reduce(
          (sum, it) => sum + Math.max(0, Number(it.qty_pesan) || 0) * Math.max(0, Number(it.harga_satuan_po) || 0),
          0
        )
      );
      const dpAmountRp =
        input.payment_terms === 'DP_PELUNASAN'
          ? Math.min(totalAmountRp, Math.max(0, Math.round(Number(input.dp_amount_rp) || 0)))
          : 0;
      const dueDate =
        input.jatuh_tempo_bayar !== undefined
          ? input.jatuh_tempo_bayar
          : computeDueDateFromTerms(input.tanggal_po, input.payment_terms);

      const { data: insertedPo, error: poErr } = await client
        .from('purchase_orders')
        .insert({
          workspace_id: wsId || null,
          project_id: prId,
          po_no: poNo,
          store_id: resolvedStoreId,
          nama_toko: input.nama_toko.trim(),
          toko_kontak: input.toko_kontak?.trim() || null,
          tanggal_po: input.tanggal_po || new Date().toISOString(),
          estimasi_tiba: input.estimasi_tiba || null,
          payment_terms: input.payment_terms || 'TUNAI_SAAT_TIBA',
          jatuh_tempo_bayar: dueDate || null,
          dp_amount_rp: dpAmountRp,
          total_amount_rp: totalAmountRp,
          catatan_toko: input.catatan_toko?.trim() || null,
          created_by: user.id || null,
          created_by_name: `${user.name} (${activeRole})`,
          status_dokumen: 'DITERBITKAN',
        })
        .select()
        .single();

      if (poErr || !insertedPo) throw poErr || new Error('Gagal membuat header Surat Pesanan.');

      const itemRows = validItems.map((it, idx) => ({
        po_id: insertedPo.id,
        project_id: prId,
        boq_item_id: it.boq_item_id || null,
        nama_barang: it.nama_barang.trim(),
        satuan: it.satuan?.trim() || 'Unit',
        qty_pesan: Number(it.qty_pesan),
        harga_satuan_po: Math.max(0, Number(it.harga_satuan_po) || 0),
        harga_pagu_boq: Math.max(0, Number(it.harga_pagu_boq) || 0),
        subtotal_rp: Math.round(Number(it.qty_pesan) * Math.max(0, Number(it.harga_satuan_po) || 0)),
        catatan: it.catatan?.trim() || null,
        sort_order: idx,
      }));

      const { data: insertedItems, error: itemsErr } = await client
        .from('purchase_order_items')
        .insert(itemRows)
        .select();

      if (itemsErr) throw itemsErr;

      await refreshData();
      const createdPo: PurchaseOrder = {
        ...insertedPo,
        dp_amount_rp: Number(insertedPo.dp_amount_rp) || 0,
        total_amount_rp: Number(insertedPo.total_amount_rp) || 0,
        items: (insertedItems || []).map((pi: any) => ({
          ...pi,
          qty_pesan: Number(pi.qty_pesan) || 0,
          harga_satuan_po: Number(pi.harga_satuan_po) || 0,
          harga_pagu_boq: Number(pi.harga_pagu_boq) || 0,
          subtotal_rp: Number(pi.subtotal_rp) || 0,
        })),
      };
      return {
        success: true,
        message: `Surat Pesanan ${poNo} berhasil diterbitkan dan masuk antrean pengesahan berantai.`,
        po: createdPo,
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal menerbitkan Surat Pesanan (PO).' };
    }
  };

  const advancePurchaseOrderWorkflow = async (
    poId: string,
    nextStatus: StatusDokumenWorkflow,
    customActorRole?: ImpersonateRole
  ) => {
    try {
      const client = getSupabaseClient();
      const targetPo = purchaseOrders.find((p) => p.id === poId);
      if (!targetPo) throw new Error('Surat Pesanan (PO) tidak ditemukan.');
      const serialErr = validateSerialWorkflowTransition(targetPo.status_dokumen, nextStatus);
      if (serialErr) throw new Error(serialErr);

      const effectiveRole = customActorRole || activeRole;
      const effectivePerms = getRolePermissions(effectiveRole);
      const actorTag = `${user.name} (${effectiveRole}) · ${new Date().toLocaleString('id-ID')}`;
      const payload: Record<string, any> = {
        status_dokumen: nextStatus,
        updated_at: new Date().toISOString(),
      };

      if (nextStatus === 'DIPERIKSA') {
        if (!effectivePerms.canCheck) {
          throw new Error('Jabatan Anda tidak memiliki hak untuk Memeriksa PO ini.');
        }
        payload.diperiksa_oleh = actorTag;
      } else if (nextStatus === 'DISETUJUI') {
        if (!effectivePerms.canApprove) {
          throw new Error('Jabatan Anda tidak memiliki hak untuk Menyetujui PO ini.');
        }
        payload.disetujui_oleh = actorTag;
      } else if (nextStatus === 'MENGETAHUI') {
        if (!effectivePerms.canAcknowledge) {
          throw new Error('Jabatan Anda tidak memiliki hak untuk Mengesahkan (TTE/QR) PO ini.');
        }
        payload.mengetahui_oleh = actorTag;
        payload.tte_qr_code = `TTE-PO-${activeCompany.npwp || 'NA'}-${targetPo.po_no}-${Date.now()}`;
      }

      const { error } = await client.from('purchase_orders').update(payload).eq('id', poId);
      if (error) throw error;
      await refreshData();
      return {
        success: true,
        message:
          nextStatus === 'MENGETAHUI'
            ? `Surat Pesanan ${targetPo.po_no} resmi DISAHKAN (TTE/QR) dan siap dikirim ke toko rekanan!`
            : `Status Surat Pesanan ${targetPo.po_no} berhasil dinaikkan menjadi ${nextStatus}.`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal memperbarui status pengesahan PO.' };
    }
  };

  const markPurchaseOrderSent = async (poId: string) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk (Pelaksana) yang dapat menandai PO telah dikirim ke toko.');
      }
      const targetPo = purchaseOrders.find((p) => p.id === poId);
      if (!targetPo) throw new Error('Surat Pesanan tidak ditemukan.');
      if (targetPo.status_dokumen !== 'MENGETAHUI') {
        throw new Error('PO wajib disahkan hingga tahap Mengetahui (TTE/QR) sebelum dikirim ke toko.');
      }
      const client = getSupabaseClient();
      const nowIso = new Date().toISOString();
      const { error } = await client
        .from('purchase_orders')
        .update({ sent_to_store_at: nowIso, updated_at: nowIso })
        .eq('id', poId);
      if (error) throw error;
      await refreshData();
      return {
        success: true,
        message: `Surat Pesanan ${targetPo.po_no} ditandai terkirim ke ${targetPo.nama_toko}.`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal memperbarui status pengiriman PO.' };
    }
  };

  const receivePurchaseOrderItems = async (input: ReceivePurchaseOrderInput) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk (Pelaksana) yang dapat mencatat penerimaan barang PO ke gudang.');
      }
      const targetPo = purchaseOrders.find((p) => p.id === input.poId);
      if (!targetPo) throw new Error('Surat Pesanan (PO) tidak ditemukan.');
      if (targetPo.is_batal || targetPo.is_ganti || targetPo.status_dokumen === 'BATAL' || targetPo.status_dokumen === 'DIGANTI') {
        throw new Error('PO yang dibatalkan atau diganti tidak dapat menerima barang.');
      }
      if (targetPo.status_dokumen !== 'MENGETAHUI') {
        throw new Error('PO harus disahkan (TTE/QR) terlebih dahulu sebelum mencatat penerimaan barang.');
      }

      const receiveProg = computePoReceiveProgress(targetPo, stockMutations);
      const progByItemId = new Map(receiveProg.itemProgress.map((p) => [p.item.id, p]));

      const rowsToReceive = (input.items || []).filter((x) => Number(x.qty_terima) > 0);
      if (rowsToReceive.length === 0) {
        throw new Error('Masukkan kuantitas barang tiba pada minimal 1 material.');
      }

      for (const r of rowsToReceive) {
        const p = progByItemId.get(r.po_item_id);
        if (!p) throw new Error('Item PO tidak dikenali.');
        if (Number(r.qty_terima) > p.qtySisaTerima + 0.0001) {
          throw new Error(
            `Kuantitas diterima untuk "${p.item.nama_barang}" (${r.qty_terima}) melebihi sisa pesanan (${p.qtySisaTerima} ${p.item.satuan}).`
          );
        }
      }

      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId =
        targetProj?.workspace_id ||
        activeWorkspaceId ||
        (activeContext?.workspaces.find((w) => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const totalBatchValueRp = Math.round(
        rowsToReceive.reduce((sum, r) => {
          const p = progByItemId.get(r.po_item_id)!;
          return sum + Number(r.qty_terima) * (Number(p.item.harga_satuan_po) || 0);
        }, 0)
      );

      let receiptId: string | null = null;
      const cleanSj = input.nomor_surat_jalan?.trim() || '';
      const urls = (input.lampiran_nota_urls || []).filter(Boolean);
      if (cleanSj || urls.length > 0) {
        const createdRc = await createProjectReceipt({
          project_id: prId,
          reference_no: cleanSj || `SJ-${targetPo.po_no}`,
          nama_toko: targetPo.nama_toko,
          toko_kontak: targetPo.toko_kontak,
          tanggal_nota: (input.tanggal || new Date().toISOString()).slice(0, 10),
          total_nota_fisik: totalBatchValueRp,
          lampiran_nota_urls: urls,
          notes: `Surat Jalan Penerimaan ${targetPo.po_no}${input.catatan ? ` · ${input.catatan.trim()}` : ''}`,
          receipt_scope: 'BELANJA_BARANG',
          created_by: user.id || undefined,
          created_by_name: `${user.name} (${activeRole})`,
        });
        if (createdRc?.id) receiptId = createdRc.id;
      }

      const insertPayload = rowsToReceive.map((r) => {
        const p = progByItemId.get(r.po_item_id)!;
        const unitPrice = Math.max(0, Number(p.item.harga_satuan_po) || 0);
        return {
          idempotency_key: crypto.randomUUID(),
          workspace_id: wsId,
          project_id: prId,
          item_id: p.item.boq_item_id || null,
          nama_barang: p.item.nama_barang,
          transaction_type: 'MASUK',
          quantity: Number(r.qty_terima),
          uom: p.item.satuan || 'Unit',
          occurred_at: input.tanggal || new Date().toISOString(),
          reference_no: cleanSj || targetPo.po_no,
          counterparty: input.pic_penerima?.trim() || user.name || 'Gudang',
          notes: input.catatan?.trim() || `Penerimaan barang dari ${targetPo.po_no} (${targetPo.nama_toko})`,
          purpose: `Penerimaan ${targetPo.po_no} (${targetPo.nama_toko})`,
          beban_biaya: 'PROYEK_BOQ',
          is_custom_item: !p.item.boq_item_id,
          source_name: targetPo.nama_toko,
          recipient_name: input.pic_penerima?.trim() || user.name || 'Gudang',
          owner_type: 'KONTRAKTOR',
          status_dokumen: 'DITERBITKAN',
          created_by_name: `${user.name} (${activeRole})`,
          harga_satuan_beli: unitPrice,
          status_harga: unitPrice > 0 ? 'TERCATAT' : 'BELUM_DIKETAHUI',
          nama_toko: targetPo.nama_toko,
          toko_kontak: targetPo.toko_kontak || null,
          nomor_nota: cleanSj || targetPo.po_no,
          tanggal_nota: (input.tanggal || new Date().toISOString()).slice(0, 10),
          total_nota_fisik: totalBatchValueRp,
          lampiran_nota_urls: urls,
          receipt_id: receiptId,
          po_id: targetPo.id,
          po_item_id: p.item.id,
        };
      });

      const { error: invErr } = await client.from('inventory_transactions').insert(insertPayload);
      if (invErr) throw invErr;

      if (!targetPo.sent_to_store_at) {
        await client
          .from('purchase_orders')
          .update({ sent_to_store_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', targetPo.id);
      }

      await refreshData();
      return {
        success: true,
        message: `${rowsToReceive.length} jenis material dari ${targetPo.po_no} berhasil masuk gudang dengan harga PO terkunci.`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal mencatat penerimaan barang PO.' };
    }
  };

  const payPurchaseOrder = async (input: PayPurchaseOrderInput) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk (Pelaksana) yang dapat mencatat pembayaran PO dari kas proyek.');
      }
      const targetPo = purchaseOrders.find((p) => p.id === input.poId);
      if (!targetPo) throw new Error('Surat Pesanan (PO) tidak ditemukan.');
      if (targetPo.is_batal || targetPo.is_ganti || targetPo.status_dokumen === 'BATAL' || targetPo.status_dokumen === 'DIGANTI') {
        throw new Error('PO yang dibatalkan atau diganti tidak dapat dibayar.');
      }
      if (targetPo.status_dokumen !== 'MENGETAHUI') {
        throw new Error('PO wajib disahkan (TTE/QR) sebelum melakukan pembayaran.');
      }

      const amount = Math.round(Number(input.jumlah_rp) || 0);
      if (amount <= 0) throw new Error('Nominal pembayaran harus lebih dari Rp 0.');

      const payProg = computePoPaymentProgress(targetPo, cashMutations);
      if (amount > payProg.sisaBayarRp + 1) {
        throw new Error(
          `Nominal bayar melebihi sisa tagihan PO (sisa: Rp ${payProg.sisaBayarRp.toLocaleString('id-ID')}).`
        );
      }
      if (amount > currentCashBalance) {
        throw new Error(
          `Saldo kas proyek saat ini (Rp ${currentCashBalance.toLocaleString('id-ID')}) tidak mencukupi. Catat dana masuk terlebih dahulu.`
        );
      }

      const jenisLabel =
        input.jenis_bayar === 'DP'
          ? 'Pembayaran Uang Muka (DP)'
          : amount >= payProg.sisaBayarRp
            ? 'Pelunasan'
            : 'Pembayaran Sebagian';
      const urls = (input.lampiran_nota_urls || []).filter(Boolean);

      const res = await addCashMutation({
        jenis: 'KELUAR',
        jumlah_rp: amount,
        untuk_apa: `${jenisLabel} ${targetPo.po_no} — ${targetPo.nama_toko}`,
        kategori_keperluan: 'Material',
        beban_biaya: 'PROYEK_BOQ',
        pic: input.pic?.trim() || user.name || 'Clerk',
        nomor_kuitansi: input.nomor_kuitansi?.trim() || targetPo.po_no,
        tanggal: input.tanggal || new Date().toISOString(),
        payment_method: input.payment_method || 'TRANSFER',
        status_bukti: urls.length > 0 ? 'TERLAMPIR' : 'BUKTI_MENYUSUL',
        lampiran_nota_urls: urls,
        nama_toko: targetPo.nama_toko,
        toko_kontak: targetPo.toko_kontak,
        source_module: 'PO_PENGADAAN',
        source_entity_id: targetPo.id,
        source_entity_no: targetPo.po_no,
        catatan: input.catatan?.trim() || `Pembayaran otomatis tertaut ke Surat Pesanan ${targetPo.po_no}`,
      });

      if (!res.success) return res;
      return {
        success: true,
        message: `${jenisLabel} ${targetPo.po_no} sebesar Rp ${amount.toLocaleString('id-ID')} berhasil dicatat ke Mutasi Dana.`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal mencatat pembayaran PO.' };
    }
  };

  const batalPurchaseOrder = async (poId: string, reason: string) => {
    try {
      if (!rolePermissions.canInitiateBatalGanti && !rolePermissions.canInstructBatalGanti) {
        throw new Error('Jabatan Anda tidak memiliki akses untuk membatalkan Surat Pesanan.');
      }
      if (!reason || reason.trim().length < 5) {
        throw new Error('Alasan pembatalan PO minimal 5 karakter.');
      }
      const targetPo = purchaseOrders.find((p) => p.id === poId);
      if (!targetPo) throw new Error('Surat Pesanan tidak ditemukan.');

      const receiveProg = computePoReceiveProgress(targetPo, stockMutations);
      const payProg = computePoPaymentProgress(targetPo, cashMutations);
      if (receiveProg.totalQtyDiterima > 0 || payProg.totalDibayarRp > 0) {
        throw new Error(
          'PO tidak dapat dibatalkan karena sudah memiliki penerimaan barang gudang atau pembayaran kas aktif. Batalkan mutasi terkait terlebih dahulu.'
        );
      }

      const client = getSupabaseClient();
      const { error } = await client
        .from('purchase_orders')
        .update({
          is_batal: true,
          status_dokumen: 'BATAL',
          alasan_batal_ganti: `Dibatalkan oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', poId);

      if (error) throw error;
      await refreshData();
      return {
        success: true,
        message: `Surat Pesanan ${targetPo.po_no} berhasil dibatalkan. Kuota pemesanan BOQ otomatis dikembalikan.`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal membatalkan Surat Pesanan.' };
    }
  };

  const gantiPurchaseOrder = async (
    poId: string,
    newInput: CreatePurchaseOrderInput,
    reason: string
  ) => {
    try {
      if (!rolePermissions.canInitiateBatalGanti && !rolePermissions.canInstructBatalGanti) {
        throw new Error('Jabatan Anda tidak memiliki akses untuk mengganti Surat Pesanan.');
      }
      if (!reason || reason.trim().length < 5) {
        throw new Error('Alasan penggantian PO minimal 5 karakter.');
      }
      const oldPo = purchaseOrders.find((p) => p.id === poId);
      if (!oldPo) throw new Error('Surat Pesanan lama tidak ditemukan.');

      const receiveProg = computePoReceiveProgress(oldPo, stockMutations);
      const payProg = computePoPaymentProgress(oldPo, cashMutations);
      if (receiveProg.totalQtyDiterima > 0 || payProg.totalDibayarRp > 0) {
        throw new Error(
          'PO yang sudah memiliki penerimaan barang atau pembayaran kas tidak dapat diganti langsung. Buat PO susulan baru atau batalkan mutasi terkait terlebih dahulu.'
        );
      }

      const revSuffix = `REV${Math.floor(10 + Math.random() * 89)}`;
      const revPoNo = `${oldPo.po_no}-${revSuffix}`;
      const created = await createPurchaseOrder({ ...newInput, po_no: revPoNo });
      if (!created.success || !created.po) {
        throw new Error(created.message || 'Gagal menerbitkan PO revisi pengganti.');
      }

      const client = getSupabaseClient();
      await client
        .from('purchase_orders')
        .update({ referensi_ganti_id: oldPo.id })
        .eq('id', created.po.id);

      const { error: updErr } = await client
        .from('purchase_orders')
        .update({
          is_ganti: true,
          status_dokumen: 'DIGANTI',
          referensi_ganti_id: created.po.id,
          alasan_batal_ganti: `Digantikan oleh ${revPoNo} oleh ${user.name} (${activeRole}). Alasan: ${reason.trim()}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', oldPo.id);

      if (updErr) throw updErr;
      await refreshData();
      return {
        success: true,
        message: `Surat Pesanan ${oldPo.po_no} ditandai DIGANTI dan revisi baru ${revPoNo} berhasil diterbitkan.`,
      };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal mengganti Surat Pesanan.' };
    }
  };

  // ============================================================================
  // DOKUMEN RESMI & PERSETUJUAN BERANTAI (SERIAL APPROVAL + CHECKSUM SHA-256 ASLI)
  // ============================================================================
  const issueOfficialDocument = async (params: {
    jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'PO_PENGADAAN' | 'INVENTARIS_LENGKAP' | 'GABUNGAN_PROYEK';
    judul: string;
    periode: string;
    ringkasan: string;
    total_nilai_atau_item: string;
    audience_pov?: DocumentAudiencePov;
    extraSnapshot?: Record<string, unknown>;
  }) => {
    try {
      if (!rolePermissions.canIssue) {
        throw new Error('Hanya Clerk (Pelaksana Administrasi) yang memiliki wewenang menerbitkan Dokumen Resmi baru.');
      }
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const prefix =
        params.jenis === 'MUTASI_STOK'
          ? 'BA-STOK'
          : params.jenis === 'MUTASI_KAS'
          ? 'BA-KAS'
          : params.jenis === 'PO_PENGADAAN'
          ? 'BA-PO'
          : params.jenis === 'GABUNGAN_PROYEK'
          ? 'BA-PROYEK'
          : 'BA-INV';
      const docCode = `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const issuedAt = new Date().toISOString();
      const resolvedAudience: DocumentAudiencePov =
        params.audience_pov ||
        (params.jenis === 'MUTASI_KAS' || params.jenis === 'PO_PENGADAAN'
          ? 'KONTRAKTOR'
          : params.jenis === 'MUTASI_STOK'
          ? 'UMUM'
          : 'KONTRAKTOR');

      const snapshotObj: Record<string, unknown> = {
        document_no: docCode,
        jenis: params.jenis,
        judul: params.judul.trim(),
        periode: params.periode,
        ringkasan: params.ringkasan,
        total_nilai_atau_item: params.total_nilai_atau_item,
        audience_pov: resolvedAudience,
        penandatangan: user.name,
        jabatan: activeRole,
        issued_at: issuedAt,
        ...(params.extraSnapshot || {}),
      };

      const shaHash = await computeDeterministicSha256(snapshotObj);

      const activeCashForDoc = cashMutations.filter((c) => !isCashRowExcluded(c));
      const activeCashBalanceForDoc = activeCashForDoc.reduce(
        (sum, c) => sum + (c.jenis === 'MASUK' ? Number(c.jumlah_rp) || 0 : -(Number(c.jumlah_rp) || 0)),
        0
      );

      const resolvedTotalTx =
        typeof params.extraSnapshot?.active_count === 'number'
          ? params.extraSnapshot.active_count
          : typeof params.extraSnapshot?.total_pos_boq === 'number'
          ? params.extraSnapshot.total_pos_boq + (resolvedAudience === 'KONTRAKTOR' ? activeCashForDoc.length : 0)
          : params.jenis === 'MUTASI_KAS'
          ? activeCashForDoc.length
          : params.jenis === 'MUTASI_STOK'
          ? stockMutations.filter((m) => !m.is_batal && !m.is_ganti).length
          : items.length;

      const resolvedAmountSummary =
        typeof params.extraSnapshot?.saldo_akhir === 'number'
          ? params.extraSnapshot.saldo_akhir
          : typeof params.extraSnapshot?.aset_kerja_rp === 'number'
          ? params.extraSnapshot.aset_kerja_rp
          : params.jenis === 'MUTASI_KAS'
          ? activeCashBalanceForDoc
          : 0;

      const { error } = await client.from('documents').insert({
        workspace_id: wsId,
        project_id: prId,
        document_no: docCode,
        document_type: params.jenis,
        title: params.judul.trim(),
        status: 'ISSUED',
        status_dokumen: 'DITERBITKAN',
        audience_pov: resolvedAudience,
        signer_name: user.name,
        signer_role: activeRole,
        signer_email: user.email || null,
        total_transactions: Math.max(0, Math.round(resolvedTotalTx)),
        amount_summary: Number.isFinite(resolvedAmountSummary) ? resolvedAmountSummary : 0,
        content_sha256: shaHash,
        qr_payload: `DOC:${docCode}:${activeCompany.npwp}`,
        snapshot: snapshotObj,
        created_by: user.id || null,
        issued_at: issuedAt
      });

      if (error) throw error;
      await refreshData();
      return { success: true, message: `Dokumen Resmi ${docCode} berhasil diterbitkan oleh Clerk dan siap memasuki alur persetujuan berantai.` };
    } catch (e: any) {
      return { success: false, message: e.message || 'Gagal menerbitkan dokumen resmi.' };
    }
  };

  const advanceDocumentWorkflow = async (
    docDbId: string,
    nextStatus: StatusDokumenWorkflow,
    customActorRole?: ImpersonateRole
  ) => {
    try {
      const client = getSupabaseClient();
      const targetDoc = documents.find((d) => d.db_id === docDbId || d.id === docDbId);
      if (!targetDoc) throw new Error('Dokumen resmi tidak ditemukan pada arsip proyek.');
      const currentStatus = targetDoc.status_dokumen || 'DITERBITKAN';
      const serialErr = validateSerialWorkflowTransition(currentStatus, nextStatus);
      if (serialErr) throw new Error(serialErr);

      const effectiveRole = customActorRole || activeRole;
      const effectivePerms = getRolePermissions(effectiveRole);
      const actorTag = `${user.name} (${effectiveRole}) · ${new Date().toLocaleString('id-ID')}`;
      const payload: any = { status_dokumen: nextStatus };

      if (nextStatus === 'DIPERIKSA') {
        if (!effectivePerms.canCheck) throw new Error('Jabatan Anda tidak memiliki wewenang untuk Memeriksa (Tahap 2) dokumen ini.');
        payload.diperiksa_oleh = actorTag;
      } else if (nextStatus === 'DISETUJUI') {
        if (!effectivePerms.canApprove) throw new Error('Jabatan Anda tidak memiliki wewenang untuk Menyetujui (Tahap 3) dokumen ini.');
        payload.disetujui_oleh = actorTag;
      } else if (nextStatus === 'MENGETAHUI') {
        if (!effectivePerms.canAcknowledge) throw new Error('Jabatan Anda tidak memiliki wewenang untuk Mengesahkan TTE/QR (Tahap 4) dokumen ini.');
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
        throw new Error('Jabatan Pengamat tidak memiliki akses untuk membatalkan dokumen.');
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
      jenis: 'MUTASI_STOK' | 'MUTASI_KAS' | 'PO_PENGADAAN' | 'INVENTARIS_LENGKAP' | 'GABUNGAN_PROYEK';
      judul: string;
      periode: string;
      ringkasan: string;
      total_nilai_atau_item: string;
      audience_pov?: DocumentAudiencePov;
      extraSnapshot?: Record<string, unknown>;
    },
    reason: string
  ) => {
    try {
      if (!rolePermissions.canInitiateBatalGanti && !rolePermissions.canInstructBatalGanti) {
        throw new Error('Jabatan Pengamat tidak memiliki akses untuk mengganti dokumen.');
      }
      if (!reason || reason.trim().length < 5) throw new Error('Alasan penggantian dokumen minimal 5 karakter.');
      const client = getSupabaseClient();
      const targetProj = activeProject || activeContext?.projects[0];
      const wsId = targetProj?.workspace_id || activeWorkspaceId || (activeContext?.workspaces.find(w => w.type === 'COMPANY')?.id as string);
      const prId = targetProj?.id || activeProjectId;

      const prefix =
        newParams.jenis === 'MUTASI_STOK'
          ? 'BA-STOK-REV'
          : newParams.jenis === 'MUTASI_KAS'
          ? 'BA-KAS-REV'
          : newParams.jenis === 'PO_PENGADAAN'
          ? 'BA-PO-REV'
          : newParams.jenis === 'GABUNGAN_PROYEK'
          ? 'BA-PROYEK-REV'
          : 'BA-INV-REV';
      const newDocCode = `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
      const issuedAt = new Date().toISOString();
      const oldDoc = documents.find((d) => d.db_id === docDbId || d.id === docDbId);
      const resolvedAudience: DocumentAudiencePov =
        newParams.audience_pov ||
        oldDoc?.audience_pov ||
        (newParams.jenis === 'MUTASI_KAS' || newParams.jenis === 'PO_PENGADAAN'
          ? 'KONTRAKTOR'
          : newParams.jenis === 'MUTASI_STOK'
          ? 'UMUM'
          : 'KONTRAKTOR');

      const snapshotObj: Record<string, unknown> = {
        document_no: newDocCode,
        jenis: newParams.jenis,
        judul: newParams.judul.trim(),
        periode: newParams.periode,
        ringkasan: newParams.ringkasan,
        total_nilai_atau_item: newParams.total_nilai_atau_item,
        audience_pov: resolvedAudience,
        replaces_document_id: docDbId,
        penandatangan: user.name,
        jabatan: activeRole,
        issued_at: issuedAt,
        ...(newParams.extraSnapshot || {}),
      };
      const shaHash = await computeDeterministicSha256(snapshotObj);

      const activeCashForRev = cashMutations.filter((c) => !isCashRowExcluded(c));
      const activeCashBalanceForRev = activeCashForRev.reduce(
        (sum, c) => sum + (c.jenis === 'MASUK' ? Number(c.jumlah_rp) || 0 : -(Number(c.jumlah_rp) || 0)),
        0
      );

      const resolvedTotalTx =
        newParams.jenis === 'MUTASI_KAS'
          ? activeCashForRev.length
          : newParams.jenis === 'MUTASI_STOK'
          ? stockMutations.filter((m) => !m.is_batal && !m.is_ganti).length
          : items.length;
      const resolvedAmountSummary =
        newParams.jenis === 'MUTASI_KAS' ? activeCashBalanceForRev : 0;

      const { data: insertedDoc, error: insertErr } = await client.from('documents').insert({
        workspace_id: wsId,
        project_id: prId,
        document_no: newDocCode,
        document_type: newParams.jenis,
        title: newParams.judul.trim(),
        status: 'ISSUED',
        status_dokumen: 'DITERBITKAN',
        audience_pov: resolvedAudience,
        signer_name: user.name,
        signer_role: activeRole,
        signer_email: user.email || null,
        total_transactions: Math.max(0, Math.round(resolvedTotalTx)),
        amount_summary: Number.isFinite(resolvedAmountSummary) ? resolvedAmountSummary : 0,
        referensi_ganti_id: docDbId,
        content_sha256: shaHash,
        qr_payload: `DOC:${newDocCode}:${activeCompany.npwp}`,
        snapshot: snapshotObj,
        created_by: user.id || null,
        issued_at: issuedAt
      }).select().single();

      if (insertErr) throw insertErr;

      const { error: updateErr } = await client.from('documents').update({
        is_ganti: true,
        status: 'REVOKED',
        status_dokumen: 'DIGANTI',
        referensi_ganti_id: insertedDoc?.id || null,
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
      localStorage.removeItem(APP_MODE_KEY);
      localStorage.removeItem(ACTIVE_ROLE_KEY);
      setAppModeState('PERSONAL');
      setCurrentView('landing');
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
  const recordedStockCount = stockItems.filter(x => x.has_stock_history).length;
  const unrecordedStockCount = stockItems.length - recordedStockCount;
  // Item yang benar-benar butuh perhatian pengadaan darurat (Kondisi S-4: Habis):
  // HANYA menghitung pos material fisik yang belum tuntas (qty_pemenuhan_sisa > 0.0001),
  // pernah memiliki histori stok masuk/keluar (has_stock_history === true && qty_keluar_total > 0),
  // dan saldo fisiknya saat ini habis (stok_saat_ini <= 0).
  // Pos S-1 yang pekerjaannya belum dimulai DILARANG memicu alarm palsu!
  const outOfStockCount = stockItems.filter(
    x => x.has_stock_history && x.qty_keluar_total > 0 && x.qty_pemenuhan_sisa > 0.0001 && x.stok_saat_ini <= 0
  ).length;
  const lowStockCount = stockItems.filter(
    x => x.has_stock_history && x.qty_pemenuhan_sisa > 0.0001 && x.stok_saat_ini > 0 && x.stok_saat_ini <= x.stok_minimum
  ).length;
  const availableStockCount = stockItems.filter(
    x => x.has_stock_history && (x.stok_saat_ini > x.stok_minimum || x.qty_pemenuhan_sisa <= 0.0001)
  ).length;

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
    projectId: activeProjectId || activeProject?.id || '2506245e-ff3f-4313-b821-920ab368a5df',
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
    // Pengamat/Klien 100% terproteksi dari finansial internal kontraktor (termasuk saat CSA meninjau mode Pengamat)
    if (activeRole === 'Viewer/Pengamat') {
      return false;
    }
    if (activeRole === 'CEO/Direktur') return true;
    const isCsa = activeContext?.workspaces?.some(w => w.type === 'COMPANY' && w.is_company_super_admin);
    if (isCsa) return true;

    const currentProj = activeProject || activeContext?.projects.find(p => p.id === activeProjectId);
    if (currentProj && typeof currentProj.can_view_financials === 'boolean') {
      return currentProj.can_view_financials;
    }

    return true;
  }, [activeRole, activeContext, activeProjectId, activeProject]);

  const cashEvalContext = useMemo(
    () =>
      resolveCashEvalContext(
        activeRole,
        rolePermissions,
        { contractorName: tenantBranding.contractorName, clientName: tenantBranding.clientName },
        canViewFinancials
      ),
    [activeRole, rolePermissions, tenantBranding.contractorName, tenantBranding.clientName, canViewFinancials]
  );

  const cashSummaryMetrics = useMemo(
    () => computeCashSummaryMetrics(cashMutations, stockMutations, projectReceipts, cashEvalContext),
    [cashMutations, stockMutations, projectReceipts, cashEvalContext]
  );

  const procurementSummary = useMemo(
    () =>
      computeProcurementSummaryMetrics(
        purchaseOrders,
        items,
        stockMutations,
        cashMutations,
        activeRole
      ),
    [purchaseOrders, items, stockMutations, cashMutations, activeRole]
  );

  const currentCashBalance = cashSummaryMetrics.saldoSaatIni;
  const cashHasEntries = cashSummaryMetrics.activeCount > 0;
  const cashCriticalAlertCount = cashSummaryMetrics.isCashCritical ? 1 : 0;

  const pendingStockApprovalCount = useMemo(
    () =>
      countPendingStockApprovals(stockMutations, activeRole) +
      countPendingDocumentApprovals(documents, activeRole, 'MUTASI_STOK'),
    [stockMutations, documents, activeRole]
  );

  const pendingCashApprovalCount = useMemo(
    () =>
      activeRole === 'Viewer/Pengamat'
        ? 0
        : countPendingCashApprovals(cashMutations, activeRole) +
          countPendingDocumentApprovals(documents, activeRole, 'MUTASI_KAS'),
    [cashMutations, documents, activeRole]
  );

  const pendingPoApprovalCount = useMemo(
    () =>
      activeRole === 'Viewer/Pengamat'
        ? 0
        : countPendingPoApprovals(purchaseOrders, activeRole) +
          countPendingDocumentApprovals(documents, activeRole, 'PO_PENGADAAN'),
    [purchaseOrders, documents, activeRole]
  );

  const pendingDocumentApprovalCount = useMemo(
    () =>
      activeRole === 'Viewer/Pengamat'
        ? 0
        : countPendingDocumentApprovals(documents, activeRole, 'GABUNGAN_PROYEK'),
    [documents, activeRole]
  );

  const pendingApprovalCount =
    pendingStockApprovalCount +
    pendingCashApprovalCount +
    pendingPoApprovalCount +
    pendingDocumentApprovalCount;

  const cashActionBadgeCount = useMemo(() => {
    if (activeRole === 'Viewer/Pengamat') return 0;
    if (cashCriticalAlertCount > 0) return cashCriticalAlertCount;
    if (pendingCashApprovalCount > 0) return pendingCashApprovalCount;
    return (
      cashSummaryMetrics.unreconciledStockReceiptsCount +
      cashSummaryMetrics.openKasbonCount +
      cashSummaryMetrics.pendingReceiptCount
    );
  }, [activeRole, cashCriticalAlertCount, pendingCashApprovalCount, cashSummaryMetrics]);

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
        purchaseOrders,
        supplierStores,
        documents,
        projectReceipts,
        refreshProjectReceipts,
        saveProjectStore,
        createPurchaseOrder,
        advancePurchaseOrderWorkflow,
        markPurchaseOrderSent,
        receivePurchaseOrderItems,
        payPurchaseOrder,
        batalPurchaseOrder,
        gantiPurchaseOrder,
        user,
        supabaseConfig,
        currentView,
        setCurrentView,
        goBack,
        previousView,
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
        lengkapiBuktiCashMutation,
        selesaikanKasbonMutation,
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
        cashSummaryMetrics,
        procurementSummary,
        cashCriticalAlertCount,
        cashActionBadgeCount,
        pendingStockApprovalCount,
        pendingCashApprovalCount,
        pendingPoApprovalCount,
        pendingDocumentApprovalCount,
        pendingApprovalCount,
        cashTargetTab,
        setCashTargetTab,
        stockTargetTab,
        setStockTargetTab,
        procurementTargetTab,
        setProcurementTargetTab,
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
