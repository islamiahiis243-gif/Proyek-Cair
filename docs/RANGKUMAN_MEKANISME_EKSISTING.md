# Rangkuman Menyeluruh Mekanisme Eksisting Sistem — Proyek Cair

> **Status Sistem**: Aktif & Terverifikasi di Produksi  
> **Versi Basis Kode**: Proyek Cair (Vite + React 18 + TypeScript + Tailwind CSS + Supabase Postgres 17)  
> **Tujuan Dokumen**: Menjadi sumber kebenaran tunggal (*Single Source of Truth*) yang merangkum seluruh arsitektur, alur data, aturan bisnis, dan integrasi antar-modul yang saat ini aktif berjalan di aplikasi Proyek Cair.

---

## 1. Arsitektur Identitas & Multi-POV (*Multi-Point of View*)

Sistem menerapkan model tata kelola identitas 3 tingkat yang sederhana dan manusiawi tanpa redundansi teknis:

```
[ Pengguna Personal (Google Email) ] 
       │
       ▼ (Klaim Undangan RFIN-B)
[ Perusahaan / Tenant (Badan Usaha) ] 
       │
       ▼ (Penugasan Topi Kerja)
[ Proyek Aktif ] ──► [ Jabatan Resmi (Clerk, Spv, Manager, KTT, Direktur, Viewer) ]
```

### 1.1. Konsep Jabatan Tunggal
- Istilah ambigu seperti *"Persona"* dan *"Role"* telah dihapus total. Sistem hanya mengenal istilah resmi: **"Jabatan"**.
- Setiap jabatan membawa hak operasionalnya secara otomatis:
  - **Clerk / Petugas Lapangan**: Input draf mutasi stok barang masuk/keluar, unggah foto nota lapangan, pencatatan fisik.
  - **Supervisor / Foreman**: Pemeriksaan fisik lapangan, verifikasi nota, persetujuan tahap pertama.
  - **Dept. Manager / KTT / Project Manager**: Otorisasi Purchase Order (PO), pengeluaran kas, kontrol anggaran.
  - **Direktur / Direksi**: Pembubuhan Tanda Tangan Elektronik (TTE), persetujuan final dokumen resmi.
  - **Viewer / Pengamat (Sudut Pandang Klien / Pemberi Kerja)**: Mode khusus dengan isolasi privasi ketat.

### 1.2. Sistem Undangan RFIN-B
- Akses ke perusahaan dan proyek diberikan melalui token undangan **RFIN-B** (*Role, Function, Identification Network - Business*) yang diterbitkan oleh Corporate Super Admin (CSA).
- Pengguna cukup memiliki 1 akun email personal seumur hidup. Saat berpindah proyek atau merangkap jabatan, pengguna cukup mengganti "topi kerja" via dropdown header tanpa perlu logout.

### 1.3. *Privacy Guard* untuk Sudut Pandang Klien (*Viewer/Pengamat*)
- Demi menjaga kerahasiaan bisnis kontraktor:
  - Tombol aksi finansial (bayar kas, buat PO, edit harga modal) disembunyikan total.
  - Modul Kasbon / Panjar dan Jurnal Transaksi Kas internal disembunyikan.
  - Di Dasbor Analitik, rincian laba bersih kontraktor dan harga beli modal ke supplier disembunyikan (hanya menampilkan progres fisik volume pekerjaan dan aset jatah klien).
  - Tampilan nota belanja internal menyamarkan rincian margin harga modal.

---

## 2. Tata Kelola Data Kekal (*Immutable Audit & CRU Tanpa Hapus*)

Sistem menerapkan prinsip **CRU (Create, Read, Update)** tanpa fitur hapus fisik (*Hard Delete*) pada data transaksi operasional:

### 2.1. Status Pembatalan & Penggantian
1. **Status BATAL (`status = 'BATAL'`)**:
   - Jika terjadi kesalahan fatal (salah proyek, transaksi fiktif), data tidak dihapus dari basis data, melainkan ditandai sebagai `BATAL`.
   - Data batal dicoret secara visual di tabel, dikecualikan dari perhitungan saldo stok dan saldo kas, namun tetap tersimpan abadi sebagai jejak audit.
2. **Status DIGANTI (`status = 'DIGANTI'`)**:
   - Jika nota, nominal, atau kuantitas dikoreksi, baris data lama diberi status `DIGANTI` dan menunjuk ke `replacement_id` baris data baru.
   - Baris data baru mencatat `replaces_id` baris lama beserta alasan koreksi manusiawi (misal: *"Koreksi harga nota sobek oleh Spv"*).
   - Pengguna dapat melihat **Riwayat Pergantian Nota (*Audit Trail Forensik*)** secara transparan.

---

## 3. Modul BOQ & Manajemen Jalur Biaya

Bill of Quantities (BOQ) menjadi jangkar utama penyerapan anggaran dan pemantauan proyek:

### 3.1. Tiga Jalur Pengadaan BOQ
1. **Jalur A (Material Saja)**: Pos BOQ yang hanya menyerap material fisik ke gudang kontraktor.
2. **Jalur B (Jasa / Upah Tenaga Kerja)**: Pos BOQ non-fisik (misal: "Tenaga Kerja Sipil", mandor, tukang). Otomatis dialirkan ke kategori kas *Upah & Konsumsi*.
3. **Jalur C (Campuran / Material + Upah)**: Pos kombinasi material terpasang dan biaya tukang.

### 3.2. Jatah Klien vs Pengadaan Kontraktor
- **Pengadaan Kontraktor (`owner_type = 'KONTRAKTOR'`)**: Material yang dibeli menggunakan pagu anggaran kontrak kontraktor. Menyerap anggaran dan wajib dipertanggungjawabkan di buku kas.
- **Jatah Klien (`owner_type = 'KLIEN'`)**: Material yang disediakan langsung oleh pemilik proyek / pemberi tugas (bebas biaya bagi kontraktor).
  - Dicatat di gudang dengan harga Rp 0.
  - Tidak membebani pagu belanja kontraktor dan **TIDAK DITAGIHKAN** ke antrean kasir kontraktor.
- **Talangan Kontraktor**: Apabila kontraktor diminta menalangi material jatah klien terlebih dahulu, transaksi dicatat sebagai piutang klaim talangan klien (*Reimbursable Cost*).

---

## 4. Modul Gudang & Mutasi Stok

Mengelola aliran fisik logistik proyek dari gerbang masuk hingga pemakaian di lapangan:

### 4.1. Alur Mutasi Barang Masuk & Keluar
- **Barang Masuk (*Stock In*)**: Menambah saldo fisik gudang. Wajib mencantumkan nomor bukti (nomor nota fisik atau nomor otomatis sistem `INV-XXXXXX`).
- **Barang Keluar (*Stock Out*)**: Mengurangi saldo fisik gudang saat material didistribusikan ke pos pekerjaan lapangan tertentu (terkoneksi langsung ke pos item BOQ terkait).
- **Valuasi FIFO**: Menghitung nilai aset gudang menggunakan metode *First-In, First-Out* murni berdasarkan harga perolehan riil.

### 4.2. Pengelolaan Bukti Nota Fisik & Fitur Cropper Interaktif
- Mendukung multi-unggah berkas nota fisik (gambar JPG/PNG atau dokumen PDF).
- Dilengkapi alat pemotong nota (*Interactive Image Cropper*) yang terintegrasi di modal unggah untuk membuang latar belakang foto yang tidak perlu sebelum disimpan ke Supabase Storage.
- Penyimpanan nota terproteksi oleh kebijakan RLS (*Row Level Security*) Supabase dengan validasi tipe berkas (MIME) dan batas ukuran.

---

## 5. Modul Pengadaan & Purchase Order (PO Toko)

Mencegah pengadaan liar dan pembelian berlebih di luar kontrak:

### 5.1. Siklus Hidup PO (*State Machine PO-1 s/d PO-7*)
- `DRAFT`: Dibuat oleh tim lapangan / logistik.
- `MENUNGGU_PERSETUJUAN`: Menunggu otorisasi berjenjang (Supervisor / KTT).
- `DISETUJUI`: Telah diotorisasi dan siap dikirim ke toko/supplier.
- `DITERBITKAN`: Resmi dikirim ke toko mitra.
- `SEBAGIAN_TIBA`: Barang telah tiba sebagian di gudang proyek.
- `SELESAI`: Seluruh item barang telah lengkap diterima fisik dan divalidasi.
- `DIBATALKAN`: PO dibatalkan resmi dengan alasan tertulis.

### 5.2. Proteksi Anti-Beli-Ganda (*Anti-Overbudget Guard*)
- Sistem memvalidasi kuantitas yang dipesan terhadap sisa volume kuantitas kontrak BOQ.
- Memblokir penerbitan PO baru jika akumulasi kuantitas melebihi batas toleransi kontrak BOQ tanpa adanya *Change Order* / Addendum resmi.

---

## 6. Modul Mutasi Kas & Kontrol Anggaran Proyek

Mengelola seluruh perputaran uang tunai dan rekening bank proyek:

### 6.1. Delapan Pos Pengeluaran Resmi
1. **Material**: Pembelian bahan bangunan fisik proyek.
2. **Upah & Konsumsi**: Pembayaran tukang, mandor, konsumsi lapangan, lembur.
3. **Sewa Alat & Angkut**: Biaya mobilisasi alat berat, sewa molen, ongkos angkut truk.
4. **Operasional Kantor & Lapangan**: Listrik, air, ATK, pulsa, bensin proyek.
5. **Subkon & Spesialis**: Pembayaran pihak ketiga / mandor borong khusus.
6. **Perizinan & K3**: Retribusi, safety gear, sertifikasi K3, koordinasi lingkungan.
7. **Talangan Klien (Reimbursable)**: Biaya yang ditalangi kontraktor atas permintaan pemilik proyek.
8. **Lain-lain / Tak Terduga**: Pengeluaran darurat di luar pos utama.

### 6.2. Proteksi Saldo Kas Proyek
- Setiap transaksi kas keluar memvalidasi kecukupan saldo kas proyek.
- Sistem mencegah kas bersaldo minus (*Overdraft Protection*), mengharuskan adanya drop dana masuk terlebih dahulu sebelum pencairan dilakukan.

---

## 7. Rekonsiliasi Terpadu & Siklus Panjar / LPJ

Jembatan cerdas antara nota fisik gudang dengan buku kas keuangan:

### 7.1. Antrean Tagihan Nota Belanja Gudang
- Setiap nota belanja material/upah yang dicatat di mutasi gudang langsung masuk ke **Antrean Tagihan Tab 2 (Rekonsiliasi & Panjar)** jika belum dibayar kas.
- **Pengecualian Otomatis**: Nota Jatah Klien (aset gratis) otomatis diabaikan dari antrean.
- **Pelunasan Ekspres 2-Klik**: Kasir cukup klik tombol `[ ↗ Bayar ]` di samping nota, modal kas otomatis terisi (nama toko, tanggal, nominal, kategori, dan nomor referensi), klik simpan, dan nota seketika tercatat lunas.
- **Penanganan Otomatis Nota Tanpa Nomor**: Jika nota gudang tidak memiliki nomor fisik, sistem menerbitkan nomor referensi unik `INV-XXXXXX` yang otomatis saling terkunci antara tabel mutasi gudang dan tabel mutasi kas.

### 7.2. Siklus Pertanggungjawaban Panjar (LPJ Kasbon)
Mendukung 3 skenario penyelesaian panjar operasional:
1. **Kasus A (Pas / Tepat Sesuai Nota)**: Total belanja nota sama persis dengan uang panjar yang diserahkan. Panjar ditutup lunas.
2. **Kasus B (Sisa / Uang Berlebih)**: Total belanja nota lebih kecil dari panjar. Sisa uang tunai disetorkan kembali ke kasir dan dibukukan sebagai transaksi Kas Masuk (*Pengembalian Sisa Panjar*).
3. **Kasus C (Kurang / Nombok)**: Belanja lapangan melebihi uang panjar. Kasir membayarkan uang pengganti (*Reimbursement*) kepada pemegang panjar sebagai transaksi Kas Keluar tambahan.

---

## 8. Dasbor Analitik & Real-Time Profit & Loss (P&L)

Pusat kendali eksekutif untuk memantau kesehatan finansial dan fisik proyek secara instan:

### 8.1. Empat Kartu KPI Finansial Utama
1. **Pagu Kontrak BOQ Kontraktor**: Total nilai kontrak kerja yang disepakati (Material + Upah).
2. **Total Realisasi Beban Riil**: Akumulasi biaya riil yang telah terserap (Belanja Gudang + Kas Lapangan).
3. **Proyeksi Laba Berjalan**:
   $$\text{Laba Berjalan (Rp)} = \text{Pagu Kontrak BOQ} - \text{Total Realisasi Beban Riil}$$
   Dilengkapi badge persentase margin keuntungan bersih dan penanda visual (*Surplus / Defisit*).
4. **Efisiensi Harga Satuan Material**: Total penghematan riil belanja material lapangan dibandingkan pagu harga satuan pada dokumen kontrak BOQ.

### 8.2. Tabel Analisis Deviasi Harga Satuan BOQ vs Harga Beli Riil
- Menyajikan perbandingan detail per item material:
  - Satuan ukuran & kuantitas volume.
  - Harga satuan standar BOQ vs Rata-rata harga beli riil di lapangan.
  - Deviasi rupiah per unit & persentase selisih.
  - Total dampak finansial penghematan atau pemborosan.
- Dilengkapi tab filter cepat: `Semua`, `🟢 Hemat`, `🔴 Over Pagu`, dan `⚪ Lainnya`.

### 8.3. Widget Mutasi Terkini yang Ringkas
- Daftar mutasi barang terkini dan mutasi kas terkini dibatasi maksimal **2 baris** agar dasbor tetap bersih, fokus, dan tidak menggeser tabel performa untung-rugi.

---

## 9. TTE Digital, Dokumen Resmi, & Verifikasi Publik QR Code

Menjamin kekuatan hukum dan keaslian dokumen proyek:

### 9.1. Dokumen Berita Acara & Laporan Resmi
- Sistem menghasilkan dokumen resmi terformat rapi: Berita Acara Serah Terima (BAST), Berita Acara Opname Pekerjaan, Laporan Realisasi Anggaran, dan Rekapitulasi Kasbon.
- Dilengkapi Tanda Tangan Elektronik (TTE) multi-pihak berjenjang (Disiapkan oleh Clerk, Diperiksa oleh Supervisor, Disetujui oleh Direktur / KTT).

### 9.2. Sertifikat Publik & Halaman Verifikasi QR Code
- Setiap dokumen resmi yang diterbitkan disematkan QR Code unik.
- Siapapun (termasuk auditor eksternal atau klien) dapat memindai QR Code tersebut menggunakan kamera HP untuk membuka rute publik:
  `/verify-doc/:documentId`
- Halaman publik menampilkan:
  - Segel Keabsahan Digital Resmi.
  - Ringkasan dokumen (Judul, Nomor Resmi, Tanggal Pengesahan).
  - Identitas penandatangan sah beserta stempel waktu (*Timestamp*).
  - Kode Hash Sidik Jari Kriptografis (SHA-256) untuk membuktikan dokumen fisik tidak pernah diubah atau dipalsukan setelah diterbitkan.

---
*Dokumen ini diperbarui secara berkala sebagai cerminan akurat dari kondisi basis kode dan skema basis data produksi Proyek Cair.*
