import React, { createContext, useContext, useEffect, useState } from 'react';
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
  BebanBiaya
} from '../types';
import {
  getStoredConfig,
  getStoredUser,
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
  addDocument: (doc: DokumenLaporan) => Promise<void>;
  logout: () => Promise<void>;
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
  activeCompany: { id: string; name: string; npwp: string };
  setActiveCompany: (c: { id: string; name: string; npwp: string }) => void;
  rolePermissions: RolePermissions;
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
  const [currentView, setCurrentView] = useState('dashboard');
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

  const [activeCompany, setActiveCompany] = useState<{ id: string; name: string; npwp: string }>({
    id: '',
    name: 'Akun Pribadi',
    npwp: ''
  });

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
    setActiveWorkspaceIdState(id);
    localStorage.setItem('udu_active_workspace', id);
    setActiveProjectIdState('');
    localStorage.removeItem('udu_active_project');
  };

  const setActiveProjectId = (id: string) => {
    setActiveProjectIdState(id);
    localStorage.setItem('udu_active_project', id);
  };

  const refreshActiveContext = async () => {
    try {
      const next = await resolveMyActiveContext();
      setActiveContext(next);

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
            name: companyWs.name || 'CV. MENARA MEGAH',
            npwp: (companyWs as any).company_npwp || (companyWs as any).npwp || '0024376584714000'
          });
        } else {
          setActiveCompany({
            id: '',
            name: 'Akun Pribadi',
            npwp: ''
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

    // Ambil workspace aktif atau fallback ke company workspace pertama
    let targetWorkspaceId = activeWorkspaceId;
    if (!targetWorkspaceId && next.workspaces.length > 0) {
      const comp = next.workspaces.find(w => w.type === 'COMPANY') || next.workspaces[0];
      targetWorkspaceId = comp.id;
      setActiveWorkspaceIdState(targetWorkspaceId);
    }

    let selectedProject = next.projects.find(p => p.id === activeProjectId && p.workspace_id === targetWorkspaceId);
    if (!selectedProject && next.projects.length > 0) {
      selectedProject = next.projects.find(p => p.workspace_id === targetWorkspaceId) || next.projects[0];
      if (selectedProject) {
        setActiveProjectIdState(selectedProject.id);
      }
    }

    // Isolasi E2E: Jika Akun Personal, PSA, atau tidak memiliki penugasan proyek yang sah,
    // data rahasia operasional tenant (BOQ, mutasi kas, stok) TIDAK dimuat.
    if (appMode === 'PERSONAL' || appMode === 'PSA' || next.projects.length === 0 || !selectedProject) {
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
    const [boqRes, sectionsRes, stockRes, cashRes, docsRes, reversalsRes] = await Promise.all([
      client.from('boq_items').select('*').eq('project_id', selectedProject.id).eq('is_active', true).order('source_row'),
      client.from('boq_sections').select('*').eq('project_id', selectedProject.id).eq('is_active', true).order('sort_order'),
      client.from('inventory_transactions').select('*').eq('project_id', selectedProject.id).order('occurred_at', { ascending: true }).order('created_at', { ascending: true }),
      client.from('cash_transactions').select('*').eq('project_id', selectedProject.id).order('occurred_at', { ascending: true }).order('created_at', { ascending: true }),
      client.from('documents').select('*').eq('project_id', selectedProject.id).in('document_type', ['MUTASI_KAS', 'MUTASI_STOK']).order('created_at', { ascending: false }),
      client.from('inventory_transaction_reversals').select('original_transaction_id')
    ]);

    const reversedIds = new Set((reversalsRes.data || []).map((r: any) => r.original_transaction_id));

    // 1. Indeks Material Fisik dari data mentah boq_items
    const rawBoq = boqRes.data || [];
    const itemToKey = new Map<string, string>();
    const itemById = new Map<string, any>();
    rawBoq.forEach((b: any) => {
      itemById.set(b.id, b);
      const key = `${(b.description || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${(b.uom || '').trim().toLowerCase()}`;
      itemToKey.set(b.id, key);
    });

    // 2. Lacak Saldo Fisik Gudang & Serapan Terperinci Pos BOQ
    const physicalBalance = new Map<string, number>();
    const physicalReceived = new Map<string, number>();
    const physicalConsumed = new Map<string, number>();
    const boqItemConsumed = new Map<string, number>();
    const stockHistory = new Set<string>();

    const stockRows: MutasiBarang[] = (stockRes.data || []).map((t: any) => {
      const targetItem = itemById.get(t.item_id);
      const key = targetItem
        ? itemToKey.get(t.item_id)!
        : `${(t.nama_barang || '').trim().toLowerCase().replace(/\s+/g, ' ')}|${(t.uom || '').trim().toLowerCase()}`;
      
      const beforePhysical = physicalBalance.get(key) || 0;
      const incoming = ['MASUK', 'PENYESUAIAN_MASUK'].includes(t.transaction_type);
      const isVoid = t.is_batal || reversedIds.has(t.id);
      const delta = isVoid ? 0 : incoming ? Number(t.quantity) : -Number(t.quantity);
      const afterPhysical = beforePhysical + delta;

      if (!isVoid) {
        physicalBalance.set(key, afterPhysical);
        if (incoming) {
          physicalReceived.set(key, (physicalReceived.get(key) || 0) + Number(t.quantity));
        } else {
          physicalConsumed.set(key, (physicalConsumed.get(key) || 0) + Number(t.quantity));
          boqItemConsumed.set(t.item_id, (boqItemConsumed.get(t.item_id) || 0) + Number(t.quantity));
        }
        stockHistory.add(t.item_id);
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
        alasan_batal_ganti: t.alasan_batal_ganti || undefined
      };
    });

    // 3. Petakan Item BOQ Terperinci
    const mappedItems: ItemBarang[] = rawBoq.map((b: any) => {
      const baseTarget = Number(b.quantity) || 0;
      const key = itemToKey.get(b.id)!;
      const physicalStock = physicalBalance.get(key) || 0;
      const masukFisik = physicalReceived.get(key) || 0;
      const terpakaiDiPosIni = boqItemConsumed.get(b.id) || 0;
      const sisaTargetPos = Math.max(baseTarget - terpakaiDiPosIni, 0);
      const progress = baseTarget > 0 ? (terpakaiDiPosIni / baseTarget) * 100 : 0;
      const statusPemenuhan: ItemBarang['status_pemenuhan'] =
        terpakaiDiPosIni > baseTarget ? 'Melebihi BOQ' : terpakaiDiPosIni >= baseTarget && baseTarget > 0 ? 'Terpenuhi' : terpakaiDiPosIni > 0 ? 'Dalam pemenuhan' : 'Belum dipenuhi';

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
        has_stock_history: stockHistory.has(b.id) || physicalBalance.has(key),
        qty_masuk_total: masukFisik,
        qty_keluar_total: terpakaiDiPosIni,
        qty_pemenuhan_sisa: sisaTargetPos,
        progress_pemenuhan: progress,
        status_pemenuhan: statusPemenuhan,
        satuan: b.uom || 'Unit',
        harga_satuan: Number(b.unit_rate || 0),
        stok_saat_ini: physicalStock,
        stok_minimum: 0,
        status: computeItemStatus(physicalStock, 0, stockHistory.has(b.id) || physicalBalance.has(key)),
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
      return {
        id: g.id,
        nama_barang: g.nama_barang,
        satuan: g.satuan,
        stok_fisik: physicalBalance.get(key) || 0,
        total_qty_boq: g.total_qty_boq,
        total_qty_masuk: physicalReceived.get(key) || 0,
        total_qty_keluar: physicalConsumed.get(key) || 0,
        is_stock_item: g.is_stock_item,
        budget_lines: g.budget_lines
      };
    });

    setPhysicalMaterials(calculatedPhysicalMaterials);

    const nameById = new Map(mappedItems.map(x => [x.id, x.nama_barang]));
    stockRows.forEach(x => {
      x.nama_barang = nameById.get(x.barang_id) || 'Item BOQ';
    });

    let cashBalance = 0;
    const cashRows: MutasiKas[] = (cashRes.data || []).map((t: any) => {
      const incoming = t.transaction_type === 'MASUK';
      const isVoid = Boolean(t.is_batal);
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
        alasan_batal_ganti: t.alasan_batal_ganti || undefined
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

    setItems(mappedItems);
    setBoqSections(sectionRows);
    setStockMutations(stockRows.reverse());
    setCashMutations(cashRows.reverse());
    setCashAccess(true);
    setDocuments([]);
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
  }, [user.id, activeProjectId, activeWorkspaceId]);

  // Transaksi Baru Mutasi Barang (Diterbitkan oleh Clerk)
  const addStockMutation = async (data: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>) => {
    try {
      const client = getSupabaseClient();
      const wsId = activeWorkspaceId || (activeContext?.workspaces[0]?.id as string);
      const prId = activeProjectId || (activeContext?.projects[0]?.id as string);

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
        created_by_name: `${user.name} (${activeRole})`
      });

      if (error) throw error;
      await refreshData();
      return { success: true, message: 'Mutasi inventaris berhasil diterbitkan dan siap diverifikasi secara berjenjang.' };
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

  // Ganti Mutasi Barang (Tautkan ke dokumen revisi baru, data lama dinolkan)
  const gantiStockMutation = async (id: string, newMutation: Omit<MutasiBarang, 'id' | 'stok_sebelum' | 'stok_sesudah'>, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan penggantian minimal 5 karakter.');
      const client = getSupabaseClient();
      const wsId = activeWorkspaceId || (activeContext?.workspaces[0]?.id as string);
      const prId = activeProjectId || (activeContext?.projects[0]?.id as string);

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
        created_by_name: `${user.name} (${activeRole})`
      }).select().single();

      if (insertErr) throw insertErr;

      // 2. Tandai mutasi lama sebagai DIGANTI
      const { error: updateErr } = await client.from('inventory_transactions').update({
        is_ganti: true,
        status_dokumen: 'DIGANTI',
        alasan_batal_ganti: `Digantikan oleh dokumen #${newRow?.id?.slice(0, 8)}. Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (updateErr) throw updateErr;
      await refreshData();
      return { success: true, message: 'Dokumen mutasi berhasil diganti. Dokumen baru telah diterbitkan dengan rujukan riwayat yang lengkap.' };
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
      const wsId = activeWorkspaceId || (activeContext?.workspaces[0]?.id as string);
      const prId = activeProjectId || (activeContext?.projects[0]?.id as string);

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
      return { success: true, message: 'Transaksi kas berhasil dicatat dan siap diverifikasi secara berjenjang.' };
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

  // Ganti Mutasi Kas (Revisi ke dokumen baru, rujukan tercatat)
  const gantiCashMutation = async (id: string, newMutation: Omit<MutasiKas, 'id' | 'saldo_setelah'>, reason: string) => {
    try {
      if (!reason || reason.trim().length < 5) throw new Error('Alasan penggantian minimal 5 karakter.');
      const client = getSupabaseClient();
      const wsId = activeWorkspaceId || (activeContext?.workspaces[0]?.id as string);
      const prId = activeProjectId || (activeContext?.projects[0]?.id as string);

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
        alasan_batal_ganti: `Digantikan oleh dokumen #${newRow?.id?.slice(0, 8)}. Alasan: ${reason.trim()}`
      }).eq('id', id);

      if (updateErr) throw updateErr;
      await refreshData();
      return { success: true, message: 'Transaksi kas berhasil diganti dengan dokumen revisi baru.' };
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

  const stockItems = items.filter(x => x.is_stock_item);
  const totalStockAssetValue = stockItems.reduce((s, x) => s + x.stok_saat_ini * x.harga_satuan, 0);
  const currentCashBalance = cashMutations[0]?.saldo_setelah ?? 0;
  const cashHasEntries = cashMutations.length > 0;
  const recordedStockCount = stockItems.filter(x => x.has_stock_history).length;
  const unrecordedStockCount = stockItems.length - recordedStockCount;
  const outOfStockCount = stockItems.filter(x => x.has_stock_history && x.stok_saat_ini <= 0).length;
  const lowStockCount = stockItems.filter(x => x.stok_saat_ini > 0 && x.stok_saat_ini <= x.stok_minimum).length;
  const availableStockCount = stockItems.filter(x => x.has_stock_history && x.stok_saat_ini > x.stok_minimum).length;

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
        addDocument,
        logout,
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
        rolePermissions
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
