# PANDUAN TATA KELOLA KOREKSI DATA: METODE GANTI & VERIFIKASI NOTA RESMI
**Aplikasi Manajemen Proyek Cair — Jejak Audit Abadi & Integritas Finansial Lapangan**

---

## 1. Landasan Prinsip: CRU Tanpa Hapus & Anti Koreksi Siluman
Di industri konstruksi dan tata kelola proyek profesional, celah kecurangan (*fraud*) dan sengketa keuangan sering terjadi akibat dua hal:
1. **Penghapusan data (*Hard Delete*)**: Menghilangkan riwayat mutasi atau transaksi masa lalu.
2. **Koreksi langsung tanpa jejak (*In-Place Overwrite / Silent Edit*)**: Mengubah angka volume, harga, atau nama barang langsung di baris yang sama, sehingga bukti catatan awal saat truk tiba di proyek hilang.

Oleh karena itu, **Aplikasi Proyek Cair menetapkan prinsip baku**:
> **Semua data historis bersifat kekal (*Immutable Ledger*). Tidak ada tombol Hapus (*Delete*) dan tidak ada pengeditan siluman. Perubahan data dilakukan melalui mekanisme BATAL atau GANTI.**

---

## 2. Mekanisme Alur Penggantian Data (*Method: DIGANTI*)

Ketika material pertama kali diterima di lapangan, Petugas Lapangan (Clerk) mencatat kedatangan fisik barang meskipun harga belum pasti atau nota resmi masih menyusul:
- **Status Awal**: `NOTA_MENYUSUL` / `BELUM_DIKETAHUI`.
- **Harga Satuan**: Belum ada (`null`) atau estimasi.

Ketika nota resmi toko/supplier tiba (membawa nomor nota, tanggal nota, nama toko, dan harga riil satuan):
Clerk melakukan pembaruan melalui tombol aksi: **`Lengkapi Nota / Ganti Baris`**.

### Yang Terjadi di Latar Belakang (Dikelola Otomatis oleh Sistem):
1. **Baris Data Lama (Origin)**:
   - Diberi penanda `is_ganti: true` dan `status_dokumen: 'DIGANTI'`.
   - Mengisi kolom `referensi_ganti_id` dengan UUID Baris Baru.
   - Mencatat `alasan_batal_ganti`: misal *"Penyelarasan nota resmi TB Maju Jaya No. NTA-8821"*.
   - **Dampak Kalkulasi**: Seluruh nominal rupiah dan volume unit pada baris lama otomatis **dinolkan (diabaikan)** dari saldo fisik gudang, belanja riil, dan realisasi BOQ.
2. **Baris Data Baru (Replacement)**:
   - Dibuat dengan UUID baru (`id`), memuat:
     - Nomor Nota & Seri Kuitansi Toko.
     - Tanggal Nota Toko (sesuai tanggal cetak bon toko).
     - Nama Toko & Data Toko (kontak/alamat).
     - Harga Satuan Riil & Total Belanja Resmi.
     - Status Harga: `TERCATAT` / `ADA_HARGA`.
     - Tautan Bukti Nota: Foto/PDF scan nota fisik toko.
     - Mengisi kolom referensi bahwa ia menggantikan ID Baris Lama.
   - **Dampak Kalkulasi**: Menjadi baris aktif tunggal yang dihitung dalam saldo gudang, belanja riil proyek, dan ekspor dokumen.

---

## 3. Struktur Kolom & Skema Data Terkait Toko & Nota

| Nama Kolom / Properti | Tipe Data | Deskripsi & Kegunaan |
| :--- | :--- | :--- |
| `nama_toko` / `source_name` | `TEXT` | Nama resmi toko / distributor penyedia (contoh: *TB Sumber Rejeki*, *CV Baja Perkasa*). |
| `nomor_surat_jalan` / `nomor_nota` | `TEXT` | Nomor nota fisik, nomor bon faktur toko, atau nomor surat jalan pengiriman. |
| `tanggal_nota` | `TIMESTAMPTZ` | Tanggal resmi yang tercetak pada bon/nota toko (bisa berbeda dengan tanggal tiba di proyek). |
| `harga_satuan_beli` | `NUMERIC` | Harga satuan riil per unit barang sesuai yang ditagihkan toko (dalam Rupiah). |
| `total_harga_nota` | `NUMERIC` | Akumulasi `jumlah * harga_satuan_beli` setelah diskon nota. |
| `status_harga` | `TEXT` | `'TERCATAT'` \| `'NOTA_MENYUSUL'` \| `'BELUM_DIKETAHUI'` \| `'JATAH_KLIEN'`. |
| `lampiran_nota_url` | `TEXT` | URL penyimpanan berkas foto nota (JPG/PNG) atau pindaian PDF nota resmi toko. |
| `is_ganti` | `BOOLEAN` | `true` jika baris ini telah digantikan oleh baris transaksi baru yang lebih valid. |
| `referensi_ganti_id` | `UUID` | Pointer ID baris pengganti (untuk baris lama) atau ID baris asal (untuk baris baru). |
| `alasan_batal_ganti` | `TEXT` | Catatan audit alasan dilakukannya penggantian baris transaksi. |

---

## 4. Multi-POV: Multi Kepentingan Pihak Tanpa Merumitkan Pengguna

Sesuai kaidah aplikasi: **Kerumitan ditangani oleh sistem di latar belakang, tampilan pengguna tetap ringkas, ramah, dan intuitif**.

### A. Sudut Pandang Petugas Lapangan (Clerk / Logistik)
- **Kenyamanan**: Clerk tidak perlu menghapus, tidak perlu membuka kalkulator saldo, dan tidak perlu mengetik ulang seluruh data lama.
- **Tindakan**: Cukup klik tombol **`[ 📝 Lengkapi Nota ]`** pada baris yang masih berstatus nota menyusul.
- Form modal langsung terisi (*pre-filled*) dengan data barang sebelumnya. Clerk tinggal:
  1. Mengisi Nomor Nota & Tanggal Nota Toko.
  2. Memasukkan Nama Toko & Harga Satuan Riil.
  3. Mengunggah foto nota fisik (bisa langsung jepret kamera HP atau unggah PDF).
  4. Klik **`Simpan & Terapkan Nota Resmi`**.
- Sistem secara instan menonaktifkan baris lama dan menerbitkan baris baru berstatus tervalidasi nota.

### B. Sudut Pandang Mandor / Pengawas Lapangan (Supervisor / Foreman)
- Dapat memverifikasi apakah spesifikasi barang yang datang di lapangan sama dengan yang tercantum di nota toko.
- Dapat melihat tombol **`[ 📎 Lihat Bukti Nota ]`** untuk memastikan bon toko asli tidak direkayasa.

### C. Sudut Pandang Manajer Keuangan / CSA / Akuntan
- Rekonsiliasi 100% klop antara arus kas keluar (*Cash Out*) dengan total nota belanja riil gudang.
- Transparan: Jika ada selisih harga dari estimasi awal ke harga nota aktual, selisih tersebut tercatat historisnya dan tidak menimbulkan selisih gaib (*unreconciled discrepancy*).

### D. Sudut Pandang Direktur & Auditor Klien
- Ekspor Dokumen Berita Acara & Rekapitulasi PDF (format Lanskap) menampilkan nomor nota toko, nama toko, tanggal nota, dan lampiran referensi.
- Audit forensik terlindungi: Setiap penggantian baris memiliki jejak waktu (*timestamp*), identitas pelaku (*created_by_name*), dan alasan penggantian.

---

## 5. Integrasi Efek Domino dalam Aplikasi

1. **Efek ke Stok Fisik Gudang & BOQ**:
   - Sistem memastikan kuantitas tidak terhitung ganda (*double counting*). Baris bertanda `is_ganti: true` langsung dilewati (*filter out*) oleh fungsi agregasi stok.
2. **Efek ke Modul Mutasi Kas (Arus Kas Keluar)**:
   - Jika pembayaran barang menggunakan Kas Proyek (bon tunai), nomor kuitansi/nota langsung tersinkronisasi sehingga bagian keuangan dapat mencocokkan bon fisik dengan mutasi kas.
3. **Efek ke Ekspor PDF & Berita Acara**:
   - Baris yang diganti ditampilkan dengan gaya redup (*muted style*) atau disaring hanya menampilkan baris aktif final (sesuai opsi filter ekspor).
   - Kotak ringkasan KPI dan baris total kaki tabel (*footer*) otomatis memperhitungkan nilai belanja riil dari baris baru yang telah ber-nota resmi.

---

## 6. Perbedaan Tegas & Baku antara "BATAL" vs "GANTI" pada Nota Resmi

Dalam konteks tata kelola nota toko dan album berkas fisik proyek, tindakan **BATAL** dan **GANTI** memiliki tujuan, sifat hukum audit, dan konsekuensi operasional yang **berbeda secara fundamental**:

| Parameter Pembeda | Aksi: BATAL NOTA (*Void / Cancel*) | Aksi: GANTI NOTA (*Supersede / Replace*) |
| :--- | :--- | :--- |
| **Definisi & Esensi** | Nota fisik dinyatakan **gugur permanen / tidak sah** dan transaksi belanja tidak dilanjutkan. | Nota fisik lama **dialihkan ke versi pembaruan yang lebih valid** (estafet kelanjutan data). |
| **Kasus Penggunaan Riil** | - Pesanan dibatalkan supplier & dana dikembalikan penuh.<br/>- Bon fiktif / salah toko total yang bukan milik proyek.<br/>- Salah upload bon kuitansi belanja pribadi pekerja. | - Foto bon pertama buram/gelap, difoto ulang dengan resolusi tajam.<br/>- Kasir toko merevisi nomor nota karena salah ketik.<br/>- Penambahan lembar halaman 2 & 3 (faktur pajak/surat jalan toko).<br/>- Penyesuaian diskon susulan yang tertera di faktur resmi. |
| **Status Dokumen Nota Lama** | Diberi tanda `is_batal = true`, `status_verifikasi = 'BATAL'`. | Diberi tanda `is_ganti = true`, `status_verifikasi = 'DIGANTI'`. |
| **Keberadaan Dokumen Pengganti** | **TIDAK ADA**. `referensi_ganti_id = NULL`. Rantai berhenti di sini. | **WAJIB ADA**. `referensi_ganti_id = [UUID Nota Baru]`, dan nota baru mencatat ID nota lama. |
| **Konsekuensi ke Item Barang yang Terhubung** | **Tautan nota diputus**. Item barang dikembalikan ke status `NOTA_MENYUSUL` / tanpa bukti bon (harus dicari/dibuatkan nota sah lain). | **Otomatis dialihkan (*Auto-Remap*)**. Seluruh item mutasi yang tadinya menempel di nota lama otomatis menempel ke nota baru tanpa perlu input ulang. |
| **Konsekuensi Finansial Kas & Laporan** | Nilai nominal nota dinolkan 100% dan tidak diakui dalam audit belanja. | Nominal nota lama dinolkan, nilai nominal nota baru yang sah yang diakui dalam laporan keuangan. |

---

## 7. Arsitektur Entitas Mandiri `project_receipts` & Interaksi Album Mobile

Untuk mewujudkan interaksi dinamis layaknya galeri foto di smartphone (bisa digeser/scroll horizontal, buka lembar, zoom, serta aksi batal/ganti langsung dari album), sistem mengimplementasikan entitas database mandiri `project_receipts`.

### A. Skema Relasi Master-Detail
```
[project_receipts] (1 Nota Fisik Toko)
        │
        ├── 1:N ──> [inventory_transactions] (N Item Barang di dalam Nota)
        └── 1:N ──> [storage.objects] (N Lembar Foto Bukti Fisik / PDF)
```

1. **Tabel `project_receipts`**:
   - `id`: UUID (Primary Key).
   - `project_id`: ID Proyek aktif.
   - `reference_no`: Nomor seri / faktur nota toko.
   - `nama_toko`: Nama toko/distributor penyedia.
   - `tanggal_nota`: Tanggal cetak di bon toko.
   - `total_nota_fisik`: Grand total rupiah tercetak di bawah bon.
   - `lampiran_nota_urls`: Array URL foto bon fisik (bisa multi-lembar 1, 2, 3..).
   - `is_batal`, `is_ganti`, `referensi_ganti_id`, `alasan_batal_ganti`: Audit log CRU Tanpa Hapus.
2. **Tabel `inventory_transactions`**:
   - Memiliki foreign key `receipt_id` yang menunjuk ke `project_receipts.id`.
   - Tidak lagi menduplikasi teks nama toko dan array file di setiap baris item, melainkan mewarisi relasi dari nota induk.

### B. Fitur & Interaksi Album Ala Mobile Phone
1. **Carousel & Swipe Gestures (Sentuhan Halus)**:
   - Pengguna dapat menggeser layar (*touch swipe*) untuk berpindah lembar foto dalam 1 nota, atau berpindah antar kartu nota toko.
2. **Pinch-to-Zoom & Fullscreen Inspection**:
   - Membesarkan foto hingga 300% untuk memeriksa cap basah, paraf kasir, dan rincian harga eceran barang.
3. **Menu Aksi Cepat per Lembar Nota di Album**:
   - **`[ 🔗 Tautkan Item ]`**: Menghubungkan mutasi yang belum ber-nota ke nota ini.
   - **`[ 🔄 Ganti / Foto Ulang ]`**: Membuka alur GANTI nota resmi (foto lama disimpan, foto baru diterapkan).
   - **`[ 🚫 Batalkan Nota ]`**: Membatalkan nota jika transaksi toko gugur (dengan konfirmasi & input alasan audit).
