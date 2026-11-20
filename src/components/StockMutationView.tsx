import React, { useState, useMemo, useRef, useEffect, useDeferredValue, startTransition } from 'react';
import { useApp } from '../context/AppContext';
import {
  ItemBarang,
  PhysicalMaterialItem,
  JenisMutasiBarang,
  MutasiBarang,
  StatusDokumenWorkflow,
  BebanBiaya,
  AsalBarang,
  TujuanPengeluaran
} from '../types';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Search,
  CheckCircle2,
  AlertTriangle,
  QrCode,
  FileCheck2,
  XCircle,
  Ban,
  FileEdit,
  Clock,
  ShieldCheck,
  BarChart3,
  Boxes,
  ChevronDown,
  ChevronRight,
  History,
  Eye,
  Building2,
  TrendingUp,
  Filter,
  FileText,
  Sparkles,
  Calendar
} from 'lucide-react';
import { formatDateTime, formatRupiah, generateBOQReportPDF, generateStockMutationPDF } from '../lib/pdfGenerator';

const getTodayLocalDate = (): string => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const toLocalDateInput = (iso?: string): string => {
  if (!iso) return getTodayLocalDate();
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return getTodayLocalDate();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const buildOccurredAtIso = (dateStr: string): string => {
  if (!dateStr) return new Date().toISOString();
  if (dateStr === getTodayLocalDate()) {
    return new Date().toISOString();
  }
  // Tengah hari waktu lokal agar pencatatan tanggal mundur tidak bergeser ke hari sebelumnya saat dikonversi ke UTC
  return new Date(`${dateStr}T12:00:00`).toISOString();
};

const getProviderMetaForMaterial = (
  pm: PhysicalMaterialItem | null
): { defaultAsal: 'KONTRAKTOR' | 'KLIEN'; isMixed: boolean; label: string } => {
  if (!pm || !pm.budget_lines || pm.budget_lines.length === 0) {
    return { defaultAsal: 'KONTRAKTOR', isMixed: false, label: 'Kontraktor' };
  }
  let imkQty = 0;
  let kontraktorQty = 0;
  let imkCount = 0;
  let kontraktorCount = 0;
  pm.budget_lines.forEach((bl) => {
    const isImk = (bl.keterangan || '').toLowerCase().includes('imk');
    const q = Number(bl.qty_boq || 0);
    if (isImk) {
      imkQty += q;
      imkCount += 1;
    } else {
      kontraktorQty += q;
      kontraktorCount += 1;
    }
  });
  const hasImk = imkQty > 0 || imkCount > 0;
  const hasKontraktor = kontraktorQty > 0 || kontraktorCount > 0;

  if (hasImk && !hasKontraktor) {
    return { defaultAsal: 'KLIEN', isMixed: false, label: 'Klien (PT IMK)' };
  }
  if (hasImk && hasKontraktor) {
    return {
      defaultAsal: imkQty > kontraktorQty ? 'KLIEN' : 'KONTRAKTOR',
      isMixed: true,
      label: 'Kontraktor & PT IMK'
    };
  }
  return { defaultAsal: 'KONTRAKTOR', isMixed: false, label: 'Kontraktor' };
};

interface StockMutationViewProps {
  isModalOpen: boolean;
  setIsModalOpen: (open: boolean) => void;
  preselectedItem: ItemBarang | null;
  preselectedType: JenisMutasiBarang;
  modalOnly?: boolean;
}

export const StockMutationView: React.FC<StockMutationViewProps> = ({
  isModalOpen,
  setIsModalOpen,
  preselectedItem,
  preselectedType,
  modalOnly = false,
}) => {
  const {
    items,
    physicalMaterials,
    stockMutations,
    documents,
    addStockMutation,
    batalStockMutation,
    gantiStockMutation,
    issueOfficialDocument,
    advanceDocumentWorkflow,
    batalOfficialDocument,
    gantiOfficialDocument,
    user,
    rolePermissions,
    activeRole,
    dataReady
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR' | 'PROYEK_BOQ' | 'PERMINTAAN_KLIEN' | 'BONUS_KLIEN' | 'OPERASIONAL'>('ALL');

  // 4 POV Terpisah Sesuai Kesepakatan:
  // 1) WAREHOUSE_SUMMARY ("Satukan Masuk" - 1 baris per nama material fisik)
  // 2) BOQ_MONITOR ("Bedakan Keluar" - 274 pos pekerjaan BOQ tanpa duplikasi kolom masuk)
  // 3) MUTATION_HISTORY ("Jurnal Transaksi & Barang Kustom" + Matriks Panduan, koreksi langsung tanpa birokrasi per baris)
  // 4) OFFICIAL_DOCUMENTS ("Dokumen & Persetujuan Berantai TTE/QR")
  const [activeTab, setActiveTab] = useState<'WAREHOUSE_SUMMARY' | 'BOQ_MONITOR' | 'MUTATION_HISTORY' | 'OFFICIAL_DOCUMENTS'>('WAREHOUSE_SUMMARY');

  // State untuk Tab 1: Rekap Gudang ("Satukan Masuk")
  const [warehouseSearchQuery, setWarehouseSearchQuery] = useState('');
  const [warehouseFilter, setWarehouseFilter] = useState<'ALL' | 'HAS_ARRIVED' | 'IN_STOCK' | 'NOT_ARRIVED'>('ALL');

  // State untuk Tab 4: Dokumen Resmi & Persetujuan Berantai
  const [docTitle, setDocTitle] = useState('Berita Acara Rekapitulasi Mutasi Barang & Gudang');
  const [docPeriode, setDocPeriode] = useState(() => new Date().toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }));
  const [docRingkasan, setDocRingkasan] = useState('');
  const [batalDocTargetId, setBatalDocTargetId] = useState<string | null>(null);
  const [batalDocReason, setBatalDocReason] = useState('');
  const [gantiDocTargetId, setGantiDocTargetId] = useState<string | null>(null);
  const [gantiDocTitle, setGantiDocTitle] = useState('');
  const [gantiDocPeriode, setGantiDocPeriode] = useState('');
  const [gantiDocRingkasan, setGantiDocRingkasan] = useState('');
  const [gantiDocReason, setGantiDocReason] = useState('');

  // State untuk Tab 1: Pantau Pemenuhan BOQ
  const [boqSearchQuery, setBoqSearchQuery] = useState('');
  const deferredBoqSearchQuery = useDeferredValue(boqSearchQuery);
  const [boqProviderFilter, setBoqProviderFilter] = useState<'ALL' | 'KONTRAKTOR' | 'IMK'>('ALL');
  const [boqStatusFilter, setBoqStatusFilter] = useState<'ALL' | 'Belum dipenuhi' | 'Dalam pemenuhan' | 'Terpenuhi' | 'Melebihi BOQ'>('ALL');
  const [collapsedDivisions, setCollapsedDivisions] = useState<Set<string>>(new Set());
  const [collapsedSubSections, setCollapsedSubSections] = useState<Set<string>>(new Set());
  const [isExportingBoq, setIsExportingBoq] = useState(false);

  const handleExportBOQPDF = async () => {
    try {
      setIsExportingBoq(true);
      const docId = `BOQ-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(1000 + Math.random() * 9000)}`;
      await generateBOQReportPDF({
        docId,
        items,
        projectName: 'Trainer & UDU Office (PT IMK)',
        signer: user || undefined
      });
      setNoticeMessage('Dokumen PDF BOQ berhasil dibuat dan diunduh.');
    } catch (err: any) {
      console.error('Error exporting BOQ PDF:', err);
      setErrorMessage('Gagal mengunduh PDF BOQ: ' + (err.message || 'Kesalahan sistem'));
    } finally {
      setIsExportingBoq(false);
    }
  };

  // Form input states
  const [hasChosenItem, setHasChosenItem] = useState<boolean>(Boolean(preselectedItem));
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [isCustomNewInput, setIsCustomNewInput] = useState<boolean>(false);
  const [customItemName, setCustomItemName] = useState<string>('');
  const [customItemUom, setCustomItemUom] = useState<string>('Unit');
  const [selectedCustomLastPurposeIn, setSelectedCustomLastPurposeIn] = useState<string>('');
  const [bebanBiaya, setBebanBiaya] = useState<BebanBiaya>('KONTRAKTOR');

  // Input Khusus MASUK: Asal Barang (otomatis terdeteksi dari kontrak BOQ, dapat disesuaikan)
  const [asalBarang, setAsalBarang] = useState<AsalBarang>('KONTRAKTOR');
  const [providerAutoMatched, setProviderAutoMatched] = useState<boolean>(false);
  const [tokoBebasName, setTokoBebasName] = useState<string>('');

  // Input Khusus KELUAR: Tujuan Pengeluaran (4 Opsi Ringkas)
  const [tujuanPengeluaran, setTujuanPengeluaran] = useState<TujuanPengeluaran>('PROYEK_BOQ');
  const [keteranganPengeluaran, setKeteranganPengeluaran] = useState<string>('');

  const [selectedItemId, setSelectedItemId] = useState<string>(preselectedItem ? preselectedItem.id : '');
  const [selectedAllocationItemId, setSelectedAllocationItemId] = useState<string>('');
  const [mutationType, setMutationType] = useState<JenisMutasiBarang>(preselectedType || 'MASUK');
  const [mutationDate, setMutationDate] = useState<string>(() => getTodayLocalDate());
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const openedInternallyRef = useRef(false);
  const wasModalOpenRef = useRef(false);

  const [qty, setQty] = useState<number>(1);
  const [purpose, setPurpose] = useState('');
  const [pic, setPic] = useState(user.name);
  const [suratJalan, setSuratJalan] = useState('');
  const [notes, setNotes] = useState('');
  const [sourceName, setSourceName] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [ownerType, setOwnerType] = useState<'KONTRAKTOR' | 'IMK'>('KONTRAKTOR');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Modal Batal & Ganti States
  const [batalTarget, setBatalTarget] = useState<MutasiBarang | null>(null);
  const [batalReason, setBatalReason] = useState('');
  const [gantiTarget, setGantiTarget] = useState<MutasiBarang | null>(null);
  const [gantiReason, setGantiReason] = useState('');

  // Helper terpadu saat material BOQ dipilih (otomatis mendeteksi penyedia & aturan BOQ)
  const applyBoqMaterialSelection = (
    pm: PhysicalMaterialItem,
    type: JenisMutasiBarang,
    explicitLineId?: string
  ) => {
    setSelectedItemId(pm.id);
    setIsCustomMode(false);
    setIsCustomNewInput(false);
    setHasChosenItem(true);
    setItemSearchQuery('');
    setCustomItemName('');
    setCustomItemUom(pm.satuan);
    setSelectedCustomLastPurposeIn('');

    if (type === 'MASUK') {
      const meta = getProviderMetaForMaterial(pm);
      setAsalBarang(meta.defaultAsal);
      setProviderAutoMatched(true);
      setTokoBebasName('');
      setBebanBiaya(meta.defaultAsal === 'KLIEN' ? 'KLIEN' : 'KONTRAKTOR');
      setSourceName(meta.defaultAsal === 'KLIEN' ? 'PT Indo Muro Kencana (Klien)' : 'CV Menara Megah');
      setDestinationName('Gudang Utama Proyek');
      setPurpose('Penyediaan Material Kontrak BOQ');
      if (pm.budget_lines.length > 0) {
        const targetLine = (explicitLineId && pm.budget_lines.find((bl) => bl.id === explicitLineId)) || pm.budget_lines[0];
        setSelectedAllocationItemId(targetLine.id);
      }
    } else {
      const lines = pm.budget_lines;
      const targetLine = (explicitLineId && lines.find((bl) => bl.id === explicitLineId)) || lines[0] || null;
      if (targetLine) {
        setSelectedAllocationItemId(targetLine.id);
        setDestinationName(`Area Proyek - ${targetLine.kategori}`);
        setPurpose(`${targetLine.kode_boq} - ${targetLine.kategori}`);
      } else {
        setSelectedAllocationItemId('');
        setDestinationName('Area Proyek');
        setPurpose('Pekerjaan Proyek BOQ');
      }
      setTujuanPengeluaran('PROYEK_BOQ');
      setBebanBiaya('PROYEK_BOQ');
      setProviderAutoMatched(false);
    }
  };

  // Sinkronisasi saat modal dibuka dari luar (Dashboard / Inventaris via App.tsx)
  useEffect(() => {
    const wasOpen = wasModalOpenRef.current;
    wasModalOpenRef.current = isModalOpen;
    if (!isModalOpen || wasOpen) return;

    if (openedInternallyRef.current) {
      openedInternallyRef.current = false;
      return;
    }

    const targetType = preselectedType || 'MASUK';
    setMutationType(targetType);
    setMutationDate(getTodayLocalDate());
    setQty(1);
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setTokoBebasName('');
    setKeteranganPengeluaran('');
    setSelectedCustomLastPurposeIn('');
    setErrorMessage(null);

    if (preselectedItem) {
      const matchedPm =
        physicalMaterials.find(
          (pm) => pm.id === preselectedItem.id || pm.budget_lines.some((bl) => bl.id === preselectedItem.id)
        ) || null;
      if (matchedPm) {
        applyBoqMaterialSelection(matchedPm, targetType, preselectedItem.id);
        return;
      }
    }

    setHasChosenItem(false);
    setIsCustomMode(false);
    setIsCustomNewInput(false);
    setSelectedItemId('');
    setSelectedAllocationItemId('');
    setItemSearchQuery('');
    setAsalBarang('KONTRAKTOR');
    setProviderAutoMatched(false);
    setTujuanPengeluaran('PROYEK_BOQ');
  }, [isModalOpen, preselectedItem, preselectedType, physicalMaterials, user.name]);

  // Material Fisik Terpadu yang aktif dipilih
  const currentPhysicalMaterial = useMemo(() => {
    if (!physicalMaterials || physicalMaterials.length === 0 || !selectedItemId) return null;
    return (
      physicalMaterials.find(
        (pm) => pm.id === selectedItemId || pm.budget_lines.some((bl) => bl.id === selectedItemId)
      ) || null
    );
  }, [physicalMaterials, selectedItemId]);

  // Sinkronisasi Alokasi Pos BOQ ketika material fisik berganti
  useEffect(() => {
    if (currentPhysicalMaterial) {
      const lines = currentPhysicalMaterial.budget_lines;
      const isCurrentValid = lines.some((bl) => bl.id === selectedAllocationItemId);
      if (!isCurrentValid && lines.length > 0) {
        const matchingPre = preselectedItem ? lines.find((bl) => bl.id === preselectedItem.id) : null;
        const targetLine = matchingPre || lines[0];
        setSelectedAllocationItemId(targetLine.id);
        if (mutationType === 'KELUAR') {
          setPurpose(`${targetLine.kode_boq} - ${targetLine.kategori}`);
        }
      }
    }
  }, [currentPhysicalMaterial, preselectedItem, mutationType, selectedAllocationItemId]);

  const selectedBudgetLine = useMemo(() => {
    if (!currentPhysicalMaterial) return null;
    return (
      currentPhysicalMaterial.budget_lines.find((bl) => bl.id === selectedAllocationItemId) ||
      currentPhysicalMaterial.budget_lines[0] ||
      null
    );
  }, [currentPhysicalMaterial, selectedAllocationItemId]);

  const existingCustomItems = useMemo(() => {
    const map = new Map<string, { nama_barang: string; satuan: string; stok: number; lastPurposeIn: string }>();
    [...stockMutations].reverse().forEach((m) => {
      if (!m.is_custom_item || m.is_batal || m.is_ganti || m.status_dokumen === 'BATAL' || m.status_dokumen === 'DIGANTI') return;
      const k = `${(m.nama_barang || '').trim().toLowerCase()}|${(m.satuan || '').trim().toLowerCase()}`;
      if (!map.has(k)) {
        map.set(k, { nama_barang: m.nama_barang, satuan: m.satuan, stok: 0, lastPurposeIn: '' });
      }
      const entry = map.get(k)!;
      entry.stok += m.jenis === 'MASUK' ? m.jumlah : -m.jumlah;
      if (m.jenis === 'MASUK' && m.tujuan_keperluan) {
        entry.lastPurposeIn = m.tujuan_keperluan;
      }
    });
    return Array.from(map.values());
  }, [stockMutations]);

  // Pencarian Cerdas Terpadu (Pertanyaan 1): Katalog BOQ & Barang Kustom Tercatat
  const filteredBoqSearchResults = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    const list = physicalMaterials.filter((pm) => pm.is_stock_item);
    const filtered = !q
      ? [...list]
      : list.filter(
          (pm) =>
            pm.nama_barang.toLowerCase().includes(q) ||
            pm.satuan.toLowerCase().includes(q) ||
            pm.budget_lines.some(
              (bl) => bl.kode_boq.toLowerCase().includes(q) || bl.kategori.toLowerCase().includes(q)
            )
        );

    filtered.sort((a, b) => {
      if (mutationType === 'KELUAR') {
        const aHas = a.stok_fisik > 0 ? 1 : 0;
        const bHas = b.stok_fisik > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        if (a.stok_fisik !== b.stok_fisik) return b.stok_fisik - a.stok_fisik;
      } else if (q) {
        const aStarts = a.nama_barang.toLowerCase().startsWith(q) ? 1 : 0;
        const bStarts = b.nama_barang.toLowerCase().startsWith(q) ? 1 : 0;
        if (aStarts !== bStarts) return bStarts - aStarts;
      }
      return a.nama_barang.localeCompare(b.nama_barang);
    });

    return filtered.slice(0, 25);
  }, [physicalMaterials, itemSearchQuery, mutationType]);

  const filteredCustomSearchResults = useMemo(() => {
    const q = itemSearchQuery.trim().toLowerCase();
    const filtered = !q
      ? [...existingCustomItems]
      : existingCustomItems.filter(
          (ci) => ci.nama_barang.toLowerCase().includes(q) || ci.satuan.toLowerCase().includes(q)
        );

    if (mutationType === 'KELUAR') {
      filtered.sort((a, b) => {
        const aHas = a.stok > 0 ? 1 : 0;
        const bHas = b.stok > 0 ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return b.stok - a.stok;
      });
    }
    return filtered;
  }, [existingCustomItems, itemSearchQuery, mutationType]);

  const selectedCustomItemInfo = useMemo(() => {
    if (!isCustomMode || isCustomNewInput || !customItemName.trim()) return null;
    const key = `${customItemName.trim().toLowerCase()}|${customItemUom.trim().toLowerCase()}`;
    return (
      existingCustomItems.find(
        (ci) => `${ci.nama_barang.trim().toLowerCase()}|${ci.satuan.trim().toLowerCase()}` === key
      ) || null
    );
  }, [existingCustomItems, isCustomMode, isCustomNewInput, customItemName, customItemUom]);

  const currentStock = currentPhysicalMaterial?.stok_fisik || 0;
  const projectedStock =
    mutationType === 'MASUK'
      ? currentStock + Number(qty || 0)
      : Math.max(0, currentStock - Number(qty || 0));

  const filteredMutations = useMemo(() => {
    return stockMutations.filter((m) => {
      const matchSearch =
        (m.nama_barang || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.tujuan_keperluan || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.pic_penerima_penyerah || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.source_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (m.nomor_surat_jalan && m.nomor_surat_jalan.toLowerCase().includes(searchQuery.toLowerCase()));

      let matchFilter = true;
      if (filterType === 'MASUK') matchFilter = m.jenis === 'MASUK';
      else if (filterType === 'KELUAR') matchFilter = m.jenis === 'KELUAR';
      else if (filterType === 'PROYEK_BOQ') matchFilter = m.beban_biaya === 'PROYEK_BOQ' || m.beban_biaya === 'KONTRAKTOR';
      else if (filterType === 'PERMINTAAN_KLIEN') matchFilter = m.beban_biaya === 'KLIEN' || (m.beban_biaya as string) === 'PERMINTAAN_KLIEN';
      else if (filterType === 'BONUS_KLIEN') matchFilter = m.beban_biaya === 'BONUS_KLIEN';
      else if (filterType === 'OPERASIONAL') matchFilter = m.beban_biaya === 'OPERASIONAL';

      return matchSearch && matchFilter;
    });
  }, [stockMutations, searchQuery, filterType]);

  // Helper Pengelompokan Kategori BOQ (Divisi & Sub-Pekerjaan)
  const parseCategory = (cat: string) => {
    if (cat.includes(' / ')) {
      const parts = cat.split(' / ');
      return {
        division: parts[0].trim(),
        subSection: parts.slice(1).join(' / ').trim()
      };
    }
    if (cat.startsWith('IV.')) {
      return {
        division: 'IV - BIAYA JASA & PEKERJAAN',
        subSection: cat.trim()
      };
    }
    return {
      division: cat || 'Kategori Umum',
      subSection: cat || 'Umum'
    };
  };

  const toggleDivision = (divName: string) => {
    setCollapsedDivisions((prev) => {
      const next = new Set(prev);
      if (next.has(divName)) next.delete(divName);
      else next.add(divName);
      return next;
    });
  };

  const toggleSubSection = (subKey: string) => {
    setCollapsedSubSections((prev) => {
      const next = new Set(prev);
      if (next.has(subKey)) next.delete(subKey);
      else next.add(subKey);
      return next;
    });
  };

  const handleExpandAll = () => {
    setCollapsedDivisions(new Set());
    setCollapsedSubSections(new Set());
  };

  // Grouped BOQ Data untuk Tab 1 (Dioptimasi dengan useDeferredValue)
  const groupedBoqData = useMemo(() => {
    const q = deferredBoqSearchQuery.trim().toLowerCase();
    const filtered = items.filter((item) => {
      const isImk = (item.keterangan || '').toLowerCase().includes('imk');
      if (boqProviderFilter === 'IMK' && !isImk) return false;
      if (boqProviderFilter === 'KONTRAKTOR' && isImk) return false;
      if (boqStatusFilter !== 'ALL' && item.status_pemenuhan !== boqStatusFilter) return false;
      if (q) {
        const matchName = item.nama_barang.toLowerCase().includes(q);
        const matchCode = (item.kode_boq || '').toLowerCase().includes(q);
        const matchCat = (item.kategori || '').toLowerCase().includes(q);
        if (!matchName && !matchCode && !matchCat) return false;
      }
      return true;
    });

    const divisionMap = new Map<string, Map<string, ItemBarang[]>>();

    filtered.forEach((item) => {
      const { division, subSection } = parseCategory(item.kategori || '');
      if (!divisionMap.has(division)) {
        divisionMap.set(division, new Map());
      }
      const subMap = divisionMap.get(division)!;
      if (!subMap.has(subSection)) {
        subMap.set(subSection, []);
      }
      subMap.get(subSection)!.push(item);
    });

    const divisions: {
      name: string;
      subSections: {
        name: string;
        items: ItemBarang[];
        totalQtyBoq: number;
        totalMasuk: number;
        totalKeluar: number;
        totalSisa: number;
        imkCount: number;
        kontraktorCount: number;
      }[];
      totalItems: number;
      totalMasuk: number;
      totalKeluar: number;
    }[] = [];

    divisionMap.forEach((subMap, divName) => {
      const subSections: {
        name: string;
        items: ItemBarang[];
        totalQtyBoq: number;
        totalMasuk: number;
        totalKeluar: number;
        totalSisa: number;
        imkCount: number;
        kontraktorCount: number;
      }[] = [];

      let divItemsCount = 0;
      let divMasuk = 0;
      let divKeluar = 0;

      subMap.forEach((subItems, subName) => {
        subItems.sort((a, b) => (a.source_excel_row || 0) - (b.source_excel_row || 0));

        let subQtyBoq = 0;
        let subMasuk = 0;
        let subKeluar = 0;
        let subSisa = 0;
        let imkCount = 0;
        let kontraktorCount = 0;

        subItems.forEach((it) => {
          subQtyBoq += it.qty_boq;
          subMasuk += it.qty_masuk_total;
          subKeluar += it.qty_keluar_total;
          subSisa += it.qty_pemenuhan_sisa;
          if ((it.keterangan || '').toLowerCase().includes('imk')) {
            imkCount++;
          } else {
            kontraktorCount++;
          }
        });

        divItemsCount += subItems.length;
        divMasuk += subMasuk;
        divKeluar += subKeluar;

        subSections.push({
          name: subName,
          items: subItems,
          totalQtyBoq: subQtyBoq,
          totalMasuk: subMasuk,
          totalKeluar: subKeluar,
          totalSisa: subSisa,
          imkCount,
          kontraktorCount
        });
      });

      divisions.push({
        name: divName,
        subSections,
        totalItems: divItemsCount,
        totalMasuk: divMasuk,
        totalKeluar: divKeluar
      });
    });

    return divisions;
  }, [items, deferredBoqSearchQuery, boqProviderFilter, boqStatusFilter]);

  const handleCollapseAll = () => {
    const allDivs = new Set(groupedBoqData.map((d) => d.name));
    const allSubs = new Set<string>();
    groupedBoqData.forEach((d) => {
      d.subSections.forEach((s) => allSubs.add(`${d.name}__${s.name}`));
    });
    setCollapsedDivisions(allDivs);
    setCollapsedSubSections(allSubs);
  };

  // Metrik Progres Kontrak BOQ Keseluruhan (Satukan Masuk di Gudang, Bedakan Keluar per Pos BOQ)
  const boqMetrics = useMemo(() => {
    const totalItems = items.length;
    let fulfilledCount = 0;
    let inProgressCount = 0;
    let notStartedCount = 0;
    let overQuotaCount = 0;
    let totalImkItems = 0;
    let totalKontraktorItems = 0;
    let arrivedPosCoverageCount = 0;

    items.forEach((it) => {
      if ((it.keterangan || '').toLowerCase().includes('imk')) {
        totalImkItems++;
      } else {
        totalKontraktorItems++;
      }

      if (it.qty_masuk_total > 0) arrivedPosCoverageCount++;

      if (it.status_pemenuhan === 'Terpenuhi') fulfilledCount++;
      else if (it.status_pemenuhan === 'Dalam pemenuhan') inProgressCount++;
      else if (it.status_pemenuhan === 'Melebihi BOQ') overQuotaCount++;
      else notStartedCount++;
    });

    const arrivedMaterialTypesCount = (physicalMaterials || []).filter((pm) => pm.total_qty_masuk > 0).length;
    const totalMaterialTypesCount = (physicalMaterials || []).filter((pm) => pm.is_stock_item).length;
    const progressPct = totalItems > 0 ? Math.round(((fulfilledCount + overQuotaCount + inProgressCount * 0.5) / totalItems) * 100) : 0;

    return {
      totalItems,
      fulfilledCount,
      inProgressCount,
      notStartedCount,
      overQuotaCount,
      totalImkItems,
      totalKontraktorItems,
      arrivedPosCoverageCount,
      arrivedMaterialTypesCount,
      totalMaterialTypesCount,
      progressPct
    };
  }, [items, physicalMaterials]);

  // Aksi Cepat Catat Masuk langsung dari 1 Baris Material Gudang ("Satukan Masuk")
  const handleOpenWarehouseMaterialIn = (pm: PhysicalMaterialItem) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    openedInternallyRef.current = true;
    setMutationType('MASUK');
    setMutationDate(getTodayLocalDate());
    setQty(1);
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setTokoBebasName('');
    setKeteranganPengeluaran('');
    setErrorMessage(null);
    applyBoqMaterialSelection(pm, 'MASUK');
    setIsModalOpen(true);
  };

  // Filter Material Gudang untuk Tab 1 ("Satukan Masuk" - 1 Baris per Nama Material)
  const filteredWarehouseMaterials = useMemo(() => {
    const q = warehouseSearchQuery.trim().toLowerCase();
    return (physicalMaterials || [])
      .filter((pm) => pm.is_stock_item)
      .filter((pm) => {
        if (warehouseFilter === 'HAS_ARRIVED' && pm.total_qty_masuk <= 0) return false;
        if (warehouseFilter === 'IN_STOCK' && pm.stok_fisik <= 0) return false;
        if (warehouseFilter === 'NOT_ARRIVED' && pm.total_qty_masuk > 0) return false;
        if (q) {
          const matchName = pm.nama_barang.toLowerCase().includes(q);
          const matchUom = pm.satuan.toLowerCase().includes(q);
          const matchBoq = pm.budget_lines.some(
            (bl) => bl.kode_boq.toLowerCase().includes(q) || bl.kategori.toLowerCase().includes(q)
          );
          if (!matchName && !matchUom && !matchBoq) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Prioritaskan yang sudah ada barang masuk di paling atas agar langsung terlihat
        if (a.total_qty_masuk > 0 && b.total_qty_masuk === 0) return -1;
        if (a.total_qty_masuk === 0 && b.total_qty_masuk > 0) return 1;
        return a.nama_barang.localeCompare(b.nama_barang);
      });
  }, [physicalMaterials, warehouseSearchQuery, warehouseFilter]);

  // Daftar Dokumen Resmi Mutasi Barang (Tab 4)
  const stockDocuments = useMemo(() => {
    return (documents || []).filter((d) => d.jenis === 'MUTASI_STOK' || d.jenis === 'GABUNGAN_PROYEK');
  }, [documents]);

  // Aksi Cepat Mutasi dari Baris Material BOQ (Khusus Pemakaian / Keluar per Pos di Tab 2)
  const handleOpenItemMutation = (item: ItemBarang, type: JenisMutasiBarang) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    openedInternallyRef.current = true;
    const matchedPm: PhysicalMaterialItem = physicalMaterials.find(
      (pm) => pm.id === item.id || pm.budget_lines.some((bl) => bl.id === item.id)
    ) || {
      id: item.id,
      nama_barang: item.nama_barang,
      satuan: item.satuan,
      stok_fisik: item.stok_saat_ini,
      total_qty_boq: item.qty_boq,
      total_qty_masuk: item.qty_masuk_total,
      total_qty_keluar: item.qty_keluar_total,
      is_stock_item: item.is_stock_item,
      budget_lines: [
        {
          id: item.id,
          kode_boq: item.kode_boq,
          kategori: item.kategori,
          qty_boq: item.qty_boq,
          qty_keluar_total: item.qty_keluar_total,
          sisa_anggaran: item.qty_pemenuhan_sisa,
          keterangan: item.keterangan
        }
      ]
    };

    setMutationType(type);
    setMutationDate(getTodayLocalDate());
    setQty(1);
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setTokoBebasName('');
    setKeteranganPengeluaran('');
    setErrorMessage(null);
    applyBoqMaterialSelection(matchedPm, type, item.id);
    setIsModalOpen(true);
  };

  // Navigasi ke Tab 3 (Jurnal Mutasi) khusus untuk item ini
  const handleViewItemHistory = (itemName: string) => {
    setActiveTab('MUTATION_HISTORY');
    setSearchQuery(itemName);
    setFilterType('ALL');
  };

  // Badge Status Pos Pekerjaan BOQ (Khusus POV "Bedakan Keluar" per Pos Pekerjaan)
  const renderBoqStatusBadge = (item: ItemBarang) => {
    switch (item.status_pemenuhan) {
      case 'Terpenuhi':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
            <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>Terpenuhi</span>
          </span>
        );
      case 'Dalam pemenuhan':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
            <TrendingUp className="w-3 h-3 text-blue-600 dark:text-blue-400" />
            <span>Dalam Proses</span>
          </span>
        );
      case 'Melebihi BOQ':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
            <AlertTriangle className="w-3 h-3 text-purple-600 dark:text-purple-400" />
            <span>Melebihi BOQ</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 border border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700">
            <Clock className="w-3 h-3 text-slate-500 dark:text-slate-300" />
            <span>Belum Dipakai</span>
          </span>
        );
    }
  };

  const handleOpenNewModal = (type: JenisMutasiBarang = 'MASUK') => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang mencatat mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    openedInternallyRef.current = true;
    setMutationType(type);
    setHasChosenItem(false);
    setIsCustomMode(false);
    setIsCustomNewInput(false);
    setSelectedItemId('');
    setSelectedAllocationItemId('');
    setCustomItemName('');
    setCustomItemUom('Unit');
    setSelectedCustomLastPurposeIn('');
    setAsalBarang('KONTRAKTOR');
    setProviderAutoMatched(false);
    setTokoBebasName('');
    setTujuanPengeluaran('PROYEK_BOQ');
    setKeteranganPengeluaran('');
    setQty(1);
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setMutationDate(getTodayLocalDate());
    setItemSearchQuery('');
    setSourceName('CV Menara Megah');
    setDestinationName(type === 'MASUK' ? 'Gudang Utama Proyek' : 'Area Proyek UDU');
    setOwnerType('KONTRAKTOR');
    setPurpose(type === 'MASUK' ? 'Penyediaan Material Kontrak BOQ' : '');
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  const handleSubmitMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!hasChosenItem) {
      setErrorMessage('Silakan pilih atau ketik barang terlebih dahulu.');
      return;
    }

    if (isCustomMode) {
      if (!customItemName.trim()) {
        setErrorMessage('Tuliskan nama barang.');
        return;
      }
      if (!customItemUom.trim()) {
        setErrorMessage('Tuliskan satuan barang (cth: Zak, Kg, Batang, Unit).');
        return;
      }
      if (mutationType === 'MASUK' && !notes.trim()) {
        setErrorMessage('Tuliskan rencana keperluan barang kustom saat masuk.');
        return;
      }
    } else {
      if (!currentPhysicalMaterial) {
        setErrorMessage('Pilih barang dari daftar terlebih dahulu.');
        return;
      }
      if (mutationType === 'KELUAR' && currentStock < qty) {
        setErrorMessage(
          `Stok fisik saat ini di gudang (${currentStock} ${currentPhysicalMaterial.satuan}) tidak mencukupi untuk pengeluaran ${qty} ${currentPhysicalMaterial.satuan}.`
        );
        return;
      }
    }

    if (mutationType === 'KELUAR' && (isCustomMode || tujuanPengeluaran !== 'PROYEK_BOQ') && !keteranganPengeluaran.trim()) {
      setErrorMessage('Tuliskan keterangan pemakaian barang keluar.');
      return;
    }

    if (qty <= 0) {
      setErrorMessage('Jumlah kuantitas mutasi harus lebih besar dari 0.');
      return;
    }

    // Material BOQ: Gunakan pos BOQ spesifik jika dipilih dari baris, atau pos pertama dari material fisik
    const targetItemId = isCustomMode
      ? ''
      : (selectedAllocationItemId || selectedItemId || currentPhysicalMaterial?.id || '');

    const itemName = isCustomMode ? customItemName.trim() : (currentPhysicalMaterial?.nama_barang || 'Material');
    const itemSatuan = isCustomMode ? customItemUom.trim() : (currentPhysicalMaterial?.satuan || 'Unit');

    // Menetapkan Asal Barang & Pemilik (Khusus MASUK)
    let calculatedSourceName = 'Pengadaan Kontraktor (CV Menara Megah)';
    let calculatedOwnerType: 'KONTRAKTOR' | 'KLIEN' = 'KONTRAKTOR';

    if (mutationType === 'MASUK') {
      if (asalBarang === 'KLIEN') {
        calculatedSourceName = 'Disediakan Klien / Owner';
        calculatedOwnerType = 'KLIEN';
      } else if (asalBarang === 'TOKO_BEBAS') {
        calculatedSourceName = tokoBebasName.trim() ? `Lainnya: ${tokoBebasName.trim()}` : 'Lainnya / Toko Bebas';
        calculatedOwnerType = 'KONTRAKTOR';
      }
    }

    // Menetapkan Beban Biaya & Uraian Tujuan (Khusus KELUAR)
    let calculatedBeban: BebanBiaya = 'KONTRAKTOR';
    let finalPurpose = 'Penyediaan Material Kontrak BOQ';

    if (mutationType === 'MASUK') {
      finalPurpose = isCustomMode
        ? (notes.trim() || `Penerimaan ${itemName}`)
        : 'Penyediaan Material Kontrak BOQ';
    } else {
      // KELUAR
      if (tujuanPengeluaran === 'PROYEK_BOQ') {
        calculatedBeban = 'PROYEK_BOQ';
        finalPurpose = isCustomMode
          ? (keteranganPengeluaran.trim() || 'Pemakaian Pekerjaan Proyek (Item Kustom)')
          : selectedBudgetLine
          ? `Pekerjaan: ${selectedBudgetLine.kode_boq} - ${selectedBudgetLine.kategori}`
          : 'Pekerjaan Proyek BOQ';
      } else if (tujuanPengeluaran === 'OPERASIONAL') {
        calculatedBeban = 'OPERASIONAL';
        finalPurpose = keteranganPengeluaran.trim() || 'Kebutuhan Operasional Lapangan';
      } else if (tujuanPengeluaran === 'PERMINTAAN_KLIEN') {
        calculatedBeban = 'KLIEN'; // Kena invoice ke Klien
        calculatedOwnerType = 'KLIEN';
        finalPurpose = keteranganPengeluaran.trim() || 'Permintaan Tambahan Klien (Kena Invoice)';
      } else if (tujuanPengeluaran === 'BONUS_KLIEN') {
        calculatedBeban = 'BONUS_KLIEN'; // Gratis / Tidak ditagihkan
        finalPurpose = keteranganPengeluaran.trim() || 'Bonus untuk Klien (Gratis / Beban Menara Megah)';
      }
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await addStockMutation({
        barang_id: targetItemId,
        nama_barang: itemName,
        jenis: mutationType,
        jumlah: qty,
        satuan: itemSatuan,
        tujuan_keperluan: finalPurpose,
        pic_penerima_penyerah: pic,
        nomor_surat_jalan: suratJalan || undefined,
        tanggal: buildOccurredAtIso(mutationDate),
        catatan: notes || undefined,
        source_name: calculatedSourceName,
        destination_name: destinationName || undefined,
        recipient_name: pic || undefined,
        owner_type: calculatedOwnerType,
        purpose: finalPurpose,
        beban_biaya: calculatedBeban,
        is_custom_item: isCustomMode
      });

      if (!res.success) {
        setErrorMessage(res.message);
        return;
      }

      setNoticeMessage(
        `${mutationType === 'MASUK' ? 'Barang masuk' : 'Barang keluar'} ${itemName} (${qty} ${itemSatuan}) berhasil disimpan.`
      );
      setIsModalOpen(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'Gagal mencatat mutasi stok.');
    } finally {
      setSubmitting(false);
    }
  };

  // Konfirmasi BATAL Mutasi
  const handleConfirmBatal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalStockMutation(batalTarget.id, batalReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalTarget(null);
        setBatalReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membatalkan transaksi.');
    } finally {
      setSubmitting(false);
    }
  };

  // Buka Modal GANTI Mutasi
  const handleOpenGanti = (item: MutasiBarang) => {
    setGantiTarget(item);
    setGantiReason('');
    setIsCustomMode(Boolean(item.is_custom_item));
    setCustomItemName(item.nama_barang || '');
    setCustomItemUom(item.satuan || 'Unit');
    setBebanBiaya(item.beban_biaya || 'KONTRAKTOR');
    setSelectedItemId(item.barang_id);
    setMutationType(item.jenis);
    setQty(item.jumlah);
    setPurpose(item.tujuan_keperluan || '');
    setPic(item.pic_penerima_penyerah || user.name);
    setSuratJalan(item.nomor_surat_jalan || '');
    setNotes(item.catatan || '');
    setMutationDate(toLocalDateInput(item.tanggal));
    setSourceName(item.source_name || '');
    setDestinationName(item.destination_name || '');
  };

  // Konfirmasi GANTI Mutasi
  const handleConfirmGanti = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiTarget || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);

    const itemName = isCustomMode ? customItemName.trim() : (currentPhysicalMaterial?.nama_barang || gantiTarget.nama_barang || 'Material');
    const itemSatuan = isCustomMode ? customItemUom.trim() : (currentPhysicalMaterial?.satuan || gantiTarget.satuan || 'Unit');

    try {
      const res = await gantiStockMutation(
        gantiTarget.id,
        {
          barang_id: isCustomMode ? '' : selectedItemId,
          nama_barang: itemName,
          jenis: mutationType,
          jumlah: qty,
          satuan: itemSatuan,
          tujuan_keperluan: purpose,
          pic_penerima_penyerah: pic,
          nomor_surat_jalan: suratJalan || undefined,
          tanggal: buildOccurredAtIso(mutationDate),
          catatan: notes || undefined,
          source_name: sourceName || undefined,
          destination_name: destinationName || undefined,
          recipient_name: pic || undefined,
          owner_type: ownerType,
          purpose: purpose,
          beban_biaya: bebanBiaya,
          is_custom_item: isCustomMode
        },
        gantiReason
      );

      if (res.success) {
        setNoticeMessage(res.message);
        setGantiTarget(null);
        setGantiReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengganti dokumen transaksi.');
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================================
  // HANDLER DOKUMEN RESMI & PERSETUJUAN BERANTAI (KHUSUS DOKUMEN)
  // ============================================================================
  const handleIssueStockDocument = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    if (!docTitle.trim()) {
      setErrorMessage('Judul dokumen resmi wajib diisi.');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const validTrx = stockMutations.filter((m) => !m.is_batal && !m.is_ganti);
      const inCount = validTrx.filter((m) => m.jenis === 'MASUK').length;
      const outCount = validTrx.filter((m) => m.jenis === 'KELUAR').length;
      const res = await issueOfficialDocument({
        jenis: 'MUTASI_STOK',
        judul: docTitle.trim(),
        periode: docPeriode.trim() || 'Periode Berjalan',
        ringkasan: docRingkasan.trim() || `Rekapitulasi ${validTrx.length} transaksi mutasi barang (${inCount} Masuk, ${outCount} Keluar)`,
        total_nilai_atau_item: `${validTrx.length} Transaksi (${boqMetrics.arrivedMaterialTypesCount} Jenis Material Tiba)`
      });
      if (res.success) {
        setNoticeMessage(res.message);
        setDocRingkasan('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal menerbitkan dokumen resmi.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdvanceStockDocument = async (docDbId: string, currentStatus: StatusDokumenWorkflow, nextStatus: StatusDokumenWorkflow) => {
    if (nextStatus === 'DISETUJUI' && currentStatus !== 'DIPERIKSA') {
      setErrorMessage('Alur persetujuan berantai: Dokumen wajib Diperiksa terlebih dahulu oleh Foreman / Spv sebelum Disetujui.');
      return;
    }
    if (nextStatus === 'MENGETAHUI' && currentStatus !== 'DISETUJUI') {
      setErrorMessage('Alur persetujuan berantai: Dokumen wajib Disetujui terlebih dahulu oleh Spv / Dept. Manager sebelum disahkan Mengetahui (TTE/QR).');
      return;
    }
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceDocumentWorkflow(docDbId, nextStatus);
      if (res.success) {
        setNoticeMessage(res.message);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal memproses persetujuan dokumen.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmBatalDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!batalDocTargetId || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await batalOfficialDocument(batalDocTargetId, batalDocReason);
      if (res.success) {
        setNoticeMessage(res.message);
        setBatalDocTargetId(null);
        setBatalDocReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal membatalkan dokumen.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleConfirmGantiDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gantiDocTargetId || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const validTrx = stockMutations.filter((m) => !m.is_batal && !m.is_ganti);
      const res = await gantiOfficialDocument(
        gantiDocTargetId,
        {
          jenis: 'MUTASI_STOK',
          judul: gantiDocTitle.trim() || 'Berita Acara Rekapitulasi Mutasi Barang (Revisi)',
          periode: gantiDocPeriode.trim() || 'Periode Berjalan',
          ringkasan: gantiDocRingkasan.trim() || `Revisi Rekapitulasi ${validTrx.length} transaksi mutasi barang`,
          total_nilai_atau_item: `${validTrx.length} Transaksi`
        },
        gantiDocReason
      );
      if (res.success) {
        setNoticeMessage(res.message);
        setGantiDocTargetId(null);
        setGantiDocReason('');
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Gagal mengganti dokumen.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDownloadStockDocPDF = async (docCode: string) => {
    try {
      const validMutations = stockMutations.filter((m) => !m.is_batal && !m.is_ganti);
      const today = new Date().toISOString().slice(0, 10);
      await generateStockMutationPDF({
        docId: docCode,
        startDate: '2026-01-01',
        endDate: today,
        mutations: validMutations,
        signer: user
      });
      setNoticeMessage(`Dokumen PDF Resmi (${docCode}) dengan QR Code Verifikasi berhasil diunduh.`);
    } catch (err: any) {
      setErrorMessage('Gagal mengunduh PDF dokumen: ' + (err?.message || 'Kesalahan sistem'));
    }
  };

  if (modalOnly && !isModalOpen) return null;
  if (!dataReady) return <div className="p-8 text-center text-xs text-slate-500">Memuat data mutasi barang...</div>;

  return (
    <div className={modalOnly ? '' : 'space-y-5'}>
      {/* Notifikasi & Pesan */}
      {noticeMessage && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{noticeMessage}</span>
          </div>
          <div className="flex items-center gap-2">
            {!modalOnly && activeTab !== 'MUTATION_HISTORY' && (
              <button
                type="button"
                onClick={() => setActiveTab('MUTATION_HISTORY')}
                className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 transition-colors cursor-pointer"
              >
                Lihat di Jurnal Transaksi →
              </button>
            )}
            <button onClick={() => setNoticeMessage(null)} aria-label="Tutup pemberitahuan" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-base font-bold">×</button>
          </div>
        </div>
      )}

      {errorMessage && (
        <div role="alert" className="flex items-center justify-between rounded-xl border border-rose-300 bg-rose-50 p-3.5 text-xs text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <button onClick={() => setErrorMessage(null)} aria-label="Tutup pesan galat" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-base font-bold">×</button>
        </div>
      )}

      {!modalOnly && (
        <>
          {/* Banner Viewer / Pengamat */}
          {activeRole === 'Viewer/Pengamat' && (
            <div className="flex items-center gap-3 p-3.5 rounded-2xl bg-cyan-950/40 border border-cyan-500/30 text-cyan-200 text-xs">
              <Eye className="w-4 h-4 text-cyan-400 shrink-0" />
              <div className="flex-1 leading-relaxed">
                <span className="font-bold text-cyan-300">Mode Viewer / Pengamat Aktif:</span> Anda memiliki akses transparansi penuh untuk mengamati progres realisasi BOQ, mutasi fisik, riwayat transaksi, dan ekspor laporan PDF. Fitur entri dan persetujuan dinonaktifkan untuk menjaga integritas data.
              </div>
            </div>
          )}

          {/* Header Panel */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm transition-colors">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                Modul Mutasi Barang & Pemantauan BOQ
              </h1>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 font-medium">
                Pencatatan masuk/keluar material untuk pemantauan realisasi kontrak BOQ. Jejak audit abadi tanpa fitur hapus.
              </p>
            </div>

            {/* Tombol Terbitkan (Hanya untuk Clerk atau Admin) */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => handleOpenNewModal('MASUK')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-emerald-600 rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Penerimaan Barang' : 'Hanya Clerk yang dapat menerbitkan dokumen'}
              >
                <ArrowDownLeft className="w-4 h-4" />
                <span>+ Catat Masuk</span>
              </button>
              <button
                onClick={() => handleOpenNewModal('KELUAR')}
                disabled={!rolePermissions.canIssue}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-rose-600 rounded-xl hover:bg-rose-700 disabled:opacity-40 transition-colors shadow-sm"
                title={rolePermissions.canIssue ? 'Catat Pengeluaran Barang' : 'Hanya Clerk yang dapat menerbitkan dokumen'}
              >
                <ArrowUpRight className="w-4 h-4" />
                <span>- Catat Keluar</span>
              </button>
            </div>
          </div>

          {/* Navigasi 4 POV Terpisah: Satukan Masuk vs Bedakan Keluar vs Jurnal & Kustom vs Dokumen Resmi */}
          <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => startTransition(() => setActiveTab('WAREHOUSE_SUMMARY'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'WAREHOUSE_SUMMARY'
                  ? 'border-emerald-600 text-emerald-700 dark:text-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/25 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <Boxes className="w-4 h-4" />
              <span>📦 Rekap Gudang ("Satukan Masuk")</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 font-bold">
                {boqMetrics.totalMaterialTypesCount} Material
              </span>
            </button>

            <button
              onClick={() => startTransition(() => setActiveTab('BOQ_MONITOR'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'BOQ_MONITOR'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>🏗️ Realisasi per Pos BOQ ("Bedakan Keluar")</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 font-bold">
                {items.length} Pos
              </span>
            </button>

            <button
              onClick={() => startTransition(() => setActiveTab('MUTATION_HISTORY'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'MUTATION_HISTORY'
                  ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              <span>📋 Jurnal Transaksi & Barang Kustom</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-bold">
                {stockMutations.length} Baris
              </span>
            </button>

            <button
              onClick={() => startTransition(() => setActiveTab('OFFICIAL_DOCUMENTS'))}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'OFFICIAL_DOCUMENTS'
                  ? 'border-amber-600 text-amber-700 dark:text-amber-400 bg-amber-50/60 dark:bg-amber-950/25 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <FileCheck2 className="w-4 h-4" />
              <span>📄 Dokumen & Persetujuan Resmi (TTE/QR)</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 font-bold">
                {stockDocuments.length} Dokumen
              </span>
            </button>
          </div>

          {/* =====================================================================
              POV 1: REKAP GUDANG MATERIAL — "SATUKAN MASUK" (1 BARIS PER MATERIAL)
          ===================================================================== */}
          {activeTab === 'WAREHOUSE_SUMMARY' && (
            <div className="space-y-4">
              {/* Penjelasan Singkat POV "Satukan Masuk" */}
              <div className="bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="space-y-1">
                  <div className="text-xs font-bold text-emerald-900 dark:text-emerald-200 flex items-center gap-2">
                    <Boxes className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                    <span>POV 1: Rekapitulasi Gudang Material ("Satukan Masuk") — 1 Nama Material = 1 Baris</span>
                  </div>
                  <p className="text-[11px] text-slate-700 dark:text-slate-300 font-medium">
                    Saat barang BOQ tiba di proyek (contoh: <b>Pasir 5 m3</b>), cukup dilihat pada <b>1 baris gabungan</b> di bawah ini tanpa terduplikasi di 13 pos pekerjaan. Untuk memantau pemakaian per pos pekerjaan BOQ, buka tab <b>Realisasi per Pos BOQ ("Bedakan Keluar")</b>.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('BOQ_MONITOR')}
                  className="shrink-0 px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                >
                  Lihat Pemakaian per 274 Pos BOQ →
                </button>
              </div>

              {/* Filter & Pencarian Gudang Material */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Cari nama material di gudang"
                    placeholder="Cari nama material fisik (contoh: Pasir, Semen, Kayu, Besi)..."
                    value={warehouseSearchQuery}
                    onChange={(e) => setWarehouseSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-emerald-500/20"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'ALL', label: `Semua Material (${boqMetrics.totalMaterialTypesCount})` },
                    { id: 'HAS_ARRIVED', label: `Sudah Ada Masuk (${boqMetrics.arrivedMaterialTypesCount})` },
                    { id: 'IN_STOCK', label: `Tersedia di Gudang (${(physicalMaterials || []).filter((pm) => pm.is_stock_item && pm.stok_fisik > 0).length})` },
                    { id: 'NOT_ARRIVED', label: `Belum Tiba (${boqMetrics.totalMaterialTypesCount - boqMetrics.arrivedMaterialTypesCount})` }
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setWarehouseFilter(f.id as any)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors cursor-pointer ${
                        warehouseFilter === f.id
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tabel 1 Baris per Nama Material ("Satukan Masuk") */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 w-10 text-center">No</th>
                        <th className="py-3 px-3.5">Nama Material & Cakupan Pos BOQ</th>
                        <th className="py-3 px-3 text-center">Satuan</th>
                        <th className="py-3 px-3 text-right">Total Kebutuhan Proyek</th>
                        <th className="py-3 px-3 text-right">Total Sudah Masuk Gudang</th>
                        <th className="py-3 px-3 text-right">Sisa Belum Tiba</th>
                        <th className="py-3 px-3 text-right">Total Sudah Dipakai (Keluar)</th>
                        <th className="py-3 px-3 text-right">Saldo Fisik Gudang</th>
                        <th className="py-3 px-3 text-center">Status Gudang</th>
                        <th className="py-3 px-3.5 text-center">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredWarehouseMaterials.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Tidak ada material fisik yang cocok dengan filter pencarian.
                          </td>
                        </tr>
                      ) : (
                        filteredWarehouseMaterials.map((pm, idx) => {
                          const totalTarget = pm.total_qty_boq || 0;
                          const totalMasuk = pm.total_qty_masuk || 0;
                          const totalKeluar = pm.total_qty_keluar || 0;
                          const sisaBelumTiba = Math.max(0, totalTarget - totalMasuk);
                          const pctTiba = totalTarget > 0 ? Math.round((totalMasuk / totalTarget) * 100) : 0;
                          const posCount = pm.budget_lines.length;

                          return (
                            <tr
                              key={pm.id}
                              className={`hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors ${
                                totalMasuk > 0 ? 'bg-emerald-50/20 dark:bg-emerald-950/10' : ''
                              }`}
                            >
                              <td className="py-3 px-3.5 text-center font-mono text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                                {idx + 1}
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="font-bold text-slate-900 dark:text-white flex items-center gap-2 flex-wrap">
                                  <span>{pm.nama_barang}</span>
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300">
                                    {posCount} Pos BOQ
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 font-medium mt-0.5">
                                  Digunakan pada kode pos:{' '}
                                  <span className="font-mono">
                                    {pm.budget_lines.slice(0, 5).map((bl) => bl.kode_boq).join(', ')}
                                    {posCount > 5 ? ` (+${posCount - 5} pos lainnya)` : ''}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3 px-3 text-center font-mono font-semibold text-slate-700 dark:text-slate-200">
                                {pm.satuan}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-200">
                                {totalTarget.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                <div>{totalMasuk.toLocaleString('id-ID', { maximumFractionDigits: 3 })}</div>
                                <div className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
                                  {pctTiba}% tiba di proyek
                                </div>
                              </td>
                              <td className="py-3 px-3 text-right font-mono text-slate-700 dark:text-slate-300 font-medium">
                                {sisaBelumTiba.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                                {totalKeluar.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                              </td>
                              <td className="py-3 px-3 text-right font-mono font-black">
                                <span
                                  className={
                                    pm.stok_fisik > 0
                                      ? 'text-emerald-600 dark:text-emerald-400 text-sm'
                                      : 'text-slate-600 dark:text-slate-300'
                                  }
                                >
                                  {pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center">
                                {pm.stok_fisik > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                    <CheckCircle2 className="w-3 h-3" /> Tersedia ({pm.stok_fisik.toLocaleString('id-ID')} {pm.satuan})
                                  </span>
                                ) : totalMasuk > 0 ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                    Habis Terpakai
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    Belum Ada Masuk
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenWarehouseMaterialIn(pm)}
                                    disabled={!rolePermissions.canIssue}
                                    title="Catat penerimaan barang masuk ke gudang"
                                    className="px-2.5 py-1 bg-emerald-600 text-white rounded-lg text-[10px] font-bold hover:bg-emerald-700 disabled:opacity-40 transition-colors cursor-pointer"
                                  >
                                    + Catat Masuk
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleViewItemHistory(pm.nama_barang)}
                                    title="Lihat riwayat transaksi material ini"
                                    className="p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors cursor-pointer"
                                  >
                                    <History className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              POV 2: REALISASI PER POS PEKERJAAN BOQ — "BEDAKAN KELUAR" (274 POS)
          ===================================================================== */}
          {activeTab === 'BOQ_MONITOR' && (
            <div className="space-y-4">
              {/* Ringkasan Nilai Kontrak Resmi (POV Kontraktor CV Menara Megah & Klien PT IMK) */}
              <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 dark:from-slate-950 dark:via-blue-950/70 dark:to-slate-950 text-white p-4 sm:p-5 rounded-2xl border border-blue-900/40 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b border-blue-800/40">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-600/30 rounded-xl border border-blue-500/40">
                      <FileCheck2 className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold uppercase tracking-wider text-blue-300">
                        POV 2: Realisasi Pemakaian per Pos Pekerjaan BOQ ("Bedakan Keluar")
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        CV MENARA MEGAH · Trainer & UDU Office (Klien: PT INDO MURO KENCANA) — Fokus Pemakaian per Pos Pekerjaan
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExportBOQPDF}
                      disabled={isExportingBoq}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>{isExportingBoq ? 'Menyiapkan PDF...' : 'Ekspor PDF BOQ'}</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 pt-3.5">
                  <div className="bg-white/5 dark:bg-white/[0.03] p-3 rounded-xl border border-white/10">
                    <span className="text-[10px] uppercase font-bold text-slate-300 tracking-wider">1. Material Kontrak</span>
                    <div className="mt-1 text-base sm:text-lg font-black text-blue-400 font-mono">Rp 448.150.623</div>
                    <span className="text-[10px] text-slate-300">Tanggungan CV Menara Megah</span>
                  </div>

                  <div className="bg-white/5 dark:bg-white/[0.03] p-3 rounded-xl border border-white/10">
                    <span className="text-[10px] uppercase font-bold text-slate-300 tracking-wider">2. Upah & Jasa (Manpower)</span>
                    <div className="mt-1 text-base sm:text-lg font-black text-emerald-400 font-mono">Rp 271.849.378</div>
                    <span className="text-[10px] text-slate-300">Jasa Bongkar & Bangun</span>
                  </div>

                  <div className="bg-amber-500/10 dark:bg-amber-500/[0.08] p-3 rounded-xl border border-amber-500/30">
                    <span className="text-[10px] uppercase font-bold text-amber-300 tracking-wider">3. Grand Total Kontrak</span>
                    <div className="mt-1 text-base sm:text-lg font-black text-amber-300 font-mono">Rp 720.000.000</div>
                    <span className="text-[10px] text-amber-200/90 font-medium">Nilai Resmi SPK / Kontrak</span>
                  </div>

                  <div className="bg-purple-950/50 p-3 rounded-xl border border-purple-800/40">
                    <span className="text-[10px] uppercase font-bold text-purple-300 tracking-wider">Free-Issue Klien (PT IMK)</span>
                    <div className="mt-1 text-base sm:text-lg font-black text-purple-300 font-mono">Rp 177.571.280</div>
                    <span className="text-[10px] text-purple-200">Disediakan Klien (Beban Kontraktor: Rp 0)</span>
                  </div>
                </div>
              </div>

              {/* Filter & Kontrol Pencarian BOQ */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Cari kode BOQ, nama material, atau uraian pekerjaan"
                    placeholder="Cari kode BOQ (I/A/1), nama material (Kayu, Pasir, Semen), atau uraian pekerjaan..."
                    value={boqSearchQuery}
                    onChange={(e) => setBoqSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-xl border border-slate-200 dark:border-slate-700">
                    <button
                      onClick={() => setBoqProviderFilter('ALL')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        boqProviderFilter === 'ALL'
                          ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      Semua Penyedia
                    </button>
                    <button
                      onClick={() => setBoqProviderFilter('KONTRAKTOR')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        boqProviderFilter === 'KONTRAKTOR'
                          ? 'bg-blue-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      🏢 Menara Megah
                    </button>
                    <button
                      onClick={() => setBoqProviderFilter('IMK')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        boqProviderFilter === 'IMK'
                          ? 'bg-purple-600 text-white shadow-xs'
                          : 'text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      👤 PT IMK
                    </button>
                  </div>

                  <select
                    value={boqStatusFilter}
                    onChange={(e) => setBoqStatusFilter(e.target.value as any)}
                    aria-label="Filter status pemakaian pos BOQ"
                    className="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden"
                  >
                    <option value="ALL">Semua Status Pos</option>
                    <option value="Belum dipenuhi">Belum Dipakai</option>
                    <option value="Dalam pemenuhan">Dalam Proses</option>
                    <option value="Terpenuhi">Terpenuhi</option>
                    <option value="Melebihi BOQ">Melebihi BOQ</option>
                  </select>

                  <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-2">
                    <button
                      onClick={handleExpandAll}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Buka Semua
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      onClick={handleCollapseAll}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                    >
                      Tutup Semua
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabel Hierarki 274 Pos Pekerjaan BOQ — "Bedakan Keluar" (Tanpa Duplikasi Kolom Masuk) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 w-24">Kode BOQ</th>
                        <th className="py-3 px-3.5">Uraian Material & Pekerjaan</th>
                        <th className="py-3 px-3 text-center">Penyedia</th>
                        <th className="py-3 px-3 text-right">Target Pos BOQ</th>
                        <th className="py-3 px-3 text-right">Terpakai di Pos Ini (Keluar)</th>
                        <th className="py-3 px-3 text-right">Sisa Kebutuhan Pos</th>
                        <th className="py-3 px-3 text-center">Ketersediaan Gudang</th>
                        <th className="py-3 px-3 text-center">Status Pos</th>
                        <th className="py-3 px-3.5 text-center w-28">Aksi Pemakaian</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {groupedBoqData.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Tidak ada pos pekerjaan BOQ yang cocok dengan filter pencarian.
                          </td>
                        </tr>
                      ) : (
                        groupedBoqData.map((div) => {
                          const isDivCollapsed = collapsedDivisions.has(div.name);

                          return (
                            <React.Fragment key={div.name}>
                              <tr className="bg-[#FFF9C4] dark:bg-[#713F12]/60 border-y border-amber-300 dark:border-amber-900/60 text-amber-950 dark:text-amber-200 font-bold transition-colors">
                                <td colSpan={9} className="py-2.5 px-3.5">
                                  <button
                                    onClick={() => toggleDivision(div.name)}
                                    className="flex items-center gap-2 w-full text-left text-xs uppercase tracking-wide cursor-pointer focus:outline-hidden"
                                  >
                                    {isDivCollapsed ? (
                                      <ChevronRight className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                                    ) : (
                                      <ChevronDown className="w-4 h-4 text-amber-800 dark:text-amber-400 shrink-0" />
                                    )}
                                    <span>{div.name}</span>
                                    <span className="ml-auto text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-amber-200/90 dark:bg-amber-900/80 text-amber-900 dark:text-amber-200">
                                      {div.totalItems} Pos
                                    </span>
                                  </button>
                                </td>
                              </tr>

                              {!isDivCollapsed &&
                                div.subSections.map((sub) => {
                                  const subKey = `${div.name}__${sub.name}`;
                                  const isSubCollapsed = collapsedSubSections.has(subKey);

                                  return (
                                    <React.Fragment key={subKey}>
                                      <tr className="bg-[#DCFCE7] dark:bg-[#064E3B]/60 border-y border-emerald-300 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-200 font-semibold transition-colors">
                                        <td colSpan={9} className="py-2 px-4">
                                          <button
                                            onClick={() => toggleSubSection(subKey)}
                                            className="flex items-center gap-2 w-full text-left text-xs cursor-pointer focus:outline-hidden"
                                          >
                                            {isSubCollapsed ? (
                                              <ChevronRight className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400 shrink-0" />
                                            ) : (
                                              <ChevronDown className="w-3.5 h-3.5 text-emerald-800 dark:text-emerald-400 shrink-0" />
                                            )}
                                            <span>{sub.name}</span>
                                            <span className="ml-auto text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-200/90 dark:bg-emerald-900/70 text-emerald-900 dark:text-emerald-200">
                                              {sub.items.length} Pos · {sub.imkCount > 0 ? `${sub.imkCount} Klien · ` : ''}{sub.kontraktorCount} Menara Megah
                                            </span>
                                          </button>
                                        </td>
                                      </tr>

                                      {!isSubCollapsed &&
                                        sub.items.map((item) => {
                                          const isImk = (item.keterangan || '').toLowerCase().includes('imk');
                                          const keluarPosPct = item.qty_boq > 0 ? Math.round((item.qty_keluar_total / item.qty_boq) * 100) : 0;

                                          return (
                                            <tr
                                              key={item.id}
                                              className="hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors bg-white dark:bg-slate-900"
                                            >
                                              <td className="py-2.5 px-3.5 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                                {item.kode_boq}
                                              </td>

                                              <td className="py-2.5 px-3.5">
                                                <div className="font-semibold text-slate-900 dark:text-white">
                                                  {item.nama_barang}
                                                </div>
                                                {isImk ? (
                                                  <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                                                    Beban Kontraktor: Rp 0 (Disediakan Klien PT IMK)
                                                  </div>
                                                ) : (
                                                  <div className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                                    {formatRupiah(item.harga_satuan)} / {item.satuan}
                                                    <span className="ml-1 font-semibold text-slate-700 dark:text-slate-200">
                                                      (Anggaran Pos: {formatRupiah(item.harga_satuan * item.qty_boq)})
                                                    </span>
                                                  </div>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-center">
                                                {isImk ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800">
                                                    👤 PT IMK
                                                  </span>
                                                ) : (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800">
                                                    🏢 Menara Megah
                                                  </span>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                                                {item.qty_boq.toLocaleString('id-ID', { maximumFractionDigits: 3 })}{' '}
                                                <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">{item.satuan}</span>
                                              </td>

                                              <td className="py-2.5 px-3 text-right font-mono font-bold text-rose-600 dark:text-rose-400">
                                                <div>
                                                  {item.qty_keluar_total.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                                </div>
                                                {item.qty_keluar_total > 0 && (
                                                  <div className="text-[9px] font-medium text-slate-600 dark:text-slate-300">
                                                    {keluarPosPct}% terpakai
                                                  </div>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300 font-medium">
                                                {item.qty_pemenuhan_sisa.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                              </td>

                                              <td className="py-2.5 px-3 text-center">
                                                {item.stok_saat_ini > 0 ? (
                                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/70">
                                                    Gudang: {item.stok_saat_ini.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {item.satuan} siap pakai
                                                  </span>
                                                ) : (
                                                  <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                                    Gudang: 0 {item.satuan}
                                                  </span>
                                                )}
                                              </td>

                                              <td className="py-2.5 px-3 text-center">
                                                {renderBoqStatusBadge(item)}
                                              </td>

                                              <td className="py-2.5 px-3.5 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                  <button
                                                    onClick={() => handleOpenItemMutation(item, 'KELUAR')}
                                                    disabled={!rolePermissions.canIssue}
                                                    title="Catat pemakaian (keluar) khusus untuk pos pekerjaan BOQ ini"
                                                    className="px-2.5 py-1 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-lg text-[10px] font-bold hover:bg-rose-100 dark:hover:bg-rose-900/60 disabled:opacity-40 transition-colors cursor-pointer"
                                                  >
                                                    - Pakai / Keluar
                                                  </button>
                                                  <button
                                                    onClick={() => handleViewItemHistory(item.nama_barang)}
                                                    aria-label="Lihat riwayat mutasi material ini"
                                                    title="Lihat riwayat mutasi material ini"
                                                    className="p-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white rounded-lg transition-colors cursor-pointer"
                                                  >
                                                    <History className="w-3.5 h-3.5" />
                                                  </button>
                                                </div>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                    </React.Fragment>
                                  );
                                })}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              POV 3: JURNAL TRANSAKSI & MATRIKS PANDUAN TATA KELOLA BARANG
          ===================================================================== */}
          {activeTab === 'MUTATION_HISTORY' && (
            <div className="space-y-4">
              {/* Matriks Panduan Tata Kelola Barang (BOQ vs Kustom Non-BOQ) */}
              <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Matriks Panduan Tata Kelola Barang & Koreksi Data (CRU Tanpa Hapus)</span>
                  </div>
                  <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                    Koreksi Baris Langsung (Tanpa Menunggu Approval Berantai)
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[11px]">
                  <div className="p-3 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-200 dark:border-emerald-800/60">
                    <div className="font-bold text-emerald-900 dark:text-emerald-300 mb-1">
                      1. Barang Kontrak BOQ ("Satukan Masuk, Bedakan Keluar")
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      Saat <b>Masuk</b>, material dicatat menyatu ke stok gudang umum (Tab 1). Saat <b>Keluar</b>, material wajib dipilih untuk Pos Pekerjaan BOQ spesifik (Tab 2).
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-purple-50/60 dark:bg-purple-950/25 border border-purple-200 dark:border-purple-800/60">
                    <div className="font-bold text-purple-900 dark:text-purple-300 mb-1">
                      2. Barang Kustom Non-BOQ ("Bedakan Masuk & Keluar")
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      Peruntukan saat <b>Masuk</b> dan saat <b>Keluar</b> dicatat terpisah. Peruntukan keluar boleh berbeda dari rencana awal saat masuk sesuai dinamika lapangan.
                    </p>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/25 border border-amber-200 dark:border-amber-800/60">
                    <div className="font-bold text-amber-900 dark:text-amber-300 mb-1">
                      3. Koreksi Baris Data vs Persetujuan Dokumen
                    </div>
                    <p className="text-slate-700 dark:text-slate-300 leading-relaxed">
                      Tidak ada tombol Hapus. Jika salah input baris, Clerk langsung klik <b>Batal</b> atau <b>Ganti</b> (nominal lama otomatis dinolkan). Persetujuan berantai khusus di Tab 4 (Dokumen).
                    </p>
                  </div>
                </div>
              </div>

              {searchQuery && (
                <div className="flex items-center justify-between p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl text-xs text-blue-900 dark:text-blue-200">
                  <div className="flex items-center gap-2">
                    <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    <span>Menampilkan mutasi khusus untuk: <strong>{searchQuery}</strong></span>
                  </div>
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-xs font-semibold underline hover:text-blue-700 dark:hover:text-blue-100 cursor-pointer"
                  >
                    Hapus Filter & Tampilkan Semua
                  </button>
                </div>
              )}

              {/* Filter & Pencarian */}
              <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 transition-colors">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    aria-label="Cari transaksi mutasi barang"
                    placeholder="Cari transaksi, material, keperluan, PIC, atau no surat jalan..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { id: 'ALL', label: `Semua (${stockMutations.length})` },
                    { id: 'MASUK', label: `Masuk (${stockMutations.filter((m) => m.jenis === 'MASUK').length})` },
                    { id: 'KELUAR', label: `Keluar (${stockMutations.filter((m) => m.jenis === 'KELUAR').length})` },
                    { id: 'PROYEK_BOQ', label: `Proyek BOQ (${stockMutations.filter((m) => m.beban_biaya === 'PROYEK_BOQ' || m.beban_biaya === 'KONTRAKTOR').length})` },
                    { id: 'PERMINTAAN_KLIEN', label: `Minta Klien (${stockMutations.filter((m) => m.beban_biaya === 'KLIEN' || (m.beban_biaya as string) === 'PERMINTAAN_KLIEN').length})` },
                    { id: 'BONUS_KLIEN', label: `Bonus Klien (${stockMutations.filter((m) => m.beban_biaya === 'BONUS_KLIEN').length})` },
                    { id: 'OPERASIONAL', label: `Operasional (${stockMutations.filter((m) => m.beban_biaya === 'OPERASIONAL').length})` },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setFilterType(tab.id as any)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-xl transition-colors ${
                        filterType === tab.id
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tabel Riwayat Baris Transaksi (Tanpa Kolom Persetujuan per Baris!) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 w-10 text-center">No</th>
                        <th className="py-3 px-3.5">Tanggal</th>
                        <th className="py-3 px-3.5 text-center">Jenis</th>
                        <th className="py-3 px-3.5">Material</th>
                        <th className="py-3 px-3.5 text-right">Jumlah</th>
                        <th className="py-3 px-3.5">Asal / Peruntukan & Jejak Audit</th>
                        <th className="py-3 px-3.5 text-center">Status Baris Data</th>
                        <th className="py-3 px-3.5 text-center">Koreksi Langsung (Batal / Ganti)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredMutations.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Belum ada riwayat transaksi mutasi barang.
                          </td>
                        </tr>
                      ) : (
                        filteredMutations.map((mut, idx) => {
                          const isVoid = mut.is_batal || mut.status_dokumen === 'BATAL';
                          const isReplaced = mut.is_ganti || mut.status_dokumen === 'DIGANTI';
                          const canCorrectRow = rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti;

                          return (
                            <tr
                              key={mut.id}
                              className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                                isVoid ? 'opacity-55 bg-rose-50/20 line-through' : isReplaced ? 'opacity-65 bg-amber-50/20 line-through' : ''
                              }`}
                            >
                              <td className="py-3 px-3.5 text-center text-slate-600 dark:text-slate-300 font-mono text-[11px] font-medium">
                                {idx + 1}
                              </td>
                              <td className="py-3 px-3.5 text-slate-700 dark:text-slate-200 font-mono text-[11px] whitespace-nowrap">
                                {formatDateTime(mut.tanggal)}
                              </td>
                              <td className="py-3 px-3.5 text-center">
                                <span
                                  className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                    mut.jenis === 'MASUK'
                                      ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                                      : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                                  }`}
                                >
                                  {mut.jenis === 'MASUK' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                                  {mut.jenis}
                                </span>
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="font-semibold text-slate-900 dark:text-white">{mut.nama_barang}</span>
                                  {mut.is_custom_item ? (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                                      ✍️ Kustom Non-BOQ
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-0.5 text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300">
                                      📦 BOQ
                                    </span>
                                  )}
                                </div>
                                {mut.catatan && <div className="text-[11px] text-slate-600 dark:text-slate-300 italic mt-0.5">{mut.catatan}</div>}
                              </td>
                              <td className="py-3 px-3.5 text-right font-mono font-bold tabular-nums whitespace-nowrap">
                                <span className={mut.jenis === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>
                                  {mut.jenis === 'MASUK' ? '+' : '-'} {mut.jumlah.toLocaleString('id-ID')}
                                </span>{' '}
                                <span className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">{mut.satuan}</span>
                                {(isVoid || isReplaced) && (
                                  <div className="text-[9px] font-bold text-rose-600 dark:text-rose-400 no-underline">
                                    Dinolkan (0 {mut.satuan})
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-slate-700 dark:text-slate-300 max-w-xs">
                                <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                                  {mut.jenis === 'MASUK' ? (
                                    <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${
                                      mut.source_name?.includes('Klien')
                                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
                                        : mut.source_name?.includes('Toko')
                                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300'
                                        : 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300'
                                    }`}>
                                      {mut.source_name || '🏢 CV Menara Megah'}
                                    </span>
                                  ) : (
                                    mut.beban_biaya === 'KLIEN' || (mut.beban_biaya as string) === 'PERMINTAAN_KLIEN' ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300">
                                        💰 Permintaan Klien (Kena Invoice)
                                      </span>
                                    ) : mut.beban_biaya === 'BONUS_KLIEN' ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/70 text-purple-800 dark:text-purple-300">
                                        🎁 Bonus Klien (Gratis)
                                      </span>
                                    ) : mut.beban_biaya === 'OPERASIONAL' ? (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-950/70 text-sky-800 dark:text-sky-300">
                                        🧑‍🍳 Operasional
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                                        🏗️ Proyek BOQ
                                      </span>
                                    )
                                  )}
                                </div>
                                <div className="truncate font-medium">
                                  {mut.is_custom_item
                                    ? `${mut.jenis === 'MASUK' ? 'Peruntukan Masuk: ' : 'Peruntukan Keluar: '}${mut.tujuan_keperluan || '-'}`
                                    : mut.tujuan_keperluan || '-'}
                                </div>
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 font-mono mt-0.5">
                                  PIC: {mut.pic_penerima_penyerah}
                                  {mut.referensi_ganti_id ? ` · Revisi dari #${mut.referensi_ganti_id.slice(0, 8)}` : ''}
                                </div>
                                {mut.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-md">
                                    {mut.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>

                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {isVoid ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                    <Ban className="h-3 w-3" /> BATAL (Dinolkan)
                                  </span>
                                ) : isReplaced ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    <FileEdit className="h-3 w-3" /> DIGANTI (Dinolkan)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    <CheckCircle2 className="h-3 w-3" /> TERCATAT AKTIF
                                  </span>
                                )}
                              </td>

                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {!isVoid && !isReplaced ? (
                                  canCorrectRow ? (
                                    <div className="flex items-center justify-center gap-1.5">
                                      <button
                                        onClick={() => {
                                          setBatalTarget(mut);
                                          setBatalReason('');
                                        }}
                                        className="px-2.5 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                                        title="Batalkan baris ini secara langsung (nominal dinolkan)"
                                      >
                                        Batal
                                      </button>
                                      <button
                                        onClick={() => handleOpenGanti(mut)}
                                        className="px-2.5 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer"
                                        title="Ganti baris yang salah input ini dengan baris revisi baru"
                                      >
                                        Ganti
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                      🔒 Hanya Baca
                                    </span>
                                  )
                                ) : (
                                  <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">Selesai Dikoreksi</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* =====================================================================
              POV 4: DOKUMEN RESMI & PERSETUJUAN BERANTAI (TTE / QR CODE)
          ===================================================================== */}
          {activeTab === 'OFFICIAL_DOCUMENTS' && (
            <div className="space-y-4">
              {/* Penjelasan & Form Penerbitan Dokumen Resmi oleh Clerk */}
              <div className="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      <FileCheck2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Penerbitan & Persetujuan Berantai Dokumen Resmi Mutasi Barang</span>
                    </h3>
                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 font-medium">
                      Alur persetujuan berjenjang: <b>1. Diterbitkan (Clerk)</b> ➔ <b>2. Diperiksa (Foreman / Spv.)</b> ➔ <b>3. Disetujui (Spv. / Dept. Manager)</b> ➔ <b>4. Mengetahui & Sah TTE/QR (Dept. Manager / KTT-PM / CEO-Direktur)</b>.
                    </p>
                  </div>
                </div>

                {rolePermissions.canIssue ? (
                  <form onSubmit={handleIssueStockDocument} className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                    <div className="md:col-span-2">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Judul Dokumen Berita Acara / Laporan <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={docTitle}
                        onChange={(e) => setDocTitle(e.target.value)}
                        placeholder="Contoh: Berita Acara Rekapitulasi Mutasi Barang Minggu Ke-3"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Periode Laporan <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={docPeriode}
                        onChange={(e) => setDocPeriode(e.target.value)}
                        placeholder="Contoh: November 2026"
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl"
                      />
                    </div>
                    <div className="flex items-end">
                      <button
                        type="submit"
                        disabled={submitting}
                        className="w-full py-2 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold shadow-xs transition-colors cursor-pointer disabled:opacity-40"
                      >
                        {submitting ? 'Menerbitkan...' : '+ Terbitkan Dokumen Resmi'}
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 font-medium">
                    ℹ️ Penerbitan Dokumen Resmi baru dilakukan oleh <b>Clerk</b>. Jabatan Anda saat ini (<b>{activeRole}</b>) dapat memproses tahap pemeriksaan/persetujuan sesuai wewenang pada daftar dokumen di bawah.
                  </div>
                )}
              </div>

              {/* Daftar Dokumen Resmi Mutasi Barang */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5">Kode & Tanggal</th>
                        <th className="py-3 px-3.5">Judul Dokumen & Ringkasan</th>
                        <th className="py-3 px-3.5">Jejak Persetujuan Berantai</th>
                        <th className="py-3 px-3.5 text-center">Status Dokumen</th>
                        <th className="py-3 px-3.5 text-center">Aksi Persetujuan</th>
                        <th className="py-3 px-3.5 text-center">Koreksi & PDF</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {stockDocuments.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Belum ada Dokumen Resmi Mutasi Barang yang diterbitkan. Clerk dapat menerbitkan dokumen di atas untuk memulai persetujuan berantai.
                          </td>
                        </tr>
                      ) : (
                        stockDocuments.map((doc) => {
                          const docDbId = doc.db_id || doc.id;
                          const wfStatus = doc.status_dokumen || 'DITERBITKAN';
                          const isDocVoid = Boolean(doc.is_batal) || wfStatus === 'BATAL';
                          const isDocReplaced = Boolean(doc.is_ganti) || wfStatus === 'DIGANTI';
                          const canCorrectDoc = rolePermissions.canInitiateBatalGanti || rolePermissions.canInstructBatalGanti;

                          return (
                            <tr
                              key={docDbId}
                              className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                                isDocVoid || isDocReplaced ? 'opacity-60 bg-rose-50/10' : ''
                              }`}
                            >
                              <td className="py-3 px-3.5 whitespace-nowrap">
                                <div className="font-mono font-bold text-slate-900 dark:text-white">{doc.id}</div>
                                <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                  {formatDateTime(doc.dibuat_pada)}
                                </div>
                              </td>
                              <td className="py-3 px-3.5">
                                <div className="font-bold text-slate-900 dark:text-white">{doc.judul}</div>
                                <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                                  Diterbitkan oleh: {doc.penandatangan_nama} ({doc.penandatangan_jabatan})
                                </div>
                                {doc.alasan_batal_ganti && (
                                  <div className="mt-1 text-[10px] font-semibold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/50 px-2 py-0.5 rounded-md">
                                    {doc.alasan_batal_ganti}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-[11px] space-y-1">
                                <div className="text-slate-700 dark:text-slate-200">
                                  <span className="font-semibold">1. Terbit:</span> {doc.penandatangan_nama}
                                </div>
                                <div className={doc.diperiksa_oleh ? 'text-indigo-700 dark:text-indigo-300 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">2. Diperiksa:</span> {doc.diperiksa_oleh || 'Menunggu Foreman / Spv.'}
                                </div>
                                <div className={doc.disetujui_oleh ? 'text-emerald-700 dark:text-emerald-300 font-medium' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">3. Disetujui:</span> {doc.disetujui_oleh || 'Menunggu Spv. / Dept. Mgr'}
                                </div>
                                <div className={doc.mengetahui_oleh ? 'text-blue-700 dark:text-blue-300 font-bold' : 'text-slate-500 dark:text-slate-400'}>
                                  <span className="font-semibold">4. Disahkan (TTE):</span> {doc.mengetahui_oleh || 'Menunggu Dept. Mgr / KTT-PM / CEO'}
                                </div>
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {isDocVoid ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                    <Ban className="h-3 w-3" /> BATAL
                                  </span>
                                ) : isDocReplaced ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                    <FileEdit className="h-3 w-3" /> DIGANTI
                                  </span>
                                ) : wfStatus === 'MENGETAHUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                    <QrCode className="h-3 w-3" /> SAH (TTE/QR)
                                  </span>
                                ) : wfStatus === 'DISETUJUI' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                    <FileCheck2 className="h-3 w-3" /> DISETUJUI
                                  </span>
                                ) : wfStatus === 'DIPERIKSA' ? (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                                    <ShieldCheck className="h-3 w-3" /> DIPERIKSA
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                    <Clock className="h-3 w-3" /> DITERBITKAN
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                {!isDocVoid && !isDocReplaced && (
                                  <div className="flex items-center justify-center gap-1.5">
                                    {wfStatus === 'DITERBITKAN' && (
                                      <button
                                        onClick={() => handleAdvanceStockDocument(docDbId, wfStatus, 'DIPERIKSA')}
                                        disabled={!rolePermissions.canCheck || submitting}
                                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-35 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300 cursor-pointer"
                                        title={rolePermissions.canCheck ? 'Periksa Dokumen (Tahap 2)' : 'Wewenang Foreman / Spv.'}
                                      >
                                        Periksa Dokumen
                                      </button>
                                    )}
                                    {wfStatus === 'DIPERIKSA' && (
                                      <button
                                        onClick={() => handleAdvanceStockDocument(docDbId, wfStatus, 'DISETUJUI')}
                                        disabled={!rolePermissions.canApprove || submitting}
                                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-35 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 cursor-pointer"
                                        title={rolePermissions.canApprove ? 'Setujui Dokumen (Tahap 3)' : 'Wewenang Spv. / Dept. Manager'}
                                      >
                                        Setujui Dokumen
                                      </button>
                                    )}
                                    {wfStatus === 'DISETUJUI' && (
                                      <button
                                        onClick={() => handleAdvanceStockDocument(docDbId, wfStatus, 'MENGETAHUI')}
                                        disabled={!rolePermissions.canAcknowledge || submitting}
                                        className="px-2.5 py-1 text-[10px] font-bold rounded-lg border border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-35 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300 cursor-pointer"
                                        title={rolePermissions.canAcknowledge ? 'Sahkan dengan TTE & QR Code (Tahap 4)' : 'Wewenang Dept. Manager / KTT-PM / CEO'}
                                      >
                                        Sahkan (TTE/QR)
                                      </button>
                                    )}
                                    {wfStatus === 'MENGETAHUI' && (
                                      <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                        <CheckCircle2 className="h-3.5 w-3.5" /> Sah & Terverifikasi
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className="py-3 px-3.5 text-center whitespace-nowrap">
                                <div className="flex items-center justify-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => handleDownloadStockDocPDF(doc.id)}
                                    className="px-2.5 py-1 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold transition-colors cursor-pointer"
                                    title="Unduh Dokumen PDF Resmi ber-QR Code"
                                  >
                                    PDF QR
                                  </button>
                                  {!isDocVoid && !isDocReplaced && canCorrectDoc && (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setBatalDocTargetId(docDbId);
                                          setBatalDocReason('');
                                        }}
                                        className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300 cursor-pointer"
                                      >
                                        Batal
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setGantiDocTargetId(docDbId);
                                          setGantiDocTitle(`${doc.judul} (Revisi)`);
                                          setGantiDocPeriode(docPeriode);
                                          setGantiDocRingkasan('');
                                          setGantiDocReason('');
                                        }}
                                        className="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300 cursor-pointer"
                                      >
                                        Ganti
                                      </button>
                                    </>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Modal Konfirmasi BATAL Dokumen Resmi */}
      {batalDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmBatalDoc} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Dokumen Resmi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen ini akan ditandai <b>BATAL</b> dan tetap tersimpan di dalam riwayat audit tanpa dihapus.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Pembatalan Dokumen <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={batalDocReason}
                onChange={(e) => setBatalDocReason(e.target.value)}
                placeholder="Contoh: Terdapat koreksi baris transaksi yang baru diselesaikan..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatalDocTargetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || batalDocReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Ya, Batalkan Dokumen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Form GANTI Dokumen Resmi */}
      {gantiDocTargetId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmGantiDoc} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Terbitkan Revisi Dokumen Resmi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen lama akan ditandai <b>DIGANTI</b> dan dokumen revisi baru akan diterbitkan mulai dari tahap awal persetujuan.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian Dokumen <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={gantiDocReason}
                onChange={(e) => setGantiDocReason(e.target.value)}
                placeholder="Contoh: Pembaruan rekapitulasi setelah penyesuaian kuantitas..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Judul Dokumen Revisi Baru <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={gantiDocTitle}
                onChange={(e) => setGantiDocTitle(e.target.value)}
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGantiDocTargetId(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Tutup
              </button>
              <button
                type="submit"
                disabled={submitting || gantiDocReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Terbitkan Dokumen Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Dialog Kartu Tanya-Jawab Cerdas: Catat Barang Masuk / Keluar */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95">
            <div className="shrink-0 p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div>
                <div className="font-bold text-sm flex items-center gap-2">
                  {mutationType === 'MASUK' ? (
                    <>
                      <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                      <span>Catat Barang Masuk</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpRight className="w-4 h-4 text-rose-400" />
                      <span>Catat Barang Keluar</span>
                    </>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {mutationType === 'MASUK'
                    ? 'Jawab singkat — sistem otomatis mengatur gudang & kategori'
                    : 'Jawab singkat — sistem otomatis memotong stok & memetakan pos'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                aria-label="Tutup jendela mutasi"
                className="text-slate-300 hover:text-white cursor-pointer"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitMutation} className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
              {(() => {
                const boqMeta = !isCustomMode && currentPhysicalMaterial
                  ? getProviderMetaForMaterial(currentPhysicalMaterial)
                  : null;
                const activeUom = isCustomMode
                  ? (customItemUom.trim() || 'Unit')
                  : (currentPhysicalMaterial?.satuan || 'Unit');
                const activeItemName = isCustomMode
                  ? (customItemName.trim() || 'Barang Baru')
                  : (currentPhysicalMaterial?.nama_barang || '');
                const customCurrentStock = selectedCustomItemInfo?.stok ?? 0;

                const boqTotalTarget = currentPhysicalMaterial?.total_qty_boq || 0;
                const boqTotalMasuk = currentPhysicalMaterial?.total_qty_masuk || 0;
                const boqKurang = Math.max(0, boqTotalTarget - boqTotalMasuk);
                const boqKurangSetelah = Math.max(0, boqTotalTarget - (boqTotalMasuk + Number(qty || 0)));

                const originLabel =
                  asalBarang === 'KLIEN'
                    ? 'Klien (PT IMK)'
                    : asalBarang === 'TOKO_BEBAS'
                    ? (tokoBebasName.trim() ? `Lainnya (${tokoBebasName.trim()})` : 'Lainnya / Toko Bebas')
                    : 'Kontraktor';

                const exitDestLabel =
                  tujuanPengeluaran === 'PROYEK_BOQ' && !isCustomMode
                    ? `Pos BOQ ${selectedBudgetLine?.kode_boq || ''}`
                    : tujuanPengeluaran === 'PROYEK_BOQ'
                    ? 'Proyek (Kustom)'
                    : tujuanPengeluaran === 'OPERASIONAL'
                    ? 'Operasional'
                    : tujuanPengeluaran === 'PERMINTAAN_KLIEN'
                    ? 'Minta Klien (Kena Invoice)'
                    : 'Bonus Klien (Gratis)';

                return (
                  <>
                    {/* PERTANYAAN 1: BARANG APA YANG MASUK / KELUAR? */}
                    <div className="space-y-2">
                      <label className="block text-xs font-bold text-slate-900 dark:text-white">
                        {mutationType === 'MASUK'
                          ? '1. Barang apa yang masuk?'
                          : '1. Barang apa yang mau dikeluarkan?'}{' '}
                        <span className="text-rose-500">*</span>
                      </label>

                      {!hasChosenItem ? (
                        <div className="space-y-2">
                          <div className="relative">
                            <Search className="w-4 h-4 text-slate-500 dark:text-slate-300 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                            <input
                              type="text"
                              autoFocus
                              placeholder={
                                mutationType === 'MASUK'
                                  ? 'Ketik nama barang (cth: Pasir, Hollow, Semen, Beras)...'
                                  : 'Ketik nama barang yang ada di gudang...'
                              }
                              value={itemSearchQuery}
                              onChange={(e) => setItemSearchQuery(e.target.value)}
                              className="w-full pl-9 pr-8 py-2.5 bg-slate-50 dark:bg-slate-800 border border-blue-400 dark:border-blue-500 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:outline-hidden focus:ring-2 focus:ring-blue-500/25"
                            />
                            {itemSearchQuery && (
                              <button
                                type="button"
                                onClick={() => setItemSearchQuery('')}
                                aria-label="Bersihkan kata kunci"
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white text-xs font-bold cursor-pointer"
                              >
                                ✕
                              </button>
                            )}
                          </div>

                          {/* Daftar Pencarian Inline (Tidak menumpuk tombol lain) */}
                          <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 max-h-60 overflow-y-auto divide-y divide-slate-200/70 dark:divide-slate-700/60">
                            {filteredBoqSearchResults.length > 0 && (
                              <>
                                <div className="px-3 py-1.5 bg-slate-100/90 dark:bg-slate-800 text-[10px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-200">
                                  Daftar Material Proyek (BOQ)
                                </div>
                                {filteredBoqSearchResults.map((pm) => {
                                  const prov = getProviderMetaForMaterial(pm);
                                  const totalTgt = pm.total_qty_boq || 0;
                                  const totalIn = pm.total_qty_masuk || 0;
                                  const kurang = Math.max(0, totalTgt - totalIn);

                                  return (
                                    <button
                                      key={pm.id}
                                      type="button"
                                      onClick={() => applyBoqMaterialSelection(pm, mutationType)}
                                      className="w-full text-left px-3 py-2.5 hover:bg-blue-50 dark:hover:bg-slate-700/70 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                                    >
                                      <div className="min-w-0 flex-1">
                                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                                          {pm.nama_barang}
                                        </div>
                                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                          <span
                                            className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-[10px] font-semibold ${
                                              prov.defaultAsal === 'KLIEN' && !prov.isMixed
                                                ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-200'
                                                : prov.isMixed
                                                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-200'
                                                : 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-200'
                                            }`}
                                          >
                                            {prov.defaultAsal === 'KLIEN' && !prov.isMixed
                                              ? '👤 Jatah Klien (PT IMK)'
                                              : prov.isMixed
                                              ? '🏢 Kontraktor & PT IMK'
                                              : '🏢 Jatah Kontraktor'}
                                          </span>
                                          <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                            Barang BOQ
                                          </span>
                                        </div>
                                      </div>

                                      <div className="text-right shrink-0 font-mono">
                                        {mutationType === 'MASUK' ? (
                                          <>
                                            <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                                              Masuk: {totalIn.toLocaleString('id-ID', { maximumFractionDigits: 2 })} /{' '}
                                              {totalTgt.toLocaleString('id-ID', { maximumFractionDigits: 2 })} {pm.satuan}
                                            </div>
                                            <div className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                              {kurang > 0
                                                ? `Kurang: ${kurang.toLocaleString('id-ID', { maximumFractionDigits: 2 })} ${pm.satuan}`
                                                : 'Target terpenuhi'}
                                            </div>
                                          </>
                                        ) : (
                                          <div
                                            className={`text-[11px] font-bold ${
                                              pm.stok_fisik > 0
                                                ? 'text-emerald-700 dark:text-emerald-300'
                                                : 'text-slate-600 dark:text-slate-300'
                                            }`}
                                          >
                                            Stok: {pm.stok_fisik.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {pm.satuan}
                                          </div>
                                        )}
                                      </div>
                                    </button>
                                  );
                                })}
                              </>
                            )}

                            {filteredCustomSearchResults.length > 0 && (
                              <>
                                <div className="px-3 py-1.5 bg-purple-50/90 dark:bg-purple-950/40 text-[10px] font-bold uppercase tracking-wider text-purple-800 dark:text-purple-200">
                                  Barang Kustom Tercatat (Non-BOQ)
                                </div>
                                {filteredCustomSearchResults.map((ci) => (
                                  <button
                                    key={`${ci.nama_barang}|${ci.satuan}`}
                                    type="button"
                                    onClick={() => {
                                      setIsCustomMode(true);
                                      setIsCustomNewInput(false);
                                      setHasChosenItem(true);
                                      setCustomItemName(ci.nama_barang);
                                      setCustomItemUom(ci.satuan);
                                      setSelectedCustomLastPurposeIn(ci.lastPurposeIn || '');
                                      setSelectedItemId('');
                                      setProviderAutoMatched(false);
                                      setAsalBarang('KONTRAKTOR');
                                      setTokoBebasName('');
                                      setNotes('');
                                      if (mutationType === 'KELUAR') {
                                        setTujuanPengeluaran('OPERASIONAL');
                                        setBebanBiaya('OPERASIONAL');
                                        setKeteranganPengeluaran('');
                                      }
                                    }}
                                    className="w-full text-left px-3 py-2.5 hover:bg-purple-50 dark:hover:bg-purple-950/30 transition-colors flex items-center justify-between gap-2 cursor-pointer"
                                  >
                                    <div className="min-w-0 flex-1">
                                      <div className="font-semibold text-slate-900 dark:text-white truncate">
                                        {ci.nama_barang}
                                      </div>
                                      <span className="inline-flex items-center mt-0.5 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-200">
                                        ✍️ Barang Kustom
                                      </span>
                                    </div>
                                    <div className="text-right shrink-0 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-200">
                                      Stok: {ci.stok.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {ci.satuan}
                                    </div>
                                  </button>
                                ))}
                              </>
                            )}

                            {filteredBoqSearchResults.length === 0 && filteredCustomSearchResults.length === 0 && (
                              <div className="p-4 text-center text-xs text-slate-600 dark:text-slate-300 font-medium">
                                Tidak ditemukan di daftar BOQ maupun barang kustom tercatat.
                              </div>
                            )}
                          </div>

                          {/* Opsi "Lainnya" selalu tampil rapi tepat di bawah kotak daftar */}
                          <button
                            type="button"
                            onClick={() => {
                              setIsCustomMode(true);
                              setIsCustomNewInput(true);
                              setHasChosenItem(true);
                              setCustomItemName(itemSearchQuery.trim());
                              setCustomItemUom('');
                              setSelectedCustomLastPurposeIn('');
                              setSelectedItemId('');
                              setProviderAutoMatched(false);
                              setAsalBarang('KONTRAKTOR');
                              setTokoBebasName('');
                              setNotes('');
                              if (mutationType === 'KELUAR') {
                                setTujuanPengeluaran('OPERASIONAL');
                                setBebanBiaya('OPERASIONAL');
                                setKeteranganPengeluaran('');
                              }
                            }}
                            className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border border-dashed border-purple-400 dark:border-purple-600 bg-purple-50/70 dark:bg-purple-950/30 text-purple-900 dark:text-purple-200 hover:bg-purple-100/80 dark:hover:bg-purple-950/50 transition-colors font-semibold text-xs cursor-pointer"
                          >
                            <span className="flex items-center gap-2 text-left">
                              <Sparkles className="w-4 h-4 text-purple-600 dark:text-purple-300 shrink-0" />
                              <span>
                                {itemSearchQuery.trim()
                                  ? `Lainnya — Catat "${itemSearchQuery.trim()}" sebagai barang baru`
                                  : 'Lainnya (Barang baru di luar daftar BOQ)'}
                              </span>
                            </span>
                            <span className="text-[11px] font-bold text-purple-700 dark:text-purple-300 shrink-0">
                              Pilih →
                            </span>
                          </button>
                        </div>
                      ) : isCustomNewInput ? (
                        <div className="p-3 rounded-xl border border-purple-300 dark:border-purple-700 bg-purple-50/50 dark:bg-purple-950/25 space-y-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-bold text-purple-800 dark:text-purple-200">
                              ✍️ Barang Baru (Lainnya / Non-BOQ)
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setHasChosenItem(false);
                                setIsCustomMode(false);
                                setIsCustomNewInput(false);
                              }}
                              className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:underline cursor-pointer"
                            >
                              ← Cari di Daftar
                            </button>
                          </div>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="col-span-2">
                              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                Nama Barang <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                required
                                autoFocus
                                placeholder="Cth: Beras 50kg, Balok Camp, Solar..."
                                value={customItemName}
                                onChange={(e) => setCustomItemName(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                Satuan <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="text"
                                required
                                placeholder="Sak, Kg, Unit..."
                                value={customItemUom}
                                onChange={(e) => setCustomItemUom(e.target.value)}
                                className="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium"
                              />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/90 flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-bold text-xs text-slate-900 dark:text-white">
                                {activeItemName}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  isCustomMode
                                    ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-200'
                                    : 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-200'
                                }`}
                              >
                                {isCustomMode
                                  ? '✍️ Barang Kustom (Non-BOQ)'
                                  : mutationType === 'MASUK'
                                  ? '📦 Katalog BOQ · Satukan Masuk'
                                  : '📦 Katalog BOQ · Bedakan Keluar'}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                              {isCustomMode ? (
                                <>
                                  Stok tersedia di gudang:{' '}
                                  <b className="font-mono text-slate-800 dark:text-slate-100">
                                    {customCurrentStock.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {activeUom}
                                  </b>
                                </>
                              ) : mutationType === 'MASUK' ? (
                                <>
                                  Target proyek: <b>{boqTotalTarget.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</b> · Sudah masuk:{' '}
                                  <b className="text-emerald-700 dark:text-emerald-300">
                                    {boqTotalMasuk.toLocaleString('id-ID', { maximumFractionDigits: 2 })}
                                  </b>{' '}
                                  · Sisa belum tiba:{' '}
                                  <b>{boqKurang.toLocaleString('id-ID', { maximumFractionDigits: 2 })} {activeUom}</b>
                                </>
                              ) : (
                                <>
                                  Stok tersedia di gudang:{' '}
                                  <b className={`font-mono ${currentStock > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                                    {currentStock.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {activeUom}
                                  </b>
                                </>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setHasChosenItem(false);
                              setIsCustomMode(false);
                              setIsCustomNewInput(false);
                              setSelectedItemId('');
                              setItemSearchQuery('');
                            }}
                            className="shrink-0 px-2.5 py-1 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-slate-700 cursor-pointer"
                          >
                            Ubah Barang
                          </button>
                        </div>
                      )}
                    </div>

                    {/* PERTANYAAN SELANJUTNYA MUNCUL OTOMATIS SETELAH BARANG DIPILIH */}
                    {hasChosenItem && (
                      <>
                        {/* PERTANYAAN 2: BERAPA BANYAK & KAPAN? */}
                        <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                          <label className="block text-xs font-bold text-slate-900 dark:text-white">
                            {mutationType === 'MASUK'
                              ? '2. Berapa banyak yang masuk & kapan?'
                              : '2. Berapa banyak yang keluar & kapan?'}
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                Jumlah ({activeUom}) <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="number"
                                min="0.0001"
                                step="any"
                                required
                                placeholder="Masukkan jumlah (cth: 5)"
                                value={qty === 0 ? '' : qty}
                                onFocus={(e) => e.target.select()}
                                onWheel={(e) => (e.target as HTMLElement).blur()}
                                onChange={(e) => setQty(e.target.value === '' ? 0 : Number(e.target.value))}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold focus:ring-2 focus:ring-blue-500/20"
                              />
                              <div className="mt-1 text-[11px] font-medium">
                                {!isCustomMode && mutationType === 'MASUK' && (
                                  <span className="text-slate-600 dark:text-slate-300">
                                    Stok gudang jadi:{' '}
                                    <b className="text-emerald-700 dark:text-emerald-300">
                                      {projectedStock.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {activeUom}
                                    </b>{' '}
                                    · Kurang: <b>{boqKurangSetelah.toLocaleString('id-ID', { maximumFractionDigits: 2 })}</b>
                                  </span>
                                )}
                                {!isCustomMode && mutationType === 'KELUAR' && (
                                  qty > currentStock ? (
                                    <span className="text-rose-700 dark:text-rose-300 font-bold">
                                      Melebihi stok gudang ({currentStock.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {activeUom})!
                                    </span>
                                  ) : (
                                    <span className="text-slate-600 dark:text-slate-300">
                                      Sisa stok gudang:{' '}
                                      <b className="text-rose-700 dark:text-rose-300">
                                        {projectedStock.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {activeUom}
                                      </b>
                                    </span>
                                  )
                                )}
                                {isCustomMode && !isCustomNewInput && (
                                  <span className="text-slate-600 dark:text-slate-300">
                                    {mutationType === 'MASUK' ? (
                                      <>
                                        Stok kustom jadi:{' '}
                                        <b className="text-emerald-700 dark:text-emerald-300">
                                          {(customCurrentStock + Number(qty || 0)).toLocaleString('id-ID', { maximumFractionDigits: 3 })} {activeUom}
                                        </b>
                                      </>
                                    ) : (
                                      <>
                                        Stok tercatat saat ini:{' '}
                                        <b>{customCurrentStock.toLocaleString('id-ID', { maximumFractionDigits: 3 })} {activeUom}</b>
                                      </>
                                    )}
                                  </span>
                                )}
                              </div>
                            </div>

                            <div>
                              <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                <Calendar className="w-3.5 h-3.5 text-slate-600 dark:text-slate-300" />
                                <span>{mutationType === 'MASUK' ? 'Tanggal Masuk' : 'Tanggal Keluar'}</span>
                                <span className="text-rose-500">*</span>
                              </label>
                              <input
                                type="date"
                                required
                                value={mutationDate}
                                onChange={(e) => setMutationDate(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium focus:ring-2 focus:ring-blue-500/20"
                              />
                              <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                                Default hari ini · Boleh pilih tanggal mundur
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* PERTANYAAN 3 (KHUSUS MASUK): DARI MANA ASAL BARANG INI? */}
                        {mutationType === 'MASUK' && (
                          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                            <label className="block text-xs font-bold text-slate-900 dark:text-white">
                              3. Dari mana asal barang ini? <span className="text-rose-500">*</span>
                            </label>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  setAsalBarang('KONTRAKTOR');
                                  setProviderAutoMatched(!isCustomMode && boqMeta?.defaultAsal === 'KONTRAKTOR');
                                }}
                                className={`py-2 px-2 rounded-xl border text-center transition-all text-xs font-semibold cursor-pointer ${
                                  asalBarang === 'KONTRAKTOR'
                                    ? 'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200 ring-1 ring-blue-500'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                🏢 Kontraktor
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAsalBarang('KLIEN');
                                  setProviderAutoMatched(!isCustomMode && boqMeta?.defaultAsal === 'KLIEN');
                                }}
                                className={`py-2 px-2 rounded-xl border text-center transition-all text-xs font-semibold cursor-pointer ${
                                  asalBarang === 'KLIEN'
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200 ring-1 ring-emerald-500'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                👤 Klien
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAsalBarang('TOKO_BEBAS');
                                  setProviderAutoMatched(false);
                                }}
                                className={`py-2 px-2 rounded-xl border text-center transition-all text-xs font-semibold cursor-pointer ${
                                  asalBarang === 'TOKO_BEBAS'
                                    ? 'border-purple-500 bg-purple-50 text-purple-900 dark:bg-purple-950/60 dark:text-purple-200 ring-1 ring-purple-500'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                🏪 Lainnya
                              </button>
                            </div>

                            {!isCustomMode && boqMeta && (
                              <p
                                className={`text-[11px] font-medium ${
                                  providerAutoMatched || asalBarang === boqMeta.defaultAsal
                                    ? 'text-emerald-700 dark:text-emerald-300'
                                    : 'text-amber-700 dark:text-amber-300'
                                }`}
                              >
                                {asalBarang === boqMeta.defaultAsal
                                  ? `✓ Otomatis disesuaikan dengan kontrak BOQ (${boqMeta.label}${boqMeta.isMixed ? ' · mayoritas pos' : ''}).`
                                  : `ℹ️ Berbeda dari penyedia standar BOQ (${boqMeta.label}) — dicatat sesuai kenyataan lapangan.`}
                              </p>
                            )}

                            {asalBarang === 'TOKO_BEBAS' && (
                              <input
                                type="text"
                                placeholder="Nama toko / sumber barang (opsional, cth: TB Makmur, Toko Berkah)..."
                                value={tokoBebasName}
                                onChange={(e) => setTokoBebasName(e.target.value)}
                                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs"
                              />
                            )}
                          </div>
                        )}

                        {/* PERTANYAAN 4 (KHUSUS MASUK + BARANG KUSTOM): RENCANA KEPERLUAN */}
                        {mutationType === 'MASUK' && isCustomMode && (
                          <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                            <label className="block text-xs font-bold text-slate-900 dark:text-white">
                              4. Rencana barang ini untuk keperluan apa? <span className="text-rose-500">*</span>
                            </label>
                            <input
                              type="text"
                              required
                              placeholder="Contoh: Stok logistik dapur camp, cadangan bedeng, kebutuhan mendesak..."
                              value={notes}
                              onChange={(e) => setNotes(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
                            />
                            {selectedCustomLastPurposeIn && (
                              <button
                                type="button"
                                onClick={() => setNotes(selectedCustomLastPurposeIn)}
                                className="text-[11px] font-medium text-purple-700 dark:text-purple-300 hover:underline cursor-pointer"
                              >
                                Rencana sebelumnya: "{selectedCustomLastPurposeIn}" (klik untuk pakai lagi)
                              </button>
                            )}
                            <p className="text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                              Barang kustom mencatat rencana masuk dan pemakaian keluar secara terpisah.
                            </p>
                          </div>
                        )}

                        {/* PERTANYAAN 3 (KHUSUS KELUAR): DIPAKAI UNTUK KEPERLUAN APA? */}
                        {mutationType === 'KELUAR' && (
                          <div className="space-y-2 pt-1 border-t border-slate-100 dark:border-slate-800">
                            <label className="block text-xs font-bold text-slate-900 dark:text-white">
                              3. Dipakai untuk keperluan apa? <span className="text-rose-500">*</span>
                            </label>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                              <button
                                type="button"
                                onClick={() => setTujuanPengeluaran('PROYEK_BOQ')}
                                className={`py-2 px-2 rounded-xl border text-center transition-all text-xs font-semibold cursor-pointer ${
                                  tujuanPengeluaran === 'PROYEK_BOQ'
                                    ? 'border-blue-500 bg-blue-50 text-blue-900 dark:bg-blue-950/60 dark:text-blue-200 ring-1 ring-blue-500'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                🏗️ Proyek (BOQ)
                              </button>
                              <button
                                type="button"
                                onClick={() => setTujuanPengeluaran('OPERASIONAL')}
                                className={`py-2 px-2 rounded-xl border text-center transition-all text-xs font-semibold cursor-pointer ${
                                  tujuanPengeluaran === 'OPERASIONAL'
                                    ? 'border-sky-500 bg-sky-50 text-sky-900 dark:bg-sky-950/60 dark:text-sky-200 ring-1 ring-sky-500'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                🧑‍🍳 Operasional
                              </button>
                              <button
                                type="button"
                                onClick={() => setTujuanPengeluaran('PERMINTAAN_KLIEN')}
                                className={`py-2 px-2 rounded-xl border text-center transition-all text-xs font-semibold cursor-pointer ${
                                  tujuanPengeluaran === 'PERMINTAAN_KLIEN'
                                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200 ring-1 ring-emerald-500'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                💰 Minta Klien
                              </button>
                              <button
                                type="button"
                                onClick={() => setTujuanPengeluaran('BONUS_KLIEN')}
                                className={`py-2 px-2 rounded-xl border text-center transition-all text-xs font-semibold cursor-pointer ${
                                  tujuanPengeluaran === 'BONUS_KLIEN'
                                    ? 'border-purple-500 bg-purple-50 text-purple-900 dark:bg-purple-950/60 dark:text-purple-200 ring-1 ring-purple-500'
                                    : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700'
                                }`}
                              >
                                🎁 Bonus Klien
                              </button>
                            </div>

                            {isCustomMode && selectedCustomLastPurposeIn && (
                              <p className="text-[11px] text-purple-700 dark:text-purple-300 font-medium">
                                ℹ️ Rencana saat masuk: "{selectedCustomLastPurposeIn}" — pemakaian keluar boleh berbeda sesuai kondisi lapangan.
                              </p>
                            )}

                            {tujuanPengeluaran === 'PROYEK_BOQ' && !isCustomMode && currentPhysicalMaterial && (
                              <div className="pt-1">
                                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                  Untuk Pos Pekerjaan yang mana?
                                </label>
                                {currentPhysicalMaterial.budget_lines.length === 1 ? (
                                  <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                                    <div className="truncate mr-2">
                                      <span className="font-mono font-bold text-blue-700 dark:text-blue-300 mr-1.5">
                                        {currentPhysicalMaterial.budget_lines[0].kode_boq}
                                      </span>
                                      <span className="text-slate-800 dark:text-slate-200">
                                        {currentPhysicalMaterial.budget_lines[0].kategori}
                                      </span>
                                    </div>
                                    <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono shrink-0 font-medium">
                                      Sisa: <b className="text-emerald-700 dark:text-emerald-300">{currentPhysicalMaterial.budget_lines[0].sisa_anggaran.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan}</b>
                                    </span>
                                  </div>
                                ) : (
                                  <select
                                    value={selectedAllocationItemId}
                                    onChange={(e) => {
                                      const newId = e.target.value;
                                      setSelectedAllocationItemId(newId);
                                      const line = currentPhysicalMaterial.budget_lines.find((bl) => bl.id === newId);
                                      if (line) {
                                        setPurpose(`${line.kode_boq} - ${line.kategori}`);
                                      }
                                    }}
                                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500/20"
                                  >
                                    {currentPhysicalMaterial.budget_lines.map((line) => (
                                      <option key={line.id} value={line.id}>
                                        [{line.kode_boq}] {line.kategori} (Sisa: {line.sisa_anggaran.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan})
                                      </option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            )}

                            {tujuanPengeluaran === 'PROYEK_BOQ' && isCustomMode && (
                              <div className="pt-1">
                                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                  Dipakai untuk pekerjaan proyek apa? <span className="text-rose-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  required
                                  placeholder="Contoh: Dipakai darurat untuk perancah tambahan / penutup area cor..."
                                  value={keteranganPengeluaran}
                                  onChange={(e) => setKeteranganPengeluaran(e.target.value)}
                                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium"
                                />
                              </div>
                            )}

                            {tujuanPengeluaran === 'OPERASIONAL' && (
                              <div className="pt-1">
                                <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-200 mb-1">
                                  Keterangan Operasional Lapangan <span className="text-rose-500">*</span>
                                </label>
                                <input
                                  type="text"
                                  required
                                  placeholder="Contoh: Konsumsi dapur tukang minggu ke-3, Bahan bakar genset proyek..."
                                  value={keteranganPengeluaran}
                                  onChange={(e) => setKeteranganPengeluaran(e.target.value)}
                                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium"
                                />
                              </div>
                            )}

                            {tujuanPengeluaran === 'PERMINTAAN_KLIEN' && (
                              <div className="pt-1">
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                                    Keterangan Permintaan Klien <span className="text-rose-500">*</span>
                                  </label>
                                  <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                                    Kena Invoice ke Klien
                                  </span>
                                </div>
                                <input
                                  type="text"
                                  required
                                  placeholder="Contoh: Penambahan stop kontak AC kamar utama, variasi keramik teras..."
                                  value={keteranganPengeluaran}
                                  onChange={(e) => setKeteranganPengeluaran(e.target.value)}
                                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium"
                                />
                              </div>
                            )}

                            {tujuanPengeluaran === 'BONUS_KLIEN' && (
                              <div className="pt-1">
                                <div className="flex items-center justify-between mb-1">
                                  <label className="text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                                    Keterangan Bonus untuk Klien <span className="text-rose-500">*</span>
                                  </label>
                                  <span className="text-[10px] text-purple-700 dark:text-purple-300 font-semibold bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-full">
                                    Gratis (Beban CV Menara Megah)
                                  </span>
                                </div>
                                <input
                                  type="text"
                                  required
                                  placeholder="Contoh: Bonus kekuatan bekisting kolom struktur, ekstra plesteran luar..."
                                  value={keteranganPengeluaran}
                                  onChange={(e) => setKeteranganPengeluaran(e.target.value)}
                                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium"
                                />
                              </div>
                            )}
                          </div>
                        )}

                        {/* DETAIL SINGKAT: PIC & SURAT JALAN */}
                        <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                          <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                              {mutationType === 'MASUK' ? 'Diterima oleh (PIC)' : 'Diserahkan oleh (PIC)'}
                            </label>
                            <input
                              type="text"
                              value={pic}
                              onChange={(e) => setPic(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
                            />
                          </div>
                          <div>
                            <label className="block font-semibold text-slate-700 dark:text-slate-200 mb-1">
                              No. Surat Jalan / Nota (opsional)
                            </label>
                            <input
                              type="text"
                              placeholder="SJ-001 / BON-12"
                              value={suratJalan}
                              onChange={(e) => setSuratJalan(e.target.value)}
                              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-xs"
                            />
                          </div>
                        </div>

                        {/* RINGKASAN OTOMATIS SISTEM */}
                        <div
                          className={`px-3 py-2 rounded-xl border text-[11px] font-semibold ${
                            mutationType === 'MASUK'
                              ? 'bg-emerald-50/70 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                              : 'bg-rose-50/70 dark:bg-rose-950/30 border-rose-200 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                          }`}
                        >
                          {mutationType === 'MASUK' ? (
                            isCustomMode ? (
                              <>✍️ Sistem mencatat sebagai Barang Kustom (Bedakan Masuk): {activeItemName} +{qty || 0} {activeUom} · Asal: {originLabel}</>
                            ) : (
                              <>📦 Sistem mencatat ke Gudang BOQ (Satukan Masuk): {activeItemName} +{qty || 0} {activeUom} · Asal: {originLabel}</>
                            )
                          ) : isCustomMode ? (
                            <>✍️ Sistem mencatat keluar Barang Kustom: {activeItemName} -{qty || 0} {activeUom} · Tujuan: {exitDestLabel}</>
                          ) : (
                            <>📦 Sistem mencatat pemakaian Pos BOQ (Bedakan Keluar): {activeItemName} -{qty || 0} {activeUom} · Tujuan: {exitDestLabel}</>
                          )}
                        </div>
                      </>
                    )}

                    {/* TOMBOL AKSI PENUTUP */}
                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() => setIsModalOpen(false)}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl cursor-pointer"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={!hasChosenItem || submitting}
                        className={`px-5 py-2.5 text-xs font-semibold text-white rounded-xl shadow-sm transition-colors disabled:opacity-40 cursor-pointer ${
                          mutationType === 'MASUK' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                        }`}
                      >
                        {submitting
                          ? 'Menyimpan...'
                          : mutationType === 'MASUK'
                          ? 'Simpan Barang Masuk'
                          : 'Simpan Barang Keluar'}
                      </button>
                    </div>
                  </>
                );
              })()}
            </form>
          </div>
        </div>
      )}

      {/* Modal Konfirmasi BATAL */}
      {batalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmBatal} className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Ban className="h-5 w-5 text-rose-500" /> Batalkan Dokumen Mutasi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen ini akan ditandai <b>BATAL</b>. Riwayat audit tetap tersimpan, namun nominal kuantitas (<b>{batalTarget.jumlah} {batalTarget.satuan}</b>) tidak akan diperhitungkan dalam stok fisik.
            </p>
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Pembatalan <span className="text-rose-500">*</span>
              </label>
              <textarea
                required
                rows={3}
                value={batalReason}
                onChange={(e) => setBatalReason(e.target.value)}
                placeholder="Contoh: Kesalahan input kuantitas, dibatalkan atas instruksi Spv..."
                className="w-full rounded-xl border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setBatalTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || batalReason.trim().length < 5}
                className="rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Ya, Batalkan Dokumen'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Modal Form GANTI Mutasi */}
      {gantiTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <form onSubmit={handleConfirmGanti} className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FileEdit className="h-5 w-5 text-amber-500" /> Ganti / Revisi Dokumen Mutasi
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Dokumen lama akan ditandai <b>DIGANTI</b> dan dokumen baru akan diterbitkan dengan nomor rujukan ke dokumen ini.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penggantian / Koreksi <span className="text-rose-500">*</span>
              </label>
              <input
                required
                type="text"
                value={gantiReason}
                onChange={(e) => setGantiReason(e.target.value)}
                placeholder="Contoh: Koreksi nomor surat jalan dan penyesuaian kuantitas nyata..."
                className="w-full rounded-xl border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Jumlah Baru</label>
                <input
                  type="number"
                  min="0.01"
                  step="any"
                  required
                  value={qty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold text-xs"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Surat Jalan Baru</label>
                <input
                  type="text"
                  value={suratJalan}
                  onChange={(e) => setSuratJalan(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Uraian Keperluan Baru</label>
              <input
                type="text"
                required
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setGantiTarget(null)}
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-medium dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={submitting || gantiReason.trim().length < 5}
                className="rounded-xl bg-amber-600 px-4 py-2 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-40"
              >
                {submitting ? 'Memproses...' : 'Simpan Dokumen Pengganti'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
