import { getSupabaseClient } from './supabase';
import { SupplierStore, MutasiBarang, ProjectReceiptAlbumItem, ProjectReceipt } from '../types';

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
 * Buat entitas nota resmi baru di project_receipts
 */
export async function createProjectReceipt(receipt: Partial<ProjectReceipt>): Promise<ProjectReceipt | null> {
  try {
    const client = getSupabaseClient();
    if (!client) return null;
    const { data, error } = await client
      .from('project_receipts')
      .insert({
        project_id: receipt.project_id,
        reference_no: receipt.reference_no,
        nama_toko: receipt.nama_toko,
        toko_kontak: receipt.toko_kontak || null,
        tanggal_nota: receipt.tanggal_nota,
        total_nota_fisik: receipt.total_nota_fisik || 0,
        lampiran_nota_urls: receipt.lampiran_nota_urls || [],
        notes: receipt.notes || null,
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
 * Metode GANTI Nota:
 * 1. Menerbitkan nota baru pengganti
 * 2. Menandai nota lama sebagai DIGANTI (is_ganti = true)
 * 3. Mengalihkan seluruh mutasi barang yang tertaut ke nota lama agar otomatis tertaut ke nota baru
 */
export async function supersedeProjectReceipt(
  oldReceiptId: string,
  newReceiptData: Partial<ProjectReceipt>,
  reason: string,
  currentUser?: { id?: string; name?: string }
): Promise<ProjectReceipt | null> {
  try {
    const client = getSupabaseClient();
    if (!client) return null;

    // 1. Buat Nota Baru
    const newReceipt = await createProjectReceipt({
      ...newReceiptData,
      referensi_ganti_id: oldReceiptId,
      alasan_batal_ganti: reason,
      created_by: currentUser?.id,
      created_by_name: currentUser?.name
    });

    if (!newReceipt) return null;

    // 2. Tandai Nota Lama sebagai DIGANTI
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

    // 3. Otomatis alihkan seluruh mutasi barang yang tertaut ke oldReceiptId agar tertaut ke newReceipt.id
    await client
      .from('inventory_transactions')
      .update({
        receipt_id: newReceipt.id,
        reference_no: newReceipt.reference_no,
        nama_toko: newReceipt.nama_toko,
        tanggal_nota: newReceipt.tanggal_nota,
        total_nota_fisik: newReceipt.total_nota_fisik,
        lampiran_nota_urls: newReceipt.lampiran_nota_urls
      })
      .eq('receipt_id', oldReceiptId);

    return newReceipt;
  } catch (err) {
    console.error('Error supersedeProjectReceipt:', err);
    return null;
  }
}

/**
 * Metode BATAL Nota:
 * 1. Menandai nota sebagai BATAL (is_batal = true, status_verifikasi = 'BATAL')
 * 2. Melepaskan tautan mutasi barang kembali ke status NOTA_MENYUSUL (tanpa nota sah)
 */
export async function voidProjectReceipt(
  receiptId: string,
  reason: string,
  _currentUser?: { id?: string; name?: string }
): Promise<boolean> {
  try {
    const client = getSupabaseClient();
    if (!client) return false;

    // 1. Tandai Nota sebagai BATAL
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
      console.error('Gagal membatalkan nota:', voidErr);
      return false;
    }

    // 2. Lepaskan tautan nota pada mutasi barang (kembali menjadi NOTA_MENYUSUL)
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

    return true;
  } catch (err) {
    console.error('Error voidProjectReceipt:', err);
    return false;
  }
}

/**
 * Membangun Album Nota Fisik Proyek (Hybrid: Master Tabel project_receipts + Mutasi Terhubung)
 */
export function buildProjectReceiptAlbum(
  mutations: MutasiBarang[],
  dbReceipts: ProjectReceipt[] = []
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
      is_batal: rc.is_batal,
      is_ganti: rc.is_ganti,
      referensi_ganti_id: rc.referensi_ganti_id,
      alasan_batal_ganti: rc.alasan_batal_ganti,
      status_verifikasi: rc.status_verifikasi,
      created_at: rc.created_at
    });
  });

  // 2. Petakan mutasi barang ke nota yang bersesuaian (berdasarkan receipt_id atau key nomor_nota + nama_toko)
  (mutations || []).forEach((m) => {
    if (m.is_batal && !m.is_ganti) return;

    let targetItem: ProjectReceiptAlbumItem | undefined;

    if (m.receipt_id && map.has(m.receipt_id)) {
      targetItem = map.get(m.receipt_id);
    } else {
      // Cari kecocokan nomor nota & toko jika receipt_id belum terisi
      const rNo = (m.nomor_nota || m.nomor_surat_jalan || '').trim().toLowerCase();
      const sName = (m.nama_toko || m.source_name || '').trim().toLowerCase();
      if (rNo && rNo !== '-' && rNo !== 'null') {
        for (const item of map.values()) {
          if (
            item.receiptNo.trim().toLowerCase() === rNo &&
            (!sName || item.storeName.trim().toLowerCase().includes(sName) || sName.includes(item.storeName.trim().toLowerCase()))
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

    // Fallback: jika ada mutasi ber-nota tapi belum ada di project_receipts
    const rNo = (m.nomor_nota || m.nomor_surat_jalan || '').trim();
    const sName = (m.nama_toko || m.source_name || '').trim();
    const urls = Array.isArray(m.lampiran_nota_urls) ? m.lampiran_nota_urls.filter(Boolean) : [];
    const isExplicitStore = sName && !sName.toLowerCase().includes('klien') && !sName.toLowerCase().includes('kontraktor');
    const isValidReceipt = (rNo && rNo !== '-' && rNo !== 'null') || urls.length > 0 || isExplicitStore;

    if (!isValidReceipt) return;

    const legacyKey = `legacy_${rNo.toLowerCase() || 'tanpa-no'}|${sName.toLowerCase() || 'toko-umum'}`;

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
        rawMutations: [m]
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

  return Array.from(map.values()).sort((a, b) => {
    const timeA = a.receiptDate ? new Date(a.receiptDate).getTime() : 0;
    const timeB = b.receiptDate ? new Date(b.receiptDate).getTime() : 0;
    return timeB - timeA;
  });
}
