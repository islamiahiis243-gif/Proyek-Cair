import { getSupabaseClient } from './supabase';
import {
  SupplierStore,
  MutasiBarang,
  MutasiKas,
  ProjectReceiptAlbumItem,
  ProjectReceipt,
  ReceiptScope,
} from '../types';
import {
  doReceiptStoresMatch,
  isClientSuppliedStockMutation,
  normalizeReceiptRef,
  normalizeReceiptStoreName,
} from './cashflowEngine';

/**
 * Fallback aman untuk kolom NOT NULL pada tabel project_receipts
 * (reference_no, nama_toko, tanggal_nota) khususnya untuk kuitansi kas kecil/lapangan.
 */
export function buildSafeReceiptFields(
  receipt: Partial<ProjectReceipt>,
  fallbackPic?: string
): { reference_no: string; nama_toko: string; tanggal_nota: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const todayStr = `${y}-${m}-${d}`;
  const rand4 = Math.random().toString(36).substring(2, 6).toUpperCase();

  const rawRef = (receipt.reference_no || '').trim();
  const reference_no =
    rawRef && rawRef !== '-' && rawRef.toLowerCase() !== 'null'
      ? rawRef
      : `KWT-${y}${m}${d}-${rand4}`;

  const rawStore = (receipt.nama_toko || '').trim();
  const nama_toko = rawStore || (fallbackPic?.trim() ? `${fallbackPic.trim()} / Kas Lapangan` : 'Kas Lapangan');

  const rawDate = (receipt.tanggal_nota || '').trim();
  const tanggal_nota = rawDate ? rawDate.slice(0, 10) : todayStr;

  return { reference_no, nama_toko, tanggal_nota };
}

/**
 * Kompresi gambar nota di sisi peramban sebelum diunggah (Hemat Kuota & Cepat di Lapangan)
 * Menghasilkan file JPEG tajam ~200-400KB dari foto asli kamera HP 5-15MB.
 */
export async function compressReceiptImage(file: File, maxDim = 1800, quality = 0.82): Promise<Blob> {
  if (file.type === 'application/pdf') {
    return file; // Jangan ubah berkas PDF
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              resolve(file);
            }
          },
          'image/jpeg',
          quality
        );
      };
      img.onerror = () => resolve(file);
      img.src = e.target?.result as string;
    };
    reader.onerror = () => resolve(file);
    reader.readAsDataURL(file);
  });
}

/**
 * Konversi berkas ke Base64 Data URL (Fallback aman bila jaringan offline)
 */
export function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

/**
 * Unggah Berkas Bukti Nota ke Supabase Storage (Bucket: receipts)
 * Mengembalikan URL publik atau Fallback Data URL.
 */
export async function uploadReceiptFile(
  file: File,
  projectId = 'default_project',
  receiptNo = 'nota'
): Promise<string> {
  const cleanReceipt = receiptNo.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) || 'nota';
  const timestamp = Date.now();
  const isPdf = file.type === 'application/pdf';
  const ext = isPdf ? 'pdf' : 'jpg';
  const filePath = `${projectId}/${cleanReceipt}_${timestamp}_${Math.random().toString(36).substring(2, 6)}.${ext}`;

  try {
    const compressed = isPdf ? file : await compressReceiptImage(file);
    const client = getSupabaseClient();

    if (client) {
      const { data, error } = await client.storage
        .from('receipts')
        .upload(filePath, compressed, {
          contentType: isPdf ? 'application/pdf' : 'image/jpeg',
          upsert: true
        });

      if (!error && data) {
        const { data: pubData } = client.storage
          .from('receipts')
          .getPublicUrl(filePath);

        if (pubData?.publicUrl) {
          return pubData.publicUrl;
        }
      }
    }
  } catch (err) {
    console.warn('Gagal unggah ke storage cloud, beralih ke penyimpanan lokal terkompresi:', err);
  }

  // Fallback ke Base64 lokal terkompresi
  const compressedFallback = isPdf ? file : await compressReceiptImage(file, 1200, 0.7);
  return await fileToBase64(compressedFallback);
}

/**
 * Ambil daftar toko / suplier langganan untuk auto-complete cepat
 */
export async function fetchSupplierStores(projectId?: string): Promise<SupplierStore[]> {
  try {
    const client = getSupabaseClient();
    if (!client) return [];
    let query = client
      .from('supplier_stores')
      .select('*')
      .order('nama_toko', { ascending: true });

    if (projectId) {
      query = query.or(`project_id.eq.${projectId},project_id.is.null`);
    }

    const { data, error } = await query;
    if (error) {
      console.warn('Gagal memuat daftar toko suplier:', error);
      return [];
    }
    return (data as SupplierStore[]) || [];
  } catch (e) {
    return [];
  }
}

/**
 * Simpan Toko / Suplier Baru jika belum ada
 */
export async function saveSupplierStore(store: {
  nama_toko: string;
  telepon?: string;
  alamat?: string;
  project_id?: string;
}): Promise<void> {
  const cleanName = store.nama_toko.trim();
  if (!cleanName) return;

  try {
    const client = getSupabaseClient();
    if (!client) return;

    // Cek apakah sudah ada nama toko yang sama
    const { data } = await client
      .from('supplier_stores')
      .select('id')
      .ilike('nama_toko', cleanName)
      .limit(1);

    if (!data || data.length === 0) {
      await client.from('supplier_stores').insert({
        nama_toko: cleanName,
        telepon: store.telepon?.trim() || null,
        alamat: store.alamat?.trim() || null,
        project_id: store.project_id || null
      });
    }
  } catch (err) {
    console.warn('Gagal menyimpan toko suplier baru:', err);
  }
}

/**
 * Ambil daftar nota resmi fisik proyek dari tabel project_receipts
 */
export async function fetchProjectReceipts(projectId: string): Promise<ProjectReceipt[]> {
  try {
    const client = getSupabaseClient();
    if (!client) return [];
    const { data, error } = await client
      .from('project_receipts')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('Gagal memuat daftar project_receipts:', error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.warn('Error fetchProjectReceipts:', err);
    return [];
  }
}

/**
 * Buat entitas nota resmi baru di project_receipts (mendukung Barang, Kas, maupun Terpadu)
 */
export async function createProjectReceipt(
  receipt: Partial<ProjectReceipt>,
  fallbackPic?: string
): Promise<ProjectReceipt | null> {
  try {
    const client = getSupabaseClient();
    if (!client) return null;
    const safe = buildSafeReceiptFields(receipt, fallbackPic);
    const { data, error } = await client
      .from('project_receipts')
      .insert({
        project_id: receipt.project_id,
        reference_no: safe.reference_no,
        nama_toko: safe.nama_toko,
        toko_kontak: receipt.toko_kontak || null,
        tanggal_nota: safe.tanggal_nota,
        total_nota_fisik: receipt.total_nota_fisik || 0,
        lampiran_nota_urls: receipt.lampiran_nota_urls || [],
        notes: receipt.notes || null,
        receipt_scope: receipt.receipt_scope || 'BELANJA_BARANG',
        status_verifikasi: receipt.status_verifikasi || 'TERCATAT',
        is_batal: false,
        is_ganti: false,
        referensi_ganti_id: receipt.referensi_ganti_id || null,
        alasan_batal_ganti: receipt.alasan_batal_ganti || null,
        created_by: receipt.created_by || null,
        created_by_name: receipt.created_by_name || null
      })
      .select()
      .single();

    if (error) {
      console.error('Gagal createProjectReceipt:', error);
      return null;
    }
    return data;
  } catch (err) {
    console.error('Error createProjectReceipt:', err);
    return null;
  }
}

/**
 * Naikkan cakupan nota gudang menjadi TERPADU ketika sudah dilunasi lewat Mutasi Dana
 */
export async function upgradeReceiptScopeToTerpadu(receiptId: string): Promise<boolean> {
  if (!isUUID(receiptId)) return false;
  try {
    const client = getSupabaseClient();
    if (!client) return false;
    const { error } = await client
      .from('project_receipts')
      .update({
        receipt_scope: 'TERPADU',
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId);
    if (error) {
      console.warn('Gagal menaikkan receipt_scope ke TERPADU:', error);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Turunkan kembali cakupan nota dari TERPADU menjadi BELANJA_BARANG
 * bila pembayaran kas yang menautkannya dibatalkan (BATAL) dan tidak ada pembayaran aktif lain.
 */
export async function downgradeReceiptScopeToBelanjaBarang(receiptId: string): Promise<boolean> {
  if (!isUUID(receiptId)) return false;
  try {
    const client = getSupabaseClient();
    if (!client) return false;
    const { error } = await client
      .from('project_receipts')
      .update({
        receipt_scope: 'BELANJA_BARANG',
        updated_at: new Date().toISOString(),
      })
      .eq('id', receiptId)
      .eq('receipt_scope', 'TERPADU');
    if (error) {
      console.warn('Gagal menurunkan receipt_scope ke BELANJA_BARANG:', error);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

// Helper untuk cek validitas UUID
const isUUID = (str?: string | null): boolean => {
  if (!str) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
};

/**
 * Metode GANTI Nota:
 * 1. Menerbitkan nota baru pengganti di tabel project_receipts
 * 2. Menandai nota lama sebagai DIGANTI (is_ganti = true) jika tercatat di project_receipts
 * 3. Mengalihkan seluruh mutasi barang & mutasi kas yang tertaut ke nota lama agar otomatis tertaut ke nota baru
 */
export async function supersedeProjectReceipt(
  oldReceiptId: string,
  newReceiptData: Partial<ProjectReceipt>,
  reason: string,
  currentUser?: { id?: string; name?: string },
  targetMutationIds?: string[],
  targetCashMutationIds?: string[]
): Promise<ProjectReceipt | null> {
  try {
    const client = getSupabaseClient();
    if (!client) return null;

    const oldIsUuid = isUUID(oldReceiptId);

    // 1. Buat Nota Baru di tabel project_receipts
    const newReceipt = await createProjectReceipt(
      {
        ...newReceiptData,
        receipt_scope: newReceiptData.receipt_scope || 'BELANJA_BARANG',
        referensi_ganti_id: oldIsUuid ? oldReceiptId : undefined,
        alasan_batal_ganti: reason,
        created_by: currentUser?.id,
        created_by_name: currentUser?.name
      },
      currentUser?.name
    );

    if (!newReceipt) return null;

    // 2. Tandai Nota Lama sebagai DIGANTI jika ID-nya merupakan UUID project_receipts sah
    if (oldIsUuid) {
      await client
        .from('project_receipts')
        .update({
          is_ganti: true,
          status_verifikasi: 'DIGANTI',
          referensi_ganti_id: newReceipt.id,
          alasan_batal_ganti: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', oldReceiptId);

      // Otomatis alihkan seluruh mutasi barang yang tertaut ke oldReceiptId agar tertaut ke newReceipt.id
      await client
        .from('inventory_transactions')
        .update({
          receipt_id: newReceipt.id,
          reference_no: newReceipt.reference_no,
          nama_toko: newReceipt.nama_toko,
          tanggal_nota: newReceipt.tanggal_nota,
          total_nota_fisik: newReceipt.total_nota_fisik,
          lampiran_nota_urls: newReceipt.lampiran_nota_urls,
          status_harga: 'ADA_HARGA'
        })
        .eq('receipt_id', oldReceiptId);

      // Otomatis alihkan seluruh mutasi kas yang tertaut ke oldReceiptId agar tertaut ke newReceipt.id
      await client
        .from('cash_transactions')
        .update({
          receipt_id: newReceipt.id,
          reference_no: newReceipt.reference_no,
          nama_toko: newReceipt.nama_toko,
          toko_kontak: newReceipt.toko_kontak || null,
          tanggal_nota: newReceipt.tanggal_nota,
          total_nota_fisik: newReceipt.total_nota_fisik,
          lampiran_nota_urls: newReceipt.lampiran_nota_urls,
          status_bukti: newReceipt.receipt_scope === 'TERPADU' ? 'REKONSILIASI_NOTA' : 'TERLAMPIR'
        })
        .eq('receipt_id', oldReceiptId);
    }

    // 3. Jika ada mutasi barang target eksplisit (misal data legacy atau mutasi tertentu)
    if (targetMutationIds && targetMutationIds.length > 0) {
      await client
        .from('inventory_transactions')
        .update({
          receipt_id: newReceipt.id,
          reference_no: newReceipt.reference_no,
          nama_toko: newReceipt.nama_toko,
          tanggal_nota: newReceipt.tanggal_nota,
          total_nota_fisik: newReceipt.total_nota_fisik,
          lampiran_nota_urls: newReceipt.lampiran_nota_urls,
          status_harga: 'ADA_HARGA'
        })
        .in('id', targetMutationIds);
    }

    // 4. Jika ada mutasi kas target eksplisit
    if (targetCashMutationIds && targetCashMutationIds.length > 0) {
      await client
        .from('cash_transactions')
        .update({
          receipt_id: newReceipt.id,
          reference_no: newReceipt.reference_no,
          nama_toko: newReceipt.nama_toko,
          toko_kontak: newReceipt.toko_kontak || null,
          tanggal_nota: newReceipt.tanggal_nota,
          total_nota_fisik: newReceipt.total_nota_fisik,
          lampiran_nota_urls: newReceipt.lampiran_nota_urls,
          status_bukti: newReceipt.receipt_scope === 'TERPADU' ? 'REKONSILIASI_NOTA' : 'TERLAMPIR'
        })
        .in('id', targetCashMutationIds);
    }

    return newReceipt;
  } catch (err) {
    console.error('Error supersedeProjectReceipt:', err);
    return null;
  }
}

/**
 * Metode BATAL Nota:
 * 1. Menandai nota sebagai BATAL (is_batal = true, status_verifikasi = 'BATAL') di project_receipts
 * 2. Melepaskan tautan mutasi barang (NOTA_MENYUSUL) & mutasi kas (BUKTI_MENYUSUL)
 */
export async function voidProjectReceipt(
  receiptId: string,
  reason: string,
  _currentUser?: { id?: string; name?: string },
  targetMutationIds?: string[],
  targetCashMutationIds?: string[]
): Promise<boolean> {
  try {
    const client = getSupabaseClient();
    if (!client) return false;

    // 1. Jika receiptId merupakan UUID sah project_receipts, tandai BATAL
    if (isUUID(receiptId)) {
      const { error: voidErr } = await client
        .from('project_receipts')
        .update({
          is_batal: true,
          status_verifikasi: 'BATAL',
          alasan_batal_ganti: reason,
          updated_at: new Date().toISOString()
        })
        .eq('id', receiptId);

      if (voidErr) {
        console.error('Gagal membatalkan nota di project_receipts:', voidErr);
        return false;
      }

      // Lepaskan tautan nota pada mutasi barang yang tertaut ke receipt_id ini
      await client
        .from('inventory_transactions')
        .update({
          receipt_id: null,
          reference_no: null,
          total_nota_fisik: null,
          lampiran_nota_urls: [],
          status_harga: 'NOTA_MENYUSUL'
        })
        .eq('receipt_id', receiptId);

      // Lepaskan tautan kuitansi pada mutasi kas yang tertaut ke receipt_id ini
      await client
        .from('cash_transactions')
        .update({
          receipt_id: null,
          total_nota_fisik: null,
          lampiran_nota_urls: [],
          status_bukti: 'BUKTI_MENYUSUL'
        })
        .eq('receipt_id', receiptId);
    }

    // 2. Lepaskan juga jika ada daftar mutasi barang eksplisit (misal data legacy)
    if (targetMutationIds && targetMutationIds.length > 0) {
      const { error: mutErr } = await client
        .from('inventory_transactions')
        .update({
          receipt_id: null,
          reference_no: null,
          total_nota_fisik: null,
          lampiran_nota_urls: [],
          status_harga: 'NOTA_MENYUSUL'
        })
        .in('id', targetMutationIds);

      if (mutErr) {
        console.error('Gagal melepaskan mutasi target:', mutErr);
        return false;
      }
    }

    // 3. Lepaskan juga daftar mutasi kas eksplisit jika ada
    if (targetCashMutationIds && targetCashMutationIds.length > 0) {
      const { error: cashErr } = await client
        .from('cash_transactions')
        .update({
          receipt_id: null,
          total_nota_fisik: null,
          lampiran_nota_urls: [],
          status_bukti: 'BUKTI_MENYUSUL'
        })
        .in('id', targetCashMutationIds);

      if (cashErr) {
        console.error('Gagal melepaskan mutasi kas target:', cashErr);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.error('Error voidProjectReceipt:', err);
    return false;
  }
}

/**
 * Membangun Album Nota & Kuitansi Fisik Proyek Terpadu
 * (Hybrid: Master Tabel project_receipts + Mutasi Barang + Mutasi Kas)
 */
export function buildProjectReceiptAlbum(
  mutations: MutasiBarang[],
  dbReceipts: ProjectReceipt[] = [],
  cashMutations: MutasiKas[] = [],
  clientName?: string
): ProjectReceiptAlbumItem[] {
  const map = new Map<string, ProjectReceiptAlbumItem>();

  // 1. Masukkan semua nota dari tabel project_receipts sebagai entitas resmi utama
  (dbReceipts || []).forEach((rc) => {
    const key = rc.id;
    map.set(key, {
      id: key,
      receiptId: rc.id,
      receiptNo: rc.reference_no,
      storeName: rc.nama_toko,
      storeContact: rc.toko_kontak,
      receiptDate: rc.tanggal_nota,
      totalPhysicalAmount: Number(rc.total_nota_fisik) || 0,
      attachmentUrls: Array.isArray(rc.lampiran_nota_urls) ? rc.lampiran_nota_urls.filter(Boolean) : [],
      linkedMutationsCount: 0,
      sampleItemNames: [],
      rawMutations: [],
      rawCashMutations: [],
      receiptScope: (rc.receipt_scope as ReceiptScope) || 'BELANJA_BARANG',
      is_batal: rc.is_batal,
      is_ganti: rc.is_ganti,
      referensi_ganti_id: rc.referensi_ganti_id,
      alasan_batal_ganti: rc.alasan_batal_ganti,
      status_verifikasi: rc.status_verifikasi,
      created_at: rc.created_at
    });
  });

  // 2. Petakan mutasi barang ke nota yang bersesuaian
  (mutations || []).forEach((m) => {
    if (m.is_batal && !m.is_ganti) return;

    let targetItem: ProjectReceiptAlbumItem | undefined;

    if (m.receipt_id && map.has(m.receipt_id)) {
      targetItem = map.get(m.receipt_id);
    } else if (!m.receipt_id) {
      const rNo = normalizeReceiptRef(m.nomor_nota || m.nomor_surat_jalan);
      const rawStore = m.nama_toko || m.source_name;
      if (rNo) {
        for (const item of map.values()) {
          if (item.receiptScope === 'KAS_OPERASIONAL') continue;
          if (
            normalizeReceiptRef(item.receiptNo) === rNo &&
            doReceiptStoresMatch(item.storeName, rawStore)
          ) {
            targetItem = item;
            break;
          }
        }
      }
    }

    if (targetItem) {
      targetItem.rawMutations.push(m);
      if (!m.is_ganti) {
        targetItem.linkedMutationsCount += 1;
      }
      if (m.nama_barang && !targetItem.sampleItemNames.includes(m.nama_barang) && targetItem.sampleItemNames.length < 5) {
        targetItem.sampleItemNames.push(m.nama_barang);
      }
      return;
    }

    const rNo = (m.nomor_nota || m.nomor_surat_jalan || '').trim();
    const sName = (m.nama_toko || m.source_name || '').trim();
    const urls = Array.isArray(m.lampiran_nota_urls) ? m.lampiran_nota_urls.filter(Boolean) : [];
    const hasValidDocNo = Boolean(normalizeReceiptRef(rNo));
    const hasAttachments = urls.length > 0;
    const isValidReceipt = hasAttachments || hasValidDocNo;

    if (!isValidReceipt) return;

    const normStoreKey = normalizeReceiptStoreName(sName) || 'toko-umum';
    const legacyKey = `legacy_${normalizeReceiptRef(rNo) || 'tanpa-no'}|${normStoreKey}`;

    if (!map.has(legacyKey)) {
      map.set(legacyKey, {
        id: legacyKey,
        receiptNo: rNo && rNo !== '-' ? rNo : 'Tanpa No. Seri',
        storeName: sName || 'Toko / Suplier Belanja',
        storeContact: m.toko_kontak,
        receiptDate: m.tanggal_nota || m.tanggal,
        totalPhysicalAmount: m.total_nota_fisik || (m.harga_satuan_beli ? m.harga_satuan_beli * m.jumlah : 0),
        attachmentUrls: [...urls],
        linkedMutationsCount: !m.is_ganti ? 1 : 0,
        sampleItemNames: m.nama_barang ? [m.nama_barang] : [],
        rawMutations: [m],
        rawCashMutations: [],
        receiptScope: 'BELANJA_BARANG'
      });
    } else {
      const item = map.get(legacyKey)!;
      item.rawMutations.push(m);
      if (!m.is_ganti) {
        item.linkedMutationsCount += 1;
      }
      if (m.nama_barang && !item.sampleItemNames.includes(m.nama_barang) && item.sampleItemNames.length < 5) {
        item.sampleItemNames.push(m.nama_barang);
      }
      if (m.total_nota_fisik && m.total_nota_fisik > item.totalPhysicalAmount) {
        item.totalPhysicalAmount = m.total_nota_fisik;
      }
      urls.forEach((u) => {
        if (!item.attachmentUrls.includes(u)) {
          item.attachmentUrls.push(u);
        }
      });
    }
  });

  // 3. Petakan mutasi kas ke nota/kuitansi yang bersesuaian (termasuk penggabungan TERPADU berbasis toko)
  (cashMutations || []).forEach((c) => {
    if (c.is_batal || c.status_dokumen === 'BATAL') return;

    const cashReceiptId =
      c.receipt_id || (c.source_module === 'MUTASI_BARANG' ? c.source_entity_id : undefined);

    let targetItem: ProjectReceiptAlbumItem | undefined;
    if (cashReceiptId && map.has(cashReceiptId)) {
      targetItem = map.get(cashReceiptId);
    } else if (!cashReceiptId) {
      const rNo = normalizeReceiptRef(c.nomor_kuitansi || c.nomor_nota || c.source_entity_no);
      const cashStoreNorm = normalizeReceiptStoreName(c.nama_toko);
      if (rNo) {
        for (const item of map.values()) {
          if (normalizeReceiptRef(item.receiptNo) !== rNo) continue;

          const isStockAlbumItem = item.receiptScope !== 'KAS_OPERASIONAL';
          if (isStockAlbumItem) {
            // Hanya kas KELUAR yang dapat melunasi nota belanja gudang
            if (c.jenis !== 'KELUAR') continue;
            // Jangan pernah menautkan kas ke nota yang seluruh item aktifnya adalah Jatah Klien
            const activeStockRows = item.rawMutations.filter(
              (m) => !m.is_batal && !m.is_ganti && m.status_dokumen !== 'BATAL' && m.status_dokumen !== 'DIGANTI'
            );
            if (
              activeStockRows.length > 0 &&
              activeStockRows.every((m) => isClientSuppliedStockMutation(m, clientName))
            ) {
              continue;
            }
            const itemStoreNorm = normalizeReceiptStoreName(item.storeName);
            if (
              !itemStoreNorm &&
              !cashStoreNorm &&
              c.source_module !== 'MUTASI_BARANG' &&
              c.kategori_keperluan !== 'Material' &&
              c.kategori_keperluan !== 'Talangan Klien'
            ) {
              continue;
            }
          }

          if (!doReceiptStoresMatch(item.storeName, c.nama_toko)) {
            continue;
          }
          targetItem = item;
          break;
        }
      }
    }

    if (targetItem) {
      if (!targetItem.rawCashMutations) targetItem.rawCashMutations = [];
      targetItem.rawCashMutations.push(c);
      if (!c.is_ganti && c.status_dokumen !== 'DIGANTI') {
        targetItem.linkedMutationsCount += 1;
        // Jika ada mutasi barang MASUK Kontraktor DAN kas KELUAR aktif pada nota yang sama -> TERPADU
        const hasContractorStock = targetItem.rawMutations.some(
          (m) =>
            m.jenis === 'MASUK' &&
            !m.is_batal &&
            !m.is_ganti &&
            m.status_dokumen !== 'BATAL' &&
            m.status_dokumen !== 'DIGANTI' &&
            !isClientSuppliedStockMutation(m, clientName)
        );
        if (c.jenis === 'KELUAR' && hasContractorStock) {
          targetItem.receiptScope = 'TERPADU';
        }
      }
      if (c.untuk_apa && !targetItem.sampleItemNames.includes(c.untuk_apa) && targetItem.sampleItemNames.length < 5) {
        targetItem.sampleItemNames.push(c.untuk_apa);
      }
      const urls = Array.isArray(c.lampiran_nota_urls) ? c.lampiran_nota_urls.filter(Boolean) : [];
      urls.forEach((u) => {
        if (!targetItem!.attachmentUrls.includes(u)) targetItem!.attachmentUrls.push(u);
      });
      return;
    }

    // Fallback: transaksi kas yang memiliki berkas bukti lampiran namun belum tercatat di project_receipts
    const urls = Array.isArray(c.lampiran_nota_urls) ? c.lampiran_nota_urls.filter(Boolean) : [];
    const rNo = (c.nomor_kuitansi || c.nomor_nota || '').trim();
    if (urls.length === 0) return;

    const cashKey = `cash_rc_${c.id}`;
    map.set(cashKey, {
      id: cashKey,
      receiptNo: rNo && rNo !== '-' ? rNo : `KWT-${c.id.slice(0, 6).toUpperCase()}`,
      storeName: c.nama_toko || `${c.pic || 'Kas'} · ${c.kategori_keperluan}`,
      storeContact: c.toko_kontak,
      receiptDate: c.tanggal_nota || c.tanggal,
      totalPhysicalAmount: c.total_nota_fisik || c.jumlah_rp || 0,
      attachmentUrls: [...urls],
      linkedMutationsCount: !c.is_ganti ? 1 : 0,
      sampleItemNames: c.untuk_apa ? [c.untuk_apa] : [],
      rawMutations: [],
      rawCashMutations: [c],
      receiptScope: 'KAS_OPERASIONAL'
    });
  });

  return Array.from(map.values()).sort((a, b) => {
    const timeA = a.receiptDate ? new Date(a.receiptDate).getTime() : 0;
    const timeB = b.receiptDate ? new Date(b.receiptDate).getTime() : 0;
    return timeB - timeA;
  });
}
