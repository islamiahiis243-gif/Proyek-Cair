import React, { useState, useMemo, useRef, useEffect, useDeferredValue, startTransition } from 'react';
import { useApp, computeItemStatus } from '../context/AppContext';
import {
  ItemBarang,
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
  RefreshCw,
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
  FileText
} from 'lucide-react';
import { formatDateTime, formatRupiah, generateBOQReportPDF } from '../lib/pdfGenerator';

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
    addStockMutation,
    batalStockMutation,
    gantiStockMutation,
    advanceStockWorkflow,
    user,
    rolePermissions,
    activeRole,
    dataReady,
    dataError,
    refreshData
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'MASUK' | 'KELUAR' | 'PROYEK_BOQ' | 'PERMINTAAN_KLIEN' | 'BONUS_KLIEN' | 'OPERASIONAL'>('ALL');

  // Tab Modul Terpadu: Pantau BOQ vs Riwayat Transaksi
  const [activeTab, setActiveTab] = useState<'BOQ_MONITOR' | 'MUTATION_HISTORY'>('BOQ_MONITOR');

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
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [customItemName, setCustomItemName] = useState<string>('');
  const [customItemUom, setCustomItemUom] = useState<string>('Unit');
  const [bebanBiaya, setBebanBiaya] = useState<BebanBiaya>('KONTRAKTOR');

  // Input Khusus MASUK: Asal Barang
  const [asalBarang, setAsalBarang] = useState<AsalBarang>('KONTRAKTOR');
  const [tokoBebasName, setTokoBebasName] = useState<string>('');

  // Input Khusus KELUAR: Tujuan Pengeluaran (4 Opsi Ringkas)
  const [tujuanPengeluaran, setTujuanPengeluaran] = useState<TujuanPengeluaran>('PROYEK_BOQ');
  const [keteranganPengeluaran, setKeteranganPengeluaran] = useState<string>('');

  const [selectedItemId, setSelectedItemId] = useState<string>(preselectedItem ? preselectedItem.id : (items[0]?.id || ''));
  const [selectedAllocationItemId, setSelectedAllocationItemId] = useState<string>('');
  const [mutationType, setMutationType] = useState<JenisMutasiBarang>(preselectedType || 'MASUK');
  const [mutationDate, setMutationDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [isItemSearchOpen, setIsItemSearchOpen] = useState(false);
  const itemSearchRef = useRef<HTMLDivElement>(null);

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

  // Tutup dropdown pencarian material jika klik di luar
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (itemSearchRef.current && !itemSearchRef.current.contains(e.target as Node)) {
        setIsItemSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Sync if preselected props change
  useEffect(() => {
    if (preselectedItem) {
      setSelectedItemId(preselectedItem.id);
    }
    if (preselectedType) {
      setMutationType(preselectedType);
    }
  }, [preselectedItem, preselectedType]);

  // Material Fisik Terpadu yang aktif dipilih
  const currentPhysicalMaterial = useMemo(() => {
    if (!physicalMaterials || physicalMaterials.length === 0) return null;
    if (selectedItemId) {
      const found = physicalMaterials.find(
        (pm) => pm.id === selectedItemId || pm.budget_lines.some((bl) => bl.id === selectedItemId)
      );
      if (found) return found;
    }
    return physicalMaterials.find((pm) => pm.is_stock_item) || physicalMaterials[0];
  }, [physicalMaterials, selectedItemId]);

  // Sinkronisasi Alokasi Pos BOQ ketika material fisik berganti
  useEffect(() => {
    if (currentPhysicalMaterial) {
      const lines = currentPhysicalMaterial.budget_lines;
      const isCurrentValid = lines.some((bl) => bl.id === selectedAllocationItemId);
      if (!isCurrentValid && lines.length > 0) {
        // Cek jika preselectedItem cocok
        const matchingPre = preselectedItem ? lines.find((bl) => bl.id === preselectedItem.id) : null;
        const targetLine = matchingPre || lines[0];
        setSelectedAllocationItemId(targetLine.id);
        if (mutationType === 'KELUAR') {
          setPurpose(`${targetLine.kode_boq} - ${targetLine.kategori}`);
        }
      }
    }
  }, [currentPhysicalMaterial, preselectedItem, mutationType]);

  const selectedBudgetLine = useMemo(() => {
    if (!currentPhysicalMaterial) return null;
    return (
      currentPhysicalMaterial.budget_lines.find((bl) => bl.id === selectedAllocationItemId) ||
      currentPhysicalMaterial.budget_lines[0] ||
      null
    );
  }, [currentPhysicalMaterial, selectedAllocationItemId]);

  // Autocomplete pencarian material fisik
  const filteredPhysicalMaterialsForPicker = useMemo(() => {
    const list = physicalMaterials.filter((pm) => pm.is_stock_item);
    if (!itemSearchQuery.trim()) {
      return list.slice(0, 15);
    }
    const q = itemSearchQuery.toLowerCase();
    return list
      .filter(
        (pm) =>
          pm.nama_barang.toLowerCase().includes(q) ||
          pm.satuan.toLowerCase().includes(q) ||
          pm.budget_lines.some(
            (bl) => bl.kode_boq.toLowerCase().includes(q) || bl.kategori.toLowerCase().includes(q)
          )
      )
      .slice(0, 25);
  }, [physicalMaterials, itemSearchQuery]);

  const currentStock = currentPhysicalMaterial?.stok_fisik || 0;
  const projectedStock =
    mutationType === 'MASUK'
      ? currentStock + Number(qty || 0)
      : Math.max(0, currentStock - Number(qty || 0));
  const projectedStatus = currentPhysicalMaterial
    ? computeItemStatus(projectedStock, 0)
    : 'Tidak Tersedia';

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

  // Metrik Progres Kontrak BOQ Keseluruhan
  const boqMetrics = useMemo(() => {
    const totalItems = items.length;
    let fulfilledCount = 0;
    let inProgressCount = 0;
    let notStartedCount = 0;
    let overQuotaCount = 0;
    let totalImkItems = 0;
    let totalKontraktorItems = 0;

    items.forEach((it) => {
      if ((it.keterangan || '').toLowerCase().includes('imk')) {
        totalImkItems++;
      } else {
        totalKontraktorItems++;
      }

      if (it.status_pemenuhan === 'Terpenuhi') fulfilledCount++;
      else if (it.status_pemenuhan === 'Dalam pemenuhan') inProgressCount++;
      else if (it.status_pemenuhan === 'Melebihi BOQ') overQuotaCount++;
      else notStartedCount++;
    });

    const progressPct = totalItems > 0 ? Math.round(((fulfilledCount + inProgressCount * 0.5) / totalItems) * 100) : 0;

    return {
      totalItems,
      fulfilledCount,
      inProgressCount,
      notStartedCount,
      overQuotaCount,
      totalImkItems,
      totalKontraktorItems,
      progressPct
    };
  }, [items]);

  // Aksi Cepat Mutasi dari Baris Material BOQ
  const handleOpenItemMutation = (item: ItemBarang, type: JenisMutasiBarang) => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang menerbitkan dokumen mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    setSelectedItemId(item.id);
    setSelectedAllocationItemId(item.id);
    setMutationType(type);
    setIsCustomMode(false);
    setCustomItemName('');
    setCustomItemUom(item.satuan);

    const isImk = (item.keterangan || '').toLowerCase().includes('imk');
    if (type === 'MASUK') {
      setAsalBarang(isImk ? 'KLIEN' : 'KONTRAKTOR');
      setSourceName(isImk ? 'PT Indo Muro Kencana (Klien)' : 'CV Menara Megah');
      setDestinationName('Gudang Utama Proyek');
      setPurpose(`Penyediaan Material Kontrak BOQ (${item.kode_boq})`);
    } else {
      setTujuanPengeluaran('PROYEK_BOQ');
      setKeteranganPengeluaran('');
      setDestinationName(`Area Proyek - ${item.kategori}`);
      setPurpose(`${item.kode_boq} - ${item.kategori}`);
    }

    setQty(1);
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setMutationDate(new Date().toISOString().slice(0, 10));
    setErrorMessage(null);
    setIsModalOpen(true);
  };

  // Navigasi ke Tab 2 (Jurnal Mutasi) khusus untuk item ini
  const handleViewItemHistory = (item: ItemBarang) => {
    setActiveTab('MUTATION_HISTORY');
    setSearchQuery(item.nama_barang);
    setFilterType('ALL');
  };

  const renderBoqStatusBadge = (status: ItemBarang['status_pemenuhan']) => {
    switch (status) {
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
            <span>Belum Ada Masuk</span>
          </span>
        );
    }
  };

  const handleOpenNewModal = (type: JenisMutasiBarang = 'MASUK') => {
    if (!rolePermissions.canIssue) {
      setErrorMessage(`Jabatan Anda (${activeRole}) tidak memiliki wewenang menerbitkan dokumen mutasi baru. Wewenang ini milik Clerk.`);
      return;
    }
    setMutationType(type);
    setIsCustomMode(false);
    setCustomItemName('');
    setCustomItemUom('Unit');
    setAsalBarang('KONTRAKTOR');
    setTokoBebasName('');
    setTujuanPengeluaran('PROYEK_BOQ');
    setKeteranganPengeluaran('');
    setQty(1);
    setPic(user.name);
    setSuratJalan('');
    setNotes('');
    setMutationDate(new Date().toISOString().slice(0, 10));
    setItemSearchQuery('');
    setIsItemSearchOpen(false);
    setSourceName('CV Menara Megah');
    setDestinationName(type === 'MASUK' ? 'Gudang Utama Proyek' : 'Area Proyek UDU');
    setOwnerType('KONTRAKTOR');
    setErrorMessage(null);

    if (type === 'KELUAR' && currentPhysicalMaterial?.budget_lines[0]) {
      const bl = currentPhysicalMaterial.budget_lines[0];
      setSelectedAllocationItemId(bl.id);
      setPurpose(`${bl.kode_boq} - ${bl.kategori}`);
    } else {
      setPurpose('Penyediaan Material Kontrak BOQ');
    }

    setIsModalOpen(true);
  };

  const handleSubmitMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (isCustomMode) {
      if (!customItemName.trim()) {
        setErrorMessage('Tuliskan nama material / barang.');
        return;
      }
      if (!customItemUom.trim()) {
        setErrorMessage('Tuliskan satuan material (cth: Zak, Kg, Batang, Unit).');
        return;
      }
    } else {
      if (!currentPhysicalMaterial) {
        setErrorMessage('Pilih material fisik dari katalog BOQ.');
        return;
      }
      if (mutationType === 'KELUAR' && currentStock < qty) {
        setErrorMessage(
          `Stok fisik saat ini di gudang (${currentStock} ${currentPhysicalMaterial.satuan}) tidak mencukupi untuk pengeluaran ${qty} ${currentPhysicalMaterial.satuan}.`
        );
        return;
      }
    }

    if (qty <= 0) {
      setErrorMessage('Jumlah kuantitas mutasi harus lebih besar dari 0.');
      return;
    }

    // Material BOQ: Pemasukan disatukan (agregat), Pengeluaran dirincikan (pos BOQ jika pilih Proyek)
    const targetItemId = isCustomMode
      ? ''
      : (mutationType === 'KELUAR' && tujuanPengeluaran === 'PROYEK_BOQ')
      ? (selectedAllocationItemId || currentPhysicalMaterial?.id || '')
      : (currentPhysicalMaterial?.id || '');

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
        calculatedSourceName = tokoBebasName.trim() ? `Toko: ${tokoBebasName.trim()}` : 'Toko / Pembelian Bebas';
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
        finalPurpose = selectedBudgetLine
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
        tanggal: new Date(mutationDate).toISOString(),
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

      setNoticeMessage(res.message);
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
    setMutationDate(item.tanggal ? new Date(item.tanggal).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10));
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
          tanggal: new Date(mutationDate).toISOString(),
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

  // Eksekusi Persetujuan Berseri (Serial Approval)
  const handleAdvanceWorkflow = async (mut: MutasiBarang, nextStatus: StatusDokumenWorkflow) => {
    // Validasi Berseri (Serial)
    if (nextStatus === 'DISETUJUI' && mut.status_dokumen !== 'DIPERIKSA') {
      setErrorMessage('Approval berseri: Dokumen wajib Diperiksa terlebih dahulu oleh Foreman / Spv sebelum Disetujui.');
      return;
    }
    if (nextStatus === 'MENGETAHUI' && mut.status_dokumen !== 'DISETUJUI') {
      setErrorMessage('Approval berseri: Dokumen wajib Disetujui terlebih dahulu oleh Spv / Dept. Manager sebelum disahkan Mengetahui (TTE/QR).');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);
    try {
      const res = await advanceStockWorkflow(mut.id, nextStatus);
      if (res.success) {
        setNoticeMessage(res.message);
      } else {
        setErrorMessage(res.message);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Pembaruan status persetujuan gagal.');
    } finally {
      setSubmitting(false);
    }
  };

  if (modalOnly && !isModalOpen) return null;
  if (!dataReady) return <div className="p-8 text-center text-xs text-slate-500">Memuat data mutasi barang...</div>;

  return (
    <div className={modalOnly ? '' : 'space-y-5'}>
      {/* Notifikasi & Pesan */}
      {noticeMessage && (
        <div role="status" className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{noticeMessage}</span>
          </div>
          <button onClick={() => setNoticeMessage(null)} aria-label="Tutup pemberitahuan" className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 text-base font-bold">×</button>
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

          {/* Navigasi Tab Terpadu: Pantau BOQ vs Riwayat Transaksi */}
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800">
            <button
              onClick={() => {
                startTransition(() => {
                  setActiveTab('BOQ_MONITOR');
                });
              }}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'BOQ_MONITOR'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <BarChart3 className="w-4 h-4" />
              <span>📊 Pantau Pemenuhan BOQ</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300 font-bold">
                {items.length} Item
              </span>
            </button>
            <button
              onClick={() => {
                startTransition(() => {
                  setActiveTab('MUTATION_HISTORY');
                });
              }}
              className={`flex items-center gap-2 py-3 px-4 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                activeTab === 'MUTATION_HISTORY'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-950/20 rounded-t-xl'
                  : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              <span>📋 Jurnal Riwayat Transaksi</span>
              <span className="text-[10px] py-0.5 px-2 rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 font-bold">
                {stockMutations.length} Mutasi
              </span>
            </button>
          </div>

          {/* TAB 1: PANTAU PEMENUHAN BOQ */}
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
                        Nilai Kontrak Pelaksanaan BOQ
                      </h4>
                      <p className="text-[11px] text-slate-300">
                        CV MENARA MEGAH · Trainer & UDU Office (Klien: PT INDO MURO KENCANA)
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
                    <span className="text-[10px] uppercase font-bold text-slate-300 dark:text-slate-300 tracking-wider">1. Material Kontrak</span>
                    <div className="mt-1 text-base sm:text-lg font-black text-blue-400 font-mono">Rp 448.150.623</div>
                    <span className="text-[10px] text-slate-300">Tanggungan CV Menara Megah</span>
                  </div>

                  <div className="bg-white/5 dark:bg-white/[0.03] p-3 rounded-xl border border-white/10">
                    <span className="text-[10px] uppercase font-bold text-slate-300 dark:text-slate-300 tracking-wider">2. Upah & Jasa (Manpower)</span>
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

              {/* Kartu Ringkasan Progres Kontrak BOQ */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Total Item BOQ</span>
                    <Boxes className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                    {boqMetrics.totalItems} Pos Item
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-500"
                        style={{ width: `${boqMetrics.progressPct}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">{boqMetrics.progressPct}%</span>
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Realisasi Kedatangan</span>
                    <ArrowDownLeft className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <div className="mt-2 text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {boqMetrics.fulfilledCount + boqMetrics.inProgressCount} Item Masuk
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                    {boqMetrics.fulfilledCount} Terpenuhi · {boqMetrics.inProgressCount} Dalam Proses
                  </p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Belum Ada Pengiriman</span>
                    <Clock className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="mt-2 text-xl font-bold text-amber-600 dark:text-amber-400">
                    {boqMetrics.notStartedCount} Item
                  </div>
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-medium">
                    Material kontrak yang belum tiba
                  </p>
                </div>

                <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">Tanggung Jawab Penyedia</span>
                    <Building2 className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <div className="mt-2 text-xl font-bold text-slate-900 dark:text-white">
                    {boqMetrics.totalKontraktorItems} Menara Megah
                  </div>
                  <p className="mt-1 text-[11px] text-purple-600 dark:text-purple-400 font-semibold">
                    + {boqMetrics.totalImkItems} Free-issue Klien (PT IMK)
                  </p>
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
                  {/* Filter Penyedia */}
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

                  {/* Filter Status */}
                  <select
                    value={boqStatusFilter}
                    onChange={(e) => setBoqStatusFilter(e.target.value as any)}
                    aria-label="Filter status pemenuhan BOQ"
                    className="px-2.5 py-1.5 text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-xl border border-slate-200 dark:border-slate-700 focus:outline-hidden"
                  >
                    <option value="ALL">Semua Status Pemenuhan</option>
                    <option value="Belum dipenuhi">Belum Ada Masuk</option>
                    <option value="Dalam pemenuhan">Dalam Proses</option>
                    <option value="Terpenuhi">Terpenuhi</option>
                    <option value="Melebihi BOQ">Melebihi BOQ</option>
                  </select>

                  {/* Toggle Buka / Tutup Semua */}
                  <div className="flex items-center gap-1 border-l border-slate-200 dark:border-slate-700 pl-2">
                    <button
                      onClick={handleExpandAll}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                      title="Buka semua hierarki pekerjaan"
                    >
                      Buka Semua
                    </button>
                    <span className="text-slate-300 dark:text-slate-700">|</span>
                    <button
                      onClick={handleCollapseAll}
                      className="px-2 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                      title="Tutup semua hierarki pekerjaan"
                    >
                      Tutup Semua
                    </button>
                  </div>
                </div>
              </div>

              {/* Tabel Hierarki Master BOQ & Kontrol Realisasi */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-colors">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 font-bold uppercase tracking-wider text-[10px]">
                        <th className="py-3 px-3.5 w-24">Kode BOQ</th>
                        <th className="py-3 px-3.5">Uraian Material & Pekerjaan</th>
                        <th className="py-3 px-3 text-center">Penyedia</th>
                        <th className="py-3 px-3 text-right">Target BOQ</th>
                        <th className="py-3 px-3 text-right">Realisasi Masuk</th>
                        <th className="py-3 px-3 text-right">Terpakai (Keluar)</th>
                        <th className="py-3 px-3 text-right">Sisa Belum Tiba</th>
                        <th className="py-3 px-3 text-right">Saldo Fisik</th>
                        <th className="py-3 px-3 text-center">Status</th>
                        <th className="py-3 px-3.5 text-center w-28">Aksi Cepat</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {groupedBoqData.length === 0 ? (
                        <tr>
                          <td colSpan={10} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Tidak ada item BOQ yang cocok dengan filter pencarian.
                          </td>
                        </tr>
                      ) : (
                        groupedBoqData.map((div) => {
                          const isDivCollapsed = collapsedDivisions.has(div.name);

                          return (
                            <React.Fragment key={div.name}>
                              {/* Level 1: Divisi Utama (Kuning Excel: #FFF9C4 / Dark Adjusted) */}
                              <tr className="bg-[#FFF9C4] dark:bg-[#713F12]/60 border-y border-amber-300 dark:border-amber-900/60 text-amber-950 dark:text-amber-200 font-bold transition-colors">
                                <td colSpan={10} className="py-2.5 px-3.5">
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
                                      {div.totalItems} Item
                                    </span>
                                  </button>
                                </td>
                              </tr>

                              {/* Level 2: Sub-Pekerjaan (Hijau Excel: #DCFCE7 / Dark Adjusted) */}
                              {!isDivCollapsed &&
                                div.subSections.map((sub) => {
                                  const subKey = `${div.name}__${sub.name}`;
                                  const isSubCollapsed = collapsedSubSections.has(subKey);

                                  return (
                                    <React.Fragment key={subKey}>
                                      <tr className="bg-[#DCFCE7] dark:bg-[#064E3B]/60 border-y border-emerald-300 dark:border-emerald-900/60 text-emerald-950 dark:text-emerald-200 font-semibold transition-colors [content-visibility:auto] [contain-intrinsic-size:0_36px]">
                                        <td colSpan={10} className="py-2 px-4">
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
                                              {sub.items.length} Item · {sub.imkCount > 0 ? `${sub.imkCount} Klien · ` : ''}{sub.kontraktorCount} Menara Megah
                                            </span>
                                          </button>
                                        </td>
                                      </tr>

                                      {/* Baris Material & Jasa */}
                                      {!isSubCollapsed &&
                                        sub.items.map((item) => {
                                          const isImk = (item.keterangan || '').toLowerCase().includes('imk');
                                          const masukPct = item.qty_boq > 0 ? Math.round((item.qty_masuk_total / item.qty_boq) * 100) : 0;

                                          return (
                                            <tr
                                              key={item.id}
                                              className="hover:bg-slate-50/90 dark:hover:bg-slate-800/60 transition-colors bg-white dark:bg-slate-900 [content-visibility:auto] [contain-intrinsic-size:0_45px]"
                                            >
                                              {/* Kode BOQ */}
                                              <td className="py-2.5 px-3.5 font-mono text-[11px] font-bold text-slate-700 dark:text-slate-300">
                                                {item.kode_boq}
                                              </td>

                                              {/* Uraian Material */}
                                              <td className="py-2.5 px-3.5">
                                                <div className="font-semibold text-slate-900 dark:text-white">
                                                  {item.nama_barang}
                                                </div>
                                                {isImk ? (
                                                  <div className="text-[10px] text-purple-600 dark:text-purple-400 font-medium">
                                                    Beban Kontraktor: Rp 0 (Disediakan Klien PT IMK)
                                                    {item.harga_satuan > 0 && (
                                                      <span className="text-slate-600 dark:text-slate-300 text-[9px] ml-1 font-medium">
                                                        · Est. Aset Klien: {formatRupiah(item.harga_satuan * item.qty_boq)}
                                                      </span>
                                                    )}
                                                  </div>
                                                ) : (
                                                  <div className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">
                                                    {formatRupiah(item.harga_satuan)} / {item.satuan}
                                                    <span className="ml-1 font-semibold text-slate-700 dark:text-slate-200">
                                                      (Total: {formatRupiah(item.harga_satuan * item.qty_boq)})
                                                    </span>
                                                    {item.keterangan ? ` · ${item.keterangan}` : ''}
                                                  </div>
                                                )}
                                              </td>

                                              {/* Penyedia */}
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

                                              {/* Target BOQ */}
                                              <td className="py-2.5 px-3 text-right font-mono font-medium text-slate-800 dark:text-slate-200">
                                                {item.qty_boq.toLocaleString('id-ID', { maximumFractionDigits: 3 })}{' '}
                                                <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">{item.satuan}</span>
                                              </td>

                                              {/* Realisasi Masuk */}
                                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                                                <div>
                                                  {item.qty_masuk_total.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                                </div>
                                                <div className="text-[9px] font-medium text-slate-600 dark:text-slate-300">
                                                  {masukPct}% tercapai
                                                </div>
                                              </td>

                                              {/* Terpakai (Keluar) */}
                                              <td className="py-2.5 px-3 text-right font-mono font-semibold text-rose-600 dark:text-rose-400">
                                                {item.qty_keluar_total.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                              </td>

                                              {/* Sisa Belum Tiba */}
                                              <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                                {item.qty_pemenuhan_sisa.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                              </td>

                                              {/* Saldo Fisik */}
                                              <td className="py-2.5 px-3 text-right font-mono font-bold">
                                                <span
                                                  className={
                                                    item.stok_saat_ini > 0
                                                      ? 'text-emerald-600 dark:text-emerald-400'
                                                      : 'text-slate-600 dark:text-slate-300 font-medium'
                                                  }
                                                >
                                                  {item.stok_saat_ini.toLocaleString('id-ID', { maximumFractionDigits: 3 })}
                                                </span>
                                              </td>

                                              {/* Status */}
                                              <td className="py-2.5 px-3 text-center">
                                                {renderBoqStatusBadge(item.status_pemenuhan)}
                                              </td>

                                              {/* Aksi Cepat */}
                                              <td className="py-2.5 px-3.5 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                  <button
                                                    onClick={() => handleOpenItemMutation(item, 'MASUK')}
                                                    disabled={!rolePermissions.canIssue}
                                                    title="Catat barang masuk untuk pos ini"
                                                    className="px-2 py-1 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 rounded-lg text-[10px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-900/60 disabled:opacity-40 transition-colors cursor-pointer"
                                                  >
                                                    + Masuk
                                                  </button>
                                                  <button
                                                    onClick={() => handleOpenItemMutation(item, 'KELUAR')}
                                                    disabled={!rolePermissions.canIssue}
                                                    title="Catat barang keluar untuk pos ini"
                                                    className="px-2 py-1 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300 border border-rose-200 dark:border-rose-800 rounded-lg text-[10px] font-bold hover:bg-rose-100 dark:hover:bg-rose-900/60 disabled:opacity-40 transition-colors cursor-pointer"
                                                  >
                                                    - Keluar
                                                  </button>
                                                  <button
                                                    onClick={() => handleViewItemHistory(item)}
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

          {/* TAB 2: JURNAL RIWAYAT TRANSAKSI */}
          {activeTab === 'MUTATION_HISTORY' && (
            <div className="space-y-4">
              {/* Notifikasi filter jika diarahkan dari BOQ */}
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

              {/* Tabel Riwayat Mutasi Barang */}
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
                        <th className="py-3 px-3.5">Asal / Keperluan</th>
                        <th className="py-3 px-3.5 text-center">Status Dokumen</th>
                        <th className="py-3 px-3.5 text-center">Alur Persetujuan</th>
                        <th className="py-3 px-3.5 text-center">Koreksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredMutations.length === 0 ? (
                        <tr>
                          <td colSpan={9} className="py-12 text-center text-slate-600 dark:text-slate-300 font-medium">
                            Belum ada riwayat transaksi mutasi barang.
                          </td>
                        </tr>
                      ) : (
                        filteredMutations.map((mut, idx) => {
                          const isVoid = mut.is_batal;
                          const isReplaced = mut.is_ganti;
                          const status = mut.status_dokumen || 'DITERBITKAN';

                          return (
                            <tr
                              key={mut.id}
                              className={`hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors ${
                                isVoid ? 'opacity-50 bg-rose-50/20 line-through' : isReplaced ? 'opacity-70 bg-amber-50/20' : ''
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
                              {mut.is_custom_item && (
                                <span className="inline-flex items-center gap-0.5 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300">
                                  ✍️ Non-BOQ
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
                            <div className="truncate font-medium">{mut.tujuan_keperluan || '-'}</div>
                            <div className="text-[10px] text-slate-600 dark:text-slate-300 font-mono mt-0.5">PIC: {mut.pic_penerima_penyerah}</div>
                          </td>

                          {/* Status Dokumen */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {isVoid ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-800 dark:bg-rose-950 dark:text-rose-300">
                                <Ban className="h-3 w-3" /> BATAL
                              </span>
                            ) : isReplaced ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                <FileEdit className="h-3 w-3" /> DIGANTI
                              </span>
                            ) : status === 'MENGETAHUI' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2.5 py-0.5 text-[10px] font-bold text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                                <QrCode className="h-3 w-3" /> SAH (TTE/QR)
                              </span>
                            ) : status === 'DISETUJUI' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                <FileCheck2 className="h-3 w-3" /> DISETUJUI
                              </span>
                            ) : status === 'DIPERIKSA' ? (
                              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300">
                                <ShieldCheck className="h-3 w-3" /> DIPERIKSA
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                                <Clock className="h-3 w-3" /> DITERBITKAN
                              </span>
                            )}
                          </td>

                          {/* Tombol Aksi Approval Berjenjang */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {!isVoid && !isReplaced && (
                              <div className="flex items-center justify-center gap-1.5">
                                {/* Tombol Periksa (Foreman & Spv) */}
                                {status === 'DITERBITKAN' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(mut, 'DIPERIKSA')}
                                    disabled={!rolePermissions.canCheck || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-30 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
                                    title={rolePermissions.canCheck ? 'Klik untuk Memeriksa' : 'Hanya Foreman / Spv yang berhak memeriksa'}
                                  >
                                    Periksa
                                  </button>
                                )}

                                {/* Tombol Setujui (Spv & Dept. Mgr) */}
                                {status === 'DIPERIKSA' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(mut, 'DISETUJUI')}
                                    disabled={!rolePermissions.canApprove || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-30 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                                    title={rolePermissions.canApprove ? 'Klik untuk Menyetujui' : 'Hanya Spv / Dept. Manager yang berhak menyetujui'}
                                  >
                                    Setujui
                                  </button>
                                )}

                                {/* Tombol Sahkan Mengetahui + TTE/QR (Dept. Mgr, PM, Direktur) */}
                                {status === 'DISETUJUI' && (
                                  <button
                                    onClick={() => handleAdvanceWorkflow(mut, 'MENGETAHUI')}
                                    disabled={!rolePermissions.canAcknowledge || submitting}
                                    className="px-2 py-1 text-[10px] font-bold rounded-lg border border-blue-400 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-30 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300"
                                    title={rolePermissions.canAcknowledge ? 'Klik untuk Mengesahkan dengan TTE/QR' : 'Hanya Dept. Mgr / PM / Direktur yang berhak mengesahkan'}
                                  >
                                    Sahkan (TTE/QR)
                                  </button>
                                )}

                                {status === 'MENGETAHUI' && (
                                  <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                    <CheckCircle2 className="h-3 w-3" /> Selesai
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Tombol Koreksi (Batal & Ganti - Tanpa Hapus) */}
                          <td className="py-3 px-3.5 text-center whitespace-nowrap">
                            {!isVoid && !isReplaced ? (
                              <div className="flex items-center justify-center gap-1">
                                <button
                                  onClick={() => {
                                    setBatalTarget(mut);
                                    setBatalReason('');
                                  }}
                                  className="px-2 py-1 rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-semibold text-rose-700 hover:bg-rose-100 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300"
                                  title="Batalkan dokumen ini (nominal dinolkan)"
                                >
                                  Batal
                                </button>
                                <button
                                  onClick={() => handleOpenGanti(mut)}
                                  className="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-[10px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                                  title="Ganti dokumen ini dengan revisi baru"
                                >
                                  Ganti
                                </button>
                              </div>
                            ) : (
                              <span className="text-[10px] text-slate-600 dark:text-slate-300 font-medium">—</span>
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
    </>
  )}

      {/* Modal Dialog Form Tambah / Terbitkan Mutasi Baru */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
          <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full overflow-hidden animate-in fade-in zoom-in-95">
            <div className="p-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="font-bold text-sm flex items-center gap-2">
                {mutationType === 'MASUK' ? (
                  <>
                    <ArrowDownLeft className="w-4 h-4 text-emerald-400" />
                    <span>Catat Penerimaan Barang (Stok Masuk)</span>
                  </>
                ) : (
                  <>
                    <ArrowUpRight className="w-4 h-4 text-rose-400" />
                    <span>Catat Pengeluaran Barang (Stok Keluar)</span>
                  </>
                )}
              </div>
              <button onClick={() => setIsModalOpen(false)} aria-label="Tutup jendela mutasi" className="text-slate-300 hover:text-white">
                <XCircle className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitMutation} className="p-5 space-y-3.5 text-xs">
              {/* Baris 1: Pemilihan Material (dengan tombol kecil toggle Non-BOQ) */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="font-semibold text-slate-700 dark:text-slate-300">
                    Material / Barang <span className="text-rose-500">*</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !isCustomMode;
                      setIsCustomMode(next);
                      if (next) {
                        setBebanBiaya('OPERASIONAL');
                        setPurpose('');
                      } else {
                        setBebanBiaya('KONTRAKTOR');
                        if (mutationType === 'MASUK') setPurpose('Penyediaan Material Kontrak BOQ');
                        else if (currentPhysicalMaterial?.budget_lines[0]) {
                          const bl = currentPhysicalMaterial.budget_lines[0];
                          setPurpose(`${bl.kode_boq} - ${bl.kategori}`);
                        }
                      }
                    }}
                    className={`text-[11px] px-2 py-0.5 rounded-md font-medium transition-colors ${
                      isCustomMode
                        ? 'bg-purple-100 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300'
                        : 'text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    {isCustomMode ? '← Kembali ke Katalog BOQ' : '+ Item Custom / Non-BOQ'}
                  </button>
                </div>

                {isCustomMode ? (
                  <div className="grid grid-cols-3 gap-2">
                    <input
                      type="text"
                      required
                      placeholder="Nama barang (Cth: Beras 50kg, Balok Camp, Solar...)"
                      value={customItemName}
                      onChange={(e) => setCustomItemName(e.target.value)}
                      className="col-span-2 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-500/20"
                    />
                    <input
                      type="text"
                      required
                      placeholder="Satuan (Kg, Zak...)"
                      value={customItemUom}
                      onChange={(e) => setCustomItemUom(e.target.value)}
                      className="col-span-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-500/20"
                    />
                  </div>
                ) : (
                  currentPhysicalMaterial && !isItemSearchOpen ? (
                    <div className="flex items-center justify-between px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                      <div className="min-w-0 flex-1 flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-white truncate">
                          {currentPhysicalMaterial.nama_barang}
                        </span>
                        <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono">
                          (Stok: <b className={currentStock > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-slate-600 dark:text-slate-300"}>{currentStock} {currentPhysicalMaterial.satuan}</b>)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setIsItemSearchOpen(true);
                          setItemSearchQuery('');
                        }}
                        className="px-2 py-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        Ganti
                      </button>
                    </div>
                  ) : (
                    <div className="relative" ref={itemSearchRef}>
                      <div className="relative">
                        <Search className="w-4 h-4 text-slate-500 dark:text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          autoFocus
                          placeholder="Ketik nama material (cth: Pasir, Semen, Kayu 5/7)..."
                          value={itemSearchQuery}
                          onChange={(e) => {
                            setItemSearchQuery(e.target.value);
                            setIsItemSearchOpen(true);
                          }}
                          onFocus={() => setIsItemSearchOpen(true)}
                          className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-blue-400 dark:border-blue-500 text-slate-900 dark:text-white rounded-xl text-xs focus:ring-2 focus:ring-blue-500/20 font-medium"
                        />
                        {currentPhysicalMaterial && (
                          <button
                            type="button"
                            onClick={() => setIsItemSearchOpen(false)}
                            aria-label="Tutup pencarian material"
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-600 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white text-xs font-bold"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      {isItemSearchOpen && (
                        <div className="absolute left-0 right-0 mt-1 max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-2xl z-50 divide-y divide-slate-100 dark:divide-slate-700/60">
                          {filteredPhysicalMaterialsForPicker.length > 0 ? (
                            filteredPhysicalMaterialsForPicker.map((pm) => (
                              <button
                                key={pm.id}
                                type="button"
                                onClick={() => {
                                  setSelectedItemId(pm.id);
                                  if (pm.budget_lines.length > 0) {
                                    setSelectedAllocationItemId(pm.budget_lines[0].id);
                                    if (mutationType === 'KELUAR') {
                                      setPurpose(`${pm.budget_lines[0].kode_boq} - ${pm.budget_lines[0].kategori}`);
                                    }
                                  }
                                  setIsItemSearchOpen(false);
                                  setItemSearchQuery('');
                                }}
                                className={`w-full text-left p-2.5 transition-colors flex items-center justify-between gap-2 hover:bg-blue-50 dark:hover:bg-slate-700/60 ${
                                  pm.id === currentPhysicalMaterial?.id ? 'bg-blue-50/80 dark:bg-slate-700/90 font-semibold' : ''
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs font-semibold text-slate-900 dark:text-white truncate">
                                    {pm.nama_barang}
                                  </div>
                                  <div className="text-[10px] text-slate-600 dark:text-slate-300 flex items-center gap-1.5 mt-0.5 truncate font-medium">
                                    <span className="font-mono text-blue-600 dark:text-blue-400 font-semibold">
                                      {pm.budget_lines.length} Pos BOQ
                                    </span>
                                    <span>·</span>
                                    <span className="truncate">
                                      {pm.budget_lines.slice(0, 2).map((bl) => bl.kode_boq).join(', ')}
                                      {pm.budget_lines.length > 2 ? '...' : ''}
                                    </span>
                                  </div>
                                </div>
                                <div className="text-right shrink-0">
                                  <div className="text-[10px] font-mono font-bold text-slate-700 dark:text-slate-300">
                                    Stok: {pm.stok_fisik} {pm.satuan}
                                  </div>
                                </div>
                              </button>
                            ))
                          ) : (
                            <div className="p-4 text-center text-xs text-slate-600 dark:text-slate-300 font-medium">
                              Tidak ditemukan material fisik dengan kata kunci "{itemSearchQuery}".
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                )}
              </div>

              {/* KHUSUS MASUK: Asal Barang / Sumber Pengadaan */}
              {mutationType === 'MASUK' && (
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Asal Barang / Sumber <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setAsalBarang('KONTRAKTOR')}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all text-xs font-semibold ${
                        asalBarang === 'KONTRAKTOR'
                          ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 ring-1 ring-blue-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      🏢 CV Menara Megah
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsalBarang('KLIEN')}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all text-xs font-semibold ${
                        asalBarang === 'KLIEN'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 ring-1 ring-emerald-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      👤 Disediakan Klien
                    </button>
                    <button
                      type="button"
                      onClick={() => setAsalBarang('TOKO_BEBAS')}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all text-xs font-semibold ${
                        asalBarang === 'TOKO_BEBAS'
                          ? 'border-purple-500 bg-purple-50 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 ring-1 ring-purple-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      🏪 Toko Bebas
                    </button>
                  </div>
                  {asalBarang === 'TOKO_BEBAS' && (
                    <input
                      type="text"
                      placeholder="Nama toko / vendor pemasok (cth: TB Makmur, Toko Berkah)..."
                      value={tokoBebasName}
                      onChange={(e) => setTokoBebasName(e.target.value)}
                      className="mt-1.5 w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs"
                    />
                  )}
                  {isCustomMode && (
                    <div className="mt-2">
                      <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Alasan / Catatan Pengadaan
                      </label>
                      <input
                        type="text"
                        placeholder="Contoh: Logistik dapur tukang minggu ke-3, Bahan bedeng camp..."
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        className="w-full px-3 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* KHUSUS KELUAR: Tujuan Pengeluaran (4 Opsi Ringkas) */}
              {mutationType === 'KELUAR' && (
                <div className="space-y-2">
                  <label className="block font-semibold text-slate-700 dark:text-slate-300">
                    Dikeluarkan untuk Keperluan Apa? <span className="text-rose-500">*</span>
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setTujuanPengeluaran('PROYEK_BOQ')}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all text-xs font-semibold ${
                        tujuanPengeluaran === 'PROYEK_BOQ'
                          ? 'border-blue-500 bg-blue-50 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300 ring-1 ring-blue-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      🏗️ Proyek (BOQ)
                    </button>
                    <button
                      type="button"
                      onClick={() => setTujuanPengeluaran('OPERASIONAL')}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all text-xs font-semibold ${
                        tujuanPengeluaran === 'OPERASIONAL'
                          ? 'border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300 ring-1 ring-sky-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      🧑‍🍳 Operasional
                    </button>
                    <button
                      type="button"
                      onClick={() => setTujuanPengeluaran('PERMINTAAN_KLIEN')}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all text-xs font-semibold ${
                        tujuanPengeluaran === 'PERMINTAAN_KLIEN'
                          ? 'border-emerald-500 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 ring-1 ring-emerald-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      💰 Minta Klien
                    </button>
                    <button
                      type="button"
                      onClick={() => setTujuanPengeluaran('BONUS_KLIEN')}
                      className={`py-1.5 px-2 rounded-xl border text-center transition-all text-xs font-semibold ${
                        tujuanPengeluaran === 'BONUS_KLIEN'
                          ? 'border-purple-500 bg-purple-50 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 ring-1 ring-purple-500'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100'
                      }`}
                    >
                      🎁 Bonus Klien
                    </button>
                  </div>

                  {/* Rincian Tambahan Sesuai Pilihan Tujuan Keluar */}
                  {tujuanPengeluaran === 'PROYEK_BOQ' && !isCustomMode && currentPhysicalMaterial && (
                    <div className="pt-1">
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Pilih Pos Pekerjaan BOQ
                      </label>
                      {currentPhysicalMaterial.budget_lines.length === 1 ? (
                        <div className="px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                          <div className="truncate mr-2">
                            <span className="font-mono font-bold text-blue-600 dark:text-blue-400 mr-1.5">
                              {currentPhysicalMaterial.budget_lines[0].kode_boq}
                            </span>
                            <span className="text-slate-800 dark:text-slate-200">
                              {currentPhysicalMaterial.budget_lines[0].kategori}
                            </span>
                          </div>
                          <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono shrink-0 font-medium">
                            Sisa: <b className="text-emerald-600 dark:text-emerald-400">{currentPhysicalMaterial.budget_lines[0].sisa_anggaran.toLocaleString('id-ID')} {currentPhysicalMaterial.satuan}</b>
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

                  {tujuanPengeluaran === 'OPERASIONAL' && (
                    <div className="pt-1">
                      <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
                        Keterangan Operasional Lapangan <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="Contoh: Konsumsi dapur tukang minggu ke-3, Bahan bakar genset proyek..."
                        value={keteranganPengeluaran}
                        onChange={(e) => setKeteranganPengeluaran(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:ring-2 focus:ring-blue-500/20"
                      />
                    </div>
                  )}

                  {tujuanPengeluaran === 'PERMINTAAN_KLIEN' && (
                    <div className="pt-1">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                          Keterangan Permintaan Klien <span className="text-rose-500">*</span>
                        </label>
                        <span className="text-[10px] text-emerald-600 font-semibold bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
                          Kena Invoice ke Klien
                        </span>
                      </div>
                      <input
                        type="text"
                        required
                        placeholder="Contoh: Penambahan stop kontak AC kamar utama, variasi keramik teras..."
                        value={keteranganPengeluaran}
                        onChange={(e) => setKeteranganPengeluaran(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-emerald-300 dark:border-emerald-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:ring-2 focus:ring-emerald-500/20"
                      />
                      <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 font-medium">
                        ℹ️ Transaksi ini otomatis ditampung ke draf tagihan/invoice pekerjaan tambah ke klien.
                      </p>
                    </div>
                  )}

                  {tujuanPengeluaran === 'BONUS_KLIEN' && (
                    <div className="pt-1">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-[11px] font-semibold text-purple-700 dark:text-purple-400">
                          Keterangan Bonus untuk Klien <span className="text-rose-500">*</span>
                        </label>
                        <span className="text-[10px] text-purple-600 font-semibold bg-purple-50 dark:bg-purple-950/60 px-2 py-0.5 rounded-full">
                          Gratis (Beban CV Menara Megah)
                        </span>
                      </div>
                      <input
                        type="text"
                        required
                        placeholder="Contoh: Bonus kekuatan bekisting kolom struktur, ekstra plesteran luar..."
                        value={keteranganPengeluaran}
                        onChange={(e) => setKeteranganPengeluaran(e.target.value)}
                        className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-purple-300 dark:border-purple-700 text-slate-900 dark:text-white rounded-xl text-xs font-medium focus:ring-2 focus:ring-purple-500/20"
                      />
                      <p className="text-[10px] text-slate-600 dark:text-slate-300 mt-1 font-medium">
                        ℹ️ Tidak ditagihkan ke klien (diserap sebagai penjaminan mutu CV Menara Megah).
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Tanggal Mutasi & Jumlah Kuantitas */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    {mutationType === 'MASUK' ? 'Tanggal Masuk' : 'Tanggal Keluar'} <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={mutationDate}
                    onChange={(e) => setMutationDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-medium focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="font-semibold text-slate-700 dark:text-slate-300">
                      Jumlah ({isCustomMode ? (customItemUom || 'Unit') : (currentPhysicalMaterial?.satuan || 'Unit')}) <span className="text-rose-500">*</span>
                    </label>
                    {!isCustomMode && (
                      <span className="text-[10px] text-slate-600 dark:text-slate-300 font-mono font-medium">
                        Stok jadi: <b className={mutationType === 'MASUK' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}>{projectedStock}</b>
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    min="0.0001"
                    step="any"
                    required
                    value={qty}
                    onChange={(e) => setQty(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono font-bold focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>

              {/* Baris 6: PIC & No. Surat Jalan */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">PIC / Petugas</label>
                  <input
                    type="text"
                    value={pic}
                    onChange={(e) => setPic(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">No. Surat Jalan / Ref</label>
                  <input
                    type="text"
                    placeholder="SJ-001 / BON-12"
                    value={suratJalan}
                    onChange={(e) => setSuratJalan(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl font-mono text-xs"
                  />
                </div>
              </div>

              {/* Baris 7: Tombol Aksi */}
              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className={`px-5 py-2.5 text-xs font-semibold text-white rounded-xl shadow-sm ${
                    mutationType === 'MASUK' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'
                  }`}
                >
                  {submitting ? 'Menyimpan...' : 'Terbitkan Dokumen Mutasi'}
                </button>
              </div>
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
