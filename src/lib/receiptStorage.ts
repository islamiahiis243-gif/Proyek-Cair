import { getSupabaseClient } from './supabase';
import { SupplierStore, MutasiBarang, ProjectReceiptAlbumItem } from '../types';

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
 * Membangun Album Nota Fisik Proyek dari riwayat mutasi
 * Mengelompokkan seluruh transaksi berdasarkan identitas nota (Nomor Nota & Nama Toko).
 */
export function buildProjectReceiptAlbum(mutations: MutasiBarang[]): ProjectReceiptAlbumItem[] {
  const map = new Map<string, ProjectReceiptAlbumItem>();

  (mutations || []).forEach((m) => {
    // Lewati mutasi yang batal permanen (kecuali jika diganti)
    if (m.is_batal && !m.is_ganti) return;

    const rNo = (m.nomor_nota || m.nomor_surat_jalan || '').trim();
    const sName = (m.nama_toko || m.source_name || '').trim();
    const urls = Array.isArray(m.lampiran_nota_urls) ? m.lampiran_nota_urls.filter(Boolean) : [];

    // Valid jika memiliki nomor nota resmi ATAU memiliki lampiran berkas ATAU memiliki nama toko suplier
    const isExplicitStore = sName && !sName.toLowerCase().includes('klien') && !sName.toLowerCase().includes('kontraktor');
    const isValidReceipt = (rNo && rNo !== '-' && rNo !== 'null') || urls.length > 0 || isExplicitStore;

    if (!isValidReceipt) return;

    const key = `${rNo.toLowerCase() || 'tanpa-no'}|${sName.toLowerCase() || 'toko-umum'}`;

    if (!map.has(key)) {
      map.set(key, {
        id: key,
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
      const item = map.get(key)!;
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
      if (m.toko_kontak && !item.storeContact) {
        item.storeContact = m.toko_kontak;
      }
      if (m.tanggal_nota && !item.receiptDate) {
        item.receiptDate = m.tanggal_nota;
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
