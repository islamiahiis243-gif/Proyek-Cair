# Matriks Status Pos Pekerjaan dan Aksi Cepat BOQ

Dokumen ini mencatat evaluasi kondisi **Existing** dan **Usulan Solusi** terkait penentuan **Status Pos** dan **Tombol Aksi Cepat** pada tab **Realisasi BOQ (`BOQ_MONITOR`)** dalam aplikasi Proyek Cair, mengacu pada prinsip **[AGENTS.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/AGENTS.md)** (User friendly, 100% native Indonesia, hemat alfabet, tidak ambigu, dan *smart-suggestion* dinamis).

---

## 1. Latar Belakang Masalah (Temuan Riil di Lapangan)

Berdasarkan tinjauan pada pekerjaan *Bowplank* (Kode BOQ `I/A/1` s.d. `I/A/6`: Kayu 5/7, Papan 2/20, Paku 2", Paku 3", Benang, Pensil), ditemukan dua kontradiksi logika:

1. **Barang Fisik Belum Ada (`Ada: 0`), tetapi Tombol Menyuruh `[Pakai]`**
   * Di kolom **Ketersediaan Gudang**, tertulis jelas: `Ada: 0 m3` / `Ada: 0 ea`.
   * Di kolom **Aksi Cepat**, tombol menyala merah tegas bertuliskan **`[Pakai]`**.
   * *Masalah:* Secara fisik di lapangan, tukang/mandor tidak mungkin disuruh "memakai" material yang stok fisiknya di gudang masih nol.
2. **Barang Belum Pernah Masuk Proyek, tetapi Status Pos Tertulis `Belum Dipakai`**
   * Di kolom **Status Pos**, terpajang badge abu-abu: `Belum Dipakai`.
   * *Masalah:* Istilah *"Belum Dipakai"* mengesankan barang sudah standby di gudang namun tukang belum mau memakainya. Padahal fakta operasionalnya adalah **barangnya belum pernah masuk sama sekali ke lokasi proyek**.

---

## 2. Kondisi & Matriks Existing (Kode Saat Ini)

### A. Logika Status Pos Saat Ini
Dihitung pada [src/context/AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L590-L605) dan dirender di [src/components/StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx#L1130-L1160):

```typescript
// AppContext.tsx:
if (terpakaiDiPosIni >= baseTarget - EPS && baseTarget > 0) {
  statusPemenuhan = terpakaiDiPosIni > baseTarget + EPS ? 'Melebihi BOQ' : 'Terpenuhi';
} else if (masukKePosIni >= baseTarget - EPS && baseTarget > 0) {
  statusPemenuhan = masukKePosIni > baseTarget + EPS ? 'Melebihi BOQ' : 'Terpenuhi';
} else if (masukKePosIni > 0 || terpakaiDiPosIni > 0) {
  statusPemenuhan = 'Dalam pemenuhan';
} else {
  statusPemenuhan = 'Belum dipenuhi';
}
```

Tampilan badge pada `StockMutationView.tsx`:
* `'Terpenuhi'` $\rightarrow$ Badge **`Terpenuhi`** (Hijau)
* `'Dalam pemenuhan'` $\rightarrow$ Badge **`Dalam Proses`** (Biru)
* `'Melebihi BOQ'` $\rightarrow$ Badge **`Melebihi BOQ`** (Ungu)
* `'Belum dipenuhi'` $\rightarrow$ Masuk blok `default`: Badge **`Belum Dipakai`** (Abu-abu)

> **Kelemahan Existing:** Pengecekan status pos murni membandingkan angka realisasi keluar terhadap target BOQ, **tanpa mengaitkan ketersediaan saldo fisik gudang (`stok_saat_ini`)**.

### B. Logika Tombol Aksi Cepat Saat Ini
Dirender pada [src/components/StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx#L2890-L2915):

```tsx
{item.qty_pemenuhan_sisa <= 0 && item.qty_keluar_total >= item.qty_boq ? (
  <span className="...">Tuntas</span>
) : (
  <button onClick={() => handleOpenItemMutation(item, 'KELUAR')} className="...">
    Pakai
  </button>
)}
```

> **Kelemahan Existing:** Selama pos belum selesai 100%, tombol secara statis selalu menampilkan **`[Pakai]`**, terlepas dari apakah barang fisiknya tersedia di gudang atau nol.

---

## 3. Peta Realitas Lapangan (4 Kuadran Fisik vs Realisasi)

Sebuah pos pekerjaan BOQ di lapangan selalu berada di dalam salah satu kuadran berikut:

| Kuadran | Stok Fisik Gudang (`stok_saat_ini`) | Realisasi Keluar di Pos (`qty_keluar_total`) | Kondisi Riil Lapangan | Tindakan yang Dibutuhkan |
| :---: | :---: | :---: | :--- | :--- |
| **K-1** | `> 0` (Tersedia) | `= 0` (Belum jalan) | Material sudah standby di gudang, pekerjaan pos belum dimulai. | Mandor mengambil barang untuk mulai kerja (**Pakai**). |
| **K-2** | `= 0` (Kosong) | `= 0` (Belum jalan) | Pekerjaan pos belum mulai dan material fisik belum ada di proyek. | Clerk mencatat penerimaan barang datang (**Masuk**). |
| **K-3** | `> 0` (Tersedia) | `> 0` (Sedang jalan) | Pekerjaan pos sedang berjalan, stok gudang masih mencukupi. | Mandor melanjutkan pemakaian material (**Pakai**). |
| **K-4** | `= 0` (Kosong) | `> 0` (Sedang jalan) | Pekerjaan pos belum selesai, tetapi stok gudang sudah habis terpakai. | Perlu kiriman pasokan baru dari supplier (**Masuk**). |
| **K-5** | `—` | $\ge \text{Target BOQ}$ | Pagu material pos pekerjaan ini telah terpenuhi 100%. | Pekerjaan tuntas (**Tuntas**). |

---

## 4. Matriks Usulan Solusi (Smart-Suggestion Dinamis)

Sesuai **Aturan ke-4 AGENTS.md** (*tampilan dinamis sesuai tindakan yang ditawarkan*), berikut usulan matriks baru:

| Kuadran | Ketersediaan Gudang | Realisasi Pos | Status Pos (Baru) | Aksi Cepat (Tombol Cerdas) | Fungsi Aksi Cepat saat Diklik |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **K-1** | `Ada: > 0` | `= 0` | **`Siap Pakai`** *(Badge Biru/Cyan)* | **`[Pakai]`** *(Rose solid)* | Buka wizard pengeluaran material ke pos ini. |
| **K-2** | `Ada: 0` | `= 0` | **`Belum Masuk`** *(Badge Abu)* | **`[Masuk]`** *(Hijau solid)* | Buka wizard penerimaan material untuk pos ini. |
| **K-3** | `Ada: > 0` | `> 0` | **`Proses`** *(Badge Kuning/Amber)* | **`[Pakai]`** *(Rose solid)* | Buka wizard pengeluaran lanjutan ke pos ini. |
| **K-4** | `Ada: 0` | `> 0` | **`Habis`** *(Badge Oranye)* | **`[Masuk]`** *(Hijau solid)* | Buka wizard penerimaan sisa pasokan material. |
| **K-5** | `—` | $\ge \text{Target}$ | **`Tuntas`** *(Badge Emerald)* | Badge **`Tuntas`** | Selesai (Hanya ada tombol riwayat transaksi 🕒). |

---

## 5. Keunggulan Matriks Usulan

1. **Bebas Kontradiksi:** Tidak akan ada lagi kejadian *"gudang nol tapi tombol menyuruh pakai"*.
2. **Bahasa Tepat & Hemat Alfabet:**
   * `Belum Masuk` (11 karakter): Jelas menunjukkan barang belum tiba di proyek.
   * `Siap Pakai` (10 karakter): Menandakan fisik barang sudah ada di gudang dan siap digunakan.
   * `Proses` (6 karakter): Menggantikan *"Dalam pemenuhan"* (15 karakter).
   * `Habis` (5 karakter): Jelas menunjukkan stok gudang terpakai habis di tengah proses.
   * `Tuntas` (6 karakter): Menggantikan *"Terpenuhi"* (9 karakter).
3. **Efisiensi Kerja 1-Klik:** Clerk atau mandor dapat langsung mengklik tombol yang relevan secara instan tanpa perlu bolak-balik antar menu.

---

## 6. Poin Diskusi Lanjutan

1. Apakah Anda lebih memilih label status **`Belum Masuk`** atau **`Belum Ada`** untuk Kuadran K-2?
2. Pada Kuadran K-4 (pekerjaan sedang jalan tapi stok gudang habis), apakah label status **`Habis`** sudah cukup ringkas dan jelas, atau lebih informatif **`Butuh Pasokan`**?
3. Konfirmasi apakah tombol **`[Masuk]`** di Tab 2 langsung mem-preselect pos BOQ tersebut pada wizard penerimaan barang.
