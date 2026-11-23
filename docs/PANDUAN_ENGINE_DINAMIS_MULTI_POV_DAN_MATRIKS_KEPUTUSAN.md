# PANDUAN RESMI: ENGINE DINAMIS MULTI-POV DAN MATRIKS KEPUTUSAN PROYEK CAIR

Dokumen ini merupakan **panduan tunggal dan rujukan baku mutlak** perancangan **Engine Dinamis Multi-POV** pada aplikasi Proyek Cair. Seluruh definisi, aturan keputusan, status pos, dan aksi cepat di dalam dokumen ini dirumuskan secara tegas, pasti, bebas dari multitafsir, dan mengacu penuh pada pedoman **[AGENTS.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/AGENTS.md)**.

---

## 1. LANDASAN PRINSIP (BERDASARKAN AGENTS.MD)

1. **Aturan 1 (Bahasa & Ergonomi):** Tampilan ramah pengguna (*user friendly*), intuitif, berbahasa 100% native Indonesia yang ringkas, hemat alfabet, dan tidak ambigu.
2. **Aturan 2 (Kerumitan di Latar Belakang):** Kerumitan multi-pihak, multi-kepentingan, dan logika silang sepenuhnya ditangani oleh sistem di latar belakang. Pengguna di depan layar hanya melihat hal yang relevan dan siap pakai.
3. **Aturan 3 (Efek Domino & Integrasi Penuh):** Setiap keputusan logika harus terintegrasi otomatis ke seluruh modul aplikasi (Tabel Stok Gudang, Tabel Pos BOQ, Jurnal Mutasi, Dialog Wizard, dan Ekspor PDF) guna mencegah bolak-balik revisi.
4. **Aturan 4 (Smart-Suggestion Dinamis):** Tampilan tombol aksi tidak boleh statis atau di-*hardcode*, melainkan berubah secara cerdas mengikuti kondisi riil barang fisik dan kebutuhan pos saat itu.

---

## 2. LATAR BELAKANG & TEMUAN KASUS RIIL LAPANGAN

Berdasarkan evaluasi terhadap pekerjaan *Bowplank* (Kode BOQ `I/A/1` s.d. `I/A/6`: Kayu 5/7, Papan 2/20, Paku 2", Paku 3", Benang, Pensil), ditemukan dua kontradiksi logika nyata di sistem sebelumnya:

1. **Barang Fisik Belum Ada (`Ada: 0`), tetapi Tombol Menyuruh `[Pakai]`**
   * Di kolom **Ketersediaan Gudang**, tertulis jelas: `Ada: 0 m3` / `Ada: 0 ea`.
   * Di kolom **Aksi Cepat**, tombol menyala merah tegas bertuliskan **`[Pakai]`**.
   * *Masalah:* Secara fisik di lapangan, tukang/mandor tidak mungkin disuruh "memakai" material yang stok fisiknya di gudang masih nol.
2. **Barang Belum Pernah Masuk Proyek, tetapi Status Pos Tertulis `Belum Dipakai`**
   * Di kolom **Status Pos**, terpajang badge abu-abu: `Belum Dipakai`.
   * *Masalah:* Istilah *"Belum Dipakai"* mengesankan barang sudah standby di gudang namun tukang belum mau memakainya. Padahal fakta operasionalnya adalah **barangnya belum pernah masuk sama sekali ke lokasi proyek**.

---

## 3. ANALISIS KODE EXISTING (TITIK LEMAH HARDCODE)

### A. Logika Status Pos Lama di [src/context/AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L590-L605)
```typescript
if (terpakaiDiPosIni >= baseTarget - EPS && baseTarget > 0) {
  statusPemenuhan = terpakaiDiPosIni > baseTarget + EPS ? 'Melebihi BOQ' : 'Terpenuhi';
} else if (masukKePosIni >= baseTarget - EPS && baseTarget > 0) {
  statusPemenuhan = masukKePosIni > baseTarget + EPS ? 'Melebihi BOQ' : 'Terpenuhi';
} else if (masukKePosIni > 0 || terpakaiDiPosIni > 0) {
  statusPemenuhan = 'Dalam pemenuhan';
} else {
  statusPemenuhan = 'Belum dipenuhi'; // <- Jatuh ke default dan dilabeli "Belum Dipakai"
}
```
*Kelemahan:* Perhitungan status murni membandingkan angka realisasi keluar terhadap target BOQ, **tanpa mengaitkan saldo ketersediaan fisik gudang (`stok_saat_ini`)**.

### B. Logika Tombol Aksi Cepat Lama di [src/components/StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx#L2890-L2915)
```tsx
{item.qty_pemenuhan_sisa <= 0 && item.qty_keluar_total >= item.qty_boq ? (
  <span className="...">Tuntas</span>
) : (
  <button onClick={() => handleOpenItemMutation(item, 'KELUAR')} className="...">
    Pakai
  </button>
)}
```
*Kelemahan:* Tombol di-*hardcode* selalu menampilkan **`[Pakai]`** selama pos belum tuntas 100%, terlepas dari apakah barang fisiknya di gudang masih nol.

---

## 4. INVENTARISASI DOMAIN: PIHAK & SUDUT PANDANG (MULTI-POV)

Aplikasi Proyek Cair beroperasi di bawah 2 entitas utama dengan sudut pandang dan kepentingan operasional yang berbeda:

### A. Pihak Kontraktor Pelaksana: **CV. MENARA MEGAH**
* **Karakteristik Finansial:** Memikul tanggung jawab modal kerja belanja material dan pembayaran upah/jasa sesuai kontrak pelaksanaan.
* **Peran Operasional di Lapangan:**
  1. **Clerk (Pencatat Lapangan):** Eksekutor tunggal penerbit dokumen mutasi barang dan kas. Butuh tombol aksi cepat langsung (*direct 1-click action*): mencatat penerimaan kiriman toko (`Masuk`) atau mencatat barang keluar ke mandor (`Pakai`).
  2. **Foreman / Mandor:** Pelaksana lapangan. Fokus memantau material mana yang sudah siap di gudang untuk segera diambil dan dipasang ke pekerjaan.
  3. **SPV & KTT/Project Manager:** Pengendali lapangan dan kontrak. Memantau volume serapan pos, kepatuhan teknis, dan mencegah pembengkakan (*over-quota*).
  4. **Direktur / Tim Finansial:** Pengendali bisnis. Memantau belanja riil vs anggaran BOQ serta margin efisiensi keuntungan.
* **Akses Data:** Berhak melihat seluruh data internal: harga beli nota, rincian supplier, perbandingan pagu, dan estimasi keuntungan.

### B. Pihak Pemilik Proyek / Klien: **PT INDO MURO KENCANA (IMK)**
* **Karakteristik Finansial:** Pemilik anggaran proyek tambang. Menyerahkan sebagian material tertentu secara cuma-cuma (*Free-Issue*, beban kontraktor Rp 0).
* **Peran Operasional di Lapangan:**
  1. **Viewer / Pengawas Lapangan Klien:** Memantau apakah kewajiban penyerahan barang *free-issue* mereka sudah sampai di proyek, apakah kontraktor sudah memasangnya ke bangunan, dan memantau kemajuan fisik pekerjaan.
* **Akses Data:** 
  * Mengetahui progres fisik pos dan status penerimaan material aset klien.
  * **Proteksi Privasi:** Data rahasia internal kontraktor (harga beli riil nota toko, sisa kas operasional, dan margin efisiensi keuntungan kontraktor) **disembunyikan otomatis**.

---

## 5. INVENTARISASI TANGGUNG JAWAB PENGADAAN (ASAL BARANG)

Setiap pos pekerjaan dan material dikelompokkan secara tegas ke dalam salah satu dari 4 status penyedia:

1. **`KONTRAKTOR` (Beban Penuh CV. MENARA MEGAH):**
   * Material wajib dibeli oleh kontraktor menggunakan anggarannya sendiri.
   * Aksi `Masuk`: Mencatat belanja barang dari supplier ke gudang.
2. **`KLIEN` (Free-Issue PT INDO MURO KENCANA — 45 Pos):**
   * Material disediakan langsung oleh klien (Beban Kontraktor: Rp 0).
   * Aksi `Masuk`: Mencatat **Serah Terima Fisik Barang Hibah Klien**, bukan belanja uang.
   * Bagi klien: Merupakan pengingat pemenuhan kewajiban penyerahan logistik.
3. **`CAMPURAN` (Mixed Provider / 1 Material Fisik untuk Beberapa Pos BOQ):**
   * Contoh riil di proyek ini: *19 mm Wall Angel Grid* (Kebutuhan 68 unit = 25 unit tanggungan Kontraktor + 43 unit tanggungan Klien).
   * Porsi masing-masing pihak dilacak terpisah secara presisi.
4. **`KUSTOM` (Non-BOQ):**
   * Material tambahan operasional atau pekerjaan tambah di luar kontrak resmi.

---

## 6. INVENTARISASI KONDISI FISIK & REALISASI (STATE MACHINE EKSPLOITASI)

Kombinasi antara **Saldo Fisik Gudang (`stok_saat_ini`)** dan **Realisasi Pos (`qty_keluar_total`)** menghasilkan 6 kondisi pasti:

| Kode Kondisi | Saldo Fisik di Gudang (`stok_saat_ini`) | Realisasi Keluar di Pos (`qty_keluar_total`) | Sisa Kebutuhan Pos (`qty_pemenuhan_sisa`) | Definisi Keadaan Lapangan |
| :---: | :---: | :---: | :---: | :--- |
| **S-1** | `= 0` (Kosong) | `= 0` (Nol) | `= Target BOQ` | **Belum Ada Masuk:** Material belum pernah tiba di proyek, pekerjaan pos belum dimulai. |
| **S-2** | `> 0` (Tersedia) | `= 0` (Nol) | `= Target BOQ` | **Siap Pakai:** Material sudah standby di gudang, tetapi mandor belum mulai mengambil untuk pos ini. |
| **S-3** | `> 0` (Tersedia) | `> 0` (Berjalan) | `> 0` (Belum lunas) | **Sedang Berjalan & Stok Ada:** Pekerjaan sedang aktif, fisik di gudang masih ada untuk melanjutkan. |
| **S-4** | `= 0` (Kosong) | `> 0` (Berjalan) | `> 0` (Belum lunas) | **Stok Habis di Tengah Jalan:** Pekerjaan pos belum selesai, tetapi stok gudang sudah tersedot habis. Butuh kiriman pasokan baru. |
| **S-5** | `—` | $\ge \text{Target BOQ}$ | $\le 0$ (Lunas) | **Tuntas Terpasang:** Target volume kontrak untuk pos ini telah 100% terpasang sempurna di lapangan. |
| **S-6** | `—` | $> \text{Target BOQ}$ | $< 0$ (Minus) | **Melebihi BOQ:** Terjadi pemakaian lapangan melebihi volume kontrak yang disetujui. |

---

## 7. MATRIKS KEPUTUSAN TERPADU (LOGIKA ENGINE DINAMIS)

Engine `BoqExecutionEngine` mengevaluasi setiap pos BOQ berdasarkan rumus:
$$\text{Output Evaluasi} = f(\text{Kondisi S-1 s.d. S-6}, \text{Tanggung Jawab Penyedia}, \text{POV Akun Aktif})$$

### TABEL MATRIKS KEPUTUSAN LENGKAP:

```
┌──────────┬─────────────┬───────────────────────────┬───────────────────────────┐
│ KONDISI  │ TANGGUNG    │ POV KONTRAKTOR            │ POV KLIEN                 │
│ FISIK    │ JAWAB       │ (CV. MENARA MEGAH)        │ (PT INDO MURO KENCANA)    │
├──────────┼─────────────┼───────────────────────────┼───────────────────────────┤
│ S-1      │ KONTRAKTOR  │ • Status: Belum Masuk     │ • Status: Belum Masuk     │
│ (Gudang  │             │ • Aksi: [Masuk] (Hijau)   │ • Aksi: — (Hanya Pantau)  │
│ Kosong,  │             │ • Info: Butuh Belanja     │ • Info: Pengadaan Kontrk. │
│ Realis=0)├─────────────┼───────────────────────────┼───────────────────────────┤
│          │ KLIEN       │ • Status: Belum Masuk     │ • Status: Belum Serah     │
│          │ (Free-Issue)│ • Aksi: [Masuk] (Hijau)*  │ • Aksi: — (Pengingat)     │
│          │             │ • Info: Tunggu Klien      │ • Info: Wajib Segera Kirim│
├──────────┼─────────────┼───────────────────────────┼───────────────────────────┤
│ S-2      │ SEMUA       │ • Status: Siap Pakai      │ • Status: Siap Pakai      │
│ (Gudang  │ PENYEDIA    │ • Aksi: [Pakai] (Rose)    │ • Aksi: — (Hanya Pantau)  │
│ Ada,     │             │ • Info: Ambil ke Tukang   │ • Info: Material Standby  │
│ Realis=0)│             │                           │                           │
├──────────┼─────────────┼───────────────────────────┼───────────────────────────┤
│ S-3      │ SEMUA       │ • Status: Proses          │ • Status: Proses          │
│ (Gudang  │ PENYEDIA    │ • Aksi: [Pakai] (Rose)    │ • Aksi: — (Hanya Pantau)  │
│ Ada,     │             │ • Info: Lanjutkan Pasang  │ • Info: Progres Pemasangan│
│ Berjalan)│             │                           │                           │
├──────────┼─────────────┼───────────────────────────┼───────────────────────────┤
│ S-4      │ KONTRAKTOR  │ • Status: Habis           │ • Status: Habis           │
│ (Gudang  │             │ • Aksi: [Masuk] (Hijau)   │ • Aksi: — (Hanya Pantau)  │
│ Kosong,  │             │ • Info: Butuh Pasokan     │ • Info: Menunggu Restock  │
│ Berjalan)├─────────────┼───────────────────────────┼───────────────────────────┤
│          │ KLIEN       │ • Status: Habis           │ • Status: Belum Serah     │
│          │ (Free-Issue)│ • Aksi: [Masuk] (Hijau)*  │ • Aksi: — (Pengingat)     │
│          │             │ • Info: Tunggu Sisa Klien │ • Info: Kirim Sisa Barang │
├──────────┼─────────────┼───────────────────────────┼───────────────────────────┤
│ S-5      │ SEMUA       │ • Status: Tuntas          │ • Status: Tuntas          │
│ (Pos     │ PENYEDIA    │ • Aksi: Badge Tuntas + 🕒 │ • Aksi: Badge Tuntas + 🕒 │
│ Selesai  │             │ • Info: Pekerjaan Selesai │ • Info: Terpasang Sempurna│
│ 100%)    │             │                           │                           │
├──────────┼─────────────┼───────────────────────────┼───────────────────────────┤
│ S-6      │ SEMUA       │ • Status: Lebih           │ • Status: Lebih           │
│ (Melebihi│ PENYEDIA    │ • Aksi: Badge Lebih + 🕒  │ • Aksi: Badge Lebih + 🕒  │
│ BOQ)     │             │ • Info: Melebihi Kuota    │ • Info: Audit Pemakaian   │
└──────────┴─────────────┴───────────────────────────┴───────────────────────────┘
```
*\*Catatan untuk Aksi `[Masuk]` pada barang Klien:* Sistem otomatis membuka modal penerimaan barang bertipe non-belanja (Beban Biaya: `KLIEN`, Nilai Beli: `Rp 0`), sehingga Clerk tidak salah mencatatnya sebagai pengeluaran kas kontraktor.

---

## 8. STANDARISASI KOSAKATA & ATRIBUT TAMPILAN (100% TIDAK AMBIGU)

Untuk memenuhi Aturan ke-1 [AGENTS.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/AGENTS.md) (hemat alfabet dan tidak ambigu):

### A. Label Status Pos:
* **`Belum Masuk`** (11 huruf, Badge Abu-abu): Menggantikan *"Belum Dipakai"*. Dipakai saat barang belum tiba di proyek.
* **`Belum Serah`** (11 huruf, Badge Oranye/Kuning): Khusus POV Klien untuk barang free-issue yang belum diserahkan ke kontraktor.
* **`Siap Pakai`** (10 huruf, Badge Biru Muda): Dipakai saat fisik sudah ada di gudang dan siap digunakan.
* **`Proses`** (6 huruf, Badge Kuning/Amber): Menggantikan *"Dalam pemenuhan"*. Dipakai saat pekerjaan sedang berjalan bertahap.
* **`Habis`** (5 huruf, Badge Oranye Tua): Dipakai saat pekerjaan belum selesai tetapi stok gudang tersedot habis (butuh pasokan lagi).
* **`Tuntas`** (6 huruf, Badge Hijau Emerald): Menggantikan *"Terpenuhi"*. Dipakai saat pagu pos telah 100% selesai.
* **`Lebih`** (5 huruf, Badge Ungu): Menggantikan *"Melebihi BOQ"*. Dipakai saat pemakaian melampaui kuota kontrak.

### B. Tombol Aksi Cepat:
* **`[Masuk]`** (5 huruf, Hijau Solid `bg-emerald-600 text-white`): Langsung membuka form pencatatan penerimaan barang masuk ke gudang.
* **`[Pakai]`** (5 huruf, Merah Rose Solid `bg-rose-600 text-white`): Langsung membuka form pengeluaran barang ke pos pekerjaan lapangan.
* **Badge `Tuntas`** (6 huruf, Abu-abu Netral): Mengunci aksi, hanya menyisakan tombol Riwayat Transaksi (🕒).

---

## 9. ARSITEKTUR IMPLEMENTASI KODE

Untuk memastikan tidak ada logika yang di-*hardcode* di dalam berkas UI:

1. **Modul Engine:** Dibuat pada `src/lib/boqExecutionEngine.ts`.
2. **Karakter Engine:** Berupa fungsi murni (*pure function*):
   ```typescript
   export function evaluateBoqPos(
     item: ItemBarang,
     physicalMaterial: PhysicalMaterialItem | undefined,
     context: {
       activeRole: ImpersonateRole;
       clientName: string;
       contractorName: string;
     }
   ): BoqPosEvaluation;
   ```
3. **Komponen Pengguna:**
   * [StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx) pada Tab 1 dan Tab 2 hanya memanggil `evaluateBoqPos()` dan merender hasilnya.
   * [pdfGenerator.ts](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/lib/pdfGenerator.ts) menggunakan engine yang sama agar hasil cetak PDF 100% identik dengan tampilan layar.

---

## 10. POIN PERTIMBANGAN & DISKUSI LANJUTAN

1. Apakah label status **`Belum Masuk`** atau **`Belum Ada`** yang Anda pilih untuk Kondisi S-1?
2. Pada Kondisi S-4 (pekerjaan jalan tapi stok gudang habis), apakah label status **`Habis`** sudah memuaskan, atau lebih informatif **`Butuh Pasokan`**?
3. Saat tombol **`[Masuk]`** di Tab 2 diklik, dialog penerimaan barang otomatis mem-preselect nama barang dan kode pos pekerjaan BOQ tersebut.

---

*Dokumen ini menjadi acuan mutlak bagi implementasi kode berikutnya.*
