import {
  AsalBarang,
  ImpersonateRole,
  ItemBarang,
  MutasiBarang,
  PhysicalMaterialItem,
} from '../types';
import {
  getProviderMetaForMaterial,
  isClientProvidedRemark,
  summarizeMaterialIncomingDiscrepancy,
} from './stockMutationEngine';

export const EPS = 0.0001;

export type PartyPOV = 'KONTRAKTOR' | 'KLIEN';
export type RoleAuthority = 'EKSEKUTOR' | 'PENGAWAS_INTERNAL' | 'PENGAMAT_KLIEN';
export type PendingApprovalAction = 'PERIKSA' | 'SETUJU' | 'SAHKAN';

export interface BoqEvalContext {
  activeRole: ImpersonateRole;
  partyPov: PartyPOV;
  authority: RoleAuthority;
  canIssue: boolean;
  canViewFinancials: boolean;
  contractorName: string;
  clientName: string;
}

export type BoqPosStatusKey =
  | 'BELUM_MASUK'
  | 'BELUM_SERAH'
  | 'BELUM_JALAN'
  | 'SIAP_PAKAI'
  | 'PROSES'
  | 'HABIS'
  | 'TUNTAS'
  | 'LEBIH';

export type BoqActionType =
  | 'MASUK'
  | 'PAKAI'
  | 'CATAT_JASA'
  | 'APPROVE'
  | 'RIWAYAT';

export type BoqActionVariant =
  | 'emerald'
  | 'purple'
  | 'rose'
  | 'indigo'
  | 'sky'
  | 'amber'
  | 'teal'
  | 'neutral';

export type BoqActionIcon =
  | 'arrow-down-left'
  | 'arrow-up-right'
  | 'clipboard-check'
  | 'check-circle'
  | 'history';

export interface BoqPosEvaluation {
  stateCode: 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'S-5' | 'S-6' | 'J-1' | 'J-2' | 'J-3' | 'J-4';
  statusKey: BoqPosStatusKey;
  statusLabel: string;
  statusBadgeClass: string;
  statusDescription: string;
  isCriticalShortage: boolean;
  providerAlert?: string;
  providerStockLabel?: string;
  providerStockSubLabel?: string;

  actionType: BoqActionType;
  actionLabel: string;
  actionVariant: BoqActionVariant;
  actionIcon: BoqActionIcon;
  actionTooltip: string;
  showSecondaryHistoryIcon: boolean;
  pendingApprovalAction: PendingApprovalAction | null;
  pendingApprovalCount?: number;
  pendingApprovalMutationId?: string;
  recommendedOrigin: AsalBarang;
  isFreeIssue: boolean;
}

export interface WarehouseRowEvaluation {
  statusKey: 'TERSEDIA' | 'BELUM_MASUK' | 'BELUM_SERAH' | 'HABIS' | 'TUNTAS';
  statusLabel: string;
  actionType: 'MASUK' | 'PAKAI' | 'APPROVE' | 'RIWAYAT';
  actionLabel: string;
  actionVariant: BoqActionVariant;
  actionIcon: BoqActionIcon;
  actionTooltip: string;
  showSecondaryHistoryIcon: boolean;
  pendingApprovalAction: PendingApprovalAction | null;
  pendingApprovalCount?: number;
  pendingApprovalMutationId?: string;
  recommendedOrigin: AsalBarang;
  sisaBelumTiba: number;
  canQuickAddResidual: boolean;
  residualChipVariant: 'emerald' | 'purple' | null;
}

/**
 * Resolusi 3 Sumbu Multi-POV: Mode x Pihak x 7 Peran Operasional
 */
export function resolveEvalContext(
  activeRole: ImpersonateRole,
  canIssue: boolean,
  branding: { contractorName?: string; clientName?: string },
  organizationParty?: PartyPOV
): BoqEvalContext {
  const partyPov: PartyPOV = organizationParty
    ? organizationParty
    : activeRole === 'Viewer/Pengamat'
    ? 'KLIEN'
    : 'KONTRAKTOR';

  let authority: RoleAuthority;
  if (activeRole === 'Clerk') {
    authority = 'EKSEKUTOR';
  } else if (activeRole === 'Viewer/Pengamat') {
    authority = 'PENGAMAT_KLIEN';
  } else {
    authority = 'PENGAWAS_INTERNAL';
  }

  const contractorName = branding.contractorName?.trim() || 'Kontraktor';
  const clientName = branding.clientName?.trim() || 'Klien';
  const canViewFinancials = partyPov === 'KONTRAKTOR';

  return {
    activeRole,
    partyPov,
    authority,
    canIssue,
    canViewFinancials,
    contractorName,
    clientName,
  };
}

/**
 * Helper pemetaan Tailwind classes untuk Smart-Button agar WCAG AA & kontras tinggi
 */
export function getActionVariantClass(variant: BoqActionVariant): string {
  switch (variant) {
    case 'emerald':
      return 'bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95 shadow-xs';
    case 'purple':
      return 'bg-purple-600 hover:bg-purple-700 text-white active:scale-95 shadow-xs';
    case 'rose':
      return 'bg-rose-600 hover:bg-rose-700 text-white active:scale-95 shadow-xs';
    case 'indigo':
      return 'bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95 shadow-xs';
    case 'sky':
      return 'bg-sky-600 hover:bg-sky-700 text-white active:scale-95 shadow-xs';
    case 'amber':
      return 'bg-amber-600 hover:bg-amber-700 text-white active:scale-95 shadow-xs';
    case 'teal':
      return 'bg-teal-600 hover:bg-teal-700 text-white active:scale-95 shadow-xs';
    case 'neutral':
    default:
      return 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-95 border border-slate-200/60 dark:border-slate-700/60';
  }
}

/**
 * Helper pemetaan Tailwind classes untuk micro-chip interaktif di kolom Sisa Belum Tiba
 */
export function getResidualChipClass(variant: 'emerald' | 'purple'): string {
  switch (variant) {
    case 'emerald':
      return 'border border-dashed border-emerald-500/70 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60 transition-colors cursor-pointer';
    case 'purple':
      return 'border border-dashed border-purple-500/70 bg-purple-50/70 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:hover:bg-purple-900/60 transition-colors cursor-pointer';
  }
}

/**
 * Cari antrean mutasi yang sedang menunggu verifikasi/persetujuan peran aktif
 */
function findPendingApprovalForItems(
  itemIds: Set<string>,
  itemName: string,
  stockMutations: MutasiBarang[],
  activeRole: ImpersonateRole
): MutasiBarang[] {
  const normName = itemName.trim().toLowerCase();

  return stockMutations.filter((m) => {
    if (m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') {
      return false;
    }

    const matchesItem =
      (m.barang_id && itemIds.has(m.barang_id)) ||
      (m.nama_barang && m.nama_barang.trim().toLowerCase() === normName);

    if (!matchesItem) return false;

    if (activeRole === 'Foreman') {
      return m.status_dokumen === 'DITERBITKAN';
    }
    if (activeRole === 'Spv.') {
      return m.status_dokumen === 'DIPERIKSA';
    }
    if (
      activeRole === 'Dept. Manager' ||
      activeRole === 'KTT/Proj. Manager' ||
      activeRole === 'CEO/Direktur'
    ) {
      return m.status_dokumen === 'DISETUJUI';
    }

    return false;
  });
}

/**
 * Evaluasi 1 Baris Pos Pekerjaan BOQ (Tab 2 Realisasi Pos BOQ, Master BOQ & Dasbor)
 * Pure function, zero hardcode, zero side effects.
 */
export function evaluateBoqPos(
  item: ItemBarang,
  physicalMaterial: PhysicalMaterialItem | undefined,
  stockMutations: MutasiBarang[],
  context: BoqEvalContext
): BoqPosEvaluation {
  const isClient = isClientProvidedRemark(item.keterangan, context.clientName);
  const recommendedOrigin: AsalBarang = isClient ? 'KLIEN' : 'KONTRAKTOR';
  const isFreeIssue = isClient;
  const target = item.qty_boq || 0;
  const keluarPos = item.qty_keluar_total || 0;

  // Jalur B — Pos Jasa / Upah (is_stock_item === false)
  if (!item.is_stock_item) {
    let stateCode: 'J-1' | 'J-2' | 'J-3' | 'J-4';
    let statusKey: BoqPosStatusKey;
    let statusLabel: string;
    let statusBadgeClass: string;
    let statusDescription: string;

    if (keluarPos >= target - EPS && target > 0) {
      if (keluarPos > target + EPS) {
        stateCode = 'J-4';
        statusKey = 'LEBIH';
        statusLabel = 'Lebih';
        statusBadgeClass =
          'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800';
        statusDescription = 'Realisasi jasa/upah melebihi target kontrak';
      } else {
        stateCode = 'J-3';
        statusKey = 'TUNTAS';
        statusLabel = 'Tuntas';
        statusBadgeClass =
          'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800';
        statusDescription = 'Pekerjaan jasa/upah selesai 100%';
      }
    } else if (keluarPos > 0) {
      stateCode = 'J-2';
      statusKey = 'PROSES';
      statusLabel = 'Proses';
      statusBadgeClass =
        'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800';
      statusDescription = 'Pekerjaan jasa/upah sedang berjalan bertahap';
    } else {
      stateCode = 'J-1';
      statusKey = 'BELUM_JALAN';
      statusLabel = 'Belum Jalan';
      statusBadgeClass =
        'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
      statusDescription = 'Pekerjaan jasa/upah belum dimulai';
    }

    // Resolusi Aksi Cepat / Smart-Button
    const pending = findPendingApprovalForItems(
      new Set([item.id]),
      item.nama_barang,
      stockMutations,
      context.activeRole
    );

    let actionType: BoqActionType = 'RIWAYAT';
    let actionLabel = 'Riwayat';
    let actionVariant: BoqActionVariant = 'neutral';
    let actionIcon: BoqActionIcon = 'history';
    let actionTooltip = 'Lihat riwayat pergerakan pos';
    let showSecondaryHistoryIcon = false;
    let pendingApprovalAction: PendingApprovalAction | null = null;
    let pendingApprovalCount: number | undefined;
    let pendingApprovalMutationId: string | undefined;

    if (context.authority === 'PENGAWAS_INTERNAL' && pending.length > 0) {
      actionType = 'APPROVE';
      showSecondaryHistoryIcon = true;
      pendingApprovalCount = pending.length;
      pendingApprovalMutationId = pending[0].id;

      if (context.activeRole === 'Foreman') {
        pendingApprovalAction = 'PERIKSA';
        actionLabel = pending.length > 1 ? `Periksa · ${pending.length}` : 'Periksa';
        actionVariant = 'sky';
        actionIcon = 'check-circle';
        actionTooltip = 'Periksa realisasi jasa yang menunggu pemeriksaan';
      } else if (context.activeRole === 'Spv.') {
        pendingApprovalAction = 'SETUJU';
        actionLabel = pending.length > 1 ? `Setuju · ${pending.length}` : 'Setuju';
        actionVariant = 'amber';
        actionIcon = 'check-circle';
        actionTooltip = 'Setujui realisasi jasa yang menunggu persetujuan';
      } else {
        pendingApprovalAction = 'SAHKAN';
        actionLabel = pending.length > 1 ? `Sahkan · ${pending.length}` : 'Sahkan';
        actionVariant = 'teal';
        actionIcon = 'check-circle';
        actionTooltip = 'Sahkan dokumen jasa dengan TTE QR';
      }
    } else if (context.authority === 'EKSEKUTOR') {
      if (stateCode === 'J-3' || stateCode === 'J-4') {
        actionType = 'RIWAYAT';
        actionLabel = 'Riwayat';
        actionVariant = 'neutral';
        actionIcon = 'history';
        actionTooltip = 'Pos selesai — lihat riwayat mutasi';
        showSecondaryHistoryIcon = false;
      } else {
        actionType = 'CATAT_JASA';
        actionLabel = 'Catat';
        actionVariant = 'indigo';
        actionIcon = 'clipboard-check';
        actionTooltip = 'Catat realisasi jasa/upah ke pos BOQ ini';
        showSecondaryHistoryIcon = true;
      }
    }

    return {
      stateCode,
      statusKey,
      statusLabel,
      statusBadgeClass,
      statusDescription,
      isCriticalShortage: false,
      actionType,
      actionLabel,
      actionVariant,
      actionIcon,
      actionTooltip,
      showSecondaryHistoryIcon,
      pendingApprovalAction,
      pendingApprovalCount,
      pendingApprovalMutationId,
      recommendedOrigin,
      isFreeIssue,
    };
  }

  // Jalur A — Material Fisik (is_stock_item === true)
  let effectiveStock = physicalMaterial ? physicalMaterial.stok_fisik : item.stok_saat_ini || 0;
  let providerAlert: string | undefined;
  let providerStockLabel: string | undefined;
  let providerStockSubLabel: string | undefined;

  const provMeta = physicalMaterial
    ? getProviderMetaForMaterial(physicalMaterial, {
        contractorName: context.contractorName,
        clientName: context.clientName,
      })
    : null;

  if (provMeta && provMeta.isMixed && physicalMaterial) {
    const disc = summarizeMaterialIncomingDiscrepancy(physicalMaterial, stockMutations, {
      contractorName: context.contractorName,
      clientName: context.clientName,
    });

    const terpakaiKlien = physicalMaterial.budget_lines
      .filter((bl) => isClientProvidedRemark(bl.keterangan, context.clientName))
      .reduce((sum, bl) => sum + (bl.qty_keluar_total || 0), 0);

    const terpakaiKontraktor = physicalMaterial.budget_lines
      .filter((bl) => !isClientProvidedRemark(bl.keterangan, context.clientName))
      .reduce((sum, bl) => sum + (bl.qty_keluar_total || 0), 0);

    const fmt = (n: number) => n.toLocaleString('id-ID', { maximumFractionDigits: 3 });

    if (isClient) {
      const netKlien = Math.max(0, disc.masukKlien - terpakaiKlien);
      effectiveStock = Math.min(netKlien, physicalMaterial.stok_fisik);
      providerStockLabel = `Porsi Klien: ${fmt(effectiveStock)} ${item.satuan}`;
      providerStockSubLabel = `(Stok Kontraktor: ${fmt(physicalMaterial.stok_fisik)} ${item.satuan})`;

      if (physicalMaterial.stok_fisik > 0 && effectiveStock <= 0) {
        providerAlert =
          'Stok gudang berasal dari porsi Kontraktor — pemakaian tercatat sebagai Talangan.';
      }
    } else {
      const netKontraktor = Math.max(0, disc.masukKontraktor - terpakaiKontraktor);
      effectiveStock = Math.min(netKontraktor, physicalMaterial.stok_fisik);
      providerStockLabel = `Porsi Kontraktor: ${fmt(effectiveStock)} ${item.satuan}`;
      if (disc.masukKlien > 0) {
        const sisaKlienFisik = Math.min(
          Math.max(0, disc.masukKlien - terpakaiKlien),
          physicalMaterial.stok_fisik
        );
        providerStockSubLabel = `(Stok Klien: ${fmt(sisaKlienFisik)} ${item.satuan})`;
      }

      if (physicalMaterial.stok_fisik > 0 && effectiveStock <= 0) {
        providerAlert =
          'Stok gudang berasal dari porsi Klien — pemakaian tercatat sebagai Dipasok Klien.';
      }
    }
  }

  // State Machine S-1 s.d. S-6
  let stateCode: 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'S-5' | 'S-6';
  let statusKey: BoqPosStatusKey;
  let statusLabel: string;
  let statusBadgeClass: string;
  let statusDescription: string;
  let isCriticalShortage = false;

  if (keluarPos >= target - EPS && target > 0) {
    if (keluarPos > target + EPS) {
      stateCode = 'S-6';
      statusKey = 'LEBIH';
      statusLabel = 'Lebih';
      statusBadgeClass =
        'bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800';
      statusDescription = 'Realisasi pemakaian melampaui volume kontrak BOQ';
    } else {
      stateCode = 'S-5';
      statusKey = 'TUNTAS';
      statusLabel = 'Tuntas';
      statusBadgeClass =
        'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800';
      statusDescription = 'Volume pekerjaan pos terpasang 100% sesuai target BOQ';
    }
  } else if (effectiveStock <= 0) {
    if (keluarPos <= 0) {
      stateCode = 'S-1';
      if (isClient && context.partyPov === 'KLIEN') {
        statusKey = 'BELUM_SERAH';
        statusLabel = 'Belum Serah';
        statusBadgeClass =
          'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700';
        statusDescription = 'Kewajiban pengadaan Jatah Klien belum diserahkan ke proyek';
      } else {
        statusKey = 'BELUM_MASUK';
        statusLabel = 'Belum Masuk';
        statusBadgeClass =
          'bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700';
        statusDescription = 'Material belum tiba di gudang proyek';
      }
    } else {
      stateCode = 'S-4';
      isCriticalShortage = true; // Kunci alarm darurat S-4
      if (isClient && context.partyPov === 'KLIEN') {
        statusKey = 'BELUM_SERAH';
        statusLabel = 'Belum Serah';
        statusBadgeClass =
          'bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700';
        statusDescription = 'Stok proyek habis, mohon serahkan sisa material Jatah Klien';
      } else {
        statusKey = 'HABIS';
        statusLabel = 'Habis';
        statusBadgeClass =
          'bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700';
        statusDescription = 'Pekerjaan sedang berjalan namun stok gudang habis';
      }
    }
  } else {
    // effectiveStock > 0
    if (keluarPos <= 0) {
      stateCode = 'S-2';
      statusKey = 'SIAP_PAKAI';
      statusLabel = 'Siap Pakai';
      statusBadgeClass =
        'bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-200 dark:border-cyan-800';
      statusDescription = 'Material porsi pos tersedia di gudang dan siap digunakan';
    } else {
      stateCode = 'S-3';
      statusKey = 'PROSES';
      statusLabel = 'Proses';
      statusBadgeClass =
        'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800';
      statusDescription = 'Pekerjaan pos sedang berjalan dan stok gudang masih tersedia';
    }
  }

  // Resolusi Smart-Button Tab 2
  const pending = findPendingApprovalForItems(
    new Set([item.id]),
    item.nama_barang,
    stockMutations,
    context.activeRole
  );

  let actionType: BoqActionType = 'RIWAYAT';
  let actionLabel = 'Riwayat';
  let actionVariant: BoqActionVariant = 'neutral';
  let actionIcon: BoqActionIcon = 'history';
  let actionTooltip = 'Lihat riwayat pergerakan pos';
  let showSecondaryHistoryIcon = false;
  let pendingApprovalAction: PendingApprovalAction | null = null;
  let pendingApprovalCount: number | undefined;
  let pendingApprovalMutationId: string | undefined;

  if (context.authority === 'PENGAWAS_INTERNAL' && pending.length > 0) {
    actionType = 'APPROVE';
    showSecondaryHistoryIcon = true;
    pendingApprovalCount = pending.length;
    pendingApprovalMutationId = pending[0].id;

    if (context.activeRole === 'Foreman') {
      pendingApprovalAction = 'PERIKSA';
      actionLabel = pending.length > 1 ? `Periksa · ${pending.length}` : 'Periksa';
      actionVariant = 'sky';
      actionIcon = 'check-circle';
      actionTooltip = 'Periksa transaksi mutasi yang menunggu verifikasi';
    } else if (context.activeRole === 'Spv.') {
      pendingApprovalAction = 'SETUJU';
      actionLabel = pending.length > 1 ? `Setuju · ${pending.length}` : 'Setuju';
      actionVariant = 'amber';
      actionIcon = 'check-circle';
      actionTooltip = 'Setujui transaksi mutasi yang telah diperiksa';
    } else {
      pendingApprovalAction = 'SAHKAN';
      actionLabel = pending.length > 1 ? `Sahkan · ${pending.length}` : 'Sahkan';
      actionVariant = 'teal';
      actionIcon = 'check-circle';
      actionTooltip = 'Sahkan dokumen mutasi dengan TTE QR';
    }
  } else if (context.authority === 'EKSEKUTOR') {
    if (stateCode === 'S-5' || stateCode === 'S-6') {
      actionType = 'RIWAYAT';
      actionLabel = 'Riwayat';
      actionVariant = 'neutral';
      actionIcon = 'history';
      actionTooltip = 'Pos selesai — lihat riwayat mutasi';
      showSecondaryHistoryIcon = false;
    } else if (stateCode === 'S-2' || stateCode === 'S-3') {
      actionType = 'PAKAI';
      actionLabel = 'Pakai';
      actionVariant = 'rose';
      actionIcon = 'arrow-up-right';
      actionTooltip = 'Catat pengeluaran material ke pos pekerjaan';
      showSecondaryHistoryIcon = true;
    } else {
      // S-1 or S-4
      actionType = 'MASUK';
      actionLabel = 'Masuk';
      actionIcon = 'arrow-down-left';
      showSecondaryHistoryIcon = true;
      if (isClient) {
        actionVariant = 'purple';
        actionTooltip = 'Terima serah terima barang dari Klien (Rp 0)';
      } else {
        actionVariant = 'emerald';
        actionTooltip = 'Catat kedatangan barang belanja Kontraktor';
      }
    }
  }

  return {
    stateCode,
    statusKey,
    statusLabel,
    statusBadgeClass,
    statusDescription,
    isCriticalShortage,
    providerAlert,
    providerStockLabel,
    providerStockSubLabel,
    actionType,
    actionLabel,
    actionVariant,
    actionIcon,
    actionTooltip,
    showSecondaryHistoryIcon,
    pendingApprovalAction,
    pendingApprovalCount,
    pendingApprovalMutationId,
    recommendedOrigin,
    isFreeIssue,
  };
}

/**
 * Evaluasi 1 Baris Rekap Material Fisik Gudang (Tab 1 Stok Gudang & PDF Rekap Gudang)
 * Pure function, zero hardcode, zero side effects.
 */
export function evaluateWarehouseMaterial(
  pm: PhysicalMaterialItem,
  stockMutations: MutasiBarang[],
  context: BoqEvalContext
): WarehouseRowEvaluation {
  const stokFisik = pm.stok_fisik || 0;
  const totalMasuk = pm.total_qty_masuk || 0;
  const totalTarget = pm.total_qty_boq || 0;
  const totalKeluar = pm.total_qty_keluar || 0;
  const sisaBelumTiba = Math.max(0, totalTarget - totalMasuk);

  const disc = summarizeMaterialIncomingDiscrepancy(pm, stockMutations, {
    contractorName: context.contractorName,
    clientName: context.clientName,
  });

  const recommendedOrigin: AsalBarang =
    disc.kontraktorSisaQty <= 0 && disc.imkSisaQty > 0 ? 'KLIEN' : 'KONTRAKTOR';

  // Status Gudang
  let statusKey: 'TERSEDIA' | 'BELUM_MASUK' | 'BELUM_SERAH' | 'HABIS' | 'TUNTAS';
  let statusLabel: string;

  if (stokFisik > 0) {
    statusKey = 'TERSEDIA';
    statusLabel = 'Tersedia';
  } else if (totalMasuk <= 0) {
    if (context.partyPov === 'KLIEN' && disc.imkSisaQty > 0) {
      statusKey = 'BELUM_SERAH';
      statusLabel = 'Belum Serah';
    } else {
      statusKey = 'BELUM_MASUK';
      statusLabel = 'Belum Masuk';
    }
  } else if (sisaBelumTiba > 0) {
    if (context.partyPov === 'KLIEN' && disc.imkSisaQty > 0) {
      statusKey = 'BELUM_SERAH';
      statusLabel = 'Belum Serah';
    } else {
      statusKey = 'HABIS';
      statusLabel = 'Habis';
    }
  } else {
    // totalMasuk > 0 && sisaBelumTiba <= 0
    // Cek apakah seluruh pos BOQ terkait sudah tuntas terpakai
    const allPosFinished = totalKeluar >= totalTarget - EPS;
    if (allPosFinished) {
      statusKey = 'TUNTAS';
      statusLabel = 'Tuntas';
    } else {
      statusKey = 'HABIS';
      statusLabel = 'Habis';
    }
  }

  // Micro-chip interaktif sisa belum tiba (Khusus Clerk saat ada stok & masih ada sisa tiba)
  const canQuickAddResidual = context.authority === 'EKSEKUTOR' && stokFisik > 0 && sisaBelumTiba > 0;
  let residualChipVariant: 'emerald' | 'purple' | null = null;
  if (canQuickAddResidual) {
    residualChipVariant = disc.kontraktorSisaQty <= 0 && disc.imkSisaQty > 0 ? 'purple' : 'emerald';
  }

  // Resolusi Smart-Button Tab 1
  const lineIds = new Set([pm.id, ...pm.budget_lines.map((bl) => bl.id)]);
  const pending = findPendingApprovalForItems(
    lineIds,
    pm.nama_barang,
    stockMutations,
    context.activeRole
  );

  let actionType: 'MASUK' | 'PAKAI' | 'APPROVE' | 'RIWAYAT' = 'RIWAYAT';
  let actionLabel = 'Riwayat';
  let actionVariant: BoqActionVariant = 'neutral';
  let actionIcon: BoqActionIcon = 'history';
  let actionTooltip = 'Lihat riwayat pergerakan stok';
  let showSecondaryHistoryIcon = false;
  let pendingApprovalAction: PendingApprovalAction | null = null;
  let pendingApprovalCount: number | undefined;
  let pendingApprovalMutationId: string | undefined;

  if (context.authority === 'PENGAWAS_INTERNAL' && pending.length > 0) {
    actionType = 'APPROVE';
    showSecondaryHistoryIcon = true;
    pendingApprovalCount = pending.length;
    pendingApprovalMutationId = pending[0].id;

    if (context.activeRole === 'Foreman') {
      pendingApprovalAction = 'PERIKSA';
      actionLabel = pending.length > 1 ? `Periksa · ${pending.length}` : 'Periksa';
      actionVariant = 'sky';
      actionIcon = 'check-circle';
      actionTooltip = 'Periksa transaksi mutasi yang menunggu verifikasi';
    } else if (context.activeRole === 'Spv.') {
      pendingApprovalAction = 'SETUJU';
      actionLabel = pending.length > 1 ? `Setuju · ${pending.length}` : 'Setuju';
      actionVariant = 'amber';
      actionIcon = 'check-circle';
      actionTooltip = 'Setujui transaksi mutasi yang telah diperiksa';
    } else {
      pendingApprovalAction = 'SAHKAN';
      actionLabel = pending.length > 1 ? `Sahkan · ${pending.length}` : 'Sahkan';
      actionVariant = 'teal';
      actionIcon = 'check-circle';
      actionTooltip = 'Sahkan dokumen mutasi dengan TTE QR';
    }
  } else if (context.authority === 'EKSEKUTOR') {
    if (statusKey === 'TUNTAS') {
      actionType = 'RIWAYAT';
      actionLabel = 'Riwayat';
      actionVariant = 'neutral';
      actionIcon = 'history';
      actionTooltip = 'Material tuntas — lihat riwayat mutasi';
      showSecondaryHistoryIcon = false;
    } else if (stokFisik > 0) {
      actionType = 'PAKAI';
      actionLabel = 'Pakai';
      actionVariant = 'rose';
      actionIcon = 'arrow-up-right';
      actionTooltip = 'Catat pengeluaran fisik dari gudang ke pos pekerjaan';
      showSecondaryHistoryIcon = true;
    } else {
      // stokFisik <= 0
      actionType = 'MASUK';
      actionLabel = 'Masuk';
      actionIcon = 'arrow-down-left';
      showSecondaryHistoryIcon = true;
      if (recommendedOrigin === 'KLIEN') {
        actionVariant = 'purple';
        actionTooltip = 'Terima serah terima barang dari Klien (Rp 0)';
      } else {
        actionVariant = 'emerald';
        actionTooltip = 'Catat kedatangan barang belanja Kontraktor';
      }
    }
  }

  return {
    statusKey,
    statusLabel,
    actionType,
    actionLabel,
    actionVariant,
    actionIcon,
    actionTooltip,
    showSecondaryHistoryIcon,
    pendingApprovalAction,
    pendingApprovalCount,
    pendingApprovalMutationId,
    recommendedOrigin,
    sisaBelumTiba,
    canQuickAddResidual,
    residualChipVariant,
  };
}
