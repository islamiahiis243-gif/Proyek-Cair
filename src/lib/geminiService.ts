/**
 * Layanan Integrasi Real AI (Google Gemini 1.5/2.0 Flash) untuk Proyek Cair
 * Menghubungkan asisten suara, pemahaman bahasa alami (NLP), dan Vision OCR nota fisik
 * dengan fallback tangguh ke mesin heuristik lokal saat luring.
 */

import { AgentContextSnapshot, AgentIntentResult, parseAgentQuery } from './agentEngine';

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const DEFAULT_MODEL = 'gemini-1.5-flash';

let memoryApiKey = '';

/**
 * Mendapatkan API Key Gemini dari penyimpanan lokal pengguna atau environment variable
 */
export function getGeminiApiKey(): string {
  if (memoryApiKey) {
    return memoryApiKey;
  }

  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const userKey = window.localStorage.getItem('pc_gemini_api_key');
      if (userKey && userKey.trim()) {
        return userKey.trim();
      }
    }
  } catch {}

  const env = (import.meta as any)?.env || {};
  return (
    env.VITE_GEMINI_API_KEY ||
    env.GEMINI_API_KEY ||
    (typeof process !== 'undefined' ? process.env?.GEMINI_API_KEY : '') ||
    ''
  ).trim();
}

/**
 * Menyimpan API Key Gemini ke localStorage pengguna
 */
export function setGeminiApiKey(key: string): void {
  memoryApiKey = key ? key.trim() : '';
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (key && key.trim()) {
        window.localStorage.setItem('pc_gemini_api_key', key.trim());
      } else {
        window.localStorage.removeItem('pc_gemini_api_key');
      }
    }
  } catch {}
}

/**
 * Memeriksa apakah integrasi Gemini AI aktif
 */
export function isGeminiAiAvailable(): boolean {
  const key = getGeminiApiKey();
  return Boolean(key && key.length > 20);
}

/**
 * Menguji koneksi ke API Google Gemini
 */
export async function testGeminiConnection(customKey?: string): Promise<{
  success: boolean;
  message: string;
  model?: string;
}> {
  const key = customKey?.trim() || getGeminiApiKey();
  if (!key) {
    return {
      success: false,
      message: 'API Key Google Gemini belum dimasukkan. Masukkan kunci dari Google AI Studio.'
    };
  }

  try {
    const endpoint = `${GEMINI_API_URL}/${DEFAULT_MODEL}:generateContent?key=${key}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: 'Balas hanya satu kata: Terhubung.' }]
          }
        ],
        generationConfig: {
          maxOutputTokens: 10,
          temperature: 0.1
        }
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errJson = await response.json().catch(() => null);
      const errMsg = errJson?.error?.message || `HTTP ${response.status} ${response.statusText}`;
      return {
        success: false,
        message: `Koneksi ditolak oleh Google: ${errMsg}`
      };
    }

    return {
      success: true,
      message: 'Koneksi ke Google Gemini AI berhasil terhubung!',
      model: DEFAULT_MODEL
    };
  } catch (err: any) {
    return {
      success: false,
      message: `Gagal menghubungi server Gemini: ${err.message || 'Timeout/Jaringan terputus'}`
    };
  }
}

/**
 * Mengonversi File menjadi base64 string
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      const base64Data = result.split(',')[1] || result;
      resolve(base64Data);
    };
    reader.onerror = error => reject(error);
  });
}

/**
 * Menganalisis Foto Nota Fisik menggunakan Gemini Vision OCR
 */
export async function analyzeReceiptWithGemini(
  file: File,
  context: AgentContextSnapshot
): Promise<AgentIntentResult> {
  const key = getGeminiApiKey();
  if (!key) {
    // Fallback tanpa API Key: ekstraksi cerdas dari nama berkas atau waktu
    return {
      type: 'STOCK_IN_AND_CASH',
      confidence: 0.6,
      spokenResponse: `Foto nota "${file.name}" telah terlampir. Silakan sebutkan nama toko dan total belanja untuk dibukukan, atau masukkan Google Gemini API Key di Pengaturan agar nota dibaca otomatis.`,
      actionRequired: true,
      proposedActionTitle: `📸 Pemindaian Nota Lapangan: ${file.name}`,
      proposedActionSubtitle: 'Foto nota berhasil disiapkan. Lengkapi nominal atau konfirmasi untuk mencatat.',
      data: {
        storeName: 'Toko Rekanan Lapangan',
        notes: `Nota fisik dari berkas ${file.name}`
      }
    };
  }

  try {
    const base64Data = await fileToBase64(file);
    const mimeType = file.type || 'image/jpeg';

    const itemsSummary = context.items
      .slice(0, 30)
      .map(it => `- ${it.nama_barang} (Satuan: ${it.satuan}, Harga Ref: Rp ${it.harga_satuan.toLocaleString('id-ID')})`)
      .join('\n');

    const promptText = `
Anda adalah sistem Vision AI OCR pemeriksa bukti belanja dan nota fisik material proyek konstruksi "Proyek Cair".
Tugas Anda:
1. Baca teks, logo toko, cap stempel, dan angka dari foto nota fisik ini secara cermat.
2. Identifikasi:
   - Nama Toko/Supplier (misal: "TB Subur Makmur", "Toko Bangunan Jaya").
   - Tanggal nota fisik (format YYYY-MM-DD).
   - Barang material yang dibeli (nama barang, kuantitas, satuan, harga per unit).
   - Total nominal akhir nota fisik (Rp).
   - Skenario pembayaran: apakah lunas tunai/kas proyek ("KAS_PROYEK"), transfer kantor ("KANTOR_PUSAT"), hutang/tempo toko ("TEMPO_TOKO"), atau panjar ("PANJAR_LAPANGAN").
3. Cocokkan barang dengan master BOQ proyek di bawah jika sesuai:
${itemsSummary}

Keluarkan HANYA JSON valid tanpa markdown, dengan format:
{
  "storeName": "Nama Toko",
  "receiptDate": "YYYY-MM-DD",
  "matchedItemId": "id_dari_master_atau_null",
  "matchedItemName": "Nama Material di Nota",
  "quantity": 10,
  "unit": "sak/rit/batang/unit",
  "pricePerUnit": 65000,
  "totalAmount": 650000,
  "paymentScenario": "KAS_PROYEK",
  "summaryNotes": "Deskripsi singkat isi nota"
}
`;

    const endpoint = `${GEMINI_API_URL}/${DEFAULT_MODEL}:generateContent?key=${key}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: promptText },
              {
                inlineData: {
                  mimeType: mimeType,
                  data: base64Data
                }
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Google Gemini Vision API error: HTTP ${response.status}`);
    }

    const resJson = await response.json();
    const candidateText = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error('Tidak ada respon teks dari Vision AI.');
    }

    // Parsing JSON hasil ekstraksi Gemini Vision
    const parsed = JSON.parse(candidateText);
    const store = parsed.storeName || 'Toko Material Lapangan';
    const itemName = parsed.matchedItemName || 'Material Belanja';
    const qty = Number(parsed.quantity) || 1;
    const unit = parsed.unit || 'unit';
    const total = Number(parsed.totalAmount) || 0;
    const scenario = parsed.paymentScenario || 'KAS_PROYEK';

    // Cari ID item BOQ yang paling sesuai jika belum matched
    let matchedId = parsed.matchedItemId;
    if (!matchedId) {
      const found = context.items.find(
        it => it.nama_barang.toLowerCase().includes(itemName.toLowerCase()) ||
              itemName.toLowerCase().includes(it.nama_barang.toLowerCase())
      );
      if (found) matchedId = found.id;
    }

    const spokenMsg = `Vision AI berhasil membaca nota dari ${store} untuk ${qty} ${unit} ${itemName} dengan total Rp ${total.toLocaleString('id-ID')}. Apakah Anda ingin langsung membukukan ke mutasi barang dan kas?`;

    return {
      type: 'STOCK_IN_AND_CASH',
      confidence: 0.95,
      spokenResponse: spokenMsg,
      actionRequired: true,
      proposedActionTitle: `🧾 Hasil Pindai Nota: ${qty} ${unit} ${itemName}`,
      proposedActionSubtitle: `${store} · Total Rp ${total.toLocaleString('id-ID')} · Foto Nota Terverifikasi AI`,
      data: {
        matchedItemId: matchedId,
        matchedItemName: itemName,
        quantity: qty,
        unit: unit,
        pricePerUnit: parsed.pricePerUnit || (total && qty ? Math.round(total / qty) : 0),
        totalAmount: total,
        storeName: store,
        paymentScenario: scenario,
        notes: parsed.summaryNotes || `Hasil scan nota Vision AI dari ${store}`
      }
    };
  } catch (err: any) {
    console.warn('[GeminiVision] Gagal memindai nota via Gemini API:', err);
    // Fallback aman ke ekstraksi nama berkas
    return {
      type: 'STOCK_IN_AND_CASH',
      confidence: 0.7,
      spokenResponse: `Foto nota telah diterima. Saya mencatat lampiran foto. Silakan sebutkan nama toko dan total nominalnya untuk konfirmasi pembukuan.`,
      actionRequired: true,
      proposedActionTitle: `📸 Nota Fisik Terlampir: ${file.name}`,
      proposedActionSubtitle: 'Foto berhasil disimpan. Konfirmasi untuk membukukan mutasi.',
      data: {
        storeName: 'Toko Rekanan',
        notes: `Nota fisik lampiran: ${file.name}`
      }
    };
  }
}

/**
 * Percakapan Alami Cerdas Multi-turn dengan Google Gemini AI
 * Menerjemahkan bahasa manusia santai menjadi tindakan terstruktur sistem Proyek Cair
 */
export async function processWithGemini(
  userQuery: string,
  context: AgentContextSnapshot
): Promise<AgentIntentResult> {
  const key = getGeminiApiKey();

  // Jika tidak ada API Key atau kueri kosong, fallback ke parser lokal
  if (!key) {
    return parseAgentQuery(userQuery, context);
  }

  // Pre-guard keamanan: akun Viewer/Pengamat tidak boleh mengeksekusi mutasi atau melihat finansial
  const isViewer = context.userRole === 'Viewer/Pengamat';
  const cannotViewFin = context.canViewFinancials === false || isViewer;

  const boqSummary = context.items
    .slice(0, 35)
    .map(it => `- [ID: ${it.id}] ${it.nama_barang} (Satuan: ${it.satuan}, Stok: ${it.stok_saat_ini}, Harga: Rp ${it.harga_satuan.toLocaleString('id-ID')})`)
    .join('\n');

  const systemPrompt = `
Anda adalah "Live AI Proyek Cair", asisten cerdas lapangan berbasis percakapan alami untuk sistem manajemen proyek konstruksi.
Karakter Anda:
- Berbahasa 100% native Indonesia yang ramah, ringkas, profesional, dan paham bahasa percakapan lapangan/santai (misal: "semen 5 sak", "ambil pasir 1 rit", "kasbon", "tempo", "transfer kantor", "uang kas sisa berapa", "posisi laba").
- Jangan pernah menggunakan bahasa Inggris untuk istilah operasional.
- Konteks Proyek Aktif:
  * Proyek: ${context.projectName}
  * Pengguna: ${context.userName} (Jabatan: ${context.userRole})
  * Hak Akses Finansial: ${cannotViewFin ? 'Dibatasi (Hanya Lihat Fisik Barang, Dilarang Akses Kas/Laba/Uang)' : 'Terbuka'}
  * Saldo Kas Saat Ini: Rp ${(context.currentCashBalance || 0).toLocaleString('id-ID')}
  * Valuasi Stok Gudang: Rp ${(context.totalStockAssetValue || 0).toLocaleString('id-ID')}
  * Antrean Dokumen Pending Approval: ${context.pendingApprovalCount || 0}
  * Daftar Material Master BOQ Proyek:
${boqSummary}

ATURAN KEAMANAN & PRIVASI:
1. Jika pengguna adalah Viewer/Pengamat atau Hak Akses Finansial Dibatasi:
   - Dilarang membocorkan nominal saldo kas atau laba rugi.
   - Dilarang mengizinkan aksi catat mutasi keluar/masuk (actionRequired = false).
2. Jika pengguna meminta catat transaksi:
   - Cocokkan nama material ke salah satu ID master BOQ di atas.
   - Tentukan skenario pembayaran:
     * KAS_PROYEK (bayar kas tunai lapangan)
     * KANTOR_PUSAT (transfer dari kantor pusat/direksi)
     * TEMPO_TOKO (hutang/tempo/bon toko)
     * PANJAR_LAPANGAN (kasbon/panjar kerja)
3. Hasilkan output HANYA JSON valid tanpa teks lain:
{
  "type": "STOCK_IN_AND_CASH" | "STOCK_OUT" | "CASH_EXPENSE" | "CHECK_STOCK" | "CHECK_CASH_BALANCE" | "CHECK_PROFIT_LOSS" | "CHECK_APPROVAL_QUEUE" | "NAVIGATE" | "CONFIRM_ACTION" | "CANCEL_ACTION" | "CHAT",
  "confidence": 0.95,
  "spokenResponse": "Jawaban lisan ringkas dan bersahabat yang akan disuarakan oleh TTS...",
  "actionRequired": boolean,
  "proposedActionTitle": "Judul kartu aksi jika ada",
  "proposedActionSubtitle": "Subjudul rincian dampak stok/kas",
  "data": {
    "matchedItemId": "id_dari_master_atau_null",
    "matchedItemName": "Nama Barang",
    "quantity": 10,
    "unit": "sak/rit/m3/kg/unit",
    "pricePerUnit": 65000,
    "totalAmount": 650000,
    "storeName": "Nama Toko",
    "paymentScenario": "KAS_PROYEK" | "KANTOR_PUSAT" | "TEMPO_TOKO" | "PANJAR_LAPANGAN",
    "category": "Material" | "Upah / Tukang" | "Alat" | "Operasional" | "Panjar / Kasbon",
    "notes": "Catatan ringkas",
    "targetView": "stock-mutations" | "cashflow" | "procurement" | "reports" | "dashboard"
  }
}
`;

  try {
    const endpoint = `${GEMINI_API_URL}/${DEFAULT_MODEL}:generateContent?key=${key}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: systemPrompt },
              { text: `Pesan pengguna: "${userQuery}"` }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1024,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Gemini Chat API returned ${response.status}`);
    }

    const resJson = await response.json();
    const candidateText = resJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) {
      throw new Error('Jawaban Gemini kosong.');
    }

    const parsed: AgentIntentResult = JSON.parse(candidateText);
    return parsed;
  } catch (err) {
    console.warn('[GeminiAI] Gagal memproses kueri cerdas, beralih ke mesin lokal:', err);
    // Seamless fallback ke mesin parser lokal
    return parseAgentQuery(userQuery, context);
  }
}
