# PANDUAN RESMI: ENGINE DINAMIS MULTI-POV DAN MATRIKS KEPUTUSAN PROYEK CAIR

> **STATUS DOKUMEN: KEPUTUSAN FINAL (SIAP REVIEW & IMPLEMENTASI)**  
> **Rujukan Baku:** [AGENTS.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/AGENTS.md) · [MAtrix Impersona.pdf](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/docs/MAtrix%20Impersona.pdf) · [TATA_KELOLA_KOREKSI_GANTI_DAN_VERIFIKASI_NOTA.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/docs/TATA_KELOLA_KOREKSI_GANTI_DAN_VERIFIKASI_NOTA.md)

Dokumen ini menetapkan **keputusan arsitektur final** untuk membangun **Engine Dinamis Multi-POV** pada aplikasi Proyek Cair. Seluruh definisi kondisi, pemisahan dimensi gudang vs pos BOQ, wewenang peran, kosakata baku, dan kontrak TypeScript di bawah ini telah disesuaikan dengan kode aktual agar tidak ada lagi logika *hardcoded*, kontradiksi antar-layar, ataupun multitafsir saat tahap implementasi.

---

## 1. LANDASAN PRINSIP (ATURAN WAJIB `AGENTS.md`)

1. **Aturan 1 — Bahasa & Ergonomi:** Antarmuka wajib ramah pengguna (*user friendly*), intuitif, memakai 100% bahasa Indonesia yang ringkas, **paling hemat huruf (alfabet)**, bebas ambigu, mendukung tema **Terang (*Light*) & Gelap (*Dark*)**, serta menyediakan **Notifikasi** dan **Badge User**.
2. **Aturan 2 — Kerumitan di Latar Belakang:** Kerumitan multi-POV, multi-penyedia, pembagian porsi *mixed*, dan aturan audit ditangani sepenuhnya oleh engine di latar belakang. Pengguna di layar hanya menerima label status yang jujur dan 1 tindakan paling relevan.
3. **Aturan 3 — Integrasi Penuh & Efek Domino:** Perubahan status dan aksi wajib berasal dari **satu sumber kebenaran (*single source of truth*)** yang langsung tersinkronisasi ke seluruh modul: Tab Stok Gudang, Tab Realisasi Pos BOQ, Master BOQ (`InventoryView`), Dasbor, Sidebar, Dialog Wizard, dan Ekspor PDF.
4. **Aturan 4 — *Smart-Suggestion* Dinamis:** Tampilan status dan tombol aksi dilarang keras di-*hardcode* secara statis; keduanya wajib bereaksi dinamis mengikuti ketersediaan fisik gudang, progres realisasi pos, jenis item (Material vs Jasa), tanggung jawab penyedia, dan sudut pandang pengguna yang sedang aktif.

---

## 2. HASIL AUDIT KODE EXISTING (6 TEMUAN KRITIS YANG DISELESAIKAN)

Hasil audit menyeluruh terhadap kode aktual menemukan **6 celah logika** yang menjadi akar permasalahan:

1. **Temuan 1 — Kontradiksi Kasus *Bowplank* di Tab 2 ([StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx)):**
   * Pada fungsi `renderBoqStatusBadge` (baris 1130–1160), status `'Belum dipenuhi'` otomatis jatuh ke cabang `default` dan dilabeli **`Belum Dipakai`**, padahal material belum pernah tiba di proyek (`Ada: 0`).
   * Pada kolom Aksi Cepat Tab 2 (baris 2890–2915), sistem di-*hardcode* menampilkan tombol merah **`[Pakai]`** untuk semua pos yang belum tuntas, meskipun `stok_saat_ini = 0`.
2. **Temuan 2 — *Bug* Konflasi Dimensi Kedatangan vs Pemakaian di [AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L590-L605):**
   * Logika lama menghitung `sisaBelumTibaPos = Math.max(0, baseTarget - Math.max(masukKePosIni, terpakaiDiPosIni))` dan menyamakan `masukKePosIni >= baseTarget` menjadi `statusPemenuhan = 'Terpenuhi'`.
   * *Dampak Buruk:* Material yang baru masuk ke gudang (belum dipakai sama sekali ke konstruksi) langsung dianggap **Terpenuhi** dan **sisa = 0** di level pos BOQ. Akibatnya, sistem menutup tombol pemakaian sebelum barang dipasang.
3. **Temuan 3 — Celah Pos Jasa / Upah (`is_stock_item === false`):**
   * Proyek memiliki pos jasa/manpower (seperti Divisi IV / Upah) yang **tidak melalui alur masuk gudang** (`stok_saat_ini` selalu `0`).
   * Jika dipaksakan mengikuti aturan material fisik, semua pos jasa akan salah dilabeli `Belum Masuk` dan disuruh klik `[Masuk]`. Pos Jasa membutuhkan jalur *state* terpisah.
4. **Temuan 4 — Celah Multi-Peran & Tombol Mati (*Disabled UI*):**
   * Dari 7 peran operasional di `getRolePermissions()` (`AppContext.tsx` baris 41–58), hanya `Clerk` yang memiliki `canIssue = true`.
   * Lima peran pengawas internal (`Foreman`, `Spv.`, `Dept. Manager`, `KTT/Proj. Manager`, `CEO/Direktur`) sebelumnya disuguhi tombol aksi `disabled` yang terlihat seperti fitur rusak.
5. **Temuan 5 — Material Campuran (*Mixed Provider*) & Selisih Penyedia:**
   * Contoh nyata: *19 mm Wall Angel Grid* (Total 68 ea = 25 ea jatah `CV. MENARA MEGAH` + 43 ea *Free-Issue* `PT INDO MURO KENCANA`). Saat kontraktor sudah memenuhi 25/25, sisa 43 ea merupakan kewajiban Klien.
   * Data selisih `TALANGAN_KONTRAKTOR` / `DIPASOK_KLIEN` dari `summarizeMaterialIncomingDiscrepancy()` ([stockMutationEngine.ts](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/lib/stockMutationEngine.ts#L404-L526)) harus memandu *auto-origin* saat tombol `[Masuk]` diklik agar Clerk tidak salah membukukan beban biaya.
6. **Temuan 6 — Fragmentasi Logika Lintas Komponen:**
   * `StockMutationView.tsx`, `InventoryView.tsx`, `DashboardView.tsx`, `Sidebar.tsx`, dan `pdfGenerator.ts` menghitung badge dan statusnya masing-masing secara terpisah. Jika satu layar diubah, layar lain menjadi tidak sinkron.

---

## 3. PETA LENGKAP MULTI-POV (3 SUMBU KENDALI: MODE × PIHAK × PERAN)

Engine mengevaluasi tampilan berdasarkan 3 sumbu kendali yang saling melengkapi:

### Sumbu 1 — Mode Aplikasi (`AppMode`)
* `PERSONAL`, `PSA` (Platform Super Admin), dan `CSA` (Company Super Admin) beroperasi di konsol tata kelola tenant/user dan tidak masuk ke ledger harian gudang/BOQ.
* Hanya mode **`IMPERSONATE`** yang mengoperasikan modul proyek (**Mutasi Barang** dan **Mutasi Dana**).

### Sumbu 2 — Sudut Pandang Pihak (`PartyPOV`)
1. **`KONTRAKTOR` (CV. MENARA MEGAH):**
   * Memiliki tanggung jawab pengadaan modal kerja material & jasa kontrak serta eksekusi lapangan.
   * **Akses Finansial:** Penuh (harga satuan kontrak, harga beli riil nota toko, total belanja riil, sisa pagu, dan margin efisiensi).
2. **`KLIEN` (PT INDO MURO KENCANA / IMK):**
   * Pemilik proyek yang memantau progres pemasangan fisik dan berkewajiban mengirim material *Free-Issue* (Beban Kontraktor: `Rp 0`).
   * **Proteksi Privasi Finansial (`canViewFinancials = false`):** Harga beli nota, rincian toko/vendor internal kontraktor, saldo kas kontraktor, dan margin keuntungan **disembunyikan otomatis**.

### Sumbu 3 — Matriks 7 Peran Operasional (`ImpersonateRole`)

Berdasarkan [AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L41-L58) dan [MAtrix Impersona.pdf](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/docs/MAtrix%20Impersona.pdf):

| Peran Aktif (`ImpersonateRole`) | Kategori Otoritas (`RoleAuthority`) | Pihak (`PartyPOV`) | Akses Finansial | Aksi Cepat Tabel (Tab 1 & Tab 2) | Wewenang Alur Kerja & Audit (Tab 3 & Tab 4) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **`Clerk`** | `EKSEKUTOR` | `KONTRAKTOR` | Penuh | **Aktif 1-Klik:** `[Masuk]` / `[Pakai]` / `[Catat]` + `🕒` | Terbitkan mutasi (CRU tanpa Hapus), inisiasi `BATAL`/`GANTI`, melengkapi nota toko. |
| **`Foreman`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Pantau Bersih:** Indikator pasif + `🕒` *(tanpa tombol mati)* | **Diperiksa Oleh** (urutan 1 setelah Clerk), instruksi `BATAL`/`GANTI`. |
| **`Spv.`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Pantau Bersih:** Indikator pasif + `🕒` *(tanpa tombol mati)* | **Diperiksa / Disetujui Oleh** (serial), instruksi `BATAL`/`GANTI`. |
| **`Dept. Manager`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Pantau Bersih:** Indikator pasif + `🕒` *(tanpa tombol mati)* | **Disetujui / Mengetahui + TTE QR** (serial), instruksi `BATAL`/`GANTI`. |
| **`KTT/Proj. Manager`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Pantau Bersih:** Indikator pasif + `🕒` *(tanpa tombol mati)* | **Mengetahui + TTE QR** (pengesahan proyek, serial), instruksi `BATAL`/`GANTI`. |
| **`CEO/Direktur`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Pantau Bersih:** Indikator pasif + `🕒` *(tanpa tombol mati)* | **Otorisasi Puncak + TTE QR** (serial), instruksi `BATAL`/`GANTI`. |
| **`Viewer/Pengamat`** | `PENGAMAT_KLIEN` | `KLIEN` | **Tersembunyi** | **Pantau Klien:** Indikator status klien + `🕒` *(tanpa tombol aksi)* | Hanya baca progres fisik & status penyerahan aset *Free-Issue* klien. |

> **KEPUTUSAN FINAL — Aturan Anti-Tombol-Mati & Notifikasi:**
> 1. Untuk peran `PENGAWAS_INTERNAL` dan `PENGAMAT_KLIEN` (`canIssue = false`), kolom **Aksi Cepat** pada Tab 1 dan Tab 2 **tidak merender tombol aksi `disabled`** (redup/mati). Kolom hanya menampilkan teks indikator peran pasif (misal: `Siap`, `Tunggu`, `Tuntas`, atau `Pantau`) beserta tombol riwayat transaksi (`🕒`).
> 2. **Notifikasi Berjalan Paralel, Eksekusi Tetap Serial:** Setiap penerbitan transaksi/dokumen oleh `Clerk` memicu notifikasi paralel ke `Foreman` hingga `CEO/Direktur` agar tim saling mengingatkan, namun tombol persetujuan di Tab 3/Tab 4 wajib urut: **`Diterbitkan` (Clerk) $\rightarrow$ `Diperiksa` (Foreman/Spv) $\rightarrow$ `Disetujui` (Spv/Dept Mgr) $\rightarrow$ `Mengetahui + TTE/QR` (Dept Mgr/KTT-PM/CEO)**.

---

## 4. KLASIFIKASI OBJEK BOQ & TANGGUNG JAWAB PENGADAAN

Setiap baris diklasifikasikan pada 2 dimensi sebelum evaluasi status dilakukan:

### A. Jenis Item Operasional
1. **Material Fisik (`is_stock_item === true`):** Barang yang wajib masuk dan disimpan di gudang fisik proyek sebelum dipakai ke pos pekerjaan (`MASUK` disatukan per material di Tab 1, `KELUAR` dirinci per pos BOQ di Tab 2).
2. **Pos Jasa / Upah Langsung (`is_stock_item === false`):** Jasa borongan/tenaga kerja yang tidak memiliki stok gudang. Tidak pernah melewati tombol `[Masuk]` gudang; realisasi langsung dicatat ke pos pekerjaan terkait (`KELUAR` dengan label tombol **`[Catat]`**).

### B. Penanggung Jawab Pengadaan (`ProviderResponsibility`)
1. **`KONTRAKTOR` (CV. MENARA MEGAH):** Modal dan pengadaan ditanggung kontraktor. Klik `[Masuk]` membuka wizard belanja (`asalBarang = 'KONTRAKTOR'`).
2. **`KLIEN` (Free-Issue PT INDO MURO KENCANA):** Disediakan klien (`Rp 0` beban kontraktor).
   * Pada POV Kontraktor: klik `[Masuk]` otomatis membuka wizard dengan **`asalBarang = 'KLIEN'`, `status_harga = 'JATAH_KLIEN'`, dan harga Rp 0** agar tidak salah tercatat sebagai belanja kas kontraktor.
   * Pada POV Klien: pos yang belum tiba memunculkan label **`Belum Serah`** sebagai pengingat logistik klien.
3. **`CAMPURAN` (*Mixed Provider*):** 1 jenis material fisik dipakai bersama oleh pos tanggungan Kontraktor dan pos tanggungan Klien.
   * **Aturan *Auto-Origin* Cerdas (Menyelesaikan Kasus *Wall Angel Grid*):** Jika jatah Kontraktor sudah lunas (`kontraktorSisaQty <= 0`) namun masih ada sisa jatah Klien (`imkSisaQty > 0`), klik `[Masuk]` di Tab 1 otomatis mengisi asal kedatangan = **`KLIEN`** (`JATAH_KLIEN`, Rp 0). Jika jatah Kontraktor belum lunas, otomatis mengisi asal = **`KONTRAKTOR`**.
4. **`KUSTOM` (Non-BOQ):** Barang tambahan di luar kontrak; mengikuti mutasi masuk/keluar fleksibel dan wajib mencatat peruntukan operasional/permintaan/bonus klien.

---

## 5. PEMISAHAN TEGAS 2 DIMENSI PERHITUNGAN (PERBAIKAN `AppContext.tsx`)

Untuk mengakhiri *bug* konflasi di `AppContext.tsx` baris 590–605, dua dimensi wajib dipisah secara ketat menggunakan konstanta toleransi pecahan desimal `EPS = 0.0001`:

1. **Dimensi A — Pengadaan & Gudang (Tab 1: "Satukan Masuk"):**
   $$\text{stok\_fisik} = \max(0,\; \text{total\_qty\_masuk} - \text{total\_qty\_keluar})$$
   $$\text{sisa\_belum\_tiba\_gudang} = \max(0,\; \text{total\_qty\_boq} - \text{total\_qty\_masuk})$$
   *Catatan Multi-Pos:* Porsi kedatangan per penyedia dihitung melalui `summarizeMaterialIncomingDiscrepancy()`, sedangkan `qty_masuk_total` pada level pos tetap dialokasikan FIFO untuk keperluan analitik kedatangan—namun **tidak pernah menggantikan realisasi pemakaian (`qty_keluar_total`)**.

2. **Dimensi B — Realisasi Pemakaian Pos BOQ (Tab 2: "Bedakan Keluar"):**
   $$\text{qty\_pemenuhan\_sisa} = \max(0,\; \text{qty\_boq} - \text{qty\_keluar\_total})$$
   $$\text{progress\_pemenuhan} = \begin{cases} \min\!\left(\frac{\text{qty\_keluar\_total}}{\text{qty\_boq}} \times 100,\; 100\right), & \text{jika } \text{qty\_boq} > 0 \\ 0, & \text{jika } \text{qty\_boq} \le 0 \end{cases}$$
   **Aturan Baku:** Sebuah pos BOQ baru dinyatakan **`Tuntas`** apabila **`qty_keluar_total >= qty_boq - EPS`** (benar-benar sudah dipakai/terpasang di lapangan), **bukan** sekadar baru tiba di gudang.

---

## 6. *STATE MACHINE* LENGKAP (MATERIAL FISIK & POS JASA)

### Jalur A — Material Fisik (`is_stock_item === true`): 6 State Pasti

| Kode *State* | Kondisi Stok Fisik Gudang (`stok_saat_ini`) | Kondisi Realisasi Keluar Pos (`qty_keluar_total`) | Kondisi Target Pos (`qty_boq`) | Makna Keadaan Lapangan |
| :---: | :---: | :---: | :---: | :--- |
| **`S-1`** | `<= 0` (Kosong) | `<= 0` (Belum dipakai) | Belum tuntas | Material belum ada di gudang dan pos belum dikerjakan. *(Mencakup barang belum pernah masuk sama sekali maupun barang yang pernah masuk untuk pos lain lalu habis sebelum pos ini mulai).* |
| **`S-2`** | `> 0` (Tersedia) | `<= 0` (Belum dipakai) | Belum tuntas | Material tersedia fisik di gudang dan siap diambil mandor untuk mulai pos ini. |
| **`S-3`** | `> 0` (Tersedia) | `> 0` (Sedang jalan) | Belum tuntas (`< target - EPS`) | Pekerjaan pos sedang berjalan dan stok gudang masih ada untuk dilanjutkan. |
| **`S-4`** | `<= 0` (Kosong) | `> 0` (Sedang jalan) | Belum tuntas (`< target - EPS`) | Pekerjaan pos sudah berjalan sebagian, namun stok gudang habis terpakai. Butuh kiriman pasokan baru. |
| **`S-5`** | *Bebas* | $\ge \text{target} - \text{EPS}$ dan $\le \text{target} + \text{EPS}$ | Tuntas 100% | Volume kontrak pos telah terpasang/terpakai 100% sesuai target BOQ. |
| **`S-6`** | *Bebas* | $> \text{target} + \text{EPS}$ | Melebihi target | Realisasi pemakaian di pos melampaui pagu volume kontrak BOQ. |

### Jalur B — Pos Jasa / Upah (`is_stock_item === false`): 4 State Pasti

| Kode *State* | Realisasi Pos (`qty_keluar_total`) | Makna Keadaan Lapangan |
| :---: | :---: | :--- |
| **`J-1`** | `<= 0` | Pekerjaan jasa/upah belum dimulai sama sekali (**`Belum Jalan`**). |
| **`J-2`** | `> 0` dan `< target - EPS` | Pekerjaan jasa/upah sedang dalam pelaksanaan bertahap (**`Proses`**). |
| **`J-3`** | $\ge \text{target} - \text{EPS}$ dan $\le \text{target} + \text{EPS}$ | Pekerjaan jasa/upah telah terlaksana 100% (**`Tuntas`**). |
| **`J-4`** | $> \text{target} + \text{EPS}$ | Realisasi jasa/upah melebihi volume kontrak (**`Lebih`**). |

---

## 7. MATRIKS KEPUTUSAN FINAL (ZERO HARDCODE)

### 7A. Sub-Matriks Tab 1: Stok Gudang (Rekap Material Fisik)

Menjaga prinsip **Tombol Tunggal Cerdas (1 aksi utama paling relevan + ikon riwayat `🕒`)**:

| Kondisi Gudang Material (`pm`) | Status Gudang | Aksi Cepat (`Clerk` / `EKSEKUTOR`) | Auto-Origin Wizard Saat Diklik | Aksi `PENGAWAS_INTERNAL` & `PENGAMAT_KLIEN` |
| :--- | :--- | :--- | :--- | :--- |
| `stok_fisik > 0` | **`Tersedia (X uom)`** | **`[Pakai]`** *(Rose Solid)* + `🕒` | `KELUAR`, pilih material `pm` | Hanya indikator stok + `🕒` *(tanpa tombol mati)* |
| `stok_fisik <= 0` & `total_masuk == 0` | **`Belum Masuk`** *(Klien pada Free-Issue: **`Belum Serah`**)* | **`[Masuk]`** *(Hijau Solid)* + `🕒` | `MASUK`, auto `KLIEN` jika jatah kontraktor `<= 0` & sisa klien `> 0`; selain itu `KONTRAKTOR` | Klien pada Free-Issue: badge **`Belum Serah`** + `🕒`; Pengawas Internal: indikator **`Tunggu`** + `🕒` |
| `stok_fisik <= 0` & `total_masuk > 0` & `sisa_belum_tiba > 0` | **`Habis`** | **`[Masuk]`** *(Hijau Solid)* + `🕒` | Sama seperti aturan auto-origin di atas | Klien pada Free-Issue (`imkSisa > 0`): **`Belum Serah`** + `🕒`; selain itu indikator **`Habis`** + `🕒` |
| `stok_fisik <= 0` & `total_masuk > 0` & `sisa_belum_tiba <= 0` & **semua pos BOQ sudah Tuntas** | **`Tuntas`** *(Gudang 0 & seluruh pos terpasang)* | Badge **`Tuntas`** + `🕒` | — *(Aksi selesai)* | Badge **`Tuntas`** + `🕒` |
| `stok_fisik <= 0` & `total_masuk > 0` & `sisa_belum_tiba <= 0` & **masih ada pos butuh pemakaian** | **`Habis`** *(Anomali/lebih keluar di pos lain)* | **`[Masuk]`** *(Hijau Solid, catat selisih)* + `🕒` | `MASUK`, catatan pengisian ulang selisih | Indikator **`Habis`** + `🕒` |

> **Kebijakan Tambahan Tab 1:** Ketika `stok_fisik > 0` tetapi masih ada kiriman susulan dari supplier (misal: *Atap Spandek* tiba 50 dari 149,6 sht), baris tetap menampilkan **1 tombol tunggal `[Pakai]`** sesuai [AGENTS.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/AGENTS.md) Aturan 4 agar kolom tabel tidak sesak. Penerimaan truk susulan dilakukan melalui tombol utama **`+ Catat Masuk`** di bagian atas halaman.

---

### 7B. Sub-Matriks Tab 2: Realisasi Pos BOQ — Material Fisik (`S-1` s.d. `S-6`)

| *State* | Penyedia Pos | Status & Aksi: `Clerk` (`EKSEKUTOR`) | Status & Aksi: `PENGAWAS_INTERNAL` | Status & Aksi: `PENGAMAT_KLIEN` (`Viewer`) |
| :---: | :--- | :--- | :--- | :--- |
| **`S-1`** | `KONTRAKTOR` | Status: **`Belum Masuk`**<br>Aksi: **`[Masuk]`** *(Hijau)* + `🕒` | Status: **`Belum Masuk`**<br>Aksi: Indikator `Butuh Stok` + `🕒` | Status: **`Belum Masuk`**<br>Aksi: Indikator `Pantau` + `🕒` |
| **`S-1`** | `KLIEN` *(Free-Issue)* | Status: **`Belum Masuk`**<br>Aksi: **`[Masuk]`** *(Hijau, auto-origin `KLIEN`, Rp 0)* + `🕒` | Status: **`Belum Masuk`**<br>Aksi: Indikator `Tunggu Klien` + `🕒` | Status: **`Belum Serah`** *(Pengingat Klien)*<br>Aksi: Indikator `Kirim Barang` + `🕒` |
| **`S-2`** | Semua Penyedia | Status: **`Siap Pakai`**<br>Aksi: **`[Pakai]`** *(Rose)* + `🕒` | Status: **`Siap Pakai`**<br>Aksi: Indikator `Siap` + `🕒` | Status: **`Siap Pakai`**<br>Aksi: Indikator `Pantau` + `🕒` |
| **`S-3`** | Semua Penyedia | Status: **`Proses`**<br>Aksi: **`[Pakai]`** *(Rose)* + `🕒` | Status: **`Proses`**<br>Aksi: Indikator `Berjalan` + `🕒` | Status: **`Proses`**<br>Aksi: Indikator `Pantau` + `🕒` |
| **`S-4`** | `KONTRAKTOR` | Status: **`Habis`**<br>Aksi: **`[Masuk]`** *(Hijau)* + `🕒` | Status: **`Habis`**<br>Aksi: Indikator `Restock` + `🕒` | Status: **`Habis`**<br>Aksi: Indikator `Pantau` + `🕒` |
| **`S-4`** | `KLIEN` *(Free-Issue)* | Status: **`Habis`**<br>Aksi: **`[Masuk]`** *(Hijau, auto-origin `KLIEN`, Rp 0)* + `🕒` | Status: **`Habis`**<br>Aksi: Indikator `Tunggu Klien` + `🕒` | Status: **`Belum Serah`** *(Kirim Sisa)*<br>Aksi: Indikator `Kirim Sisa` + `🕒` |
| **`S-5`** | Semua Penyedia | Status: **`Tuntas`**<br>Aksi: Badge **`Tuntas`** + `🕒` | Status: **`Tuntas`**<br>Aksi: Badge **`Tuntas`** + `🕒` | Status: **`Tuntas`**<br>Aksi: Badge **`Tuntas`** + `🕒` |
| **`S-6`** | Semua Penyedia | Status: **`Lebih`**<br>Aksi: Badge **`Lebih`** + `🕒` | Status: **`Lebih`**<br>Aksi: Badge **`Lebih`** + `🕒` | Status: **`Lebih`**<br>Aksi: Badge **`Lebih`** + `🕒` |

---

### 7C. Sub-Matriks Tab 2: Realisasi Pos BOQ — Pos Jasa / Upah (`J-1` s.d. `J-4`)

| *State* | Status Pos (Semua POV) | Aksi Cepat: `Clerk` (`EKSEKUTOR`) | Aksi: `PENGAWAS_INTERNAL` & `PENGAMAT_KLIEN` |
| :---: | :--- | :--- | :--- |
| **`J-1`** | **`Belum Jalan`** | **`[Catat]`** *(Biru/Indigo Solid, buka wizard `KELUAR` pos jasa)* + `🕒` | Indikator `Belum Mulai` + `🕒` |
| **`J-2`** | **`Proses`** | **`[Catat]`** *(Biru/Indigo Solid, buka wizard `KELUAR` pos jasa)* + `🕒` | Indikator `Berjalan` + `🕒` |
| **`J-3`** | **`Tuntas`** | Badge **`Tuntas`** + `🕒` | Badge **`Tuntas`** + `🕒` |
| **`J-4`** | **`Lebih`** | Badge **`Lebih`** + `🕒` | Badge **`Lebih`** + `🕒` |

---

## 8. KEPUTUSAN FINAL KOSAKATA BAKU, HEMAT ALFABET & TOKEN TEMA (LIGHT / DARK)

Keputusan final ini **menutup permanen seluruh pilihan terbuka** dari pembahasan sebelumnya:

1. **`Belum Masuk` (dipilih atas `Belum Ada`):** Untuk kondisi `S-1` (gudang 0, belum keluar). Lebih tepat dalam bahasa logistik konstruksi karena langsung berpasangan simetris dengan aksi **`[Masuk]`** dan konsisten dengan perubahan label pengguna sebelumnya di Tab 1 (`Belum Masuk` vs `Sudah Masuk`).
2. **`Habis` (dipilih atas `Butuh Pasokan`):** Untuk kondisi `S-4` (gudang habis di tengah pekerjaan berjalan). Hanya 5 huruf—paling ringkas, langsung jelas stok gudangnya habis, dan selaras dengan label **`Habis`** yang sudah dibakukan pengguna di Tab 1 serta Ekspor PDF.
3. **Auto-Preselect Pos BOQ:** Klik **`[Masuk]`** dari Tab 2 langsung mem-preselect material terkait serta membawa informasi pos BOQ asal agar auto-origin penyedia (`KONTRAKTOR` vs `KLIEN`) bekerja otomatis sesuai pos yang diklik.

### Tabel Standarisasi Kosakata & Kelas Tema (Light + Dark)

| Jenis | Label Final | Panjang | Alasan Baku | Token Kelas Tailwind (Light & Dark Kontras Tinggi) |
| :--- | :--- | :---: | :--- | :--- |
| **Status** | **`Belum Masuk`** | 11 | Menggantikan *"Belum Dipakai"* / *"Belum dipenuhi"* | `bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700` |
| **Status** | **`Belum Serah`** | 11 | Khusus POV Klien untuk *Free-Issue* yang wajib dikirim | `bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700` |
| **Status** | **`Belum Jalan`** | 11 | Khusus Pos Jasa/Upah (`J-1`) agar tidak disangka stok gudang | `bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700` |
| **Status** | **`Siap Pakai`** | 10 | Fisik ada di gudang (`Ada: > 0`), siap diambil mandor (`S-2`) | `bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-200 dark:border-cyan-800` |
| **Status** | **`Proses`** | 6 | Menggantikan *"Dalam Proses"* / *"Dalam pemenuhan"* (`S-3`, `J-2`) | `bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800` |
| **Status** | **`Habis`** | 5 | Stok gudang habis terpakai di tengah proses (`S-4`) | `bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700` |
| **Status** | **`Tuntas`** | 6 | Menggantikan *"Terpenuhi"* (`S-5`, `J-3`, selesai 100%) | `bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800` |
| **Status** | **`Lebih`** | 5 | Menggantikan *"Melebihi BOQ"* (`S-6`, `J-4`) | `bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800` |
| **Tombol** | **`[Masuk]`** | 5 | Aksi catat kedatangan barang atau terima *Free-Issue* Klien | `bg-emerald-600 hover:bg-emerald-700 text-white` |
| **Tombol** | **`[Pakai]`** | 5 | Aksi catat pengeluaran fisik dari gudang ke pos pekerjaan | `bg-rose-600 hover:bg-rose-700 text-white` |
| **Tombol** | **`[Catat]`** | 5 | Aksi khusus catat realisasi lapangan Pos Jasa / Upah (`J-1`, `J-2`) | `bg-indigo-600 hover:bg-indigo-700 text-white` |

---

## 9. ARSITEKTUR & KONTRAK TYPESCRIPT (`src/lib/boqExecutionEngine.ts`)

Seluruh aturan matriks wajib dibungkus ke modul murni (*pure function*, bebas efek samping, nol *hardcode* di UI) pada `src/lib/boqExecutionEngine.ts`:

```typescript
import {
  AsalBarang,
  ImpersonateRole,
  ItemBarang,
  MutasiBarang,
  PhysicalMaterialItem,
} from '../types';

export type PartyPOV = 'KONTRAKTOR' | 'KLIEN';
export type RoleAuthority = 'EKSEKUTOR' | 'PENGAWAS_INTERNAL' | 'PENGAMAT_KLIEN';

export interface BoqEvalContext {
  activeRole: ImpersonateRole;
  partyPov: PartyPOV;
  authority: RoleAuthority;
  canIssue: boolean;
  canViewFinancials: boolean;
  contractorName: string;
  clientName: string;
}

export type BoqPosStatusKey =
  | 'BELUM_MASUK'
  | 'BELUM_SERAH'
  | 'BELUM_JALAN'
  | 'SIAP_PAKAI'
  | 'PROSES'
  | 'HABIS'
  | 'TUNTAS'
  | 'LEBIH';

export type BoqActionType = 'MASUK' | 'PAKAI' | 'CATAT_JASA' | 'TUNTAS' | 'LEBIH' | 'NONE';
export type BoqActionVariant = 'emerald' | 'rose' | 'indigo' | 'neutral' | 'purple' | 'passive';

export interface BoqPosEvaluation {
  stateCode: 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'S-5' | 'S-6' | 'J-1' | 'J-2' | 'J-3' | 'J-4';
  statusKey: BoqPosStatusKey;
  statusLabel: string;        // Contoh: "Belum Masuk", "Siap Pakai", "Proses", "Tuntas"
  statusBadgeClass: string;   // Kelas Tailwind Light & Dark lengkap
  statusDescription: string;  // Penjelasan singkat bebas multitafsir sesuai POV

  actionType: BoqActionType;
  actionLabel: string;        // "Masuk" | "Pakai" | "Catat" | "Tuntas" | "Lebih" | teks pasif
  actionVariant: BoqActionVariant;
  actionTooltip: string;      // Konteks saran cerdas untuk pengguna
  showActionButton: boolean;  // true hanya untuk EKSEKUTOR saat butuh aksi
  recommendedOrigin: AsalBarang; // KONTRAKTOR vs KLIEN untuk auto-origin wizard
  isFreeIssue: boolean;
}

export interface WarehouseRowEvaluation {
  statusKey: 'TERSEDIA' | 'BELUM_MASUK' | 'BELUM_SERAH' | 'HABIS' | 'TUNTAS';
  statusLabel: string;
  actionType: 'MASUK' | 'PAKAI' | 'TUNTAS' | 'NONE';
  actionLabel: string;
  actionVariant: BoqActionVariant;
  actionTooltip: string;
  showActionButton: boolean;
  recommendedOrigin: AsalBarang;
  sisaBelumTiba: number;
}

export function resolveEvalContext(
  activeRole: ImpersonateRole,
  canIssue: boolean,
  branding: { contractorName?: string; clientName?: string }
): BoqEvalContext;

export function evaluateBoqPos(
  item: ItemBarang,
  physicalMaterial: PhysicalMaterialItem | undefined,
  stockMutations: MutasiBarang[],
  context: BoqEvalContext
): BoqPosEvaluation;

export function evaluateWarehouseMaterial(
  pm: PhysicalMaterialItem,
  stockMutations: MutasiBarang[],
  context: BoqEvalContext
): WarehouseRowEvaluation;
```

---

## 10. PETA INTEGRASI EFEK DOMINO & STRATEGI PENGUJIAN (ATURAN 3)

Agar implementasi bersifat utuh dan bebas dari efek samping terputus, seluruh 7 berkas berikut wajib terintegrasi serentak saat kode dieksekusi:

1. **`src/lib/boqExecutionEngine.ts` *(Baru)*:** Mengimplementasikan `resolveEvalContext()`, `evaluateBoqPos()`, dan `evaluateWarehouseMaterial()` sesuai Matriks Keputusan Bagian 7 & Kosakata Bagian 8.
2. **`src/lib/boqExecutionEngine.test.ts` *(Baru)*:** Menguji 100% kombinasi matriks (`S-1` s.d. `S-6`, `J-1` s.d. `J-4`, penyedia `KONTRAKTOR` / `KLIEN` / `CAMPURAN`, serta seluruh 7 `ImpersonateRole` termasuk proteksi *Viewer* & auto-origin *Wall Angel Grid*).
3. **[src/context/AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx):**
   * Memperbaiki baris 590–605 agar `qty_pemenuhan_sisa` dan `status_pemenuhan` murni mengukur realisasi pemakaian lapangan (`qty_keluar_total`), bukan konflasi dengan `masukKePosIni`.
   * Memastikan `outOfStockCount` dan `pendingDeliveryCount` selaras dengan kondisi gudang riil agar banner peringatan & badge sidebar bebas alarm palsu.
4. **[src/components/StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx):**
   * Tab 1 menggunakan `evaluateWarehouseMaterial()` (menjaga 1 tombol tunggal cerdas + *auto-origin*).
   * Tab 2 menggunakan `evaluateBoqPos()` untuk `renderBoqStatusBadge` dan tombol aksi cepat (`[Masuk]` / `[Pakai]` / `[Catat]` / `Tuntas`).
   * Filter status di Tab 2 diselaraskan dengan kategori status baru (`Belum Masuk`, `Siap Pakai`, `Proses`, `Habis`, `Tuntas`, `Lebih`), dan fungsi `handleOpenItemMutation` mendukung prefill `asalBarang = 'KLIEN'` (`Rp 0`) untuk pos *Free-Issue*.
5. **[src/components/InventoryView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/InventoryView.tsx):**
   * Mengganti badge dan tombol mutasi cepat *hardcoded* dengan `evaluateBoqPos()` agar Master BOQ & Kontrol Stok identik dengan Mutasi Barang.
6. **[src/components/DashboardView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/DashboardView.tsx) & [src/components/Sidebar.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/Sidebar.tsx):**
   * Menyelaraskan KPI kartu ringkasan BOQ (*Tuntas*, *Proses*, *Belum Masuk*, *Kewajiban Klien*) serta badge notifikasi `Butuh Stok` pada Sidebar agar angkanya 100% klop dengan tabel di Tab 1 dan Tab 2.
7. **[src/lib/pdfGenerator.ts](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/lib/pdfGenerator.ts):**
   * Ekspor PDF Rekap Stok Gudang dan Ekspor PDF Realisasi Pos BOQ memanggil fungsi evaluasi engine yang sama sehingga teks status di dokumen cetak **100% identik dengan tampilan di layar**.

---

*Keputusan arsitektur ini ditetapkan secara resmi sebagai acuan baku untuk tahap penulisan kode dan pengujian otomatis berikutnya.*
