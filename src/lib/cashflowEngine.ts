import {
  BebanBiaya,
  CashInCategory,
  CashOutCategory,
  DokumenLaporan,
  ImpersonateRole,
  ItemBarang,
  KategoriMutasiKas,
  MetodePembayaran,
  MutasiBarang,
  MutasiKas,
  ProjectModuleCode,
  ProjectReceipt,
  PurchaseOrder,
  StatusBuktiKas,
  StatusDokumenWorkflow,
  StatusKasbon,
} from '../types';
import { PartyPOV, PendingApprovalAction, RoleAuthority } from './boqExecutionEngine';
import { getTodayLocalDate, isClientProvidedRemark } from './stockMutationEngine';

export const CASH_IN_CATEGORIES: readonly CashInCategory[] = [
  'Dana Termin Proyek',
  'Modal Kerja Kontraktor',
  'Pengembalian Panjar',
  'Penggantian Talangan Klien',
  'Penerimaan Lainnya',
] as const;

export const CASH_OUT_CATEGORIES: readonly CashOutCategory[] = [
  'Material',
  'Upah & Konsumsi',
  'Sewa Alat & Angkut',
  'Operasional',
  'Panjar / Kasbon',
  'Talangan Klien',
  'Bonus Klien',
  'Lainnya',
] as const;

export const PAYMENT_METHOD_LABELS: Record<MetodePembayaran, string> = {
  TUNAI: 'Tunai',
  TRANSFER: 'Transfer Bank',
  GIRO_CEK: 'Giro / Cek',
  DOMPET_DIGITAL: 'Dompet Digital',
};

export const STATUS_BUKTI_LABELS: Record<StatusBuktiKas, string> = {
  TERLAMPIR: 'Bukti Lengkap',
  BUKTI_MENYUSUL: 'Bukti Menyusul',
  TANPA_BUKTI: 'Tanpa Bukti',
  REKONSILIASI_NOTA: 'Nota Gudang Terpadu',
};

export const BEBAN_BIAYA_LABELS: Record<BebanBiaya, string> = {
  PROYEK_BOQ: 'Proyek BOQ',
  OPERASIONAL: 'Operasional',
  KLIEN: 'Tagihan Klien',
  BONUS_KLIEN: 'Bonus Klien',
  KONTRAKTOR: 'Internal Kontraktor',
};

export const SOURCE_MODULE_LABELS: Record<ProjectModuleCode, string> = {
  KAS_LANGSUNG: 'Mutasi Dana Langsung',
  MUTASI_BARANG: 'Nota Mutasi Barang',
  PO_PENGADAAN: 'Pengadaan & PO Toko',
  UPAH_MANDOR: 'Upah Mandor & Tukang',
  TERMIN_BAP: 'Penagihan Termin & BAP',
  SUBKON_ALAT: 'Subkontraktor & Sewa Alat',
};

export interface CashEvalContext {
  activeRole: ImpersonateRole;
  partyPov: PartyPOV;
  authority: RoleAuthority;
  canIssue: boolean;
  canCorrect: boolean;
  canViewFinancials: boolean;
  contractorName: string;
  clientName: string;
}

export type CashBalanceHealthCode = 'K-1' | 'K-2' | 'K-3' | 'K-4';
export type CashBalanceHealthKey = 'BELUM_ADA_KAS' | 'SEHAT' | 'MENIPIS' | 'SALDO_HABIS';
export type CashRowStateCode = 'T-1' | 'T-2' | 'T-3' | 'T-4' | 'T-5' | 'T-6' | 'T-7';
export type BudgetCategoryStateCode = 'A-1' | 'A-2' | 'A-3' | 'A-4';

export type CashActionType =
  | 'MASUK'
  | 'BAYAR'
  | 'TERIMA_TALANGAN'
  | 'UNGGAH_BUKTI'
  | 'LUNASI_PANJAR'
  | 'APPROVE'
  | 'KOREKSI'
  | 'LIHAT_PENGGANTI'
  | 'RIWAYAT';

export type CashActionVariant =
  | 'emerald'
  | 'rose'
  | 'blue'
  | 'indigo'
  | 'sky'
  | 'amber'
  | 'teal'
  | 'slate'
  | 'neutral';

export interface CashSummaryMetrics {
  activeCount: number;
  excludedCount: number;
  totalMasukAktif: number;
  totalKeluarAktif: number;
  saldoSaatIni: number;
  ambangWaspada: number;
  healthCode: CashBalanceHealthCode;
  healthKey: CashBalanceHealthKey;
  healthLabel: string;
  healthBadgeClass: string;
  isCashCritical: boolean; // HANYA true pada K-4 (pernah ada kas & saldo <= 0)
  totalMasukTermin: number;
  totalMasukModal: number;
  totalMasukPengembalian: number;
  totalKeluarMaterial: number;
  totalKeluarUpah: number;
  totalKeluarAlat: number;
  totalKeluarOperasional: number;
  totalKeluarPanjarTerbuka: number;
  totalKeluarBonusKlien: number;
  totalPiutangTalanganKlien: number;
  pendingReceiptCount: number;
  openKasbonCount: number;
  unreconciledStockReceiptsCount: number;
  pendingWorkflowCount: number;
}

export interface BudgetCategoryEvaluation {
  categoryKey: CashOutCategory;
  label: string;
  description: string;
  paguAcuanRp: number;
  realisasiKasRp: number;
  sisaPaguRp: number;
  serapanPct: number;
  txCount: number;
  stateCode: BudgetCategoryStateCode;
  statusLabel: 'Belum Keluar' | 'Aman' | 'Waspada' | 'Lebih';
  statusBadgeClass: string;
  actionType: 'BAYAR' | 'ISI_KAS' | 'RIWAYAT';
  actionLabel: string;
  actionVariant: CashActionVariant;
  actionTooltip: string;
  showSecondaryHistoryIcon: boolean;
}

export interface CashRowEvaluation {
  stateCode: CashRowStateCode;
  isExcluded: boolean;
  statusLabel: string;
  statusBadgeClass: string;
  buktiLabel: string;
  buktiBadgeClass: string;
  actionType: CashActionType;
  actionLabel: string;
  actionVariant: CashActionVariant;
  actionTooltip: string;
  showSecondaryHistoryIcon: boolean;
  pendingApprovalAction: PendingApprovalAction | null;
  nextWorkflowTarget: 'DIPERIKSA' | 'DISETUJUI' | 'MENGETAHUI' | null;
}

export interface UnreconciledStockReceiptItem {
  key: string;
  receiptId?: string;
  receiptNo: string;
  storeName: string;
  storeContact?: string;
  receiptDate: string;
  totalAmountRp: number;
  attachmentUrls: string[];
  itemSummary: string;
  itemCount: number;
  isTalangan: boolean;
}

export interface OpenKasbonItem {
  kasbonTx: MutasiKas;
  picName: string;
  nominalAwalRp: number;
  nominalLpjRp: number;
  nominalKembaliRp: number;
  nominalLpjDanKembaliRp: number;
  sisaTerbukaRp: number;
  statusKasbon: StatusKasbon;
}

export interface ClientAdvanceReceivableSummary {
  totalTalanganRp: number;
  totalDigantiRp: number;
  sisaPiutangRp: number;
  transactions: MutasiKas[];
}

export type CashWizardStepId =
  | 'PURPOSE_AMOUNT'
  | 'PARTY_EVIDENCE'
  | 'REVIEW'
  | 'DONE_NEXT';

export interface CashWizardAnswers {
  jenis: 'MASUK' | 'KELUAR';
  kategori_keperluan: KategoriMutasiKas;
  beban_biaya: BebanBiaya;
  untuk_apa: string;
  boq_item_id?: string;
  receipt_id?: string;
  linked_stock_receipt?: UnreconciledStockReceiptItem | null;
  kasbon_induk_id?: string;
  source_module: ProjectModuleCode;
  source_entity_id?: string;
  source_entity_no?: string;
  jumlah_rp: number;
  tanggal: string; // YYYY-MM-DD lokal
  payment_method: MetodePembayaran;
  pic: string;
  nama_toko: string;
  toko_kontak: string;
  nomor_kuitansi: string;
  status_bukti: StatusBuktiKas;
  lampiran_nota_urls: string[];
  catatan: string;
}

export interface KasbonSettlementInput {
  kasbonTx: MutasiKas;
  realSpentRp: number; // Total belanja riil sesuai kuitansi pada pelunasan ini
  lpjCategory: CashOutCategory;
  isPartial?: boolean; // true jika mandor masih memegang sisa panjar
  returnedCashRp?: number; // khusus isPartial jika mandor menyetor sebagian sisa tunai sekarang
  previousReturnedRp?: number; // total pengembalian tunai (MASUK) yang sudah tercatat sebelumnya untuk panjar ini
  settlementDate: string; // ISO string
  paymentMethod?: MetodePembayaran;
  notes?: string;
  receiptId?: string;
  receiptNo?: string;
  attachmentUrls?: string[];
}

export interface KasbonSettlementPlan {
  scenario: 'BELANJA_KURANG' | 'BELANJA_PAS' | 'BELANJA_LEBIH' | 'BERTAHAP';
  updatedParent: {
    status_kasbon: StatusKasbon;
    nominal_lpj: number;
    lpj_kategori_riil: CashOutCategory;
    status_bukti?: StatusBuktiKas;
    receipt_id?: string;
    lampiran_nota_urls?: string[];
  };
  followUpTransaction: Omit<MutasiKas, 'id' | 'saldo_setelah'> | null;
  netCashImpactTotalRp: number; // total pengeluaran kas bersih terhadap proyek
  returnAmountRp: number;
  topUpAmountRp: number;
  remainingOpenRp: number;
  summaryText: string;
}

/**
 * Rumus tunggal pengecualian baris kas (BATAL atau DIGANTI)
 */
export function isCashRowExcluded(c: Partial<MutasiKas> | null | undefined): boolean {
  if (!c) return true;
  return Boolean(
    c.is_batal ||
    c.is_ganti ||
    c.status_dokumen === 'BATAL' ||
    c.status_dokumen === 'DIGANTI'
  );
}

/**
 * Auto-derivasi beban biaya di latar belakang sesuai Aturan 2 AGENTS.md
 */
export function deriveBebanBiayaFromCategory(
  jenis: 'MASUK' | 'KELUAR',
  kategori: KategoriMutasiKas | string
): BebanBiaya {
  if (jenis === 'MASUK') {
    if (kategori === 'Penggantian Talangan Klien') return 'KLIEN';
    return 'KONTRAKTOR';
  }
  switch (kategori) {
    case 'Material':
    case 'Upah & Konsumsi':
      return 'PROYEK_BOQ';
    case 'Sewa Alat & Angkut':
    case 'Operasional':
      return 'OPERASIONAL';
    case 'Talangan Klien':
      return 'KLIEN';
    case 'Bonus Klien':
      return 'BONUS_KLIEN';
    case 'Panjar / Kasbon':
    case 'Lainnya':
    default:
      return 'KONTRAKTOR';
  }
}

/**
 * Hitung saldo berjalan kronologis (occurred_at ASC, created_at ASC).
 * Baris BATAL/DIGANTI mengembalikan null dan tidak menggeser akumulator.
 */
export function computeRunningCashBalances(cashMutations: MutasiKas[]): Map<string, number | null> {
  const result = new Map<string, number | null>();
  if (!cashMutations || cashMutations.length === 0) return result;

  const sortedAsc = [...cashMutations].sort((a, b) => {
    const tA = new Date(a.tanggal || 0).getTime();
    const tB = new Date(b.tanggal || 0).getTime();
    if (tA !== tB) return tA - tB;

    const cA = a.created_at ? new Date(a.created_at).getTime() : 0;
    const cB = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (cA !== cB) return cA - cB;

    return (a.id || '').localeCompare(b.id || '');
  });

  let running = 0;
  for (const tx of sortedAsc) {
    if (isCashRowExcluded(tx)) {
      result.set(tx.id, null);
      continue;
    }
    const amt = Number(tx.jumlah_rp) || 0;
    running += tx.jenis === 'MASUK' ? amt : -amt;
    result.set(tx.id, running);
  }

  return result;
}

/**
 * Resolusi konteks 3 sumbu Multi-POV khusus Mutasi Dana.
 * Viewer/Pengamat terkunci 100% canViewFinancials = false.
 */
export function resolveCashEvalContext(
  activeRole: ImpersonateRole,
  permissions: { canIssue: boolean; canInitiateBatalGanti: boolean; canInstructBatalGanti: boolean },
  branding: { contractorName?: string; clientName?: string },
  canViewFinancialsFlag: boolean
): CashEvalContext {
  const contractorName = branding.contractorName?.trim() || 'Kontraktor';
  const clientName = branding.clientName?.trim() || 'Klien';

  if (activeRole === 'Viewer/Pengamat') {
    return {
      activeRole,
      partyPov: 'KLIEN',
      authority: 'PENGAMAT_KLIEN',
      canIssue: false,
      canCorrect: false,
      canViewFinancials: false,
      contractorName,
      clientName,
    };
  }

  const authority: RoleAuthority = activeRole === 'Clerk' ? 'EKSEKUTOR' : 'PENGAWAS_INTERNAL';
  const canIssue = authority === 'EKSEKUTOR' && Boolean(permissions.canIssue);
  const canCorrect = Boolean(permissions.canInitiateBatalGanti || permissions.canInstructBatalGanti);

  return {
    activeRole,
    partyPov: 'KONTRAKTOR',
    authority,
    canIssue,
    canCorrect,
    canViewFinancials: Boolean(canViewFinancialsFlag),
    contractorName,
    clientName,
  };
}

/**
 * Cek apakah sebuah dokumen / baris sedang menunggu giliran persetujuan peran aktif (eksekusi serial)
 */
export function getPendingApprovalForRole(
  statusDokumen: StatusDokumenWorkflow | undefined,
  activeRole: ImpersonateRole
): { action: PendingApprovalAction; nextTarget: 'DIPERIKSA' | 'DISETUJUI' | 'MENGETAHUI' } | null {
  const wf = statusDokumen || 'DITERBITKAN';
  if (wf === 'BATAL' || wf === 'DIGANTI' || wf === 'MENGETAHUI') return null;

  if (activeRole === 'Foreman' && wf === 'DITERBITKAN') {
    return { action: 'PERIKSA', nextTarget: 'DIPERIKSA' };
  }
  if (activeRole === 'Spv.' && wf === 'DIPERIKSA') {
    return { action: 'SETUJU', nextTarget: 'DISETUJUI' };
  }
  if (
    (activeRole === 'Dept. Manager' ||
      activeRole === 'KTT/Proj. Manager' ||
      activeRole === 'CEO/Direktur') &&
    wf === 'DISETUJUI'
  ) {
    return { action: 'SAHKAN', nextTarget: 'MENGETAHUI' };
  }
  return null;
}

export function countPendingCashApprovals(
  cashMutations: MutasiKas[],
  activeRole: ImpersonateRole
): number {
  return (cashMutations || []).filter((tx) => {
    if (isCashRowExcluded(tx)) return false;
    return getPendingApprovalForRole(tx.status_dokumen, activeRole) !== null;
  }).length;
}

export function countPendingStockApprovals(
  stockMutations: MutasiBarang[],
  activeRole: ImpersonateRole
): number {
  return (stockMutations || []).filter((m) => {
    if (m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') {
      return false;
    }
    return getPendingApprovalForRole(m.status_dokumen, activeRole) !== null;
  }).length;
}

export function countPendingDocumentApprovals(
  documents: DokumenLaporan[],
  activeRole: ImpersonateRole,
  jenisFilter?: DokumenLaporan['jenis']
): number {
  return (documents || []).filter((doc) => {
    if (jenisFilter && doc.jenis !== jenisFilter) return false;
    if (doc.is_batal || doc.is_ganti || doc.status_dokumen === 'BATAL' || doc.status_dokumen === 'DIGANTI') {
      return false;
    }
    return getPendingApprovalForRole(doc.status_dokumen, activeRole) !== null;
  }).length;
}

/**
 * Tentukan tab tujuan cerdas saat pengawas mengklik lonceng antrean Mutasi Barang:
 * - Jika ada baris mutasi stok menunggu persetujuan -> 'MUTATION_HISTORY'
 * - Jika seluruh antrean berasal dari Dokumen Resmi MUTASI_STOK -> 'OFFICIAL_DOCUMENTS'
 */
export function resolveStockApprovalTargetTab(
  stockMutations: MutasiBarang[],
  documents: DokumenLaporan[],
  activeRole: ImpersonateRole
): 'MUTATION_HISTORY' | 'OFFICIAL_DOCUMENTS' {
  const pendingRows = countPendingStockApprovals(stockMutations, activeRole);
  if (pendingRows > 0) return 'MUTATION_HISTORY';
  const pendingDocs = countPendingDocumentApprovals(documents, activeRole, 'MUTASI_STOK');
  if (pendingDocs > 0) return 'OFFICIAL_DOCUMENTS';
  return 'MUTATION_HISTORY';
}

export interface TerpaduReceiptIndex {
  paidReceiptIds: Set<string>;
  paidRefsByNo: Map<string, Array<{ storeNorm: string; receiptId?: string }>>;
  paidPoIds: Set<string>;
  paidPoAmountById: Map<string, number>;
  fullyPaidPoIds?: Set<string>;
}

export function normalizeReceiptRef(raw?: string | null): string {
  const cleaned = (raw || '').trim().toLowerCase();
  if (
    !cleaned ||
    cleaned === '-' ||
    cleaned === 'null' ||
    cleaned === 'undefined' ||
    cleaned === 'tanpa no. seri'
  ) {
    return '';
  }
  return cleaned;
}

export function normalizeReceiptStoreName(raw?: string | null): string {
  const rawLower = (raw || '').trim().toLowerCase();
  if (
    !rawLower ||
    rawLower === '-' ||
    rawLower === 'null' ||
    rawLower === 'undefined' ||
    rawLower === 'toko / suplier' ||
    rawLower === 'toko / suplier belanja' ||
    rawLower === 'toko / pihak lawan' ||
    rawLower === 'lainnya / toko bebas' ||
    rawLower === 'kas lapangan' ||
    rawLower.endsWith('/ kas lapangan') ||
    rawLower.startsWith('belum dipastikan') ||
    rawLower.startsWith('pengadaan kontraktor')
  ) {
    return '';
  }
  const withoutWrapper = rawLower
    .replace(/^(lainnya|toko\s+bebas)\s*:\s*/i, '')
    .trim();
  const cleaned = withoutWrapper
    .replace(/[.,:/\-()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    !cleaned ||
    cleaned === '-' ||
    cleaned === 'null' ||
    cleaned === 'undefined' ||
    cleaned === 'toko suplier' ||
    cleaned === 'toko suplier belanja' ||
    cleaned === 'toko pihak lawan' ||
    cleaned === 'lainnya toko bebas' ||
    cleaned === 'kas lapangan'
  ) {
    return '';
  }
  return cleaned;
}

function canonicalStoreCore(normStore: string): string {
  if (!normStore) return '';
  let core = normStore;
  const prefixPattern = /^(toko\s+bangunan|tb|toko|ud|cv|pt|pd|warung|depot|kios)\s+/i;
  while (prefixPattern.test(core)) {
    const next = core.replace(prefixPattern, '').trim();
    if (!next) break;
    core = next;
  }
  return core;
}

/**
 * Perbandingan nama toko lintas modul (Mutasi Barang <-> Mutasi Dana <-> Album Nota).
 * - Jika kedua sisi menyebut toko, inti nama toko (tanpa prefiks TB/Toko/CV/PT/UD) wajib sama persis,
 *   sehingga "TB. Sinar A" cocok dengan "TB Sinar A" tetapi TIDAK tabrakan dengan "TB Sinar Abadi" atau "TB Abadi".
 * - Jika satu sisi menyebut toko dan sisi lain kosong, TIDAK cocok agar kas tanpa toko tidak mencemari nota toko mana pun.
 * - Jika kedua sisi sama-sama kosong (data legacy tanpa toko), fallback nomor nota diizinkan.
 */
export function doReceiptStoresMatch(
  storeA?: string | null,
  storeB?: string | null
): boolean {
  const a = normalizeReceiptStoreName(storeA);
  const b = normalizeReceiptStoreName(storeB);
  if (!a && !b) return true;
  if (!a || !b) return false;
  return canonicalStoreCore(a) === canonicalStoreCore(b);
}

function isClientSupplierName(rawSource?: string | null, clientName?: string): boolean {
  const raw = (rawSource || '').trim();
  if (!raw) return false;
  const lower = raw.toLowerCase();
  if (lower.startsWith('pengadaan kontraktor')) return false;

  if (
    lower.includes('by klien') ||
    lower.includes('by client') ||
    lower.includes('by owner') ||
    lower.includes('free-issue') ||
    lower.includes('free issue') ||
    lower.includes('jatah klien') ||
    lower.includes('disediakan klien') ||
    lower.includes('pasokan klien') ||
    lower.includes('dari klien') ||
    lower.includes('milik klien') ||
    lower.includes('owner supply') ||
    /\bimk\b/.test(lower) ||
    /\bklien\b/.test(lower) ||
    /\bclient\b/.test(lower) ||
    /\bpemilik\b/.test(lower)
  ) {
    return true;
  }

  if (!clientName || !clientName.trim()) return false;
  const stopWords = new Set(['pt', 'cv', 'tbk', 'persero', 'ltd', 'inc', 'co', 'dan', 'the']);
  const clientTokens = clientName
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !stopWords.has(t));

  if (clientTokens.length === 0) return false;

  const sourceNorm = lower.replace(/[^a-z0-9\s]+/g, ' ').replace(/\s+/g, ' ').trim();
  const sourceWords = new Set(sourceNorm.split(/\s+/).filter(Boolean));
  const corePhrase = clientTokens.join(' ');

  if (corePhrase.length >= 3 && sourceNorm.includes(corePhrase)) {
    return true;
  }

  if (clientTokens.length >= 2) {
    // Memerlukan minimal 2 token khas nama klien agar nama toko seperti "TB Indo Makmur"
    // tidak keliru dianggap pasokan "PT INDO MURO KENCANA".
    const matchedTokens = clientTokens.filter((t) => sourceWords.has(t));
    return matchedTokens.length >= 2;
  }

  // Nama klien 1 kata: cocokkan kata utuh & pastikan bukan entri toko bebas
  const isHardwareStorePrefix = /^(lainnya\s*:|tb\.?\s+|toko\s+|ud\.?\s+|cv\.?\s+)/i.test(raw);
  return !isHardwareStorePrefix && sourceWords.has(clientTokens[0]);
}

function isEligibleForStorelessStockFallback(c: Partial<MutasiKas>): boolean {
  return (
    c.source_module === 'MUTASI_BARANG' ||
    c.kategori_keperluan === 'Material' ||
    c.kategori_keperluan === 'Talangan Klien'
  );
}

/**
 * Cek apakah mutasi barang merupakan Jatah Klien (IMK / KLIEN / Free-Issue).
 * Mutasi Jatah Klien tidak pernah menjadi tagihan kas Kontraktor maupun berstatus ✓ Terbayar Kas.
 */
export function isClientSuppliedStockMutation(
  mut: Partial<MutasiBarang> | null | undefined,
  clientName?: string
): boolean {
  if (!mut) return false;
  if (
    mut.owner_type === 'KLIEN' ||
    mut.owner_type === 'IMK' ||
    mut.status_harga === 'JATAH_KLIEN' ||
    mut.asal_barang === 'KLIEN'
  ) {
    return true;
  }
  return isClientSupplierName(mut.source_name, clientName);
}

/**
 * Bangun indeks nota terbayar berbasis receipt_id dan pasangan (nomor nota + nama toko)
 * untuk mencegah tabrakan nomor nota sama antar toko berbeda.
 */
export function buildTerpaduReceiptIndex(
  projectReceipts: ProjectReceipt[],
  cashMutations: MutasiKas[],
  purchaseOrders?: PurchaseOrder[]
): TerpaduReceiptIndex {
  const paidReceiptIds = new Set<string>();
  const paidRefsByNo = new Map<string, Array<{ storeNorm: string; receiptId?: string }>>();
  const paidPoIds = new Set<string>();
  const paidPoAmountById = new Map<string, number>();
  let fullyPaidPoIds: Set<string> | undefined = undefined;

  const addRefEntry = (
    rawRef: string | undefined,
    rawStore: string | undefined,
    receiptId?: string
  ) => {
    const refNo = normalizeReceiptRef(rawRef);
    if (!refNo) return;
    const storeNorm = normalizeReceiptStoreName(rawStore);
    const list = paidRefsByNo.get(refNo) || [];
    const exists = list.some(
      (item) => item.storeNorm === storeNorm && item.receiptId === receiptId
    );
    if (!exists) {
      list.push({ storeNorm, receiptId });
      paidRefsByNo.set(refNo, list);
    }
  };

  for (const pr of projectReceipts || []) {
    if (
      pr.is_batal ||
      pr.is_ganti ||
      pr.status_verifikasi === 'BATAL' ||
      pr.status_verifikasi === 'DIGANTI'
    ) {
      continue;
    }
    if (pr.receipt_scope === 'TERPADU') {
      paidReceiptIds.add(pr.id);
      addRefEntry(pr.reference_no, pr.nama_toko, pr.id);
    }
  }

  for (const c of cashMutations || []) {
    if (isCashRowExcluded(c) || c.jenis !== 'KELUAR') continue;
    if (c.source_module === 'PO_PENGADAAN' && c.source_entity_id) {
      const amt = Math.max(0, Number(c.jumlah_rp) || 0);
      if (amt > 0) {
        paidPoIds.add(c.source_entity_id);
        paidPoAmountById.set(
          c.source_entity_id,
          (paidPoAmountById.get(c.source_entity_id) || 0) + amt
        );
      }
    }
    const linkedReceiptId =
      c.receipt_id || (c.source_module === 'MUTASI_BARANG' ? c.source_entity_id : undefined);
    if (linkedReceiptId) {
      paidReceiptIds.add(linkedReceiptId);
    }
    const storeNorm = normalizeReceiptStoreName(c.nama_toko);
    if (storeNorm || isEligibleForStorelessStockFallback(c)) {
      addRefEntry(
        c.nomor_kuitansi || c.nomor_nota || c.source_entity_no,
        c.nama_toko,
        linkedReceiptId
      );
    }
  }

  if (purchaseOrders && purchaseOrders.length > 0) {
    fullyPaidPoIds = new Set<string>();
    for (const po of purchaseOrders) {
      if (po.is_batal || po.is_ganti || po.status_dokumen === 'BATAL' || po.status_dokumen === 'DIGANTI') continue;
      const totalPoRp =
        Number(po.total_amount_rp) ||
        (po.items || []).reduce(
          (acc: number, it: any) =>
            acc + (Number(it.qty_pesan || it.qty || 0) * Number(it.harga_satuan_po || it.harga_satuan || 0)),
          0
        );
      const paidPoRp = paidPoAmountById.get(po.id) || 0;
      if (totalPoRp > 0 && paidPoRp >= totalPoRp) {
        fullyPaidPoIds.add(po.id);
      }
    }
  }

  return { paidReceiptIds, paidRefsByNo, paidPoIds, paidPoAmountById, fullyPaidPoIds };
}

function isReceiptPaidInIndex(
  receiptId: string | undefined,
  rawReceiptNo: string | undefined,
  rawStoreName: string | undefined,
  index: TerpaduReceiptIndex
): boolean {
  if (receiptId && index.paidReceiptIds.has(receiptId)) {
    return true;
  }
  const refNo = normalizeReceiptRef(rawReceiptNo);
  if (!refNo) return false;
  const entries = index.paidRefsByNo.get(refNo);
  if (!entries || entries.length === 0) return false;
  return entries.some((entry) => {
    // Jangan pernah mencocokkan dua entitas project_receipts yang ID-nya berbeda
    if (receiptId && entry.receiptId && receiptId !== entry.receiptId) {
      return false;
    }
    return doReceiptStoresMatch(rawStoreName, entry.storeNorm);
  });
}

/**
 * Tentukan apakah sebuah mutasi barang MASUK layak mendapat lencana ✓ Terbayar Kas.
 * Mengecualikan baris non-MASUK, BATAL/DIGANTI, Jatah Klien (IMK/KLIEN), dan toko berbeda.
 */
export function isStockMutationPaidViaCash(
  mut: MutasiBarang | null | undefined,
  index: TerpaduReceiptIndex,
  clientName?: string
): boolean {
  if (!mut || mut.jenis !== 'MASUK') return false;
  if (
    mut.is_batal ||
    mut.is_ganti ||
    mut.status_dokumen === 'BATAL' ||
    mut.status_dokumen === 'DIGANTI'
  ) {
    return false;
  }
  if (isClientSuppliedStockMutation(mut, clientName)) return false;

  if (mut.po_id) {
    if (index.fullyPaidPoIds !== undefined) {
      return index.fullyPaidPoIds.has(mut.po_id);
    }
    return index.paidPoIds.has(mut.po_id);
  }

  return isReceiptPaidInIndex(
    mut.receipt_id,
    mut.nomor_nota || mut.nomor_surat_jalan,
    mut.nama_toko || mut.source_name,
    index
  );
}

/**
 * Cari seluruh transaksi kas KELUAR aktif yang sah tertaut pada sebuah mutasi barang MASUK.
 * Mencegah tabrakan nomor nota lintas toko dan mengecualikan mutasi Jatah Klien.
 */
export function findLinkedCashMutationsForStockMutation(
  mut: MutasiBarang | null | undefined,
  cashMutations: MutasiKas[],
  clientName?: string
): MutasiKas[] {
  if (!mut || mut.jenis !== 'MASUK') return [];
  if (isClientSuppliedStockMutation(mut, clientName)) return [];

  const mutRef = normalizeReceiptRef(mut.nomor_nota || mut.nomor_surat_jalan);
  const mutStore = mut.nama_toko || mut.source_name;
  const mutStoreNorm = normalizeReceiptStoreName(mutStore);

  return (cashMutations || []).filter((c) => {
    if (isCashRowExcluded(c) || c.jenis !== 'KELUAR') return false;

    if (mut.po_id && c.source_module === 'PO_PENGADAAN' && c.source_entity_id === mut.po_id) {
      return true;
    }

    const cashReceiptId =
      c.receipt_id || (c.source_module === 'MUTASI_BARANG' ? c.source_entity_id : undefined);

    if (mut.receipt_id && cashReceiptId) {
      return mut.receipt_id === cashReceiptId;
    }

    if (!mutRef) return false;
    const cashRef = normalizeReceiptRef(c.nomor_kuitansi || c.nomor_nota || c.source_entity_no);
    if (!cashRef || cashRef !== mutRef) return false;

    const cashStoreNorm = normalizeReceiptStoreName(c.nama_toko);
    if (!mutStoreNorm && !cashStoreNorm && !isEligibleForStorelessStockFallback(c)) {
      return false;
    }

    return doReceiptStoresMatch(mutStore, c.nama_toko);
  });
}

/**
 * Cari seluruh baris mutasi barang aktif lain yang berada pada nota toko yang sama
 * (berbasis receipt_id atau pasangan nomor nota + toko, bebas tabrakan lintas toko/jenis/kepemilikan).
 */
export function findRelatedStockMutationsForReceipt(
  primary: MutasiBarang | null | undefined,
  stockMutations: MutasiBarang[],
  clientName?: string
): MutasiBarang[] {
  if (!primary) return [];

  const primaryRef = normalizeReceiptRef(primary.nomor_nota || primary.nomor_surat_jalan);
  const primaryStore = primary.nama_toko || primary.source_name;
  const primaryIsClient = isClientSuppliedStockMutation(primary, clientName);

  const related = (stockMutations || []).filter((m) => {
    if (
      m.is_batal ||
      m.is_ganti ||
      m.status_dokumen === 'BATAL' ||
      m.status_dokumen === 'DIGANTI'
    ) {
      return false;
    }
    if (m.jenis !== primary.jenis) return false;
    if (primary.receipt_id && m.receipt_id) {
      return m.receipt_id === primary.receipt_id;
    }
    if (!primaryRef) {
      return m.id === primary.id;
    }
    const mRef = normalizeReceiptRef(m.nomor_nota || m.nomor_surat_jalan);
    if (!mRef || mRef !== primaryRef) return false;
    if (isClientSuppliedStockMutation(m, clientName) !== primaryIsClient) {
      return false;
    }
    return doReceiptStoresMatch(primaryStore, m.nama_toko || m.source_name);
  });

  return related.length > 0 ? related : [primary];
}

/**
 * Validasi transisi serial dokumen/transaksi (Mencegah lompat tahap atau mundur)
 */
export function validateSerialWorkflowTransition(
  currentStatus: StatusDokumenWorkflow | undefined,
  nextStatus: StatusDokumenWorkflow
): string | null {
  const wf = currentStatus || 'DITERBITKAN';
  if (wf === 'BATAL' || wf === 'DIGANTI') {
    return 'Dokumen atau transaksi yang sudah BATAL/DIGANTI tidak dapat diproses persetujuannya.';
  }
  if (nextStatus !== 'DIPERIKSA' && nextStatus !== 'DISETUJUI' && nextStatus !== 'MENGETAHUI') {
    return `Status tujuan persetujuan tidak valid: ${nextStatus}.`;
  }
  if (nextStatus === 'DIPERIKSA' && wf !== 'DITERBITKAN') {
    return 'Tahap Pemeriksaan hanya dapat dilakukan pada status DITERBITKAN.';
  }
  if (nextStatus === 'DISETUJUI' && wf !== 'DIPERIKSA') {
    return 'Alur persetujuan berantai: wajib Diperiksa terlebih dahulu oleh Foreman sebelum Disetujui.';
  }
  if (nextStatus === 'MENGETAHUI' && wf !== 'DISETUJUI') {
    return 'Alur persetujuan berantai: wajib Disetujui terlebih dahulu oleh Spv. sebelum disahkan (TTE/QR).';
  }
  return null;
}

/**
 * Cari antrean nota belanja gudang (Kontraktor) yang belum dibayar lewat Mutasi Dana.
 * Mengecualikan barang Jatah Klien (IMK/KLIEN Rp 0), transaksi BATAL/DIGANTI, serta nota yang sudah terbayar kas.
 */
export function findUnreconciledStockReceipts(
  stockMutations: MutasiBarang[],
  projectReceipts: ProjectReceipt[],
  cashMutations: MutasiKas[],
  clientName?: string
): UnreconciledStockReceiptItem[] {
  const paymentIndex = buildTerpaduReceiptIndex(projectReceipts, cashMutations);

  // Lacak receipt_id yang pernah tertaut pada mutasi stok agar nota yang seluruh mutasinya BATAL/Jatah Klien tidak muncul sebagai utang
  const stockLinkedReceiptIds = new Set<string>();
  for (const m of stockMutations || []) {
    if (m.jenis === 'MASUK' && m.receipt_id) {
      stockLinkedReceiptIds.add(m.receipt_id);
    }
  }

  const activeStockIn = (stockMutations || []).filter((m) => {
    if (m.jenis !== 'MASUK') return false;
    if (m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') {
      return false;
    }
    // Kecualikan Jatah Klien (baik 'KLIEN' maupun 'IMK' dari skema DB)
    if (isClientSuppliedStockMutation(m, clientName)) return false;

    const unitPrice = Number(m.harga_satuan_beli || 0);
    const physTotal = Number(m.total_nota_fisik || 0);
    return unitPrice > 0 || physTotal > 0;
  });

  const activeStockLinkedReceiptIds = new Set<string>();
  const receivedValueByPoId = new Map<string, number>();
  const poIdsByReceiptId = new Map<string, Set<string>>();

  for (const m of activeStockIn) {
    if (m.receipt_id) activeStockLinkedReceiptIds.add(m.receipt_id);
    if (m.po_id) {
      const val = (Number(m.harga_satuan_beli) || 0) * (Number(m.jumlah) || 0);
      receivedValueByPoId.set(m.po_id, (receivedValueByPoId.get(m.po_id) || 0) + val);
      if (m.receipt_id) {
        const set = poIdsByReceiptId.get(m.receipt_id) || new Set<string>();
        set.add(m.po_id);
        poIdsByReceiptId.set(m.receipt_id, set);
      }
    }
  }

  // PO dianggap sudah tertutup pembayarannya lewat modul PO_PENGADAAN bila total bayar kas PO >= nilai barang diterima
  const isPoReceiptCoveredByPoPayment = (poId: string | undefined): boolean => {
    if (!poId) return false;
    const paidRp = paymentIndex.paidPoAmountById.get(poId) || 0;
    if (paidRp <= 0) return false;
    const receivedRp = receivedValueByPoId.get(poId) || 0;
    return receivedRp <= 0 || paidRp >= receivedRp;
  };

  // Kelompokkan berdasarkan receipt_id resmi terlebih dahulu, lalu nomor nota + toko
  const receiptById = new Map<string, ProjectReceipt>();
  for (const rc of projectReceipts || []) {
    if (rc.is_batal || rc.is_ganti || rc.status_verifikasi === 'BATAL' || rc.status_verifikasi === 'DIGANTI') {
      continue;
    }
    receiptById.set(rc.id, rc);
  }

  type GroupAcc = {
    key: string;
    receiptId?: string;
    receiptNo: string;
    storeName: string;
    storeContact?: string;
    receiptDate: string;
    explicitTotalRp: number;
    computedItemsTotalRp: number;
    attachmentUrls: string[];
    itemNames: string[];
    itemCount: number;
    isTalangan: boolean;
  };

  const groups = new Map<string, GroupAcc>();

  // 1. Masukkan nota resmi project_receipts berscope BELANJA_BARANG yang punya nominal > 0
  for (const rc of receiptById.values()) {
    const scope = rc.receipt_scope || 'BELANJA_BARANG';
    if (scope === 'KAS_OPERASIONAL' || scope === 'TERPADU') continue;
    // Jika nota ini tertaut pada mutasi stok tapi semuanya BATAL/DIGANTI/JATAH_KLIEN -> kecualikan
    if (stockLinkedReceiptIds.has(rc.id) && !activeStockLinkedReceiptIds.has(rc.id)) continue;

    if (isReceiptPaidInIndex(rc.id, rc.reference_no, rc.nama_toko, paymentIndex)) {
      continue;
    }
    const linkedPos = poIdsByReceiptId.get(rc.id);
    if (linkedPos && linkedPos.size > 0 && Array.from(linkedPos).every((pid) => isPoReceiptCoveredByPoPayment(pid))) {
      continue;
    }

    const totalPhys = Number(rc.total_nota_fisik || 0);
    groups.set(rc.id, {
      key: rc.id,
      receiptId: rc.id,
      receiptNo: rc.reference_no || 'Tanpa No. Seri',
      storeName: rc.nama_toko || 'Toko / Suplier',
      storeContact: rc.toko_kontak,
      receiptDate: rc.tanggal_nota || rc.created_at || new Date().toISOString(),
      explicitTotalRp: totalPhys,
      computedItemsTotalRp: 0,
      attachmentUrls: Array.isArray(rc.lampiran_nota_urls) ? rc.lampiran_nota_urls.filter(Boolean) : [],
      itemNames: [],
      itemCount: 0,
      isTalangan: false,
    });
  }

  // 2. Gabungkan mutasi masuk gudang yang berbiaya Kontraktor
  for (const m of activeStockIn) {
    if (m.receipt_id) {
      const linkedRc = receiptById.get(m.receipt_id);
      if (linkedRc && (linkedRc.receipt_scope === 'TERPADU' || linkedRc.receipt_scope === 'KAS_OPERASIONAL')) {
        continue;
      }
    }

    const rNoRaw = (m.nomor_nota || m.nomor_surat_jalan || '').trim();
    const sNameRaw = (m.nama_toko || m.source_name || 'Toko / Suplier').trim();
    const rNoNorm = normalizeReceiptRef(rNoRaw);
    const sNameNorm = normalizeReceiptStoreName(m.nama_toko || m.source_name) || sNameRaw.toLowerCase();

    if (isReceiptPaidInIndex(m.receipt_id, rNoRaw, m.nama_toko || m.source_name, paymentIndex)) {
      continue;
    }
    if (isPoReceiptCoveredByPoPayment(m.po_id)) {
      continue;
    }

    let groupKey: string | undefined = m.receipt_id && groups.has(m.receipt_id) ? m.receipt_id : undefined;

    if (!groupKey && rNoNorm) {
      for (const [k, g] of groups.entries()) {
        if (m.receipt_id && g.receiptId && m.receipt_id !== g.receiptId) {
          continue;
        }
        if (
          normalizeReceiptRef(g.receiptNo) === rNoNorm &&
          doReceiptStoresMatch(g.storeName, m.nama_toko || m.source_name)
        ) {
          groupKey = k;
          break;
        }
      }
    }

    if (!groupKey) {
      groupKey = m.receipt_id
        ? m.receipt_id
        : rNoNorm
        ? `nota:${rNoNorm}|${sNameNorm}`
        : `tx:${m.id}`;
    }

    const lineValue = (Number(m.harga_satuan_beli) || 0) * (Number(m.jumlah) || 0);
    const isTalangan =
      m.beban_biaya === 'KLIEN' ||
      (m.tujuan_keperluan || '').toLowerCase().includes('talangan');

    if (!groups.has(groupKey)) {
      groups.set(groupKey, {
        key: groupKey,
        receiptId: m.receipt_id,
        receiptNo: rNoRaw && rNoRaw !== '-' ? rNoRaw : `INV-${m.id.slice(0, 6).toUpperCase()}`,
        storeName: sNameRaw,
        storeContact: m.toko_kontak,
        receiptDate: m.tanggal_nota || m.tanggal,
        explicitTotalRp: Number(m.total_nota_fisik || 0),
        computedItemsTotalRp: lineValue,
        attachmentUrls: Array.isArray(m.lampiran_nota_urls) ? m.lampiran_nota_urls.filter(Boolean) : [],
        itemNames: m.nama_barang ? [m.nama_barang] : [],
        itemCount: 1,
        isTalangan,
      });
    } else {
      const g = groups.get(groupKey)!;
      g.computedItemsTotalRp += lineValue;
      g.itemCount += 1;
      if (m.nama_barang && !g.itemNames.includes(m.nama_barang)) {
        g.itemNames.push(m.nama_barang);
      }
      if (Number(m.total_nota_fisik || 0) > g.explicitTotalRp) {
        g.explicitTotalRp = Number(m.total_nota_fisik || 0);
      }
      if (Array.isArray(m.lampiran_nota_urls)) {
        for (const u of m.lampiran_nota_urls) {
          if (u && !g.attachmentUrls.includes(u)) g.attachmentUrls.push(u);
        }
      }
      if (isTalangan) g.isTalangan = true;
    }
  }

  const results: UnreconciledStockReceiptItem[] = [];
  for (const g of groups.values()) {
    const totalAmountRp = g.explicitTotalRp > 0 ? g.explicitTotalRp : Math.round(g.computedItemsTotalRp);
    if (totalAmountRp <= 0) continue;

    const previewItems = g.itemNames.slice(0, 3).join(', ');
    const moreCount = g.itemNames.length > 3 ? ` (+${g.itemNames.length - 3} lainnya)` : '';

    results.push({
      key: g.key,
      receiptId: g.receiptId,
      receiptNo: g.receiptNo,
      storeName: g.storeName,
      storeContact: g.storeContact,
      receiptDate: g.receiptDate,
      totalAmountRp,
      attachmentUrls: g.attachmentUrls,
      itemSummary: previewItems ? `${previewItems}${moreCount}` : 'Pembelian Material Gudang',
      itemCount: Math.max(1, g.itemCount),
      isTalangan: g.isTalangan,
    });
  }

  return results.sort((a, b) => new Date(b.receiptDate).getTime() - new Date(a.receiptDate).getTime());
}

/**
 * Ringkas seluruh Panjar / Kasbon Lapangan beserta nilai LPJ, pengembalian, dan sisa terbuka.
 */
export function summarizeOpenKasbon(cashMutations: MutasiKas[]): OpenKasbonItem[] {
  const active = (cashMutations || []).filter((c) => !isCashRowExcluded(c));

  // Hitung total pengembalian tunai (MASUK) yang tertaut ke masing-masing kasbon_induk_id
  const returnedByParent = new Map<string, number>();
  for (const tx of active) {
    if (tx.jenis === 'MASUK' && tx.kasbon_induk_id) {
      returnedByParent.set(
        tx.kasbon_induk_id,
        (returnedByParent.get(tx.kasbon_induk_id) || 0) + (Number(tx.jumlah_rp) || 0)
      );
    }
  }

  const kasbonRows = active.filter(
    (c) =>
      c.jenis === 'KELUAR' &&
      (c.is_kasbon === true || c.kategori_keperluan === 'Panjar / Kasbon')
  );

  return kasbonRows
    .map((tx) => {
      const nominalAwalRp = Number(tx.jumlah_rp) || 0;
      const nominalLpjRp = Math.max(0, Number(tx.nominal_lpj) || 0);
      const nominalKembaliRp = returnedByParent.get(tx.id) || 0;
      const nominalLpjDanKembaliRp = Math.min(nominalAwalRp, nominalLpjRp + nominalKembaliRp);
      const sisaTerbukaRp =
        tx.status_kasbon === 'LUNAS' ? 0 : Math.max(0, nominalAwalRp - nominalLpjRp - nominalKembaliRp);

      let statusKasbon: StatusKasbon = tx.status_kasbon || 'TERBUKA';
      if (statusKasbon === 'TIDAK_BERLAKU') {
        statusKasbon = sisaTerbukaRp <= 0 ? 'LUNAS' : 'TERBUKA';
      }

      return {
        kasbonTx: tx,
        picName: tx.pic || '-',
        nominalAwalRp,
        nominalLpjRp,
        nominalKembaliRp,
        nominalLpjDanKembaliRp,
        sisaTerbukaRp,
        statusKasbon,
      };
    })
    .sort((a, b) => {
      // Urutkan yang masih terbuka/sebagian di atas
      const rank = (s: StatusKasbon) => (s === 'TERBUKA' ? 0 : s === 'SEBAGIAN' ? 1 : 2);
      const diff = rank(a.statusKasbon) - rank(b.statusKasbon);
      if (diff !== 0) return diff;
      return new Date(b.kasbonTx.tanggal).getTime() - new Date(a.kasbonTx.tanggal).getTime();
    });
}

/**
 * Rencanakan penyelesaian LPJ Panjar/Kasbon (3 Skenario Matematis + Bertahap)
 * Bebas double-counting dan patuh terhadap CHECK (amount > 0).
 */
export function planKasbonSettlement(input: KasbonSettlementInput): KasbonSettlementPlan {
  const {
    kasbonTx,
    realSpentRp,
    lpjCategory,
    isPartial = false,
    returnedCashRp = 0,
    previousReturnedRp = 0,
    settlementDate,
    paymentMethod = 'TUNAI',
    notes,
    receiptId,
    receiptNo,
    attachmentUrls = [],
  } = input;

  const nominalAwal = Number(kasbonTx.jumlah_rp) || 0;
  const previousLpj = Math.max(0, Number(kasbonTx.nominal_lpj) || 0);
  const prevReturned = Math.max(0, Math.round(Number(previousReturnedRp) || 0));
  const effectivePrincipal = Math.max(0, nominalAwal - prevReturned);
  const spentNow = Math.max(0, Math.round(Number(realSpentRp) || 0));
  const cumulativeLpj = previousLpj + spentNow;
  const picName = kasbonTx.pic || 'Penanggung Jawab';
  const mergedUrls = Array.from(
    new Set([...(kasbonTx.lampiran_nota_urls || []), ...(attachmentUrls || [])].filter(Boolean))
  );
  const baseProofFields = {
    ...(receiptId ? { receipt_id: receiptId } : {}),
    ...(mergedUrls.length > 0 ? { lampiran_nota_urls: mergedUrls, status_bukti: 'TERLAMPIR' as StatusBuktiKas } : {}),
  };

  // Mode Pelunasan Bertahap (SEBAGIAN) — memperhitungkan pengembalian tunai sebelumnya (prevReturned)
  const retNow = Math.max(0, Math.round(Number(returnedCashRp) || 0));
  if (isPartial && cumulativeLpj + retNow < effectivePrincipal) {
    const remainingOpenRp = Math.max(0, effectivePrincipal - cumulativeLpj - retNow);

    const followUp: Omit<MutasiKas, 'id' | 'saldo_setelah'> | null =
      retNow > 0
        ? {
            jenis: 'MASUK',
            jumlah_rp: retNow,
            untuk_apa: `Pengembalian Sebagian Sisa Panjar (${kasbonTx.untuk_apa})`,
            kategori_keperluan: 'Pengembalian Panjar',
            beban_biaya: 'KONTRAKTOR',
            pic: picName,
            nomor_kuitansi: receiptNo || undefined,
            tanggal: settlementDate,
            payment_method: paymentMethod,
            status_bukti: attachmentUrls.length > 0 ? 'TERLAMPIR' : 'TANPA_BUKTI',
            lampiran_nota_urls: attachmentUrls,
            receipt_id: receiptId,
            kasbon_induk_id: kasbonTx.id,
            source_module: 'KAS_LANGSUNG',
            catatan: notes?.trim() || `Setoran sebagian sisa panjar #${kasbonTx.id.slice(0, 8)}`,
          }
        : null;

    return {
      scenario: 'BERTAHAP',
      updatedParent: {
        status_kasbon: 'SEBAGIAN',
        nominal_lpj: cumulativeLpj,
        lpj_kategori_riil: lpjCategory,
        ...baseProofFields,
      },
      followUpTransaction: followUp,
      netCashImpactTotalRp: Math.max(0, effectivePrincipal - retNow),
      returnAmountRp: retNow,
      topUpAmountRp: 0,
      remainingOpenRp,
      summaryText: `LPJ bertahap Rp ${spentNow.toLocaleString('id-ID')} dicatat ke pos ${lpjCategory}.${retNow > 0 ? ` Setoran sisa Rp ${retNow.toLocaleString('id-ID')} dicatat sebagai Kas Masuk.` : ''} Sisa panjar terbuka Rp ${remainingOpenRp.toLocaleString('id-ID')}.`,
    };
  }

  // Kasus 1: Belanja Riil Kumulatif < Pokok Efektif (Panjar - Pengembalian Sebelumnya) → Terbitkan 1 baris MASUK Pengembalian Panjar sebesar sisa
  if (cumulativeLpj < effectivePrincipal) {
    const returnAmountRp = effectivePrincipal - cumulativeLpj;
    return {
      scenario: 'BELANJA_KURANG',
      updatedParent: {
        status_kasbon: 'LUNAS',
        nominal_lpj: cumulativeLpj,
        lpj_kategori_riil: lpjCategory,
        ...baseProofFields,
      },
      followUpTransaction: {
        jenis: 'MASUK',
        jumlah_rp: returnAmountRp,
        untuk_apa: `Pengembalian Sisa Panjar — ${kasbonTx.untuk_apa}`,
        kategori_keperluan: 'Pengembalian Panjar',
        beban_biaya: 'KONTRAKTOR',
        pic: picName,
        nomor_kuitansi: receiptNo || undefined,
        tanggal: settlementDate,
        payment_method: paymentMethod,
        status_bukti: attachmentUrls.length > 0 ? 'TERLAMPIR' : 'TANPA_BUKTI',
        lampiran_nota_urls: attachmentUrls,
        receipt_id: receiptId,
        kasbon_induk_id: kasbonTx.id,
        source_module: 'KAS_LANGSUNG',
        catatan:
          notes?.trim() ||
          `Pelunasan LPJ Panjar #${kasbonTx.id.slice(0, 8)} (Belanja riil Rp ${cumulativeLpj.toLocaleString('id-ID')} di pos ${lpjCategory}, sisa dikembalikan Rp ${returnAmountRp.toLocaleString('id-ID')}).`,
      },
      netCashImpactTotalRp: cumulativeLpj,
      returnAmountRp,
      topUpAmountRp: 0,
      remainingOpenRp: 0,
      summaryText: `Panjar LUNAS. Biaya Rp ${cumulativeLpj.toLocaleString('id-ID')} direklasifikasi ke ${lpjCategory} dan sisa Rp ${returnAmountRp.toLocaleString('id-ID')} otomatis dicatat sebagai Kas Masuk Pengembalian Panjar.`,
    };
  }

  // Kasus 2: Belanja Riil Kumulatif == Pokok Efektif → TIDAK membuat baris Rp 0 (patuh CHECK amount > 0)
  if (cumulativeLpj === effectivePrincipal) {
    return {
      scenario: 'BELANJA_PAS',
      updatedParent: {
        status_kasbon: 'LUNAS',
        nominal_lpj: effectivePrincipal,
        lpj_kategori_riil: lpjCategory,
        ...baseProofFields,
      },
      followUpTransaction: null,
      netCashImpactTotalRp: effectivePrincipal,
      returnAmountRp: 0,
      topUpAmountRp: 0,
      remainingOpenRp: 0,
      summaryText: `Panjar LUNAS pas tanpa sisa (Rp ${effectivePrincipal.toLocaleString('id-ID')}). Biaya otomatis direklasifikasi ke pos ${lpjCategory}.`,
    };
  }

  // Kasus 3: Belanja Riil Kumulatif > Pokok Efektif → Terbitkan 1 baris KELUAR tambahan (kurang bayar / ganti mandor)
  const topUpAmountRp = cumulativeLpj - effectivePrincipal;
  return {
    scenario: 'BELANJA_LEBIH',
    updatedParent: {
      status_kasbon: 'LUNAS',
      nominal_lpj: effectivePrincipal,
      lpj_kategori_riil: lpjCategory,
      ...baseProofFields,
    },
    followUpTransaction: {
      jenis: 'KELUAR',
      jumlah_rp: topUpAmountRp,
      untuk_apa: `Tambahan Kurang Bayar LPJ Panjar — ${kasbonTx.untuk_apa}`,
      kategori_keperluan: lpjCategory,
      beban_biaya: deriveBebanBiayaFromCategory('KELUAR', lpjCategory),
      pic: picName,
      nomor_kuitansi: receiptNo || undefined,
      tanggal: settlementDate,
      payment_method: paymentMethod,
      status_bukti: attachmentUrls.length > 0 ? 'TERLAMPIR' : 'TANPA_BUKTI',
      lampiran_nota_urls: attachmentUrls,
      receipt_id: receiptId,
      kasbon_induk_id: kasbonTx.id,
      source_module: 'KAS_LANGSUNG',
      catatan:
        notes?.trim() ||
        `Penggantian kekurangan bayar LPJ Panjar #${kasbonTx.id.slice(0, 8)} (Total belanja riil Rp ${cumulativeLpj.toLocaleString('id-ID')} > Pokok Panjar Rp ${effectivePrincipal.toLocaleString('id-ID')}).`,
    },
    netCashImpactTotalRp: cumulativeLpj,
    returnAmountRp: 0,
    topUpAmountRp,
    remainingOpenRp: 0,
    summaryText: `Panjar LUNAS. Total belanja riil Rp ${cumulativeLpj.toLocaleString('id-ID')} (${lpjCategory}); kekurangan bayar Rp ${topUpAmountRp.toLocaleString('id-ID')} otomatis dicatat sebagai Kas Keluar tambahan.`,
  };
}

/**
 * Ringkasan Piutang Talangan Klien (Kas keluar atas beban KLIEN + LPJ panjar berkategori Talangan Klien vs penggantian diterima)
 */
export function summarizeClientAdvanceReceivables(
  cashMutations: MutasiKas[]
): ClientAdvanceReceivableSummary {
  const active = (cashMutations || []).filter((c) => !isCashRowExcluded(c));

  let totalTalanganRp = 0;
  const talanganOut: MutasiKas[] = [];

  for (const c of active) {
    if (c.jenis !== 'KELUAR') continue;
    const isPanjar = c.is_kasbon === true || c.kategori_keperluan === 'Panjar / Kasbon';
    if (isPanjar) {
      if (c.lpj_kategori_riil === 'Talangan Klien' && Number(c.nominal_lpj) > 0) {
        totalTalanganRp += Math.min(Number(c.jumlah_rp) || 0, Number(c.nominal_lpj) || 0);
        talanganOut.push(c);
      }
      continue;
    }
    if (c.beban_biaya === 'KLIEN' || c.kategori_keperluan === 'Talangan Klien') {
      totalTalanganRp += Number(c.jumlah_rp) || 0;
      talanganOut.push(c);
    }
  }

  const talanganIn = active.filter(
    (c) =>
      c.jenis === 'MASUK' &&
      (c.kategori_keperluan === 'Penggantian Talangan Klien' || c.beban_biaya === 'KLIEN')
  );

  const totalDigantiRp = talanganIn.reduce((s, c) => s + (Number(c.jumlah_rp) || 0), 0);
  const sisaPiutangRp = Math.max(0, totalTalanganRp - totalDigantiRp);

  return {
    totalTalanganRp,
    totalDigantiRp,
    sisaPiutangRp,
    transactions: [...talanganOut, ...talanganIn].sort(
      (a, b) => new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime()
    ),
  };
}

/**
 * Helper internal: hitung alokasi pengeluaran bersih per 8 pos biaya dengan reklasifikasi LPJ bebas double-counting.
 */
function computeReclassifiedOutflowByCategory(cashMutations: MutasiKas[]): {
  amountByCat: Record<CashOutCategory, number>;
  countByCat: Record<CashOutCategory, number>;
} {
  const amountByCat: Record<CashOutCategory, number> = {
    Material: 0,
    'Upah & Konsumsi': 0,
    'Sewa Alat & Angkut': 0,
    Operasional: 0,
    'Panjar / Kasbon': 0,
    'Talangan Klien': 0,
    'Bonus Klien': 0,
    Lainnya: 0,
  };
  const countByCat: Record<CashOutCategory, number> = {
    Material: 0,
    'Upah & Konsumsi': 0,
    'Sewa Alat & Angkut': 0,
    Operasional: 0,
    'Panjar / Kasbon': 0,
    'Talangan Klien': 0,
    'Bonus Klien': 0,
    Lainnya: 0,
  };

  const active = (cashMutations || []).filter((c) => !isCashRowExcluded(c));

  const returnedByParent = new Map<string, number>();
  for (const tx of active) {
    if (tx.jenis === 'MASUK' && tx.kasbon_induk_id) {
      returnedByParent.set(
        tx.kasbon_induk_id,
        (returnedByParent.get(tx.kasbon_induk_id) || 0) + (Number(tx.jumlah_rp) || 0)
      );
    }
  }

  const normalizeOutCat = (raw?: string): CashOutCategory => {
    if (raw && (CASH_OUT_CATEGORIES as readonly string[]).includes(raw)) {
      return raw as CashOutCategory;
    }
    return 'Lainnya';
  };

  for (const tx of active) {
    if (tx.jenis !== 'KELUAR') continue;
    const amt = Number(tx.jumlah_rp) || 0;
    const isPanjar = tx.is_kasbon === true || tx.kategori_keperluan === 'Panjar / Kasbon';

    if (isPanjar) {
      const lpjRp = Math.min(amt, Math.max(0, Number(tx.nominal_lpj) || 0));
      const retRp = returnedByParent.get(tx.id) || 0;
      const openRemain =
        tx.status_kasbon === 'LUNAS' ? 0 : Math.max(0, amt - lpjRp - retRp);

      if (lpjRp > 0) {
        const targetCat = normalizeOutCat(tx.lpj_kategori_riil || 'Lainnya');
        amountByCat[targetCat] += lpjRp;
        countByCat[targetCat] += 1;
      }
      if (openRemain > 0) {
        amountByCat['Panjar / Kasbon'] += openRemain;
        countByCat['Panjar / Kasbon'] += 1;
      }
      continue;
    }

    // Pengeluaran non-panjar
    let cat: CashOutCategory = normalizeOutCat(tx.kategori_keperluan);
    if (tx.beban_biaya === 'KLIEN' && cat !== 'Talangan Klien') {
      cat = 'Talangan Klien';
    } else if (tx.beban_biaya === 'BONUS_KLIEN' && cat !== 'Bonus Klien') {
      cat = 'Bonus Klien';
    }

    amountByCat[cat] += amt;
    countByCat[cat] += 1;
  }

  return { amountByCat, countByCat };
}

/**
 * Hitung ringkasan KPI kas & State Machine A (K-1 s.d. K-4 — Bebas Alarm Palsu)
 */
export function computeCashSummaryMetrics(
  cashMutations: MutasiKas[],
  stockMutations: MutasiBarang[],
  projectReceipts: ProjectReceipt[],
  context: CashEvalContext
): CashSummaryMetrics {
  const all = cashMutations || [];
  let activeCount = 0;
  let excludedCount = 0;
  let totalMasukAktif = 0;
  let totalKeluarAktif = 0;
  let totalMasukTermin = 0;
  let totalMasukModal = 0;
  let totalMasukPengembalian = 0;
  let pendingReceiptCount = 0;

  for (const c of all) {
    if (isCashRowExcluded(c)) {
      excludedCount += 1;
      continue;
    }
    activeCount += 1;
    const amt = Number(c.jumlah_rp) || 0;
    if (c.jenis === 'MASUK') {
      totalMasukAktif += amt;
      if (c.kategori_keperluan === 'Dana Termin Proyek') {
        totalMasukTermin += amt;
      } else if (c.kategori_keperluan === 'Modal Kerja Kontraktor') {
        totalMasukModal += amt;
      } else if (
        c.kategori_keperluan === 'Pengembalian Panjar' ||
        c.kategori_keperluan === 'Penggantian Talangan Klien'
      ) {
        totalMasukPengembalian += amt;
      }
    } else {
      totalKeluarAktif += amt;
    }

    if (c.status_bukti === 'BUKTI_MENYUSUL') {
      pendingReceiptCount += 1;
    }
  }

  const saldoSaatIni = totalMasukAktif - totalKeluarAktif;
  const ambangWaspada = Math.max(2_000_000, Math.round(0.1 * totalMasukAktif));

  let healthCode: CashBalanceHealthCode;
  let healthKey: CashBalanceHealthKey;
  let healthLabel: string;
  let healthBadgeClass: string;
  let isCashCritical = false;

  if (activeCount === 0) {
    healthCode = 'K-1';
    healthKey = 'BELUM_ADA_KAS';
    healthLabel = 'Belum Ada Kas';
    healthBadgeClass =
      'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
    isCashCritical = false;
  } else if (saldoSaatIni <= 0) {
    healthCode = 'K-4';
    healthKey = 'SALDO_HABIS';
    healthLabel = 'Saldo Habis';
    healthBadgeClass =
      'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700';
    isCashCritical = true;
  } else if (saldoSaatIni <= ambangWaspada) {
    healthCode = 'K-3';
    healthKey = 'MENIPIS';
    healthLabel = 'Menipis';
    healthBadgeClass =
      'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800';
    isCashCritical = false;
  } else {
    healthCode = 'K-2';
    healthKey = 'SEHAT';
    healthLabel = 'Sehat';
    healthBadgeClass =
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800';
    isCashCritical = false;
  }

  const { amountByCat } = computeReclassifiedOutflowByCategory(all);
  const openKasbonList = summarizeOpenKasbon(all);
  const openKasbonCount = openKasbonList.filter((k) => k.statusKasbon !== 'LUNAS').length;
  const totalKeluarPanjarTerbuka = openKasbonList.reduce((s, k) => s + k.sisaTerbukaRp, 0);

  const clientAdvance = summarizeClientAdvanceReceivables(all);
  const unreconciled = findUnreconciledStockReceipts(
    stockMutations,
    projectReceipts,
    all,
    context.clientName
  );
  const pendingWorkflowCount = countPendingCashApprovals(all, context.activeRole);

  return {
    activeCount,
    excludedCount,
    totalMasukAktif,
    totalKeluarAktif,
    saldoSaatIni,
    ambangWaspada,
    healthCode,
    healthKey,
    healthLabel,
    healthBadgeClass,
    isCashCritical,
    totalMasukTermin,
    totalMasukModal,
    totalMasukPengembalian,
    totalKeluarMaterial: amountByCat['Material'],
    totalKeluarUpah: amountByCat['Upah & Konsumsi'],
    totalKeluarAlat: amountByCat['Sewa Alat & Angkut'],
    totalKeluarOperasional: amountByCat['Operasional'],
    totalKeluarPanjarTerbuka,
    totalKeluarBonusKlien: amountByCat['Bonus Klien'],
    totalPiutangTalanganKlien: clientAdvance.sisaPiutangRp,
    pendingReceiptCount,
    openKasbonCount,
    unreconciledStockReceiptsCount: unreconciled.length,
    pendingWorkflowCount,
  };
}

/**
 * Evaluasi 8 Pos Kontrol Anggaran (Tab 1 Ringkasan & Anggaran — State Machine C: A-1..A-4)
 */
export function evaluateBudgetCategories(
  cashMutations: MutasiKas[],
  boqItems: ItemBarang[],
  context: CashEvalContext
): BudgetCategoryEvaluation[] {
  // Hitung pagu BOQ Kontraktor (Material vs Upah/Jasa)
  let paguMaterial = 0;
  let paguUpah = 0;
  for (const it of boqItems || []) {
    if (isClientProvidedRemark(it.keterangan, context.clientName)) continue;
    const val = (Number(it.qty_boq) || 0) * (Number(it.harga_satuan) || 0);
    const catUpper = (it.kategori || '').toUpperCase();
    const isManpower =
      !it.is_stock_item ||
      catUpper.startsWith('IV') ||
      catUpper.includes('JASA') ||
      catUpper.includes('UPAH') ||
      catUpper.includes('MANPOWER');
    if (isManpower) paguUpah += val;
    else paguMaterial += val;
  }

  // Cek kesehatan kas (K-1 / K-4 menuntut tombol Isi Kas alih-alih Bayar)
  const active = (cashMutations || []).filter((c) => !isCashRowExcluded(c));
  const saldoSaatIni = active.reduce(
    (sum, c) => sum + (c.jenis === 'MASUK' ? Number(c.jumlah_rp) || 0 : -(Number(c.jumlah_rp) || 0)),
    0
  );
  const isCashEmpty = active.length === 0 || saldoSaatIni <= 0;

  const { amountByCat, countByCat } = computeReclassifiedOutflowByCategory(cashMutations);

  const definitions: Array<{
    key: CashOutCategory;
    label: string;
    description: string;
    pagu: number;
  }> = [
    {
      key: 'Material',
      label: 'Material Kontrak BOQ',
      description: 'Pembayaran belanja material proyek & pelunasan nota gudang',
      pagu: paguMaterial,
    },
    {
      key: 'Upah & Konsumsi',
      label: 'Upah & Konsumsi BOQ',
      description: 'Upah borongan/harian tukang, mandor, dan konsumsi kerja',
      pagu: paguUpah,
    },
    {
      key: 'Sewa Alat & Angkut',
      label: 'Sewa Alat & Angkut',
      description: 'Rental peralatan kerja, kendaraan pikap, dan ekspedisi material',
      pagu: 0,
    },
    {
      key: 'Operasional',
      label: 'Operasional Lapangan',
      description: 'Listrik/air kerja, BBM genset, ATK, dan keperluan umum proyek',
      pagu: 0,
    },
    {
      key: 'Panjar / Kasbon',
      label: 'Panjar / Kasbon Lapangan',
      description: 'Saldo uang muka kerja mandor/staf yang masih terbuka (belum LPJ)',
      pagu: 0,
    },
    {
      key: 'Talangan Klien',
      label: 'Talangan Klien (Dapat Ditagih)',
      description: `Biaya pekerjaan di luar kontrak atas permintaan ${context.clientName}`,
      pagu: 0,
    },
    {
      key: 'Bonus Klien',
      label: 'Bonus Klien',
      description: `Apresiasi atau insentif di luar tagihan kontrak ${context.clientName}`,
      pagu: 0,
    },
    {
      key: 'Lainnya',
      label: 'Pengeluaran Lainnya',
      description: 'Biaya tak terduga atau pengeluaran lain di luar pos utama',
      pagu: 0,
    },
  ];

  return definitions.map((def) => {
    const realisasi = amountByCat[def.key] || 0;
    const txCount = countByCat[def.key] || 0;
    const pagu = def.pagu;
    const sisaPaguRp = pagu > 0 ? Math.max(0, pagu - realisasi) : 0;
    const serapanPct = pagu > 0 ? Math.round((realisasi / pagu) * 1000) / 10 : 0;

    let stateCode: BudgetCategoryStateCode;
    let statusLabel: 'Belum Keluar' | 'Aman' | 'Waspada' | 'Lebih';
    let statusBadgeClass: string;

    if (realisasi <= 0) {
      stateCode = 'A-1';
      statusLabel = 'Belum Keluar';
      statusBadgeClass =
        'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
    } else if (pagu > 0 && realisasi > pagu) {
      stateCode = 'A-4';
      statusLabel = 'Lebih';
      statusBadgeClass =
        'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800';
    } else if (pagu > 0 && realisasi > 0.8 * pagu) {
      stateCode = 'A-3';
      statusLabel = 'Waspada';
      statusBadgeClass =
        'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800';
    } else {
      stateCode = 'A-2';
      statusLabel = 'Aman';
      statusBadgeClass =
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800';
    }

    let actionType: 'BAYAR' | 'ISI_KAS' | 'RIWAYAT' = 'RIWAYAT';
    let actionLabel = 'Riwayat';
    let actionVariant: CashActionVariant = 'neutral';
    let actionTooltip = `Lihat riwayat transaksi pos ${def.label}`;
    let showSecondaryHistoryIcon = false;

    if (context.authority === 'EKSEKUTOR' && context.canIssue) {
      if (stateCode === 'A-4') {
        actionType = 'RIWAYAT';
        actionLabel = 'Riwayat';
        actionVariant = 'neutral';
        actionTooltip = 'Realisasi telah melampaui pagu kontrak — tinjau riwayat pos';
        showSecondaryHistoryIcon = false;
      } else if (isCashEmpty) {
        actionType = 'ISI_KAS';
        actionLabel = 'Isi Kas';
        actionVariant = 'emerald';
        actionTooltip = 'Saldo kas Rp 0 — catat dana masuk sebelum membayar pos ini';
        showSecondaryHistoryIcon = true;
      } else {
        actionType = 'BAYAR';
        actionLabel = 'Bayar';
        actionVariant = stateCode === 'A-3' ? 'amber' : 'rose';
        actionTooltip = `Catat pembayaran kas keluar untuk pos ${def.label}`;
        showSecondaryHistoryIcon = true;
      }
    }

    return {
      categoryKey: def.key,
      label: def.label,
      description: def.description,
      paguAcuanRp: pagu,
      realisasiKasRp: realisasi,
      sisaPaguRp,
      serapanPct,
      txCount,
      stateCode,
      statusLabel,
      statusBadgeClass,
      actionType,
      actionLabel,
      actionVariant,
      actionTooltip,
      showSecondaryHistoryIcon,
    };
  });
}

/**
 * Evaluasi 1 Baris Jurnal Kas (Tab 3 Jurnal Transaksi Kas — State Machine B: T-1..T-7)
 */
export function evaluateCashRow(tx: MutasiKas, context: CashEvalContext): CashRowEvaluation {
  const wf = tx.status_dokumen || 'DITERBITKAN';
  const isVoid = Boolean(tx.is_batal || wf === 'BATAL');
  const isReplaced = !isVoid && Boolean(tx.is_ganti || wf === 'DIGANTI');

  const statusBukti: StatusBuktiKas =
    tx.status_bukti ||
    ((tx.lampiran_nota_urls && tx.lampiran_nota_urls.length > 0)
      ? 'TERLAMPIR'
      : tx.receipt_id
      ? 'REKONSILIASI_NOTA'
      : 'TANPA_BUKTI');

  const buktiLabel = STATUS_BUKTI_LABELS[statusBukti] || 'Tanpa Bukti';
  const buktiBadgeClass =
    statusBukti === 'TERLAMPIR'
      ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800'
      : statusBukti === 'REKONSILIASI_NOTA'
      ? 'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800'
      : statusBukti === 'BUKTI_MENYUSUL'
      ? 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800'
      : 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';

  // T-6: BATAL
  if (isVoid) {
    return {
      stateCode: 'T-6',
      isExcluded: true,
      statusLabel: 'Batal',
      statusBadgeClass:
        'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-700',
      buktiLabel,
      buktiBadgeClass,
      actionType: 'RIWAYAT',
      actionLabel: 'Rincian',
      actionVariant: 'neutral',
      actionTooltip: 'Lihat rincian alasan pembatalan audit',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // T-7: DIGANTI
  if (isReplaced) {
    return {
      stateCode: 'T-7',
      isExcluded: true,
      statusLabel: 'Diganti',
      statusBadgeClass:
        'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-700',
      buktiLabel,
      buktiBadgeClass,
      actionType: 'LIHAT_PENGGANTI',
      actionLabel: 'Pengganti',
      actionVariant: 'neutral',
      actionTooltip: 'Lompat ke baris revisi pengganti yang sah',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // T-3: Giliran persetujuan Pengawas Internal (Foreman / Spv. / Dept. Mgr / KTT-PM / CEO)
  const pendingApproval =
    context.authority === 'PENGAWAS_INTERNAL'
      ? getPendingApprovalForRole(wf, context.activeRole)
      : null;

  if (pendingApproval) {
    const labelMap: Record<PendingApprovalAction, { label: string; variant: CashActionVariant; tip: string }> = {
      PERIKSA: {
        label: 'Periksa',
        variant: 'sky',
        tip: 'Periksa transaksi kas yang menunggu pemeriksaan',
      },
      SETUJU: {
        label: 'Setuju',
        variant: 'amber',
        tip: 'Setujui transaksi kas yang telah diperiksa',
      },
      SAHKAN: {
        label: 'Sahkan',
        variant: 'teal',
        tip:
          statusBukti === 'BUKTI_MENYUSUL'
            ? 'Peringatan: bukti kuitansi menyusul — konfirmasi sebelum sahkan TTE'
            : 'Sahkan transaksi kas dengan TTE QR',
      },
    };
    const cfg = labelMap[pendingApproval.action];
    const wfBadge =
      wf === 'DISETUJUI'
        ? {
            label: 'Disetujui',
            cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800',
          }
        : wf === 'DIPERIKSA'
        ? {
            label: 'Diperiksa',
            cls: 'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800',
          }
        : {
            label: 'Terbit',
            cls: 'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700',
          };

    return {
      stateCode: 'T-3',
      isExcluded: false,
      statusLabel: wfBadge.label,
      statusBadgeClass: wfBadge.cls,
      buktiLabel,
      buktiBadgeClass,
      actionType: 'APPROVE',
      actionLabel: cfg.label,
      actionVariant: cfg.variant,
      actionTooltip: cfg.tip,
      showSecondaryHistoryIcon: true,
      pendingApprovalAction: pendingApproval.action,
      nextWorkflowTarget: pendingApproval.nextTarget,
    };
  }

  // T-2: Panjar / Kasbon Terbuka atau Sebagian
  const isOpenKasbon =
    tx.jenis === 'KELUAR' &&
    (tx.is_kasbon === true || tx.kategori_keperluan === 'Panjar / Kasbon') &&
    tx.status_kasbon !== 'LUNAS';

  if (isOpenKasbon) {
    const isPartial = tx.status_kasbon === 'SEBAGIAN';
    const isClerk = context.authority === 'EKSEKUTOR' && context.canIssue;
    return {
      stateCode: 'T-2',
      isExcluded: false,
      statusLabel: isPartial ? 'Panjar Sebagian' : 'Panjar Terbuka',
      statusBadgeClass:
        'bg-indigo-50 text-indigo-800 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-200 dark:border-indigo-800',
      buktiLabel,
      buktiBadgeClass,
      actionType: isClerk ? 'LUNASI_PANJAR' : 'RIWAYAT',
      actionLabel: isClerk ? 'Lunasi' : 'Riwayat',
      actionVariant: isClerk ? 'indigo' : 'neutral',
      actionTooltip: isClerk
        ? 'Input LPJ kuitansi & selesaikan saldo panjar terbuka'
        : 'Lihat rincian dan jejak audit transaksi',
      showSecondaryHistoryIcon: isClerk,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // T-1: Bukti Menyusul
  if (statusBukti === 'BUKTI_MENYUSUL') {
    const isClerk = context.authority === 'EKSEKUTOR' && context.canIssue;
    return {
      stateCode: 'T-1',
      isExcluded: false,
      statusLabel: 'Bukti Menyusul',
      statusBadgeClass:
        'bg-sky-50 text-sky-800 border-sky-200 dark:bg-sky-950/50 dark:text-sky-200 dark:border-sky-800',
      buktiLabel,
      buktiBadgeClass,
      actionType: isClerk ? 'UNGGAH_BUKTI' : 'RIWAYAT',
      actionLabel: isClerk ? 'Bukti' : 'Riwayat',
      actionVariant: isClerk ? 'blue' : 'neutral',
      actionTooltip: isClerk
        ? 'Unggah dan lengkapi foto kuitansi/bukti transfer yang menyusul'
        : 'Lihat rincian dan jejak audit transaksi',
      showSecondaryHistoryIcon: isClerk,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // T-5: Sah (TTE/QR)
  if (wf === 'MENGETAHUI') {
    return {
      stateCode: 'T-5',
      isExcluded: false,
      statusLabel: 'Sah (TTE)',
      statusBadgeClass:
        'bg-teal-50 text-teal-800 border-teal-200 dark:bg-teal-950/50 dark:text-teal-200 dark:border-teal-800',
      buktiLabel,
      buktiBadgeClass,
      actionType: 'RIWAYAT',
      actionLabel: 'Riwayat',
      actionVariant: 'neutral',
      actionTooltip: 'Transaksi telah disahkan TTE — lihat riwayat lengkap',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // T-4: Aktif normal
  const isClerk = context.authority === 'EKSEKUTOR' && context.canCorrect;
  const activeLabel =
    wf === 'DISETUJUI' ? 'Disetujui' : wf === 'DIPERIKSA' ? 'Terperiksa' : 'Aktif';

  return {
    stateCode: 'T-4',
    isExcluded: false,
    statusLabel: activeLabel,
    statusBadgeClass:
      'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800',
    buktiLabel,
    buktiBadgeClass,
    actionType: isClerk ? 'KOREKSI' : 'RIWAYAT',
    actionLabel: isClerk ? 'Koreksi' : 'Riwayat',
    actionVariant: isClerk ? 'slate' : 'neutral',
    actionTooltip: isClerk
      ? 'Buka menu koreksi: Ganti, Batalkan, atau Lihat Bukti'
      : 'Lihat rincian dan jejak audit transaksi',
    showSecondaryHistoryIcon: isClerk,
    pendingApprovalAction: null,
    nextWorkflowTarget: null,
  };
}

/**
 * Helper kelas Tailwind Smart-Button WCAG AA (Light & Dark)
 */
export function getCashActionVariantClass(variant: CashActionVariant): string {
  switch (variant) {
    case 'emerald':
      return 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 shadow-xs';
    case 'rose':
      return 'bg-rose-600 hover:bg-rose-700 text-white active:scale-95 shadow-xs';
    case 'blue':
      return 'bg-blue-600 hover:bg-blue-700 text-white active:scale-95 shadow-xs';
    case 'indigo':
      return 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95 shadow-xs';
    case 'sky':
      return 'bg-sky-600 hover:bg-sky-700 text-white active:scale-95 shadow-xs';
    case 'amber':
      return 'bg-amber-600 hover:bg-amber-700 text-white active:scale-95 shadow-xs';
    case 'teal':
      return 'bg-teal-600 hover:bg-teal-700 text-white active:scale-95 shadow-xs';
    case 'slate':
      return 'bg-slate-700 hover:bg-slate-800 text-white dark:bg-slate-700 dark:hover:bg-slate-600 active:scale-95 shadow-xs';
    case 'neutral':
    default:
      return 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-95 border border-slate-200/70 dark:border-slate-700/70';
  }
}

/**
 * Buat jawaban awal Wizard 3 Langkah (atau 2-Klik Ekspres dari Nota Gudang)
 */
export function createInitialCashWizardAnswers(params: {
  jenis: 'MASUK' | 'KELUAR';
  defaultPic: string;
  preselectedCategory?: KategoriMutasiKas;
  preselectedReceipt?: UnreconciledStockReceiptItem | null;
  preselectedAmount?: number;
  preselectedPurpose?: string;
}): CashWizardAnswers {
  const {
    jenis,
    defaultPic,
    preselectedCategory,
    preselectedReceipt,
    preselectedAmount,
    preselectedPurpose,
  } = params;

  if (preselectedReceipt) {
    const cat: CashOutCategory = preselectedReceipt.isTalangan ? 'Talangan Klien' : 'Material';
    return {
      jenis: 'KELUAR',
      kategori_keperluan: cat,
      beban_biaya: preselectedReceipt.isTalangan ? 'KLIEN' : 'PROYEK_BOQ',
      untuk_apa: `Pelunasan Nota ${preselectedReceipt.receiptNo} (${preselectedReceipt.storeName}) — ${preselectedReceipt.itemSummary}`,
      receipt_id: preselectedReceipt.receiptId,
      linked_stock_receipt: preselectedReceipt,
      source_module: 'MUTASI_BARANG',
      source_entity_id: preselectedReceipt.receiptId,
      source_entity_no: preselectedReceipt.receiptNo,
      jumlah_rp: preselectedReceipt.totalAmountRp,
      tanggal: getTodayLocalDate(),
      payment_method: 'TRANSFER',
      pic: defaultPic || '',
      nama_toko: preselectedReceipt.storeName,
      toko_kontak: preselectedReceipt.storeContact || '',
      nomor_kuitansi: preselectedReceipt.receiptNo,
      status_bukti:
        preselectedReceipt.attachmentUrls.length > 0 ? 'REKONSILIASI_NOTA' : 'BUKTI_MENYUSUL',
      lampiran_nota_urls: [...preselectedReceipt.attachmentUrls],
      catatan: `Rekonsiliasi pembayaran nota belanja gudang (${preselectedReceipt.itemCount} item).`,
    };
  }

  const defaultCat: KategoriMutasiKas =
    preselectedCategory || (jenis === 'MASUK' ? 'Dana Termin Proyek' : 'Material');

  return {
    jenis,
    kategori_keperluan: defaultCat,
    beban_biaya: deriveBebanBiayaFromCategory(jenis, defaultCat),
    untuk_apa: preselectedPurpose || '',
    linked_stock_receipt: null,
    source_module: 'KAS_LANGSUNG',
    jumlah_rp: preselectedAmount || 0,
    tanggal: getTodayLocalDate(),
    payment_method: jenis === 'MASUK' ? 'TRANSFER' : 'TUNAI',
    pic: defaultPic || '',
    nama_toko: '',
    toko_kontak: '',
    nomor_kuitansi: '',
    status_bukti: 'TANPA_BUKTI',
    lampiran_nota_urls: [],
    catatan: '',
  };
}

/**
 * Validasi langkah Wizard Mutasi Dana
 */
export function validateCashWizardStep(
  stepId: CashWizardStepId,
  answers: CashWizardAnswers,
  currentCashBalance: number
): string | null {
  if (stepId === 'PURPOSE_AMOUNT') {
    if (!answers.jumlah_rp || answers.jumlah_rp <= 0) {
      return 'Nominal transaksi kas harus lebih besar dari Rp 0.';
    }
    if (!answers.tanggal) {
      return 'Tanggal transaksi kas wajib diisi.';
    }
    if (!answers.untuk_apa.trim()) {
      return 'Tuliskan uraian keperluan atau sumber dana terlebih dahulu.';
    }
    if (answers.jenis === 'KELUAR' && answers.jumlah_rp > currentCashBalance) {
      return `Saldo kas operasional (Rp ${currentCashBalance.toLocaleString('id-ID')}) tidak mencukupi untuk pengeluaran Rp ${answers.jumlah_rp.toLocaleString('id-ID')}.`;
    }
    return null;
  }

  if (stepId === 'PARTY_EVIDENCE') {
    if (!answers.pic.trim()) {
      return 'Nama Penanggung Jawab (PIC) penyerah/penerima dana wajib diisi.';
    }
    return null;
  }

  if (stepId === 'REVIEW') {
    if (!answers.jumlah_rp || answers.jumlah_rp <= 0) {
      return 'Nominal transaksi harus lebih dari Rp 0.';
    }
    if (!answers.untuk_apa.trim()) {
      return 'Uraian transaksi wajib diisi.';
    }
    if (!answers.pic.trim()) {
      return 'Nama Penanggung Jawab (PIC) wajib diisi.';
    }
    if (answers.jenis === 'KELUAR' && answers.jumlah_rp > currentCashBalance) {
      return `Saldo kas operasional (Rp ${currentCashBalance.toLocaleString('id-ID')}) tidak mencukupi. Catat Kas Masuk terlebih dahulu.`;
    }
    return null;
  }

  return null;
}

/**
 * Terjemahkan jawaban Wizard menjadi payload siap simpan ke database
 */
export function buildCashMutationPayloadFromWizard(
  answers: CashWizardAnswers,
  occurredAtIso: string
): Omit<MutasiKas, 'id' | 'saldo_setelah'> {
  const isPanjar =
    answers.jenis === 'KELUAR' && answers.kategori_keperluan === 'Panjar / Kasbon';
  const hasAttachments = answers.lampiran_nota_urls && answers.lampiran_nota_urls.length > 0;
  const resolvedBukti: StatusBuktiKas =
    answers.status_bukti === 'BUKTI_MENYUSUL'
      ? 'BUKTI_MENYUSUL'
      : answers.linked_stock_receipt && hasAttachments
      ? 'REKONSILIASI_NOTA'
      : hasAttachments
      ? 'TERLAMPIR'
      : answers.status_bukti || 'TANPA_BUKTI';

  return {
    jenis: answers.jenis,
    jumlah_rp: Math.round(Number(answers.jumlah_rp) || 0),
    untuk_apa: answers.untuk_apa.trim(),
    kategori_keperluan: answers.kategori_keperluan,
    beban_biaya:
      answers.beban_biaya || deriveBebanBiayaFromCategory(answers.jenis, answers.kategori_keperluan),
    pic: answers.pic.trim(),
    nomor_kuitansi: answers.nomor_kuitansi.trim() || undefined,
    tanggal: occurredAtIso,
    catatan: answers.catatan.trim() || undefined,
    payment_method: answers.payment_method || 'TUNAI',
    status_bukti: resolvedBukti,
    nama_toko: answers.nama_toko.trim() || undefined,
    toko_kontak: answers.toko_kontak.trim() || undefined,
    tanggal_nota: answers.linked_stock_receipt?.receiptDate || occurredAtIso,
    total_nota_fisik: answers.linked_stock_receipt?.totalAmountRp || Math.round(Number(answers.jumlah_rp) || 0),
    lampiran_nota_urls: hasAttachments ? [...answers.lampiran_nota_urls] : [],
    receipt_id: answers.receipt_id || answers.linked_stock_receipt?.receiptId || undefined,
    boq_item_id: answers.boq_item_id || undefined,
    is_kasbon: isPanjar,
    status_kasbon: isPanjar ? 'TERBUKA' : 'TIDAK_BERLAKU',
    kasbon_induk_id: answers.kasbon_induk_id || undefined,
    nominal_lpj: 0,
    source_module: answers.linked_stock_receipt ? 'MUTASI_BARANG' : answers.source_module || 'KAS_LANGSUNG',
    source_entity_id: answers.source_entity_id || answers.linked_stock_receipt?.receiptId || undefined,
    source_entity_no: answers.source_entity_no || answers.linked_stock_receipt?.receiptNo || undefined,
  };
}
