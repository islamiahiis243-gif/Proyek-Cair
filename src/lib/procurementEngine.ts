import {
  ImpersonateRole,
  ItemBarang,
  MutasiBarang,
  MutasiKas,
  PoPaymentTerms,
  PurchaseOrder,
  PurchaseOrderItem,
} from '../types';
import { PendingApprovalAction } from './boqExecutionEngine';
import {
  CashEvalContext,
  getPendingApprovalForRole,
  isCashRowExcluded,
  SOURCE_MODULE_LABELS,
} from './cashflowEngine';
import { getTodayLocalDate, isClientProvidedRemark } from './stockMutationEngine';

export const PO_PAYMENT_TERMS_LABELS: Record<PoPaymentTerms, string> = {
  TUNAI_SAAT_TIBA: 'Tunai / COD Saat Tiba',
  DP_PELUNASAN: 'Uang Muka (DP) + Pelunasan',
  TEMPO_7: 'Tempo 7 Hari',
  TEMPO_14: 'Tempo 14 Hari',
  TEMPO_30: 'Tempo 30 Hari',
};

export const PO_PAYMENT_TERMS_SHORT_LABELS: Record<PoPaymentTerms, string> = {
  TUNAI_SAAT_TIBA: 'Tunai / COD',
  DP_PELUNASAN: 'DP + Pelunasan',
  TEMPO_7: 'Tempo 7 Hr',
  TEMPO_14: 'Tempo 14 Hr',
  TEMPO_30: 'Tempo 30 Hr',
};

export const PO_PAYMENT_TERMS_DAYS: Record<PoPaymentTerms, number> = {
  TUNAI_SAAT_TIBA: 0,
  DP_PELUNASAN: 0,
  TEMPO_7: 7,
  TEMPO_14: 14,
  TEMPO_30: 30,
};

export type ProcurementHealthCode = 'P-1' | 'P-2' | 'P-3' | 'P-4';
export type ProcurementHealthKey = 'BELUM_ADA_PO' | 'LANCAR' | 'KIRIM_TERLAMBAT' | 'JATUH_TEMPO';
export type PoStateCode = 'PO-1' | 'PO-2' | 'PO-3' | 'PO-4' | 'PO-5' | 'PO-6' | 'PO-7';

export type PoActionType =
  | 'APPROVE'
  | 'KOREKSI'
  | 'KIRIM_PO'
  | 'TERIMA_BARANG'
  | 'BAYAR_PO'
  | 'ISI_KAS'
  | 'LIHAT_PENGGANTI'
  | 'RIWAYAT';

export type PoActionVariant =
  | 'emerald'
  | 'rose'
  | 'blue'
  | 'indigo'
  | 'sky'
  | 'amber'
  | 'teal'
  | 'slate'
  | 'neutral';

export interface ProcurementNeedItem {
  boqItemId: string;
  kodeBoq: string;
  namaBarang: string;
  kategori: string;
  satuan: string;
  hargaPaguBoq: number;
  qtyBoq: number;
  qtyMasukGudang: number;
  qtySedangDipesanPo: number;
  sisaBoqBelumTiba: number;
  sisaPerluDipesan: number;
  estimasiPaguSisaRp: number;
  activePoNos: string[];
  status: 'PERLU_DIPESAN' | 'SEDANG_DIPESAN' | 'TERPENUHI';
  statusLabel: string;
  statusBadgeClass: string;
  actionType: 'PESAN' | 'PANTAU' | 'TERPENUHI';
  actionLabel: string;
}

export interface PoItemReceiveProgress {
  item: PurchaseOrderItem;
  qtyPesan: number;
  qtyDiterima: number;
  qtySisaTerima: number;
  isComplete: boolean;
}

export interface PoEvaluation {
  stateCode: PoStateCode;
  isExcluded: boolean;
  statusLabel: string;
  statusBadgeClass: string;
  actionType: PoActionType;
  actionLabel: string;
  actionVariant: PoActionVariant;
  actionTooltip: string;
  showSecondaryHistoryIcon: boolean;
  pendingApprovalAction: PendingApprovalAction | null;
  nextWorkflowTarget: 'DIPERIKSA' | 'DISETUJUI' | 'MENGETAHUI' | null;
  // Progres 3-Way
  itemProgress: PoItemReceiveProgress[];
  totalQtyPesan: number;
  totalQtyDiterima: number;
  totalQtySisaTerima: number;
  receivePct: number;
  linkedStockMutations: MutasiBarang[];
  totalDibayarRp: number;
  sisaBayarRp: number;
  payPct: number;
  linkedCashMutations: MutasiKas[];
  isDpPending: boolean;
  recommendedPayAmountRp: number;
  // Komparasi BOQ
  totalPaguBoqRp: number;
  selisihBoqRp: number; // positif = hemat, negatif = melebihi pagu BOQ
  // Jadwal & Jatuh Tempo
  isDeliveryOverdue: boolean;
  deliveryOverdueDays: number;
  isPaymentOverdue: boolean;
  paymentOverdueDays: number;
  // Proteksi Koreksi
  canBatal: boolean;
  batalBlockReason?: string;
  canGanti: boolean;
  gantiBlockReason?: string;
}

export interface ProcurementSummaryMetrics {
  activePoCount: number;
  excludedPoCount: number;
  needOrderItemsCount: number;
  needOrderEstimatedBoqRp: number;
  pendingApprovalAllCount: number;
  pendingMyApprovalCount: number;
  readyToSendCount: number;
  waitingDeliveryCount: number;
  waitingPaymentCount: number;
  completedPoCount: number;
  overdueDeliveryCount: number;
  overduePaymentCount: number;
  totalPoCommitmentRp: number;
  totalPoPaidRp: number;
  totalPoOutstandingRp: number;
  totalBoqSavingsRp: number; // positif = hemat, negatif = lebih dari pagu BOQ
  healthCode: ProcurementHealthCode;
  healthKey: ProcurementHealthKey;
  healthLabel: string;
  healthBadgeClass: string;
  isPoCritical: boolean; // HANYA true pada P-4 (jatuh tempo bayar lewat)
}

export interface PoModuleContributionSnapshot {
  moduleCode: 'PO_PENGADAAN';
  moduleLabel: string;
  status: 'AKTIF';
  transactionCount: number;
  totalInRp: number;
  totalOutRp: number;
  pendingCount: number;
}

/**
 * Rumus tunggal pengecualian baris PO (BATAL atau DIGANTI)
 */
export function isPoRowExcluded(po: Partial<PurchaseOrder> | null | undefined): boolean {
  if (!po) return true;
  return Boolean(
    po.is_batal ||
      po.is_ganti ||
      po.status_dokumen === 'BATAL' ||
      po.status_dokumen === 'DIGANTI'
  );
}

function isStockMutationExcluded(m: Partial<MutasiBarang> | null | undefined): boolean {
  if (!m) return true;
  return Boolean(
    m.is_batal ||
      m.is_ganti ||
      m.status_dokumen === 'BATAL' ||
      m.status_dokumen === 'DIGANTI'
  );
}

/**
 * Hitung selisih hari (today - targetDate) dalam hari kalender lokal (YYYY-MM-DD).
 * Positif berarti sudah melewati targetDate.
 */
export function computeCalendarDaysPast(
  targetDateYmd: string | null | undefined,
  todayLocalDate: string = getTodayLocalDate()
): number {
  if (!targetDateYmd) return 0;
  const cleanTarget = targetDateYmd.slice(0, 10);
  const cleanToday = todayLocalDate.slice(0, 10);
  const targetMs = Date.parse(`${cleanTarget}T00:00:00Z`);
  const todayMs = Date.parse(`${cleanToday}T00:00:00Z`);
  if (!Number.isFinite(targetMs) || !Number.isFinite(todayMs)) return 0;
  return Math.floor((todayMs - targetMs) / 86_400_000);
}

/**
 * Hitung tanggal jatuh tempo bayar otomatis dari tanggal PO / tanggal terima + syarat tempo.
 */
export function computeDueDateFromTerms(
  baseDateIsoOrYmd: string,
  terms: PoPaymentTerms
): string | null {
  const days = PO_PAYMENT_TERMS_DAYS[terms] || 0;
  if (days <= 0) return null;
  const cleanBase = (baseDateIsoOrYmd || getTodayLocalDate()).slice(0, 10);
  const baseMs = Date.parse(`${cleanBase}T00:00:00Z`);
  if (!Number.isFinite(baseMs)) return null;
  const due = new Date(baseMs + days * 86_400_000);
  return due.toISOString().slice(0, 10);
}

/**
 * Hitung progres penerimaan barang per baris item PO dari mutasi stok MASUK yang aktif.
 */
export function computePoReceiveProgress(
  po: PurchaseOrder,
  stockMutations: MutasiBarang[]
): {
  itemProgress: PoItemReceiveProgress[];
  totalQtyPesan: number;
  totalQtyDiterima: number;
  totalQtySisaTerima: number;
  receivePct: number;
  linkedStockMutations: MutasiBarang[];
} {
  const poItems = po.items || [];
  const linkedStockMutations = (stockMutations || []).filter(
    (m) => m.jenis === 'MASUK' && !isStockMutationExcluded(m) && m.po_id === po.id
  );

  const qtyByItemId = new Map<string, number>();
  const unmappedByBoqOrName: MutasiBarang[] = [];

  for (const m of linkedStockMutations) {
    const qty = Math.max(0, Number(m.jumlah) || 0);
    if (m.po_item_id) {
      qtyByItemId.set(m.po_item_id, (qtyByItemId.get(m.po_item_id) || 0) + qty);
    } else {
      unmappedByBoqOrName.push(m);
    }
  }

  // Fallback jika ada mutasi lama/manual yang menautkan po_id tanpa po_item_id
  for (const m of unmappedByBoqOrName) {
    const matched = poItems.find(
      (it) =>
        (it.boq_item_id && it.boq_item_id === m.barang_id) ||
        it.nama_barang.trim().toLowerCase() === (m.nama_barang || '').trim().toLowerCase()
    );
    if (matched) {
      qtyByItemId.set(
        matched.id,
        (qtyByItemId.get(matched.id) || 0) + Math.max(0, Number(m.jumlah) || 0)
      );
    }
  }

  let totalQtyPesan = 0;
  let totalQtyDiterima = 0;
  let totalQtySisaTerima = 0;

  const itemProgress: PoItemReceiveProgress[] = poItems.map((item) => {
    const qtyPesan = Math.max(0, Number(item.qty_pesan) || 0);
    const qtyDiterima = Math.max(0, qtyByItemId.get(item.id) || 0);
    const qtySisaTerima = Math.max(0, Number((qtyPesan - qtyDiterima).toFixed(4)));
    totalQtyPesan += qtyPesan;
    totalQtyDiterima += Math.min(qtyPesan, qtyDiterima);
    totalQtySisaTerima += qtySisaTerima;
    return {
      item,
      qtyPesan,
      qtyDiterima,
      qtySisaTerima,
      isComplete: qtySisaTerima <= 0.0001,
    };
  });

  const receivePct =
    totalQtyPesan > 0
      ? Math.min(100, Math.round((totalQtyDiterima / totalQtyPesan) * 100))
      : 0;

  return {
    itemProgress,
    totalQtyPesan: Number(totalQtyPesan.toFixed(4)),
    totalQtyDiterima: Number(totalQtyDiterima.toFixed(4)),
    totalQtySisaTerima: Number(totalQtySisaTerima.toFixed(4)),
    receivePct,
    linkedStockMutations,
  };
}

/**
 * Hitung progres pembayaran kas terhadap sebuah PO (source_module = 'PO_PENGADAAN').
 */
export function computePoPaymentProgress(
  po: PurchaseOrder,
  cashMutations: MutasiKas[]
): {
  totalDibayarRp: number;
  sisaBayarRp: number;
  payPct: number;
  linkedCashMutations: MutasiKas[];
} {
  const poNoClean = (po.po_no || '').trim().toUpperCase();
  const linkedCashMutations = (cashMutations || []).filter((tx) => {
    if (tx.jenis !== 'KELUAR' || isCashRowExcluded(tx)) return false;
    if (tx.source_module !== 'PO_PENGADAAN') return false;
    if (tx.source_entity_id && tx.source_entity_id === po.id) return true;
    if (
      poNoClean &&
      tx.source_entity_no &&
      tx.source_entity_no.trim().toUpperCase() === poNoClean
    ) {
      return true;
    }
    return false;
  });

  const totalDibayarRp = linkedCashMutations.reduce(
    (sum, tx) => sum + Math.max(0, Number(tx.jumlah_rp) || 0),
    0
  );
  const totalPoRp = Math.max(0, Number(po.total_amount_rp) || 0);
  const sisaBayarRp = Math.max(0, Math.round(totalPoRp - totalDibayarRp));
  const payPct =
    totalPoRp > 0 ? Math.min(100, Math.round((totalDibayarRp / totalPoRp) * 100)) : 100;

  return {
    totalDibayarRp,
    sisaBayarRp,
    payPct,
    linkedCashMutations,
  };
}

/**
 * Tab 1 — Engine Anti Beli Ganda:
 * Menghitung sisa material fisik milik Kontraktor yang masih perlu dipesan:
 * sisaPerluDipesan = max(0, qty_boq - qty_masuk_total - qty_sedang_dipesan_po)
 * Secara otomatis mengecualikan pos jasa (is_stock_item === false) dan Jatah Klien / IMK.
 */
export function computeProcurementNeeds(
  items: ItemBarang[],
  purchaseOrders: PurchaseOrder[],
  stockMutations: MutasiBarang[]
): ProcurementNeedItem[] {
  const pendingQtyByBoqId = new Map<string, number>();
  const activePoNosByBoqId = new Map<string, Set<string>>();

  for (const po of purchaseOrders || []) {
    if (isPoRowExcluded(po)) continue;
    const receive = computePoReceiveProgress(po, stockMutations);
    for (const row of receive.itemProgress) {
      const boqId = row.item.boq_item_id;
      if (!boqId || row.qtySisaTerima <= 0) continue;
      pendingQtyByBoqId.set(boqId, (pendingQtyByBoqId.get(boqId) || 0) + row.qtySisaTerima);
      const set = activePoNosByBoqId.get(boqId) || new Set<string>();
      set.add(po.po_no);
      activePoNosByBoqId.set(boqId, set);
    }
  }

  const results: ProcurementNeedItem[] = [];

  for (const item of items || []) {
    // Kecualikan pos jasa & material jatah klien / IMK
    if (!item.is_stock_item) continue;
    if (isClientProvidedRemark(item.keterangan)) continue;

    const qtyBoq = Math.max(0, Number(item.target_kebutuhan_total || item.qty_boq || 0));
    if (qtyBoq <= 0) continue;

    const qtyMasukGudang = Math.max(0, Number(item.qty_masuk_total || 0));
    const qtySedangDipesanPo = Number((pendingQtyByBoqId.get(item.id) || 0).toFixed(4));
    const sisaBoqBelumTiba = Math.max(0, Number((qtyBoq - qtyMasukGudang).toFixed(4)));
    const sisaPerluDipesan = Math.max(
      0,
      Number((qtyBoq - qtyMasukGudang - qtySedangDipesanPo).toFixed(4))
    );
    const hargaPaguBoq = Math.max(0, Number(item.harga_satuan) || 0);
    const estimasiPaguSisaRp = Math.round(sisaPerluDipesan * hargaPaguBoq);
    const activePoNos = Array.from(activePoNosByBoqId.get(item.id) || []);

    let status: ProcurementNeedItem['status'] = 'TERPENUHI';
    let statusLabel = 'Terpenuhi';
    let statusBadgeClass =
      'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70';
    let actionType: ProcurementNeedItem['actionType'] = 'TERPENUHI';
    let actionLabel = 'Terpenuhi';

    if (sisaPerluDipesan > 0) {
      status = 'PERLU_DIPESAN';
      statusLabel = 'Perlu Dipesan';
      statusBadgeClass =
        'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70';
      actionType = 'PESAN';
      actionLabel = 'Pesan';
    } else if (qtySedangDipesanPo > 0) {
      status = 'SEDANG_DIPESAN';
      statusLabel = 'Sudah di PO';
      statusBadgeClass =
        'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70';
      actionType = 'PANTAU';
      actionLabel = 'Pantau';
    }

    results.push({
      boqItemId: item.id,
      kodeBoq: item.kode_boq,
      namaBarang: item.nama_barang,
      kategori: item.kategori,
      satuan: item.satuan,
      hargaPaguBoq,
      qtyBoq,
      qtyMasukGudang,
      qtySedangDipesanPo,
      sisaBoqBelumTiba,
      sisaPerluDipesan,
      estimasiPaguSisaRp,
      activePoNos,
      status,
      statusLabel,
      statusBadgeClass,
      actionType,
      actionLabel,
    });
  }

  const orderWeight: Record<ProcurementNeedItem['status'], number> = {
    PERLU_DIPESAN: 0,
    SEDANG_DIPESAN: 1,
    TERPENUHI: 2,
  };

  return results.sort((a, b) => {
    const wDiff = orderWeight[a.status] - orderWeight[b.status];
    if (wDiff !== 0) return wDiff;
    if (b.estimasiPaguSisaRp !== a.estimasiPaguSisaRp) {
      return b.estimasiPaguSisaRp - a.estimasiPaguSisaRp;
    }
    return a.namaBarang.localeCompare(b.namaBarang, 'id');
  });
}

/**
 * Hitung jumlah PO aktif yang menunggu persetujuan jabatan peran aktif (untuk Lonceng Header & Sidebar).
 */
export function countPendingPoApprovals(
  purchaseOrders: PurchaseOrder[],
  activeRole: ImpersonateRole,
  permissions?: { canCheck?: boolean; canApprove?: boolean; canAcknowledge?: boolean }
): number {
  return (purchaseOrders || []).filter((po) => {
    if (isPoRowExcluded(po)) return false;
    return getPendingApprovalForRole(po.status_dokumen, activeRole, permissions) !== null;
  }).length;
}

/**
 * State Machine B — Evaluasi 1 Baris Surat Pesanan (PO-1 s.d. PO-7) & 1 Smart-Button Fixed-Slot 7 Peran.
 */
export function evaluatePurchaseOrder(
  po: PurchaseOrder,
  stockMutations: MutasiBarang[],
  cashMutations: MutasiKas[],
  evalCtx: CashEvalContext,
  saldoKasSaatIni: number,
  todayLocalDate: string = getTodayLocalDate()
): PoEvaluation {
  const receive = computePoReceiveProgress(po, stockMutations);
  const payment = computePoPaymentProgress(po, cashMutations);

  const totalPaguBoqRp = (po.items || []).reduce(
    (sum, it) => sum + Math.max(0, Number(it.qty_pesan) || 0) * Math.max(0, Number(it.harga_pagu_boq) || 0),
    0
  );
  const totalPoRp = Math.max(0, Number(po.total_amount_rp) || 0);
  // Positif berarti harga PO lebih hemat dari pagu BOQ
  const selisihBoqRp = totalPaguBoqRp > 0 ? Math.round(totalPaguBoqRp - totalPoRp) : 0;

  const isExcluded = isPoRowExcluded(po);
  const isBatal = Boolean(po.is_batal || po.status_dokumen === 'BATAL');
  const isGanti = Boolean(po.is_ganti || po.status_dokumen === 'DIGANTI');
  const wf = po.status_dokumen || 'DITERBITKAN';
  const isApproved = wf === 'MENGETAHUI';

  // Proteksi 3-way: cegah BATAL/GANTI jika sudah ada penerimaan atau pembayaran aktif
  const hasAnyReceive = receive.totalQtyDiterima > 0;
  const hasAnyPayment = payment.totalDibayarRp > 0;
  const canBatal = !isExcluded && !hasAnyReceive && !hasAnyPayment;
  const canGanti = !isExcluded && !hasAnyReceive && !hasAnyPayment;

  let batalBlockReason: string | undefined;
  let gantiBlockReason: string | undefined;
  if (!isExcluded && (hasAnyReceive || hasAnyPayment)) {
    const reasons: string[] = [];
    if (hasAnyReceive) reasons.push('sudah ada penerimaan barang di gudang');
    if (hasAnyPayment) reasons.push('sudah ada pembayaran kas terkait');
    const msg = `PO tidak dapat dibatalkan/diganti karena ${reasons.join(' dan ')}. Batalkan mutasi terkait terlebih dahulu agar stok dan kas tetap seimbang.`;
    batalBlockReason = msg;
    gantiBlockReason = msg;
  }

  // Indikator jadwal kirim & jatuh tempo bayar
  const deliveryOverdueDays =
    !isExcluded && isApproved && receive.totalQtySisaTerima > 0 && po.estimasi_tiba
      ? Math.max(0, computeCalendarDaysPast(po.estimasi_tiba, todayLocalDate))
      : 0;
  const isDeliveryOverdue = deliveryOverdueDays > 0;

  const paymentOverdueDays =
    !isExcluded && isApproved && payment.sisaBayarRp > 0 && po.jatuh_tempo_bayar
      ? Math.max(0, computeCalendarDaysPast(po.jatuh_tempo_bayar, todayLocalDate))
      : 0;
  const isPaymentOverdue = paymentOverdueDays > 0;

  const isDpPending =
    !isExcluded &&
    isApproved &&
    po.payment_terms === 'DP_PELUNASAN' &&
    (Number(po.dp_amount_rp) || 0) > 0 &&
    payment.totalDibayarRp < (Number(po.dp_amount_rp) || 0);

  const recommendedPayAmountRp = isDpPending
    ? Math.max(0, Math.min(payment.sisaBayarRp, Math.round((Number(po.dp_amount_rp) || 0) - payment.totalDibayarRp)))
    : payment.sisaBayarRp;

  const base = {
    isExcluded,
    itemProgress: receive.itemProgress,
    totalQtyPesan: receive.totalQtyPesan,
    totalQtyDiterima: receive.totalQtyDiterima,
    totalQtySisaTerima: receive.totalQtySisaTerima,
    receivePct: receive.receivePct,
    linkedStockMutations: receive.linkedStockMutations,
    totalDibayarRp: payment.totalDibayarRp,
    sisaBayarRp: payment.sisaBayarRp,
    payPct: payment.payPct,
    linkedCashMutations: payment.linkedCashMutations,
    isDpPending,
    recommendedPayAmountRp,
    totalPaguBoqRp: Math.round(totalPaguBoqRp),
    selisihBoqRp,
    isDeliveryOverdue,
    deliveryOverdueDays,
    isPaymentOverdue,
    paymentOverdueDays,
    canBatal,
    batalBlockReason,
    canGanti,
    gantiBlockReason,
  };

  // PO-7: BATAL
  if (isBatal) {
    return {
      ...base,
      stateCode: 'PO-7',
      statusLabel: 'Batal',
      statusBadgeClass:
        'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70',
      actionType: 'RIWAYAT',
      actionLabel: 'Rincian',
      actionVariant: 'neutral',
      actionTooltip: 'Lihat rincian alasan pembatalan Surat Pesanan ini',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // PO-6: DIGANTI
  if (isGanti) {
    return {
      ...base,
      stateCode: 'PO-6',
      statusLabel: 'Diganti',
      statusBadgeClass:
        'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
      actionType: 'LIHAT_PENGGANTI',
      actionLabel: 'Pengganti',
      actionVariant: 'amber',
      actionTooltip: 'Lompat ke Surat Pesanan revisi pengganti',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // PO-1: MENUNGGU PENGESAHAN SERIAL 4 TINGKAT
  if (!isApproved) {
    const pending = getPendingApprovalForRole(po.status_dokumen, evalCtx.activeRole, {
      canCheck: evalCtx.canCheck,
      canApprove: evalCtx.canApprove,
      canAcknowledge: evalCtx.canAcknowledge,
    });
    const wfLabelMap: Record<string, string> = {
      DITERBITKAN: 'Terbit',
      DIPERIKSA: 'Diperiksa',
      DISETUJUI: 'Disetujui',
    };
    const statusLabel = wfLabelMap[wf] || 'Terbit';
    const statusBadgeClass =
      wf === 'DITERBITKAN'
        ? 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800/70'
        : wf === 'DIPERIKSA'
          ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70'
          : 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70';

    const canActOnApproval =
      evalCtx.authority === 'PENGAWAS_INTERNAL' ||
      Boolean(evalCtx.canCheck || evalCtx.canApprove || evalCtx.canAcknowledge);

    if (canActOnApproval && pending) {
      const labelByAction: Record<PendingApprovalAction, string> = {
        PERIKSA: 'Periksa',
        SETUJU: 'Setuju',
        SAHKAN: 'Sahkan',
      };
      const variantByAction: Record<PendingApprovalAction, PoActionVariant> = {
        PERIKSA: 'sky',
        SETUJU: 'amber',
        SAHKAN: 'teal',
      };
      return {
        ...base,
        stateCode: 'PO-1',
        statusLabel,
        statusBadgeClass,
        actionType: 'APPROVE',
        actionLabel: labelByAction[pending.action],
        actionVariant: variantByAction[pending.action],
        actionTooltip: `${labelByAction[pending.action]} Surat Pesanan ini sesuai giliran jabatan Anda`,
        showSecondaryHistoryIcon: true,
        pendingApprovalAction: pending.action,
        nextWorkflowTarget: pending.nextTarget,
      };
    }

    if (evalCtx.canIssue) {
      return {
        ...base,
        stateCode: 'PO-1',
        statusLabel,
        statusBadgeClass,
        actionType: 'KOREKSI',
        actionLabel: 'Koreksi',
        actionVariant: 'slate',
        actionTooltip: 'Buka rincian atau koreksi Surat Pesanan sebelum disahkan',
        showSecondaryHistoryIcon: true,
        pendingApprovalAction: null,
        nextWorkflowTarget: null,
      };
    }

    return {
      ...base,
      stateCode: 'PO-1',
      statusLabel,
      statusBadgeClass,
      actionType: 'RIWAYAT',
      actionLabel: 'Riwayat',
      actionVariant: 'neutral',
      actionTooltip: 'Lihat detail dan jejak pengesahan Surat Pesanan',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // PO-2: SAH TTE/QR BELUM DIKIRIM KE TOKO (dan belum ada penerimaan barang)
  if (!po.sent_to_store_at && receive.totalQtyDiterima <= 0) {
    if (evalCtx.canIssue) {
      return {
        ...base,
        stateCode: 'PO-2',
        statusLabel: 'Siap Kirim',
        statusBadgeClass:
          'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70',
        actionType: 'KIRIM_PO',
        actionLabel: 'Kirim PO',
        actionVariant: 'blue',
        actionTooltip: 'Cetak PDF dan tandai Surat Pesanan telah dikirim ke toko rekanan',
        showSecondaryHistoryIcon: true,
        pendingApprovalAction: null,
        nextWorkflowTarget: null,
      };
    }
    return {
      ...base,
      stateCode: 'PO-2',
      statusLabel: 'Siap Kirim',
      statusBadgeClass:
        'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/70',
      actionType: 'RIWAYAT',
      actionLabel: 'Riwayat',
      actionVariant: 'neutral',
      actionTooltip: 'Lihat dokumen dan status pengiriman PO ke toko',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // PO-4 (DP Belum Dibayar sebelum barang dikirim/diterima)
  if (isDpPending && receive.totalQtyDiterima <= 0 && payment.sisaBayarRp > 0) {
    const kasKosong = saldoKasSaatIni <= 0;
    return {
      ...base,
      stateCode: 'PO-4',
      statusLabel: isPaymentOverdue ? 'Jatuh Tempo' : 'Bayar DP',
      statusBadgeClass: isPaymentOverdue
        ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70'
        : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70',
      actionType: evalCtx.canIssue ? (kasKosong ? 'ISI_KAS' : 'BAYAR_PO') : 'RIWAYAT',
      actionLabel: evalCtx.canIssue ? (kasKosong ? 'Isi Kas' : 'Bayar DP') : 'Riwayat',
      actionVariant: evalCtx.canIssue ? (kasKosong ? 'emerald' : 'rose') : 'neutral',
      actionTooltip: evalCtx.canIssue
        ? kasKosong
          ? 'Saldo kas proyek Rp 0 — isi dana masuk terlebih dahulu sebelum membayar DP PO'
          : 'Bayar uang muka (DP) PO ke toko rekanan melalui kas proyek'
        : 'Lihat riwayat PO dan status pembayaran DP',
      showSecondaryHistoryIcon: evalCtx.canIssue,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // PO-3: SAH & SUDAH DIKIRIM (ATAU TERIMA PARSIAL) & MASIH ADA SISA BARANG BELUM TIBA
  if (receive.totalQtySisaTerima > 0) {
    const isPartial = receive.totalQtyDiterima > 0;
    const statusLabel = isDeliveryOverdue
      ? `Terlambat ${deliveryOverdueDays} Hr`
      : isPartial
        ? 'Tiba Sebagian'
        : 'Menunggu Tiba';
    const statusBadgeClass = isDeliveryOverdue
      ? 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70'
      : isPartial
        ? 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70'
        : 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/70';

    if (evalCtx.canIssue) {
      return {
        ...base,
        stateCode: 'PO-3',
        statusLabel,
        statusBadgeClass,
        actionType: 'TERIMA_BARANG',
        actionLabel: 'Terima',
        actionVariant: 'emerald',
        actionTooltip: 'Catat penerimaan barang parsial atau penuh ke gudang dengan harga PO terkunci',
        showSecondaryHistoryIcon: true,
        pendingApprovalAction: null,
        nextWorkflowTarget: null,
      };
    }

    return {
      ...base,
      stateCode: 'PO-3',
      statusLabel,
      statusBadgeClass,
      actionType: 'RIWAYAT',
      actionLabel: 'Riwayat',
      actionVariant: 'neutral',
      actionTooltip: 'Pantau progres penerimaan barang PO',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // PO-4: BARANG DITERIMA PENUH TETAPI SISA PEMBAYARAN > 0
  if (payment.sisaBayarRp > 0) {
    const kasKosong = saldoKasSaatIni <= 0;
    const statusLabel = isPaymentOverdue
      ? `Jatuh Tempo (${paymentOverdueDays} Hr)`
      : 'Siap Bayar';
    const statusBadgeClass = isPaymentOverdue
      ? 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70'
      : 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70';

    if (evalCtx.canIssue) {
      return {
        ...base,
        stateCode: 'PO-4',
        statusLabel,
        statusBadgeClass,
        actionType: kasKosong ? 'ISI_KAS' : 'BAYAR_PO',
        actionLabel: kasKosong ? 'Isi Kas' : 'Bayar',
        actionVariant: kasKosong ? 'emerald' : 'rose',
        actionTooltip: kasKosong
          ? 'Saldo kas proyek Rp 0 — catat dana masuk terlebih dahulu sebelum melunasi PO'
          : 'Bayar atau lunasi tagihan PO ke toko rekanan (otomatis tercatat di Mutasi Dana)',
        showSecondaryHistoryIcon: true,
        pendingApprovalAction: null,
        nextWorkflowTarget: null,
      };
    }

    return {
      ...base,
      stateCode: 'PO-4',
      statusLabel,
      statusBadgeClass,
      actionType: 'RIWAYAT',
      actionLabel: 'Riwayat',
      actionVariant: 'neutral',
      actionTooltip: 'Lihat rincian tagihan dan pembayaran PO',
      showSecondaryHistoryIcon: false,
      pendingApprovalAction: null,
      nextWorkflowTarget: null,
    };
  }

  // PO-5: TUNTAS 100% BARANG TIBA & 100% LUNAS
  return {
    ...base,
    stateCode: 'PO-5',
    statusLabel: 'Tuntas',
    statusBadgeClass:
      'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/60 dark:text-teal-300 dark:border-teal-800/70',
    actionType: 'RIWAYAT',
    actionLabel: 'Riwayat',
    actionVariant: 'neutral',
    actionTooltip: 'PO telah 100% diterima dan lunas dibayar — klik untuk melihat riwayat lengkap',
    showSecondaryHistoryIcon: false,
    pendingApprovalAction: null,
    nextWorkflowTarget: null,
  };
}

/**
 * State Machine A — Ringkasan Kesehatan Pengadaan Proyek (P-1 s.d. P-4, Bebas Alarm Palsu).
 */
export function computeProcurementSummaryMetrics(
  purchaseOrders: PurchaseOrder[],
  items: ItemBarang[],
  stockMutations: MutasiBarang[],
  cashMutations: MutasiKas[],
  activeRole: ImpersonateRole,
  todayLocalDate: string = getTodayLocalDate(),
  permissions?: { canCheck?: boolean; canApprove?: boolean; canAcknowledge?: boolean }
): ProcurementSummaryMetrics {
  const needs = computeProcurementNeeds(items, purchaseOrders, stockMutations);
  const needOrderItems = needs.filter((n) => n.sisaPerluDipesan > 0);
  const needOrderItemsCount = needOrderItems.length;
  const needOrderEstimatedBoqRp = needOrderItems.reduce(
    (sum, n) => sum + n.estimasiPaguSisaRp,
    0
  );

  let activePoCount = 0;
  let excludedPoCount = 0;
  let pendingApprovalAllCount = 0;
  let pendingMyApprovalCount = 0;
  let readyToSendCount = 0;
  let waitingDeliveryCount = 0;
  let waitingPaymentCount = 0;
  let completedPoCount = 0;
  let overdueDeliveryCount = 0;
  let overduePaymentCount = 0;
  let totalPoCommitmentRp = 0;
  let totalPoPaidRp = 0;
  let totalPoOutstandingRp = 0;
  let totalBoqSavingsRp = 0;

  for (const po of purchaseOrders || []) {
    if (isPoRowExcluded(po)) {
      excludedPoCount += 1;
      continue;
    }

    activePoCount += 1;
    const totalPoRp = Math.max(0, Number(po.total_amount_rp) || 0);
    totalPoCommitmentRp += totalPoRp;

    const totalPaguBoq = (po.items || []).reduce(
      (sum, it) =>
        sum + Math.max(0, Number(it.qty_pesan) || 0) * Math.max(0, Number(it.harga_pagu_boq) || 0),
      0
    );
    if (totalPaguBoq > 0) {
      totalBoqSavingsRp += Math.round(totalPaguBoq - totalPoRp);
    }

    const receive = computePoReceiveProgress(po, stockMutations);
    const payment = computePoPaymentProgress(po, cashMutations);
    totalPoPaidRp += payment.totalDibayarRp;
    totalPoOutstandingRp += payment.sisaBayarRp;

    const wf = po.status_dokumen || 'DITERBITKAN';
    if (wf !== 'MENGETAHUI') {
      pendingApprovalAllCount += 1;
      if (getPendingApprovalForRole(po.status_dokumen, activeRole, permissions) !== null) {
        pendingMyApprovalCount += 1;
      }
      continue;
    }

    if (!po.sent_to_store_at && receive.totalQtyDiterima <= 0) {
      readyToSendCount += 1;
    }

    if (receive.totalQtySisaTerima > 0) {
      waitingDeliveryCount += 1;
      if (po.estimasi_tiba && computeCalendarDaysPast(po.estimasi_tiba, todayLocalDate) > 0) {
        overdueDeliveryCount += 1;
      }
    }

    if (payment.sisaBayarRp > 0) {
      waitingPaymentCount += 1;
      if (po.jatuh_tempo_bayar && computeCalendarDaysPast(po.jatuh_tempo_bayar, todayLocalDate) > 0) {
        overduePaymentCount += 1;
      }
    }

    if (receive.totalQtySisaTerima <= 0 && payment.sisaBayarRp <= 0) {
      completedPoCount += 1;
    }
  }

  let healthCode: ProcurementHealthCode = 'P-1';
  let healthKey: ProcurementHealthKey = 'BELUM_ADA_PO';
  let healthLabel = 'Belum Ada PO';
  let healthBadgeClass =
    'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  let isPoCritical = false;

  if (activePoCount > 0) {
    if (overduePaymentCount > 0) {
      healthCode = 'P-4';
      healthKey = 'JATUH_TEMPO';
      healthLabel = 'Jatuh Tempo';
      healthBadgeClass =
        'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/70';
      isPoCritical = true;
    } else if (overdueDeliveryCount > 0) {
      healthCode = 'P-3';
      healthKey = 'KIRIM_TERLAMBAT';
      healthLabel = 'Kirim Terlambat';
      healthBadgeClass =
        'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/70';
      isPoCritical = false;
    } else {
      healthCode = 'P-2';
      healthKey = 'LANCAR';
      healthLabel = 'Lancar';
      healthBadgeClass =
        'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/70';
      isPoCritical = false;
    }
  }

  return {
    activePoCount,
    excludedPoCount,
    needOrderItemsCount,
    needOrderEstimatedBoqRp,
    pendingApprovalAllCount,
    pendingMyApprovalCount,
    readyToSendCount,
    waitingDeliveryCount,
    waitingPaymentCount,
    completedPoCount,
    overdueDeliveryCount,
    overduePaymentCount,
    totalPoCommitmentRp: Math.round(totalPoCommitmentRp),
    totalPoPaidRp: Math.round(totalPoPaidRp),
    totalPoOutstandingRp: Math.round(totalPoOutstandingRp),
    totalBoqSavingsRp: Math.round(totalBoqSavingsRp),
    healthCode,
    healthKey,
    healthLabel,
    healthBadgeClass,
    isPoCritical,
  };
}

/**
 * Bangun objek kontribusi resmi PO_PENGADAAN untuk disuntikkan ke projectReportEngine.ts
 */
export function buildPoModuleContribution(
  purchaseOrders: PurchaseOrder[],
  stockMutations: MutasiBarang[],
  cashMutations: MutasiKas[]
): PoModuleContributionSnapshot {
  let activeCount = 0;
  let totalPaidRp = 0;
  let pendingCount = 0;

  for (const po of purchaseOrders || []) {
    if (isPoRowExcluded(po)) continue;
    activeCount += 1;
    const receive = computePoReceiveProgress(po, stockMutations);
    const payment = computePoPaymentProgress(po, cashMutations);
    totalPaidRp += payment.totalDibayarRp;

    const wf = po.status_dokumen || 'DITERBITKAN';
    if (wf !== 'MENGETAHUI' || receive.totalQtySisaTerima > 0 || payment.sisaBayarRp > 0) {
      pendingCount += 1;
    }
  }

  return {
    moduleCode: 'PO_PENGADAAN',
    moduleLabel: SOURCE_MODULE_LABELS.PO_PENGADAAN,
    status: 'AKTIF',
    transactionCount: activeCount,
    totalInRp: 0,
    totalOutRp: Math.round(totalPaidRp),
    pendingCount,
  };
}

/**
 * Kelas tombol WCAG AA Light/Dark untuk 1 Smart-Button Fixed-Slot PO
 */
export function getPoActionVariantClass(variant: PoActionVariant): string {
  switch (variant) {
    case 'emerald':
      return 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-700/20 shadow-sm dark:bg-emerald-600 dark:hover:bg-emerald-500';
    case 'rose':
      return 'bg-rose-600 hover:bg-rose-700 text-white border-rose-700/20 shadow-sm dark:bg-rose-600 dark:hover:bg-rose-500';
    case 'blue':
      return 'bg-blue-600 hover:bg-blue-700 text-white border-blue-700/20 shadow-sm dark:bg-blue-600 dark:hover:bg-blue-500';
    case 'indigo':
      return 'bg-indigo-600 hover:bg-indigo-700 text-white border-indigo-700/20 shadow-sm dark:bg-indigo-600 dark:hover:bg-indigo-500';
    case 'sky':
      return 'bg-sky-600 hover:bg-sky-700 text-white border-sky-700/20 shadow-sm dark:bg-sky-600 dark:hover:bg-sky-500';
    case 'amber':
      return 'bg-amber-600 hover:bg-amber-700 text-white border-amber-700/20 shadow-sm dark:bg-amber-600 dark:hover:bg-amber-500';
    case 'teal':
      return 'bg-teal-600 hover:bg-teal-700 text-white border-teal-700/20 shadow-sm dark:bg-teal-600 dark:hover:bg-teal-500';
    case 'slate':
      return 'bg-slate-700 hover:bg-slate-800 text-white border-slate-700/20 shadow-sm dark:bg-slate-600 dark:hover:bg-slate-500';
    case 'neutral':
    default:
      return 'bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 dark:border-slate-700';
  }
}

/**
 * Generator nomor PO proyek yang rapi dan unik: PO-YYYYMMDD-XXXX
 */
export function generateNextPoNumber(existingPos: PurchaseOrder[], dateYmd?: string): string {
  const cleanDate = (dateYmd || getTodayLocalDate()).replace(/-/g, '').slice(0, 8);
  const existingSet = new Set((existingPos || []).map((p) => (p.po_no || '').toUpperCase()));
  for (let seq = 1; seq <= 999; seq += 1) {
    const candidate = `PO-${cleanDate}-${String(seq).padStart(3, '0')}`;
    if (!existingSet.has(candidate)) {
      return candidate;
    }
  }
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PO-${cleanDate}-${rand}`;
}
