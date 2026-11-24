# PANDUAN RESMI: ENGINE DINAMIS MULTI-POV DAN MATRIKS KEPUTUSAN PROYEK CAIR

> **STATUS DOKUMEN: KEPUTUSAN FINAL REVISI 3 (LOGIKA ENGINE MULTI-POV + SPESIFIKASI DESAIN & LAYOUT SMART-BUTTONS)**  
> **Rujukan Baku:** [AGENTS.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/AGENTS.md) · [MAtrix Impersona.pdf](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/docs/MAtrix%20Impersona.pdf) · [TATA_KELOLA_KOREKSI_GANTI_DAN_VERIFIKASI_NOTA.md](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/docs/TATA_KELOLA_KOREKSI_GANTI_DAN_VERIFIKASI_NOTA.md)

Dokumen ini menetapkan **keputusan arsitektur & antarmuka final** untuk membangun **Engine Dinamis Multi-POV** pada aplikasi Proyek Cair. Seluruh definisi kondisi, pemisahan dimensi gudang vs pos BOQ, perlindungan material campuran (*mixed provider*), wewenang 7 peran, desain & tata letak *1 Smart-Button*, kosakata baku 100% bahasa Indonesia, dan kontrak TypeScript di bawah ini telah disesuaikan dengan kode aktual serta diuji terhadap skenario nyata lintas pihak agar tidak ada logika *hardcoded*, kontradiksi antar-layar, ataupun multitafsir saat tahap implementasi.

---

## 1. LANDASAN PRINSIP (ATURAN WAJIB `AGENTS.md`)

1. **Aturan 1 — Bahasa & Ergonomi:** Antarmuka wajib ramah pengguna (*user friendly*), intuitif, memakai **100% bahasa Indonesia** yang ringkas, **paling hemat huruf (alfabet)**, bebas ambigu, mendukung tema **Terang (*Light*) & Gelap (*Dark*)**, serta menyediakan **Notifikasi** dan **Badge User**. Seluruh label UI dilarang mencampur kata Inggris (contoh: istilah tampilan *Free-Issue Klien* dibakukan menjadi **`Jatah Klien`**; istilah *Restock* dilarang dipakai).
2. **Aturan 2 — Kerumitan di Latar Belakang:** Kerumitan multi-POV, multi-penyedia, pembagian porsi campuran, dan aturan audit ditangani sepenuhnya oleh engine di latar belakang. Pengguna di layar hanya menerima label status yang jujur dan tindakan paling relevan dalam 1 klik.
3. **Aturan 3 — Integrasi Penuh & Efek Domino:** Perubahan status dan aksi wajib berasal dari **satu sumber kebenaran (*single source of truth*)** yang langsung tersinkronisasi ke seluruh modul: Tab Stok Gudang, Tab Realisasi Pos BOQ, Master BOQ (`InventoryView`), Dasbor, Sidebar, Dialog Wizard, dan Ekspor PDF.
4. **Aturan 4 — *Smart-Suggestion* Dinamis:** Tampilan status dan tombol aksi dilarang keras di-*hardcode* secara statis; keduanya wajib bereaksi dinamis mengikuti ketersediaan fisik gudang, porsi penyedia pos, progres realisasi, jenis item (Material vs Jasa), serta wewenang dan antrean persetujuan peran yang sedang aktif.

---

## 2. HASIL AUDIT KODE EXISTING (TEMUAN KRITIS YANG DISELESAIKAN)

Hasil audit menyeluruh terhadap kode aktual dan simulasi lintas pihak menemukan **8 celah logika** berikut yang wajib diselesaikan serentak oleh engine baru:

1. **Temuan 1 — Kontradiksi Kasus *Bowplank* di Tab 2 ([StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx)):**
   * Pada fungsi `renderBoqStatusBadge` (baris 1130–1160), status `'Belum dipenuhi'` otomatis jatuh ke cabang `default` dan dilabeli **`Belum Dipakai`**, padahal material belum pernah tiba di proyek (`Ada: 0`).
   * Pada kolom Aksi Cepat Tab 2 (baris 2890–2915), sistem di-*hardcode* menampilkan tombol merah **`[Pakai]`** untuk semua pos yang belum tuntas, meskipun `stok_saat_ini = 0`.
2. **Temuan 2 — *Bug* Konflasi Dimensi Kedatangan vs Pemakaian di [AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L590-L605):**
   * Logika lama menghitung `sisaBelumTibaPos = Math.max(0, baseTarget - Math.max(masukKePosIni, terpakaiDiPosIni))` dan menyamakan `masukKePosIni >= baseTarget` menjadi `statusPemenuhan = 'Terpenuhi'`.
   * *Dampak Buruk:* Material yang baru masuk ke gudang (belum dipakai sama sekali ke konstruksi) langsung dianggap **Terpenuhi** dan **sisa = 0** di level pos BOQ. Akibatnya, sistem menutup tombol pemakaian sebelum barang dipasang.
3. **Temuan 3 — Lubang Material Campuran (*Mixed Provider*) di Tab 2:**
   * Contoh nyata: *19 mm Wall Angel Grid* memiliki Pos `I/E/14` (25 ea jatah `CV. MENARA MEGAH`) dan Pos `I/F/8` (43 ea **`Jatah Klien`** `PT INDO MURO KENCANA`). Saat Kontraktor sudah memasukkan 25 ea (`stok_saat_ini = 25`), sementara Klien masih `0/43`, penggunaan saldo gudang gabungan secara naif membuat Pos `I/F/8` ikut dianggap `Siap Pakai`. Engine wajib mengevaluasi ketersediaan porsi per penyedia pos terkait!
4. **Temuan 4 — Celah Pos Jasa / Upah (`is_stock_item === false`):**
   * Pos jasa/manpower (seperti Divisi IV / Upah) **tidak melalui alur masuk gudang** (`stok_saat_ini` selalu `0`). Jika disamakan dengan material fisik, semua pos jasa akan salah dilabeli `Belum Masuk` dan disuruh klik `[Masuk]`.
5. **Temuan 5 — Celah Multi-Peran, Tombol Mati (*Disabled*), & Redundansi Kolom:**
   * Hanya `Clerk` yang memiliki `canIssue = true` (`AppContext.tsx` baris 41–58). Lima peran pengawas internal (`Foreman` s.d. `CEO/Direktur`) sebelumnya disuguhi tombol mati atau teks pasif yang mengulang kolom status (`Siap`, `Berjalan`, `Pantau`), padahal mereka membutuhkan akses 1-klik ke dokumen mutasi yang menunggu giliran pemeriksaannya (`[ ✓ Periksa ]` / `[ ✓ Setuju ]` / `[ ✓ Sahkan ]`).
6. **Temuan 6 — Hambatan Kerja Clerk Pada Truk Susulan & Ambiguitas Barang Klien:**
   * Saat `stok_fisik > 0` namun masih ada sisa belum tiba di Tab 1 (misal *Atap Spandek* 50/149,6 sht), Clerk tidak boleh dipaksa *scroll* ke atas mencari ulang nama barang.
   * Selain itu, tombol `[Masuk]` untuk barang belanja Kontraktor dan barang `Jatah Klien` (Rp 0) sebelumnya berisiko tampak sama jika warnanya identik hijau.
7. **Temuan 7 — Risiko Ledakan Alarm Palsu `outOfStockCount` ([AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L1349)):**
   * Setelah `qty_pemenuhan_sisa` diperbaiki murni menjadi `qty_boq - qty_keluar_total`, ~154 pos `S-1` yang memang belum dimulai akan memenuhi syarat `qty_pemenuhan_sisa > 0 && stok_saat_ini <= 0`. Tanpa pembatasan ketat hanya untuk **`S-4` (`Habis`)**, Dasbor dan badge Sidebar akan membanjiri pengguna dengan ratusan alarm palsu.
8. **Temuan 8 — Fragmentasi Logika Lintas Komponen:**
   * `StockMutationView.tsx`, `InventoryView.tsx`, `DashboardView.tsx`, `Sidebar.tsx`, dan `pdfGenerator.ts` menghitung status secara terpisah sehingga angka dan badge berisiko tidak sinkron.

---

## 3. PETA LENGKAP MULTI-POV (3 SUMBU KENDALI: MODE × PIHAK × PERAN)

Engine mengevaluasi tampilan berdasarkan 3 sumbu kendali terpisah agar siap mendukung portal login Klien terpisah di masa mendatang tanpa bongkar ulang logika:

### Sumbu 1 — Mode Aplikasi (`AppMode`)
* `PERSONAL`, `PSA` (Platform Super Admin), dan `CSA` (Company Super Admin) beroperasi di konsol tata kelola tenant/user dan tidak masuk ke ledger harian gudang/BOQ.
* Hanya mode **`IMPERSONATE`** yang mengoperasikan modul proyek (**Mutasi Barang** dan **Mutasi Dana**).

### Sumbu 2 — Sudut Pandang Pihak (`PartyPOV`)
`resolveEvalContext()` memisahkan **`partyPov`** dari **`authority`**. Saat ini `Viewer/Pengamat` dipetakan otomatis ke `partyPov = 'KLIEN'`, dan siap menerima parameter `organizationParty` bila kelak ada portal khusus login anggota organisasi Klien:
1. **`KONTRAKTOR` (CV. MENARA MEGAH):**
   * Bertanggung jawab atas pengadaan modal kerja material/jasa kontrak serta pelaksanaan fisik di lapangan.
   * **Akses Finansial:** Penuh (harga satuan kontrak, harga beli riil nota toko, total belanja riil, sisa pagu, dan margin efisiensi).
2. **`KLIEN` (PT INDO MURO KENCANA / IMK):**
   * Pemilik proyek yang memantau progres pemasangan fisik dan berkewajiban mengirim material **`Jatah Klien`** (*Free-Issue*, beban kontraktor `Rp 0`).
   * **Proteksi Privasi Finansial (`canViewFinancials = false`):** Harga beli nota, rincian toko/vendor internal kontraktor, saldo kas kontraktor, dan margin keuntungan **disembunyikan otomatis**.
   * **Filter Adaptif:** Pada Tab 2, saat `partyPov === 'KLIEN'`, pil filter cepat **`Belum Serah (X)`** otomatis ditempatkan di posisi paling depan agar logistik Klien langsung melihat kewajiban barangnya yang belum dikirim.

### Sumbu 3 — Matriks 7 Peran Operasional (`ImpersonateRole`)

Berdasarkan [AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L41-L58) dan [MAtrix Impersona.pdf](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/docs/MAtrix%20Impersona.pdf):

| Peran Aktif (`ImpersonateRole`) | Kategori Otoritas (`RoleAuthority`) | Pihak (`PartyPOV`) | Akses Finansial | Wujud *Smart-Button* Kolom Aksi/Riwayat (Tab 1 & Tab 2) | Wewenang Persetujuan Berjenjang & Audit (Tab 3 & Tab 4) |
| :--- | :--- | :---: | :---: | :--- | :--- |
| **`Clerk`** | `EKSEKUTOR` | `KONTRAKTOR` | Penuh | **Aktif (`S-1..S-4`, `J-1..J-2`):** `[ ↓ Masuk ]` *(Hijau/Ungu)* / `[ ↑ Pakai ]` *(Rose)* / `[ ✓ Catat ]` *(Indigo)* + `[ 🕒 ]`<br>**Saat `Tuntas`/`Lebih`:** **`[ 🕒 Riwayat ]`** *(Netral)* | Terbitkan mutasi (CRU tanpa Hapus), inisiasi `BATAL`/`GANTI`, melengkapi nota toko. |
| **`Foreman`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Ada antrean periksa:** **`[ ✓ Periksa ]`** *(Biru Langit)* + `[ 🕒 ]`<br>**Tidak ada antrean:** **`[ 🕒 Riwayat ]`** *(Netral)* | **Diperiksa Oleh** (tahap 1 setelah Clerk), instruksi `BATAL`/`GANTI`. |
| **`Spv.`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Ada antrean setuju:** **`[ ✓ Setuju ]`** *(Amber)* + `[ 🕒 ]`<br>**Tidak ada antrean:** **`[ 🕒 Riwayat ]`** *(Netral)* | **Diperiksa / Disetujui Oleh** (serial), instruksi `BATAL`/`GANTI`. |
| **`Dept. Manager`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Ada antrean sahkan:** **`[ ✓ Sahkan ]`** *(Teal)* + `[ 🕒 ]`<br>**Tidak ada antrean:** **`[ 🕒 Riwayat ]`** *(Netral)* | **Disetujui / Mengetahui + TTE QR** (serial), instruksi `BATAL`/`GANTI`. |
| **`KTT/Proj. Manager`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Ada antrean sahkan:** **`[ ✓ Sahkan ]`** *(Teal)* + `[ 🕒 ]`<br>**Tidak ada antrean:** **`[ 🕒 Riwayat ]`** *(Netral)* | **Mengetahui + TTE QR** (pengesahan proyek, serial), instruksi `BATAL`/`GANTI`. |
| **`CEO/Direktur`** | `PENGAWAS_INTERNAL` | `KONTRAKTOR` | Penuh | **Ada antrean sahkan:** **`[ ✓ Sahkan ]`** *(Teal)* + `[ 🕒 ]`<br>**Tidak ada antrean:** **`[ 🕒 Riwayat ]`** *(Netral)* | **Otorisasi Puncak + TTE QR** (serial), instruksi `BATAL`/`GANTI`. |
| **`Viewer/Pengamat`** | `PENGAMAT_KLIEN` | `KLIEN` | **Tersembunyi** | **Selalu bersih:** **`[ 🕒 Riwayat ]`** *(Netral; judul kolom otomatis **`Riwayat`**)* | Hanya baca progres fisik & status penyerahan aset `Jatah Klien`. |

> **KEPUTUSAN FINAL — Anti-Tombol-Mati, Anti-Duplikasi & *Smart Approval*:**
> 1. Untuk `PENGAWAS_INTERNAL` dan `PENGAMAT_KLIEN`, kolom **Aksi Cepat / Riwayat** dilarang keras menampilkan tombol `disabled`, teks pasif redundan (`Pantau`, `Siap`, `Berjalan`, `Tunggu`), maupun mengulang badge `Tuntas` / `Lebih`. Ketika tidak ada aksi pengawasan, Smart-Button otomatis bertransformasi menjadi tombol utuh **`[ 🕒 Riwayat ]`**.
> 2. **Notifikasi Paralel, Eksekusi Serial, Aksi 1-Klik:** Penerbitan mutasi oleh `Clerk` mengirim notifikasi paralel ke seluruh pengawas, sedangkan tombol persetujuan berjalan berseri (**`Diterbitkan` [Clerk] $\rightarrow$ `Diperiksa` [Foreman/Spv] $\rightarrow$ `Disetujui` [Spv/Dept Mgr] $\rightarrow$ `Mengetahui + TTE/QR` [Dept Mgr/KTT-PM/CEO]**). Bila pada baris material/pos terdapat transaksi aktif yang **sedang menunggu giliran persetujuan peran yang login**, Smart-Button menampilkan **`[ ✓ Periksa ]`**, **`[ ✓ Setuju ]`**, atau **`[ ✓ Sahkan ]`** (lengkap dengan hitungan bila $>1$, misal `[ ✓ Periksa · 2 ]`) yang melompat langsung ke transaksi terkait di Tab 3.

---

## 4. KLASIFIKASI OBJEK BOQ, PENYEDIA & PERLINDUNGAN MATERIAL CAMPURAN

### A. Jenis Item Operasional
1. **Material Fisik (`is_stock_item === true`):** Wajib masuk gudang sebelum dipakai (`MASUK` disatukan per material di Tab 1, `KELUAR` dirinci per pos BOQ di Tab 2).
2. **Pos Jasa / Upah Langsung (`is_stock_item === false`):** Tidak memiliki stok gudang; realisasi langsung dicatat ke pos terkait (`KELUAR` dengan tombol **`[ ✓ Catat ]`**).

### B. Penanggung Jawab Pengadaan & Perlindungan Material Campuran
1. **`KONTRAKTOR` (CV. MENARA MEGAH):** Dibeli oleh kontraktor. Tombol **`[ ↓ Masuk ]`** berwarna **Hijau Solid** (`asalBarang = 'KONTRAKTOR'`).
2. **`KLIEN` (`Jatah Klien` — PT INDO MURO KENCANA):** Disediakan oleh Klien (*Free-Issue*, beban kontraktor `Rp 0`).
   * Pada POV Kontraktor: tombol **`[ ↓ Masuk ]`** berwarna **Ungu Solid** (*tooltip*: `Terima barang dari Klien (Rp 0)`). Saat diklik, wizard otomatis mengisi **`asalBarang = 'KLIEN'`, `status_harga = 'JATAH_KLIEN'`, dan harga `Rp 0`**.
   * Pada POV Klien: pos/material yang porsi Kliennya belum tiba berstatus **`Belum Serah`** sebagai pengingat kirim barang.
3. **`CAMPURAN` (*Mixed Provider*):** 1 material fisik dipakai bersama oleh pos Kontraktor dan pos Klien (contoh: *19 mm Wall Angel Grid*).
   * **Aturan *Auto-Origin* Tab 1:** Jika `kontraktorSisaQty <= 0` dan `imkSisaQty > 0`, klik `[ ↓ Masuk ]` otomatis memilih asal **`KLIEN`** (tombol berwarna **Ungu Solid**). Selain itu, memilih **`KONTRAKTOR`** (tombol berwarna **Hijau Solid**).
   * **Aturan Perlindungan Porsi Tab 2 (Menutup Celah `Wall Angel Grid`):** Engine wajib mengecek ketersediaan saldo porsi penyedia pos tersebut (`providerAvailableStock`), bukan sekadar saldo gudang gabungan:
     * Untuk **pos Klien** (misal Pos `I/F/8`): dihitung sisa hak fisik dari pasokan Klien (`masukKlien - terpakaiPosKlien`). Jika Klien belum mengirim (`masukKlien === 0`), meski gudang menyimpan `25 ea` milik Kontraktor, status pos `I/F/8` **tetap `Belum Masuk`** (POV Klien: **`Belum Serah`**) dan aksinya adalah **`[ ↓ Masuk ]` (Ungu)**!
     * **Catatan Talangan Sah:** Apabila Clerk memang terpaksa memakai stok Kontraktor di gudang untuk pos Klien melalui menu `+ Catat Keluar`, sistem memperbolehkannya dengan mengisi `providerAlert`: *"Stok gudang berasal dari porsi Kontraktor — pemakaian tercatat sebagai Talangan."* Demikian pula sebaliknya (*Dipasok Klien*).

---

## 5. PEMISAHAN TEGAS 2 DIMENSI & DEFINISI ALARM DARURAT ([AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx))

Mengakhiri *bug* konflasi di `AppContext.tsx` baris 590–605 dan ledakan alarm palsu di baris 1349 menggunakan toleransi `EPS = 0.0001`:

1. **Dimensi A — Pengadaan & Gudang (Tab 1: "Satukan Masuk"):**
   $$\text{stok\_fisik} = \max(0,\; \text{total\_qty\_masuk} - \text{total\_qty\_keluar})$$
   $$\text{sisa\_belum\_tiba\_gudang} = \max(0,\; \text{total\_qty\_boq} - \text{total\_qty\_masuk})$$
2. **Dimensi B — Realisasi Pemakaian Pos BOQ (Tab 2: "Bedakan Keluar"):**
   $$\text{qty\_pemenuhan\_sisa} = \max(0,\; \text{qty\_boq} - \text{qty\_keluar\_total})$$
   $$\text{progress\_pemenuhan} = \begin{cases} \min\!\left(\frac{\text{qty\_keluar\_total}}{\text{qty\_boq}} \times 100,\; 100\right), & \text{jika } \text{qty\_boq} > 0 \\ 0, & \text{jika } \text{qty\_boq} \le 0 \end{cases}$$
   Pos baru dinyatakan **`Tuntas`** apabila **`qty_keluar_total >= qty_boq - EPS`**, bukan karena barang baru tiba di gudang.
3. **Kunci Definisi Alarm Darurat (`outOfStockCount` & Badge Sidebar `Butuh Stok`):**
   * **DILARANG** membunyikan alarm merah/kuning untuk pos `S-1` yang pekerjaannya belum dimulai.
   * `outOfStockCount` (`isCriticalShortage === true`) **HANYA** menghitung pos material fisik dalam kondisi **`S-4` (`Habis`)** — yaitu pos yang **belum tuntas (`qty_pemenuhan_sisa > EPS`), pernah memiliki histori masuk/keluar (`has_stock_history === true`), tetapi saldo fisiknya saat ini habis (`stok_saat_ini <= 0`)**.
   * Kartu ringkasan BOQ di Dasbor wajib membaca hasil `evaluateBoqPos()` agar rincian **`Tuntas · Proses · Siap Pakai · Belum Masuk`** 100% cocok dengan Tab 2.

---

## 6. *STATE MACHINE* LENGKAP (MATERIAL FISIK & POS JASA)

### Jalur A — Material Fisik (`is_stock_item === true`): 6 State Pasti

Untuk pos tunggal/murni, `efektifStok = stok_saat_ini`; sedangkan pada material **`CAMPURAN`**, `efektifStok` memperhitungkan sisa saldo porsi penyedia pos terkait (`providerAvailableStock`) agar pos Klien tidak salah mengambil porsi Kontraktor secara diam-diam:

| Kode *State* | `efektifStok` | Realisasi Keluar Pos (`qty_keluar_total`) | Kondisi Target Pos (`qty_boq`) | Makna Keadaan Lapangan |
| :---: | :---: | :---: | :---: | :--- |
| **`S-1`** | `<= 0` | `<= 0` | Belum tuntas | Porsi penyedia pos ini belum masuk ke gudang dan belum dipakai. |
| **`S-2`** | `> 0` | `<= 0` | Belum tuntas | Material porsi pos tersedia di gudang dan siap diambil mandor. |
| **`S-3`** | `> 0` | `> 0` | Belum tuntas (`< target - EPS`) | Pekerjaan pos sedang berjalan dan stok gudang masih tersedia. |
| **`S-4`** | `<= 0` | `> 0` | Belum tuntas (`< target - EPS`) | Pekerjaan pos sudah berjalan, tetapi stok gudang habis terpakai. Memicu `isCriticalShortage = true`. |
| **`S-5`** | *Bebas* | $\ge \text{target} - \text{EPS}$ & $\le \text{target} + \text{EPS}$ | Tuntas 100% | Volume kontrak pos terpasang/terpakai 100% sesuai target BOQ. |
| **`S-6`** | *Bebas* | $> \text{target} + \text{EPS}$ | Melebihi target | Realisasi pemakaian melampaui volume kontrak BOQ (wajar tercatat sebagai *over-quota* riil). |

### Jalur B — Pos Jasa / Upah (`is_stock_item === false`): 4 State Pasti

| Kode *State* | Realisasi Pos (`qty_keluar_total`) | Makna Keadaan Lapangan |
| :---: | :---: | :--- |
| **`J-1`** | `<= 0` | Pekerjaan jasa/upah belum dimulai sama sekali (**`Belum Jalan`**). |
| **`J-2`** | `> 0` & `< target - EPS` | Pekerjaan jasa/upah sedang berjalan bertahap (**`Proses`**). |
| **`J-3`** | $\ge \text{target} - \text{EPS}$ & $\le \text{target} + \text{EPS}$ | Pekerjaan jasa/upah selesai 100% (**`Tuntas`**). |
| **`J-4`** | $> \text{target} + \text{EPS}$ | Realisasi jasa/upah melebihi target kontrak (**`Lebih`**). |

---

## 7. MATRIKS KEPUTUSAN FINAL (ZERO HARDCODE)

### 7A. Sub-Matriks Tab 1: Stok Gudang (Rekap Material Fisik)

| Kondisi Gudang Material (`pm`) | Status Gudang (`Kontraktor` vs `Klien`) | *Smart-Button* `Clerk` (`EKSEKUTOR`) | *Smart-Button* `PENGAWAS_INTERNAL` | *Smart-Button* `PENGAMAT_KLIEN` |
| :--- | :--- | :--- | :--- | :--- |
| `stok_fisik > 0` | **`Tersedia (X uom)`** | **`[ ↑ Pakai ]`** *(Rose)* + `[ 🕒 ]`<br>*(Kolom `Sisa Belum Tiba > 0` berbentuk micro-chip `[ X + ]` interaktif!)* | Jika ada antrean: **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]`<br>Jika idle: **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |
| `stok_fisik <= 0` & `total_masuk == 0` | **Kontraktor:** **`Belum Masuk`**<br>**Klien (`Jatah Klien`):** **`Belum Serah`** | **`[ ↓ Masuk ]`** *(Hijau jika Kontraktor; **Ungu** jika `Jatah Klien`)* + `[ 🕒 ]` | Jika ada antrean: **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]`<br>Jika idle: **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |
| `stok_fisik <= 0` & `total_masuk > 0` & `sisa_belum_tiba > 0` | **`Habis`** *(Klien jika `imkSisa > 0`: **`Belum Serah`**)* | **`[ ↓ Masuk ]`** *(Hijau jika sisa Kontraktor > 0; **Ungu** jika Kontraktor lunas & sisa Klien > 0)* + `[ 🕒 ]` | Jika ada antrean: **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]`<br>Jika idle: **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |
| `stok_fisik <= 0` & `total_masuk > 0` & `sisa_belum_tiba <= 0` & **semua pos BOQ tuntas** | **`Tuntas`** | **`[ 🕒 Riwayat ]`** *(Netral, bebas duplikasi badge)* | Jika ada dokumen belum sah: **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]`<br>Jika semua sah: **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |
| `stok_fisik <= 0` & `total_masuk > 0` & `sisa_belum_tiba <= 0` & **masih ada pos butuh pemakaian** | **`Habis`** *(Selisih lebih keluar di pos lain)* | **`[ ↓ Masuk ]`** *(Hijau/Ungu)* + `[ 🕒 ]` | Jika ada antrean: **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]`<br>Jika idle: **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |

---

### 7B. Sub-Matriks Tab 2: Realisasi Pos BOQ — Material Fisik (`S-1` s.d. `S-6`)

| *State* | Penyedia Pos | Status & *Smart-Button* `Clerk` (`EKSEKUTOR`) | Status: `PENGAWAS_INTERNAL` | Status: `PENGAMAT_KLIEN` | *Smart-Button* Non-Clerk (`PENGAWAS_INTERNAL` & `KLIEN`) |
| :---: | :--- | :--- | :--- | :--- | :--- |
| **`S-1`** | `KONTRAKTOR` | Status: **`Belum Masuk`**<br>Aksi: **`[ ↓ Masuk ]`** *(Hijau)* + `[ 🕒 ]` | **`Belum Masuk`** | **`Belum Masuk`** | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |
| **`S-1`** | `KLIEN` *(`Jatah Klien`)* | Status: **`Belum Masuk`**<br>Aksi: **`[ ↓ Masuk ]`** *(**Ungu**, auto `KLIEN`, Rp 0)* + `[ 🕒 ]` | **`Belum Masuk`** | **`Belum Serah`** *(Pengingat Klien)* | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |
| **`S-2`** | Semua Penyedia | Status: **`Siap Pakai`**<br>Aksi: **`[ ↑ Pakai ]`** *(Rose)* + `[ 🕒 ]` | **`Siap Pakai`** | **`Siap Pakai`** | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |
| **`S-3`** | Semua Penyedia | Status: **`Proses`**<br>Aksi: **`[ ↑ Pakai ]`** *(Rose)* + `[ 🕒 ]` | **`Proses`** | **`Proses`** | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |
| **`S-4`** | `KONTRAKTOR` | Status: **`Habis`**<br>Aksi: **`[ ↓ Masuk ]`** *(Hijau)* + `[ 🕒 ]` | **`Habis`** | **`Habis`** | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |
| **`S-4`** | `KLIEN` *(`Jatah Klien`)* | Status: **`Habis`**<br>Aksi: **`[ ↓ Masuk ]`** *(**Ungu**, auto `KLIEN`, Rp 0)* + `[ 🕒 ]` | **`Habis`** | **`Belum Serah`** *(Kirim Sisa)* | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |
| **`S-5`** | Semua Penyedia | Status: **`Tuntas`**<br>Aksi: **`[ 🕒 Riwayat ]`** *(Netral)* | **`Tuntas`** | **`Tuntas`** | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada transaksi belum sah; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |
| **`S-6`** | Semua Penyedia | Status: **`Lebih`**<br>Aksi: **`[ 🕒 Riwayat ]`** *(Netral)* | **`Lebih`** | **`Lebih`** | *Pengawas:* **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada transaksi belum sah; selain itu **`[ 🕒 Riwayat ]`**<br>*Klien:* **`[ 🕒 Riwayat ]`** |

> **KEPUTUSAN FINAL — Pencatatan *Over-Quota* Riil pada Pos `S-5` (`Tuntas`):** Perubahan *Smart-Button* menjadi **`[ 🕒 Riwayat ]`** pada baris **`Tuntas`** adalah ***smart suggestion*** untuk mencegah salah klik harian, **bukan blokir keras**. Apabila di lapangan volume pekerjaan riil bertambah (misal karena kondisi tanah aktual) dan tukang benar-benar mengambil material lagi dari gudang untuk pos yang sudah `Tuntas`, Clerk tetap sah mencatat pengeluaran melalui tombol header **`- Catat Keluar`** (memilih pos tersebut dengan konfirmasi alasan penambahan). Pos otomatis berpindah ke **`S-6` (`Lebih`)** agar saldo fisik gudang selalu 100% jujur terhadap stok nyata.

---

### 7C. Sub-Matriks Tab 2: Realisasi Pos BOQ — Pos Jasa / Upah (`J-1` s.d. `J-4`)

| *State* | Status Pos (Semua POV) | *Smart-Button* `Clerk` (`EKSEKUTOR`) | *Smart-Button* `PENGAWAS_INTERNAL` | *Smart-Button* `PENGAMAT_KLIEN` |
| :---: | :--- | :--- | :--- | :--- |
| **`J-1`** | **`Belum Jalan`** | **`[ ✓ Catat ]`** *(Indigo Solid, buka wizard `KELUAR` pos jasa)* + `[ 🕒 ]` | **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |
| **`J-2`** | **`Proses`** | **`[ ✓ Catat ]`** *(Indigo Solid, buka wizard `KELUAR` pos jasa)* + `[ 🕒 ]` | **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada antrean; selain itu **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |
| **`J-3`** | **`Tuntas`** | **`[ 🕒 Riwayat ]`** *(Netral)* | **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada dokumen belum sah; selain itu **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |
| **`J-4`** | **`Lebih`** | **`[ 🕒 Riwayat ]`** *(Netral)* | **`[ ✓ Periksa/Setuju/Sahkan ]`** + `[ 🕒 ]` bila ada dokumen belum sah; selain itu **`[ 🕒 Riwayat ]`** | **`[ 🕒 Riwayat ]`** |

---

## 8. SPESIFIKASI DESAIN, ERGONOMI & LAYOUT *SMART-BUTTONS*

Bagian ini mengunci standar visual dan tata letak UI agar *1 Smart-Button* benar-benar nyaman dipindai mata di tabel padat (174–280 baris), aman disentuh jari di layar HP/tablet proyek, bebas zig-zag, serta kontras tinggi di mode **Terang (*Light*)** dan **Gelap (*Dark*)**:

### A. Prinsip Inti *1 Smart-Button* & Hukum Pemisahan Visual ("Pil = Info, Kotak Solid = Klik")
Kolom **`Aksi Cepat`** hanya memuat **1 tombol utama (*Smart-Button*)** yang label, mikro-ikon (`12px`), warna solid, dan fungsinya berubah otomatis sesuai situasi—**tanpa *dual button* maupun *split button***.

| Elemen UI | Bentuk & Gaya | Kontras Warna | Fungsi |
| :--- | :--- | :--- | :--- |
| **Badge Status** *(Kolom Status)* | **Pil bulat penuh** (`rounded-full`) | Warna lembut (*tinted*) + garis tepi tipis | **Hanya dibaca** (informasi keadaan) |
| **Smart-Button Aksi** *(Kolom Aksi)* | **Kotak membulat** (`rounded-lg`) | Warna penuh (*solid fill*) + teks putih WCAG AA + mikro-ikon `12px` + `active:scale-95` | **Tindakan 1-klik** (aksi utama baris) |
| **Tombol Riwayat Sekunder** | Kotak netral (`w-7 h-7`, `rounded-lg`) | Abu-abu netral | Pintasan audit di kanan saat tombol aksi aktif |
| **Smart-Button Riwayat Utuh** *(Saat `Tuntas`/`Lebih`/Idle)* | **1 tombol netral menyatu** (`rounded-lg`) | Abu-abu netral (`[ 🕒 Riwayat ]`) | Menggantikan slot tombol+ikon secara rapi (tanpa duplikasi `Tuntas` maupun `—`) |

### B. Anatomi *Fixed-Slot Grid* (Anti Zig-Zag di 280 Baris)
* **Lebar Seragam:** Slot utama *Smart-Button* aksi dikunci pada lebar minimum seragam **`min-w-[82px]`** dengan pintasan `[ 🕒 ]` (`w-7 h-7`) di kanannya. Ketika bertransformasi menjadi **`[ 🕒 Riwayat ]`** (pada pos `Tuntas`/`Lebih` atau peran non-Clerk tanpa antrean), tombol tunggal netral memakai **`min-w-[114px]`** (`82 + gap + 28`) agar tepi kiri dan tepi kanan di semua 280 baris selalu lurus vertikal.
* **Tinggi Ergonomis Perangkat:** `h-7` (`28px`) di desktop agar baris tabel tetap padat, dan otomatis melonggar menjadi `min-h-[34px]` di layar sentuh (*mobile/tablet*) guna mencegah salah tekan.
* **Lencana Hitungan Antrean Persetujuan:** Bila pada satu baris material/pos terdapat lebih dari 1 transaksi menunggu giliran persetujuan pengawas, tampilkan angka ringkas pada tombol (misal: **`[ ✓ Periksa · 2 ]`**).
* **Judul Kolom Adaptif POV:** Untuk `Clerk` & Pengawas yang memiliki antrean, judul kolom paling kanan tampil **`Aksi Cepat`**; untuk `Viewer/Pengamat` (Klien), judul kolom otomatis menyusut dan berubah menjadi **`Riwayat`**.

### C. Pintasan 1-Klik Truk Susulan di Tab 1 (*Micro-Chip* Interaktif `Sisa Belum Tiba`)
Saat `stok_fisik > 0` dan masih ada sisa kiriman belum datang (`sisa_belum_tiba > 0`, misal *Atap Spandek* tiba `50` dari `149,6` sht, sisa `99,6`):
* Kolom `Aksi Cepat` **tetap 100% murni 1 Smart-Button: `[ ↑ Pakai ]`** (`bg-rose-600`) + `[ 🕒 ]`.
* Khusus untuk `Clerk`, angka pada kolom **`Sisa Belum Tiba` (`99,6`)** ditampilkan sebagai ***micro-chip* interaktif `[ 99,6 + ]`** dengan garis tepi putus-putus (`border-dashed`):
  * **Hijau putus-putus** (`emerald`) bila sisa kiriman merupakan belanja Kontraktor.
  * **Ungu putus-putus** (`purple`) bila sisa kiriman merupakan **`Jatah Klien`** (`Rp 0`).
* Diklik 1 kali langsung membuka wizard **`Masuk`** dengan material tersebut otomatis terpilih (menghilangkan keharusan *scroll* ke atas mencari ulang dari 174 material), dan tetap tampak jelas dapat diklik di Desktop maupun HP/Tablet. Untuk peran non-Clerk, kolom `Sisa Belum Tiba` tetap berupa teks angka biasa.

### D. Layout Kolom `Ketersediaan Gudang` untuk Material Campuran di Tab 2
Menutup celah kebingungan pada material campuran seperti *19 mm Wall Angel Grid* (Kontraktor `25/25`, Klien `0/43`):
* **Pos `I/E/14` (Porsi Kontraktor):** Menampilkan `Ada: 25 ea siap pakai` $\rightarrow$ Status **`Siap Pakai`** $\rightarrow$ Tombol **`[ ↑ Pakai ]`** (Rose).
* **Pos `I/F/8` (Porsi `Jatah Klien`):** Menampilkan baris utama **`Porsi Klien: 0 ea`** + sub-teks redup `(Stok Kontraktor: 25 ea)` $\rightarrow$ Status **`Belum Masuk`** (Klien: **`Belum Serah`**) $\rightarrow$ Tombol **`[ ↓ Masuk ]`** (**Ungu**, Rp 0).

### E. Layout *Smart-Header* Halaman `Mutasi Barang` (Anti Tombol Mati di Header)
Area kanan *header* halaman di [StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx#L1848-L1867) juga bertransformasi dinamis mengikuti peran aktif (menggantikan tombol `+ Catat Masuk` / `- Catat Keluar` yang sebelumnya redup/mati bagi non-Clerk):
* **`Clerk` (`EKSEKUTOR`):** Menampilkan tombol penuh `[ ↓ + Catat Masuk ]` dan `[ ↑ - Catat Keluar ]`.
* **`PENGAWAS_INTERNAL` (`Foreman`..`CEO`):** Menyembunyikan tombol Masuk/Keluar, dan menggantinya dengan tombol pintas antrean persetujuan **`[ 🔔 X Transaksi Menunggu Periksa/Setuju/Sahkan → ]`** (beralih ke Tab 3 terfilter giliran perannya) atau lencana hijau **`[ ✓ Semua Mutasi Terverifikasi ]`** bila antrean 0.
* **`PENGAMAT_KLIEN` (`Viewer`):** Menyembunyikan tombol Masuk/Keluar, dan menggantinya dengan tombol pintas **`[ 📦 X Jatah Klien Belum Serah → ]`** (1-klik filter Tab 2 ke kewajiban Klien yang belum tiba).

---

## 9. KEPUTUSAN FINAL KOSAKATA BAKU, HEMAT ALFABET & TOKEN TEMA (LIGHT / DARK)

Keputusan berikut **bersifat final (menutup seluruh opsi terbuka sebelumnya)**:
1. **`Belum Masuk`:** Baku untuk kondisi `S-1` (berpasangan simetris dengan `[ ↓ Masuk ]` dan pil filter `Belum Masuk` / `Sudah Masuk`).
2. **`Habis`:** Baku untuk kondisi `S-4` (hanya 5 huruf, selaras dengan label status gudang di Tab 1 dan PDF).
3. **`Jatah Klien`:** Baku untuk seluruh label antarmuka yang sebelumnya memakai frasa Inggris `Free-Issue Klien`.
4. **Pemisahan Warna Tombol `[ ↓ Masuk ]`:** Hijau untuk belanja Kontraktor, **Ungu** untuk penerimaan **`Jatah Klien`** (`Rp 0`).
5. **Tombol Persetujuan Pengawas 1-Klik:** **`[ ✓ Periksa ]`** (`Foreman`), **`[ ✓ Setuju ]`** (`Spv.`), **`[ ✓ Sahkan ]`** (`Dept. Mgr`, `KTT/PM`, `CEO`).
6. **Transformasi Tombol Riwayat Utuh:** **`[ 🕒 Riwayat ]`** menggantikan pengulangan badge `Tuntas` / `Lebih` / strip `—` di kolom Aksi.

### Tabel Standarisasi Kosakata, Mikro-Ikon & Kelas Tema (Light + Dark)

| Jenis | Label & Mikro-Ikon (`12px`) | Panjang | Alasan Baku | Token Kelas Tailwind (Light & Dark Kontras Tinggi WCAG AA) |
| :--- | :--- | :---: | :--- | :--- |
| **Status** | **`Belum Masuk`** | 11 | Menggantikan *"Belum Dipakai"* / *"Belum dipenuhi"* | `bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700` |
| **Status** | **`Belum Serah`** | 11 | Khusus POV Klien untuk `Jatah Klien` yang wajib dikirim | `bg-purple-100 text-purple-800 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-700` |
| **Status** | **`Belum Jalan`** | 11 | Khusus Pos Jasa/Upah (`J-1`) agar tidak disangka stok gudang | `bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700` |
| **Status** | **`Siap Pakai`** | 10 | Fisik porsi pos tersedia (`Ada: > 0`), siap diambil (`S-2`) | `bg-cyan-50 text-cyan-800 border-cyan-200 dark:bg-cyan-950/50 dark:text-cyan-200 dark:border-cyan-800` |
| **Status** | **`Proses`** | 6 | Menggantikan *"Dalam Proses"* / *"Dalam pemenuhan"* (`S-3`, `J-2`) | `bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-200 dark:border-amber-800` |
| **Status** | **`Habis`** | 5 | Stok gudang habis terpakai di tengah proses (`S-4`) | `bg-orange-100 text-orange-800 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-700` |
| **Status** | **`Tuntas`** | 6 | Menggantikan *"Terpenuhi"* (`S-5`, `J-3`, selesai 100%) | `bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-200 dark:border-emerald-800` |
| **Status** | **`Lebih`** | 5 | Menggantikan *"Melebihi BOQ"* (`S-6`, `J-4`) | `bg-purple-50 text-purple-800 border-purple-200 dark:bg-purple-950/50 dark:text-purple-200 dark:border-purple-800` |
| **Tombol** | **`Masuk`** + `ArrowDownLeft` *(Kontraktor)* | 5 | Aksi catat kedatangan barang belanja Kontraktor | `bg-emerald-600 hover:bg-emerald-700 text-white active:scale-95` |
| **Tombol** | **`Masuk`** + `ArrowDownLeft` *(`Jatah Klien`)* | 5 | Aksi catat serah terima barang dari Klien (`Rp 0`) | `bg-purple-600 hover:bg-purple-700 text-white active:scale-95` |
| **Tombol** | **`Pakai`** + `ArrowUpRight` | 5 | Aksi catat pengeluaran fisik dari gudang ke pos pekerjaan | `bg-rose-600 hover:bg-rose-700 text-white active:scale-95` |
| **Tombol** | **`Catat`** + `ClipboardCheck` | 5 | Aksi catat realisasi lapangan Pos Jasa / Upah (`J-1`, `J-2`) | `bg-indigo-600 hover:bg-indigo-700 text-white active:scale-95` |
| **Tombol** | **`Periksa`** + `CheckCircle2` | 7 | Aksi 1-klik `Foreman` saat ada antrean persetujuan baris ini | `bg-sky-600 hover:bg-sky-700 text-white active:scale-95` |
| **Tombol** | **`Setuju`** + `CheckCircle2` | 6 | Aksi 1-klik `Spv.` saat ada antrean persetujuan baris ini *(WCAG AA)* | `bg-amber-600 hover:bg-amber-700 text-white active:scale-95` |
| **Tombol** | **`Sahkan`** + `CheckCircle2` | 6 | Aksi 1-klik `Dept. Mgr` / `KTT-PM` / `CEO` untuk TTE QR | `bg-teal-600 hover:bg-teal-700 text-white active:scale-95` |
| **Tombol** | **`Riwayat`** + `History` | 7 | Transformasi tunggal saat `Tuntas` / `Lebih` / Idle non-Clerk | `bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 active:scale-95` |
| **Chip** | **`[ X + ]`** *(Tab 1 Kontraktor)* | — | Pintasan 1-klik truk susulan di kolom `Sisa Belum Tiba` | `border border-dashed border-emerald-500/70 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-900/60` |
| **Chip** | **`[ X + ]`** *(Tab 1 `Jatah Klien`)* | — | Pintasan 1-klik sisa kirim Klien di kolom `Sisa Belum Tiba` | `border border-dashed border-purple-500/70 bg-purple-50/70 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300 dark:hover:bg-purple-900/60` |

---

## 10. ARSITEKTUR & KONTRAK TYPESCRIPT (`src/lib/boqExecutionEngine.ts`)

Seluruh aturan matriks dan tampilan *1 Smart-Button* dibungkus ke fungsi murni (*pure function*, tanpa efek samping, nol *hardcode* di UI) pada `src/lib/boqExecutionEngine.ts`:

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
export type PendingApprovalAction = 'PERIKSA' | 'SETUJU' | 'SAHKAN';

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

export type BoqActionType =
  | 'MASUK'
  | 'PAKAI'
  | 'CATAT_JASA'
  | 'APPROVE'
  | 'RIWAYAT';

export type BoqActionVariant =
  | 'emerald'
  | 'purple'
  | 'rose'
  | 'indigo'
  | 'sky'
  | 'amber'
  | 'teal'
  | 'neutral';

export type BoqActionIcon =
  | 'arrow-down-left'
  | 'arrow-up-right'
  | 'clipboard-check'
  | 'check-circle'
  | 'history';

export interface BoqPosEvaluation {
  stateCode: 'S-1' | 'S-2' | 'S-3' | 'S-4' | 'S-5' | 'S-6' | 'J-1' | 'J-2' | 'J-3' | 'J-4';
  statusKey: BoqPosStatusKey;
  statusLabel: string;                  // "Belum Masuk" | "Belum Serah" | "Belum Jalan" | "Siap Pakai" | "Proses" | "Habis" | "Tuntas" | "Lebih"
  statusBadgeClass: string;             // Kelas Tailwind Light & Dark baku
  statusDescription: string;            // Penjelasan singkat bebas ambigu sesuai POV
  isCriticalShortage: boolean;          // true HANYA untuk S-4 (Habis) — mencegah alarm palsu S-1
  providerAlert?: string;               // Peringatan eksplisit jika porsi campuran berbeda / talangan
  providerStockLabel?: string;          // Misal Tab 2 Material Campuran: "Porsi Klien: 0 ea"
  providerStockSubLabel?: string;       // Misal: "(Stok Kontraktor: 25 ea)"

  actionType: BoqActionType;            // Selalu tepat 1 Smart-Button: MASUK | PAKAI | CATAT_JASA | APPROVE | RIWAYAT
  actionLabel: string;                  // "Masuk" | "Pakai" | "Catat" | "Periksa" | "Setuju" | "Sahkan" | "Riwayat"
  actionVariant: BoqActionVariant;
  actionIcon: BoqActionIcon;
  actionTooltip: string;                // Saran kontekstual sesuai peran & penyedia
  showSecondaryHistoryIcon: boolean;    // true saat actionType !== 'RIWAYAT', false saat berubah jadi [ 🕒 Riwayat ]
  pendingApprovalAction: PendingApprovalAction | null;
  pendingApprovalCount?: number;        // Angka ringkas bila > 1 transaksi pending pada baris ini
  pendingApprovalMutationId?: string;   // ID mutasi target bila pengawas klik 1-klik Periksa/Setuju/Sahkan
  recommendedOrigin: AsalBarang;        // 'KONTRAKTOR' | 'KLIEN' (otomatis untuk wizard Masuk)
  isFreeIssue: boolean;
}

export interface WarehouseRowEvaluation {
  statusKey: 'TERSEDIA' | 'BELUM_MASUK' | 'BELUM_SERAH' | 'HABIS' | 'TUNTAS';
  statusLabel: string;
  actionType: 'MASUK' | 'PAKAI' | 'APPROVE' | 'RIWAYAT';
  actionLabel: string;
  actionVariant: BoqActionVariant;
  actionIcon: BoqActionIcon;
  actionTooltip: string;
  showSecondaryHistoryIcon: boolean;    // true saat actionType !== 'RIWAYAT'
  pendingApprovalAction: PendingApprovalAction | null;
  pendingApprovalCount?: number;
  pendingApprovalMutationId?: string;
  recommendedOrigin: AsalBarang;        // Ungu ('KLIEN') jika jatah kontraktor <= 0 & sisa klien > 0
  sisaBelumTiba: number;
  canQuickAddResidual: boolean;         // true bagi Clerk saat stok_fisik > 0 && sisaBelumTiba > 0 (micro-chip klik)
  residualChipVariant: 'emerald' | 'purple' | null;
}

export function resolveEvalContext(
  activeRole: ImpersonateRole,
  canIssue: boolean,
  branding: { contractorName?: string; clientName?: string },
  organizationParty?: PartyPOV
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

## 11. PETA INTEGRASI EFEK DOMINO & STRATEGI PENGUJIAN (ATURAN 3)

Seluruh 7 berkas berikut wajib terintegrasi serentak saat tahap implementasi kode:

1. **`src/lib/boqExecutionEngine.ts` *(Baru)*:** Mengimplementasikan `resolveEvalContext()`, `evaluateBoqPos()`, `evaluateWarehouseMaterial()`, pengecekan porsi penyedia material campuran, mikro-ikon, varian warna `emerald`/`purple`/`amber` WCAG AA, serta pencocokan antrean persetujuan serial peran aktif beserta jumlahnya (`pendingApprovalCount`).
2. **`src/lib/boqExecutionEngine.test.ts` *(Baru)*:** Menguji 100% kombinasi matriks:
   * `S-1` s.d. `S-6` (Material Fisik) dan `J-1` s.d. `J-4` (Pos Jasa).
   * Material Campuran (*19 mm Wall Angel Grid*: `I/E/14` Kontraktor vs `I/F/8` Jatah Klien + `providerStockLabel` + `providerAlert`).
   * *Smart-Button* lintas 7 peran `ImpersonateRole` (`Clerk` mendapat tombol mutasi atau `RIWAYAT` saat tuntas + `canQuickAddResidual` / `residualChipVariant`; `Foreman`/`Spv.`/`Dept. Mgr`/`KTT-PM`/`CEO` mendapat `APPROVE` + hitungan saat ada antrean atau `RIWAYAT` saat idle; `Viewer/Pengamat` mendapat `RIWAYAT` & proteksi finansial).
   * Verifikasi `isCriticalShortage` hanya bernilai `true` pada `S-4`.
3. **[src/context/AppContext.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx):**
   * Memisahkan dimensi pengadaan vs realisasi pemakaian (`qty_pemenuhan_sisa = qty_boq - qty_keluar_total`, `progress_pemenuhan` berdasarkan `qty_keluar_total`).
   * Mengunci `outOfStockCount` agar hanya menghitung pos dengan kondisi kritis **`S-4` (`Habis`)** sehingga bebas dari alarm palsu `S-1`.
4. **[src/components/StockMutationView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx):**
   * Menerapkan **Smart-Header** adaptif di bagian atas halaman (mengganti tombol Masuk/Keluar yang redup menjadi pintasan antrean pengawas atau pintasan kewajiban `Jatah Klien`).
   * Tab 1 memakai `evaluateWarehouseMaterial()` dengan *Fixed-Slot* 1 *Smart-Button* + *micro-chip* interaktif `[ X + ]` pada kolom `Sisa Belum Tiba` (`residualChipVariant`) + pembedaan tombol Ungu/Hijau.
   * Tab 2 memakai `evaluateBoqPos()` untuk badge Status Pos, tampilan `providerStockLabel` / `providerStockSubLabel` pada material campuran, pil filter adaptif Multi-POV (`Belum Serah` terdepan saat POV Klien), judul kolom adaptif (`Aksi Cepat` vs `Riwayat`), dan *Smart-Button* seragam (`[ ↓ Masuk ]` / `[ ↑ Pakai ]` / `[ ✓ Catat ]` / `[ ✓ Periksa/Setuju/Sahkan ]` / `[ 🕒 Riwayat ]`).
   * `handleOpenItemMutation` mendukung prefill otomatis `asalBarang = recommendedOrigin` (`KLIEN` / `JATAH_KLIEN` / Rp 0 saat berasal dari pos Jatah Klien), serta klik tombol persetujuan langsung mengarahkan ke transaksi di Tab 3.
   * Penyeragaman istilah UI: `Free-Issue Klien` $\rightarrow$ **`Jatah Klien`**.
5. **[src/components/InventoryView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/InventoryView.tsx):**
   * Mengganti badge dan tombol *hardcoded* lama dengan `evaluateBoqPos()` agar Master BOQ & Kontrol Stok identik dengan Mutasi Barang.
6. **[src/components/DashboardView.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/DashboardView.tsx) & [src/components/Sidebar.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/Sidebar.tsx):**
   * Kartu ringkasan Dasbor BOQ membaca evaluasi `evaluateBoqPos()` (`Tuntas · Proses · Siap Pakai · Belum Masuk`) agar angkanya 100% klop dengan Tab 2, dan badge `Butuh Stok` di Sidebar konsisten dengan definisi `S-4`.
7. **[src/lib/pdfGenerator.ts](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/lib/pdfGenerator.ts):**
   * Ekspor PDF Rekap Stok Gudang dan Ekspor PDF Realisasi Pos BOQ memanggil fungsi evaluasi engine yang sama agar status pada dokumen cetak **100% identik dengan layar**.

---

*Keputusan arsitektur Revisi 3 ini dinyatakan final (lengkap dengan desain & tata letak Smart-Buttons) dan siap dijadikan acuan langsung untuk tahap implementasi kode.*
