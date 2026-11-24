import React, { useState, useMemo, startTransition } from 'react';
import { useApp } from '../context/AppContext';
import {
  FileText,
  Download,
  QrCode,
  ShieldCheck,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  Printer,
  Boxes,
  WalletCards,
  ClipboardCheck,
  Building2,
  Search,
  ArrowUpDown,
  Check,
  BadgeCheck,
  Package,
  Layers,
  Combine,
  FileCheck2,
  Sparkles,
} from 'lucide-react';
import {
  generateStockMutationPDF,
  generateCashflowPDF,
  generateBOQReportPDF,
  generateWarehouseSummaryPDF,
  generateIntegratedProjectReportPDF,
  formatDateTime,
  formatDateOnly,
  formatRupiah,
} from '../lib/pdfGenerator';
import {
  getCashActionVariantClass,
  getPendingApprovalForRole,
  isCashRowExcluded,
} from '../lib/cashflowEngine';
import {
  buildIntegratedProjectReport,
  filterDocumentsForPov,
} from '../lib/projectReportEngine';
import { buildPoModuleContribution } from '../lib/procurementEngine';
import { DocumentAudiencePov, MutasiKas } from '../types';
import { ExportSettingsModal, ExportSettingsConfig } from './ExportSettingsModal';

const DOC_STATUS_LABELS: Record<string, string> = {
  DITERBITKAN: 'Tahap 1 · Diterbitkan',
  DIPERIKSA: 'Tahap 2 · Diperiksa',
  DISETUJUI: 'Tahap 3 · Disetujui',
  MENGETAHUI: 'Tahap 4 · Sah (TTE/QR)',
  BATAL: 'Dibatalkan',
  DIGANTI: 'Diganti',
};

export const ReportsView: React.FC = () => {
  const {
    stockMutations,
    physicalMaterials,
    items,
    cashMutations,
    purchaseOrders,
    projectReceipts,
    documents,
    activeProject,
    user,
    setVerifyingDocId,
    setCurrentView,
    goBack,
    dataReady,
    tenantBranding,
    activeRole,
    rolePermissions,
    canViewFinancials,
    issueOfficialDocument,
    advanceDocumentWorkflow,
  } = useApp();

  const isViewer = activeRole === 'Viewer/Pengamat';
  const canReadCash = !isViewer && canViewFinancials && Boolean(activeProject?.permissions.includes('cash.read') ?? true);
  const canReadDocuments = Boolean(activeProject?.permissions.includes('document.read') ?? true);

  // 5 Jenis Laporan yang Didukung
  const [rawReportType, setReportType] = useState<'stock' | 'cash' | 'boq' | 'warehouse' | 'integrated'>('stock');
  const reportType = rawReportType === 'cash' && !canReadCash ? 'stock' : rawReportType;

  // Pilihan Edisi Sudut Pandang untuk Laporan Proyek Terpadu (Pengamat selalu dikunci ke KLIEN)
  const [integratedEdition, setIntegratedEdition] = useState<'KONTRAKTOR' | 'KLIEN'>('KONTRAKTOR');
  const effectiveIntegratedPov: 'KONTRAKTOR' | 'KLIEN' =
    isViewer || !canViewFinancials ? 'KLIEN' : integratedEdition;

  // Rentang Tanggal
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().split('T')[0]);

  // Filter & Pencarian
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState<'DATE_DESC' | 'DATE_ASC' | 'AMOUNT_DESC' | 'AMOUNT_ASC'>('DATE_DESC');

  // State Modal Ekspor, Penerbitan Arsip & Notifikasi
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isIssuingIntegrated, setIsIssuingIntegrated] = useState(false);
  const [advancingDocId, setAdvancingDocId] = useState<string | null>(null);
  const [generationSuccess, setGenerationSuccess] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  // Saring arsip dokumen sesuai sudut pandang pihak aktif (zero leakage untuk Pengamat / non-finansial)
  const visibleDocuments = useMemo(
    () => filterDocumentsForPov(documents, isViewer || !canViewFinancials ? 'KLIEN' : 'KONTRAKTOR'),
    [documents, isViewer, canViewFinancials]
  );

  // Agregator Laporan Proyek Terpadu (Segitiga Kontrol Proyek)
  const integratedReport = useMemo(
    () =>
      buildIntegratedProjectReport({
        activeRole: effectiveIntegratedPov === 'KLIEN' ? 'Viewer/Pengamat' : activeRole,
        canViewFinancials: effectiveIntegratedPov === 'KONTRAKTOR' && canViewFinancials,
        items,
        physicalMaterials,
        stockMutations,
        cashMutations,
        projectReceipts,
        documents,
        externalContributions: [
          buildPoModuleContribution(purchaseOrders, stockMutations, cashMutations),
        ],
        branding: {
          projectName: activeProject?.name || tenantBranding.projectName || 'Proyek Aktif',
          contractorName: tenantBranding.contractorName,
          clientName: tenantBranding.clientName,
        },
      }),
    [
      effectiveIntegratedPov,
      activeRole,
      canViewFinancials,
      items,
      physicalMaterials,
      stockMutations,
      cashMutations,
      purchaseOrders,
      projectReceipts,
      documents,
      activeProject?.name,
      tenantBranding.projectName,
      tenantBranding.contractorName,
      tenantBranding.clientName,
    ]
  );

  // Shortcut Tanggal Cepat (Prasetel)
  const applyDatePreset = (preset: 'today' | '7days' | '30days' | 'thisMonth' | 'all') => {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    if (preset === 'today') {
      setStartDate(todayStr);
      setEndDate(todayStr);
    } else if (preset === '7days') {
      const d = new Date();
      d.setDate(d.getDate() - 7);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === '30days') {
      const d = new Date();
      d.setDate(d.getDate() - 30);
      setStartDate(d.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === 'thisMonth') {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      setStartDate(firstDay.toISOString().split('T')[0]);
      setEndDate(todayStr);
    } else if (preset === 'all') {
      setStartDate('2020-01-01');
      setEndDate(todayStr);
    }
  };

  // Hitung jumlah baris data & ringkasan metrik yang cocok secara reaktif
  const matchingData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    if (reportType === 'stock') {
      const filtered = stockMutations.filter((m) => {
        const dateOnly = m.tanggal.split('T')[0];
        const matchDate = dateOnly >= startDate && dateOnly <= endDate;
        const matchType = filterType === 'ALL' || m.jenis === filterType;
        const matchSearch =
          !q ||
          (m.nama_barang || '').toLowerCase().includes(q) ||
          (m.tujuan_keperluan || '').toLowerCase().includes(q) ||
          (m.pic_penerima_penyerah || '').toLowerCase().includes(q) ||
          (m.nomor_surat_jalan || '').toLowerCase().includes(q) ||
          (m.nomor_nota || '').toLowerCase().includes(q) ||
          (m.nama_toko || '').toLowerCase().includes(q);
        return matchDate && matchType && matchSearch;
      });

      const materialPriceMap = new Map<string, number>();
      (physicalMaterials || []).forEach((pm) => {
        const p =
          pm.harga_beli_rata_rata ||
          pm.harga_beli_terakhir ||
          (pm.total_qty_masuk > 0 && pm.total_nilai_belanja_riil != null && pm.total_nilai_belanja_riil > 0
            ? Math.round(pm.total_nilai_belanja_riil / pm.total_qty_masuk)
            : 0);
        if (p > 0) {
          materialPriceMap.set(pm.id, p);
          materialPriceMap.set(pm.nama_barang.trim().toLowerCase(), p);
        }
      });

      const boqPriceMap = new Map<string, number>();
      (items || []).forEach((it) => {
        if (it.harga_satuan > 0) {
          boqPriceMap.set(it.id, it.harga_satuan);
          boqPriceMap.set(it.nama_barang.trim().toLowerCase(), it.harga_satuan);
        }
      });

      const totalVolume = filtered.reduce((acc, m) => acc + (Number(m.jumlah) || 0), 0);
      const totalNilai = canViewFinancials
        ? filtered.reduce((acc, m) => {
            if (m.total_nota_fisik) return acc + Number(m.total_nota_fisik);
            const explicitPrice =
              m.harga_satuan_beli != null && Number(m.harga_satuan_beli) > 0 ? Number(m.harga_satuan_beli) : null;
            const fallbackPrice =
              materialPriceMap.get(m.barang_id) ||
              materialPriceMap.get((m.nama_barang || '').trim().toLowerCase()) ||
              boqPriceMap.get(m.barang_id) ||
              boqPriceMap.get((m.nama_barang || '').trim().toLowerCase()) ||
              0;
            const effPrice = explicitPrice ?? fallbackPrice;
            if (effPrice > 0) return acc + effPrice * Number(m.jumlah || 0);
            return acc;
          }, 0)
        : 0;

      return {
        count: filtered.length,
        totalVolume,
        totalNilai,
        totalMasuk: 0,
        totalKeluar: 0,
        excludedCount: 0,
        items: filtered,
      };
    }

    if (reportType === 'cash') {
      const filtered = cashMutations.filter((c) => {
        const dateOnly = c.tanggal.split('T')[0];
        const matchDate = dateOnly >= startDate && dateOnly <= endDate;
        const matchType = filterType === 'ALL' || c.jenis === filterType;
        const matchSearch =
          !q ||
          (c.untuk_apa || '').toLowerCase().includes(q) ||
          (c.pic || '').toLowerCase().includes(q) ||
          (c.nomor_kuitansi || '').toLowerCase().includes(q) ||
          (c.nama_toko || '').toLowerCase().includes(q) ||
          (c.kategori_keperluan || '').toLowerCase().includes(q);
        return matchDate && matchType && matchSearch;
      });

      const activeOnly = filtered.filter((c) => !isCashRowExcluded(c));
      const totalMasuk = activeOnly
        .filter((c) => c.jenis === 'MASUK')
        .reduce((acc, c) => acc + (Number(c.jumlah_rp) || 0), 0);
      const totalKeluar = activeOnly
        .filter((c) => c.jenis === 'KELUAR')
        .reduce((acc, c) => acc + (Number(c.jumlah_rp) || 0), 0);

      return {
        count: filtered.length,
        totalVolume: activeOnly.length,
        totalNilai: totalMasuk - totalKeluar,
        totalMasuk,
        totalKeluar,
        excludedCount: filtered.length - activeOnly.length,
        items: filtered,
      };
    }

    if (reportType === 'boq') {
      const filtered = (items || []).filter((b) => {
        return !q || (b.nama_barang || '').toLowerCase().includes(q) || (b.kategori || '').toLowerCase().includes(q);
      });
      const totalNilai = canViewFinancials
        ? filtered.reduce((acc, b) => acc + Number(b.harga_satuan || 0) * Number(b.qty_boq || 0), 0)
        : 0;
      return {
        count: filtered.length,
        totalVolume: filtered.length,
        totalNilai,
        totalMasuk: 0,
        totalKeluar: 0,
        excludedCount: 0,
        items: filtered,
      };
    }

    if (reportType === 'warehouse') {
      const filtered = (physicalMaterials || []).filter((p) => {
        return !q || (p.nama_barang || '').toLowerCase().includes(q);
      });
      const totalVolume = filtered.reduce((acc, p) => acc + (Number(p.stok_fisik) || 0), 0);
      return {
        count: filtered.length,
        totalVolume,
        totalNilai: 0,
        totalMasuk: 0,
        totalKeluar: 0,
        excludedCount: 0,
        items: filtered,
      };
    }

    // Laporan Proyek Terpadu (Selalu tersedia minimal 1 laporan menyeluruh)
    const totalEntities =
      integratedReport.physicalProgress.totalPosCount +
      (integratedReport.cashMetrics?.activeCount || 0) +
      integratedReport.receiptIndex.length;

    return {
      count: Math.max(totalEntities, 1),
      totalVolume: integratedReport.physicalProgress.totalPosCount,
      totalNilai: integratedReport.reconciliation?.totalAsetKerjaProyekRp || 0,
      totalMasuk: integratedReport.cashMetrics?.totalMasukAktif || 0,
      totalKeluar: integratedReport.cashMetrics?.totalKeluarAktif || 0,
      excludedCount: 0,
      items: [],
    };
  }, [
    reportType,
    stockMutations,
    cashMutations,
    items,
    physicalMaterials,
    startDate,
    endDate,
    filterType,
    searchQuery,
    canViewFinancials,
    integratedReport,
  ]);

  // Buka Modal Konfigurasi Ekspor
  const handleOpenExportModal = (e: React.FormEvent) => {
    e.preventDefault();
    setGenerationSuccess(null);
    setGenerationError(null);

    if (reportType === 'cash' && !canReadCash) {
      setGenerationError('Jabatan Anda tidak memiliki hak akses untuk mengekspor Buku Kas Proyek.');
      return;
    }
    if ((reportType === 'stock' || reportType === 'cash') && (!startDate || !endDate || startDate > endDate)) {
      setGenerationError('Rentang tanggal tidak valid. Tanggal awal harus sebelum atau sama dengan tanggal akhir.');
      return;
    }
    if (reportType !== 'integrated' && matchingData.count === 0) {
      setGenerationError('Tidak ada baris data yang cocok dengan kriteria saringan saat ini.');
      return;
    }

    startTransition(() => {
      setIsExportModalOpen(true);
    });
  };

  // Terbitkan Laporan Proyek Terpadu Resmi ke Tabel documents (masuk alur persetujuan 4 tingkat)
  const handleIssueIntegratedDocument = async () => {
    if (!rolePermissions.canIssue || isIssuingIntegrated) return;
    setIsIssuingIntegrated(true);
    setGenerationSuccess(null);
    setGenerationError(null);
    try {
      const edition: DocumentAudiencePov = effectiveIntegratedPov;
      const projectName = activeProject?.name || tenantBranding.projectName || 'Proyek Aktif';
      const title =
        edition === 'KONTRAKTOR'
          ? `Laporan Proyek Terpadu Lengkap — ${projectName}`
          : `Laporan Progres Fisik & Serah Terima Proyek (Edisi Klien) — ${projectName}`;
      const summary =
        edition === 'KONTRAKTOR'
          ? `Serapan fisik BOQ ${integratedReport.physicalProgress.serapanFisikPct}% (${integratedReport.physicalProgress.tuntasCount}/${integratedReport.physicalProgress.totalPosCount} pos) · Saldo Kas ${formatRupiah(integratedReport.cashMetrics?.saldoSaatIni || 0)} · Valuasi Stok ${formatRupiah(integratedReport.reconciliation?.valuasiStokGudangRp || 0)}`
          : `Serapan fisik BOQ ${integratedReport.physicalProgress.serapanFisikPct}% (${integratedReport.physicalProgress.tuntasCount}/${integratedReport.physicalProgress.totalPosCount} pos tuntas · ${integratedReport.physicalProgress.prosesCount} berjalan)`;

      const res = await issueOfficialDocument({
        jenis: 'GABUNGAN_PROYEK',
        judul: title,
        periode: `${formatDateOnly(startDate)} s/d ${formatDateOnly(endDate)}`,
        ringkasan: summary,
        total_nilai_atau_item:
          edition === 'KONTRAKTOR'
            ? formatRupiah(integratedReport.reconciliation?.totalAsetKerjaProyekRp || 0)
            : `${integratedReport.physicalProgress.totalPosCount} Pos Pekerjaan`,
        audience_pov: edition,
        extraSnapshot: {
          party_pov: edition,
          serapan_fisik_pct: integratedReport.physicalProgress.serapanFisikPct,
          total_pos_boq: integratedReport.physicalProgress.totalPosCount,
          saldo_kas_rp: edition === 'KONTRAKTOR' ? integratedReport.cashMetrics?.saldoSaatIni || 0 : null,
          aset_kerja_rp:
            edition === 'KONTRAKTOR' ? integratedReport.reconciliation?.totalAsetKerjaProyekRp || 0 : null,
        },
      });
      if (res.success) {
        setGenerationSuccess(res.message);
      } else {
        setGenerationError(res.message);
      }
    } catch (err: any) {
      setGenerationError(err?.message || 'Gagal menerbitkan dokumen Laporan Proyek Terpadu.');
    } finally {
      setIsIssuingIntegrated(false);
    }
  };

  // Proses persetujuan dokumen langsung dari daftar arsip resmi
  const handleAdvanceDoc = async (docDbId: string, nextStatus: 'DIPERIKSA' | 'DISETUJUI' | 'MENGETAHUI') => {
    setAdvancingDocId(docDbId);
    setGenerationSuccess(null);
    setGenerationError(null);
    try {
      const res = await advanceDocumentWorkflow(docDbId, nextStatus);
      if (res.success) {
        setGenerationSuccess(res.message);
      } else {
        setGenerationError(res.message);
      }
    } finally {
      setAdvancingDocId(null);
    }
  };

  // Eksekusi Pembuatan Dokumen PDF
  const handleConfirmExport = async (config: ExportSettingsConfig) => {
    setIsGenerating(true);
    setGenerationSuccess(null);
    setGenerationError(null);
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const docId = `RPT-${reportType.toUpperCase()}-${dateTag}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
      const projectName = activeProject?.name || tenantBranding.contractorName || 'Proyek Aktif';

      if (reportType === 'stock') {
        const sortedList = [...(matchingData.items as any[])].sort((a, b) => {
          if (sortOrder === 'DATE_DESC') return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime();
          if (sortOrder === 'DATE_ASC') return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
          if (sortOrder === 'AMOUNT_DESC') return b.jumlah - a.jumlah;
          if (sortOrder === 'AMOUNT_ASC') return a.jumlah - b.jumlah;
          return 0;
        });

        const sortLabel =
          sortOrder === 'DATE_DESC'
            ? 'Terbaru'
            : sortOrder === 'DATE_ASC'
            ? 'Terlama'
            : sortOrder === 'AMOUNT_DESC'
            ? 'Volume Terbesar'
            : 'Volume Terkecil';
        const typeLabel = filterType === 'ALL' ? 'Semua Arus' : filterType === 'MASUK' ? 'Barang Masuk' : 'Barang Keluar';
        const searchPart = searchQuery.trim() ? ` · Cari: "${searchQuery.trim()}"` : '';

        await generateStockMutationPDF({
          docId,
          startDate,
          endDate,
          mutations: sortedList,
          signer: user,
          projectName,
          physicalMaterials,
          branding: tenantBranding,
          filterSummary: `${typeLabel}${searchPart} · Urut: ${sortLabel}`,
          customTitle: config.customTitle || 'LAPORAN REKAPITULASI MUTASI BARANG & MATERIAL',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape',
        });

        setGenerationSuccess(`Dokumen Laporan Mutasi Barang ${docId} (${sortedList.length} transaksi) berhasil dicetak dan diunduh.`);
      } else if (reportType === 'cash') {
        let filteredForExport: MutasiKas[] = [...(matchingData.items as MutasiKas[])];
        if (config.filterScope.onlyActive) {
          filteredForExport = filteredForExport.filter((c) => !isCashRowExcluded(c));
        }
        if (config.filterScope.transactionType !== 'ALL') {
          filteredForExport = filteredForExport.filter((c) => c.jenis === config.filterScope.transactionType);
        }
        if (config.filterScope.onlyKasbon) {
          filteredForExport = filteredForExport.filter(
            (c) => c.is_kasbon || c.kategori_keperluan === 'Panjar / Kasbon' || Boolean(c.kasbon_induk_id)
          );
        }
        if (config.filterScope.onlyClientClaim) {
          filteredForExport = filteredForExport.filter(
            (c) =>
              c.beban_biaya === 'KLIEN' ||
              c.kategori_keperluan === 'Talangan Klien' ||
              c.kategori_keperluan === 'Penggantian Talangan Klien'
          );
        }
        if (config.filterScope.onlyPendingReceipt) {
          filteredForExport = filteredForExport.filter((c) => c.status_bukti === 'BUKTI_MENYUSUL');
        }

        const sortedList = filteredForExport.sort((a, b) => {
          if (sortOrder === 'DATE_DESC') return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime();
          if (sortOrder === 'DATE_ASC') return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
          if (sortOrder === 'AMOUNT_DESC') return b.jumlah_rp - a.jumlah_rp;
          if (sortOrder === 'AMOUNT_ASC') return a.jumlah_rp - b.jumlah_rp;
          return 0;
        });

        const sortLabel =
          sortOrder === 'DATE_DESC'
            ? 'Terbaru'
            : sortOrder === 'DATE_ASC'
            ? 'Terlama'
            : sortOrder === 'AMOUNT_DESC'
            ? 'Nominal Terbesar'
            : 'Nominal Terkecil';
        const typeLabel =
          filterType === 'ALL' ? 'Semua Arus Kas' : filterType === 'MASUK' ? 'Kas Masuk' : 'Kas Keluar';
        const searchPart = searchQuery.trim() ? ` · Cari: "${searchQuery.trim()}"` : '';

        await generateCashflowPDF({
          docId,
          startDate,
          endDate,
          cashMutations: sortedList,
          signer: user,
          projectName,
          branding: tenantBranding,
          filterSummary: `${typeLabel}${searchPart} · Urut: ${sortLabel}`,
          customTitle: config.customTitle || 'BUKU LAPORAN KAS & KEUANGAN PROYEK',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation,
          hideRunningBalance: Boolean(config.filterScope.hideRunningBalance),
        });

        setGenerationSuccess(`Dokumen Buku Kas Proyek ${docId} (${sortedList.length} transaksi) berhasil dicetak dan diunduh.`);
      } else if (reportType === 'boq') {
        await generateBOQReportPDF({
          docId,
          items: items || [],
          projectName,
          signer: user,
          branding: tenantBranding,
          filterSummary: `Kontrol Pemenuhan Material BOQ (${items.length} Pos Pekerjaan)`,
          customTitle: config.customTitle || 'LAPORAN KONTROL PEMENUHAN MATERIAL KONTRAK BOQ',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          orientation: config.orientation || 'landscape',
          mutations: stockMutations,
          physicalMaterials,
          role: activeRole,
        });

        setGenerationSuccess(`Dokumen Laporan Pemenuhan BOQ ${docId} berhasil dicetak dan diunduh.`);
      } else if (reportType === 'warehouse') {
        await generateWarehouseSummaryPDF({
          docId,
          materials: physicalMaterials || [],
          projectName,
          signer: user,
          stockMutations,
          branding: tenantBranding,
          filterSummary: `Posisi Stok Fisik Gudang Lapangan (${physicalMaterials.length} Jenis Material)`,
          customTitle: config.customTitle || 'LAPORAN REKAPITULASI STOK FISIK GUDANG PROYEK',
          customNotes: config.customNotes,
          selectedColumns: config.selectedColumns,
          role: activeRole,
          orientation: config.orientation || 'landscape',
        });

        setGenerationSuccess(`Dokumen Laporan Stok Gudang ${docId} berhasil dicetak dan diunduh.`);
      } else if (reportType === 'integrated') {
        await generateIntegratedProjectReportPDF({
          docId,
          report: integratedReport,
          signer: user,
          branding: tenantBranding,
          selectedSections: config.selectedColumns,
          customTitle: config.customTitle,
          customNotes: config.customNotes,
          orientation: config.orientation || 'landscape',
          includeClientClaim: Boolean(
            config.filterScope.onlyClientClaim ||
              config.selectedColumns.includes('lampirkan_talangan_klien')
          ),
        });

        setGenerationSuccess(
          `Dokumen Laporan Proyek Terpadu ${docId} (${
            effectiveIntegratedPov === 'KONTRAKTOR' ? 'Edisi Kontraktor' : 'Edisi Klien'
          }) berhasil dicetak dan diunduh.`
        );
      }
    } catch (err: any) {
      console.error('Error saat mencetak PDF:', err);
      setGenerationError(err?.message || 'Gagal menghasilkan dokumen PDF. Periksa kriteria data dan coba lagi.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleVerifyDoc = (docId: string) => {
    setVerifyingDocId(docId);
    setCurrentView('verification');
  };

  if (!dataReady) {
    return (
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-sm font-medium text-slate-600 dark:text-slate-300 shadow-sm animate-pulse">
        Memuat data laporan dan arsip proyek...
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Header Utama & Breadcrumb */}
      <div className="bg-white dark:bg-slate-900 p-5 sm:p-6 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4 transition-colors">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <button
              onClick={() => (goBack ? goBack() : setCurrentView('dashboard'))}
              className="inline-flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white transition-colors cursor-pointer mr-1"
              title="Kembali ke halaman sebelumnya"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Dasbor</span>
            </button>
            <span className="text-slate-300 dark:text-slate-700">/</span>
            <span className="text-xs font-extrabold text-blue-600 dark:text-blue-400">
              Studio Laporan PDF
            </span>
          </div>

          <h1 className="text-lg sm:text-xl font-extrabold text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
            <Printer className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <span>Studio Laporan &amp; Ekspor PDF Terpadu</span>
          </h1>

          <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed max-w-2xl">
            Susun laporan siap cetak dari rekaman data transaksi proyek — mulai dari mutasi barang, buku kas, BOQ, gudang, hingga Laporan Proyek Terpadu satu kesatuan lengkap dengan kode QR keaslian.
          </p>
        </div>

        {/* Profil & Badget Pengguna + Banner Rata Kanan */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 sm:gap-4 shrink-0 self-start md:self-auto">
          <div className="flex flex-wrap items-center gap-2">
            <div className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <BadgeCheck className="w-3.5 h-3.5 text-blue-500 shrink-0" />
              <span className="font-bold">{user.name}</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-extrabold">
                {activeRole === 'Viewer/Pengamat' ? 'Pengamat' : activeRole}
              </span>
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800/60 text-xs font-bold text-indigo-700 dark:text-indigo-300 flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5" />
              <span>{tenantBranding.contractorName}</span>
            </div>
          </div>

          <div className="flex items-center justify-end self-center shrink-0">
            <img
              src="/words_PNG2.png"
              alt="Proyek Cair"
              className="h-10 sm:h-12 lg:h-14 w-auto max-w-[150px] sm:max-w-[200px] lg:max-w-[240px] object-contain drop-shadow-md dark:block hidden"
            />
            <img
              src="/words_light.png"
              alt="Proyek Cair"
              className="h-10 sm:h-12 lg:h-14 w-auto max-w-[150px] sm:max-w-[200px] lg:max-w-[240px] object-contain drop-shadow-md dark:hidden block"
            />
          </div>
        </div>
      </div>

      {/* Alert Notifikasi Sukses / Gagal */}
      {generationSuccess && (
        <div className="bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-2xl p-4 flex items-center justify-between text-xs text-emerald-900 dark:text-emerald-200 shadow-xs animate-in zoom-in-95 duration-150">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span className="font-semibold">{generationSuccess}</span>
          </div>
          <button
            onClick={() => setGenerationSuccess(null)}
            className="text-emerald-700 dark:text-emerald-300 font-bold hover:underline cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {generationError && (
        <div className="bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-2xl p-4 flex items-center justify-between text-xs text-rose-900 dark:text-rose-200 shadow-xs animate-in zoom-in-95 duration-150">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            <span className="font-semibold">{generationError}</span>
          </div>
          <button
            onClick={() => setGenerationError(null)}
            className="text-rose-700 dark:text-rose-300 font-bold hover:underline cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Formulir Konfigurasi & Pembuat Laporan */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 sm:p-6 space-y-6 transition-colors">
        <form onSubmit={handleOpenExportModal} className="space-y-6">
          {/* 1. Pemilihan Jenis Laporan (5 Kartu Interaktif) */}
          <div className="space-y-2">
            <label className="block text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              1. Pilih Jenis Dokumen Laporan:
            </label>
            <div className={`grid grid-cols-1 sm:grid-cols-2 ${canReadCash ? 'lg:grid-cols-5' : 'lg:grid-cols-4'} gap-3`}>
              {/* Laporan 1: Mutasi Stok Barang */}
              <button
                type="button"
                onClick={() => setReportType('stock')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  reportType === 'stock'
                    ? 'border-blue-500 bg-blue-50/70 dark:bg-blue-950/40 dark:border-blue-500 ring-2 ring-blue-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      reportType === 'stock'
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Boxes className="w-5 h-5" />
                  </div>
                  {reportType === 'stock' && <Check className="w-4 h-4 text-blue-600 dark:text-blue-400" />}
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Mutasi Keluar / Masuk Barang
                  </h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                    Rekapitulasi fisik masuk-keluar material, tujuan pos kerja, penanggung jawab, dan nota toko.
                  </p>
                </div>
              </button>

              {/* Laporan 2: Mutasi Kas Keuangan Proyek (hanya dirender jika berwenang, tanpa tombol mati) */}
              {canReadCash && (
                <button
                  type="button"
                  onClick={() => setReportType('cash')}
                  className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                    reportType === 'cash'
                      ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 dark:border-emerald-500 ring-2 ring-emerald-500/20 shadow-xs'
                      : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                        reportType === 'cash'
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <WalletCards className="w-5 h-5" />
                    </div>
                    {reportType === 'cash' && <Check className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />}
                  </div>
                  <div>
                    <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                      Buku Kas Keuangan Proyek
                    </h2>
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                      Arus kas masuk dan keluar aktif, metode bayar, beban biaya, dan saldo kas berjalan.
                    </p>
                  </div>
                </button>
              )}

              {/* Laporan 3: Kontrol Pemenuhan BOQ */}
              <button
                type="button"
                onClick={() => setReportType('boq')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  reportType === 'boq'
                    ? 'border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 dark:border-amber-500 ring-2 ring-amber-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      reportType === 'boq'
                        ? 'bg-amber-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <ClipboardCheck className="w-5 h-5" />
                  </div>
                  {reportType === 'boq' && <Check className="w-4 h-4 text-amber-600 dark:text-amber-400" />}
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Kontrol Pemenuhan BOQ
                  </h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                    Pemenuhan material kontrak BOQ, realisasi tiba, sisa belum tiba, dan capaian tiap pos.
                  </p>
                </div>
              </button>

              {/* Laporan 4: Stok Fisik Gudang */}
              <button
                type="button"
                onClick={() => setReportType('warehouse')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  reportType === 'warehouse'
                    ? 'border-purple-500 bg-purple-50/70 dark:bg-purple-950/40 dark:border-purple-500 ring-2 ring-purple-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      reportType === 'warehouse'
                        ? 'bg-purple-600 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <Package className="w-5 h-5" />
                  </div>
                  {reportType === 'warehouse' && <Check className="w-4 h-4 text-purple-600 dark:text-purple-400" />}
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Stok Fisik Gudang Proyek
                  </h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                    Posisi stok fisik material yang tersedia di gudang lapangan saat ini beserta statusnya.
                  </p>
                </div>
              </button>

              {/* Laporan 5: Laporan Proyek Terpadu (Satu Kesatuan Lintas Modul) */}
              <button
                type="button"
                onClick={() => setReportType('integrated')}
                className={`p-4 rounded-2xl border text-left transition-all flex flex-col justify-between gap-3 cursor-pointer ${
                  reportType === 'integrated'
                    ? 'border-teal-500 bg-teal-50/80 dark:bg-teal-950/50 dark:border-teal-500 ring-2 ring-teal-500/20 shadow-xs'
                    : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                      reportType === 'integrated'
                        ? 'bg-teal-600 text-white'
                        : 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
                    }`}
                  >
                    <Combine className="w-5 h-5" />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900 text-teal-800 dark:text-teal-200">
                      Terpadu
                    </span>
                    {reportType === 'integrated' && <Check className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
                  </div>
                </div>
                <div>
                  <h2 className="text-xs font-bold text-slate-900 dark:text-white">
                    Laporan Proyek Terpadu
                  </h2>
                  <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-1 line-clamp-2">
                    Satu kesatuan BOQ, stok gudang, arus kas, rekonsiliasi nota, dan pengesahan 4 tingkat.
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Panel Khusus Laporan Proyek Terpadu: Pemilih Edisi Sudut Pandang + Pratinjau Segitiga Kontrol */}
          {reportType === 'integrated' && (
            <div className="p-4 rounded-2xl bg-teal-50/50 dark:bg-teal-950/30 border border-teal-200/80 dark:border-teal-800/70 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <div className="text-xs font-extrabold text-teal-900 dark:text-teal-200 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Ringkasan Segitiga Kontrol Proyek (Data Langsung)</span>
                  </div>
                  <p className="text-[11px] text-teal-800/80 dark:text-teal-300/80 mt-0.5">
                    {effectiveIntegratedPov === 'KONTRAKTOR'
                      ? 'Edisi Kontraktor menampilkan 6 bab lengkap: fisik BOQ, rekonsiliasi lintas modul, kas, panjar, dan indeks nota.'
                      : 'Edisi Klien / Pengamat hanya menampilkan progres fisik, serah terima jatah, dan capaian divisi tanpa angka kas internal.'}
                  </p>
                </div>

                {!isViewer && canViewFinancials && (
                  <div className="flex items-center gap-1 bg-white dark:bg-slate-900 p-1 rounded-xl border border-teal-200 dark:border-teal-800 shrink-0">
                    <button
                      type="button"
                      onClick={() => setIntegratedEdition('KONTRAKTOR')}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                        integratedEdition === 'KONTRAKTOR'
                          ? 'bg-teal-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      Edisi Kontraktor (Lengkap)
                    </button>
                    <button
                      type="button"
                      onClick={() => setIntegratedEdition('KLIEN')}
                      className={`px-3 py-1.5 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                        integratedEdition === 'KLIEN'
                          ? 'bg-cyan-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      Edisi Klien (Fisik Saja)
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Pilar 1 · Fisik BOQ
                  </div>
                  <div className="text-lg font-extrabold text-slate-900 dark:text-white mt-1 tabular-nums">
                    {integratedReport.physicalProgress.serapanFisikPct}% Tuntas
                  </div>
                  <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                    {integratedReport.physicalProgress.tuntasCount} dari {integratedReport.physicalProgress.totalPosCount} pos selesai ·{' '}
                    {integratedReport.physicalProgress.habisKritisCount} pos kritis
                  </div>
                </div>

                {effectiveIntegratedPov === 'KONTRAKTOR' && integratedReport.cashMetrics && integratedReport.reconciliation ? (
                  <>
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Pilar 2 · Kas &amp; Aset Kerja
                      </div>
                      <div className="text-lg font-extrabold text-emerald-700 dark:text-emerald-300 mt-1 font-mono tabular-nums">
                        {formatRupiah(integratedReport.reconciliation.totalAsetKerjaProyekRp)}
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        Kas {formatRupiah(integratedReport.cashMetrics.saldoSaatIni)} + Stok{' '}
                        {formatRupiah(integratedReport.reconciliation.valuasiStokGudangRp)}
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Pilar 3 · Rekonsiliasi &amp; Panjar
                      </div>
                      <div className="text-lg font-extrabold text-amber-700 dark:text-amber-300 mt-1 font-mono tabular-nums">
                        {formatRupiah(integratedReport.reconciliation.selisihNotaBelumDibayarRp)}
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        {integratedReport.reconciliation.unreconciledReceipts.length} nota belum dibayar ·{' '}
                        {integratedReport.reconciliation.openKasbonList.filter((k) => k.statusKasbon !== 'LUNAS').length} panjar terbuka
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Pilar 2 · Status Pengerjaan &amp; Gudang
                      </div>
                      <div className="text-lg font-extrabold text-blue-700 dark:text-blue-300 mt-1 tabular-nums">
                        {integratedReport.physicalProgress.prosesCount} Berjalan · {integratedReport.physicalProgress.siapPakaiCount} Siap Pakai
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        {integratedReport.physicalProgress.belumMasukAtauSerahCount} pos belum masuk / belum serah
                      </div>
                    </div>

                    <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                        Pilar 3 · Serah Terima &amp; Arsip Resmi
                      </div>
                      <div className="text-lg font-extrabold text-teal-700 dark:text-teal-300 mt-1 tabular-nums">
                        {integratedReport.officialDocumentsSummary.sahTteCount} Dokumen Sah
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                        {integratedReport.physicalProgress.jatahKlienBelumSerahCount} jatah Klien menunggu serah terima
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* 2. Rentang Periode & Shortcut Cepat (Khusus Laporan Berbasis Tanggal) */}
          {(reportType === 'stock' || reportType === 'cash' || reportType === 'integrated') && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <label className="text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  2. Tentukan Periode Tanggal Laporan:
                </label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {[
                    { id: 'today', label: 'Hari Ini' },
                    { id: '7days', label: '7 Hari' },
                    { id: '30days', label: '30 Hari' },
                    { id: 'thisMonth', label: 'Bulan Ini' },
                    { id: 'all', label: 'Semua Periode' },
                  ].map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyDatePreset(p.id as any)}
                      className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Dari Tanggal:</span>
                  <div className="relative">
                    <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      required
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400">Sampai Tanggal:</span>
                  <div className="relative">
                    <Calendar className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                    <input
                      type="date"
                      required
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white font-mono focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 3. Filter Arus & Pencarian Langsung */}
          {reportType !== 'integrated' && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="block text-xs font-extrabold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                3. Saringan &amp; Kata Kunci Pencarian:
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {reportType === 'stock' || reportType === 'cash' ? (
                  <div>
                    <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Arus Transaksi:
                    </span>
                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
                      {[
                        { id: 'ALL', label: 'Semua Arus' },
                        { id: 'MASUK', label: 'Masuk' },
                        { id: 'KELUAR', label: 'Keluar' },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setFilterType(t.id as any)}
                          className={`flex-1 py-1.5 px-2 text-[11px] font-bold rounded-lg transition-colors cursor-pointer ${
                            filterType === t.id
                              ? 'bg-blue-600 text-white shadow-xs'
                              : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div>
                    <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Cakupan Data:
                    </span>
                    <div className="p-2 text-xs font-bold text-slate-700 dark:text-slate-300 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center gap-2">
                      <Layers className="w-4 h-4 text-blue-500" />
                      <span>Seluruh Item Terdaftar</span>
                    </div>
                  </div>
                )}

                <div>
                  <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Cari Nama Barang / PIC / Dokumen:
                  </span>
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Contoh: Baut, Toko Bangunan, Upah..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20"
                    />
                  </div>
                </div>

                <div>
                  <span className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Urutan Baris Dokumen:
                  </span>
                  <div className="relative">
                    <ArrowUpDown className="w-4 h-4 absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
                    <select
                      value={sortOrder}
                      onChange={(e) => setSortOrder(e.target.value as any)}
                      className="w-full pl-9 pr-3 py-2 text-xs border border-slate-200 dark:border-slate-700 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white focus:ring-2 focus:ring-blue-500/20 cursor-pointer"
                    >
                      <option value="DATE_DESC">Tanggal: Terbaru ke Terlama</option>
                      <option value="DATE_ASC">Tanggal: Terlama ke Terbaru</option>
                      <option value="AMOUNT_DESC">
                        {reportType === 'stock' || reportType === 'warehouse'
                          ? 'Volume: Terbanyak ke Sedikit'
                          : 'Nominal: Terbesar ke Terkecil'}
                      </option>
                      <option value="AMOUNT_ASC">
                        {reportType === 'stock' || reportType === 'warehouse'
                          ? 'Volume: Sedikit ke Terbanyak'
                          : 'Nominal: Terkecil ke Terbesar'}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Pratinjau Langsung & Tombol Aksi */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Pratinjau Data Dokumen:
                </span>
                <span className="px-2 py-0.5 rounded-full text-xs font-mono font-extrabold bg-blue-100 dark:bg-blue-950 text-blue-800 dark:text-blue-200">
                  {reportType === 'integrated'
                    ? `${integratedReport.physicalProgress.totalPosCount} Pos BOQ${
                        effectiveIntegratedPov === 'KONTRAKTOR'
                          ? ` · ${integratedReport.cashMetrics?.activeCount || 0} Kas Aktif`
                          : ''
                      }`
                    : `${matchingData.count} Baris Data Terpilih`}
                </span>
              </div>

              {reportType === 'cash' ? (
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  Masuk Aktif: <strong className="text-emerald-700 dark:text-emerald-300">{formatRupiah(matchingData.totalMasuk)}</strong> ·{' '}
                  Keluar Aktif: <strong className="text-rose-700 dark:text-rose-300">{formatRupiah(matchingData.totalKeluar)}</strong> ·{' '}
                  Bersih: <strong>{formatRupiah(matchingData.totalNilai)}</strong>
                  {matchingData.excludedCount > 0 ? ` (${matchingData.excludedCount} baris batal/diganti dikecualikan)` : ''}
                </p>
              ) : (
                <p className="text-[11px] text-slate-600 dark:text-slate-300">
                  {canViewFinancials && matchingData.totalNilai > 0 && reportType !== 'integrated'
                    ? `Total Terhitung: ${formatRupiah(matchingData.totalNilai)} · `
                    : ''}
                  PDF dicetak rapi dengan kop {tenantBranding.contractorName} dan kode QR keaslian.
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {reportType === 'integrated' && rolePermissions.canIssue && (
                <button
                  type="button"
                  disabled={isIssuingIntegrated}
                  onClick={() => void handleIssueIntegratedDocument()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-3 text-xs font-bold text-teal-800 dark:text-teal-200 bg-teal-50 dark:bg-teal-950/70 hover:bg-teal-100 dark:hover:bg-teal-900/70 border border-teal-300 dark:border-teal-700 rounded-xl transition-all cursor-pointer disabled:opacity-50"
                >
                  <FileCheck2 className="w-4 h-4" />
                  <span>{isIssuingIntegrated ? 'Menerbitkan Arsip...' : 'Terbitkan ke Arsip Resmi'}</span>
                </button>
              )}

              <button
                type="submit"
                disabled={isGenerating || (reportType !== 'integrated' && matchingData.count === 0)}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-md hover:shadow-blue-500/25 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>{isGenerating ? 'Menyusun Dokumen PDF...' : 'Konfigurasi & Cetak PDF →'}</span>
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* Arsip Dokumen Resmi & Validasi Kode QR (Tersaring Sesuai Sudut Pandang) */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Arsip Dokumen Resmi &amp; Validasi Kode QR</span>
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
              Daftar dokumen resmi proyek yang dapat Anda akses, lengkapi persetujuan berjenjangnya, atau verifikasi integritas SHA-256 secara instan.
            </p>
          </div>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 self-start sm:self-auto">
            {canReadDocuments ? visibleDocuments.length : 0} Dokumen Terbit
          </span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {!canReadDocuments ? (
            <div className="p-6 text-center text-xs text-amber-800 dark:text-amber-300 font-medium">
              Hak akses baca arsip dokumen diperlukan untuk melihat daftar ini.
            </div>
          ) : visibleDocuments.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-600 dark:text-slate-400">
              Belum ada dokumen resmi pada arsip proyek yang dapat Anda akses. Terbitkan berita acara atau laporan terpadu untuk mencatat arsip baru.
            </div>
          ) : (
            visibleDocuments.map((doc) => {
              const docDbId = doc.db_id || doc.id;
              const isDocInactive = Boolean(
                doc.is_batal ||
                  doc.is_ganti ||
                  doc.status_dokumen === 'BATAL' ||
                  doc.status_dokumen === 'DIGANTI'
              );
              const pendingAction =
                !isDocInactive && !isViewer
                  ? getPendingApprovalForRole(doc.status_dokumen || 'DITERBITKAN', activeRole)
                  : null;
              const statusDisplay =
                DOC_STATUS_LABELS[doc.status_dokumen || ''] || doc.status || 'Diterbitkan';

              return (
                <div
                  key={doc.id}
                  className="p-4 hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                >
                  <div className="flex items-start gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        doc.jenis === 'GABUNGAN_PROYEK'
                          ? 'bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300'
                          : 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                      }`}
                    >
                      {doc.jenis === 'GABUNGAN_PROYEK' ? (
                        <Combine className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-slate-900 dark:text-white">{doc.judul}</span>
                        <span className="text-[10px] font-mono font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/70 px-2 py-0.5 rounded-md border border-blue-200 dark:border-blue-900">
                          {doc.id}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${
                            isDocInactive
                              ? 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700'
                              : doc.status_dokumen === 'MENGETAHUI'
                              ? 'bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
                              : 'bg-amber-50 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                          }`}
                        >
                          {statusDisplay}
                        </span>
                        {doc.audience_pov && (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            {doc.audience_pov === 'KLIEN'
                              ? 'Edisi Klien'
                              : doc.audience_pov === 'UMUM'
                              ? 'Umum'
                              : 'Edisi Kontraktor'}
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-600 dark:text-slate-400 flex flex-wrap items-center gap-2">
                        <span>
                          Periode: {formatDateOnly(doc.periode_awal)} s/d {formatDateOnly(doc.periode_akhir)}
                        </span>
                        <span>·</span>
                        <span>Penyusun: {doc.penandatangan_nama}</span>
                        <span>·</span>
                        <span>{formatDateTime(doc.dibuat_pada)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {pendingAction && (() => {
                      const approvalVariant =
                        pendingAction.action === 'PERIKSA'
                          ? 'sky'
                          : pendingAction.action === 'SETUJU'
                          ? 'amber'
                          : 'teal';
                      const approvalLabel =
                        pendingAction.action === 'PERIKSA'
                          ? 'Periksa'
                          : pendingAction.action === 'SETUJU'
                          ? 'Setuju'
                          : 'Sahkan';
                      return (
                        <button
                          type="button"
                          disabled={advancingDocId === docDbId}
                          onClick={() => void handleAdvanceDoc(docDbId, pendingAction.nextTarget)}
                          className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-xl transition-colors cursor-pointer disabled:opacity-50 ${getCashActionVariantClass(approvalVariant)}`}
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            {advancingDocId === docDbId ? 'Memproses...' : approvalLabel}
                          </span>
                        </button>
                      );
                    })()}

                    <button
                      onClick={() => handleVerifyDoc(doc.id)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 rounded-xl transition-colors border border-blue-200 dark:border-blue-800/80 cursor-pointer"
                    >
                      <QrCode className="w-3.5 h-3.5" />
                      <span>Verifikasi Kode QR</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Modal Pengaturan Kustomisasi PDF */}
      <ExportSettingsModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
        targetType={
          reportType === 'stock'
            ? 'STOCK_JOURNAL'
            : reportType === 'cash'
            ? 'CASH'
            : reportType === 'boq'
            ? 'BOQ'
            : reportType === 'integrated'
            ? 'PROJECT_INTEGRATED'
            : 'WAREHOUSE'
        }
        title={`Pengaturan Cetak: ${
          reportType === 'stock'
            ? 'Laporan Mutasi Barang'
            : reportType === 'cash'
            ? 'Buku Kas Proyek'
            : reportType === 'boq'
            ? 'Kontrol Pemenuhan BOQ'
            : reportType === 'integrated'
            ? effectiveIntegratedPov === 'KONTRAKTOR'
              ? 'Laporan Proyek Terpadu (Edisi Kontraktor)'
              : 'Laporan Proyek Terpadu (Edisi Klien)'
            : 'Stok Fisik Gudang'
        }`}
        totalOriginalCount={matchingData.count}
        initialIncludeFinancials={
          reportType === 'integrated' ? effectiveIntegratedPov === 'KONTRAKTOR' : canViewFinancials
        }
        onConfirmExport={handleConfirmExport}
        currentFilterLabel={
          reportType === 'integrated'
            ? `Edisi ${effectiveIntegratedPov === 'KONTRAKTOR' ? 'Kontraktor (Lengkap)' : 'Klien (Fisik)'} · ${formatDateOnly(startDate)} s/d ${formatDateOnly(endDate)}`
            : `${startDate} s/d ${endDate} · ${
                filterType === 'ALL' ? 'Semua Arus' : filterType === 'MASUK' ? 'Masuk' : 'Keluar'
              }${searchQuery.trim() ? ` · "${searchQuery.trim()}"` : ''}`
        }
        currentSortLabel={`Urut: ${
          sortOrder === 'DATE_DESC'
            ? 'Terbaru'
            : sortOrder === 'DATE_ASC'
            ? 'Terlama'
            : sortOrder === 'AMOUNT_DESC'
            ? 'Terbesar'
            : 'Terkecil'
        }`}
      />
    </div>
  );
};
