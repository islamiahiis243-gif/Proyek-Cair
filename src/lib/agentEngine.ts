/**
 * Agent Engine - Proyek Cair Conversational Assistant
 * Mesin pemrosesan bahasa alami (NLP) berbasis niat (Intent Recognition)
 * Bahasa Indonesia 100% native untuk operasional cerdas tanpa menu.
 */

import { ItemBarang, MutasiBarang, MutasiKas } from '../types';

export type AgentIntentType =
  | 'STOCK_IN_AND_CASH'
  | 'STOCK_IN_ONLY'
  | 'STOCK_OUT'
  | 'CASH_EXPENSE'
  | 'CHECK_CASH_BALANCE'
  | 'CHECK_STOCK'
  | 'CHECK_PROFIT_LOSS'
  | 'CHECK_APPROVAL_QUEUE'
  | 'NAVIGATE'
  | 'CONFIRM_ACTION'
  | 'CANCEL_ACTION'
  | 'GENERAL_QUERY';

export type PaymentScenario = 'KANTOR_PUSAT' | 'KAS_PROYEK' | 'TEMPO_TOKO' | 'PANJAR_LAPANGAN';

export interface ParsedTransactionData {
  itemCandidate?: string;
  matchedItemId?: string;
  matchedItemName?: string;
  quantity?: number;
  unit?: string;
  pricePerUnit?: number;
  totalAmount?: number;
  storeName?: string;
  category?: 'Material' | 'Upah & Konsumsi' | 'Sewa Alat & Angkut' | 'Operasional Kantor & Lapangan' | 'Subkon & Spesialis' | 'Lain-lain / Tak Terduga';
  notes?: string;
  targetView?: string;
  paymentScenario?: PaymentScenario;
  poNumber?: string;
  attachedImageUrl?: string;
}

export interface AgentIntentResult {
  type: AgentIntentType;
  confidence: number;
  spokenResponse: string;
  actionRequired: boolean;
  proposedActionTitle?: string;
  proposedActionSubtitle?: string;
  data: ParsedTransactionData;
}

export interface AgentContextSnapshot {
  userRole: string;
  userName: string;
  projectName: string;
  currentCashBalance: number;
  items: ItemBarang[];
  totalStockAssetValue: number;
  stockMutationsCount: number;
  cashMutationsCount: number;
  pendingApprovalCount?: number;
  canViewFinancials?: boolean;
}

/**
 * Konversi teks nominal bahasa Indonesia (misal: "dua juta lima ratus ribu", "dua juta lima ratus", "75 ribu", "1.500.000") ke angka
 */
export function parseIndonesianNumber(text: string): number | null {
  if (!text) return null;
  const clean = text.toLowerCase().replace(/,/g, '.').trim();

  // 1. Cek pola angka langsung (misal: "Rp 2.500.000" atau "2500000" atau "75.000")
  const numMatch = clean.match(/(?:rp\.?\s*)?(\d+(?:\.\d{3})*(?:,\d+)?|\d+)/i);
  if (numMatch && numMatch[1]) {
    const rawVal = numMatch[1].replace(/\./g, '');
    const num = parseFloat(rawVal);
    if (!isNaN(num) && num > 0) {
      if (clean.includes('juta') && num < 1000) return num * 1000000;
      if (clean.includes('ribu') && num < 1000) return num * 1000;
      return num;
    }
  }

  // 2. Parser kata bilangan bahasa Indonesia terstruktur
  const digitWords: Record<string, number> = {
    satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
    enam: 6, tujuh: 7, delapan: 8, sembilan: 9
  };

  // Helper parsing kelompok ribuan / ratusan
  const parseGroup = (phrase: string): number => {
    const tokens = phrase.trim().split(/\s+/);
    let val = 0;
    let temp = 0;

    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (digitWords[tok] !== undefined) {
        temp += digitWords[tok];
      } else if (tok === 'sepuluh') {
        temp += 10;
      } else if (tok === 'sebelas') {
        temp += 11;
      } else if (tok === 'belas') {
        temp += 10;
      } else if (tok === 'puluh') {
        temp = (temp === 0 ? 1 : temp) * 10;
      } else if (tok === 'seratus') {
        val += 100;
      } else if (tok === 'ratus') {
        val += (temp === 0 ? 1 : temp) * 100;
        temp = 0;
      }
    }
    return val + temp;
  };

  let total = 0;

  // Cek bagian "juta"
  if (clean.includes('juta')) {
    const [jutaPart, afterJuta] = clean.split('juta');
    const jutaVal = parseGroup(jutaPart);
    total += (jutaVal === 0 ? 1 : jutaVal) * 1000000;

    if (afterJuta && afterJuta.trim()) {
      if (afterJuta.includes('ribu')) {
        const [ribuPart, rest] = afterJuta.split('ribu');
        total += parseGroup(ribuPart) * 1000;
        if (rest && rest.trim()) total += parseGroup(rest);
      } else {
        const afterVal = parseGroup(afterJuta);
        // Frasa lazim: "dua juta lima ratus" = 2.500.000 (bukan 2.000.500)
        if (afterVal > 0 && afterVal < 1000) {
          total += afterVal * 1000;
        } else {
          total += afterVal;
        }
      }
    }
    return total > 0 ? total : null;
  }

  // Cek bagian "ribu"
  if (clean.includes('ribu')) {
    const [ribuPart, rest] = clean.split('ribu');
    const ribuVal = parseGroup(ribuPart);
    total += (ribuVal === 0 ? 1 : ribuVal) * 1000;
    if (rest && rest.trim()) total += parseGroup(rest);
    return total > 0 ? total : null;
  }

  const direct = parseGroup(clean);
  return direct > 0 ? direct : null;
}

/**
 * Pencocokan item barang berdasarkan kemiripan nama
 */
export function findMatchingItem(query: string, items: ItemBarang[]): ItemBarang | null {
  if (!query || items.length === 0) return null;
  const q = query.toLowerCase().trim();

  // 1. Exact match
  const exact = items.find(it => it.nama_barang.toLowerCase() === q);
  if (exact) return exact;

  // 2. Substring match
  const sub = items.find(it => it.nama_barang.toLowerCase().includes(q) || q.includes(it.nama_barang.toLowerCase()));
  if (sub) return sub;

  // 3. Keyword token match (misal "semen" cocok dengan "Semen Padang 40kg" atau "Semen Gresik")
  const tokens = q.split(/\s+/).filter(t => t.length > 2);
  for (const token of tokens) {
    const tokenMatch = items.find(it => it.nama_barang.toLowerCase().includes(token));
    if (tokenMatch) return tokenMatch;
  }

  return null;
}

/**
 * Ekstraksi Nama Toko dari frasa "dari toko X", "di TB Y", "supplier Z"
 */
export function extractStoreName(text: string): string | undefined {
  const storePattern = /(?:dari|di|pada)\s+(?:toko|tb|rekanan|suplier|supplier)?\s*([a-zA-Z0-9\.\s]+?)(?=(?:harga|total|seharga|senilai|sebesar|langsung|pakai|tunai|cash|kemarin|hari|$))/i;
  const match = text.match(storePattern);
  if (match && match[1]) {
    let raw = match[1].trim();
    raw = raw.replace(/^(?:toko|tb)\s+/i, '').trim();
    if (raw.length > 2 && !['gudang', 'lapangan', 'kas', 'kasir'].includes(raw.toLowerCase())) {
      if (/\btb\s+/i.test(match[0])) {
        return 'TB ' + raw.charAt(0).toUpperCase() + raw.slice(1);
      }
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    }
  }
  return undefined;
}

/**
 * Deteksi Kategori Pengeluaran Kas
 */
export function detectCashCategory(text: string): ParsedTransactionData['category'] {
  const t = text.toLowerCase();
  if (t.includes('upah') || t.includes('tukang') || t.includes('mandor') || t.includes('makan') || t.includes('konsumsi')) {
    return 'Upah & Konsumsi';
  }
  if (t.includes('sewa') || t.includes('alat') || t.includes('molen') || t.includes('angkut') || t.includes('truk') || t.includes('mobilisasi')) {
    return 'Sewa Alat & Angkut';
  }
  if (t.includes('bensin') || t.includes('solar') || t.includes('atk') || t.includes('pulsa') || t.includes('listrik') || t.includes('operasional')) {
    return 'Operasional Kantor & Lapangan';
  }
  if (t.includes('subkon') || t.includes('spesialis') || t.includes('borongan luar')) {
    return 'Subkon & Spesialis';
  }
  return 'Material';
}

/**
 * Mesin Utama Pemrosesan Percakapan Asisten AI
 */
export function parseAgentQuery(rawQuery: string, context: AgentContextSnapshot): AgentIntentResult {
  const text = rawQuery.toLowerCase().trim();

  // 1. Cek Kata Konfirmasi atau Batal
  const isConfirm = /^(ya|oke|ok|setuju|eksekusi|lanjutkan|bukukan|simpan|benar|yup|confirm)\b/i.test(text) ||
    /\b(ya|eksekusi|bukukan)\b/i.test(text);
  if (isConfirm && !text.includes('semen') && !text.includes('pasir') && !text.includes('besi') && !text.includes('catat') && !text.includes('keluar')) {
    return {
      type: 'CONFIRM_ACTION',
      confidence: 0.99,
      spokenResponse: 'Memproses dan membukukan transaksi sekarang...',
      actionRequired: true,
      data: {}
    };
  }

  const isCancel = /^(batal|batalkan|tidak|jangan|salah|cancel|kembali)\b/i.test(text) || /\b(batal|batalkan)\b/i.test(text);
  if (isCancel && !text.includes('catat') && !text.includes('masuk')) {
    return {
      type: 'CANCEL_ACTION',
      confidence: 0.99,
      spokenResponse: 'Perintah dibatalkan. Tidak ada data yang diubah.',
      actionRequired: false,
      data: {}
    };
  }

  // 2. Cek Saldo Kas Proyek
  if (text.includes('saldo') || text.includes('uang kas') || text.includes('sisa uang') || text.includes('kas kita')) {
    if (context.userRole === 'Viewer/Pengamat' || context.canViewFinancials === false) {
      return {
        type: 'CHECK_CASH_BALANCE',
        confidence: 0.95,
        spokenResponse: 'Informasi saldo kas dan finansial proyek dirahasiakan dan tidak dapat diakses untuk peran Anda.',
        actionRequired: false,
        data: {}
      };
    }
    const formatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(context.currentCashBalance);
    return {
      type: 'CHECK_CASH_BALANCE',
      confidence: 0.95,
      spokenResponse: `Saldo kas riil proyek ${context.projectName} saat ini adalah ${formatted}. Saldo siap digunakan untuk operasional.`,
      actionRequired: false,
      data: { totalAmount: context.currentCashBalance }
    };
  }

  // 3. Cek Posisi Untung Rugi & Performa Proyek
  if (text.includes('untung rugi') || text.includes('laba') || text.includes('margin') || text.includes('performa') || text.includes('evaluasi proyek')) {
    if (context.userRole === 'Viewer/Pengamat' || context.canViewFinancials === false) {
      return {
        type: 'CHECK_PROFIT_LOSS',
        confidence: 0.92,
        spokenResponse: 'Informasi evaluasi laba-rugi dan performa finansial proyek dirahasiakan untuk peran Anda.',
        actionRequired: false,
        data: { targetView: 'dashboard' }
      };
    }
    const assetFormatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(context.totalStockAssetValue);
    const cashFormatted = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(context.currentCashBalance);
    return {
      type: 'CHECK_PROFIT_LOSS',
      confidence: 0.92,
      spokenResponse: `Posisi saat ini: Valuasi fisik material di gudang tercatat ${assetFormatted}, dan saldo kas aktif ${cashFormatted}. Seluruh pencatatan mengacu pada pagu kontrak BOQ.`,
      actionRequired: false,
      data: { targetView: 'dashboard' }
    };
  }

  // 3b. Cek Antrean Persetujuan & Dokumen Menunggu Giliran
  if (
    text.includes('antrean') ||
    text.includes('persetujuan') ||
    text.includes('periksa dokumen') ||
    text.includes('approval') ||
    text.includes('belum disetujui') ||
    text.includes('belum disahkan')
  ) {
    const count = context.pendingApprovalCount || 0;
    if (count > 0) {
      return {
        type: 'CHECK_APPROVAL_QUEUE',
        confidence: 0.95,
        spokenResponse: `Terdapat ${count} transaksi atau dokumen yang menunggu persetujuan Anda saat ini. Saya dapat langsung membukakan antrean mutasi untuk Anda periksa.`,
        actionRequired: false,
        data: { targetView: 'stock-mutations' }
      };
    } else {
      return {
        type: 'CHECK_APPROVAL_QUEUE',
        confidence: 0.95,
        spokenResponse: 'Seluruh transaksi dan dokumen proyek saat ini telah disahkan. Tidak ada antrean persetujuan yang menunggu tindakan Anda.',
        actionRequired: false,
        data: { targetView: 'dashboard' }
      };
    }
  }

  // 4. Navigasi Cepat Halaman
  if (text.startsWith('buka') || text.startsWith('tampilkan') || text.startsWith('pindah ke') || text.startsWith('lihat')) {
    if (text.includes('gudang') || text.includes('stok') || text.includes('mutasi barang') || text.includes('inventaris')) {
      return {
        type: 'NAVIGATE',
        confidence: 0.95,
        spokenResponse: 'Membuka halaman Mutasi Gudang & Stok Material.',
        actionRequired: false,
        data: { targetView: 'stock-mutations' }
      };
    }
    if (text.includes('kas') || text.includes('uang') || text.includes('jurnal') || text.includes('rekonsiliasi')) {
      return {
        type: 'NAVIGATE',
        confidence: 0.95,
        spokenResponse: 'Membuka halaman Buku Mutasi Kas & Rekonsiliasi.',
        actionRequired: false,
        data: { targetView: 'cashflow' }
      };
    }
    if (text.includes('pengadaan') || text.includes('po') || text.includes('pesanan toko') || text.includes('purchasing')) {
      return {
        type: 'NAVIGATE',
        confidence: 0.95,
        spokenResponse: 'Membuka halaman Pengadaan Material & PO Toko.',
        actionRequired: false,
        data: { targetView: 'procurement' }
      };
    }
    if (text.includes('laporan') || text.includes('berita acara') || text.includes('dokumen')) {
      return {
        type: 'NAVIGATE',
        confidence: 0.95,
        spokenResponse: 'Membuka halaman Dokumen Resmi & Berita Acara TTE.',
        actionRequired: false,
        data: { targetView: 'reports' }
      };
    }
    if (text.includes('dasbor') || text.includes('dashboard') || text.includes('beranda') || text.includes('depan')) {
      return {
        type: 'NAVIGATE',
        confidence: 0.95,
        spokenResponse: 'Membuka Dasbor Analitik Utama.',
        actionRequired: false,
        data: { targetView: 'dashboard' }
      };
    }
  }

  // 5. Cek Stok Item Tertentu
  if ((text.includes('cek') || text.includes('ada berapa') || text.includes('sisa stok') || text.includes('stok')) && !text.includes('catat') && !text.includes('masuk') && !text.includes('keluar')) {
    // Cari item yang disebut
    for (const it of context.items) {
      if (text.includes(it.nama_barang.toLowerCase())) {
        return {
          type: 'CHECK_STOCK',
          confidence: 0.92,
          spokenResponse: `Stok material ${it.nama_barang} saat ini tercatat ${it.stok_saat_ini} ${it.satuan}. Status ketersediaan: ${it.status}.`,
          actionRequired: false,
          data: {
            matchedItemId: it.id,
            matchedItemName: it.nama_barang,
            quantity: it.stok_saat_ini,
            unit: it.satuan
          }
        };
      }
    }
  }

  // 6. Pencatatan Mutasi Barang Keluar (Pakai ke Lapangan)
  const isIncomingGoods = text.includes('masuk') || text.includes('tiba') || text.includes('terima') || text.includes('datang') || text.includes('drop') || text.includes('beli');
  if (!isIncomingGoods && (text.includes('keluar') || text.includes('pakai') || text.includes('ambil') || text.includes('gunakan') || text.includes('distribusi'))) {
    // Ekstraksi kuantitas
    const qtyMatch = text.match(/(\d+)\s*(sak|rit|m3|m2|batang|lembar|kg|buah|lonjor|unit|set|zak)?/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : parseIndonesianNumber(text) || 1;
    const unit = qtyMatch && qtyMatch[2] ? qtyMatch[2] : 'unit';

    // Cari item yang dicocokkan
    let matchedItem: ItemBarang | null = null;
    for (const it of context.items) {
      if (text.includes(it.nama_barang.toLowerCase()) || text.includes(it.kode_boq.toLowerCase())) {
        matchedItem = it;
        break;
      }
    }
    if (!matchedItem) {
      // Cari kata kunci umum
      if (text.includes('semen')) matchedItem = findMatchingItem('semen', context.items);
      else if (text.includes('pasir')) matchedItem = findMatchingItem('pasir', context.items);
      else if (text.includes('batu') || text.includes('batako')) matchedItem = findMatchingItem('batako', context.items) || findMatchingItem('batu', context.items);
      else if (text.includes('besi')) matchedItem = findMatchingItem('besi', context.items);
    }

    const itemName = matchedItem ? matchedItem.nama_barang : 'Material';
    const itemUnit = matchedItem ? matchedItem.satuan : unit;

    return {
      type: 'STOCK_OUT',
      confidence: 0.88,
      spokenResponse: `Siap mencatat pengeluaran ${qty} ${itemUnit} ${itemName} untuk pemakaian lapangan. Mohon konfirmasi untuk membukukan.`,
      actionRequired: true,
      proposedActionTitle: `📦 Pengeluaran Material Gudang: ${qty} ${itemUnit} ${itemName}`,
      proposedActionSubtitle: `Akan mengurangi saldo fisik gudang dari ${matchedItem ? matchedItem.stok_saat_ini : 0} ${itemUnit} menjadi ${Math.max(0, (matchedItem ? matchedItem.stok_saat_ini : 0) - qty)} ${itemUnit}.`,
      data: {
        matchedItemId: matchedItem?.id,
        matchedItemName: itemName,
        quantity: qty,
        unit: itemUnit,
        notes: rawQuery
      }
    };
  }

  // 7. Pencatatan Mutasi Barang Masuk (+ Opsi Pelunasan Kas Otomatis)
  if (text.includes('masuk') || text.includes('tiba') || text.includes('terima') || text.includes('datang') || text.includes('drop')) {
    // Ekstraksi kuantitas
    const qtyMatch = text.match(/(\d+)\s*(sak|rit|m3|m2|batang|lembar|kg|buah|lonjor|unit|set|zak)?/i);
    const qty = qtyMatch ? parseInt(qtyMatch[1], 10) : 1;
    const unit = qtyMatch && qtyMatch[2] ? qtyMatch[2] : 'unit';

    // Cari item yang dicocokkan
    let matchedItem: ItemBarang | null = null;
    for (const it of context.items) {
      if (text.includes(it.nama_barang.toLowerCase())) {
        matchedItem = it;
        break;
      }
    }
    if (!matchedItem) {
      if (text.includes('semen')) matchedItem = findMatchingItem('semen', context.items);
      else if (text.includes('pasir')) matchedItem = findMatchingItem('pasir', context.items);
      else if (text.includes('batako')) matchedItem = findMatchingItem('batako', context.items);
      else if (text.includes('besi')) matchedItem = findMatchingItem('besi', context.items);
      else if (text.includes('cat')) matchedItem = findMatchingItem('cat', context.items);
    }

    const itemName = matchedItem ? matchedItem.nama_barang : 'Material Baru';
    const itemUnit = matchedItem ? matchedItem.satuan : unit;
    const storeName = extractStoreName(rawQuery) || 'Toko Rekanan';

    // Ekstraksi total rupiah
    // Hindari mencocokkan kuantitas (misal: "50 sak ... dua juta")
    let totalRp: number | null = null;
    const rpRegex = /(?:total|seharga|senilai|sebesar|harga|bayar)\s*([0-9\.\s\w]+?)(?=(?:pakai|tunai|cash|kemarin|hari|$))/i;
    const rpMatch = rawQuery.match(rpRegex);
    if (rpMatch && rpMatch[1]) {
      totalRp = parseIndonesianNumber(rpMatch[1]);
    } else {
      // Coba parse bagian belakang
      const parts = rawQuery.split(/(?:sak|rit|m3|lembar|batang|kg|unit)/i);
      if (parts.length > 1) {
        totalRp = parseIndonesianNumber(parts[1]);
      }
    }

    // Deteksi 4 Skenario Riil Lapangan (Dokumen UPCOMING_PLAN)
    let paymentScenario: PaymentScenario = 'KAS_PROYEK';
    if (text.includes('kantor') || text.includes('pusat') || text.includes('cbd') || text.includes('transfer di depan') || text.includes('lunas kantor')) {
      paymentScenario = 'KANTOR_PUSAT';
    } else if (text.includes('tempo') || text.includes('hutang') || text.includes('kredit') || text.includes('tagihan menyusul') || text.includes('invoice')) {
      paymentScenario = 'TEMPO_TOKO';
    } else if (text.includes('panjar') || text.includes('kasbon')) {
      paymentScenario = 'PANJAR_LAPANGAN';
    } else if (text.includes('bayar') || text.includes('lunas') || text.includes('kas') || text.includes('tunai') || text.includes('cod')) {
      paymentScenario = 'KAS_PROYEK';
    } else {
      paymentScenario = totalRp ? 'KAS_PROYEK' : 'TEMPO_TOKO';
    }

    const formattedRp = totalRp
      ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(totalRp)
      : null;

    let intentType: AgentIntentType = 'STOCK_IN_AND_CASH';
    let responseText = '';
    let actionTitle = '';
    let actionSubtitle = '';

    if (paymentScenario === 'KANTOR_PUSAT') {
      intentType = 'STOCK_IN_ONLY';
      responseText = `Siap mencatat kedatangan ${qty} ${itemUnit} ${itemName} dari ${storeName}. Pembayaran telah lunas ditransfer kantor pusat, kas proyek tidak akan dipotong ganda. Silakan konfirmasi untuk mencatat.`;
      actionTitle = `📦 Barang Masuk: ${qty} ${itemUnit} ${itemName} (Lunas Transfer Kantor Pusat)`;
      actionSubtitle = `Toko: ${storeName} · Nilai: ${formattedRp || 'Sesuai PO'} · Saldo fisik bertambah & bebas beban kas proyek.`;
    } else if (paymentScenario === 'TEMPO_TOKO') {
      intentType = 'STOCK_IN_ONLY';
      responseText = `Siap mencatat kedatangan ${qty} ${itemUnit} ${itemName} dari ${storeName} tempo toko. Nota akan masuk ke antrean kasir untuk pembayaran jatuh tempo. Silakan konfirmasi.`;
      actionTitle = `📦 Barang Masuk: ${qty} ${itemUnit} ${itemName} (Tempo Toko)`;
      actionSubtitle = `Toko: ${storeName} · Nilai: ${formattedRp || 'Menyusul'} · Stok gudang bertambah & masuk antrean tagihan kasir.`;
    } else if (paymentScenario === 'PANJAR_LAPANGAN') {
      intentType = 'STOCK_IN_AND_CASH';
      responseText = `Siap mencatat kedatangan ${qty} ${itemUnit} ${itemName} dari ${storeName} senilai ${formattedRp} dari panjar lapangan. Sekaligus disiapkan draf pertanggungjawaban panjar mandor. Silakan konfirmasi.`;
      actionTitle = `📦 Barang Masuk + 💼 Pertanggungjawaban Panjar (LPJ): ${qty} ${itemUnit} ${itemName}`;
      actionSubtitle = `Toko: ${storeName} · Nilai: ${formattedRp} · Stok bertambah & panjar mandor dipertanggungjawabkan.`;
    } else {
      // KAS_PROYEK
      intentType = totalRp ? 'STOCK_IN_AND_CASH' : 'STOCK_IN_ONLY';
      responseText = totalRp
        ? `Siap mencatat kedatangan ${qty} ${itemUnit} ${itemName} dari ${storeName} senilai ${formattedRp}, sekaligus membukukan pembayaran lunas dari kas proyek. Silakan konfirmasi untuk membukukan.`
        : `Siap mencatat kedatangan ${qty} ${itemUnit} ${itemName} dari ${storeName}. Stok gudang akan bertambah. Silakan konfirmasi.`;
      actionTitle = totalRp
        ? `📦 Barang Masuk + 💸 Pelunasan Kas Proyek: ${qty} ${itemUnit} ${itemName}`
        : `📦 Penerimaan Barang Masuk: ${qty} ${itemUnit} ${itemName}`;
      actionSubtitle = totalRp
        ? `Toko: ${storeName} · Nilai: ${formattedRp} · Stok bertambah & Kas berkurang otomatis.`
        : `Toko: ${storeName} · Saldo fisik gudang akan bertambah ${qty} ${itemUnit}.`;
    }

    return {
      type: intentType,
      confidence: 0.91,
      spokenResponse: responseText,
      actionRequired: true,
      proposedActionTitle: actionTitle,
      proposedActionSubtitle: actionSubtitle,
      data: {
        matchedItemId: matchedItem?.id,
        matchedItemName: itemName,
        quantity: qty,
        unit: itemUnit,
        totalAmount: totalRp || undefined,
        pricePerUnit: totalRp ? Math.round(totalRp / qty) : undefined,
        storeName: storeName,
        category: 'Material',
        paymentScenario: paymentScenario,
        notes: rawQuery
      }
    };
  }

  // 8. Pengeluaran Kas Murni (Upah, Bensin, Operasional, Sewa Alat)
  if (text.includes('bayar') || text.includes('beli') || text.includes('keluar uang') || text.includes('kas keluar')) {
    const category = detectCashCategory(text);
    const amount = parseIndonesianNumber(rawQuery);
    const formattedAmount = amount
      ? new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(amount)
      : 'sesuai nominal';

    const storeName = extractStoreName(rawQuery);

    return {
      type: 'CASH_EXPENSE',
      confidence: 0.86,
      spokenResponse: `Siap membukukan pengeluaran kas ${category} sebesar ${formattedAmount}. Saldo kas proyek akan berkurang. Silakan konfirmasi untuk mencatat.`,
      actionRequired: true,
      proposedActionTitle: `💸 Pengeluaran Kas: ${category} (${formattedAmount})`,
      proposedActionSubtitle: `Keterangan: ${rawQuery} ${storeName ? `· Penerima: ${storeName}` : ''}`,
      data: {
        totalAmount: amount || undefined,
        category: category,
        storeName: storeName,
        notes: rawQuery
      }
    };
  }

  // 9. Pertanyaan Umum / Panduan
  return {
    type: 'GENERAL_QUERY',
    confidence: 0.5,
    spokenResponse: `Saya mendengarkan: "${rawQuery}". Anda dapat memerintahkan saya secara langsung, misalnya: "Catat semen masuk 50 sak dari TB Berkah dua juta lima ratus", "Berapa sisa uang kas sekarang?", atau "Keluarkan 20 sak semen untuk lantai 2".`,
    actionRequired: false,
    data: { notes: rawQuery }
  };
}
