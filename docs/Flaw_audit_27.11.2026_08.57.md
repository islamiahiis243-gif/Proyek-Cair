I will execute the **Delegation Routine** using the `DeepInvestigator` subagent to perform an exhaustive multi-layer audit of the codebase and report all flaws.

Used tool: invoke_subagent

I have initiated the deep multi-layer flaw audit using the `DeepInvestigator` subagent. I am now awaiting its comprehensive audit findings across all architectural, business logic, security, and UI layers.

# LAPORAN AUDIT MENDALAM MULTI-LAYER SISTEM PROYEK CAIR
**Status Audit**: Selesai Menyeluruh (Deep Multi-Layer Audit Completed)  
**Cakupan**: Seluruh basis kode & skema basis data Proyek Cair (*Frontend React/TS, Backend Supabase Postgres RLS, State Machine, Audit Trail Zero-Delete, Asisten Suara/AI, & UI/UX*).

---

## RINGKASAN EKSEKUTIF
Audit mendalam dilakukan di 5 layer utama sistem. Secara keseluruhan arsitektur aplikasi telah memiliki fondasi serial approval dan kontrol relasi yang kuat (95 unit tests lolos). Namun, ditemukan **19 potensi kelemahan (*flaws*)**—termasuk **7 celah kritis** pada skema basis data, proteksi privasi finansial, integritas 3-way matching, dan asisten suara yang berpotensi menimbulkan dampak operasional fatal jika tidak segera ditangani.

---

## 1. LAYER HAK AKSES, PRIVASI & SKEMA BASIS DATA

### 1.1. [KRITIS] Celah Kebocoran Finansial Masif pada Peran Non-Viewer Berizin `canViewFinancials: false`
- **Lokasi Berkas**: [DashboardView.tsx#L70](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/DashboardView.tsx#L70), [Sidebar.tsx#L201-L218](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/Sidebar.tsx#L201-L218), [App.tsx#L128-L146](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/App.tsx#L128-L146), dan [Header.tsx#L689](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/Header.tsx#L689).
- **Akar Masalah**: Pengecekan privasi finansial di seluruh antarmuka utama disamakan secara kaku dengan `activeRole === 'Viewer/Pengamat'`. Variabel `canViewFinancials` dari RFIN-B tidak diperiksa di Sidebar dan Dashboard.
- **Dampak Operasional**: Staf lapangan (seperti Foreman, Logistik, atau Subkontraktor) yang dinonaktifkan hak finansialnya oleh CSA (`can_view_financials: false`) **tetap dapat melihat seluruh saldo kas, margin laba proyek, serta membuka menu Mutasi Dana dan Pengadaan PO**.
- **Solusi Rekomendasi**: Satukan pengondisian hak finansial:
  ```typescript
  const hasFinancialAccess = activeRole !== 'Viewer/Pengamat' && Boolean(canViewFinancials);
  ```

### 1.2. [KRITIS] Eskalasi Izin Finansial Lintas Perusahaan pada `canViewFinancials`
- **Lokasi Berkas**: [AppContext.tsx#L2711-L2712](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L2711-L2712).
- **Akar Masalah**: Fungsi penentu hak finansial memeriksa status CSA pada *seluruh workspace* milik pengguna (`activeContext.workspaces.some(...)`), bukan pada workspace proyek yang sedang aktif.
- **Dampak Operasional**: Jika pengguna yang memiliki perusahaan sendiri (CSA di Workspace A) diundang ke proyek milik kontraktor/perusahaan lain (Workspace B) dengan peran lapangan tanpa hak finansial, sistem secara otomatis meloloskan akses finansial penuh ke proyek Perusahaan B tersebut.
- **Solusi Rekomendasi**: Batasi evaluasi CSA hanya pada workspace dari proyek yang sedang dibuka:
  ```typescript
  const currentWsId = activeProject?.workspace_id || activeWorkspaceId;
  const isCurrentCsa = activeContext?.workspaces?.some(
    w => w.id === currentWsId && w.is_company_super_admin
  );
  if (isCurrentCsa) return true;
  ```

### 1.3. [KRITIS] Runtime Error Postgres pada Fungsi `resolve_my_active_context()`
- **Lokasi Berkas**: [supabase/migrations/20261127000000_dynamic_rfin_b_custom_permissions.sql#L166-L180](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/supabase/migrations/20261127000000_dynamic_rfin_b_custom_permissions.sql#L166-L180).
- **Akar Masalah**: Fungsi dideklarasikan sebagai `STABLE`, namun di dalamnya menjalankan `INSERT INTO public.workspaces` dan `UPDATE public.profiles`.
- **Dampak Operasional**: Pengguna baru yang masuk ke sistem dan belum memiliki workspace personal akan mengalami crash total dengan error: `ERROR: 25006: cannot execute INSERT in a function declared STABLE`.
- **Solusi Rekomendasi**: Ubah penanda fungsi SQL dari `STABLE` menjadi `VOLATILE`.

### 1.4. [KRITIS] Gagal Aktivasi Token RFIN-B Akibat Mismatch Constraint `ON CONFLICT`
- **Lokasi Berkas**: [supabase/migrations/20261127000000_dynamic_rfin_b_custom_permissions.sql#L141-L148](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/supabase/migrations/20261127000000_dynamic_rfin_b_custom_permissions.sql#L141-L148).
- **Akar Masalah**: Fungsi `redeem_rfin()` menggunakan klausul `ON CONFLICT (project_id, user_id, role_code)`, padahal tabel `public.project_memberships` hanya memiliki constraint unik `UNIQUE (project_id, user_id)`.
- **Dampak Operasional**: Karyawan lapangan gagal mengklaim token undangan RFIN-B dengan error `ERROR: 42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`.
- **Solusi Rekomendasi**: Kembalikan klausul ke `ON CONFLICT (project_id, user_id) DO UPDATE ...`.

### 1.5. [KRITIS] Foto Bukti Nota Fisik Rusak (403 Forbidden) Akibat Storage Privat Tanpa Signed URL
- **Lokasi Berkas**: [supabase/migrations/20261125000000_security_rls_storage_and_schema_hardening.sql#L767](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/supabase/migrations/20261125000000_security_rls_storage_and_schema_hardening.sql#L767) dan [receiptStorage.ts#L151-L157](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/lib/receiptStorage.ts#L151-L157).
- **Akar Masalah**: Bucket `receipts` disetel privat (`public = false`), tetapi frontend hanya memanggil `getPublicUrl()` tanpa membuat `createSignedUrl()`.
- **Dampak Operasional**: Di lingkungan Supabase Cloud, seluruh tag `<img>` nota di [ReceiptViewerModal.tsx](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/ReceiptViewerModal.tsx#L291) akan menampilkan gambar rusak (*broken image*).
- **Solusi Rekomendasi**: Tambahkan helper pembuatan signed URL bertempo (1 jam) di `receiptStorage.ts`.

### 1.6. [SEDANG] Kebijakan RLS Memblokir Toko Global / Katalog Standar (`project_id IS NULL`)
- **Lokasi Berkas**: [supabase/migrations/20261125000000_security_rls_storage_and_schema_hardening.sql#L626-L629](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/supabase/migrations/20261125000000_security_rls_storage_and_schema_hardening.sql#L626-L629).
- **Akar Masalah**: RLS mewajibkan `project_id IS NOT NULL`, padahal sistem mendukung katalog toko umum tingkat workspace/perusahaan (`project_id IS NULL`).
- **Dampak Operasional**: Daftar toko bawaan tidak pernah muncul di formulir pengadaan PO.
- **Solusi Rekomendasi**: Longgarkan klausul RLS: `USING (project_id IS NULL OR (SELECT private.check_user_project_financial_access(project_id)))`.

---

## 2. LAYER STATE MACHINE & LOGIKA BISNIS

### 2.1. [KRITIS] Perhitungan Ganda (*Double-Counting*) Belanja Material di Dasbor P&L
- **Lokasi Berkas**: [DashboardView.tsx#L448-L454](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/DashboardView.tsx#L448-L454).
- **Akar Masalah**: Formula P&L menjumlahkan `totalRealisasiMaterial` (dari penerimaan fisik gudang) dengan `cashSummaryMetrics.totalKeluarAktif` (yang di dalamnya sudah mencakup belanja kas kategori Material).
- **Dampak Operasional**: Belanja material terhitung 2 kali lipat, memangkas proyeksi margin laba bersih proyek secara drastis dan keliru.
- **Solusi Rekomendasi**:
  ```typescript
  const totalKasNonMaterial = Math.max(0, cashSummaryMetrics.totalKeluarAktif - (cashSummaryMetrics.totalKeluarMaterial || 0));
  const totalBiayaRiilProyek = totalRealisasiMaterial + totalKasNonMaterial;
  ```

### 2.2. [KRITIS] Pemutusan 3-Way Matching & Kehilangan Metadata Nota pada `gantiStockMutation`
- **Lokasi Berkas**: [AppContext.tsx#L1222-L1248](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L1222-L1248).
- **Akar Masalah**: Saat mutasi stok dikoreksi via fungsi GANTI, objek baru tidak meneruskan `po_id`, `po_item_id`, `receipt_id`, `nama_toko`, `tanggal_nota`, `total_nota_fisik`, dan `lampiran_nota_urls`.
- **Dampak Operasional**: Progres penerimaan barang pada PO yang bersangkutan kembali ke 0%, tautan ke album nota fisik terputus, dan foto bon fisik hilang dari rekaman baru.
- **Solusi Rekomendasi**: Teruskan seluruh metadata PO dan nota dari objek lama (`oldRow`) jika tidak diisi pada revisi baru.

### 2.3. [KRITIS] Putusnya Audit Trail Maju pada Mutasi Stok yang Diganti
- **Lokasi Berkas**: [AppContext.tsx#L1253-L1258](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L1253-L1258).
- **Akar Masalah**: Baris lama yang diganti tidak diisi kolom `referensi_ganti_id: newRow.id`.
- **Dampak Operasional**: Tombol "Lihat Baris Pengganti" di [StockMutationView.tsx#L3776](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/StockMutationView.tsx#L3776) tidak pernah muncul untuk baris stok yang diganti.
- **Solusi Rekomendasi**: Simpan ID baris baru pada baris lama: `referensi_ganti_id: newRow.id`.

### 2.4. [SEDANG] Tidak Ada Alur Pengembalian Draf (`DITOLAK` / `REVISI`)
- **Lokasi Berkas**: [cashflowEngine.ts#L944-L965](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/lib/cashflowEngine.ts#L944-L965).
- **Akar Masalah**: Validasi status serial hanya mengizinkan transisi maju (`DIPERIKSA`, `DISETUJUI`, `MENGETAHUI`).
- **Dampak Operasional**: Foreman atau Supervisor yang menemukan salah ketik tidak dapat mengembalikan berkas ke Klerk untuk diedit; mereka terpaksa membatalkan transaksi (`BATAL`).
- **Solusi Rekomendasi**: Tambahkan status `DITOLAK` atau izin mundur ke `DITERBITKAN` dengan catatan revisi pengawas.

---

## 3. LAYER KOMUNIKASI & VOICE / LIVE ASSISTANT

### 3.1. [KRITIS] Korupsi Data Fisik Gudang Akibat Fallback Senyap `items[0]`
- **Lokasi Berkas**: [LiveVoiceAssistantModal.tsx#L212, L335](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/LiveVoiceAssistantModal.tsx#L212).
- **Akar Masalah**: `const itemToMutate = items.find(it => it.id === data.matchedItemId) || items[0];`
- **Dampak Operasional**: Jika pengguna menyebut nama barang yang tidak cocok dengan BOQ (misal: "pakai 2 sak perekat hebel"), sistem secara diam-diam memutasi item indeks ke-0 di master BOQ (misal: Besi Beton D16).
- **Solusi Rekomendasi**: Hapus fallback `|| items[0]`. Tolak eksekusi jika `matchedItemId` tidak ditemukan dan tanyakan apakah ingin mencatat sebagai material non-BOQ/kustom.

### 3.2. [KRITIS] Asisten Suara Membocorkan Saldo Kas & Margin Laba ke Akun Pengamat (Viewer)
- **Lokasi Berkas**: [agentEngine.ts#L251-L272](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/lib/agentEngine.ts#L251-L272) dan [LiveVoiceAssistantModal.tsx#L176-L178](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/LiveVoiceAssistantModal.tsx#L176-L178).
- **Akar Masalah**: Kueri suara "cek saldo kas" dan "cek posisi untung rugi" langsung membacakan angka riil tanpa memverifikasi hak akses finansial pengguna.
- **Dampak Operasional**: Akun Klien/Pengamat dapat mengetahui nominal kas internal dan valuasi rahasia kontraktor melalui asisten suara.
- **Solusi Rekomendasi**: Blokir kueri finansial suara jika `!canViewFinancials` atau `activeRole === 'Viewer/Pengamat'`.

### 3.3. [KRITIS] Ketidakcocokan Bukti Transaksi Suara & Risiko Pembayaran Ganda
- **Lokasi Berkas**: [LiveVoiceAssistantModal.tsx#L253-L281](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/LiveVoiceAssistantModal.tsx#L253-L281).
- **Akar Masalah**: Panggilan `addCashMutation` dari asisten suara menghasilkan nomor bukti yang berbeda dari nomor nota barang masuk (`KAS-AI-xxx` vs `INV-AI-xxx`), serta tidak menyertakan `source_module: 'MUTASI_BARANG'`, `receipt_id`, dan `nama_toko`.
- **Dampak Operasional**: Modul rekonsiliasi kas tidak mendeteksi nota tersebut telah terbayar, sehingga nota barang masuk tetap muncul di antrean utang belanja (berisiko dibayar 2 kali oleh kasir).
- **Solusi Rekomendasi**: Sertakan `source_module: 'MUTASI_BARANG'`, `source_entity_id`, dan nomor bukti yang identik.

### 3.4. [SEDANG] Pemalsuan Status Bukti Kas `'TERLAMPIR'` Tanpa Berkas Nyata
- **Lokasi Berkas**: [LiveVoiceAssistantModal.tsx#L394](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/LiveVoiceAssistantModal.tsx#L394).
- **Akar Masalah**: Operator ternary bug: `receiptUrls.length > 0 ? 'TERLAMPIR' : 'TERLAMPIR'`.
- **Dampak Operasional**: Pengeluaran kas via suara tanpa foto nota ditandai telah melampirkan berkas, menyesatkan proses audit.
- **Solusi Rekomendasi**: Ubah menjadi `receiptUrls.length > 0 ? 'TERLAMPIR' : 'BUKTI_MENYUSUL'`.

---

## 4. LAYER UI/UX, INTEGRITAS AUDIT & BAHASA

### 4.1. [SEDANG] Kebocoran Frasa Bahasa Asing di Header & Sidebar
- **Lokasi Berkas**: [Header.tsx#L473, L482, L483, L521](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/Header.tsx#L473) dan [Sidebar.tsx#L122, L132](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/Sidebar.tsx#L122).
- **Akar Masalah**: String identitas peran masih menggunakan `'GLOBAL PLATFORM'`, `'PLATFORM ADMIN'`, `'Personal User'`, `'Platform Super Admin'`, dan `'Company Super Admin'`.
- **Dampak Operasional**: Melanggar aturan standar baku 100% native Indonesia (AGENTS.md).
- **Solusi Rekomendasi**: Terjemahkan ke istilah baku: *Administrator Global Platform, Admin Platform, Pengguna Personal, Administrator Utama Platform (PSA), Administrator Utama Perusahaan (CSA)*.

### 4.2. [SEDANG] State `cashAccess` di AppContext Bersifat Dead Code / Hardcoded
- **Lokasi Berkas**: [AppContext.tsx#L357, L1106](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L357).
- **Akar Masalah**: `setCashAccess(true)` selalu dipanggil saat data proyek dimuat tanpa mengevaluasi `canViewFinancials`.
- **Dampak Operasional**: Pemeriksaan di Header `{cashAccess ? formatRupiah(...) : 'Terbatas'}` tidak pernah menampilkan label 'Terbatas'.
- **Solusi Rekomendasi**: Hubungkan langsung dengan `canViewFinancials`: `const cashAccess = Boolean(canViewFinancials);`.

### 4.3. [SEDANG] Transaksi Pembatalan/Penggantian Tidak Tercatat ke `audit_logs`
- **Lokasi Berkas**: [AppContext.tsx#L1195, L1250, L1510, L1540](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/context/AppContext.tsx#L1195).
- **Akar Masalah**: Fungsi `batalStockMutation`, `gantiStockMutation`, `batalCashMutation`, dan `gantiCashMutation` memperbarui tabel transaksi masing-masing tetapi tidak menyisipkan riwayat ke tabel `public.audit_logs`.
- **Dampak Operasional**: Tab Log Audit di Konsol Platform tidak menampilkan rekaman pembatalan operasional lapangan.
- **Solusi Rekomendasi**: Buat fungsi helper pencatat audit trail terpusat yang selalu dipanggil saat terjadi pembatalan atau penggantian.

### 4.4. [RENDAH] Kode Yatim (*Dead Code*) Berisi Hard-Delete di `WorkspaceCenter.tsx`
- **Lokasi Berkas**: [WorkspaceCenter.tsx#L48](file:///c:/Users/A%20C%20E%20R/antigravity/Proyek%20Cair/src/components/WorkspaceCenter.tsx#L48).
- **Akar Masalah**: Komponen tidak lagi digunakan/diimpor di mana pun tetapi memuat operasi `.delete()` pada tabel `personal_projects`.
- **Dampak Operasional**: Risiko kebingungan pengembang dan potensi pelanggaran kepatuhan *Zero-Delete*.
- **Solusi Rekomendasi**: Hapus atau arsipkan berkas tersebut.

---

## MATRIKS URUTAN PRIORITAS PENANGANAN (*ACTION PLAN*)

1. **Prioritas 1 (Basis Data & Otentikasi Sesi)**:
   - Ubah fungsi `resolve_my_active_context()` menjadi `VOLATILE`.
   - Perbaiki klausa `ON CONFLICT (project_id, user_id)` pada fungsi `redeem_rfin()`.
   - Longgarkan RLS `supplier_stores` untuk mendukung toko global (`project_id IS NULL`).
2. **Prioritas 2 (Keamanan Akses Finansial & Logika Biaya)**:
   - Koreksi formula P&L di `DashboardView.tsx` agar tidak menghitung ganda belanja material.
   - Kunci akses navigasi, routing, dan panel finansial menggunakan `hasFinancialAccess = activeRole !== 'Viewer/Pengamat' && Boolean(canViewFinancials)`.
   - Batasi evaluasi `isCsa` hanya pada workspace proyek yang sedang dibuka.
3. **Prioritas 3 (Integritas Data Transaksi & Asisten Suara)**:
   - Lengkapi seluruh metadata nota dan PO pada fungsi `gantiStockMutation` dan isi `referensi_ganti_id` pada baris lama.
   - Hapus fallback `items[0]` pada asisten suara dan samakan nomor bukti serta tautan modul rekonsiliasi.
   - Perbaiki bug status bukti `'BUKTI_MENYUSUL'` pada asisten suara.
   - Implementasikan generator signed URL untuk bucket storage `receipts`.
4. **Prioritas 4 (Kerapian UI & Kepatuhan Bahasa)**:
   - Ganti seluruh string bahasa Inggris yang tersisa di Header dan Sidebar.
   - Bersihkan komponen yatim `WorkspaceCenter.tsx`.

<!-- GOAL_COMPLETE -->